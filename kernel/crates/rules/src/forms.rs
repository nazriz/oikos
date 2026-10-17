//! An office's stationery, as data (participants/src/module.ts `FormField`, `Issued`, `Taken`, `Routine`, `Answers`,
//! `Opening`, `Kept`; participants/src/behaviour/papers.ts; docs/behaviour/office-papers.md).
//!
//! A form says what whoever fills it in is asked for, and how its fields are written into the statement the rest of
//! the world reads (`writes`, contracts/outcomes.schema.json FormWrites). A module lists the forms its office issues
//! and the directions it takes in its manifest (`issues`, `takes`); where a model holds the office the world publishes
//! them for it, and a paper filled in on its form is the paper the module would have made. The engine's resolver
//! writes a filled form into its paper (kernel/crates/resolver/src/forms.rs); nothing here does, and a code office
//! makes its papers with `say` as before.
//!
//! **The catalogue** (`catalogue`, `group`, `form`) is the forms of papers.ts by its export's name, read from
//! `forms/papers.json`, which `scripts/port-forms.ts` writes and `participants/test/port-forms.test.ts` holds equal to
//! the TS until the cut-over; after it the JSON is the source. Lane E owns its content. Its schema is the one the
//! translator reads forms by name in (`Issued` as JSON, fields in the order written).

use serde::de::{Deserializer, MapAccess, Visitor};
use serde::ser::{SerializeMap, Serializer};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

/// A map that keeps the order it was written in (a form's fields are asked for in that order).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Ordered<T>(pub Vec<(String, T)>);

impl<T> Ordered<T> {
    pub fn get(&self, k: &str) -> Option<&T> {
        self.0.iter().find(|(n, _)| n == k).map(|(_, v)| v)
    }
    pub fn keys(&self) -> impl Iterator<Item = &str> {
        self.0.iter().map(|(k, _)| k.as_str())
    }
    pub fn iter(&self) -> impl Iterator<Item = (&str, &T)> {
        self.0.iter().map(|(k, v)| (k.as_str(), v))
    }
    pub fn remove(&mut self, k: &str) -> Option<T> {
        let i = self.0.iter().position(|(n, _)| n == k)?;
        Some(self.0.remove(i).1)
    }
    pub fn set(&mut self, k: &str, v: T) {
        match self.0.iter_mut().find(|(n, _)| n == k) {
            Some(x) => x.1 = v,
            None => self.0.push((k.to_string(), v)),
        }
    }
}

impl<T: Serialize> Serialize for Ordered<T> {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let mut m = s.serialize_map(Some(self.0.len()))?;
        for (k, v) in &self.0 {
            m.serialize_entry(k, v)?;
        }
        m.end()
    }
}

impl<'de, T: Deserialize<'de>> Deserialize<'de> for Ordered<T> {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V<T>(std::marker::PhantomData<T>);
        impl<'de, T: Deserialize<'de>> Visitor<'de> for V<T> {
            type Value = Ordered<T>;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("a map")
            }
            fn visit_map<A: MapAccess<'de>>(self, mut a: A) -> Result<Ordered<T>, A::Error> {
                let mut v = vec![];
                while let Some((k, x)) = a.next_entry::<String, T>()? {
                    v.push((k, x));
                }
                Ok(Ordered(v))
            }
        }
        d.deserialize_map(V(std::marker::PhantomData))
    }
}

/// A field of a form: what whoever fills it in is asked for. `type`: amount, duration, date, count, text, choice
/// (one of `options`), list (several ids), or what an id names (lot, cell, space, structure_type, account, entity,
/// structure, record).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FormField {
    #[serde(rename = "type")]
    pub type_: String,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub required: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<String>,
    pub description: String,
}

impl FormField {
    pub fn new(type_: &str, description: &str) -> Self {
        FormField { type_: type_.into(), required: false, options: vec![], description: description.into() }
    }
    pub fn required(mut self) -> Self {
        self.required = true;
        self
    }
    pub fn options(mut self, o: &[&str]) -> Self {
        self.options = o.iter().map(|s| s.to_string()).collect();
        self
    }
}

