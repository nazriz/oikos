//! A JSON value held compactly, for what the world keeps and never changes in place (docs/design/performance.md, "A
//! plan for what is left", R2): records' opaque parts, entities' record sections, the config's controllers. It is
//! immutable; an object is a sorted array of (interned key, value), not a tree of nodes; arrays, objects and strings
//! are behind `Arc`, so a copy shares them. It reads as `serde_json::Value` does (`get`, `as_str`, indexing...), and is
//! written as the same value would be: a field's bytes, every hash and the log are what they were.

use crate::id::Id;
use serde::de::{self, DeserializeSeed, IntoDeserializer, MapAccess, SeqAccess, Visitor};
use serde::ser::{SerializeMap, SerializeSeq};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::{Number, Value};
use std::fmt;
use std::sync::Arc;

/// A JSON value, frozen.
#[derive(Clone, Default)]
pub enum Frozen {
    #[default]
    Null,
    Bool(bool),
    Number(Number),
    String(Arc<str>),
    Array(Arc<[Frozen]>),
    Object(Obj),
}

/// An object: its members in key order, each key once.
#[derive(Clone, Default)]
pub struct Obj(Option<Arc<[(Id, Frozen)]>>);

pub static NULL: Frozen = Frozen::Null;
/// An empty object.
pub static EMPTY: Frozen = Frozen::Object(Obj(None));

impl Obj {
    pub fn get(&self, k: &str) -> Option<&Frozen> {
        let m = self.0.as_deref()?;
        m.binary_search_by(|(x, _)| x.as_str().cmp(k)).ok().map(|i| &m[i].1)
    }
    pub fn contains_key(&self, k: &str) -> bool {
        self.get(k).is_some()
    }
    pub fn len(&self) -> usize {
        self.0.as_deref().map_or(0, |m| m.len())
    }
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
    pub fn iter(&self) -> impl DoubleEndedIterator<Item = (&Id, &Frozen)> + ExactSizeIterator {
        self.0.as_deref().unwrap_or_default().iter().map(|(k, v)| (k, v))
    }
    pub fn keys(&self) -> impl DoubleEndedIterator<Item = &Id> + ExactSizeIterator {
        self.iter().map(|(k, _)| k)
    }
    pub fn values(&self) -> impl DoubleEndedIterator<Item = &Frozen> + ExactSizeIterator {
        self.iter().map(|(_, v)| v)
    }
    /// Members already in key order, each key once.
    fn of_sorted(m: Vec<(Id, Frozen)>) -> Obj {
        Obj(if m.is_empty() { None } else { Some(m.into()) })
    }
    /// The object with these members (a later one of the same key replaces an earlier, as a map's insert does).
    pub fn from_members(mut m: Vec<(Id, Frozen)>) -> Obj {
        m.sort_by(|a, b| a.0.cmp(&b.0));
        let mut out: Vec<(Id, Frozen)> = Vec::with_capacity(m.len());
        for (k, v) in m {
            match out.last_mut() {
                Some(l) if l.0 == k => l.1 = v,
                _ => out.push((k, v)),
            }
        }
        Obj::of_sorted(out)
    }
    pub fn to_map(&self) -> serde_json::Map<String, Value> {
        self.iter().map(|(k, v)| (k.to_string(), v.to_value())).collect()
    }
}

impl<'a> IntoIterator for &'a Obj {
    type Item = (&'a Id, &'a Frozen);
    type IntoIter = std::iter::Map<std::slice::Iter<'a, (Id, Frozen)>, fn(&'a (Id, Frozen)) -> (&'a Id, &'a Frozen)>;
    fn into_iter(self) -> Self::IntoIter {
        self.0.as_deref().unwrap_or_default().iter().map(|(k, v)| (k, v))
    }
}

