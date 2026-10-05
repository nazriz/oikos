//! The call language (contracts/calls.md): parsing, canonical text, the contract's argument table, and the unit
//! tables for amounts, durations and counts. The same as participants/src/calls.ts, which it replaces in the engine.

use serde_json::Value as Json;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::OnceLock;

pub const FUNCTIONS: [&str; 19] = ["money", "goods", "work", "account", "structure", "occupancy", "entity", "claim", "agreement", "statement", "vote", "message", "form", "presence", "birth", "harm", "position", "system", "take"];
pub const LABELS: [&str; 5] = ["not_yours", "needs_calculation", "too_much", "unclear", "unknown_form"];

#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Id(String),
    Var(String),
    Text(String),
    Json(Json),
    Call(Call),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Call {
    pub fn_: String,
    /// In the order written.
    pub args: Vec<(String, Value)>,
}

impl Call {
    pub fn get(&self, key: &str) -> Option<&Value> {
        self.args.iter().find(|(k, _)| k == key).map(|(_, v)| v)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Line {
    pub bind: Option<String>,
    pub call: Call,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Program {
    Lines(Vec<Line>),
    None(String),
}

#[derive(Debug, Clone, PartialEq)]
pub struct SyntaxError(pub String);

fn is_id_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | ':' | '/' | '-')
}

fn is_name(s: &str) -> bool {
    let mut cs = s.chars();
    matches!(cs.next(), Some(c) if c.is_ascii_lowercase()) && s.len() <= 32 && cs.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

struct Reader<'a> {
    s: &'a [char],
    i: usize,
}

impl Reader<'_> {
    fn ws(&mut self) {
        while self.i < self.s.len() && matches!(self.s[self.i], ' ' | '\t' | '\r' | '\n') {
            self.i += 1;
        }
    }
    fn peek(&mut self) -> Option<char> {
        self.ws();
        self.s.get(self.i).copied()
    }
    fn eat(&mut self, c: char) -> Result<(), SyntaxError> {
        self.ws();
        if self.s.get(self.i) != Some(&c) {
            return Err(SyntaxError(format!("expected \"{c}\" at {}", self.i)));
        }
        self.i += 1;
        Ok(())
    }
    fn token(&mut self) -> Result<String, SyntaxError> {
        self.ws();
        let start = self.i;
        while self.i < self.s.len() && is_id_char(self.s[self.i]) {
            self.i += 1;
        }
        if self.i == start {
            return Err(SyntaxError(format!("expected a name or id at {start}")));
        }
        Ok(self.s[start..self.i].iter().collect())
    }
    fn string(&mut self) -> Result<String, SyntaxError> {
        self.eat('"')?;
        let mut out = String::new();
        loop {
            let c = *self.s.get(self.i).ok_or_else(|| SyntaxError("unterminated string".into()))?;
            self.i += 1;
            match c {
                '"' => return Ok(out),
                '\\' => {
                    let e = self.s.get(self.i).copied();
                    self.i += 1;
                    match e {
                        Some(e @ ('"' | '\\')) => out.push(e),
                        e => return Err(SyntaxError(format!("bad escape \\{}", e.map(String::from).unwrap_or_default()))),
                    }
                }
                c => out.push(c),
            }
        }
    }
    fn json(&mut self) -> Result<Json, SyntaxError> {
        self.ws();
        let start = self.i;
        let (mut depth, mut in_str) = (0i32, false);
        while self.i < self.s.len() {
            let c = self.s[self.i];
            if in_str {
                if c == '\\' {
                    self.i += 1;
                } else if c == '"' {
                    in_str = false;
                }
            } else if c == '"' {
                in_str = true;
            } else if c == '{' || c == '[' {
                depth += 1;
            } else if c == '}' || c == ']' {
                depth -= 1;
                if depth == 0 {
                    self.i += 1;
                    let text: String = self.s[start..self.i].iter().collect();
                    let v: Json = serde_json::from_str(&text).map_err(|e| SyntaxError(e.to_string()))?;
                    if !integers_only(&v) {
                        return Err(SyntaxError("numbers must be integers".into()));
                    }
                    return Ok(v);
                }
            }
            self.i += 1;
        }
        Err(SyntaxError("unterminated JSON value".into()))
    }
}

fn integers_only(v: &Json) -> bool {
    match v {
        Json::Number(n) => n.is_i64() || n.is_u64(),
        Json::Array(a) => a.iter().all(integers_only),
        Json::Object(m) => m.values().all(integers_only),
        _ => true,
    }
}

