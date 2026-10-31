//! Ids, interned (docs/design/performance.md, "A plan for what is left", R1): an id is a handle on the one copy of its
//! text the process holds, so a record, a ledger, a map's key and a person's knowledge that name the same participant
//! share it. It is ordered, hashed, compared and serialised as the string it is, so every map's order, every hash and
//! the log are what they were when it was a `String`. (The table of texts is the process's, behind locks, so ids made
//! on any thread are the same ids; where an id's text is held decides nothing.) Ids are never freed: what names something in a run names it for
//! the run (records are kept whole), and an id made only to look something up is the id of something already there.

use std::borrow::Borrow;
use std::fmt;
use std::hash::{Hash, Hasher};
use std::ops::Deref;
use std::sync::{LazyLock, RwLock};

/// An interned id: two are equal exactly when they are the same copy.
#[derive(Clone, Copy)]
pub struct Id(&'static str);

const SHARDS: usize = 64;
static TABLE: LazyLock<[RwLock<Texts>; SHARDS]> = LazyLock::new(|| std::array::from_fn(|_| RwLock::new(Texts::default())));

/// FNV-1a of a text: which shard holds it, and where in the shard's table it is looked for. Nothing else depends on
/// it (ids are ordered and hashed by their text, never by where they are held).
fn fnv(s: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in s.as_bytes() {
        h = (h ^ u64::from(*b)).wrapping_mul(0x0100_0000_01b3);
    }
    h
}

/// One shard's texts: an open-addressed table (linear probing, at most half full), only ever looked up and added to;
/// and the texts themselves, written one after another into blocks held for the process (a text a block alone: one of
/// its own), so that they do not lie among what is made and let go of while the run goes on.
#[derive(Default)]
struct Texts {
    slots: Vec<Option<&'static str>>,
    len: usize,
    rest: &'static mut [u8],
}

/// The size of a block of texts.
const BLOCK: usize = 4 * 1024;

impl Texts {
    fn find(&self, s: &str, h: u64) -> Option<&'static str> {
        if self.slots.is_empty() {
            return None;
        }
        let mask = self.slots.len() - 1;
        let mut i = (h as usize) & mask;
        while let Some(k) = self.slots[i] {
            if k == s {
                return Some(k);
            }
            i = (i + 1) & mask;
        }
        None
    }
    /// The text, kept for the process.
    fn keep(&mut self, s: &str) -> &'static str {
        if s.len() > BLOCK / 4 {
            return Box::leak(s.to_owned().into_boxed_str());
        }
        if s.len() > self.rest.len() {
            self.rest = Box::leak(vec![0u8; BLOCK].into_boxed_slice());
        }
        let (head, tail) = std::mem::take(&mut self.rest).split_at_mut(s.len());
        head.copy_from_slice(s.as_bytes());
        self.rest = tail;
        let head: &'static [u8] = head;
        std::str::from_utf8(head).expect("a text copied whole is text")
    }
    fn add(&mut self, k: &'static str, h: u64) {
        if (self.len + 1) * 2 > self.slots.len() {
            let size = (self.slots.len() * 2).max(64);
            let old = std::mem::replace(&mut self.slots, vec![None; size]);
            self.len = 0;
            for o in old.into_iter().flatten() {
                self.put(o, fnv(o));
            }
        }
        self.put(k, h);
    }
    fn put(&mut self, k: &'static str, h: u64) {
        let mask = self.slots.len() - 1;
        let mut i = (h as usize) & mask;
        while self.slots[i].is_some() {
            i = (i + 1) & mask;
        }
        self.slots[i] = Some(k);
        self.len += 1;
    }
}

impl Id {
    /// The id of this text: the one copy of it, made if it is new.
    pub fn new(s: &str) -> Id {
        Id::interned(s)
    }
    /// As `new`, from a string made for it.
    pub fn from_string(s: String) -> Id {
        Id::interned(&s)
    }
    fn interned(s: &str) -> Id {
        let h = fnv(s);
        let t = &TABLE[(h >> 58) as usize % SHARDS];
        if let Some(k) = t.read().unwrap_or_else(|e| e.into_inner()).find(s, h) {
            return Id(k);
        }
        let mut w = t.write().unwrap_or_else(|e| e.into_inner());
        if let Some(k) = w.find(s, h) {
            return Id(k);
        }
        let k = w.keep(s);
        w.add(k, h);
        Id(k)
    }
    pub fn as_str(&self) -> &str {
        self.0
    }
    /// Its text, for as long as the process lives.
    pub fn text(self) -> &'static str {
        self.0
    }
}

/// How many texts the process holds as ids, and their bytes (for whoever measures memory).
pub fn interned() -> (usize, usize) {
    TABLE.iter().fold((0, 0), |(n, b), t| {
        let t = t.read().unwrap_or_else(|e| e.into_inner());
        (n + t.len, b + t.slots.iter().flatten().map(|k| k.len()).sum::<usize>())
    })
}

