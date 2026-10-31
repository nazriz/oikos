//! Laws as the actors read and write them (participants/src/law.ts; common.ts "laws made from figures"). Pure.
//!
//! - **Reading** a statement's formal condition against an act: the law reader (`oikos-law`: CEL, integers only,
//!   allowlisted functions, D27). A law's condition has no power: an actor chooses to apply it (`breaches` in
//!   `oikos_actors::common::laws`), and never the kernel.
//! - **Writing** a law from a few figures by a schedule (a record of kind `law_schedule`: docs/behaviour/
//!   government.md): the generator's opening laws and a council clerk's amended law are written the same way, so
//!   whoever reads the first reads the second. Nothing here knows any particular law.

use serde::{Deserialize, Serialize};
use oikos_core::Frozen;
use serde_json::Value;
use std::collections::BTreeMap;

const DAY: i64 = 86_400;

/// A standing claim as a law's condition reads it: a position held by someone, to an action, about an object.
pub use oikos_law::Claim;

/// Whether a condition may be used at all, and why not (an empty list: it may).
pub fn violations(condition: &str) -> Result<Vec<String>, String> {
    oikos_law::violations(condition)
}

/// A law's formal condition against an act (a block, as JSON), the acting entity, the moment and the claims the reader
/// knows of: true where the act matches (for a prohibition: it would be a breach); an error where the condition cannot
/// be read of this act (it names a field the act lacks), which the reader counts and says (law.ts `evaluate`).
pub fn evaluate(condition: &str, block: &Value, actor: &str, now: i64, claims: &[Claim]) -> Result<bool, String> {
    oikos_law::evaluate(condition, block, actor, now, claims)
}

/// Claims as someone reading the registry understands them: recorded, and not released or withdrawn (law.ts
/// `standingClaims`), from records as JSON in the order seen. Each claim read as the condition reads it (a claim
/// whose `about` names no action and object is no permission to anything, and is left out).
pub fn standing_claims<'a>(records: impl IntoIterator<Item = &'a Value> + Clone) -> Vec<Claim> {
    let mut gone = std::collections::BTreeSet::new();
    for r in records.clone() {
        match r.get("record").and_then(Value::as_str) {
            Some("claim_release") => gone.extend(r.get("claim").and_then(Value::as_str)),
            Some("withdrawal") => gone.extend(r.get("withdraws").and_then(Value::as_str)),
            _ => {}
        }
    }
    records
        .into_iter()
        .filter(|r| r.get("record").and_then(Value::as_str) == Some("claim"))
        .filter(|r| !r.get("id").and_then(Value::as_str).is_some_and(|id| gone.contains(id)))
        .filter_map(Claim::from_record)
        .collect()
}

// ------------------------------------------------------------------ laws written from figures

/// A figure of a law. A duration is held in seconds and worded in `unit` (days, months...); a count is held in
/// `held_in` (default: its unit), `per_unit` of them to one `unit` (a share: unit "percent", held in basis points,
/// 100 to one). `type` is also the type of the figure's field on the law's amendment form.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LawFigure {
    #[serde(rename = "type")]
    pub type_: FigureType,
    pub unit: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub held_in: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub per_unit: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// The law may do without it: given as nought, it is taken as not given (a requirement of nothing is none).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub optional: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FigureType {
    Duration,
    Count,
}

/// A schedule (a `law_schedule` record's data): in its `text`, each part of its `adico` and its `formal`, `{name}`
/// stands for the figure as worded ("60 days", "50") and `{name:held}` for the number as held. Clauses that turn on
/// optional figures are a list, `<<separator;;clause;;clause>>`: a clause is kept where every figure it names is
/// given, and the kept ones are joined by the separator.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LawSchedule {
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub form: Option<String>,
    pub figures: BTreeMap<String, LawFigure>,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub adico: Option<BTreeMap<String, String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub formal: Option<String>,
}

/// A figure as a law carries it: its value with the unit it is held in.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HeldFigure {
    pub value: i64,
    pub unit: String,
}

/// What a schedule writes: the law's words, its breakdown, its rule and the figures it carries (`data`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DraftLaw {
    pub text: String,
    pub adico: Option<BTreeMap<String, String>>,
    /// A CEL condition (`formal: {language: "cel", condition}`).
    pub formal: Option<String>,
    pub schedule: String,
    pub figures: BTreeMap<String, HeldFigure>,
}

