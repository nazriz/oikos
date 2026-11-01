//! Everything physical is somewhere, and moves only along a network (law 9; docs/design/foundations-2.md section 3). The
//! kernel's side of its backstop (`orchestrator/test/everything-is-somewhere.test.ts`), grown step by step:
//!
//! - **S1:** over any sequence of operations, a body is in one place at a time: in at most one building's spaces, never
//!   in two. (Going somewhere takes the trip: `services.rs`, `a_body_is_in_one_place_and_going_somewhere_takes_the_trip`.)
//! - **S2:** roads are ways: a trip goes along them at the vehicle's speed (or on foot), a road with a gap is no way
//!   through, a vehicle is driven only by whoever may and only from where it stands, and stands where it went.
//! - **S3:** a body on its way is in no building from when it sets out until it arrives (the property, and a trip by car),
//!   its vehicle with it; a trip refused on arrival brings it back where it set out.

mod common;

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
        // (S3: a body on its way is in no building, and arrives no sooner than it set out.)
        for (body, tr) in st.transit.iter() {
            prop_assert!(st.structures_of(body).is_empty(), "{} is on its way and in {:?}", body, st.structures_of(body));
            prop_assert!(tr.arrives >= tr.departed);
        }
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

// ----------------------------------------------------------------------------------------------------------------- S3: on the way

fn start_go(run: &mut Run<Vec<u8>>, who: &str, space: &str, vehicle: Option<&str>) -> (i64, i64, Vec<EventBody>) {
    let mut b = json!({"block": "occupy", "space": space});
    if let Some(v) = vehicle {
        b["vehicle"] = json!(v);
    }
    let cmd = direct(who, None, serde_json::from_value(json!([b])).unwrap()).unwrap();
    // (Begun, not carried through: the act is under way.)
    let r = run.command(&cmd).unwrap();
    let (s, d) = r.events.iter().find_map(|e| match &e.body { EventBody::ActionStarted { starts, done, .. } => Some((*starts, *done)), _ => None }).unwrap();
    (s, d, r.events.into_iter().map(|e| e.body).collect())
}

#[test]
fn a_body_on_its_way_is_in_no_building_until_it_arrives_and_its_car_goes_with_it() {
    let mut run = Run::start(road_world(), "space-transit", Vec::new(), None).unwrap();
    let (starts, done, events) = start_go(&mut run, "alice-self", "s-shop/dwelling.1", Some("car-1"));
    // She sets out at once: out of her home, on her way, the car with her.
    assert!(events.iter().any(|e| matches!(e, EventBody::Vacated { occupant, .. } if occupant == "alice")));
    assert!(starts < done);
    let st = run.kernel().state();
    assert!(st.structures_of("alice").is_empty(), "on her way, she is in no building");
    assert_eq!(st.transit["alice"].to, "s-shop");
    assert_eq!(st.vehicles["car-1"].at, "alice", "the car is on the road with her");
    // Bob cannot take the car she is driving; she knows where she is going and when she gets there.
    assert_eq!(go(&mut run, "bob-self", "s-house/dwelling.1", Some("car-1")), Err(RefusalCode::NotPresent));
    let o = run.command(&Command::Observe { participant: "alice-self".into(), only: None }).unwrap().observation.unwrap();
    assert_eq!(serde_json::to_value(&o).unwrap()["body"]["on_way"], json!({"to": "s-shop", "arrives": done}));
    // She arrives when the trip is done, and the car is there.
    run.command(&Command::Advance { to: done + 1 }).unwrap();
    let st = run.kernel().state();
    assert_eq!(st.structures_of("alice"), vec![oikos_kernel::blocks::Id::new("s-shop")]);
    assert!(st.transit.is_empty());
    assert_eq!(st.vehicles["car-1"].at, "s-shop");
}