/// What a value may be indexed by: a key, or a place in an array (as `serde_json::value::Index`).
pub trait Index {
    fn index_into<'v>(&self, v: &'v Frozen) -> Option<&'v Frozen>;
}
impl Index for str {
    fn index_into<'v>(&self, v: &'v Frozen) -> Option<&'v Frozen> {
        match v {
            Frozen::Object(m) => m.get(self),
            _ => None,
        }
    }
}
impl Index for String {
    fn index_into<'v>(&self, v: &'v Frozen) -> Option<&'v Frozen> {
        self.as_str().index_into(v)
    }
}
impl Index for usize {
    fn index_into<'v>(&self, v: &'v Frozen) -> Option<&'v Frozen> {
        match v {
            Frozen::Array(a) => a.get(*self),
            _ => None,
        }
    }
}
impl<T: Index + ?Sized> Index for &T {
    fn index_into<'v>(&self, v: &'v Frozen) -> Option<&'v Frozen> {
        (**self).index_into(v)
    }
}

impl Frozen {
    /// A value frozen.
    pub fn of(v: &Value) -> Frozen {
        match v {
            Value::Null => Frozen::Null,
            Value::Bool(b) => Frozen::Bool(*b),
            Value::Number(n) => Frozen::Number(n.clone()),
            Value::String(s) => Frozen::String(s.as_str().into()),
            Value::Array(a) => Frozen::Array(a.iter().map(Frozen::of).collect()),
            // (A map's members are in key order already.)
            Value::Object(m) => Frozen::Object(Obj::of_sorted(m.iter().map(|(k, v)| (Id::new(k), Frozen::of(v))).collect())),
        }
    }
    /// The value as a `serde_json::Value`, made afresh.
    pub fn to_value(&self) -> Value {
        match self {
            Frozen::Null => Value::Null,
            Frozen::Bool(b) => Value::Bool(*b),
            Frozen::Number(n) => Value::Number(n.clone()),
            Frozen::String(s) => Value::String(s.to_string()),
            Frozen::Array(a) => Value::Array(a.iter().map(Frozen::to_value).collect()),
            Frozen::Object(m) => Value::Object(m.to_map()),
        }
    }
    pub fn get<I: Index>(&self, i: I) -> Option<&Frozen> {
        i.index_into(self)
    }
    pub fn pointer(&self, p: &str) -> Option<&Frozen> {
        if p.is_empty() {
            return Some(self);
        }
        let p = p.strip_prefix('/')?;
        p.split('/').map(|t| t.replace("~1", "/").replace("~0", "~")).try_fold(self, |v, t| match v {
            Frozen::Object(m) => m.get(&t),
            Frozen::Array(a) => t.parse::<usize>().ok().and_then(|i| a.get(i)),
            _ => None,
        })
    }
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Frozen::String(s) => Some(s),
            _ => None,
        }
    }
    pub fn as_i64(&self) -> Option<i64> {
        match self {
            Frozen::Number(n) => n.as_i64(),
            _ => None,
        }
    }
    pub fn as_u64(&self) -> Option<u64> {
        match self {
            Frozen::Number(n) => n.as_u64(),
            _ => None,
        }
    }
    pub fn as_bool(&self) -> Option<bool> {
        match self {
            Frozen::Bool(b) => Some(*b),
            _ => None,
        }
    }
    pub fn as_number(&self) -> Option<&Number> {
        match self {
            Frozen::Number(n) => Some(n),
            _ => None,
        }
    }
    pub fn as_array(&self) -> Option<&[Frozen]> {
        match self {
            Frozen::Array(a) => Some(a),
            _ => None,
        }
    }
    pub fn as_object(&self) -> Option<&Obj> {
        match self {
            Frozen::Object(m) => Some(m),
            _ => None,
        }
    }
    pub fn is_null(&self) -> bool {
        matches!(self, Frozen::Null)
    }
    pub fn is_object(&self) -> bool {
        matches!(self, Frozen::Object(_))
    }
    pub fn is_array(&self) -> bool {
        matches!(self, Frozen::Array(_))
    }
    pub fn is_string(&self) -> bool {
        matches!(self, Frozen::String(_))
    }
    pub fn is_number(&self) -> bool {
        matches!(self, Frozen::Number(_))
    }
    pub fn is_boolean(&self) -> bool {
        matches!(self, Frozen::Bool(_))
    }
    pub fn is_i64(&self) -> bool {
        matches!(self, Frozen::Number(n) if n.is_i64())
    }
    pub fn is_u64(&self) -> bool {
        matches!(self, Frozen::Number(n) if n.is_u64())
    }
}

