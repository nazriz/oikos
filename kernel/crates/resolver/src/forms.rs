//! A form that writes a paper: the twin of `participants/src/forms.ts`, step for step, held to
//! `contracts/test/forms.json` (contracts/outcomes.schema.json, FormData `writes`; docs/behaviour/office-papers.md).
//!
//! A template is JSON. A string in it that begins with one of the marks `=`, `#`, `?`, `+` and a field's name stands
//! for that field: `=name` as the form reads it, `#name` as a whole number, `?name` as true or false, `+name` as a
//! length of time counted from now, `=self` whoever the paper is made for. A field not given leaves out the key (or
//! the place in a list) it would have filled; a list given where a list's item stands is set out in its place.

use serde_json::{json, Map, Value as Json};

use crate::resolve::duration_words;
use oikos_rules::calendar::Dated;

const DAY: i64 = 86_400;
const YEAR: i64 = 365 * DAY;

/// A date in words, as a report gives one ("year 1, day 12"). The world has no calendar: a year is 365 days.
pub fn date_words(t: i64) -> String {
    format!("year {}, day {}", t.div_euclid(YEAR) + 1, t.rem_euclid(YEAR) / DAY + 1)
}

/// A date in words in the world's calendar ("12 March 2026"), or as `date_words` writes one where it has none.
pub fn date_words_in(t: i64, dated: Option<&Dated>) -> String {
    dated.and_then(|d| d.words(t, false)).unwrap_or_else(|| date_words(t))
}

