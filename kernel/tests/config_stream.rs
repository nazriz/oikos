//! A config read participant by participant (`config::load_from`) is the config read whole: the same checks, the same
//! canonical bytes and hash, the same typed config; and a run started from it is the same run, its log byte for byte
//! (SC-1: a large world's start was bounded by its config's JSON held whole). Three profiles' generated towns.

use oikos_kernel::canon;
use oikos_kernel::config::{self, Config};
use oikos_kernel::engine::{run_code_world, run_code_world_loaded, EngineOptions};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::PathBuf;

const DAY: i64 = 86_400;

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

/// The town of `worlds/town.yaml` from a profile, as the generator writes it (its JSON text, cached for the build).
fn town_text(profile: &str) -> Vec<u8> {
    let out = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(format!("stream-town-{profile}.json"));
    let r = std::process::Command::new("bun")
        .current_dir(root())
        .args(["orchestrator/test/lib/write-town.ts", "worlds/town.yaml", out.to_str().unwrap(), "1", &format!("profile=\"{profile}\"")])
        .output()
        .expect("bun, to generate the town");
    assert!(r.status.success(), "{}", String::from_utf8_lossy(&r.stderr));
    std::fs::read(&out).unwrap()
}

const PROFILES: [&str; 3] = ["au-vic-2026", "gb-eng-2026", "us-oh-2026"];

#[test]
fn a_config_read_participant_by_participant_is_the_config_read_whole() {
    for profile in PROFILES {
        let text = town_text(profile);
        let whole: Value = serde_json::from_slice(&text).unwrap();
        // The old reading, written out here: the whole value's canonical bytes, their hash, the whole read into its type.
        let canonical = canon::canonical_value(&whole).unwrap();
        let hash = canon::hash_with_domain(canon::DOMAIN_CONFIG, &canonical);
        let typed = Config::deserialize(whole.clone()).unwrap();
        let (streamed, rest) = config::load_from(&text[..]).unwrap();
        assert!(typed.participants.len() > 100, "{profile}: a town with its people");
        assert_eq!(streamed.canonical.len(), canonical.len() as u64, "{profile}");
        assert!(streamed.canonical.to_vec() == canonical, "{profile}: the same canonical bytes");
        assert_eq!(streamed.hash, hash, "{profile}");
        assert!(*streamed.config == typed, "{profile}: the same config");
        // Read from a value, the same again.
        let (from_value, rest2) = config::load_split(whole.clone()).unwrap();
        assert!(from_value.canonical.to_vec() == canonical && from_value.hash == hash && *from_value.config == typed, "{profile}");
        assert_eq!(rest, rest2);
        // What the engine reads as JSON: every member but the participants as given, and the world's currencies.
        for (k, v) in whole.as_object().unwrap() {
            match k.as_str() {
                "participants" => assert_eq!(rest[k], json!([])),
                "world" => assert_eq!(rest[k], json!({ "currencies": v["currencies"] })),
                _ => assert_eq!(&rest[k], v, "{profile}: {k}"),
            }
        }
        // A snapshot's reading of the rest, without the participants or the world.
        assert_eq!(config::rest_of(&canonical[..]).unwrap(), rest);
        // The people's controllers keep their params' long members once for all (the town's ventures, demand...): a
        // handful of maps for some hundreds of people, and each controller reads back as given.
        let people: Vec<_> = streamed.config.participants.iter().filter(|p| p.controller.get("impl").and_then(Value::as_str) == Some("citizen.default")).collect();
        // (Each distinct member, held once: the town's ventures, the same for everyone, are one.)
        let held = |name: &str| -> std::collections::BTreeSet<usize> {
            people.iter().flat_map(|p| p.controller.parts().1.iter().filter(|m| m.0 == name).map(|m| std::sync::Arc::as_ptr(m) as usize)).collect()
        };
        assert!(people.len() > 100 && people.iter().all(|p| p.controller.shares()), "{profile}");
        assert_eq!(held("ventures").len(), 1, "{profile}: one list of ventures for {} people", people.len());
        assert!(held("demand").len() <= 2, "{profile}");
        for (p, given) in streamed.config.participants.iter().zip(whole["participants"].as_array().unwrap()) {
            assert!(p.controller.to_value() == given["controller"], "{profile}: {}", p.id);
        }
        // Kept compressed: a few per cent of what it is.
        let kept: usize = streamed.canonical.kept_bytes();
        assert!(kept * 10 < canonical.len(), "{profile}: {kept} of {}", canonical.len());
    }
}