fn parse_call(r: &mut Reader, fn_: &str, vars: &BTreeSet<String>) -> Result<Call, SyntaxError> {
    if !FUNCTIONS.contains(&fn_) {
        return Err(SyntaxError(format!("unknown function {fn_}")));
    }
    r.eat('(')?;
    let mut args: Vec<(String, Value)> = vec![];
    if r.peek() != Some(')') {
        loop {
            let key = r.token()?;
            if !is_name(&key) {
                return Err(SyntaxError(format!("bad argument name {key}")));
            }
            if args.iter().any(|(k, _)| *k == key) {
                return Err(SyntaxError(format!("argument {key} given twice")));
            }
            r.eat('=')?;
            let v = parse_value(r, vars)?;
            args.push((key, v));
            if r.peek() == Some(',') {
                r.eat(',')?;
                continue;
            }
            break;
        }
    }
    r.eat(')')?;
    Ok(Call { fn_: fn_.into(), args })
}

fn parse_value(r: &mut Reader, vars: &BTreeSet<String>) -> Result<Value, SyntaxError> {
    match r.peek() {
        Some('"') => return Ok(Value::Text(r.string()?)),
        Some('{' | '[') => return Ok(Value::Json(r.json()?)),
        _ => {}
    }
    let tok = r.token()?;
    if r.peek() == Some('(') && FUNCTIONS.contains(&tok.as_str()) {
        return Ok(Value::Call(parse_call(r, &tok, vars)?));
    }
    Ok(if vars.contains(&tok) { Value::Var(tok) } else { Value::Id(tok) })
}

/// Parse a program in the call language.
pub fn parse_program(text: &str) -> Result<Program, SyntaxError> {
    let src = text.trim();
    if let Some(inner) = src.strip_prefix("none(").and_then(|x| x.strip_suffix(')')) {
        let label = inner.trim();
        if !label.is_empty() && label.chars().all(|c| c.is_ascii_lowercase() || c == '_') {
            if !LABELS.contains(&label) {
                return Err(SyntaxError(format!("unknown label {label}")));
            }
            return Ok(Program::None(label.into()));
        }
    }
    let chars: Vec<char> = src.chars().collect();
    let mut r = Reader { s: &chars, i: 0 };
    let mut vars = BTreeSet::new();
    let mut lines = vec![];
    while r.peek().is_some() {
        let first = r.token()?;
        let (mut bind, mut fn_) = (None, first.clone());
        if r.peek() == Some('=') {
            if !is_name(&first) {
                return Err(SyntaxError(format!("bad variable name {first}")));
            }
            r.eat('=')?;
            bind = Some(first);
            fn_ = r.token()?;
        }
        let call = parse_call(&mut r, &fn_, &vars)?;
        if let Some(b) = &bind {
            if !vars.insert(b.clone()) {
                return Err(SyntaxError(format!("variable {b} bound twice")));
            }
        }
        lines.push(Line { bind, call });
        if lines.len() > 32 {
            return Err(SyntaxError("more than 32 lines".into()));
        }
    }
    if lines.is_empty() {
        return Err(SyntaxError("empty program".into()));
    }
    Ok(Program::Lines(lines))
}

// ------------------------------------------------------------ the contract's argument table (P12)

struct Args {
    allowed: Option<BTreeSet<String>>,
    required: Vec<String>,
}

/// Per function: the arguments it takes and the ones it needs, read from contracts/calls.schema.json.
fn args_table() -> &'static BTreeMap<String, Args> {
    static T: OnceLock<BTreeMap<String, Args>> = OnceLock::new();
    T.get_or_init(|| {
        let schema: Json = serde_json::from_str(include_str!("../../../../contracts/calls.schema.json")).expect("calls schema");
        let mut m = BTreeMap::new();
        for rule in schema["$defs"]["Call"]["allOf"].as_array().into_iter().flatten() {
            let fn_ = rule["if"]["properties"]["fn"]["const"].as_str().unwrap_or_default().to_string();
            let args = &rule["then"]["properties"]["args"];
            let allowed = args["propertyNames"]["enum"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect());
            let required = args["required"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
            m.insert(fn_, Args { allowed, required });
        }
        m
    })
}

