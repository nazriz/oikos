//! Citizens' minds and memories held compactly (risk SC-1; docs/decisions.md 2026-10-25, "Citizens' minds and memories
//! held compactly"): what a mind and a life read of their params is read once for all whose params are alike but for a
//! person's own members, and held once; what a person last wrote to their record is kept as text; the book's places in
//! a sorted list. None of it may change a result.
//!
//! - Held always: in three profiles' generated towns, every person's shared readings are what that person would have
//!   read of all their params alone (so leaving their own members out of what is shared, and sharing it, changed nothing
//!   anyone reads), and people given the same params but their own share one reading.
//! - The proof of the change, run by hand (`cargo test --test main mind_memory:: -- --ignored`): a living town of each of the
//!   three profiles runs a month to the state hash and the log main did before the change (main at 2e3f6277). These are
//!   pins, which catch any change to what a town does (docs/testing.md, "Change detectors"), so they are not run with
//!   the others: culture-dial.test.ts is the one alarm kept. The 1,000- and 10,000-person towns were checked the same
//!   way (the decisions entry).

use oikos_actors::citizen::params::{Own, Params, PERSONS_OWN};
use oikos_actors::mind::citizen::{Common, P};
use oikos_actors::{Ctx, Params as ActorParams};
use oikos_kernel::engine::{run_code_world, world_info, EngineOptions};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::sync::Arc;

const DAY: i64 = 86_400;
const PROFILES: [&str; 3] = ["au-vic-2026", "gb-eng-2026", "us-oh-2026"];

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

/// The living town of `worlds/town.yaml` from a profile, everyone with initiative (their minds' every part at work).
fn town(profile: &str) -> Value {
    let out = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(format!("mind-memory-{profile}.json"));
    let r = std::process::Command::new("bun")
        .current_dir(root())
        .args(["orchestrator/test/lib/write-town.ts", "worlds/town.yaml", out.to_str().unwrap(), "1", &format!("profile=\"{profile}\""), "living={\"initiative_bps\":10000}"])
        .output()
        .expect("bun, to generate the town");
    assert!(r.status.success(), "{}", String::from_utf8_lossy(&r.stderr));
    serde_json::from_slice(&std::fs::read(&out).unwrap()).unwrap()
}

#[test]
fn everyones_shared_readings_of_their_params_are_what_they_would_have_read_alone() {
    for profile in PROFILES {
        let config = town(profile);
        let world = Arc::new(world_info(&config).unwrap());
        let (loaded, _) = oikos_kernel::config::load_split(config).unwrap();
        let mut minds = std::collections::BTreeSet::new();
        let mut lives = std::collections::BTreeSet::new();
        let mut alike = std::collections::BTreeSet::new();
        // (Each held, as people hold theirs: a reading no one holds is let go, and read again by the next.)
        let mut held = vec![];
        let mut people = 0;
        for part in &loaded.config.participants {
            if part.controller.get("impl").and_then(Value::as_str) != Some("citizen.default") {
                continue;
            }
            people += 1;
            let ctx = Ctx {
                participant: part.id.clone(),
                performer: Default::default(),
                entity: part.person.clone().unwrap_or_default(),
                position: None,
                params: ActorParams::of_controller(&part.controller),
                world: world.clone(),
            };
            // The mind's: the shared part is the reading of all their params (Debug: every field), their own theirs.
            let p = P::of(&ctx);
            assert_eq!(format!("{:?}", *p.c), format!("{:?}", Common::read(&ctx, &[])), "{profile}: {}", part.id);
            let own = |k: &str| ctx.params.get(k).filter(|x| !x.is_null()).cloned();
            assert_eq!(p.own_values.as_ref().map(|m| serde_json::to_value(m).unwrap()), own("own_values"), "{profile}: {}", part.id);
            assert_eq!(p.started.as_ref().map(|s| s.value()), own("started"));
            assert_eq!(serde_json::to_value(&p.beliefs).unwrap(), own("beliefs").unwrap_or(serde_json::json!({})));
            minds.insert(Arc::as_ptr(&p.c) as usize);
            // The life's: the shared part is all their params read whole, their own read whole too.
            let whole: serde_json::Map<String, Value> = ctx.params.iter().filter(|(_, v)| !v.is_null()).map(|(k, v)| (k.clone(), v.clone())).collect();
            let g = Params::of(&ctx.params).unwrap();
            assert!(*g.common == serde_json::from_value::<Params>(Value::Object(whole.clone())).unwrap(), "{profile}: {}", part.id);
            let o: Own = serde_json::from_value(Value::Object(whole)).unwrap();
            assert_eq!((&g.trade, &g.stops_work_at, &g.started), (&o.trade, &o.stops_work_at, &o.started));
            lives.insert(Arc::as_ptr(&g.common) as usize);
            alike.insert(ctx.params.text_without(&PERSONS_OWN));
            held.push((p, g));
        }
        // One reading for each set of params alike but for their own (a handful: those in the labour force or not...).
        assert!(people > 100, "{profile}: a town with its people");
        assert!(minds.len() == alike.len() && lives.len() == alike.len(), "{profile}: {} and {} readings, {} alike", minds.len(), lives.len(), alike.len());
        assert!(alike.len() * 20 < people, "{profile}: {} readings for {people} people ({PERSONS_OWN:?} their own)", alike.len());
    }
}

