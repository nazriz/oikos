//! The call builders common.ts had beside `say` and `pay` (which are in `crate::steps`): withdrawing a statement,
//! going in and out of a space, a vote, a claim recorded. Agreements' are in `crate::papers::agreements` (`offer`,
//! `sign`, `notice`), a letter's in `letters::message`.

use crate::steps::{arg, call, json, text, Visible};
use oikos_sight::calls::Call;
use serde_json::Value;

/// Take a statement of ours down (`text`: why, in words).
pub fn withdraw(record: &str, why: Option<&str>) -> Call {
    call("statement", vec![("withdraw", Some(arg(record))), ("text", why.map(text))])
}

/// Go into a space (a home, a workplace floor).
pub fn move_in(space: &str) -> Call {
    call("occupancy", vec![("in", Some(arg(space)))])
}

/// Come out of a space, or a whole building.
pub fn move_out(from: &str, who: &str) -> Call {
    call("occupancy", vec![("in", Some(arg(from))), ("who", Some(arg(who))), ("leave", Some(arg("yes")))])
}

/// A vote on a ballot; `visible`: public, or only to these (a secret ballot).
pub fn vote(ballot: &str, choice: &str, visible: Option<Visible>) -> Call {
    call(
        "vote",
        vec![
            ("ballot", Some(arg(ballot))),
            ("choice", Some(arg(choice))),
            (
                "visible",
                visible.map(|v| match v {
                    Visible::Public => arg("public"),
                    Visible::Only(ids) => json(Value::from(ids)),
                }),
            ),
        ],
    )
}

/// A claim recorded: `holder` has a right or liberty about `about` (against someone, citing a basis).
pub fn record(position: &str, holder: &str, about: Value, against: Option<&str>, basis: Option<&str>) -> Call {
    call(
        "claim",
        vec![("position", Some(arg(position))), ("holder", Some(arg(holder))), ("about", Some(json(about))), ("against", against.map(arg)), ("basis", basis.map(arg))],
    )
}
