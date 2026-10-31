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

/// Acts a translator drafted for the actor's words and its own module accepted (docs/behaviour/founding.md, "Through the
/// translator"): sent as they are, with the draft's provenance, in place of calls. A code actor's steps are otherwise
/// calls; these are the one place its acts are a draft's, so the log says the translator wrote them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Drafted {
    pub blocks: Vec<Value>,
    /// The draft's provenance as the host gave it (`via: translator`, the proposal, draft, hash, translator, call, resolver).
    pub provenance: Value,
    /// What the actor made of it, reported as the acts are sent (`Cx::worded`).
    pub worded: crate::Worded,
}

/// Calls in one action, with its reason, and the plan's token for what follows from it.
#[derive(Debug, Clone)]
pub struct Step<T> {
    pub lines: Vec<Line>,
    /// A translator's accepted draft, sent in place of the lines (which are then empty).
    pub act: Option<Box<Drafted>>,
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
        Step { lines, act: None, why: None, then: None, redo: false, planned: None, lapses_at: None }
    }
    /// A step that sends a translator's accepted draft (with no reasoning of its own: run.ts `wordsFor` gave none).
    pub fn drafted(d: Drafted) -> Self {
        let mut s = Step::new(vec![]);
        s.act = Some(Box::new(d));
        s
    }
    /// Whether there is nothing to send.
    pub fn is_empty(&self) -> bool {
        self.lines.is_empty() && self.act.is_none()
    }
    /// The action that sends it: its calls, or the draft it carries (reported to the engine as it goes: `Cx::worded`).
    pub fn action(&self, cx: &mut Cx) -> Action {
        match &self.act {
            Some(d) => {
                cx.worded(d.worded.clone());
                Action::Act {
                    blocks: d.blocks.iter().filter_map(|b| serde_json::from_value(b.clone()).ok()).collect(),
                    reasoning: self.why.clone(),
                    by: vec![],
                    provenance: oikos_sight::Provenance::Given(d.provenance.clone()),
                }
            }
            None => Action::Call { program: self.program(), reasoning: self.why.clone() },
        }
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
            Some(tok) => self.plan.then(tok, done, cx).into_iter().filter(|s| !s.is_empty()).collect(),
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    act: Option<Drafted>,
    why: Option<String>,
    then: Option<T>,
    redo: bool,
    planned: Option<i64>,
    lapses_at: Option<i64>,
}

