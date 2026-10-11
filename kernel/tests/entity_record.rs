//! An entity's own record (docs/design/ai-citizens.md 10d): held by the kernel, written only by it, bounded, chained,
//! shown to nobody but the entity, and never set by a participant a model runs.

mod common;

use common::*;
use oikos_kernel::canon;
use oikos_kernel::events::EventBody;
use oikos_kernel::observe::ChannelData;
use oikos_kernel::run::{replay, Run};
use oikos_kernel::Command;
use serde_json::{json, Value};
use std::collections::BTreeMap;

fn set(participant: &str, sections: Value, because: Option<Value>) -> Command {
    Command::EntityRecord { participant: participant.into(), set: serde_json::from_value::<BTreeMap<String, Value>>(sections).unwrap(), because }
}

fn recorded(r: &oikos_kernel::run::Response) -> (String, u64, String, String) {
    match &r.events[0].body {
        EventBody::EntityRecorded { entity, n, chain, digest } => (entity.clone(), *n, chain.clone(), digest.clone()),
        other => panic!("expected entity_recorded, got {other:?}"),
    }
}

#[test]
fn a_record_is_set_section_by_section_and_chained() {
    let mut run = Run::start(riverbend(), "record", Vec::new(), None).unwrap();
    let first = json!({"needs": {"shelter": 10000, "meaning": 4000}, "agency": {"now": 5000}});
    let r1 = run.command(&set("alice-self", first.clone(), None)).unwrap();
    let (entity, n, chain1, digest1) = recorded(&r1);
    assert_eq!((entity.as_str(), n), ("alice", 1));
    // The first link: the change alone. The digest: the sections as they stand.
    let change = json!({"t": 0, "set": first, "because": null});
    assert_eq!(chain1, canon::hash_with_domain(canon::DOMAIN_ENTITY_RECORD, &canon::canonical_value(&change).unwrap()));
    assert_eq!(digest1, canon::hash_with_domain(canon::DOMAIN_ENTITY_RECORD, &canon::canonical_value(&first).unwrap()));

    // A second change sets one section; the other stands. Its link is over the first.
    let because = json!([{"what": "notice_received", "about": "acme"}]);
    let second = json!({"agency": {"now": 4200}});
    let r2 = run.command(&set("alice-self", second.clone(), Some(because.clone()))).unwrap();
    let (_, n, chain2, digest2) = recorded(&r2);
    assert_eq!(n, 2);
    let mut link = chain1.clone().into_bytes();
    link.extend(canon::canonical_value(&json!({"t": 0, "set": second, "because": because})).unwrap());
    assert_eq!(chain2, canon::hash_with_domain(canon::DOMAIN_ENTITY_RECORD, &link));
    let whole = json!({"needs": {"shelter": 10000, "meaning": 4000}, "agency": {"now": 4200}});
    assert_eq!(digest2, canon::hash_with_domain(canon::DOMAIN_ENTITY_RECORD, &canon::canonical_value(&whole).unwrap()));
    let held = &run.kernel().state().entity_records["alice"];
    assert_eq!((held.n, held.chain.as_str()), (2, chain2.as_str()));
    assert_eq!(serde_json::to_value(&held.sections).unwrap(), whole);

    // It is state: a replay of the log comes to the same world.
    let state = run.kernel().canonical_state().unwrap();
    run.finish("completed", None).unwrap();
    let log = run.into_log();
    assert_eq!(replay(&log, None).unwrap().canonical_state, state);
}

