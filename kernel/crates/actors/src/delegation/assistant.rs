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
use crate::papers::delegation::{Advice, ApprovalRequest, Brief, Declined, Draft, GoAhead, Level, Referral, Report, ServiceDelivery, SignOff};
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
        Ok(Box::new(Stepper::new(Assisting { me: ctx.entity.clone(), sys: ctx.participant.clone(), book: Book::new(), mine: vec![], matters: BTreeMap::new(), handled: BTreeSet::new() })))
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
    /// The act carried out: what follows is the report.
    Did { referral: String },
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
        let mut who = vec![self.me.clone()];
        for x in [&m.provider, &m.client] {
            if !who.contains(x) {
                who.push(x.clone());
            }
        }
        say(kind, words, Say { to: Some(vec![m.client.clone()]), visible: Some(Visible::Only(who)), basis: Some(basis.to_string()), data: Some(data), ..Default::default() })
    }

    fn report(&self, m: &Mine, referral: &str, done: bool, created: BTreeMap<String, String>, why: Option<String>) -> Step<Then> {
        let r = Report { referral: referral.to_string(), done, created, why: why.clone() };
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
        let mut s = Step::new(lines).then(Then::Did { referral: referral.to_string() });
        s.why = Some(format!("Doing what {referral} asks."));
        s
    }
}

impl Plan for Assisting {
    type Then = Then;

    fn absorb(&mut self, pic: &Picture, _: &mut Cx) {
        self.book.absorb(pic);
    }

    fn plan(&mut self, _pic: &Picture, cx: &mut Cx) -> Vec<Step<Then>> {
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
            let calls = x.calls.clone().unwrap_or_default();
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
                    let d = Draft { referral: id.clone(), calls: (!wrong).then(|| calls.clone()) };
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
            .filter(|r| !self.handled.contains(r.id.as_str()) && addressed_to(r).iter().any(|a| self.mine.iter().any(|m| *a == m.provider)))
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
            Then::Did { referral } => {
                let Some(svc) = self.service_of(referral) else { return vec![] };
                match done {
                    Done::Outcome(o) if done.applied() => {
                        let created: BTreeMap<String, String> = o.created.iter().flatten().map(|(k, v)| (k.to_string(), v.to_string())).collect();
                        vec![self.report(&svc, referral, true, created, None)]
                    }
                    Done::Outcome(o) => vec![self.report(&svc, referral, false, BTreeMap::new(), Some(o.refusal.as_ref().and_then(|r| r.detail.clone()).unwrap_or_else(|| "refused".into())))],
                    Done::NotDone(why) => vec![self.report(&svc, referral, false, BTreeMap::new(), Some(why.to_string()))],
                }
            }
        }
    }
}
