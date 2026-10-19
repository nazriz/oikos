//! A run: a kernel plus the log it writes. The kernel logs every command
//! before applying it, then the events it caused, then a checkpoint whenever
//! an advance crosses a `log.checkpoint_every` boundary.

use crate::canon;
use crate::config::{self, CONTRACTS_VERSION};
use crate::events::Event;
use crate::kernel::{Command, Kernel, Output, ProtocolError};
use crate::log::{self, Kind, LogWriter};
use crate::observe::Observation;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::Write;

pub const KERNEL_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const KERNEL_BUILD: &str = env!("OIKOS_BUILD");
/// A fingerprint of the sources the engine was built from (build.rs): the binary and the native module agree on it
/// when they were built from the same sources.
pub const KERNEL_SOURCE: &str = env!("OIKOS_SOURCE");

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KernelIdentity {
    pub version: String,
    pub build: String,
}

impl KernelIdentity {
    pub fn current() -> Self {
        KernelIdentity { version: KERNEL_VERSION.into(), build: KERNEL_BUILD.into() }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Header {
    pub contracts: String,
    pub kernel: KernelIdentity,
    pub run_id: String,
    pub config: Value,
    pub config_hash: String,
    pub initial_state_hash: String,
    pub canary: String,
}

/// How a failure to write the log reads (`RunError::Io`). The protocol marks a reply that starts with it as fatal:
/// the world may have moved on without its record, so nothing after it can be trusted.
pub const LOG_WRITE_FAILED: &str = "log write failed: ";

#[derive(Debug)]
pub enum RunError {
    Protocol(ProtocolError),
    Io(std::io::Error),
    Config(String),
}

impl std::fmt::Display for RunError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RunError::Protocol(e) => write!(f, "protocol error: {e}"),
            RunError::Io(e) => write!(f, "{LOG_WRITE_FAILED}{e}"),
            RunError::Config(e) => write!(f, "invalid config: {e}"),
        }
    }
}

impl std::error::Error for RunError {}

impl From<ProtocolError> for RunError {
    fn from(e: ProtocolError) -> Self {
        RunError::Protocol(e)
    }
}

impl From<std::io::Error> for RunError {
    fn from(e: std::io::Error) -> Self {
        RunError::Io(e)
    }
}

/// What a command produced: its log seq, its events (as logged) and, for
/// `observe`, the observation.
#[derive(Debug, Clone, Serialize)]
pub struct Response {
    pub seq: u64,
    pub events: Vec<Event>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub observation: Option<Observation>,
    /// Each event's canonical JSON, as it was logged (for whoever passes the events on: they needn't be written again).
    #[serde(skip)]
    pub logged: Vec<Vec<u8>>,
}

pub struct Run<W: Write> {
    kernel: Kernel,
    log: LogWriter<W>,
    checkpoint_every: i64,
    ended: bool,
    /// The last command's observation as it was hashed, if it was (see `take_observed`).
    observed: Option<crate::kernel::Observed>,
    /// Requests to observe whose shape has been checked against the contract (participant -> capacities asked for):
    /// the same one, asked again, keeps to it as it did. (A wake is one of these, and there are a few thousand kinds.)
    observes_checked: std::collections::BTreeMap<String, std::collections::BTreeSet<Option<String>>>,
    /// The config as it was given, in canonical JSON (what the header carries): a snapshot carries it too.
    config: std::sync::Arc<[u8]>,
    run_id: String,
}

impl<W: Write> Run<W> {
    pub fn start(config: Value, run_id: &str, out: W, anchors: Option<Box<dyn Write>>) -> Result<Self, RunError> {
        Self::start_as(config, run_id, KernelIdentity::current(), out, anchors)
    }

    /// Start with an explicit kernel identity (replay reproduces the original header).
    pub fn start_as(
        config: Value,
        run_id: &str,
        identity: KernelIdentity,
        out: W,
        anchors: Option<Box<dyn Write>>,
    ) -> Result<Self, RunError> {
        if run_id.is_empty() || run_id.len() > 128 || !run_id.bytes().all(|b| b.is_ascii_alphanumeric() || b"_.:-".contains(&b)) {
            return Err(RunError::Config(format!("invalid run id {run_id:?}")));
        }
        let loaded = config::load(config).map_err(RunError::Config)?;
        let kernel = Kernel::new(&loaded).map_err(RunError::Config)?;
        // (The header is made without its config, whose canonical bytes are then written where it stands: a large
        // world's config goes to the log from the bytes its hash was taken of, and is held as JSON nowhere.)
        let header = Header {
            contracts: CONTRACTS_VERSION.into(),
            kernel: identity,
            run_id: run_id.into(),
            config: Value::Null,
            config_hash: loaded.hash.clone(),
            initial_state_hash: kernel.state_hash().map_err(|e| RunError::Config(e.to_string()))?,
            canary: loaded.config.meta.canary.clone(),
        };
        let body = serde_json::to_value(&header).expect("header serializes");
        let Value::Object(members) = &body else { unreachable!("a header is an object") };
        let (anchor_every, checkpoint_every) = (loaded.config.log.anchor_every_entries, loaded.config.log.checkpoint_every);
        let mut bytes = Vec::with_capacity(loaded.canonical.len() + 512);
        canon::write_object(members, &mut bytes, |key, x, out| if key == "config" { out.extend_from_slice(&loaded.canonical) } else { canon::write_value(x, out) });
        let mut log = LogWriter::new(out, anchors, anchor_every);
        log.append_canonical(0, Kind::Header, &bytes)?;
        let config = std::sync::Arc::from(loaded.canonical);
        Ok(Run { checkpoint_every, kernel, log, ended: false, observed: None, observes_checked: Default::default(), config, run_id: run_id.into() })
    }