fn save_step<T: Clone>(s: &Step<T>) -> SavedStep<T> {
    SavedStep {
        program: program_text(&s.program()),
        act: s.act.as_deref().cloned(),
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
    Ok(Step { lines, act: s.act.map(Box::new), why: s.why, then: s.then, redo: s.redo, planned: s.planned, lapses_at: s.lapses_at })
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
                if let Some((s, _)) = self.under_way.remove(o.action.as_str()) {
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
            let mut fresh: Vec<_> = self.plan.plan(pic, cx).into_iter().filter(|s| !s.is_empty()).collect();
            for s in &mut fresh {
                s.planned.get_or_insert(pic.t);
            }
            self.todo.extend(fresh);
            self.planned_at = pic.t;
        }
        follow.retain(|s| !s.is_empty());
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
        let action = next.action(cx);
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

/// The stepper's rules, each held here on a plan of its own (they were held in TypeScript by participants/test/stepper.test.ts, on
/// `stepper`, which went with the TypeScript actors; the engine's offices show them only through their own acts). The TypeScript
/// loop's allowance of twelve acts a wake was the host's, not the stepper's: here a wake is as many steps as are asked for.
#[cfg(test)]
mod tests {
    use super::*;
    use crate::finance::kit::{picture, Stand};
    use serde_json::json;

    fn note<T>(i: i64) -> Step<T> {
        because(format!("step {i}"), vec![call("message", vec![("to", Some(json(json!(["x"])))), ("text", Some(text(i.to_string())))])])
    }
    fn which(a: &Action) -> String {
        match a {
            Action::Wait { .. } => "wait".into(),
            Action::Look { .. } => "look".into(),
            Action::Call { reasoning, .. } => reasoning.clone().unwrap_or_default(),
            other => format!("{other:?}"),
        }
    }
    fn pic(t: i64) -> Picture {
        picture("firm", t, json!({}))
    }

    // ---- what a wake did not get to is done first at the next, never dropped

    #[derive(Serialize, Deserialize, Default)]
    struct Twenty {
        wake: u32,
    }
    impl Plan for Twenty {
        type Then = ();
        fn absorb(&mut self, _: &Picture, _: &mut Cx) {}
        fn plan(&mut self, _: &Picture, _: &mut Cx) -> Vec<Step<()>> {
            self.wake += 1;
            if self.wake == 1 { (0..20).map(note).collect() } else { vec![note(100)] }
        }
    }

    #[test]
    fn what_a_wake_did_not_get_to_is_done_first_at_the_next_never_dropped() {
        let mut stand = Stand::new("firm");
        let mut s = Stepper::new(Twenty::default());
        let first: Vec<String> = (0..12).map(|_| which(&s.step(&pic(0), &mut stand.cx(0)))).collect();
        assert_eq!(first, (0..12).map(|i| format!("step {i}")).collect::<Vec<_>>());
        // The next wake: the 8 left over, in order, then what it plans now; then nothing more.
        let next: Vec<String> = (0..10).map(|_| which(&s.step(&pic(DAY), &mut stand.cx(DAY)))).collect();
        let mut want: Vec<String> = (12..20).map(|i| format!("step {i}")).collect();
        want.extend(["step 100".to_string(), "wait".to_string()]);
        assert_eq!(next, want);
    }

    // ---- a day's work left undone when the day's over is dropped, and the plan hears it was not done

    #[derive(Serialize, Deserialize, Default)]
    struct Day {
        wake: u32,
        heard: Vec<u32>,
    }
    impl Plan for Day {
        type Then = u32;
        fn absorb(&mut self, _: &Picture, _: &mut Cx) {}
        fn plan(&mut self, _: &Picture, _: &mut Cx) -> Vec<Step<u32>> {
            self.wake += 1;
            if self.wake == 1 {
                let mut v: Vec<Step<u32>> = (0..12).map(note).collect();
                v.push(because("work 50", vec![call("work", vec![("task", Some(text("serve"))), ("units", Some(text("1"))), ("at", Some(text("shop")))])]).then(50));
                v.push(note(51));
                v
            } else {
                vec![note(100)]
            }
        }
        fn then(&mut self, token: &u32, done: Done, _: &mut Cx) -> Vec<Step<u32>> {
            assert!(matches!(done, Done::NotDone(_)), "it was never sent");
            self.heard.push(*token);
            vec![]
        }
    }

    #[test]
    fn a_days_work_left_undone_when_the_day_is_over_is_dropped_and_the_plan_hears_it_was_not_done() {
        let mut stand = Stand::new("firm");
        let mut s = Stepper::new(Day::default());
        for _ in 0..12 {
            s.step(&pic(3_600), &mut stand.cx(3_600));
        }
        // The next day: the day's work is dropped (and told so); the other leftover step still comes first.
        let t = DAY + 3_600;
        let next: Vec<String> = (0..3).map(|_| which(&s.step(&pic(t), &mut stand.cx(t)))).collect();
        assert_eq!(next, ["step 51", "step 100", "wait"]);
        assert_eq!(s.plan.heard, vec![50]);
    }

    // ---- a step that counts from when it is done is made again if it is done later than planned

    #[derive(Serialize, Deserialize, Default)]
    struct Redo {
        wake: u32,
        made: Vec<i64>,
    }
    fn notice(at: i64) -> Step<()> {
        let mut s = because(format!("notice from {}", at + 5), vec![call("message", vec![("to", Some(json(json!(["x"])))), ("text", Some(text("n")))])]);
        s.redo = true;
        s
    }
    impl Plan for Redo {
        type Then = ();
        fn absorb(&mut self, _: &Picture, _: &mut Cx) {}
        fn plan(&mut self, _: &Picture, _: &mut Cx) -> Vec<Step<()>> {
            self.wake += 1;
            if self.wake == 1 {
                self.made.push(0);
                let mut v: Vec<Step<()>> = (0..12).map(note).collect();
                v.push(notice(0));
                v
            } else {
                vec![]
            }
        }
        fn redo(&mut self, _: Step<()>, t: i64) -> Step<()> {
            self.made.push(t);
            notice(t)
        }
    }

    #[test]
    fn a_step_that_counts_from_when_it_is_done_is_made_again_if_it_is_done_later_than_planned() {
        let mut stand = Stand::new("firm");
        let mut s = Stepper::new(Redo::default());
        for _ in 0..12 {
            s.step(&pic(0), &mut stand.cx(0));
        }
        // Carried to the next wake, at 3600: remade for then.
        assert_eq!(which(&s.step(&pic(3_600), &mut stand.cx(3_600))), "notice from 3605");
        assert_eq!(s.plan.made, vec![0, 3_600]);
    }

    // ---- what a plan needs to look up is asked before it plans, one look after another

    #[derive(Serialize, Deserialize, Default)]
    struct Lookup {
        known: Vec<String>,
        planned: Vec<String>,
    }
    impl Plan for Lookup {
        type Then = ();
        fn absorb(&mut self, pic: &Picture, _: &mut Cx) {
            for seen in pic.channels.values() {
                if let oikos_sight::Seen::Records { records, .. } = seen {
                    for r in records {
                        if !self.known.contains(&r.id.to_string()) {
                            self.known.push(r.id.to_string());
                        }
                    }
                }
            }
        }
        fn plan(&mut self, _: &Picture, _: &mut Cx) -> Vec<Step<()>> {
            let mut k = self.known.clone();
            k.sort();
            self.planned = k;
            vec![note(1)]
        }
        fn looks(&mut self, _: &Picture) -> Vec<LookRequest> {
            let wanted = ["lot-1", "lot-2"].iter().find(|w| !self.known.iter().any(|k| k == *w));
            wanted.map(|_| vec![serde_json::from_value(json!({ "channel": "lots" })).expect("a look")]).unwrap_or_default()
        }
    }
    fn found(t: i64, id: &str) -> Picture {
        picture("firm", t, json!({ "lots": { "kind": "records", "search": true, "records": [{ "id": id, "at": 0, "record": "statement", "author": "x", "speaks_for": "c", "visible_to": "public", "kind": "lot", "text": "A lot." }] } }))
    }

    #[test]
    fn what_a_plan_needs_to_look_up_is_asked_before_it_plans_one_look_after_another() {
        let mut stand = Stand::new("firm");
        let mut s = Stepper::new(Lookup::default());
        assert_eq!(which(&s.step(&pic(0), &mut stand.cx(0))), "look");
        assert_eq!(which(&s.step(&found(0, "lot-1"), &mut stand.cx(0))), "look");
        assert_eq!(which(&s.step(&found(0, "lot-2"), &mut stand.cx(0))), "step 1");
        assert_eq!(s.plan.planned, vec!["lot-1", "lot-2"]);
        assert_eq!(which(&s.step(&pic(0), &mut stand.cx(0))), "wait");
    }

    // ---- an act's outcome goes to the act it is of, however late

    #[derive(Serialize, Deserialize, Default)]
    struct Order {
        wake: u32,
        heard: Vec<String>,
    }
    impl Plan for Order {
        type Then = u8;
        fn absorb(&mut self, _: &Picture, _: &mut Cx) {}
        fn plan(&mut self, _: &Picture, _: &mut Cx) -> Vec<Step<u8>> {
            self.wake += 1;
            if self.wake == 1 { vec![note(0).then(1), note(1).then(2)] } else { vec![] }
        }
        fn then(&mut self, token: &u8, done: Done, _: &mut Cx) -> Vec<Step<u8>> {
            let Done::Outcome(o) = done else { return vec![] };
            self.heard.push(format!("{}:{}", if *token == 1 { "long" } else { "short" }, if o.status == oikos_sight::OutcomeStatus::Applied { "applied" } else { "refused" }));
            vec![]
        }
    }
    fn outcome(action: &str, status: &str, t: i64) -> Outcome {
        serde_json::from_value(json!({ "action": action, "t": t, "status": status })).expect("an outcome")
    }

    #[test]
    fn an_acts_outcome_goes_to_the_act_it_is_of_however_late() {
        // (Foundations F1, 2026-10-15. An office that sets a crew to work is free again before the crew is done, and an order that will not fit the
        // crew's day is refused at once: its outcome comes before that of the long work sent earlier.)
        let mut stand = Stand::new("firm");
        let mut s = Stepper::new(Order::default());
        s.step(&pic(0), &mut stand.cx(0));
        s.sent("act.1");
        s.step(&pic(2), &mut stand.cx(2));
        s.sent("act.2");
        // The short one is refused at once; the long one is applied hours later.
        let mut p = pic(4);
        p.outcomes = vec![outcome("act.2", "refused", 3)];
        s.step(&p, &mut stand.cx(4));
        let mut p = pic(20_000);
        p.outcomes = vec![outcome("act.1", "applied", 18_000)];
        s.step(&p, &mut stand.cx(20_000));
        assert_eq!(s.plan.heard, vec!["short:refused", "long:applied"]);
    }
}
