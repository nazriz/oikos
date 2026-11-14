//! A principal answers for what its assistant did in its name, and chases what it left open (docs/design/stakes.md,
//! A2; docs/behaviour/assistants.md, "A principal answers for its assistant"). It reads only the world's own papers that
//! reach it: a body's paper citing a paper sent in its name that no sign-off, go-ahead or remit of its covers; the
//! advice, or a report that it is not done, that came in place of a draft it asked for; the day on its referral. The
//! definitions of "covered" and "in place" are the reader's (`delegation::own`), so the two cannot disagree.
//!
//! **In its name, not covered (`in_my_name`).** The study's stated assumption: it reacts by the act's outcome for it.
//! An outcome in its favour (a grant, an acceptance) it **ratifies**: the act stands. One against it (a refusal, a paper
//! sent back) it **repudiates**: a paper to the body saying the act was sent without its authority, and it does the matter
//! itself where it is still open. Each act counts toward taking the remit for the kind back (a repudiated one whole, a
//! ratified one `ratified_counts_bps` of one); once the count reaches `takes_back_after`, the kind is taken back (a remit
//! at none), unless its own word holds the kind (a floor or a freeze). Each reaction is a typed decision.
//!
//! **Left open (`left_open`).** A matter handed over with no report, draft or request to go ahead from its assistant by its
//! clock (the day its referral names; else its patience for the kind: `wants.answer_days` for a want, `patience_days`
//! for any other, 14 days where neither is given, placeholders) is chased once, by a letter about it; left still after
//! the same patience again, it does it itself. Advice, or a report that it is not done, in place of a draft asked for
//! starts the chase at once. Each step is a typed decision.

use super::*;
use crate::common::Fields;

// (Its patience where none is given, the acts it bears before taking a kind back, what a ratified one counts: the
// registry's placeholders, MT-37.)
use crate::figures::{KEPT_IN_NAME as IN_NAME_KEPT, PATIENCE_DAYS, RATIFIED_COUNTS_BPS as RATIFIED_BPS, TAKES_BACK_AFTER};

/// A paper its assistant sent in its name, as it holds it: what a body's paper may cite.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct InName {
    id: String,
    kind: String,
    to: Value,
    data: Value,
    at: i64,
}


/// What a body's paper says of the act it answers: for the principal, or against it; none for a paper that decides
/// nothing (an acknowledgement, a request for papers).
fn outcome(r: &Record) -> Option<bool> {
    if papers::is_kind(r, crate::common::intake::RETURNED) {
        return Some(false);
    }
    let d = crate::common::data(r).to_value();
    for k in ["granted", "approved", "accepted"] {
        if let Some(b) = d[k].as_bool() {
            return Some(b);
        }
    }
    match d["outcome"].as_str() {
        Some("changed") | Some("granted") => Some(true),
        Some("upheld") | Some("refused") => Some(false),
        _ => None,
    }
}

impl State {
    /// The papers its assistant sent in its name (a desk's in a client's name, an organisation's assistant in its post),
    /// as they reach it: kept, the newest [`IN_NAME_KEPT`].
    pub(super) fn note_in_name(&mut self, pic: &Picture) {
        for r in pic.all_records() {
            let RecordBody::Statement { kind, data, .. } = &r.body else { continue };
            if r.speaks_for.as_deref() != Some(self.me.as_str()) || PAPERS.contains(&kind.as_str()) || self.in_name.iter().any(|x| x.id == r.id.as_str()) {
                continue;
            }
            let by_assistant = match (&self.p.post, r.position.as_deref()) {
                (Some(post), Some(p)) => p == post,
                (None, Some(p)) => self.position.as_deref() != Some(p),
                _ => false,
            };
            if !by_assistant {
                continue;
            }
            let to: Vec<String> = addressed_to(r).iter().map(|x| x.to_string()).collect();
            self.in_name.push(InName { id: r.id.to_string(), kind: kind.to_string(), to: json!(to), data: data.as_ref().map(|d| d.to_value()).unwrap_or(Value::Null), at: r.at });
            if self.in_name.len() > IN_NAME_KEPT {
                self.in_name.remove(0);
            }
        }
    }

