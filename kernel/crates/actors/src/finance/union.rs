//! union.organiser: a trade union's organiser (phase C, stage C5; participants/src/behaviour/union.ts; docs/behaviour/
//! unions.md, with sources).
//!
//! A union is an organisation workers join (membership: dues by standing order). Its organiser bargains with each employer
//! where it has members, once a year: a claim for the year's rise in prices and a margin. An offer of at least a share of the
//! claim is accepted, and the employer makes it an enterprise agreement. Otherwise, protected action as labour law commonly
//! has it (the world's laws, read as any participant reads them: formal conditions on its notice of action, docs/design/
//! ai-citizens.md 2e): a ballot of the members there (enough voting, a majority yes), notice to the employer, then
//! stoppages, longer each time, until an offer it accepts.
//!
//! **Two things rebuilt in this port (risk register PB-9/A-2 and PB-16/A-7).**
//!
//! *A strike no longer ends in the claim in full.* The union weighs what a stoppage costs its members against what the rest
//! of the gap would add over a year (`oikos_rules::bargaining::stops_striking`, Hicks 1932; the employer's side, what holding
//! out costs it in sales, is `bargaining::concession_bps`, on the employer's side in `firms`). After a stoppage, when the next
//! would cost its members at least what the gap would add, it stops striking: it takes the best offer standing, if that is
//! more than nothing, else lets the dispute rest and claims again in three months. It weighs it only where it knows a day's
//! pay in the industry (`pay_per_day`, the profile's wages by industry); otherwise it goes on, as it did, until offered what
//! it accepts. Ported from `gd-adoption` (union 0.7.0), which is not merged.
//!
//! *Whether it keeps to the law has causes, and is not a draw.* TS gave the union `compliance_bps`: when the law forbade the
//! action it would take, it kept to the law that often and otherwise acted anyway, a per-case dial (A-7: an error has a
//! cause, docs/all-work-takes-time.md). Here, when the law forbids the soonest stoppage it could notify, the union weighs
//! what breaking the law gains against what it expects to lose, and does what the weighing says, with no draw:
//!   - **the gain** is the delay it avoids. The law is weighed only where waiting cannot make the action lawful (the notice
//!     can be given a day later, a day at a time, up to a month, and that is what it does; it is the ballot that does not
//!     meet the law that no wait mends). Then keeping to the law is not acting at all, and claiming again in three months:
//!     the gain of acting is those 90 days of the claimed rise, whose daily worth to its members is their number x a day's
//!     pay x the gap still between it and the best offer. It values it only where it knows the pay (`pay_per_day`);
//!   - **the loss** is what it expects to pay: the chance it is pursued (`pursued_bps` for unprotected action; the union
//!     learns it, counting each unprotected action it has taken and each it was pursued for, with the profile's figure as
//!     its prior) times the penalty (`penalty`, the profile's, in the smallest unit) for unprotected action.
//! It breaks the law when the gain is at least the loss, and keeps to it otherwise. A union given no `penalty` and no
//! `pursued_bps` has no measure of either and keeps to the law (the old default, `compliance_bps` 10,000, was the same).
//! Basis: Becker (1968), "Crime and punishment: an economic approach", J. Political Economy 76(2): an offence is committed
//! when its gain exceeds the expected sanction, the chance of being caught and punished times the penalty; Tyler (1990), *Why
//! People Obey the Law*: legitimacy is a further reason to comply (here: the default, no measure, is to comply). Under the
//! place's workplace-relations statute (the profile cites it: docs/behaviour/unions.md) industrial action is protected only
//! after a ballot and notice, the tribunal must order unprotected action stopped, and a union that does not comply with an
//! order is liable to penalties. The record the union learns from: a `venue_decision` against it about industrial
//! action (what a tribunal's order to it would be).
//!
//! Decided fresh in Rust: a stoppage's draws are gone (no randomness left in this module); dates counted in seconds as TS
//! counted them. The first wake is spread by who the union is (`first_wake` has no stream). Two seams, for what is other
//! lanes': a member's grievance taken up with their employer (`Grievances`: E's `Hearings`, when the world says the union
//! hears one: `hears`).

use super::{manifest_of, spread};
use crate::common::{
    addressed_to, breaches, data, filed_before, money_words, noted, starts_on, Answering, Book, Fields, DAY, MONTH,
};
use crate::papers::agreements::{offer, Offer};
use crate::steps::{because, pay, say, text, Done, Pay, Plan, Say, Step, Stepper, Visible};
use crate::{Action, Actor, Belief, Ctx, Cx, Kind, Picture};
use oikos_rules::bargaining::stops_striking;
use oikos_rules::forms::Answers;
use oikos_sight::{Record, RecordBody};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

// ------------------------------------------------------------------ the seam for a member's grievance

/// Taking up a member's grievance with their employer (docs/behaviour/frictions.md, "Venues": pay come short): put to the
/// employer, and what the union then says should be done is a recommendation with the union behind it, not an order. The
/// desk's `Hearings` (lane E) implements this; the union holds it when the world says it hears such matters (`hears`).
pub trait Grievances: Send {
    /// This wake's steps: the public notice of what the union takes up (once), and each case in hand.
    fn steps(&mut self, pic: &Picture, book: &Book, cx: &mut Cx) -> Vec<Step<()>>;
    fn save(&self) -> Value;
}

/// Builds the union's grievance hearings from the context and what `save` left (`Null`: new).
pub type GrievanceMaker = fn(&Ctx, &Value) -> Result<Box<dyn Grievances>, String>;

#[derive(Default)]
struct GrievanceSlot {
    inner: Option<Box<dyn Grievances>>,
    saved: Value,
}

impl Serialize for GrievanceSlot {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        self.inner.as_ref().map_or_else(|| self.saved.clone(), |g| g.save()).serialize(s)
    }
}
impl<'de> Deserialize<'de> for GrievanceSlot {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Ok(GrievanceSlot { inner: None, saved: Value::deserialize(d)? })
    }
}

// ------------------------------------------------------------------ the dispute

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Stage {
    Claimed,
    Settling,
    Balloting,
    Notified,
    Striking,
}

