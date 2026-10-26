//! An act may rest on several records (contracts: Basis). The kernel checks that each exists and keeps them in the
//! order cited; it never asks what any of them is, or whether the act follows from them. One record has one written
//! form (its id alone), so every record made before a basis could be several reads and hashes as it did.

use crate::common;

use common::*;
use oikos_kernel::blocks::{Basis, BasisArg, Block, Record};
use oikos_kernel::events::{EventBody, RefusalCode};
use oikos_kernel::observe::ChannelData;
use oikos_kernel::run::{Response, Run};
use oikos_kernel::Command;
use serde_json::{json, Value};

fn town() -> Run<Vec<u8>> {
    let mut c = riverbend();
    let bob = c["participants"].as_array_mut().unwrap().iter_mut().find(|s| s["id"] == "bob-self").unwrap();
    bob["channels"].as_array_mut().unwrap().push(json!({"id": "board", "kind": "records", "way": "published", "match": {"statement_kinds": ["notice"]}, "on_request": true}));
    Run::start(c, "basis", Vec::new(), None).unwrap()
}

fn act(run: &mut Run<Vec<u8>>, participant: &str, blocks: Value) -> Response {
    run.done(&rb_act(participant, blocks)).unwrap()
}

fn refusal(r: &Response) -> Option<RefusalCode> {
    match &r.events[0].body {
        EventBody::ActionRefused { code, .. } => Some(code.clone()),
        _ => None,
    }
}

fn made(r: &Response, name: &str) -> String {
    match &r.events[0].body {
        EventBody::ActionApplied { created: Some(c), .. } => c[name].clone(),
        other => panic!("expected an applied action, got {other:?}"),
    }
}

fn notice(run: &mut Run<Vec<u8>>, basis: Value) -> Response {
    act(run, "mayor", json!([{"block": "publish", "kind": "notice", "speaks_for": "city", "text": "The river path is closed.", "basis": basis, "ref": "n"}]))
}

fn stored(run: &Run<Vec<u8>>, id: &str) -> Value {
    serde_json::to_value(&*run.kernel().state().records[id].record).unwrap()
}

#[test]
fn one_basis_has_one_written_form() {
    // In a record: its id alone, or two or more as a list. A list of one, an empty one, a repeat: not a record.
    let record = |basis: Value| -> Result<Record, serde_json::Error> {
        serde_json::from_value(json!({"id": "rec.9", "record": "statement", "author": "genesis", "at": 0, "visible_to": "public", "kind": "notice", "text": "x", "basis": basis}))
    };
    let one = record(json!("law-river")).unwrap();
    assert_eq!(one.basis.as_ref().unwrap().ids(), ["law-river"]);
    assert_eq!(serde_json::to_value(&one).unwrap()["basis"], json!("law-river"));
    let two = record(json!(["law-river", "title-p12"])).unwrap();
    assert_eq!(two.basis.as_ref().unwrap().ids(), ["law-river", "title-p12"]);
    assert_eq!(two.basis.as_ref().unwrap().first(), "law-river");
    assert!(two.basis.as_ref().unwrap().cites("title-p12") && !two.basis.as_ref().unwrap().cites("lease-bob"));
    assert_eq!(serde_json::to_value(&two).unwrap()["basis"], json!(["law-river", "title-p12"]));
    for bad in [json!(["law-river"]), json!([]), json!(["law-river", "law-river"]), json!([1, 2]), json!({"a": "law-river"})] {
        assert!(record(bad.clone()).is_err(), "{bad} is no stored basis");
    }
    let many: Vec<String> = (0..65).map(|i| format!("rec.{i}")).collect();
    assert!(record(json!(many)).is_err(), "more than 64");
    assert!(record(json!(many[..64])).is_ok());
    // Put together from what a block cites: in order, each once, and nothing from nothing.
    assert_eq!(serde_json::to_value(Basis::of(["a".to_string()]).unwrap()).unwrap(), json!("a"));
    assert_eq!(serde_json::to_value(Basis::of(["b".to_string(), "a".into(), "b".into()]).unwrap()).unwrap(), json!(["b", "a"]));
    assert!(Basis::of(Vec::<String>::new()).is_none());

    // In a block: one, or a list of one or more (kept as written, so the command reads in the log as it was given).
    let block = |basis: Value| -> Result<Block, serde_json::Error> { serde_json::from_value(json!({"block": "withdraw", "record": "rec.1", "basis": basis})) };
    for (written, ids) in [(json!("rec.2"), vec!["rec.2"]), (json!(["rec.2"]), vec!["rec.2"]), (json!(["$permit", "rec.2"]), vec!["$permit", "rec.2"])] {
        let b = block(written.clone()).unwrap();
        let Block::Withdraw { basis: Some(basis), .. } = &b else { panic!() };
        assert_eq!(basis.ids(), ids);
        assert_eq!(serde_json::to_value(&b).unwrap()["basis"], written);
    }
    assert_eq!(BasisArg::one("rec.2").ids(), ["rec.2"]);
    for bad in [json!([]), json!(["rec.2", "rec.2"]), json!([["rec.2"]]), json!(7)] {
        assert!(block(bad.clone()).is_err(), "{bad} is no basis");
    }
}

