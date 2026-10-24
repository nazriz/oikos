//! The engine inside the participant host's process (docs/design/rebuild.md section 5.1): the kernel's session,
//! with the same requests and replies as the stdio protocol (kernel/src/protocol.rs), without a subprocess or a pipe.

use napi_derive::napi;
use oikos_kernel::protocol::Session;

// The kernel allocates heavily (JSON values, canonical encoding): the same allocator as its binary. Results don't
// depend on it.
#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

/// One run's session, in-process.
#[napi]
pub struct KernelSession {
    session: Session,
}

#[napi]
impl KernelSession {
    #[napi(constructor)]
    #[allow(clippy::new_without_default)]
    pub fn new() -> Self {
        Self { session: Session::new() }
    }

    /// One request as a line of JSON; its reply as one.
    #[napi]
    pub fn request(&mut self, line: String) -> String {
        self.session.request_owned(line)
    }

    /// The host is done with it: a run still open ends as aborted.
    #[napi]
    pub fn close(&mut self) {
        self.session.close();
    }

    /// The kernel's build, for the log header's provenance.
    #[napi]
    pub fn version() -> String {
        oikos_kernel::run::KERNEL_VERSION.to_string()
    }

    /// The fingerprint of the sources it was built from (kernel/build.rs), to match against the binary's.
    #[napi]
    pub fn source() -> String {
        oikos_kernel::run::KERNEL_SOURCE.to_string()
    }
}

// ------------------------------------------------------------------ the engine with its actors (lane F)

use napi::bindgen_prelude::Buffer;
use oikos_kernel::host::{Detached as DetachedActor, Host};

fn err(e: String) -> napi::Error {
    napi::Error::from_reason(e)
}
fn parse(s: &str, what: &str) -> napi::Result<serde_json::Value> {
    serde_json::from_str(s).map_err(|e| err(format!("{what}: {e}")))
}

/// Whom the engine is deciding for now (the watchdog's thread asks, while the run's own is inside the engine).
#[napi]
pub fn deciding() -> String {
    oikos_kernel::engine::deciding()
}

/// A world run in the engine, its built-in actors in Rust, its seats hosted by the caller (kernel/src/host.rs):
/// every call takes and gives JSON text.
#[napi]
pub struct World {
    host: Host,
}

#[napi]
impl World {
    /// `config`: the world's config (its JSON text; or empty, and `config_file` in the options names a file holding
    /// it); `options`: see kernel/src/host.rs (`run_id`, `log`, `threads`, `until`, `stand_in`,
    /// `snapshot_every_days`, `stream`...). Either way it is read participant by participant (`config::load_from`),
    /// never held whole as JSON.
    #[napi(constructor)]
    pub fn new(config: String, options: String) -> napi::Result<Self> {
        let opts = parse(&options, "options")?;
        let read = match opts["config_file"].as_str() {
            Some(path) if config.is_empty() => {
                oikos_kernel::config::load_from(std::fs::File::open(path).map_err(|e| err(format!("config_file {path}: {e}")))?)
            }
            _ => oikos_kernel::config::load_from(config.as_bytes()),
        };
        let (loaded, rest) = read.map_err(|e| err(format!("invalid config: {e}")))?;
        drop(config);
        Ok(World { host: Host::start_loaded(loaded, rest, &opts).map_err(err)? })
    }

    /// A run taken up again from a snapshot's bytes, with its own options (its log, `parent`, threads).
    #[napi(factory)]
    pub fn resume(snapshot: Buffer, options: String) -> napi::Result<Self> {
        Ok(World { host: Host::resume(&snapshot, &parse(&options, "options")?).map_err(err)? })
    }

    /// A fork of this run now, apart from it from here on.
    #[napi]
    pub fn fork(&mut self, options: String) -> napi::Result<World> {
        Ok(World { host: self.host.fork(&parse(&options, "options")?).map_err(err)? })
    }

    /// `{"due":"seats","t","seats":[{key, participant, t, woke_for, since, observation}]}` or `{"due":"end","t"}`.
    #[napi]
    pub fn next(&mut self) -> napi::Result<String> {
        Ok(self.host.next().map_err(err)?.to_string())
    }

    /// `next`, stopping between moments before anything after `by` (`{"due":"paused","t"}`).
    #[napi]
    pub fn next_by(&mut self, by: i64) -> napi::Result<String> {
        Ok(self.host.next_by(by).map_err(err)?.to_string())
    }

    /// A seat's action (the participant API's: wait, look, call, act with its provenance, message, opt_out).
    #[napi]
    pub fn submit(&mut self, key: String, action: String) -> napi::Result<()> {
        self.host.submit(&key, &parse(&action, "action")?).map_err(err)
    }

    /// The host's own record into the log (usage and cost per seat, transcripts, debriefs).
    #[napi]
    pub fn annotate(&mut self, annotation: String) -> napi::Result<()> {
        self.host.annotate(parse(&annotation, "annotation")?).map_err(err)
    }

