//! How a form writes its paper, and reads one back (docs/behaviour/office-papers.md; docs/design/broad-seats.md, G2).
//!
//! The form's template engine, moved here from the resolver (`kernel/crates/resolver/src/forms.rs`, which uses it) so
//! that the actors can fill the same form a model fills: the code assistant composes a paper handed over as what
//! happened by filling its principal's own form (2026-11-11). A template is JSON. A string in it that begins with one of
//! the marks `=`, `#`, `?`, `+` and a field's name stands for that field: `=name` as the form reads it, `#name` as a
//! whole number, `?name` as true or false, `+name` as a length of time counted from now, `=self` whoever the paper is
//! made for. A field not given leaves out the key (or the place in a list) it would have filled; a list given where a
//! list's item stands is set out in its place. `read_back` is the same template read the other way: the blanks a paper
//! was filled in with.

use crate::calendar::Dated;
use serde_json::{json, Map, Value as Json};

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

/// A length of time in words, as people say one: whole days where it is whole days ("14 days", "1 day"); else whole
/// hours ("8 hours"); else hours and minutes ("1 hour 30 minutes", "45 minutes"); seconds only where nothing rounder
/// fits. (The participants' forms write the same: `durationWords`.)
pub fn duration_words(seconds: i64) -> String {
    let n = |x: i64, word: &str| if x == 1 { format!("1 {word}") } else { format!("{x} {word}s") };
    if seconds % 86_400 == 0 {
        return n(seconds / 86_400, "day");
    }
    if seconds < 0 {
        return n(seconds, "second");
    }
    if seconds % 3_600 == 0 {
        return n(seconds / 3_600, "hour");
    }
    if seconds % 60 == 0 {
        return if seconds > 3_600 { format!("{} {}", n(seconds / 3_600, "hour"), n((seconds % 3_600) / 60, "minute")) } else { n(seconds / 60, "minute") };
    }
    n(seconds, "second")
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

pub type Money<'a> = &'a dyn Fn(&str) -> Result<String, String>;

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

// ------------------------------------------------------------------ reading a paper back (G2)

/// A blank's role in a matter handed over as what happened (docs/design/broad-seats.md, 4.2): `fact` (what happened,
/// whom, where), `decided` (the principal's own choice: a price, a rise, a finding), `worked` (worked out from the
/// other blanks by the rule the form gives), or `words` (the writer's: a blank only the paper's words use). A form may
/// say a blank's role; otherwise a blank with a rule is worked, one that only the words use is words, and the rest go
/// by type: a figure, a count, a choice or a length of time is decided; anything else (a record, a person, a place, an
/// account, a date, a list, a word the receiving office reads) is a fact.
pub fn role(spec: &Json, name: &str) -> &'static str {
    let f = &spec["fields"][name];
    match f["role"].as_str() {
        Some("fact") => return "fact",
        Some("decided") => return "decided",
        Some("worked") if f["worked"].is_string() => return "worked",
        Some("words") => return "words",
        _ => {}
    }
    if f["worked"].is_string() {
        return "worked";
    }
    let w = &spec["writes"];
    let mut used = vec![];
    for k in ["data", "to", "basis", "offer", "assertion", "visible"] {
        named(&w[k], &mut used);
    }
    if !used.contains(&name) && f["read"].is_null() {
        return "words";
    }
    match f["type"].as_str() {
        Some("amount" | "count" | "choice" | "duration") => "decided",
        _ => "fact",
    }
}

