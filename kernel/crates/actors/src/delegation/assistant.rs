//! The assistant's code (`assistant`): what plays a provider's system when no model holds it (docs/design/delegation.md
//! section 3). It works in the post it was appointed to, sees only what that post's channels show (what its principal
//! hands it, its remits and briefs, its provider's papers), and does each matter at the level its referral asks:
//!
//! * **advice**: says what it would do (`advice`);
//! * **draft**: writes the act whole (`draft`), and once it is signed off sends exactly that;
//! * **approve**: asks with the gist (`approval_request`), and once told to go ahead writes and sends it;
//! * **alone**: writes and sends it.
//!
//! and reports what became of it (`report`). Where it slips (the world's table of slips, its template's row: a system's
//! own rate, not its provider's claim), the matter is lost as it is written: a draft that is not what was asked, advice
//! that is wrong, an act never sent though it believes it sent it (its report says done, as it believes). It does what
//! its principal's brief says not to do nothing of; it never asks for more (a procedure does not), and it decides nothing
//! the principal did not: the referral says what to do. A model in the seat is what decides otherwise.

use crate::common::{addressed_to, Book, DAY};
use crate::papers::delegation::{Advice, ApprovalRequest, Brief, Declined, Depth, Draft, GoAhead, Level, Referral, Remit, Report, ServiceDelivery, SignOff};
use crate::papers::{self, Paper};
use crate::steps::{because, say, Done, Plan, Say, Step, Stepper, Visible};
use crate::{Actor, Ctx, Cx, Kind, Picture};
use oikos_rules::slip::{slip, SlipOptions};
use oikos_sight::calls::{parse_program, Line, Program};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

pub struct Assistant;

impl Kind for Assistant {
    fn name(&self) -> &'static str {
        "assistant"
    }
    fn version(&self) -> &'static str {
        "0.1.0"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/assistants.md"
    }
    fn manifest(&self) -> Value {
        json!({
            "name": self.name(), "version": self.version(), "doc": self.doc(),
            "params": {},
            "perceives": [], "state": "its matters in hand",
            "answers": { "office": "an assistant", "acts": "It does what it is handed, at the level it is asked: it advises, drafts for sign-off, asks to go ahead, or acts, and reports. It acts on nothing it is not handed." },
        })
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        DAY
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        Ok(Box::new(Stepper::new(Assisting { me: ctx.entity.clone(), sys: ctx.participant.clone(), book: Book::new(), mine: vec![], matters: BTreeMap::new(), handled: BTreeSet::new(), ways: BTreeMap::new(), sent: vec![], awaiting: vec![] })))
    }
    fn restore(&self, _: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        Ok(Box::new(Stepper::<Assisting>::restore(saved)?))
    }
}

/// Its service, as its papers tell it: the delivery that names it, and the agreement its principal's brief gives.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Mine {
    delivery: String,
    /// Whom it works for under this service: its own organisation (a system delivered to it), or a person its provider's
    /// desk writes for in their name.
    client: String,
    provider: String,
    template: String,
    agreement: Option<String>,
    stop: Vec<String>,
    limit: Option<i64>,
    /// What becomes of its records at the end (the offer's, as delivered).
    #[serde(default = "provider_keeps")]
    records: crate::papers::delegation::Records,
    /// Handed over already.
    #[serde(default)]
    handed: bool,
}

