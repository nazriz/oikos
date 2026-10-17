//! police.station: NOT YET PORTED (stub). Replace this file with the port of the TS module (docs/port-guide.md, section 3).

use crate::{Actor, Ctx, Kind};
use serde_json::{json, Value};

pub struct Station;
impl Kind for Station {
    fn name(&self) -> &'static str { "police.station" }
    fn version(&self) -> &'static str { "0.0.0" }
    fn doc(&self) -> &'static str { "" }
    fn manifest(&self) -> Value { json!({ "name": "police.station" }) }
    fn cadence(&self, _: &Ctx) -> i64 { 86_400 }
    fn create(&self, _: &Ctx) -> Result<Box<dyn Actor>, String> { Err("police.station: not yet ported".into()) }
    fn restore(&self, _: &Ctx, _: Value) -> Result<Box<dyn Actor>, String> { Err("police.station: not yet ported".into()) }
}
