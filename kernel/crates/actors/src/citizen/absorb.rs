//! What a person takes in from every observation (citizen.ts `absorb`, 1246-1563; `learnFromInitialRecords`;
//! word of mouth, 4097-4168): the book, money in and out, pay, offers and papers about us, the household's sayings,
//! letters (what is the mind's goes to it), leads. STUB: lane A1's absorb part fills it.

use super::params::Params;
#[allow(unused_imports)]
use super::person::{Person, Todo, Week};
use crate::Cx;
use serde::{Deserialize, Serialize};

/// This part's own memory (fields only this part reads; what several parts read is in `person::State`).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Absorbed {}

impl Absorbed {
    pub fn new(_p: &Params, _cx: &mut Cx) -> Self {
        Absorbed::default()
    }
}

#[allow(unused_variables)]
impl Person {
    pub fn absorb(&mut self, pic: &oikos_sight::Picture, cx: &mut Cx) { self.book.absorb(pic); }
    pub fn learn_from_initial_records(&mut self, w: &mut Week) {}

}