fn provider_keeps() -> crate::papers::delegation::Records {
    crate::papers::delegation::Records::Provider
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct InHand {
    agreement: String,
    wants: Level,
    kind: String,
    calls: String,
    /// Its draft or its request to go ahead, once on file.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    asked: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Then {
    /// Its draft or request on file: its id is what an answer will cite.
    Asked { referral: String },
    /// The act carried out: what follows is the report. (What it sent, kept should a paper of it come back.)
    Did {
        referral: String,
        #[serde(default, skip_serializing_if = "String::is_empty")]
        calls: String,
    },
}

#[derive(Serialize, Deserialize)]
struct Assisting {
    me: String,
    sys: String,
    book: Book,
    /// Its services: each delivery that names it (an organisation's system has one; a provider's desk, one a client).
    mine: Vec<Mine>,
    matters: BTreeMap<String, InHand>,
    /// Papers it has acted on.
    handled: BTreeSet<String>,
    /// At want depth, the way it took on each matter (the paper it sent and to whom), for its report.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    ways: BTreeMap<String, String>,
    /// The papers it sent on its matters (their ids): the referral, and what it sent, should one come back
    /// (docs/design/obstacles.md, O1 and O4). The newest few hundred.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    sent: Vec<(String, String, String)>,
    /// Papers a body sent back for want of a client's authority: (the body, the client, the referral, what it sent, the
    /// paper sent back), until the body records one.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    awaiting: Vec<(String, String, String, String, String)>,
}

impl Assisting {
    /// The service a referral came under (from the referral on file).
    fn service_of(&self, referral: &str) -> Option<Mine> {
        let x = self.book.get(referral).and_then(|r| papers::read::<Referral>(r))?;
        self.service(&x.agreement).cloned()
    }

    fn service(&self, agreement: &str) -> Option<&Mine> {
        self.mine.iter().find(|m| m.agreement.as_deref() == Some(agreement))
    }

    fn say_to(&self, m: &Mine, kind: &str, words: &str, basis: &str, data: Value) -> oikos_sight::calls::Call {
        // (An organisation's own system writes to the organisation, seen by it alone, as its principal's papers to it
        // are; the provider's desk writes to a person it serves, the provider and the person seeing it.)
        let mut who = vec![self.me.clone()];
        for x in if m.client == self.me { vec![] } else { vec![&m.provider, &m.client] } {
            if !who.contains(x) {
                who.push(x.clone());
            }
        }
        say(kind, words, Say { to: Some(vec![m.client.clone()]), visible: Some(Visible::Only(who)), basis: Some(basis.to_string()), data: Some(data), ..Default::default() })
    }

    fn report(&self, m: &Mine, referral: &str, done: bool, created: BTreeMap<String, String>, why: Option<String>) -> Step<Then> {
        self.report_needing(m, referral, done, created, why, None)
    }

    fn report_needing(&self, m: &Mine, referral: &str, done: bool, created: BTreeMap<String, String>, why: Option<String>, needs: Option<crate::papers::delegation::Need>) -> Step<Then> {
        let r = Report { referral: referral.to_string(), done, created, why: why.clone(), way: self.ways.get(referral).cloned(), needs };
        let words = if done { format!("Done: {referral}.") } else { format!("Not done: {referral} ({}).", why.as_deref().unwrap_or("")) };
        because(words.clone(), vec![self.say_to(m, Report::KIND, &words, referral, papers::data(&r))])
    }

    /// Whether this matter slips as it is written (its template's row in the world's table of slips).
    fn slips(&self, m: &Mine, cx: &mut Cx, referral: &str) -> bool {
        slip(cx, &m.template, referral, &SlipOptions::default())
    }

    /// Carrying a matter out: its calls as they stand (in its client's name, where it writes for a person), or nothing
    /// where it slips (it believes it sent them).
    fn act(&self, m: &Mine, referral: &str, calls: &str, cx: &mut Cx) -> Step<Then> {
        if self.slips(m, cx, referral) {
            return self.report(m, referral, true, BTreeMap::new(), None);
        }
        self.send(m, referral, calls)
    }

    fn send(&self, m: &Mine, referral: &str, calls: &str) -> Step<Then> {
        let mut lines: Vec<Line> = match parse_program(calls) {
            Ok(Program::Lines(l)) => l,
            _ => return self.report(m, referral, false, BTreeMap::new(), Some("what was asked could not be read".into())),
        };
        if m.client != self.me {
            // (A paper of a person's, written by the desk in their name: it speaks for them, and they see it.)
            for l in &mut lines {
                if l.call.fn_ == "statement" && l.call.get("for").is_none() {
                    l.call.args.push(("for".into(), crate::steps::arg(&m.client)));
                }
            }
        }
        // (It keeps what it sent where a body it may write to has said it sends papers back: docs/design/obstacles.md.)
        let keep = self.book.open(crate::common::intake::NOTICE).next().is_some();
        if keep {
            // (Each paper named, so that the outcome says which records it made: what a body may send back.)
            for (i, l) in lines.iter_mut().enumerate() {
                if l.bind.is_none() && l.call.fn_ == "statement" {
                    l.bind = Some(format!("sent{i}"));
                }
            }
        }
        let mut s = Step::new(lines).then(Then::Did { referral: referral.to_string(), calls: if keep { calls.to_string() } else { String::new() } });
        s.why = Some(format!("Doing what {referral} asks."));
        s
    }
}

impl Assisting {
    /// A want handed over, worked by a clerk's procedure (`oikos_rules::recourse::next`, docs/design/handing-over.md
    /// section 4.3): from the want's fields and the facts its client gave, the bodies on its board that say they hear
    /// the matter, and its brief's limit. The act it would send (in the call language) and its way in words, or why it
    /// can do nothing now. It never reads its client's trust, fear or what they have learned: it has no sight of them.
    fn clerk(&self, x: &Referral, m: &Mine, t: i64, cx: &Cx) -> Result<(String, String), String> {
        use oikos_rules::recourse::{next, Case, Matter as M, Next};
        let w = x.want.as_ref().ok_or_else(|| "it was handed no want".to_string())?;
        let d = x.facts.as_ref().map(|f| f["data"].clone()).unwrap_or(Value::Null);
        let st = |v: &Value| v.as_str().map(String::from);
        let lease = d.get("lease").filter(|l| l.is_object()).and_then(|l| Some((st(&l["landlord"])?, st(&l["agreement"])?, st(&l["space"])?, crate::papers::lenient::whole(&l["rent"])?)));
        let matter = d.get("matter").filter(|l| l.is_object()).and_then(|g| {
            Some(M { matter: st(&g["matter"])?, party: st(&g["party"])?, about: st(&g["about"]), amount: crate::papers::lenient::whole(&g["amount"]), structure: st(&g["structure"]), seeks: st(&g["seeks"]) })
        });
        // (The bodies on its board that say they hear the matter: what it can find for itself, as anyone can.)
        let heard = matter.as_ref().map_or(w.about.clone(), |g| g.matter.clone());
        let mut venues = vec![];
        for h in self.book.hearings() {
            let oikos_sight::RecordBody::Statement { offer: Some(o), .. } = &h.body else { continue };
            if !o.get("hears").and_then(|x| x.as_array()).is_some_and(|a| a.iter().any(|e| e.get("about").and_then(|v| v.as_str()) == Some(heard.as_str()))) {
                continue;
            }
            let venue = h.speaks_for.map(|x| x.to_string()).unwrap_or_else(|| h.author.to_string());
            let fee = crate::citizen::recourse::venue_fee(o);
            venues.push((venue, h.id.to_string(), crate::citizen::recourse::form_for(o, &heard), fee.as_ref().map_or(0, |f| f.1), fee.map(|f| f.0)));
        }
        let case = Case {
            about: w.about.clone(),
            against: w.against.as_ref().map(|a| (a.record.clone(), a.by.clone())),
            lease,
            matter,
            asked: crate::papers::lenient::whole(&d["asked"]),
            answer: st(&d["answer"]),
            account: st(&d["account"]),
            venues,
            limit: m.limit,
            applied: d["applied"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default(),
        };
        let days = crate::papers::lenient::whole(&d["answer_days"]).ok_or_else(|| "it was not told how long the other side has to answer".to_string())?;
        let money = |n: i64| crate::common::money_words(n, &cx.ctx.world);
        let (paper, fee) = match next(&case, &m.client, t, days, &money) {
            Next::Ask(p) => (p, None),
            Next::Apply(p, fee) => (p, fee),
            Next::Wait(until) => return Err(format!("asked already: their answer is awaited until {}", crate::common::when_words(until, &cx.ctx.world))),
            Next::Nothing(why) => return Err(why),
        };
        let way = format!("{} to {}", paper.kind, paper.to.join(", "));
        let mut lines = vec![Line { bind: None, call: crate::citizen::recourse::call_of(&paper) }];
        if let (Some((to, cost)), Some(acc)) = (fee, case.account.clone()) {
            lines.push(Line { bind: None, call: crate::steps::pay(&to, cost, crate::steps::Pay { from: Some(acc), for_: Some("Application fee.".into()), ..Default::default() }, cx) });
        }
        Ok((oikos_sight::calls::program_text(&Program::Lines(lines)), way))
    }
}

/// A call made to cite one more record (its `basis`, kept with any it cited already).
fn cite(c: &mut oikos_sight::calls::Call, id: &str) {
    use oikos_sight::calls::Value as Arg;
    match c.args.iter_mut().find(|(k, _)| k == "basis") {
        Some((_, v)) => {
            let mut all: Vec<Value> = match v {
                Arg::Id(x) | Arg::Text(x) => vec![Value::from(x.clone())],
                Arg::Json(Value::Array(a)) => a.clone(),
                _ => vec![],
            };
            all.push(Value::from(id));
            *v = Arg::Json(Value::Array(all));
        }
        None => c.args.push(("basis".into(), crate::steps::arg(id))),
    }
}

impl Plan for Assisting {
    type Then = Then;

    fn absorb(&mut self, pic: &Picture, _: &mut Cx) {
        self.book.absorb(pic);
    }

    fn plan(&mut self, pic: &Picture, cx: &mut Cx) -> Vec<Step<Then>> {
        let mut steps = vec![];
        // Which services it is in: each delivery that names it, and the agreement its client's brief gives.
        for r in self.book.all(ServiceDelivery::KIND) {
            if self.mine.iter().any(|m| m.delivery == r.id.as_str()) {
                continue;
            }
            let Some(d) = papers::read::<ServiceDelivery>(r) else { continue };
            if !d.systems.contains(&self.sys) {
                continue;
            }
            let client = addressed_to(r).first().map(|x| x.to_string()).unwrap_or_default();
            self.mine.push(Mine { delivery: r.id.to_string(), client, provider: d.offer.provider.clone(), template: d.offer.template.clone(), agreement: None, stop: vec![], limit: None, records: d.offer.records, handed: false });
        }
        let briefs: Vec<Brief> = self.book.all(Brief::KIND).filter_map(|r| papers::read::<Brief>(r)).collect();
        for b in &briefs {
            for m in self.mine.iter_mut() {
                if b.delivery.as_deref() == Some(m.delivery.as_str()) || m.agreement.as_deref() == Some(b.agreement.as_str()) {
                    m.agreement = Some(b.agreement.clone());
                    m.stop = b.stop.clone();
                    m.limit = b.limit.or(m.limit);
                }
            }
        }
        if self.mine.iter().all(|m| m.agreement.is_none()) {
            return steps;
        }
        // (A remit that hands a kind over no longer takes back what it had open of that kind: the principal does those now,
        // so nothing more is sent on them.)
        let cuts: Vec<(i64, Remit)> = self.book.all(Remit::KIND).filter_map(|r| papers::read::<Remit>(r).map(|x| (r.at, x))).filter(|(_, x)| matches!(x.level, Level::None | Level::Advice) && self.service(&x.agreement).is_some()).collect();
        for (at, x) in cuts {
            let back: Vec<String> = self.matters.iter().filter(|(id, m)| m.agreement == x.agreement && m.kind == x.kind && self.book.get(id).is_some_and(|r| r.at < at)).map(|(id, _)| id.clone()).collect();
            for id in back {
                self.matters.remove(&id);
            }
        }
        // (Asked to hand over at the service's end: what is open, with its notes where the records term gives them.)
        let ending: Vec<String> = briefs.iter().filter(|b| b.hand_over).map(|b| b.agreement.clone()).collect();
        for a in ending {
            let Some(m) = self.mine.iter().find(|m| m.agreement.as_deref() == Some(a.as_str()) && !m.handed).cloned() else { continue };
            let open: Vec<(String, InHand)> = self.matters.iter().filter(|(_, x)| x.agreement == a).map(|(k, x)| (k.clone(), x.clone())).collect();
            let notes: BTreeMap<String, String> = if m.records == crate::papers::delegation::Records::Principal { open.iter().map(|(k, x)| (k.clone(), x.calls.clone())).collect() } else { BTreeMap::new() };
            let h = crate::papers::delegation::Handover { agreement: a.clone(), open: open.iter().map(|(k, _)| k.clone()).collect(), notes };
            let words = format!("Handing over {} matter{} still open.", open.len(), if open.len() == 1 { "" } else { "s" });
            steps.push(because(words.clone(), vec![self.say_to(&m, crate::papers::delegation::Handover::KIND, &words, &a, papers::data(&h))]));
            for (k, _) in &open {
                self.matters.remove(k);
            }
            if let Some(x) = self.mine.iter_mut().find(|x| x.agreement.as_deref() == Some(a.as_str())) {
                x.handed = true;
            }
        }
        // What it is handed.
        let referrals: Vec<(String, Referral)> = self
            .book
            .all(Referral::KIND)
            .filter(|r| !self.handled.contains(r.id.as_str()))
            .filter_map(|r| papers::read::<Referral>(r).map(|x| (r.id.to_string(), x)))
            .filter(|(_, x)| self.service(&x.agreement).is_some())
            .collect();
        for (id, x) in referrals {
            self.handled.insert(id.clone());
            let m = self.service(&x.agreement).cloned().expect("filtered above");
            // (Handed a want: a clerk's procedure says which paper, to whom.)
            if x.depth == Depth::Want && !m.stop.contains(&x.kind) && x.wants != Level::None {
                match self.clerk(&x, &m, pic.t, cx) {
                    Ok((_, way)) => {
                        self.ways.insert(id.clone(), way);
                    }
                    Err(why) => {
                        steps.push(self.report(&m, &id, false, BTreeMap::new(), Some(why)));
                        continue;
                    }
                }
            }
            // (Handed what happened: it works the paper out from the facts, as its principal's code would have.)
            let calls = match (&x.calls, &x.facts) {
                _ if x.depth == Depth::Want => self.clerk(&x, &m, pic.t, cx).map(|c| c.0).unwrap_or_default(),
                (Some(c), _) => c.clone(),
                (None, Some(f)) => composed(f, &m.client, pic.t, &cx.ctx.world).unwrap_or_default(),
                _ => String::new(),
            };
            if m.stop.contains(&x.kind) {
                steps.push(self.report(&m, &id, false, BTreeMap::new(), Some(format!("your brief says not to act on a {} until told", x.kind.replace('_', " ")))));
                continue;
            }
            if calls.is_empty() {
                steps.push(self.report(&m, &id, false, BTreeMap::new(), Some("a code assistant acts on what it is asked to do, and this says nothing to do".into())));
                continue;
            }
            match x.wants {
                Level::Advice => {
                    let wrong = self.slips(&m, cx, &id);
                    let a = Advice { referral: id.clone(), calls: Some(if wrong { String::new() } else { calls.clone() }) };
                    let words = if wrong { "Our advice: nothing needs doing.".to_string() } else { "Our advice: as you have it.".to_string() };
                    steps.push(because(words.clone(), vec![self.say_to(&m, Advice::KIND, &words, &id, papers::data(&a))]));
                }
                Level::Draft => {
                    let wrong = self.slips(&m, cx, &id);
                    let d = Draft { referral: id.clone(), calls: (!wrong).then(|| calls.clone()), paper: None };
                    self.matters.insert(id.clone(), InHand { agreement: x.agreement.clone(), wants: x.wants, kind: x.kind.clone(), calls: if wrong { String::new() } else { calls.clone() }, asked: None });
                    let words = format!("Draft for {id}, for your sign-off.");
                    let mut s = Step::new(vec![Line { bind: Some("asked".into()), call: self.say_to(&m, Draft::KIND, &words, &id, papers::data(&d)) }]).then(Then::Asked { referral: id.clone() });
                    s.why = Some(words);
                    steps.push(s);
                }
                Level::Approve => {
                    let r = ApprovalRequest { referral: id.clone(), gist: format!("a {} as you asked", x.kind.replace('_', " ")) };
                    self.matters.insert(id.clone(), InHand { agreement: x.agreement.clone(), wants: x.wants, kind: x.kind.clone(), calls: calls.clone(), asked: None });
                    let words = format!("May we go ahead with {id}?");
                    let mut s = Step::new(vec![Line { bind: Some("asked".into()), call: self.say_to(&m, ApprovalRequest::KIND, &words, &id, papers::data(&r)) }]).then(Then::Asked { referral: id.clone() });
                    s.why = Some(words);
                    steps.push(s);
                }
                Level::Alone => steps.push(self.act(&m, &id, &calls, cx)),
                Level::None => steps.push(self.report(&m, &id, false, BTreeMap::new(), Some("it was handed over with nothing asked".into()))),
            }
        }
        // Answers to what it asked: a sign-off sends the draft as it stands; a go-ahead, the act; a refusal, nothing.
        let answers: Vec<(String, String, Option<String>)> = self
            .book
            .records()
            .filter(|r| !self.handled.contains(r.id.as_str()) && addressed_to(r).iter().any(|a| self.mine.iter().any(|m| *a == m.provider || (m.client == self.me && *a == m.client))))
            .filter_map(|r| {
                if let Some(x) = papers::read::<SignOff>(r) {
                    Some((r.id.to_string(), x.referral, Some(x.draft)))
                } else if let Some(x) = papers::read::<GoAhead>(r) {
                    Some((r.id.to_string(), x.referral, Some(x.request)))
                } else {
                    papers::read::<Declined>(r).map(|x| (r.id.to_string(), x.referral, None))
                }
            })
            .collect();
        for (id, referral, of) in answers {
            self.handled.insert(id);
            let Some(m) = self.matters.get(&referral).cloned() else { continue };
            let Some(svc) = self.service(&m.agreement).cloned() else { continue };
            if of.is_none() || of != m.asked {
                if of.is_none() {
                    self.matters.remove(&referral);
                }
                continue;
            }
            self.matters.remove(&referral);
            match m.wants {
                Level::Draft if m.calls.is_empty() => steps.push(self.report(&svc, &referral, true, BTreeMap::new(), None)),
                Level::Draft => steps.push(self.send(&svc, &referral, &m.calls)),
                _ => steps.push(self.act(&svc, &referral, &m.calls, cx)),
            }
            let _ = m.kind;
        }
        // Papers of its own a body sent back (docs/design/obstacles.md, O1 and O4): one the body could not match to its
        // records is sent again as it was, citing the return; for anything else (an authority, an item its form asks
        // for) it reports the matter not done, with what would clear it, as the body said.
        let back: Vec<(String, String, String, Value)> = self
            .book
            .all(crate::common::intake::RETURNED)
            .filter(|r| !self.handled.contains(r.id.as_str()))
            .filter_map(|r| {
                let d = crate::common::data(r).to_value();
                let (_, rf, calls) = self.sent.iter().find(|x| Some(x.0.as_str()) == d["returned"].as_str())?;
                Some((r.id.to_string(), rf.clone(), calls.clone(), d))
            })
            .collect();
        for (id, rf, calls, d) in back {
            self.handled.insert(id.clone());
            let Some(m) = self.service_of(&rf) else { continue };
            let need = &d["need"];
            if need.get("authority").is_none() && need["correction"].as_array().is_none_or(|a| a.is_empty()) {
                let mut st = self.send(&m, &rf, &calls);
                for l in &mut st.lines {
                    cite(&mut l.call, &id);
                }
                st.why = Some(format!("{id} sent {rf}'s paper back: sending it again."));
                steps.push(st);
            } else {
                let needs = serde_json::from_value::<crate::papers::delegation::Need>(need.clone()).ok();
                // (Waiting on an authority: it sends the paper again once the body says it has recorded one.)
                if let Some(a) = needs.as_ref().and_then(|n| n.authority.clone()) {
                    self.awaiting.push((a.with, a.for_, rf.clone(), calls.clone(), id.clone()));
                }
                let why = self.book.get(&id).map(|r| crate::common::text(r).to_string());
                steps.push(self.report_needing(&m, &rf, false, BTreeMap::new(), why, needs));
            }
        }
        // An authority a body recorded for a client it waits on: the paper sent back for want of it goes again.
        let recorded: Vec<(String, String, Vec<String>)> = self
            .book
            .all(crate::common::intake::RECORDED)
            .filter(|r| !self.handled.contains(r.id.as_str()))
            .map(|r| {
                // (As its client passed it on: the body that recorded it, and the client; else as the body wrote it.)
                let d = crate::common::data(r).to_value();
                let with = d["by"].as_str().map(String::from).unwrap_or_else(|| r.speaks_for.as_deref().unwrap_or(r.author.as_str()).to_string());
                let to: Vec<String> = match d["for"].as_str() {
                    Some(c) => vec![c.to_string()],
                    None => crate::common::addressed_to(r).iter().map(|x| x.to_string()).collect(),
                };
                (r.id.to_string(), with, to)
            })
            .collect();
        for (id, with, to) in recorded {
            self.handled.insert(id.clone());
            let (now, rest): (Vec<_>, Vec<_>) = std::mem::take(&mut self.awaiting).into_iter().partition(|w| w.0 == with && to.contains(&w.1));
            self.awaiting = rest;
            for (_, _, rf, calls, returned) in now {
                let Some(m) = self.service_of(&rf) else { continue };
                let mut st = self.send(&m, &rf, &calls);
                for l in &mut st.lines {
                    cite(&mut l.call, &returned);
                }
                st.why = Some(format!("{with} has recorded the authority it needed: sending {rf}'s paper again."));
                steps.push(st);
            }
        }
        steps
    }

    fn then(&mut self, tok: &Then, done: Done, _cx: &mut Cx) -> Vec<Step<Then>> {
        match tok {
            Then::Asked { referral } => {
                if let (Done::Outcome(o), Some(m)) = (done, self.matters.get_mut(referral)) {
                    m.asked = o.created.as_ref().and_then(|c| c.get("asked")).map(|x| x.to_string());
                }
                vec![]
            }
            Then::Did { referral, calls } => {
                let Some(svc) = self.service_of(referral) else { return vec![] };
                match done {
                    Done::Outcome(o) if done.applied() => {
                        let created: BTreeMap<String, String> = o.created.iter().flatten().map(|(k, v)| (k.to_string(), v.to_string())).collect();
                        if !calls.is_empty() {
                            for id in created.values() {
                                self.sent.push((id.clone(), referral.clone(), calls.clone()));
                            }
                            if self.sent.len() > crate::figures::KEPT_ACKNOWLEDGED {
                                let over = self.sent.len() - crate::figures::KEPT_ACKNOWLEDGED;
                                self.sent.drain(..over);
                            }
                        }
                        vec![self.report(&svc, referral, true, created, None)]
                    }
                    Done::Outcome(o) => vec![self.report(&svc, referral, false, BTreeMap::new(), Some(o.refusal.as_ref().and_then(|r| r.detail.clone()).unwrap_or_else(|| "refused".into())))],
                    Done::NotDone(why) => vec![self.report(&svc, referral, false, BTreeMap::new(), Some(why.to_string()))],
                }
            }
        }
    }
}

/// The papers of a matter handed over as what happened, written on its principal's own forms from what it gave
/// (docs/design/broad-seats.md, G2): each paper's blanks given, the blanks its form works out by its rules, the words as
/// its form puts them, in the name of whom it works for (`me`). The same forms, through the same writer, as a model's
/// draft on them; the call it sends, each paper under the name its principal's code gave it. An error: a form that
/// cannot be filled from what was given.
fn composed(facts: &Value, me: &str, t: i64, world: &crate::WorldInfo) -> Result<String, String> {
    let forms = facts["composed_on"].as_array().ok_or("no forms")?;
    let papers: Vec<&Value> = match facts["papers"].as_array() {
        Some(ps) => ps.iter().collect(),
        None => vec![facts],
    };
    let dated = world.calendar.clone().map(|c| oikos_rules::calendar::Dated { calendar: Some(c), style: world.date_style.clone().unwrap_or_default() });
    let money = |s: &str| s.parse::<i64>().map(|n| crate::common::money_words(n, world)).map_err(|_| format!("{s} is not a sum"));
    let mut lines = vec![];
    for (i, p) in papers.iter().enumerate() {
        let form = forms.get(i).ok_or("a paper with no form")?;
        let mut given = p.as_object().cloned().unwrap_or_default();
        given.remove("composed_on");
        let made = oikos_rules::form_papers::compose(&form["spec"], &given, me, t, &money, dated.as_ref())?;
        let list = |k: &str| -> Option<Vec<String>> { made.get(k).and_then(Value::as_array).map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()) };
        let visible = match made.get("visible_to") {
            Some(Value::String(s)) if s == "public" => Some(Visible::Public),
            _ => list("visible_to").map(Visible::Only),
        };
        let mut extra = vec![];
        for k in ["offer", "assertion"] {
            if let Some(v) = made.get(k) {
                extra.push((if k == "offer" { "offer" } else { "assertion" }, v.clone()));
            }
        }
        let call = say(
            made["kind"].as_str().unwrap_or_default(),
            made["text"].as_str().unwrap_or_default(),
            Say { to: list("addressed_to"), visible, basis: made.get("basis").and_then(Value::as_str).map(String::from), data: made.get("data").cloned(), extra, ..Default::default() },
        );
        lines.push(Line { bind: form["bind"].as_str().map(String::from), call });
    }
    Ok(oikos_sight::calls::program_text(&Program::Lines(lines)))
}