/// (profile, final state hash, log digest), main at 2e3f6277, before the change.
const MAIN: [(&str, &str, &str); 3] = [
    ("au-vic-2026", "d53a6dafedbcb5c9066f0d378e046a6b6fe05ca3ecf5408f8de42bb45fa3f7c4", "fc4ab34da461c63d"),
    ("gb-eng-2026", "b287a219983d3006e14d399959a304a996a72c4e9750a3fcf3fab2efe34508ed", "72a8c1c2833ab669"),
    ("us-oh-2026", "ca5fff918c582133b0550c4c4510fa672d536d888570c6a062ae878ba5379557", "5d37f0021e6a9485"),
];

/// The log as written, less what follows from the build: the header's `"kernel":{...}`, and each entry's own `hash`
/// and `prev` (the last of each in its line, after the entry's body). sha256 of the lines, the first 16 hex.
fn digest(log: &[u8]) -> (String, usize) {
    fn cut(line: &str, key: &str) -> String {
        let pat = format!(",\"{key}\":\"");
        match line.rfind(&pat) {
            Some(i) => {
                let from = i + pat.len();
                let j = from + line[from..].find('"').unwrap();
                format!("{}{}", &line[..i], &line[j + 1..])
            }
            None => line.to_string(),
        }
    }
    let mut h = Sha256::new();
    let mut n = 0;
    for line in log.split(|b| *b == b'\n').filter(|l| !l.is_empty()) {
        let mut line = std::str::from_utf8(line).unwrap().to_string();
        if n == 0 {
            let i = line.find("\"kernel\":{\"build\":\"").expect("the header names the kernel");
            let j = i + line[i..].find('}').unwrap();
            line = format!("{}\"kernel\":null{}", &line[..i], &line[j + 1..]);
        }
        let line = cut(&cut(&line, "prev"), "hash");
        h.update(line.as_bytes());
        h.update(b"\n");
        n += 1;
    }
    let hex: String = h.finalize().iter().map(|b| format!("{b:02x}")).collect();
    (hex[..16].to_string(), n)
}

#[test]
#[ignore = "the change's proof against main, run by hand: pins (docs/testing.md, \"Change detectors\")"]
fn a_living_town_of_each_of_three_profiles_runs_a_month_as_main_did() {
    let mut got = vec![];
    for (profile, hash, log) in MAIN {
        let mut out = vec![];
        let (h, e) = run_code_world(town(profile), "world", &mut out, EngineOptions { threads: 4, until: Some(30 * DAY), ..Default::default() }).unwrap();
        drop(e);
        let (d, lines) = digest(&out);
        eprintln!("(\"{profile}\", \"{h}\", \"{d}\"), // {lines} lines");
        got.push((profile, h == hash && d == log));
    }
    assert!(got.iter().all(|g| g.1), "not main's run: {got:?} (each line printed above is what this build did)");
}
