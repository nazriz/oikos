//! Tax on pay, as an employer's payroll and an employee reckon it (participants/src/behaviour/tax.ts;
//! docs/behaviour/public-finance.md). The law is a record its lawmaker publishes: a list of charges, each with what it
//! is charged on, its schedule of rates, its reliefs and whom it is paid to. Nothing here holds any place's figures;
//! every figure is the law's, which a world's profile supplies.
//!
//! Pure, integer, data in and data out: the actors read the law from their book (`firms::tax::income_tax_law`) and the
//! generator calls the same functions through the N-API module, so the opening wage instructions, every payroll, a
//! worker's own check and a payment reckoned on net pay come to the same figure to the smallest unit. Amounts are
//! cents (`i64`); every product is taken in `i128` and floored, which is exactly what TS's `Math.floor` of a quotient
//! gave while the quotient was below 2^53 (the shared cases, `contracts/test/withholding.json`, are held to the TS).

use crate::returns::{return_rule_in_words, return_rules_of, returns_of, ReturnRule, MONTH_WORDS};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

const DAY: i64 = 86_400;
const YEAR: i64 = 365 * DAY;

/// A band of a schedule: the marginal rate on what lies above `from` (up to the next band's start). With
/// `rising_to_bps`, the marginal rate rises in a straight line from `rate_bps` at the band's start to that at its end.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Band {
    pub from: i64,
    pub rate_bps: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rising_to_bps: Option<i64>,
}

/// A sum taken off the pay before it is charged, or off the charge: flat, or lost as pay rises (`tapers`: by `bps` of
/// each unit of a year's pay above `above`, never below nought).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Allowance {
    pub amount: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tapers: Option<Taper>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Taper {
    pub above: i64,
    pub bps: i64,
}

/// What is taken off a year's pay before a charge's schedule is applied: an allowance; a share of the pay, within a
/// least and a most; or what other charges of the same law take (contributions deducted before a tax).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Deduction {
    Charges { charges: Vec<String> },
    Share {
        share_bps: i64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        least: Option<i64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        most: Option<i64>,
    },
    Allowance(Allowance),
}

/// What is taken off a charge once reckoned: an allowance (a credit); or all of it, where what it is charged on is no
/// more than a sum (a rebate that leaves low incomes untaxed). Never below nought.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Relief {
    NoneDue { none_due_up_to: i64 },
    Allowance(Allowance),
}

/// What a charge is charged on.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Base {
    /// Another charge: its amount (a surcharge on a tax). Absent: a year's pay.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on: Option<String>,
    /// Nothing is due on pay below this, and all of it is charged from there.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<i64>,
    /// Pay beyond this is not charged (a ceiling).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub up_to: Option<i64>,
    /// What is taken off first.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub less: Vec<Deduction>,
}

/// One charge on pay. Amounts are a year's, in the smallest unit of the world's money.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Charge {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base: Option<Base>,
    pub schedule: Vec<Band>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub reliefs: Vec<Relief>,
    /// Whom it is paid to, and into which account.
    #[serde(default)]
    pub collector: String,
    #[serde(default)]
    pub account: String,
    /// The employer's report of it names each worker and their pay (a contribution that builds a record).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub itemised: bool,
}

/// A law taxing pay: its charges, in the order the law lists them, and (`returns`) when each charge is reported and
/// paid over (none: every charge monthly, on the first day of the month after).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IncomeTaxLaw {
    pub id: String,
    pub charges: Vec<Charge>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub returns: Option<Vec<ReturnRule>>,
}

impl IncomeTaxLaw {
    /// The returns this law has, each charge under exactly one.
    pub fn returns_list(&self) -> Vec<ReturnRule> {
        let ids: Vec<&str> = self.charges.iter().map(|c| c.id.as_str()).collect();
        returns_of(Some((&ids, self.returns.as_deref().unwrap_or(&[]))))
    }
}