    /// A run going on from where it was (a snapshot, or a fork): this kernel, its log carried on from entry `next_seq`
    /// whose previous entry's hash is `prev` (no header is written: the log before it is the run's, or its parent's).
    pub fn resume(kernel: Kernel, config: std::sync::Arc<[u8]>, run_id: &str, next_seq: u64, prev: &str, out: W, anchors: Option<Box<dyn Write>>) -> Self {
        let (anchor_every, checkpoint_every) =
            (kernel.statics().config.log.anchor_every_entries, kernel.statics().config.log.checkpoint_every);
        let log = LogWriter::resume(out, anchors, anchor_every, next_seq, prev);
        Run { checkpoint_every, kernel, log, ended: false, observed: None, observes_checked: Default::default(), config, run_id: run_id.into() }
    }

    /// The config as it was given, in canonical JSON.
    pub fn config_bytes(&self) -> &std::sync::Arc<[u8]> {
        &self.config
    }

    pub fn run_id(&self) -> &str {
        &self.run_id
    }

    /// Where the log stands: the next entry's seq, and the hash of the last.
    pub fn log_head(&self) -> (u64, String) {
        (self.log.next_seq(), self.log.head().to_string())
    }

    /// The log's writer (whoever wrote a snapshot into the log, or tees its entries to a stream).
    pub fn log_out(&mut self) -> &mut W {
        self.log.out_mut()
    }

    pub fn log_ref(&self) -> &W {
        self.log.out_ref()
    }

    pub fn ended(&self) -> bool {
        self.ended
    }

    /// The full picture a participant's channels cover right now (the perception invariant's reference). Changes nothing; not logged.
    pub fn full_view(&mut self, participant: &str) -> Option<crate::observe::Observation> {
        self.kernel.full_view(participant)
    }

    pub fn kernel(&self) -> &Kernel {
        &self.kernel
    }

    /// These observations will be asked for next: see `Kernel::plan`.
    pub fn plan(&mut self, observations: Vec<(String, Option<String>)>) {
        self.kernel.plan(observations);
    }

    /// How many threads observations are made ready on, and how many at least together: see `Kernel::share`.
    pub fn share(&mut self, threads: usize, at_least: Option<usize>) {
        self.kernel.share(threads, at_least);
    }

    /// The host keeps the records it's handed: see `Kernel::refer_to_records`.
    pub fn refer_to_records(&mut self) {
        self.kernel.refer_to_records();
    }

    pub fn head(&self) -> &str {
        self.log.head()
    }

    /// Writes out whatever of the log is still held in memory: the file then holds every entry so far.
    pub fn flush(&mut self) -> std::io::Result<()> {
        self.log.flush()
    }

    fn not_ended(&self) -> Result<(), RunError> {
        if self.ended {
            return Err(ProtocolError("the run has ended".into()).into());
        }
        Ok(())
    }

    pub fn command(&mut self, cmd: &Command) -> Result<Response, RunError> {
        self.not_ended()?;
        // (Its JSON once, for the check and for the log; checked once, before it's logged: nothing changes the world
        // between that and applying it.)
        let known = match cmd {
            Command::Observe { participant, only } => self.observes_checked.get(participant).is_some_and(|x| x.contains(only)),
            _ => false,
        };
        let from = self.kernel.t();
        let seq = if known {
            self.kernel.precheck_in_world(cmd)?;
            self.log.append_as(from, Kind::Command, cmd)?.0
        } else {
            let body = serde_json::to_value(cmd).map_err(|e| ProtocolError(e.to_string()))?;
            self.kernel.precheck_as(cmd, &body)?;
            if let Command::Observe { participant, only } = cmd {
                self.observes_checked.entry(participant.clone()).or_default().insert(only.clone());
            }
            self.log.append(from, Kind::Command, body)?.seq
        };
        self.observed = None;
        let Output { events, observation, observed } = self.kernel.apply_prechecked(cmd)?;
        self.observed = observed;
        let mut events_logged = Vec::with_capacity(events.len());
        let mut logged = Vec::with_capacity(events.len());
        for mut timed in events {
            timed.event.cause = seq;
            logged.push(self.log.append_as(timed.t, Kind::Event, &timed.event)?.1);
            events_logged.push(timed.event);
        }
        if matches!(cmd, Command::Advance { .. } | Command::AdvanceToNews { .. }) {
            // (Where the clock is now: an advance that stops at body news has not gone as far as it was asked.)
            let to = self.kernel.t();
            if to / self.checkpoint_every > from / self.checkpoint_every {
                self.checkpoint()?;
            }
        }
        Ok(Response { seq, events: events_logged, observation, logged })
    }