/// What's wrong with a program against the contract (unknown or missing arguments, in any nested call).
pub fn contract_errors(p: &Program) -> Vec<String> {
    let Program::Lines(lines) = p else { return vec![] };
    let mut out = vec![];
    fn check(c: &Call, at: &str, out: &mut Vec<String>) {
        let Some(a) = args_table().get(&c.fn_) else {
            out.push(format!("{at}: unknown function {}", c.fn_));
            return;
        };
        for (k, _) in &c.args {
            if a.allowed.as_ref().is_some_and(|s| !s.contains(k)) {
                out.push(format!("{at}: {} takes no argument {k}", c.fn_));
            }
        }
        for k in &a.required {
            if c.get(k).is_none() {
                out.push(format!("{at}: {} needs {k}", c.fn_));
            }
        }
        for (k, v) in &c.args {
            if let Value::Call(inner) = v {
                check(inner, &format!("{at}.{k}"), out);
            }
        }
    }
    for (i, l) in lines.iter().enumerate() {
        check(&l.call, &format!("line {}", i + 1), &mut out);
    }
    out
}

// ------------------------------------------------------------ text

fn quote(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
}

fn value_text(v: &Value) -> String {
    match v {
        Value::Id(x) | Value::Var(x) => x.clone(),
        Value::Text(t) => quote(t),
        Value::Json(j) => String::from_utf8(oikos_canonical(j)).unwrap_or_default(),
        Value::Call(c) => call_text(c),
    }
}

/// Canonical JSON (keys sorted), as the call language writes data.
fn oikos_canonical(v: &Json) -> Vec<u8> {
    fn w(v: &Json, out: &mut String) {
        match v {
            Json::Object(m) => {
                let mut keys: Vec<&String> = m.keys().collect();
                keys.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
                out.push('{');
                for (i, k) in keys.into_iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    out.push_str(&Json::String(k.clone()).to_string());
                    out.push(':');
                    w(&m[k], out);
                }
                out.push('}');
            }
            Json::Array(a) => {
                out.push('[');
                for (i, x) in a.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    w(x, out);
                }
                out.push(']');
            }
            other => out.push_str(&other.to_string()),
        }
    }
    let mut s = String::new();
    w(v, &mut s);
    s.into_bytes()
}

/// Canonical text of a call: arguments in key order.
pub fn call_text(c: &Call) -> String {
    let mut args: Vec<&(String, Value)> = c.args.iter().collect();
    args.sort_by(|a, b| a.0.cmp(&b.0));
    format!("{}({})", c.fn_, args.iter().map(|(k, v)| format!("{k}={}", value_text(v))).collect::<Vec<_>>().join(", "))
}

pub fn program_text(p: &Program) -> String {
    match p {
        Program::None(l) => format!("none({l})"),
        Program::Lines(lines) => lines.iter().map(|l| match &l.bind { Some(b) => format!("{b} = {}", call_text(&l.call)), None => call_text(&l.call) }).collect::<Vec<_>>().join("\n"),
    }
}

// ------------------------------------------------------------ unit tables

#[derive(Debug, Clone, PartialEq)]
pub struct UnitError(pub String);