/// A tax law's terms, from its record's data. `charges` as above (a charge that names no collector is its lawmaker's).
/// A law in the short form (`brackets`, `levy_bps`, `levy_from`, `account`) is read as the two charges it is: marginal
/// rates on a year's pay, and a levy on the whole of a pay from a threshold, both paid into one account.
pub fn tax_law_of(id: &str, data: &Value, lawmaker: Option<&str>) -> Option<IncomeTaxLaw> {
    let data_collector = data.get("collector").and_then(Value::as_str).or(lawmaker).unwrap_or("");
    if let Some(list) = data.get("charges").and_then(Value::as_array) {
        let mut charges = vec![];
        for c in list {
            let mut charge: Charge = serde_json::from_value(c.clone()).ok()?;
            if c.get("collector").is_none() || c["collector"].is_null() {
                charge.collector = data_collector.to_string();
            }
            charges.push(charge);
        }
        let returns = data.get("returns").and_then(return_rules_of).filter(|r| !r.is_empty());
        return Some(IncomeTaxLaw { id: id.to_string(), charges, returns });
    }
    let brackets: Vec<Band> = serde_json::from_value(data.get("brackets")?.clone()).ok()?;
    let account = data.get("account").and_then(Value::as_str).unwrap_or("").to_string();
    let to = |id: &str, base: Option<Base>, schedule: Vec<Band>| Charge {
        id: id.into(),
        name: None,
        base,
        schedule,
        reliefs: vec![],
        collector: data_collector.to_string(),
        account: account.clone(),
        itemised: false,
    };
    let levy_bps = data.get("levy_bps").and_then(Value::as_i64).unwrap_or(0);
    let mut charges = vec![to("income-tax", None, brackets)];
    if levy_bps > 0 {
        let from = data.get("levy_from").and_then(Value::as_i64).unwrap_or(0);
        charges.push(to(
            "levy",
            Some(Base { from: Some(from), ..Default::default() }),
            vec![Band { from: 0, rate_bps: levy_bps, rising_to_bps: None }],
        ));
    }
    Some(IncomeTaxLaw { id: id.to_string(), charges, returns: None })
}

fn floor_div(a: i128, b: i128) -> i128 {
    a.div_euclid(b)
}

fn small(x: i128) -> i64 {
    x.clamp(i128::from(i64::MIN), i128::from(i64::MAX)) as i64
}

fn allowance(a: &Allowance, pay: i64) -> i64 {
    let taper = match &a.tapers {
        Some(t) if pay > t.above => small(floor_div(i128::from(pay - t.above) * i128::from(t.bps), 10_000)),
        _ => 0,
    };
    (a.amount - taper).max(0)
}

/// A schedule's charge on a base (each band rounded down).
fn scheduled(schedule: &[Band], base: i64) -> i64 {
    let mut bands: Vec<&Band> = schedule.iter().collect();
    bands.sort_by_key(|b| b.from); // (stable, as the TS sort is)
    let mut due: i128 = 0;
    for (i, b) in bands.iter().enumerate() {
        let top = bands.get(i + 1).map(|n| n.from);
        if base <= b.from {
            continue;
        }
        let part = i128::from(top.map_or(base, |t| base.min(t)) - b.from);
        match (b.rising_to_bps, top) {
            (Some(rising), Some(top)) => {
                // The marginal rate rises in a straight line across the band: the charge on a part of it is the part
                // at the mean of the rate at the band's start and the rate reached.
                let width = i128::from(top - b.from);
                let rate = i128::from(b.rate_bps);
                due += part * (2 * rate * width + i128::from(rising - b.rate_bps) * part) / (2 * width * 10_000);
            }
            _ => due += floor_div(part * i128::from(b.rate_bps), 10_000),
        }
    }
    small(due)
}

struct Reckoner<'a> {
    law: &'a IncomeTaxLaw,
    pay: i64,
    done: BTreeMap<&'a str, i64>,
    doing: BTreeSet<&'a str>,
}

