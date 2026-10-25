//! A trading firm's body: what a shop or a factory does as an employer, a borrower, a party to a union and a firm that
//! can fail, which is not the market's business. In TS it was firms.ts's `Staffing`, `LabourPlan`, `Bargaining` and
//! `WindingUp`, credit.ts's `Borrowing`, frictions.ts's `Respondent` and orgwants.ts's `Org`, which lanes C1 (firms) and
//! D (finance) own. The market lane (retailer, producer) calls only the seam below, so it can be tested alone and the
//! real body dropped in at integration: C1 implements [`Body`] over its `Staffing`, `WindingUp` and the rest (wrapping
//! its step tokens in [`BodyThen`], opaque JSON, as lane E's `StaffThen` does), and the two kinds in `market` are
//! generic over it. Nothing in the market lane reads a body's insides.
//!
//! [`PlainBody`] is the stand-in the market lane tests with: its staff are the people who hold an employment agreement
//! with the firm, in force, at ordinary hours; it posts and hires no one, borrows from no one, never fails. It does
//! what a firm with a settled staff does, which is all a market test needs from it.

use crate::common::book::Book;
use crate::common::OwnAccount;
use crate::papers::agreements;
use crate::steps::{Done, Step};
use crate::{Belief, Cx, Picture, WorldInfo};
use oikos_sight::{Record, RecordBody};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;

/// What follows from a body's step: opaque to the market, handed back to the body.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BodyThen(pub Value);

/// A body's steps lifted into a plan's own token.
pub fn lift<T, U>(steps: Vec<Step<T>>, f: impl Fn(T) -> U) -> Vec<Step<U>> {
    steps
        .into_iter()
        .map(|s| Step { lines: s.lines, act: s.act, why: s.why, then: s.then.map(&f), redo: s.redo, planned: s.planned, lapses_at: s.lapses_at })
        .collect()
}

/// Whether the firm is trading, or closing: its premises being sold after a failure, or wound up.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Standing {
    Trading,
    /// Being wound up: it trades no more, and lets its people go; it finishes when the winding-up has run its time.
    Winding,
    /// Closed, its premises offered for sale (it still keeps an account).
    Closed,
}

/// What the firm wants of its staff, for the body's hiring routine.
#[derive(Debug, Clone)]
pub struct Want {
    pub target: i64,
    pub wage: i64,
    /// Whether the market side judged it may post (money and room): a body that changes the wage in its dealings (a rise it
    /// agreed with a union) judges the money again at the new wage, from `postable` (everything but the money).
    pub can_post: bool,
    pub postable: bool,
    /// This month's headcount, and why it is what it is (the posting's reason is written from them and the wage then).
    pub headcount: i64,
    pub headcount_why: String,
}

/// The month's end, as the market side reads its trade for the labour decision.
#[derive(Debug, Clone)]
pub struct Review {
    /// Hands the trade we expect needs (at least the minimum, at most the room).
    pub needed: i64,
    /// The trade in words, for the reasons given ("the trade we expect (250 a month; last month 230)").
    pub trade: String,
    pub notice_days: i64,
    /// What the firm expects to make or sell in a month (smoothed), and last month's.
    pub expected: i64,
    pub last_demand: i64,
    /// A shop reads a surplus of hands against its serving, a factory against its stock: which surplus rule applies.
    pub surplus: Surplus,
    /// A factory's stock at the month's end, and the share of the expected demand below which it is low (bps).
    pub stock: i64,
    pub phi_low_bps: i64,
}

/// How the month's end reads too many hands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Surplus {
    /// More hands than the trade needs.
    OverStaffed,
    /// Stock is over the band: make less (a factory).
    OverStocked,
    /// Stock is under the band, and there is room: take one on (a factory).
    UnderStocked,
}

/// What the body decided at the month's end.
#[derive(Debug)]
pub struct Staffed {
    pub steps: Vec<Step<BodyThen>>,
    pub headcount: i64,
    pub why: String,
}

/// What a wake gives the body to do its routine dealings (staff, union, bank, debts, hearings).
pub struct House<'a> {
    pub pic: &'a Picture,
    pub book: &'a Book,
    pub acct: &'a OwnAccount,
    pub want: Want,
    pub trading: bool,
    /// Wages for the next pay period the market side keeps aside (what a dividend or an order must not take).
    pub workers: usize,
    /// A business of one (its owner serves): it takes on nobody and is not idle for want of staff.
    pub operator: bool,
    /// What customers paid it, a day, over the last month (what a stoppage costs it in sales), and the share of its work
    /// that systems do (bps): the employer's side of bargaining reads both.
    pub takings_per_day: i64,
    pub system_bps: i64,
}

/// What the routine dealings produced.
#[derive(Debug, Default)]
pub struct Dealt {
    pub steps: Vec<Step<BodyThen>>,
    /// Rises in the wage offered (bps) the firm agreed with its union, in the order agreed.
    pub wage_rises: Vec<i64>,
    /// The headcount is cut to this (cash ran short and the most recent hire was let go).
    pub headcount_cap: Option<i64>,
    /// The firm found itself insolvent or idle and began to wind up: it trades no more.
    pub began: bool,
}

/// Where in the failing of a firm a call is made.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stage {
    /// Closed: sell the premises.
    Closed,
    /// The winding-up is due: the suppliers have been paid what the account could, now finish.
    Due,
}

