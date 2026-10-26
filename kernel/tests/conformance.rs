//! The kernel speaks the contracts exactly.
//!   1. Contract examples deserialize into the kernel's types and serialize
//!      back to the same canonical JSON (field names and shapes match).
//!   2. Everything the kernel emits (every log entry, every observation)
//!      validates against the JSON Schemas in contracts/.

use crate::common;

use common::*;
use proptest::prelude::*;
use serde_json::{json, Value};
use std::path::Path;
use oikos_kernel::blocks::Block;
use oikos_kernel::canon::canonical_value;
use oikos_kernel::events::Event;
use oikos_kernel::kernel::Command;
use oikos_kernel::run::{Header, Run};

fn read_json(p: &Path) -> Value {
    serde_json::from_slice(&std::fs::read(p).unwrap()).unwrap_or_else(|e| panic!("{}: {e}", p.display()))
}

fn examples(kind: &str) -> Vec<(String, Value)> {
    let dir = contracts_dir().join("examples/valid").join(kind);
    let mut v: Vec<_> =
        std::fs::read_dir(&dir).unwrap().map(|e| e.unwrap().path()).filter(|p| p.extension().is_some_and(|x| x == "json")).collect();
    v.sort();
    v.into_iter().map(|p| (p.file_name().unwrap().to_string_lossy().into_owned(), read_json(&p))).collect()
}

fn round_trips<T: serde::de::DeserializeOwned + serde::Serialize>(name: &str, v: &Value) {
    let t: T = serde_json::from_value(v.clone()).unwrap_or_else(|e| panic!("{name}: does not deserialize: {e}"));
    let back = serde_json::to_value(&t).unwrap();
    assert_eq!(canonical_value(&back).unwrap(), canonical_value(v).unwrap(), "{name}: does not round-trip");
}

#[test]
fn contract_examples_round_trip_through_kernel_types() {
    for (name, v) in examples("world-config") {
        oikos_kernel::config::load(v).unwrap_or_else(|e| panic!("{name}: {e}"));
    }
    for (name, v) in examples("block") {
        round_trips::<Block>(&name, &v);
    }
    for (name, v) in examples("record") {
        round_trips::<oikos_kernel::blocks::Record>(&name, &v);
    }
    for (name, v) in examples("participant-action") {
        if v["type"] == "act" {
            round_trips::<Vec<Block>>(&name, &v["blocks"]);
        }
    }
    for (name, v) in examples("log-entry") {
        round_trips::<oikos_kernel::log::Entry>(&name, &v);
        match v["kind"].as_str().unwrap() {
            "command" => round_trips::<Command>(&name, &v["body"]),
            "event" => round_trips::<Event>(&name, &v["body"]),
            "header" => round_trips::<Header>(&name, &v["body"]),
            _ => {}
        }
    }
}

struct Schemas {
    entry: jsonschema::Validator,
    observation: jsonschema::Validator,
}

fn schemas() -> Schemas {
    let files = ["common", "blocks", "records", "world-config", "participant-api", "log"];
    let build = |root: Value| {
        let mut opts = jsonschema::options();
        for f in files {
            let s = read_json(&contracts_dir().join(format!("{f}.schema.json")));
            let id = s["$id"].as_str().unwrap().to_string();
            opts = opts.with_resource(id, jsonschema::Resource::from_contents(s).unwrap());
        }
        opts.build(&root).unwrap()
    };
    Schemas {
        entry: build(json!({"$schema": "https://json-schema.org/draft/2020-12/schema", "$ref": "urn:oikos:contracts:0.8:log"})),
        observation: build(
            json!({"$schema": "https://json-schema.org/draft/2020-12/schema", "$ref": "urn:oikos:contracts:0.8:participant-api#/$defs/Observation"}),
        ),
    }
}

fn assert_valid(v: &jsonschema::Validator, instance: &Value, what: &str) -> Result<(), TestCaseError> {
    let errors: Vec<String> = v.iter_errors(instance).map(|e| format!("{} at {}", e, e.instance_path)).take(5).collect();
    prop_assert!(
        errors.is_empty(),
        "{} violates the contract:\n  {}\n{}",
        what,
        errors.join("\n  "),
        serde_json::to_string(instance).unwrap()
    );
    Ok(())
}

