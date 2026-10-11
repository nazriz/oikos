//! Canonical JSON (RFC 8785 / JCS restricted to Oikos's contracts) and
//! domain-separated SHA-256.
//!
//! Contracts allow only integers within ±(2^53 − 1) and ASCII object keys, so
//! JCS reduces to: object keys sorted, no insignificant whitespace, standard
//! string escaping. Keys are sorted explicitly here rather than relying on
//! serde_json's map type, so a dependency enabling `preserve_order` can't
//! silently change hashes.

use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fmt;

pub const MAX_SAFE: i64 = 9_007_199_254_740_991;

pub const DOMAIN_LOG: &str = "oikos.log.v1\n";
pub const DOMAIN_STATE: &str = "oikos.state.v1\n";
pub const DOMAIN_CONFIG: &str = "oikos.config.v1\n";
pub const DOMAIN_OBSERVATION: &str = "oikos.observation.v1\n";
pub const DOMAIN_DRAFT: &str = "oikos.draft.v1\n";
/// An entity's own record (docs/design/ai-citizens.md 10d): the chain of its changes, and the digest of what it holds.
pub const DOMAIN_ENTITY_RECORD: &str = "oikos.entity_record.v1\n";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CanonError {
    Float(String),
    UnsafeInteger(String),
    Serialize(String),
}

impl fmt::Display for CanonError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CanonError::Float(p) => write!(f, "floating-point number at {p}; contracts are integer-only"),
            CanonError::UnsafeInteger(p) => write!(f, "integer outside ±(2^53-1) at {p}"),
            CanonError::Serialize(e) => write!(f, "serialization failed: {e}"),
        }
    }
}

impl std::error::Error for CanonError {}

/// Rejects floats and unsafe integers anywhere in `v`.
pub fn check_integers(v: &Value) -> Result<(), CanonError> {
    /// The same check without saying where: nearly every value passes, and the path is only wanted for one that doesn't.
    fn fine(v: &Value) -> bool {
        match v {
            Value::Number(n) => n.as_i64().is_some_and(|i| (-MAX_SAFE..=MAX_SAFE).contains(&i)),
            Value::Array(a) => a.iter().all(fine),
            Value::Object(m) => m.values().all(fine),
            _ => true,
        }
    }
    if fine(v) {
        return Ok(());
    }
    fn walk(v: &Value, path: &mut String) -> Result<(), CanonError> {
        match v {
            Value::Number(n) => {
                if let Some(i) = n.as_i64() {
                    if !(-MAX_SAFE..=MAX_SAFE).contains(&i) {
                        return Err(CanonError::UnsafeInteger(path.clone()));
                    }
                } else if n.as_u64().is_some() {
                    return Err(CanonError::UnsafeInteger(path.clone()));
                } else {
                    return Err(CanonError::Float(path.clone()));
                }
            }
            Value::Array(a) => {
                for (i, x) in a.iter().enumerate() {
                    let len = path.len();
                    path.push_str(&format!("/{i}"));
                    walk(x, path)?;
                    path.truncate(len);
                }
            }
            Value::Object(m) => {
                for (k, x) in m {
                    let len = path.len();
                    path.push('/');
                    path.push_str(k);
                    walk(x, path)?;
                    path.truncate(len);
                }
            }
            _ => {}
        }
        Ok(())
    }
    walk(v, &mut String::new())
}

/// Canonical bytes of an already-parsed JSON value.
pub fn canonical_value(v: &Value) -> Result<Vec<u8>, CanonError> {
    check_integers(v)?;
    let mut out = Vec::with_capacity(256);
    write_value(v, &mut out);
    Ok(out)
}

