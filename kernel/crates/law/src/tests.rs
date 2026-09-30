use super::*;
use serde_json::json;

const PLANNING: &str = "block.block == 'construct' && !holds_liberty(actor, 'build', block.lot)";
const RIVER: &str = "block.block == 'construct' && block.cells.exists(c, c in ['cell.0.11','cell.1.11']) ";
// As worlds/generator/generate.ts writes them (14 days' notice, 12-month reviews; a 50% turnout, a majority).
const RENT: &str = "block.block == 'publish' && block.kind == 'rent_increase' && (block.data.from - now < 1209600 || block.data.from - block.data.last_from < 31104000)";
const STRIKE: &str = "block.block == 'publish' && block.kind == 'industrial_action' && (block.data.from - now < 1209600 || block.data.voted * 10000 < 5000 * block.data.eligible || block.data.yes * 10000 <= 5000 * block.data.voted)";

fn ev(c: &str, block: serde_json::Value, claims: &[Claim]) -> Result<bool, String> {
    evaluate(c, &block, "landlord-1", 0, claims)
}

#[test]
fn a_planning_law_flags_building_without_a_permit_and_not_with_one() {
    let act = json!({ "block": "construct", "at": "cell.3.4", "cells": ["cell.3.4"], "lot": "lot-03-04", "structure_type": "house" });
    assert_eq!(ev(PLANNING, act.clone(), &[]), Ok(true));
    let permit = Claim::from_record(&json!({ "position": "liberty", "holder": "landlord-1", "about": { "action": "build", "object": "lot-03-04" } })).unwrap();
    assert_eq!(ev(PLANNING, act.clone(), std::slice::from_ref(&permit)), Ok(false));
    let right = Claim { position: "right".into(), ..permit };
    assert_eq!(ev(PLANNING, act, &[right]), Ok(true));
    assert_eq!(ev(RIVER, json!({ "block": "construct", "at": "cell.1.11", "cells": ["cell.1.11"] }), &[]), Ok(true));
    assert_eq!(ev(RIVER, json!({ "block": "construct", "at": "cell.1.9", "cells": ["cell.1.9"] }), &[]), Ok(false));
}

#[test]
fn the_generated_laws_read_as_written() {
    let rent = |from: i64, last: i64| json!({ "block": "publish", "kind": "rent_increase", "data": { "from": from, "last_from": last } });
    let day = 86_400;
    assert_eq!(evaluate(RENT, &rent(10 * day, -400 * day), "l", 0, &[]), Ok(true)); // short notice
    assert_eq!(evaluate(RENT, &rent(30 * day, -100 * day), "l", 0, &[]), Ok(true)); // too soon after the last
    assert_eq!(evaluate(RENT, &rent(30 * day, -400 * day), "l", 0, &[]), Ok(false));
    // Another notice isn't read further than its kind; a notice with no last increase can't be read (an error, not false).
    assert_eq!(evaluate(RENT, &json!({ "block": "publish", "kind": "sale" }), "l", 0, &[]), Ok(false));
    assert!(evaluate(RENT, &json!({ "block": "publish", "kind": "rent_increase", "data": { "from": 30 * day } }), "l", 0, &[]).is_err());
    // …unless the other side decides: short notice is a breach whatever the last increase was.
    assert_eq!(evaluate(RENT, &json!({ "block": "publish", "kind": "rent_increase", "data": { "from": day } }), "l", 0, &[]), Ok(true));
    let strike = |voted: i64, yes: i64| json!({ "block": "publish", "kind": "industrial_action", "data": { "from": 30 * day, "voted": voted, "eligible": 100, "yes": yes } });
    assert_eq!(evaluate(STRIKE, &strike(60, 40), "u", 0, &[]), Ok(false));
    assert_eq!(evaluate(STRIKE, &strike(40, 40), "u", 0, &[]), Ok(true)); // turnout too low
    assert_eq!(evaluate(STRIKE, &strike(60, 30), "u", 0, &[]), Ok(true)); // no majority
    let permit = "block.block == 'grant_permit' && block.lot in ['lot-01-11','lot-02-11']";
    assert_eq!(evaluate(permit, &json!({ "block": "grant_permit", "lot": "lot-02-11" }), "p", 0, &[]), Ok(true));
    assert_eq!(evaluate(permit, &json!({ "block": "grant_permit", "lot": "lot-02-10" }), "p", 0, &[]), Ok(false));
}

