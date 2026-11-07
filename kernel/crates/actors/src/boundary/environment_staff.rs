//! The environment office's staff: a reduced employer's side, **to be replaced by C1's `actors::firms::staffing::Staffing`
//! at integration** (C1's has not landed).
//!
//! Copied in idea and nearly in code from lane E's `offices/staff.rs` (no dependency on it). TS: `Staffing`
//! (participants/src/behaviour/firms.ts). This is the part an office that hires uses: who is on the staff (employment
//! agreements in force of this office's role), the postings, hiring one applicant a posting at random, and letting the
//! most recent hire go. It does not send the payroll office a notice of each starter and leaver (environment.ts 0.5.0,
//! the `payroll` option), which is C1's: the real `Staffing` does it when the plan gives it `payroll` and `line`.
//!
//! **The seam.** The environment plan holds a `Staff`, and calls only `absorb`, `workers`, `let_go`, `routine`,
//! `not_recruiting` (and `then`, which has nothing to do here), wrapping the tokens of the steps in its own
//! `Then::Staff(StaffThen)` with [`lift`]. Replacing it is one `use` line in environment.rs.

use crate::common::Book;
use crate::papers::agreements::{self, job_terms, Offer};
use crate::steps::{because, call, pay, say, Done, Pay, Say, Step, Visible};
use crate::{Belief, Cx, Picture, DAY};
use oikos_sight::calls::Line;
use oikos_sight::{Record, RecordBody};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

/// Whose staff an office keeps, among its organisation's: all of them, those of its role, or those of its role and
/// those whose agreement names none (`own` in TS).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum Own {
    #[default]
    All,
    Role,
    RoleOrUnnamed,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct StaffOpts {
    /// Seconds between pays.
    pub period: i64,
    pub notice_days: i64,
    pub workplace: Option<String>,
    pub role: String,
    pub industry: Option<String>,
    pub own: Own,
    /// Whether this office hires, and whether it pays (a works office hires and a payroll office pays).
    pub hire: bool,
    pub pay: bool,
}

/// What an office wants of its staff at this wake.
#[derive(Debug, Clone, Default)]
pub struct Want {
    pub target: usize,
    pub wage: i64,
    pub can_post: bool,
    pub why: Option<String>,
    /// `Some(false)`: directed not to recruit.
    pub recruit: Option<bool>,
    pub stopped: Option<String>,
}

/// The token of a step this module returns (opaque to the office that holds it).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StaffThen(pub Value);