/// `parse_date`, reading the world's calendar first ("12 March 2026", ISO), then the old "year N, day D".
pub fn parse_date_in(s: &str, now: i64, dated: Option<&Dated>) -> Result<i64, String> {
    if let Some(t) = dated.and_then(|d| d.read(s, now)) {
        return Ok(t);
    }
    parse_date(s).map_err(|e| match dated.and_then(|d| d.words(now, false)) {
        Some(example) => format!("not a date: {s}. A date is written like \"{example}\"."),
        None => e,
    })
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
    // A day may be followed by a time of day, as the town's own papers write a moment ("year 1, day 289, 13:00").
    let mut of_day = 0;
    if day.is_some() && !rest.is_empty() {
        let at = rest.strip_prefix(',').map_or(rest, str::trim_start);
        let Some((h, hl)) = digits(at, 2) else { return Err(not_a_date(s)) };
        let Some(after) = at[hl..].strip_prefix(':') else { return Err(not_a_date(s)) };
        let two = |x: &str| -> Option<i64> { (x.len() >= 2 && x.as_bytes()[..2].iter().all(u8::is_ascii_digit)).then(|| x[..2].parse().ok()).flatten() };
        let Some(m) = two(after) else { return Err(not_a_date(s)) };
        let mut tail = &after[2..];
        let mut sec = 0;
        if let Some(x) = tail.strip_prefix(':') {
            let Some(v) = two(x) else { return Err(not_a_date(s)) };
            sec = v;
            tail = &x[2..];
        }
        if h > 23 || m > 59 || sec > 59 {
            return Err(not_a_date(s));
        }
        of_day = h * 3_600 + m * 60 + sec;
        rest = tail.trim_start();
    }
    if !rest.is_empty() || (year.is_none() && day.is_none()) {
        return Err(not_a_date(s));
    }
    let (year, day) = (year.unwrap_or(1), day.unwrap_or(1));
    if year < 1 || !(1..=365).contains(&day) {
        return Err(not_a_date(s));
    }
    Ok(((year - 1) * 365 + (day - 1)) * DAY + of_day)
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
    dated: Option<&'a Dated>,
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
fn words(v: Option<&Json>, ty: Option<&str>, money: Money, dated: Option<&Dated>) -> Result<String, String> {
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
        (Some(Json::Number(n)), Some("date")) if n.as_i64().is_some() => date_words_in(n.as_i64().unwrap_or_default(), dated),
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
                    out.push_str(&words(env.fields.get(name), spec_fields[name]["type"].as_str(), money, env.dated)?);
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

/// The fields a template names, each once, in the order met ("=self" aside).
fn named<'a>(t: &'a Json, into: &mut Vec<&'a str>) {
    if let Some((_, name)) = placeholder(t) {
        if name != "self" && !into.contains(&name) {
            into.push(name);
        }
        return;
    }
    match t {
        Json::Array(items) => items.iter().for_each(|x| named(x, into)),
        Json::Object(m) => m.values().for_each(|x| named(x, into)),
        _ => {}
    }
}

fn claim_word(position: &str) -> &str {
    match position {
        "liberty" => "permission",
        other => other,
    }
}

/// The claim a form records beside its paper (contracts: FormWrites `claim`), as the keys of the act that records it
/// (without the block or the speaker): None where the form records none, or its `when` does not hold. Where it is
/// due, every field it is written from is needed, and one not given is a question back. The twin of `writeClaim`.
pub fn write_claim(spec: &Json, fields: &Map<String, Json>, me: &str, now: i64) -> Result<Option<Map<String, Json>>, String> {
    let c = &spec["writes"]["claim"];
    if !c.is_object() {
        return Ok(None);
    }
    let when: Vec<(&String, &Json)> = c["when"].as_object().map(|m| m.iter().collect()).unwrap_or_default();
    if !when.iter().all(|(k, v)| fields.get(*k) == Some(*v)) {
        return Ok(None);
    }
    let form = spec["form"].as_str().unwrap_or_default().replace('_', " ");
    let position = c["position"].as_str().unwrap_or_default();
    let mut names = vec![];
    named(&c["holder"], &mut names);
    named(&c["about"], &mut names);
    named(&c["basis"], &mut names);
    let mut missing: Vec<&str> = names.into_iter().filter(|n| !fields.contains_key(*n)).collect();
    missing.sort_unstable();
    if !missing.is_empty() {
        let said: Vec<String> = when.iter().map(|(k, v)| format!("{} {}", k.replace('_', " "), v.as_str().unwrap_or_default())).collect();
        let with = if said.is_empty() { String::new() } else { format!(", with {},", said.join(" and ")) };
        return Err(format!("The {form}{with} needs: {}. They say what the {} it records is.", missing.join(", "), claim_word(position)));
    }
    let env = Env { fields, me, now, dated: None };
    let Some(holder @ Json::String(_)) = fill(&c["holder"], &env)? else {
        return Err(format!("The {form} can't say who holds the {} it records.", claim_word(position)));
    };
    let mut out = Map::new();
    out.insert("position".into(), json!(position));
    out.insert("holder".into(), holder);
    out.insert("about".into(), fill(&c["about"], &env)?.unwrap_or(Json::Null));
    if let Some(b @ Json::String(_)) = c.get("basis").filter(|x| !x.is_null()).map(|t| fill(t, &env)).transpose()?.flatten() {
        out.insert("basis".into(), b);
    }
    Ok(Some(out))
}

/// What a form with `writes` makes of its fields: the paper, as the keys of the act that publishes it (without the
/// block, the speaker or a reference). `text`: the paper's own words, where whoever fills it in gives them. An error
/// is a question back.
pub fn write_paper(spec: &Json, fields: &Map<String, Json>, me: &str, now: i64, money: Money, dated: Option<&Dated>, text: Option<&str>) -> Result<Map<String, Json>, String> {
    let w = &spec["writes"];
    let env = Env { fields, me, now, dated };
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::calls::{parse_when_in, When};

    /// A world with a calendar reads and writes the place's dates, and still reads the old ones.
    #[test]
    fn dates_in_the_worlds_calendar() {
        let table: Json = serde_json::from_str(include_str!("../../../../contracts/test/dates.json")).unwrap();
        let dated = Dated::from_config(Some(&table["calendars"]["dmy"])).unwrap();
        let day = 86_400;
        let now = 21 * day; // 2 April 2026
        assert_eq!(date_words_in(0, Some(&dated)), "12 March 2026");
        assert_eq!(date_words_in(0, None), "year 1, day 1");
        assert_eq!(parse_date_in("15 April 2026", now, Some(&dated)), Ok(34 * day));
        assert_eq!(parse_date_in("year 1, day 22", now, Some(&dated)), Ok(21 * day), "an old paper still reads");
        assert_eq!(parse_date_in("15 April", now, Some(&dated)), Ok(34 * day), "this year's");
        assert_eq!(parse_date_in("31 February 2026", now, Some(&dated)).unwrap_err(), "not a date: 31 February 2026. A date is written like \"2 April 2026\".");
        assert!(parse_date_in("15 April 2026", now, None).is_err(), "no calendar: no such dates");
        assert_eq!(parse_when_in("from 15 April 2026", now, Some(&dated)), Ok(When::At(34 * day)));
        assert_eq!(parse_when_in("on the 3rd of May", now, Some(&dated)), Ok(When::At(52 * day)));
        assert_eq!(parse_when_in("in 14 days", now, Some(&dated)), Ok(When::In(14 * day)));
        assert_eq!(parse_when_in("a fortnight", now, Some(&dated)), Ok(When::In(14 * day)));
        assert_eq!(parse_when_in("year 1, day 40", now, Some(&dated)), Ok(When::At(39 * day)));
    }
}
