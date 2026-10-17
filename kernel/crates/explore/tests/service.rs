//! The HTTP service and the read-only rule (renderer/test/read-only.test.ts, in Rust): indexing and serving a run
//! leave every file in its folder with the same bytes and times; the service answers GET only, on 127.0.0.1 only, and
//! never shows a debrief; a live run answers while it is fed.

use oikos_explore::service::{RunSpec, Service};
use serde_json::Value;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::{Arc, Mutex};
use std::time::Duration;

const FIXTURE: &str = include_str!("fixture.jsonl");

fn http(addr: std::net::SocketAddr, method: &str, path: &str, host: Option<&str>) -> (u16, Vec<u8>) {
    let mut c = TcpStream::connect(addr).unwrap();
    let host = host.map(String::from).unwrap_or_else(|| addr.to_string());
    write!(c, "{method} {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n").unwrap();
    let mut buf = vec![];
    c.read_to_end(&mut buf).unwrap();
    let split = buf.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
    let head = String::from_utf8_lossy(&buf[..split]).to_string();
    let status: u16 = head.split(' ').nth(1).unwrap().parse().unwrap();
    (status, buf[split + 4..].to_vec())
}
fn json(addr: std::net::SocketAddr, path: &str) -> Value {
    let (s, b) = http(addr, "GET", path, None);
    assert_eq!(s, 200, "{path}");
    serde_json::from_slice(&b).unwrap_or_else(|e| panic!("{path}: {e}: {}", String::from_utf8_lossy(&b)))
}
fn wait_ready(addr: std::net::SocketAddr, key: &str) {
    for _ in 0..200 {
        let st = json(addr, &format!("/api/r/{key}/status?open=1"));
        if st["state"] == "ready" {
            return;
        }
        assert_ne!(st["state"], "failed", "{st}");
        std::thread::sleep(Duration::from_millis(25));
    }
    panic!("never ready");
}
fn snapshot(dir: &std::path::Path) -> Vec<(String, u64, std::time::SystemTime, Vec<u8>)> {
    let mut v: Vec<_> = std::fs::read_dir(dir)
        .unwrap()
        .map(|e| {
            let e = e.unwrap();
            let m = e.metadata().unwrap();
            (e.file_name().to_string_lossy().to_string(), m.len(), m.modified().unwrap(), std::fs::read(e.path()).unwrap())
        })
        .collect();
    v.sort_by(|a, b| a.0.cmp(&b.0));
    v
}