impl<I: Index> std::ops::Index<I> for Frozen {
    type Output = Frozen;
    fn index(&self, i: I) -> &Frozen {
        i.index_into(self).unwrap_or(&NULL)
    }
}

impl From<Value> for Frozen {
    fn from(v: Value) -> Frozen {
        match v {
            Value::Null => Frozen::Null,
            Value::Bool(b) => Frozen::Bool(b),
            Value::Number(n) => Frozen::Number(n),
            Value::String(s) => Frozen::String(s.into()),
            Value::Array(a) => Frozen::Array(a.into_iter().map(Frozen::from).collect()),
            Value::Object(m) => Frozen::Object(Obj::of_sorted(m.into_iter().map(|(k, v)| (Id::from_string(k), Frozen::from(v))).collect())),
        }
    }
}
impl From<&Value> for Frozen {
    fn from(v: &Value) -> Frozen {
        Frozen::of(v)
    }
}
impl From<&Frozen> for Value {
    fn from(v: &Frozen) -> Value {
        v.to_value()
    }
}
impl From<Frozen> for Value {
    fn from(v: Frozen) -> Value {
        v.to_value()
    }
}

impl PartialEq for Frozen {
    fn eq(&self, o: &Frozen) -> bool {
        match (self, o) {
            (Frozen::Null, Frozen::Null) => true,
            (Frozen::Bool(a), Frozen::Bool(b)) => a == b,
            (Frozen::Number(a), Frozen::Number(b)) => a == b,
            (Frozen::String(a), Frozen::String(b)) => a == b,
            (Frozen::Array(a), Frozen::Array(b)) => Arc::ptr_eq(a, b) || a[..] == b[..],
            (Frozen::Object(a), Frozen::Object(b)) => match (&a.0, &b.0) {
                (Some(x), Some(y)) => Arc::ptr_eq(x, y) || x[..] == y[..],
                (x, y) => x.is_none() && y.is_none(),
            },
            _ => false,
        }
    }
}
impl Eq for Frozen {}
impl PartialEq<Value> for Frozen {
    fn eq(&self, o: &Value) -> bool {
        match (self, o) {
            (Frozen::Null, Value::Null) => true,
            (Frozen::Bool(a), Value::Bool(b)) => a == b,
            (Frozen::Number(a), Value::Number(b)) => a == b,
            (Frozen::String(a), Value::String(b)) => **a == **b,
            (Frozen::Array(a), Value::Array(b)) => a.len() == b.len() && a.iter().zip(b).all(|(x, y)| x == y),
            (Frozen::Object(a), Value::Object(b)) => a.len() == b.len() && a.iter().zip(b).all(|((k, x), (l, y))| k == l && x == y),
            _ => false,
        }
    }
}
impl PartialEq<Frozen> for Value {
    fn eq(&self, o: &Frozen) -> bool {
        o == self
    }
}
impl PartialEq<str> for Frozen {
    fn eq(&self, o: &str) -> bool {
        self.as_str() == Some(o)
    }
}
impl PartialEq<&str> for Frozen {
    fn eq(&self, o: &&str) -> bool {
        self.as_str() == Some(*o)
    }
}
impl PartialEq<String> for Frozen {
    fn eq(&self, o: &String) -> bool {
        self.as_str() == Some(o.as_str())
    }
}
impl PartialEq<bool> for Frozen {
    fn eq(&self, o: &bool) -> bool {
        self.as_bool() == Some(*o)
    }
}
impl PartialEq<i64> for Frozen {
    fn eq(&self, o: &i64) -> bool {
        self.as_i64() == Some(*o)
    }
}

impl fmt::Debug for Frozen {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Debug::fmt(&self.to_value(), f)
    }
}
impl fmt::Display for Frozen {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(&self.to_value(), f)
    }
}

