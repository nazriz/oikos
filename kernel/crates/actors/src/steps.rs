//! Steps and the stepper: how an office's code plans its work and sends it one act at a time (participants/src/
//! behaviour/firms.ts `stepper`, common.ts `Step`, `because`, `callAction`, `say`, `pay`), ported for every office kind.
//!
//! A step is calls in one action, with its reason. What follows from its outcome is the plan's own `then`, given the
//! step's token: Rust has no closures over the actor's state, so a step carries a token (`T`, the plan's own enum)
//! and the plan answers `then(token, outcome)`. Likewise `redo` (a step whose content depends on when it is done) and
//! `lapses_at` (a moment after which it is not sent but answered as not done).
//!
//! The stepper's rules, as in TS:
//! - A plan is made when a wake begins; woken because an act of ours is done, it carries on with what it planned.
//! - What a wake did not get to is done first at the next; a day's work left undone at the day's turn is dropped and
//!   its `then` hears it was not done.
//! - An outcome is matched to its act by the action's name (`sent`), since acts under way finish out of order.
//! - While a question put to a register's keeper is unanswered (`asking`), nothing is judged.

use crate::{Actor, Cx, DAY};
use oikos_sight::calls::{parse_program, program_text, Call, Line, Program, Value as Arg};
use oikos_sight::{Action, LookRequest, Outcome, Picture};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

/// How an act came out, as a step's `then` hears it.
#[derive(Debug, Clone, Copy)]
pub enum Done<'a> {
    /// The world's outcome of the act.
    Outcome(&'a Outcome),
    /// It was never sent: its moment passed, or a day's work was not got to that day.
    NotDone(&'static str),
}

impl Done<'_> {
    pub fn applied(&self) -> bool {
        matches!(self, Done::Outcome(o) if o.status == oikos_sight::OutcomeStatus::Applied)
    }
}

/// Calls in one action, with its reason, and the plan's token for what follows from it.
#[derive(Debug, Clone)]
pub struct Step<T> {
    pub lines: Vec<Line>,
    pub why: Option<String>,
    /// What follows from its outcome: the plan's `then` is given this.
    pub then: Option<T>,
    /// Whether the plan's `redo` makes it again for a later moment, if it is done later than planned.
    pub redo: bool,
    /// When it was planned (the stepper's).
    pub planned: Option<i64>,
    /// From this moment on it is not sent but answered as not done.
    pub lapses_at: Option<i64>,
}

impl<T> Step<T> {
    pub fn new(lines: Vec<Line>) -> Self {
        Step { lines, why: None, then: None, redo: false, planned: None, lapses_at: None }
    }
    pub fn then(mut self, token: T) -> Self {
        self.then = Some(token);
        self
    }
    fn works_today(&self) -> bool {
        self.lines.iter().any(|l| l.call.fn_ == "work")
    }
    /// The program it sends: each call's arguments in name order, as participants/src/calls.ts `programOf` writes them.
    pub fn program(&self) -> Program {
        Program::Lines(self.lines.iter().map(|l| Line { bind: l.bind.clone(), call: sorted(&l.call) }).collect())
    }
}

fn sorted(c: &Call) -> Call {
    let mut args: Vec<(String, Arg)> =
        c.args.iter().map(|(k, v)| (k.clone(), if let Arg::Call(x) = v { Arg::Call(sorted(x)) } else { v.clone() })).collect();
    args.sort_by(|a, b| a.0.cmp(&b.0));
    Call { fn_: c.fn_.clone(), args }
}

/// A step of calls, with its reason (common.ts `because`).
pub fn because<T>(why: impl Into<String>, calls: Vec<Call>) -> Step<T> {
    let mut s = Step::new(calls.into_iter().map(|call| Line { bind: None, call }).collect());
    s.why = Some(why.into());
    s
}

