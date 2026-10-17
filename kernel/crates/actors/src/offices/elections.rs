//! city.electoral_office: NOT YET PORTED (stub). Replace this file with the port of the TS module (docs/port-guide.md, section 3).

use crate::{Actor, Ctx, Kind};
use serde_json::{json, Value};

pub struct ElectoralOffice;
impl Kind for ElectoralOffice {
    fn name(&self) -> &'static str { "city.electoral_office" }
    fn version(&self) -> &'static str { "0.0.0" }
    fn doc(&self) -> &'static str { "" }
    fn manifest(&self) -> Value { json!({ "name": "city.electoral_office" }) }
    fn cadence(&self, _: &Ctx) -> i64 { 86_400 }
    fn create(&self, _: &Ctx) -> Result<Box<dyn Actor>, String> { Err("city.electoral_office: not yet ported".into()) }
    fn restore(&self, _: &Ctx, _: Value) -> Result<Box<dyn Actor>, String> { Err("city.electoral_office: not yet ported".into()) }
}