#[test]
fn a_trip_refused_on_arrival_brings_the_body_back_where_it_set_out() {
    let mut run = Run::start(road_world(), "space-back", Vec::new(), None).unwrap();
    let (_, done, _) = start_go(&mut run, "alice-self", "s-shop/dwelling.1", None);
    // While she walks, carol takes the shop's one bed.
    let (_, carol_done, _) = start_go(&mut run, "carol-self", "s-shop/dwelling.1", None);
    assert!(carol_done < done);
    let out = run.command(&Command::Advance { to: done + 1 }).unwrap();
    assert!(out.events.iter().any(|e| matches!(e.body, EventBody::ActionRefused { code: RefusalCode::CapacityExceeded, .. })));
    let st = run.kernel().state();
    assert_eq!(st.structures_of("alice"), vec![oikos_kernel::blocks::Id::new("s-house")], "back home");
    assert!(st.transit.is_empty());
}

// ----------------------------------------------------------------------------------------------------------------- S4: carried

fn act_now(run: &mut Run<Vec<u8>>, who: &str, pos: Option<&str>, blocks: Value) -> (i64, i64, Vec<EventBody>) {
    let cmd = direct(who, pos, serde_json::from_value(blocks).unwrap()).unwrap();
    let r = run.command(&cmd).unwrap();
    let Some((s, d)) = r.events.iter().find_map(|e| match &e.body { EventBody::ActionStarted { starts, done, .. } => Some((*starts, *done)), _ => None }) else {
        return (0, 0, r.events.into_iter().map(|e| e.body).collect());
    };
    (s, d, r.events.into_iter().map(|e| e.body).collect())
}

fn refused(events: &[EventBody]) -> Option<RefusalCode> {
    events.iter().find_map(|e| match e {
        EventBody::ActionRefused { code, .. } => Some(*code),
        _ => None,
    })
}

#[test]
fn goods_between_two_buildings_go_only_with_someone_who_carries_them_there_and_back() {
    // Nobody takes them: refused, and nothing moves.
    let mut run = Run::start(road_world(), "space-carry", Vec::new(), None).unwrap();
    let (_, done, ev) = act_now(&mut run, "alice-self", None, json!([{"block": "move_goods", "kind": "goods", "quantity": "3", "from_at": "s-house", "to": "alice", "to_at": "s-shop"}]));
    let out = run.command(&Command::Advance { to: done + 1 }).unwrap();
    let all: Vec<EventBody> = ev.into_iter().chain(out.events.into_iter().map(|e| e.body)).collect();
    assert_eq!(refused(&all), Some(RefusalCode::NotCarried));
    assert_eq!(run.kernel().state().holding("alice", "s-house", "goods"), 10);
    // She carries them: she goes to the shop and back (twice the way), is in no building meanwhile, and they are there.
    let mut run = Run::start(road_world(), "space-carry2", Vec::new(), None).unwrap();
    let (starts, done, _) = act_now(&mut run, "alice-self", None, json!([{"block": "move_goods", "kind": "goods", "quantity": "3", "from_at": "s-house", "to": "alice", "to_at": "s-shop", "carried": true}]));
    let mut walk = Run::start(road_world(), "space-carry-walk", Vec::new(), None).unwrap();
    let (s0, d0, _) = act_now(&mut walk, "alice-self", None, json!([{"block": "occupy", "space": "s-shop/dwelling.1"}]));
    assert!((done - starts) >= 2 * (d0 - s0) - 10, "there and back: {} against one way {}", done - starts, d0 - s0);
    assert!(run.kernel().state().structures_of("alice").is_empty());
    let out = run.command(&Command::Advance { to: done + 1 }).unwrap();
    assert_eq!(refused(&out.events.iter().map(|e| e.body.clone()).collect::<Vec<_>>()), None);
    let st = run.kernel().state();
    assert_eq!((st.holding("alice", "s-house", "goods"), st.holding("alice", "s-shop", "goods")), (7, 3));
    assert_eq!(st.structures_of("alice"), vec![oikos_kernel::blocks::Id::new("s-house")], "home again");
    assert!(out.events.iter().any(|e| matches!(&e.body, EventBody::GoodsMoved { carrier: Some(c), .. } if c == "alice")));
}