/// Whom a form itself sends every paper to, whatever its fields say, and why, in the form's own words.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Sends {
    pub to: Vec<String>,
    pub why: String,
}

/// A claim a form records beside its paper (the permission a decision grants): where `when` holds, `holder` has
/// `position` about `about`, citing `basis`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FormClaim {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub when: Option<BTreeMap<String, String>>,
    pub position: String,
    pub holder: String,
    pub about: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub basis: Option<String>,
}

/// How a form's fields are written into its paper (forms.ts `FormWrites`). In a template, a string `=name`, `#name`,
/// `?name` or `+name` stands for a field (forms.ts); `@name` for something of the office's own that the world fills
/// in when it publishes the form (`issues_with`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FormWrites {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sends: Vec<Sends>,
    pub kind: String,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub basis: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to: Option<Vec<Value>>,
    /// `"public"`, or a list.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub offer: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assertion: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claim: Option<FormClaim>,
}

/// A paper an office issues, as a form of its own stationery (module.ts `Issued`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Issued {
    pub form: String,
    pub title: String,
    /// What issuing the paper does, in a sentence, for whoever holds the office.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub does: Option<String>,
    pub fields: Ordered<FormField>,
    pub writes: FormWrites,
}

/// A written direction an office takes (module.ts `Taken`; docs/behaviour/directions.md): the form it publishes for
/// it, and what following one means.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Taken {
    pub form: String,
    pub title: String,
    pub fields: Ordered<FormField>,
    pub follows: String,
}

/// A routine's rhythm: days, or the parameter that gives them with what it is where none is given.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Every {
    Days(i64),
    Param(String, i64),
}

/// A kind of incoming paper a counter's staff answer, and how.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CounterPaper {
    pub kind: String,
    pub how: String,
}

/// A routine task an office's staff do by standing work order (module.ts `Routine`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Routine {
    pub task: String,
    pub what: String,
    /// The parameter that holds the place the work is done at.
    pub at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub every: Option<Every>,
    /// Where when it is done is set by a published paper: the parameter that names it, and the paper otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub follows: Option<(String, String)>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub papers: Vec<CounterPaper>,
}

/// What an office says of a letter that plainly concerns something it has a form or a set way for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AnswerForm {
    pub about: Vec<String>,
    pub say: String,
}

/// How a code-run office answers a letter (module.ts `Answers`; docs/behaviour/letters.md).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Answers {
    pub office: String,
    pub acts: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub forms: Vec<AnswerForm>,
    /// The office has a standing report of its own, which it sends in answer to a letter, with these words after it.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub report: bool,
}

/// A paper an office has on file when a new holder arrives (module.ts `Opening`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Opening {
    pub kind: String,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub offer: Option<Value>,
}

/// A whole collection a kind of participant holds, or what it carries of the world's edge, with the reason in words
/// (module.ts `Kept`; docs/no-god-view.md).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Kept {
    pub what: String,
    pub why: String,
}

// ------------------------------------------------------------------ the catalogue (papers.ts)

const CATALOGUE: &str = include_str!("../forms/papers.json");

#[derive(Deserialize)]
#[serde(untagged)]
enum Entry {
    One(Box<Issued>),
    Many(Vec<Issued>),
}

/// Every group of forms (papers.ts's exports by name: `LANDLORD`, `REGISTRY`, `ORDER` ...), each a list.
pub fn catalogue() -> Ordered<Vec<Issued>> {
    let raw: Ordered<Entry> = serde_json::from_str(CATALOGUE).expect("forms/papers.json reads as forms (a test holds it)");
    Ordered(
        raw.0
            .into_iter()
            .map(|(k, e)| {
                (k, match e {
                    Entry::One(f) => vec![*f],
                    Entry::Many(v) => v,
                })
            })
            .collect(),
    )
}

/// One group of forms, by its name in the catalogue (empty if there is none).
pub fn group(name: &str) -> Vec<Issued> {
    catalogue().remove(name).unwrap_or_default()
}

/// One form of a group, by its form name.
pub fn form(group_name: &str, form: &str) -> Option<Issued> {
    group(group_name).into_iter().find(|f| f.form == form)
}