/// An amount as written ("$1.5k", "250 cents", "$3 trillion") in cents, exact, as a decimal string.
pub fn parse_amount(s: &str) -> Result<String, UnitError> {
    let err = || UnitError(format!("not an amount: {s}"));
    let t = s.trim().to_lowercase().split_whitespace().collect::<Vec<_>>().join(" ");
    let mut rest = t.as_str();
    rest = rest.strip_prefix('$').unwrap_or(rest);
    rest = rest.strip_prefix(' ').unwrap_or(rest);
    let digits_end = rest.find(|c: char| !(c.is_ascii_digit() || c == ',')).unwrap_or(rest.len());
    let whole = &rest[..digits_end];
    if whole.is_empty() || !whole.starts_with(|c: char| c.is_ascii_digit()) {
        return Err(err());
    }
    rest = &rest[digits_end..];
    let mut frac = "";
    if let Some(r) = rest.strip_prefix('.') {
        let n = r.find(|c: char| !c.is_ascii_digit()).unwrap_or(r.len());
        if n == 0 || n > 3 {
            return Err(err());
        }
        frac = &r[..n];
        rest = &r[n..];
    }
    rest = rest.strip_prefix(' ').unwrap_or(rest);
    let mults: [(&str, u128); 8] = [("thousand", 1_000), ("million", 1_000_000), ("billion", 1_000_000_000), ("trillion", 1_000_000_000_000), ("k", 1_000), ("m", 1_000_000), ("b", 1_000_000_000), ("t", 1_000_000_000_000)];
    let mut mult: u128 = 1;
    let mut has_mult = false;
    for (w, m) in mults {
        if let Some(r) = rest.strip_prefix(w) {
            // (A single letter only when a unit word or the end follows, as the pattern reads it.)
            let r2 = r.strip_prefix(' ').unwrap_or(r);
            if r2.is_empty() || ["dollars", "dollar", "bucks", "cents", "cent"].iter().any(|u| r2 == *u) {
                mult = m;
                has_mult = true;
                rest = r;
                break;
            }
        }
    }
    rest = rest.strip_prefix(' ').unwrap_or(rest);
    let cents = match rest {
        "" => false,
        "dollars" | "dollar" | "bucks" => false,
        "cents" | "cent" => true,
        _ => return Err(err()),
    };
    if whole.contains(',') {
        let groups: Vec<&str> = whole.split(',').collect();
        let ok = !groups[0].is_empty() && groups[0].len() <= 3 && groups[1..].iter().all(|g| g.len() == 3);
        if !ok {
            return Err(UnitError(format!("badly grouped digits: {s}")));
        }
    }
    if cents && (!frac.is_empty() || has_mult) {
        return Err(err());
    }
    if frac.len() == 3 && mult == 1 {
        return Err(UnitError(format!("more than two decimals: {s}")));
    }
    let units_per_dollar: u128 = if cents { 1 } else { 100 };
    let whole_n: u128 = whole.replace(',', "").parse().map_err(|_| UnitError(format!("too large: {s}")))?;
    let frac_n: u128 = format!("{frac}000")[..3].parse().unwrap_or(0);
    let scaled = whole_n.checked_mul(1000).and_then(|x| x.checked_add(frac_n)).and_then(|x| x.checked_mul(mult)).and_then(|x| x.checked_mul(units_per_dollar)).ok_or_else(|| UnitError(format!("too large: {s}")))?;
    if scaled % 1000 != 0 {
        return Err(UnitError(format!("fraction of a cent: {s}")));
    }
    Ok((scaled / 1000).to_string())
}

const DAY: i64 = 86_400;

fn word(w: &str) -> Option<i64> {
    Some(match w {
        "a" | "an" | "one" => 1,
        "two" => 2,
        "three" => 3,
        "four" => 4,
        "five" => 5,
        "six" => 6,
        "seven" => 7,
        "eight" => 8,
        "nine" => 9,
        "ten" => 10,
        "twelve" => 12,
        _ => return None,
    })
}

/// "30 days", "2 weeks", "monthly", "every 3 months", "a year" -> seconds. A month is 30 days, a year 365.
pub fn parse_duration(s: &str) -> Result<i64, UnitError> {
    let err = || UnitError(format!("not a duration: {s}"));
    let mut t = s.trim().to_lowercase().split_whitespace().collect::<Vec<_>>().join(" ");
    for p in ["every ", "per "] {
        if let Some(r) = t.strip_prefix(p) {
            t = r.to_string();
        }
    }
    // "12-month" (as in "a 12-month lease") reads as "12 month".
    if let Some(dash) = t.find('-') {
        let (a, b) = t.split_at(dash);
        if !a.is_empty() && (a.chars().all(|c| c.is_ascii_digit()) || a.chars().all(|c| c.is_ascii_lowercase())) && b[1..].starts_with(|c: char| c.is_ascii_lowercase()) {
            t = format!("{a} {}", &b[1..]);
        }
    }
    let adverb = match t.as_str() {
        "hourly" => Some(3600),
        "daily" => Some(DAY),
        "weekly" => Some(7 * DAY),
        "fortnightly" => Some(14 * DAY),
        "monthly" => Some(30 * DAY),
        "quarterly" => Some(90 * DAY),
        "yearly" | "annually" => Some(365 * DAY),
        _ => None,
    };
    if let Some(a) = adverb {
        return Ok(a);
    }
    let (count, unit) = match t.split_once(' ') {
        Some((a, b)) => (Some(a), b),
        // ("3months": a number run straight into its unit.)
        None => match t.find(|c: char| !c.is_ascii_digit()) {
            Some(i) if i > 0 => (Some(&t[..i]), &t[i..]),
            _ => (None, t.as_str()),
        },
    };
    let unit = unit.strip_suffix('s').unwrap_or(unit);
    let secs = match unit {
        "second" => 1,
        "minute" => 60,
        "hour" => 3600,
        "day" => DAY,
        "week" => 7 * DAY,
        "fortnight" => 14 * DAY,
        "month" => 30 * DAY,
        "quarter" => 90 * DAY,
        "year" => 365 * DAY,
        _ => return Err(err()),
    };
    let n = match count {
        None => 1,
        Some(c) if !c.is_empty() && c.chars().all(|x| x.is_ascii_digit()) => c.parse::<i64>().map_err(|_| err())?,
        Some(c) if !c.is_empty() && c.chars().all(|x| x.is_ascii_lowercase()) => word(c).ok_or_else(err)?,
        _ => return Err(err()),
    };
    Ok(n * secs)
}

