//! The binary log (kernel/src/blog.rs) and the live stream (kernel/src/stream.rs): the same entries as the JSONL log,
//! exported back byte for byte; snapshots among them that a fork carries on from, its own log naming its parent; the
//! stream handing on every entry as it is written.

use crate::common;

use oikos_actors::sight::Action;
use oikos_kernel::blog::{self, About, BinLog};
use oikos_kernel::engine::{Due, Engine, EngineOptions, Snapshot};
use oikos_kernel::log::Kind;
use oikos_kernel::stream::{Stream, Tee};
use serde_json::{json, Value};
use std::io::Write;

const DAY: i64 = 86_400;

fn world() -> Value {
    let mut c = common::riverbend();
    c["clock"]["run_seconds"] = json!(40 * DAY);
    for p in c["participants"].as_array_mut().unwrap() {
        if p["id"] == "inspector-system" {
            p["controller"] = json!({ "type": "code", "impl": "world.weather", "params": { "events": [{ "kind": "heatwave", "from_day": 6, "days": 3 }, { "kind": "storm", "from_day": 25, "days": 2 }], "lead_days": 2 } });
        }
    }
    common::alone(&mut c, &["world.weather"]);
    c
}

fn opts() -> EngineOptions {
    EngineOptions { threads: 2, stand_in: Some("idle".into()), share_at: 1, ..Default::default() }
}

fn mayor(n: usize) -> Action {
    if n % 2 == 1 {
        Action::Message { to: vec!["alice-self".into()], text: format!("Note {n}"), re: None }
    } else {
        Action::wait()
    }
}

/// Drives to the end, a snapshot put in the log every `every` days if `snap` is given.
fn drive<W: Write>(e: &mut Engine<W>, mut n: usize, every: Option<i64>, mut snap: impl FnMut(&mut Engine<W>, usize)) -> String {
    let mut at = every.map(|d| (e.t() / (d * DAY) + 1) * d * DAY);
    loop {
        let due = match at {
            Some(a) => match e.next_by(a).unwrap() {
                Some(d) => d,
                None => {
                    snap(e, n);
                    at = at.map(|a| a + every.unwrap() * DAY);
                    continue;
                }
            },
            None => e.next().unwrap(),
        };
        match due {
            Due::End => break,
            Due::Seats(seats) => {
                for s in seats {
                    n += 1;
                    e.submit(&s.key, mayor(n)).unwrap();
                }
            }
        }
    }
    e.finish().unwrap()
}

fn jsonl() -> (String, Vec<u8>) {
    let mut e = Engine::start(world(), "blog", Vec::new(), None, opts()).unwrap();
    let h = drive(&mut e, 0, None, |_, _| {});
    (h, e.into_log())
}