/// Canonical bytes of any serializable value: exactly `canonical_value` of it as a JSON value (`canonical_by_value`),
/// written straight from its own shape where that can be (`canon_ser`), with no value made of it on the way.
pub fn canonical<T: Serialize + ?Sized>(x: &T) -> Result<Vec<u8>, CanonError> {
    match crate::canon_ser::bytes_of(x) {
        Ok(bytes) => {
            debug_assert_eq!(Ok(&bytes), canonical_by_value(x).as_ref(), "the direct writer and the rule disagree");
            Ok(bytes)
        }
        Err(_) => canonical_by_value(x),
    }
}

/// The rule `canonical` keeps to: the value as JSON, then that value's canonical bytes.
pub fn canonical_by_value<T: Serialize + ?Sized>(x: &T) -> Result<Vec<u8>, CanonError> {
    let v = serde_json::to_value(x).map_err(|e| CanonError::Serialize(e.to_string()))?;
    canonical_value(&v)
}

/// The members of a value that is an object, in canonical order: each key, and its value's canonical bytes. Written
/// one after another between braces, with commas and each key as `write_string` gives it and a colon, they are
/// `canonical` of the whole: for a writer that has some member's bytes from elsewhere (the state's records).
pub fn canonical_members<T: Serialize + ?Sized>(x: &T) -> Result<Vec<(String, Vec<u8>)>, CanonError> {
    let by_value = || {
        let v = serde_json::to_value(x).map_err(|e| CanonError::Serialize(e.to_string()))?;
        check_integers(&v)?;
        let Value::Object(m) = &v else { return Err(CanonError::Serialize("not an object".into())) };
        let mut keys: Vec<&String> = m.keys().collect();
        keys.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
        Ok(keys
            .into_iter()
            .map(|k| {
                let mut bytes = Vec::new();
                write_value(&m[k], &mut bytes);
                (k.clone(), bytes)
            })
            .collect())
    };
    match crate::canon_ser::members_of(x) {
        Ok(members) => {
            debug_assert_eq!(Ok(&members), by_value().as_ref(), "the direct writer and the rule disagree");
            Ok(members)
        }
        Err(_) => by_value(),
    }
}

pub fn write_value(v: &Value, out: &mut Vec<u8>) {
    match v {
        Value::Null => out.extend_from_slice(b"null"),
        Value::Bool(true) => out.extend_from_slice(b"true"),
        Value::Bool(false) => out.extend_from_slice(b"false"),
        Value::Number(n) => match n.as_i64() {
            // (An integer's digits, as `to_string` writes them, without making the string.)
            Some(i) => {
                use std::io::Write;
                write!(out, "{i}").expect("writing to a Vec doesn't fail");
            }
            None => out.extend_from_slice(n.to_string().as_bytes()),
        },
        Value::String(s) => write_string(s, out),
        Value::Array(a) => {
            out.push(b'[');
            for (i, x) in a.iter().enumerate() {
                if i > 0 {
                    out.push(b',');
                }
                write_value(x, out);
            }
            out.push(b']');
        }
        Value::Object(m) => write_object(m, out, |_, x, out| write_value(x, out)),
    }
}

/// An object in canonical form, each member's value written by `value` (given its key): for a writer that has some
/// member's canonical bytes already and needn't encode it again. `write_value` is this with every value written plainly.
pub fn write_object(m: &serde_json::Map<String, Value>, out: &mut Vec<u8>, mut value: impl FnMut(&str, &Value, &mut Vec<u8>)) {
    out.push(b'{');
    // JCS orders by UTF-16 code units; for ASCII keys that equals byte order. Keys that are ASCII and already come in
    // byte order (as serde_json's own map gives them) are in JCS order as they stand: checked each time, never
    // assumed, so a dependency enabling `preserve_order` still can't change a hash.
    let mut last: Option<&str> = None;
    let in_order = m.keys().all(|k| {
        let ok = k.is_ascii() && last.is_none_or(|l| l.as_bytes() < k.as_bytes());
        last = Some(k);
        ok
    });
    if in_order {
        for (i, (k, x)) in m.iter().enumerate() {
            if i > 0 {
                out.push(b',');
            }
            write_string(k, out);
            out.push(b':');
            value(k, x, out);
        }
    } else {
        let mut keys: Vec<&String> = m.keys().collect();
        keys.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
        for (i, k) in keys.into_iter().enumerate() {
            if i > 0 {
                out.push(b',');
            }
            write_string(k, out);
            out.push(b':');
            value(k, &m[k], out);
        }
    }
    out.push(b'}');
}

