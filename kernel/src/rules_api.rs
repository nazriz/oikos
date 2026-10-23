//! The shared rules, by name, for the TypeScript top layer (docs/design/rust-port.md 1.1: the generator stays in
//! TypeScript and calls the Rust rules, so nothing is written twice). One table: a rule's name, and a function from its
//! arguments (JSON) to its answer (JSON). The N-API module serves it as `rules(name, args)`; `oikos-kernel rules`
//! lists it.
//!
//! A lane that ports a rule the generator uses (household drawing: A1; withholding and support: C1; decision law: D)
//! adds its line here, and the generator's call switches to it (worlds/generator/rules.ts). Every rule is pure: the
//! same arguments, the same answer.

use oikos_rules::{forms, household, law, support, withholding};
use serde_json::{json, Value};
use std::collections::BTreeMap;

type Rule = fn(&Value) -> Result<Value, String>;

fn arg<T: serde::de::DeserializeOwned>(args: &Value, k: &str) -> Result<T, String> {
    serde_json::from_value(args.get(k).cloned().unwrap_or(Value::Null)).map_err(|e| format!("argument {k}: {e}"))
}

fn to<T: serde::Serialize>(x: T) -> Result<Value, String> {
    serde_json::to_value(x).map_err(|e| e.to_string())
}


/// An amount as the town writes its money in a law's words: the currency's sign, grouping and decimal places, but whole
/// units without their decimals when the sum is a round one (the generator's `asWritten`; the kernel's `format_money`).
fn written_in(cur: &oikos_sight::calls::Currency, n: i64) -> String {
    let per = 10_i64.pow(u32::from(cur.minor_units));
    if cur.minor_units > 0 && n % per == 0 {
        let whole = oikos_sight::calls::Currency { minor_units: 0, ..cur.clone() };
        oikos_sight::calls::format_money(&(n / per).to_string(), &whole)
    } else {
        oikos_sight::calls::format_money(&n.to_string(), cur)
    }
}

fn currency_arg(a: &Value) -> Result<oikos_sight::calls::Currency, String> {
    oikos_sight::calls::Currency::from_config(a.get("currency").ok_or("argument currency")?).ok_or_else(|| "argument currency: not a currency".to_string())
}

/// `{ "<account>": "<name>" }` as a way to say whom a charge or a payment goes to: `<name> (<account>)`.
fn payees_arg(a: &Value) -> BTreeMap<String, String> {
    a.get("payees").and_then(Value::as_object).map(|m| m.iter().filter_map(|(k, v)| v.as_str().map(|n| (k.clone(), format!("{n} ({k})")))).collect()).unwrap_or_default()
}

