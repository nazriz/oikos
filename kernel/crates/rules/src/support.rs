//! Support payments, as the law that sets them out, the office that pays them and a claimant read them
//! (participants/src/behaviour/payments.ts and the sums of `world.transfers` in world.ts; docs/behaviour/boundary.md,
//! "world.transfers"). A payment is a rule in three parts: who qualifies, how much, for how long. The law is a record
//! its lawmaker publishes; nothing here holds any place's figures.
//!
//! Pure and integer: the paying office (lane C2's `world.transfers`), the claimant (A1) and the generator (through the
//! N-API module) all call this one reckoning, `decide`, which is `world.transfers`'s `decide` without its book: what
//! the office read off its own file (the pay reported for the claimant, whether it pays them another pension) is handed
//! in. Cases held to the TS: `contracts/test/support.json`.

use crate::calendar::Calendar;
use crate::withholding::{withholding, IncomeTaxLaw};
use serde::{Deserialize, Serialize};

const DAY: i64 = 86_400;
const MONTH: i64 = 30 * DAY;
/// A year, as the world counts one without a calendar (365 days).
pub const YEAR: i64 = 365 * DAY;

/// One payment of a support law. Sums are in the smallest unit of the world's money, for one payment (every
/// `every_days`), unless said otherwise.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PaymentRule {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Who pays (an entity); the law's lawmaker where it names none (`support_law` fills it in).
    #[serde(default)]
    pub payer: String,
    /// And from which account.
    #[serde(default)]
    pub account: String,
    pub every_days: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub who: Option<Who>,
    pub amount: Amount,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lasts: Option<Lasts>,
}

