//! bank.payment_system: a bank's automated payment system (participants/src/behaviour/bank.ts; docs/behaviour/
//! bank-payment-system.md).
//!
//! It reads payment requests addressed to its bank (the standard encoding, docs/design/translator-and-resolver.md 9.1:
//! one-off payments, standing orders, bulk payments), applies the bank's procedure (only the account holder may instruct;
//! the money must be there), and moves money it holds in custody. It is content: a bank run by a different module (or an
//! AI) can freeze accounts, ignore instructions, or pay the wrong people. Physics does not stop it.
//!
//! Rewritten for Rust (docs/port-guide.md, section 2); the rules are TS's 0.17.1 and what changed is said here:
//! - A standing order is gone through when it is next due, not at every plan, unless what the bank's checks read has
//!   changed (the accounts it keeps and whose they are, the signatories it has been told of, whom it has learnt the
//!   writers are). TS kept a binary heap and an object identity for "changed"; Rust keeps an ordered set and a count.
//! - **A dead customer** (the fault the test audit found nobody was catching; kernel/tests/d_bank_dead.rs and the tests
//!   below): once a death is registered with the bank, the dead person's standing orders and one-off instructions are
//!   ended and dropped, not gone through again every day for ever; their account pays out only to settle the estate; an
//!   estate with nobody yet to receive it is looked at again at the next plan, not given up for good; and the note to the
//!   payer of a standing order into a dead person's account is kept by instruction (the latest due told), not by a set
//!   that grew with every payment. A death registered after a payment fell due does not undo it: a bank pays until it is told.
//! - An instruction the bank refuses for a reason the writer could not know is answered once, as before.
//!
//! Basis (docs/behaviour/bank-payment-system.md, deaths.md): a bank acts on its customer's instruction while the customer
//! lives; on being notified of a death it stops the deceased's standing orders and holds the account for the personal
//! representative, and pays out to the estate (law-succession: the partner, else the adult children, else the town).

use oikos_core::frozen::JsonRead;
use oikos_core::Frozen;
use super::{act, manifest_of, Kept, Note};
use crate::common::{
    addressed_to, cents, data, filed_before, first_due, message, money_words, when_words, who_wrote, Asked, Book, Fields, Letter, Letters, DAY,
    PAYEE_DIED, PAYMENT_FAILED,
};
use crate::steps::{call, pay, Pay};
use crate::{Action, Actor, Cx, Ctx, Kind, Picture};
use oikos_rules::words::refusal_text;
use oikos_sight::calls::Call;
use oikos_sight::{AccountItem, OutcomeStatus, Record, RecordBody, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::sync::Arc;

/// What a bank writes, once, to whoever put a hold on standing instructions of theirs (docs/behaviour/
/// bank-payment-system.md, "A hold"): which it will not pay under and from which due date, that nothing missed is made up,
/// that what the payments were for is still owed, and how the hold is lifted. `taken`: each instruction with the first due
/// date the hold stops, in the bank's words.
pub mod hold_note {
    pub fn taken(hold: &str, taken: &[String]) -> String {
        format!("Hold {hold} is in place. Not paid while it stands: {}. Anything due before then is still paid. A payment not made under a hold is not made up when the hold is lifted: what it was for is still owed, and is yours to settle with whoever it is owed to. To resume, withdraw {hold}; payments then go on from the next due date.", taken.join("; "))
    }
}

pub struct PaymentSystem;

const MANIFEST: &str = include_str!("manifests/bank.payment_system.json");

impl Kind for PaymentSystem {
    fn name(&self) -> &'static str {
        "bank.payment_system"
    }
    fn version(&self) -> &'static str {
        "0.18.0"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/bank-payment-system.md"
    }
    fn manifest(&self) -> Value {
        let mut m = manifest_of(MANIFEST);
        m["version"] = self.version().into();
        m
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        DAY
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        let p = Params {
            verify_author: ctx.param("verify_author", true)?,
            who: ctx.param::<Option<String>>("who", None)?.filter(|w| !w.is_empty()),
            review_all: ctx.param("review_all", false)?,
            max_batch: ctx.param::<i64>("max_batch", 32)?.clamp(1, 32) as usize,
            hold_notice: ctx.param::<i64>("hold_notice", 86_400)?.max(0),
            letter_lists: ctx.param::<i64>("letter_lists", 40)?.max(0) as usize,
            statement_lists: ctx.param::<i64>("statement_lists", 40)?.max(1) as usize,
            town: ctx.param("town", String::new())?,
            courts: ctx.param("courts", Vec::<String>::new())?,
        };
        Ok(Box::new(Bank::new(p)))
    }
    fn restore(&self, _: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        let mut b: Bank = serde_json::from_value(saved.get("bank").cloned().ok_or("bank: nothing saved")?).map_err(|e| e.to_string())?;
        b.book = Book::restore(saved.get("book").cloned().ok_or("bank: no book saved")?)?;
        Ok(Box::new(b))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Params {
    /// Whether an instruction must be written by one of the account holder's own seats (default: yes).
    verify_author: bool,
    /// Where it looks up who wrote an instruction (its channel onto who's who: nobody is shown it; none: it knows of
    /// writers only what it is shown).
    who: Option<String>,
    /// Go through every standing order at every plan (the long way: for checking the short one).
    review_all: bool,
    max_batch: usize,
    /// How long before a due date a hold must be given to stop that payment (seconds).
    hold_notice: i64,
    /// How many of a customer's standing instructions a letter lists.
    letter_lists: usize,
    /// How many entries a statement lists, the latest, before giving the rest as a count within the totals.
    statement_lists: usize,
    /// An estate with no heirs goes to the town, if the world names one.
    town: String,
    /// Whose garnishee orders it carries out (the world's tribunals and courts).
    courts: Vec<String>,
}

/// A payment to make.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Payment {
    instruction: String,
    from: String,
    to: String,
    amount: i64,
    due: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    settles: Option<String>,
    /// What the payer said the payment is for, as the payee's statement narrates it (a bank statement's line).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    memo: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    line: Option<String>,
    /// Retried alone, after a batch was refused.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    single: bool,
}

/// What the bank has entered for an account: how many entries there have been, what they come to in and out, and the
/// latest of them (as many as a statement lists).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct Ledger {
    n: i64,
    paid_in: i64,
    paid_out: i64,
    latest: Vec<Transaction>,
}

/// Where an account's ledger stood at the last statement to a writer.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
struct Stated {
    n: i64,
    paid_in: i64,
    paid_out: i64,
    t: i64,
}

/// What the checks read, when last gone through (a change makes every standing order be gone through again).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Read {
    accounts: Vec<(String, String)>,
    signatories: Vec<String>,
    who_is_who: usize,
}

type Custody<'a> = BTreeMap<&'a str, &'a AccountItem>;

#[derive(Serialize, Deserialize)]
struct Bank {
    p: Params,
    #[serde(skip)]
    book: Book,
    asked: Asked,
    letters: Letters,
    /// One-off instructions handled.
    done: BTreeSet<String>,
    /// Death registration -> the heirs' accounts its estate goes to.
    settled: BTreeMap<String, Vec<String>>,
    /// Standing order -> next due time.
    next_due: BTreeMap<String, i64>,
    /// Standing order -> the latest due date at which its payer was told the payee has died.
    told_died: BTreeMap<String, i64>,
    cursor: usize,
    /// Standing orders, kept until withdrawn (so a plan never rescans every instruction ever made).
    standing: BTreeSet<String>,
    /// Each order under its next due time (an entry is stale once that has moved on); `undated`: orders with no due time
    /// yet (never got as far as being due: refused, or not their holder's), gone through at every plan as they always were.
    by_due: BTreeSet<(i64, String)>,
    undated: BTreeSet<String>,
    /// What has been withdrawn, as the bank acts on it: an instruction or a hold, and when its withdrawal took effect.
    ended: BTreeMap<String, i64>,
    withdrawal_cursor: usize,
    /// Withdrawals of a paper it has not been shown yet.
    unplaced: Vec<String>,
    withdrawal_notes: Vec<Note>,
    hold_cursor: usize,
    /// Holds: each order's accepted holds, with the time from which each counts.
    holds_on: BTreeMap<String, Vec<(String, i64)>>,
    hold_notes: Vec<Note>,
    ledgers: BTreeMap<String, Ledger>,
    /// `<writer> <account>` -> where the ledger stood at the last statement to them.
    stated_to: BTreeMap<String, Stated>,
    ledger_from: Option<i64>,
    read: Option<Read>,
    queue: VecDeque<Payment>,
    queued_at: i64,
    in_flight: Vec<Payment>,
    refusals: Vec<Note>,
    /// Accounts to open, as asked: the holder.
    opens: Vec<String>,
    replies: VecDeque<Kept>,
}

impl Bank {
    fn new(p: Params) -> Bank {
        Bank {
            p,
            book: Book::new(),
            asked: Asked::default(),
            letters: Letters::default(),
            done: BTreeSet::new(),
            settled: BTreeMap::new(),
            next_due: BTreeMap::new(),
            told_died: BTreeMap::new(),
            cursor: 0,
            standing: BTreeSet::new(),
            by_due: BTreeSet::new(),
            undated: BTreeSet::new(),
            ended: BTreeMap::new(),
            withdrawal_cursor: 0,
            unplaced: vec![],
            withdrawal_notes: vec![],
            hold_cursor: 0,
            holds_on: BTreeMap::new(),
            hold_notes: vec![],
            ledgers: BTreeMap::new(),
            stated_to: BTreeMap::new(),
            ledger_from: None,
            read: None,
            queue: VecDeque::new(),
            queued_at: -1,
            in_flight: vec![],
            refusals: vec![],
            opens: vec![],
            replies: VecDeque::new(),
        }
    }

    // ---------------------------------------------------------------- who may instruct

    /// The positions an account holder has told the bank may instruct payments from an account (latest standing list), if any.
    fn signatories(&self, holder: &str, account: &str) -> Option<Vec<String>> {
        let list = self.book.open("signatories").rfind(|r| r.speaks_for.as_deref() == Some(holder) && data(r).s("account") == Some(account))?;
        data(list).get("positions").and_then(|x| x.as_array()).map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
    }

    /// Whether whoever made this record may instruct on this account: written for its holder, by one of the holder's own
    /// seats, and where the holder has named signatories for the account, in one of those posts.
    fn may_instruct(&self, r: &Record, acc: Option<&AccountItem>) -> bool {
        let Some(acc) = acc else { return false };
        if r.speaks_for.as_deref() != Some(acc.holder.as_str()) || (self.p.verify_author && self.book.author_entity(r) != Some(acc.holder.as_str())) {
            return false;
        }
        match self.signatories(&acc.holder, &acc.account) {
            None => true,
            Some(named) => r.author == "genesis" || named.iter().any(|n| Some(n.as_str()) == r.position.as_deref().or(Some(""))),
        }
    }

    /// Why not, in one sentence that tells the writer nothing they could not know: one of the account holder's own people
    /// who is not a signatory is told that; anyone else, that there is nothing of theirs by that reference.
    fn why_not(&self, r: &Record, acc: Option<&AccountItem>) -> Option<String> {
        let acc = acc?;
        (r.speaks_for.as_deref() == Some(acc.holder.as_str()) && (!self.p.verify_author || self.book.author_entity(r) == Some(acc.holder.as_str())))
            .then(|| format!("{} is not an authorised signatory for {}", r.position.as_deref().unwrap_or(&r.author), acc.account))
    }

    /// Who a letter about a record is to: the organisation it speaks for if genesis, else the post or the writer.
    fn to_whom(&self, r: &Record, me: &str) -> Vec<String> {
        vec![if r.author == "genesis" { (r.speaks_for.unwrap_or_else(|| me.to_string().into())).to_string() } else { (r.position.unwrap_or_else(|| r.author.clone().into())).to_string() }]
    }

