//! Nature (docs/design/world-expansion.md 2): covers, fields and populations stepped daily by the kernel; building
//! over habitat ends a population, and extinction is for good; surveys are work that finds an estimate only the
//! surveyor sees; passers-by see a conspicuous species, never a count; cleared land grows back; the truth is censused
//! monthly for measurement; and all of it replays exactly.

use crate::common;

use common::*;
use serde_json::{json, Value};
use oikos_kernel::events::{EventBody, RefusalCode};
use oikos_kernel::run::Run;
use oikos_kernel::Command;

const DAY: i64 = 86_400;

/// The test world, with nature: the east column is the river (water), the two cells west of its south end are
/// wetland, the rest is grassland. Frogs live in the wetland; herons (conspicuous) on grassland and water. The shop
/// pollutes, and the river carries it south.
fn nature_world() -> Value {
    let mut w = world(&default_params());
    let cat = w["catalogue"].as_object_mut().unwrap();
    cat.insert("land_covers".into(), json!([
        {"id": "water"}, {"id": "wetland"}, {"id": "grassland"},
        {"id": "cleared", "succeeds_to": {"cover": "grassland", "after_days": 10}}
    ]));
    cat.insert("default_cover".into(), json!("grassland"));
    cat.insert("cleared_cover".into(), json!("cleared"));
    cat.insert("fields".into(), json!([{"id": "pollution", "min": 0, "max": 1000000, "decay_bps_per_day": 100, "diffusion_bps_per_day": 1000, "flow_bps_per_day": 5000, "from_structures": {"shop": 50}}]));
    cat.insert("species".into(), json!([
        {"id": "frog", "capacity_per_1000_cells": {"wetland": 60000, "water": 5000}, "growth_bps_per_year": 15000, "mortality_bps_per_year": 3000, "dispersal_bps_per_year": 500,
         "barriers": ["built"], "min_viable": 2, "tolerance": {"pollution": {"above": 5000, "mortality_bps_per_day": 100}}, "detection_bps": 5000},
        {"id": "heron", "capacity_per_1000_cells": {"grassland": 2000, "water": 3000}, "growth_bps_per_year": 3000, "mortality_bps_per_year": 1500, "dispersal_bps_per_year": 2000,
         "min_viable": 1, "detection_bps": 9000, "conspicuous": true}
    ]));
    cat["tasks"].as_array_mut().unwrap().push(json!({"id": "survey", "labour": 600, "surveys": true}));
    // A park may be laid out on wetland (it's grassland while it stands).
    for t in cat["structure_types"].as_array_mut().unwrap() {
        if t["id"] == "park" {
            t["terrains"] = json!(["wetland"]);
            t["cover"] = json!("grassland");
        }
    }
    let world = w["world"].as_object_mut().unwrap();
    world["ground"]["terrain"].as_array_mut().unwrap().push(json!({"label": "wetland", "x": 2, "y": 1, "w": 1, "h": 2}));
    world.insert("populations".into(), json!([
        {"species": "frog", "cell": "cell.2.1", "count": 20}, {"species": "frog", "cell": "cell.2.2", "count": 20},
        {"species": "heron", "cell": "cell.3.1", "count": 2}
    ]));
    world.insert("flows".into(), json!([{"from": "cell.3.0", "to": "cell.3.1"}, {"from": "cell.3.1", "to": "cell.3.2"}]));
    w
}

fn start(w: &Value) -> Run<Vec<u8>> {
    Run::start(w.clone(), "nature", Vec::new(), None).unwrap()
}

fn act(run: &mut Run<Vec<u8>>, participant: &str, position: Option<&str>, blocks: Value) -> Result<Vec<EventBody>, RefusalCode> {
    let cmd = direct(participant, position, serde_json::from_value(blocks).unwrap()).unwrap();
    let r = step(run, &cmd).unwrap();
    match &r.events[0].body {
        EventBody::ActionApplied { .. } => Ok(r.events.into_iter().map(|e| e.body).collect()),
        EventBody::ActionRefused { code, .. } => Err(*code),
        other => panic!("{other:?}"),
    }
}

