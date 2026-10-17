//! The call language (contracts/calls.md): parsing, canonical text, the contract's argument table, and the unit
//! tables for amounts, durations and counts. The same as participants/src/calls.ts, which it replaces in the engine.

use serde_json::Value as Json;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::OnceLock;

pub const FUNCTIONS: [&str; 19] = ["money", "goods", "work", "account", "structure", "occupancy", "entity", "claim", "agreement", "statement", "vote", "message", "form", "presence", "birth", "harm", "position", "system", "take"];
pub const LABELS: [&str; 8] = ["not_yours", "needs_calculation", "too_much", "unclear", "unknown_form", "not_an_act", "no_such_act", "look_first"];

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

/// How a world's money is written (its config's `world.currencies` entry): the sign or code before an amount (or
/// after it), the words after it, how many decimal places its smallest unit is, and how its place writes numbers:
/// the decimal mark, the mark and size of groups of digits, a space beside the sign, the words for large numbers.
/// The platform has none of its own: every amount in words is read and written in a currency the world declares.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Currency {
    pub code: String,
    pub minor_units: u8,
    pub symbol: Option<String>,
    pub unit_words: Vec<String>,
    pub minor_words: Vec<String>,
    /// '.' or ','; absent: a point, unless the group mark is a point.
    pub decimal_mark: Option<char>,
    /// As the config writes it (a space may be a no-break one); absent: a comma, or a point where the decimal mark is a comma.
    pub group_mark: Option<char>,
    /// [3] or [3, 2]; absent: threes written, threes (and twos with commas) read.
    pub grouping: Option<Vec<u8>>,
    pub symbol_after: bool,
    pub symbol_spaced: bool,
    /// The place's words for large numbers (lower case) and their values.
    pub number_words: Vec<(String, u128)>,
}

impl Currency {
    /// A currency as a world's config declares it.
    pub fn from_config(v: &serde_json::Value) -> Option<Currency> {
        let words = |k: &str| v[k].as_array().into_iter().flatten().filter_map(|w| w.as_str().map(String::from)).collect();
        Some(Currency {
            code: v["code"].as_str()?.to_string(),
            minor_units: u8::try_from(v["minor_units"].as_u64()?).ok()?,
            symbol: v["symbol"].as_str().map(String::from),
            unit_words: words("unit_words"),
            minor_words: words("minor_words"),
            decimal_mark: v["decimal_mark"].as_str().and_then(|m| m.chars().next()),
            group_mark: v["group_mark"].as_str().and_then(|m| m.chars().next()),
            grouping: v["grouping"].as_array().map(|g| g.iter().filter_map(|n| n.as_u64().and_then(|n| u8::try_from(n).ok())).collect()),
            symbol_after: v["symbol_after"].as_bool().unwrap_or(false),
            symbol_spaced: v["symbol_spaced"].as_bool().unwrap_or(false),
            number_words: v["number_words"].as_object().into_iter().flatten().filter_map(|(w, n)| Some((w.to_lowercase(), u128::from(n.as_u64()?)))).collect(),
        })
    }

    /// The decimal mark this place writes, and the group mark.
    fn marks(&self) -> (char, char) {
        let dec = self.decimal_mark.unwrap_or(if self.group_mark == Some('.') { ',' } else { '.' });
        (dec, self.group_mark.unwrap_or(if dec == ',' { '.' } else { ',' }))
    }

    /// What the config settles about the two marks: the decimal mark and the mark between groups, each only where
    /// the config says it (directly, or by saying the other).
    fn stated(&self) -> (Option<char>, Option<char>) {
        let other = |c: char| if c == ',' { '.' } else { ',' };
        let plain = |c: char| c == ',' || c == '.';
        let dec = self.decimal_mark.or(self.group_mark.filter(|g| plain(*g)).map(other));
        let grp = self.group_mark.map(group_char).or(self.decimal_mark.map(other));
        (dec, grp)
    }
}

/// A group mark as it is read: every kind of space is one space, either apostrophe is one.
fn group_char(c: char) -> char {
    match c {
        '\u{2019}' => '\'',
        c if c.is_whitespace() => ' ',
        c => c,
    }
}