/// An office's code: what it takes in from each observation, what it plans at a wake, and what follows from outcomes.
pub trait Plan: Send + Serialize + DeserializeOwned {
    /// The plan's token for what follows from a step (an enum of its own; `()` if nothing ever follows).
    type Then: Clone + Send + Serialize + DeserializeOwned;
    /// Takes in what the observation shows (its books).
    fn absorb(&mut self, pic: &Picture, cx: &mut Cx);
    /// What is to be done now.
    fn plan(&mut self, pic: &Picture, cx: &mut Cx) -> Vec<Step<Self::Then>>;
    /// When to wake next if it waits with nothing to do (absent: its cadence).
    fn until(&self, _pic: &Picture) -> Option<i64> {
        None
    }
    /// What to look up before planning (a look takes the rest of the wake's moment).
    fn looks(&mut self, _pic: &Picture) -> Vec<LookRequest> {
        vec![]
    }
    /// What follows from a step's outcome.
    fn then(&mut self, _token: &Self::Then, _done: Done, _cx: &mut Cx) -> Vec<Step<Self::Then>> {
        vec![]
    }
    /// The step made again for moment `t` (for a step with `redo`).
    fn redo(&mut self, step: Step<Self::Then>, _t: i64) -> Step<Self::Then> {
        step
    }
}

/// The stepper: a `Plan` run as an actor.
pub struct Stepper<P: Plan> {
    pub plan: P,
    todo: Vec<Step<P::Then>>,
    carried: Vec<Step<P::Then>>,
    planned_at: i64,
    under_way: BTreeMap<String, (Step<P::Then>, i64)>,
    last: Option<Step<P::Then>>,
    last_at: i64,
    hooked: bool,
    returned: Option<Step<P::Then>>,
}

impl<P: Plan> Stepper<P> {
    pub fn new(plan: P) -> Self {
        Stepper {
            plan,
            todo: vec![],
            carried: vec![],
            planned_at: -1,
            under_way: BTreeMap::new(),
            last: None,
            last_at: 0,
            hooked: false,
            returned: None,
        }
    }

    fn follow(&mut self, step: &Step<P::Then>, done: Done, cx: &mut Cx) -> Vec<Step<P::Then>> {
        match &step.then {
            Some(tok) => self.plan.then(tok, done, cx).into_iter().filter(|s| !s.lines.is_empty()).collect(),
            None => vec![],
        }
    }

    fn wait(&self, pic: &Picture) -> Action {
        Action::Wait { until: self.plan.until(pic) }
    }
}

/// A step as a snapshot keeps it: its program as text (the call language reads back exactly).
#[derive(Serialize, Deserialize)]
struct SavedStep<T> {
    program: String,
    why: Option<String>,
    then: Option<T>,
    redo: bool,
    planned: Option<i64>,
    lapses_at: Option<i64>,
}

fn save_step<T: Clone>(s: &Step<T>) -> SavedStep<T> {
    SavedStep {
        program: program_text(&s.program()),
        why: s.why.clone(),
        then: s.then.clone(),
        redo: s.redo,
        planned: s.planned,
        lapses_at: s.lapses_at,
    }
}

fn load_step<T>(s: SavedStep<T>) -> Result<Step<T>, String> {
    let lines = match parse_program(&s.program).map_err(|e| e.0)? {
        Program::Lines(l) => l,
        Program::None(_) => vec![],
    };
    Ok(Step { lines, why: s.why, then: s.then, redo: s.redo, planned: s.planned, lapses_at: s.lapses_at })
}

#[derive(Serialize, Deserialize)]
#[serde(bound = "P: Plan")]
struct SavedStepper<P: Plan> {
    plan: P,
    todo: Vec<SavedStep<P::Then>>,
    carried: Vec<SavedStep<P::Then>>,
    planned_at: i64,
    under_way: Vec<(String, SavedStep<P::Then>, i64)>,
    last: Option<SavedStep<P::Then>>,
    last_at: i64,
    hooked: bool,
    returned: Option<SavedStep<P::Then>>,
}

impl<P: Plan> Stepper<P> {
    /// A stepper as `save` left it.
    pub fn restore(saved: Value) -> Result<Self, String> {
        let s: SavedStepper<P> = serde_json::from_value(saved).map_err(|e| e.to_string())?;
        let all = |v: Vec<SavedStep<P::Then>>| v.into_iter().map(load_step).collect::<Result<Vec<_>, _>>();
        Ok(Stepper {
            plan: s.plan,
            todo: all(s.todo)?,
            carried: all(s.carried)?,
            planned_at: s.planned_at,
            under_way: s.under_way.into_iter().map(|(k, st, at)| load_step(st).map(|st| (k, (st, at)))).collect::<Result<_, _>>()?,
            last: s.last.map(load_step).transpose()?,
            last_at: s.last_at,
            hooked: s.hooked,
            returned: s.returned.map(load_step).transpose()?,
        })
    }
}