pub fn write_string(s: &str, out: &mut Vec<u8>) {
    out.push(b'"');
    write_escaped(s, out);
    out.push(b'"');
}

/// A string's characters as they stand between its quotes.
pub fn write_escaped(s: &str, out: &mut Vec<u8>) {
    // Everything that needs escaping is a single ASCII byte (never part of a longer UTF-8 sequence), so the stretches
    // between them are copied as they stand.
    let bytes = s.as_bytes();
    let mut from = 0;
    for (i, &b) in bytes.iter().enumerate() {
        if b >= 0x20 && b != b'"' && b != b'\\' {
            continue;
        }
        out.extend_from_slice(&bytes[from..i]);
        from = i + 1;
        match b {
            b'"' => out.extend_from_slice(b"\\\""),
            b'\\' => out.extend_from_slice(b"\\\\"),
            0x08 => out.extend_from_slice(b"\\b"),
            0x0C => out.extend_from_slice(b"\\f"),
            b'\n' => out.extend_from_slice(b"\\n"),
            b'\r' => out.extend_from_slice(b"\\r"),
            b'\t' => out.extend_from_slice(b"\\t"),
            b => out.extend_from_slice(format!("\\u{:04x}", b as u32).as_bytes()),
        }
    }
    out.extend_from_slice(&bytes[from..]);
}

/// Lowercase hex SHA-256 of `domain` followed by `bytes`.
pub fn hash_with_domain(domain: &str, bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(domain.as_bytes());
    h.update(bytes);
    to_hex(&h.finalize())
}

pub fn hash_value<T: Serialize + ?Sized>(domain: &str, x: &T) -> Result<String, CanonError> {
    Ok(hash_with_domain(domain, &canonical(x)?))
}

pub fn to_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(HEX[(b >> 4) as usize] as char);
        s.push(HEX[(b & 15) as usize] as char);
    }
    s
}