impl<'a> Reckoner<'a> {
    fn of(&mut self, id: &str) -> i64 {
        if let Some(&x) = self.done.get(id) {
            return x;
        }
        let Some(c) = self.law.charges.iter().find(|x| x.id == id) else { return 0 };
        if self.doing.contains(c.id.as_str()) {
            return 0; // (a charge on itself: nothing)
        }
        self.doing.insert(&c.id);
        let pay = self.pay;
        let empty = Base::default();
        let b = c.base.as_ref().unwrap_or(&empty);
        let mut amount = 0;
        if b.on.is_some() || pay >= b.from.unwrap_or(0) {
            let mut base = match &b.on {
                Some(on) => self.of(on),
                None => pay,
            };
            if let Some(up) = b.up_to {
                base = base.min(up);
            }
            for d in &b.less {
                match d {
                    Deduction::Charges { charges } => {
                        for other in charges {
                            base -= self.of(other);
                        }
                    }
                    Deduction::Share { share_bps, least, most } => {
                        let share = small(floor_div(i128::from(pay) * i128::from(*share_bps), 10_000));
                        base -= share.max(least.unwrap_or(0)).min(most.unwrap_or(i64::MAX));
                    }
                    Deduction::Allowance(a) => base -= allowance(a, pay),
                }
            }
            base = base.max(0);
            amount = scheduled(&c.schedule, base);
            for r in &c.reliefs {
                amount = match r {
                    Relief::NoneDue { none_due_up_to } => {
                        if base <= *none_due_up_to {
                            0
                        } else {
                            amount
                        }
                    }
                    Relief::Allowance(a) => (amount - allowance(a, pay)).max(0),
                };
            }
        }
        self.doing.remove(c.id.as_str());
        self.done.insert(&c.id, amount);
        amount
    }
}

/// What each charge of a law takes of a year's pay (rounded down), in the law's order.
pub fn charges_on(law: &IncomeTaxLaw, pay: i64) -> Vec<(&Charge, i64)> {
    let mut r = Reckoner { law, pay, done: BTreeMap::new(), doing: BTreeSet::new() };
    law.charges.iter().map(|c| (c, r.of(&c.id))).collect()
}

/// Everything a law takes of a year's pay (rounded down, charge by charge).
pub fn annual_tax(law: &IncomeTaxLaw, income: i64) -> i64 {
    charges_on(law, income).iter().map(|(_, a)| a).sum()
}

/// What is withheld from one pay.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Withheld<'a> {
    pub total: i64,
    /// Each charge that takes anything from this pay, in the law's order.
    pub parts: Vec<(&'a Charge, i64)>,
}

/// What's withheld from a pay of `gross` every `period` seconds, charge by charge: the pay reckoned as a year's, the
/// law's charges on that, and a pay period's part. The whole is rounded down once; each charge has its part rounded
/// down, and what that leaves over goes to the first that takes anything. No law: nothing.
/// The one reckoning of it: the opening wage instructions, every employer's payroll, a worker's own check of their pay
/// and a payment reckoned on net pay all call this, and the law's text says the same steps (`withholding_in_words`).
pub fn withheld<'a>(law: Option<&'a IncomeTaxLaw>, gross: i64, period: i64) -> Withheld<'a> {
    let Some(law) = law.filter(|_| gross > 0 && period > 0) else { return Withheld { total: 0, parts: vec![] } };
    let yearly = small(floor_div(i128::from(gross) * i128::from(YEAR), i128::from(period)));
    let year = charges_on(law, yearly);
    let sum: i128 = year.iter().map(|(_, a)| i128::from(*a)).sum();
    let total = small(floor_div(sum * i128::from(period), i128::from(YEAR)));
    let mut parts: Vec<(&Charge, i64, bool)> = year
        .iter()
        .map(|(c, a)| (*c, small(floor_div(i128::from(*a) * i128::from(period), i128::from(YEAR))), *a > 0))
        .collect();
    let taking: i64 = parts.iter().filter(|p| p.2).map(|p| p.1).sum();
    if let Some(first) = parts.iter_mut().find(|p| p.2) {
        first.1 += total - taking;
    }
    Withheld { total, parts: parts.into_iter().filter(|p| p.2 && p.1 > 0).map(|p| (p.0, p.1)).collect() }
}

/// What's withheld from a pay of `gross` every `period` seconds, in all (rounded down). No law: nothing.
pub fn withholding(law: Option<&IncomeTaxLaw>, gross: i64, period: i64) -> i64 {
    withheld(law, gross, period).total
}

/// The span a day's pay is reckoned over, for what the law takes from it: a day's pay is pay for a working day, so a
/// year's is the working days of a year of it (the week over its working days), not every day of the year.
pub fn day_pay_period(work_days_a_week: i64) -> i64 {
    // (TS: Math.round(7 * 86400 / min(7, max(1, n))); the quotient is exact for 1 to 7 days.)
    let n = work_days_a_week.clamp(1, 7);
    (7 * DAY * 2 + n) / (2 * n)
}