#[test]
fn a_record_never_grows_past_its_cap() {
    let mut cfg = riverbend();
    cfg["caps"]["entity_record_bytes"] = json!(256);
    let mut run = Run::start(cfg, "record-cap", Vec::new(), None).unwrap();
    run.command(&set("alice-self", json!({"a": [1, 2, 3]}), None)).unwrap();
    let before = run.kernel().state().entity_records.clone();
    let seq = run.command(&Command::Observe { participant: "alice-self".into(), only: None }).unwrap().seq;
    // Too much in one section, or too much with what already stands: refused, never logged, nothing changed.
    let big: Vec<i64> = (0..200).collect();
    assert!(run.command(&set("alice-self", json!({"b": big}), None)).is_err());
    let r = run.command(&Command::Observe { participant: "alice-self".into(), only: None }).unwrap();
    assert_eq!(r.seq, seq + 2, "the refused change left no entry in the log");
    assert_eq!(run.kernel().state().entity_records, before);
    // More sections than a record has.
    let many: BTreeMap<String, Value> = (0..30).map(|i| (format!("s{i}"), json!(1))).collect();
    assert!(run.command(&Command::EntityRecord { participant: "alice-self".into(), set: many, because: None }).is_err());
    // Whole numbers only, as all opaque data.
    assert!(run.command(&set("alice-self", json!({"a": 1.5}), None)).is_err());
}

#[test]
fn only_a_code_mind_sets_a_record_and_only_its_own() {
    let mut run = Run::start(riverbend(), "record-who", Vec::new(), None).unwrap();
    // A participant a model runs has no way to write who it is.
    let e = run.command(&set("mayor-system", json!({"agency": {"now": 10000}}), None)).unwrap_err();
    assert!(e.to_string().contains("not run by code"), "{e}");
    // A system has no record of its own.
    assert!(run.command(&set("finance-system", json!({"agency": {"now": 1}}), None)).is_err());
    // The same holds of a person a model runs.
    let mut cfg = riverbend();
    let alice = cfg["participants"].as_array_mut().unwrap().iter_mut().find(|p| p["id"] == "alice-self").unwrap();
    alice["controller"] = json!({"type": "llm", "impl": "mock", "model": "mock"});
    let mut run2 = Run::start(cfg, "record-llm", Vec::new(), None).unwrap();
    assert!(run2.command(&set("alice-self", json!({"agency": {"now": 10000}}), None)).is_err());
    // The command names no entity: bob's sets bob's, and alice's is untouched.
    run.command(&set("bob-self", json!({"agency": {"now": 1}}), None)).unwrap();
    assert!(run.kernel().state().entity_records.contains_key("bob"));
    assert!(!run.kernel().state().entity_records.contains_key("alice"));
}

#[test]
fn only_the_entity_is_shown_its_record() {
    let mut cfg = riverbend();
    for p in cfg["participants"].as_array_mut().unwrap() {
        if p["id"] == "alice-self" || p["id"] == "bob-self" {
            p["channels"].as_array_mut().unwrap().push(json!({"id": "self", "kind": "own_record"}));
        }
    }
    let mut run = Run::start(cfg, "record-shown", Vec::new(), None).unwrap();
    run.command(&set("alice-self", json!({"agency": {"now": 7}}), None)).unwrap();
    let look = |run: &mut Run<Vec<u8>>, who: &str| run.command(&Command::Observe { participant: who.into(), only: None }).unwrap().observation.unwrap();
    // Alice sees hers; Bob, through the same kind of channel, sees nothing (he has none), and never Alice's.
    match &look(&mut run, "alice-self").channels["self"] {
        ChannelData::OwnRecord { record: Some(r) } => assert_eq!((r.n, serde_json::to_value(&r.sections).unwrap()), (1, json!({"agency": {"now": 7}}))),
        other => panic!("{other:?}"),
    }
    assert_eq!(look(&mut run, "bob-self").channels["self"], ChannelData::OwnRecord { record: None });
    // Unchanged since her last look: nothing new. Changed: shown again.
    assert_eq!(look(&mut run, "alice-self").channels["self"], ChannelData::OwnRecord { record: None });
    run.command(&set("alice-self", json!({"agency": {"now": 8}}), None)).unwrap();
    assert!(matches!(&look(&mut run, "alice-self").channels["self"], ChannelData::OwnRecord { record: Some(r) } if r.n == 2));
    // Nobody else's observation holds any of it, whatever their channels.
    for who in ["bob-self", "carol-self", "mayor-system", "bank-payments-system"] {
        let obs = serde_json::to_string(&look(&mut run, who)).unwrap();
        assert!(!obs.contains("\"agency\""), "{who} was shown another's record");
    }
}