impl Serialize for Frozen {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            Frozen::Null => s.serialize_unit(),
            Frozen::Bool(b) => s.serialize_bool(*b),
            Frozen::Number(n) => n.serialize(s),
            Frozen::String(x) => s.serialize_str(x),
            Frozen::Array(a) => {
                let mut q = s.serialize_seq(Some(a.len()))?;
                for x in a.iter() {
                    q.serialize_element(x)?;
                }
                q.end()
            }
            Frozen::Object(m) => {
                let mut q = s.serialize_map(Some(m.len()))?;
                for (k, v) in m {
                    q.serialize_entry(k.as_str(), v)?;
                }
                q.end()
            }
        }
    }
}

impl<'de> Deserialize<'de> for Frozen {
    /// Read as the `Value` it is, then frozen: whatever `Value` takes, a number of any kind among it, `Frozen` takes the
    /// same, and refuses it where `Value` was refused (a float, at its canonical form), as it was.
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Frozen, D::Error> {
        Value::deserialize(d).map(Frozen::from)
    }
}

/// A JSON value seen, whichever way it is held (`Value` or `Frozen`): for code that reads either alike.
#[derive(Clone, Copy)]
pub enum JsonRef<'a> {
    Null,
    Bool(bool),
    Number(&'a Number),
    String(&'a str),
    Array(Items<'a>),
    Object(Members2<'a>),
}

/// An array seen through `JsonRef`.
#[derive(Clone, Copy)]
pub enum Items<'a> {
    Value(&'a [Value]),
    Frozen(&'a [Frozen]),
}
impl<'a> Items<'a> {
    pub fn len(&self) -> usize {
        match self {
            Items::Value(a) => a.len(),
            Items::Frozen(a) => a.len(),
        }
    }
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
    pub fn iter(&self) -> impl Iterator<Item = JsonRef<'a>> + 'a {
        let (a, b) = match *self {
            Items::Value(a) => (Some(a.iter().map(JsonRead::view)), None),
            Items::Frozen(a) => (None, Some(a.iter().map(JsonRead::view))),
        };
        a.into_iter().flatten().chain(b.into_iter().flatten())
    }
}

/// An object seen through `JsonRef`.
#[derive(Clone, Copy)]
pub enum Members2<'a> {
    Value(&'a serde_json::Map<String, Value>),
    Frozen(&'a Obj),
}
impl<'a> Members2<'a> {
    pub fn get(&self, k: &str) -> Option<JsonRef<'a>> {
        match *self {
            Members2::Value(m) => m.get(k).map(JsonRead::view),
            Members2::Frozen(m) => m.get(k).map(JsonRead::view),
        }
    }
    pub fn len(&self) -> usize {
        match self {
            Members2::Value(m) => m.len(),
            Members2::Frozen(m) => m.len(),
        }
    }
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// What reads a JSON value, held either way.
pub trait JsonRead {
    fn view(&self) -> JsonRef<'_>;
    /// A whole number from a number or from digits (a float or anything else: not a whole number).
    fn whole(&self) -> Option<i64> {
        match self.view() {
            JsonRef::Number(n) => n.as_i64(),
            JsonRef::String(s) => s.trim().parse::<i64>().ok(),
            _ => None,
        }
    }
}
impl JsonRead for Value {
    fn view(&self) -> JsonRef<'_> {
        match self {
            Value::Null => JsonRef::Null,
            Value::Bool(b) => JsonRef::Bool(*b),
            Value::Number(n) => JsonRef::Number(n),
            Value::String(s) => JsonRef::String(s),
            Value::Array(a) => JsonRef::Array(Items::Value(a)),
            Value::Object(m) => JsonRef::Object(Members2::Value(m)),
        }
    }
}
impl JsonRead for Frozen {
    fn view(&self) -> JsonRef<'_> {
        match self {
            Frozen::Null => JsonRef::Null,
            Frozen::Bool(b) => JsonRef::Bool(*b),
            Frozen::Number(n) => JsonRef::Number(n),
            Frozen::String(s) => JsonRef::String(s),
            Frozen::Array(a) => JsonRef::Array(Items::Frozen(a)),
            Frozen::Object(m) => JsonRef::Object(Members2::Frozen(m)),
        }
    }
}
impl JsonRead for JsonRef<'_> {
    fn view(&self) -> JsonRef<'_> {
        *self
    }
}
impl<T: JsonRead + ?Sized> JsonRead for &T {
    fn view(&self) -> JsonRef<'_> {
        (**self).view()
    }
}
impl<'a> JsonRef<'a> {
    pub fn as_str(self) -> Option<&'a str> {
        match self {
            JsonRef::String(s) => Some(s),
            _ => None,
        }
    }
    pub fn as_i64(self) -> Option<i64> {
        match self {
            JsonRef::Number(n) => n.as_i64(),
            _ => None,
        }
    }
    pub fn get(self, k: &str) -> Option<JsonRef<'a>> {
        match self {
            JsonRef::Object(m) => m.get(k),
            _ => None,
        }
    }
}

