//! What a participant answers a wake with (contracts/participant-api.schema.json, ParticipantAction), typed.
//!
//! A built-in actor returns one of these from its step; a seat's host sends one as JSON (`Action::from_json`), its
//! translator's drafts already turned into `Act` with their provenance (the host's work, never the engine's).

use crate::calls::{parse_program, program_text, Program};
use oikos_world::blocks::{Block, Id};
use oikos_world::config::LookRequest;
use serde_json::{json, Value};

/// How an act came to be written, as the log records it with the act (contracts: Provenance). A code actor's call is
/// `Call` (the engine fills in the call's text and the resolver); a seat's host says which way its acts came.
#[derive(Debug, Clone, PartialEq)]
pub enum Provenance {
    Direct,
    /// As the host gives it (a translator's draft: its proposal, draft, hash, translator, call and resolver).
    Given(Value),
}

#[derive(Debug, Clone, PartialEq)]
pub enum Action {
    /// Sleep until `until` (absent: the actor's cadence).
    Wait { until: Option<i64> },
    /// Look again, through these channels, at once (the next observation follows in the same moment).
    Look { looks: Vec<LookRequest> },
    /// A call in the call language, resolved by the engine into the actor's own acts.
    Call { program: Program, reasoning: Option<String> },
    /// Blocks, as they are.
    Act { blocks: Vec<Block>, reasoning: Option<String>, by: Vec<Id>, provenance: Provenance },
    /// A letter.
    Message { to: Vec<Id>, text: String, re: Option<Id> },
    /// Leaving the study (D38): only a seat does this.
    OptOut { statement: Option<String> },
}

impl Action {
    pub const fn wait() -> Self {
        Action::Wait { until: None }
    }
    pub const fn wait_until(t: i64) -> Self {
        Action::Wait { until: Some(t) }
    }

    /// The action as the participant API writes it (for a seat, for the log's notes, for tests).
    pub fn to_json(&self) -> Value {
        match self {
            Action::Wait { until: None } => json!({ "type": "wait" }),
            Action::Wait { until: Some(t) } => json!({ "type": "wait", "until": t }),
            Action::Look { looks } => json!({ "type": "look", "looks": looks }),
            Action::Call { program, reasoning } => {
                let mut v = json!({ "type": "call", "call": program_text(program) });
                if let Some(r) = reasoning {
                    v["reasoning"] = json!(r);
                }
                v
            }
            Action::Act { blocks, reasoning, by, .. } => {
                let mut v = json!({ "type": "act", "blocks": blocks });
                if let Some(r) = reasoning {
                    v["reasoning"] = json!(r);
                }
                if !by.is_empty() {
                    v["by"] = json!(by);
                }
                v
            }
            Action::Message { to, text, re } => {
                let mut v = json!({ "type": "message", "to": to, "text": text });
                if let Some(r) = re {
                    v["re"] = json!(r);
                }
                v
            }
            Action::OptOut { statement } => json!({ "type": "opt_out", "statement": statement }),
        }
    }

    /// A seat's action as its host sends it. `provenance` on an `act` is the host's (a confirmed draft's); absent, the
    /// act is direct.
    pub fn from_json(v: &Value) -> Result<Action, String> {
        let s = |k: &str| v.get(k).and_then(Value::as_str).map(String::from);
        let ids = |k: &str| -> Vec<Id> {
            v.get(k).and_then(Value::as_array).map(|a| a.iter().filter_map(|x| x.as_str().map(Id::new)).collect()).unwrap_or_default()
        };
        match v.get("type").and_then(Value::as_str) {
            Some("wait") => Ok(Action::Wait { until: v.get("until").and_then(Value::as_i64) }),
            Some("look") => Ok(Action::Look {
                looks: serde_json::from_value(v.get("looks").cloned().unwrap_or(json!([]))).map_err(|e| format!("bad looks: {e}"))?,
            }),
            Some("call") => Ok(Action::Call {
                program: parse_program(&s("call").ok_or("a call without its text")?).map_err(|e| e.0)?,
                reasoning: s("reasoning"),
            }),
            Some("act") => Ok(Action::Act {
                blocks: serde_json::from_value(v.get("blocks").cloned().unwrap_or(json!([]))).map_err(|e| format!("bad blocks: {e}"))?,
                reasoning: s("reasoning"),
                by: ids("by"),
                provenance: v.get("provenance").cloned().map_or(Provenance::Direct, Provenance::Given),
            }),
            Some("message") => Ok(Action::Message { to: ids("to"), text: s("text").unwrap_or_default(), re: s("re").map(Into::into) }),
            Some("opt_out") => Ok(Action::OptOut { statement: s("statement") }),
            other => Err(format!("not an action the engine takes: {other:?} (a seat's host turns its drafts into acts)")),
        }
    }
}
