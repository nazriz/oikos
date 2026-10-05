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

/// Canonical bytes of any serializable value.
pub fn canonical<T: Serialize + ?Sized>(x: &T) -> Result<Vec<u8>, CanonError> {
    let v = serde_json::to_value(x).map_err(|e| CanonError::Serialize(e.to_string()))?;
    canonical_value(&v)
}

pub fn write_value(v: &Value, out: &mut Vec<u8>) {
    match v {
        Value::Null => out.extend_from_slice(b"null"),
        Value::Bool(true) => out.extend_from_slice(b"true"),
        Value::Bool(false) => out.extend_from_slice(b"false"),
        Value::Number(n) => out.extend_from_slice(n.to_string().as_bytes()),
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
        Value::Object(m) => {
            let mut keys: Vec<&String> = m.keys().collect();
            // JCS orders by UTF-16 code units; for ASCII keys that equals byte order.
            keys.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
            out.push(b'{');
            for (i, k) in keys.into_iter().enumerate() {
                if i > 0 {
                    out.push(b',');
                }
                write_string(k, out);
                out.push(b':');
                write_value(&m[k], out);
            }
            out.push(b'}');
        }
    }
}

pub fn write_string(s: &str, out: &mut Vec<u8>) {
    out.push(b'"');
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
            c => {
                let mut buf = [0u8; 4];
                out.extend_from_slice(c.encode_utf8(&mut buf).as_bytes());
            }
        }
    }
    out.push(b'"');
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

pub const ZERO_HASH: &str = "0000000000000000000000000000000000000000000000000000000000000000";

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
