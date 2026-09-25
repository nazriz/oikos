//! The kernel speaks the contracts exactly.
//!   1. Contract examples deserialize into the kernel's types and serialize
//!      back to the same canonical JSON (field names and shapes match).
//!   2. Everything the kernel emits (every log entry, every observation)
//!      validates against the JSON Schemas in contracts/.

mod common;

use common::*;
use proptest::prelude::*;
use serde_json::{json, Value};
use std::path::Path;
use terrarium_kernel::blocks::Block;
use terrarium_kernel::canon::canonical_value;
use terrarium_kernel::events::Event;
use terrarium_kernel::kernel::Command;
use terrarium_kernel::run::{Header, Run};

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
        terrarium_kernel::config::load(v).unwrap_or_else(|e| panic!("{name}: {e}"));
    }
    for (name, v) in examples("block") {
        round_trips::<Block>(&name, &v);
    }
    for (name, v) in examples("seat-action") {
        if v["type"] == "act" {
            round_trips::<Vec<Block>>(&name, &v["blocks"]);
        }
    }
    for (name, v) in examples("log-entry") {
        round_trips::<terrarium_kernel::log::Entry>(&name, &v);
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
    let files = ["common", "blocks", "world-config", "seat-api", "log"];
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
        entry: build(json!({"$schema": "https://json-schema.org/draft/2020-12/schema", "$ref": "urn:terrarium:contracts:0.1:log"})),
        observation: build(
            json!({"$schema": "https://json-schema.org/draft/2020-12/schema", "$ref": "urn:terrarium:contracts:0.1:seat-api#/$defs/Observation"}),
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

fn check_outputs(config: Value, seats: &[&str], ops: &[Op], s: &Schemas) -> Result<(), TestCaseError> {
    let mut run = Run::start(config, "conformance", Vec::new(), None).unwrap();
    for op in ops {
        if let Some(cmd) = concretize(&run, op) {
            let Some(resp) = step(&mut run, &cmd) else { continue };
            if let Some(o) = resp.observation {
                assert_valid(&s.observation, &serde_json::to_value(&o).unwrap(), "observation")?;
            }
        }
    }
    for seat in seats {
        let o = run.command(&Command::Observe { seat: seat.to_string() }).unwrap().observation.unwrap();
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
        S.with(|s| check_outputs(world(&permissive()), &SEATS, &ops, s))?;
    }
}

#[test]
fn riverbend_outputs_validate_against_the_contracts() {
    let s = schemas();
    let ops = vec![
        Op::Observe { seat: 0 },
        Op::Act {
            seat: 0,
            blocks: vec![
                B::Create { founder: 1, controller: None, bind: true },
                B::Transfer { from: 1, to: 0, amount: 4_000_000, to_ref: true },
            ],
        },
        Op::Act { seat: 2, blocks: vec![B::Zoning { parcels: vec![5], allow: vec![0] }] },
        Op::Advance { ticks: 1000 },
        Op::Observe { seat: 1 },
    ];
    check_outputs(riverbend(), &["mayor", "council-seat", "developer"], &ops, &s).unwrap();
}