/// Who qualifies (everything listed must hold).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Who {
    /// The claimant's age in years, both inclusive.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from_age: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to_age: Option<i64>,
    /// It is for someone without work who is looking for it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub out_of_work: Option<bool>,
    /// Contributions reported for the claimant to the payer: in at least `months` reports (one, if not said), within
    /// the last `within_months` (any time, if not said).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub record: Option<RecordNeeded>,
    /// The household's income for a month, as the claimant declares it, is under `amount`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub income_under: Option<IncomeUnder>,
    /// The claimant declares that nobody else pays them a pension, and the payer pays them no other payment for age.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub no_other_pension: Option<bool>,
    /// At least `least` children under `under_age` in the household, as declared.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub children: Option<Children>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecordNeeded {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub months: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub within_months: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Per {
    Household,
    Head,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IncomeUnder {
    pub amount: i64,
    pub per: Per,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Children {
    pub least: i64,
    pub under_age: i64,
}

/// How much one payment is.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Amount {
    /// The same sum for everyone.
    Flat { flat: i64 },
    /// `share_bps` of the claimant's previous pay for the same length of time (`of`: before or after what the tax law
    /// withholds), from the contributions record, no less than `least` and no more than `most` (one sum, or by age);
    /// `with_child_bps`: the share for a claimant who declares a child under 18 in the household.
    Share {
        share_bps: i64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        with_child_bps: Option<i64>,
        #[serde(default)]
        of: Of,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        least: Option<i64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        most: Option<Most>,
    },
    /// A sum for the household, with `per_member` for each of its members and `per_child` for each child under an
    /// age. One claim a household, by its head.
    Household {
        household: i64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        per_member: Option<i64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        per_child: Option<PerChild>,
    },
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Of {
    #[default]
    Gross,
    Net,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Most {
    One(i64),
    ByAge(Vec<AgeSum>),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgeSum {
    pub from_age: i64,
    pub amount: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PerChild {
    pub under_age: i64,
    pub amount: i64,
}

/// For how long (not given: for as long as the claimant qualifies and claims): `days` from the day it is granted;
/// `until_age`: until the claimant reaches that age; `then`: the payment of this law that may be claimed when it ends.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Lasts {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub days: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub until_age: Option<i64>,
    #[serde(default, rename = "then", skip_serializing_if = "Option::is_none")]
    pub then: Option<String>,
}

/// What a claimant declares on a claim, where the payment's rule asks: taken as stated by the office.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Declared {
    /// The household's income for a month, and how many live in it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub household_income: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub household_members: Option<i64>,
    /// The dates of birth of the household's children.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub children_born_at: Option<Vec<i64>>,
    /// Whether anyone else pays the claimant a pension.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub other_pension: Option<bool>,
}

impl Declared {
    pub fn is_empty(&self) -> bool {
        *self == Declared::default()
    }
}

/// A payment for those out of work (a stopgap while looking), as against one for age or for a household.
pub fn for_out_of_work(r: &PaymentRule) -> bool {
    r.who.as_ref().and_then(|w| w.out_of_work) == Some(true)
}
/// A payment made to a household, claimed by its head.
pub fn for_household(r: &PaymentRule) -> bool {
    matches!(r.amount, Amount::Household { .. })
}
/// A payment for age: a pension.
pub fn for_age(r: &PaymentRule) -> bool {
    !for_out_of_work(r) && !for_household(r) && r.who.as_ref().is_some_and(|w| w.from_age.is_some())
}

/// What a claimant knows to declare, from their circumstances.
#[derive(Debug, Clone, Default)]
pub struct Facts {
    pub household_income: i64,
    pub household_members: i64,
    pub children_born_at: Vec<i64>,
    pub other_pension: bool,
}

/// What a claim for this payment must declare (nothing: the rule asks for no declaration).
pub fn declaration_for(r: &PaymentRule, facts: &Facts) -> Option<Declared> {
    let mut d = Declared::default();
    if r.who.as_ref().is_some_and(|w| w.income_under.is_some()) {
        d.household_income = Some(facts.household_income);
        d.household_members = Some(facts.household_members);
    }
    if for_household(r) {
        d.household_members = Some(facts.household_members);
    }
    let asks_children = r.who.as_ref().is_some_and(|w| w.children.is_some())
        || matches!(&r.amount, Amount::Household { per_child: Some(_), .. })
        || matches!(&r.amount, Amount::Share { with_child_bps: Some(_), .. });
    if asks_children {
        d.children_born_at = Some(facts.children_born_at.clone());
    }
    if r.who.as_ref().and_then(|w| w.no_other_pension) == Some(true) {
        d.other_pension = Some(facts.other_pension);
    }
    (!d.is_empty()).then_some(d)
}

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

/// A sum for one payment in words a law's text can carry. `written` words a sum as the world writes it; `payer`,
/// who pays (default: the payer from the account).
pub fn payments_in_words(payments: &[PaymentRule], written: &dyn Fn(i64) -> String, payer: &dyn Fn(&PaymentRule) -> String) -> String {
    payments
        .iter()
        .map(|r| {
            let empty = Who::default();
            let w = r.who.as_ref().unwrap_or(&empty);
            let age = match (w.from_age, w.to_age) {
                (Some(f), Some(t)) => format!("aged {f} to {t}"),
                (Some(f), None) => format!("aged {f} or over"),
                (None, Some(t)) => format!("aged {t} or under"),
                _ => String::new(),
            };
            let plural = |n: i64, one: &str, many: &str| if n == 1 { one.to_string() } else { many.to_string() };
            let who = [
                age,
                if w.out_of_work == Some(true) { "out of work and looking for it".to_string() } else { String::new() },
                w.record.as_ref().map_or(String::new(), |rec| {
                    let m = rec.months.unwrap_or(1);
                    format!(
                        "with contributions reported for them in at least {m} month{}{}",
                        plural(m, "", "s"),
                        rec.within_months.filter(|x| *x != 0).map_or(String::new(), |x| format!(" of the last {x}"))
                    )
                }),
                w.income_under.as_ref().map_or(String::new(), |i| {
                    format!("whose household's income for a month is under {}{}", written(i.amount), if i.per == Per::Head { " a head" } else { "" })
                }),
                if w.no_other_pension == Some(true) { "paid no other pension".to_string() } else { String::new() },
                w.children.as_ref().map_or(String::new(), |c| {
                    format!("with at least {} {} under {} in the household", c.least, plural(c.least, "child", "children"), c.under_age)
                }),
            ]
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join(", ");
            let much = match &r.amount {
                Amount::Flat { flat } => written(*flat),
                Amount::Share { share_bps, with_child_bps, of, least, most } => format!(
                    "{}{} of their previous pay{}{}{}",
                    pct(*share_bps),
                    with_child_bps.map_or(String::new(), |c| format!(" ({} with a child)", pct(c))),
                    if *of == Of::Net { " after what is withheld from it" } else { "" },
                    least.map_or(String::new(), |l| format!(", at least {}", written(l))),
                    match most {
                        None => String::new(),
                        Some(Most::One(m)) => format!(", at most {}", written(*m)),
                        Some(Most::ByAge(list)) => format!(
                            ", at most {}",
                            list.iter().map(|m| format!("{} from age {}", written(m.amount), m.from_age)).collect::<Vec<_>>().join(", ")
                        ),
                    }
                ),
                Amount::Household { household, per_member, per_child } => format!(
                    "{} a household{}{}",
                    written(*household),
                    per_member.filter(|p| *p != 0).map_or(String::new(), |p| format!(", and {} for each member", written(p))),
                    per_child.as_ref().map_or(String::new(), |c| format!(", and {} for each child under {}", written(c.amount), c.under_age))
                ),
            };
            let long = r.lasts.as_ref().map_or(String::new(), |l| {
                [
                    l.days.map_or(String::new(), |d| format!("for {d} days")),
                    l.until_age.map_or(String::new(), |a| format!("until the age of {a}")),
                    l.then.as_ref().map_or(String::new(), |t| {
                        let name = payments.iter().find(|x| &x.id == t).map_or_else(|| t.clone(), |x| x.name.clone().unwrap_or_else(|| x.id.clone()));
                        format!("after which {name} may be claimed")
                    }),
                ]
                .into_iter()
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join(", ")
            });
            format!(
                "{}: to a person {}, {much} every {} days{}; paid by {}",
                r.name.as_deref().unwrap_or(&r.id),
                if who.is_empty() { "who claims it".to_string() } else { who },
                r.every_days,
                if long.is_empty() { String::new() } else { format!(", {long}") },
                payer(r)
            )
        })
        .collect::<Vec<_>>()
        .join(". ")
}

/// The default payer in a payment's words.
pub fn payer_words(r: &PaymentRule) -> String {
    format!("{} from {}", r.payer, r.account)
}

/// The age, in whole years, of someone born at `born_at`, at `t`.
pub fn age_in(born_at: i64, t: i64, year: i64) -> i64 {
    (t - born_at).div_euclid(year)
}

/// The age at which someone in the labour force stops work, from the share of people in the labour force by age
/// (`curve`: bands as `(from, bps)` in order of age, the first the reference; docs/behaviour/citizen.md, "Stopping
/// work"). Of those in the labour force in the reference band, the share still in it in a later band is that band's
/// share over the reference's; a person is given one number (`draw`, of 10,000) and stops at the start of the first
/// band whose share of the reference is at or below it. `None`: never, by this curve.
pub fn stops_work_at(curve: &[(i64, i64)], draw: i64) -> Option<i64> {
    let base = curve.first().map_or(0, |b| b.1);
    if base <= 0 {
        return curve.first().map(|b| b.0);
    }
    let mut kept = 10_000;
    for (from, bps) in &curve[1..] {
        // (A share that rises again with age brings nobody back: the share kept only falls.)
        kept = kept.min(bps * 10_000 / base);
        if draw >= kept {
            return Some(*from);
        }
    }
    None
}

/// Where the record of contributions a rule asks about starts, for the office to select the reports it hands to
/// `decide`: reports made at or after this moment count. No window: from the beginning of time.
pub fn record_since(rule: &PaymentRule, t: i64, cal: Option<&Calendar>) -> i64 {
    match rule.who.as_ref().and_then(|w| w.record.as_ref()).and_then(|r| r.within_months).filter(|m| *m != 0) {
        None => i64::MIN,
        Some(m) => match cal {
            Some(c) => c.months_after(t, -m),
            None => t - m * MONTH,
        },
    }
}

/// Whether deciding a claim under this rule reads the claimant's record of contributions.
pub fn reads_record(rule: &PaymentRule) -> bool {
    rule.who.as_ref().is_some_and(|w| w.record.is_some()) || matches!(rule.amount, Amount::Share { .. })
}

/// What the office has on its own file about a claimant, and what they stated.
#[derive(Debug, Clone, Default)]
pub struct Claimant {
    pub born_at: i64,
    pub declared: Declared,
    /// The monthly pay employers reported for them, newest first, from `record_since` on (`reads_record` rules only).
    pub reports: Vec<i64>,
    /// Whether the office pays them another payment for age than this one.
    pub paid_another_pension: bool,
}

/// Why a claim is refused. Most carry what the office says; `Silent` is a refusal with no reason given.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Refusal {
    /// Outside the ages (or no such rule): refused without a reason.
    Silent,
    Record { have: i64, asked: i64 },
    IncomeNotStated,
    IncomeNotUnder { amount: i64, per: Per },
    PensionNotStated,
    PaidAnotherPension,
    Children { least: i64, under_age: i64 },
    NoPay,
    Nothing,
}

impl Refusal {
    /// The reason in words (as the office writes it), if there is one.
    pub fn why(&self, written: &dyn Fn(i64) -> String) -> Option<String> {
        let s = |n: i64| if n == 1 { "" } else { "s" };
        Some(match self {
            Refusal::Silent => return None,
            Refusal::Record { have, asked } => format!("contributions are on our record for {have} month{}, and the payment asks for {asked}", s(*have)),
            Refusal::IncomeNotStated => "the claim doesn't state the household's income".into(),
            Refusal::IncomeNotUnder { amount, per } => {
                format!("the household's income as stated is not under {}{}", written(*amount), if *per == Per::Head { " a head" } else { "" })
            }
            Refusal::PensionNotStated => "the claim doesn't state that no other pension is paid".into(),
            Refusal::PaidAnotherPension => "we pay the claimant another pension".into(),
            Refusal::Children { least, under_age } => {
                format!("the household as stated has fewer than {least} child{} under {under_age}", if *least == 1 { "" } else { "ren" })
            }
            Refusal::NoPay => "no pay is on our record for the claimant".into(),
            Refusal::Nothing => "the payment comes to nothing".into(),
        })
    }
}

/// A claim granted: the sum of each payment and when it ends (`None`: when the claimant stops qualifying).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Granted {
    pub amount: i64,
    pub until: Option<i64>,
}

