//! Lane D's actors (docs/port-guide.md, section 8): the bank's payment system and lending office (bank.ts, credit.ts), the
//! retirement fund (fund.ts), the union's organiser (union.ts), the local paper (news.ts), and two libraries every
//! organisation uses for grievances and for what a decision waits for (frictions.ts, decisions.ts). Each kind is in a
//! module of its own here, listed in `KINDS` (the registry reads it: no lane edits another's list).
//!
//! What lane D's kinds ask of other lanes, and offer them (docs/decisions.md, 2026-10-17, "Lane D"):
//! - `decisions` and `frictions` are libraries for offices and firms (lanes C1 and E): `Waits`, `Reconsiderations`,
//!   `Respondent` (with `Character`, which C1's organisation implements), the papers they travel on.
//! - `oikos_rules::decisions` (the law's rules as data), `oikos_rules::bargaining` (what a stoppage costs each side:
//!   C1's employer calls it), `oikos_rules::words::refusal_text` (a refusal in the world's words).
//! - Two seams for what is another lane's: the lending office's staff payroll (`credit::StaffPayroll`, wired to C1's
//!   `Staffing`) and the union's hearing of a member's grievance (`union::Grievances`, wired to E's `Hearings`).

pub mod bank;
pub mod credit;
pub mod decisions;
pub mod frictions;
pub mod fund;
#[cfg(test)]
pub mod kit;
pub mod news;
pub mod union;

use crate::steps::{because, Step};
use crate::{Action, Ctx, Kind};
use oikos_sight::calls::{parse_program, program_text, Call, Program};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Every kind of this lane, in name order.
pub static KINDS: &[&dyn Kind] = &[&credit::Lending { payroll: None }, &bank::PaymentSystem, &news::Newspaper, &fund::Retirement, &union::Organiser { grievances: None }];

/// A manifest as the module file carries it (until the cut-over each equals `participants/manifests/<name>.json`).
pub(crate) fn manifest_of(json: &str) -> Value {
    serde_json::from_str(json).unwrap_or(Value::Null)
}

/// A stable spread of `n` over a participant and a purpose, for the first wake and the like (TS drew `ctx.rng("first-wake")`
/// in `firstWake`; a kind has no stream before it runs, so Rust names the spread by who it is: FNV-1a over the participant
/// id and the purpose, the same on every machine and in every order).
pub(crate) fn spread(ctx: &Ctx, purpose: &str, n: i64) -> i64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in ctx.participant.bytes().chain([0u8]).chain(purpose.bytes()) {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    (h % n.max(1) as u64) as i64
}

/// One act of calls with its reason (common.ts `callAction(because(...))`).
pub(crate) fn act(why: &str, calls: Vec<Call>) -> Action {
    let s: Step<()> = because(why, calls);
    Action::Call { program: s.program(), reasoning: s.why }
}

/// An act kept to be sent later, as its program's text (the call language reads back exactly): what an actor holds across
/// a snapshot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Kept {
    pub why: String,
    pub program: String,
}

impl Kept {
    pub fn of(why: &str, calls: &[Call]) -> Kept {
        let s: Step<()> = because(why, calls.to_vec());
        Kept { why: why.to_string(), program: program_text(&s.program()) }
    }
    pub fn action(&self) -> Action {
        let program = parse_program(&self.program).unwrap_or(Program::None(String::new()));
        Action::Call { program, reasoning: Some(self.why.clone()) }
    }
}

/// A letter kept to be sent: to whom, the words, and what it answers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Note {
    pub to: Vec<String>,
    pub text: String,
    pub re: Option<String>,
}

impl Note {
    pub fn new(to: Vec<String>, text: String, re: Option<&str>) -> Note {
        Note { to, text, re: re.map(String::from) }
    }
    pub fn call(&self) -> Call {
        crate::common::message(&self.to, &self.text, self.re.as_deref())
    }
}