#[test]
fn a_record_may_rest_on_several_records_each_of_which_must_exist() {
    let mut run = town();
    // One, as ever.
    let r = notice(&mut run, json!("law-river"));
    assert_eq!(stored(&run, &made(&r, "n"))["basis"], json!("law-river"));
    // Several: all kept, in the order cited (not sorted), whatever they are (a law, a title, a lease: the kernel doesn't ask).
    let r = notice(&mut run, json!(["title-p12", "law-river", "lease-bob"]));
    assert_eq!(refusal(&r), None);
    let id = made(&r, "n");
    assert_eq!(stored(&run, &id)["basis"], json!(["title-p12", "law-river", "lease-bob"]));
    // The event that says it was recorded says the same.
    let recorded = r.events.iter().find_map(|e| match &e.body {
        EventBody::Recorded { record } => Some(serde_json::to_value(record).unwrap()),
        _ => None,
    });
    assert_eq!(recorded.unwrap()["basis"], json!(["title-p12", "law-river", "lease-bob"]));
    // A list of one is that record: stored as it alone.
    let r = notice(&mut run, json!(["law-river"]));
    assert_eq!(stored(&run, &made(&r, "n"))["basis"], json!("law-river"));
    // Any one of them missing: refused whole, and nothing is recorded.
    let n = run.kernel().state().records.len();
    assert_eq!(refusal(&notice(&mut run, json!(["law-river", "rec.999999"]))), Some(RefusalCode::UnknownRecord));
    assert_eq!(refusal(&notice(&mut run, json!(["rec.999999", "law-river"]))), Some(RefusalCode::UnknownRecord));
    assert_eq!(run.kernel().state().records.len(), n);
    // Every act that makes a record takes several: a claim, its transfer and release, an agreement, a withdrawal.
    let r = act(
        &mut run,
        "mayor",
        json!([
            {"block": "record_claim", "position": "liberty", "holder": "devco", "about": {"action": "build"}, "speaks_for": "city", "basis": ["law-river", "title-p12"], "ref": "c"},
            {"block": "transfer_claim", "claim": "$c", "to": "buildco", "speaks_for": "city", "basis": ["$c", "law-river"], "ref": "t"},
            {"block": "release_claim", "claim": "$c", "speaks_for": "city", "basis": ["$t", "$c"], "ref": "x"},
            {"block": "propose_agreement", "speaks_for": "city", "basis": ["$c", "title-p12"], "terms": {"parties": ["city", "devco"], "commitments": [{"who": "devco", "does": {"text": "Build it."}}], "text": "Terms."}, "ref": "a"},
            {"block": "withdraw", "record": id, "speaks_for": "city", "basis": ["law-river", "$a"], "ref": "w"}
        ]),
    );
    assert_eq!(refusal(&r), None);
    let (c, t, a) = (made(&r, "c"), made(&r, "t"), made(&r, "a"));
    assert_eq!(stored(&run, &c)["basis"], json!(["law-river", "title-p12"]));
    assert_eq!(stored(&run, &t)["basis"], json!([c, "law-river"]), "a name bound earlier in the act is the record it made");
    assert_eq!(stored(&run, &made(&r, "x"))["basis"], json!([t, c]));
    assert_eq!(stored(&run, &a)["basis"], json!([c, "title-p12"]));
    assert_eq!(stored(&run, &made(&r, "w"))["basis"], json!(["law-river", a]));
    // A name that isn't bound is refused, as anywhere.
    assert_eq!(refusal(&notice(&mut run, json!(["law-river", "$nothing"]))), Some(RefusalCode::UnknownRef));
}

