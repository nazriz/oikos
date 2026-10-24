//! The capture of citizens' decisions, for training a citizen model (docs/citizen-data.md; contract
//! contracts/citizen-data.schema.json; design docs/design/citizen-model.md section 1).
//!
//! A stream of rows beside the run's log, never in it: turning it on changes nothing in the world or the log (the
//! actors read nothing of it; `Cx::rng` only notes the streams it opens). Each row is built from what a person's own
//! unit left beside its action (`Kept`): its decisions as it recorded them, their draws, what it came to know of how they
//! went, and the changes to its record the kernel took. Nothing here reads the world: what a row holds is what the
//! person's mind held (docs/no-god-view.md).
//!
//! Rows are written in the order the engine carries the round out (key order), so the same run writes the same bytes;
//! a person's record at a turn is the fold of that person's `record` rows above it. Compressed in zstd frames of about
//! 4 MB of rows each, so a run stopped hard loses at most its last frame.

use oikos_actors::Kept;
use serde::Serialize;
use serde_json::{Map, Value};
use std::fs::File;
use std::io::Write;

/// The stream's format, written in its first row; a reader refuses another.
pub const FORMAT: &str = "citizen-data/1";
/// The kind whose units are captured: people (the citizen's own unit).
pub const KIND: &str = "citizen.default";
/// Rows held before they are compressed and written as a frame.
const FRAME: usize = 4 << 20;
const LEVEL: i32 = 3;

/// (Frames are compressed and written on a thread of the capture's own, in the order they are handed over: the run's
/// thread only gathers rows. One writer, so the bytes are the same however the threads fall out.)
pub struct Capture {
    buf: Vec<u8>,
    to: Option<std::sync::mpsc::SyncSender<Vec<u8>>>,
    writer: Option<std::thread::JoinHandle<Result<(), String>>>,
    /// Rows written (for the summary; not state).
    pub rows: u64,
}

fn write_frames(mut file: File, from: std::sync::mpsc::Receiver<Vec<u8>>) -> Result<(), String> {
    for buf in from {
        let packed = zstd::bulk::compress(&buf, LEVEL).map_err(|e| format!("the citizen data: {e}"))?;
        file.write_all(&packed).map_err(|e| format!("the citizen data: {e}"))?;
    }
    file.flush().map_err(|e| format!("the citizen data: {e}"))
}

impl Capture {
    /// A new stream at `path` (replacing any there), opened with its segment row: the format, the run, from when, and
    /// the versions of the engine and the citizen's rules that wrote it.
    pub fn create(path: &str, run_id: &str, from_t: i64, citizen_version: &str) -> Result<Capture, String> {
        if let Some(d) = std::path::Path::new(path).parent().filter(|d| !d.as_os_str().is_empty()) {
            std::fs::create_dir_all(d).map_err(|e| format!("{}: {e}", d.display()))?;
        }
        let file = File::create(path).map_err(|e| format!("{path}: {e}"))?;
        let (to, from) = std::sync::mpsc::sync_channel::<Vec<u8>>(2);
        let writer = std::thread::Builder::new().name("citizen-data".into()).spawn(move || write_frames(file, from)).map_err(|e| e.to_string())?;
        let mut c = Capture { buf: Vec::with_capacity(FRAME + (1 << 16)), to: Some(to), writer: Some(writer), rows: 0 };
        let mut head = Map::new();
        head.insert("row".into(), "segment".into());
        head.insert("schema".into(), FORMAT.into());
        head.insert("run".into(), run_id.into());
        head.insert("from_t".into(), from_t.into());
        head.insert("engine".into(), super::ENGINE_VERSION.into());
        head.insert("citizen".into(), citizen_version.into());
        serde_json::to_writer(&mut c.buf, &Value::Object(head)).map_err(|e| e.to_string())?;
        c.buf.push(b'\n');
        Ok(c)
    }

