//! The engine with its actors in Rust (docs/design/rust-port.md 2.2; docs/port-guide.md): a world run with code
//! actors stepped inside the kernel's process, seats handed to a host, the same result on any number of threads.

mod common;

use oikos_actors::sight::Action;
use oikos_kernel::engine::{each_mut, run_code_world, Due, Engine, EngineOptions};
use serde_json::{json, Value};

const DAY: i64 = 86_400;

/// Riverbend with its inspector's system replaced by the weather bureau, warning of a heatwave from day 10; every
/// other code participant stood in for by `idle` (its kinds are not ported yet).
fn weather_world() -> Value {
    let mut c = common::riverbend();
    c["clock"]["run_seconds"] = json!(30 * DAY);
    for p in c["participants"].as_array_mut().unwrap() {
        if p["id"] == "inspector-system" {
            p["controller"] = json!({ "type": "code", "impl": "world.weather", "params": { "events": [{ "kind": "heatwave", "from_day": 10, "days": 5 }], "lead_days": 2 } });
        }
    }
    c
}

fn opts(threads: usize) -> EngineOptions {
    EngineOptions { threads, stand_in: Some("idle".into()), share_at: 1, ..Default::default() }
}

fn lines(log: &[u8]) -> Vec<Value> {
    log.split(|b| *b == b'\n').filter(|l| !l.is_empty()).map(|l| serde_json::from_slice(l).unwrap()).collect()
}

#[test]
fn the_weather_bureau_warns_the_public_ahead_of_a_spell_from_inside_the_engine() {
    let (_, e) = run_code_world(weather_world(), "weather", Vec::new(), opts(4)).unwrap();
    let log = lines(&e.into_log());
    let warnings: Vec<&Value> = log
        .iter()
        .filter(|l| l["kind"] == "event" && l["body"]["event"] == "recorded" && l["body"]["record"]["kind"] == "weather_warning")
        .map(|l| &l["body"]["record"])
        .collect();
    assert_eq!(warnings.len(), 1, "one spell, one warning");
    let w = warnings[0];
    assert_eq!(w["visible_to"], "public");
    assert_eq!(w["data"], json!({ "kind": "heatwave", "from": 10 * DAY, "until": 15 * DAY }));
    assert_eq!(w["text"], "Heatwave warning: expected from day 11 for about 5 days.");
    // Issued two days ahead, at six in the morning, plus the time the act took (all work takes time).
    let at = w["at"].as_i64().unwrap();
    assert!((8 * DAY + 6 * 3600..9 * DAY).contains(&at), "warned at {at}");
    // Its act went through the resolver, as every code actor's call does, and is logged with it.
    let act = log
        .iter()
        .find(|l| l["kind"] == "command" && l["body"]["command"] == "act" && l["body"]["participant"] == "inspector-system")
        .unwrap();
    assert_eq!(act["body"]["provenance"]["via"], "call");
    assert!(act["body"]["provenance"]["call"].as_str().unwrap().starts_with("statement("));
    // The log says which kinds ran, stand-ins too.
    let orch = log.iter().find(|l| l["body"]["annotation"] == "orchestrator").unwrap();
    assert!(orch["body"]["data"]["modules"]["world.weather"].is_object());
    assert!(orch["body"]["data"]["modules"]["idle"].is_object());
}

#[test]
fn the_same_world_on_one_thread_and_on_fourteen_is_the_same_world_and_twice_in_a_row() {
    let run = |threads| {
        let (hash, e) = run_code_world(weather_world(), "threads", Vec::new(), opts(threads)).unwrap();
        (hash, e.into_log())
    };
    let (h1, l1) = run(1);
    let (h14, l14) = run(14);
    let (h14b, _) = run(14);
    assert_eq!(h1, h14);
    assert_eq!(h14, h14b);
    assert!(l1 == l14, "the logs are byte for byte the same");
}

#[test]
fn deciding_on_many_threads_puts_each_result_in_its_own_place() {
    let mut items: Vec<u64> = (0..1000).collect();
    let one = each_mut(&mut items.clone(), 1, 1, |x| *x * 7 % 13);
    let many = each_mut(&mut items, 14, 1, |x| {
        *x += 1;
        (*x - 1) * 7 % 13
    });
    assert_eq!(one, many);
    assert_eq!(items[999], 1000, "each item was given to exactly one thread");
}

#[test]
fn a_world_naming_a_kind_the_engine_lacks_is_refused_unless_a_stand_in_is_named() {
    let err = Engine::start(weather_world(), "missing", Vec::new(), None, EngineOptions { stand_in: None, ..opts(1) }).err().unwrap();
    assert!(err.contains("no actor kind"), "{err}");
}

