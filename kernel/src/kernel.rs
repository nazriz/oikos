//! The engine's kernel (docs/design/rebuild.md section 4): the world (`oikos-world`, the only writer) and what its
//! participants perceive of it (`oikos-perception`, read-only), together behind one command interface. An
//! observation is built by perception from the world as it is, then delivered by the world (what was looked through
//! is marked seen; outcomes and messages are handed over), and its hash goes in the log.

use crate::canon;
use crate::config::LookRequest;
use crate::events::{EventBody, Timed};
use crate::observe::{self, Observation, RecordIndex};
use crate::state::State;
use crate::statics::Statics;

pub use oikos_world::kernel::{Check, Command, ProtocolError};

#[derive(Debug, Clone, Default)]
pub struct Output {
    pub events: Vec<Timed>,
    pub observation: Option<Observation>,
    /// The observation as it was hashed, when it was: whoever delivers it needn't serialise it again.
    pub observed: Option<Observed>,
}

/// An observation in JSON: its value, and its canonical bytes (what its hash in the log is of).
#[derive(Debug, Clone)]
pub struct Observed {
    pub value: serde_json::Value,
    pub canonical: Vec<u8>,
}

impl Observed {
    pub fn of(obs: &Observation) -> Result<Observed, canon::CanonError> {
        let value = serde_json::to_value(obs).map_err(|e| canon::CanonError::Serialize(e.to_string()))?;
        let canonical = canon::canonical_value(&value)?;
        Ok(Observed { value, canonical })
    }
}

pub struct Kernel {
    world: oikos_world::World,
    /// Perception's derived lookups; not part of the state.
    index: RecordIndex,
}

impl Kernel {
    pub fn new(loaded: &crate::config::LoadedConfig) -> Result<Kernel, String> {
        Ok(Kernel { world: oikos_world::World::new(loaded)?, index: Default::default() })
    }

    pub fn state(&self) -> &State {
        self.world.state()
    }

    pub fn statics(&self) -> &Statics {
        self.world.statics()
    }

    pub fn t(&self) -> i64 {
        self.world.t()
    }

    pub fn canonical_state(&self) -> Result<Vec<u8>, canon::CanonError> {
        self.world.canonical_state()
    }

    pub fn state_hash(&self) -> Result<String, canon::CanonError> {
        self.world.state_hash()
    }

    /// Validate a command without applying it.
    pub fn precheck(&self, cmd: &Command) -> Result<(), ProtocolError> {
        self.world.precheck(cmd)
    }

    pub fn apply(&mut self, cmd: &Command) -> Result<Output, ProtocolError> {
        match cmd {
            Command::Observe { participant, only } => {
                self.world.precheck(cmd)?;
                Ok(self.observe(participant, only.as_deref(), &[]))
            }
            Command::Look { participant, only, looks } => {
                self.world.precheck(cmd)?;
                Ok(self.observe(participant, only.as_deref(), looks))
            }
            _ => Ok(Output { events: self.world.apply(cmd)?.events, observation: None, observed: None }),
        }
    }

    pub fn check(&self, participant: &str, position: Option<&str>, blocks: &[crate::blocks::Block]) -> Result<Check, ProtocolError> {
        self.world.check(participant, position, blocks)
    }

    /// The full picture a participant's channels cover right now; changes nothing.
    pub fn full_view(&mut self, participant: &str) -> Option<Observation> {
        self.world.state().participants.contains_key(participant).then(|| observe::full_view(self.world.statics(), self.world.state(), &mut self.index, participant))
    }

    fn observe(&mut self, participant: &str, only: Option<&str>, looks: &[LookRequest]) -> Output {
        let (obs, seen, drained) = observe::observe(self.world.statics(), self.world.state(), &mut self.index, participant, only, looks);
        let (outcomes, inbox) = self.world.deliver(participant, only, seen, drained);
        let obs = Observation { outcomes, inbox, ..obs };
        // A lean log keeps no observation hashes (the log's `detail`): hashing a whole observation is much of the cost.
        if self.world.statics().config.log.detail.as_deref() == Some("lean") {
            return Output { events: vec![], observation: Some(obs), observed: None };
        }
        // (Exactly `canon::hash_value` of the observation, its JSON kept for whoever delivers it.)
        let observed = Observed::of(&obs).expect("observations are canonical");
        let hash = canon::hash_with_domain(canon::DOMAIN_OBSERVATION, &observed.canonical);
        Output { events: vec![Timed::new(self.world.t(), EventBody::Observation { participant: participant.into(), observation_hash: hash })], observation: Some(obs), observed: Some(observed) }
    }
}