/// "1", "one", "3" -> a count.
pub fn parse_count(s: &str) -> Result<i64, UnitError> {
    let t = s.trim().to_lowercase();
    let n = if !t.is_empty() && t.chars().all(|c| c.is_ascii_digit()) { t.parse::<i64>().ok() } else { word(&t) };
    match n {
        Some(n) if n > 0 && n <= 9_007_199_254_740_991 => Ok(n),
        _ => Err(UnitError(format!("not a count: {s}"))),
    }
}

/// Cents as money text: "$1,234.56".
pub fn format_money(cents: &str) -> String {
    let (neg, digits) = match cents.strip_prefix('-') {
        Some(d) => (true, d),
        None => (false, cents),
    };
    let digits = digits.trim_start_matches('0');
    let digits = if digits.is_empty() { "0" } else { digits };
    let (whole, frac) = if digits.len() > 2 { digits.split_at(digits.len() - 2) } else { ("0", digits) };
    let mut grouped = String::new();
    for (i, c) in whole.chars().enumerate() {
        if i > 0 && (whole.len() - i) % 3 == 0 {
            grouped.push(',');
        }
        grouped.push(c);
    }
    format!("{}${grouped}.{frac:0>2}", if neg { "-" } else { "" })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn amounts_durations_counts_and_money() {
        assert_eq!(parse_amount("$1,234.56").unwrap(), "123456");
        assert_eq!(parse_amount("$1.5k").unwrap(), "150000");
        assert_eq!(parse_amount("250 cents").unwrap(), "250");
        assert_eq!(parse_amount("60k").unwrap(), "6000000");
        assert_eq!(parse_amount("$2m").unwrap(), "200000000");
        assert_eq!(parse_amount("500 dollars").unwrap(), "50000");
        assert_eq!(parse_amount("$3 trillion").unwrap(), "300000000000000");
        assert!(parse_amount("1,23").is_err());
        assert!(parse_amount("$1.234").is_err());
        assert!(parse_amount("ten dollars").is_err());
        assert_eq!(parse_duration("30 days").unwrap(), 30 * DAY);
        assert_eq!(parse_duration("every 3 months").unwrap(), 90 * DAY);
        assert_eq!(parse_duration("monthly").unwrap(), 30 * DAY);
        assert_eq!(parse_duration("a year").unwrap(), 365 * DAY);
        assert_eq!(parse_duration("12-month").unwrap(), 360 * DAY);
        assert_eq!(parse_duration("week").unwrap(), 7 * DAY);
        assert_eq!(parse_count("one").unwrap(), 1);
        assert!(parse_count("0").is_err());
        assert_eq!(format_money("123456"), "$1,234.56");
        assert_eq!(format_money("5"), "$0.05");
        assert_eq!(format_money("100000000"), "$1,000,000.00");
    }

    #[test]
    fn programs_parse_and_read_back() {
        let p = parse_program("pay = money(to=acc-builder, amount=\"$97,500.00\", from=acc-city)\nstatement(kind=notice, text=\"Paid \\\"it\\\".\", data={\"a\":[1,2]}, basis=pay)").unwrap();
        let Program::Lines(lines) = &p else { panic!() };
        assert_eq!(lines[0].bind.as_deref(), Some("pay"));
        assert_eq!(lines[1].call.get("basis"), Some(&Value::Var("pay".into())));
        assert_eq!(parse_program(&program_text(&p)).unwrap(), parse_program(&program_text(&p)).unwrap());
        assert_eq!(program_text(&p).lines().next().unwrap(), "pay = money(amount=\"$97,500.00\", from=acc-city, to=acc-builder)");
        assert_eq!(parse_program(" none(unclear) ").unwrap(), Program::None("unclear".into()));
        assert!(parse_program("none(bogus)").is_err());
        assert!(parse_program("launch(x=1)").is_err());
        assert!(contract_errors(&parse_program("money(to=x)").unwrap()).iter().any(|e| e.contains("needs amount")));
    }
}
