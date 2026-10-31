//! The engine as a host in another language sees it (kernel/src/host.rs, served by the N-API module): JSON in and out;
//! seats of several forks out at once; a fork's binary log naming its parent, its export the whole run; the live
//! stream; a seat that sits as its code twin through a detached actor deciding exactly as the code would; the shared
//! rules by name.

use crate::common;

use oikos_kernel::host::{Detached, Host};
use serde_json::{json, Value};

const DAY: i64 = 86_400;

fn world() -> Value {
    let mut c = common::riverbend();
    c["clock"]["run_seconds"] = json!(30 * DAY);
    for p in c["participants"].as_array_mut().unwrap() {
        if p["id"] == "inspector-system" {
            p["controller"] = json!({ "type": "code", "impl": "world.weather", "params": { "events": [{ "kind": "heatwave", "from_day": 6, "days": 3 }, { "kind": "storm", "from_day": 20, "days": 2 }], "lead_days": 2 } });
        }
    }
    common::alone(&mut c, &["world.weather"]);
    c
}

fn dir(name: &str) -> std::path::PathBuf {
    let d = std::path::Path::new(env!("CARGO_TARGET_TMPDIR")).join(name);
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn seat_action(n: usize, word: &str) -> Value {
    if n % 2 == 1 && word != "quiet" {
        json!({ "type": "message", "to": ["alice-self"], "text": format!("{word} {n}") })
    } else {
        json!({ "type": "wait" })
    }
}

/// Drives a host to its end; the seat's n-th wake answered by `seat_action`.
fn drive(h: &mut Host, mut n: usize, word: &str) -> Value {
    loop {
        let due = h.next().unwrap();
        match due["due"].as_str().unwrap() {
            "end" => break,
            "seats" => {
                for s in due["seats"].as_array().unwrap() {
                    n += 1;
                    assert!(s["observation"]["channels"].is_object());
                    h.submit(s["key"].as_str().unwrap(), &seat_action(n, word)).unwrap();
                }
            }
            other => panic!("{other}"),
        }
    }
    h.finish().unwrap()
}

#[test]
fn a_host_drives_a_world_by_json_and_forks_of_it_run_side_by_side_with_their_seats_out_at_once() {
    let d = dir("host-forks");
    let opts = |log: &str| json!({ "run_id": "host", "log": d.join(log).display().to_string(), "threads": 2, "stand_in": "idle", "share_at": 1, "snapshot_every_days": 10 });
    let mut straight = Host::start(world(), &opts("straight.oklog")).unwrap();
    let end = drive(&mut straight, 0, "Hello");
    // The same world to day 12, then three forks, their seats answered in turn, round by round.
    let mut h = Host::start(world(), &opts("parent.oklog")).unwrap();
    let mut n = 0;
    loop {
        let due = h.next_by(12 * DAY).unwrap();
        if due["due"] == "paused" {
            break;
        }
        for s in due["seats"].as_array().unwrap() {
            n += 1;
            h.submit(s["key"].as_str().unwrap(), &seat_action(n, "Hello")).unwrap();
        }
    }
    let words = ["Hello", "quiet", "quiet"];
    let mut forks: Vec<Host> = (0..3).map(|i| h.fork(&json!({ "log": d.join(format!("fork{i}.oklog")).display().to_string(), "threads": 1 + i * 6 })).unwrap()).collect();
    let mut counts = vec![n; 3];
    let mut ended = vec![None; 3];
    // (Round by round across the forks: each fork's seats are out while the others' are, as a host awaiting several
    // models at once would have them.)
    while ended.iter().any(Option::is_none) {
        let mut out = vec![];
        for (i, f) in forks.iter_mut().enumerate() {
            if ended[i].is_some() {
                continue;
            }
            let due = f.next().unwrap();
            if due["due"] == "end" {
                ended[i] = Some(f.finish().unwrap());
            } else {
                out.push((i, due));
            }
        }
        for (i, due) in out {
            for s in due["seats"].as_array().unwrap() {
                counts[i] += 1;
                forks[i].submit(s["key"].as_str().unwrap(), &seat_action(counts[i], words[i])).unwrap();
            }
        }
    }
    let ended: Vec<Value> = ended.into_iter().map(Option::unwrap).collect();
    assert_eq!(ended[0]["state_hash"], end["state_hash"], "the fork given what the straight run was given is the straight run");
    assert_ne!(ended[1]["state_hash"], end["state_hash"]);
    assert_eq!(ended[1]["state_hash"], ended[2]["state_hash"], "forks given the same, on 7 and 13 threads, are alike");
    // The parent flushed what it had when it forked; its fork's export is the whole straight run.
    drop(h);
    let mut a = vec![];
    oikos_kernel::blog::export_file(&d.join("straight.oklog"), &mut a).unwrap();
    let mut b = vec![];
    oikos_kernel::blog::export_file(&d.join("fork0.oklog"), &mut b).unwrap();
    assert!(a == b, "the fork's log, after its parent's to the fork, is the straight run's");
    assert_eq!(oikos_kernel::replay(&b, None).unwrap().state_hash, end["state_hash"].as_str().unwrap());
    // Snapshots every ten days are in the straight run's log, and a run resumed from one is the straight run.
    let bin = std::fs::read(d.join("straight.oklog")).unwrap();
    let r = oikos_kernel::blog::Read::of(&bin).unwrap();
    // (Each is of the world as it stood at the last moment before the day: nothing happens between moments.)
    let snaps = r.snapshots();
    assert_eq!(snaps.len(), 2, "{snaps:?}");
    assert!(snaps[0].1 <= 10 * DAY && snaps[1].1 <= 20 * DAY && snaps[0].1 < snaps[1].1, "{snaps:?}");
    // Each is taken without the config (the log's header has it once), and reads back with it, to be resumed.
    let (_, bytes) = r.snapshot_by(Some(20 * DAY)).unwrap();
    assert!(oikos_kernel::engine::Snapshot::from_bytes(bytes).is_err(), "it holds no config of its own");
    let snap = oikos_kernel::blog::snapshot_in(&d.join("straight.oklog"), Some(20 * DAY)).unwrap();
    assert!(bytes.len() < snap.to_bytes().unwrap().len());
    let mut again = Host::resume(&snap.to_bytes().unwrap(), &json!({ "threads": 3 })).unwrap();
    assert_eq!(drive(&mut again, 0, "quiet")["t"], end["t"]);
}

#[test]
fn the_host_stream_gives_the_log_entries_as_they_come_and_the_host_records_its_seats_usage() {
    let mut h = Host::start(world(), &json!({ "run_id": "host", "stand_in": "idle", "stream": { "cap": 100000, "kinds": ["annotation"] } })).unwrap();
    let mut n = 0;
    let mut usage = 0;
    loop {
        let due = h.next().unwrap();
        if due["due"] == "end" {
            break;
        }
        for s in due["seats"].as_array().unwrap() {
            n += 1;
            // (A seat's model call, as the host records it: who it was for, and its cost.)
            h.annotate(json!({ "annotation": "usage", "purpose": "participant", "subject": s["participant"], "provider": "mock", "model": "mock", "input_tokens": 100, "output_tokens": 10, "cost_microusd": 0 })).unwrap();
            usage += 1;
            h.submit(s["key"].as_str().unwrap(), &seat_action(n, "Hi")).unwrap();
        }
    }
    let ev = h.events(1_000_000);
    let entries = ev["entries"].as_array().unwrap();
    let usages = entries.iter().filter(|e| e["body"]["annotation"] == "usage" && e["body"]["subject"] == "mayor-system").count();
    assert_eq!(usages, usage);
    assert!(entries.iter().all(|e| e["kind"] == "annotation"), "only the kinds asked for");
    assert!(h.annotate(json!({ "annotation": "usage" })).is_err(), "the contract checks what the host records");
    h.finish().unwrap();
    let log = h.log_bytes().unwrap();
    assert!(oikos_kernel::log::verify(&log, None).is_ok());
}

#[test]
fn a_seat_that_sits_as_its_code_twin_through_a_detached_actor_does_what_the_code_does() {
    // The code run: the weather bureau is code.
    let mut code = Host::start(world(), &json!({ "stand_in": "idle" })).unwrap();
    drive(&mut code, 0, "quiet");
    let code_log = code.log_bytes().unwrap();
    // The twin run: the bureau's participant is a mock seat whose brain is the bureau, decided by a detached actor.
    let mut c = world();
    let mut spec = json!(null);
    for p in c["participants"].as_array_mut().unwrap() {
        if p["id"] == "inspector-system" {
            let params = p["controller"]["params"].clone();
            p["controller"] = json!({ "type": "llm", "impl": "mock", "params": { "mock": { "twin": true, "brain": "world.weather", "params": params } } });
            spec = json!({ "kind": "world.weather", "participant": "inspector-system", "capacity": "inspector", "entity": "city", "system": true, "params": params });
        }
    }
    spec["config"] = c.clone();
    let mut brain = Detached::new(&spec).unwrap();
    let mut twin = Host::start(c, &json!({ "stand_in": "idle" })).unwrap();
    let mut n = 0;
    loop {
        let due = twin.next().unwrap();
        if due["due"] == "end" {
            break;
        }
        for s in due["seats"].as_array().unwrap() {
            let a = if s["participant"] == "inspector-system" {
                let r = brain.step(&s["observation"], s["woke_for"].as_str().unwrap(), s["since"].as_i64().unwrap(), &Value::Null).unwrap();
                r["action"].clone()
            } else {
                n += 1;
                seat_action(n, "quiet")
            };
            twin.submit(s["key"].as_str().unwrap(), &a).unwrap();
        }
    }
    twin.finish().unwrap();
    let twin_log = twin.log_bytes().unwrap();
    let warnings = |log: &[u8]| -> Vec<(i64, Value)> {
        log.split(|b| *b == b'\n')
            .filter(|l| !l.is_empty())
            .map(|l| serde_json::from_slice::<Value>(l).unwrap())
            .filter(|l| l["body"]["record"]["kind"] == "weather_warning")
            .map(|l| (l["body"]["record"]["at"].as_i64().unwrap(), l["body"]["record"]["text"].clone()))
            .collect()
    };
    let (a, b) = (warnings(&code_log), warnings(&twin_log));
    assert_eq!(a.len(), 2);
    assert_eq!(a, b, "the twin warned when the code did, in the same words");
}

#[test]
fn the_shared_rules_are_served_by_name() {
    let words = oikos_kernel::rules_api::call("forms.plan_law_words", &json!({ "plan_months": 6, "plan_consider": "must", "cure_days": 14 })).unwrap();
    assert!(words.as_str().unwrap().contains("must consider"), "{words}");
    let m = oikos_kernel::rules_api::call("actors.manifests", &json!({})).unwrap();
    assert!(m["world.weather"].is_object());
    assert!(oikos_kernel::rules_api::call("no.such", &json!({})).is_err());
}

/// The laws' words are written once, here, with the town's currency served as data (MT-18): the sum of a budget's lines
/// written as the town writes its money, whole units without decimals where the sum is round.
#[test]
fn the_words_of_the_laws_are_written_in_the_towns_currency() {
    let currency = json!({ "code": "ZZZ", "minor_units": 2, "symbol": "z", "symbol_after": true, "symbol_spaced": true, "unit_words": ["zed"], "minor_words": ["zeds"] });
    let lines = oikos_kernel::rules_api::call("words.lines", &json!({ "lines": [["parks", 15_000_000], ["staff", 46_928_568]], "currency": currency })).unwrap();
    assert_eq!(lines.as_str().unwrap(), "parks 150,000 z, staff 469,285.68 z; 619,285.68 z in all");
    let tax = oikos_kernel::rules_api::call("words.withholding", &json!({ "period_days": 30 })).unwrap();
    assert!(tax.as_str().unwrap().contains("a pay for 30 days is 30/365 of a year's pay"));
    let none = oikos_kernel::rules_api::call("words.payments", &json!({ "payments": [], "currency": currency })).unwrap();
    assert_eq!(none.as_str().unwrap(), "");
    assert!(oikos_kernel::rules_api::call("words.lines", &json!({ "lines": [] })).is_err(), "no currency, no words");
}

/// The papers of a kind a run's log (JSONL, kept in memory) recorded, with when; and its `withheld` notes.
fn papers(log: &[u8], kind: &str) -> (Vec<i64>, Vec<Value>) {
    let lines: Vec<Value> = log.split(|b| *b == b'\n').filter(|l| !l.is_empty()).map(|l| serde_json::from_slice::<Value>(l).unwrap()).collect();
    let at = lines.iter().filter(|l| l["body"]["record"]["kind"] == kind).map(|l| l["body"]["record"]["at"].as_i64().unwrap()).collect();
    let notes = lines.iter().filter(|l| l["body"]["annotation"] == "note" && l["body"]["data"]["withheld"].is_object()).map(|l| l["body"]["data"]["withheld"].clone()).collect();
    (at, notes)
}

#[test]
fn a_fork_can_withhold_one_named_act_and_is_otherwise_its_parent_to_the_hash() {
    // (Risk MT-19: the counterfactual arm. The weather bureau's two warnings; a fork at day 1 that withholds the first.)
    let mut straight = Host::start(world(), &json!({ "stand_in": "idle" })).unwrap();
    let end = drive(&mut straight, 0, "quiet");
    let (warned, none) = papers(&straight.log_bytes().unwrap(), "weather_warning");
    assert_eq!((warned.len(), none.len()), (2, 0));
    let mut h = Host::start(world(), &json!({ "stand_in": "idle" })).unwrap();
    loop {
        let due = h.next_by(DAY).unwrap();
        if due["due"] == "paused" {
            break;
        }
        for s in due["seats"].as_array().unwrap() {
            h.submit(s["key"].as_str().unwrap(), &json!({ "type": "wait" })).unwrap();
        }
    }
    let run = |h: &mut Host, withhold: Value| -> (Value, Vec<i64>, Vec<Value>) {
        let mut f = h.fork(&json!({ "stand_in": "idle", "withhold": withhold })).unwrap();
        let end = drive(&mut f, 0, "quiet");
        let (at, notes) = papers(&f.log_bytes().unwrap(), "weather_warning");
        (end["state_hash"].clone(), at, notes)
    };
    // Withheld: the first warning never reaches the town; the second does, when it did; the log says which was withheld.
    let (hash, at, notes) = run(&mut h, json!([{ "what": "weather_warning", "participant": "inspector-system" }]));
    assert_ne!(hash, end["state_hash"]);
    assert_eq!(at, warned[1..].to_vec());
    assert_eq!(notes.len(), 1);
    assert_eq!((notes[0]["what"].as_str(), notes[0]["nth"].as_u64(), notes[0]["participant"].as_str()), (Some("weather_warning"), Some(1), Some("inspector-system")));
    assert!(notes[0]["t"].as_i64().unwrap() <= warned[0]);
    // Deterministic: the same withholding twice is the same world.
    assert_eq!(run(&mut h, json!([{ "what": "weather_warning", "participant": "inspector-system", "nth": 1 }])).0, hash);
    // The second, not the first.
    // (Only a paper whose data has a field: the warnings' data has its kind, so `has: "kind"` is the first warning again.)
    assert_eq!(run(&mut h, json!([{ "what": "weather_warning", "has": "kind", "nth": 1 }])).0, hash);
    let (second, at, _) = run(&mut h, json!([{ "what": "weather_warning", "nth": 2 }]));
    assert_eq!(at, warned[..1].to_vec());
    assert_ne!(second, hash);
    // Nothing named that comes (a third warning; another's; a kind never made): the parent's world to the hash, no note.
    for w in [json!([{ "what": "weather_warning", "nth": 3 }]), json!([{ "what": "weather_warning", "participant": "alice-self" }]), json!([{ "what": "no_such_paper" }]), json!([{ "what": "weather_warning", "matter": "no_such_matter" }]), json!([{ "what": "weather_warning", "to": "nobody" }]), json!([{ "what": "weather_warning", "has": "no_such_field" }]), json!([])] {
        let (h2, at, notes) = run(&mut h, w.clone());
        assert_eq!((h2, at, notes.len()), (end["state_hash"].clone(), warned.clone(), 0), "{w}");
    }
    // A withholding that names nothing is refused.
    assert!(Host::start(world(), &json!({ "stand_in": "idle", "withhold": [{ "what": "weather_warning", "nth": 0 }] })).is_err());
    assert!(Host::start(world(), &json!({ "stand_in": "idle", "withhold": [{ "nth": 1 }] })).is_err());
}

#[test]
fn a_seats_thinking_as_its_host_reckons_it_comes_before_its_act_where_the_world_says_thinking_takes_time() {
    // (MT-22: a model seat's host sends how long it thought, from its tokens as run.ts reckons a pilot's; the act begins
    // after it. Where thinking is free, what a host sends is not taken.)
    let starts = |costs: bool| -> Vec<i64> {
        let mut c = world();
        c["clock"]["run_seconds"] = json!(4 * DAY);
        c["orchestration"]["thinking_time"] = json!(if costs { "costs_world_time" } else { "free" });
        let mut h = Host::start(c, &json!({ "run_id": "think", "stand_in": "idle", "stream": { "cap": 100000, "kinds": ["event"] } })).unwrap();
        let mut late = vec![];
        loop {
            let due = h.next().unwrap();
            if due["due"] == "end" {
                break;
            }
            for s in due["seats"].as_array().unwrap() {
                h.submit(s["key"].as_str().unwrap(), &json!({ "type": "message", "to": ["alice-self"], "text": "Hello", "thinking": 600 })).unwrap();
            }
            for e in h.events(100_000)["entries"].as_array().unwrap() {
                if e["body"]["event"] == "action_started" && e["body"]["participant"] == "mayor-system" {
                    late.push(e["body"]["starts"].as_i64().unwrap() - e["t"].as_i64().unwrap());
                }
            }
        }
        late
    };
    let (costs, free) = (starts(true), starts(false));
    assert!(!costs.is_empty() && costs.iter().all(|x| *x >= 600), "{costs:?}");
    assert!(!free.is_empty() && free.iter().any(|x| *x < 600), "{free:?}");
}