impl DraftLaw {
    /// The statement's `data` (`{schedule, figures}`).
    pub fn data(&self) -> Value {
        serde_json::json!({ "schedule": self.schedule, "figures": self.figures })
    }
    /// The statement's `formal` part.
    pub fn formal_part(&self) -> Option<Value> {
        self.formal.as_ref().map(|c| serde_json::json!({ "language": "cel", "condition": c }))
    }
}

/// The unit a figure's value is held in.
pub fn held_in(f: &LawFigure) -> String {
    match f.type_ {
        FigureType::Duration => "seconds".into(),
        FigureType::Count => f.held_in.clone().unwrap_or_else(|| f.unit.clone()),
    }
}

/// A figure's value as held, from what its form field gives (a duration in seconds; a count in the figure's unit).
pub fn held_value(f: &LawFigure, given: i64) -> i64 {
    match f.type_ {
        FigureType::Duration => given,
        FigureType::Count => given * f.per_unit.unwrap_or(1),
    }
}

/// Is a figure given? An optional one given as nought is not.
pub fn figure_given(f: Option<&LawFigure>, value: Option<i64>) -> bool {
    matches!((f, value), (Some(f), Some(v)) if !(f.optional && v == 0))
}

/// `n / d` written as a decimal: whole where it is whole, else to at most `places` places, trailing noughts dropped,
/// rounded half away from nought. (Decided fresh: TS wrote JavaScript's float; a law's figures are whole numbers of
/// their unit or hundredths of one.)
fn decimal(n: i64, d: i64, places: u32) -> String {
    let scale = 10_i128.pow(places);
    let (n, d) = (i128::from(n), i128::from(d.max(1)));
    let neg = n < 0;
    let x = (n.abs() * scale * 2 + d) / (d * 2);
    let (whole, mut frac) = (x / scale, x % scale);
    let mut s = format!("{}{whole}", if neg && x != 0 { "-" } else { "" });
    if frac != 0 {
        let mut digits = places;
        while frac % 10 == 0 {
            frac /= 10;
            digits -= 1;
        }
        s.push_str(&format!(".{frac:0width$}", width = digits as usize));
    }
    s
}

const DURATION_UNITS: [(&str, &str, i64); 7] = [
    ("years", "year", 365 * DAY),
    ("months", "month", 30 * DAY),
    ("weeks", "week", 7 * DAY),
    ("days", "day", DAY),
    ("hours", "hour", 3600),
    ("minutes", "minute", 60),
    ("seconds", "second", 1),
];

/// A figure in words (common.ts `figureWords`): a duration in the schedule's unit when it is a whole number of them,
/// else in days, hours or minutes where whole, else in the schedule's unit to two places; a count in its unit ("50%",
/// "3 times"; without the unit, "50"). Not there: "none".
pub fn figure_words(f: &LawFigure, value: Option<i64>, with_unit: bool) -> String {
    let Some(value) = value else { return "none".into() };
    match f.type_ {
        FigureType::Duration => {
            let own = DURATION_UNITS.iter().find(|u| u.0 == f.unit).copied().unwrap_or(DURATION_UNITS[3]);
            let (plural, singular, size) =
                [own, DURATION_UNITS[3], DURATION_UNITS[4], DURATION_UNITS[5]].into_iter().find(|u| value >= u.2 && value % u.2 == 0).unwrap_or(own);
            let n = decimal(value, size, 2);
            format!("{n} {}", if n == "1" { singular } else { plural })
        }
        FigureType::Count => {
            let n = decimal(value, f.per_unit.unwrap_or(1), 6);
            match (with_unit, f.unit.as_str()) {
                (false, _) => n,
                (true, "percent") => format!("{n}%"),
                (true, u) => format!("{n} {u}"),
            }
        }
    }
}

/// The names a template part uses (`{name}` or `{name:held}`).
fn names_in(part: &str) -> Vec<&str> {
    let mut out = vec![];
    let mut rest = part;
    while let Some(i) = rest.find('{') {
        rest = &rest[i + 1..];
        let end = rest.find('}').unwrap_or(rest.len());
        let inner = &rest[..end];
        let name = inner.split(':').next().unwrap_or("");
        if !name.is_empty() && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_') {
            out.push(name);
        }
        rest = &rest[end.min(rest.len())..];
    }
    out
}

