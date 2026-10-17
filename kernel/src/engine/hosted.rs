//! The engine with a host that carries its own seats (`EngineOptions::host_seats`): the TS host's run loop
//! (orchestrator/src/run.ts under OIKOS_WORLD=rust, through the stdio protocol or the N-API session,
//! kernel/src/protocol.rs). The engine runs every built-in actor; the host runs its seats exactly as it does on the TS
//! world (their prompts, the translator's drafts, confirmations, notebooks, debriefs, costs), with the same requests:
//! it observes a seat, decides, and acts for it by commands, in the seat's place in the round's key order, and says
//! when the seat's wake is done.
//!
//! The order of a moment: the engine wakes everyone due, code actors look and decide; the seats are handed to the host
//! (`Due::Seats`, unobserved). As the host acts for a seat, the code actions before it in key order are carried out
//! first (`host_command`); when the host asks what is next, the rest of the round is, and then the moment's further
//! rounds. A seat that looks again or drafts takes its further rounds in the host, at once, in its place.

use super::{Due, Engine};
use crate::kernel::Command;
use serde_json::Value;
use std::io::Write;

/// Whether a command changes the world (an observation does not: it may be made before the round is carried out).
fn changes(cmd: &Command) -> bool {
    !matches!(cmd, Command::Observe { .. })
}

fn participant_of(cmd: &Command) -> Option<String> {
    serde_json::to_value(cmd).ok().and_then(|v| v["participant"].as_str().map(String::from))
}

impl<W: Write> Engine<W> {
    /// A host's command for one of its seats (or the run's own): the round's code actions before that seat carried out
    /// first, then the command through the kernel's path (logged, the seat's knowledge kept, the schedule told).
    pub fn host_command(&mut self, cmd: &Command) -> Result<(crate::run::Response, Option<crate::kernel::Observed>), String> {
        if changes(cmd) {
            if let Some(mut r) = self.round.take() {
                let stop = participant_of(cmd).filter(|p| r.awake.iter().any(|(k, _)| k == p));
                let done = self.carry_some(&mut r, stop.as_deref());
                self.round = Some(r);
                done?;
            }
        }
        self.hosting = true;
        let out = self.command_seen(cmd);
        self.hosting = false;
        out
    }

    /// A host's seat's wake is done (`until`: when it asked to be woken).
    pub fn host_finished(&mut self, key: &str, until: Option<i64>) {
        let t = self.run.kernel().t();
        self.sched.finished(key, until, t);
    }

    /// The host's own units (its seats as it schedules them: `hears`, `sort`, `body`), in place of the engine's.
    pub fn host_units_add(&mut self, units: &[Value]) -> Result<(), String> {
        self.sched.add(units)
    }
    pub fn host_units_remove(&mut self, keys: &[String]) {
        self.sched.remove(keys);
    }
    pub fn host_to_cadence(&mut self, participant: &str) {
        let t = self.run.kernel().t();
        self.sched.to_cadence(participant, t);
    }
    pub fn host_perturb(&mut self, p: crate::schedule::Perturb) {
        self.sched.perturb(p);
    }

    /// The events of the engine's own commands since last taken (the host keeps its cast from them).
    pub fn host_events(&mut self) -> Vec<crate::events::Event> {
        std::mem::take(&mut self.for_host)
    }

    /// The run ends at `until` (the host's), no later than the world's end.
    pub fn set_until(&mut self, until: i64) {
        self.until = until.min(self.run_end);
    }

    /// What the seat's knowledge resolves a call to (the resolver, from what it has been shown: P8).
    pub fn host_resolve(&self, key: &str, program: &oikos_resolver::calls::Program, as_: Option<&str>) -> oikos_resolver::Resolution {
        let empty = oikos_resolver::Knowledge::new(self.currency.clone());
        let k = self.knowledge.get(key).unwrap_or(&empty);
        let types = &self.types;
        let type_of = |t: &str| types.get(t).cloned();
        oikos_resolver::resolve(program, k, &type_of, as_)
    }

    pub fn run_mut(&mut self) -> &mut crate::run::Run<W> {
        &mut self.run
    }

    /// What is next for a host carrying its seats: the rest of the round carried out first.
    pub fn host_next(&mut self) -> Result<Due, String> {
        self.next()
    }
}