#[test]
fn a_run_from_a_config_read_participant_by_participant_is_the_same_run() {
    for profile in PROFILES {
        let text = town_text(profile);
        let opts = || EngineOptions { threads: 4, until: Some(10 * DAY), ..Default::default() };
        let (h1, e1) = run_code_world(serde_json::from_slice(&text).unwrap(), "stream", Vec::new(), opts()).unwrap();
        let (loaded, rest) = config::load_from(&text[..]).unwrap();
        let (h2, e2) = run_code_world_loaded(loaded, rest, "stream", Vec::new(), opts()).unwrap();
        assert_eq!(h1, h2, "{profile}: the same state");
        // The state's canonical bytes, written map entry by map entry for its hash, are the state's made whole.
        let k = e1.run().kernel();
        let (streamed, whole) = (k.canonical_state().unwrap(), k.canonical_state_whole().unwrap());
        assert!(streamed.len() > 1_000_000 && streamed == whole, "{profile}: the state's bytes, streamed and whole");
        let (a, b) = (e1.into_log(), e2.into_log());
        assert!(a.len() > 1_000_000, "{profile}: a run of some length ({} bytes)", a.len());
        assert!(a == b, "{profile}: the same log, byte for byte");
        // The header carries the config as given, in canonical JSON.
        let header: Value = serde_json::from_slice(a.split(|b| *b == b'\n').next().unwrap()).unwrap();
        assert!(canon::canonical_value(&header["body"]["config"]).unwrap() == canon::canonical_value(&serde_json::from_slice::<Value>(&text).unwrap()).unwrap());
    }
}

#[test]
fn a_config_read_participant_by_participant_is_checked_as_the_whole_is() {
    let text = town_text("au-vic-2026");
    let whole: Value = serde_json::from_slice(&text).unwrap();
    let read = |v: &Value| config::load_from(serde_json::to_vec(v).unwrap().as_slice()).map(|_| ());
    let both = |v: &Value| (read(v), config::load(v.clone()).map(|_| ()));
    // A participant against the contract: refused, and told where.
    let mut bad = whole.clone();
    bad["participants"][3]["kind"] = json!("ghost");
    let (a, b) = both(&bad);
    assert!(a.as_ref().unwrap_err().contains("/participants/3/kind"), "{a:?}");
    assert!(b.is_err());
    // A number that is not a whole one, in a participant.
    let mut bad = whole.clone();
    bad["participants"][5]["controller"]["params"]["x"] = json!(1.5);
    let (a, b) = both(&bad);
    assert!(a.as_ref().unwrap_err().contains("/participants/5/controller/params/x"), "{a:?}");
    assert!(b.is_err());
    // The rest against the contract, with the participants fine.
    let mut bad = whole.clone();
    bad["seed"] = json!("one");
    let (a, b) = both(&bad);
    assert!(a.as_ref().unwrap_err().contains("/seed"), "{a:?}");
    assert!(b.is_err());
    // A semantic check across the participants (an id used twice).
    let mut bad = whole.clone();
    let first = bad["participants"][0].clone();
    bad["participants"].as_array_mut().unwrap().push(first);
    let (a, b) = both(&bad);
    assert!(a.is_err() && b.is_err(), "{a:?} {b:?}");
    // Participants that are not a list, or none.
    let mut bad = whole.clone();
    bad["participants"] = json!({});
    let (a, b) = both(&bad);
    assert!(a.is_err() && b.is_err());
    let mut none = whole.clone();
    none.as_object_mut().unwrap().remove("participants");
    let (a, b) = both(&none);
    assert!(a.is_err() && b.is_err());
    // Text that is not one JSON value.
    let mut trailing = text.clone();
    trailing.extend_from_slice(b" {}");
    assert!(config::load_from(&trailing[..]).is_err());
    assert!(config::load_from(&text[..text.len() / 2]).is_err());
    // A member given twice: the last is the config's, as when the text is read whole.
    let mut twice = br#"{"participants":[],"#.to_vec();
    twice.extend_from_slice(&text[1..]);
    let (l, _) = config::load_from(&twice[..]).unwrap();
    assert_eq!(l.hash, config::load(whole).unwrap().hash);
}

