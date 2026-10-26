//! Work (contracts v0.5, phase B): performers at a place spend their time on a task; a person has only so many
//! working hours in a day; inputs are used up and outputs made; state variables (wear) change with time, occupancy
//! and work, exactly; a building completes only with its materials, its labour and its time; demolition takes labour.

mod common;

use common::*;
use serde_json::{json, Value};
use oikos_kernel::events::{EventBody, RefusalCode};
use oikos_kernel::run::Run;
use oikos_kernel::Command;

const DAY: i64 = 86_400;

fn town() -> Run<Vec<u8>> {
    Run::start(world(&default_params()), "work", Vec::new(), None).unwrap()
}

fn act(run: &mut Run<Vec<u8>>, participant: &str, position: Option<&str>, blocks: Value) -> Result<Vec<EventBody>, RefusalCode> {
    let blocks = serde_json::from_value(blocks).unwrap();
    let cmd = direct(participant, position, blocks).unwrap();
    let r = step(run, &cmd).unwrap();
    match &r.events[0].body {
        EventBody::ActionApplied { .. } => Ok(r.events.into_iter().map(|e| e.body).collect()),
        EventBody::ActionRefused { code, .. } => Err(*code),
        other => panic!("{other:?}"),
    }
}

fn make(run: &mut Run<Vec<u8>>, units: u64, performers: &[&str]) -> Result<Vec<EventBody>, RefusalCode> {
    act(run, "developer-system", Some("developer"), json!([{"block": "work", "task": "make", "units": units, "at": "s-shop", "performers": performers}]))
}

fn advance(run: &mut Run<Vec<u8>>, to: i64) {
    run.command(&Command::Advance { to }).unwrap();
}

#[test]
fn work_needs_people_at_work_with_time_left_and_the_inputs() {
    let mut run = town();
    let st = |run: &Run<Vec<u8>>, kind: &str| run.kernel().state().holding("devco", "s-shop", kind);
    // Carol works at the shop (a workplace there): 4 units take 2 hours of hers, 40 kg of materials, and make 20 goods.
    make(&mut run, 4, &["carol"]).unwrap();
    assert_eq!((st(&run, "materials"), st(&run, "goods")), (1000 - 40, 200 + 20));
    // Nobody named, for work that takes time; someone who isn't there; someone there but not in a workplace.
    assert_eq!(make(&mut run, 1, &[]), Err(RefusalCode::NotAtWork));
    assert_eq!(make(&mut run, 1, &["alice"]), Err(RefusalCode::NotAtWork));
    // Her working day is 8 hours: 2 used, 12 more units (6 hours) fit, then no more today.
    make(&mut run, 12, &["carol"]).unwrap();
    assert_eq!(make(&mut run, 1, &["carol"]), Err(RefusalCode::NoTimeLeft));
    // Tomorrow she has a whole day again.
    advance(&mut run, DAY + 3600);
    make(&mut run, 1, &["carol"]).unwrap();
    // Asking more of her than a day holds is refused on time, before anything's used.
    assert_eq!(make(&mut run, 200, &["carol"]), Err(RefusalCode::NoTimeLeft));
    // With the materials moved away (all but 5 kg), one unit (10 kg) can't be made: refused, and nothing used.
    let away = st(&run, "materials") - 5;
    act(&mut run, "developer-system", Some("developer"), json!([{"block": "move_goods", "kind": "materials", "quantity": away.to_string(), "from_at": "s-shop", "to": "devco", "to_at": "s-flats"}])).unwrap();
    assert_eq!(make(&mut run, 1, &["carol"]), Err(RefusalCode::InsufficientQuantity));
    assert_eq!(st(&run, "materials"), 5);
    // An unknown task, a place that isn't there.
    assert_eq!(act(&mut run, "developer-system", Some("developer"), json!([{"block": "work", "task": "juggle", "units": 1, "at": "s-shop", "performers": ["carol"]}])), Err(RefusalCode::UnknownTask));
    // Using things up takes no one's time: alice eats at home.
    act(&mut run, "alice-self", None, json!([{"block": "work", "task": "eat", "units": 3, "at": "s-house", "performers": []}])).unwrap();
    assert_eq!(run.kernel().state().holding("alice", "s-house", "goods"), 10 - 3);
}

