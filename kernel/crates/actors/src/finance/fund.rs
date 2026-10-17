//! fund.retirement: a retirement fund's trustee (participants/src/behaviour/fund.ts; docs/behaviour/firm-ownership.md).
//!
//! The trustee of a retirement fund, which holds shares for its members (it is on those firms' registers as any holder is,
//! and they pay it as they pay any holder). Every `pay_every_days` it takes what has come in since it last did; pays its
//! costs out of that (`cost_bps_of_income`, to its administrator); and credits the rest to its members by their units,
//! from the register it keeps (its latest `fund_members` statement). A member below `access_age` is paid nothing: their part
//! is kept for them. A member from that age is paid their part as it comes, as a pension, and with it what was kept for
//! them before, at the yearly rate for their age (`drawdown_bps_by_age`). When a member's death is registered, what was kept
//! for them is paid to their account (their estate's), and their units end. A member who has left is paid nothing more here;
//! their part is kept. Every `report_every_days` (0: never) it reports publicly what it took in, paid and keeps. It takes
//! no contributions and admits no members.
//!
//! Rewritten for Rust: TS's 0.1.0 rules, in integers (a part, a cost and a drawdown are floored in 128-bit arithmetic).
//! Basis: docs/behaviour/firm-ownership.md (the fund's rules and their sources: a defined-contribution fund pays its costs
//! from income, preserves benefits until a preservation age, and pays a minimum drawdown by age).

use super::manifest_of;
use crate::common::{data, money_words, own_account, Answering, Book, Fields, DAY};
use crate::steps::{because, pay, say, Pay, Plan, Say, Step, Stepper, Visible};
use crate::{Actor, Ctx, Cx, Kind, Picture};
use oikos_rules::forms::Answers;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

pub struct Retirement;

const MANIFEST: &str = include_str!("manifests/fund.retirement.json");

/// A member as the fund's register has them: where they are paid, when they were born, and their units of the fund.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Member {
    member: String,
    #[serde(default)]
    account: String,
    #[serde(default, deserialize_with = "crate::papers::lenient::int")]
    born_at: i64,
    #[serde(default, deserialize_with = "crate::papers::lenient::int")]
    units: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Drawdown {
    from: i64,
    bps: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct Period {
    income: i64,
    costs: i64,
    pensions: i64,
    on_death: i64,
}

#[derive(Serialize, Deserialize)]
struct Fund {
    me: String,
    administrator_account: String,
    access_age: i64,
    cost_bps_of_income: i64,
    /// How often it pays, seconds.
    every: i64,
    drawdown_bps_by_age: Vec<Drawdown>,
    report_every: i64,
    year: i64,
    book: Book,
    next: i64,
    next_report: Option<i64>,
    members: Option<BTreeMap<String, Member>>,
    /// Member -> what is kept for them.
    kept: BTreeMap<String, i64>,
    away: BTreeSet<String>,
    period: Period,
}

impl Kind for Retirement {
    fn name(&self) -> &'static str {
        "fund.retirement"
    }
    fn version(&self) -> &'static str {
        "0.1.0"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/firm-ownership.md"
    }
    fn manifest(&self) -> Value {
        let mut m = manifest_of(MANIFEST);
        m["answers"] = json!({ "office": ANSWERS.0, "acts": ANSWERS.1 });
        m
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        DAY
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        let administrator_account: String = ctx.need("administrator_account", "fund.retirement")?;
        let access_age: i64 = ctx.need("access_age", "fund.retirement")?;
        let report_every_days: i64 = ctx.param("report_every_days", 0)?;
        let every = ctx.param::<i64>("pay_every_days", 30)? * DAY;
        let fund = Fund {
            me: ctx.entity.clone(),
            administrator_account,
            access_age,
            cost_bps_of_income: ctx.param("cost_bps_of_income", 0)?,
            every,
            drawdown_bps_by_age: ctx.param("drawdown_bps_by_age", Vec::<Drawdown>::new())?,
            report_every: report_every_days * DAY,
            year: ctx.param("year", 365 * DAY)?,
            book: Book::new(),
            next: every,
            next_report: (report_every_days > 0).then_some(report_every_days * DAY),
            members: None,
            kept: BTreeMap::new(),
            away: BTreeSet::new(),
            period: Period::default(),
        };
        Ok(Box::new(Answering::new(Stepper::new(fund), answers())))
    }
    fn restore(&self, _: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        let inner = Stepper::<Fund>::restore(saved.get("inner").cloned().ok_or("fund.retirement: nothing saved")?)?;
        Ok(Box::new(Answering::restore(inner, answers(), &saved)?))
    }
}

