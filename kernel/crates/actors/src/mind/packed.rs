//! A JSON value kept as its text (risk SC-1). What a person last wrote to their record (`State::written`, a dozen
//! sections every citizen keeps to compare the next against) was 16 KB a person as `serde_json` values; as text it is
//! a few. Read back, it is the value it was made from: `serde_json` writes every number so that reading it gives the
//! same number (integers as integers, a float as the shortest text that reads back to its bits), and an object's
//! members in key order, as its map holds them. Saved, it is that value, as before.

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Packed(Box<str>);

impl Packed {
    pub fn of(v: &Value) -> Packed {
        // (Writing a value to text cannot fail: its map keys are strings.)
        Packed(serde_json::to_string(v).unwrap_or_else(|_| "null".into()).into_boxed_str())
    }
    /// The value it was made from.
    pub fn value(&self) -> Value {
        serde_json::from_str(&self.0).unwrap_or(Value::Null)
    }
}

impl Serialize for Packed {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        self.value().serialize(s)
    }
}

impl<'de> Deserialize<'de> for Packed {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Packed, D::Error> {
        Ok(Packed::of(&Value::deserialize(d)?))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_packed_value_reads_back_as_the_value_it_was_made_from() {
        let vs = [
            json!(null),
            json!({ "b": [1, -2, 3.5, 1e300, -0.0, 0.1, 2.0, u64::MAX, i64::MIN], "a": "x\"\\\n\u{1}é", "c": { "z": true, "y": false } }),
            json!(f64::MIN_POSITIVE),
            json!([[], {}, ""]),
        ];
        for v in vs {
            let p = Packed::of(&v);
            assert_eq!(p.value(), v);
            // Bit for bit, floats too; and saved as the value.
            assert_eq!(serde_json::to_string(&p.value()).unwrap(), serde_json::to_string(&v).unwrap());
            assert_eq!(serde_json::to_value(&p).unwrap(), v);
            let back: Packed = serde_json::from_value(v.clone()).unwrap();
            assert_eq!(back, p);
        }
    }
}
