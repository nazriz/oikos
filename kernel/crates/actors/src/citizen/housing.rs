//! Housing (citizen.ts): a home's tenancy ending, offers signed, a rent rise, possession, moving in, staying with
//! someone, hunting, the land register, buying and selling (docs/behaviour/citizen.md, households.md, justice.md,
//! ownership.md). STUB: lane A1's housing part fills it.

use super::params::Params;
#[allow(unused_imports)]
use super::person::{Person, Todo, Week};
use crate::Cx;
use serde::{Deserialize, Serialize};

/// This part's own memory (fields only this part reads; what several parts read is in `person::State`).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Housing {}

impl Housing {
    pub fn new(_p: &Params, _cx: &mut Cx) -> Self {
        Housing::default()
    }
}

#[allow(unused_variables)]
impl Person {
    pub fn staying_with(&self) -> Option<&str> { None }
    pub fn home_budget(&self, balance: i64, t: i64) -> i64 { 0 }
    pub fn need_home(&self, t: i64) -> bool { false }
    pub fn home_lead_look(&self, lead: &str, budget: i64, t: i64) -> oikos_sight::LookRequest { crate::common::ask::one("homes", lead) }
    pub fn home_market_look(&self, budget: i64, t: i64) -> oikos_sight::LookRequest { crate::common::ask::board("homes", self.p.search_limit, vec![], None) }
    pub fn sale_looks(&mut self, t: i64) -> Vec<oikos_sight::LookRequest> { vec![] }
    pub fn register_looks(&mut self, t: i64) -> Vec<oikos_sight::LookRequest> { vec![] }
    pub fn find_own_home(&mut self, w: &mut Week) {}
    pub fn retire_old_rents(&mut self, w: &mut Week) {}
    pub fn tenancy_end(&mut self, w: &mut Week) {}
    pub fn offers(&mut self, w: &mut Week) {}
    pub fn rent_rise(&mut self, w: &mut Week) {}
    pub fn possession(&mut self, w: &mut Week) {}
    pub fn ordered_to_pay_rent(&mut self, w: &mut Week) {}
    pub fn left_homes(&mut self, w: &mut Week) {}
    pub fn move_into_home(&mut self, w: &mut Week) {}
    pub fn stay_with_someone(&mut self, w: &mut Week) {}
    pub fn hunt_home(&mut self, w: &mut Week) {}
    pub fn utilities(&mut self, w: &mut Week) {}
    pub fn selling_and_buying(&mut self, w: &mut Week) {}

}