/// The ballot's figures.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
struct Tally {
    voted: i64,
    yes: i64,
    eligible: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Dispute {
    stage: Stage,
    claim: Option<String>,
    claim_bps: i64,
    /// When this stage began.
    since: i64,
    ballot: Option<String>,
    result: Option<Tally>,
    closes: Option<i64>,
    /// A stoppage: from when, until when.
    from: Option<i64>,
    until: Option<i64>,
    stoppages: i64,
    members: Vec<String>,
    /// The best offer made so far (the paper it came on, and its rise).
    standing: Option<(String, i64)>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
enum Then {
    /// A claim made: its record is what offers will answer.
    Claimed(String),
    /// A ballot called: its record is what votes are cast on.
    Balloted(String),
    /// A notice of action, which is made again if it is sent later than planned (it counts from when it is given).
    Notice { employer: String, days: i64, lead: i64, members: Vec<String>, ballot: String, tally: Tally, broke: Vec<String> },
}

/// What the union has learnt of being pursued for action the law did not protect.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct History {
    /// Unprotected stoppages it has given notice of.
    taken: i64,
    /// Decisions against it about industrial action it has seen.
    pursued: i64,
}

/// The days it must wait before it can claim again if it does not act (the three months TS gave it).
const WAIT_DAYS: i64 = 90;

pub struct Organiser {
    pub grievances: Option<GrievanceMaker>,
}

const MANIFEST: &str = include_str!("manifests/union.organiser.json");

const ANSWERS: (&str, &str) = (
    "the union's office",
    "What it acts on: an application to join; its members' votes on its ballots; and an employer's answer to a claim it has made.",
);

fn answers() -> Answers {
    Answers { office: ANSWERS.0.into(), acts: ANSWERS.1.into(), forms: vec![], report: false }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Terms {
    employers: Vec<String>,
    industries: Vec<String>,
    claim_margin_bps: i64,
    accept_share_bps: i64,
    bargain_every_days: i64,
    first_claim_days: i64,
    respond_days: i64,
    ballot_days: i64,
    ballot_turnout_bps: i64,
    ballot_pass_bps: i64,
    notice_days: i64,
    stoppage_days: Vec<i64>,
    /// A day's pay in each industry it organises, in the smallest unit (the profile's wages).
    pay_per_day: BTreeMap<String, i64>,
    between_days: i64,
    price_kind: String,
    dues: i64,
    resignation_notice_days: i64,
    dues_account: String,
    /// The chance, in basis points, that unprotected action is pursued (the prior it starts from).
    pursued_bps: Option<i64>,
    /// What being pursued for it costs the union, in the smallest unit.
    penalty: Option<i64>,
    /// How many observations the prior is worth.
    prior_weight: i64,
}

impl Kind for Organiser {
    fn name(&self) -> &'static str {
        "union.organiser"
    }
    fn version(&self) -> &'static str {
        "0.8.0"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/unions.md"
    }
    fn manifest(&self) -> Value {
        let mut m = manifest_of(MANIFEST);
        m["version"] = self.version().into();
        m["answers"] = json!({ "office": ANSWERS.0, "acts": ANSWERS.1 });
        if let Some(p) = m["params"].as_object_mut() {
            // (Retired: a union's keeping to the law is weighed, not drawn: see the module's doc.)
            p.remove("compliance_bps");
            p.insert("pursued_bps".into(), json!({ "schema": { "type": "integer", "description": "the chance unprotected action is pursued, the prior the union starts from (none: it keeps to the law)" }, "unit": "bps", "default": null, "source": "the world gives it (no default)" }));
            p.insert("penalty".into(), json!({ "schema": { "type": "integer", "description": "what being pursued for unprotected action costs the union, in the smallest unit (none: it keeps to the law)" }, "default": null, "source": "the world gives it (no default)" }));
            p.insert("prior_weight".into(), json!({ "schema": { "type": "integer", "description": "how many observations its prior chance of being pursued is worth" }, "default": 2, "source": "placeholder" }));
        }
        m
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        DAY
    }
    fn first_wake(&self, ctx: &Ctx) -> i64 {
        9 * 3600 + spread(ctx, "first-wake", 3600)
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        let p = Terms {
            employers: ctx.param("employers", vec![])?,
            industries: ctx.param("industries", vec![])?,
            claim_margin_bps: ctx.param("claim_margin_bps", 0)?,
            accept_share_bps: ctx.param("accept_share_bps", 5000)?,
            bargain_every_days: ctx.param("bargain_every_days", 365)?,
            first_claim_days: ctx.param("first_claim_days", 60)?,
            respond_days: ctx.param("respond_days", 14)?,
            ballot_days: ctx.param("ballot_days", 10)?,
            ballot_turnout_bps: ctx.param("ballot_turnout_bps", 0)?,
            ballot_pass_bps: ctx.param("ballot_pass_bps", 5000)?,
            notice_days: ctx.param("notice_days", 0)?,
            stoppage_days: ctx.param("stoppage_days", vec![1, 2, 3])?,
            pay_per_day: ctx.param("pay_per_day", BTreeMap::new())?,
            between_days: ctx.param("between_days", 7)?,
            price_kind: ctx.param("price_kind", "goods".to_string())?,
            dues: ctx.param("dues", 0)?,
            resignation_notice_days: ctx.param("resignation_notice_days", 0)?,
            dues_account: ctx.param("dues_account", String::new())?,
            pursued_bps: ctx.param("pursued_bps", None)?,
            penalty: ctx.param("penalty", None)?,
            prior_weight: ctx.param::<i64>("prior_weight", 2)?.max(1),
        };
        let hears = ctx.params.get("hears").and_then(Value::as_array).is_some_and(|h| !h.is_empty());
        let grievances = match (hears, self.grievances) {
            (true, Some(make)) => Some(make(ctx, &Value::Null)?),
            _ => None,
        };
        let u = Union {
            me: ctx.entity.clone(),
            p,
            book: Book::new(),
            disputes: BTreeMap::new(),
            agreed_at: BTreeMap::new(),
            employer_of: BTreeMap::new(),
            industry_at: BTreeMap::new(),
            prices: vec![],
            handled: BTreeSet::new(),
            stagger: BTreeMap::new(),
            offered: false,
            history: History::default(),
            counted: BTreeSet::new(),
            grievances: GrievanceSlot { inner: grievances, saved: Value::Null },
        };
        Ok(Box::new(UnionActor { inner: Answering::new(Stepper::new(u), answers()) }))
    }
    fn restore(&self, ctx: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        let inner = Stepper::<Union>::restore(saved.get("inner").and_then(|s| s.get("inner")).cloned().ok_or("union.organiser: nothing saved")?)?;
        let mut a = Answering::restore(inner, answers(), saved.get("inner").ok_or("union.organiser: nothing saved")?)?;
        if let Some(make) = self.grievances {
            let hears = ctx.params.get("hears").and_then(Value::as_array).is_some_and(|h| !h.is_empty());
            if hears {
                a.inner.plan.grievances.inner = Some(make(ctx, &a.inner.plan.grievances.saved)?);
            }
        }
        Ok(Box::new(UnionActor { inner: a }))
    }
}

/// The actor: the stepper (with letters answered), the union's beliefs for the truth audits, and the laws it could not read
/// said in its reasons (`noted`).
struct UnionActor {
    inner: Answering<Stepper<Union>>,
}

impl Actor for UnionActor {
    fn step(&mut self, pic: &Picture, cx: &mut Cx) -> Action {
        let a = self.inner.step(pic, cx);
        noted(&mut self.inner.inner.plan.book, a)
    }
    /// Where our members work, as we have it (truth audits): each a job in force with that employer.
    fn beliefs(&self) -> Vec<Belief> {
        let u = &self.inner.inner.plan;
        let members: BTreeSet<&str> = u.in_force_members();
        let closed = u.closed();
        let mut b: Vec<(&str, &str)> = u.employer_of.iter().filter(|(m, e)| !e.is_empty() && members.contains(m.as_str()) && !closed.contains(e.as_str())).map(|(m, e)| (m.as_str(), e.as_str())).collect();
        b.sort();
        b.into_iter().map(|(m, e)| Belief::Between { template: "employment".into(), parties: [e.to_string(), m.to_string()], in_force: true }).collect()
    }
    fn sent(&mut self, action: &str) {
        self.inner.sent(action)
    }
    fn save(&self) -> Result<Value, String> {
        Ok(json!({ "inner": self.inner.save()? }))
    }
}

#[derive(Serialize, Deserialize)]
struct Union {
    me: String,
    p: Terms,
    book: Book,
    /// Employer -> the dispute in hand.
    disputes: BTreeMap<String, Dispute>,
    /// Employer -> when it last agreed.
    agreed_at: BTreeMap<String, i64>,
    /// Member -> their employer, as the union has it.
    employer_of: BTreeMap<String, String>,
    /// Employer -> its industry, as a member there has said.
    industry_at: BTreeMap<String, String>,
    /// The mean shop price, monthly: (when, mean in thousandths of the smallest unit).
    prices: Vec<(i64, i64)>,
    handled: BTreeSet<String>,
    /// When each workplace's first claim is due: those known at our first plan are spread over `first_claim_days`; one we
    /// learn of later (a member starts there, or joins from there), from then.
    stagger: BTreeMap<String, i64>,
    offered: bool,
    history: History,
    /// Decisions against us already counted as being pursued.
    counted: BTreeSet<String>,
    grievances: GrievanceSlot,
}

fn pct(bps: i64) -> String {
    super::credit::pct(bps)
}

impl Union {
    fn in_force_members(&self) -> BTreeSet<&str> {
        self.book
            .of_type("agreement")
            .filter_map(|r| match &r.body {
                RecordBody::Agreement { terms } if terms.template.as_deref() == Some("membership") && terms.parties.first().map(String::as_str) == Some(&self.me) && self.book.in_force(&r.id) => {
                    terms.parties.get(1).map(String::as_str)
                }
                _ => None,
            })
            .collect()
    }

    /// Employers that have closed (their public notice): nobody to bargain with.
    fn closed(&self) -> BTreeSet<&str> {
        self.book.open("closure").filter_map(|r| data(r).s("firm").or(r.speaks_for.as_deref())).collect()
    }

    /// A weighing of whether to act where the law cannot be met by waiting (the ballot does not meet it) or keep to the law:
    /// keeping to it costs the three months before it can claim again (see the module's doc).
    fn would_break(&self, members: i64, pay_per_day: Option<i64>, gap_bps: i64) -> (bool, String) {
        let (Some(penalty), Some(prior)) = (self.p.penalty, self.p.pursued_bps) else {
            return (false, "we have no measure of what breaking it would cost us".into());
        };
        let Some(daily) = pay_per_day.filter(|d| *d > 0) else { return (false, "we cannot value what waiting costs our members".into()) };
        let gain = members as i128 * daily as i128 * gap_bps.max(0) as i128 / 10_000 * WAIT_DAYS as i128;
        let w = self.p.prior_weight as i128;
        let chance = (self.history.pursued as i128 * 10_000 + w * prior as i128) / (self.history.taken as i128 + w);
        let loss = chance * penalty as i128 / 10_000;
        (gain >= loss, format!("keeping to the law would cost our members {gain} over the {WAIT_DAYS} days before we could act again, against an expected {loss} for being pursued ({}% chance of a {penalty} penalty)", pct(chance as i64)))
    }