/// Every form of the catalogue, in group order, each once (a form in two groups is the same form).
pub fn all() -> Vec<Issued> {
    let mut out: Vec<Issued> = vec![];
    for (_, g) in catalogue().0 {
        for f in g {
            if !out.contains(&f) {
                out.push(f);
            }
        }
    }
    out
}

// ------------------------------------------------------------------ forms made from a place's law (papers.ts)

/// What a place's law says of a plan to pay in place of possession (papers.ts `planLaw`): whether the tribunal may set
/// one, must consider one, or has none; where it is taken away; and where paying everything owed in time ends the claim.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlanLaw {
    /// "may", "must" or "none".
    pub plan_consider: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan_barred_rent_months: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cure_days: Option<i64>,
}

/// The profile's figures `planLaw` is read from.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlanFigures {
    pub plan_months: i64,
    #[serde(default)]
    pub plan_consider: Option<String>,
    #[serde(default)]
    pub plan_barred_rent_months: Option<i64>,
    #[serde(default)]
    pub cure_days: Option<i64>,
}

pub fn plan_law(p: &PlanFigures) -> PlanLaw {
    let consider = if p.plan_months > 0 {
        match p.plan_consider.as_deref() {
            Some("must") => "must",
            Some("none") => "none",
            _ => "may",
        }
    } else {
        "none"
    };
    PlanLaw {
        plan_consider: consider.into(),
        plan_barred_rent_months: p.plan_barred_rent_months.filter(|m| *m != 0 && consider != "none"),
        cure_days: p.cure_days.filter(|d| *d != 0),
    }
}

/// The same, in the law's words: what the tribunal may or must do before it orders possession.
pub fn plan_law_words(p: &PlanFigures) -> String {
    let l = plan_law(p);
    let barred = l.plan_barred_rent_months.map(|m| format!("; it may not where {m} months' rent or more is owed on the day it decides")).unwrap_or_default();
    let months = p.plan_months;
    let plan = match l.plan_consider.as_str() {
        "must" => format!("Before it orders possession the tribunal must consider whether the tenant could pay what is owed by a plan, the tenant staying and paying the rent and a sum a month over no more than {months} months, and may set one in place of possession{barred}."),
        "may" => format!("The tribunal may, in place of possession, set a plan to pay: the tenant staying and paying the rent and a sum a month over no more than {months} months{barred}."),
        _ => "The law gives the tribunal no plan to pay to set in place of possession.".into(),
    };
    let cure = match l.cure_days {
        Some(d) => format!(" If everything owed is paid within {d} days of the application, the claim is at an end and the tenancy goes on."),
        None => " Where what is owed has been paid, there is nothing to order.".into(),
    };
    plan + &cure
}

/// The possession order form as a place's law has it (papers.ts `possessionOrderFor`): with the plan where the law
/// gives the tribunal one to set, and without it (the option, its fields and its words) where it gives none.
pub fn possession_order_for(law: &PlanLaw, plan_months: i64) -> Option<Issued> {
    let mut x = form("TRIBUNAL_MEMBER", "possession_order")?;
    let tail = " It moves nobody: a tenant still there after the day is put out only on a warrant the landlord asks the tribunal's registrar for, by whoever carries its warrants out. What the law asks before an order and how many days on the day for possession falls are in the law on possession and the tribunal's procedure.";
    let head = "Decides an application for possession of a let home for rent owed, and tells landlord and tenant: ";
    let cure = law.cure_days.map(|d| format!(" Where everything owed has been paid within {d} days of the application the law ends the claim: dismissed.")).unwrap_or_default();
    if law.plan_consider == "none" {
        x.fields.remove("instalment");
        x.fields.remove("pay_into");
        if let Some(Value::Object(d)) = x.writes.data.as_mut() {
            d.remove("instalment");
            d.remove("to");
        }
        x.does = Some(format!("{head}dismissed (the tenant stays, and the notice to vacate is spent); or possession on a day (the tenant and household are to leave by it). The law here gives the tribunal no plan to pay to set.{cure}{tail}"));
        x.fields.set("finding", FormField::new("choice", "What is ordered.").required().options(&["dismissed", "possession"]));
        x.fields.set("owed", FormField::new("amount", "The rent found owed (possession)."));
        return Some(x);
    }
    let barred = law.plan_barred_rent_months.map(|m| format!(", which the law does not allow where {m} months' rent or more is owed on the day of the order")).unwrap_or_default();
    let asks = if law.plan_consider == "must" { "The law asks the tribunal to consider a plan before it orders possession." } else { "The law allows a plan in place of possession." };
    x.does = Some(format!("{head}dismissed (the tenant stays, and the notice to vacate is spent); a plan (the tenant stays, paying the rent and a sum a month toward what is owed, over no more than {plan_months} months{barred}; a plan not kept, the landlord may apply again); or possession on a day (the tenant and household are to leave by it). {asks}{cure}{tail}"));
    Some(x)
}