/// Every rule served, in name order.
pub const RULES: &[(&str, Rule, &str)] = &[
    ("forms.catalogue", |_| to(forms::catalogue()), "every office's forms, by group (papers.ts's exports)"),
    ("forms.group", |a| to(forms::group(&arg::<String>(a, "group")?)), "{group}: one group's forms"),
    (
        "forms.plan_law",
        |a| to(forms::plan_law(&serde_json::from_value(a.clone()).map_err(|e| e.to_string())?)),
        "{plan_months, plan_consider?, plan_barred_rent_months?, cure_days?}: papers.ts planLaw",
    ),
    (
        "forms.plan_law_words",
        |a| to(forms::plan_law_words(&serde_json::from_value(a.clone()).map_err(|e| e.to_string())?)),
        "the same figures: papers.ts planLawWords",
    ),
    (
        "forms.possession_order_for",
        |a| to(forms::possession_order_for(&arg(a, "law")?, arg(a, "plan_months")?)),
        "{law: PlanLaw, plan_months}: papers.ts possessionOrderFor",
    ),
    (
        "forms.staffing_own",
        |a| {
            let s = |k: &str| a.get(k).and_then(Value::as_str);
            to(forms::staffing_own(s("role"), s("industry"), s("workplace"), a.get("notice_days").and_then(Value::as_i64)))
        },
        "{role?, industry?, workplace?, notice_days?}: papers.ts staffingOwn",
    ),
    (
        "law.draft",
        |a| {
            let d = law::draft_law(&arg::<String>(a, "schedule_id")?, &arg(a, "schedule")?, &arg::<BTreeMap<String, i64>>(a, "values")?)?;
            Ok(json!({ "text": d.text, "adico": d.adico, "formal": d.formal_part(), "data": d.data() }))
        },
        "{schedule_id, schedule, values}: a law written from figures by its schedule (law.ts draftLaw)",
    ),
    ("law.violations", |a| to(law::violations(&arg::<String>(a, "condition")?)?), "{condition}: what a CEL condition cannot say"),
    (
        "founding.accept_gathering",
        |a| {
            use oikos_actors::mind::founding::{accept_gathering, GatherBounds};
            let (from, to): (i64, i64) = arg(a, "first")?;
            let bounds = GatherBounds { at: arg(a, "at")?, every_days: arg(a, "every_days")?, lasts_minutes: arg(a, "lasts_minutes")?, first: (from, to), at_seconds: arg(a, "at_seconds")? };
            let blocks: Vec<oikos_contracts::blocks::Block> = arg(a, "blocks")?;
            Ok(match accept_gathering(&arg::<String>(a, "me")?, &bounds, &blocks) { Ok(done) => json!({ "ok": done }), Err(why) => json!({ "refused": why }) })
        },
        "{me, at, every_days, lasts_minutes, first: [from, to], at_seconds, blocks}: a founder's draft of its gathering, accepted ({ok: blocks}) or refused ({refused: why})",
    ),
    (
        "founding.accept_membership",
        |a| {
            use oikos_actors::mind::founding::{accept_membership, MembershipBounds};
            let bounds = MembershipBounds { account: arg(a, "account")?, dues: arg(a, "dues")?, notice: arg(a, "notice")? };
            let blocks: Vec<oikos_contracts::blocks::Block> = arg(a, "blocks")?;
            Ok(match accept_membership(&arg::<String>(a, "me")?, &bounds, &blocks) { Ok(done) => json!({ "ok": done }), Err(why) => json!({ "refused": why }) })
        },
        "{me, account, dues, notice, blocks}: a founder's draft of its offer of membership, accepted ({ok: blocks}) or refused ({refused: why})",
    ),
    (
        "withholding.withholding",
        |a| {
            let law: Option<withholding::IncomeTaxLaw> = arg(a, "law")?;
            to(withholding::withholding(law.as_ref(), arg(a, "gross")?, arg(a, "period")?))
        },
        "{law?: IncomeTaxLaw, gross, period}: what is withheld from one pay (tax.ts withholding); no law, nothing",
    ),
    ("withholding.day_pay_period", |a| to(withholding::day_pay_period(arg(a, "work_days")?)), "{work_days}: the span a day's pay is reckoned over (tax.ts dayPayPeriod)"),
    (
        "support.declaration_for",
        |a| {
            let r: support::PaymentRule = arg(a, "rule")?;
            let f = a.get("facts").ok_or("argument facts")?;
            let facts = support::Facts {
                household_income: arg(f, "household_income")?,
                household_members: arg(f, "household_members")?,
                children_born_at: arg(f, "children_born_at")?,
                other_pension: arg(f, "other_pension")?,
            };
            to(support::declaration_for(&r, &facts))
        },
        "{rule: PaymentRule, facts: {household_income, household_members, children_born_at, other_pension}}: what a claim must declare (payments.ts declarationFor); null for none",
    ),
    ("support.for_age", |a| to(support::for_age(&arg(a, "rule")?)), "{rule}: a pension (payments.ts forAge)"),
    ("support.for_out_of_work", |a| to(support::for_out_of_work(&arg(a, "rule")?)), "{rule}: a payment for those out of work (payments.ts forOutOfWork)"),
    (
        "support.stops_work_at",
        |a| {
            let curve: Vec<(i64, i64)> = arg::<Vec<Value>>(a, "curve")?
                .iter()
                .map(|b| Ok((arg(b, "from")?, arg(b, "bps")?)))
                .collect::<Result<_, String>>()?;
            to(support::stops_work_at(&curve, arg(a, "draw")?))
        },
        "{curve: [{from, bps}], draw}: the age someone stops work (payments.ts stopsWorkAt); null for never",
    ),
    (
        "household.bedrooms_needed",
        |a| {
            let std: Option<household::OccupancyStandard> = arg(a, "standard")?;
            to(household::bedrooms_needed(&arg(a, "household")?, arg(a, "t")?, arg(a, "year")?, std.as_ref()))
        },
        "{household, t, year, standard?}: the bedrooms a household needs (household.ts bedroomsNeeded)",
    ),
    ("household.draw_savings", |a| to(household::draw_savings(arg(a, "pct")?, arg(a, "q")?)), "{pct: [5], q}: a saving drawn between the percentiles (household.ts drawSavings)"),
    (
        "household.town",
        |a| {
            use oikos_core::rng::Randomness;
            let seed: u64 = arg(a, "seed")?;
            let citizens: usize = arg(a, "citizens")?;
            let mut spec: household::HouseholdSpec = arg(a, "spec")?;
            let r = Randomness::new(seed);
            let bands = if spec.adult_age_bands.is_none() {
                let mut s = r.stream(&["generator", "age-bands"]);
                let b = household::adult_age_bands(&spec, &mut |n| s.below(n as u64) as i64, household::ADULT_AGE_BANDS_DRAWS);
                spec.adult_age_bands = b.clone();
                b
            } else {
                None
            };
            let mut s = r.stream(&["generator", "households"]);
            let (mut count, mut out) = (0usize, vec![]);
            while count < citizens {
                let d = household::draw_household(&spec, &mut |n| s.below(n as u64) as i64);
                count += d.members.len();
                out.push(d);
            }
            Ok(json!({ "adult_age_bands": bands, "households": out }))
        },
        "{spec, seed, citizens}: the town's households, drawn on the generator's keyed streams (age-bands, households) until the people are counted (household.ts adultAgeBands, drawHousehold)",
    ),
    (
        "words.charges",
        |a| {
            let cur = currency_arg(a)?;
            let payees = payees_arg(a);
            let charges: Vec<withholding::Charge> = arg(a, "charges")?;
            Ok(json!(withholding::charges_in_words(&charges, &|n| written_in(&cur, n), &|c| payees.get(&c.account).cloned().unwrap_or_else(|| c.account.clone()))))
        },
        "{charges, currency, payees?: {account: name}}: a tax law's charges in words (tax.ts chargesInWords), sums written in the currency",
    ),
    ("words.withholding", |a| Ok(json!(withholding::withholding_in_words(arg(a, "period_days")?, arg(a, "work_days")?))), "{period_days, work_days?}: how a pay's withholding is reckoned, in words (tax.ts withholdingInWords)"),
    ("words.returns", |a| Ok(json!(withholding::returns_in_words(&arg(a, "law")?))), "{law: IncomeTaxLaw}: when the returns fall due, in words (tax.ts returnsInWords)"),
    (
        "words.payments",
        |a| {
            let cur = currency_arg(a)?;
            let payees = payees_arg(a);
            let payments: Vec<support::PaymentRule> = arg(a, "payments")?;
            Ok(json!(support::payments_in_words(&payments, &|n| written_in(&cur, n), &|r| payees.get(&r.account).cloned().unwrap_or_else(|| r.account.clone()))))
        },
        "{payments, currency, payees?: {account: name}}: the support law's payments in words (payments.ts paymentsInWords)",
    ),
    (
        "words.decisions",
        |a| {
            let cur = currency_arg(a)?;
            let rules: Vec<oikos_rules::decisions::DecisionLaw> = arg(a, "rules")?;
            Ok(json!(oikos_rules::decisions::decisions_in_words(&rules, |n| written_in(&cur, n))))
        },
        "{rules, currency}: the decision law in words (decisions.ts decisionsInWords)",
    ),
    (
        "words.lines",
        |a| {
            let cur = currency_arg(a)?;
            let lines: Vec<(String, i64)> = arg(a, "lines")?;
            let pairs: Vec<(&str, i64)> = lines.iter().map(|(k, v)| (k.as_str(), *v)).collect();
            Ok(json!(oikos_actors::offices::council::lines_in_words(&pairs, &|n| written_in(&cur, n))))
        },
        "{lines: [[line, sum]], currency}: a budget's lines in words (government.ts linesInWords)",
    ),
    ("actors.manifests", |_| Ok(manifests()), "every actor kind's manifest (contracts/module.schema.json), by name"),
];

/// Every actor kind's manifest, by name: what the generator, the seat prompts and the backstops read.
pub fn manifests() -> Value {
    let all: serde_json::Map<String, Value> =
        oikos_actors::registry::kinds().iter().map(|k| (k.name().to_string(), k.manifest())).collect();
    Value::Object(all)
}

/// A rule's answer to its arguments.
pub fn call(name: &str, args: &Value) -> Result<Value, String> {
    let (_, f, _) = RULES.iter().find(|(n, ..)| *n == name).ok_or_else(|| format!("no rule {name} (oikos-kernel rules lists them)"))?;
    f(args)
}