#[test]
fn a_crew_goes_to_the_building_it_works_on_and_is_away_from_its_depot_meanwhile() {
    let mut run = Run::start(road_world(), "space-crew", Vec::new(), None).unwrap();
    let (_, done, _) = act_now(&mut run, "developer-system", Some("developer"), json!([{"block": "work", "task": "mend", "units": 1, "at": "s-shop", "on": "s-house", "performers": ["carol"]}]));
    assert!(run.kernel().state().structures_of("carol").is_empty(), "carol has gone to the house");
    assert!(run.kernel().state().transit["carol"].via.iter().any(|x| x == "s-house"));
    let out = run.command(&Command::Advance { to: done + 1 }).unwrap();
    assert_eq!(refused(&out.events.iter().map(|e| e.body.clone()).collect::<Vec<_>>()), None);
    assert_eq!(run.kernel().state().structures_of("carol"), vec![oikos_kernel::blocks::Id::new("s-shop")], "back at the shop");
}

#[test]
fn the_outsides_freight_takes_its_time_from_the_edges_node_and_goods_on_their_way_are_still_counted() {
    let mut w = road_world();
    // A road out of the town from the street's west end to the outside, 90 km at 90 km/h: an hour.
    w["world"]["network"] = json!({"nodes": [{"id": "n-gate", "cell": "cell.2.1"}, {"id": "n-out", "edge": "outside"}],
        "links": [{"id": "road-out", "from": "n-gate", "to": "n-out", "mode": "road", "length_m": 90_000, "capacity": 600, "speed_kmh": 90}]});
    let mut run = Run::start(w, "space-freight", Vec::new(), None).unwrap();
    let before = run.kernel().state().total_goods();
    let (_, done, ev) = act_now(&mut run, "outside-system", Some("outside-trade"), json!([{"block": "move_goods", "kind": "goods", "quantity": "40", "from_at": "outside", "to": "devco", "to_at": "s-shop"}]));
    if done == 0 {
        panic!("{ev:?}");
    }
    let out = run.command(&Command::Advance { to: done + 1 }).unwrap();
    let arrives = out.events.iter().find_map(|e| match &e.body { EventBody::GoodsMoved { arrives, .. } => *arrives, _ => None }).expect("on its way");
    assert!(arrives >= done + 3_600, "an hour on the road out, and more through the town");
    assert_eq!(run.kernel().state().holding("devco", "s-shop", "goods"), 200, "not there yet");
    assert_eq!(run.kernel().state().total_goods(), before, "on their way, still counted");
    run.command(&Command::Advance { to: arrives + 1 }).unwrap();
    assert_eq!(run.kernel().state().holding("devco", "s-shop", "goods"), 240);
}

// ----------------------------------------------------------------------------------------------------------------- dead on the way

#[test]
fn someone_who_dies_on_the_way_lies_where_they_had_come_to_and_whoever_comes_by_sees_them() {
    let mut run = Run::start(road_world(), "space-remains", Vec::new(), None).unwrap();
    let (starts, done, _) = start_go(&mut run, "alice-self", "s-shop/dwelling.1", None);
    let mut st = run.kernel().state().clone();
    let s = run.kernel().statics().clone();
    let tr = st.transit["alice"].clone();
    // Halfway along the way from her house (1,1) to the shop (39,2): about cell 20 of the straight line.
    let mid = oikos_kernel::exec::where_on_the_way(&st, &tr, starts + (done - starts) / 2).expect("a cell of the road");
    let (x, _) = oikos_kernel::config::cell_xy(&mid).unwrap();
    assert!((18..=22).contains(&x), "{mid}");
    st.remains.insert("alice".into(), mid);
    // Bob comes by the same way (from the house to the shop): he sees her there, as a look at that cell would show it.
    let mut by = tr.clone();
    by.from = "s-house".into();
    oikos_kernel::exec::seen_on_the_way(&s, &mut st, "bob", &by);
    let pending = &st.participants["bob-self"].pending;
    let seen = pending.values().flat_map(|p| p.visits.iter()).flat_map(|v| v.cells.iter()).find(|c| c.cell == mid).expect("bob saw the cell");
    assert_eq!(seen.remains, vec![oikos_kernel::blocks::Id::new("alice")]);
    // Carol, who went nowhere near (a trip from the shop to itself), sees nothing.
    let mut away = tr.clone();
    away.from = "s-shop".into();
    away.to = "s-shop".into();
    oikos_kernel::exec::seen_on_the_way(&s, &mut st, "carol", &away);
    assert!(st.participants["carol-self"].pending.values().all(|p| p.visits.is_empty()));
}