fn dir(name: &str) -> std::path::PathBuf {
    let d = std::path::Path::new(env!("CARGO_TARGET_TMPDIR")).join(name);
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

#[test]
fn the_binary_log_holds_the_jsonl_logs_entries_and_gives_them_back_byte_for_byte() {
    let (hash, log) = jsonl();
    let out = BinLog::new(Vec::new(), &About { run_id: "blog".into(), ..Default::default() }).unwrap();
    let mut e = Engine::start(world(), "blog", out, None, opts()).unwrap();
    let h = drive(&mut e, 0, Some(10), |e, _| {
        let bytes = e.snapshot().unwrap().to_bytes().unwrap();
        let t = e.t();
        e.log_out().snapshot(t, &bytes).unwrap();
    });
    assert_eq!(h, hash, "putting snapshots in the log changes nothing in the run");
    let bin = e.into_log().into_inner().unwrap();
    let r = blog::Read::of(&bin).unwrap();
    assert!(!r.cut_short);
    let mut back = Vec::new();
    r.export(None, &mut back).unwrap();
    assert!(back == log, "the export is the JSONL log");
    assert_eq!(r.snapshots().len(), 3, "days 10, 20 and 30");
    eprintln!("JSONL {} bytes; binary {} bytes with three snapshots", log.len(), bin.len());
}

#[test]
fn a_fork_from_a_snapshot_in_the_log_writes_its_own_log_and_its_export_is_the_whole_run() {
    let (hash, log) = jsonl();
    let d = dir("fork");
    let out = BinLog::new(std::fs::File::create(d.join("parent.oklog")).unwrap(), &About { run_id: "blog".into(), ..Default::default() }).unwrap();
    let mut e = Engine::start(world(), "blog", out, None, opts()).unwrap();
    let mut wakes = std::collections::BTreeMap::new();
    drive(&mut e, 0, Some(10), |e, n| {
        let bytes = e.snapshot().unwrap().to_bytes().unwrap();
        let t = e.t();
        wakes.insert(e.log_head().0, n);
        e.log_out().snapshot(t, &bytes).unwrap();
    });
    e.into_log().into_inner().unwrap();
    let bin = std::fs::read(d.join("parent.oklog")).unwrap();
    let r = blog::Read::of(&bin).unwrap();
    let (seq, bytes) = r.snapshot_by(Some(20 * DAY)).unwrap();
    let snap = Snapshot::from_bytes(bytes).unwrap();
    assert_eq!(snap.head.next_seq, seq);
    let about = About { run_id: "blog".into(), parent: Some("parent.oklog".into()), label: Some("from day 20".into()) };
    let out = BinLog::from_entry(std::fs::File::create(d.join("fork.oklog")).unwrap(), &about, seq, &snap.head.prev).unwrap();
    let mut f = Engine::resume(&snap, out, None, opts()).unwrap();
    assert_eq!(drive(&mut f, wakes[&seq], None, |_, _| {}), hash);
    f.into_log().into_inner().unwrap();
    let mut whole = Vec::new();
    blog::export_file(&d.join("fork.oklog"), &mut whole).unwrap();
    assert!(whole == log, "the parent's entries to the snapshot, then the fork's: the straight run's log");
    assert_eq!(oikos_kernel::replay(&whole, None).unwrap().state_hash, hash);
}

#[test]
fn a_binary_log_cut_off_mid_frame_reads_back_to_its_last_whole_frame() {
    let (_, log) = jsonl();
    let mut out = BinLog::new(Vec::new(), &About { run_id: "blog".into(), ..Default::default() }).unwrap();
    let lines: Vec<&[u8]> = log.split_inclusive(|b| *b == b'\n').collect();
    for l in &lines[..40] {
        out.write_all(l).unwrap();
    }
    out.flush().unwrap();
    for l in &lines[40..] {
        out.write_all(l).unwrap();
    }
    let mut bin = out.into_inner().unwrap();
    bin.truncate(bin.len() - 7);
    let r = blog::Read::of(&bin).unwrap();
    assert!(r.cut_short);
    let mut back = Vec::new();
    assert_eq!(r.export(None, &mut back).unwrap(), 40);
    assert!(back == lines[..40].concat());
}

#[test]
fn the_stream_hands_on_every_event_as_it_is_written_and_tells_a_watcher_that_fell_behind_what_it_missed() {
    let (hash, log) = jsonl();
    let stream = Stream::new(1_000_000, vec![Kind::Event]);
    let mut e = Engine::start(world(), "blog", Tee::new(Vec::new(), Some(stream.clone())), None, opts()).unwrap();
    let mut seen = vec![];
    let mut n = 0;
    loop {
        match e.next().unwrap() {
            Due::End => break,
            Due::Seats(seats) => {
                // (Watched while the run waits on its seat: what has happened so far is there.)
                seen.extend(stream.take(usize::MAX).0);
                for s in seats {
                    n += 1;
                    e.submit(&s.key, mayor(n)).unwrap();
                }
            }
        }
    }
    assert_eq!(e.finish().unwrap(), hash);
    seen.extend(stream.take(usize::MAX).0);
    let events: Vec<&[u8]> = log.split(|b| *b == b'\n').filter(|l| blog::parse_line(l).is_some_and(|p| p.kind == Kind::Event)).collect();
    assert_eq!(seen.len(), events.len());
    assert!(seen.iter().zip(&events).all(|(a, b)| a.as_slice() == *b));
    // A watcher that takes nothing holds at most its cap, and is told how many it missed.
    let small = Stream::new(5, vec![]);
    let mut e = Engine::start(world(), "blog", Tee::new(std::io::sink(), Some(small.clone())), None, opts()).unwrap();
    drive(&mut e, 0, None, |_, _| {});
    let (lines, missed) = small.take(100);
    assert_eq!(lines.len(), 5);
    assert_eq!(missed as usize + 5, log.split(|b| *b == b'\n').filter(|l| !l.is_empty()).count());
}