/// Advance, collecting the events on the way.
fn advance(run: &mut Run<Vec<u8>>, to: i64) -> Vec<EventBody> {
    run.command(&Command::Advance { to }).unwrap().events.into_iter().map(|e| e.body).collect()
}

fn total(run: &Run<Vec<u8>>, sp: &str) -> i64 {
    run.kernel().state().nature.as_ref().and_then(|n| n.populations.get(sp)).map_or(0, |m| m.values().sum())
}

#[test]
fn populations_live_on_their_covers_and_the_truth_is_censused_monthly() {
    let mut run = start(&nature_world());
    let ev = advance(&mut run, 300 * DAY);
    // Frogs grew toward the wetland's capacity (two cells of 60): logistic from 40 at 150% a year is about 75 by now.
    let frogs = total(&run, "frog");
    assert!((60..=110).contains(&frogs), "frogs {frogs}");
    // A census every 30 days, with the truth for measurement.
    let censuses: Vec<_> = ev.iter().filter_map(|e| match e { EventBody::NatureCensus { species, covers } => Some((species.clone(), covers.clone())), _ => None }).collect();
    assert_eq!(censuses.len(), 10);
    assert_eq!(censuses.last().unwrap().0["frog"].count, frogs);
    assert_eq!(censuses[0].1["wetland"], 2);
    // The shop's pollution is on the ground near it, and the river carries some south.
    let n = run.kernel().state().nature.clone().unwrap();
    assert!(n.fields["pollution"]["cell.0.2"] > 0);
    assert!(n.fields["pollution"].get("cell.3.2").is_some());
}

#[test]
fn building_over_habitat_ends_a_population_for_good() {
    let mut run = start(&nature_world());
    advance(&mut run, 30 * DAY);
    assert!(total(&run, "frog") > 0);
    // Parks laid out over both wetland cells (the builder's crew): frogs can't live on grassland.
    for cell in ["cell.2.1", "cell.2.2"] {
        act(&mut run, "builder-system", Some("builder"), json!([{"block": "construct", "at": cell, "structure_type": "park", "materials_at": "s-flats"}])).unwrap();
    }
    let ev = advance(&mut run, 400 * DAY);
    let extinct: Vec<_> = ev.iter().filter(|e| matches!(e, EventBody::SpeciesExtinct { species } if species == "frog")).collect();
    assert_eq!(extinct.len(), 1, "extinct once");
    assert_eq!(total(&run, "frog"), 0);
    assert!(run.kernel().state().nature.as_ref().unwrap().extinct.contains_key("frog"));
    // Herons, on grassland and water, carry on.
    assert!(total(&run, "heron") > 0);
}

