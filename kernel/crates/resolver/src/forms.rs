//! A form that writes a paper: the twin of `participants/src/forms.ts`, step for step, held to
//! `contracts/test/forms.json` (contracts/outcomes.schema.json, FormData `writes`; docs/behaviour/office-papers.md).
//!
//! A template is JSON. A string in it that begins with one of the marks `=`, `#`, `?`, `+` and a field's name stands
//! for that field: `=name` as the form reads it, `#name` as a whole number, `?name` as true or false, `+name` as a
//! length of time counted from now, `=self` whoever the paper is made for. A field not given leaves out the key (or
//! the place in a list) it would have filled; a list given where a list's item stands is set out in its place.

use serde_json::{json, Map, Value as Json};

use crate::resolve::duration_words;

const DAY: i64 = 86_400;
const YEAR: i64 = 365 * DAY;

/// A date in words, as a report gives one ("year 1, day 12"). The world has no calendar: a year is 365 days.
pub fn date_words(t: i64) -> String {
    format!("year {}, day {}", t.div_euclid(YEAR) + 1, t.rem_euclid(YEAR) / DAY + 1)
}

fn not_a_date(s: &str) -> String {
    format!("not a date: {s}. A date is written like \"year 1, day 12\".")
}

/// A date as written ("year 2, day 40", or "day 40" of the first year): the moment that day begins. Bare digits are
/// a moment as a record has it, in seconds.
pub fn parse_date(s: &str) -> Result<i64, String> {
    let t = s.trim();
    if (1..=15).contains(&t.len()) && t.bytes().all(|b| b.is_ascii_digit()) {
        return Ok(t.parse().unwrap_or_default());
    }
    let digits = |rest: &str, max: usize| -> Option<(i64, usize)> {
        let n = rest.bytes().take_while(u8::is_ascii_digit).count();
        if n == 0 || n > max {
            None
        } else {
            Some((rest[..n].parse().ok()?, n))
        }
    };
    let word = |rest: &str, w: &str| rest.get(..w.len()).is_some_and(|p| p.eq_ignore_ascii_case(w));
    let mut rest = s.trim_start();
    let (mut year, mut day) = (None, None);
    if word(rest, "year") {
        let after = rest[4..].trim_start();
        let Some((n, len)) = digits(after, 6) else { return Err(not_a_date(s)) };
        year = Some(n);
        rest = after[len..].trim_start();
    }
    if let Some(r) = rest.strip_prefix(',') {
        rest = r.trim_start();
    }
    if word(rest, "day") {
        let after = rest[3..].trim_start();
        let Some((n, len)) = digits(after, 3) else { return Err(not_a_date(s)) };
        day = Some(n);
        rest = after[len..].trim_start();
    }
    if !rest.is_empty() || (year.is_none() && day.is_none()) {
        return Err(not_a_date(s));
    }
    let (year, day) = (year.unwrap_or(1), day.unwrap_or(1));
    if year < 1 || !(1..=365).contains(&day) {
        return Err(not_a_date(s));
    }
    Ok(((year - 1) * 365 + (day - 1)) * DAY)
}

fn is_name(n: &str) -> bool {
    let b = n.as_bytes();
    (1..=32).contains(&b.len()) && (b[0].is_ascii_lowercase() || b[0] == b'_') && b[1..].iter().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'_')
}

/// The field a template's string stands for, and how; None: the string is as written.
fn placeholder(t: &Json) -> Option<(char, &str)> {
    let s = t.as_str()?;
    let mark = s.chars().next()?;
    let name = s.get(1..)?;
    if !"=#?+".contains(mark) || !is_name(name) {
        return None;
    }
    Some((mark, name))
}

fn whole_number(name: &str, v: &Json) -> Result<i64, String> {
    let n = match v {
        Json::Number(n) => n.as_i64(),
        Json::String(s) => {
            let d = s.strip_prefix('-').unwrap_or(s);
            if (1..=16).contains(&d.len()) && d.bytes().all(|b| b.is_ascii_digit()) {
                s.parse().ok()
            } else {
                None
            }
        }
        _ => None,
    };
    match n {
        Some(n) if n.abs() <= 9_007_199_254_740_991 => Ok(n),
        _ => Err(format!("{name} can't be written as a whole number.")),
    }
}

struct Env<'a> {
    fields: &'a Map<String, Json>,
    me: &'a str,
    now: i64,
}