    /// The observation the last command returned, in JSON: as it was hashed for the log, so the protocol's reply
    /// carries those bytes instead of serialising it again (or encoded now, for a lean log, which keeps no
    /// observation hashes).
    pub fn observed(&mut self, obs: &mut Observation) -> Result<crate::kernel::Observed, canon::CanonError> {
        match self.observed.take() {
            Some(o) => Ok(o),
            None => self.kernel.observed(obs),
        }
    }

    fn checkpoint(&mut self) -> Result<(), RunError> {
        let hash = self.kernel.state_hash().map_err(|e| RunError::Config(e.to_string()))?;
        self.log.append(self.kernel.t(), Kind::Checkpoint, json!({ "state_hash": hash }))?;
        Ok(())
    }

    /// Record non-state information (usage, transcripts, drafts, ...),
    /// validated against the Annotation contract.
    pub fn annotate(&mut self, annotation: Value) -> Result<u64, RunError> {
        self.not_ended()?;
        canon::check_integers(&annotation).map_err(|e| ProtocolError(e.to_string()))?;
        crate::contracts::check(&crate::contracts::contracts().annotation, &annotation)
            .map_err(|e| ProtocolError(format!("annotation {e}")))?;
        Ok(self.log.append(self.kernel.t(), Kind::Annotation, annotation)?.seq)
    }

    pub fn finish(&mut self, reason: &str, detail: Option<&str>) -> Result<(u64, String), RunError> {
        self.not_ended()?;
        if !["completed", "aborted", "error"].contains(&reason) {
            return Err(ProtocolError(format!("unknown end reason {reason}")).into());
        }
        let hash = self.kernel.state_hash().map_err(|e| RunError::Config(e.to_string()))?;
        let mut body = json!({ "reason": reason, "state_hash": hash });
        if let Some(d) = detail {
            body["detail"] = Value::String(d.chars().take(2000).collect());
        }
        let seq = self.log.append(self.kernel.t(), Kind::End, body)?.seq;
        self.log.anchor()?;
        self.log.flush()?;
        self.ended = true;
        Ok((seq, hash))
    }

    pub fn into_log(self) -> W {
        self.log.into_inner()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReplayReport {
    pub entries: usize,
    pub state_hash: String,
    pub canonical_state: Vec<u8>,
    pub complete: bool,
    /// The log was written by a different kernel build than this one.
    pub build_differs: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReplayError {
    Chain(log::VerifyError),
    /// Replay produced a different log. `line` is the first differing line (0-based).
    Diverged {
        line: usize,
        detail: String,
    },
    Invalid(String),
}

impl std::fmt::Display for ReplayError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ReplayError::Chain(e) => write!(f, "hash chain does not verify: {e}"),
            ReplayError::Diverged { line, detail } => write!(f, "replay diverged at line {}: {detail}", line + 1),
            ReplayError::Invalid(e) => write!(f, "cannot replay: {e}"),
        }
    }
}

impl std::error::Error for ReplayError {}