#[test]
fn a_survey_is_work_whose_estimate_only_the_surveyor_sees() {
    let mut run = start(&nature_world());
    advance(&mut run, 60 * DAY + 3600);
    let truth: i64 = ["cell.2.1", "cell.2.2"].iter().map(|c| run.kernel().state().nature.as_ref().unwrap().populations["frog"].get(*c).copied().unwrap_or(0)).sum();
    // Carol (at the shop) surveys the two wetland cells for frogs: two units, 20 minutes of her time.
    let ev = act(&mut run, "developer-system", Some("developer"),
        json!([{"block": "work", "task": "survey", "units": 2, "at": "s-shop", "performers": ["carol"], "survey": {"of": "frog", "cells": ["cell.2.1", "cell.2.2"]}}])).unwrap();
    assert!(ev.iter().any(|e| matches!(e, EventBody::Worked { labour: 1200, .. })));
    let o = run.command(&Command::Observe { participant: "developer-system".into(), only: Some("developer".into()) }).unwrap().observation.unwrap();
    let found = o.outcomes.iter().find_map(|x| x.surveyed.clone()).expect("the surveyor sees what was found");
    assert_eq!(found["of"], "frog");
    let est: i64 = found["cells"].as_object().unwrap().values().map(|v| v.as_i64().unwrap()).sum();
    assert!(est <= truth && est * 4 >= truth, "found {est} of {truth} (half are found, on average)");
    // Nobody else sees it.
    let other = run.command(&Command::Observe { participant: "alice-self".into(), only: None }).unwrap().observation.unwrap();
    assert!(other.outcomes.iter().all(|x| x.surveyed.is_none()));
    // What a survey must say, and of what.
    let bad = |run: &mut Run<Vec<u8>>, b: Value| act(run, "developer-system", Some("developer"), json!([b]));
    assert_eq!(bad(&mut run, json!({"block": "work", "task": "survey", "units": 1, "at": "s-shop", "performers": ["carol"]})), Err(RefusalCode::BadSurvey));
    assert_eq!(bad(&mut run, json!({"block": "work", "task": "survey", "units": 1, "at": "s-shop", "performers": ["carol"], "survey": {"of": "unicorn", "cells": ["cell.2.1"]}})), Err(RefusalCode::BadSurvey));
    assert_eq!(bad(&mut run, json!({"block": "work", "task": "survey", "units": 2, "at": "s-shop", "performers": ["carol"], "survey": {"of": "frog", "cells": ["cell.2.1"]}})), Err(RefusalCode::BadSurvey));
    assert_eq!(bad(&mut run, json!({"block": "work", "task": "make", "units": 1, "at": "s-shop", "performers": ["carol"], "survey": {"of": "frog", "cells": ["cell.2.1"]}})), Err(RefusalCode::BadSurvey));
}

#[test]
fn passers_by_see_a_conspicuous_species_but_not_how_many() {
    let mut run = start(&nature_world());
    advance(&mut run, DAY + 3600);
    // (Whoever goes there sees it: nobody is shown ground they are not on.)
    let cells = go_and_see(&mut run, "mayor-system", "mayor/town", &["cell.3.1", "cell.2.1", "cell.1.0"]);
    let river = cells.iter().find(|c| c.cell == "cell.3.1").unwrap();
    assert_eq!(river.seen, vec![oikos_kernel::blocks::Id::new("heron")]);
    assert!(cells.iter().all(|c| !c.seen.iter().any(|x| x == "frog")), "frogs aren't conspicuous");
    assert_eq!(cells.iter().find(|c| c.cell == "cell.2.1").unwrap().terrain.as_deref(), Some("wetland"));
}

#[test]
fn cleared_land_grows_back() {
    let mut run = start(&nature_world());
    // The house comes down (an hour's demolition, by bob): its cell is cleared land, and grassland 10 days on.
    act(&mut run, "developer-system", Some("developer"), json!([{"block": "demolish", "structure": "s-house"}])).unwrap();
    act(&mut run, "developer-system", Some("developer"), json!([{"block": "work", "task": "demolish", "units": 3600, "at": "s-shop", "performers": ["carol"], "on": "s-house"}])).unwrap();
    assert_eq!(run.kernel().state().cells["cell.1.1"].terrain.as_deref(), Some("cleared"));
    advance(&mut run, 12 * DAY);
    assert_eq!(run.kernel().state().cells["cell.1.1"].terrain.as_deref(), Some("grassland"));
}

#[test]
fn nature_replays_exactly() {
    let w = nature_world();
    let go = || {
        let mut run = start(&w);
        advance(&mut run, 90 * DAY);
        run.kernel().state_hash().unwrap()
    };
    assert_eq!(go(), go());
    // A world without nature has none (and no daily step).
    let run = start(&world(&default_params()));
    assert!(run.kernel().state().nature.is_none());
}