/// The large-number words every currency is read with (a place's own are its `number_words`).
const MULTIPLIERS: [(&str, u128); 8] = [
    ("thousand", 1_000), ("million", 1_000_000), ("billion", 1_000_000_000), ("trillion", 1_000_000_000_000),
    ("k", 1_000), ("m", 1_000_000), ("b", 1_000_000_000), ("t", 1_000_000_000_000),
];
const NUMBER_WORDS: [&str; 9] = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight"];

/// An amount as written, in the currency's smallest unit, exact, as a decimal string.
///
/// What is read, in this order:
///  - a marker of this world's money, before the digits or after them, with a space or without: the currency's sign,
///    its code, a word for its unit, or its sign with the first two letters of its code before it (how a sign that
///    several currencies share is told apart). A marker that ends in a letter may have a full stop and a space after it;
///  - the digits, with their separators. A comma and a point together: the one written last is the decimal mark and
///    the other groups the digits. Either of them written more than once groups the digits. A point written once is
///    a decimal point. A comma written once groups the digits if three follow it, and is a decimal comma if one or two
///    do. Digits are grouped in threes, or (with commas, or where the currency's `grouping` is [3, 2]) the last
///    three and then twos. Where the currency says its marks (`decimal_mark`, `group_mark`) a mark written once is
///    what it says: its decimal mark is the decimals, its group mark groups the digits if exactly three follow it and
///    a whole of one to three digits (not starting with a zero) comes before it; a space or an apostrophe between
///    groups of digits is read only where the currency's group mark is one;
///  - a multiplier (k, m, b, t; thousand, million, billion, trillion; and the currency's own `number_words`), only
///    where a marker or the end follows it;
///  - then a marker again, or a word for the smallest unit (then whole digits and no multiplier).
/// Bare digits are whole units. Nothing finer than the smallest unit, and no arithmetic on anything but the digits
/// written.
///
/// What is not read, because it could be two numbers and a currency's config doesn't say which: a point written once
/// with three digits after it, in a currency of fewer than three decimals, whose config says neither its decimal mark
/// nor that a point groups digits. Another currency's sign, code or words are
/// not this world's money, and are not read; nor is a number written out in words.
/// (participants/src/calls.ts `parseAmount` is the same, step for step; contracts/test/amounts.json holds what both
/// must read and what both must refuse.)
pub fn parse_amount(s: &str, cur: &Currency) -> Result<String, UnitError> {
    let err = || UnitError(format!("not an amount: {s}"));
    let grouping = || UnitError(format!("badly grouped digits: {s}"));
    let t = s.trim().to_lowercase().split_whitespace().collect::<Vec<_>>().join(" ");
    let code = cur.code.to_lowercase();
    let symbol = cur.symbol.as_ref().map(|x| x.to_lowercase());
    let minor = usize::from(cur.minor_units);
    let minors: Vec<String> = cur.minor_words.iter().map(|u| u.to_lowercase()).collect();
    // What marks an amount as this world's money. (Tried longest first: a sign may be how its code or a word begins.)
    let mut markers: Vec<String> = vec![code.clone()];
    markers.extend(cur.unit_words.iter().map(|u| u.to_lowercase()));
    if let Some(x) = &symbol {
        markers.push(x.clone());
        if !x.chars().any(|c| c.is_ascii_lowercase() || c.is_ascii_digit()) {
            markers.push(format!("{}{x}", code.chars().take(2).collect::<String>()));
        }
    }
    markers.retain(|m| !m.is_empty());
    markers.sort_by_key(|m| std::cmp::Reverse(m.chars().count()));
    let space = |x: &'_ str| -> usize { usize::from(x.starts_with(' ')) };
    let is_unit = |w: &str| markers.iter().any(|m| m == w);
    let is_minor = |w: &str| minors.iter().any(|m| m == w);
    let digit = |c: Option<char>| c.is_some_and(|c| c.is_ascii_digit());
    let (stated_dec, stated_grp) = cur.stated();
    let spaced_groups = stated_grp == Some(' ');
    let apostrophe_groups = stated_grp == Some('\'');
    let t = if apostrophe_groups { t.replace('\u{2019}', "'") } else { t };
    let mut rest = t.as_str();
    if !digit(rest.chars().next()) {
        // A marker first: one that has the digits straight after it.
        let mut found = None;
        for m in &markers {
            let Some(mut r) = rest.strip_prefix(m.as_str()) else { continue };
            if m.ends_with(|c: char| c.is_ascii_lowercase()) && r.starts_with(". ") {
                r = &r[1..];
            }
            r = &r[space(r)..];
            if digit(r.chars().next()) {
                found = Some(r);
                break;
            }
        }
        rest = found.ok_or_else(err)?;
    }
    // The digits and their separators (a separator is one only between two digits).
    let bytes = rest.as_bytes();
    let mut end = 0;
    let three_then_not_digit = |at: usize| bytes.get(at + 1..at + 4).is_some_and(|d| d.iter().all(|b| b.is_ascii_digit())) && !bytes.get(at + 4).is_some_and(|b| b.is_ascii_digit());
    while end < bytes.len()
        && (bytes[end].is_ascii_digit()
            || ((bytes[end] == b',' || bytes[end] == b'.' || (apostrophe_groups && bytes[end] == b'\'')) && bytes.get(end + 1).is_some_and(|b| b.is_ascii_digit()))
            || (spaced_groups && bytes[end] == b' ' && three_then_not_digit(end)))
    {
        end += 1;
    }
    let number = &rest[..end];
    rest = &rest[end..];
    rest = &rest[space(rest)..];
    // Which separator is the decimal mark, if either is.
    let commas = number.matches(',').count();
    let points = number.matches('.').count();
    let mark = if commas > 0 && points > 0 {
        Some(if number.rfind(',') > number.rfind('.') { ',' } else { '.' })
    } else if commas + points == 1 {
        // A mark written once. What the currency says settles it; else a point is the decimals, and a comma is the
        // decimals if one or two digits follow it.
        let s = if points == 1 { '.' } else { ',' };
        let at = number.find(s).unwrap_or(0);
        let (head, after) = (&number[..at], number.len() - at - 1);
        if stated_dec == Some(s) {
            Some(s)
        } else if stated_grp == Some(s) && after == 3 && !head.starts_with('0') {
            None
        } else if s == '.' {
            Some('.')
        } else if after < 3 {
            Some(',')
        } else {
            None
        }
    } else {
        None
    };
    let group = if let Some(g) = [' ', '\''].into_iter().find(|g| number.contains(*g)) {
        g
    } else if mark == Some(',') || (mark.is_none() && points > 0) {
        '.'
    } else {
        ','
    };
    let (whole, frac) = match mark.and_then(|m| number.rfind(m)) {
        Some(cut) => (&number[..cut], &number[cut + 1..]),
        None => (number, ""),
    };
    if mark.is_some_and(|m| whole.contains(m)) {
        return Err(grouping());
    }
    if frac.len() > minor.max(3) {
        return Err(err());
    }
    // (The place's own words first, the longest first: one that begins another is tried before it.)
    let mut own: Vec<(&str, u128)> = cur.number_words.iter().filter(|(w, _)| !w.is_empty()).map(|(w, m)| (w.as_str(), *m)).collect();
    own.sort_by_key(|(w, _)| std::cmp::Reverse(w.chars().count()));
    let mults: Vec<(&str, u128)> = own.into_iter().chain(MULTIPLIERS).collect();
    let mut mult: u128 = 1;
    let mut has_mult = false;
    for (w, m) in mults {
        if let Some(r) = rest.strip_prefix(w) {
            // (A multiplier only when a marker, a word for the smallest unit, or the end follows.)
            let r2 = &r[space(r)..];
            if r2.is_empty() || is_unit(r2) || is_minor(r2) {
                mult = m;
                has_mult = true;
                rest = r;
                break;
            }
        }
    }
    rest = &rest[space(rest)..];
    let in_minor = match rest {
        "" => false,
        w if is_unit(w) => false,
        w if is_minor(w) => true,
        _ => return Err(err()),
    };
    let groups: Vec<&str> = whole.split(group).collect();
    if groups.len() > 1 {
        let first = groups[0].len();
        let last = groups.len() - 1;
        let threes = first <= 3 && groups[1..].iter().all(|g| g.len() == 3);
        let twos_read = cur.grouping.as_ref().map_or(group == ',', |g| g.len() > 1 && group == group_char(cur.marks().1));
        let twos = twos_read && groups.len() > 2 && first <= 2 && groups[1..last].iter().all(|g| g.len() == 2) && groups[last].len() == 3;
        if !threes && !twos {
            return Err(grouping());
        }
    }
    if in_minor && (!frac.is_empty() || has_mult) {
        return Err(err());
    }
    // (The one that could be two numbers is said to be so: one to three digits, a point, three digits.)
    if frac.len() > minor && mult == 1 && mark == Some('.') && stated_dec.is_none() && frac.len() == 3 && commas == 0 && whole.len() <= 3 && !whole.starts_with('0') {
        return Err(UnitError(format!("a point with three digits after it can be read two ways: {s}")));
    }
    if frac.len() > minor && mult == 1 {
        return Err(UnitError(match minor {
            0 => format!("this money has no decimals: {s}"),
            n => format!("more than {} decimals: {s}", NUMBER_WORDS.get(n).copied().unwrap_or("that many")),
        }));
    }
    let large = || UnitError(format!("too large: {s}"));
    let per_unit: u128 = if in_minor { 1 } else { 10u128.pow(u32::from(cur.minor_units)) };
    let whole_n: u128 = groups.concat().parse().map_err(|_| large())?;
    // The decimals, carried exactly: what's written, times the multiplier, must come to whole smallest units.
    let frac_n: u128 = if frac.is_empty() { 0 } else { frac.parse().map_err(|_| err())? };
    let frac_scaled = frac_n * mult * per_unit;
    let frac_div = 10u128.pow(frac.len() as u32);
    if frac_scaled % frac_div != 0 {
        return Err(UnitError(match cur.minor_words.first() {
            Some(w) => format!("fraction of a {w}: {s}"),
            None => format!("fraction of the smallest unit: {s}"),
        }));
    }
    let n = whole_n.checked_mul(mult).and_then(|x| x.checked_mul(per_unit)).and_then(|x| x.checked_add(frac_scaled / frac_div)).ok_or_else(large)?;
    let out = n.to_string();
    if out.len() > 38 {
        return Err(large());
    }
    Ok(out)
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
    // ("once a week", "once every 2 weeks": how often, as people say it.)
    // ("every" or "each", one of the two, as the other parser reads it.)
    let mut one = false;
    for p in ["once ", "every ", "each ", "per "] {
        if (p == "every " || p == "each ") && one {
            continue;
        }
        if let Some(r) = t.strip_prefix(p) {
            t = r.to_string();
            one = one || p == "every " || p == "each ";
        }
    }
    // "12-month" (as in "a 12-month lease") reads as "12 month".
    if let Some(dash) = t.find('-') {
        let (a, b) = t.split_at(dash);
        if !a.is_empty() && (a.chars().all(|c| c.is_ascii_digit()) || a.chars().all(|c| c.is_ascii_lowercase())) && b[1..].starts_with(|c: char| c.is_ascii_lowercase()) {
            t = format!("{a} {}", &b[1..]);
        }
    }
    // ("each working day", "every school day": a day, of the days those whose work it is are at work.)
    'days: for adj in ["working", "school", "business", "week"] {
        for unit in ["days", "day"] {
            for sep in [" ", ""] {
                let tail = format!("{adj}{sep}{unit}");
                if t == tail || t.ends_with(&format!(" {tail}")) {
                    t = format!("{}{unit}", &t[..t.len() - tail.len()]);
                    break 'days;
                }
            }
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

/// When something is to happen, as written: a date (the moment that day begins) or a length of time from when the
/// paper is lodged (seconds).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum When {
    At(i64),
    In(i64),
}

/// A "when" as written (`first`, `until`): a date as the world's papers write one ("year 1, day 22", "year 1 day 22",
/// "day 22" of the year it now is, "year 2"; "tomorrow"), or a length of time ("14 days", "a fortnight", "today" and
/// "now": none at all). The words people put round either are read past ("from year 1, day 22", "in 14 days", "14
/// days from now"). Bare digits are neither. (participants/src/calls.ts `parseWhen` is the same, step for step;
/// contracts/test/when.json holds what both must read and refuse.)
pub fn parse_when(s: &str, now: i64) -> Result<When, UnitError> {
    parse_when_in(s, now, None)
}

/// `parse_when`, where the world has a calendar: a date as the place writes one ("12 March 2026", "15 April" of this
/// year, ISO) is read first; the old "year N, day D" is read always.
pub fn parse_when_in(s: &str, now: i64, dated: Option<&oikos_rules::calendar::Dated>) -> Result<When, UnitError> {
    const YEAR: i64 = 365 * DAY;
    let err = || UnitError(format!("not a date or a duration: {s}"));
    let mut t = s.trim().to_lowercase().split_whitespace().collect::<Vec<_>>().join(" ");
    if t == "at once" {
        return Ok(When::In(0));
    }
    for lead in [&["starting ", "beginning ", "commencing ", "effective "][..], &["from ", "on ", "in ", "after ", "at ", "until ", "till "][..], &["the "][..]] {
        if let Some(r) = lead.iter().find_map(|p| t.strip_prefix(p)) {
            t = r.to_string();
        }
    }
    for tail in [" from now", " from today", "'s time", " in time", " later", " hence"] {
        if let Some(r) = t.strip_suffix(tail) {
            t = r.to_string();
            break;
        }
    }
    if ["today", "now", "immediately", "at once", "straight away"].contains(&t.as_str()) {
        return Ok(When::In(0));
    }
    if t == "tomorrow" {
        return Ok(When::At((now.div_euclid(DAY) + 1) * DAY));
    }
    if let Some(at) = dated.and_then(|d| d.read(&t, now)) {
        return Ok(When::At(at));
    }
    // A date: "year N", "day D", or both, with a comma or a space between (or neither).
    let digits = |rest: &str, max: usize| -> Option<(i64, usize)> {
        let n = rest.bytes().take_while(u8::is_ascii_digit).count();
        if n == 0 || n > max {
            None
        } else {
            Some((rest[..n].parse().ok()?, n))
        }
    };
    let gap = |rest: &'_ str| -> usize { usize::from(rest.starts_with(' ')) };
    let date = (|| -> Option<(Option<i64>, Option<i64>)> {
        let mut rest = t.as_str();
        let (mut year, mut day) = (None, None);
        if let Some(r) = rest.strip_prefix("year") {
            let r = &r[gap(r)..];
            if let Some((n, len)) = digits(r, 6) {
                year = Some(n);
                rest = &r[len..];
            }
        }
        rest = &rest[gap(rest)..];
        if let Some(x) = rest.strip_prefix(',') {
            rest = x;
        }
        rest = &rest[gap(rest)..];
        if let Some(r) = rest.strip_prefix("day") {
            let r = &r[gap(r)..];
            if let Some((n, len)) = digits(r, 3) {
                day = Some(n);
                rest = &r[len..];
            }
        }
        if rest.is_empty() && (year.is_some() || day.is_some()) {
            Some((year, day))
        } else {
            None
        }
    })();
    if let Some((year, day)) = date {
        let year = year.unwrap_or(now.div_euclid(YEAR) + 1);
        let day = day.unwrap_or(1);
        if year < 1 || !(1..=365).contains(&day) {
            return Err(err());
        }
        return Ok(When::At(((year - 1) * 365 + (day - 1)) * DAY));
    }
    parse_duration(&t).map(When::In).map_err(|_| err())
}

/// "1", "one", "3" -> a count. With the world's currency, digits grouped as the place groups them are read exactly
/// as an amount's are (`parse_amount`: "60,000", or "60.000" where a point groups digits), and so is a multiplier;
/// what an amount's digits could not be (a decimal, a mark that could be read two ways) is not a count. Never
/// nought, unless `zero` says it may be. (participants/src/calls.ts `parseCount` is the same.)
pub fn parse_count(s: &str, cur: Option<&Currency>, zero: bool) -> Result<i64, UnitError> {
    let t = s.trim().to_lowercase();
    let err = || UnitError(format!("not a count: {s}"));
    let mut n = if (1..=15).contains(&t.len()) && t.bytes().all(|c| c.is_ascii_digit()) { t.parse::<i64>().ok() } else { word(&t) };
    if let (None, Some(cur)) = (n, cur) {
        if t.starts_with(|c: char| c.is_ascii_digit()) {
            // (The place's way of writing numbers, and nothing of its money: no sign, code or word, and no decimals.)
            let plain = Currency {
                code: String::new(),
                minor_units: 0,
                symbol: None,
                unit_words: vec![],
                minor_words: vec![],
                decimal_mark: cur.decimal_mark,
                group_mark: cur.group_mark,
                grouping: cur.grouping.clone(),
                symbol_after: false,
                symbol_spaced: false,
                number_words: cur.number_words.clone(),
            };
            let read = parse_amount(&t, &plain).map_err(|_| err())?;
            if read.len() > 15 {
                return Err(err());
            }
            n = read.parse::<i64>().ok();
        }
    }
    match n {
        Some(n) if (n > 0 || (zero && n == 0)) && n <= 9_007_199_254_740_991 => Ok(n),
        _ => Err(err()),
    }
}

/// An amount in the currency's smallest unit as people write it: its sign (or its code and a space) before the digits
/// or, where the currency says so, after them; the whole units grouped as the currency groups them (in threes unless
/// it says [3, 2]) with its group mark; its decimals after its decimal mark.
pub fn format_money(amount: &str, cur: &Currency) -> String {
    let (neg, digits) = match amount.strip_prefix('-') {
        Some(d) => (true, d),
        None => (false, amount),
    };
    let digits = digits.trim_start_matches('0');
    let digits = if digits.is_empty() { "0" } else { digits };
    let minor = usize::from(cur.minor_units);
    let (whole, frac) = if digits.len() > minor { digits.split_at(digits.len() - minor) } else { ("0", digits) };
    let (dec, grp) = cur.marks();
    let second = match cur.grouping.as_deref() {
        Some([_, s]) => usize::from(*s),
        _ => 3,
    };
    let mut number = String::new();
    for (i, c) in whole.chars().enumerate() {
        let from_right = whole.len() - i;
        if i > 0 && (from_right == 3 || (from_right > 3 && (from_right - 3) % second == 0)) {
            number.push(grp);
        }
        number.push(c);
    }
    if minor > 0 {
        number.push(dec);
        number.push_str(&format!("{frac:0>minor$}"));
    }
    // (A code, being letters, is always set off from the digits.)
    let sign = cur.symbol.as_deref().unwrap_or(&cur.code);
    let gap = if cur.symbol.is_none() || cur.symbol_spaced { " " } else { "" };
    let body = if cur.symbol_after { format!("{number}{gap}{sign}") } else { format!("{sign}{gap}{number}") };
    if neg { format!("-{body}") } else { body }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A currency as a test's world declares it (the platform has none of its own).
    fn currency(code: &str, minor_units: u8, symbol: Option<&str>, unit_words: &[&str], minor_words: &[&str]) -> Currency {
        let own = |w: &[&str]| w.iter().map(|x| x.to_string()).collect();
        Currency { code: code.into(), minor_units, symbol: symbol.map(String::from), unit_words: own(unit_words), minor_words: own(minor_words), ..Default::default() }
    }

    #[test]
    fn amounts_durations_counts_and_money() {
        let cur = currency("TWN", 2, Some("$"), &["dollar", "dollars", "bucks"], &["cent", "cents"]);
        let parse_amount = |s: &str| super::parse_amount(s, &cur);
        let format_money = |s: &str| super::format_money(s, &cur);
        assert_eq!(parse_amount("$1,234.56").unwrap(), "123456");
        assert_eq!(parse_amount("$1.5k").unwrap(), "150000");
        assert_eq!(parse_amount("250 cents").unwrap(), "250");
        assert_eq!(parse_amount("60k").unwrap(), "6000000");
        assert_eq!(parse_amount("$2m").unwrap(), "200000000");
        assert_eq!(parse_amount("500 dollars").unwrap(), "50000");
        assert_eq!(parse_amount("$3 trillion").unwrap(), "300000000000000");
        assert_eq!(parse_amount("1,23").unwrap(), "123"); // (a comma with two digits after it can only be a decimal comma)
        assert!(parse_amount("1,2345").is_err());
        assert!(parse_amount("$1.234").is_err());
        assert!(parse_amount("ten dollars").is_err());
        assert_eq!(parse_amount("$1.234").unwrap_err().0, "a point with three digits after it can be read two ways: $1.234");
        assert_eq!(parse_amount("$0.005").unwrap_err().0, "more than two decimals: $0.005");
        assert_eq!(parse_amount("twn 500").unwrap(), "50000");
        assert_eq!(parse_amount("1.5 cents").unwrap_err().0, "not an amount: 1.5 cents");
        assert_eq!(parse_amount("$90,071,992,547,409.93").unwrap(), "9007199254740993");
        assert_eq!(parse_amount(&format!("${}", "9".repeat(36))).unwrap(), format!("{}00", "9".repeat(36)));
        assert_eq!(parse_amount(&format!("${}", "9".repeat(37))).unwrap_err().0, format!("too large: ${}", "9".repeat(37)));
        assert_eq!(parse_duration("30 days").unwrap(), 30 * DAY);
        assert_eq!(parse_duration("every 3 months").unwrap(), 90 * DAY);
        assert_eq!(parse_duration("once a week").unwrap(), 7 * DAY);
        assert_eq!(parse_duration("once every 2 weeks").unwrap(), 14 * DAY);
        assert_eq!(parse_duration("monthly").unwrap(), 30 * DAY);
        assert_eq!(parse_duration("a year").unwrap(), 365 * DAY);
        assert_eq!(parse_duration("12-month").unwrap(), 360 * DAY);
        assert_eq!(parse_duration("week").unwrap(), 7 * DAY);
        assert_eq!(parse_count("one", None, false).unwrap(), 1);
        assert!(parse_count("0", None, false).is_err());
        assert_eq!(parse_count("0", None, true).unwrap(), 0);
        assert_eq!(format_money("123456"), "$1,234.56");
        assert_eq!(format_money("5"), "$0.05");
        assert_eq!(format_money("100000000"), "$1,000,000.00");
        assert_eq!(format_money("-5"), "-$0.05");
    }

    /// The table both readers of amounts are held to (the TypeScript one: translator/test/amounts.test.ts): every
    /// amount in it reads as it says in its own currency, or is refused.
    #[test]
    fn amounts_read_as_the_shared_table_says() {
        let table: serde_json::Value = serde_json::from_str(include_str!("../../../../contracts/test/amounts.json")).unwrap();
        let cases = table["cases"].as_array().unwrap();
        assert!(cases.len() > 200);
        let mut wrong = Vec::new();
        for case in cases {
            let (name, text) = (case[0].as_str().unwrap(), case[1].as_str().unwrap());
            let cur = Currency::from_config(&table["currencies"][name]).unwrap();
            let got = parse_amount(text, &cur).ok();
            if got.as_deref() != case[2].as_str() {
                wrong.push(format!("{name}: {text:?} read as {got:?}, wanted {}", case[2]));
            }
        }
        // What a refusal says (the participant is told it): the same words from both readers.
        for case in table["refusals"].as_array().unwrap() {
            let (name, text) = (case[0].as_str().unwrap(), case[1].as_str().unwrap());
            let cur = Currency::from_config(&table["currencies"][name]).unwrap();
            match parse_amount(text, &cur) {
                Err(e) if Some(e.0.as_str()) == case[2].as_str() => {}
                other => wrong.push(format!("{name}: {text:?} answered {other:?}, wanted {}", case[2])),
            }
        }
        assert!(wrong.is_empty(), "{}", wrong.join("\n"));
        // What each currency writes an amount as: the same words as the TypeScript writer.
        for case in table["writes"].as_array().unwrap() {
            let (name, n, want) = (case[0].as_str().unwrap(), case[1].as_str().unwrap(), case[2].as_str().unwrap());
            let cur = Currency::from_config(&table["currencies"][name]).unwrap();
            assert_eq!(format_money(n, &cur), want, "{name} {n}");
        }
        // What a world writes an amount as reads back as that amount.
        for cur in table["currencies"].as_object().unwrap().values() {
            let cur = Currency::from_config(cur).unwrap();
            for n in ["0", "1", "5", "99", "100", "1000", "123456", "100000", "1234567", "50000000", "123456789012", "9007199254740993"] {
                assert_eq!(parse_amount(&format_money(n, &cur), &cur).unwrap(), n, "{}", cur.code);
            }
        }
    }

    #[test]
    fn money_in_a_currency_with_no_smaller_unit() {
        let cur = currency("JPY", 0, Some("¥"), &["yen"], &[]);
        let parse = |s: &str| parse_amount(s, &cur);
        assert_eq!(parse("500").unwrap(), "500");
        assert_eq!(parse("¥500").unwrap(), "500");
        assert_eq!(parse("¥1,234,567").unwrap(), "1234567");
        assert_eq!(parse("1.5k yen").unwrap(), "1500");
        assert_eq!(parse("¥2m").unwrap(), "2000000");
        assert_eq!(parse("JPY 500").unwrap(), "500");
        assert_eq!(parse("500 jpy").unwrap(), "500");
        assert_eq!(parse("¥500.5").unwrap_err().0, "this money has no decimals: ¥500.5");
        assert_eq!(parse("¥500.00").unwrap_err().0, "this money has no decimals: ¥500.00");
        assert!(parse("$500").is_err()); // another world's sign
        assert!(parse("500 dollars").is_err());
        assert!(parse("500 cents").is_err());
        assert_eq!(format_money("500", &cur), "¥500");
        assert_eq!(format_money("1234567", &cur), "¥1,234,567");
        assert_eq!(format_money("0", &cur), "¥0");
        assert_eq!(format_money("-50000", &cur), "-¥50,000");
    }

    #[test]
    fn money_in_a_currency_with_three_decimals() {
        let cur = currency("KWD", 3, Some("KD"), &["dinar", "dinars"], &["fils"]);
        let parse = |s: &str| parse_amount(s, &cur);
        assert_eq!(parse("500").unwrap(), "500000");
        assert_eq!(parse("KD 1.234").unwrap(), "1234");
        assert_eq!(parse("kd1,000.5").unwrap(), "1000500");
        assert_eq!(parse("2 dinars").unwrap(), "2000");
        assert_eq!(parse("250 fils").unwrap(), "250");
        assert_eq!(parse("1.5k").unwrap(), "1500000");
        assert_eq!(parse("1.2345").unwrap_err().0, "not an amount: 1.2345");
        assert!(parse("1.5 fils").is_err());
        assert!(parse("2k fils").is_err());
        assert_eq!(format_money("1234", &cur), "KD1.234");
        assert_eq!(format_money("5", &cur), "KD0.005");
        assert_eq!(format_money("1234567890", &cur), "KD1,234,567.890");
    }

    #[test]
    fn money_in_a_currency_with_only_a_code() {
        let cur = currency("XYZ", 2, None, &[], &[]);
        let parse = |s: &str| parse_amount(s, &cur);
        assert_eq!(parse("XYZ 500").unwrap(), "50000");
        assert_eq!(parse("xyz500").unwrap(), "50000");
        assert_eq!(parse("500 XYZ").unwrap(), "50000");
        assert_eq!(parse("500").unwrap(), "50000");
        assert_eq!(parse("XYZ 1,234.56").unwrap(), "123456");
        assert_eq!(parse("3m xyz").unwrap(), "300000000");
        assert!(parse("$500").is_err());
        assert!(parse("500 dollars").is_err());
        assert_eq!(format_money("50000", &cur), "XYZ 500.00");
        assert_eq!(format_money("-123456", &cur), "-XYZ 1,234.56");
        // (What's written is read back as it was.)
        for n in ["0", "5", "50000", "123456789"] {
            assert_eq!(parse(&format_money(n, &cur)).unwrap(), n);
        }
        // More decimal places than three: read to the currency's own.
        let fine = currency("FIN", 8, None, &[], &[]);
        assert_eq!(parse_amount("FIN 0.00000001", &fine).unwrap(), "1");
        assert_eq!(parse_amount("1.5", &fine).unwrap(), "150000000");
        assert_eq!(format_money("150000001", &fine), "FIN 1.50000001");
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
