//! Who and what things are called (docs/design/names-and-dates.md sections 2 to 4). Ids stay the keys underneath, in
//! the log, the measures and every `basis`; a name is what a seat reads and writes. A name is drawn from the profile's
//! sourced distributions by a stream keyed on the thing's stable identity (a person's household key and place in it;
//! an organisation's kind and founding), never on a record number or the order things were made, so that a town and its
//! twin call everyone the same. Records get the reference the office that filed them would issue (its own counter, in
//! the record's `data.reference`), not the kernel's `rec.N`.
//!
//! The types are fixed here; drawing names and references, the profile's `names` section and the seat-side rendering
//! are the names-and-dates lane's (docs/port-guide.md, section 8).

use serde::{Deserialize, Serialize};

/// A thing as the world keys it and as a seat is shown it.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Identity {
    /// The world's key (an entity, a space, a record, an account): what the log and the tools use.
    pub id: String,
    /// What it is called (a person's full name, an organisation's, a home's address, a paper's reference). Absent: a
    /// world without names (the old towns), and the seat is shown the id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

/// A person's name as its parts, ordered and formed by the profile's customs (`names.customs`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PersonName {
    pub given: Vec<String>,
    pub family: Vec<String>,
    /// Given name first, or family name first (as in Japan).
    pub family_first: bool,
}

/// The stable key a name is drawn by: what the thing is, not when it was made.
pub fn name_stream_key(kind: &str, stable: &str) -> [String; 3] {
    ["names".into(), kind.into(), stable.into()]
}

/// An office's own reference for a record it files, from its pattern (the profile's `names.references`): `{y}` the year,
/// `{n}` the office's running number in that series, `{n4}` and `{n6}` the number padded to that many digits (never cut).
/// The number is the office's own counter, kept in its own books (the count of references it has issued in the series, so
/// a record's reference never depends on what another office did); the kernel's `rec.N` stays underneath. The twin of
/// participants/src/identity.ts, both held to contracts/test/references.json.
pub fn reference(pattern: &str, year: i32, n: u64) -> String {
    pattern
        .replace("{y}", &year.to_string())
        .replace("{n4}", &format!("{n:04}"))
        .replace("{n6}", &format!("{n:06}"))
        .replace("{n}", &n.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn references_as_the_shared_cases_have_them() {
        let table: serde_json::Value = serde_json::from_str(include_str!("../../../../contracts/test/references.json")).unwrap();
        for c in table["cases"].as_array().unwrap() {
            assert_eq!(reference(c["pattern"].as_str().unwrap(), c["year"].as_i64().unwrap() as i32, c["n"].as_u64().unwrap()), c["text"].as_str().unwrap(), "{c}");
        }
    }

    #[test]
    fn a_name_stream_is_keyed_on_what_is_named() {
        assert_eq!(name_stream_key("person", "c0042"), ["names".to_string(), "person".into(), "c0042".into()]);
    }
}