/// A claim under a rule at `t`: granted (with the sum and how long), or why not. `year`: the world's year in seconds
/// (a claimant's age is whole years of it); `tax`: the law in force, for a payment on net pay. Equal to `world.transfers`'s
/// `decide`, except that a share of previous pay is reckoned exactly (the mean of the reports times the payment's days
/// over 30, rounded down once; the TS divided and multiplied in floating point).
pub fn decide(rule: &PaymentRule, who: &Claimant, t: i64, year: i64, tax: Option<&IncomeTaxLaw>) -> Result<Granted, Refusal> {
    let age = age_in(who.born_at, t, year);
    let empty = Who::default();
    let w = rule.who.as_ref().unwrap_or(&empty);
    if w.from_age.is_some_and(|f| age < f) || w.to_age.is_some_and(|x| age > x) {
        return Err(Refusal::Silent);
    }
    let said = &who.declared;
    let members = said.household_members.unwrap_or(1).max(1);
    let children = |under: i64| said.children_born_at.as_deref().unwrap_or(&[]).iter().filter(|b| age_in(**b, t, year) < under).count() as i64;
    let record = if reads_record(rule) { who.reports.as_slice() } else { &[] };
    if let Some(rec) = &w.record {
        let asked = rec.months.unwrap_or(1);
        if (record.len() as i64) < asked {
            return Err(Refusal::Record { have: record.len() as i64, asked });
        }
    }
    if let Some(inc) = &w.income_under {
        let Some(income) = said.household_income else { return Err(Refusal::IncomeNotStated) };
        let each = if inc.per == Per::Head { income.div_euclid(members) } else { income };
        if each >= inc.amount {
            return Err(Refusal::IncomeNotUnder { amount: inc.amount, per: inc.per });
        }
    }
    if w.no_other_pension == Some(true) {
        if said.other_pension != Some(false) {
            return Err(Refusal::PensionNotStated);
        }
        if who.paid_another_pension {
            return Err(Refusal::PaidAnotherPension);
        }
    }
    if let Some(c) = &w.children {
        if children(c.under_age) < c.least {
            return Err(Refusal::Children { least: c.least, under_age: c.under_age });
        }
    }
    let amount = match &rule.amount {
        Amount::Flat { flat } => *flat,
        Amount::Share { share_bps, with_child_bps, of, least, most } => {
            // Their previous pay for as long as one payment covers: the mean of the monthly pay reported for them (the
            // last twelve reports at most), before or after what the tax law withholds from such a pay.
            let last = &record[..record.len().min(12)];
            if last.is_empty() {
                return Err(Refusal::NoPay);
            }
            let sum: i128 = last.iter().map(|g| i128::from(*g)).sum();
            let gross = (sum * i128::from(rule.every_days)).div_euclid(last.len() as i128 * 30) as i64;
            let pay = if *of == Of::Net { gross - withholding(tax, gross, rule.every_days * DAY) } else { gross };
            let top = match most {
                None => i64::MAX,
                Some(Most::One(m)) => *m,
                Some(Most::ByAge(list)) => {
                    let mut sorted: Vec<&AgeSum> = list.iter().collect();
                    sorted.sort_by(|a, b| b.from_age.cmp(&a.from_age));
                    sorted.into_iter().find(|b| b.from_age <= age).map_or(i64::MAX, |b| b.amount)
                }
            };
            let bps = match with_child_bps {
                Some(c) if children(18) > 0 => *c,
                _ => *share_bps,
            };
            let share = ((i128::from(pay) * i128::from(bps)).div_euclid(10_000)) as i64;
            share.max(least.unwrap_or(0)).min(top)
        }
        Amount::Household { household, per_member, per_child } => {
            household + per_member.unwrap_or(0) * members + per_child.as_ref().map_or(0, |c| c.amount * children(c.under_age))
        }
    };
    if amount <= 0 {
        return Err(Refusal::Nothing);
    }
    let by_days = rule.lasts.as_ref().and_then(|l| l.days).map(|d| t + d * DAY);
    let by_age = rule.lasts.as_ref().and_then(|l| l.until_age).map(|a| who.born_at + a * year);
    let until = [by_days, by_age].into_iter().flatten().min();
    Ok(Granted { amount, until })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::withholding::tax_law_of;
    use serde_json::{json, Value};

    fn rule(v: Value) -> PaymentRule {
        let mut v = v;
        v["payer"] = json!("outside");
        v["account"] = json!("acc-o");
        serde_json::from_value(v).unwrap()
    }
    fn written(n: i64) -> String {
        n.to_string()
    }

    #[test]
    fn the_shared_cases_equal_the_ts_answers() {
        let file: Value = serde_json::from_str(include_str!("../../../../contracts/test/support.json")).unwrap();
        let tax = tax_law_of("t", &oikos_core::Frozen::of(&file["tax"]), Some("outside"));
        let cases = file["decisions"].as_array().unwrap();
        assert!(cases.len() >= 15);
        for c in cases {
            let r: PaymentRule = serde_json::from_value(c["rule"].clone()).unwrap();
            let who = Claimant {
                born_at: c["born_at"].as_i64().unwrap(),
                declared: serde_json::from_value(c.get("declares").cloned().unwrap_or(json!({}))).unwrap(),
                reports: c.get("reports").and_then(Value::as_array).map(|a| a.iter().map(|x| x.as_i64().unwrap()).collect()).unwrap_or_default(),
                paid_another_pension: c.get("paid_another_pension").and_then(Value::as_bool).unwrap_or(false),
            };
            let got = decide(&r, &who, c["t"].as_i64().unwrap(), YEAR, tax.as_ref());
            let e = &c["expect"];
            match got {
                Ok(g) => {
                    assert_eq!(e["granted"], json!(true), "{}", c["name"]);
                    assert_eq!(e["amount"].as_i64().unwrap(), g.amount, "{}", c["name"]);
                    assert_eq!(e.get("until").and_then(Value::as_i64), g.until, "{}", c["name"]);
                }
                Err(why) => {
                    assert_eq!(e["granted"], json!(false), "{}", c["name"]);
                    assert_eq!(e.get("reason").and_then(Value::as_str).map(String::from), why.why(&|n| format!("XTS {}.{:02}", n / 100, n % 100)), "{}", c["name"]);
                }
            }
        }
        for c in file["declarations"].as_array().unwrap() {
            let r: PaymentRule = serde_json::from_value(c["rule"].clone()).unwrap();
            let f = &c["facts"];
            let facts = Facts {
                household_income: f["household_income"].as_i64().unwrap(),
                household_members: f["household_members"].as_i64().unwrap(),
                children_born_at: f["children_born_at"].as_array().unwrap().iter().map(|x| x.as_i64().unwrap()).collect(),
                other_pension: f["other_pension"].as_bool().unwrap(),
            };
            let got = declaration_for(&r, &facts).map(|d| serde_json::to_value(d).unwrap()).unwrap_or(Value::Null);
            assert_eq!(got, c["declares"], "{}", c["name"]);
        }
        for c in file["words"].as_array().unwrap() {
            let rules: Vec<PaymentRule> = serde_json::from_value(c["rules"].clone()).unwrap();
            assert_eq!(payments_in_words(&rules, &written, &payer_words), c["words"].as_str().unwrap());
        }
        for c in file["stops_work"].as_array().unwrap() {
            let curve: Vec<(i64, i64)> = c["curve"].as_array().unwrap().iter().map(|b| (b["from"].as_i64().unwrap(), b["bps"].as_i64().unwrap())).collect();
            for d in c["draws"].as_array().unwrap() {
                assert_eq!(stops_work_at(&curve, d[0].as_i64().unwrap()), d[1].as_i64(), "draw {d}");
            }
        }
    }

    #[test]
    fn a_pay_by_age_by_household_by_out_of_work() {
        let pension = rule(json!({ "id": "p", "every_days": 14, "who": { "from_age": 67 }, "amount": { "flat": 50_000 } }));
        assert!(for_age(&pension) && !for_out_of_work(&pension) && !for_household(&pension));
        let basic = rule(json!({ "id": "b", "every_days": 30, "who": { "out_of_work": true }, "amount": { "flat": 1 } }));
        assert!(for_out_of_work(&basic) && !for_age(&basic));
        let family = rule(json!({ "id": "f", "every_days": 30, "amount": { "household": 1 } }));
        assert!(for_household(&family) && !for_age(&family));
        // A payment for age granted by the claimant's age, once; refused outside it without a reason.
        let old = Claimant { born_at: -70 * YEAR, ..Default::default() };
        assert_eq!(decide(&pension, &old, 0, YEAR, None), Ok(Granted { amount: 50_000, until: None }));
        let young = Claimant { born_at: -30 * YEAR, ..Default::default() };
        assert_eq!(decide(&pension, &young, 0, YEAR, None), Err(Refusal::Silent));
    }

    #[test]
    fn a_dead_claimants_born_in_the_future_is_nobodys_age_and_a_pension_for_no_other_is_refused_if_another_is_paid() {
        let r = rule(json!({ "id": "social", "every_days": 30, "who": { "from_age": 70, "no_other_pension": true }, "amount": { "flat": 2_000 } }));
        let mut c = Claimant { born_at: -72 * YEAR, declared: Declared { other_pension: Some(false), ..Default::default() }, ..Default::default() };
        assert!(decide(&r, &c, 0, YEAR, None).is_ok());
        c.paid_another_pension = true;
        assert_eq!(decide(&r, &c, 0, YEAR, None), Err(Refusal::PaidAnotherPension));
        c.paid_another_pension = false;
        c.declared.other_pension = None;
        assert_eq!(decide(&r, &c, 0, YEAR, None), Err(Refusal::PensionNotStated));
    }

    #[test]
    fn a_payment_ends_on_the_day_its_time_or_the_claimants_age_runs_out() {
        let by_days = rule(json!({ "id": "i", "every_days": 30, "amount": { "flat": 10_000 }, "lasts": { "days": 60, "then": "basic" } }));
        let who = Claimant { born_at: -40 * YEAR, ..Default::default() };
        assert_eq!(decide(&by_days, &who, 0, YEAR, None).unwrap().until, Some(60 * DAY));
        let by_age = rule(json!({ "id": "bridge", "every_days": 30, "amount": { "flat": 1_000 }, "lasts": { "until_age": 60 } }));
        let nearly = Claimant { born_at: -(60 * YEAR - 45 * DAY), ..Default::default() };
        assert_eq!(decide(&by_age, &nearly, 0, YEAR, None).unwrap().until, Some(45 * DAY));
        let both = rule(json!({ "id": "x", "every_days": 30, "amount": { "flat": 1 }, "lasts": { "days": 10, "until_age": 60 } }));
        assert_eq!(decide(&both, &nearly, 0, YEAR, None).unwrap().until, Some(10 * DAY));
    }

    #[test]
    fn the_record_window_is_thirty_day_months_or_the_calendars() {
        let r = rule(json!({ "id": "i", "every_days": 30, "who": { "record": { "months": 12, "within_months": 30 } }, "amount": { "flat": 1 } }));
        assert_eq!(record_since(&r, 45 * MONTH, None), 15 * MONTH);
        let none = rule(json!({ "id": "i", "every_days": 30, "who": { "record": {} }, "amount": { "flat": 1 } }));
        assert_eq!(record_since(&none, 45 * MONTH, None), i64::MIN);
        assert!(reads_record(&none) && !reads_record(&rule(json!({ "id": "p", "every_days": 1, "amount": { "flat": 1 } }))));
    }
}