fn check_outputs(
    config: Value,
    participants: &[&str],
    cmds: impl Fn(&Run<Vec<u8>>, usize) -> Option<Option<Command>>,
    s: &Schemas,
) -> Result<(), TestCaseError> {
    let mut run = Run::start(config, "conformance", Vec::new(), None).unwrap();
    let mut i = 0;
    while let Some(next) = cmds(&run, i) {
        i += 1;
        let Some(cmd) = next else { continue };
        let Some(resp) = step(&mut run, &cmd) else { continue };
        if let Some(o) = resp.observation {
            assert_valid(&s.observation, &serde_json::to_value(&o).unwrap(), "observation")?;
        }
    }
    for participant in participants {
        let o = run.command(&Command::Observe { participant: participant.to_string(), only: None }).unwrap().observation.unwrap();
        assert_valid(&s.observation, &serde_json::to_value(&o).unwrap(), "observation")?;
    }
    run.annotate(json!({"annotation": "usage", "purpose": "translator", "subject": "translator", "provider": "p", "model": "m", "input_tokens": 1, "output_tokens": 2, "cost_microusd": 3})).unwrap();
    run.finish("completed", None).unwrap();
    for line in std::str::from_utf8(&run.into_log()).unwrap().lines() {
        let entry: Value = serde_json::from_str(line).unwrap();
        assert_valid(&s.entry, &entry, "log entry")?;
    }
    Ok(())
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 64, ..ProptestConfig::default() })]

    #[test]
    fn kernel_outputs_validate_against_the_contracts(ops in proptest::collection::vec(op_strategy(), 1..50)) {
        thread_local!(static S: Schemas = schemas());
        let participants: Vec<&str> = ACTORS.iter().map(|(p, _, _)| *p).collect();
        S.with(|s| check_outputs(world(&default_params()), &participants, |run, i| ops.get(i).map(|op| concretize(run, op)), s))?;
    }
}

/// The river scenario, scripted, on the Riverbend contract example.
pub fn river_script() -> Vec<Command> {
    let act = |participant: &str, blocks: Value| rb_act(participant, blocks);
    vec![
        Command::Observe { participant: "inspector-system".into(), only: None },
        act(
            "bank-payments",
            json!([{"block": "transfer", "from": "acc-bob", "to": "acc-devco", "amount": "180000", "per_instruction": "so-bob-rent"}]),
        ),
        act(
            "developer",
            json!([{"block": "publish", "kind": "permit_application", "speaks_for": "devco", "addressed_to": ["city"], "text": "Apartments on p12, please.", "data": {"parcel": "p12"}, "ref": "app"}]),
        ),
        act(
            "planning",
            json!([{"block": "publish", "kind": "permit_decision", "speaks_for": "city", "addressed_to": ["devco"], "basis": "law-river", "text": "Refused: river zone.", "data": {"decision": "refused"}}]),
        ),
        act(
            "developer",
            json!([{"block": "propose_agreement", "speaks_for": "devco", "ref": "job", "terms": {"template": "construction", "parties": ["devco", "buildco"], "commitments": [{"who": "buildco", "does": {"outcome": {"structure": {"type": "apartments", "on": "p12"}}}}, {"who": "devco", "does": {"outcome": {"money": {"to": "acc-buildco", "amount": "30000000"}}}}]}},
                                 {"block": "sign_agreement", "agreement": "$job", "as": "devco"}]),
        ),
        act(
            "builder",
            json!([{"block": "construct", "at": "cell.2.1", "structure_type": "house", "materials_at": "s-shop", "ref": "h"}]),
        ),
        Command::Advance { to: 20 * 86_400 },
        Command::Observe { participant: "inspector-system".into(), only: None },
        act(
            "inspector",
            json!([{"block": "record_claim", "position": "right", "holder": "city", "counterparty": "devco", "basis": "law-river", "speaks_for": "city", "about": {"kind": "fine", "amount": "5000000"}}]),
        ),
        act(
            "mayor",
            json!([{"block": "publish", "kind": "ballot", "speaks_for": "city", "text": "Repeal law-river?", "data": {"options": ["yes", "no"]}, "ref": "b"}]),
        ),
        act("alice-self", json!([{"block": "vote", "ballot": "rec.6", "choice": "no", "speaks_for": "alice"}])),
        act("developer", json!([{"block": "vacate", "occupant": "bob", "from": "s-apts"}])),
        act("finance", json!([{"block": "transfer", "from": "acc-city", "to": "acc-devco", "amount": "1"}])),
        Command::Advance { to: 100 * 86_400 },
        Command::Observe { participant: "inspector-system".into(), only: None },
        Command::Observe { participant: "bob-self".into(), only: None },
        Command::OptOut { participant: "mayor-system".into(), statement: "Leaving the study.".into() },
    ]
}

#[test]
fn riverbend_outputs_validate_against_the_contracts() {
    let s = schemas();
    let script = river_script();
    let participants = [
        "mayor-system", "finance-system", "planning-system", "inspector-system", "bank-payments-system", "developer-system", "builder-system", "alice-self", "bob-self", "carol-self",
    ];
    check_outputs(riverbend(), &participants, |_, i| script.get(i).cloned().map(Some), &s).unwrap();
}
