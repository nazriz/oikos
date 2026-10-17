//! The local HTTP/JSON service (renderer/src/server.ts's `/api`, in Rust): the routes of `crate::ROUTES`, on 127.0.0.1
//! only, GET only, `std::net` only, so the Three.js client reads a Rust index without a change. A run is opened lazily
//! on the first request that wants it (state none, indexing, ready, failed), in a background thread. A run may be a
//! finished log (`.jsonl`, `.jsonl.zst`), a live run fed by a poller (`RunSpec::live`), or an `Index` the caller
//! already holds and feeds (`RunSpec::attached`).
//!
//! ```no_run
//! use oikos_explore::service::{RunSpec, Service};
//! let svc = Service::new(vec![RunSpec::file("town", "runs/town.seed1.jsonl.zst", None)]);
//! let server = svc.serve("127.0.0.1:4322").unwrap();
//! println!("http://{}/api/runs", server.addr());
//! ```

use crate::{Index, Panel, RunIndex};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

type Poller = Arc<dyn Fn() -> Vec<String> + Send + Sync>;

/// Where a run's lines come from.
#[derive(Clone)]
pub enum Source {
    /// A finished log, and optionally the pilot viewer's data (`pilot.json`).
    File { log: PathBuf, pilot: Option<PathBuf> },
    /// A running log: `poll` is called every `interval` and returns the lines written since its last call.
    Live { poll: Poller, interval: Duration },
    /// An index the caller feeds itself.
    Attached(Arc<Index>),
}

/// One run the service can show.
#[derive(Clone)]
pub struct RunSpec {
    pub key: String,
    pub name: String,
    pub note: Option<String>,
    pub pilot: bool,
    pub mtime: u64,
    pub source: Source,
}

impl RunSpec {
    /// A finished log; the key is made safe for a URL.
    pub fn file(key: &str, log: impl AsRef<Path>, pilot_json: Option<PathBuf>) -> RunSpec {
        let log = log.as_ref().to_path_buf();
        let mtime = std::fs::metadata(&log)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        RunSpec {
            key: safe_key(key),
            name: key.to_string(),
            note: None,
            pilot: pilot_json.is_some(),
            mtime,
            source: Source::File { log, pilot: pilot_json },
        }
    }
    /// A run fed by a poller: a future Bevy engine or the kernel's `Stream::take`, attached to a running log.
    pub fn live(key: &str, interval: Duration, poll: impl Fn() -> Vec<String> + Send + Sync + 'static) -> RunSpec {
        RunSpec {
            key: safe_key(key),
            name: key.to_string(),
            note: Some("live".into()),
            pilot: false,
            mtime: 0,
            source: Source::Live { poll: Arc::new(poll), interval },
        }
    }
    /// An index the caller holds and feeds (it may be fed while the service answers).
    pub fn attached(key: &str, index: Arc<Index>) -> RunSpec {
        RunSpec { key: safe_key(key), name: key.to_string(), note: None, pilot: false, mtime: 0, source: Source::Attached(index) }
    }
}

