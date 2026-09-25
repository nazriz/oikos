//! Facts fixed for the whole run, derived from the config.

use crate::config::{Config, Seat, StructureType};
use crate::rng::Randomness;
use std::collections::BTreeMap;

#[derive(Debug, Clone)]
pub struct Statics {
    pub config: Config,
    pub types: BTreeMap<String, StructureType>,
    pub seats: BTreeMap<String, Seat>,
    /// The boundary entity, and the account (in its own custody) that
    /// construction materials are paid into.
    pub boundary: String,
    pub boundary_account: String,
    pub tick: i64,
    pub randomness: Randomness,
}

impl Statics {
    /// A duration rounded up to whole ticks.
    pub fn span(&self, d: i64) -> i64 {
        (d + self.tick - 1) / self.tick * self.tick
    }

    /// End of the run, rounded up to a whole tick.
    pub fn run_end(&self) -> i64 {
        self.span(self.config.clock.run_seconds)
    }

    /// The entity a seat acts as.
    pub fn entity_of(&self, seat: &str) -> Option<&str> {
        self.seats.get(seat).map(|s| s.entity.as_str())
    }
}
