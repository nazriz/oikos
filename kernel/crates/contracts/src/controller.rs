//! A participant's controller (opaque to the kernel): held with the long members of its params that others' have too
//! held once, for all of them (SC-1). A town's people each have a controller whose params are some 23 KB of JSON, nearly
//! all of it the same for everyone (the ventures on offer, demand, institutions...) and only a few hundred bytes their
//! own (their values, beliefs, origin); as JSON values each was a quarter of a megabyte, 2.5 GB at 10,000 people. Read
//! as a whole (`to_value`, its serialisation, its equality) it is exactly the controller as given: what is shared is a
//! matter of how it is kept, never of what it says.

use oikos_core::canon;
use oikos_core::frozen::{Frozen, Obj};
use oikos_core::Id;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex, Weak};

/// A member of a controller's params is held once for all who have it alike when its canonical JSON (with its name) is
/// at least this long (a shorter one costs less than the sharing does).
const SHARE_AT: usize = 128;

/// One member of a params map: its name and value.
pub type Member = (Id, Frozen);

#[derive(Clone)]
pub struct Controller {
    /// The controller as given, its params without the members in `shared` (frozen: R2).
    top: Frozen,
    /// The params' long members, in name order, each held once for everyone who has it alike (empty: none apart).
    shared: Arc<[Arc<Member>]>,
}

/// The members held, by their name and canonical JSON.
static HELD: Mutex<Option<BTreeMap<Vec<u8>, Weak<Member>>>> = Mutex::new(None);

impl Controller {
    /// A controller as given: its params' long members looked up among those already held, and shared where the same.
    pub fn new(mut v: Value) -> Controller {
        let Some(Value::Object(params)) = v.get_mut("params") else { return Controller::whole(v) };
        let mut shared = Vec::new();
        let mut buf = Vec::new();
        let names: Vec<String> = params.keys().cloned().collect();
        let mut held = HELD.lock().unwrap_or_else(|e| e.into_inner());
        let held = held.get_or_insert_with(BTreeMap::new);
        for k in names {
            buf.clear();
            canon::write_string(&k, &mut buf);
            buf.push(b':');
            canon::write_value(&params[&k], &mut buf);
            if buf.len() < SHARE_AT {
                continue;
            }
            let x = params.remove(&k).expect("a member just named");
            let m = match held.get(&buf).and_then(Weak::upgrade) {
                Some(m) => m,
                None => {
                    let m = Arc::new((Id::from_string(k), Frozen::from(x)));
                    // (Members no one holds any more are let go of now and then.)
                    if held.len() % 4096 == 4095 {
                        held.retain(|_, w| w.strong_count() > 0);
                    }
                    held.insert(buf.clone(), Arc::downgrade(&m));
                    m
                }
            };
            shared.push(m);
        }
        // (In name order already: the map's own order.)
        Controller { top: Frozen::from(v), shared: shared.into() }
    }

    fn whole(v: Value) -> Controller {
        Controller { top: Frozen::from(v), shared: Arc::from([]) }
    }

    /// A member of the controller other than its params (`params`, `params_value`): its type, impl, code...
    pub fn get(&self, key: &str) -> Option<&Frozen> {
        assert!(key != "params", "a controller's params are read with `params_value` or `parts` (they are kept in parts)");
        self.top.get(key)
    }

    /// The controller as given, whole.
    pub fn to_value(&self) -> Value {
        let mut v = self.top.to_value();
        if !self.shared.is_empty() {
            v["params"] = self.params_value();
        }
        v
    }

    /// Its params as given, whole (null where it has none).
    pub fn params_value(&self) -> Value {
        let mut m = match self.top.get("params") {
            Some(Frozen::Object(m)) => m.to_map(),
            Some(other) => return other.to_value(),
            None => return Value::Null,
        };
        for x in self.shared.iter() {
            m.insert(x.0.to_string(), x.1.to_value());
        }
        Value::Object(m)
    }

    /// How it is kept: the controller with its own params, and the members shared (for a view of the params that
    /// reads both: the actors' `Params`).
    pub fn parts(&self) -> (&Frozen, &Arc<[Arc<Member>]>) {
        (&self.top, &self.shared)
    }

    /// Whether any of its params' members are held shared (for tests and counts).
    pub fn shares(&self) -> bool {
        !self.shared.is_empty()
    }
}

/// The members of an object and of a list of members apart from it (keys apart; the list in name order), in key order:
/// the order an object of them all would give.
pub fn merged<'a>(a: &'a Obj, b: &'a [Arc<Member>]) -> impl Iterator<Item = (&'a Id, &'a Frozen)> {
    let mut x = a.iter().peekable();
    let mut y = b.iter().map(|m| (&m.0, &m.1)).peekable();
    std::iter::from_fn(move || match (x.peek(), y.peek()) {
        (Some((ka, _)), Some((kb, _))) => {
            if ka.as_bytes() <= kb.as_bytes() {
                x.next()
            } else {
                y.next()
            }
        }
        (Some(_), None) => x.next(),
        (None, Some(_)) => y.next(),
        (None, None) => None,
    })
}

