//! The native shell: the same scene in a desktop window, with the explorer's data layer in this process (an
//! `oikos_explore::Index` fed from the run's log on a thread, so the town shows as soon as the header is read and the
//! rest is indexed behind it). Its interface is egui (ui.rs); the browser's is the HTML one (explorer/web).

use crate::bridge::Command;
use crate::scene::{push_command, MemProbe};
use crate::source::{Req, Resp, Source};
use crate::tracks::Need;
use oikos_explore::Index;
use std::path::PathBuf;
use std::sync::Arc;

/// The data layer in process: every ask is answered on a thread from the index (read-only).
pub struct IndexSource {
    pub index: Arc<Index>,
}

impl Source for IndexSource {
    fn ask(&self, _run: &str, req: Req, reply: crossbeam_channel::Sender<Resp>) {
        let ix = self.index.clone();
        std::thread::spawn(move || {
            let r = answer(&ix, req);
            let _ = reply.send(r);
        });
    }
    fn backend(&self) -> String {
        "native".into()
    }
}

/// One answer from the index, as the HTTP service gives it (kernel/crates/explore/src/service.rs).
pub fn answer(ix: &Index, req: Req) -> Resp {
    match req {
        Req::Status => {
            let state = if ix.state() == "indexing" || !ix.has_header() { "indexing" } else { ix.state() };
            Resp::Status { state: state.into(), message: format!("{} lines kept", ix.kept()), header: ix.has_header() }
        }
        Req::World => match ix.world_json() {
            Some(v) => Resp::World(v.to_string()),
            None => Resp::Failed(req, "no header yet".into()),
        },
        Req::Track(n) => {
            let (name, from, to) = match n {
                Need::Where { from, to } => ("where", from, to),
                Need::Moves { from, to } => ("moves", from, to),
            };
            match ix.track_bytes(name, Some(from), Some(to)) {
                Some(b) => Resp::Track(n, b),
                None => Resp::Failed(req, "no tracks yet".into()),
            }
        }
        Req::Bin(name) => match ix.track_bytes(name, None, None) {
            Some(b) => Resp::Bin(name, b),
            None => Resp::Failed(req, "no tracks yet".into()),
        },
        Req::DayRow(name, d) => match ix.track_bytes(name, Some(d), Some(d + 1)) {
            Some(b) => Resp::DayRow(name, d, b),
            None => Resp::Failed(req, "no tracks yet".into()),
        },
        Req::Decided { from, to } => match ix.by_building(from, to) {
            Some(counts) => Resp::Decided { from, to, counts },
            None => Resp::Failed(req, "no tracks yet".into()),
        },
    }
}

fn rss() -> u64 {
    std::fs::read_to_string("/proc/self/statm")
        .ok()
        .and_then(|s| s.split_whitespace().nth(1)?.parse::<u64>().ok())
        .map(|p| p * 4096)
        .unwrap_or(0)
}

pub fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut log: Option<PathBuf> = None;
    let mut pilot: Option<PathBuf> = None;
    let mut at: Option<i64> = None;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--pilot" => {
                pilot = args.get(i + 1).map(PathBuf::from);
                i += 1;
            }
            "--at" => {
                at = args.get(i + 1).and_then(|s| s.parse().ok());
                i += 1;
            }
            a => log = Some(PathBuf::from(a)),
        }
        i += 1;
    }
    let Some(log) = log else {
        eprintln!("usage: oikos-explorer <run log (.jsonl or .jsonl.zst)> [--pilot pilot.json] [--at SECONDS]");
        std::process::exit(2);
    };
    let index = Arc::new(Index::new());
    if let Some(p) = pilot {
        if let Ok(v) = std::fs::read_to_string(&p).map(|s| serde_json::from_str(&s).unwrap_or_default()) {
            index.set_pilot(v);
        }
    }
    {
        let ix = index.clone();
        let log = log.clone();
        std::thread::spawn(move || {
            if let Err(e) = ix.load_path(&log) {
                eprintln!("{}: {e}", log.display());
            }
        });
    }
    let run = log.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let mut app = crate::app(Arc::new(IndexSource { index: index.clone() }), Some(run), None);
    app.insert_resource(MemProbe(rss));
    crate::ui::add(&mut app, index);
    if let Some(t) = at {
        push_command(Command::SetTime { t });
    }
    push_command(Command::Stats { on: true });
    app.run();
}