    fn paying_account<'a>(order: Option<&Record>, custody: &Custody<'a>) -> Option<&'a AccountItem> {
        let d = data(order?);
        let from = d.get("outcome").and_then(|o| o.get("money")).and_then(|m| m.s("from")).or_else(|| d.s("from"))?;
        custody.get(from).copied()
    }

    // ---------------------------------------------------------------- the plan: what falls due

    /// Whether a payment under an order, due at a time, is under a hold: one that counted by then and had not been lifted.
    fn held(&self, order: &str, at: i64) -> bool {
        self.holds_on.get(order).is_some_and(|on| on.iter().any(|(hold, from)| *from <= at && self.ended.get(hold).is_none_or(|lifted| *lifted > at)))
    }

    #[allow(clippy::too_many_lines)]
    fn plan(&mut self, pic: &Picture, cx: &mut Cx) -> Vec<Payment> {
        let me = pic.entity;
        let t = pic.t;
        let world = cx.ctx.world.clone();
        let custody: Custody = pic.accounts().filter(|a| a.custodian == me).map(|a| (a.account.as_str(), a)).collect();
        // Has what the checks read changed since the last plan? (Who is who as far as it has been shown or has looked
        // up: who wrote an order it could not place before may be known now.)
        let signatories: Vec<String> = self.book.open("signatories").map(|r| r.id).map(|x| x.to_string()).collect();
        let now_read = Read {
            accounts: custody.values().map(|a| (a.account.to_string(), a.holder.to_string())).collect(),
            signatories,
            who_is_who: if self.p.who.is_some() { 0 } else { self.book.positions().len() },
        };
        let changed = self.p.review_all || self.read.as_ref() != Some(&now_read);
        if changed {
            self.read = Some(now_read);
        }
        // (Only what has come since the last plan is read: the book's lists grow all run, and copying each whole at every
        // plan made the bank's wakes cost more the longer the town had run.)
        let requests = self.book.all("request").len();
        let fresh: Vec<Arc<Record>> = self.book.all("request").skip(self.cursor).filter(|r| addressed_to(r).iter().any(|x| x == &me.to_string())).cloned().collect();
        self.cursor = requests;
        for r in &fresh {
            let every = data(r).get("every").and_then(|x| x.as_i64()).is_some_and(|e| e > 0);
            if every && !data(r).get("payments").is_some_and(|x| x.is_array()) && !self.ended.contains_key(r.id.as_str()) {
                self.standing.insert(r.id.to_string());
                if !self.next_due.contains_key(r.id.as_str()) {
                    self.undated.insert(r.id.to_string());
                }
            }
        }
        // Withdrawals that have arrived since the last plan, and instructions that say they replace another. Each is acted
        // on only from whoever may instruct on the account; the rest are answered, and what they named stands.
        let mut just_ended: Vec<String> = vec![];
        let mut lifts: Vec<(Arc<Record>, Arc<Record>, Vec<String>)> = vec![];
        let withdrawals = self.book.of_type("withdrawal").len();
        let mut to_place: Vec<Arc<Record>> = std::mem::take(&mut self.unplaced).iter().filter_map(|id| self.book.get(id).cloned()).collect();
        to_place.extend(self.book.of_type("withdrawal").skip(self.withdrawal_cursor).cloned());
        self.withdrawal_cursor = withdrawals;
        for w in to_place {
            let RecordBody::Withdrawal { withdraws, .. } = &w.body else { continue };
            let Some(target) = self.book.get(withdraws).cloned() else {
                if self.unplaced.len() < 256 {
                    self.unplaced.push(w.id.to_string()); // (the paper it names has not reached us yet: looked at again next plan)
                }
                continue;
            };
            if !matches!(target.body, RecordBody::Statement { .. }) || !addressed_to(&target).iter().any(|x| x == &me.to_string()) || self.ended.contains_key(target.id.as_str()) {
                continue;
            }
            let to = self.to_whom(&w, &me);
            match crate::common::kind(&target) {
                Some("request") => {
                    let acc = Self::paying_account(Some(&target), &custody);
                    if self.may_instruct(&w, acc) {
                        self.ended.insert(target.id.to_string(), w.at);
                        just_ended.push(target.id.to_string());
                    } else if self.standing.contains(target.id.as_str()) || !self.done.contains(target.id.as_str()) {
                        let text = match self.why_not(&w, acc) {
                            Some(why) => format!("Withdrawal {} is not acted on, and {} stands: {why}.", w.id, target.id),
                            None => format!("Withdrawal {} does not apply to {}: we have no standing instruction of yours by that reference.", w.id, target.id),
                        };
                        self.withdrawal_notes.push(Note::new(to, text, Some(&w.id)));
                    }
                }
                Some("hold") => lifts.push((w.clone(), target.clone(), to)),
                _ => {}
            }
        }
        // (An instruction that names the one it replaces: the earlier one ends when the later was given, if whoever gave
        // the later may instruct on the account the earlier pays from. Otherwise the earlier stands; the later is answered
        // for itself, below, as any instruction is.)
        for r in &fresh {
            let Some(old) = data(r).s("replaces").and_then(|id| self.book.get(id)).cloned() else { continue };
            if crate::common::kind(&old) != Some("request") || !addressed_to(&old).iter().any(|x| x == &me.to_string()) || self.ended.contains_key(old.id.as_str()) {
                continue;
            }
            if !self.may_instruct(r, Self::paying_account(Some(&old), &custody)) {
                continue;
            }
            self.ended.insert(old.id.to_string(), r.at);
            just_ended.push(old.id.to_string());
        }
        // (A payment that fell due before its order was withdrawn is still made: the bank goes through its plans a day
        // apart, and an order replaced in the hours after its pay day, a wage at a new rate say, would lose that pay.)
        let mut last_call: BTreeMap<String, (Arc<Record>, i64)> = BTreeMap::new();
        for id in just_ended {
            if !self.standing.contains(&id) {
                continue;
            }
            let Some(r) = self.book.get(&id).cloned() else { continue };
            let until = self.ended.get(&id).copied().unwrap_or(t);
            let every = data(&r).get("every").and_then(|x| x.as_i64()).unwrap_or(DAY);
            let next = self.next_due.get(&id).copied().unwrap_or_else(|| first_due(&r, every));
            if next <= until {
                last_call.insert(id.clone(), (r, until));
            }
            self.standing.remove(&id);
            self.undated.remove(&id);
        }
        // Holds that have arrived since the last plan. One counts for a standing order the bank has from whoever may
        // instruct on the account it pays from (the same check as for any instruction); for anything else the writer is
        // told, in one sentence that says nothing of anyone else's instructions. Either way it is answered, once.
        let holds_seen = self.book.all("hold").len();
        let holds: Vec<Arc<Record>> = self.book.all("hold").skip(self.hold_cursor).cloned().collect();
        for h in holds.iter() {
            if !addressed_to(h).iter().any(|x| x == &me.to_string()) {
                continue;
            }
            let Some(list) = data(h).get("holds").and_then(|x| x.as_array()) else { continue };
            let (mut taken, mut not, mut unsigned): (Vec<String>, Vec<String>, Vec<String>) = (vec![], vec![], vec![]);
            let mut seen = BTreeSet::new();
            let ids: Vec<&str> = list.iter().filter_map(|x| x.as_str()).filter(|id| seen.insert(*id)).take(64).collect();
            for id in ids {
                let order = if self.standing.contains(id) { self.book.get(id).cloned() } else { None };
                let acc = Self::paying_account(order.as_deref(), &custody);
                let Some(order) = order.filter(|_| self.may_instruct(h, acc)) else {
                    // (One of the account holder's own people who is not a signatory is told so; anyone else is told
                    // nothing of whose the instruction is.)
                    let why = if self.standing.contains(id) { self.why_not(h, acc) } else { None };
                    match why {
                        Some(w) => unsigned.push(format!("Hold {} is not in place on {id}: {w}.", h.id)),
                        None => not.push(id.to_string()),
                    }
                    continue;
                };
                let from = h.at + self.p.hold_notice;
                self.holds_on.entry(id.to_string()).or_default().push((h.id.to_string(), from));
                // (The first payment it stops: the first due at or after the time it counts from.)
                let every = data(&order).get("every").and_then(|x| x.as_i64()).unwrap_or(DAY);
                let next = self.next_due.get(id).copied().unwrap_or_else(|| first_due(&order, every));
                let first = if next >= from { next } else { next + (from - next + every - 1).div_euclid(every) * every };
                taken.push(format!("{id}, from the payment due on day {}", first.div_euclid(DAY) + 1));
            }
            if taken.is_empty() && not.is_empty() && unsigned.is_empty() {
                continue;
            }
            let mut said: Vec<String> = vec![];
            if !taken.is_empty() {
                said.push(hold_note::taken(&h.id, &taken));
            }
            said.extend(unsigned);
            if !not.is_empty() {
                said.push(format!("Hold {} does not apply to {}: we have no standing instruction of yours by that reference.", h.id, not.join(", ")));
            }
            let to = self.to_whom(h, &me);
            self.hold_notes.push(Note::new(to, said.join(" "), Some(&h.id)));
        }
        self.hold_cursor = holds_seen;
        // Holds withdrawn: a hold is lifted by whoever may instruct on the accounts its orders pay from, every one of them.
        // (The accounts as they were when the hold was taken: an order since ended is no longer looked at.)
        for (w, hold, to) in lifts {
            let orders: Vec<String> = self.holds_on.iter().filter(|(_, on)| on.iter().any(|(h, _)| *h == hold.id)).map(|(order, _)| order.clone()).collect();
            if orders.is_empty() {
                continue; // (a hold we never took: nothing to lift)
            }
            let accounts: Vec<Option<&AccountItem>> = orders.iter().map(|o| Self::paying_account(self.book.get(o).map(|r| &**r), &custody)).collect();
            if accounts.iter().all(|acc| self.may_instruct(&w, *acc)) {
                self.ended.insert(hold.id.to_string(), w.at);
            } else {
                let bad = accounts.iter().find(|acc| !self.may_instruct(&w, **acc)).copied().flatten();
                let text = match self.why_not(&w, bad) {
                    Some(why) => format!("Withdrawal {} is not acted on, and hold {} stands: {why}.", w.id, hold.id),
                    None => format!("Withdrawal {} does not apply to {}: we have no hold of yours by that reference.", w.id, hold.id),
                };
                self.withdrawal_notes.push(Note::new(to, text, Some(&w.id)));
            }
        }
        // The instructions to go through: the new ones, and of the standing orders every one if what is checked has
        // changed, else those due by now and those with no due time.
        let mut look: BTreeMap<String, Arc<Record>> = BTreeMap::new();
        let mut due_taken: Vec<(i64, String)> = vec![];
        if changed {
            for id in &self.standing {
                if let Some(r) = self.book.get(id) {
                    look.insert(id.clone(), r.clone());
                }
            }
        } else {
            for id in &self.undated {
                if let Some(r) = self.book.get(id) {
                    look.insert(id.clone(), r.clone());
                }
            }
            while let Some((at, id)) = self.by_due.first().cloned() {
                if at > t {
                    break;
                }
                self.by_due.pop_first();
                if !self.standing.contains(&id) || self.next_due.get(&id) != Some(&at) || look.contains_key(&id) {
                    continue; // (withdrawn, or its due time has moved on)
                }
                if let Some(r) = self.book.get(&id) {
                    look.insert(id.clone(), r.clone());
                }
                due_taken.push((at, id));
            }
        }
        for r in &fresh {
            look.insert(r.id.to_string(), r.clone());
        }
        for (id, (r, _)) in &last_call {
            look.insert(id.clone(), r.clone());
        }
        let mut instructions: Vec<Arc<Record>> = look.into_values().collect();
        instructions.sort_by(|a, b| filed_before(&a.id, &b.id));
        let mut out: Vec<Payment> = vec![];
        // Deaths registered: the dead person's instructions are no longer carried out (law-succession).
        let deaths: Vec<Arc<Record>> = self.book.all("death_registration").cloned().collect();
        let dead: BTreeSet<String> = deaths.iter().filter_map(|r| data(r).s("deceased").map(String::from)).collect();
        for ins in &instructions {
            if dead.contains(ins.speaks_for.as_deref().unwrap_or("")) {
                // (A dead person's instruction is no more carried out. It is ended, so that it is not gone through again
                // every day for ever; and a one-off not yet made is lapsed. Nobody is told: nobody is there to be.)
                if self.standing.remove(ins.id.as_str()) {
                    self.undated.remove(ins.id.as_str());
                    self.ended.entry(ins.id.to_string()).or_insert(t);
                }
                continue;
            }
            if self.ended.contains_key(ins.id.as_str()) && !last_call.contains_key(ins.id.as_str()) {
                continue;
            }
            self.go_through(ins, &custody, &dead, &last_call, t, &me, &world, &mut out);
        }
        // (An order that was due and was not gone through to its payments, its holder dead or its author not the holder's:
        // still due, so gone through again at the next plan.)
        for (at, id) in due_taken {
            if self.standing.contains(&id) && self.next_due.get(&id) == Some(&at) {
                self.by_due.insert((at, id));
            }
        }
        self.settle_estates(&deaths, &dead, &custody, t, &mut out);
        self.garnish(&custody, t, &me, &mut out);
        out.sort_by(|a, b| a.due.cmp(&b.due).then_with(|| filed_before(&a.instruction, &b.instruction)));
        out
    }

    /// One instruction, gone through: an account to open, a bulk payment, a one-off, or a standing order's payments due.
    #[allow(clippy::too_many_arguments)]
    fn go_through(&mut self, ins: &Arc<Record>, custody: &Custody, dead: &BTreeSet<String>, last_call: &BTreeMap<String, (Arc<Record>, i64)>, t: i64, me: &str, world: &crate::WorldInfo, out: &mut Vec<Payment>) {
        let d = data(ins);
        // Requests the bank cannot carry out get a reply, once, as a real bank's would (docs/behaviour/bank-payment-system.md).
        macro_rules! cannot {
            ($why:expr) => {{
                if self.done.insert(ins.id.to_string()) {
                    let to = self.to_whom(ins, me);
                    self.refusals.push(Note::new(to, format!("Request {} not carried out: {}", ins.id, $why), Some(&ins.id)));
                }
            }};
        }
        // Opening an account: for whoever asks, in their own name (the bank's procedure; no checks beyond that yet).
        let outcome = d.get("outcome");
        if let Some(opening) = outcome.and_then(|o| o.get("account")).filter(|a| a.is_object() && !a.flag("close")) {
            if !self.done.insert(ins.id.to_string()) {
                return;
            }
            let holder = opening.s("holder");
            if holder != ins.speaks_for.as_deref() || self.book.author_entity(ins) != ins.speaks_for.as_deref() {
                let to = self.to_whom(ins, me);
                self.refusals.push(Note::new(to, format!("Request {} not carried out: an account can only be opened by the person or organisation it's for.", ins.id), Some(&ins.id)));
            } else if let Some(h) = holder {
                self.opens.push(h.to_string());
            }
            return;
        }
        // A bulk payment (a share registry's dividends, say): one instruction, from one account, to many, once.
        let bulk: Option<&[Frozen]> = d.get("payments").and_then(|x| x.as_array());
        let money = outcome.and_then(|o| o.get("money"));
        let amount_of = |v: Option<&Frozen>| v.and_then(JsonRead::whole);
        let (from, to, pay_amount, settles, said_by) = if let Some(b) = bulk {
            (d.s("from"), Some("(many)"), b.iter().map(|x| amount_of(x.get("amount")).unwrap_or(0)).sum::<i64>(), None, None)
        } else {
            match money {
                Some(m) => (m.s("from"), m.s("to"), amount_of(m.get("amount")).unwrap_or(0), m.s("settles"), Some(m)),
                None => {
                    cannot!("this bank only makes payments and opens accounts.");
                    return;
                }
            }
        };
        if let Some(b) = bulk {
            if b.iter().any(|x| x.s("to").is_none() || amount_of(x.get("amount")).is_none_or(|a| a <= 0)) {
                cannot!("a payment in it doesn't say a valid amount and account to pay.");
                return;
            }
        }
        // (What the payer said it is for goes with the money: the line on the payee's statement.)
        let said = |x: Option<&Frozen>| -> (Option<String>, Option<String>) {
            let memo = x.and_then(|x| x.s("for")).filter(|s| !s.is_empty()).map(|s| s.strip_suffix('.').unwrap_or(s).chars().take(120).collect());
            (memo, x.and_then(|x| x.s("line")).filter(|s| !s.is_empty()).map(String::from))
        };
        let from_id = from.unwrap_or_default();
        let acc = custody.get(from_id).copied();
        if acc.is_some_and(|a| dead.contains(a.holder.as_str())) {
            return; // the account holder has died: it pays out only to settle the estate
        }
        let Some(acc) = acc else {
            cannot!(format!("this bank doesn't keep account {from_id}."));
            return;
        };
        let Some(to) = to.filter(|_| pay_amount > 0) else {
            cannot!("it doesn't say a valid amount and account to pay.");
            return;
        };
        // The bank's procedure: only the account holder may instruct it (someone acting for it: the person themselves, or
        // one of its positions), and if the holder has named the positions that may sign for this account, only those.
        if ins.speaks_for.as_deref() != Some(acc.holder.as_str()) || (self.p.verify_author && self.book.author_entity(ins) != Some(acc.holder.as_str())) {
            return;
        }
        if let Some(named) = self.signatories(&acc.holder, from_id) {
            if ins.author != "genesis" && !named.iter().any(|n| Some(n.as_str()) == ins.position.as_deref().or(Some(""))) {
                cannot!(format!("{} is not an authorised signatory for {from_id}.", ins.position.as_deref().unwrap_or(&ins.author)));
                return;
            }
        }
        let every = if bulk.is_some() { None } else { d.get("every").and_then(|x| x.as_i64()).filter(|e| *e > 0) };
        if let Some(every) = every {
            // A standing order into the account of someone we have been told has died: the payer is told at each payment
            // until it stops it (how an employer comes to know: docs/behaviour/deaths.md; a letter to an office with nobody in
            // it is lost, so it says so again at the next). It is still carried out, into the estate.
            let was = self.next_due.get(ins.id.as_str()).copied();
            let mut due = was.unwrap_or_else(|| first_due(ins, every));
            // (Said when a payment under it next falls due, so that it is said at the same moment however often the order
            // is gone through.)
            let payee = if due <= t { custody.get(to).copied() } else { None };
            if let Some(p) = payee.filter(|p| dead.contains(p.holder.as_str())) {
                if self.told_died.get(ins.id.as_str()).is_none_or(|told| *told < due) {
                    self.told_died.insert(ins.id.to_string(), due);
                    let to_payer = self.to_whom(ins, me);
                    self.refusals.push(Note::new(to_payer, PAYEE_DIED::note(&p.holder, to, &ins.id), Some(&ins.id)));
                }
            }
            let until = t.min(last_call.get(ins.id.as_str()).map_or(t, |(_, u)| *u));
            let (memo, line) = said(said_by);
            while due <= until {
                // (A due date under a hold is passed over: not paid then, and not made up when the hold is lifted.)
                if !self.held(&ins.id, due) {
                    out.push(Payment { instruction: ins.id.to_string(), from: from_id.to_string(), to: to.to_string(), amount: pay_amount, due, settles: None, memo: memo.clone(), line: line.clone(), single: false });
                }
                due += every;
            }
            self.next_due.insert(ins.id.to_string(), due);
            if Some(due) != was && self.standing.contains(ins.id.as_str()) {
                self.undated.remove(ins.id.as_str());
                self.by_due.insert((due, ins.id.to_string()));
            }
        } else if let Some(b) = bulk {
            if self.done.insert(ins.id.to_string()) {
                for x in b {
                    let (memo, line) = said(Some(x));
                    out.push(Payment {
                        instruction: ins.id.to_string(),
                        from: from_id.to_string(),
                        to: x.s("to").unwrap_or_default().to_string(),
                        amount: amount_of(x.get("amount")).unwrap_or(0),
                        due: ins.at,
                        settles: None,
                        memo,
                        line,
                        single: false,
                    });
                }
            }
        } else if self.done.insert(ins.id.to_string()) {
            let (memo, line) = said(said_by);
            out.push(Payment { instruction: ins.id.to_string(), from: from_id.to_string(), to: to.to_string(), amount: pay_amount, due: ins.at, settles: settles.map(String::from), memo, line, single: false });
        }
        let _ = world;
    }

    /// Settling an estate, as law-succession says: to the partner; else equally to the adult children; else the town. The
    /// heirs are settled once; what comes into the estate later (a dividend, a refund) is passed on to them too, as an
    /// estate's administrator does. An estate with nobody yet to receive it is kept, and looked at again at the next plan.
    fn settle_estates(&mut self, deaths: &[Arc<Record>], dead: &BTreeSet<String>, custody: &Custody, t: i64, out: &mut Vec<Payment>) {
        let account_of = |holder: &str| custody.values().find(|a| a.holder == holder && !dead.contains(holder)).map(|a| a.account);
        for r in deaths {
            if !self.settled.contains_key(r.id.as_str()) {
                let d = data(r);
                let mut heirs: Vec<String> = d.s("partner").filter(|x| !x.is_empty()).and_then(account_of).into_iter().map(|x| x.to_string()).collect();
                if heirs.is_empty() {
                    heirs = d.ids("adult_children").into_iter().filter_map(&account_of).map(|x| x.to_string()).collect();
                }
                if heirs.is_empty() {
                    heirs = Some(self.p.town.as_str()).filter(|t| !t.is_empty()).and_then(account_of).into_iter().map(|x| x.to_string()).collect();
                }
                if heirs.is_empty() {
                    continue;
                }
                self.settled.insert(r.id.to_string(), heirs);
            }
            let to = &self.settled[r.id.as_str()];
            for acc in custody.values() {
                if Some(acc.holder.as_str()) != data(r).s("deceased") {
                    continue;
                }
                let balance = cents(acc.balance);
                if balance <= 0 {
                    continue;
                }
                let each = balance / to.len() as i64;
                for (i, account) in to.iter().enumerate() {
                    let amount = if i == 0 { balance - each * (to.len() as i64 - 1) } else { each };
                    if amount > 0 {
                        out.push(Payment { instruction: r.id.to_string(), from: acc.account.to_string(), to: account.clone(), amount, due: t, settles: None, memo: None, line: None, single: false });
                    }
                }
            }
        }
    }

    /// Garnishee orders (docs/behaviour/justice.md): a court's or tribunal's order to pay a debt from what we hold for the
    /// debtor, carried out as the law requires: what the debtor's accounts here hold, up to the amount, to the creditor,
    /// settling the debt. Once each.
    fn garnish(&mut self, custody: &Custody, t: i64, me: &str, out: &mut Vec<Payment>) {
        let orders: Vec<Arc<Record>> = self
            .book
            .open("garnishee_order")
            .filter(|r| addressed_to(r).iter().any(|a| a == me) && !self.done.contains(r.id.as_str()) && self.p.courts.iter().any(|c| Some(c.as_str()) == r.speaks_for.as_deref()))
            .cloned()
            .collect();
        for g in orders {
            self.done.insert(g.id.to_string());
            let d = data(&g);
            let mut left = d.get("amount").and_then(crate::papers::lenient::whole).unwrap_or(0);
            let Some(to) = d.s("to") else { continue };
            if left <= 0 {
                continue;
            }
            for acc in custody.values().filter(|a| Some(a.holder.as_str()) == d.s("debtor") && cents(a.balance) > 0) {
                let amount = left.min(cents(acc.balance));
                left -= amount;
                out.push(Payment { instruction: g.id.to_string(), from: acc.account.to_string(), to: to.to_string(), amount, due: t, settles: d.s("claim").map(String::from), memo: None, line: None, single: false });
                if left <= 0 {
                    break;
                }
            }
        }
    }

    // ---------------------------------------------------------------- letters

    /// A letter to the bank answered with the writer's own accounts here, their balances and latest payments, and how to
    /// instruct the bank (pilot 9: a mayor wrote 34 times and heard nothing).
    fn account_report(&mut self, pic: &Picture, world: &crate::WorldInfo, holder: Option<&str>, writer: &str) -> String {
        let me = pic.entity.as_str();
        let mut mine: Vec<&AccountItem> = pic.accounts().filter(|a| a.custodian == me && Some(a.holder.as_str()) == holder).collect();
        mine.sort_by(|a, b| a.account.cmp(&b.account));
        if mine.is_empty() {
            return format!("Report from {me}: we hold no account for you. To open one, ask us for one in writing.");
        }
        let ids: BTreeSet<&str> = mine.iter().map(|a| a.account.as_str()).collect();
        let usd = |n: i64| money_words(n, world);
        let lists = self.p.statement_lists;
        // A statement of each account, from the bank's ledger: what was paid in and out since the last statement to this
        // writer (the first: since the ledger began), by date, with the account paid or paying, what the payer said it was
        // for, and the references a customer may know (their own instruction; what a payment settles). The payer's
        // instruction is not named to whoever was paid: it is the payer's paper.
        let mut statements: Vec<String> = vec![];
        for a in &mine {
            let l = self.ledgers.get(a.account.as_str()).cloned().unwrap_or_default();
            let key = format!("{writer} {}", a.account);
            let before = self.stated_to.get(&key).copied();
            let since = before.unwrap_or(Stated { n: 0, paid_in: 0, paid_out: 0, t: self.ledger_from.unwrap_or(pic.t) });
            self.stated_to.insert(key, Stated { n: l.n, paid_in: l.paid_in, paid_out: l.paid_out, t: pic.t });
            let (n, paid_in, paid_out) = (l.n - since.n, l.paid_in - since.paid_in, l.paid_out - since.paid_out);
            let balance = cents(a.balance);
            let period = format!("{} to {}{}", when_words(since.t, world), when_words(pic.t, world), if before.is_some() { " (since our last statement to you)" } else { "" });
            if n == 0 {
                statements.push(format!("Statement of {}, {period}: nothing was paid in or out. Balance {}.", a.account, usd(balance)));
                continue;
            }
            let k = (n as usize).min(lists).min(l.latest.len());
            let listed = &l.latest[l.latest.len() - k..];
            let entry = |x: &Transaction| {
                let out_of = x.from == a.account;
                let what = x.memo.as_deref().map(|m| format!(" ({})", m.strip_suffix('.').unwrap_or(m))).unwrap_or_default();
                format!(
                    "{}: paid {}{}{}{}",
                    when_words(x.t, world),
                    if out_of { format!("out {} to {}", usd(cents(x.amount)), x.to) } else { format!("in {} from {}", usd(cents(x.amount)), x.from) },
                    what,
                    if out_of { x.per_instruction.as_deref().map(|i| format!(", under your instruction {i}")).unwrap_or_default() } else { String::new() },
                    x.settles.as_deref().map(|s| format!(", settling {s}")).unwrap_or_default()
                )
            };
            statements.push(format!(
                "Statement of {}, {period}: balance brought forward {}. {}. {}In all {} paid out and {} paid in. Balance carried forward {}.",
                a.account,
                usd(balance - paid_in + paid_out),
                listed.iter().map(entry).collect::<Vec<_>>().join("; "),
                if (n as usize) > listed.len() { format!("Those are the latest {} of {n} entries; the {} before them are in the totals. ", listed.len(), n as usize - listed.len()) } else { String::new() },
                usd(paid_out),
                usd(paid_in),
                usd(balance)
            ));
        }
        // The writer's own standing instructions, each by its reference (what it is named by to withdraw it or to hold it):
        // from an account of theirs, in their name. Nobody else's.
        let mut orders: Vec<Arc<Record>> = self
            .standing
            .iter()
            .filter_map(|id| self.book.get(id))
            .filter(|r| r.speaks_for.as_deref() == holder && data(r).get("outcome").and_then(|o| o.get("money")).and_then(|m| m.s("from")).is_some_and(|f| ids.contains(f)))
            .cloned()
            .collect();
        orders.sort_by(|a, b| filed_before(&a.id, &b.id));
        let order = |r: &Arc<Record>| {
            let m = data(r).get("outcome").and_then(|o| o.get("money")).cloned().unwrap_or_default();
            let every = data(r).get("every").and_then(|x| x.as_i64()).unwrap_or(DAY);
            let next = self.next_due.get(r.id.as_str());
            let on: Vec<&str> = self.holds_on.get(r.id.as_str()).map(|v| v.iter().filter(|(h, _)| !self.ended.contains_key(h)).map(|(h, _)| h.as_str()).collect()).unwrap_or_default();
            // (Who gave it and when, and what it cites: what the instruction itself says, which is the customer's own paper.)
            let cites = crate::common::bases_of(r);
            let given = format!(
                ", given {}{}{}",
                if r.author == "genesis" { "before the year began".to_string() } else { format!("on {}", when_words(r.at, world)) },
                r.position.as_deref().map(|p| format!(" in your post {p}")).unwrap_or_default(),
                if cites.is_empty() { String::new() } else { format!(", citing {}", cites.join(", ")) }
            );
            format!(
                "{}: {} from {} to {} every {}{}{}{}",
                r.id,
                usd(m.get("amount").and_then(crate::papers::lenient::whole).unwrap_or(0)),
                m.s("from").unwrap_or_default(),
                m.s("to").unwrap_or_default(),
                if every % DAY == 0 { format!("{} day{}", every / DAY, if every == DAY { "" } else { "s" }) } else { format!("{every} seconds") },
                next.map(|n| format!(", next due day {}", n.div_euclid(DAY) + 1)).unwrap_or_default(),
                given,
                if on.is_empty() { String::new() } else { format!(", on hold ({})", on.join(", ")) }
            )
        };
        let cap = self.p.letter_lists;
        format!(
            "Report from {me}: {} {}We pay on your written instruction (a request to pay, once or every so often), from an account you hold, if its balance covers it. To end a standing instruction, withdraw it by its reference; to pause one, put a hold on it by its reference, and withdraw the hold to resume.",
            statements.join(" "),
            if orders.is_empty() {
                "You have no standing instructions with us. ".to_string()
            } else {
                format!(
                    "Your standing instructions with us: {}{}. ",
                    orders.iter().take(cap).map(order).collect::<Vec<_>>().join("; "),
                    if orders.len() > cap { format!("; and {} more", orders.len() - cap) } else { String::new() }
                )
            }
        )
    }

    fn enter(&mut self, account: &str, x: &Transaction, out: bool) {
        let keep = self.p.statement_lists;
        let l = self.ledgers.entry(account.to_string()).or_default();
        l.n += 1;
        if out {
            l.paid_out += cents(x.amount);
        } else {
            l.paid_in += cents(x.amount);
        }
        l.latest.push(x.clone());
        if l.latest.len() > 2 * keep {
            let cut = l.latest.len() - keep;
            l.latest.drain(..cut);
        }
    }
}

