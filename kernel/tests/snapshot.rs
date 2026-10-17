//! Snapshot and fork (kernel/src/engine/snapshot.rs): a run saved at a moment and taken up again goes on exactly as it
//! would have (the same log entries byte for byte, the same state hash), on any number of threads, from memory or from
//! its bytes; forks of one moment are apart from each other from then on, and alike when given the same.

mod common;

use oikos_actors::sight::Action;
use oikos_kernel::engine::{Due, Engine, EngineOptions, Snapshot};
use serde_json::{json, Value};

const DAY: i64 = 86_400;

/// Riverbend with the weather bureau warning of two spells, the mayor a seat, everyone else standing idle.
fn world() -> Value {
    let mut c = common::riverbend();
    c["clock"]["run_seconds"] = json!(30 * DAY);
    for p in c["participants"].as_array_mut().unwrap() {
        if p["id"] == "inspector-system" {
            p["controller"] = json!({ "type": "code", "impl": "world.weather", "params": { "events": [{ "kind": "heatwave", "from_day": 6, "days": 3 }, { "kind": "storm", "from_day": 20, "days": 2 }], "lead_days": 2 } });
        }
    }
    c
}

fn opts(threads: usize) -> EngineOptions {
    EngineOptions { threads, stand_in: Some("idle".into()), share_at: 1, ..Default::default() }
}

/// What the mayor's seat does at its n-th wake (the same in every run that is meant to be the same).
/// ("Quiet": the mayor says nothing.)
fn mayor(n: usize, word: &str) -> Action {
    if n % 2 == 1 && word != "Quiet" {
        Action::Message { to: vec!["alice-self".into()], text: format!("{word} {n}"), re: None }
    } else {
        Action::wait()
    }
}

/// Drives an engine to its end, the mayor answering as `mayor` says from wake `from` on.
fn drive<W: std::io::Write>(e: &mut Engine<W>, mut n: usize, word: &str) -> String {
    loop {
        match e.next().unwrap() {
            Due::End => break,
            Due::Seats(seats) => {
                for s in seats {
                    n += 1;
                    e.submit(&s.key, mayor(n, word)).unwrap();
                }
            }
        }
    }
    e.finish().unwrap()
}

fn straight(threads: usize) -> (String, Vec<u8>) {
    let mut e = Engine::start(world(), "snap", Vec::new(), None, opts(threads)).unwrap();
    let h = drive(&mut e, 0, "Hello");
    (h, e.into_log())
}

#[test]
fn a_run_saved_between_moments_and_taken_up_again_from_its_bytes_is_the_run_it_would_have_been() {
    let (hash, log) = straight(4);
    let mut e = Engine::start(world(), "snap", Vec::new(), None, opts(4)).unwrap();
    let mut n = 0;
    // To day 12, then stop between moments.
    while let Some(due) = e.next_by(12 * DAY).unwrap() {
        match due {
            Due::End => panic!("the run ended before day 12"),
            Due::Seats(seats) => {
                for s in seats {
                    n += 1;
                    e.submit(&s.key, mayor(n, "Hello")).unwrap();
                }
            }
        }
    }
    assert!(e.t() <= 12 * DAY);
    let snap = e.snapshot().unwrap();
    assert!(snap.head.seats_waiting.is_empty());
    let bytes = snap.to_bytes().unwrap();
    let before = e.into_log();
    // Read back, on one thread this time.
    let back = Snapshot::from_bytes(&bytes).unwrap();
    assert_eq!(back.head, snap.head);
    let mut r = Engine::resume(&back, Vec::new(), None, opts(1)).unwrap();
    let h = drive(&mut r, n, "Hello");
    assert_eq!(h, hash, "the same final state");
    let mut whole = before;
    whole.extend(r.into_log());
    assert!(whole == log, "the log before the snapshot and the resumed run's after it are the straight run's, byte for byte");
    // And the log verifies and replays as one.
    let report = oikos_kernel::replay(&whole, None).unwrap();
    assert_eq!(report.state_hash, hash);
}

#[test]
fn a_run_saved_while_a_seat_thinks_goes_on_from_its_seats_action_and_forks_of_it_part_ways() {
    let (hash, log) = straight(2);
    let mut e = Engine::start(world(), "snap", Vec::new(), None, opts(2)).unwrap();
    let mut n = 0;
    // Up to the mayor's third wake, its action not yet given.
    let seat = loop {
        match e.next().unwrap() {
            Due::End => panic!("the mayor woke fewer than three times"),
            Due::Seats(mut seats) => {
                let s = seats.remove(0);
                if n == 2 {
                    break s;
                }
                n += 1;
                e.submit(&s.key, mayor(n, "Hello")).unwrap();
            }
        }
    };
    let snap = e.snapshot().unwrap();
    assert_eq!(snap.head.seats_waiting, vec![seat.key.clone()]);
    let snap = Snapshot::from_bytes(&snap.to_bytes().unwrap()).unwrap();
    let before = e.into_log();
    let mut forks = vec![];
    for (threads, word) in [(1, "Hello"), (14, "Hello"), (3, "Quiet"), (7, "Quiet")] {
        let mut f = Engine::resume(&snap, Vec::new(), None, opts(threads)).unwrap();
        f.submit(&seat.key, mayor(n + 1, word)).unwrap();
        let h = drive(&mut f, n + 1, word);
        forks.push((h, f.into_log()));
    }
    assert_eq!(forks[0].0, hash, "the fork given what the straight run was given is the straight run");
    let mut whole = before.clone();
    whole.extend(&forks[0].1);
    assert!(whole == log);
    assert_eq!(forks[0], forks[1], "on one thread and on fourteen");
    assert_ne!(forks[2].0, hash, "a fork whose mayor said something else is another world");
    assert_eq!(forks[2], forks[3], "two forks given the same are the same");
}

#[test]
fn a_fork_in_memory_leaves_the_run_it_was_taken_from_as_it_was() {
    let (hash, _) = straight(2);
    let mut e = Engine::start(world(), "snap", Vec::new(), None, opts(2)).unwrap();
    let mut n = 0;
    while let Some(due) = e.next_by(9 * DAY).unwrap() {
        if let Due::Seats(seats) = due {
            for s in seats {
                n += 1;
                e.submit(&s.key, mayor(n, "Hello")).unwrap();
            }
        }
    }
    let mut f = e.fork(Vec::new(), None, opts(2)).unwrap();
    let fh = drive(&mut f, n, "Quiet");
    assert_ne!(fh, hash);
    let h = drive(&mut e, n, "Hello");
    assert_eq!(h, hash, "the run itself goes on as if no fork had been taken");
}

#[test]
fn a_snapshot_of_another_format_or_cut_short_is_refused() {
    let e = Engine::start(world(), "snap", Vec::new(), None, opts(1)).unwrap();
    let bytes = e.snapshot().unwrap().to_bytes().unwrap();
    assert!(Snapshot::from_bytes(&bytes[..bytes.len() - 10]).is_err());
    assert!(Snapshot::from_bytes(b"not a snapshot at all").is_err());
}

