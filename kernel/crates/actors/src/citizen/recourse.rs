//! Recourse (citizen.ts): grievances and what is asked of whoever did wrong, answers to what we asked, a
//! caseload from before the year, disrepair, complaints about a service, the tribunal, carrying out the ways the mind
//! chose for its wants, and the openings life offers for a want (docs/behaviour/frictions.md, justice.md, services.md).
//! STUB: lane A1's recourse part fills it.

use super::params::Params;
#[allow(unused_imports)]
use super::person::{Person, Todo, Week};
use crate::Cx;
use serde::{Deserialize, Serialize};

/// This part's own memory (fields only this part reads; what several parts read is in `person::State`).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Recourse {}

impl Recourse {
    pub fn new(_p: &Params, _cx: &mut Cx) -> Self {
        Recourse::default()
    }
}

#[allow(unused_variables)]
impl Person {
    pub fn answers(&mut self, w: &mut Week) {}
    pub fn opening_caseload(&mut self, w: &mut Week) {}
    pub fn disrepair(&mut self, w: &mut Week) {}
    pub fn complaints(&mut self, w: &mut Week) {}
    pub fn justice(&mut self, w: &mut Week) {}
    pub fn carry_out(&mut self, w: &mut Week, intent: &super::mind::Intent, why: Option<&str>) {}

}

/// Life's openings for a want, as the mind asks for them mid-call (citizen.ts `waysFor`).
pub struct Ways<'a> {
    pub person: &'a Person,
    pub pic: &'a oikos_sight::Picture,
}

impl super::mind::Openings for Ways<'_> {
    fn for_want(&self, _want: &super::mind::WantView, _t: i64) -> Vec<super::mind::Opening> {
        vec![]
    }
    fn grievance(&self, _want: &super::mind::WantView) -> Option<super::mind::GrievanceView> {
        None
    }
}