#[test]
fn serving_a_run_changes_nothing_in_its_folder_and_answers_get_on_loopback_only() {
    let base = std::env::temp_dir().join(format!("oikos-explore-svc-{}", std::process::id()));
    let dir = base.join("fixture-run");
    std::fs::create_dir_all(&dir).unwrap();
    let log = dir.join("fixture.seed1.jsonl");
    std::fs::write(&log, FIXTURE).unwrap();
    let before = snapshot(&dir);
    let mut server = Service::new(vec![RunSpec::file("fx", &log, None)]).single("fx").serve("127.0.0.1:0").unwrap();
    let addr = server.addr();
    assert!(addr.ip().is_loopback());
    wait_ready(addr, "fx");
    let runs = json(addr, "/api/runs");
    assert_eq!(runs["single"], "fx");
    assert_eq!(runs["runs"][0]["state"], "ready");
    let world = json(addr, "/api/r/fx/world");
    assert_eq!(world["meta"]["persons"], 2);
    assert_eq!(world["seatActs"].as_array().unwrap().len(), 1);
    assert_eq!(world["persons"], serde_json::json!(["c1", "c2"]));
    let person = json(addr, &format!("/api/r/fx/person/c1?t={}", 3 * 86400));
    assert_eq!(person["home"]["structure"], "house-1");
    let ord = world["seatActs"][0]["ord"].as_u64().unwrap();
    let act = json(addr, &format!("/api/r/fx/act/{ord}"));
    assert_eq!(act["trace"][0]["role"], "act");
    assert_eq!(act["trace"][0]["cls"], "seat");
    let tr = json(addr, &format!("/api/r/fx/trace/{ord}?about=c1"));
    assert_eq!(tr["row"]["ord"], ord);
    assert!(tr["links"].as_array().unwrap().len() > 1);
    assert_eq!(json(addr, "/api/r/fx/person/nobody")["missing"], true);
    assert_eq!(json(addr, "/api/r/fx/building/2")["usedBy"][0]["id"], "tribunal");
    assert_eq!(json(addr, "/api/r/fx/org/tribunal")["posts"][0]["cls"], "seat");
    // the line as the log has it, and the binary tracks
    let (s, line) = http(addr, "GET", "/api/r/fx/line/0", None);
    assert_eq!(s, 200);
    assert_eq!(String::from_utf8(line).unwrap(), FIXTURE.lines().nth(1).unwrap());
    let days = world["meta"]["days"].as_u64().unwrap() as usize;
    let (_, w) = http(addr, "GET", "/api/r/fx/bin/where", None);
    assert_eq!(w.len(), (days + 1) * 2 * 4);
    let (_, m) = http(addr, "GET", "/api/r/fx/bin/money", None);
    assert_eq!(m.len(), (days + 1) * 4 * 8);
    let (_, a) = http(addr, "GET", "/api/r/fx/bin/agency", None);
    assert_eq!(a.len(), (days + 1) * 2 * 2);
    assert_eq!(i16::from_le_bytes([a[2 * 2 * 2], a[2 * 2 * 2 + 1]]), 4100); // day 2, c1
    let (_, p) = http(addr, "GET", "/api/r/fx/bin/pulses", None);
    assert_eq!(p.len(), 5 * 6 * 4);
    let (_, mv) = http(addr, "GET", "/api/r/fx/bin/moves?from=1&to=2", None);
    assert_eq!(mv.len(), 2 * 3 * 4); // c2 goes to work (vacate + occupy) on day 1
    assert_eq!(http(addr, "GET", "/api/r/fx/bin/nothing", None).0, 404);
    // read only, loopback only, and no debrief anywhere
    assert_eq!(http(addr, "POST", "/api/r/fx/world", None).0, 405);
    assert_eq!(http(addr, "GET", "/api/runs", Some("evil.example")).0, 403);
    assert_eq!(http(addr, "GET", "/api/r/nope/world", None).0, 404);
    for p in ["world", "person/c1", "org/tribunal", "trace/3", "bin/where"] {
        let (_, b) = http(addr, "GET", &format!("/api/r/fx/{p}"), None);
        assert!(!String::from_utf8_lossy(&b).contains("SECRET-DEBRIEF"), "{p}");
    }
    server.stop();
    assert!(Service::new(vec![]).serve("0.0.0.0:0").is_err(), "a non-loopback address is refused");
    assert_eq!(snapshot(&dir), before, "the run's folder is unchanged");
    std::fs::remove_dir_all(&base).ok();
}

#[test]
fn a_live_run_answers_while_a_poller_feeds_it() {
    let pending: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(vec![]));
    let p2 = pending.clone();
    let mut server = Service::new(vec![RunSpec::live("live", Duration::from_millis(10), move || std::mem::take(&mut *p2.lock().unwrap()))])
        .single("live")
        .serve("127.0.0.1:0")
        .unwrap();
    let addr = server.addr();
    let lines: Vec<String> = FIXTURE.lines().map(String::from).collect();
    // nothing yet: not ready
    assert_ne!(json(addr, "/api/r/live/status?open=1")["state"], "ready");
    pending.lock().unwrap().extend(lines[..12].iter().cloned());
    wait_ready(addr, "live");
    let wait_kept = |n: u64| {
        for _ in 0..200 {
            if json(addr, "/api/r/live/world")["meta"]["kept"].as_u64().unwrap() >= n {
                return;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        panic!("the poller did not feed");
    };
    wait_kept(3);
    let mid = json(addr, "/api/r/live/world");
    assert_eq!(mid["meta"]["state"], "live");
    let kept_mid = mid["meta"]["kept"].as_u64().unwrap();
    assert!(json(addr, "/api/r/live/person/c1").get("missing").is_none());
    pending.lock().unwrap().extend(lines[12..].iter().cloned());
    wait_kept(kept_mid + 3);
    let end = json(addr, "/api/r/live/world");
    assert!(end["meta"]["lastT"].as_i64().unwrap() > mid["meta"]["lastT"].as_i64().unwrap());
    assert_eq!(end["meta"]["end"]["reason"], "completed");
    assert_eq!(json(addr, "/api/runs")["runs"][0]["state"], "ready");
    server.stop();
}