/// Replay a log from its header and commands, regenerate the entire log, and
/// require it to be byte-identical to the original.
/// What a participant was shown by the observe (or look) command at `seq` of a log, regenerated by replaying the log up to
/// it: the view of a code actor that a log keeping only seats' observations (`log.observations: seats`) does not hold.
/// The world is deterministic, so this is exactly the observation the actor was given (the same as a log keeping `all`
/// records for it: kernel/tests/observations.rs). In the shape a recorded one has: its channels as a list, each with its
/// `path` (the recorded one also says the entity and capacity it was shown for, which its unit, not the log, knows).
pub fn observation_at(original: &[u8], seq: u64) -> Result<Value, ReplayError> {
    let verified = log::verify(original, None).map_err(ReplayError::Chain)?;
    let header: Header =
        serde_json::from_value(verified.entries[0].body.clone()).map_err(|e| ReplayError::Invalid(format!("bad header: {e}")))?;
    let invalid = |e: RunError| ReplayError::Invalid(e.to_string());
    let mut run = Run::start_as(header.config.clone(), &header.run_id, header.kernel.clone(), Vec::new(), None).map_err(invalid)?;
    for e in &verified.entries[1..] {
        match e.kind {
            Kind::Command => {
                let cmd: Command = serde_json::from_value(e.body.clone())
                    .map_err(|x| ReplayError::Invalid(format!("entry {}: bad command: {x}", e.seq)))?;
                let r = run.command(&cmd).map_err(|x| ReplayError::Diverged { line: e.seq as usize, detail: x.to_string() })?;
                if e.seq == seq {
                    let (Command::Observe { participant, .. } | Command::Look { participant, .. }) = &cmd else {
                        return Err(ReplayError::Invalid(format!("entry {seq} is not an observation")));
                    };
                    let obs = r.observation.ok_or_else(|| ReplayError::Invalid(format!("entry {seq} gave no observation")))?;
                    let mut v = serde_json::to_value(&obs).map_err(|x| ReplayError::Invalid(x.to_string()))?;
                    let _ = participant;
                    if let Some(chans) = v.get("channels").and_then(Value::as_object).cloned() {
                        v["channels"] = Value::Array(chans.into_iter().map(|(path, mut c)| {
                            c["path"] = serde_json::json!(path);
                            c
                        }).collect());
                    }
                    return Ok(v);
                }
            }
            Kind::Annotation => {
                run.annotate(e.body.clone()).map_err(|x| ReplayError::Diverged { line: e.seq as usize, detail: x.to_string() })?;
            }
            Kind::End | Kind::Event | Kind::Checkpoint | Kind::Header => {}
        }
        if e.seq > seq {
            break;
        }
    }
    Err(ReplayError::Invalid(format!("no entry {seq} in the log")))
}

pub fn replay(original: &[u8], anchors: Option<&[u8]>) -> Result<ReplayReport, ReplayError> {
    let verified = log::verify(original, anchors).map_err(ReplayError::Chain)?;
    let header: Header =
        serde_json::from_value(verified.entries[0].body.clone()).map_err(|e| ReplayError::Invalid(format!("bad header: {e}")))?;
    let current = KernelIdentity::current();
    let build_differs = (header.kernel != current).then(|| {
        format!("log written by {} ({}), replayed by {} ({})", header.kernel.version, header.kernel.build, current.version, current.build)
    });
    let invalid = |e: RunError| ReplayError::Invalid(e.to_string());
    let mut run = Run::start_as(header.config.clone(), &header.run_id, header.kernel.clone(), Vec::new(), None).map_err(invalid)?;
    for e in &verified.entries[1..] {
        match e.kind {
            Kind::Command => {
                let cmd: Command = serde_json::from_value(e.body.clone())
                    .map_err(|x| ReplayError::Invalid(format!("entry {}: bad command: {x}", e.seq)))?;
                run.command(&cmd).map_err(|x| ReplayError::Diverged { line: e.seq as usize, detail: x.to_string() })?;
            }
            Kind::Annotation => {
                run.annotate(e.body.clone()).map_err(|x| ReplayError::Diverged { line: e.seq as usize, detail: x.to_string() })?;
            }
            Kind::End => {
                let reason = e.body["reason"].as_str().unwrap_or("");
                run.finish(reason, e.body.get("detail").and_then(Value::as_str))
                    .map_err(|x| ReplayError::Diverged { line: e.seq as usize, detail: x.to_string() })?;
            }
            // Regenerated by the commands; compared below.
            Kind::Event | Kind::Checkpoint | Kind::Header => {}
        }
    }
    let state_hash = run.kernel().state_hash().map_err(|e| ReplayError::Invalid(e.to_string()))?;
    let canonical_state = run.kernel().canonical_state().map_err(|e| ReplayError::Invalid(e.to_string()))?;
    let regenerated = run.into_log();
    if regenerated != original {
        let (a, b) = (log::lines(original), log::lines(&regenerated));
        let line = a.iter().zip(b.iter()).position(|(x, y)| x != y).unwrap_or(a.len().min(b.len()));
        let detail = match (a.get(line), b.get(line)) {
            (Some(x), Some(y)) => format!("logged {} / replayed {}", String::from_utf8_lossy(x), String::from_utf8_lossy(y)),
            (Some(_), None) => "replay produced fewer entries".into(),
            (None, Some(y)) => format!("replay produced an extra entry {}", String::from_utf8_lossy(y)),
            (None, None) => "logs differ".into(),
        };
        return Err(ReplayError::Diverged { line, detail });
    }
    Ok(ReplayReport { entries: verified.entries.len(), state_hash, canonical_state, complete: verified.complete, build_differs })
}