/// A template filled from the fields; None: it stands for a field not given.
fn fill(t: &Json, env: &Env) -> Result<Option<Json>, String> {
    if let Some((mark, name)) = placeholder(t) {
        if mark == '=' && name == "self" {
            return Ok(Some(json!(env.me)));
        }
        let Some(v) = env.fields.get(name) else { return Ok(None) };
        return Ok(Some(match mark {
            '=' => v.clone(),
            '#' => json!(whole_number(name, v)?),
            '?' => json!(v.as_str() == Some("yes")),
            _ => json!(env.now + whole_number(name, v)?),
        }));
    }
    match t {
        Json::Array(items) => {
            let mut out = vec![];
            for x in items {
                let Some(v) = fill(x, env)? else { continue };
                match v {
                    // (A list given where one item stands is set out in its place.)
                    Json::Array(inner) if placeholder(x).is_some() => out.extend(inner),
                    v => out.push(v),
                }
            }
            Ok(Some(Json::Array(out)))
        }
        Json::Object(m) => {
            let mut out = Map::new();
            for (k, x) in m {
                if let Some(v) = fill(x, env)? {
                    out.insert(k.clone(), v);
                }
            }
            Ok(Some(Json::Object(out)))
        }
        _ => Ok(Some(t.clone())),
    }
}

/// The strings of a filled list, each once, the first place kept.
fn unique(v: Option<Json>) -> Vec<String> {
    let mut out: Vec<String> = vec![];
    if let Some(Json::Array(xs)) = v {
        for x in xs {
            if let Json::String(s) = x {
                if !out.contains(&s) {
                    out.push(s);
                }
            }
        }
    }
    out
}

type Money<'a> = &'a dyn Fn(&str) -> Result<String, String>;

/// A field in words, for a paper's text.
fn words(v: Option<&Json>, ty: Option<&str>, money: Money) -> Result<String, String> {
    Ok(match (v, ty) {
        (None, _) => "none".to_string(),
        (Some(Json::Array(a)), _) => {
            if a.is_empty() {
                "none".to_string()
            } else {
                a.iter().map(|x| x.as_str().map(String::from).unwrap_or_else(|| x.to_string())).collect::<Vec<_>>().join(", ")
            }
        }
        (Some(Json::String(s)), Some("amount")) => money(s)?,
        (Some(Json::Number(n)), Some("duration")) if n.as_i64().is_some() => duration_words(n.as_i64().unwrap_or_default()),
        (Some(Json::Number(n)), Some("date")) if n.as_i64().is_some() => date_words(n.as_i64().unwrap_or_default()),
        (Some(Json::String(s)), _) => s.clone(),
        (Some(x), _) => x.to_string(),
    })
}

/// The text of a template with each `{name}` replaced by the field in words.
fn fill_text(template: &str, spec_fields: &Json, env: &Env, money: Money) -> Result<String, String> {
    let mut out = String::new();
    let mut rest = template;
    while let Some(i) = rest.find('{') {
        out.push_str(&rest[..i]);
        let after = &rest[i + 1..];
        match after.find('}') {
            Some(j) if is_name(&after[..j]) => {
                let name = &after[..j];
                if name == "self" {
                    out.push_str(env.me);
                } else {
                    out.push_str(&words(env.fields.get(name), spec_fields[name]["type"].as_str(), money)?);
                }
                rest = &after[j + 1..];
            }
            _ => {
                out.push('{');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    Ok(out)
}

/// What a form with `writes` makes of its fields: the paper, as the keys of the act that publishes it (without the
/// block, the speaker or a reference). `text`: the paper's own words, where whoever fills it in gives them. An error
/// is a question back.
pub fn write_paper(spec: &Json, fields: &Map<String, Json>, me: &str, now: i64, money: Money, text: Option<&str>) -> Result<Map<String, Json>, String> {
    let w = &spec["writes"];
    let env = Env { fields, me, now };
    let text = match text {
        Some(t) => t.to_string(),
        None => fill_text(w["text"].as_str().unwrap_or_default(), &spec["fields"], &env, money)?,
    };
    let mut out = Map::new();
    out.insert("kind".into(), w["kind"].clone());
    out.insert("text".into(), json!(text));
    let get = |k: &str| w.get(k).filter(|x| !x.is_null());
    let data = get("data").map(|t| fill(t, &env)).transpose()?.flatten();
    let to = unique(get("to").map(|t| fill(t, &env)).transpose()?.flatten());
    let visible = match get("visible") {
        None => None,
        Some(Json::String(s)) if s == "public" => Some(json!("public")),
        Some(t) => Some(json!(unique(fill(t, &env)?))),
    };
    let basis = get("basis").map(|t| fill(t, &env)).transpose()?.flatten();
    let offer = get("offer").map(|t| fill(t, &env)).transpose()?.flatten();
    let assertion = get("assertion").map(|t| fill(t, &env)).transpose()?.flatten();
    if !to.is_empty() {
        out.insert("addressed_to".into(), json!(to));
    }
    if let Some(d) = data {
        out.insert("data".into(), d);
    }
    if let Some(v) = visible {
        out.insert("visible_to".into(), v);
    }
    if let Some(b @ Json::String(_)) = basis {
        out.insert("basis".into(), b);
    }
    if let Some(o) = offer {
        out.insert("offer".into(), o);
    }
    if let Some(a) = assertion {
        out.insert("assertion".into(), a);
    }
    Ok(out)
}
