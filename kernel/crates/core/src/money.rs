//! Money (contracts v0.5, D58): exact integers in the smallest unit of an account's currency, 128-bit in the kernel
//! and decimal strings on the wire, so a world's amounts are never limited by JSON's 2^53 (about 90 trillion units of a
//! currency with two decimal places, less than a year of the world's output). Every amount's unit is its account's currency; the kernel never
//! converts between currencies (an exchange is a trade: two transfers in one action).

use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// An amount or balance, in the smallest unit of its currency.
pub type Money = i128;

/// The largest amount or balance: 38 digits (the contracts' pattern), within i128.
pub const MAX_MONEY: Money = 99_999_999_999_999_999_999_999_999_999_999_999_999;

/// Parse a decimal-string integer: an optional minus, no leading zeros, at most 38 digits.
pub fn parse(s: &str) -> Result<Money, String> {
    let digits = s.strip_prefix('-').unwrap_or(s);
    let ok = !digits.is_empty() && digits.len() <= 38 && digits.bytes().all(|b| b.is_ascii_digit()) && (digits == "0" || !digits.starts_with('0')) && !(s.starts_with('-') && digits == "0");
    if !ok {
        return Err(format!("not an amount: {s:?} (a decimal integer of at most 38 digits)"));
    }
    s.parse::<Money>().map_err(|e| format!("not an amount: {s:?}: {e}"))
}

/// Serde for a `Money` field as a decimal string.
pub mod amount {
    use super::*;
    pub fn serialize<S: Serializer>(v: &Money, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&v.to_string())
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Money, D::Error> {
        let s = String::deserialize(d)?;
        parse(&s).map_err(serde::de::Error::custom)
    }
}

/// Serde for an optional `Money` field as a decimal string.
pub mod opt_amount {
    use super::*;
    pub fn serialize<S: Serializer>(v: &Option<Money>, s: S) -> Result<S::Ok, S::Error> {
        match v {
            Some(x) => s.serialize_str(&x.to_string()),
            None => s.serialize_none(),
        }
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Money>, D::Error> {
        let s = Option::<String>::deserialize(d)?;
        s.map(|x| parse(&x).map_err(serde::de::Error::custom)).transpose()
    }
}

/// Serde for a map of quantities (kind -> decimal string), as in tasks' inputs and outputs and buildings' materials.
pub mod amount_map {
    use super::*;
    use std::collections::BTreeMap;
    pub fn serialize<K: Serialize,S: Serializer>(v: &BTreeMap<K, Money>, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        let mut m = s.serialize_map(Some(v.len()))?;
        for (k, x) in v {
            m.serialize_entry(k, &x.to_string())?;
        }
        m.end()
    }
    pub fn deserialize<'de, K: Deserialize<'de> + Ord, D: Deserializer<'de>>(d: D) -> Result<BTreeMap<K, Money>, D::Error> {
        let m = BTreeMap::<K, String>::deserialize(d)?;
        m.into_iter().map(|(k, x)| parse(&x).map(|v| (k, v)).map_err(serde::de::Error::custom)).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_exact_integers_to_38_digits_and_refuses_everything_else() {
        assert_eq!(parse("0"), Ok(0));
        assert_eq!(parse("50000"), Ok(50_000));
        assert_eq!(parse("-7"), Ok(-7));
        assert_eq!(parse(&"9".repeat(38)), Ok(MAX_MONEY));
        // Beyond JSON's safe integers: exact.
        assert_eq!(parse("9007199254740993"), Ok(9_007_199_254_740_993));
        for bad in ["", "-", "-0", "01", "1.5", "1e3", " 1", "+1", &"9".repeat(39)] {
            assert!(parse(bad).is_err(), "{bad:?} should be refused");
        }
    }

    #[test]
    fn round_trips_through_json_as_strings() {
        #[derive(serde::Serialize, serde::Deserialize, PartialEq, Debug)]
        struct X {
            #[serde(with = "amount")]
            a: Money,
            #[serde(with = "opt_amount", default, skip_serializing_if = "Option::is_none")]
            b: Option<Money>,
        }
        let x = X { a: MAX_MONEY, b: Some(-1) };
        let j = serde_json::to_string(&x).unwrap();
        assert_eq!(j, format!("{{\"a\":\"{}\",\"b\":\"-1\"}}", "9".repeat(38)));
        assert_eq!(serde_json::from_str::<X>(&j).unwrap(), x);
        assert_eq!(serde_json::from_str::<X>("{\"a\":\"5\"}").unwrap(), X { a: 5, b: None });
        assert!(serde_json::from_str::<X>("{\"a\":5}").is_err(), "a JSON number is not an amount");
    }
}