/// A type read from a frozen value, as `serde_json::from_value` reads one from a `Value`.
pub fn from_frozen<'a, T: Deserialize<'a>>(v: &'a Frozen) -> Result<T, serde_json::Error> {
    T::deserialize(v)
}

impl<'de> Deserializer<'de> for &'de Frozen {
    type Error = serde_json::Error;
    fn deserialize_any<V: Visitor<'de>>(self, v: V) -> Result<V::Value, Self::Error> {
        match self {
            Frozen::Null => v.visit_unit(),
            Frozen::Bool(b) => v.visit_bool(*b),
            Frozen::Number(n) => n.deserialize_any(v),
            Frozen::String(s) => v.visit_borrowed_str(s),
            Frozen::Array(a) => {
                let mut q = Seq(a.iter());
                let r = v.visit_seq(&mut q)?;
                if q.0.len() == 0 {
                    Ok(r)
                } else {
                    Err(de::Error::invalid_length(a.len(), &"fewer elements in array"))
                }
            }
            Frozen::Object(m) => {
                let mut q = Members { it: m.iter(), value: None };
                let r = v.visit_map(&mut q)?;
                if q.it.len() == 0 {
                    Ok(r)
                } else {
                    Err(de::Error::invalid_length(m.len(), &"fewer elements in map"))
                }
            }
        }
    }
    fn deserialize_option<V: Visitor<'de>>(self, v: V) -> Result<V::Value, Self::Error> {
        match self {
            Frozen::Null => v.visit_none(),
            _ => v.visit_some(self),
        }
    }
    fn deserialize_enum<V: Visitor<'de>>(self, _name: &'static str, _variants: &'static [&'static str], v: V) -> Result<V::Value, Self::Error> {
        match self {
            Frozen::String(s) => v.visit_enum((&**s).into_deserializer()),
            Frozen::Object(m) if m.len() == 1 => {
                let (k, x) = m.iter().next().expect("one member");
                v.visit_enum(Variant { key: k.as_str(), value: x })
            }
            _ => Err(de::Error::invalid_type(de::Unexpected::Other("not a string or a map of one"), &"an enum")),
        }
    }
    fn deserialize_newtype_struct<V: Visitor<'de>>(self, _name: &'static str, v: V) -> Result<V::Value, Self::Error> {
        v.visit_newtype_struct(self)
    }
    // (The two float kinds by hand, as the world has no floating point and its source does not name them.)
    fn deserialize_f32<V: Visitor<'de>>(self, v: V) -> Result<V::Value, Self::Error> {
        self.deserialize_any(v)
    }
    fn deserialize_f64<V: Visitor<'de>>(self, v: V) -> Result<V::Value, Self::Error> {
        self.deserialize_any(v)
    }
    serde::forward_to_deserialize_any! {
        bool i8 i16 i32 i64 i128 u8 u16 u32 u64 u128 char str string bytes byte_buf unit unit_struct seq tuple
        tuple_struct map struct identifier ignored_any
    }
}

struct Seq<'de>(std::slice::Iter<'de, Frozen>);
impl<'de> SeqAccess<'de> for Seq<'de> {
    type Error = serde_json::Error;
    fn next_element_seed<T: DeserializeSeed<'de>>(&mut self, seed: T) -> Result<Option<T::Value>, Self::Error> {
        self.0.next().map(|x| seed.deserialize(x)).transpose()
    }
    fn size_hint(&self) -> Option<usize> {
        Some(self.0.len())
    }
}