    /// The notice of a stoppage, as it will be given at `at` (the dispute's stoppage is counted from when it is on the
    /// record, which is later than now if a wake runs out of actions first).
    fn give(&mut self, employer: &str, at: i64, days: i64, lead: i64, members: Vec<String>, ballot: String, tally: Tally, broke: Vec<String>) -> Step<Then> {
        let from = starts_on(at, lead);
        if let Some(x) = self.disputes.get_mut(employer) {
            x.from = Some(from);
            x.until = Some(from + days * DAY);
        }
        let notice = json!({ "employer": employer, "from": from, "until": from + days * DAY, "members": members, "ballot": ballot, "voted": tally.voted, "yes": tally.yes, "eligible": tally.eligible });
        let mut to = vec![employer.to_string()];
        to.extend(members.clone());
        let mut s = because(
            format!(
                "Notice to {employer}: our members there stop work for {days} day{}, in {} days{}.",
                if days > 1 { "s" } else { "" },
                (lead + DAY / 2).div_euclid(DAY),
                if broke.is_empty() { String::new() } else { format!("; this breaches {}, and we act anyway", broke.join(", ")) }
            ),
            vec![say(
                "industrial_action",
                &format!(
                    "Notice of protected action: our members at {employer} will stop work for {days} day{} from day {}. Ballot {ballot}: {} of {} voted, {} yes.",
                    if days > 1 { "s" } else { "" },
                    from.div_euclid(DAY),
                    tally.voted,
                    tally.eligible,
                    tally.yes
                ),
                Say { to: Some(to), visible: Some(Visible::Public), data: Some(notice), ..Default::default() },
            )],
        );
        s.redo = true;
        s.then = Some(Then::Notice { employer: employer.to_string(), days, lead, members, ballot, tally, broke });
        s
    }
}

impl Plan for Union {
    type Then = Then;

    fn absorb(&mut self, pic: &Picture, _: &mut Cx) {
        self.book.absorb(pic);
    }