/// What a job advertisement carries of the employer's own (papers.ts `staffingOwn`): the post, the trade, where the
/// work is, and the notice; each value of an `@name` in `JOB_ADVERTISEMENT`.
pub fn staffing_own(role: Option<&str>, industry: Option<&str>, workplace: Option<&str>, notice_days: Option<i64>) -> BTreeMap<String, Value> {
    let mut m = BTreeMap::new();
    let some = |s: Option<&str>| s.filter(|x| !x.is_empty()).map(|x| Value::String(x.into()));
    if let Some(r) = role {
        m.insert("role".into(), Value::String(r.into()));
    }
    if let Some(i) = some(industry) {
        m.insert("industry".into(), i);
    }
    if let Some(w) = workplace.filter(|w| !w.is_empty()) {
        m.insert("workplace".into(), Value::String(w.into()));
        m.insert("workplace_structure".into(), Value::String(w.split('/').next().unwrap_or(w).into()));
        m.insert("occupancy".into(), serde_json::json!({ "who": "taker", "does": { "outcome": { "occupancy": { "in": w } } } }));
    }
    if let Some(n) = notice_days.filter(|n| *n > 0) {
        let s = n * 86_400;
        m.insert("termination".into(), serde_json::json!([{ "party": "=self", "notice": s }, { "party": "taker", "notice": s }]));
    }
    m
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_catalogue_reads_and_keeps_its_fields_in_order() {
        let c = catalogue();
        assert!(c.0.len() >= 25, "{} groups", c.0.len());
        let forms = all();
        assert!(forms.len() >= 70, "{} forms", forms.len());
        let mut names: Vec<&str> = forms.iter().map(|f| f.form.as_str()).collect();
        names.sort();
        let ad = form("JOB_ADVERTISEMENT", "job_advertisement").unwrap();
        assert_eq!(ad.fields.keys().collect::<Vec<_>>(), ["wage", "period", "posts", "account"]);
        assert_eq!(ad.writes.kind, "job_posting");
        // (Written out again, it reads the same: the export the translator reads.)
        let again: Issued = serde_json::from_str(&serde_json::to_string(&ad).unwrap()).unwrap();
        assert_eq!(again, ad);
        assert!(form("PLANNING", "permit_decision").unwrap().writes.claim.is_some());
    }

    #[test]
    fn the_possession_order_follows_the_place_s_law() {
        let none = plan_law(&PlanFigures { plan_months: 0, ..Default::default() });
        assert_eq!(none.plan_consider, "none");
        let f = possession_order_for(&none, 0).unwrap();
        assert!(f.fields.get("instalment").is_none());
        assert_eq!(f.fields.get("finding").unwrap().options, ["dismissed", "possession"]);
        let must = plan_law(&PlanFigures { plan_months: 12, plan_consider: Some("must".into()), plan_barred_rent_months: Some(3), cure_days: Some(14) });
        let f = possession_order_for(&must, 12).unwrap();
        assert!(f.fields.get("instalment").is_some());
        assert!(f.does.as_deref().unwrap().contains("over no more than 12 months, which the law does not allow where 3 months'"));
        assert!(plan_law_words(&PlanFigures { plan_months: 12, plan_consider: Some("must".into()), plan_barred_rent_months: Some(3), cure_days: Some(14) }).contains("within 14 days"));
    }
}
