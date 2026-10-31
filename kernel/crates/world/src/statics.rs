//! Facts fixed for the whole run, derived from the config.

use crate::blocks::Id;
use crate::config::{Config, Life, SpaceSpec, StructureType, Template};
use crate::rng::Randomness;
use std::collections::BTreeMap;

#[derive(Debug, Clone)]
pub struct Statics {
    /// (The one the run was loaded from: shared, not a copy.)
    pub config: std::sync::Arc<Config>,
    pub types: BTreeMap<Id, StructureType>,
    /// Each structure type's spaces, in order: local id (`dwelling.3`) -> spec.
    pub spaces: BTreeMap<Id, BTreeMap<Id, SpaceSpec>>,
    pub templates: BTreeMap<Id, Template>,
    /// The world's edges (the first is the default), and each edge's accounts in its own custody, by currency:
    /// what newcomers' money comes from, and (at the default edge) what construction materials are paid into.
    pub boundaries: Vec<Id>,
    pub boundary_accounts: BTreeMap<(Id, Id), Id>,
    /// The world's default currency (its first): materials and newcomers' money are in it.
    pub currency: Id,
    pub tick: i64,
    /// How long each act takes its actor (the world's `orchestration.act_time`).
    pub act_times: oikos_time::ActTimes,
    /// The kind of space a person must be in to do another's work (`orchestration.performers_in`); absent: anywhere.
    pub performers_in: Option<String>,
    /// The detailed places' areas: where cells exist (D58).
    pub detailed: Vec<crate::config::PlaceRect>,
    pub randomness: Randomness,
    /// Nature's ground (its cells, neighbours and flow layer), when the world has nature.
    pub nature: Option<oikos_nature::Ground>,
    /// Each configured participant's place in `config.participants`, by id (the first of an id): looked up, not
    /// searched for, at every write of a record.
    pub participant_at: BTreeMap<Id, usize>,
    /// For each organisation, the first configured position of it that keeps its record (`keeps_record`), by its
    /// place in `config.positions`.
    pub record_keeping_at: BTreeMap<Id, usize>,
    /// The network for what flows (foundations-2 C3), its trees found at load, when the world has one.
    pub net: Option<std::sync::Arc<crate::network::NetStatics>>,
    /// Who may drive which vehicles (law 9, foundations-2 S2): each body's own and those its owner lets it drive, from the
    /// config (no act yet makes a vehicle or changes who may drive it), so that a person's view finds theirs at once.
    pub drivers_of: BTreeMap<Id, Vec<Id>>,
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

    /// The default edge.
    pub fn boundary(&self) -> &str {
        &self.boundaries[0]
    }

    /// Whether an entity is one of the world's edges.
    pub fn is_boundary(&self, entity: &str) -> bool {
        self.boundaries.iter().any(|b| b == entity)
    }

    /// An edge's own account in the default currency.
    pub fn boundary_account(&self, edge: &str) -> &str {
        &self.boundary_accounts[&(Id::new(edge), self.currency)]
    }

    /// Whether an account id is one of the edges' own (which can never be closed: the world's edges always exist).
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