/// Bind what a template stands for in a value: false where the value is not one the template could have written.
/// `lists`: the blanks that are lists (a list given where one item stands is set out in its place).
fn bind(t: &Json, v: &Json, lists: &[&str], me: &str, now: i64, out: &mut Map<String, Json>) -> bool {
    // (A blank written in two places reads the same in both; where one place writes it as a whole number (`#`) and
    // the other as given (`=`), the given one is what was filled in.)
    fn put(out: &mut Map<String, Json>, name: &str, x: Json, given: bool) -> bool {
        match out.get(name) {
            Some(y) if alike(Some(y), Some(&x)) => {
                if given {
                    out.insert(name.to_string(), x);
                }
                true
            }
            Some(_) => false,
            None => {
                out.insert(name.to_string(), x);
                true
            }
        }
    }
    if v.is_null() {
        // (Nothing there: a blank not given, or a template that wrote nothing.)
        return placeholder(t).is_some() || t.is_null();
    }
    if let Some((mark, name)) = placeholder(t) {
        if mark == '=' && name == "self" {
            return v.as_str() == Some(me);
        }
        return match mark {
            '=' => put(out, name, v.clone(), true),
            '#' => v.as_i64().is_some() && put(out, name, v.clone(), false),
            '?' => v.as_bool().is_some_and(|b| put(out, name, json!(if b { "yes" } else { "no" }), false)),
            _ => v.as_i64().is_some_and(|x| put(out, name, json!(x - now), false)),
        };
    }
    match (t, v) {
        (Json::Object(tm), Json::Object(vm)) => {
            // (Nothing the form does not write; what the form writes and the paper leaves out is a blank not given.)
            vm.iter().all(|(k, y)| y.is_null() || tm.contains_key(k))
                && tm.iter().all(|(k, x)| match vm.get(k) {
                    Some(y) => bind(x, y, lists, me, now, out),
                    None => placeholder(x).is_some() || matches!(x, Json::Object(_) | Json::Array(_)),
                })
        }
        (Json::Array(ts), Json::Array(vs)) => {
            // (Each item one value, in order; a list blank takes as many as the others leave.)
            let is_list = |x: &Json| placeholder(x).is_some_and(|(m, n)| m == '=' && lists.contains(&n));
            let spread = ts.iter().filter(|x| is_list(x)).count();
            if spread > 1 || (spread == 0 && ts.len() != vs.len()) || vs.len() + spread < ts.len() {
                return false;
            }
            let take = vs.len() + spread - ts.len();
            let mut i = 0;
            for x in ts {
                if is_list(x) {
                    let name = placeholder(x).map(|(_, n)| n).unwrap_or_default();
                    if !put(out, name, Json::Array(vs[i..i + take].to_vec()), true) {
                        return false;
                    }
                    i += take;
                } else {
                    if !bind(x, &vs[i], lists, me, now, out) {
                        return false;
                    }
                    i += 1;
                }
            }
            true
        }
        _ => t == v,
    }
}

fn as_set(v: Option<&Json>) -> Vec<String> {
    let mut out: Vec<String> = match v {
        Some(Json::Array(xs)) => xs.iter().map(|x| x.as_str().map(String::from).unwrap_or_else(|| x.to_string())).collect(),
        Some(Json::String(s)) => vec![s.clone()],
        _ => vec![],
    };
    out.sort();
    out.dedup();
    out
}

/// A value with the details that hold nothing left out (a paper's `null` is no detail).
fn bare(v: Option<&Json>) -> Option<Json> {
    match v? {
        Json::Null => None,
        Json::Object(m) => Some(Json::Object(m.iter().filter_map(|(k, x)| bare(Some(x)).map(|y| (k.clone(), y))).collect())),
        x => Some(x.clone()),
    }
}

/// A blank as its type writes it: a sum worked out by a rule is written as sums are in the call language, in digits.
fn typed(spec: &Json, name: &str, x: Json) -> Json {
    match (&spec["fields"][name]["type"], &x) {
        (Json::String(t), Json::Number(n)) if t == "amount" => json!(n.to_string()),
        _ => x,
    }
}

/// The blanks a paper was filled in with on this form (`paper`: the keys `write_paper` makes; `now`: when it was made;
/// `me`: whom it was made for), read back: None where the paper has anything the form does not write, or writing the
/// blanks again would not give the same paper (kind, addressees, who sees it, basis, details). A blank the form says
/// how to read (`read`, a rule over the others) and does not write is read by its rule. The words are not read: they
/// are the writer's.
pub fn read_back(spec: &Json, paper: &Map<String, Json>, me: &str, now: i64) -> Option<Map<String, Json>> {
    let w = &spec["writes"];
    if paper.get("kind") != w.get("kind") {
        return None;
    }
    let lists: Vec<&str> = spec["fields"].as_object().map(|m| m.iter().filter(|(_, f)| f["type"] == "list").map(|(k, _)| k.as_str()).collect()).unwrap_or_default();
    let mut out = Map::new();
    for (tk, pk) in [("data", "data"), ("to", "addressed_to"), ("basis", "basis"), ("offer", "offer"), ("assertion", "assertion")] {
        match (w.get(tk).filter(|x| !x.is_null()), paper.get(pk).filter(|x| !x.is_null())) {
            (Some(t), Some(v)) => {
                if !bind(t, v, &lists, me, now, &mut out) {
                    return None;
                }
            }
            (None, Some(_)) => return None,
            _ => {}
        }
    }
    // (Who sees it, where a blank says so and nothing else does: read where it can be, else left to the check below.)
    if let (Some(t), Some(v)) = (w.get("visible").filter(|x| x.is_array()), paper.get("visible_to").filter(|x| x.is_array())) {
        let mut seen = out.clone();
        if bind(t, v, &lists, me, now, &mut seen) {
            out = seen;
        }
    }
    // (A blank the form reads by a rule from the others: one the paper does not show, such as the price of each behind
    // a sum.)
    if let Some(fields) = spec["fields"].as_object() {
        for (name, f) in fields {
            if let (Some(rule), false) = (f["read"].as_str(), out.contains_key(name)) {
                if let Ok(x) = oikos_law::value(rule, &out) {
                    let x = typed(spec, name, x);
                    out.insert(name.clone(), x);
                }
            }
        }
    }
    let as_is = |s: &str| Ok(s.to_string());
    let again = write_paper(spec, &out, me, now, &as_is, None, Some(paper.get("text").and_then(Json::as_str).unwrap_or_default())).ok()?;
    let same = |k: &str| bare(again.get(k)) == bare(paper.get(k));
    if !(same("data") && same("basis") && same("offer") && same("assertion") && as_set(again.get("addressed_to")) == as_set(paper.get("addressed_to"))) {
        return None;
    }
    if paper.get("visible_to").is_some() && again.get("visible_to").is_some() && as_set(again.get("visible_to")) != as_set(paper.get("visible_to")) {
        return None;
    }
    Some(out)
}