/// A number of ten-thousandths as JavaScript prints `Number(x.toFixed(4))`: trailing zeros dropped.
fn decimal4(scaled: i64) -> String {
    let (whole, frac) = (scaled / 10_000, scaled % 10_000);
    if frac == 0 {
        return whole.to_string();
    }
    let f = format!("{frac:04}");
    format!("{whole}.{}", f.trim_end_matches('0'))
}

/// The rule `withheld` reckons by, in the words a tax law gives it, so that whoever works a pay's withholding out by
/// hand from the law comes to the figure every payroll comes to. It is said step by step, with each rounding, because
/// the step people take from habit is another one: a year as a whole number of pays (26 pays of 14 days), where the
/// world's year is 365 days and a pay is its days' share of it (wave 2a, 2026-10-09). `period_days`: the pay period
/// the words give as their example; `work_days`: the working days of a week, where pay by the day is reckoned.
pub fn withholding_in_words(period_days: i64, work_days: Option<i64>) -> String {
    let d = period_days;
    let days = |n: i64| format!("{n} day{}", if n == 1 { "" } else { "s" });
    let per_day = work_days.map(|w| {
        let p = day_pay_period(w);
        decimal4((p * 10_000 * 2 + DAY) / (2 * DAY))
    });
    let mut parts = vec![
        "Employers withhold each from every pay. What is withheld from a pay is reckoned in three steps, and in no other way.".to_string(),
        format!("One: the pay is taken as a year's pay, by multiplying it by 365 and dividing by the number of days the pay is for, rounded down to the smallest unit of money. (A year is 365 days: a pay for {} is {d}/365 of a year's pay, and a year is not taken as a whole number of pays.)", days(d)),
        "Two: each charge is reckoned on that year's pay as set out above, each band's part rounded down.".to_string(),
        "Three: the year's charges are added together, and that sum, multiplied by the number of days the pay is for and divided by 365, rounded down, is what is withheld from the pay.".to_string(),
        "Of what is withheld, each charge's part is its own year's amount multiplied and divided the same way, rounded down, and what that leaves over goes with the first charge that takes anything.".to_string(),
    ];
    if let (Some(p), Some(w)) = (per_day, work_days) {
        parts.push(format!("Pay for a day's work is taken as pay for {p} days: a week over its {w} working days."));
    }
    parts.join(" ")
}

/// A percentage of basis points as JavaScript prints bps / 100 with a percent sign.
fn pct(bps: i64) -> String {
    let (whole, frac) = (bps / 100, bps % 100);
    if frac == 0 {
        format!("{whole}%")
    } else if frac % 10 == 0 {
        format!("{whole}.{}%", frac / 10)
    } else {
        format!("{whole}.{frac:02}%")
    }
}

