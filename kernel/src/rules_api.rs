//! The shared rules, by name, for the TypeScript top layer (docs/design/rust-port.md 1.1: the generator stays in
//! TypeScript and calls the Rust rules, so nothing is written twice). One table: a rule's name, and a function from its
//! arguments (JSON) to its answer (JSON). The N-API module serves it as `rules(name, args)`; `oikos-kernel rules`
//! lists it.
//!
//! A lane that ports a rule the generator uses (household drawing: A1; withholding and support: C1; decision law: D)
//! adds its line here, and the generator's call switches to it (worlds/generator/rules.ts). Every rule is pure: the
//! same arguments, the same answer.

use oikos_rules::{forms, law};
use serde_json::{json, Value};
use std::collections::BTreeMap;

type Rule = fn(&Value) -> Result<Value, String>;

fn arg<T: serde::de::DeserializeOwned>(args: &Value, k: &str) -> Result<T, String> {
    serde_json::from_value(args.get(k).cloned().unwrap_or(Value::Null)).map_err(|e| format!("argument {k}: {e}"))
}

fn to<T: serde::Serialize>(x: T) -> Result<Value, String> {
    serde_json::to_value(x).map_err(|e| e.to_string())
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