#[test]
fn a_seat_is_handed_to_its_host_with_what_it_was_shown_and_its_action_is_carried_out_in_its_place() {
    let mut e = Engine::start(weather_world(), "seat", Vec::new(), None, opts(2)).unwrap();
    let mut woke = 0;
    loop {
        match e.next().unwrap() {
            Due::End => break,
            Due::Seats(seats) => {
                for s in seats {
                    assert_eq!(s.participant, "mayor-system");
                    assert!(s.observation["channels"].is_object(), "the contract's observation, as JSON");
                    woke += 1;
                    let a = if woke == 1 {
                        Action::Message { to: vec!["alice-self".into()], text: "Hello from the mayor.".into(), re: None }
                    } else {
                        Action::wait()
                    };
                    e.submit(&s.key, a).unwrap();
                }
            }
        }
    }
    e.finish().unwrap();
    assert!(woke >= 2, "the seat woke at its cadence: {woke}");
    let log = lines(&e.into_log());
    let mayor: Vec<&Value> =
        log.iter().filter(|l| l["body"]["participant"] == "mayor-system" || l["body"]["subject"] == "mayor-system").collect();
    assert!(log.iter().any(|l| l["body"]["event"] == "message_delivered"), "the seat's letter was delivered: {mayor:?}");
}

#[test]
fn every_actors_memory_saves_and_the_saved_actor_steps_as_the_original() {
    let mut e = Engine::start(weather_world(), "save", Vec::new(), None, EngineOptions { until: Some(5 * DAY), ..opts(1) }).unwrap();
    while let Due::Seats(seats) = e.next().unwrap() {
        for s in seats {
            e.submit(&s.key, Action::wait()).unwrap();
        }
    }
    let saved = e.save_actors().unwrap();
    let bureau = &saved["inspector-system|inspector"];
    assert_eq!(bureau["kind"], "world.weather");
    assert_eq!(bureau["actor"]["plan"]["next"], 0, "not yet warned at day 5");
    let kind = oikos_actors::registry::find("world.weather").unwrap();
    let ctx = oikos_actors::Ctx {
        participant: "x".into(),
        performer: Default::default(),
        entity: "city".into(),
        position: None,
        params: Default::default(),
        world: Default::default(),
    };
    let back = kind.restore(&ctx, bureau["actor"].clone()).unwrap();
    assert_eq!(back.save().unwrap(), bureau["actor"]);
}

#[test]
fn the_weather_manifest_is_the_one_the_ts_module_wrote() {
    let ts: Value = serde_json::from_slice(
        &std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/../participants/manifests/world.weather.json")).unwrap(),
    )
    .unwrap();
    let rust = oikos_actors::registry::find("world.weather").unwrap().manifest();
    for (k, v) in ts.as_object().unwrap() {
        assert_eq!(&rust[k], v, "{k}");
    }
}

/// How long the worked example takes to step (printed, never asserted: `cargo test --release --test engine -- --nocapture weather_steps`).
#[test]
#[allow(clippy::disallowed_methods)] // (a measurement, printed: nothing in the world reads it)
fn weather_steps_per_second() {
    let kind = oikos_actors::registry::find("world.weather").unwrap();
    let events: Vec<Value> = (0..50).map(|i| json!({ "kind": "heatwave", "from_day": 5 + i * 7, "days": 3 })).collect();
    let ctx = oikos_actors::Ctx {
        participant: "bureau".into(),
        performer: Default::default(),
        entity: "outside".into(),
        position: Some("weather-bureau".into()),
        params: json!({ "events": events }).as_object().unwrap().clone(),
        world: std::sync::Arc::new(oikos_actors::WorldInfo { tick: 60, run_end: 365 * DAY, ..Default::default() }),
    };
    let mut actor = kind.create(&ctx).unwrap();
    let mut draws = oikos_actors::Draws::new("bureau", "weather-bureau");
    let obs: oikos_actors::sight::Observation = serde_json::from_value(
        json!({ "participant": "bureau", "t": 0, "status": "active", "outcomes": [], "inbox": [], "drafts": [], "channels": {} }),
    )
    .unwrap();
    let mut view = oikos_actors::sight::View::default();
    let started = std::time::Instant::now();
    let (mut steps, mut calls) = (0u64, 0u64);
    for day in 0..365 {
        let mut o = obs.clone();
        o.t = day * DAY + 6 * 3600;
        let pic = view.apply(o, Some("weather-bureau"), "outside", "cadence", DAY);
        let mut cx = oikos_actors::Cx::new(pic.t, &ctx, &mut draws, 1, vec![]);
        if matches!(actor.step(&pic, &mut cx), Action::Call { .. }) {
            calls += 1;
            actor.sent(&format!("act.{calls}"));
        }
        steps += 1;
    }
    let ns = started.elapsed().as_nanos() as u64 / steps;
    println!("world.weather: {steps} wakes, {calls} warnings, {ns} ns a wake (view and step)");
    assert_eq!(calls, 50);
}
