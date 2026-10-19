//! Observations in the log (`log.observations`; docs/reliability.md, "Observations in the log"). A log that keeps only
//! seats' observations leaves out a code actor's (its full text and its hash): the world is deterministic, so the same
//! run reaches the same state and makes the same acts, its replay still checks out, and a code actor's view is
//! regenerated exactly by replaying the log to it (`run::observation_at`).

use oikos_kernel::engine::{run_code_world, EngineOptions};
use oikos_kernel::run;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::OnceLock;

const DAY: i64 = 86_400;

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

/// The town of `worlds/town.yaml`, as the generator writes it (cached for the build).
fn town() -> Value {
    static TOWN: OnceLock<Value> = OnceLock::new();
    TOWN.get_or_init(|| {
        let out = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("observations-town.json");
        if !out.exists() {
            let r = std::process::Command::new("bun")
                .current_dir(root())
                .args(["orchestrator/test/lib/write-town.ts", "worlds/town.yaml", out.to_str().unwrap(), "1"])
                .output()
                .expect("bun, to generate the town");
            assert!(r.status.success(), "{}", String::from_utf8_lossy(&r.stderr));
        }
        serde_json::from_slice(&std::fs::read(&out).unwrap()).unwrap()
    })
    .clone()
}

fn lines(log: &[u8]) -> Vec<Value> {
    log.split(|b| *b == b'\n').filter(|l| !l.is_empty()).map(|l| serde_json::from_slice(l).unwrap()).collect()
}

fn run_with(observations: &str, record: bool) -> (String, Vec<u8>) {
    let mut c = town();
    c["log"]["observations"] = json!(observations);
    let opts = EngineOptions { threads: 4, stand_in: Some("idle".into()), share_at: 1, until: Some(10 * DAY), record_observations: record, ..Default::default() };
    let (hash, e) = run_code_world(c, "observations", Vec::new(), opts).unwrap();
    (hash, e.into_log())
}

#[test]
fn a_log_of_seats_observations_is_the_same_run_its_replay_checks_out_and_a_code_actors_view_is_regenerated_exactly() {
    let (all_hash, all) = run_with("all", true);
    let (seats_hash, seats) = run_with("seats", false);
    assert_eq!(all_hash, seats_hash, "the same state");
    let (a, s) = (lines(&all), lines(&seats));
    let acts = |l: &[Value]| l.iter().filter(|x| x["kind"] == "command" && x["body"]["command"] != "observe" && x["body"]["command"] != "look").map(|x| (x["t"].clone(), x["body"].clone())).collect::<Vec<_>>();
    assert_eq!(acts(&a), acts(&s), "the same acts, at the same times, in the same order");
    let observations = |l: &[Value]| l.iter().filter(|x| x["kind"] == "event" && x["body"]["event"] == "observation").count();
    assert!(observations(&a) > 1_000, "the full log hashes every observation ({})", observations(&a));
    assert_eq!(observations(&s), 0, "a town of code actors and no seats: none kept");
    eprintln!("log: all {} bytes, seats {} bytes ({}%)", all.len(), seats.len(), seats.len() * 100 / all.len());
    assert!(seats.len() < all.len());
    // Each replays byte for byte to the same state.
    let ra = run::replay(&all, None).expect("the full log replays");
    let rs = run::replay(&seats, None).expect("the seats' log replays");
    assert_eq!((ra.state_hash.as_str(), rs.state_hash.as_str()), (all_hash.as_str(), all_hash.as_str()));
    // A sample of code actors' views, as the full log recorded them, against the seats' log replayed to them: the
    // n-th observation of a participant in one log is its n-th in the other.
    let nth_observes = |l: &[Value], who: &str| l.iter().filter(|x| x["kind"] == "command" && (x["body"]["command"] == "observe" || x["body"]["command"] == "look") && x["body"]["participant"] == who).map(|x| x["seq"].as_u64().unwrap()).collect::<Vec<_>>();
    let recorded: Vec<&Value> = a.iter().filter(|x| x["kind"] == "annotation" && x["body"]["annotation"] == "observation").collect();
    assert!(recorded.len() > 1_000);
    let mut checked = 0;
    for r in recorded.iter().step_by(recorded.len() / 7) {
        let who = r["body"]["subject"].as_str().unwrap();
        // (The recorded observation follows the command that made it: the n-th of that participant's before it.)
        let n = nth_observes(&a, who).iter().filter(|q| **q < r["seq"].as_u64().unwrap()).count();
        let seq = nth_observes(&s, who)[n - 1];
        let mut regenerated = run::observation_at(&seats, seq).expect("regenerated");
        let mut was = r["body"]["data"]["observation"].clone();
        // (Whom it was shown for, the recorded one says as its unit had it: the office it acts for, where it acts for one.)
        for v in [&mut regenerated, &mut was] {
            v.as_object_mut().unwrap().remove("entity");
        }
        assert_eq!(regenerated, was, "{who}'s observation {n}, regenerated from the seats' log at entry {seq}");
        checked += 1;
    }
    assert!(checked >= 7);
}