fn safe_key(k: &str) -> String {
    k.chars().map(|c| if c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-') { c } else { '_' }).collect()
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum St {
    None,
    Indexing,
    Ready,
    Failed,
}
impl St {
    fn name(self) -> &'static str {
        match self {
            St::None => "none",
            St::Indexing => "indexing",
            St::Ready => "ready",
            St::Failed => "failed",
        }
    }
}

/// (state, message, when opening began, the index once there is one)
type RunState = (St, String, Option<Instant>, Option<Arc<Index>>);

struct Run {
    spec: RunSpec,
    st: Mutex<RunState>,
}

struct Shared {
    runs: Vec<Run>,
    single: Option<String>,
    stop: AtomicBool,
}

/// The service: the runs it can show.
pub struct Service {
    shared: Shared,
}

/// A response, before it goes on the wire (so routes can be tested without a socket).
pub struct Response {
    pub status: u16,
    pub content_type: &'static str,
    pub body: Vec<u8>,
}
impl Response {
    fn json(v: &Value) -> Response {
        Response { status: 200, content_type: "application/json", body: serde_json::to_vec(v).unwrap_or_default() }
    }
    fn text(status: u16, s: &str) -> Response {
        Response { status, content_type: "text/plain; charset=utf-8", body: s.as_bytes().to_vec() }
    }
}

/// A running server.
pub struct Server {
    addr: SocketAddr,
    shared: Arc<Service>,
    thread: Option<std::thread::JoinHandle<()>>,
}
impl Server {
    pub fn addr(&self) -> SocketAddr {
        self.addr
    }
    /// Stops accepting (live pollers stop too). Open requests finish.
    pub fn stop(&mut self) {
        self.shared.shared.stop.store(true, Ordering::SeqCst);
        let _ = TcpStream::connect(self.addr);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
    /// Blocks until the server is stopped (never, for the command line).
    pub fn join(mut self) {
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
    pub fn service(&self) -> &Arc<Service> {
        &self.shared
    }
}
impl Drop for Server {
    fn drop(&mut self) {
        self.stop();
    }
}

fn pct_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'%' if i + 2 < b.len() => {
                let h = std::str::from_utf8(&b[i + 1..i + 3]).ok().and_then(|x| u8::from_str_radix(x, 16).ok());
                match h {
                    Some(v) => {
                        out.push(v);
                        i += 3;
                    }
                    None => {
                        out.push(b'%');
                        i += 1;
                    }
                }
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn pct_decode_path(s: &str) -> String {
    // (decodeURIComponent: "+" stays a plus in a path)
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Some(v) = std::str::from_utf8(&b[i + 1..i + 3]).ok().and_then(|x| u8::from_str_radix(x, 16).ok()) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn parse_query(q: &str) -> HashMap<String, String> {
    q.split('&')
        .filter(|p| !p.is_empty())
        .map(|p| match p.split_once('=') {
            Some((k, v)) => (pct_decode(k), pct_decode(v)),
            None => (pct_decode(p), String::new()),
        })
        .collect()
}

fn digits(s: &str) -> Option<u32> {
    if !s.is_empty() && s.bytes().all(|c| c.is_ascii_digit()) {
        s.parse().ok()
    } else {
        None
    }
}

impl Service {
    pub fn new(runs: Vec<RunSpec>) -> Service {
        let mut seen: HashMap<String, usize> = HashMap::new();
        let runs = runs
            .into_iter()
            .map(|mut s| {
                let n = seen.entry(s.key.clone()).or_insert(0);
                if *n > 0 {
                    s.key = format!("{}-{}", s.key, n);
                }
                *n += 1;
                Run { spec: s, st: Mutex::new((St::None, String::new(), None, None)) }
            })
            .collect();
        Service { shared: Shared { runs, single: None, stop: AtomicBool::new(false) } }
    }

    /// The run the page opens on, and starts reading at once.
    pub fn single(mut self, key: &str) -> Service {
        self.shared.single = Some(key.to_string());
        self
    }

    /// Serves on `addr`, which must be a loopback address. The listener runs in a thread; the returned `Server` stops it.
    pub fn serve(self, addr: impl ToSocketAddrs) -> std::io::Result<Server> {
        let addr = addr.to_socket_addrs()?.next().ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "no address"))?;
        if !addr.ip().is_loopback() {
            return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, "the explorer serves 127.0.0.1 only"));
        }
        let listener = TcpListener::bind(addr)?;
        let addr = listener.local_addr()?;
        let svc = Arc::new(self);
        if let Some(k) = svc.shared.single.clone() {
            if let Some(r) = svc.run(&k) {
                svc.start(r);
            }
        }
        let s2 = svc.clone();
        let thread = std::thread::spawn(move || {
            for conn in listener.incoming() {
                if s2.shared.stop.load(Ordering::SeqCst) {
                    break;
                }
                if let Ok(c) = conn {
                    let s3 = s2.clone();
                    std::thread::spawn(move || {
                        let _ = s3.connection(c);
                    });
                }
            }
        });
        Ok(Server { addr, shared: svc, thread: Some(thread) })
    }

    fn run(&self, key: &str) -> Option<&Run> {
        self.shared.runs.iter().find(|r| r.spec.key == key)
    }

    /// The index of a run, if it is ready to answer.
    pub fn index_of(&self, key: &str) -> Option<Arc<Index>> {
        let r = self.run(key)?;
        let st = r.st.lock().unwrap_or_else(|e| e.into_inner());
        if st.0 == St::Ready {
            st.3.clone()
        } else {
            None
        }
    }

    fn state_of(&self, r: &Run) -> St {
        let mut st = r.st.lock().unwrap_or_else(|e| e.into_inner());
        // A live or attached run is ready once its header has been read.
        if st.0 == St::Indexing {
            if let (Some(ix), true) = (st.3.clone(), !matches!(r.spec.source, Source::File { .. })) {
                if ix.has_header() {
                    st.0 = St::Ready;
                }
            }
        }
        st.0
    }

    /// Starts reading a run, if it is not yet read or being read.
    fn start(self: &Arc<Self>, r: &Run) {
        let mut st = r.st.lock().unwrap_or_else(|e| e.into_inner());
        if matches!(st.0, St::Indexing | St::Ready) {
            return;
        }
        st.0 = St::Indexing;
        st.1 = "reading the log".into();
        st.2 = Some(Instant::now());
        let key = r.spec.key.clone();
        match &r.spec.source {
            Source::Attached(ix) => {
                st.3 = Some(ix.clone());
                if ix.has_header() {
                    st.0 = St::Ready;
                }
            }
            Source::File { log, pilot } => {
                let ix = Arc::new(Index::new());
                st.3 = Some(ix.clone());
                let (log, pilot) = (log.clone(), pilot.clone());
                let me = self.clone();
                std::thread::spawn(move || {
                    let res = ix.load_path(&log).map_err(|e| e.to_string()).map(|_| {
                        if let Some(p) = pilot {
                            // (the pilot's seats are optional: a pilot.json that cannot be read is left out)
                            if let Ok(text) = std::fs::read_to_string(&p) {
                                if let Ok(v) = serde_json::from_str::<Value>(&text) {
                                    ix.set_pilot(v);
                                }
                            }
                        }
                    });
                    if let Some(r) = me.run(&key) {
                        let mut st = r.st.lock().unwrap_or_else(|e| e.into_inner());
                        match res {
                            Ok(()) => st.0 = St::Ready,
                            Err(m) => {
                                st.0 = St::Failed;
                                st.1 = m;
                            }
                        }
                    }
                });
            }
            Source::Live { poll, interval } => {
                let ix = Arc::new(Index::new());
                ix.set_state("live");
                st.3 = Some(ix.clone());
                let (poll, interval) = (poll.clone(), *interval);
                let me = self.clone();
                std::thread::spawn(move || {
                    while !me.shared.stop.load(Ordering::SeqCst) {
                        let lines = poll();
                        if !lines.is_empty() {
                            ix.feed_all(lines);
                        }
                        std::thread::sleep(interval);
                    }
                });
            }
        }
    }

    fn connection(self: &Arc<Self>, mut c: TcpStream) -> std::io::Result<()> {
        c.set_read_timeout(Some(Duration::from_secs(10)))?;
        let mut buf = Vec::new();
        let mut chunk = [0u8; 4096];
        loop {
            let n = c.read(&mut chunk)?;
            if n == 0 {
                break;
            }
            buf.extend_from_slice(&chunk[..n]);
            if buf.windows(4).any(|w| w == b"\r\n\r\n") || buf.len() > 32 * 1024 {
                break;
            }
        }
        let head = String::from_utf8_lossy(&buf).into_owned();
        let mut lines = head.split("\r\n");
        let first = lines.next().unwrap_or("");
        let mut parts = first.split(' ');
        let method = parts.next().unwrap_or("");
        let target = parts.next().unwrap_or("/");
        let host = lines.find_map(|l| l.split_once(':').filter(|(k, _)| k.eq_ignore_ascii_case("host")).map(|(_, v)| v.trim().to_string()));
        let resp = if method != "GET" {
            Response::text(405, "read only")
        } else if host.as_deref().map(|h| !loopback_host(h)).unwrap_or(false) {
            Response::text(403, "127.0.0.1 only")
        } else {
            self.get(target)
        };
        let reason = match resp.status {
            200 => "OK",
            403 => "Forbidden",
            404 => "Not Found",
            405 => "Method Not Allowed",
            500 => "Internal Server Error",
            _ => "OK",
        };
        let mut out = format!(
            "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n",
            resp.status,
            reason,
            resp.content_type,
            resp.body.len()
        )
        .into_bytes();
        out.extend_from_slice(&resp.body);
        c.write_all(&out)?;
        c.flush()
    }

    /// Answers a GET (`/api/...?query`) without a socket. Needs the service in an `Arc` so a run can be started.
    pub fn get(self: &Arc<Self>, target: &str) -> Response {
        let (path, query) = target.split_once('?').unwrap_or((target, ""));
        let q = parse_query(query);
        if path == "/api/runs" {
            let runs: Vec<Value> = self
                .shared
                .runs
                .iter()
                .map(|r| {
                    let st = self.state_of(r);
                    json!({"key": r.spec.key, "name": r.spec.name, "note": r.spec.note, "pilot": r.spec.pilot, "mtime": r.spec.mtime, "state": st.name()})
                })
                .collect();
            return Response::json(&json!({"single": self.shared.single, "runs": runs}));
        }
        let Some(rest) = path.strip_prefix("/api/r/") else { return Response::text(404, "not found") };
        let Some((key, what)) = rest.split_once('/') else { return Response::text(404, "not found") };
        let Some(r) = self.run(&pct_decode_path(key)) else { return Response::text(404, "no such run") };
        let what = what.to_string();
        if what == "status" {
            if q.contains_key("open") {
                self.start(r);
            }
            let st = self.state_of(r);
            let g = r.st.lock().unwrap_or_else(|e| e.into_inner());
            let msg = self.message(r, st, &g.1, g.3.as_ref());
            let secs = g.2.map(|t| t.elapsed().as_secs()).unwrap_or(0);
            return Response::json(&json!({"state": st.name(), "message": msg, "seconds": secs}));
        }
        let st = self.state_of(r);
        let ix = if st == St::Ready { r.st.lock().unwrap_or_else(|e| e.into_inner()).3.clone() } else { None };
        let Some(ix) = ix else {
            self.start(r);
            let st = self.state_of(r);
            let g = r.st.lock().unwrap_or_else(|e| e.into_inner());
            let msg = self.message(r, st, &g.1, g.3.as_ref());
            return Response::json(&json!({"state": st.name(), "message": msg}));
        };
        let t: Option<i64> = q.get("t").and_then(|x| x.trim().parse::<f64>().ok()).map(|f| f as i64);
        self.answer(&ix, &what, &q, t)
    }

    fn message(&self, _r: &Run, st: St, m: &str, ix: Option<&Arc<Index>>) -> String {
        match (st, ix) {
            (St::Indexing, Some(ix)) => format!("reading the log: {} lines kept", ix.kept()),
            _ => m.to_string(),
        }
    }

    fn answer(&self, ix: &Arc<Index>, what: &str, q: &HashMap<String, String>, t: Option<i64>) -> Response {
        let missing = || Response::json(&json!({"missing": true}));
        if what == "world" {
            return match ix.world_json() {
                Some(v) => Response::json(&v),
                None => Response::json(&json!({"state": "indexing"})),
            };
        }
        if let Some(name) = what.strip_prefix("bin/") {
            let num = |k: &str| q.get(k).and_then(|x| x.trim().parse::<f64>().ok()).map(|f| f as i64);
            return match ix.track_bytes(name, num("from"), num("to")) {
                Some(b) => Response { status: 200, content_type: "application/octet-stream", body: b },
                None => Response::text(404, "no such track"),
            };
        }
        if let Some(id) = what.strip_prefix("person/") {
            return ix.panel_json(Panel::Person(pct_decode_path(id)), t).map(|v| Response::json(&v)).unwrap_or_else(missing);
        }
        if let Some(id) = what.strip_prefix("org/") {
            return ix.panel_json(Panel::Org(pct_decode_path(id)), t).map(|v| Response::json(&v)).unwrap_or_else(missing);
        }
        if let Some(n) = what.strip_prefix("building/") {
            if let Some(n) = digits(n) {
                return ix.panel_json(Panel::Building(n), t).map(|v| Response::json(&v)).unwrap_or_else(missing);
            }
        }
        if let Some(n) = what.strip_prefix("act/") {
            if let Some(n) = digits(n) {
                return ix.panel_json(Panel::SeatAct(n), t).map(|v| Response::json(&v)).unwrap_or_else(missing);
            }
        }
        if let Some(n) = what.strip_prefix("trace/") {
            if let Some(n) = digits(n) {
                let about = q.get("about").map(String::as_str).filter(|a| !a.is_empty());
                return ix.trace_json(n, about).map(|v| Response::json(&v)).unwrap_or_else(|| Response::text(500, "error: no such line"));
            }
        }
        if let Some(n) = what.strip_prefix("line/") {
            if let Some(n) = digits(n) {
                return match ix.line_text(n) {
                    Some(t) => Response { status: 200, content_type: "application/json", body: t.into_bytes() },
                    None => Response::text(500, "error: no such line"),
                };
            }
        }
        if let Some(id) = what.strip_prefix("seat/") {
            return Response::json(&ix.seat_json(&pct_decode_path(id)));
        }
        Response::text(404, "not found")
    }
}

fn loopback_host(h: &str) -> bool {
    let host = if let Some(rest) = h.strip_prefix('[') {
        rest.split(']').next().unwrap_or("")
    } else {
        h.rsplit_once(':').map(|(a, _)| a).unwrap_or(h)
    };
    matches!(host, "127.0.0.1" | "localhost" | "::1")
}
