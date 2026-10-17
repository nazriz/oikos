//! Small helpers that read a `serde_json::Value` the way the TypeScript explorer reads parsed JSON: a missing key and
//! a `null` are the same ("undefined" / `??`), and a value interpolated into a sentence is `String(x)` as JS has it.

use serde_json::{Map, Value};

/// `v[k]`, but a `null` counts as absent (JS `??`).
pub fn g<'a>(v: &'a Value, k: &str) -> Option<&'a Value> {
    match v.get(k) {
        Some(Value::Null) | None => None,
        x => x,
    }
}
pub fn gs<'a>(v: &'a Value, k: &str) -> Option<&'a str> {
    g(v, k).and_then(Value::as_str)
}
pub fn gi(v: &Value, k: &str) -> Option<i64> {
    g(v, k).and_then(num_i64)
}
pub fn num_i64(v: &Value) -> Option<i64> {
    v.as_i64().or_else(|| v.as_f64().map(|f| f as i64))
}
/// `Number(x)` of a JSON value (a string of digits is a number, as in `Number("500")`); NaN is None.
pub fn number(v: Option<&Value>) -> Option<f64> {
    match v? {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => {
            let t = s.trim();
            if t.is_empty() {
                Some(0.0)
            } else {
                t.parse::<f64>().ok()
            }
        }
        Value::Bool(b) => Some(*b as u8 as f64),
        Value::Null => Some(0.0),
        _ => None,
    }
}

/// `String(x)` as a template literal has it ("undefined" for a missing value).
pub fn jstr(v: Option<&Value>) -> String {
    match v {
        None => "undefined".into(),
        Some(Value::Null) => "null".into(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Bool(b)) => b.to_string(),
        Some(Value::Number(n)) => fmt_num(n),
        Some(Value::Array(a)) => a.iter().map(|x| if x.is_null() { String::new() } else { jstr(Some(x)) }).collect::<Vec<_>>().join(","),
        Some(Value::Object(_)) => "[object Object]".into(),
    }
}
fn fmt_num(n: &serde_json::Number) -> String {
    if let Some(i) = n.as_i64() {
        return i.to_string();
    }
    match n.as_f64() {
        Some(f) if f.fract() == 0.0 && f.abs() < 1e21 => format!("{}", f as i128),
        Some(f) => format!("{f}"),
        None => n.to_string(),
    }
}
/// `x ?? d` then `String`.
pub fn jstr_or(v: Option<&Value>, d: &str) -> String {
    match v {
        None | Some(Value::Null) => d.to_string(),
        x => jstr(x),
    }
}
/// `String(x ?? "")`.
pub fn jstr0(v: Option<&Value>) -> String {
    jstr_or(v, "")
}
/// `[].concat(x ?? []).map(String)`.
pub fn list(v: Option<&Value>) -> Vec<String> {
    match v {
        None | Some(Value::Null) => vec![],
        Some(Value::Array(a)) => a.iter().map(|x| jstr(Some(x))).collect(),
        x => vec![jstr(x)],
    }
}
/// JS truthiness of a value.
pub fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().map(|f| f != 0.0 && !f.is_nan()).unwrap_or(true),
        Some(Value::String(s)) => !s.is_empty(),
        _ => true,
    }
}
/// A JSON number from a float: an integer when it is one (as JS prints it).
pub fn num(f: f64) -> Value {
    if f.is_finite() && f.fract() == 0.0 && f.abs() < 9.0e15 {
        Value::from(f as i64)
    } else {
        serde_json::Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null)
    }
}
/// `s.slice(0, n)` + "…" when longer than n (clip in trace.ts); lengths in characters.
pub fn clip(s: &str, n: usize) -> String {
    if s.chars().count() > n {
        let mut o: String = s.chars().take(n).collect();
        o.push('…');
        o
    } else {
        s.to_string()
    }
}
pub fn take_chars(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

/// An object builder that leaves out what JS would leave out (undefined).
#[derive(Default)]
pub struct Obj(pub Map<String, Value>);
impl Obj {
    pub fn new() -> Self {
        Obj(Map::new())
    }
    pub fn set(mut self, k: &str, v: impl Into<Value>) -> Self {
        self.0.insert(k.to_string(), v.into());
        self
    }
    pub fn opt(mut self, k: &str, v: Option<impl Into<Value>>) -> Self {
        if let Some(v) = v {
            self.0.insert(k.to_string(), v.into());
        }
        self
    }
    pub fn build(self) -> Value {
        Value::Object(self.0)
    }
}