const ANSWERS: (&str, &str) = ("the retirement fund", "What it acts on: its members' accounts and the pensions it pays from them, as its rules say.");

fn answers() -> Answers {
    Answers { office: ANSWERS.0.into(), acts: ANSWERS.1.into(), forms: vec![], report: false }
}

impl Plan for Fund {
    type Then = ();

    fn absorb(&mut self, pic: &Picture, _: &mut Cx) {
        self.book.absorb(pic);
    }

    fn plan(&mut self, pic: &Picture, cx: &mut Cx) -> Vec<Step<()>> {
        let t = pic.t;
        let world = cx.ctx.world.clone();
        let usd = |n: i64| money_words(n, &world);
        let mut steps: Vec<Step<()>> = vec![];
        let register = self.book.open("fund_members").filter(|r| r.speaks_for.as_deref() == Some(&self.me)).max_by(|a, b| a.at.cmp(&b.at).then_with(|| crate::common::filed_before(&b.id, &a.id))).cloned();
        if let (None, Some(register)) = (&self.members, &register) {
            let list: Vec<Member> = data(register).get("members").and_then(Value::as_array).map(|a| a.iter().filter_map(|m| serde_json::from_value(m.clone()).ok()).collect()).unwrap_or_default();
            self.members = Some(list.into_iter().map(|m| (m.member.clone(), m)).collect());
        }
        let acc = own_account(pic);
        let (Some(acc), true) = (acc, t >= self.next && self.members.is_some()) else { return steps };
        while self.next <= t {
            self.next += self.every;
        }
        for r in self.book.all("departure") {
            if let Some(s) = &r.speaks_for {
                self.away.insert(s.clone());
            }
        }
        // What has come in: what we hold beyond what is kept for members.
        let income = (acc.balance - self.kept.values().sum::<i64>()).max(0);
        let mut lines: Vec<Value> = vec![];
        // Deaths, as registered: what was kept for the member, to their account; their units end.
        let mut on_death = 0;
        let dead: BTreeSet<String> = self.book.all("death_registration").filter_map(|r| data(r).s("deceased").map(String::from)).collect();
        let members = self.members.as_mut().expect("checked above");
        for who in &dead {
            let Some(m) = members.get(who) else { continue };
            let sum = self.kept.get(who).copied().unwrap_or(0);
            if sum > 0 {
                lines.push(json!({ "to": m.account, "amount": sum.to_string(), "for": "Death benefit." }));
            }
            on_death += sum;
            self.kept.remove(who);
            members.remove(who);
        }
        let cost = (income as i128 * self.cost_bps_of_income as i128).div_euclid(10_000) as i64;
        let net = income - cost;
        let units: i64 = members.values().map(|m| m.units).sum();
        let mut pensions = 0;
        let ids: Vec<String> = members.keys().cloned().collect();
        if units > 0 {
            for id in ids {
                let m = members[&id].clone();
                let part = (net as i128 * m.units as i128).div_euclid(units as i128) as i64;
                let age = (t - m.born_at).div_euclid(self.year);
                let had = self.kept.get(&m.member).copied().unwrap_or(0);
                if age < self.access_age || self.away.contains(&m.member) {
                    if part > 0 {
                        self.kept.insert(m.member.clone(), had + part);
                    }
                    continue;
                }
                let rate = self.drawdown_bps_by_age.iter().filter(|b| b.from <= age).max_by_key(|b| b.from).map_or(0, |b| b.bps);
                let draw = had.min((had as i128 * rate as i128 * self.every as i128).div_euclid(10_000 * self.year as i128) as i64);
                if draw > 0 {
                    self.kept.insert(m.member.clone(), had - draw);
                }
                if part + draw > 0 {
                    lines.push(json!({ "to": m.account, "amount": (part + draw).to_string(), "for": "Pension." }));
                }
                pensions += part + draw;
            }
        }
        let n_members = self.members.as_ref().map_or(0, |m| m.len());
        if cost > 0 {
            steps.push(because(
                format!("We took in {} since we last paid: {}% of it goes on our costs.", usd(income), super::credit::pct(self.cost_bps_of_income)),
                vec![pay(&self.administrator_account, cost, Pay { from: Some(acc.account.clone()), for_: Some("Administration and investment costs.".into()), ..Default::default() }, cx)],
            ));
        }
        // One instruction to the bank for them all (docs/behaviour/bank-payment-system.md).
        if !lines.is_empty() {
            let n = lines.len();
            steps.push(because(
                format!(
                    "Of the {} left, each member's part by their units: kept for those not yet {}; paid to those who are, with what was kept for them before at the yearly rate for their age ({n} payment{}, {}, in one instruction to the bank).",
                    usd(net),
                    self.access_age,
                    if n > 1 { "s" } else { "" },
                    usd(pensions + on_death)
                ),
                vec![say(
                    "request",
                    &format!("Please pay these from {}: {n} payments.", acc.account),
                    Say { to: Some(vec![acc.custodian.clone()]), data: Some(json!({ "from": acc.account, "payments": lines })), ..Default::default() },
                )],
            ));
        }
        self.period.income += income;
        self.period.costs += cost;
        self.period.pensions += pensions;
        self.period.on_death += on_death;
        if let Some(due) = self.next_report.filter(|due| t >= *due) {
            let mut due = due;
            while due <= t {
                due += self.report_every;
            }
            self.next_report = Some(due);
            let keeps: i64 = self.kept.values().sum();
            let p = std::mem::take(&mut self.period);
            steps.push(because(
                "Our report for the period: what we took in, what it cost, what we paid, and what we keep for our members.",
                vec![say(
                    "fund_report",
                    &format!(
                        "{}: {n_members} members; took in {}, costs {}, pensions paid {}, paid on members' deaths {}; {} kept for members.",
                        self.me,
                        usd(p.income),
                        usd(p.costs),
                        usd(p.pensions),
                        usd(p.on_death),
                        usd(keeps)
                    ),
                    Say {
                        visible: Some(Visible::Public),
                        data: Some(json!({ "members": n_members, "income": p.income, "costs": p.costs, "pensions": p.pensions, "on_death": p.on_death, "kept": keeps })),
                        ..Default::default()
                    },
                )],
            ));
        }
        steps
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::finance::kit::{arg, json_arg, records, statement, Rig, DAY, MONTH};
    use oikos_sight::calls::Call;

    const YEAR: i64 = 365 * DAY;
    fn member(id: &str, age: i64, units: i64, days: i64) -> Value {
        json!({ "member": id, "account": format!("acc-{id}"), "born_at": -(age * YEAR + days * DAY), "units": units })
    }
    fn register(members: Vec<Value>) -> Value {
        statement("members-fund", 0, "fund_members", json!({ "speaks_for": "fund", "visible_to": ["fund"] }), json!({ "members": members }))
    }
    fn params() -> Value {
        json!({ "administrator_account": "acc-admin", "access_age": 67, "cost_bps_of_income": 1500, "pay_every_days": 30,
            "drawdown_bps_by_age": [{ "from": 0, "bps": 400 }, { "from": 65, "bps": 500 }, { "from": 75, "bps": 600 }] })
    }
    fn fund(p: Value) -> Rig {
        Rig::new(&Retirement, "fund", "fund-trustee-system", p)
    }
    fn shown(balance: i64, rs: Vec<Value>) -> Value {
        json!({ "ledger": { "kind": "accounts", "transactions": [], "accounts": [{ "account": "acc-fund", "holder": "fund", "custodian": "bank", "currency": "XTS", "balance": balance.to_string() }] },
            "register": records(rs) })
    }
    fn payments(said: &[Call]) -> Vec<(String, String, String)> {
        said.iter()
            .find(|c| arg(c, "kind").as_deref() == Some("request"))
            .map(|c| json_arg(c, "data")["payments"].as_array().unwrap().iter().map(|p| (p["to"].as_str().unwrap().into(), p["amount"].as_str().unwrap().into(), p["for"].as_str().unwrap().into())).collect())
            .unwrap_or_default()
    }
    fn costs(said: &[Call]) -> Vec<(String, String)> {
        said.iter().filter(|c| c.fn_ == "money").map(|c| (arg(c, "to").unwrap(), arg(c, "amount").unwrap())).collect()
    }
    fn p(to: &str, amount: &str, why: &str) -> (String, String, String) {
        (to.into(), amount.into(), why.into())
    }

    #[test]
    fn costs_first_then_each_members_part_by_their_units_kept_below_the_access_age_paid_from_it() {
        let mut m = fund(params());
        let members = vec![member("a", 70, 30, 0), member("b", 40, 20, 0), member("c", 80, 50, 0)];
        assert!(m.at(0, shown(0, vec![register(members)]), json!([])).is_empty());
        // Nothing is paid before a period has passed.
        assert!(m.at(29 * DAY, shown(100_000, vec![]), json!([])).is_empty());
        let first = m.at(MONTH, shown(100_000, vec![]), json!([]));
        assert_eq!(costs(&first), [("acc-admin".to_string(), "$150.00".to_string())]);
        assert_eq!(payments(&first), [p("acc-a", "25500", "Pension."), p("acc-c", "42500", "Pension.")]);
        // The next period: what it holds is what was kept for b (17,000) and 10,000 more come in.
        let second = m.at(2 * MONTH, shown(27_000, vec![]), json!([]));
        assert_eq!(costs(&second), [("acc-admin".to_string(), "$15.00".to_string())]);
        assert_eq!(payments(&second), [p("acc-a", "2550", "Pension."), p("acc-c", "4250", "Pension.")]);
        // Nothing came in: nothing is paid, and what is kept stays kept.
        assert!(m.at(3 * MONTH, shown(18_700, vec![]), json!([])).is_empty());
    }

    #[test]
    fn what_was_kept_is_paid_from_the_access_age_at_the_rate_for_the_members_age_and_on_death_to_the_members_account() {
        let mut m = fund(params());
        // b turns 67 between the first and the second period.
        m.at(0, shown(0, vec![register(vec![member("a", 70, 50, 0), member("b", 66, 50, 365 - 45)])]), json!([]));
        let first = m.at(MONTH, shown(200_000, vec![]), json!([]));
        assert_eq!(payments(&first), [p("acc-a", "85000", "Pension.")]);
        // Kept for b: 85,000. Now 67: their part of what came in (20,000 less costs, halved), and 5% a year of what was kept.
        let second = m.at(2 * MONTH, shown(105_000, vec![]), json!([]));
        let draw = 85_000 * 500 * 30 / (10_000 * 365);
        assert_eq!(payments(&second), [p("acc-a", "8500", "Pension."), p("acc-b", &(8_500 + draw).to_string(), "Pension.")]);
        // b dies: what is still kept for them goes to their account (their estate's, which the bank settles), and a has every unit.
        let death = statement("rec.9", 2 * MONTH + DAY, "death_registration", json!({}), json!({ "deceased": "b" }));
        let mut ch = shown(85_000 - draw + 10_000, vec![]);
        ch["gone"] = records(vec![death]);
        let third = m.at(3 * MONTH, ch, json!([]));
        assert_eq!(payments(&third), [p("acc-b", &(85_000 - draw).to_string(), "Death benefit."), p("acc-a", "8500", "Pension.")]);
    }

    #[test]
    fn a_member_who_has_left_is_paid_nothing_more_here_their_part_is_kept() {
        let mut m = fund(params());
        m.at(0, shown(0, vec![register(vec![member("a", 70, 50, 0), member("b", 71, 50, 0)])]), json!([]));
        let left = statement("rec.3", DAY, "departure", json!({ "speaks_for": "b" }), json!({}));
        let mut ch = shown(100_000, vec![]);
        ch["gone"] = records(vec![left]);
        assert_eq!(payments(&m.at(MONTH, ch, json!([]))), [p("acc-a", "42500", "Pension.")]);
    }

    #[test]
    fn the_world_must_say_whom_it_pays_its_costs_to_and_from_what_age_it_pays() {
        let ctx = Ctx { participant: "f".into(), performer: Default::default(), entity: "fund".into(), position: None, params: Default::default(), world: crate::finance::kit::test_money() };
        let err = Retirement.create(&ctx).err().unwrap();
        assert!(err.contains("the world must say administrator_account"), "{err}");
    }

    #[test]
    fn it_reports_publicly_what_it_took_in_paid_and_keeps_and_saves_and_restores() {
        let mut m = fund(json!({ "administrator_account": "acc-admin", "access_age": 67, "cost_bps_of_income": 1000, "pay_every_days": 30, "report_every_days": 60 }));
        m.at(0, shown(0, vec![register(vec![member("a", 70, 50, 0), member("b", 40, 50, 0)])]), json!([]));
        assert!(m.at(MONTH, shown(100_000, vec![]), json!([])).iter().all(|c| arg(c, "kind").as_deref() != Some("fund_report")));
        m.snapshot_round_trip();
        let second = m.at(2 * MONTH, shown(95_000, vec![]), json!([]));
        let report = second.iter().find(|c| arg(c, "kind").as_deref() == Some("fund_report")).expect("a report at the period's end");
        assert_eq!(arg(report, "visible").as_deref(), Some("public"));
        let d = json_arg(report, "data");
        assert_eq!((d["members"].as_i64(), d["income"].as_i64()), (Some(2), Some(150_000)), "{d}");
        assert_eq!(d["costs"].as_i64(), Some(15_000), "a tenth of what came in over the two periods");
    }
}