/// Something read from JSON text, held once for all who read the same text (`text` is its key; `read` makes it the
/// first time): for what many actors are given alike and read into a shape of their own (a town's ventures, in each
/// person's params). Nothing is kept that could differ between them: the same text gives the same thing, which none of
/// them can change (it is shared, not theirs). Kept while anyone holds it.
pub fn read_once<T: Send + Sync + 'static, E>(text: &str, read: impl FnOnce() -> Result<T, E>) -> Result<Arc<T>, E> {
    use std::any::{Any, TypeId};
    type Read = BTreeMap<(TypeId, String), Weak<dyn Any + Send + Sync>>;
    static READ: Mutex<Option<Read>> = Mutex::new(None);
    let key = (TypeId::of::<T>(), text.to_string());
    if let Some(x) = READ.lock().unwrap_or_else(|e| e.into_inner()).as_ref().and_then(|h| h.get(&key)).and_then(Weak::upgrade) {
        if let Ok(x) = x.downcast::<T>() {
            return Ok(x);
        }
    }
    let x = Arc::new(read()?);
    let mut held = READ.lock().unwrap_or_else(|e| e.into_inner());
    let held = held.get_or_insert_with(BTreeMap::new);
    if held.len() % 64 == 63 {
        held.retain(|_, w| w.strong_count() > 0);
    }
    let any: Arc<dyn Any + Send + Sync> = x.clone();
    held.insert(key, Arc::downgrade(&any));
    Ok(x)
}

impl From<Value> for Controller {
    fn from(v: Value) -> Controller {
        Controller::new(v)
    }
}

impl Default for Controller {
    fn default() -> Controller {
        Controller { top: Frozen::Null, shared: Arc::from([]) }
    }
}

impl PartialEq for Controller {
    fn eq(&self, o: &Controller) -> bool {
        let same_shared = self.shared.len() == o.shared.len() && self.shared.iter().zip(o.shared.iter()).all(|(a, b)| Arc::ptr_eq(a, b));
        if same_shared {
            self.top == o.top
        } else {
            self.to_value() == o.to_value()
        }
    }
}

impl Eq for Controller {}

impl std::fmt::Debug for Controller {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.to_value().fmt(f)
    }
}

impl Serialize for Controller {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        if self.shared.is_empty() {
            return self.top.serialize(s);
        }
        let Frozen::Object(top) = &self.top else { unreachable!("a controller with shared params is an object") };
        struct Params<'a>(&'a Obj, &'a [Arc<Member>]);
        impl Serialize for Params<'_> {
            fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
                let mut m = s.serialize_map(Some(self.0.len() + self.1.len()))?;
                for (k, v) in merged(self.0, self.1) {
                    m.serialize_entry(k.as_str(), v)?;
                }
                m.end()
            }
        }
        let mut m = s.serialize_map(Some(top.len()))?;
        for (k, v) in top {
            match (k.as_str(), v) {
                ("params", Frozen::Object(own)) => m.serialize_entry(k.as_str(), &Params(own, &self.shared))?,
                _ => m.serialize_entry(k.as_str(), v)?,
            }
        }
        m.end()
    }
}

impl<'de> Deserialize<'de> for Controller {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Controller, D::Error> {
        Value::deserialize(d).map(Controller::new)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn long(n: i64) -> Value {
        json!({ "list": (0..40).map(|i| json!({ "kind": format!("k{i}"), "n": n })).collect::<Vec<_>>() })
    }

    #[test]
    fn a_controller_kept_in_parts_is_the_controller_given() {
        let given = json!({ "type": "code", "impl": "x", "params": { "a": 1, "big": long(1), "own": [1, 2], "zz": long(2), "b": "s" } });
        let c = Controller::new(given.clone());
        assert!(c.shares());
        assert_eq!(c.to_value(), given);
        assert_eq!(serde_json::to_value(&c).unwrap(), given);
        assert_eq!(canon::canonical(&c).unwrap(), canon::canonical_value(&given).unwrap());
        assert_eq!(c.params_value(), given["params"]);
        let (top, shared) = c.parts();
        assert_eq!(top["params"], json!({ "a": 1, "own": [1, 2], "b": "s" }));
        assert_eq!(shared.iter().map(|m| m.0.as_str()).collect::<Vec<_>>(), ["big", "zz"]);
        assert_eq!(merged(top["params"].as_object().unwrap(), shared).map(|(k, _)| k.as_str()).collect::<Vec<_>>(), ["a", "b", "big", "own", "zz"]);
        // Another's alike holds the same members; one with a long member of its own holds that one apart.
        let d = Controller::new(json!({ "type": "code", "impl": "x", "params": { "a": 2, "big": long(1), "zz": long(2) } }));
        assert!(Arc::ptr_eq(&c.parts().1[0], &d.parts().1[0]) && Arc::ptr_eq(&c.parts().1[1], &d.parts().1[1]));
        let e = Controller::new(json!({ "type": "code", "impl": "x", "params": { "a": 2, "big": long(3), "zz": long(2) } }));
        assert!(!Arc::ptr_eq(&c.parts().1[0], &e.parts().1[0]) && Arc::ptr_eq(&c.parts().1[1], &e.parts().1[1]));
        // Equal when what they say is the same, however kept.
        assert_eq!(Controller::new(given.clone()), c);
        assert_ne!(d, c);
        assert_eq!(serde_json::from_value::<Controller>(given.clone()).unwrap(), c);
        // Small, or without params: kept as given.
        for v in [json!({ "type": "code", "impl": "y", "params": { "a": 1 } }), json!({ "type": "llm" }), json!(null), json!({ "params": 3 })] {
            let c = Controller::new(v.clone());
            assert!(!c.shares());
            assert_eq!(c.to_value(), v);
        }
    }
}