impl<P: Plan> Actor for Stepper<P> {
    fn save(&self) -> Result<Value, String> {
        let j = |v: Result<Value, serde_json::Error>| v.map_err(|e| e.to_string());
        let steps = |v: &[Step<P::Then>]| j(serde_json::to_value(v.iter().map(save_step).collect::<Vec<_>>()));
        Ok(serde_json::json!({
            "plan": j(serde_json::to_value(&self.plan))?,
            "todo": steps(&self.todo)?,
            "carried": steps(&self.carried)?,
            "planned_at": self.planned_at,
            "under_way": j(serde_json::to_value(self.under_way.iter().map(|(k, (s, at))| (k.clone(), save_step(s), *at)).collect::<Vec<_>>()))?,
            "last": j(serde_json::to_value(self.last.as_ref().map(save_step)))?,
            "last_at": self.last_at,
            "hooked": self.hooked,
            "returned": j(serde_json::to_value(self.returned.as_ref().map(save_step)))?,
        }))
    }

    fn sent(&mut self, action: &str) {
        self.hooked = true;
        if let Some(s) = self.last.take() {
            self.under_way.insert(action.to_string(), (s, self.last_at));
        }
    }

    fn step(&mut self, pic: &Picture, cx: &mut Cx) -> Action {
        let mut follow = std::mem::take(&mut self.carried);
        // (An act that was never heard of again is not under way after days.)
        self.under_way.retain(|_, (_, at)| pic.t - *at <= 3 * DAY);
        if !self.hooked {
            if let (Some(r), Some(o)) = (self.returned.take(), pic.outcomes.last()) {
                let more = self.follow(&r, Done::Outcome(o), cx);
                follow.extend(more);
            }
        }
        self.returned = None;
        if self.hooked {
            for o in &pic.outcomes {
                if let Some((s, _)) = self.under_way.remove(&o.action) {
                    let more = self.follow(&s, Done::Outcome(o), cx);
                    follow.extend(more);
                }
            }
        }
        self.plan.absorb(pic, cx);
        if !pic.asking.is_empty() {
            self.carried = follow;
            return self.wait(pic);
        }
        if self.planned_at != pic.t && (pic.woke_for != "done" || self.todo.is_empty()) {
            let ask = self.plan.looks(pic);
            if !ask.is_empty() {
                self.carried = follow;
                return Action::Look { looks: ask };
            }
            if self.planned_at >= 0 && pic.t.div_euclid(DAY) != self.planned_at.div_euclid(DAY) {
                let (stale, keep): (Vec<_>, Vec<_>) = std::mem::take(&mut self.todo).into_iter().partition(Step::works_today);
                self.todo = keep;
                for s in stale {
                    let mut more = self.follow(&s, Done::NotDone("a day's work not got to that day"), cx);
                    more.append(&mut self.todo);
                    self.todo = more;
                }
            }
            let mut fresh: Vec<_> = self.plan.plan(pic, cx).into_iter().filter(|s| !s.lines.is_empty()).collect();
            for s in &mut fresh {
                s.planned.get_or_insert(pic.t);
            }
            self.todo.extend(fresh);
            self.planned_at = pic.t;
        }
        follow.retain(|s| !s.lines.is_empty());
        follow.append(&mut self.todo);
        self.todo = follow;
        let mut next = if self.todo.is_empty() { None } else { Some(self.todo.remove(0)) };
        while let Some(s) = next.take() {
            if s.lapses_at.is_some_and(|at| pic.t >= at) {
                let mut more = self.follow(&s, Done::NotDone("not got to before the day's hours were over"), cx);
                more.append(&mut self.todo);
                self.todo = more;
                next = if self.todo.is_empty() { None } else { Some(self.todo.remove(0)) };
            } else {
                next = Some(s);
                break;
            }
        }
        let Some(mut next) = next else { return self.wait(pic) };
        if next.redo && next.planned.is_some_and(|p| p != pic.t) {
            next = self.plan.redo(next, pic.t);
        }
        let action = Action::Call { program: next.program(), reasoning: next.why.clone() };
        self.last = Some(next.clone());
        self.returned = Some(next);
        self.last_at = pic.t;
        action
    }
}

// ------------------------------------------------------------------ call builders (common.ts)