/// The blanks worked out by the form's rules from those given (each blank's `worked`, a rule over the others),
/// added to them. A sum comes out as the call language writes one, in digits. A rule whose blanks were not given works
/// out nothing.
pub fn work_out(spec: &Json, given: &Map<String, Json>) -> Result<Map<String, Json>, String> {
    let mut out = given.clone();
    if let Some(fields) = spec["fields"].as_object() {
        for (name, f) in fields {
            // (A blank of the writer's words may have a rule too: the form's own way of putting it, which the code
            // assistant uses and nobody checks.)
            if f["worked"].as_str().is_none() || out.contains_key(name) {
                continue;
            }
            // (A rule whose blanks were not given works out nothing: the blank is left out, as one not given is.)
            if let Ok(x) = oikos_law::value(f["worked"].as_str().unwrap_or_default(), &out) {
                out.insert(name.clone(), typed(spec, name, x));
            }
        }
    }
    Ok(out)
}

fn figure(v: Option<&Json>) -> Option<i64> {
    v.and_then(|x| x.as_i64().or_else(|| x.as_str().and_then(|s| s.parse().ok())))
}

fn alike(a: Option<&Json>, b: Option<&Json>) -> bool {
    a == b || (figure(a).is_some() && figure(a) == figure(b))
}

/// What a principal gives with a matter on this form (docs/design/broad-seats.md, 4.2): every blank it filled in but
/// the writer's words and those its form works out, where the form's rule gives what the principal's paper has (where
/// it does not, the principal gives that figure itself). A decided blank is the principal's decision, handed over.
pub fn given(spec: &Json, blanks: &Map<String, Json>) -> Map<String, Json> {
    let mut out: Map<String, Json> = blanks.iter().filter(|(k, _)| role(spec, k) != "words").map(|(k, v)| (k.clone(), v.clone())).collect();
    let worked: Vec<String> = out.keys().filter(|k| role(spec, k) == "worked").cloned().collect();
    let mut without = out.clone();
    for k in &worked {
        without.remove(k);
    }
    let ruled = work_out(spec, &without).unwrap_or_default();
    for k in worked {
        if alike(ruled.get(&k), blanks.get(&k)) {
            out.remove(&k);
        }
    }
    out
}

/// The paper the code assistant writes on its principal's form from what it was given: the blanks given, those the form
/// works out, and the words as the form puts them (with sums in the world's words, `money`). An error: a rule that
/// cannot be worked, or a form that cannot be filled.
pub fn compose(spec: &Json, given: &Map<String, Json>, me: &str, now: i64, money: Money, dated: Option<&Dated>) -> Result<Map<String, Json>, String> {
    let blanks = work_out(spec, given)?;
    write_paper(spec, &blanks, me, now, money, dated, None)
}

