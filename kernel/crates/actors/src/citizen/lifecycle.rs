//! Lifecycle (citizen.ts): births, deaths seen at home and at work, a silent home next door, leaving town, a
//! child's wake, school and care, the daily round (docs/behaviour/households.md, deaths.md, education.md, health.md).
//! STUB: lane A1's lifecycle part fills it.

use super::params::Params;
use super::person::{Person, Todo, Week};
use crate::Cx;
use serde::{Deserialize, Serialize};

/// This part's own memory (fields only this part reads; what several parts read is in `person::State`).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Lifecycle {}

impl Lifecycle {
    pub fn new(_p: &Params, _cx: &mut Cx) -> Self {
        Lifecycle::default()
    }
}

#[allow(unused_variables)]
impl Person {
    pub fn births(&mut self, w: &mut Week) {}
    pub fn see_death_at_home(&mut self, w: &mut Week) {}
    pub fn see_death_at_work(&mut self, w: &mut Week) {}
    pub fn wonder_next_door(&mut self, w: &mut Week) -> Option<crate::steps::Step<()>> { None }
    pub fn leaving_town(&mut self, w: &mut Week) -> bool { false }
    pub fn child_wake(&mut self, w: &mut Week) -> oikos_sight::Action { oikos_sight::Action::wait() }
    pub fn heard_go(&mut self, pic: &oikos_sight::Picture) {}
    pub fn go_where_we_belong(&mut self, pic: &oikos_sight::Picture, cx: &mut Cx) -> Option<Todo> { None }
    pub fn belong(&self, pic: &oikos_sight::Picture) -> Option<String> { None }
    pub fn next_change(&self, t: i64) -> i64 { i64::MAX }
    pub fn schooling_and_care(&mut self, w: &mut Week) {}

}