/// A town in which one person is a model's seat (who only waits) and everyone else is code: its decisions are written
/// for the log as they are made, and not kept as values while the seat thinks (SC-1). A run saved while the seat
/// thinks at the town's first moment, with every citizen's decisions of that round held, and taken up again from its bytes, is the run.
#[test]
fn a_round_saved_while_a_seat_thinks_logs_the_decisions_its_people_made() {
    use oikos_actors::sight::Action;
    use oikos_kernel::engine::{Due, Engine, Snapshot};
    let mut town: Value = serde_json::from_slice(&town_text("au-vic-2026")).unwrap();
    let seat = town["participants"].as_array_mut().unwrap().iter_mut().find(|p| p["controller"]["impl"] == "citizen.default").unwrap();
    seat["controller"] = json!({ "type": "llm", "impl": "mock", "params": {} });
    let seat_id = seat["id"].as_str().unwrap().to_string();
    let opts = || EngineOptions { threads: 4, until: Some(20 * DAY), ..Default::default() };
    let drive = |e: &mut Engine<Vec<u8>>| loop {
        match e.next().unwrap() {
            Due::End => break e.finish().unwrap(),
            Due::Seats(seats) => {
                for s in seats {
                    e.submit(&s.key, Action::wait()).unwrap();
                }
            }
        }
    };
    let mut straight = Engine::start(town.clone(), "seat", Vec::new(), None, opts()).unwrap();
    let hash = drive(&mut straight);
    let log = straight.into_log();
    let mut e = Engine::start(town, "seat", Vec::new(), None, opts()).unwrap();
    let mut wakes = 0;
    let key = loop {
        match e.next().unwrap() {
            Due::End => panic!("the seat never woke"),
            Due::Seats(seats) => {
                assert!(seats.iter().all(|s| s.participant == seat_id));
                wakes += 1;
                // (Its first wake is the town's first moment: everyone decides in that round.)
                if wakes == 1 {
                    break seats[0].key.clone();
                }
                for s in seats {
                    e.submit(&s.key, Action::wait()).unwrap();
                }
            }
        }
    };
    let snap = Snapshot::from_bytes(&e.snapshot().unwrap().to_bytes().unwrap()).unwrap();
    let before = e.into_log();
    let mut f = Engine::resume(&snap, Vec::new(), None, opts()).unwrap();
    f.submit(&key, Action::wait()).unwrap();
    let h = drive(&mut f);
    let mut whole = before;
    whole.extend(f.into_log());
    assert_eq!(h, hash);
    assert!(whole.len() > 1_000_000 && whole == log, "the run taken up again is the run, its decisions all logged");
    let pat: &[u8] = b"\"annotation\":\"decision\"";
    let decisions = whole.split(|b| *b == b'\n').filter(|l| l.windows(pat.len()).any(|w| w == pat)).count();
    assert!(decisions > 100, "{decisions} decisions logged");
}

/// A round of many units with no seat is decided a window at a time as it is carried out (SC-1: a town's first moment
/// held every unit's decisions together). Each decides from what it was shown and its own state, so the run is the
/// same with any window: here seven against all at once, on three profiles' towns for 60 days. (A unit let go of in a
/// round before it decided decides first, as it would have with the others: `decided_early_n`. No town tried reaches
/// it, a year at 200 people nor 120 days at 1,000, so it is held by its construction, not by this test.)
#[test]
fn a_round_decided_a_window_at_a_time_is_the_round_decided_at_once() {
    for profile in PROFILES {
        let text = town_text(profile);
        let run = |window: usize| {
            let opts = EngineOptions { threads: 4, until: Some(60 * DAY), decide_window: window, ..Default::default() };
            let (h, e) = run_code_world(serde_json::from_slice(&text).unwrap(), "window", Vec::new(), opts).unwrap();
            let n = e.decided_early_n;
            (h, e.into_log(), n)
        };
        let (h1, a, _) = run(usize::MAX);
        let (h2, b, _) = run(7);
        assert_eq!(h1, h2, "{profile}: the same state");
        assert!(a.len() > 1_000_000 && a == b, "{profile}: the same log, byte for byte");
/// Two worlds in one process, run side by side (a host's arms; tests at once): what each person has seen of a building
/// is held once for everyone in their world who sees it the same (SC-1), never shared with the other world, whose
/// building of the same name may stand on another config. The same town twice, the second with its buildings' wear
/// coming on faster (its catalogue's), stepped a day each in turn on one thread: each is the run it is alone.
#[test]
fn two_worlds_side_by_side_are_each_the_world_alone() {
    use oikos_kernel::engine::{Due, Engine};
    let base: Value = serde_json::from_slice(&town_text("au-vic-2026")).unwrap();
    let mut other = base.clone();
    let wear = other["catalogue"]["variables"].as_array_mut().unwrap().iter_mut().find(|v| v["per_day"].as_i64().is_some_and(|d| d > 0)).expect("a variable that comes on by the day");
    wear["per_day"] = json!(wear["per_day"].as_i64().unwrap() * 2);
    let towns = [base, other];
    let opts = || EngineOptions { threads: 2, until: Some(20 * DAY), ..Default::default() };
    let alone: Vec<(String, Vec<u8>)> = towns
        .iter()
        .map(|t| {
            let (h, e) = run_code_world(t.clone(), "side", Vec::new(), opts()).unwrap();
            (h, e.into_log())
        })
        .collect();
    assert_ne!(alone[0].0, alone[1].0, "the two towns are not the same world");
    let mut worlds: Vec<Engine<Vec<u8>>> = towns.iter().map(|t| Engine::start(t.clone(), "side", Vec::new(), None, opts()).unwrap()).collect();
    for day in 1..=20 {
        for e in worlds.iter_mut() {
            while let Some(due) = e.next_by(day * DAY).unwrap() {
                assert!(matches!(due, Due::End | Due::Seats(_)), "no seats here");
                if matches!(due, Due::End) {
                    break;
                }
            }
        }
    }
    let ends: Vec<(String, Vec<u8>)> = worlds.into_iter().map(|mut e| (e.finish().unwrap(), e.into_log())).collect();
    for (i, (side, solo)) in ends.iter().zip(&alone).enumerate() {
        assert_eq!(side.0, solo.0, "world {i} side by side");
        assert!(side.1 == solo.1, "world {i}'s log is its own alone");
    }
}