#[test]
fn a_world_may_begin_with_records_resting_on_several() {
    let with = |basis: Value| {
        let mut c = riverbend();
        c["world"]["records"].as_array_mut().unwrap().push(json!({"id": "notice-path", "record": "statement", "author": "genesis", "at": 0, "visible_to": "public", "kind": "notice", "speaks_for": "city", "text": "The river path is closed.", "basis": basis}));
        Run::start(c, "basis", Vec::new(), None)
    };
    let run = with(json!(["law-river", "title-p12"])).unwrap();
    assert_eq!(stored(&run, "notice-path")["basis"], json!(["law-river", "title-p12"]));
    assert!(with(json!(["law-river", "no-such-record"])).is_err(), "each must exist");
    assert!(with(json!(["law-river"])).is_err(), "one record is written as its id alone");
    assert!(with(json!("law-river")).is_ok());
}

#[test]
fn a_search_by_basis_finds_a_record_that_cites_it_among_several() {
    let mut run = town();
    let alone = made(&notice(&mut run, json!("law-river")), "n");
    let both = made(&notice(&mut run, json!(["title-p12", "law-river"])), "n");
    let other = made(&notice(&mut run, json!("title-p12")), "n");
    let none = made(&act(&mut run, "mayor", json!([{"block": "publish", "kind": "notice", "speaks_for": "city", "text": "Nothing cited.", "ref": "n"}])), "n");
    let mut found = |q: Value| -> Vec<String> {
        let looks = serde_json::from_value(json!([{"channel": "board", "query": q}])).unwrap();
        let o = run.command(&Command::Look { participant: "bob-self".into(), only: None, looks }).unwrap().observation.unwrap();
        match o.channels.get("board").unwrap() {
            ChannelData::Records { records, .. } => records.iter().map(|r| r.id.clone()).collect(),
            _ => panic!(),
        }
    };
    // Equal: it cites that record, alone or among several. Newest first.
    assert_eq!(found(json!({"where": [{"field": "basis", "op": "=", "value": "law-river"}]})), vec![both.clone(), alone.clone()]);
    assert_eq!(found(json!({"where": [{"field": "basis", "op": "=", "value": "title-p12"}]})), vec![other.clone(), both.clone()]);
    // Not equal: it cites something, and not that. One that cites nothing has no such field, as before.
    assert_eq!(found(json!({"where": [{"field": "basis", "op": "!=", "value": "law-river"}]})), vec![other.clone()]);
    assert_eq!(found(json!({"where": [{"field": "basis", "op": "!=", "value": "lease-bob"}]})), vec![other.clone(), both.clone(), alone.clone()]);
    // Ordered by basis: by the one cited first; those citing nothing last.
    assert_eq!(found(json!({"order": {"field": "basis"}})), vec![alone, other, both, none]);
}
