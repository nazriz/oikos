//! What the census and support kinds share: the manifest a kind states, read from the copy of the TS manifest kept
//! beside the code (`manifests/`), and a few small rules of reading a record as TS did.
//!
//! The manifests are copies of participants/manifests/<name>.json, which the TS generated from its modules; the Rust
//! kinds' manifests must equal them in every key (engine.rs, `the_ported_manifests_are_the_ts_ones`). Until the
//! cut-over the TS file is the check; after it, these are the source.

use crate::common::{data, Answering, Fields};
use crate::steps::{Plan, Stepper};
use crate::Actor;
use oikos_rules::forms::Answers;
use oikos_sight::Record;
use serde_json::Value;

/// A manifest from its JSON text (a fault in the copy is a fault in the build: it is read once in a test).
pub fn manifest(text: &str, office: &str, acts: &str) -> Value {
    let mut m: Value = serde_json::from_str(text).expect("a kind's manifest is JSON");
    // (How the office answers a letter is in the TS module but not in its generated manifest: stated here, as weather does.)
    m["answers"] = serde_json::json!({ "office": office, "acts": acts });
    m
}

/// A plan run as an actor that acknowledges the letters it is sent, as common.ts `answering` wraps every office whose
/// module says how it answers (`answers` in its manifest, no standing report): the plan never sees that a letter was
/// answered. The kind's manifest says how.
pub fn answering<P: Plan + 'static>(manifest: &Value, plan: P) -> Result<Box<dyn Actor>, String> {
    Ok(Box::new(Answering::new(Stepper::new(plan), answers_of(manifest)?)))
}

/// An actor made by `answering`, as `save` left it.
pub fn restore_answering<P: Plan + 'static>(manifest: &Value, saved: Value) -> Result<Box<dyn Actor>, String> {
    let inner = Stepper::<P>::restore(saved.get("inner").cloned().ok_or("a saved office has its inner part")?)?;
    Ok(Box::new(Answering::restore(inner, answers_of(manifest)?, &saved)?))
}

fn answers_of(manifest: &Value) -> Result<Answers, String> {
    serde_json::from_value(manifest.get("answers").cloned().unwrap_or(Value::Null)).map_err(|e| format!("a manifest's answers: {e}"))
}

/// Whole-number division rounded half up (JavaScript's `Math.round` of a ratio, for a non-negative numerator).
pub fn round_div(n: i64, d: i64) -> i64 {
    (2 * n + d).div_euclid(2 * d)
}

/// A record's `data.<key>` as a string.
pub fn data_s<'a>(r: &'a Record, key: &str) -> Option<&'a str> {
    data(r).s(key)
}

/// Records in the order they were made, ties in the order they were filed (`rec.9` before `rec.10`).
pub fn by_time<'a>(mut v: Vec<&'a std::sync::Arc<Record>>) -> Vec<&'a std::sync::Arc<Record>> {
    v.sort_by(|a, b| a.at.cmp(&b.at).then_with(|| crate::common::filed_before(&a.id, &b.id)));
    v
}

/// The test rig: a kind driven through the engine's own calls without an engine, over hand-built pictures.
#[cfg(test)]
pub mod rig {
    use super::*;
    use crate::{Action, Actor, Ctx, Cx, Draws, Kind, Picture, WorldInfo};
    use oikos_sight::calls::{Program, Value as Arg};
    use oikos_sight::{Seen, Outcome};
    use serde_json::json;
    use std::collections::BTreeMap;
    use std::sync::Arc;

    pub fn rec(v: Value) -> Arc<Record> {
        Arc::new(serde_json::from_value(v).expect("a record"))
    }

    /// A public statement.
    pub fn st(id: &str, at: i64, kind: &str, speaks_for: &str, data: Value) -> Arc<Record> {
        rec(json!({ "id": id, "record": "statement", "author": format!("p.{speaks_for}"), "speaks_for": speaks_for, "at": at, "visible_to": "public", "kind": kind, "text": kind, "data": data }))
    }
    /// A statement addressed to some.
    pub fn st_to(id: &str, at: i64, kind: &str, speaks_for: &str, to: &[&str], data: Value) -> Arc<Record> {
        rec(json!({ "id": id, "record": "statement", "author": format!("p.{speaks_for}"), "speaks_for": speaks_for, "at": at, "visible_to": "public", "kind": kind, "text": kind, "data": data, "addressed_to": to }))
    }

    /// What one statement in a program says.
    #[derive(Debug, Clone)]
    pub struct Said {
        pub kind: String,
        pub text: String,
        pub data: Value,
        pub to: Vec<String>,
        pub basis: Option<String>,
    }

    pub fn world(currency: bool) -> Arc<WorldInfo> {
        let mut w = WorldInfo { tick: 60, run_end: 365 * 86_400, ..Default::default() };
        if currency {
            w.currency = Some(oikos_sight::calls::Currency { code: "XTS".into(), minor_units: 2, symbol: Some("$".into()), ..Default::default() });
        }
        Arc::new(w)
    }

    pub struct Rig {
        pub ctx: Ctx,
        pub actor: Box<dyn Actor>,
        pub kind: &'static dyn Kind,
        draws: Draws,
        pub acts: u64,
        pub seed: u64,
    }

    impl Rig {
        pub fn new(kind: &'static dyn Kind, entity: &str, params: Value) -> Rig {
            Rig::build(kind, entity, None, params, world(true))
        }