/// Steps in the token of the plan that holds a `Staff`.
pub fn lift<T>(steps: Vec<Step<StaffThen>>, f: impl Fn(StaffThen) -> T) -> Vec<Step<T>> {
    steps
        .into_iter()
        .map(|s| Step { lines: s.lines, act: s.act, why: s.why, then: s.then.map(&f), redo: s.redo, planned: s.planned, lapses_at: s.lapses_at })
        .collect()
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Staff {
    me: String,
    o: StaffOpts,
    /// Agreement -> the wage standing order we made for it.
    orders: BTreeMap<String, String>,
    /// Bound name in a step -> the agreement whose order it will be.
    pending: BTreeMap<String, String>,
    handled: BTreeSet<String>,
    /// Agreements we have given notice on, and when.
    pub noticed: BTreeMap<String, i64>,
    n: u32,
}

impl Staff {
    pub fn new(me: &str, o: StaffOpts) -> Self {
        Staff { me: me.to_string(), o, ..Default::default() }
    }

    fn role_of(&self, a: &Record, book: &Book) -> Option<String> {
        if let RecordBody::Agreement { terms } = &a.body {
            // ("... works for X as <role> for <the wage> every N days.")
            if let Some(text) = terms.text.as_deref() {
                if let Some(i) = text.find(" as ") {
                    let rest = &text[i + 4..];
                    if let Some(j) = rest.find(" for ") {
                        return Some(rest[..j].to_string());
                    }
                }
            }
        }
        agreements::advertised_job(book, a).and_then(|p| crate::common::data(p).get("role").and_then(|x| x.as_str()).filter(|s| !s.is_empty()).map(String::from))
    }
    fn ours(&self, role: Option<&str>) -> bool {
        match self.o.own {
            Own::All => true,
            Own::Role => role == Some(self.o.role.as_str()),
            Own::RoleOrUnnamed => role == Some(self.o.role.as_str()) || role.is_none(),
        }
    }
    fn contracts(&self, book: &Book) -> Vec<Arc<Record>> {
        book.of_type("agreement")
            .filter(|r| match &r.body {
                RecordBody::Agreement { terms } => {
                    terms.template.as_deref() == Some(agreements::EMPLOYMENT)
                        && terms.parties.first().map(String::as_str) == Some(self.me.as_str())
                        && self.ours(self.role_of(r, book).as_deref())
                }
                _ => false,
            })
            .cloned()
            .collect()
    }
    fn end_of(book: &Book, a: &Record) -> i64 {
        book.ends_at(&a.id).unwrap_or(i64::MAX)
    }
    /// Employment agreements in force and not yet ended, oldest signed first.
    pub fn staff(&self, book: &Book, t: i64) -> Vec<Arc<Record>> {
        let mut v: Vec<_> = self.contracts(book).into_iter().filter(|a| book.in_force(&a.id) && t < Self::end_of(book, a)).collect();
        v.sort_by_key(|a| book.signed_at(&a.id).unwrap_or(0));
        v
    }
    fn worker_of(a: &Record) -> String {
        agreements::parties_of(a).get(1).cloned().unwrap_or_default()
    }
    /// The workers we are paying, by person.
    pub fn workers(&self, book: &Book, t: i64) -> Vec<String> {
        self.staff(book, t).iter().map(|a| Self::worker_of(a)).collect()
    }
    /// How many of our staff are staying: those we have not given notice.
    #[allow(dead_code)]
    pub fn staying(&self, book: &Book, t: i64) -> usize {
        self.staff(book, t).iter().filter(|a| !self.noticed.contains_key(a.id.as_str())).count()
    }
    /// Offers made in the last month that the worker has not signed yet.
    pub fn offered(&self, book: &Book, t: i64) -> Vec<Arc<Record>> {
        self.contracts(book)
            .into_iter()
            .filter(|a| !book.concluded(&a.id) && !book.signed_by(&a.id, &Self::worker_of(a)) && t - a.at < crate::common::MONTH)
            .collect()
    }
    /// Our standing job postings.
    pub fn postings(&self, book: &Book) -> Vec<Arc<Record>> {
        book.open("job_posting")
            .filter(|j| j.speaks_for.as_deref() == Some(self.me.as_str()) && self.ours(crate::common::data(j).get("role").and_then(|x| x.as_str())))
            .cloned()
            .collect()
    }
    /// Our staff as the truth audits read them (an office that keeps only its role's staff says nothing of the list).
    #[allow(dead_code)]
    pub fn beliefs(&self, book: &Book) -> Vec<Belief> {
        if self.o.own != Own::All {
            return vec![];
        }
        vec![Belief::Held {
            party: self.me.clone(),
            template: agreements::EMPLOYMENT.to_string(),
            agreements: self.staff(book, book.now).iter().map(|a| a.id).map(|x| x.to_string()).collect(),
        }]
    }
    /// What a direction not to recruit does, in the office's words (docs/behaviour/directions.md).
    pub fn not_recruiting(&self, book: &Book, t: i64) -> String {
        let out = self.offered(book, t);
        let mut s = "The office advertises no post, takes down the advertisements it has out and makes no new offer of employment.".to_string();
        if !out.is_empty() {
            let list: Vec<String> = out.iter().map(|a| format!("{}, to {}", a.id, Self::worker_of(a))).collect();
            s += &format!(
                " {} it had already made {} not yet signed by the worker ({}): a direction ends no offer already made, and {} if the worker signs it.",
                if out.len() == 1 { "One offer".to_string() } else { format!("{} offers", out.len()) },
                if out.len() == 1 { "is" } else { "are" },
                list.join("; "),
                if out.len() == 1 { "it stands" } else { "they stand" }
            );
        }
        s
    }

    /// Takes in what the observation shows: the standing orders our steps made (named by their bound names).
    pub fn absorb(&mut self, pic: &Picture) {
        for o in &pic.outcomes {
            for (name, id) in o.created.iter().flatten() {
                if let Some(a) = self.pending.remove(name) {
                    self.orders.insert(a, id.to_string());
                }
            }
        }
    }

    /// What follows from a step's outcome: nothing (the orders are read in `absorb`).
    pub fn then(&mut self, _tok: &StaffThen, _done: Done, _cx: &mut Cx) -> Vec<Step<StaffThen>> {
        vec![]
    }

    fn posting(&self, wage: i64, account: &str, cx: &Cx) -> oikos_sight::calls::Call {
        let place = match &self.o.workplace {
            Some(w) => json!({ "workplace": crate::common::structure_of(w), "space": w }),
            None => json!({}),
        };
        let mut data = json!({ "wage": wage, "period": self.o.period, "role": self.o.role });
        if let Some(i) = &self.o.industry {
            data["industry"] = json!(i);
        }
        if let (Some(d), Some(p)) = (data.as_object_mut(), place.as_object()) {
            d.extend(p.clone());
        }
        let mut commitments = vec![json!({ "who": self.me, "does": { "outcome": { "money": { "amount": wage.to_string(), "for": "wages" } } }, "every": self.o.period })];
        if !account.is_empty() {
            commitments[0]["does"]["outcome"]["money"]["from"] = json!(account);
        }
        if let Some(w) = &self.o.workplace {
            commitments.push(json!({ "who": "taker", "does": { "outcome": { "occupancy": { "in": w } } } }));
        }
        let mut terms = json!({ "template": agreements::EMPLOYMENT, "commitments": commitments });
        if self.o.notice_days > 0 {
            let n = self.o.notice_days * DAY;
            terms["termination"] = json!([{ "party": self.me, "notice": n }, { "party": "taker", "notice": n }]);
        }
        let offer = json!({ "by": self.me, "to": { "min_age_years": 18 }, "take_up": "apply", "available": 1, "terms": terms });
        say(
            "job_posting",
            &format!("Hiring: {} every {} days.", crate::common::money_words(wage, &cx.ctx.world), self.o.period / DAY),
            Say { data: Some(data), extra: vec![("offer", offer)], ..Default::default() },
        )
    }

    /// The routine: start wages for new hires and stop them for the departed; offer each posting's job to one
    /// applicant at random; post a job while short of the target and allowed to.
    pub fn routine(&mut self, pic: &Picture, book: &Book, account: &str, want: &Want, cx: &mut Cx) -> Vec<Step<StaffThen>> {
        let t = pic.t;
        let me = self.me.clone();
        // The orders we have on file for an agreement (read from the file, so a successor carries on).
        for r in book.open("request") {
            if r.speaks_for.as_deref() == Some(me.as_str()) && crate::common::data(r).get("every").is_some_and(|e| !e.is_null()) {
                for b in crate::common::bases_of(r) {
                    self.orders.entry(b.to_string()).or_insert_with(|| r.id.to_string());
                }
            }
        }
        let contracts = self.contracts(book);
        let staff = self.staff(book, t);
        let offered = self.offered(book, t);
        let mut steps: Vec<Step<StaffThen>> = vec![];
        let mut offers_now = 0;
        let recruiting = want.recruit != Some(false);
        let does_hire = self.o.hire && recruiting;
        if !recruiting && self.o.hire {
            let up = self.postings(book);
            if !up.is_empty() {
                steps.push(because(
                    want.stopped.clone().unwrap_or_else(|| "Directed not to recruit: taking our advertisements down.".into()),
                    up.iter().map(|j| crate::common::withdraw(&j.id, Some("Withdrawn: recruiting is stopped by direction."))).collect(),
                ));
            }
        }
        // Newly signed: wages by standing order.
        if self.o.pay {
            for a in &staff {
                if self.orders.contains_key(a.id.as_str()) || self.noticed.contains_key(a.id.as_str()) || self.pending.values().any(|x| *x == a.id) {
                    continue;
                }
                let worker = Self::worker_of(a);
                let pays = job_terms(a, &worker, Some(book));
                let to = agreements::commitment_of(a, &me).0.and_then(|o| o.money).map(|m| m.to).filter(|s| !s.is_empty()).or_else(|| {
                    book.all("job_application")
                        .find(|r| r.speaks_for.as_deref() == Some(worker.as_str()))
                        .and_then(|r| crate::common::data(r).get("account").and_then(|x| x.as_str()).map(String::from))
                });
                let Some(to) = to else { continue };
                let name = format!("wo{}", self.n);
                self.n += 1;
                self.pending.insert(name.clone(), a.id.to_string());
                let c = pay(&to, pays.wage, Pay { from: Some(account.to_string()).filter(|s| !s.is_empty()), every: Some(pays.period), first: Some(pays.period), basis: Some(a.id.to_string()), for_: Some(format!("Wages for {worker}.")), ..Default::default() }, cx);
                let mut s = Step::new(vec![Line { bind: Some(name), call: c }]);
                s.why = Some(format!("A new hire has signed: starting their wages by standing order ({}).", crate::common::money_words(pays.wage, &cx.ctx.world)));
                steps.push(s);
            }
            // Ended: stop the wages.
            for a in &contracts {
                if book.concluded(&a.id) && t >= Self::end_of(book, a) {
                    if let Some(order) = self.orders.remove(a.id.as_str()) {
                        steps.push(because("Employment has ended: stopping the wages.", vec![crate::common::withdraw(&order, Some("Employment ended; stop wages."))]));
                    }
                }
            }
        }
        // Hiring: one applicant at random per posting, at the posting's wage.
        let posts = self.postings(book);
        let apps: Vec<Arc<Record>> = book
            .open("job_application")
            .filter(|a| crate::common::addressed_to(a).iter().any(|x| x == &me) && !self.handled.contains(a.id.as_str()))
            .cloned()
            .collect();
        for post in if does_hire { posts.clone() } else { vec![] } {
            if book.on_hold(&post.id, Some(std::slice::from_ref(&me))) {
                continue;
            }
            let mut mine: Vec<&Arc<Record>> = apps.iter().filter(|a| crate::common::data(a).get("posting").and_then(|x| x.as_str()) == Some(post.id.as_str())).collect();
            mine.sort_by(|x, y| crate::common::filed_before(&x.id, &y.id));
            for a in &mine {
                self.handled.insert(a.id.to_string());
            }
            if mine.is_empty() {
                continue;
            }
            let chosen = mine[cx.rng(&format!("hire-{}", post.id)).below(mine.len() as u64) as usize];
            let worker = chosen.speaks_for.unwrap_or_default();
            let wage = crate::common::data(&post).get("wage").and_then(|x| x.as_i64()).unwrap_or(want.wage);
            let to = crate::common::data(chosen).get("account").and_then(|x| x.as_str()).unwrap_or(&worker).to_string();
            let we = pay(&to, wage, Pay { every: Some(self.o.period), for_: Some("wages".into()), ..Default::default() }, cx);
            let they = self.o.workplace.as_ref().map(|w| call("occupancy", vec![("who", Some(crate::steps::arg(&worker))), ("in", Some(crate::steps::arg(w)))]));
            let offer = agreements::offer(
                &worker,
                Offer {
                    template: agreements::EMPLOYMENT.into(),
                    we: Some(we),
                    they,
                    our_notice: Some(self.o.notice_days * DAY),
                    their_notice: Some(self.o.notice_days * DAY),
                    text: Some(format!(
                        "{worker} works for {me} as {} for {} every {} days. First pay {} days after both have signed.",
                        crate::common::data(&post).get("role").and_then(|x| x.as_str()).unwrap_or("staff"),
                        crate::common::money_words(wage, &cx.ctx.world),
                        self.o.period / DAY,
                        self.o.period / DAY
                    )),
                    basis: Some(chosen.id.to_string()),
                    ..Default::default()
                },
            );
            let mut s = Step::new(vec![Line { bind: Some("job".into()), call: offer }, Line { bind: None, call: crate::common::withdraw(&post.id, Some("Filled.")) }]);
            s.why = Some(format!("Hiring for our posting: an applicant picked at random among {}.", mine.len()));
            steps.push(s);
            offers_now += 1;
        }
        // Post a job if short-staffed.
        let have = staff.len() + offered.len() + offers_now;
        if does_hire && have < want.target && posts.is_empty() && want.can_post {
            steps.push(because(
                want.why.clone().unwrap_or_else(|| format!("Short-staffed ({have} of {}): posting a job.", want.target)),
                vec![self.posting(want.wage, account, cx)],
            ));
        }
        let _ = Visible::Public;
        steps
    }

    /// Let the most recent hire go (notice under their agreement).
    pub fn let_go(&mut self, book: &Book, t: i64, why: &str, reason: &str) -> Vec<Step<StaffThen>> {
        let staying: Vec<_> = self.staff(book, t).into_iter().filter(|a| !self.noticed.contains_key(a.id.as_str())).collect();
        let Some(a) = staying.last() else { return vec![] };
        self.noticed.insert(a.id.to_string(), t);
        vec![because(why, vec![agreements::notice(&a.id, reason)])]
    }
}