impl Actor for Bank {
    fn save(&self) -> Result<Value, String> {
        Ok(json!({ "bank": serde_json::to_value(self).map_err(|e| e.to_string())?, "book": self.book.save() }))
    }

    fn step(&mut self, pic: &Picture, cx: &mut Cx) -> Action {
        let world = cx.ctx.world.clone();
        self.book.absorb(pic);
        // Into the ledger: each payment in or out of an account, as the bank is shown it (once).
        self.ledger_from.get_or_insert(pic.t);
        let txs: Vec<Transaction> = pic.transactions().cloned().collect();
        for x in &txs {
            self.enter(&x.from, x, true);
            if x.to != x.from {
                self.enter(&x.to, x, false);
            }
        }
        self.letters.take(pic, &self.book);
        // (A wake's payments, planned when it begins or its plan is done: the stepper.)
        if self.queued_at != pic.t && (pic.woke_for != "done" || self.queue.is_empty()) {
            // Who wrote the instructions it is about to read for the first time: looked up first, each writer once
            // (docs/behaviour/bank-payment-system.md, "Who wrote it"). Its payment platform is a system under licence, and a
            // payment takes it a second (foundations F5): it plans knowing the answers. (And who wrote a hold it is about to
            // read: a hold is its customer's instruction too; and a withdrawal: only whoever may instruct on an account
            // ends an instruction on it.)
            let me = pic.entity.as_str();
            let mut unread: Vec<&Arc<Record>> = vec![];
            unread.extend(self.book.all("request").skip(self.cursor).filter(|r| addressed_to(r).iter().any(|a| a == me)));
            unread.extend(self.book.all("hold").skip(self.hold_cursor).filter(|r| addressed_to(r).iter().any(|a| a == me)));
            unread.extend(self.book.of_type("withdrawal").skip(self.withdrawal_cursor));
            let whom = who_wrote(&self.book, &mut self.asked, self.p.who.as_deref(), unread.into_iter().map(|r| &**r));
            if !whom.is_empty() {
                return Action::Look { looks: whom };
            }
            // Payments a busy moment did not get to (a wake allows only so many actions) are made first at the next: they are
            // already counted as due (a one-off as handled, a standing order's next date moved on), so never dropped.
            let fresh = self.plan(pic, cx);
            self.queue.extend(fresh);
            self.queued_at = pic.t;
            self.in_flight.clear();
        }
        // If the last batch was refused (the world changed under us), retry it one payment at a time; a single payment
        // that is refused is reported to the account holder, in plain words.
        if let Some(last) = pic.outcomes.last().filter(|o| o.status == OutcomeStatus::Refused) {
            if self.in_flight.len() > 1 {
                for p in std::mem::take(&mut self.in_flight).into_iter().rev() {
                    self.queue.push_front(Payment { single: true, ..p });
                }
            } else if let [p] = self.in_flight.as_slice() {
                if let Some(holder) = pic.accounts().find(|a| a.account == p.from).map(|a| a.holder) {
                    let code = last.refusal.as_ref().and_then(|r| serde_json::to_value(r.code).ok()).and_then(|v| v.as_str().map(String::from));
                    self.refusals.push(Note::new(
                        vec![holder.to_string()],
                        format!("Payment of {} to {} (request {}) couldn't be made: {}.", money_words(p.amount, &world), p.to, p.instruction, refusal_text(code.as_deref())),
                        Some(&p.instruction),
                    ));
                }
            }
        }
        self.in_flight.clear();
        let first_32 = |v: &mut Vec<Note>| -> Vec<Call> { v.drain(..v.len().min(32)).map(|n| n.call()).collect() };
        if !self.refusals.is_empty() {
            return act("Telling account holders about requests we couldn't carry out.", first_32(&mut self.refusals));
        }
        if !self.withdrawal_notes.is_empty() {
            return act(
                "Answering withdrawals of standing instructions and holds that we do not act on: whoever gave them may not instruct on the account, or there is nothing of theirs by that reference.",
                first_32(&mut self.withdrawal_notes),
            );
        }
        if !self.hold_notes.is_empty() {
            return act("Answering instructions to hold standing payments: what is held and from when, or that there is nothing of theirs by that reference.", first_32(&mut self.hold_notes));
        }
        // (Who wrote: the organisation of the position written in, or the participant's person, from the directory.)
        for (letter, (holder, writer)) in self.letters_answer() {
            let text = self.account_report(pic, &world, holder.as_deref(), &writer);
            let calls = vec![message(std::slice::from_ref(&letter.from), &text, Some(&letter.id))];
            self.replies.push_back(Kept::of("A letter to the bank: answering with a statement of the writer's own accounts (what was paid in and out since the last one) and their standing instructions.", &calls));
        }
        if let Some(r) = self.replies.pop_front() {
            return r.action();
        }
        if !self.opens.is_empty() {
            let me = pic.entity;
            let n = self.opens.len().min(32);
            let calls: Vec<Call> = self.opens.drain(..n).map(|h| call("account", vec![("holder", Some(crate::steps::arg(&h))), ("at", Some(crate::steps::arg(&me)))])).collect();
            return act("Opening accounts people asked for.", calls);
        }
        if self.queue.is_empty() {
            return Action::wait();
        }
        // (Each account as it is seen, and beside it what is left in those this batch pays from.)
        let seen: BTreeMap<&str, &AccountItem> = pic.accounts().map(|a| (a.account.as_str(), a)).collect();
        let mut left: BTreeMap<String, i64> = BTreeMap::new();
        let mut blocks: Vec<Call> = vec![];
        while !self.queue.is_empty() && blocks.len() < self.p.max_batch {
            let Some(p) = self.queue.pop_front() else { break };
            let from = seen.get(p.from.as_str());
            let have = left.get(&p.from).copied().unwrap_or_else(|| from.map_or(0, |a| cents(a.balance)));
            if have >= p.amount {
                blocks.push(pay(&p.to, p.amount, Pay { from: Some(p.from.clone()), per_request: Some(p.instruction.clone()), settles: p.settles.clone(), for_: p.memo.clone(), line: p.line.clone(), ..Default::default() }, cx));
                left.insert(p.from.clone(), have - p.amount);
                self.in_flight.push(p.clone());
            } else if let Some(a) = from {
                // Not enough money: the payment isn't made, and the account holder is told.
                blocks.push(message(std::slice::from_ref(&a.holder.to_string()), &PAYMENT_FAILED::note(&money_words(p.amount, &world), &p.to, &p.instruction), Some(&p.instruction)));
            }
            if p.single {
                break;
            }
        }
        if blocks.is_empty() {
            Action::wait()
        } else {
            act("Carrying out the payment requests due (each names its request), in order.", blocks)
        }
    }
}