/// An id is written bare; anything else is quoted text (calls.ts `toValue`).
pub fn arg(s: &str) -> Arg {
    let id = !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | ':' | '/' | '-'));
    if id {
        Arg::Id(s.to_string())
    } else {
        Arg::Text(s.to_string())
    }
}
pub fn text(s: impl Into<String>) -> Arg {
    Arg::Text(s.into())
}
pub fn json(v: Value) -> Arg {
    Arg::Json(v)
}
/// A call (arguments in any order: the program writes them in name order).
pub fn call(fn_: &str, args: Vec<(&str, Option<Arg>)>) -> Call {
    Call { fn_: fn_.to_string(), args: args.into_iter().filter_map(|(k, v)| v.map(|v| (k.to_string(), v))).collect() }
}

/// Who may see a statement: everyone, or only these.
#[derive(Debug, Clone)]
pub enum Visible {
    Public,
    Only(Vec<String>),
}

/// The optional parts of a published statement (common.ts `say`). Fields the frame's actors do not yet use (adico,
/// formal, offer, practice, assertion, registry) are `extra`, each as the JSON the call takes; port agents may type them.
#[derive(Debug, Clone, Default)]
pub struct Say {
    pub to: Option<Vec<String>>,
    pub data: Option<Value>,
    pub visible: Option<Visible>,
    pub basis: Option<String>,
    pub for_: Option<String>,
    pub on: Option<String>,
    pub extra: Vec<(&'static str, Value)>,
}

/// A published statement: kind, text and its optional parts.
pub fn say(kind: &str, words: &str, o: Say) -> Call {
    let mut args = vec![
        ("kind", Some(arg(kind))),
        ("text", Some(text(words))),
        ("to", o.to.map(|t| json(Value::from(t)))),
        ("data", o.data.map(json)),
        (
            "visible",
            o.visible.map(|v| match v {
                Visible::Public => arg("public"),
                Visible::Only(ids) => json(Value::from(ids)),
            }),
        ),
        ("basis", o.basis.as_deref().map(arg)),
        ("for", o.for_.as_deref().map(arg)),
        ("on", o.on.as_deref().map(arg)),
    ];
    for (k, v) in o.extra {
        // (A law's formal condition is text, as common.ts `say` writes it (`C.text`): as JSON the resolver asks for it to
        // be written out, and a council's amended law was never published, 2026-10-18.)
        match (k, v) {
            ("formal", Value::String(f)) => args.push((k, Some(text(f)))),
            (k, v) => args.push((k, Some(json(v)))),
        }
    }
    call("statement", args)
}

/// The optional parts of a payment (common.ts `pay`).
#[derive(Debug, Clone, Default)]
pub struct Pay {
    pub from: Option<String>,
    pub for_: Option<String>,
    pub settles: Option<String>,
    pub every: Option<i64>,
    pub first: Option<i64>,
    pub basis: Option<String>,
    pub per_request: Option<String>,
    pub line: Option<String>,
}

/// A duration as text: whole days where possible (calls.ts `secs`).
pub fn secs(s: i64) -> Arg {
    text(if s % DAY == 0 { format!("{} days", s / DAY) } else { format!("{s} seconds") })
}

/// An amount in the smallest unit, as the canonical text the parser reads back exactly, in the world's money
/// (calls.ts `amountText`): its symbol or code, the whole units ungrouped, and its decimals.
pub fn amount_text(n: i64, cx: &Cx) -> Arg {
    let cur = cx.ctx.world.currency.as_ref();
    // (A world always declares its money; with none, the amount is written in its smallest unit, unmarked.)
    let minor = cur.map_or(0, |c| u32::from(c.minor_units));
    let per = 10_i64.pow(minor);
    let mark = cur.map_or_else(String::new, |c| c.symbol.clone().unwrap_or_else(|| format!("{} ", c.code)));
    let whole = n.div_euclid(per);
    text(if minor > 0 { format!("{mark}{whole}.{:0width$}", n.rem_euclid(per), width = minor as usize) } else { format!("{mark}{whole}") })
}

/// Money to an account: a one-off or repeating payment.
pub fn pay(to: &str, amount: i64, o: Pay, cx: &Cx) -> Call {
    call(
        "money",
        vec![
            ("to", Some(arg(to))),
            ("amount", Some(amount_text(amount, cx))),
            ("from", o.from.as_deref().map(arg)),
            ("for", o.for_.map(text)),
            ("settles", o.settles.as_deref().map(arg)),
            ("every", o.every.filter(|e| *e != 0).map(secs)),
            ("first", o.first.map(secs)),
            ("basis", o.basis.as_deref().map(arg)),
            ("per_request", o.per_request.as_deref().map(arg)),
            ("line", o.line.as_deref().map(arg)),
        ],
    )
}
