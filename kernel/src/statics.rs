//! Facts fixed for the whole run, derived from the config.

use crate::config::{Config, Life, SpaceSpec, StructureType, Template};
use crate::rng::Randomness;
use std::collections::BTreeMap;

#[derive(Debug, Clone)]
pub struct Statics {
    pub config: Config,
    pub types: BTreeMap<String, StructureType>,
    /// Each structure type's spaces, in order: local id (`dwelling.3`) -> spec.
    pub spaces: BTreeMap<String, BTreeMap<String, SpaceSpec>>,
    pub templates: BTreeMap<String, Template>,
    /// The boundary entity, and its accounts (in its own custody) by currency: what construction materials are paid
    /// into and newcomers' money comes from.
    pub boundary: String,
    pub boundary_accounts: BTreeMap<String, String>,
    /// The world's default currency (its first): materials and newcomers' money are in it.
    pub currency: String,
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

    /// The outside world's account in the default currency.
    pub fn boundary_account(&self) -> &str {
        &self.boundary_accounts[&self.currency]
    }

    /// Whether an account id is one of the outside world's own (which can never be closed).
    pub fn is_boundary_account(&self, account: &str) -> bool {
        self.boundary_accounts.values().any(|a| a == account)
    }

    pub fn life(&self) -> Option<&Life> {
        self.config.life.as_ref()
    }

    /// A space's spec, from its full id.
    pub fn space(&self, structure_type: &str, local: &str) -> Option<&SpaceSpec> {
        self.spaces.get(structure_type)?.get(local)
    }
}