/// Tier 2 (world-expansion 6.4): work draws from a field where there's enough of it, emits to a field and to a world
/// counter, and the counters are censused monthly.
#[test]
fn work_draws_from_and_emits_to_fields_and_counters() {
    let mut w = nature_world();
    let cat = w["catalogue"].as_object_mut().unwrap();
    cat.insert("counters".into(), json!([{"id": "ghg"}]));
    cat["tasks"].as_array_mut().unwrap().push(json!({"id": "clean", "labour": 1, "in": "workplace", "draws": {"field": "pollution", "per_unit": 10}}));
    cat["tasks"].as_array_mut().unwrap().push(json!({"id": "burn", "labour": 60, "in": "workplace", "emits": {"ghg": 5, "pollution": 1000}}));
    let mut run = start(&w);
    advance(&mut run, 10 * DAY);
    let field = |run: &Run<Vec<u8>>, cell: &str| run.kernel().state().nature.as_ref().unwrap().fields.get("pollution").and_then(|m| m.get(cell)).copied().unwrap_or(0);
    // The shop pollutes its own cell (cell.0.2) most: that's where a draw takes from.
    let before = field(&run, "cell.0.2");
    assert!(before > 20, "{before}");
    act(&mut run, "carol-self", None, json!([{"block": "work", "task": "clean", "units": 2, "at": "s-shop", "performers": ["carol"]}])).unwrap();
    assert_eq!(field(&run, "cell.0.2"), before - 20);
    // More than there is: refused, and nothing taken.
    assert_eq!(act(&mut run, "carol-self", None, json!([{"block": "work", "task": "clean", "units": 1000, "at": "s-shop", "performers": ["carol"]}])), Err(RefusalCode::FieldExhausted));
    assert_eq!(field(&run, "cell.0.2"), before - 20);
    // Emitting: to the counter, and to the field at the shop's corner cell.
    act(&mut run, "carol-self", None, json!([{"block": "work", "task": "burn", "units": 3, "at": "s-shop", "performers": ["carol"]}])).unwrap();
    assert_eq!(run.kernel().state().totals["ghg"], 15);
    assert_eq!(field(&run, "cell.0.2"), before - 20 + 3000);
    // The census, monthly.
    let ev = advance(&mut run, 31 * DAY);
    let census: Vec<_> = ev.iter().filter_map(|e| match e { EventBody::CounterCensus { counters } => Some(counters.clone()), _ => None }).collect();
    assert_eq!(census.len(), 1);
    assert_eq!(census[0]["ghg"], 15);
}

/// Floods (world-expansion 7.3): a building whose type floods, above its level, is under water: its occupants moved out,
/// no one let in, its wear rising; the water down, it's receded. Sources scale by day; a field spills over a level.
#[test]
fn a_building_floods_above_its_level_and_recedes() {
    let mut w = nature_world();
    // The shop's own pollution stands in for water: it floods above 100, and from day 6 the source stops.
    w["catalogue"]["fields"][0]["source_by_day"] = json!([{"from_day": 6, "bps": 0}]);
    w["catalogue"]["fields"][0]["decay_bps_per_day"] = json!(5000);
    w["catalogue"]["fields"][0]["spills_above"] = json!(1000);
    w["catalogue"]["fields"][0]["spill_bps_per_day"] = json!(5000);
    for t in w["catalogue"]["structure_types"].as_array_mut().unwrap() {
        if t["id"] == "shop" {
            t["floods"] = json!({"field": "pollution", "above": 30, "wear_per_day": 100});
        }
    }
    let mut run = start(&w);
    let ev = advance(&mut run, 5 * DAY);
    assert!(ev.iter().any(|e| matches!(e, EventBody::Flooded { structure, .. } if structure == "s-shop")));
    assert!(ev.iter().any(|e| matches!(e, EventBody::Vacated { occupant, reason, .. } if occupant == "carol" && format!("{reason:?}") == "Flooded")));
    assert!(run.kernel().state().structures_of("carol").is_empty());
    assert_eq!(act(&mut run, "carol-self", None, json!([{"block": "occupy", "space": "s-shop/workplace.1"}])), Err(RefusalCode::Flooded));
    // The source stopped, it decays: receded, and carol can go back.
    let ev = advance(&mut run, 20 * DAY);
    assert!(ev.iter().any(|e| matches!(e, EventBody::FloodReceded { structure } if structure == "s-shop")));
    act(&mut run, "carol-self", None, json!([{"block": "occupy", "space": "s-shop/workplace.1"}])).unwrap();
}