#[test]
fn wear_rises_by_the_day_and_mending_lowers_it_exactly() {
    let mut run = town();
    let wear = |run: &Run<Vec<u8>>, sid: &str| {
        let st = run.kernel().state();
        let cfg = &run.kernel().statics().config.catalogue.variables[0];
        oikos_kernel::exec::variable_at(st, sid, cfg, st.t).unwrap()
    };
    // The house (alice inside): 100 at the start, +1 a day. (A variable is a condition: it does not grow by its
    // occupants, law 8; until foundations-2 C4 this world's wear rose 2 a day for each.)
    assert_eq!(wear(&run, "s-house"), 100);
    advance(&mut run, 10 * DAY);
    assert_eq!(wear(&run, "s-house"), 110);
    // Alice leaves: still 1 a day (to the twentieth day).
    act(&mut run, "alice-self", None, json!([{"block": "vacate", "occupant": "alice", "from": "s-house"}])).unwrap();
    advance(&mut run, 20 * DAY);
    assert_eq!(wear(&run, "s-house"), 120);
    // Mending (carol, from the shop) takes 50 off a unit, down to the minimum and no further.
    act(&mut run, "developer-system", Some("developer"), json!([{"block": "work", "task": "mend", "units": 2, "at": "s-shop", "performers": ["carol"], "on": "s-house"}])).unwrap();
    assert_eq!(wear(&run, "s-house"), 20);
    act(&mut run, "developer-system", Some("developer"), json!([{"block": "work", "task": "mend", "units": 2, "at": "s-shop", "performers": ["carol"], "on": "s-house"}])).unwrap();
    assert_eq!(wear(&run, "s-house"), 0);
    // Seen with its trend: a look shows the value on a day and the rate, and today's value follows from them.
    let cells = go_and_see(&mut run, "mayor-system", "mayor/town", &["s-house"]);
    let v = &cells.iter().find(|c| c.cell == "cell.1.1").unwrap().structure.as_ref().unwrap().variables.as_ref().unwrap()["wear"];
    assert_eq!((v.value, v.per_day, v.min, v.max), (0, 1, 0, 10_000));
}

#[test]
fn a_building_completes_only_with_its_materials_its_labour_and_its_time() {
    let mut run = town();
    // A house needs 300 kg of materials (the builder's, at the flats), 4 hours' building, and 20 days.
    let r = act(&mut run, "builder-system", Some("builder"), json!([{"block": "construct", "at": "cell.2.1", "structure_type": "house", "materials_at": "s-flats", "ref": "h"}])).unwrap();
    let house = r.iter().find_map(|e| match e { EventBody::StructureStarted { structure, .. } => Some(structure.clone()), _ => None }).unwrap();
    assert_eq!(run.kernel().state().holding("buildco", "s-flats", "materials"), 5000 - 300);
    let build = |run: &mut Run<Vec<u8>>, seconds: u64| act(run, "builder-system", Some("builder"), json!([{"block": "work", "task": "build", "units": seconds, "at": "s-flats", "performers": ["bob"], "on": house}]));
    // Its time passes, but it isn't built: it waits for its labour.
    advance(&mut run, 21 * DAY);
    assert!(!run.kernel().state().structures[&house].complete);
    // Bob works 3 hours today, 1 more tomorrow: it completes with the last hour.
    build(&mut run, 3 * 3600).unwrap();
    assert!(!run.kernel().state().structures[&house].complete);
    advance(&mut run, 22 * DAY);
    let r = build(&mut run, 3600).unwrap();
    assert!(r.iter().any(|e| matches!(e, EventBody::StructureCompleted { .. })));
    // No more building work on it.
    assert_eq!(build(&mut run, 60), Err(RefusalCode::NotBeingBuilt));
    // Without materials where the builder says they are, nothing is begun.
    assert_eq!(
        act(&mut run, "builder-system", Some("builder"), json!([{"block": "construct", "at": "cell.2.2", "structure_type": "house", "materials_at": "s-house"}])),
        Err(RefusalCode::InsufficientQuantity)
    );
}

#[test]
fn labour_done_first_completes_when_its_time_is_up() {
    let mut run = town();
    let r = act(&mut run, "builder-system", Some("builder"), json!([{"block": "construct", "at": "cell.2.1", "structure_type": "shop", "materials_at": "s-flats", "ref": "s"}])).unwrap();
    let shop = r.iter().find_map(|e| match e { EventBody::StructureStarted { structure, .. } => Some(structure.clone()), _ => None }).unwrap();
    act(&mut run, "builder-system", Some("builder"), json!([{"block": "work", "task": "build", "units": 7200, "at": "s-flats", "performers": ["bob"], "on": shop}])).unwrap();
    assert!(!run.kernel().state().structures[&shop].complete, "labour done, but not its 30 days");
    advance(&mut run, 31 * DAY);
    assert!(run.kernel().state().structures[&shop].complete);
}

#[test]
fn demolition_takes_labour_and_nobody_moves_in_meanwhile() {
    let mut run = town();
    // The house needs an hour's demolition: its occupant leaves at once, and it stands until the work is done.
    let r = act(&mut run, "developer-system", Some("developer"), json!([{"block": "demolish", "structure": "s-house"}])).unwrap();
    assert!(r.iter().any(|e| matches!(e, EventBody::DemolitionStarted { .. })));
    assert!(run.kernel().state().structures.contains_key("s-house"));
    assert_eq!(act(&mut run, "carol-self", None, json!([{"block": "occupy", "space": "s-house/dwelling.1"}])), Err(RefusalCode::ComingDown));
    let r = act(&mut run, "developer-system", Some("developer"), json!([{"block": "work", "task": "demolish", "units": 3600, "at": "s-shop", "performers": ["carol"], "on": "s-house"}])).unwrap();
    assert!(r.iter().any(|e| matches!(e, EventBody::StructureDemolished { .. })));
    assert!(!run.kernel().state().structures.contains_key("s-house"));
    // What was held there stays held there (alice's goods), to be moved out.
    assert_eq!(run.kernel().state().holding("alice", "s-house", "goods"), 10);
}

