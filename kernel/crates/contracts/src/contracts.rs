//! The contract schemas, compiled into the kernel. Every input the kernel
//! accepts (world config, command, annotation) is validated against them
//! before it can reach the log, so the log can never contain an entry that
//! violates the contract, whatever the orchestrator sends.

use serde_json::{json, Value};
use std::sync::OnceLock;

const SCHEMAS: [&str; 6] = [
    include_str!("../../../../contracts/common.schema.json"),
    include_str!("../../../../contracts/blocks.schema.json"),
    include_str!("../../../../contracts/records.schema.json"),
    include_str!("../../../../contracts/world-config.schema.json"),
    include_str!("../../../../contracts/participant-api.schema.json"),
    include_str!("../../../../contracts/log.schema.json"),
];

pub struct Contracts {
    pub config: jsonschema::Validator,
    pub command: jsonschema::Validator,
    pub annotation: jsonschema::Validator,
}

fn validator(reference: &str) -> jsonschema::Validator {
    let mut opts = jsonschema::options();
    for text in SCHEMAS {
        let schema: Value = serde_json::from_str(text).expect("contract schemas are valid JSON");
        let id = schema["$id"].as_str().expect("contract schemas have an $id").to_string();
        opts = opts.with_resource(id, jsonschema::Resource::from_contents(schema).expect("contract schema is a resource"));
    }
    opts.build(&json!({ "$schema": "https://json-schema.org/draft/2020-12/schema", "$ref": reference })).expect("contract schemas compile")
}

pub fn contracts() -> &'static Contracts {
    static C: OnceLock<Contracts> = OnceLock::new();
    C.get_or_init(|| Contracts {
        config: validator("urn:oikos:contracts:0.8:world-config"),
        command: validator("urn:oikos:contracts:0.8:log#/$defs/Command"),
        annotation: validator("urn:oikos:contracts:0.8:log#/$defs/Annotation"),
    })
}

/// Ok, or the first few violations as one message.
pub fn check(v: &jsonschema::Validator, instance: &Value) -> Result<(), String> {
    let errors: Vec<String> = v
        .iter_errors(instance)
        .take(3)
        .map(|e| {
            let at = e.instance_path.to_string();
            format!("{}{}", if at.is_empty() { String::new() } else { format!("{at}: ") }, e)
        })
        .collect();
    if errors.is_empty() {
        Ok(())
    } else {
        Err(format!("violates the contract: {}", errors.join("; ")))
    }
}