        pub fn build(kind: &'static dyn Kind, entity: &str, position: Option<&str>, params: Value, world: Arc<WorldInfo>) -> Rig {
            let ctx = Ctx {
                participant: format!("{entity}-system"),
                performer: Default::default(),
                entity: entity.into(),
                position: position.map(String::from),
                params: params.as_object().cloned().unwrap_or_default().into(),
                world,
            };
            let actor = kind.create(&ctx).expect("created");
            Rig { ctx, actor, kind, draws: Draws::new("p", "self"), acts: 0, seed: 7 }
        }

        pub fn picture(t: i64, channels: Vec<(&str, Seen)>, outcomes: Vec<Outcome>, woke_for: &str) -> Picture {
            Picture {
                participant: "p".into(),
                t,
                status: oikos_sight::ParticipantStatus::Active,
                entity: "e".into(),
                as_position: None,
                body: None,
                positions: vec![],
                outcomes,
                inbox: vec![],
                channels: channels.into_iter().map(|(k, v)| (oikos_sight::Id::new(k), v)).collect::<BTreeMap<_, _>>(),
                asking: vec![],
                readings: BTreeMap::new(),
                woke_for: woke_for.into(),
                since: 0,
            }
        }

        /// One wake: the actor steps until it waits, each act it makes counted as done. Returns every action it took.
        pub fn wake(&mut self, t: i64, channels: Vec<(&str, Seen)>) -> Vec<Action> {
            let mut out = vec![];
            let mut first = true;
            for _ in 0..200 {
                let pic = Self::picture(t, if first { channels.clone() } else { vec![] }, vec![], if first { "cadence" } else { "done" });
                let mut cx = Cx::new(t, &self.ctx, &mut self.draws, self.seed, vec![]);
                let a = self.actor.step(&pic, &mut cx);
                first = false;
                match &a {
                    Action::Call { .. } => {
                        self.acts += 1;
                        self.actor.sent(&format!("act.{}", self.acts));
                        out.push(a);
                    }
                    Action::Look { .. } => {
                        out.push(a);
                        break;
                    }
                    _ => {
                        out.push(a);
                        break;
                    }
                }
            }
            out
        }

        /// A wake that gives the actor records on a channel.
        pub fn wake_records(&mut self, t: i64, channel: &str, records: Vec<Arc<Record>>) -> Vec<Action> {
            self.wake(t, vec![(channel, Seen::Records { records, search: false })])
        }

        /// One step of the actor over a picture the test built (outcomes and all).
        pub fn step(&mut self, pic: &Picture) -> Action {
            let mut cx = Cx::new(pic.t, &self.ctx, &mut self.draws, self.seed, vec![]);
            let a = self.actor.step(pic, &mut cx);
            if matches!(a, Action::Call { .. }) {
                self.acts += 1;
                self.actor.sent(&format!("act.{}", self.acts));
            }
            a
        }

        /// Saves the actor and brings it back; the copy must save to the same JSON.
        pub fn save_and_restore(&mut self) {
            let saved = self.actor.save().expect("saves");
            let back = self.kind.restore(&self.ctx, saved.clone()).expect("restores");
            assert_eq!(back.save().expect("saves again"), saved, "a restored actor saves as it was");
            self.actor = back;
        }
    }

    /// Every statement in the calls among the actions.
    pub fn statements(actions: &[Action]) -> Vec<Said> {
        let mut v = vec![];
        for a in actions {
            let Action::Call { program: Program::Lines(lines), .. } = a else { continue };
            for l in lines {
                if l.call.fn_ != "statement" {
                    continue;
                }
                let s = |k: &str| match l.call.get(k) {
                    Some(Arg::Id(x)) | Some(Arg::Text(x)) => Some(x.clone()),
                    _ => None,
                };
                let j = |k: &str| match l.call.get(k) {
                    Some(Arg::Json(x)) => x.clone(),
                    _ => Value::Null,
                };
                v.push(Said {
                    kind: s("kind").unwrap_or_default(),
                    text: s("text").unwrap_or_default(),
                    data: j("data"),
                    to: j("to").as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default(),
                    basis: s("basis"),
                });
            }
        }
        v
    }

    /// Every payment in the calls among the actions: (to, amount text, from, for).
    pub fn payments(actions: &[Action]) -> Vec<(String, String, Option<String>, Option<String>)> {
        let mut v = vec![];
        for a in actions {
            let Action::Call { program: Program::Lines(lines), .. } = a else { continue };
            for l in lines {
                if l.call.fn_ != "money" {
                    continue;
                }
                let s = |k: &str| match l.call.get(k) {
                    Some(Arg::Id(x)) | Some(Arg::Text(x)) => Some(x.clone()),
                    _ => None,
                };
                v.push((s("to").unwrap_or_default(), s("amount").unwrap_or_default(), s("from"), s("for")));
            }
        }
        v
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every kind this lane ported is registered under its name and states a manifest of its own name and version (that
    /// it equals the TS file's is held by kernel/tests/c2_boundary.rs, which may read files).
    #[test]
    fn the_ported_kinds_are_registered_with_their_manifests() {
        for name in ["transfers", "funding", "grants", "statistics", "valuer", "disposal", "migration"] {
            let kind = crate::registry::find(&format!("world.{name}")).unwrap_or_else(|| panic!("world.{name} is registered"));
            let rust = kind.manifest();
            assert_eq!(rust["name"], kind.name());
            assert_eq!(rust["version"], kind.version());
            assert_eq!(rust["doc"], kind.doc());
        }
    }

    #[test]
    fn half_up_division() {
        assert_eq!(round_div(5, 2), 3);
        assert_eq!(round_div(4, 3), 1);
        assert_eq!(round_div(7, 3), 2);
        assert_eq!(round_div(0, 5), 0);
    }
}