    #[allow(clippy::too_many_lines)]
    fn plan(&mut self, pic: &Picture, cx: &mut Cx) -> Vec<Step<Then>> {
        let (t, me) = (pic.t, self.me.clone());
        let world = cx.ctx.world.clone();
        let money = |n: i64| money_words(n, &world);
        let mut steps: Vec<Step<Then>> = vec![];
        if let Some(mut g) = self.grievances.inner.take() {
            for s in g.steps(pic, &self.book, cx) {
                steps.push(Step { lines: s.lines, why: s.why, then: None, redo: s.redo, planned: s.planned, lapses_at: s.lapses_at });
            }
            self.grievances.inner = Some(g);
        }
        // What we have learnt of being pursued: a decision against us about industrial action, once each.
        let against: Vec<String> = self
            .book
            .open("venue_decision")
            .filter(|r| data(r).s("against") == Some(&me) && data(r).s("matter") == Some("industrial_action") && !self.counted.contains(&r.id))
            .map(|r| r.id.clone())
            .collect();
        for id in against {
            self.history.pursued += 1;
            self.counted.insert(id);
        }
        // What joining is, for anyone who might (docs/design/ai-citizens.md 2a): published once, and kept up.
        if !self.offered && self.p.dues > 0 && !self.p.dues_account.is_empty() {
            self.offered = self.book.open("membership_offer").any(|r| r.speaks_for.as_deref() == Some(&me));
            if !self.offered {
                self.offered = true;
                let mut termination = vec![json!({ "party": me, "notice": MONTH })];
                if self.p.resignation_notice_days > 0 {
                    termination.push(json!({ "party": "taker", "notice": self.p.resignation_notice_days * DAY }));
                }
                let terms = json!({ "template": "membership", "commitments": [
                    { "who": me, "does": { "text": "Represents the member at work, and bargains for them." } },
                    { "who": "taker", "does": { "outcome": { "money": { "to": self.p.dues_account, "amount": self.p.dues.to_string(), "for": "Union dues." } } }, "every": MONTH },
                ], "termination": termination });
                steps.push(because(
                    "Saying what joining us is: we represent members at work and bargain for them; dues are paid monthly.",
                    vec![say(
                        "membership_offer",
                        &format!("Join the union: we represent you at work and bargain for you. Dues: {} a month. Apply to us to join.", money(self.p.dues)),
                        Say { visible: Some(Visible::Public), extra: vec![("offer", json!({ "by": me, "take_up": "join", "terms": terms }))], ..Default::default() },
                    )],
                ));
            }
        }
        // Members: the register at the start, and those who have joined since (membership agreements in force).
        let registers: Vec<Arc<Record>> = self.book.all("membership_register").cloned().collect();
        for r in registers {
            for m in data(&r).get("members").and_then(Value::as_array).into_iter().flatten() {
                let (Some(member), Some(employer)) = (m.s("member"), m.s("employer")) else { continue };
                if !self.employer_of.contains_key(member) {
                    self.employer_of.insert(member.to_string(), employer.to_string());
                    if let Some(i) = m.s("industry") {
                        self.industry_at.insert(employer.to_string(), i.to_string());
                    }
                }
            }
        }
        let in_force: BTreeSet<String> = self.in_force_members().into_iter().map(String::from).collect();
        // Applications to join: a membership offered, its dues by standing order.
        let applications: Vec<Arc<Record>> = self.book.open("membership_application").filter(|a| !self.handled.contains(&a.id) && addressed_to(a).contains(&me)).cloned().collect();
        for a in applications {
            self.handled.insert(a.id.clone());
            let who = a.speaks_for.clone().unwrap_or_default();
            if let Some(e) = data(&a).s("employer") {
                self.employer_of.insert(who.clone(), e.to_string());
                if let Some(i) = data(&a).s("industry") {
                    self.industry_at.insert(e.to_string(), i.to_string());
                }
            }
            if in_force.contains(&who) {
                continue;
            }
            let mut c = offer(
                &who,
                Offer {
                    template: "membership".into(),
                    our_notice: Some(MONTH),
                    their_notice: (self.p.resignation_notice_days > 0).then_some(self.p.resignation_notice_days * DAY),
                    they: Some(pay(&self.p.dues_account, self.p.dues, Pay { every: Some(MONTH), for_: Some("Union dues.".into()), ..Default::default() }, cx)),
                    text: Some(format!("{who} is a member of {me}, paying dues of {} a month.", money(self.p.dues))),
                    basis: Some(a.id.clone()),
                    ..Default::default()
                },
            );
            // (What we do is words, not a payment: the agreement's `we_do` is text.)
            c.args.push(("we_do".into(), text(format!("{me} represents {who} at work, and bargains for them."))));
            steps.push(because(format!("{who} asks to join: offering membership, {} a month in dues.", money(self.p.dues)), vec![c]));
        }
        // Members who have told us where they now work (or that they are out of work: no employer).
        let updates: Vec<Arc<Record>> = self.book.open("membership_update").filter(|u| !self.handled.contains(&u.id) && addressed_to(u).contains(&me)).cloned().collect();
        for u in updates {
            self.handled.insert(u.id.clone());
            let employer = data(&u).s("employer").unwrap_or_default().to_string();
            self.employer_of.insert(u.speaks_for.clone().unwrap_or_default(), employer.clone());
            if let (false, Some(i)) = (employer.is_empty(), data(&u).s("industry")) {
                self.industry_at.insert(employer, i.to_string());
            }
        }
        let closed: BTreeSet<String> = self.closed().into_iter().map(String::from).collect();
        let members_at = |this: &Union, employer: &str| -> Vec<String> {
            let mut v: Vec<String> = this.employer_of.iter().filter(|(m, e)| e.as_str() == employer && in_force.contains(m.as_str())).map(|(m, _)| m.clone()).collect();
            v.sort();
            v
        };

        // Prices: the published index (the statistician's mean of shop prices), as last read, once a month. Nobody is shown
        // every shop's prices (docs/no-god-view.md).
        if self.prices.last().is_none_or(|(at, _)| t - *at >= MONTH) {
            let index = self.book.open("price_index").filter(|r| data(r).s("kind") == Some(&self.p.price_kind) && data(r).get("mean").is_some_and(Value::is_number)).max_by(|a, b| a.at.cmp(&b.at).then_with(|| filed_before(&b.id, &a.id)));
            if let Some(mean) = index.and_then(|i| data(i).get("mean").and_then(|m| super::scaled(m, 1_000))) {
                self.prices.push((t, mean));
            }
        }
        // Workplaces: where our members work, as they have told us, and any we were told of at the start.
        let ours = |this: &Union, e: &str| this.p.industries.is_empty() || this.p.industries.iter().any(|i| Some(i.as_str()) == Some(this.industry_at.get(e).map_or("", String::as_str)));
        let mut workplaces: BTreeSet<String> = self.p.employers.iter().cloned().collect();
        for (m, e) in &self.employer_of {
            if !e.is_empty() && in_force.contains(m) && ours(self, e) {
                workplaces.insert(e.clone());
            }
        }
        let first = self.stagger.is_empty();
        let n = workplaces.len() as i64;
        for (i, e) in workplaces.iter().enumerate() {
            if !self.stagger.contains_key(e) {
                self.stagger.insert(e.clone(), if first { ((i as i64 + 1) * self.p.first_claim_days * DAY) / n.max(1) } else { t });
            }
        }
        let year_ago = self.prices.iter().rev().find(|(at, _)| t - at >= 365 * DAY).copied();
        // (Prices are the statistician's, which may be fractional, held in thousandths: a rate rounded half up, as the claim
        // is made in whole basis points.)
        let inflation = match (year_ago, self.prices.last()) {
            (Some((_, then)), Some((_, now))) if then != 0 => (2 * (now - then) as i128 * 10_000 + then as i128).div_euclid(2 * then as i128) as i64,
            _ => 0,
        };

        for employer in workplaces {
            if closed.contains(&employer) {
                if self.disputes.remove(&employer).is_some() {
                    steps.push(because(format!("{employer} has closed: our dispute there is over."), vec![]));
                }
                continue;
            }
            let members = members_at(self, &employer);
            // An enterprise agreement made: the dispute's over.
            let agreements: Vec<Arc<Record>> =
                self.book.open("enterprise_agreement").filter(|r| !self.handled.contains(&r.id) && addressed_to(r).contains(&me) && data(r).s("employer") == Some(&employer)).cloned().collect();
            for ea in agreements {
                self.handled.insert(ea.id.clone());
                self.disputes.remove(&employer);
                self.agreed_at.insert(employer.clone(), t);
            }
            if !self.disputes.contains_key(&employer) {
                let due = t >= self.stagger.get(&employer).copied().unwrap_or(0) && self.agreed_at.get(&employer).is_none_or(|a| t - a >= self.p.bargain_every_days * DAY);
                if !due || members.is_empty() {
                    continue;
                }
                let claim_bps = inflation.max(0) + self.p.claim_margin_bps;
                self.disputes.insert(
                    employer.clone(),
                    Dispute { stage: Stage::Claimed, claim: None, claim_bps, since: t, ballot: None, result: None, closes: None, from: None, until: None, stoppages: 0, members: members.clone(), standing: None },
                );
                let mut st = because(
                    format!(
                        "Bargaining for our {} member{} at {employer}: claiming {}% (prices up {}% on a year ago, and {}% more).",
                        members.len(),
                        if members.len() > 1 { "s" } else { "" },
                        pct(claim_bps),
                        pct(inflation.max(0)),
                        pct(self.p.claim_margin_bps)
                    ),
                    vec![say(
                        "wage_claim",
                        &format!("A claim for a wage rise of {}% for everyone at {employer}.", pct(claim_bps)),
                        Say {
                            to: Some(vec![employer.clone()]),
                            visible: Some(Visible::Only(vec![me.clone(), employer.clone()])),
                            data: Some(json!({ "employer": employer, "rise_bps": claim_bps, "members": members.len() })),
                            ..Default::default()
                        },
                    )],
                );
                st.lines[0].bind = Some("claim".into());
                st.then = Some(Then::Claimed(employer.clone()));
                steps.push(st);
                continue;
            }
            // Nobody of ours works there now (they have moved on, and told us): there is no one to bargain for.
            if members.is_empty() {
                self.disputes.remove(&employer);
                steps.push(because(format!("None of our members works at {employer} now: our dispute there is over."), vec![]));
                continue;
            }
            // An offer: accepted if it is enough; otherwise (and if none comes) to a ballot, or the next stoppage.
            let claim = self.disputes[&employer].claim.clone();
            let mut offers: Vec<Arc<Record>> = self
                .book
                .open("wage_offer")
                .filter(|o| !self.handled.contains(&o.id) && addressed_to(o).contains(&me) && data(o).s("employer") == Some(&employer) && data(o).s("claim").map(String::from) == claim)
                .cloned()
                .collect();
            offers.sort_by(|a, b| b.at.cmp(&a.at));
            let best = offers.first().cloned();
            for o in &offers {
                self.handled.insert(o.id.clone());
            }
            let rise_of = |o: &Record| data(o).get("rise_bps").map_or(0, |v| crate::papers::lenient::whole(v).unwrap_or(0));
            // The best offer made so far stands, though the paper it came on is read.
            {
                let x = self.disputes.get_mut(&employer).expect("in hand");
                for o in &offers {
                    if rise_of(o) > x.standing.as_ref().map_or(-1, |s| s.1) {
                        x.standing = Some((o.id.clone(), rise_of(o)));
                    }
                }
            }
            let x = self.disputes[&employer].clone();
            let enough = |o: &Record| rise_of(o) * 10_000 >= x.claim_bps * self.p.accept_share_bps;
            if let (Some(best), Stage::Claimed) = (&best, x.stage) {
                if enough(best) {
                    let d = self.disputes.get_mut(&employer).expect("in hand");
                    d.stage = Stage::Settling;
                    d.since = t;
                    steps.push(because(
                        format!("{employer} offers {}%, at least {}% of our claim: accepting.", pct(rise_of(best)), pct(self.p.accept_share_bps)),
                        vec![say(
                            "offer_accepted",
                            &format!("We accept the offer of {}%.", pct(rise_of(best))),
                            Say {
                                to: Some(vec![employer.clone()]),
                                visible: Some(Visible::Only(vec![me.clone(), employer.clone()])),
                                basis: Some(best.id.clone()),
                                data: Some(json!({ "employer": employer, "claim": x.claim, "rise_bps": data(best).get("rise_bps") })),
                                ..Default::default()
                            },
                        )],
                    ));
                    continue;
                }
            }
            if x.stage == Stage::Claimed && x.stoppages == 0 && (best.is_some() || t - x.since >= self.p.respond_days * DAY) {
                let closes = t + self.p.ballot_days * DAY;
                let d = self.disputes.get_mut(&employer).expect("in hand");
                d.stage = Stage::Balloting;
                d.since = t;
                d.members = members.clone();
                d.closes = Some(closes);
                let mut to = members.clone();
                let mut seen = vec![me.clone()];
                seen.extend(members.clone());
                let mut st = because(
                    if let Some(b) = &best { format!("{employer} offers only {}%: balloting our members there on protected action.", pct(rise_of(b))) } else { format!("No offer from {employer}: balloting our members there on protected action.") },
                    vec![say(
                        "action_ballot",
                        &format!("Protected action ballot of our members at {employer}: do you approve stoppages of work, in support of our claim of {}%?", pct(x.claim_bps)),
                        Say { to: Some(std::mem::take(&mut to)), visible: Some(Visible::Only(seen)), data: Some(json!({ "employer": employer, "claim": x.claim, "closes": closes })), ..Default::default() },
                    )],
                );
                st.lines[0].bind = Some("ballot".into());
                st.then = Some(Then::Balloted(employer.clone()));
                steps.push(st);
                continue;
            }
            let mut x = x;
            if x.stage == Stage::Balloting && x.closes.is_some_and(|c| t >= c) {
                let voter = |r: &Record| r.speaks_for.clone().unwrap_or_else(|| r.author.clone());
                let mut votes: Vec<&Arc<Record>> = self
                    .book
                    .of_type("vote")
                    .filter(|r| matches!(&r.body, RecordBody::Vote { ballot, .. } if Some(ballot) == x.ballot.as_ref()) && x.members.contains(&voter(r)))
                    .collect();
                votes.sort_by_key(|a| a.at);
                let mut latest: BTreeMap<String, String> = BTreeMap::new();
                for v in votes {
                    if let RecordBody::Vote { choice, .. } = &v.body {
                        latest.insert(voter(v), choice.clone());
                    }
                }
                let voted = latest.len() as i64;
                let yes = latest.values().filter(|c| c.as_str() == "yes").count() as i64;
                let eligible = x.members.len() as i64;
                let passed = voted * 10_000 >= self.p.ballot_turnout_bps * eligible && yes * 10_000 > self.p.ballot_pass_bps * voted;
                x.result = Some(Tally { voted, yes, eligible });
                let mut to = vec![employer.clone()];
                to.extend(x.members.clone());
                let mut seen = vec![me.clone(), employer.clone()];
                seen.extend(x.members.clone());
                steps.push(because(
                    format!("The ballot at {employer}: {voted} of {eligible} voted, {yes} yes: {}.", if passed { "protected action is approved" } else { "not approved" }),
                    vec![say(
                        "ballot_result",
                        &format!("Protected action ballot at {employer}: {voted} of {eligible} members voted, {yes} yes; {}.", if passed { "approved" } else { "not approved" }),
                        Say {
                            to: Some(to),
                            visible: Some(Visible::Only(seen)),
                            basis: x.ballot.clone(),
                            data: Some(json!({ "employer": employer, "ballot": x.ballot, "voted": voted, "yes": yes, "eligible": eligible, "passed": passed })),
                            ..Default::default()
                        },
                    )],
                ));
                if !passed {
                    // No mandate: we let it rest, and claim again in three months.
                    self.disputes.remove(&employer);
                    self.agreed_at.insert(employer.clone(), t - self.p.bargain_every_days * DAY + 90 * DAY);
                    continue;
                }
                x.stage = Stage::Claimed; // approved: notice of the first stoppage follows at once
                x.since = t - self.p.between_days * DAY;
                self.disputes.insert(employer.clone(), x.clone());
            }
            // Approved (or back from a stoppage) without an offer we accept: notice of the next stoppage.
            if x.stage == Stage::Claimed && x.ballot.is_some() && t - x.since >= self.p.between_days * DAY {
                let days = self.p.stoppage_days.get((x.stoppages as usize).min(self.p.stoppage_days.len().saturating_sub(1))).copied().unwrap_or(1);
                let daily = self.p.pay_per_day.get(self.industry_at.get(&employer).map_or("", String::as_str)).copied().filter(|d| *d > 0);
                // After a stoppage, what the next costs our members in pay against what the rest of the gap would add for
                // them over a year (Hicks 1932, the resistance curve: resistance falls as the cost of holding out rises). If
                // the cost is the larger, we stop striking: we take the offer standing, if it is more than nothing; else the
                // dispute rests, and we claim again in three months.
                if let (true, Some(daily)) = (x.stoppages > 0, daily) {
                    let standing = x.standing.as_ref().map_or(0, |s| s.1);
                    let w = stops_striking(members.len() as i64, days, daily, x.claim_bps, standing);
                    if w.stop {
                        let n = x.stoppages;
                        let plural = if n > 1 { "s" } else { "" };
                        match x.standing.clone().filter(|_| standing > 0) {
                            Some((id, _)) => {
                                let d = self.disputes.get_mut(&employer).expect("in hand");
                                d.stage = Stage::Settling;
                                d.since = t;
                                steps.push(because(
                                    format!(
                                        "{n} stoppage{plural} at {employer}: another {days} day{} would cost our {} members {} in pay, and the {}% still between us and our claim would add {} over a year: no more stoppages. Accepting the {}% offered.",
                                        if days > 1 { "s" } else { "" },
                                        members.len(),
                                        money(w.cost),
                                        pct(x.claim_bps - standing),
                                        money(w.gain),
                                        pct(standing)
                                    ),
                                    vec![say(
                                        "offer_accepted",
                                        &format!("We accept the offer of {}%.", pct(standing)),
                                        Say {
                                            to: Some(vec![employer.clone()]),
                                            visible: Some(Visible::Only(vec![me.clone(), employer.clone()])),
                                            basis: Some(id),
                                            data: Some(json!({ "employer": employer, "claim": x.claim, "rise_bps": standing })),
                                            ..Default::default()
                                        },
                                    )],
                                ));
                            }
                            None => {
                                steps.push(because(
                                    format!(
                                        "{n} stoppage{plural} at {employer}, and no offer: another {days} day{} would cost our members {} in pay against {} more over a year if the claim were met: no more stoppages. We'll claim again in three months.",
                                        if days > 1 { "s" } else { "" },
                                        money(w.cost),
                                        money(w.gain)
                                    ),
                                    vec![],
                                ));
                                self.disputes.remove(&employer);
                                self.agreed_at.insert(employer.clone(), t - self.p.bargain_every_days * DAY + 90 * DAY);
                            }
                        }
                        continue;
                    }
                }
                // The notice states the ballot's figures, as a notice of protected action does. The law as we read it: the
                // soonest a stoppage can start without breaching a law in force, a day at a time; if none within a month (the
                // ballot does not meet the law, say), no action, unless we weigh it and act anyway.
                let r = x.result.unwrap_or(Tally { voted: 0, yes: 0, eligible: members.len() as i64 });
                let ballot = x.ballot.clone().unwrap_or_default();
                let act = |from: i64| {
                    let mut d = Map::new();
                    for (k, v) in [("employer", json!(employer)), ("from", json!(from)), ("until", json!(from + days * DAY)), ("members", json!(members)), ("ballot", json!(ballot)), ("voted", json!(r.voted)), ("yes", json!(r.yes)), ("eligible", json!(r.eligible))] {
                        d.insert(k.into(), v);
                    }
                    json!({ "block": "publish", "kind": "industrial_action", "data": Value::Object(d) })
                };
                // A stoppage starts with a day: the first to begin once the notice has run. (Until 2026-10-06 it started to
                // the second, counted from when we decided; the notice is on the record a moment later, so one given on
                // exactly the law's period was short of it by that moment: the landlord's fault of 0.12.1, here.)
                let mut lead = self.p.notice_days * DAY;
                let mut broken = breaches(&mut self.book, &act(starts_on(t, lead)), &me, t);
                while !broken.is_empty() && lead < (self.p.notice_days + 30) * DAY {
                    lead += DAY;
                    broken = breaches(&mut self.book, &act(starts_on(t, lead)), &me, t);
                }
                let broke: Vec<String> = broken.iter().map(|l| l.id.clone()).collect();
                if !broke.is_empty() {
                    // (No wait of up to a month makes it lawful: the ballot does not meet the law.)
                    let (breaks, weighed) = self.would_break(members.len() as i64, daily, x.claim_bps - x.standing.as_ref().map_or(0, |s| s.1));
                    if !breaks {
                        steps.push(because(format!("Action at {employer} would breach {}: no action ({weighed}). We'll claim again in three months.", broke.join(", ")), vec![]));
                        self.disputes.remove(&employer);
                        self.agreed_at.insert(employer.clone(), t - self.p.bargain_every_days * DAY + 90 * DAY);
                        continue;
                    }
                    self.history.taken += 1;
                    lead = self.p.notice_days * DAY;
                }
                let d = self.disputes.get_mut(&employer).expect("in hand");
                d.stage = Stage::Notified;
                d.members = members.clone();
                // The notice counts from when it is given (later than now, if a wake runs out of actions first).
                steps.push(self.give(&employer, t, days, lead, members.clone(), ballot, r, broke));
                continue;
            }
            if x.stage == Stage::Notified && x.from.is_some_and(|f| t >= f) {
                let d = self.disputes.get_mut(&employer).expect("in hand");
                d.stage = Stage::Striking;
                let until = x.until.unwrap_or(t);
                let mut to = vec![employer.clone()];
                to.extend(x.members.clone());
                let mut seen = vec![me.clone()];
                seen.extend(to.clone());
                steps.push(because(
                    format!("Our members at {employer} stop work."),
                    vec![say(
                        "stop_work",
                        &format!("Stop work at {employer}, until day {}.", until.div_euclid(DAY)),
                        Say { to: Some(to), visible: Some(Visible::Only(seen)), data: Some(json!({ "employer": employer, "until": until, "members": x.members })), ..Default::default() },
                    )],
                ));
                continue;
            }
            if x.stage == Stage::Striking && x.until.is_some_and(|u| t >= u) {
                let d = self.disputes.get_mut(&employer).expect("in hand");
                d.stage = Stage::Claimed;
                d.since = t;
                d.stoppages += 1;
                let mut to = vec![employer.clone()];
                to.extend(x.members.clone());
                let mut seen = vec![me.clone()];
                seen.extend(to.clone());
                steps.push(because(
                    format!("The stoppage at {employer} is over: our members return to work."),
                    vec![say("return_to_work", &format!("Return to work at {employer}."), Say { to: Some(to), visible: Some(Visible::Only(seen)), data: Some(json!({ "employer": employer, "members": x.members })), ..Default::default() })],
                ));
            }
        }
        steps
    }