/// A decimal number as written (`12`, `-3.25`, `0.5`) as whole units and the digits after the point: `(N, k)` meaning
/// N / 10^k. The world has no floating point (kernel/tests/determinism_lint.rs): a figure a profile or a statistician
/// writes with a fraction is read as the digits it was written in. None where it is not a plain decimal.
fn decimal(s: &str) -> Option<(i128, u32)> {
    let s = s.trim();
    let (neg, rest) = match s.strip_prefix('-') {
        Some(r) => (true, r),
        None => (false, s.strip_prefix('+').unwrap_or(s)),
    };
    let (whole, frac) = rest.split_once('.').unwrap_or((rest, ""));
    if whole.is_empty() && frac.is_empty() || !whole.chars().all(|c| c.is_ascii_digit()) || !frac.chars().all(|c| c.is_ascii_digit()) || frac.len() > 18 || whole.len() > 18 {
        return None;
    }
    let n: i128 = format!("{whole}{frac}").parse().ok()?;
    Some((if neg { -n } else { n }, frac.len() as u32))
}

fn text_of(v: &Value) -> Option<String> {
    match v {
        Value::Number(n) => Some(n.to_string()),
        Value::String(s) => Some(s.clone()),
        _ => None,
    }
}

/// A number written in the world's data, times `scale`, rounded half up (JavaScript's `Math.round`), in whole numbers:
/// `scaled(&json!(8.25), 100) == Some(825)`.
pub(crate) fn scaled(v: &Value, scale: i64) -> Option<i64> {
    let (n, k) = decimal(&text_of(v)?)?;
    let d = 10_i128.pow(k);
    i64::try_from((n * i128::from(scale) * 2 + d).div_euclid(2 * d)).ok()
}

/// A number written in the world's data rounded down (JavaScript's `Math.floor`), in whole numbers.
pub(crate) fn floor_of(v: &Value) -> Option<i64> {
    let (n, k) = decimal(&text_of(v)?)?;
    i64::try_from(n.div_euclid(10_i128.pow(k))).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn numbers_written_with_a_fraction_are_read_as_the_digits_they_were_written_in_and_rounded_as_javascript_rounds() {
        assert_eq!(scaled(&json!(8.25), 100), Some(825));
        assert_eq!(scaled(&json!("12.345"), 100), Some(1235), "half up");
        assert_eq!(scaled(&json!(0.5), 1_000), Some(500));
        assert_eq!(scaled(&json!(-1.5), 1), Some(-1), "half toward the larger, as Math.round does");
        assert_eq!(scaled(&json!(12), 100), Some(1200));
        assert_eq!(scaled(&json!("x"), 100), None);
        assert_eq!(scaled(&json!(null), 100), None);
        assert_eq!(floor_of(&json!(12.9)), Some(12));
        assert_eq!(floor_of(&json!(-1.5)), Some(-2));
        assert_eq!(floor_of(&json!("40")), Some(40));
        assert_eq!(floor_of(&json!(true)), None);
    }

    #[test]
    fn a_spread_is_by_who_it_is_the_same_on_every_machine_and_within_its_bound() {
        let ctx = |p: &str| crate::Ctx { participant: p.into(), performer: Default::default(), entity: "e".into(), position: None, params: Default::default(), world: Default::default() };
        let (a, b) = (spread(&ctx("bank-1"), "first-wake", 24), spread(&ctx("bank-2"), "first-wake", 24));
        assert!((0..24).contains(&a) && (0..24).contains(&b));
        assert_eq!(a, spread(&ctx("bank-1"), "first-wake", 24));
        assert_ne!(spread(&ctx("bank-1"), "first-wake", 1_000_000), spread(&ctx("bank-1"), "first-edition", 1_000_000));
        assert_eq!(spread(&ctx("x"), "p", 1), 0);
    }

    #[test]
    fn every_kind_of_the_lane_is_listed_in_name_order_with_a_manifest_that_names_it() {
        let names: Vec<&str> = KINDS.iter().map(|k| k.name()).collect();
        assert_eq!(names, ["bank.lending", "bank.payment_system", "firm.newspaper", "fund.retirement", "union.organiser"]);
        for k in KINDS {
            assert_eq!(k.manifest()["name"], k.name());
            assert_eq!(k.manifest()["version"], k.version());
        }
    }
}