/// A law's charges in words, for the law's own text and for an office's report: each with what it is charged on, its
/// rates, its reliefs and where it is paid. `written` words a sum of money as the world writes it; `payee`, whom a
/// charge is paid to.
pub fn charges_in_words(charges: &[Charge], written: &dyn Fn(i64) -> String, payee: &dyn Fn(&Charge) -> String) -> String {
    let name_of = |id: &str| charges.iter().find(|x| x.id == id).map(|x| x.name.clone().unwrap_or_else(|| x.id.clone())).unwrap_or_else(|| id.to_string());
    charges
        .iter()
        .map(|c| {
            let empty = Base::default();
            let b = c.base.as_ref().unwrap_or(&empty);
            let on = match &b.on {
                Some(o) => format!("on the {} due", name_of(o)),
                None => "on a year's pay".to_string(),
            };
            let less: Vec<String> = b
                .less
                .iter()
                .map(|d| match d {
                    Deduction::Charges { charges: ids } => {
                        format!("less what is paid as {}", ids.iter().map(|i| name_of(i)).collect::<Vec<_>>().join(", "))
                    }
                    Deduction::Share { share_bps, least, most } => format!(
                        "less {} of it{}{}",
                        pct(*share_bps),
                        least.map_or(String::new(), |l| format!(", at least {}", written(l))),
                        most.map_or(String::new(), |m| format!(", at most {}", written(m)))
                    ),
                    Deduction::Allowance(a) => format!(
                        "less {}{}",
                        written(a.amount),
                        a.tapers.as_ref().map_or(String::new(), |t| format!(" (reduced by {} of pay above {})", pct(t.bps), written(t.above)))
                    ),
                })
                .collect();
            let mut bands: Vec<&Band> = c.schedule.iter().collect();
            bands.sort_by_key(|x| x.from);
            let rates = if bands.len() == 1 && bands[0].from == 0 && bands[0].rising_to_bps.is_none() {
                pct(bands[0].rate_bps)
            } else {
                bands
                    .iter()
                    .enumerate()
                    .map(|(i, s)| {
                        let rate = format!("{}{}", pct(s.rate_bps), s.rising_to_bps.map_or(String::new(), |r| format!(" rising to {}", pct(r))));
                        if s.from > 0 {
                            return format!("{rate} above {}", written(s.from));
                        }
                        // (The first band is said by where it ends, "nothing up to" or "so much up to".)
                        match bands.get(i + 1) {
                            Some(next) => format!(
                                "{} up to {}",
                                if s.rate_bps == 0 && s.rising_to_bps.is_none() { "nothing".to_string() } else { rate },
                                written(next.from)
                            ),
                            None => rate,
                        }
                    })
                    .collect::<Vec<_>>()
                    .join(", ")
            };
            let reliefs: Vec<String> = c
                .reliefs
                .iter()
                .map(|r| match r {
                    Relief::NoneDue { none_due_up_to } => format!("none due where that is {} or less", written(*none_due_up_to)),
                    Relief::Allowance(a) => format!(
                        "less {} of the charge{}",
                        written(a.amount),
                        a.tapers.as_ref().map_or(String::new(), |t| format!(" (reduced by {} of pay above {})", pct(t.bps), written(t.above)))
                    ),
                })
                .collect();
            let mut head = vec![on];
            if b.from.is_some_and(|f| f != 0) {
                head.push(format!("from {}", written(b.from.unwrap())));
            }
            if let Some(u) = b.up_to {
                head.push(format!("up to {}", written(u)));
            }
            head.extend(less);
            format!(
                "{}: {}: {rates}{}; paid to {}{}",
                c.name.as_deref().unwrap_or(&c.id),
                head.join(", "),
                if reliefs.is_empty() { String::new() } else { format!("; {}", reliefs.join("; ")) },
                payee(c),
                if c.itemised { ", reported worker by worker" } else { "" }
            )
        })
        .collect::<Vec<_>>()
        .join(". ")
}

