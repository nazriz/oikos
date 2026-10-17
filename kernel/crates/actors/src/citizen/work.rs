//! Work (citizen.ts): pay and its shortfalls, a job ending and the next starting, the union, hours, stopping
//! work, looking for work, working for oneself and starting a business, taking from work (docs/behaviour/citizen.md,
//! unions.md, entry.md, crime.md). STUB: lane A1's work part fills it.

use super::params::Params;
#[allow(unused_imports)]
use super::person::{Person, Todo, Week};
use crate::Cx;
use serde::{Deserialize, Serialize};

/// This part's own memory (fields only this part reads; what several parts read is in `person::State`).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Work {}

impl Work {
    pub fn new(_p: &Params, _cx: &mut Cx) -> Self {
        Work::default()
    }
}

#[allow(unused_variables)]
impl Person {
    pub fn job_lead_look(&self, lead: &str) -> oikos_sight::LookRequest { crate::common::ask::one("jobs", lead) }
    pub fn job_market_looks(&self) -> Vec<oikos_sight::LookRequest> { vec![] }
    pub fn search_due(&mut self, pic: &oikos_sight::Picture, cx: &mut Cx) {}
    pub fn leaving_union(&mut self) -> Vec<oikos_sight::calls::Call> { vec![] }
    pub fn trading_from(&mut self, w: &mut Week) {}
    pub fn unpaid_wages(&mut self, w: &mut Week) {}
    pub fn job_end(&mut self, w: &mut Week) {}
    pub fn switch_start(&mut self, w: &mut Week) {}
    pub fn union(&mut self, w: &mut Week) {}
    pub fn hours_asked(&mut self, w: &mut Week) {}
    pub fn short_pay(&mut self, w: &mut Week) {}
    pub fn stop_work(&mut self, w: &mut Week) {}
    pub fn look_for_work(&mut self, w: &mut Week) {}
    pub fn ventures(&mut self, w: &mut Week) {}
    pub fn taking(&mut self, w: &mut Week) {}

}
