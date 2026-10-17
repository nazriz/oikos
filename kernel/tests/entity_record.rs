//! An entity's own record (docs/design/ai-citizens.md 10d): held by the kernel, written only by it, bounded, chained,
//! shown to nobody but the entity, and set only by the platform's bookkeeping for that entity, named in the world's
//! config (never by anything a model can reach).

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
    Command::EntityRecord { participant: participant.into(), entity: None, set: serde_json::from_value::<BTreeMap<String, Value>>(sections).unwrap(), because }
}

fn set_of(participant: &str, entity: &str, sections: Value) -> Command {
    Command::EntityRecord { participant: participant.into(), entity: Some(entity.into()), set: serde_json::from_value::<BTreeMap<String, Value>>(sections).unwrap(), because: None }
}

fn position_mut<'a>(cfg: &'a mut Value, id: &str) -> &'a mut Value {
    cfg["positions"].as_array_mut().unwrap().iter_mut().find(|p| p["id"] == id).unwrap()
}

fn keeper_of(r: &oikos_kernel::run::Response) -> Option<String> {
    match &r.events[0].body {
        EventBody::EntityRecorded { keeper, .. } => keeper.clone(),
        other => panic!("expected entity_recorded, got {other:?}"),
    }
}

fn recorded(r: &oikos_kernel::run::Response) -> (String, u64, String, String) {
    match &r.events[0].body {
        EventBody::EntityRecorded { entity, n, chain, digest, .. } => (entity.clone(), *n, chain.clone(), digest.clone()),
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
    assert!(run.command(&Command::EntityRecord { participant: "alice-self".into(), entity: None, set: many, because: None }).is_err());
    // Whole numbers only, as all opaque data.
    assert!(run.command(&set("alice-self", json!({"a": 1.5}), None)).is_err());
}

#[test]
fn only_a_code_mind_sets_a_record_and_only_its_own() {
    let mut run = Run::start(riverbend(), "record-who", Vec::new(), None).unwrap();
    // A participant a model runs has no way to write who it is.
    let e = run.command(&set("mayor-system", json!({"agency": {"now": 10000}}), None)).unwrap_err();
    assert!(e.to_string().contains("not a person"), "{e}");
    // A system has no record of its own.
    assert!(run.command(&set("finance-system", json!({"agency": {"now": 1}}), None)).is_err());
    // The same holds of a person a model runs.
    let mut cfg = riverbend();
    let alice = cfg["participants"].as_array_mut().unwrap().iter_mut().find(|p| p["id"] == "alice-self").unwrap();
    alice["controller"] = json!({"type": "llm", "impl": "mock", "model": "mock"});
    let mut run2 = Run::start(cfg, "record-llm", Vec::new(), None).unwrap();
    let e = run2.command(&set("alice-self", json!({"agency": {"now": 10000}}), None)).unwrap_err();
    assert!(e.to_string().contains("alice has no bookkeeping named for its record: nothing can set it"), "{e}");
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

#[test]
fn a_model_beside_its_bookkeeping_may_have_its_record_kept() {
    // A participant a model runs, with a bookkeeping named for its person: accepted, and the event says whose.
    let mut cfg = riverbend();
    let alice = cfg["participants"].as_array_mut().unwrap().iter_mut().find(|p| p["id"] == "alice-self").unwrap();
    alice["controller"] = json!({"type": "llm", "impl": "mock", "model": "mock"});
    alice["record_keeper"] = json!("citizen.default");
    let mut run = Run::start(cfg, "record-model-kept", Vec::new(), None).unwrap();
    let r = run.command(&set("alice-self", json!({"agency": {"now": 10000}}), None)).unwrap();
    assert_eq!(keeper_of(&r).as_deref(), Some("citizen.default"));
    // A code citizen's keeper is its own module, unless the world names another.
    let mut run = Run::start(riverbend(), "record-code-kept", Vec::new(), None).unwrap();
    let r = run.command(&set("bob-self", json!({"agency": {"now": 1}}), None)).unwrap();
    assert_eq!(keeper_of(&r).as_deref(), Some("citizen.default"));
}

#[test]
fn an_organisations_record_is_kept_through_its_keeping_post() {
    let mut cfg = riverbend();
    position_mut(&mut cfg, "finance")["keeps_record"] = json!(true);
    let mut run = Run::start(cfg, "record-org", Vec::new(), None).unwrap();
    // Through the keeping post: accepted, and the log names the bookkeeping.
    let r = run.command(&set_of("finance-system", "city", json!({"books": {"open": 3}}))).unwrap();
    let (entity, n, ..) = recorded(&r);
    assert_eq!((entity.as_str(), n), ("city", 1));
    assert_eq!(keeper_of(&r).as_deref(), Some("city.finance_officer"));
    assert_eq!(serde_json::to_value(&run.kernel().state().entity_records["city"].sections).unwrap(), json!({"books": {"open": 3}}));
    let before = run.kernel().state().entity_records.clone();
    let seq = run.command(&Command::Observe { participant: "alice-self".into(), only: None }).unwrap().seq;
    // Through another post of the same organisation: refused.
    assert!(run.command(&set_of("planning-system", "city", json!({"books": {"open": 4}}))).is_err());
    // By one who holds no post of it: refused.
    assert!(run.command(&set_of("bank-payments-system", "city", json!({"books": {"open": 4}}))).is_err());
    assert!(run.command(&set_of("alice-self", "city", json!({"books": {"open": 4}}))).is_err());
    // Naming a person other than oneself: refused, whoever asks; so is one's own through the other way round.
    assert!(run.command(&set_of("finance-system", "alice", json!({"agency": {"now": 1}}))).is_err());
    assert!(run.command(&set_of("alice-self", "bob", json!({"agency": {"now": 1}}))).is_err());
    // An organisation none of whose posts keeps its record, and a thing that is no entity.
    let e = run.command(&set_of("bank-payments-system", "bank", json!({"books": {"open": 1}}))).unwrap_err();
    assert!(e.to_string().contains("bank has no bookkeeping named for its record: nothing can set it"), "{e}");
    assert!(run.command(&set_of("finance-system", "nowhere", json!({"books": {"open": 1}}))).is_err());
    // Nothing refused changed the world, and nothing refused was logged.
    assert_eq!(run.kernel().state().entity_records["city"], before["city"]);
    let seq2 = run.command(&Command::Observe { participant: "alice-self".into(), only: None }).unwrap().seq;
    assert_eq!(seq2, seq + 2, "the refusals left no entry in the log");
    // Naming one's own person is the same as naming none.
    assert!(run.command(&set_of("alice-self", "alice", json!({"agency": {"now": 1}}))).is_ok());
    run.finish("completed", None).unwrap();
}

#[test]
fn an_organisation_has_at_most_one_keeping_post_and_it_needs_a_module() {
    let mut cfg = riverbend();
    position_mut(&mut cfg, "finance")["keeps_record"] = json!(true);
    position_mut(&mut cfg, "planning")["keeps_record"] = json!(true);
    let e = Run::start(cfg, "record-two", Vec::new(), None).err().expect("two keeping posts are refused at load");
    assert!(e.to_string().contains("both keep the record of city"), "{e}");
    let mut cfg = riverbend();
    position_mut(&mut cfg, "mayor")["keeps_record"] = json!(true);
    let e = Run::start(cfg, "record-no-module", Vec::new(), None).err().expect("a keeping post needs a module");
    assert!(e.to_string().contains("keeps_record needs a role_module with a code"), "{e}");
}

#[test]
fn a_config_with_none_of_the_new_fields_stands_as_before() {
    // (Until 2026-10-17 the fixture's initial state hash was pinned here and re-taken with every change to the state;
    // what the test stands for is the comparison below. docs/testing.md, "Change detectors".)
    let run = Run::start(riverbend(), "record", Vec::new(), None).unwrap();
    // The new fields change nothing the kernel hashes of the world, and dials are opaque to it.
    let mut cfg = riverbend();
    cfg["dials"] = json!({"initiative_bps": 2500, "other": [1, 2]});
    position_mut(&mut cfg, "finance")["keeps_record"] = json!(true);
    let run2 = Run::start(cfg, "record", Vec::new(), None).unwrap();
    assert_eq!(run2.kernel().state_hash().unwrap(), run.kernel().state_hash().unwrap());
}