#[test]
fn decimals_time_and_regex_are_rejected() {
    assert_eq!(violations("x > 1.5"), Ok(vec!["literal doubleValue".to_string()]));
    assert_eq!(violations("x > 1u"), Ok(vec!["literal uint64Value".to_string()]));
    assert!(!violations("timestamp('2026-01-01T00:00:00Z') < now").unwrap().is_empty());
    assert!(!violations("actor.matches('^a')").unwrap().is_empty());
    assert_eq!(violations(PLANNING), Ok(vec![]));
    assert!(evaluate("now > 1.5", &json!({}), "a", 0, &[]).unwrap_err().starts_with("condition not allowed"));
    assert!(violations("block.block ==").is_err());
    assert!(violations("(((").is_err());
    assert!(evaluate("block.block ==", &json!({}), "a", 0, &[]).unwrap_err().starts_with("parse"));
}

#[test]
fn strict_where_a_lax_reader_would_guess() {
    let e = |c: &str| evaluate(c, &json!({ "n": 5, "s": "abc", "xs": [1, 2, 3], "m": { "k": 1 } }), "a", 7, &[]);
    assert!(e("block.missing == 1").is_err()); // a missing field is an error, not null
    assert!(e("!block.n").is_err()); // no truthiness
    assert!(e("block.n < 'x'").is_err());
    assert!(e("block.n ? true : false").is_err());
    assert_eq!(e("block.n == 'x'"), Ok(false)); // different kinds are unequal
    assert!(e("9223372036854775807 + block.n > 0").is_err()); // overflow stops
    assert!(e("block.n / 0 == 0").is_err());
    assert!(e("block.xs[3] == 1").is_err());
    assert_eq!(e("false && block.missing"), Ok(false));
    assert_eq!(e("block.missing || true"), Ok(true));
    assert!(e("block.missing && true").is_err());
    assert!(e("block.n").is_err()); // not true or false
}

#[test]
fn the_allowed_functions_work() {
    let e = |c: &str| evaluate(c, &json!({ "n": 5, "s": "abcé", "xs": [1, 2, 3], "m": { "k": 1 } }), "actor-1", 7, &[]);
    for c in [
        "size(block.s) == 4 && block.s.size() == 4 && size(block.xs) == 3 && size(block.m) == 1",
        "int('12') == 12 && string(12) == '12' && string(true) == 'true'",
        "actor.startsWith('actor') && actor.endsWith('-1') && actor.contains('or-')",
        "has(block.m.k) && !has(block.m.j) && 'k' in block.m && !('j' in block.m) && 2 in block.xs",
        "block.xs.all(x, x > 0) && block.xs.exists_one(x, x == 2) && !block.xs.exists(x, x > 3)",
        "block.xs.map(x, x * 2) == [2, 4, 6] && block.xs.filter(x, x % 2 == 1) == [1, 3] && block.xs.map(x, x > 1, x) == [2, 3]",
        "block.m.exists(k, k == 'k') && {'a': 1}.a == 1 && block.m['k'] == 1 && -block.n == -5 && now == 7",
        "block.n > 1 ? block.n - 1 == 4 : false",
        "[1] + [2] == [1, 2] && 'a' + 'b' == 'ab' && block.n / 2 == 2 && block.n % 2 == 1 && block.n * 3 == 15",
    ] {
        assert_eq!(e(c), Ok(true), "{c}");
    }
    // A comprehension absorbs an error when a later element decides it.
    let mixed = json!({ "xs": [{ "a": 1 }, {}, { "a": -1 }] });
    assert_eq!(evaluate("block.xs.all(x, x.a > 0)", &mixed, "a", 0, &[]), Ok(false));
    assert_eq!(evaluate("block.xs.exists(x, x.a < 0 && false)", &mixed, "a", 0, &[]), Ok(false)); // (false absorbs it)
    assert!(evaluate("block.xs.exists(x, x.a > 5)", &mixed, "a", 0, &[]).is_err()); // nothing decides it
    assert!(evaluate("block.n == 1", &json!({ "n": 1.5 }), "a", 0, &[]).is_err());
}

#[test]
fn the_json_boundary() {
    let out: serde_json::Value = serde_json::from_str(&call(&json!({ "op": "evaluate", "condition": PLANNING, "block": { "block": "construct", "lot": "l" }, "actor": "a", "now": 0,
        "claims": [{ "position": "liberty", "holder": "a", "about": { "action": "build", "object": "l" } }] }).to_string())).unwrap();
    assert_eq!(out, json!({ "value": false }));
    let out: serde_json::Value = serde_json::from_str(&call(&json!({ "op": "violations", "condition": "x > 1.5" }).to_string())).unwrap();
    assert_eq!(out, json!({ "violations": ["literal doubleValue"] }));
    assert!(call("{").contains("error"));
    assert!(call(r#"{"op":"source"}"#).contains(SOURCE));
}
