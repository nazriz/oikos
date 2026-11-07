//! A person who lives outside the world (docs/behaviour/staffing.md, "A seat in an office of the outside world"; risk WM-14):
//! a body the town does not hold (`present: false`), whose life there is not simulated. Their own participant does nothing in
//! the world; what they do here is the post they hold from outside it (`holds_abroad`), which a seat sharing their body acts
//! in, at a person's speed and in a person's working day. Not a stand-in: their life is the boundary's, as the outside
//! world's markets and agencies are.

use crate::{Action, Actor, Ctx, Cx, Kind, Picture, DAY};
use serde_json::{json, Value};

pub struct NonResident;

impl Kind for NonResident {
    fn name(&self) -> &'static str {
        "world.nonresident"
    }
    fn version(&self) -> &'static str {
        "0.1.0"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/staffing.md"
    }
    fn manifest(&self) -> Value {
        json!({ "name": "world.nonresident", "version": "0.1.0", "doc": "docs/behaviour/staffing.md", "params": {}, "perceives": [], "state": "none" })
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        30 * DAY
    }
    fn create(&self, _: &Ctx) -> Result<Box<dyn Actor>, String> {
        Ok(Box::new(Abroad))
    }
    fn restore(&self, _: &Ctx, _: Value) -> Result<Box<dyn Actor>, String> {
        Ok(Box::new(Abroad))
    }
}

/// Their life is elsewhere: nothing to do in the world.
struct Abroad;
impl Actor for Abroad {
    fn step(&mut self, _: &Picture, _: &mut Cx) -> Action {
        Action::wait()
    }
    fn save(&self) -> Result<Value, String> {
        Ok(Value::Null)
    }
}