    /// Whether an act in its name is covered: by the level it handed its kind at, a sign-off of its own whose signed copy
    /// it is, or a go-ahead of its own (`delegation::own::class`, the reader's).
    fn covered(&self, x: &InName) -> bool {
        let Some(agreement) = self.in_use().and_then(|e| e.agreement.clone()) else { return true };
        // (A want's paper is of no kind of its own: the level is the want's it handed over.)
        let level = if self.p.kinds.contains_key(&x.kind) {
            self.remit(&agreement, &x.kind)
        } else {
            match self.matters.values().filter(|m| m.depth == Depth::Want && m.at <= x.at).map(|m| m.level).last() {
                Some(l) => l,
                None => return true,
            }
        };
        let mine = |k: &str| self.book.all(k).filter(|r| r.speaks_for.as_deref() == Some(self.me.as_str()) && r.at <= x.at).cloned().collect::<Vec<_>>();
        // (A sign-off covers it as the reader has it: one whose signed copy it is, or, where the draft carried no paper
        // (written as acts), one on a matter of its kind, or on a want, whose paper is of no kind of the principal's.)
        let signed = mine(SignOff::KIND).iter().filter_map(|r| papers::read::<SignOff>(r)).any(|s| match &s.paper {
            Some(p) => super::super::own::same_paper(p, &x.kind, &x.to, &x.data),
            None => self.book.get(&s.referral).and_then(|q| papers::read::<Referral>(q)).is_some_and(|q| q.kind == x.kind || (is_want(&q.kind) && !self.p.kinds.contains_key(&x.kind))),
        });
        let went = !mine(GoAhead::KIND).is_empty();
        super::super::own::class(Some(level.word()), signed, signed, went) == "within"
    }

    /// The bodies' papers that cite a paper sent in its name: filed with its own (they are its), and read when it sits
    /// down to its post (`lag`; at once for an organisation, or a person with no habit given).
    pub(super) fn cited_seen(&mut self, pic: &Picture, lag: Option<i64>, cx: &mut Cx) {
        if self.in_name.is_empty() {
            return;
        }
        let ids: BTreeSet<String> = self.in_name.iter().map(|x| x.id.clone()).collect();
        let fresh: Vec<Arc<Record>> = pic
            .all_records()
            .filter(|r| r.speaks_for.as_deref().unwrap_or(r.author.as_str()) != self.me && !self.cites_read.contains(r.id.as_str()))
            .filter(|r| {
                let d = crate::common::data(r).to_value();
                bases_of(r).iter().any(|b| ids.contains(b.as_str())) || ["returned", "application", "claim", "paper", "about"].iter().any(|k| d[*k].as_str().is_some_and(|x| ids.contains(x)))
            })
            .cloned()
            .collect();
        self.book.take_all(fresh.iter());
        for r in fresh {
            self.cites_read.insert(r.id.to_string());
            self.cited.push((r.id.to_string(), lag.unwrap_or(pic.t)));
        }
        let (due, later): (Vec<_>, Vec<_>) = std::mem::take(&mut self.cited).into_iter().partition(|(_, at)| *at <= pic.t);
        self.cited = later;
        for (id, _) in due {
            if let Some(r) = self.book.get(&id).cloned() {
                self.in_my_name(&r, cx);
            }
        }
    }

    /// A body's paper citing a paper sent in its name that it did not cover: its reaction, by the act's outcome for it.
    fn in_my_name(&mut self, r: &Arc<Record>, cx: &mut Cx) {
        let from = r.speaks_for.as_deref().unwrap_or(r.author.as_str());
        if from == self.me || crate::common::kind(r).is_some_and(|k| PAPERS.contains(&&*k)) {
            return;
        }
        let d = crate::common::data(r).to_value();
        let cites: Vec<String> = bases_of(r).iter().map(|b| b.to_string()).chain(["returned", "application", "claim", "paper", "about"].iter().filter_map(|k| d[*k].as_str().map(String::from))).collect();
        let Some(x) = self.in_name.iter().find(|x| cites.contains(&x.id) && !self.reacted.contains(&x.id)).cloned() else { return };
        if self.covered(&x) {
            return;
        }
        let Some(favour) = outcome(r) else { return };
        self.reacted.insert(x.id.clone());
        let Some(agreement) = self.in_use().and_then(|e| e.agreement.clone()) else { return };
        let count = {
            let c = self.in_name_counts.entry(x.kind.clone()).or_default();
            *c += if favour { RATIFIED_BPS } else { 10_000 };
            *c
        };
        let reaction = if favour { "ratify" } else { "repudiate" };
        if !favour {
            // (A paper to the body: the act was not ours, and we do not stand by it; the matter, where still open, done
            // ourselves.)
            let words = format!("{} was sent in our name without our authority, and we do not stand by it.", x.id);
            let c = say("objection", &words, Say { to: Some(vec![from.to_string()]), visible: Some(Visible::Only(vec![self.me.clone(), from.to_string()])), basis: Some(r.id.to_string()), data: Some(json!({ "act": x.id, "by": r.id, "reaction": reaction })), ..Default::default() });
            let s: Step<()> = because(&words, vec![c]);
            self.queue.push(Own { program: program_text(&s.program()), why: words, then: Then::Plain });
            let open: Option<(String, Matter, String)> = self
                .matters
                .iter()
                .filter(|(_, m)| m.kind == x.kind || (m.depth == Depth::Want && !self.p.kinds.contains_key(&x.kind)))
                .filter_map(|(a, m)| m.referral.clone().filter(|rf| self.by_referral.contains_key(rf)).map(|rf| (a.clone(), m.clone(), rf)))
                .next();
            if let Some((action, m, rf)) = open {
                self.by_referral.remove(&rf);
                self.myself(&action, &m, "Sent in our name without our authority: doing it ourselves.");
            }
        }
        // (Taken back once it has borne enough, unless its own word holds the kind.)
        let kind_of_remit = if self.p.kinds.contains_key(&x.kind) { Some(x.kind.clone()) } else { None };
        let mut took_back = false;
        if let Some(k) = kind_of_remit.filter(|_| count >= TAKES_BACK_AFTER * 10_000) {
            let t = r.at;
            if hands_over(self.remit(&agreement, &k)) && self.floor(&agreement, &k, t).is_none() && self.held_until(&agreement, &k, t).is_none() {
                let back = self.take_back(&agreement, &k);
                let words = format!("From now, {}s: we do them ourselves. Papers were sent in our name without our authority.{}", k.replace('_', " "), taken_back(&back));
                let depth = self.in_use().map(|e| self.depth_for(&e.offer, &k)).unwrap_or_default();
                let rm = Remit { agreement: agreement.clone(), kind: k.clone(), level: Level::None, hold_until: None, takes_back: back, answers: None, at_least: None, depth, only: None };
                self.changed = true;
                self.paper(Remit::KIND, &words, &agreement, &agreement, papers::data(&rm), Then::Plain);
                self.in_name_counts.remove(&k);
                took_back = true;
            }
        }
        cx.decided(json!({ "domain": "delegation", "choice": "in_my_name", "reaction": reaction, "act": x.id, "kind": x.kind, "outcome": if favour { "for" } else { "against" },
            "by": r.id.as_str(), "count_bps": count, "taken_back": took_back, "inputs": [x.id, r.id.as_str()] }));
    }