/// A law written from figures by a schedule (common.ts `draftLaw`). An error if the schedule names a figure it is not
/// given and cannot do without (a law cannot be written with a gap in it), or it is given none of its figures.
pub fn draft_law(schedule_id: &str, s: &LawSchedule, values: &BTreeMap<String, i64>) -> Result<DraftLaw, String> {
    let given = |name: &str| figure_given(s.figures.get(name), values.get(name).copied());
    // The clauses that turn on optional figures: each kept where all it names is given, the kept ones joined.
    let clauses = |t: &str| -> String {
        let mut out = String::new();
        let mut rest = t;
        while let Some(i) = rest.find("<<") {
            out.push_str(&rest[..i]);
            let after = &rest[i + 2..];
            let Some(j) = after.find(">>") else {
                out.push_str(&rest[i..]);
                rest = "";
                break;
            };
            let mut parts = after[..j].split(";;");
            let sep = parts.next().unwrap_or("");
            let kept: Vec<&str> = parts.filter(|p| names_in(p).iter().all(|n| given(n))).collect();
            out.push_str(&kept.join(sep));
            rest = &after[j + 2..];
        }
        out.push_str(rest);
        out
    };
    let fill = |t: &str| -> Result<String, String> {
        let c = clauses(t);
        let mut out = String::new();
        let mut rest = c.as_str();
        while let Some(i) = rest.find('{') {
            out.push_str(&rest[..i]);
            let after = &rest[i + 1..];
            let end = after.find('}');
            let inner = end.map(|e| &after[..e]);
            match inner {
                Some(inner) if !inner.is_empty() && inner.split(':').all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')) => {
                    let mut it = inner.split(':');
                    let name = it.next().unwrap_or("");
                    let held = it.next().is_some();
                    if !given(name) {
                        return Err(format!("law schedule {schedule_id}: no figure {name}"));
                    }
                    let v = values.get(name).copied();
                    out.push_str(&if held { v.unwrap_or(0).to_string() } else { figure_words(&s.figures[name], v, false) });
                    rest = &after[end.unwrap_or(0) + 1..];
                }
                _ => {
                    out.push('{');
                    rest = after;
                }
            }
        }
        out.push_str(rest);
        // (Spaces left doubled by a clause left out are one; the ends trimmed.)
        let mut squeezed = String::with_capacity(out.len());
        let mut space = 0;
        for ch in out.chars() {
            if ch == ' ' {
                space += 1;
                if space == 1 {
                    squeezed.push(' ');
                }
            } else {
                space = 0;
                squeezed.push(ch);
            }
        }
        Ok(squeezed.trim().to_string())
    };
    let mut figures = BTreeMap::new();
    for (name, f) in &s.figures {
        if !given(name) {
            if f.optional {
                continue;
            }
            return Err(format!("law schedule {schedule_id}: no figure {name}"));
        }
        figures.insert(name.clone(), HeldFigure { value: values[name], unit: held_in(f) });
    }
    if figures.is_empty() {
        return Err(format!("law schedule {schedule_id}: none of its figures is given, so there is no law to write"));
    }
    let adico = match &s.adico {
        None => None,
        Some(a) => {
            let mut out = BTreeMap::new();
            for (k, v) in a {
                let w = fill(v)?;
                // (A part of the breakdown that turned wholly on figures not given is left out.)
                if !w.is_empty() {
                    out.insert(k.clone(), w);
                }
            }
            Some(out)
        }
    };
    Ok(DraftLaw {
        text: fill(&s.text)?,
        adico,
        formal: s.formal.as_deref().map(fill).transpose()?,
        schedule: schedule_id.to_string(),
        figures,
    })
}