impl Bank {
    /// The letters in, each with whom it was written for and who wrote it (for the report). A letter is answered once,
    /// however many wakes pass before the act is sent.
    fn letters_answer(&mut self) -> Vec<(Letter, (Option<String>, String))> {
        self.letters
            .drain()
            .into_iter()
            .map(|l| {
                let holder = l.entity.clone().or_else(|| match &l.position {
                    Some(p) => self.book.position(p).map(|x| x.entity.clone()),
                    None => self.book.person_of(&l.from).map(String::from),
                });
                let writer = l.position.clone().unwrap_or_else(|| l.from.clone());
                (l, (holder, writer))
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::finance::kit::{arg, calls, custody, json_arg, letter, records, statement, Rig, DAY, MONTH};

    fn who() -> Value {
        json!({ "kind": "directory", "positions": [{ "position": "firm-clerk", "entity": "firm" }, { "position": "firm-boss", "entity": "firm" }],
            "entities": [{ "entity": "firm", "kind": "organisation", "name": "Firm" }, { "entity": "c1", "kind": "person", "name": "C One", "participant": "c1-self" },
                { "entity": "c2", "kind": "person", "name": "C Two", "participant": "c2-self" }] })
    }
    fn bank(params: Value) -> Rig {
        Rig::new(&PaymentSystem, "bank", "bank-pay-system", params)
    }
    const RICH: &[(&str, i64)] = &[("c1", 9_000_000), ("c2", 9_000_000), ("firm", 9_000_000), ("landlord", 0)];
    /// What the bank is shown at `t`: the new records, the balances it keeps, who is who, the letters.
    fn at(m: &mut Rig, t: i64, rs: Vec<Value>, balances: &[(&str, i64)]) -> Vec<Call> {
        at_with(m, t, rs, balances, json!([]))
    }
    fn at_with(m: &mut Rig, t: i64, rs: Vec<Value>, balances: &[(&str, i64)], inbox: Value) -> Vec<Call> {
        m.at(t, json!({ "requests": records(rs), "custody": custody("bank", balances), "who": who() }), inbox)
    }
    fn person(id: &str) -> Value {
        json!({ "author": format!("{id}-self"), "speaks_for": id })
    }
    fn merge(mut a: Value, b: Value) -> Value {
        a.as_object_mut().unwrap().extend(b.as_object().unwrap().clone());
        a
    }
    /// A request to pay from a person's account.
    fn request(id: &str, at: i64, from: &str, amount: i64, extra: Value) -> Value {
        let data = merge(json!({ "outcome": { "money": { "from": format!("acc-{from}"), "to": "acc-landlord", "amount": amount.to_string(), "for": "Rent." } } }), extra);
        statement(id, at, "request", merge(person(from), json!({ "addressed_to": ["bank"], "visible_to": [from, "bank"] })), data)
    }
    fn order(id: &str, at: i64, from: &str) -> Value {
        request(id, at, from, 100_000, json!({ "every": 10 * DAY }))
    }
    fn hold(id: &str, at: i64, by: &str, holds: &[&str]) -> Value {
        statement(id, at, "hold", merge(person(by), json!({ "addressed_to": ["bank"], "visible_to": [by, "bank"] })), json!({ "holds": holds }))
    }
    fn lifted(id: &str, at: i64, what: &str, by: &str) -> Value {
        merge(json!({ "id": id, "at": at, "record": "withdrawal", "withdraws": what, "visible_to": [by, "bank"] }), person(by))
    }
    fn paid(said: &[Call], under: &str) -> usize {
        said.iter().filter(|c| c.fn_ == "money" && arg(c, "per_request").as_deref() == Some(under)).count()
    }
    fn notes(said: &[Call]) -> Vec<(Vec<String>, String, String)> {
        said.iter()
            .filter(|c| c.fn_ == "message")
            .map(|c| (json_arg(c, "to").as_array().unwrap().iter().map(|x| x.as_str().unwrap().to_string()).collect(), arg(c, "text").unwrap(), arg(c, "re").unwrap_or_default()))
            .collect()
    }
    fn money(said: &[Call]) -> Vec<(String, String)> {
        said.iter().filter(|c| c.fn_ == "money").map(|c| (arg(c, "per_request").unwrap(), arg(c, "amount").unwrap())).collect()
    }

    #[test]
    fn the_words_of_a_payment_failed_for_want_of_money_are_the_words_its_readers_know_it_by_and_no_other_note_reads_as_one() {
        let note = PAYMENT_FAILED::note("$1,000.00", "acc-landlord", "rec.12");
        assert_eq!(note, "Payment of $1,000.00 to acc-landlord (request rec.12) failed: insufficient funds.");
        assert!(PAYMENT_FAILED::is(&note).is_some());
        assert!(PAYMENT_FAILED::is("Payment of $1,000.00 to acc-landlord (request rec.12) couldn't be made: there's no such account.").is_none());
        assert!(PAYMENT_FAILED::is("Request rec.12 not carried out: this bank doesn't keep account acc-x.").is_none());
        assert!(PAYMENT_FAILED::is("Your application failed.").is_none());
    }

    #[test]
    fn a_standing_order_is_paid_on_each_due_date_naming_its_request() {
        let mut m = bank(json!({}));
        let so = request("so-1", 0, "c1", 100_000, json!({ "every": MONTH, "first": 0 }));
        let later = request("so-2", 0, "c2", 50_000, json!({ "every": MONTH })); // no `first`: due a period on
        let day0 = at(&mut m, 0, vec![so, later], &[("c1", 500_000), ("c2", 500_000), ("landlord", 0)]);
        assert_eq!(day0.len(), 1);
        let c = &day0[0];
        assert_eq!((c.fn_.as_str(), arg(c, "to").unwrap(), arg(c, "amount").unwrap(), arg(c, "for").unwrap(), arg(c, "from").unwrap(), arg(c, "per_request").unwrap()),
            ("money", "acc-landlord".to_string(), "$1000.00".to_string(), "Rent".to_string(), "acc-c1".to_string(), "so-1".to_string()), "with what the payer said it was for: the line on a statement");
        let held = &[("c1", 400_000), ("c2", 500_000), ("landlord", 0)];
        assert!(at(&mut m, DAY, vec![], held).is_empty());
        let day30 = at(&mut m, MONTH, vec![], held);
        assert_eq!(money(&day30), [("so-1".into(), "$1000.00".into()), ("so-2".into(), "$500.00".into())]);
        // Waking late (two due dates gone by), it pays each once.
        let late = at(&mut m, 3 * MONTH + DAY, vec![], held);
        assert_eq!(late.iter().filter(|c| arg(c, "per_request").as_deref() == Some("so-1")).count(), 2);
    }

    #[test]
    fn a_payment_the_account_cannot_cover_is_not_made_the_holder_is_told_once_and_that_due_date_is_not_tried_again() {
        let mut m = bank(json!({}));
        let so = request("so-1", 0, "c1", 100_000, json!({ "every": MONTH, "first": 0 }));
        // Day 0: $999.99 in the account, a cent short.
        let day0 = at(&mut m, 0, vec![so], &[("c1", 99_999)]);
        assert_eq!(notes(&day0), [(vec!["c1".to_string()], PAYMENT_FAILED::note("$1,000.00", "acc-landlord", "so-1"), "so-1".to_string())]);
        assert_eq!(day0.len(), 1);
        // The money arrives the next day: nothing. The missed payment is the payer's to make good, not the bank's to retry.
        assert!(at(&mut m, DAY, vec![], &[("c1", 900_000)]).is_empty());
        assert!(at(&mut m, 29 * DAY, vec![], &[("c1", 900_000)]).is_empty());
        // The next due date: one payment, the month's, and not the one missed as well.
        assert_eq!(money(&at(&mut m, MONTH, vec![], &[("c1", 900_000)])), [("so-1".into(), "$1000.00".into())]);
        // Short again a month on: told again, for that due date.
        assert_eq!(at(&mut m, 2 * MONTH, vec![], &[("c1", 5)]).iter().map(|c| c.fn_.as_str()).collect::<Vec<_>>(), ["message"]);
    }

    #[test]
    fn a_one_off_that_fails_is_told_and_done_with_and_payments_due_together_are_met_in_order_while_the_money_lasts() {
        let mut m = bank(json!({}));
        let once = request("pay-1", DAY, "c1", 70_000, json!({}));
        let told = at(&mut m, DAY, vec![once], &[("c1", 100)]);
        assert_eq!(notes(&told)[0].1, "Payment of $700.00 to acc-landlord (request pay-1) failed: insufficient funds.");
        assert!(at(&mut m, 2 * DAY, vec![], &[("c1", 900_000)]).is_empty());
        // Three one-offs from one account holding enough for the first two (by due time, then request id): the third
        // fails, counted against what the first two leave.
        let three = vec![request("pay-a", 3 * DAY, "c2", 60_000, json!({})), request("pay-b", 3 * DAY, "c2", 30_000, json!({})), request("pay-c", 3 * DAY, "c2", 20_000, json!({}))];
        let did = at(&mut m, 3 * DAY, three, &[("c1", 0), ("c2", 100_000)]);
        assert_eq!(did.iter().map(|c| (c.fn_.clone(), arg(c, "per_request").or(arg(c, "re")).unwrap())).collect::<Vec<_>>(), [("money".into(), "pay-a".into()), ("money".into(), "pay-b".into()), ("message".into(), "pay-c".into())]);
    }

    #[test]
    fn a_payment_the_world_refuses_is_reported_in_other_words_that_do_not_read_as_a_payment_failed_for_want_of_money() {
        let mut m = bank(json!({}));
        let channels = |rs: Vec<Value>| json!({ "requests": records(rs), "custody": custody("bank", &[("c1", 100_000)]), "who": who() });
        let first = calls(&m.wake(DAY, "cadence", channels(vec![request("pay-1", DAY, "c1", 70_000, json!({}))]), json!([]), json!([])));
        assert_eq!(first.iter().map(|c| c.fn_.as_str()).collect::<Vec<_>>(), ["money"]);
        let refused = json!([{ "action": "act.1", "t": DAY, "status": "refused", "refusal": { "code": "unknown_account" } }]);
        let told = calls(&m.wake(DAY, "done", channels(vec![]), json!([]), refused));
        assert_eq!(notes(&told), [(vec!["c1".to_string()], "Payment of $700.00 to acc-landlord (request pay-1) couldn't be made: there's no such account.".to_string(), "pay-1".to_string())]);
        assert!(PAYMENT_FAILED::is(&notes(&told)[0].1).is_none());
    }

    #[test]
    fn someone_who_pays_by_standing_order_into_the_account_of_a_person_who_has_died_is_told_at_each_payment_and_it_is_still_paid_into_the_estate() {
        let mut m = bank(json!({}));
        let wages = request("r1", 0, "c1", 50_000, json!({ "every": 14 * DAY, "first": 14 * DAY }));
        let wages = merge(wages, json!({}));
        let wages = {
            let mut w = wages;
            w["data"]["outcome"]["money"]["to"] = "acc-c2".into();
            w
        };
        let death = statement("d1", 20 * DAY, "death_registration", json!({ "speaks_for": "city", "addressed_to": ["bank"], "visible_to": ["city", "bank"] }), json!({ "deceased": "c2" }));
        let told = |said: &[Call]| notes(said).into_iter().filter_map(|(to, text, re)| PAYEE_DIED::who(&text).map(|w| (to, re, w.to_string()))).collect::<Vec<_>>();
        let first = at(&mut m, 14 * DAY, vec![wages], &[("c1", 500_000), ("c2", 0)]);
        assert_eq!((paid(&first, "r1"), told(&first).len()), (1, 0));
        // Told of the death between pay days: nothing is said until a payment falls due.
        assert!(told(&at(&mut m, 21 * DAY, vec![death], &[("c1", 500_000), ("c2", 50_000)])).is_empty());
        let next = at(&mut m, 28 * DAY, vec![], &[("c1", 500_000), ("c2", 50_000)]);
        assert_eq!(told(&next), [(vec!["c1-self".to_string()], "r1".to_string(), "c2".to_string())]);
        assert_eq!(paid(&next, "r1"), 1, "it is still paid, into the estate");
        // (Told at each payment, not once, since foundations F6: a letter to an office with nobody in it is lost, and the
        // wage went on for good.)
        assert!(told(&at(&mut m, 35 * DAY, vec![], &[("c1", 500_000), ("c2", 100_000)])).is_empty());
        assert_eq!(told(&at(&mut m, 42 * DAY, vec![], &[("c1", 500_000), ("c2", 100_000)])).iter().map(|t| (t.1.clone(), t.2.clone())).collect::<Vec<_>>(), [("r1".to_string(), "c2".to_string())]);
    }

    #[test]
    fn who_wrote_an_instruction_is_looked_up_before_it_is_read_each_writer_once_and_nobody_is_shown_who_is_who() {
        let mut m = bank(json!({ "who": "who" }));
        let nobody = json!({ "kind": "directory", "positions": [], "entities": [] });
        let step = |m: &mut Rig, t: i64, rs: Vec<Value>, directory: Value| {
            m.wake(t, "cadence", json!({ "requests": records(rs), "custody": custody("bank", &[("c1", 500_000), ("c2", 500_000), ("firm", 500_000)]), "who": directory }), json!([]), json!([]))
        };
        let from_clerk = statement("so-3", 0, "request", json!({ "author": "boss-self", "in_position": "firm-clerk", "speaks_for": "firm", "addressed_to": ["bank"], "visible_to": ["firm", "bank"] }),
            json!({ "outcome": { "money": { "from": "acc-firm", "to": "acc-landlord", "amount": "700", "for": "Rent." } }, "every": MONTH, "first": 0 }));
        let rs = vec![request("so-1", 0, "c1", 100_000, json!({ "every": MONTH, "first": 0 })), request("so-2", 0, "c2", 50_000, json!({ "every": MONTH, "first": 0 })), from_clerk, request("so-4", 0, "c1", 5, json!({ "every": MONTH, "first": 0 }))];
        // Three instructions arrive from two people and a firm's clerk: before reading them, it asks who each writer is.
        let Action::Look { looks } = step(&mut m, 0, rs, nobody.clone()) else { panic!("it looks first") };
        let asked: Vec<Value> = looks.iter().map(|l| serde_json::to_value(l).unwrap()).collect();
        assert_eq!(asked.len(), 3, "{asked:?}");
        assert_eq!(asked[0]["who"]["participant"], "c1-self");
        assert_eq!(asked[1]["who"]["participant"], "c2-self");
        assert_eq!(asked[2]["who"]["position"], "firm-clerk");
        // The answers come at once, and it pays as their holders instructed.
        let known = who();
        let did = m.at(0, json!({ "requests": records(vec![]), "custody": custody("bank", &[("c1", 500_000), ("c2", 500_000), ("firm", 500_000)]), "who": known.clone() }), json!([]));
        assert_eq!(did.iter().filter(|c| c.get("per_request").is_some()).count(), 4);
        // Someone the directory does not know (the look-up found nobody) is asked after once, and their instruction is not
        // their account holder's: never paid, and never asked about again.
        let stranger = statement("so-9", DAY, "request", json!({ "author": "ghost", "speaks_for": "c1", "addressed_to": ["bank"], "visible_to": ["c1", "bank"] }),
            json!({ "outcome": { "money": { "from": "acc-c1", "to": "acc-landlord", "amount": "9", "for": "x" } } }));
        let Action::Look { looks } = step(&mut m, DAY, vec![stranger], known.clone()) else { panic!("it asks after the stranger") };
        assert_eq!(serde_json::to_value(&looks[0]).unwrap()["who"]["participant"], "ghost");
        assert!(matches!(step(&mut m, DAY, vec![], known.clone()), Action::Wait { .. }));
        assert!(matches!(step(&mut m, 2 * DAY, vec![], known), Action::Wait { .. }));
    }

    #[test]
    fn a_payment_that_fell_due_before_its_standing_order_was_withdrawn_is_still_made_and_nothing_due_after_is() {
        // (The bank goes through its instructions a day apart. An employer that replaced a wage order in the hours after
        // its pay day, for a new rate, lost its worker that pay: found 2026-10-08.)
        let mut m = bank(json!({}));
        let so = request("so-1", 0, "c1", 100_000, json!({ "every": MONTH, "first": 0 }));
        let rich = &[("c1", 900_000), ("landlord", 0)];
        assert_eq!(money(&at(&mut m, 0, vec![so.clone()], rich)), [("so-1".into(), "$1000.00".into())]);
        assert!(at(&mut m, MONTH - DAY / 2, vec![], rich).is_empty());
        // Due at a month; withdrawn two hours after, and replaced by an order whose first payment is a month on. The bank
        // next looks half a day after the due time.
        let gone = lifted("w-1", MONTH + 7200, "so-1", "c1");
        let next = request("so-2", MONTH + 7200, "c1", 110_000, json!({ "every": MONTH, "first": MONTH - 7200 }));
        assert_eq!(money(&at(&mut m, MONTH + DAY / 2, vec![gone, next], rich)), [("so-1".into(), "$1000.00".into())]);
        // After that the old order pays nothing more, and the new one pays on its own dates.
        assert!(at(&mut m, MONTH + 2 * DAY, vec![], rich).is_empty());
        assert_eq!(money(&at(&mut m, 2 * MONTH + DAY / 2, vec![], rich)), [("so-2".into(), "$1100.00".into())]);
        // An order withdrawn before its next due time pays nothing more.
        let mut m2 = bank(json!({}));
        assert_eq!(at(&mut m2, 0, vec![so], rich).len(), 1);
        let early = lifted("w-1", MONTH - 7200, "so-1", "c1");
        assert!(at(&mut m2, MONTH + DAY / 2, vec![early], rich).is_empty());
    }

    // ---- holds

    #[test]
    fn a_held_order_is_not_paid_once_the_hold_is_withdrawn_it_is_paid_from_the_next_due_date_and_what_was_missed_is_not_made_up() {
        let mut m = bank(json!({}));
        assert_eq!(paid(&at(&mut m, 0, vec![order("so-1", 0, "c1")], RICH), "so-1"), 0);
        assert_eq!(paid(&at(&mut m, 10 * DAY, vec![], RICH), "so-1"), 1);
        // The hold, given on day 15: the bank answers once, saying which payment is the first it stops.
        let told = at(&mut m, 15 * DAY, vec![hold("h1", 15 * DAY, "c1", &["so-1"])], RICH);
        assert_eq!(notes(&told), [(vec!["c1-self".to_string()], hold_note::taken("h1", &["so-1, from the payment due on day 21".into()]), "h1".to_string())]);
        assert_eq!(notes(&told)[0].1, "Hold h1 is in place. Not paid while it stands: so-1, from the payment due on day 21. Anything due before then is still paid. A payment not made under a hold is not made up when the hold is lifted: what it was for is still owed, and is yours to settle with whoever it is owed to. To resume, withdraw h1; payments then go on from the next due date.");
        // Two due dates pass under it: nothing is paid, and nothing more is said.
        assert!(at(&mut m, 20 * DAY, vec![], RICH).is_empty());
        assert!(at(&mut m, 30 * DAY, vec![], RICH).is_empty());
        // Lifted on day 35: nothing at once (the two missed are not made up), then one payment on each due date after.
        assert!(at(&mut m, 35 * DAY, vec![lifted("w1", 35 * DAY, "h1", "c1")], RICH).is_empty());
        assert_eq!(paid(&at(&mut m, 40 * DAY, vec![], RICH), "so-1"), 1);
        assert_eq!(paid(&at(&mut m, 50 * DAY, vec![], RICH), "so-1"), 1);
    }

    #[test]
    fn a_payment_that_fell_due_before_the_hold_counted_is_still_made() {
        // The bank wakes late: due on days 10 and 20, the hold given on day 12, the bank's next plan on day 25. The payment
        // of day 10 goes; that of day 20 does not.
        let mut late = bank(json!({}));
        at(&mut late, 0, vec![order("so-1", 0, "c1")], RICH);
        assert_eq!(paid(&at(&mut late, 25 * DAY, vec![hold("h1", 12 * DAY, "c1", &["so-1"])], RICH), "so-1"), 1);
        // Given half a day before a due date, with a day's notice asked: that payment still goes, and the next does not.
        let mut m = bank(json!({}));
        at(&mut m, 0, vec![order("so-1", 0, "c1")], RICH);
        let told = at(&mut m, 9 * DAY + DAY / 2, vec![hold("h1", 9 * DAY + DAY / 2, "c1", &["so-1"])], RICH);
        assert!(notes(&told)[0].1.contains("so-1, from the payment due on day 21."));
        assert_eq!(paid(&at(&mut m, 10 * DAY, vec![], RICH), "so-1"), 1);
        assert_eq!(paid(&at(&mut m, 20 * DAY, vec![], RICH), "so-1"), 0);
        // A bank that asks for no notice stops the payment due that day.
        let mut prompt = bank(json!({ "hold_notice": 0 }));
        at(&mut prompt, 0, vec![order("so-1", 0, "c1")], RICH);
        assert!(notes(&at(&mut prompt, 9 * DAY + DAY / 2, vec![hold("h1", 9 * DAY + DAY / 2, "c1", &["so-1"])], RICH))[0].1.contains("so-1, from the payment due on day 11."));
        assert_eq!(paid(&at(&mut prompt, 10 * DAY, vec![], RICH), "so-1"), 0);
    }

    fn signatories_of_the_boss() -> Value {
        statement("sig-1", 0, "signatories", json!({ "author": "boss-1", "in_position": "firm-boss", "speaks_for": "firm", "addressed_to": ["bank"], "visible_to": ["firm", "bank"] }), json!({ "account": "acc-firm", "positions": ["firm-boss"] }))
    }
    fn firm_order(id: &str, at: i64, post: &str, author: &str, extra: Value) -> Value {
        let mut r = order(id, at, "firm");
        r["author"] = author.into();
        r["in_position"] = post.into();
        if let Value::Object(o) = extra {
            for (k, v) in o {
                r["data"][k] = v;
            }
        }
        r
    }
    fn firm_post(mut r: Value, post: &str, author: &str) -> Value {
        r["author"] = author.into();
        r["in_position"] = post.into();
        r["speaks_for"] = "firm".into();
        r
    }

    #[test]
    fn a_hold_from_anyone_but_whoever_may_instruct_on_the_account_changes_nothing_and_is_answered_in_a_sentence_that_says_nothing_of_others() {
        let mut m = bank(json!({}));
        at(&mut m, 0, vec![order("so-1", 0, "c1"), firm_order("so-f", 0, "firm-clerk", "clerk-1", json!({})), signatories_of_the_boss()], RICH);
        let nothing = |hold: &str, what: &str| format!("Hold {hold} does not apply to {what}: we have no standing instruction of yours by that reference.");
        // Someone else's order, an order nobody made, and the firm's order held by a post that may not sign for its account.
        let told = at(&mut m, 5 * DAY, vec![hold("h1", 5 * DAY, "c2", &["so-1"]), hold("h2", 5 * DAY, "c1", &["so-9"]), firm_post(hold("h3", 5 * DAY, "firm", &["so-f"]), "firm-clerk", "clerk-1")], RICH);
        // (One of the firm's own people who is not its signatory is told that, which is the firm's own rule; the other two
        // are told nothing of whose the instruction is, or whether there is one.)
        let n = notes(&told);
        assert_eq!(n.iter().map(|(to, t, re)| (to.clone(), t.clone(), re.clone())).collect::<Vec<_>>(), [
            (vec!["c2-self".to_string()], nothing("h1", "so-1"), "h1".to_string()),
            (vec!["c1-self".to_string()], nothing("h2", "so-9"), "h2".to_string()),
            (vec!["firm-clerk".to_string()], "Hold h3 is not in place on so-f: firm-clerk is not an authorised signatory for acc-firm.".to_string(), "h3".to_string()),
        ]);
        // The one sentence, whether the instruction exists or not.
        assert_eq!(n[0].1.replace("h1", "X").replace("so-1", "X"), n[1].1.replace("h2", "X").replace("so-9", "X"));
        let day10 = at(&mut m, 10 * DAY, vec![], RICH);
        assert_eq!([paid(&day10, "so-1"), paid(&day10, "so-f")], [1, 0], "the clerk's order was never the firm's to give either: its signatory is the boss");
        // The boss's order, and the boss's hold on it: taken. One hold may name several; what is not theirs is said beside what is.
        at(&mut m, 11 * DAY, vec![firm_order("so-g", 11 * DAY, "firm-boss", "boss-1", json!({}))], RICH);
        let mixed = at(&mut m, 12 * DAY, vec![firm_post(hold("h4", 12 * DAY, "firm", &["so-g", "so-1"]), "firm-boss", "boss-1")], RICH);
        assert_eq!(notes(&mixed)[0].1, format!("{} {}", hold_note::taken("h4", &["so-g, from the payment due on day 22".into()]), nothing("h4", "so-1")));
        let day21 = at(&mut m, 21 * DAY, vec![], RICH);
        assert_eq!([paid(&day21, "so-1"), paid(&day21, "so-g")], [1, 0]);
    }

    #[test]
    fn a_letter_to_the_bank_is_answered_with_the_writers_own_standing_instructions_each_by_its_reference_and_nobody_elses() {
        let mut m = bank(json!({}));
        let union = request("so-2", 0, "c1", 2500, json!({ "every": 30 * DAY, "first": 0 }));
        let union = {
            let mut u = union;
            u["data"]["outcome"]["money"]["to"] = "acc-union".into();
            u["data"]["outcome"]["money"].as_object_mut().unwrap().remove("for");
            u
        };
        at(&mut m, 0, vec![order("so-1", 0, "c1"), union, order("so-3", 0, "c2")], RICH);
        at(&mut m, 12 * DAY, vec![hold("h1", 12 * DAY, "c1", &["so-1"])], RICH);
        let ask = |m: &mut Rig, t: i64, from: &str| notes(&at_with(m, t, vec![], RICH, json!([letter(&format!("m-{from}"), t, &format!("{from}-self"), "What do you hold for me?")])))[0].1.clone();
        let mine = ask(&mut m, 13 * DAY, "c1");
        assert!(mine.contains("Your standing instructions with us: so-1: $1,000.00 from acc-c1 to acc-landlord every 10 days, next due day 21, given on year 1, day 1, on hold (h1); so-2: $25.00 from acc-c1 to acc-union every 30 days, next due day 31, given on year 1, day 1. "), "{mine}");
        assert!(mine.ends_with("To end a standing instruction, withdraw it by its reference; to pause one, put a hold on it by its reference, and withdraw the hold to resume."));
        assert!(!mine.contains("so-3"));
        assert!(ask(&mut m, 13 * DAY, "c2").contains("Your standing instructions with us: so-3: $1,000.00 from acc-c2 to acc-landlord every 10 days, next due day 21, given on year 1, day 1. "));
        // Once the hold is lifted the list no longer says it is held.
        at(&mut m, 14 * DAY, vec![lifted("w1", 14 * DAY, "h1", "c1")], RICH);
        assert!(ask(&mut m, 14 * DAY, "c1").contains("so-1: $1,000.00 from acc-c1 to acc-landlord every 10 days, next due day 21, given on year 1, day 1; so-2"));
        // An instruction the customer opened with, given in a post of theirs and resting on an agreement: the list says so.
        let mut town = bank(json!({}));
        let mut w = firm_order("so-w", 0, "firm-boss", "genesis", json!({}));
        w["basis"] = "job-c9".into();
        at(&mut town, 0, vec![w], RICH);
        let asked = at_with(&mut town, DAY, vec![], RICH, json!([{ "id": "m1", "t": DAY, "from": "boss-1", "as": "firm-boss", "from_entity": "firm", "to": ["bank"], "text": "Who set this up?" }]));
        assert!(notes(&asked)[0].1.contains("so-w: $1,000.00 from acc-firm to acc-landlord every 10 days, next due day 11, given before the year began in your post firm-boss, citing job-c9. "), "{:?}", notes(&asked));
        let mut none = bank(json!({}));
        assert!(notes(&at_with(&mut none, DAY, vec![], RICH, json!([letter("m1", DAY, "c1-self", "Hello.")])))[0].1.contains("You have no standing instructions with us. "));
        // A long list is cut where the bank's parameter says, and says how many more there are.
        let mut short = bank(json!({ "letter_lists": 1 }));
        at(&mut short, 0, vec![order("so-1", 0, "c1"), order("so-2", 0, "c1")], RICH);
        assert!(notes(&at_with(&mut short, DAY, vec![], RICH, json!([letter("m1", DAY, "c1-self", "Hello.")])))[0].1.contains("so-1: $1,000.00 from acc-c1 to acc-landlord every 10 days, next due day 11, given on year 1, day 1; and 1 more. "));
    }

    #[test]
    fn a_withdrawal_is_acted_on_only_from_whoever_may_instruct_on_the_account_anyone_else_is_answered_and_the_instruction_stands() {
        let mut m = bank(json!({}));
        at(&mut m, 0, vec![signatories_of_the_boss(), firm_order("so-g", 0, "firm-boss", "boss-1", json!({})), order("so-1", 0, "c1")], RICH);
        // Day 5: the firm's clerk, who is not its signatory, withdraws the firm's order; and c2 withdraws c1's.
        let clerk = firm_post(lifted("w1", 5 * DAY, "so-g", "firm"), "firm-clerk", "clerk-1");
        let told = at(&mut m, 5 * DAY, vec![clerk, lifted("w2", 5 * DAY, "so-1", "c2")], RICH);
        assert_eq!(notes(&told), [
            (vec!["firm-clerk".to_string()], "Withdrawal w1 is not acted on, and so-g stands: firm-clerk is not an authorised signatory for acc-firm.".to_string(), "w1".to_string()),
            (vec!["c2-self".to_string()], "Withdrawal w2 does not apply to so-1: we have no standing instruction of yours by that reference.".to_string(), "w2".to_string()),
        ]);
        let day10 = at(&mut m, 10 * DAY, vec![], RICH);
        assert_eq!([paid(&day10, "so-g"), paid(&day10, "so-1")], [1, 1]);
        // The signatory withdraws it: nothing more is paid under it, and nothing is said (it was theirs to end).
        let boss = firm_post(lifted("w3", 12 * DAY, "so-g", "firm"), "firm-boss", "boss-1");
        assert!(at(&mut m, 12 * DAY, vec![boss], RICH).is_empty());
        let day20 = at(&mut m, 20 * DAY, vec![], RICH);
        assert_eq!([paid(&day20, "so-g"), paid(&day20, "so-1")], [0, 1]);
        // Someone the bank cannot place (no person, no post of the customer's) ends nothing either.
        let nobody = json!({ "id": "w4", "at": 21 * DAY, "record": "withdrawal", "author": "x", "withdraws": "so-1", "visible_to": ["bank"] });
        assert_eq!(notes(&at(&mut m, 21 * DAY, vec![nobody], RICH)), [(vec!["x".to_string()], "Withdrawal w4 does not apply to so-1: we have no standing instruction of yours by that reference.".to_string(), "w4".to_string())]);
        assert_eq!(paid(&at(&mut m, 30 * DAY, vec![], RICH), "so-1"), 1);
    }

    #[test]
    fn a_hold_is_lifted_and_an_instruction_replaced_only_by_whoever_may_instruct_on_the_account() {
        let mut m = bank(json!({}));
        at(&mut m, 0, vec![signatories_of_the_boss(), firm_order("so-g", 0, "firm-boss", "boss-1", json!({}))], RICH);
        at(&mut m, 2 * DAY, vec![firm_post(hold("h1", 2 * DAY, "firm", &["so-g"]), "firm-boss", "boss-1")], RICH);
        // The clerk lifts the boss's hold: not acted on; the due date passes under the hold.
        let clerk = firm_post(lifted("w1", 5 * DAY, "h1", "firm"), "firm-clerk", "clerk-1");
        assert_eq!(notes(&at(&mut m, 5 * DAY, vec![clerk], RICH))[0].1, "Withdrawal w1 is not acted on, and hold h1 stands: firm-clerk is not an authorised signatory for acc-firm.");
        assert_eq!(paid(&at(&mut m, 10 * DAY, vec![], RICH), "so-g"), 0);
        // The boss lifts it: paid from the next due date.
        assert!(at(&mut m, 12 * DAY, vec![firm_post(lifted("w2", 12 * DAY, "h1", "firm"), "firm-boss", "boss-1")], RICH).is_empty());
        assert_eq!(paid(&at(&mut m, 20 * DAY, vec![], RICH), "so-g"), 1);
        // The clerk gives an instruction that says it replaces the boss's: it is refused for itself, and the boss's stands.
        let mut swap = firm_order("so-x", 22 * DAY, "firm-clerk", "clerk-1", json!({ "replaces": "so-g" }));
        swap["data"]["outcome"]["money"]["to"] = "acc-c2".into();
        assert_eq!(notes(&at(&mut m, 22 * DAY, vec![swap], RICH))[0].1, "Request so-x not carried out: firm-clerk is not an authorised signatory for acc-firm.");
        let day30 = at(&mut m, 30 * DAY, vec![], RICH);
        assert_eq!([paid(&day30, "so-g"), paid(&day30, "so-x")], [1, 0]);
        // The boss's replacement: the old one ends when the new one was given; the new one pays on its own dates.
        let mut mine = firm_order("so-y", 32 * DAY, "firm-boss", "boss-1", json!({ "replaces": "so-g" }));
        mine["data"]["outcome"]["money"]["amount"] = "120000".into();
        at(&mut m, 32 * DAY, vec![mine], RICH);
        assert_eq!(paid(&at(&mut m, 40 * DAY, vec![], RICH), "so-g"), 0);
        assert_eq!(paid(&at(&mut m, 42 * DAY, vec![], RICH), "so-y"), 1);
    }

    #[test]
    fn a_hold_and_its_withdrawal_that_reach_the_bank_together_the_hold_is_taken_and_lifted_and_nothing_is_passed_over() {
        let mut m = bank(json!({}));
        at(&mut m, 0, vec![order("so-1", 0, "c1")], RICH);
        at(&mut m, 5 * DAY, vec![hold("h1", 3 * DAY, "c1", &["so-1"]), lifted("w1", 4 * DAY, "h1", "c1")], RICH);
        assert_eq!(paid(&at(&mut m, 10 * DAY, vec![], RICH), "so-1"), 1);
    }

    // ---- statements

    fn tx(t: i64, from: &str, to: &str, amount: i64, extra: Value) -> Value {
        merge(json!({ "t": t, "from": format!("acc-{from}"), "to": format!("acc-{to}"), "amount": amount.to_string(), "currency": "XTS", "by": "bank-pay-system" }), extra)
    }
    fn statement_at(m: &mut Rig, t: i64, balances: &[(&str, i64)], transactions: Vec<Value>, inbox: Value) -> Vec<String> {
        let mut c = custody("bank", balances);
        c["transactions"] = Value::Array(transactions);
        let said = m.at(t, json!({ "requests": records(vec![]), "custody": c, "who": who() }), inbox);
        notes(&said).into_iter().map(|n| n.1).collect()
    }
    fn clerk_letter(id: &str, t: i64) -> Value {
        json!([{ "id": id, "t": t, "from": "clerk-1", "as": "firm-clerk", "from_entity": "firm", "to": ["bank"], "text": "What have you paid from our account?" }])
    }

    #[test]
    fn a_statement_lists_what_was_paid_out_and_in_since_the_ledger_began_by_date_account_purpose_and_reference_with_the_balances() {
        let mut m = bank(json!({}));
        statement_at(&mut m, 0, &[("firm", 1_000_000), ("c1", 50_000)], vec![], json!([]));
        // Day 3: the bank is shown two payments it made the day before and one paid to the firm. No letter: nothing is said.
        let txs = vec![
            tx(2 * DAY, "firm", "c1", 100_000, json!({ "per_instruction": "job-c1-wages", "memo": "wages" })),
            tx(2 * DAY + 60, "firm", "builder", 75_000, json!({ "per_instruction": "rec.7", "settles": "inv-1" })),
            tx(2 * DAY + 90, "shop", "firm", 24_000, json!({ "per_instruction": "rec.9", "memo": "Goods.", "settles": "inv-2" })),
        ];
        assert!(statement_at(&mut m, 3 * DAY, &[("firm", 849_000), ("c1", 150_000)], txs, json!([])).is_empty());
        // Day 9: the firm's clerk writes. Nothing was paid at this look; the statement is from the ledger.
        let said = statement_at(&mut m, 9 * DAY, &[("firm", 849_000), ("c1", 150_000)], vec![], clerk_letter("msg.1", 9 * DAY));
        assert!(!said[0].contains("No payments yet"));
        assert!(said[0].starts_with(
            "Report from bank: Statement of acc-firm, year 1, day 1 to year 1, day 10: balance brought forward $10,000.00. \
year 1, day 3: paid out $1,000.00 to acc-c1 (wages), under your instruction job-c1-wages; \
year 1, day 3: paid out $750.00 to acc-builder, under your instruction rec.7, settling inv-1; \
year 1, day 3: paid in $240.00 from acc-shop (Goods), settling inv-2. \
In all $1,750.00 paid out and $240.00 paid in. Balance carried forward $8,490.00. You have no standing instructions with us."
        ), "{}", said[0]);
        // (Whoever was paid is not told the payer's instruction: it is the payer's paper.)
        let worker = statement_at(&mut m, 10 * DAY, &[("firm", 849_000), ("c1", 150_000)], vec![], json!([letter("msg.2", 10 * DAY, "c1-self", "What have you paid?")]));
        assert!(worker[0].contains("Statement of acc-c1, year 1, day 1 to year 1, day 11: balance brought forward $500.00. year 1, day 3: paid in $1,000.00 from acc-firm (wages). In all $0.00 paid out and $1,000.00 paid in. Balance carried forward $1,500.00."), "{}", worker[0]);
        assert!(!worker[0].contains("job-c1-wages"));
    }

    #[test]
    fn a_statement_runs_from_the_last_one_to_the_same_writer_and_another_officer_of_the_same_customer_has_their_own() {
        let mut m = bank(json!({}));
        statement_at(&mut m, 0, &[("firm", 1_000_000)], vec![], json!([]));
        statement_at(&mut m, 3 * DAY, &[("firm", 900_000)], vec![tx(2 * DAY, "firm", "c1", 100_000, json!({ "per_instruction": "job-c1-wages", "memo": "wages" }))], json!([]));
        let first = &statement_at(&mut m, 9 * DAY, &[("firm", 900_000)], vec![], clerk_letter("msg.1", 9 * DAY))[0];
        assert!(first.contains("paid out $1,000.00 to acc-c1"));
        // The clerk again, with nothing paid since: the statement says so, and since when.
        let again = &statement_at(&mut m, 12 * DAY, &[("firm", 900_000)], vec![], clerk_letter("msg.2", 12 * DAY))[0];
        assert!(again.contains("Statement of acc-firm, year 1, day 10 to year 1, day 13 (since our last statement to you): nothing was paid in or out. Balance $9,000.00."), "{again}");
        // One more payment, then the clerk a third time: only that one, from the balance the last statement ended on.
        statement_at(&mut m, 17 * DAY, &[("firm", 800_000)], vec![tx(16 * DAY, "firm", "c1", 100_000, json!({ "per_instruction": "job-c1-wages", "memo": "wages" }))], json!([]));
        let third = &statement_at(&mut m, 20 * DAY, &[("firm", 800_000)], vec![], clerk_letter("msg.3", 20 * DAY))[0];
        assert!(third.contains("Statement of acc-firm, year 1, day 13 to year 1, day 21 (since our last statement to you): balance brought forward $9,000.00. year 1, day 17: paid out $1,000.00 to acc-c1 (wages), under your instruction job-c1-wages. In all $1,000.00 paid out and $0.00 paid in. Balance carried forward $8,000.00."), "{third}");
        // The boss has had no statement: theirs runs from the beginning.
        let boss = json!([{ "id": "msg.4", "t": 21 * DAY, "from": "boss-1", "as": "firm-boss", "from_entity": "firm", "to": ["bank"], "text": "Statement?" }]);
        let boss = &statement_at(&mut m, 21 * DAY, &[("firm", 800_000)], vec![], boss)[0];
        assert!(boss.contains("Statement of acc-firm, year 1, day 1 to year 1, day 22: balance brought forward $10,000.00. year 1, day 3: paid out $1,000.00 to acc-c1 (wages), under your instruction job-c1-wages; year 1, day 17: paid out $1,000.00"), "{boss}");
    }

    #[test]
    fn a_statement_lists_the_latest_entries_up_to_the_banks_figure_and_gives_the_rest_in_its_totals() {
        let mut m = bank(json!({ "statement_lists": 3 }));
        statement_at(&mut m, 0, &[("firm", 1_000_000)], vec![], json!([]));
        let txs = (1..=7).map(|d| tx(d * DAY, "firm", "c1", 100_000, json!({ "memo": "wages" }))).collect();
        statement_at(&mut m, 8 * DAY, &[("firm", 300_000)], txs, json!([]));
        let said = &statement_at(&mut m, 9 * DAY, &[("firm", 300_000)], vec![], clerk_letter("msg.1", 9 * DAY))[0];
        assert!(said.contains("balance brought forward $10,000.00. year 1, day 6: paid out $1,000.00 to acc-c1 (wages); year 1, day 7: paid out $1,000.00 to acc-c1 (wages); year 1, day 8: paid out $1,000.00 to acc-c1 (wages). Those are the latest 3 of 7 entries; the 4 before them are in the totals. In all $7,000.00 paid out and $0.00 paid in. Balance carried forward $3,000.00."), "{said}");
    }

    #[test]
    fn someone_with_no_account_is_told_so_and_nothing_of_anyones_payments() {
        let mut m = bank(json!({}));
        statement_at(&mut m, 0, &[("firm", 1_000_000)], vec![], json!([]));
        statement_at(&mut m, 3 * DAY, &[("firm", 900_000)], vec![tx(2 * DAY, "firm", "c1", 100_000, json!({}))], json!([]));
        assert_eq!(statement_at(&mut m, 4 * DAY, &[("firm", 900_000)], vec![], json!([letter("msg.1", 4 * DAY, "c1-self", "Hi")])), ["Report from bank: we hold no account for you. To open one, ask us for one in writing."]);
    }

    // ---- going through standing orders only when due is the same as going through every one at every plan

    /// A small deterministic stream for the property test below (no randomness is the world's here: the test's own).
    struct Lcg(u64);
    impl Lcg {
        fn below(&mut self, n: u64) -> u64 {
            self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            (self.0 >> 33) % n
        }
        fn pick<'a, T>(&mut self, xs: &'a [T]) -> &'a T {
            &xs[self.below(xs.len() as u64) as usize]
        }
    }

    #[test]
    fn going_through_standing_orders_only_when_due_gives_the_payments_and_replies_that_going_through_every_one_at_every_plan_does() {
        let people = ["c1", "c2", "c3", "c4", "c5", "c6"];
        let (mut paid_all, mut told_all) = (0, 0);
        for seed in 1..=6u64 {
            let mut rng = Lcg(seed);
            let mut short = bank(json!({ "courts": ["tribunal"], "town": "city" }));
            let mut long = bank(json!({ "courts": ["tribunal"], "town": "city", "review_all": true }));
            let mut balances: Vec<(String, i64)> = [&people[..4], &["firm", "city"][..]].concat().iter().map(|h| (h.to_string(), 300_000)).collect();
            let mut written: Vec<Value> = vec![];
            let mut n = 0;
            let mut hour = 0;
            while hour < 24 * 45 {
                hour += 1 + rng.below(9) as i64;
                let t = hour * 3600;
                let mut recs: Vec<Value> = vec![];
                for _ in 0..rng.below(4) {
                    n += 1;
                    let id = format!("r{n:04}");
                    let who_ = *rng.pick(&people);
                    let other = *rng.pick(&people);
                    let from = rng.pick(&[who_, who_, who_, other, "firm"]).to_string();
                    let money = json!({ "from": format!("acc-{from}"), "to": format!("acc-{}", rng.pick(&people)), "amount": rng.pick(&["500", "2000", "40000", "0", "900000"]), "for": "x" });
                    let by = match rng.below(5) {
                        0 | 1 => json!({ "author": format!("{who_}-self"), "speaks_for": who_ }),
                        2 => json!({ "author": format!("{}-self", rng.pick(&people)), "speaks_for": who_ }),
                        3 => json!({ "author": "clerk-1", "in_position": rng.pick(&["firm-clerk", "firm-boss"]), "speaks_for": "firm" }),
                        _ => json!({ "author": "genesis", "speaks_for": who_ }),
                    };
                    let firm = by["speaks_for"] == "firm";
                    let money = if firm { merge(money, json!({ "from": "acc-firm" })) } else { money };
                    let every = *rng.pick(&[3600, 7200, DAY, 3 * DAY, 10 * DAY]);
                    let data = match rng.below(7) {
                        0 => json!({ "outcome": { "money": money }, "every": every, "first": *rng.pick(&[0, 3600, 5 * DAY]) }),
                        1 => json!({ "outcome": { "money": money }, "every": *rng.pick(&[DAY, 2 * DAY]) }),
                        2 => json!({ "outcome": { "money": money } }),
                        3 => json!({ "from": money["from"], "payments": [{ "to": "acc-c1", "amount": "700" }, { "to": "acc-c2", "amount": *rng.pick(&["300", "0"]) }] }),
                        4 => json!({ "outcome": { "account": { "holder": *rng.pick(&[who_, "c6"]) } }, "every": DAY }),
                        5 => json!({ "outcome": { "occupancy": { "who": who_, "in": "somewhere" } }, "every": DAY }),
                        _ => json!({ "outcome": { "money": merge(money, json!({ "to": 7 })) }, "every": DAY }),
                    };
                    let rec = statement(&id, t, "request", merge(by, json!({ "addressed_to": [*rng.pick(&["bank", "bank", "bank", "other-bank"])], "visible_to": [who_, "bank"] })), data);
                    recs.push(rec);
                }
                if !written.is_empty() && rng.below(6) == 0 {
                    let w = rng.pick(&written).clone();
                    n += 1;
                    let own = json!({ "author": w["author"], "speaks_for": w["speaks_for"] });
                    let by = if rng.below(5) < 3 { own } else { json!({ "author": format!("{}-self", rng.pick(&people)), "speaks_for": *rng.pick(&people) }) };
                    recs.push(merge(json!({ "id": format!("w{n}"), "at": t, "record": "withdrawal", "withdraws": w["id"], "visible_to": ["bank"] }), by));
                }
                if rng.below(60) == 0 {
                    n += 1;
                    recs.push(statement(&format!("d{n}"), t, "death_registration", json!({ "speaks_for": "city" }), json!({ "deceased": *rng.pick(&people), "partner": *rng.pick(&people), "adult_children": [*rng.pick(&people)] })));
                }
                if rng.below(40) == 0 {
                    n += 1;
                    recs.push(statement(&format!("g{n}"), t, "garnishee_order", json!({ "speaks_for": "tribunal", "addressed_to": ["bank"], "visible_to": ["bank"] }), json!({ "debtor": *rng.pick(&people), "to": format!("acc-{}", rng.pick(&people)), "amount": "1500", "claim": "claim-1" })));
                }
                if rng.below(30) == 0 && balances.len() > 2 {
                    let i = rng.below(balances.len() as u64) as usize;
                    balances.remove(i);
                }
                if rng.below(20) == 0 {
                    let h = rng.pick(&[&people[..], &["firm"][..]].concat()).to_string();
                    if !balances.iter().any(|(b, _)| *b == h) {
                        balances.push((h, 250_000));
                    }
                }
                for b in balances.iter_mut() {
                    if rng.below(5) == 0 {
                        b.1 = *rng.pick(&[0, 1_000, 60_000, 400_000]);
                    }
                }
                written.extend(recs.iter().filter(|r| r["record"] == "statement").cloned());
                let bal: Vec<(&str, i64)> = balances.iter().map(|(h, b)| (h.as_str(), *b)).collect();
                let a = at(&mut short, t, recs.clone(), &bal);
                let b = at(&mut long, t, recs, &bal);
                let (a, b): (Vec<_>, Vec<_>) = (a.iter().map(|c| format!("{c:?}")).collect(), b.iter().map(|c| format!("{c:?}")).collect());
                assert_eq!(a, b, "seed {seed}, hour {hour}");
                paid_all += a.iter().filter(|c| c.starts_with("Call { fn_: \"money\"")).count();
                told_all += a.iter().filter(|c| c.starts_with("Call { fn_: \"message\"")).count();
            }
        }
        // (The stream does make the bank pay, and refuse.)
        assert!(paid_all > 100, "{paid_all}");
        assert!(told_all > 20, "{told_all}");
    }

    // ---- a dead customer's instructions and account (the audit found nothing catching a fault here)

    fn death(id: &str, at: i64, deceased: &str, extra: Value) -> Value {
        statement(id, at, "death_registration", json!({ "speaks_for": "city", "addressed_to": ["bank"], "visible_to": ["city", "bank"] }), merge(json!({ "deceased": deceased }), extra))
    }
    fn rent_order(id: &str, from: &str) -> Value {
        request(id, 0, from, 100_000, json!({ "every": 10 * DAY, "first": 10 * DAY }))
    }
    const FOUR: &[(&str, i64)] = &[("c1", 900_000), ("c2", 900_000), ("c3", 900_000), ("c4", 900_000), ("city", 0), ("landlord", 0)];

    #[test]
    fn a_dead_persons_standing_order_is_paid_until_the_bank_is_told_and_never_after() {
        let mut m = bank(json!({ "town": "city" }));
        at(&mut m, 0, vec![rent_order("so-1", "c1")], FOUR);
        assert_eq!(paid(&at(&mut m, 10 * DAY, vec![], FOUR), "so-1"), 1);
        // c1 dies on day 12; the registry tells the bank on day 15. The payment due on day 20 is not made, nor any after.
        at(&mut m, 15 * DAY, vec![death("d1", 15 * DAY, "c1", json!({}))], FOUR);
        for day in [20, 30, 40, 100] {
            assert_eq!(paid(&at(&mut m, day * DAY, vec![], FOUR), "so-1"), 0, "day {day}");
        }
    }

    #[test]
    fn a_dead_persons_standing_order_is_ended_not_gone_through_again_every_day_for_ever() {
        let mut m = bank(json!({ "town": "city" }));
        at(&mut m, 0, vec![rent_order("so-1", "c1"), rent_order("so-2", "c2")], FOUR);
        at(&mut m, 15 * DAY, vec![death("d1", 15 * DAY, "c1", json!({}))], FOUR);
        let b = bank_of(&m);
        assert!(!b.standing.contains("so-1"), "it is dropped");
        assert!(b.standing.contains("so-2"), "the living one's is kept");
        assert!(b.ended.contains_key("so-1"));
        assert!(b.undated.is_empty() && !b.by_due.iter().any(|(_, id)| id == "so-1"));
    }

    fn bank_of(m: &Rig) -> Bank {
        let saved = m.actor.save().unwrap();
        let mut b: Bank = serde_json::from_value(saved["bank"].clone()).unwrap();
        b.book = Book::restore(saved["book"].clone()).unwrap();
        b
    }

    #[test]
    fn a_dead_persons_one_off_instruction_not_yet_carried_out_lapses_and_nobody_is_told() {
        let mut m = bank(json!({ "town": "city" }));
        // Written the day they died (day 12), seen by the bank on day 15 together with the registration of the death.
        let said = at(&mut m, 15 * DAY, vec![request("pay-1", 12 * DAY, "c1", 70_000, json!({})), death("d1", 15 * DAY, "c1", json!({}))], FOUR);
        assert_eq!(paid(&said, "pay-1"), 0);
        assert!(notes(&said).is_empty(), "{said:?}");
        assert_eq!(paid(&at(&mut m, 16 * DAY, vec![], FOUR), "pay-1"), 0);
    }

    #[test]
    fn a_dead_holders_account_pays_out_only_to_settle_the_estate_whoever_instructs() {
        let mut m = bank(json!({ "town": "city" }));
        // An instruction from the dead holder's own account, filed before the death but first seen after it, and one filed by a genesis paper.
        let said = at(&mut m, 15 * DAY, vec![death("d1", 14 * DAY, "c1", json!({ "partner": "c2" })), request("pay-1", 15 * DAY, "c1", 1_000, json!({})), merge(request("pay-2", 15 * DAY, "c1", 1_000, json!({})), json!({ "author": "genesis" }))], FOUR);
        assert_eq!(paid(&said, "pay-1") + paid(&said, "pay-2"), 0);
        // What it pays is the estate, to the partner, and only that.
        assert_eq!(said.iter().filter(|c| c.fn_ == "money").map(|c| (arg(c, "from").unwrap(), arg(c, "to").unwrap(), arg(c, "amount").unwrap(), arg(c, "per_request").unwrap())).collect::<Vec<_>>(),
            [("acc-c1".to_string(), "acc-c2".to_string(), "$9000.00".to_string(), "d1".to_string())]);
    }

    #[test]
    fn an_estate_goes_to_the_partner_else_equally_to_the_adult_children_with_the_remainder_to_the_first_else_the_town() {
        // To the partner.
        let mut m = bank(json!({ "town": "city" }));
        let said = at(&mut m, DAY, vec![death("d1", DAY, "c1", json!({ "partner": "c2", "adult_children": ["c3"] }))], FOUR);
        assert_eq!(money(&said), [("d1".into(), "$9000.00".into())]);
        assert_eq!(arg(&said[0], "to").unwrap(), "acc-c2");
        // No partner: the adult children, equally, the first getting the remainder (a cent over among three).
        let mut m = bank(json!({ "town": "city" }));
        let said = at(&mut m, DAY, vec![death("d1", DAY, "c1", json!({ "adult_children": ["c2", "c3", "c4"] }))], &[("c1", 1_000_001), ("c2", 0), ("c3", 0), ("c4", 0), ("city", 0)]);
        assert_eq!(said.iter().map(|c| (arg(c, "to").unwrap(), arg(c, "amount").unwrap())).collect::<Vec<_>>(), [("acc-c2".to_string(), "$3333.35".to_string()), ("acc-c3".to_string(), "$3333.33".to_string()), ("acc-c4".to_string(), "$3333.33".to_string())]);
        // Neither: the town.
        let mut m = bank(json!({ "town": "city" }));
        let said = at(&mut m, DAY, vec![death("d1", DAY, "c1", json!({}))], FOUR);
        assert_eq!(arg(&said[0], "to").unwrap(), "acc-city");
    }

    #[test]
    fn a_partner_who_has_died_too_does_not_receive_the_estate_it_goes_to_the_children() {
        let mut m = bank(json!({ "town": "city" }));
        let said = at(&mut m, 2 * DAY, vec![death("d0", DAY, "c2", json!({})), death("d1", DAY, "c1", json!({ "partner": "c2", "adult_children": ["c3"] }))], FOUR);
        let to: Vec<(String, String)> = said.iter().filter(|c| arg(c, "per_request").as_deref() == Some("d1")).map(|c| (arg(c, "to").unwrap(), arg(c, "amount").unwrap())).collect();
        assert_eq!(to, [("acc-c3".to_string(), "$9000.00".to_string())]);
    }

    #[test]
    fn an_estate_with_nobody_to_receive_it_is_kept_and_looked_at_again_not_given_up_for_good() {
        let mut m = bank(json!({}));
        // No town named, no partner, no adult child with an account here: nothing to pay to.
        let said = at(&mut m, DAY, vec![death("d1", DAY, "c1", json!({ "adult_children": ["c9"] }))], FOUR);
        assert!(said.is_empty(), "{said:?}");
        assert!(at(&mut m, 2 * DAY, vec![], FOUR).is_empty());
        // Later an adult child opens an account here: the estate goes to them.
        let later = at(&mut m, 3 * DAY, vec![], &[("c1", 900_000), ("c9", 0)]);
        assert_eq!(later.iter().map(|c| (arg(c, "to").unwrap(), arg(c, "amount").unwrap())).collect::<Vec<_>>(), [("acc-c9".to_string(), "$9000.00".to_string())]);
    }

    #[test]
    fn what_comes_into_an_estate_later_is_passed_on_to_the_same_heirs_and_they_are_settled_once() {
        let mut m = bank(json!({ "town": "city" }));
        at(&mut m, DAY, vec![death("d1", DAY, "c1", json!({ "partner": "c2" }))], FOUR);
        // The partner dies next; a dividend arrives in the first estate afterwards. The heirs were settled once: it still goes to c2's account.
        let said = at(&mut m, 5 * DAY, vec![death("d2", 4 * DAY, "c2", json!({ "adult_children": ["c3"] }))], &[("c1", 12_345), ("c2", 900_000), ("c3", 0), ("city", 0)]);
        let first: Vec<(String, String)> = said.iter().filter(|c| arg(c, "per_request").as_deref() == Some("d1")).map(|c| (arg(c, "to").unwrap(), arg(c, "amount").unwrap())).collect();
        assert_eq!(first, [("acc-c2".to_string(), "$123.45".to_string())]);
        // The partner's own estate goes to their child.
        let second: Vec<(String, String)> = said.iter().filter(|c| arg(c, "per_request").as_deref() == Some("d2")).map(|c| (arg(c, "to").unwrap(), arg(c, "amount").unwrap())).collect();
        assert_eq!(second, [("acc-c3".to_string(), "$9000.00".to_string())]);
    }

    #[test]
    fn a_standing_order_into_a_dead_persons_account_tells_its_payer_at_each_payment_and_not_before_one_falls_due() {
        let mut m = bank(json!({ "town": "city" }));
        let mut wages = request("r1", 0, "c1", 50_000, json!({ "every": 14 * DAY, "first": 14 * DAY }));
        wages["data"]["outcome"]["money"]["to"] = "acc-c2".into();
        at(&mut m, 0, vec![wages], FOUR);
        at(&mut m, 5 * DAY, vec![death("d1", 5 * DAY, "c2", json!({}))], FOUR);
        let told = |said: &[Call]| notes(said).iter().filter(|(_, t, _)| PAYEE_DIED::who(t).is_some()).count();
        // Nothing until a payment falls due; then at each, once for each (not a set that grows: the latest due told).
        assert_eq!(told(&at(&mut m, 13 * DAY, vec![], FOUR)), 0);
        for (day, expect) in [(14, 1), (15, 0), (28, 1), (42, 1), (43, 0)] {
            let said = at(&mut m, day * DAY, vec![], FOUR);
            assert_eq!(told(&said), expect, "day {day}");
        }
        assert!(bank_of(&m).told_died.len() <= 1, "kept by instruction, not by payment");
    }

    #[test]
    fn a_garnishee_order_takes_what_the_debtor_holds_up_to_the_amount_for_the_court_that_made_it_only() {
        let mut m = bank(json!({ "courts": ["tribunal"] }));
        let g = |id: &str, by: &str| statement(id, DAY, "garnishee_order", json!({ "speaks_for": by, "addressed_to": ["bank"], "visible_to": ["bank"] }), json!({ "debtor": "c1", "to": "acc-landlord", "amount": "150000", "claim": "claim-1" }));
        let said = at(&mut m, DAY, vec![g("g1", "tribunal"), g("g2", "someone-else")], &[("c1", 100_000), ("landlord", 0)]);
        let m1: Vec<(String, String, Option<String>)> = said.iter().map(|c| (arg(c, "amount").unwrap(), arg(c, "per_request").unwrap(), arg(c, "settles"))).collect();
        assert_eq!(m1, [("$1000.00".to_string(), "g1".to_string(), Some("claim-1".to_string()))], "what it holds, up to the amount, for the court only");
    }

    #[test]
    fn an_account_is_opened_for_whoever_asks_in_their_own_name_only() {
        let mut m = bank(json!({}));
        let open = |id: &str, by: &str, holder: &str| statement(id, DAY, "request", merge(person(by), json!({ "addressed_to": ["bank"], "visible_to": [by, "bank"] })), json!({ "outcome": { "account": { "holder": holder } } }));
        let said = at(&mut m, DAY, vec![open("o1", "c1", "c1"), open("o2", "c1", "c2")], RICH);
        assert_eq!(said.iter().map(|c| c.fn_.clone()).collect::<Vec<_>>(), ["message", "account"], "the refusal goes first, then the account");
        assert_eq!(notes(&said)[0].1, "Request o2 not carried out: an account can only be opened by the person or organisation it's for.");
        assert_eq!((arg(&said[1], "holder").unwrap(), arg(&said[1], "at").unwrap()), ("c1".to_string(), "bank".to_string()));
    }

    #[test]
    fn a_bulk_payment_is_made_once_from_one_account_to_many() {
        let mut m = bank(json!({}));
        let bulk = statement("b1", DAY, "request", json!({ "author": "clerk-1", "in_position": "firm-clerk", "speaks_for": "firm", "addressed_to": ["bank"], "visible_to": ["firm", "bank"] }), json!({ "from": "acc-firm", "payments": [{ "to": "acc-c1", "amount": "700", "for": "Dividend." }, { "to": "acc-c2", "amount": "300" }] }));
        let said = at(&mut m, DAY, vec![bulk.clone()], RICH);
        assert_eq!(money(&said), [("b1".into(), "$7.00".into()), ("b1".into(), "$3.00".into())]);
        assert!(at(&mut m, 2 * DAY, vec![bulk], RICH).is_empty(), "once");
    }

    #[test]
    fn a_bank_saves_and_restores_exactly_and_steps_as_it_would_have() {
        let mut m = bank(json!({ "town": "city" }));
        at(&mut m, 0, vec![order("so-1", 0, "c1"), order("so-2", 0, "c2")], RICH);
        at(&mut m, 12 * DAY, vec![hold("h1", 12 * DAY, "c1", &["so-1"])], RICH);
        let mut twin = bank(json!({ "town": "city" }));
        at(&mut twin, 0, vec![order("so-1", 0, "c1"), order("so-2", 0, "c2")], RICH);
        at(&mut twin, 12 * DAY, vec![hold("h1", 12 * DAY, "c1", &["so-1"])], RICH);
        m.snapshot_round_trip();
        for day in [20, 30, 40] {
            let (a, b) = (at(&mut m, day * DAY, vec![], RICH), at(&mut twin, day * DAY, vec![], RICH));
            assert_eq!(format!("{a:?}"), format!("{b:?}"), "day {day}");
        }
    }
}
