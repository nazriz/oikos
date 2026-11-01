//! Everything physical is somewhere, and moves only along a network (law 9; docs/design/foundations-2.md section 3). The
//! kernel's side of its backstop (`orchestrator/test/everything-is-somewhere.test.ts`), grown step by step:
//!
//! - **S1:** over any sequence of operations, a body is in one place at a time: in at most one building's spaces, never
//!   in two. (Going somewhere takes the trip: `services.rs`, `a_body_is_in_one_place_and_going_somewhere_takes_the_trip`.)
//! - **S2:** roads are ways: a trip goes along them at the vehicle's speed (or on foot), a road with a gap is no way
//!   through, a vehicle is driven only by whoever may and only from where it stands, and stands where it went.

use crate::common;

use common::*;
use oikos_kernel::events::{EventBody, RefusalCode};
use oikos_kernel::kernel::Command;
use oikos_kernel::run::Run;
use proptest::prelude::*;
use proptest::strategy::ValueTree;
use serde_json::{json, Value};

/// Runs the operations, checking after each that no body is in two buildings; returns how many times a body went in somewhere.
fn check_run(config: Value, ops: &[Op]) -> Result<usize, TestCaseError> {
    let mut run = Run::start(config, "space", Vec::new(), None).unwrap();
    let mut went = 0;
    for op in ops {
        let Some(cmd) = concretize(&run, op) else { continue };
        let Some(resp) = step(&mut run, &cmd) else { continue };
        went += resp.events.iter().filter(|e| matches!(e.body, EventBody::Occupied { .. })).count();
        let st = run.kernel().state();
        let mut seen = std::collections::BTreeMap::<&str, &str>::new();
        for (structure, spaces) in st.occupancy.iter() {
            for body in spaces.values().flatten() {
                if let Some(other) = seen.insert(body.as_str(), structure.as_str()) {
                    prop_assert_eq!(other, structure.as_str(), "{} is in {} and {} at once, after {:?}", body, other, structure, cmd);
                }
            }
        }
    }
    Ok(went)
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 128, ..ProptestConfig::default() })]
    #[test]
    fn a_body_is_in_one_place_at_a_time(ops in proptest::collection::vec(op_strategy(), 1..120)) {
        check_run(world(&default_params()), &ops)?;
    }
}

/// Not vacuous: bodies do go from one place to another.
#[test]
fn bodies_do_move() {
    let mut runner = proptest::test_runner::TestRunner::deterministic();
    let mut n = 0;
    for _ in 0..30 {
        let ops = proptest::collection::vec(op_strategy(), 60..61).new_tree(&mut runner).unwrap().current();
        n += check_run(world(&default_params()), &ops).unwrap();
    }
    assert!(n > 10, "only {n} bodies went in anywhere");
}

// ----------------------------------------------------------------------------------------------------------------- S2: ways

/// A long town (40 cells of 25 m, each 18 s on foot): a road along the middle row from beside alice's
/// house to beside the shop at the far end, and alice's car at home, which bob may drive too.
fn road_world() -> Value {
    let mut w = world(&default_params());
    w["world"]["ground"] = json!({"w": 40, "h": 3, "cell": 25});
    w["world"]["places"][0]["area"] = json!({"x": 0, "y": 0, "w": 40, "h": 3});
    w["catalogue"]["travel"] = json!({"seconds_per_cell": 18});
    w["catalogue"]["structure_types"].as_array_mut().unwrap().push(json!({"id": "road", "category": "transport", "build_time": 86_400, "footprint": {"w": 1, "h": 1}, "spaces": [], "way": {"mode": "road", "capacity": 600, "speed_kmh": 45}}));
    let structures = w["world"]["structures"].as_array_mut().unwrap();
    for s in structures.iter_mut() {
        if s["id"] == "s-shop" {
            s["at"] = json!("cell.39.2");
        }
    }
    for x in 2..40 {
        structures.push(json!({"id": format!("road-{x}"), "at": format!("cell.{x}.1"), "type": "road", "built_by": "buildco"}));
    }
    w["travel"] = json!({"vehicle_types": [{"id": "car", "seats": 5, "speed_kmh": 100}], "vehicles": [{"id": "car-1", "type": "car", "owner": "alice", "at": "s-house", "drivers": ["bob"]}]});
    w
}