impl Default for Id {
    fn default() -> Id {
        Id::new("")
    }
}

impl PartialEq for Id {
    fn eq(&self, o: &Id) -> bool {
        std::ptr::eq(self.0, o.0)
    }
}
impl Eq for Id {}
impl PartialOrd for Id {
    fn partial_cmp(&self, o: &Id) -> Option<std::cmp::Ordering> {
        Some(self.cmp(o))
    }
}
impl Ord for Id {
    fn cmp(&self, o: &Id) -> std::cmp::Ordering {
        if std::ptr::eq(self.0, o.0) {
            std::cmp::Ordering::Equal
        } else {
            self.0.cmp(o.0)
        }
    }
}
impl Hash for Id {
    fn hash<H: Hasher>(&self, h: &mut H) {
        self.0.hash(h)
    }
}
impl Deref for Id {
    type Target = str;
    fn deref(&self) -> &str {
        self.0
    }
}
impl AsRef<str> for Id {
    fn as_ref(&self) -> &str {
        self.0
    }
}
impl Borrow<str> for Id {
    fn borrow(&self) -> &str {
        self.0
    }
}
impl fmt::Debug for Id {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Debug::fmt(self.0, f)
    }
}
impl fmt::Display for Id {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.0)
    }
}
impl From<&str> for Id {
    fn from(s: &str) -> Id {
        Id::new(s)
    }
}
impl From<&String> for Id {
    fn from(s: &String) -> Id {
        Id::new(s)
    }
}
impl From<String> for Id {
    fn from(s: String) -> Id {
        Id::from_string(s)
    }
}
impl From<&Id> for Id {
    fn from(s: &Id) -> Id {
        *s
    }
}
impl From<Id> for String {
    fn from(s: Id) -> String {
        s.0.to_owned()
    }
}
impl PartialEq<str> for Id {
    fn eq(&self, o: &str) -> bool {
        self.0 == o
    }
}
impl PartialEq<&str> for Id {
    fn eq(&self, o: &&str) -> bool {
        self.0 == *o
    }
}
impl PartialEq<String> for Id {
    fn eq(&self, o: &String) -> bool {
        self.0 == o.as_str()
    }
}
impl PartialEq<Id> for str {
    fn eq(&self, o: &Id) -> bool {
        self == o.0
    }
}
impl PartialEq<Id> for &str {
    fn eq(&self, o: &Id) -> bool {
        *self == o.0
    }
}
impl PartialEq<Id> for String {
    fn eq(&self, o: &Id) -> bool {
        self.as_str() == o.0
    }
}

impl serde::Serialize for Id {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(self.0)
    }
}
impl<'de> serde::Deserialize<'de> for Id {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Id, D::Error> {
        struct V;
        impl serde::de::Visitor<'_> for V {
            type Value = Id;
            fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("a string")
            }
            fn visit_str<E>(self, v: &str) -> Result<Id, E> {
                Ok(Id::new(v))
            }
            fn visit_string<E>(self, v: String) -> Result<Id, E> {
                Ok(Id::from_string(v))
            }
        }
        d.deserialize_str(V)
    }
}

impl From<Id> for serde_json::Value {
    fn from(s: Id) -> serde_json::Value {
        serde_json::Value::String(s.0.to_owned())
    }
}
impl From<&Id> for serde_json::Value {
    fn from(s: &Id) -> serde_json::Value {
        serde_json::Value::String(s.0.to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::Id;

    #[test]
    fn an_id_is_its_text_ordered_hashed_and_written_as_a_string_is() {
        let (a, b) = (Id::new("rec.10"), Id::from_string(format!("rec.{}", 9)));
        assert_eq!(a, Id::from_string("rec.10".to_string()));
        assert!(std::ptr::eq(a.as_str(), Id::new("rec.10").as_str()), "one copy of each text");
        assert_eq!(a.cmp(&b), "rec.10".cmp("rec.9"));
        let mut ids: Vec<Id> = (0..5000).map(|i| Id::from_string(format!("x.{i}"))).collect();
        let mut texts: Vec<String> = (0..5000).map(|i| format!("x.{i}")).collect();
        ids.sort();
        texts.sort();
        assert!(ids.iter().zip(&texts).all(|(i, t)| i == t));
        assert_eq!(serde_json::to_string(&a).unwrap(), serde_json::to_string("rec.10").unwrap());
        assert_eq!(serde_json::from_str::<Id>("\"rec.10\"").unwrap(), a);
        let h = |x: &dyn Fn(&mut std::collections::hash_map::DefaultHasher)| {
            let mut s = std::collections::hash_map::DefaultHasher::new();
            x(&mut s);
            std::hash::Hasher::finish(&s)
        };
        assert_eq!(h(&|s| std::hash::Hash::hash(&a, s)), h(&|s| std::hash::Hash::hash("rec.10", s)));
    }
}