/// A holding stays within the range of a quantity: what work would make, or a taking would bring, beyond it is refused
/// in the ordinary way, and nothing changes. (Until 2026-10-05 these sums weren't checked: a holding could pass the
/// range, or overflow, which stops a test build and wrapped in a release one.)
#[test]
fn a_holding_at_the_top_of_its_range_refuses_more_from_work_or_a_taking() {
    use oikos_kernel::money::MAX_MONEY;
    let mut w = world(&default_params());
    let holdings = w["world"]["holdings"].as_array_mut().unwrap();
    // The developer's goods in the shop: room for one more unit's worth (5), and no more. Bob's, kept at alice's house:
    // room for 2.
    holdings.iter_mut().find(|h| h["holder"] == "devco" && h["kind"] == "goods").unwrap()["quantity"] = json!((MAX_MONEY - 9).to_string());
    holdings.push(json!({"kind": "goods", "holder": "bob", "at": "s-house", "quantity": (MAX_MONEY - 2).to_string()}));
    let mut run = Run::start(w, "work", Vec::new(), None).unwrap();
    let held = |run: &Run<Vec<u8>>, who: &str, at: &str, kind: &str| run.kernel().state().holding(who, at, kind);
    make(&mut run, 1, &["carol"]).unwrap();
    assert_eq!(held(&run, "devco", "s-shop", "goods"), MAX_MONEY - 4);
    assert_eq!(make(&mut run, 1, &["carol"]), Err(RefusalCode::Overflow));
    // Refused whole: nothing made, nothing used, none of carol's time spent (she can still work the rest of her day).
    assert_eq!((held(&run, "devco", "s-shop", "goods"), held(&run, "devco", "s-shop", "materials")), (MAX_MONEY - 4, 1000 - 10));
    // A taking: bob, at alice's, takes 3 of her goods and would hold more than a quantity can be; 2 fit.
    act(&mut run, "bob-self", None, json!([{"block": "occupy", "space": "s-house/dwelling.1"}])).unwrap();
    let take = |n: u32| json!([{"block": "take", "kind": "goods", "quantity": n.to_string(), "from": "alice", "at": "s-house"}]);
    assert_eq!(act(&mut run, "bob-self", None, take(3)), Err(RefusalCode::Overflow));
    assert_eq!((held(&run, "alice", "s-house", "goods"), held(&run, "bob", "s-house", "goods")), (10, MAX_MONEY - 2));
    act(&mut run, "bob-self", None, take(2)).unwrap();
    assert_eq!((held(&run, "alice", "s-house", "goods"), held(&run, "bob", "s-house", "goods")), (8, MAX_MONEY));
    // The state still hashes, and the run replays.
    run.finish("completed", None).unwrap();
    oikos_kernel::replay(&run.into_log(), None).unwrap();
}

/// A demolition empties a building as anyone leaves a space: its variables are settled first (they were rising with its
/// occupants), and each departure is recorded for those who can see who's there. (Until 2026-10-05 a demolition did
/// neither: the wear of the days its occupants lived there was lost, and nobody was recorded as having left.)
#[test]
fn a_demolition_settles_the_building_and_records_who_left() {
    use oikos_kernel::events::VacateReason;
    let mut run = town();
    let wear = |run: &Run<Vec<u8>>| {
        let st = run.kernel().state();
        let cfg = &run.kernel().statics().config.catalogue.variables[0];
        oikos_kernel::exec::variable_at(st, "s-house", cfg, st.t).unwrap()
    };
    // The house, alice inside: 100 at the start, 1 a day.
    advance(&mut run, 10 * DAY);
    assert_eq!(wear(&run), 110);
    // Demolition begins (the house needs an hour's work to come down): alice is out at once.
    let r = act(&mut run, "developer-system", Some("developer"), json!([{"block": "demolish", "structure": "s-house"}])).unwrap();
    assert!(r.iter().any(|e| matches!(e, EventBody::Vacated { occupant, reason: VacateReason::Demolition, .. } if occupant == "alice")));
    assert!(r.iter().any(|e| matches!(e, EventBody::DemolitionStarted { .. })));
    let st = run.kernel().state();
    assert!(st.structures_of("alice").is_empty());
    let gone = st.departures.get("s-house/dwelling.1").expect("the departure is recorded");
    assert_eq!(gone.iter().map(|d| (d.occupant.as_str(), d.reason)).collect::<Vec<_>>(), vec![("alice", VacateReason::Demolition)]);
    // Its wear is what its ten days made it, and rises from there at 1 a day.
    assert_eq!(wear(&run), 110);
    advance(&mut run, 20 * DAY);
    assert_eq!(wear(&run), 120);
    run.finish("completed", None).unwrap();
    oikos_kernel::replay(&run.into_log(), None).unwrap();
}