    /// What a seat's call would come to from what it has been shown: `{blocks}` or `{questions, invalid?}` (nothing changes).
    #[napi]
    pub fn resolve(&self, participant: String, program: String, as_: Option<String>) -> napi::Result<String> {
        Ok(self.host.resolve(&participant, &program, as_.as_deref()).map_err(err)?.to_string())
    }

    /// Whether these blocks would be carried out for the participant now: `{ok, refusal?}` (nothing changes).
    #[napi]
    pub fn check(&self, participant: String, as_: Option<String>, blocks: String) -> napi::Result<String> {
        Ok(self.host.check(&participant, as_.as_deref(), &parse(&blocks, "blocks")?).map_err(err)?.to_string())
    }

    /// Code actors' questions to models since last asked: `[{key, kind, about, body}]`.
    #[napi]
    pub fn questions(&mut self) -> String {
        self.host.questions().to_string()
    }

    /// Answers for a unit (`[{kind, about, body}]`), given to it with its next observation.
    #[napi]
    pub fn answer(&mut self, key: String, answers: String) -> napi::Result<()> {
        self.host.answer(&key, &parse(&answers, "answers")?).map_err(err)
    }

    /// The whole run now, as bytes (between moments, or while seats are out).
    #[napi]
    pub fn snapshot(&self) -> napi::Result<Buffer> {
        Ok(self.host.snapshot().map_err(err)?.into())
    }

    /// Write what the run's log holds so far to its file (before another process resumes from a snapshot of it).
    #[napi]
    pub fn flush(&mut self) -> napi::Result<()> {
        self.host.flush().map_err(err)
    }

    /// A snapshot into the run's binary log.
    #[napi]
    pub fn snapshot_to_log(&mut self) -> napi::Result<()> {
        self.host.snapshot_to_log().map_err(err)
    }

    /// The live stream: `{entries: [log entries...], missed}` (options.stream must have asked for it).
    #[napi]
    pub fn events(&self, max: u32) -> String {
        self.host.events(max as usize).to_string()
    }

    #[napi]
    pub fn t(&self) -> i64 {
        self.host.t()
    }

    #[napi]
    pub fn state_hash(&self) -> napi::Result<String> {
        self.host.state_hash().map_err(err)
    }

    /// The run's end: `{state_hash, t, steps, log?}`.
    #[napi]
    pub fn finish(&mut self) -> napi::Result<String> {
        Ok(self.host.finish().map_err(err)?.to_string())
    }

    /// The log, where it was kept in memory (after `finish`): the JSONL lines.
    #[napi]
    pub fn log_bytes(&mut self) -> Option<Buffer> {
        self.host.log_bytes().map(Buffer::from)
    }
}

/// One actor kind run on observations it is handed (twins: a mock seat sitting as its code twin).
#[napi]
pub struct Detached {
    inner: DetachedActor,
}

#[napi]
impl Detached {
    /// `{kind, participant, capacity, entity, system?, params, seed, config}`.
    #[napi(constructor)]
    pub fn new(spec: String) -> napi::Result<Self> {
        Ok(Detached { inner: DetachedActor::new(&parse(&spec, "spec")?).map_err(err)? })
    }

    /// One step: `{action, decisions, outcomes, record, questions}`.
    #[napi]
    pub fn step(&mut self, observation: String, woke_for: String, since: i64, answers: Option<String>) -> napi::Result<String> {
        let answers = match answers {
            Some(a) => parse(&a, "answers")?,
            None => serde_json::Value::Null,
        };
        Ok(self.inner.step(&parse(&observation, "observation")?, &woke_for, since, &answers).map_err(err)?.to_string())
    }

    /// `[first_wake, cadence]`: when the engine's unit of this kind would first wake, and how often.
    #[napi]
    pub fn schedule(&self) -> Vec<i64> {
        let (f, c) = self.inner.schedule();
        vec![f, c]
    }

    #[napi]
    pub fn sent(&mut self, action: String) {
        self.inner.sent(&action);
    }

    #[napi]
    pub fn save(&self) -> napi::Result<String> {
        Ok(self.inner.save().map_err(err)?.to_string())
    }
}

/// A shared rule by name (kernel/src/rules_api.rs), its arguments and answer as JSON text.
#[napi]
pub fn rules(name: String, args: String) -> napi::Result<String> {
    Ok(oikos_kernel::rules_api::call(&name, &parse(&args, "args")?).map_err(err)?.to_string())
}

/// The rules served: `[[name, what it takes]]`.
#[napi]
pub fn rules_list() -> String {
    serde_json::Value::Array(oikos_kernel::rules_api::RULES.iter().map(|(n, _, d)| serde_json::json!([n, d])).collect()).to_string()
}

/// Every actor kind's manifest, by name.
#[napi]
pub fn manifests() -> String {
    oikos_kernel::rules_api::manifests().to_string()
}