/// The blanks of a draft that differ from the principal's own, on everything but the writer's words: their names
/// (none: as the principal would have sent it).
pub fn differs(spec: &Json, mine: &Map<String, Json>, drafted: &Map<String, Json>) -> Vec<String> {
    let mut names: Vec<String> = mine.keys().chain(drafted.keys()).filter(|k| role(spec, k) != "words").cloned().collect();
    names.sort();
    names.dedup();
    names.into_iter().filter(|k| !alike(mine.get(k), drafted.get(k))).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(name: &str, f: &crate::forms::FormField) -> Json {
        match f.type_.as_str() {
            "amount" => json!("12345"),
            "count" => json!(3),
            "date" => json!(5 * DAY),
            "duration" => json!(DAY),
            "choice" => json!(f.options.first().cloned().unwrap_or_else(|| "yes".into())),
            "list" => json!([format!("{name}-1"), format!("{name}-2")]),
            "text" => json!(format!("words of {name}")),
            _ => json!(format!("{name}-1")),
        }
    }

    /// The law of reading back (docs/design/broad-seats.md, G2): for every form in the catalogue, a paper written from
    /// its blanks reads back to the same blanks (all but the writer's words, and those its form reads by a rule).
    #[test]
    fn every_form_reads_back_the_blanks_it_was_written_with() {
        let as_is = |s: &str| Ok(s.to_string());
        let mut checked = 0;
        // (A list that two list blanks are set out in cannot say which item was whose: such a paper does not read back,
        // and a matter of it goes as the finished act.)
        fn two_lists(t: &Json, lists: &[&str]) -> bool {
            match t {
                Json::Array(xs) => xs.iter().filter(|x| placeholder(x).is_some_and(|(_, n)| lists.contains(&n))).count() > 1 || xs.iter().any(|x| two_lists(x, lists)),
                Json::Object(m) => m.values().any(|x| two_lists(x, lists)),
                _ => false,
            }
        }
        for f in crate::forms::all() {
            let spec = serde_json::to_value(&f).unwrap();
            let lists: Vec<&str> = f.fields.iter().filter(|(_, x)| x.type_ == "list").map(|(n, _)| n).collect();
            if two_lists(&spec["writes"], &lists) {
                continue;
            }
            let blanks: Map<String, Json> = f.fields.iter().filter(|(_, x)| x.read.is_none()).map(|(n, x)| (n.to_string(), sample(n, x))).collect();
            let paper = write_paper(&spec, &blanks, "me", 10 * DAY, &as_is, None, None).unwrap_or_else(|e| panic!("{}: {e}", f.form));
            let back = read_back(&spec, &paper, "me", 10 * DAY).unwrap_or_else(|| panic!("{} does not read back: {paper:?}", f.form));
            for (k, v) in &blanks {
                if role(&spec, k) != "words" {
                    assert!(alike(back.get(k), Some(v)), "{}: {k} read back as {:?}, written {v}", f.form, back.get(k));
                }
            }
            checked += 1;
        }
        assert!(checked > 50, "{checked}");
    }

    /// A blank worked out by its form's rule is not given where the rule gives the principal's own figure, and the paper
    /// written from what is given is the principal's paper; one whose rule does not agree is given as it stands.
    #[test]
    fn a_worked_blank_is_left_to_its_rule_only_where_the_rule_gives_the_principals_figure() {
        let f = crate::forms::all().into_iter().find(|x| x.form == "export_invoice").expect("the export invoice form");
        let spec = serde_json::to_value(&f).unwrap();
        let line: Map<String, Json> = serde_json::from_value(json!({ "kind": "invoice", "text": "Invoice: 3 goods at $10.00 each, $30.00.", "addressed_to": ["outside"], "visible_to": ["f1", "outside"], "basis": "rec.16",
            "data": { "kind": "goods", "quantity": 3, "from_at": "works", "outcome": { "money": { "to": "acc-f1", "amount": "3000", "for": "3 goods exported" } } } }))
        .unwrap();
        let back = read_back(&spec, &line, "f1", 0).expect("reads back");
        let given = given(&spec, &back);
        assert!(!given.contains_key("amount") && !given.contains_key("memo") && given["unit_price"] == json!("1000"), "{given:?}");
        // (The memo is words: the form's way of putting it is the code assistant's, and nobody checks it.)
        assert_eq!(role(&spec, "memo"), "words");
        let money = |s: &str| Ok(format!("${}.00", s.parse::<i64>().unwrap_or_default() / 100));
        let made = compose(&spec, &given, "f1", 0, &money, None).unwrap();
        assert_eq!((made["data"].clone(), made["text"].clone()), (line["data"].clone(), line["text"].clone()));
        let mut other = line.clone();
        other["data"]["outcome"]["money"]["amount"] = json!("3500");
        let given = super::given(&spec, &read_back(&spec, &other, "f1", 0).unwrap());
        assert_eq!((given["amount"].clone(), given["unit_price"].clone()), (json!("3500"), json!("1166")), "a sum its rule does not give is given as it stands");
    }
}
