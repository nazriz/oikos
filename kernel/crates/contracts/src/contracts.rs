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
    /// One of a config's participants (its `participants` items), for a config read participant by participant
    /// (`config::load_from`): the config's own schema checks each with this same definition.
    pub participant: jsonschema::Validator,
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
        participant: validator("urn:oikos:contracts:0.8:world-config#/$defs/Participant"),
        command: validator("urn:oikos:contracts:0.8:log#/$defs/Command"),
        annotation: validator("urn:oikos:contracts:0.8:log#/$defs/Annotation"),
    })
}

/// Ok, or the first few violations as one message.
pub fn check(v: &jsonschema::Validator, instance: &Value) -> Result<(), String> {
    check_at(v, instance, "")
}

/// `check`, of a value that stands at `at` within a larger one (a JSON pointer): its violations are told at their place
/// in the whole.
pub fn check_at(v: &jsonschema::Validator, instance: &Value, at_whole: &str) -> Result<(), String> {
    // (Nearly everything checked is valid, and saying only that is much the cheaper question: the violations are
    // looked for when there are some.)
    if v.is_valid(instance) {
        return Ok(());
    }
    let errors: Vec<String> = v
        .iter_errors(instance)
        .take(3)
        .map(|e| {
            let at = format!("{at_whole}{}", e.instance_path);
            format!("{}{}", if at.is_empty() { String::new() } else { format!("{at}: ") }, e)
        })
        .collect();
    if errors.is_empty() {
        Ok(())
    } else {
        Err(format!("violates the contract: {}", errors.join("; ")))
    }
}

/// The largest integer every JSON consumer reads exactly (common.schema.json `SafeInt`).
const SAFE_INT: i64 = 9_007_199_254_740_991;

/// Whether a value is the contract's `Opaque` (common.schema.json): null, a boolean, a safe integer, a string of at most
/// 1,048,576 characters, or arrays and objects of those, each object's keys matching `^[A-Za-z_][A-Za-z0-9_.-]{0,63}$`.
/// `true` only where the schema says valid; `false` where it isn't, or where this is not sure (the schema decides then).
pub fn opaque(v: &Value) -> bool {
    match v {
        Value::Null | Value::Bool(_) => true,
        Value::Number(n) => n.as_i64().is_some_and(|i| (-SAFE_INT..=SAFE_INT).contains(&i)),
        // (Bytes are at least characters: a string this short in bytes is short enough.)
        Value::String(s) => s.len() <= 1_048_576,
        Value::Array(a) => a.iter().all(opaque),
        Value::Object(m) => m.iter().all(|(k, x)| key(k) && opaque(x)),
    }
}

/// `^[A-Za-z_][A-Za-z0-9_.-]{0,63}$`, the `Opaque` object's property names.
fn key(k: &str) -> bool {
    let b = k.as_bytes();
    !b.is_empty() && b.len() <= 64 && (b[0].is_ascii_alphabetic() || b[0] == b'_') && b[1..].iter().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'.' | b'-'))
}

/// The kinds of annotation whose shape is `{annotation, subject, data}` (log.schema.json, Annotation's fourth branch).
const SUBJECT_DATA: [&str; 10] = ["transcript", "model_call_failed", "translation_failure", "debrief", "orchestrator", "note", "observation", "decision", "outcome", "audit"];

/// Whether the annotation `{annotation: kind, subject, data}` would be `plain_annotation`, asked of its parts (for one
/// written straight from them, without the annotation's own value).
pub fn plain_subject_data(kind: &str, subject: &str, data: &Value) -> bool {
    SUBJECT_DATA.contains(&kind) && subject.len() <= 128 && opaque(data)
}

/// Whether an annotation plainly keeps to the contract (`check(&contracts().annotation, ..)` would pass it, and every
/// integer in it is safe): the commonest shape, a subject and its data (decisions, outcomes, notes, observations), with
/// data that is plainly `Opaque`. Every other branch of the Annotation's `oneOf` names other kinds, so one that keeps
/// to the fourth keeps to the contract. `false` says only that the schema must decide.
pub fn plain_annotation(instance: &Value) -> bool {
    let Value::Object(m) = instance else { return false };
    let plain = m.len() == 3
        && m.get("annotation").and_then(Value::as_str).is_some_and(|a| SUBJECT_DATA.contains(&a))
        && m.get("subject").and_then(Value::as_str).is_some_and(|s| s.len() <= 128)
        && m.get("data").is_some_and(opaque);
    debug_assert!(!plain || contracts().annotation.is_valid(instance), "an annotation passed as plainly valid is not: {instance}");
    plain
}