/// What the law says of the returns: which charges are reported together, how often, and the day each is due.
pub fn returns_in_words(law: &IncomeTaxLaw) -> String {
    let rules = law.returns_list();
    let name = |id: &str| law.charges.iter().find(|c| c.id == id).map(|c| c.name.clone().unwrap_or_else(|| c.id.clone())).unwrap_or_else(|| id.to_string());
    let each: Vec<String> = rules
        .iter()
        .map(|r| {
            let r2 = if r.id == "return-rest" { ReturnRule { name: Some("Return of tax withheld from wages".into()), ..r.clone() } } else { r.clone() };
            let charges = r.charges.as_deref().unwrap_or(&[]).iter().map(|c| name(c)).collect::<Vec<_>>().join(", ");
            return_rule_in_words(&r2, &charges)
        })
        .collect();
    format!(
        "Employers report what they withheld, and pay it over with the report, in {}: {}. {MONTH_WORDS}",
        if rules.len() == 1 { "this return" } else { "these returns" },
        each.join("; ")
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn law(charges: Value) -> IncomeTaxLaw {
        tax_law_of("l", &json!({ "charges": charges }), Some("o")).unwrap()
    }
    fn to() -> Value {
        json!({ "collector": "o", "account": "a" })
    }
    fn with(mut c: Value) -> Value {
        for (k, v) in to().as_object().unwrap() {
            c[k] = v.clone();
        }
        c
    }
    fn of(l: &IncomeTaxLaw, pay: i64) -> BTreeMap<String, i64> {
        charges_on(l, pay).into_iter().map(|(c, a)| (c.id.clone(), a)).collect()
    }
    fn map(pairs: &[(&str, i64)]) -> BTreeMap<String, i64> {
        pairs.iter().map(|(k, v)| (k.to_string(), *v)).collect()
    }

    #[test]
    fn the_shared_cases_equal_the_ts_answers() {
        let file: Value = serde_json::from_str(include_str!("../../../../contracts/test/withholding.json")).unwrap();
        let cases = file["cases"].as_array().unwrap();
        assert!(cases.len() >= 10);
        for c in cases {
            let l = tax_law_of("l", &c["law"], Some("outside")).unwrap();
            for (gross, period, total, parts) in c["pays"].as_array().unwrap().iter().map(|p| (p["gross"].as_i64().unwrap(), p["period"].as_i64().unwrap(), p["total"].as_i64().unwrap(), &p["parts"])) {
                let w = withheld(Some(&l), gross, period);
                let got: Vec<Value> = w.parts.iter().map(|(c, a)| json!([c.id, a])).collect();
                assert_eq!((w.total, Value::Array(got)), (total, parts.clone()), "{} gross {gross} over {period}", c["name"]);
            }
            for (pay, amounts) in c["annual"].as_array().unwrap().iter().map(|p| (p["pay"].as_i64().unwrap(), &p["charges"])) {
                let got: Vec<Value> = charges_on(&l, pay).iter().map(|(c, a)| json!([c.id, a])).collect();
                assert_eq!(Value::Array(got), *amounts, "{} annual on {pay}", c["name"]);
            }
        }
    }

    /// The law in its short form, as it was reckoned before a law was a list of charges.
    fn short_form(brackets: &[(i64, i64)], levy_bps: i64, levy_from: i64, income: i64) -> i64 {
        let mut tax = 0;
        for (i, (from, rate)) in brackets.iter().enumerate() {
            let top = brackets.get(i + 1).map_or(i64::MAX, |b| b.0);
            if income > *from {
                tax += (income.min(top) - from) * rate / 10_000;
            }
        }
        if income >= levy_from {
            tax += income * levy_bps / 10_000;
        }
        tax
    }

    #[test]
    fn a_law_in_the_short_form_is_two_charges_and_comes_to_the_same_sums() {
        let forms: [(&[(i64, i64)], i64, i64); 3] = [
            (&[(0, 0), (1_000_000, 2000), (5_000_000, 4000)], 100, 2_000_000),
            (&[(0, 192), (1_013_512, 640), (8_602_213, 1088)], 0, 0),
            (&[(0, 0), (1_234_901, 1933), (6_987_901, 4200)], 2115, 723_601),
        ];
        for (b, levy, levy_from) in forms {
            let data = json!({ "brackets": b.iter().map(|(f, r)| json!({ "from": f, "rate_bps": r })).collect::<Vec<_>>(), "levy_bps": levy, "levy_from": levy_from, "collector": "o", "account": "a" });
            let l = tax_law_of("l", &data, None).unwrap();
            assert_eq!(l.charges.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(), if levy > 0 { vec!["income-tax", "levy"] } else { vec!["income-tax"] });
            let mut income = 0;
            while income < 30_000_000 {
                assert_eq!(annual_tax(&l, income), short_form(b, levy, levy_from, income));
                income += 97_301;
            }
            for gross in [0, 1, 77_777, 211_356, 300_000, 999_999] {
                for days in [7, 14, 30] {
                    let w = withheld(Some(&l), gross, days * DAY);
                    let yearly = gross * 365 / days;
                    assert_eq!(w.total, if gross > 0 { short_form(b, levy, levy_from, yearly) * days / 365 } else { 0 });
                    assert_eq!(w.parts.iter().map(|p| p.1).sum::<i64>(), w.total);
                }
            }
        }
        assert!(tax_law_of("l", &json!({ "rate_ppm": 4 }), None).is_none());
        assert_eq!(withholding(None, 100_000, 14 * DAY), 0);
    }

    #[test]
    fn a_charges_base_allowance_ceiling_threshold() {
        let l = law(json!([
            with(json!({ "id": "tax", "base": { "less": [{ "amount": 1_000_000, "tapers": { "above": 8_000_000, "bps": 5000 } }] }, "schedule": [{ "from": 0, "rate_bps": 2000 }, { "from": 3_000_000, "rate_bps": 4000 }] })),
            with(json!({ "id": "fund", "base": { "up_to": 5_000_000 }, "schedule": [{ "from": 0, "rate_bps": 600 }] })),
            with(json!({ "id": "levy", "base": { "from": 2_000_000 }, "schedule": [{ "from": 0, "rate_bps": 100 }] })),
        ]));
        assert_eq!(of(&l, 900_000), map(&[("tax", 0), ("fund", 54_000), ("levy", 0)]));
        assert_eq!(of(&l, 2_000_000), map(&[("tax", 200_000), ("fund", 120_000), ("levy", 20_000)]));
        assert_eq!(of(&l, 6_000_000), map(&[("tax", 600_000 + 800_000), ("fund", 300_000), ("levy", 60_000)]));
        assert_eq!(of(&l, 9_000_000)["tax"], 600_000 + (9_000_000 - 500_000 - 3_000_000) * 4 / 10);
        assert_eq!(of(&l, 10_000_000)["tax"], 600_000 + 7_000_000 * 4 / 10);
        assert_eq!(of(&l, 12_000_000)["tax"], 600_000 + 9_000_000 * 4 / 10);
    }

    #[test]
    fn deductions_reliefs_and_surcharges() {
        let l = law(json!([
            with(json!({ "id": "fund", "schedule": [{ "from": 0, "rate_bps": 1000 }] })),
            with(json!({ "id": "tax", "base": { "less": [{ "share_bps": 3000, "least": 500_000, "most": 1_500_000 }, { "charges": ["fund"] }] }, "schedule": [{ "from": 0, "rate_bps": 1000 }] })),
        ]));
        assert_eq!(of(&l, 1_000_000)["tax"], (1_000_000 - 500_000 - 100_000) / 10);
        assert_eq!(of(&l, 3_000_000)["tax"], (3_000_000 - 900_000 - 300_000) / 10);
        assert_eq!(of(&l, 9_000_000)["tax"], (9_000_000 - 1_500_000 - 900_000) / 10);
        assert_eq!(of(&l, 400_000)["tax"], 0, "never below nought");
        let l = law(json!([
            with(json!({ "id": "tax", "name": "Income tax", "schedule": [{ "from": 0, "rate_bps": 1000 }, { "from": 2_000_000, "rate_bps": 2500 }], "reliefs": [{ "amount": 200_000 }] })),
            with(json!({ "id": "cess", "base": { "on": "tax" }, "schedule": [{ "from": 0, "rate_bps": 400 }] })),
            with(json!({ "id": "other", "schedule": [{ "from": 0, "rate_bps": 500 }, { "from": 1_000_000, "rate_bps": 1000 }], "reliefs": [{ "none_due_up_to": 3_000_000 }] })),
        ]));
        assert_eq!(of(&l, 1_500_000), map(&[("tax", 0), ("cess", 0), ("other", 0)]));
        assert_eq!(of(&l, 2_000_000), map(&[("tax", 0), ("cess", 0), ("other", 0)]));
        assert_eq!(of(&l, 3_000_000), map(&[("tax", 250_000), ("cess", 10_000), ("other", 0)]));
        assert_eq!(of(&l, 3_000_001)["other"], 50_000 + 200_000);
        assert!(charges_in_words(&l.charges, &|n| n.to_string(), &|c| c.account.clone()).contains("cess: on the Income tax due: 4%; paid to a"));
    }

    #[test]
    fn a_charge_on_itself_or_on_a_missing_charge_is_nothing() {
        let l = law(json!([with(json!({ "id": "a", "base": { "on": "a" }, "schedule": [{ "from": 0, "rate_bps": 1000 }] })), with(json!({ "id": "b", "base": { "on": "zzz" }, "schedule": [{ "from": 0, "rate_bps": 1000 }] }))]));
        assert_eq!(of(&l, 1_000_000), map(&[("a", 0), ("b", 0)]));
    }

    #[test]
    fn a_band_whose_rate_rises_in_a_straight_line() {
        let l = law(json!([with(json!({ "id": "tax", "schedule": [
            { "from": 0, "rate_bps": 0 }, { "from": 1_000_000, "rate_bps": 1400, "rising_to_bps": 2400 },
            { "from": 2_000_000, "rate_bps": 2400, "rising_to_bps": 4200 }, { "from": 6_000_000, "rate_bps": 4200 }] }))]));
        assert_eq!(annual_tax(&l, 1_000_000), 0);
        // x * (0.14 + (0.14 + 0.1 x / 1e6)) / 2 for x = 500,000
        assert_eq!(annual_tax(&l, 1_500_000), 500_000 * (14 + 14 + 5) / 200);
        assert_eq!(annual_tax(&l, 2_000_000), 190_000);
        assert_eq!(annual_tax(&l, 4_000_000), 190_000 + 2_000_000 * (24 + 33) / 200);
        assert_eq!(annual_tax(&l, 6_000_000), 190_000 + 1_320_000);
        assert_eq!(annual_tax(&l, 7_000_000), 190_000 + 1_320_000 + 420_000);
        let mut last = 0;
        let mut pay = 0;
        while pay <= 8_000_000 {
            let now = annual_tax(&l, pay);
            assert!(now >= last);
            assert!(now - last <= 12_345 * 42 / 100 + 2);
            last = now;
            pay += 12_345;
        }
    }

    #[test]
    fn what_is_withheld_is_what_the_three_steps_give_worked_by_hand() {
        let l = law(json!([
            with(json!({ "id": "tax", "schedule": [{ "from": 0, "rate_bps": 0 }, { "from": 1_000_000, "rate_bps": 1000 }, { "from": 3_000_000, "rate_bps": 2000 }] })),
            with(json!({ "id": "levy", "schedule": [{ "from": 0, "rate_bps": 500 }] })),
        ]));
        let (gross, days) = (236_000i64, 14i64);
        let yearly = gross * 365 / days;
        assert_eq!(yearly, 6_152_857);
        let tax = (3_000_000 - 1_000_000) * 10 / 100 + (yearly - 3_000_000) * 20 / 100;
        let levy = yearly * 5 / 100;
        assert_eq!((tax, levy), (830_571, 307_642));
        let by_hand = (tax + levy) * days / 365;
        assert_eq!(by_hand, 43_657);
        let w = withheld(Some(&l), gross, days * DAY);
        assert_eq!(w.total, by_hand);
        let parts = [tax * days / 365, levy * days / 365];
        assert_eq!(w.parts.iter().map(|p| p.1).collect::<Vec<_>>(), [parts[0] + (by_hand - parts[0] - parts[1]), parts[1]]);
        assert_eq!(day_pay_period(5), 120_960);
        let p = day_pay_period(5);
        assert_eq!(withheld(Some(&l), 23_600, p).total, annual_tax(&l, 23_600 * 365 * DAY / p) * p / (365 * DAY));
        let words = withholding_in_words(days, Some(5));
        for said in [
            "What is withheld from a pay is reckoned in three steps, and in no other way.",
            "a pay for 14 days is 14/365 of a year's pay, and a year is not taken as a whole number of pays.",
            "Three: the year's charges are added together, and that sum, multiplied by the number of days the pay is for and divided by 365, rounded down, is what is withheld from the pay.",
            "Pay for a day's work is taken as pay for 1.4 days: a week over its 5 working days.",
        ] {
            assert!(words.contains(said), "{said}");
        }
        assert!(withholding_in_words(30, None).contains("a pay for 30 days is 30/365 of a year's pay"));
        assert!(!withholding_in_words(30, None).contains("a day's work"));
        assert!(withholding_in_words(1, None).contains("a pay for 1 day is 1/365"));
        assert!(withholding_in_words(14, Some(6)).contains("1.1667 days"));
    }

    #[test]
    fn money_in_percentages_and_the_laws_words() {
        assert_eq!((pct(2000), pct(1910), pct(1933), pct(5)), ("20%".into(), "19.1%".into(), "19.33%".into(), "0.05%".into()));
        let l = tax_law_of("l", &json!({ "charges": [{ "id": "a", "name": "Income tax", "schedule": [{ "from": 0, "rate_bps": 0 }, { "from": 1000, "rate_bps": 1000 }], "account": "x", "collector": "o" }], "returns": [{ "id": "r", "day": 9, "charges": ["a"] }] }), None).unwrap();
        assert!(returns_in_words(&l).starts_with("Employers report what they withheld, and pay it over with the report, in this return: r: Income tax reported"));
        assert_eq!(
            charges_in_words(&l.charges, &|n| format!("${n}"), &|c| c.account.clone()),
            "Income tax: on a year's pay: nothing up to $1000, 10% above $1000; paid to x"
        );
    }
}
