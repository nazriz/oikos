//! The papers modules write and read (docs/port-guide.md, section 5): every statement kind one module writes and
//! another reads has one Rust type here, its `data` typed. This is the whole interface between modules, with
//! agreements (`agreements`), payments, letters and forms, so it is fixed before the lanes start (step 1b).
//!
//! **How a paper type is written.**
//! - A `struct` (or `enum`, for a kind whose data takes several shapes) that derives `Serialize`, `Deserialize`,
//!   `Debug`, `Clone`, `PartialEq`, and implements [`Paper`] with the statement kind it is.
//! - Its doc comment says who writes it and who reads it, by TS module (the lane that owns it is the writer's), and
//!   anything a reader relies on that the type cannot say (an amount is cents; a time is seconds from the world's
//!   start; a duration is seconds).
//! - Every field the writer may leave out is an `Option` with `#[serde(default, skip_serializing_if =
//!   "Option::is_none")]`, a list with `#[serde(default, skip_serializing_if = "Vec::is_empty")]`, so that what is
//!   written is what TS wrote (TS left `undefined` keys out). A field always written is plain.
//! - Unknown fields are allowed when reading (a writer may add one; old papers lack one), never denied.
//! - Money is `i64` cents (`#name` in a form), times and durations `i64` seconds, ids `String`, basis points `i64`.
//! - Fields whose content is another contract's shape (an `offer`, an `outcome`) are typed where this crate has the
//!   type (`agreements::Outcome`), else `serde_json::Value`, with the shape named in the comment.
//!
//! **Ownership.** A paper type is owned by the lane of its writer (the file it is in). It is changed only with the
//! readers' lanes told (SendMessage) and a line in the decisions log. A kind with writers in more than one lane is in
//! the file of the first writer named in its doc, and the others write it through the same type.
//!
//! **Reading and writing.** A writer puts `data(&paper)` into `steps::Say { data, .. }`; a reader takes
//! `read::<P>(record)` (none: not a statement of that kind, or its data does not read as `P`, which is a writer's
//! fault, and is counted by the caller where it matters).

use oikos_sight::{Record, RecordBody};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;

pub mod agreements;
pub mod citizen;
pub mod finance;
pub mod firms;
pub mod market;
pub mod mind;
pub mod offices;

/// A statement kind with typed data.
pub trait Paper: Serialize + DeserializeOwned + Clone {
    /// The statement's `kind`.
    const KIND: &'static str;
}

/// A paper's data, as the statement carries it (`Null` never: a paper with no data is a unit struct written as `{}`).
pub fn data<P: Paper>(p: &P) -> Value {
    serde_json::to_value(p).unwrap_or(Value::Null)
}

/// The data of a statement of `P`'s kind, read as `P`; none if the record is not one, or its data does not read.
pub fn read<P: Paper>(r: &Record) -> Option<P> {
    match &r.body {
        RecordBody::Statement { kind, data, .. } if kind == P::KIND => {
            serde_json::from_value(data.clone().unwrap_or_else(|| Value::Object(Default::default()))).ok()
        }
        _ => None,
    }
}

/// Whether a record is a statement of `P`'s kind (whatever its data).
pub fn is<P: Paper>(r: &Record) -> bool {
    matches!(&r.body, RecordBody::Statement { kind, .. } if kind == P::KIND)
}

/// Every paper kind this crate types, with the file (lane) it is in: the registry the backstops and the guide read.
pub fn kinds() -> Vec<(&'static str, &'static str)> {
    let mut v: Vec<(&'static str, &'static str)> = vec![];
    v.extend(citizen::KINDS.iter().map(|k| (*k, "citizen")));
    v.extend(mind::KINDS.iter().map(|k| (*k, "mind")));
    v.extend(firms::KINDS.iter().map(|k| (*k, "firms")));
    v.extend(market::KINDS.iter().map(|k| (*k, "market")));
    v.extend(finance::KINDS.iter().map(|k| (*k, "finance")));
    v.extend(offices::KINDS.iter().map(|k| (*k, "offices")));
    v.sort();
    v
}

/// A unit-like paper type's data: `{}` (a kind whose meaning is all in its words and addressees).
#[derive(Debug, Clone, Default, PartialEq, Serialize, serde::Deserialize)]
pub struct Empty {}

/// Reading numbers as writers wrote them. A code module writes an amount as a whole number; a seat's paper filled in
/// on a form writes a field marked `=name` as the form reads it (an amount as a decimal string in the smallest unit,
/// contracts: FormWrites) and one marked `#name` as a whole number. Readers in TS took either (`Number(x)`,
/// `cents(x)`). Use `#[serde(default, deserialize_with = "lenient::opt_int")]` on an `Option<i64>` that either may
/// write, `#[serde(deserialize_with = "lenient::int")]` on an `i64` always written. Writing is always a number.
pub mod lenient {
    use serde::{Deserialize, Deserializer};
    use serde_json::Value;

    /// A whole number from a number or from digits (a float or anything else: not a whole number).
    pub fn whole(v: &Value) -> Option<i64> {
        match v {
            Value::Number(n) => n.as_i64(),
            Value::String(s) => s.trim().parse::<i64>().ok(),
            _ => None,
        }
    }
    pub fn int<'de, D: Deserializer<'de>>(d: D) -> Result<i64, D::Error> {
        let v = Value::deserialize(d)?;
        whole(&v).ok_or_else(|| serde::de::Error::custom(format!("not a whole number: {v}")))
    }
    /// Absent, null or not a whole number: none (as TS's `Number.isSafeInteger` checks read it).
    pub fn opt_int<'de, D: Deserializer<'de>>(d: D) -> Result<Option<i64>, D::Error> {
        let v = Option::<Value>::deserialize(d)?;
        Ok(v.as_ref().and_then(whole))
    }
    /// A list of ids, written as a list or as one id.
    pub fn ids<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<String>, D::Error> {
        Ok(match Option::<Value>::deserialize(d)? {
            Some(Value::String(s)) => vec![s],
            Some(Value::Array(a)) => a.into_iter().filter_map(|x| x.as_str().map(String::from)).collect(),
            _ => vec![],
        })
    }
    /// A yes or no always written, as a boolean or as the words.
    pub fn yes<'de, D: Deserializer<'de>>(d: D) -> Result<bool, D::Error> {
        opt_yes(d)?.ok_or_else(|| serde::de::Error::custom("not a yes or no"))
    }
    /// A yes or no, written as a boolean (`?name`) or as the words (`=name` of a choice).
    pub fn opt_yes<'de, D: Deserializer<'de>>(d: D) -> Result<Option<bool>, D::Error> {
        Ok(match Option::<Value>::deserialize(d)? {
            Some(Value::Bool(b)) => Some(b),
            Some(Value::String(s)) if s == "yes" => Some(true),
            Some(Value::String(s)) if s == "no" => Some(false),
            _ => None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_kind_is_typed_once() {
        let k = kinds();
        let mut names: Vec<&str> = k.iter().map(|x| x.0).collect();
        let n = names.len();
        names.dedup();
        assert_eq!(names.len(), n, "a kind typed in two files: {k:?}");
    }
}