fn go(run: &mut Run<Vec<u8>>, who: &str, space: &str, vehicle: Option<&str>) -> Result<(i64, i64), RefusalCode> {
    let mut b = json!({"block": "occupy", "space": space});
    if let Some(v) = vehicle {
        b["vehicle"] = json!(v);
    }
    let cmd = direct(who, None, serde_json::from_value(json!([b])).unwrap()).unwrap();
    let r = step(run, &cmd).unwrap();
    let Some((starts, done)) = r.events.iter().find_map(|e| match &e.body { EventBody::ActionStarted { starts, done, .. } => Some((*starts, *done)), _ => None }) else {
        return match &r.events[0].body {
            EventBody::ActionRefused { code, .. } => Err(*code),
            other => panic!("{other:?}"),
        };
    };
    let out = run.command(&Command::Advance { to: done + 1 }).unwrap();
    if let Some(code) = r.events.iter().chain(out.events.iter()).find_map(|e| match &e.body { EventBody::ActionRefused { code, .. } => Some(*code), _ => None }) {
        return Err(code);
    }
    Ok((starts, done))
}

#[test]
fn a_trip_by_car_goes_along_the_road_at_its_speed_and_the_car_stands_where_it_went() {
    let mut on_foot = Run::start(road_world(), "space-foot", Vec::new(), None).unwrap();
    let (s0, d0) = go(&mut on_foot, "alice-self", "s-shop/dwelling.1", None).unwrap();
    let mut by_car = Run::start(road_world(), "space-car", Vec::new(), None).unwrap();
    let (s1, d1) = go(&mut by_car, "alice-self", "s-shop/dwelling.1", Some("car-1")).unwrap();
    // On foot: 39 cells at 18 s. By car: a cell on foot to the road, 37 links of 25 m at 45 km/h (2 s each), and a cell on
    // foot from it to the shop. (The act's own time is the same either way.)
    assert_eq!((d0 - s0) - (d1 - s1), 39 * 18 - (18 + 37 * 2 + 18));
    let st = by_car.kernel().state();
    assert_eq!(st.vehicles["car-1"].at, "s-shop");
    assert_eq!(on_foot.kernel().state().vehicles["car-1"].at, "s-house", "on foot, the car stays at home");
    // Hers to know: the car, where it stands.
    let o = by_car.command(&Command::Observe { participant: "alice-self".into(), only: None }).unwrap().observation.unwrap();
    assert_eq!(serde_json::to_value(&o).unwrap()["body"]["vehicles"], json!([{"vehicle": "car-1", "type": "car", "at": "s-shop"}]));
}

#[test]
fn a_car_is_driven_only_by_whoever_may_and_only_from_where_it_stands() {
    let mut run = Run::start(road_world(), "space-who", Vec::new(), None).unwrap();
    // Carol may not drive it; bob may, but it is not where he is.
    assert_eq!(go(&mut run, "carol-self", "s-house/dwelling.1", Some("car-1")), Err(RefusalCode::NotTheirs));
    assert_eq!(go(&mut run, "bob-self", "s-shop/dwelling.1", Some("car-1")), Err(RefusalCode::NotPresent));
    assert_eq!(go(&mut run, "alice-self", "s-shop/dwelling.1", Some("van-9")), Err(RefusalCode::UnknownRef));
    assert_eq!(run.kernel().state().vehicles["car-1"].at, "s-house");
}

#[test]
fn a_road_with_a_gap_is_no_way_through_and_a_world_with_a_way_says_how_big_a_cell_is() {
    let mut w = road_world();
    // A cell of the road is missing: no way through, so the car is no quicker than walking.
    w["world"]["structures"].as_array_mut().unwrap().retain(|s| s["id"] != "road-20");
    let mut gap = Run::start(w, "space-gap", Vec::new(), None).unwrap();
    let (s, d) = go(&mut gap, "alice-self", "s-shop/dwelling.1", Some("car-1")).unwrap();
    let mut on_foot = Run::start(road_world(), "space-foot", Vec::new(), None).unwrap();
    let (s0, d0) = go(&mut on_foot, "alice-self", "s-shop/dwelling.1", None).unwrap();
    assert_eq!(d - s, d0 - s0, "a road with a gap is walked");
    let mut w = road_world();
    w["world"]["ground"] = json!({"w": 40, "h": 3});
    assert!(Run::start(w, "space-cell", Vec::new(), None).err().map(|e| format!("{e:?}")).unwrap_or_default().contains("how many metres a cell is"));
    let mut w = road_world();
    w["travel"]["vehicle_types"][0].as_object_mut().unwrap().remove("speed_kmh");
    assert!(Run::start(w, "space-speed", Vec::new(), None).is_err());
}
