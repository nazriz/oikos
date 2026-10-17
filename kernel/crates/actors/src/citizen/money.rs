//! Money (citizen.ts): claims for support, borrowing, paying what is ordered or recorded against us, spending,
//! shopping and using things up (docs/behaviour/citizen.md, boundary.md, credit.md). STUB: lane A1's money part fills it.

use super::params::Params;
#[allow(unused_imports)]
use super::person::{Person, Todo, Week};
use crate::Cx;
use serde::{Deserialize, Serialize};

/// This part's own memory (fields only this part reads; what several parts read is in `person::State`).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Money {}

impl Money {
    pub fn new(_p: &Params, _cx: &mut Cx) -> Self {
        Money::default()
    }
}

#[allow(unused_variables)]
impl Person {
    pub fn shop_looks(&mut self, pic: &oikos_sight::Picture, cx: &mut Cx) -> Vec<oikos_sight::LookRequest> { vec![] }
    pub fn claims(&mut self, w: &mut Week) {}
    pub fn borrowing(&mut self, w: &mut Week) {}
    pub fn ordered_to_pay(&mut self, w: &mut Week) {}
    pub fn recorded_against(&mut self, w: &mut Week) {}
    pub fn spending(&mut self, w: &mut Week) {}
    pub fn shopping(&mut self, w: &mut Week) {}
    pub fn use_up(&mut self, w: &mut Week) {}

}