pub struct Wind<'a> {
    pub pic: &'a Picture,
    pub book: &'a Book,
    pub acct: &'a OwnAccount,
    pub stage: Stage,
    pub premises: Option<(String, String, String)>,
    /// What the premises are offered at, if the firm can say (a share of what building them new costs).
    pub sale_price: Option<i64>,
    /// What was already paid before the firm finishes: its staff's wages and withheld tax owed, and its suppliers (invoices).
    pub paid_suppliers: i64,
    pub staying: bool,
}

/// What a body is to the market lane.
pub trait Body: Serialize + DeserializeOwned + Send + Sized + 'static {
    /// Takes in what a wake shows.
    fn absorb(&mut self, pic: &Picture, book: &Book, cx: &mut Cx);
    /// The people who work for the firm now.
    fn workers(&self, book: &Book, t: i64) -> Vec<String>;
    /// A worker's hours now, in basis points of the ordinary (cut hours are less).
    fn hours_bps(&self, _worker: &str, _t: i64) -> i64 {
        10_000
    }
    /// A job posted that has stood a month unfilled; whether any job is posted now.
    fn vacancies(&self, book: &Book, t: i64) -> (bool, bool);
    /// Whether anyone is under notice or wages are owed (nothing is paid out to shareholders while it is true).
    fn strained(&self, book: &Book, t: i64, world: &WorldInfo) -> Option<String>;
    /// The month's end for the staff: hours cut before heads, a hand taken on or let go.
    fn review(&mut self, book: &Book, t: i64, r: &Review, workers: i64, cx: &mut Cx) -> Staffed;
    /// The routine of an employer, borrower and union party, each wake while trading.
    fn dealings(&mut self, h: &House, cx: &mut Cx) -> Dealt;
    fn standing(&self) -> Standing {
        Standing::Trading
    }
    /// Whether the winding-up has run its time and the firm is to finish.
    fn winding_due(&self, _t: i64) -> bool {
        false
    }
    /// Months of the wage bill the firm must hold in hand before it posts a job (after a lay-off for want of cash).
    fn months_in_hand(&self, _book: &Book) -> i64 {
        1
    }
    /// Winding up: what the firm owes its staff (wages and redundancy pay in its books) and the tax it withheld from their
    /// wages come before its suppliers, its other creditors and its shareholders. The steps, and what they pay.
    fn wind_up_owed(&mut self, _book: &Book, _t: i64, _acct: &OwnAccount, _cx: &mut Cx) -> (Vec<Step<BodyThen>>, i64) {
        (vec![], 0)
    }
    /// Where its staff work from now (premises it has taken on a lease: docs/behaviour/leasing.md).
    fn set_workplace(&mut self, _space: &str) {}
    /// The act that ends a wake: the organisation's record (its character and memory), if it has one to write.
    fn keep(&mut self, _cx: &mut Cx) {}
    /// The firm never opened (the premises it meant to buy went to someone else) and is closed: it trades no more.
    fn close(&mut self) {}
    /// Closing and selling (`Stage::Closed`: sell the premises) and finishing (`Stage::Due`): the steps it sends.
    fn wind_up(&mut self, _w: &Wind, _cx: &mut Cx) -> Vec<Step<BodyThen>> {
        vec![]
    }
    fn then(&mut self, _tok: &BodyThen, _done: Done, _cx: &mut Cx) -> Vec<Step<BodyThen>> {
        vec![]
    }
    fn beliefs(&self, _book: &Book) -> Vec<Belief> {
        vec![]
    }
}

/// The stand-in body: the staff are those with an employment agreement in force; nothing else.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PlainBody {
    me: String,
}

impl PlainBody {
    pub fn new(me: &str) -> Self {
        PlainBody { me: me.to_string() }
    }
    fn contracts(&self, book: &Book) -> Vec<Arc<Record>> {
        book.of_type("agreement")
            .filter(|r| match &r.body {
                RecordBody::Agreement { terms } => {
                    terms.template.as_deref() == Some(agreements::EMPLOYMENT) && terms.parties.first().map(String::as_str) == Some(self.me.as_str())
                }
                _ => false,
            })
            .cloned()
            .collect()
    }
}

impl Body for PlainBody {
    fn absorb(&mut self, _: &Picture, _: &Book, _: &mut Cx) {}
    fn workers(&self, book: &Book, t: i64) -> Vec<String> {
        let mut v: Vec<_> = self.contracts(book).into_iter().filter(|a| book.in_force(&a.id) && t < book.ends_at(&a.id).unwrap_or(i64::MAX)).collect();
        v.sort_by_key(|a| book.signed_at(&a.id).unwrap_or(0));
        v.iter().map(|a| agreements::parties_of(a).get(1).cloned().unwrap_or_default()).collect()
    }
    fn vacancies(&self, book: &Book, t: i64) -> (bool, bool) {
        let posts: Vec<_> = book.open("job_posting").filter(|j| j.speaks_for.as_deref() == Some(self.me.as_str())).collect();
        (posts.iter().any(|x| t - x.at >= crate::common::MONTH), !posts.is_empty())
    }
    fn strained(&self, _: &Book, _: i64, _: &WorldInfo) -> Option<String> {
        None
    }
    fn review(&mut self, _: &Book, _: i64, r: &Review, workers: i64, _: &mut Cx) -> Staffed {
        // A settled staff: it neither hires nor lets go; the headcount it asks for is what the trade needs.
        let headcount = match r.surplus {
            Surplus::OverStaffed => r.needed,
            Surplus::OverStocked => (workers - 1).max(0),
            Surplus::UnderStocked => workers + 1,
        };
        Staffed { steps: vec![], headcount, why: String::new() }
    }
    fn dealings(&mut self, _: &House, _: &mut Cx) -> Dealt {
        Dealt::default()
    }
}