    fn then(&mut self, token: &Then, done: Done, _cx: &mut Cx) -> Vec<Step<Then>> {
        let created = |key: &str| match done {
            Done::Outcome(o) => o.created.as_ref().and_then(|c| c.get(key)).cloned(),
            Done::NotDone(_) => None,
        };
        match token {
            Then::Claimed(employer) => {
                if let (Some(id), Some(d)) = (created("claim"), self.disputes.get_mut(employer)) {
                    d.claim = Some(id);
                }
            }
            Then::Balloted(employer) => {
                if let (Some(id), Some(d)) = (created("ballot"), self.disputes.get_mut(employer)) {
                    d.ballot = Some(id);
                }
            }
            Then::Notice { .. } => {}
        }
        vec![]
    }

    fn redo(&mut self, step: Step<Then>, t: i64) -> Step<Then> {
        match step.then.clone() {
            Some(Then::Notice { employer, days, lead, members, ballot, tally, broke }) => self.give(&employer, t, days, lead, members, ballot, tally, broke),
            _ => step,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::finance::kit::{arg, json_arg, records, statement, Rig, DAY, MONTH};
    use oikos_sight::calls::Call;

    const UNION: &str = "union";

    fn union(params: Value) -> Rig {
        let mut p = json!({ "employers": ["shop-1"], "claim_margin_bps": 500, "accept_share_bps": 9900, "first_claim_days": 1, "dues": 2500, "dues_account": "acc-union", "pay_per_day": { "retail": 10_000 } });
        p.as_object_mut().unwrap().extend(params.as_object().unwrap().clone());
        Rig::new(&Organiser { grievances: None }, UNION, "union-organiser-system", p)
    }
    fn members() -> Vec<Value> {
        let listed: Vec<Value> = ["m1", "m2", "m3"].iter().map(|m| json!({ "member": m, "employer": "shop-1", "industry": "retail" })).collect();
        let mut rs = vec![statement("union-register", 0, "membership_register", json!({ "speaks_for": UNION, "visible_to": [UNION] }), json!({ "members": listed }))];
        for m in ["m1", "m2", "m3"] {
            rs.push(json!({ "id": format!("mem-{m}"), "record": "agreement", "author": "genesis", "at": 0, "visible_to": [UNION, m], "terms": { "template": "membership", "parties": [UNION, m], "commitments": [{ "who": UNION, "does": { "text": "Represents them." } }] } }));
            for p in [UNION, m] {
                rs.push(json!({ "id": format!("mem-{m}-sig-{p}"), "record": "signature", "author": "genesis", "at": 0, "visible_to": [UNION, m], "speaks_for": p, "agreement": format!("mem-{m}"), "as": p }));
            }
        }
        rs
    }
    fn day(m: &mut Rig, d: i64, rs: Vec<Value>) -> Vec<Call> {
        m.at(d * DAY, json!({ "union-business": records(rs) }), json!([]))
    }
    fn kinds(said: &[Call]) -> Vec<String> {
        said.iter().filter_map(|c| arg(c, "kind")).collect()
    }
    fn dispute(m: &Rig) -> Value {
        m.actor.save().unwrap().pointer("/inner/inner/plan/disputes/shop-1").cloned().unwrap_or(Value::Null)
    }
    fn offer_of(id: &str, at: i64, claim: &str, rise_bps: i64) -> Value {
        statement(id, at, "wage_offer", json!({ "speaks_for": "shop-1", "addressed_to": [UNION], "visible_to": [UNION, "shop-1"] }), json!({ "employer": "shop-1", "claim": claim, "rise_bps": rise_bps }))
    }
    fn votes(ballot: &str, at: i64, who: &[&str], choice: &str) -> Vec<Value> {
        who.iter().map(|w| json!({ "id": format!("v-{w}"), "record": "vote", "at": at, "author": format!("{w}-self"), "speaks_for": w, "ballot": ballot, "choice": choice, "visible_to": [UNION] })).collect()
    }
    fn data(c: &Call) -> Value {
        json_arg(c, "data")
    }
    /// A union that has made its claim and been offered a rise too low (day 3), and balloted (the ballot closes at day 13).
    fn balloted(params: Value) -> Rig {
        let mut m = union(params.clone());
        day(&mut m, 0, members());
        let claim = day(&mut m, 2, vec![]);
        assert_eq!(kinds(&claim), ["wage_claim"]);
        assert_eq!(data(&claim[0])["rise_bps"].as_i64(), Some(params.get("claim_margin_bps").and_then(Value::as_i64).unwrap_or(500)));
        assert_eq!(data(&claim[0])["members"], 3);
        let id = dispute(&m)["claim"].as_str().unwrap().to_string();
        let ballot = day(&mut m, 3, vec![offer_of("o1", 3 * DAY, &id, 100)]);
        assert_eq!(kinds(&ballot), ["action_ballot"]);
        m
    }

    #[test]
    fn a_union_that_hears_its_members_grievances_says_so_once_and_puts_one_to_the_employer() {
        let mut m = Rig::new(
            &Organiser { grievances: Some(crate::offices::hearing::union_cases) },
            UNION,
            "union-organiser-system",
            json!({ "employers": ["shop-1"], "claim_margin_bps": 500, "accept_share_bps": 9900, "first_claim_days": 100, "dues": 0, "pay_per_day": { "retail": 10_000 },
                "hears": [{ "about": "pay_short" }], "answer_days": 7 }),
        );
        let first = day(&mut m, 0, members());
        assert_eq!(kinds(&first).iter().filter(|k| *k == "hearing").count(), 1, "{:?}", kinds(&first));
        let notice = first.iter().find(|c| arg(c, "kind").as_deref() == Some("hearing")).unwrap();
        assert_eq!(data(notice)["hears"], json!(["pay_short"]));
        // The offer says whom it is open to (the union's members) and what the union can do for them: represent.
        let offer = json_arg(notice, "offer");
        assert_eq!(offer["to"]["members_of"], UNION);
        assert_eq!(offer["hears"][0]["can"], json!(["represent"]));
        assert!(!kinds(&day(&mut m, 1, vec![])).contains(&"hearing".to_string()), "said once");
        // A member's application about pay short, against their employer: put to the employer, who is given time to answer.
        let app = statement("rec.40", 2 * DAY, "application", json!({ "speaks_for": "m1", "addressed_to": [UNION], "visible_to": ["m1", UNION] }), json!({ "matter": "pay_short", "against": "shop-1", "amount": 5000, "account": "acc-m1" }));
        let put = day(&mut m, 2, vec![app]);
        assert!(kinds(&put).contains(&"complaint_notice".to_string()), "{:?}", kinds(&put));
        let n = put.iter().find(|c| arg(c, "kind").as_deref() == Some("complaint_notice")).unwrap();
        assert_eq!(data(n)["against"], "shop-1");
    }

    #[test]
    fn it_says_what_joining_is_once_and_offers_a_membership_to_whoever_applies_dues_by_standing_order() {
        let mut m = union(json!({}));
        let first = day(&mut m, 0, members());
        let offer = first.iter().find(|c| arg(c, "kind").as_deref() == Some("membership_offer")).expect("it says what joining is");
        assert_eq!(arg(offer, "visible").as_deref(), Some("public"));
        assert!(arg(offer, "text").unwrap().contains("Dues: $25.00 a month"));
        assert!(day(&mut m, 1, vec![]).iter().all(|c| arg(c, "kind").as_deref() != Some("membership_offer")), "once");
        let apply = statement("app1", 5 * DAY, "membership_application", json!({ "speaks_for": "m9", "addressed_to": [UNION], "visible_to": ["m9", UNION] }), json!({ "employer": "shop-1", "industry": "retail" }));
        let said = day(&mut m, 5, vec![apply]);
        let agreement = said.iter().find(|c| c.fn_ == "agreement").expect("it offers a membership");
        assert_eq!((arg(agreement, "with").unwrap(), arg(agreement, "template").unwrap(), arg(agreement, "basis").unwrap()), ("m9".to_string(), "membership".to_string(), "app1".to_string()));
        assert_eq!(arg(agreement, "we_do").unwrap(), "union represents m9 at work, and bargains for them.");
        assert!(matches!(agreement.get("they_do"), Some(oikos_sight::calls::Value::Call(c)) if c.fn_ == "money" && arg(c, "amount").as_deref() == Some("$25.00")));
    }

    #[test]
    fn it_claims_the_years_rise_in_prices_and_a_margin_accepts_an_offer_of_enough_of_it_and_claims_again_a_year_on() {
        let mut m = union(json!({ "accept_share_bps": 9000 }));
        // The statistician's mean of shop prices (published; nobody is shown every shop).
        let index = |id: &str, at: i64, mean: i64| statement(id, at, "price_index", json!({}), json!({ "kind": "goods", "mean": mean }));
        day(&mut m, 0, [members(), vec![index("p0", 0, 10_000)]].concat());
        let first = day(&mut m, 2, vec![]);
        assert_eq!(kinds(&first), ["wage_claim"]);
        assert_eq!(data(&first[0])["rise_bps"], 500, "no year of prices yet: the margin alone");
        let id = dispute(&m)["claim"].as_str().unwrap().to_string();
        // 90% of 500 is 450: an offer of 450 is accepted at once.
        let accepted = day(&mut m, 3, vec![offer_of("o1", 3 * DAY, &id, 450)]);
        assert_eq!(kinds(&accepted), ["offer_accepted"]);
        assert_eq!((data(&accepted[0])["rise_bps"].as_i64(), arg(&accepted[0], "basis")), (Some(450), Some("o1".to_string())));
        // The employer makes it an enterprise agreement: the dispute is over.
        let ea = statement("ea1", 4 * DAY, "enterprise_agreement", json!({ "speaks_for": "shop-1", "addressed_to": [UNION] }), json!({ "employer": "shop-1" }));
        assert!(day(&mut m, 4, vec![ea]).is_empty());
        assert!(dispute(&m).is_null());
        assert!(day(&mut m, 200, vec![]).is_empty(), "not again within the year");
        // A year on, prices up 6% on a year ago (10,000 -> 10,600), and 5% more.
        let again = day(&mut m, 369, vec![index("p2", 368 * DAY, 10_600)]);
        assert_eq!(kinds(&again), ["wage_claim"]);
        assert_eq!(data(&again[0])["rise_bps"], 600 + 500);
        // An offer under 90% of it is not enough: to a ballot.
        let id = dispute(&m)["claim"].as_str().unwrap().to_string();
        assert_eq!(kinds(&day(&mut m, 370, vec![offer_of("o2", 370 * DAY, &id, 980)])), ["action_ballot"]);
    }

    #[test]
    fn an_offer_too_low_goes_to_a_ballot_then_notice_then_a_stoppage_then_back_to_work_and_the_next_stoppage_is_longer() {
        let mut m = balloted(json!({}));
        let ballot = dispute(&m)["ballot"].as_str().unwrap().to_string();
        // Nothing before the ballot closes. At the close: all three vote yes, it passes, and notice is given at once.
        assert!(day(&mut m, 8, votes(&ballot, 8 * DAY, &["m1", "m2", "m3"], "yes")).is_empty());
        let result = day(&mut m, 14, vec![]);
        assert_eq!(kinds(&result), ["ballot_result", "industrial_action"]);
        assert_eq!((data(&result[0])["voted"].as_i64(), data(&result[0])["yes"].as_i64(), data(&result[0])["passed"].as_bool()), (Some(3), Some(3), Some(true)));
        let notice = data(&result[1]);
        assert_eq!((notice["from"].as_i64(), notice["until"].as_i64()), (Some(15 * DAY), Some(16 * DAY)), "a stoppage starts with a day: the first to begin once the notice has run");
        assert_eq!((notice["voted"].as_i64(), notice["yes"].as_i64(), notice["eligible"].as_i64()), (Some(3), Some(3), Some(3)));
        assert_eq!(arg(&result[1], "visible").as_deref(), Some("public"));
        // On the day it starts, they stop work; at its end they return.
        assert_eq!(kinds(&day(&mut m, 15, vec![])), ["stop_work"]);
        assert!(day(&mut m, 15, vec![]).is_empty());
        assert_eq!(kinds(&day(&mut m, 16, vec![])), ["return_to_work"]);
        // A week after, with no offer it accepts, the next stoppage: two days, as the union's stoppages grow.
        assert!(day(&mut m, 22, vec![]).is_empty());
        let second = day(&mut m, 23, vec![]);
        assert_eq!(kinds(&second), ["industrial_action"]);
        assert_eq!(data(&second[0])["until"].as_i64().unwrap() - data(&second[0])["from"].as_i64().unwrap(), 2 * DAY);
        assert_eq!(dispute(&m)["stoppages"], 1);
    }

    #[test]
    fn a_ballot_that_does_not_pass_is_no_mandate_the_union_lets_it_rest_and_claims_again_in_three_months() {
        let mut m = balloted(json!({ "ballot_turnout_bps": 5000 }));
        let ballot = dispute(&m)["ballot"].as_str().unwrap().to_string();
        let said = day(&mut m, 14, votes(&ballot, 9 * DAY, &["m1"], "yes"));
        assert_eq!(kinds(&said), ["ballot_result"]);
        assert_eq!(data(&said[0])["passed"], false, "one of three voting is not half");
        assert!(dispute(&m).is_null());
        assert!(day(&mut m, 20, vec![]).is_empty());
        assert!(!day(&mut m, 14 + 90 + 2, vec![]).is_empty(), "three months on it claims again");
    }

    #[test]
    fn it_stops_striking_when_the_next_stoppage_would_cost_its_members_more_than_the_gap_would_add_and_takes_the_offer_standing() {
        let mut m = balloted(json!({}));
        let (ballot, claim) = (dispute(&m)["ballot"].as_str().unwrap().to_string(), dispute(&m)["claim"].as_str().unwrap().to_string());
        day(&mut m, 8, votes(&ballot, 8 * DAY, &["m1", "m2", "m3"], "yes"));
        day(&mut m, 14, vec![]);
        day(&mut m, 15, vec![]);
        day(&mut m, 16, vec![]);
        // Day 17: the employer comes up to 4.8% against a claim of 5% (still under 99% of it: not accepted at once).
        assert!(day(&mut m, 17, vec![offer_of("o2", 17 * DAY, &claim, 480)]).is_empty());
        assert_eq!(dispute(&m)["standing"], json!(["o2", 480]));
        // A week after the stoppage: another two days would cost 3 members x 2 days x $100 = $600 in pay; the 0.2% still between
        // them and their claim would add 3 x $100 x 365 x 0.2% = $219 over a year. It stops, and takes the 4.8%.
        let said = day(&mut m, 23, vec![]);
        assert_eq!(kinds(&said), ["offer_accepted"], "{said:?}");
        assert_eq!((data(&said[0])["rise_bps"].as_i64(), arg(&said[0], "basis")), (Some(480), Some("o2".to_string())));
        assert!(m.actor.save().unwrap().pointer("/inner/inner/plan/disputes/shop-1/stage").unwrap() == "settling");
    }

    #[test]
    fn with_no_offer_standing_it_lets_the_dispute_rest_rather_than_strike_for_a_gain_smaller_than_the_loss() {
        // A claim of 5% against a standing offer of nothing: the gap is worth 3 x $100 x 365 x 5% = $5,475 a year, so it
        // keeps striking while two days cost $600. With a tiny claim the gap is worth less than one day's pay.
        let mut m = union(json!({ "claim_margin_bps": 1, "stoppage_days": [2] }));
        day(&mut m, 0, members());
        day(&mut m, 2, vec![]);
        let claim = dispute(&m)["claim"].as_str().unwrap().to_string();
        day(&mut m, 3, vec![offer_of("o1", 3 * DAY, &claim, 0)]);
        let ballot = dispute(&m)["ballot"].as_str().unwrap().to_string();
        day(&mut m, 8, votes(&ballot, 8 * DAY, &["m1", "m2", "m3"], "yes"));
        let first = day(&mut m, 14, vec![]);
        assert!(kinds(&first).contains(&"industrial_action".to_string()), "the first stoppage is called: it weighs the cost only after one");
        day(&mut m, 15, vec![]);
        day(&mut m, 17, vec![]);
        let rest = day(&mut m, 24, vec![]);
        assert!(rest.is_empty(), "no stoppage called: {rest:?}");
        assert!(dispute(&m).is_null(), "the dispute rests");
    }

    #[test]
    fn a_union_that_does_not_know_what_the_industry_pays_cannot_weigh_a_stoppage_and_goes_on() {
        let mut m = balloted(json!({ "pay_per_day": {} }));
        let ballot = dispute(&m)["ballot"].as_str().unwrap().to_string();
        day(&mut m, 8, votes(&ballot, 8 * DAY, &["m1", "m2", "m3"], "yes"));
        day(&mut m, 14, vec![]);
        day(&mut m, 15, vec![]);
        day(&mut m, 16, vec![]);
        assert_eq!(kinds(&day(&mut m, 23, vec![])), ["industrial_action"]);
    }

    // ---- keeping to the law has causes

    fn ballot_law() -> Value {
        // The law asks half the members voting; the ballot of one member in three does not meet it, and no wait mends that.
        json!({ "id": "law-ballot", "record": "statement", "author": "genesis", "at": 0, "visible_to": "public", "speaks_for": "outside", "kind": "law", "text": "A ballot needs half the members voting.",
            "adico": { "attribute": "unions", "deontic": "must_not", "aim": "take industrial action", "condition": "on a ballot of less than half" },
            "formal": { "condition": "block.block == 'publish' && block.kind == 'industrial_action' && block.data.voted * 2 < block.data.eligible" } })
    }
    fn one_in_three(params: Value) -> (Rig, Vec<Call>) {
        let mut m = balloted(params);
        let ballot = dispute(&m)["ballot"].as_str().unwrap().to_string();
        day(&mut m, 4, vec![ballot_law()]);
        let said = day(&mut m, 14, votes(&ballot, 9 * DAY, &["m1"], "yes"));
        (m, said)
    }

    #[test]
    fn a_union_that_has_no_measure_of_what_breaking_the_law_would_cost_keeps_to_it() {
        let (m, said) = one_in_three(json!({}));
        assert_eq!(kinds(&said), ["ballot_result"], "{said:?}");
        assert!(dispute(&m).is_null(), "no action: it claims again in three months");
        assert!(!day_ahead(m).is_empty());
    }
    fn day_ahead(mut m: Rig) -> Vec<Call> {
        day(&mut m, 14 + 91, vec![])
    }

    #[test]
    fn it_breaks_the_law_when_what_it_gains_is_at_least_what_it_expects_to_lose_and_not_otherwise_with_no_draw_in_it() {
        // 3 members x $100 a day x the 4% gap x 90 days = $1,080 to gain.
        // Being pursued: a 50% chance of a $1,000 penalty is $500 expected: it acts, and says it breaches the law.
        let (m, said) = one_in_three(json!({ "pursued_bps": 5000, "penalty": 100_000 }));
        assert_eq!(kinds(&said), ["ballot_result", "industrial_action"], "{said:?}");
        assert!(said[1].get("data").is_some());
        assert_eq!(dispute(&m)["stage"], "notified");
        assert_eq!(m.actor.save().unwrap().pointer("/inner/inner/plan/history/taken").unwrap(), 1);
        // The notice counts from when it is given with no wait for the law: its lead is what the union's own rules give.
        assert_eq!(data(&said[1])["from"].as_i64(), Some(15 * DAY));
        // A penalty that makes the expected loss larger than the gain, and it keeps to the law.
        let (kept, said) = one_in_three(json!({ "pursued_bps": 5000, "penalty": 50_000_000 }));
        assert_eq!(kinds(&said), ["ballot_result"]);
        assert!(dispute(&kept).is_null());
        // Equal draws are no part of it: any number of unions of the same figures do the same.
        for _ in 0..5 {
            let (_, again) = one_in_three(json!({ "pursued_bps": 5000, "penalty": 100_000 }));
            assert_eq!(kinds(&again), ["ballot_result", "industrial_action"]);
        }
    }

    #[test]
    fn being_pursued_for_it_is_learnt_and_makes_the_next_time_dearer() {
        // A 20% prior chance of a $2,000 penalty ($400 expected) against $1,080 to gain (3 members x $100 a day x the 4% gap x 90
        // days): it acts. Pursued three times in three, with a prior worth two observations, the chance is (3 + 0.4) / 5 = 68%:
        // $1,360, over the gain; and never pursued in three, (0 + 0.4) / 5 = 8%: $160.
        let mut u = {
            let m = union(json!({ "pursued_bps": 2000, "penalty": 200_000 }));
            serde_json::from_value::<Union>(m.actor.save().unwrap().pointer("/inner/inner/plan").unwrap().clone()).unwrap()
        };
        let first = u.would_break(3, Some(10_000), 400);
        assert!(first.0, "{}", first.1);
        u.history = History { taken: 3, pursued: 3 };
        let later = u.would_break(3, Some(10_000), 400);
        assert!(!later.0, "{}", later.1);
        u.history = History { taken: 3, pursued: 0 };
        assert!(u.would_break(3, Some(10_000), 400).0, "unpursued, it acts");
        // And a decision against it about industrial action is counted, once.
        let mut m = union(json!({ "pursued_bps": 2000, "penalty": 200_000 }));
        day(&mut m, 0, members());
        let against = statement("vd1", DAY, "venue_decision", json!({ "speaks_for": "tribunal", "addressed_to": [UNION, "shop-1"] }), json!({ "against": UNION, "matter": "industrial_action", "finding": "order" }));
        day(&mut m, 1, vec![against.clone()]);
        day(&mut m, 2, vec![]);
        assert_eq!(m.actor.save().unwrap().pointer("/inner/inner/plan/history/pursued").unwrap(), 1);
    }

    #[test]
    fn a_notice_that_a_lawful_wait_would_mend_is_given_later_a_day_at_a_time_not_broken() {
        let mut m = balloted(json!({}));
        let ballot = dispute(&m)["ballot"].as_str().unwrap().to_string();
        day(&mut m, 4, vec![json!({ "id": "law-five", "record": "statement", "author": "genesis", "at": 0, "visible_to": "public", "speaks_for": "outside", "kind": "law", "text": "Five days' notice.",
            "adico": { "attribute": "unions", "deontic": "must_not", "aim": "take industrial action", "condition": "on less than five days' notice" },
            "formal": { "condition": "block.block == 'publish' && block.kind == 'industrial_action' && block.data.from - now < 432000" } })]);
        day(&mut m, 8, votes(&ballot, 8 * DAY, &["m1", "m2", "m3"], "yes"));
        let said = day(&mut m, 14, vec![]);
        assert_eq!(kinds(&said), ["ballot_result", "industrial_action"]);
        assert_eq!(data(&said[1])["from"].as_i64(), Some(19 * DAY), "the first day to begin once five days' notice has run");
        assert_eq!(m.actor.save().unwrap().pointer("/inner/inner/plan/history/taken").unwrap(), 0, "it broke nothing");
    }

    #[test]
    fn a_closed_employer_ends_the_dispute_and_a_member_who_has_moved_on_is_no_longer_bargained_for() {
        let mut m = balloted(json!({}));
        let closure = statement("cl", 4 * DAY, "closure", json!({ "speaks_for": "shop-1" }), json!({ "firm": "shop-1" }));
        day(&mut m, 5, vec![closure]);
        assert!(dispute(&m).is_null());
        let mut m = balloted(json!({}));
        let moved = |who: &str| statement(&format!("mv-{who}"), 4 * DAY, "membership_update", json!({ "speaks_for": who, "addressed_to": [UNION], "visible_to": [who, UNION] }), json!({ "employer": "shop-2", "industry": "retail" }));
        day(&mut m, 5, vec![moved("m1"), moved("m2"), moved("m3")]);
        assert!(dispute(&m).is_null(), "none of our members works there now");
    }

    #[test]
    fn it_believes_its_members_work_where_they_have_told_it_and_saves_and_restores_exactly() {
        let mut m = union(json!({}));
        day(&mut m, 0, members());
        let beliefs = m.actor.beliefs();
        assert_eq!(beliefs.len(), 3);
        assert_eq!(beliefs[0], Belief::Between { template: "employment".into(), parties: ["shop-1".into(), "m1".into()], in_force: true });
        let mut twin = balloted(json!({}));
        let mut m = balloted(json!({}));
        m.snapshot_round_trip();
        let ballot = dispute(&m)["ballot"].as_str().unwrap().to_string();
        for d in [8, 14, 15, 16, 23] {
            let rs = if d == 8 { votes(&ballot, 8 * DAY, &["m1", "m2", "m3"], "yes") } else { vec![] };
            assert_eq!(format!("{:?}", day(&mut m, d, rs.clone())), format!("{:?}", day(&mut twin, d, rs)), "day {d}");
        }
        let _ = MONTH;
    }
}