/// A law's figures as its data carries them (`data.figures`), as plain values in the unit each is held in.
pub fn figures_of(data: &Frozen) -> BTreeMap<String, i64> {
    data.get("figures")
        .and_then(|x| x.as_object())
        .map(|m| m.iter().filter_map(|(k, v)| v.get("value").and_then(|x| x.as_i64()).map(|x| (k.to_string(), x))).collect())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn notice_schedule() -> LawSchedule {
        serde_json::from_value(serde_json::json!({
            "title": "Notice of a rent increase",
            "figures": {
                "notice": { "type": "duration", "unit": "days" },
                "cap": { "type": "count", "unit": "percent", "held_in": "bps", "per_unit": 100, "optional": true }
            },
            "text": "A landlord must give {notice} notice of a rent increase.<<;; It may not raise it by more than {cap}%.>>",
            "adico": { "aim": "give notice", "condition": "<<;;more than {cap}%>>" },
            "formal": "block.kind == 'rent_increase' && block.data.from - now < {notice:seconds}"
        }))
        .unwrap()
    }

    #[test]
    fn a_law_written_from_its_figures_with_and_without_an_optional_one() {
        let s = notice_schedule();
        let mut v = BTreeMap::from([("notice".to_string(), 60 * DAY)]);
        let d = draft_law("rec.7", &s, &v).unwrap();
        assert_eq!(d.text, "A landlord must give 60 days notice of a rent increase.");
        assert_eq!(d.adico.as_ref().unwrap().len(), 1, "the part that turned wholly on the cap is left out");
        assert_eq!(d.formal.as_deref(), Some("block.kind == 'rent_increase' && block.data.from - now < 5184000"));
        assert_eq!(d.data()["figures"]["notice"], serde_json::json!({ "value": 5_184_000, "unit": "seconds" }));
        v.insert("cap".into(), 550);
        let d = draft_law("rec.7", &s, &v).unwrap();
        assert_eq!(d.text, "A landlord must give 60 days notice of a rent increase. It may not raise it by more than 5.5%.");
        v.insert("cap".into(), 0);
        assert!(!draft_law("rec.7", &s, &v).unwrap().text.contains("raise"), "an optional figure of nought is none");
        assert!(draft_law("rec.7", &s, &BTreeMap::new()).is_err());
    }

    /// The shared cases (contracts/test/law-drafts.json): every schedule of worlds/law/schedules.json, as TS's
    /// `draftLaw` wrote it, with every figure and with each optional one left out.
    #[test]
    fn every_schedule_drafts_as_the_ts_drafted_it() {
        let cases: Value = serde_json::from_str(include_str!("../../../../contracts/test/law-drafts.json")).unwrap();
        let cases = cases["cases"].as_array().unwrap();
        assert!(cases.len() >= 3);
        for c in cases {
            let s: LawSchedule = serde_json::from_value(c["data"].clone()).unwrap();
            let values: BTreeMap<String, i64> = serde_json::from_value(c["values"].clone()).unwrap();
            let id = c["schedule"].as_str().unwrap();
            match (draft_law(id, &s, &values), c["out"].get("error")) {
                (Err(_), Some(_)) => {}
                (Ok(d), None) => {
                    let o = &c["out"];
                    assert_eq!(d.text, o["text"], "{id} {values:?}");
                    assert_eq!(serde_json::to_value(&d.adico).unwrap(), o.get("adico").cloned().unwrap_or(Value::Null), "{id}");
                    assert_eq!(d.formal_part(), o.get("formal").cloned(), "{id}");
                    assert_eq!(d.data(), o["data"], "{id}");
                }
                (got, want) => panic!("{id} {values:?}: {got:?} where TS gave {want:?}"),
            }
        }
    }

    #[test]
    fn figures_in_words() {
        let days = LawFigure { type_: FigureType::Duration, unit: "months".into(), label: None, held_in: None, per_unit: None, description: None, optional: false };
        assert_eq!(figure_words(&days, Some(60 * DAY), true), "2 months");
        assert_eq!(figure_words(&days, Some(30 * DAY), true), "1 month");
        assert_eq!(figure_words(&days, Some(45 * DAY), true), "45 days");
        assert_eq!(figure_words(&days, Some(5400), true), "90 minutes");
        assert_eq!(figure_words(&days, None, true), "none");
        let pct = LawFigure { type_: FigureType::Count, unit: "percent".into(), label: None, held_in: Some("bps".into()), per_unit: Some(100), description: None, optional: false };
        assert_eq!(figure_words(&pct, Some(5000), true), "50%");
        assert_eq!(figure_words(&pct, Some(5050), false), "50.5");
        assert_eq!(held_value(&pct, 5), 500);
    }

    #[test]
    fn a_condition_read_against_an_act_and_the_claims_that_stand() {
        let recs = [
            serde_json::json!({ "id": "rec.1", "record": "claim", "position": "liberty", "holder": "ann", "about": { "action": "build", "object": "lot-1" } }),
            serde_json::json!({ "id": "rec.2", "record": "claim", "position": "liberty", "holder": "bob", "about": { "action": "build", "object": "lot-2" } }),
            serde_json::json!({ "id": "rec.3", "record": "claim_release", "claim": "rec.2" }),
        ];
        let claims = standing_claims(recs.iter());
        assert_eq!(claims.len(), 1);
        let block = serde_json::json!({ "block": "construct", "on": "lot-1" });
        assert_eq!(evaluate("!holds_liberty(actor, 'build', block.on)", &block, "ann", 0, &claims), Ok(false));
        assert_eq!(evaluate("!holds_liberty(actor, 'build', block.on)", &block, "bob", 0, &claims), Ok(true));
        assert!(evaluate("block.missing > 1", &block, "ann", 0, &claims).is_err());
    }
}