    /// One step's rows, as `rows` made them.
    pub fn push(&mut self, rows: &[u8]) -> Result<(), String> {
        if rows.is_empty() {
            return Ok(());
        }
        self.rows += rows.iter().filter(|&&b| b == b'\n').count() as u64;
        self.buf.extend_from_slice(rows);
        if self.buf.len() >= FRAME {
            self.frame()?;
        }
        Ok(())
    }

    fn frame(&mut self) -> Result<(), String> {
        if self.buf.is_empty() {
            return Ok(());
        }
        let buf = std::mem::replace(&mut self.buf, Vec::with_capacity(FRAME + (1 << 16)));
        match &self.to {
            Some(to) if to.send(buf).is_ok() => Ok(()),
            // (The writer stopped: its error is what finish says.)
            _ => self.finish(),
        }
    }

    /// Everything held written out (at the run's end); the writer's error, if it had one.
    pub fn finish(&mut self) -> Result<(), String> {
        if self.to.is_some() && !self.buf.is_empty() {
            let buf = std::mem::take(&mut self.buf);
            let _ = self.to.as_ref().expect("checked").send(buf);
        }
        self.to = None;
        match self.writer.take() {
            Some(w) => w.join().map_err(|_| "the citizen data's writer panicked".to_string())?,
            None => Ok(()),
        }
    }
}

impl Drop for Capture {
    fn drop(&mut self) {
        let _ = self.finish();
    }
}

/// The rows of one step of a person's unit (`pid`, at `t`), appended to `out`, one JSON object a line:
/// - `turn`: each decision, as the mind recorded it (`decision`, the `decision` annotation's data), its count `n` and
///   its `draws`;
/// - `outcome`: what the person came to know of how things went, this step (`outcomes`, as the `outcome` annotation's);
/// - `record`: the change to the person's record the step asked the kernel to keep (`set`, `because`).
///
/// Built only from `kept`: no world state reaches it.
pub fn rows(kept: &Kept, pid: &str, t: i64, out: &mut Vec<u8>) {
    #[derive(Serialize)]
    struct Turn<'a> {
        row: &'static str,
        t: i64,
        p: &'a str,
        n: u64,
        decision: &'a Value,
        draws: &'a [Value],
    }
    #[derive(Serialize)]
    struct Outcomes<'a> {
        row: &'static str,
        t: i64,
        p: &'a str,
        outcomes: &'a [Value],
    }
    #[derive(Serialize)]
    struct Record<'a> {
        row: &'static str,
        t: i64,
        p: &'a str,
        set: &'a Value,
        #[serde(skip_serializing_if = "Option::is_none")]
        because: Option<&'a Value>,
    }
    let mut line = |r: &dyn erased::Row| {
        r.write(out);
        out.push(b'\n');
    };
    // (Every decision is a turn; its draws where the step kept them. A round taken up from a snapshot has none: a
    // snapshot is the same with the capture off, so it does not keep them.)
    for (i, d) in kept.decisions.iter().enumerate() {
        let c = kept.captured.iter().find(|c| c.at == i);
        let Some(n) = c.map(|c| c.n).or_else(|| d["n"].as_u64()) else { continue };
        line(&Turn { row: "turn", t, p: pid, n, decision: d, draws: c.map_or(&[][..], |c| &c.draws[..]) });
    }
    if !kept.outcomes.is_empty() {
        line(&Outcomes { row: "outcome", t, p: pid, outcomes: &kept.outcomes });
    }
    if let Some(change) = &kept.record {
        if change["set"].as_object().is_some_and(|s| !s.is_empty()) {
            let because = change.get("because").filter(|b| b.as_array().is_some_and(|b| !b.is_empty()));
            line(&Record { row: "record", t, p: pid, set: &change["set"], because });
        }
    }
}

mod erased {
    /// A row written as JSON (one trait object for the three kinds of row).
    pub trait Row {
        fn write(&self, out: &mut Vec<u8>);
    }
    impl<T: serde::Serialize> Row for T {
        fn write(&self, out: &mut Vec<u8>) {
            let _ = serde_json::to_writer(out, self);
        }
    }
}
