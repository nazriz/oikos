//! clinic.practice: a clinic's practice manager (participants/src/behaviour/health.ts; docs/behaviour/health.md).
//! STUB: lane A1's health part fills it.

use crate::{Actor, Ctx, Kind};
use serde_json::Value;

pub struct Practice;

const MANIFEST: &str = include_str!("../../../../../participants/manifests/clinic.practice.json");

impl Kind for Practice {
    fn name(&self) -> &'static str {
        "clinic.practice"
    }
    fn version(&self) -> &'static str {
        "0.3.1"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/health.md"
    }
    fn manifest(&self) -> Value {
        serde_json::from_str(MANIFEST).unwrap_or(Value::Null)
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        crate::DAY
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        crate::stub::Idle.create(ctx)
    }
    fn restore(&self, ctx: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        crate::stub::Idle.restore(ctx, saved)
    }
}
