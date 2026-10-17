//! office.desk: NOT YET PORTED (stub). Replace this file with the port of the TS module (docs/port-guide.md, section 3).

use crate::{Actor, Ctx, Kind};
use serde_json::{json, Value};

pub struct Desk;
impl Kind for Desk {
    fn name(&self) -> &'static str { "office.desk" }
    fn version(&self) -> &'static str { "0.0.0" }
    fn doc(&self) -> &'static str { "" }
    fn manifest(&self) -> Value { json!({ "name": "office.desk" }) }
    fn cadence(&self, _: &Ctx) -> i64 { 86_400 }
    fn create(&self, _: &Ctx) -> Result<Box<dyn Actor>, String> { Err("office.desk: not yet ported".into()) }
    fn restore(&self, _: &Ctx, _: Value) -> Result<Box<dyn Actor>, String> { Err("office.desk: not yet ported".into()) }
}