struct Members<'de, I: Iterator<Item = (&'de Id, &'de Frozen)>> {
    it: I,
    value: Option<&'de Frozen>,
}
impl<'de, I: Iterator<Item = (&'de Id, &'de Frozen)> + ExactSizeIterator> MapAccess<'de> for Members<'de, I> {
    type Error = serde_json::Error;
    fn next_key_seed<K: DeserializeSeed<'de>>(&mut self, seed: K) -> Result<Option<K::Value>, Self::Error> {
        match self.it.next() {
            Some((k, v)) => {
                self.value = Some(v);
                seed.deserialize(de::value::BorrowedStrDeserializer::<serde_json::Error>::new(k.text())).map(Some)
            }
            None => Ok(None),
        }
    }
    fn next_value_seed<V: DeserializeSeed<'de>>(&mut self, seed: V) -> Result<V::Value, Self::Error> {
        seed.deserialize(self.value.take().expect("a value after its key"))
    }
    fn size_hint(&self) -> Option<usize> {
        Some(self.it.len())
    }
}

struct Variant<'de> {
    key: &'de str,
    value: &'de Frozen,
}
impl<'de> de::EnumAccess<'de> for Variant<'de> {
    type Error = serde_json::Error;
    type Variant = &'de Frozen;
    fn variant_seed<V: DeserializeSeed<'de>>(self, seed: V) -> Result<(V::Value, &'de Frozen), Self::Error> {
        Ok((seed.deserialize(de::value::BorrowedStrDeserializer::<serde_json::Error>::new(self.key))?, self.value))
    }
}
impl<'de> de::VariantAccess<'de> for &'de Frozen {
    type Error = serde_json::Error;
    fn unit_variant(self) -> Result<(), Self::Error> {
        Deserialize::deserialize(self)
    }
    fn newtype_variant_seed<T: DeserializeSeed<'de>>(self, seed: T) -> Result<T::Value, Self::Error> {
        seed.deserialize(self)
    }
    fn tuple_variant<V: Visitor<'de>>(self, _len: usize, v: V) -> Result<V::Value, Self::Error> {
        Deserializer::deserialize_any(self, v)
    }
    fn struct_variant<V: Visitor<'de>>(self, _fields: &'static [&'static str], v: V) -> Result<V::Value, Self::Error> {
        Deserializer::deserialize_any(self, v)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_frozen_value_reads_and_is_written_as_the_value_it_was() {
        let v = json!({ "b": [1, -2, "x", null, true, { "z": 1, "a": [] }], "a": { "k": "v" }, "n": 9007199254740991i64, "e": {}, "s": "é\n" });
        let f = Frozen::of(&v);
        assert_eq!(serde_json::to_string(&f).unwrap(), serde_json::to_string(&v).unwrap());
        assert_eq!(crate::canon::canonical(&f).unwrap(), crate::canon::canonical(&v).unwrap());
        assert_eq!(f.to_value(), v);
        assert_eq!(Frozen::from(v.clone()), f);
        assert!(f == v && v == f);
        assert_eq!(serde_json::from_str::<Frozen>(&v.to_string()).unwrap(), f);
        assert_eq!(f["a"]["k"], "v");
        assert_eq!(f["b"][1].as_i64(), Some(-2));
        assert!(f["nothing"]["deeper"].is_null() && f.get("nothing").is_none());
        assert_eq!(f.pointer("/b/5/z").and_then(Frozen::as_i64), Some(1));
        assert_eq!(f.as_object().unwrap().keys().map(|k| k.as_str()).collect::<Vec<_>>(), ["a", "b", "e", "n", "s"]);
        assert_eq!(format!("{f:?}"), format!("{v:?}"));
        assert_eq!(f.to_string(), v.to_string());
        // Read into a type as from the value.
        #[derive(Deserialize, Debug, PartialEq)]
        struct T {
            a: std::collections::BTreeMap<String, String>,
            n: i64,
            #[serde(default)]
            missing: Option<u32>,
        }
        assert_eq!(from_frozen::<T>(&f).unwrap(), serde_json::from_value::<T>(v.clone()).unwrap());
        // A later member of the same key wins, as in a map.
        assert_eq!(serde_json::from_str::<Frozen>(r#"{"a":1,"a":2}"#).unwrap(), json!({ "a": 2 }));
    }
}