pub const ZERO_HASH: &str ="0000000000000000000000000000000000000000000000000000000000000000";

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn sorts_keys_and_strips_whitespace() {
        let v = json!({"b": 1, "a": [true, null, "x"], "c": {"z": -2, "y": "q"}});
        assert_eq!(String::from_utf8(canonical_value(&v).unwrap()).unwrap(), r#"{"a":[true,null,"x"],"b":1,"c":{"y":"q","z":-2}}"#);
    }

    #[test]
    fn escapes_like_jcs() {
        let v = json!("a\"b\\c\n\t\u{01}é/");
        assert_eq!(String::from_utf8(canonical_value(&v).unwrap()).unwrap(), "\"a\\\"b\\\\c\\n\\t\\u0001é/\"");
    }

    #[test]
    fn orders_keys_by_utf16_code_units() {
        // In bytes U+FFFF sorts before U+10000; in UTF-16 code units (JCS's order) it sorts after.
        let v = json!({"\u{ffff}": 1, "\u{10000}": 2, "a": 3, "B": 4});
        assert_eq!(String::from_utf8(canonical_value(&v).unwrap()).unwrap(), "{\"B\":4,\"a\":3,\"\u{10000}\":2,\"\u{ffff}\":1}");
    }

    #[test]
    fn writes_every_string_as_the_plain_rule_does() {
        // The rule, a character at a time: what `write_string` must give for any text.
        fn plain(s: &str) -> Vec<u8> {
            let mut out = vec![b'"'];
            for c in s.chars() {
                match c {
                    '"' => out.extend_from_slice(b"\\\""),
                    '\\' => out.extend_from_slice(b"\\\\"),
                    '\u{08}' => out.extend_from_slice(b"\\b"),
                    '\u{0C}' => out.extend_from_slice(b"\\f"),
                    '\n' => out.extend_from_slice(b"\\n"),
                    '\r' => out.extend_from_slice(b"\\r"),
                    '\t' => out.extend_from_slice(b"\\t"),
                    c if (c as u32) < 0x20 => out.extend_from_slice(format!("\\u{:04x}", c as u32).as_bytes()),
                    c => out.extend_from_slice(c.encode_utf8(&mut [0u8; 4]).as_bytes()),
                }
            }
            out.push(b'"');
            out
        }
        let every_low: String = (0u8..0x80).map(|b| b as char).collect();
        for s in ["", "plain", "\"", "\\", "ends with \\", "\"starts", "é\"ü\\漢\u{1f600}\n", "\u{7f}\u{80}\u{2028}", every_low.as_str()] {
            let mut out = vec![];
            write_string(s, &mut out);
            assert_eq!(out, plain(s), "{s:?}");
        }
        // Numbers are written as their digits.
        assert_eq!(String::from_utf8(canonical_value(&json!([0, -1, 42, MAX_SAFE, -MAX_SAFE])).unwrap()).unwrap(), "[0,-1,42,9007199254740991,-9007199254740991]");
    }

    /// Shapes of every kind serde gives a value: what the direct writer must write as the rule does.
    mod shapes {
        use serde::Serialize;
        use std::collections::BTreeMap;

        #[derive(Serialize)]
        pub struct Unit;
        #[derive(Serialize)]
        pub struct Wrapped(pub i64);
        #[derive(Serialize)]
        pub struct Pair(pub String, pub Option<bool>);
        #[derive(Serialize)]
        #[serde(rename_all = "snake_case")]
        pub enum Plain {
            First,
            SecondOne,
        }
        #[derive(Serialize)]
        pub enum Outer {
            Unit,
            New(Vec<i64>),
            Tuple(i64, String),
            Struct { z: i64, a: Option<String> },
        }
        #[derive(Serialize)]
        #[serde(tag = "kind", rename_all = "snake_case")]
        pub enum Tagged {
            Statement { text: String, about: serde_json::Value },
            Vote { on: String },
        }
        #[derive(Serialize)]
        #[serde(untagged)]
        pub enum Either {
            Word(Plain),
            Many(Vec<String>),
        }
        #[derive(Serialize)]
        pub struct Inner {
            pub zed: i64,
            pub alpha: String,
            /// Under a key the struct it's flattened into also has: the later one is kept.
            pub id: String,
        }
        #[derive(Serialize)]
        pub struct Whole {
            pub id: String,
            pub unit: Unit,
            pub nothing: (),
            pub wrapped: Wrapped,
            pub pair: Pair,
            pub plain: Vec<Plain>,
            pub outer: Vec<Outer>,
            #[serde(flatten)]
            pub tagged: Tagged,
            pub either: Vec<Either>,
            pub votes: Vec<Tagged>,
            #[serde(flatten)]
            pub inner: Inner,
            #[serde(skip_serializing_if = "Option::is_none")]
            pub absent: Option<i64>,
            pub none: Option<i64>,
            pub by_number: BTreeMap<i64, char>,
            pub by_flag: BTreeMap<bool, u8>,
            pub by_name: BTreeMap<String, (i64, i64)>,
            pub by_word: BTreeMap<char, Wrapped>,
            pub shared: std::sync::Arc<Vec<u64>>,
            pub bytes: Bytes,
            pub big: i128,
            pub empty: BTreeMap<String, i64>,
            pub value: serde_json::Value,
        }
        pub struct Bytes(pub Vec<u8>);
        impl Serialize for Bytes {
            fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
                s.serialize_bytes(&self.0)
            }
        }
        /// A map written with its keys out of order and one of them twice.
        pub struct Unordered(pub Vec<(String, i64)>);
        impl Serialize for Unordered {
            fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
                s.collect_map(self.0.iter().map(|(k, v)| (k, v)))
            }
        }
        /// A number with a fraction, which no canonical form has (given as text so that none is written here).
        pub struct Fraction(pub &'static str);
        impl Serialize for Fraction {
            fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
                self.0.parse::<serde_json::Number>().expect("a number").serialize(s)
            }
        }

        pub fn whole(value: serde_json::Value) -> Whole {
            Whole {
                id: "outer".into(),
                unit: Unit,
                nothing: (),
                wrapped: Wrapped(-7),
                pair: Pair("a\"b\\c\n\u{01}é".into(), None),
                plain: vec![Plain::First, Plain::SecondOne],
                outer: vec![Outer::Unit, Outer::New(vec![3, 1, 2]), Outer::Tuple(5, "x".into()), Outer::Struct { z: 1, a: None }],
                tagged: Tagged::Statement { text: "t".into(), about: serde_json::json!({ "b": [1, { "d": null, "c": true }], "a": "" }) },
                either: vec![Either::Word(Plain::First), Either::Many(vec!["p".into(), "q".into()])],
                votes: vec![Tagged::Vote { on: "it".into() }],
                inner: Inner { zed: 26, alpha: "α".into(), id: "inner".into() },
                absent: None,
                none: None,
                by_number: [(10, 'a'), (9, '"'), (-1, '\u{1f600}')].into(),
                by_flag: [(true, 1), (false, 0)].into(),
                by_name: [("\u{ffff}".to_string(), (1, 2)), ("\u{10000}".to_string(), (3, 4)), ("B".to_string(), (5, 6)), ("a\tb".to_string(), (7, 8))].into(),
                by_word: [('z', Wrapped(1)), ('é', Wrapped(2))].into(),
                shared: std::sync::Arc::new(vec![0, super::MAX_SAFE as u64]),
                bytes: Bytes(vec![0, 127, 255]),
                big: -(super::MAX_SAFE as i128),
                empty: BTreeMap::new(),
                value,
            }
        }
    }

    /// A JSON value drawn at random: objects with keys of every sort, strings that need escaping, integers at and
    /// past the safe range's ends, now and then a number with a fraction.
    fn drawn(rng: &mut crate::rng::Rng, depth: u32) -> Value {
        const WORDS: [&str; 12] = ["", "a", "B", "id", "kind", "a\"b", "back\\slash", "line\nbreak", "\u{01}", "é", "\u{ffff}", "\u{10000}"];
        let word = |rng: &mut crate::rng::Rng| WORDS[rng.below(WORDS.len() as u64) as usize].to_string();
        match rng.below(if depth == 0 { 7 } else { 10 }) {
            0 => Value::Null,
            1 => Value::Bool(rng.below(2) == 0),
            2 => json!(rng.below(2000) as i64 - 1000),
            3 => json!([MAX_SAFE, -MAX_SAFE, 0][rng.below(3) as usize]),
            4 | 5 => Value::String(word(rng)),
            6 => match rng.below(40) {
                0 => json!(MAX_SAFE + 1),
                1 => json!(u64::MAX),
                2 => "0.5".parse::<serde_json::Number>().map(Value::Number).expect("a number"),
                _ => Value::String(format!("{}{}", word(rng), word(rng))),
            },
            7 => Value::Array((0..rng.below(4)).map(|_| drawn(rng, depth - 1)).collect()),
            _ => Value::Object((0..rng.below(5)).map(|_| (format!("{}{}", word(rng), rng.below(3)), drawn(rng, depth - 1))).collect()),
        }
    }

    #[test]
    fn the_direct_writer_writes_what_the_rule_does() {
        let mut rng = crate::rng::Randomness::new(11).stream(&["canon", "direct"]);
        let (mut written, mut refused) = (0, 0);
        for _ in 0..4000 {
            let v = drawn(&mut rng, 4);
            let rule = canonical_by_value(&v);
            assert_eq!(canonical(&v), rule, "{v}");
            // (Where the rule gives bytes, the direct writer gave them, not the long way round.)
            match &rule {
                Ok(bytes) => {
                    assert_eq!(crate::canon_ser::bytes_of(&v).ok().as_ref(), Some(bytes), "{v}");
                    written += 1;
                }
                Err(_) => refused += 1,
            }
            // The same value inside every kind of shape.
            let whole = shapes::whole(v);
            let rule = canonical_by_value(&whole);
            assert_eq!(canonical(&whole), rule);
            if let Ok(bytes) = &rule {
                assert_eq!(crate::canon_ser::bytes_of(&whole).ok().as_ref(), Some(bytes));
                // Its members one by one, put together again, are the whole.
                let mut joined = vec![b'{'];
                for (i, (k, bytes)) in canonical_members(&whole).unwrap().iter().enumerate() {
                    if i > 0 {
                        joined.push(b',');
                    }
                    write_string(k, &mut joined);
                    joined.push(b':');
                    joined.extend_from_slice(bytes);
                }
                joined.push(b'}');
                assert_eq!(&joined, bytes);
                assert_eq!(crate::canon_ser::members_of(&whole).ok(), canonical_members(&whole).ok());
            }
        }
        assert!(written > 3000 && refused > 20, "{written} written, {refused} refused: both ways are tried");
    }

    #[test]
    fn the_direct_writer_keeps_the_last_of_a_key_and_refuses_what_it_cannot_write() {
        // The last value under a key is the one kept, wherever its key sorts.
        let m = shapes::Unordered(vec![("b".into(), 1), ("a".into(), 2), ("b".into(), 3), ("é".into(), 4), ("a".into(), 5)]);
        assert_eq!(String::from_utf8(crate::canon_ser::bytes_of(&m).unwrap()).unwrap(), "{\"a\":5,\"b\":3,\"é\":4}");
        assert_eq!(canonical(&m), canonical_by_value(&m));
        // A member is asked of an object alone.
        assert!(crate::canon_ser::members_of(&vec![json!({ "a": 1 })]).is_err());
        assert!(crate::canon_ser::members_of(&7).is_err());
        assert!(canonical_members(&json!([1])).is_err());
        assert_eq!(canonical_members(&json!({})), Ok(vec![]));
        // What isn't canonical is an error by either way, and the same one.
        for bad in [shapes::Fraction("1.5"), shapes::Fraction("9007199254740992"), shapes::Fraction("-9007199254740992"), shapes::Fraction("18446744073709551615")] {
            assert!(crate::canon_ser::bytes_of(&bad).is_err());
            assert!(canonical(&bad).is_err());
            assert_eq!(canonical(&bad), canonical_by_value(&bad));
            assert_eq!(canonical(&vec![("k", &bad)]), canonical_by_value(&vec![("k", &bad)]));
        }
    }

    #[test]
    fn rejects_floats_and_unsafe_integers() {
        assert!(matches!(canonical_value(&json!({"x": [1.5]})), Err(CanonError::Float(p)) if p == "/x/0"));
        assert!(matches!(canonical_value(&json!(9_007_199_254_740_992_i64)), Err(CanonError::UnsafeInteger(_))));
        assert!(matches!(canonical_value(&json!(u64::MAX)), Err(CanonError::UnsafeInteger(_))));
        assert!(canonical_value(&json!(MAX_SAFE)).is_ok());
        assert!(canonical_value(&json!(-MAX_SAFE)).is_ok());
    }

    #[test]
    fn domain_separation_changes_hash() {
        assert_ne!(hash_with_domain(DOMAIN_LOG, b"{}"), hash_with_domain(DOMAIN_STATE, b"{}"));
        assert_eq!(hash_with_domain("", b"").len(), 64);
        // SHA-256("") known answer.
        assert_eq!(hash_with_domain("", b""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    }
}