/// A flooded building that comes down isn't flooded any more: there's nothing there. (Until 2026-10-05 its id stayed
/// among the flooded for good: only standing structures are looked at when the water goes down.)
#[test]
fn a_flooded_building_brought_down_is_no_longer_among_the_flooded() {
    let mut w = nature_world();
    for t in w["catalogue"]["structure_types"].as_array_mut().unwrap() {
        if t["id"] == "shop" {
            t["floods"] = json!({"field": "pollution", "above": 30, "wear_per_day": 100});
        }
    }
    let mut run = start(&w);
    let ev = advance(&mut run, 5 * DAY);
    assert!(ev.iter().any(|e| matches!(e, EventBody::Flooded { structure, .. } if structure == "s-shop")));
    assert!(run.kernel().state().flooded.contains("s-shop"));
    let ev = act(&mut run, "developer-system", Some("developer"), json!([{"block": "demolish", "structure": "s-shop"}])).unwrap();
    assert!(ev.iter().any(|e| matches!(e, EventBody::StructureDemolished { structure, .. } if structure == "s-shop")));
    let st = run.kernel().state();
    assert!(!st.structures.contains_key("s-shop"));
    assert!(st.flooded.is_empty(), "still among the flooded: {:?}", st.flooded);
    // Nothing recedes later from where nothing stands, and the run replays.
    let ev = advance(&mut run, 40 * DAY);
    assert!(!ev.iter().any(|e| matches!(e, EventBody::FloodReceded { .. })));
    run.finish("completed", None).unwrap();
    oikos_kernel::replay(&run.into_log(), None).unwrap();
}

/// Two surveys of the same thing in one action are two looks, each with its own draws: keyed by the block as well as
/// who looked and the day. (Until 2026-10-05 they shared the action's draws, so the second found exactly what the first
/// did. Until 2026-10-12 the key was the action's number, which moves with every act anyone makes.)
#[test]
fn two_surveys_in_one_action_draw_independently() {
    let mut run = start(&nature_world());
    advance(&mut run, 60 * DAY + 3600);
    let cells = ["cell.2.1", "cell.2.2"];
    let counts: Vec<i64> = cells.iter().map(|c| run.kernel().state().nature.as_ref().unwrap().populations["frog"].get(*c).copied().unwrap_or(0)).collect();
    assert!(counts.iter().sum::<i64>() >= 20, "enough frogs for two looks to differ: {counts:?}");
    let look = json!({"block": "work", "task": "survey", "units": 2, "at": "s-shop", "performers": ["carol"], "survey": {"of": "frog", "cells": cells}});
    act(&mut run, "developer-system", Some("developer"), json!([look.clone(), look])).unwrap();
    let o = run.command(&Command::Observe { participant: "developer-system".into(), only: Some("developer".into()) }).unwrap().observation.unwrap();
    let outcome = o.outcomes.iter().find(|x| x.surveyed.is_some()).unwrap();
    // What each block's own draws find (a frog is found with the species' chance, 5,000 in 10,000; cell by cell).
    let by_block = |index: &str| -> Vec<i64> {
        let day = (run.kernel().state().t / DAY).to_string();
        let mut rng = run.kernel().statics().randomness.stream(&["survey", "developer-system", "frog", &day, index]);
        counts.iter().map(|n| (0..*n).filter(|_| rng.below(10_000) < 5_000).count() as i64).collect()
    };
    let (first, second) = (by_block("0"), by_block("1"));
    assert_ne!(first, second, "the two looks find different things");
    // The outcome carries the action's last survey: the second block's.
    let found = outcome.surveyed.clone().unwrap();
    assert_eq!(cells.iter().map(|c| found["cells"][*c].as_i64().unwrap()).collect::<Vec<_>>(), second);
}