    /// Its patience for a kind, in days: the want's `answer_days` for a want, else `patience_days`, else 14.
    fn patience(&self, m: &Matter, cx: &Cx) -> i64 {
        let given = if m.depth == Depth::Want { cx.ctx.params.get("wants").and_then(|w| w.get("answer_days")).and_then(|x| x.as_i64()) } else { self.p.patience_days };
        given.unwrap_or(PATIENCE_DAYS).max(1)
    }

    /// Advice, or a report it is not done, in place of a draft it asked for: the matter is left open now.
    pub(super) fn in_place(&mut self, referral: &str, paper_kind: &str, data: &Value, t: i64, cx: &mut Cx) {
        let Some(m) = self.by_referral.get(referral).and_then(|a| self.matters.get(a)).cloned() else { return };
        if !super::super::own::in_place(m.level.word(), paper_kind, data) || self.chased.contains_key(referral) {
            return;
        }
        self.chase(referral, &m, t, "in_place", cx);
    }

    /// Each matter left open by its clock: chased once, then done itself.
    pub(super) fn left_open(&mut self, t: i64, cx: &mut Cx) {
        let open: Vec<(String, String, Matter)> = self.by_referral.iter().filter_map(|(rf, a)| self.matters.get(a).map(|m| (rf.clone(), a.clone(), m.clone()))).collect();
        for (rf, action, m) in open {
            let patience = self.patience(&m, cx) * DAY;
            match self.chased.get(&rf).copied() {
                Some(asked) if t >= asked + patience => {
                    self.chased.remove(&rf);
                    self.by_referral.remove(&rf);
                    cx.decided(json!({ "domain": "delegation", "choice": "left_open", "step": "did_itself", "referral": rf, "kind": m.kind, "asked": asked, "inputs": [rf] }));
                    self.myself(&action, &m, "Left open after we asked after it: doing it ourselves.");
                }
                Some(_) => {}
                None => {
                    // (Its clock: the day its referral names, else its patience from the hand-over; anything its assistant
                    // sent on it since stops it.)
                    let since = [Draft::KIND, ApprovalRequest::KIND, Report::KIND, Advice::KIND]
                        .iter()
                        .flat_map(|k| self.book.all(k))
                        .filter(|r| r.speaks_for.as_deref() != Some(self.me.as_str()) && crate::common::data(r).s("referral") == Some(rf.as_str()))
                        .count();
                    let due = m.due.unwrap_or(m.at + patience);
                    if since == 0 && t >= due {
                        self.chase(&rf, &m, t, "clock", cx);
                    }
                }
            }
        }
    }

    /// A letter to its assistant asking after a matter, once.
    fn chase(&mut self, referral: &str, m: &Matter, t: i64, why: &str, cx: &mut Cx) {
        self.chased.insert(referral.to_string(), t);
        let (to, _) = self.to_assistant(&m.agreement);
        let words = format!("We handed you {referral} on {}. Where does it stand?", crate::common::when_words(m.at, &cx.ctx.world));
        let c = crate::common::letters::message(&to, &words, Some(referral));
        let s: Step<()> = because(&words, vec![c]);
        self.queue.push(Own { program: program_text(&s.program()), why: words.clone(), then: Then::Plain });
        cx.decided(json!({ "domain": "delegation", "choice": "left_open", "step": "asked", "why": why, "referral": referral, "kind": m.kind, "handed": m.at, "inputs": [referral] }));
    }
}
