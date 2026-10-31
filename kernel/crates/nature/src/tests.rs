use super::*;
use oikos_contracts::config::{Catalogue, LandCoverCfg, SuccessionCfg};

fn cat(json: serde_json::Value) -> Catalogue {
    let mut base = serde_json::json!({ "structure_types": [] });
    base.as_object_mut().unwrap().extend(json.as_object().unwrap().clone());
    serde_json::from_value(base).unwrap()
}

/// A row of `w` cells, cell.0.0 .. cell.<w-1>.0.
fn row(w: i64, flows: &[FlowCfg]) -> Ground {
    Ground::new(&(0..w).map(|x| (Id::from(format!("cell.{x}.0")), x, 0)).collect::<Vec<_>>(), flows)
}

fn land(covers: &[&str]) -> Land {
    Land { cover: covers.iter().map(|c| Id::new(c)).collect(), built: covers.iter().map(|c| *c == "built").collect(), anchored: vec![vec![]; covers.len()] }
}

fn frog() -> serde_json::Value {
    serde_json::json!({ "id": "frog", "capacity_per_1000_cells": { "wetland": 100000 }, "growth_bps_per_year": 20000, "mortality_bps_per_year": 2000,
        "dispersal_bps_per_year": 1000, "barriers": ["built"], "min_viable": 4, "detection_bps": 6000 })
}

fn run(c: &Catalogue, g: &Ground, l: &Land, st: &mut NatureState, days: std::ops::Range<i64>, r: &Randomness) -> Vec<DayResult> {
    days.map(|d| step_day(c, g, l, st, d, r)).collect()
}

fn total(st: &NatureState, sp: &str) -> i64 {
    st.populations.get(sp).map_or(0, |m| m.values().sum())
}

#[test]
fn a_population_grows_toward_its_capacity_and_stays_near_it() {
    let c = cat(serde_json::json!({ "species": [frog()] }));
    let g = row(3, &[]);
    let l = land(&["wetland", "wetland", "wetland"]);
    let mut st = NatureState::default();
    st.populations.insert("frog".into(), Cells::from_iter([(Id::from("cell.1.0"), 10)]));
    let r = Randomness::new(7);
    run(&c, &g, &l, &mut st, 0..3650, &r);
    let t = total(&st, "frog");
    assert!((240..=310).contains(&t), "total {t}: near 3 cells x 100");
    assert!(st.extinct.is_empty());
}

#[test]
fn no_capacity_no_life_and_extinction_is_permanent() {
    let c = cat(serde_json::json!({ "species": [frog()] }));
    let g = row(2, &[]);
    let mut st = NatureState::default();
    st.populations.insert("frog".into(), Cells::from_iter([(Id::from("cell.0.0"), 50)]));
    let r = Randomness::new(1);
    // The wetland is built over: none can live there, and the one neighbour is built too (a barrier).
    let results = run(&c, &g, &land(&["built", "built"]), &mut st, 0..3, &r);
    assert_eq!(total(&st, "frog"), 0);
    assert_eq!(st.extinct.get("frog"), Some(&0));
    assert_eq!(results[0].extinct, vec![Id::new("frog")]);
    // Wetland again: nothing comes back, and extinction isn't recorded twice.
    let results = run(&c, &g, &land(&["wetland", "wetland"]), &mut st, 3..400, &r);
    assert_eq!(total(&st, "frog"), 0);
    assert!(results.iter().all(|x| x.extinct.is_empty()));
}

#[test]
fn a_barrier_between_habitats_keeps_them_apart() {
    let c = cat(serde_json::json!({ "species": [frog()] }));
    let g = row(3, &[]);
    let mut st = NatureState::default();
    st.populations.insert("frog".into(), Cells::from_iter([(Id::from("cell.0.0"), 80)]));
    let r = Randomness::new(3);
    run(&c, &g, &land(&["wetland", "built", "wetland"]), &mut st, 0..1500, &r);
    assert_eq!(st.populations["frog"].get("cell.2.0"), None, "crossing the built cell kills");
    // Without the barrier (grassland: no capacity, but crossable), some get through.
    let mut st2 = NatureState::default();
    st2.populations.insert("frog".into(), Cells::from_iter([(Id::from("cell.0.0"), 80)]));
    let c2 = cat(serde_json::json!({ "species": [{ "id": "frog", "capacity_per_1000_cells": { "wetland": 100000 }, "growth_bps_per_year": 20000, "mortality_bps_per_year": 2000,
        "dispersal_bps_per_year": 20000, "min_viable": 1, "detection_bps": 6000 }] }));
    let mut l = land(&["wetland", "grassland", "wetland"]);
    l.built = vec![false; 3];
    // (A disperser into grassland dies there the same day, so the far wetland is reached only straight through: here
    // it isn't reachable at all in one step, which is the point of a matrix it can't live in.)
    run(&c2, &g, &l, &mut st2, 0..400, &r);
    assert!(total(&st2, "frog") > 0);
}

#[test]
fn pollution_flows_downstream_and_kills_what_cant_bear_it() {
    let flows: Vec<FlowCfg> = (0..3).map(|x| FlowCfg { from: format!("cell.{x}.0").into(), to: format!("cell.{}.0", x + 1).into() }).collect();
    let mut f = frog();
    f["tolerance"] = serde_json::json!({ "pollution": { "above": 300, "mortality_bps_per_day": 500 } });
    f["dispersal_bps_per_year"] = serde_json::json!(0);
    let c = cat(serde_json::json!({
        "fields": [{ "id": "pollution", "min": 0, "max": 1000000, "decay_bps_per_day": 100, "flow_bps_per_day": 5000, "from_structures": { "works": 400 } }],
        "species": [f] }));
    let g = row(4, &flows);
    let mut l = land(&["built", "water", "water", "wetland"]);
    l.anchored[0] = vec!["works".into()];
    let mut st = NatureState::default();
    st.populations.insert("frog".into(), Cells::from_iter([(Id::from("cell.3.0"), 90)]));
    let r = Randomness::new(5);
    run(&c, &g, &l, &mut st, 0..200, &r);
    let p = &st.fields["pollution"];
    assert!(p["cell.3.0"] > 300, "downstream: {p:?}");
    assert_eq!(total(&st, "frog"), 0, "the frogs downstream die");
    // Without the works, the same frogs live.
    let mut clean = NatureState::default();
    clean.populations.insert("frog".into(), Cells::from_iter([(Id::from("cell.3.0"), 90)]));
    run(&c, &g, &land(&["built", "water", "water", "wetland"]), &mut clean, 0..200, &r);
    assert!(total(&clean, "frog") > 50);
}

#[test]
fn cleared_land_grows_back_slowly_but_not_while_built_on() {
    let c = Catalogue {
        land_covers: vec![
            LandCoverCfg { id: "cleared".into(), succeeds_to: Some(SuccessionCfg { cover: "scrub".into(), after_days: 100 }) },
            LandCoverCfg { id: "scrub".into(), succeeds_to: Some(SuccessionCfg { cover: "woodland".into(), after_days: 300 }) },
            LandCoverCfg { id: "woodland".into(), succeeds_to: None },
        ],
        ..cat(serde_json::json!({}))
    };
    let g = row(2, &[]);
    let mut st = NatureState::default();
    let r = Randomness::new(1);
    let mut covers = vec!["cleared".into(), "built".into()];
    let mut changes = vec![];
    for day in 0..500 {
        let l = Land { cover: covers.clone().into_iter().map(Into::into).collect(), built: vec![false, true], anchored: vec![vec![], vec![]] };
        let out = step_day(&c, &g, &l, &mut st, day, &r);
        for (cell, to) in out.cover_changes {
            changes.push((day, cell, to));
            covers[g.index[&cell]] = to.to_string();
        }
    }
    assert_eq!(changes, vec![(100, "cell.0.0".into(), "scrub".into()), (400, "cell.0.0".into(), "woodland".into())]);
}

#[test]
fn a_field_diffuses_and_decays_to_its_baseline() {
    let c = cat(serde_json::json!({ "fields": [{ "id": "p", "min": 0, "max": 1000, "decay_bps_per_day": 1000, "diffusion_bps_per_day": 2000 }] }));
    let g = row(3, &[]);
    let l = land(&["a", "a", "a"]);
    let mut st = NatureState::default();
    st.fields.insert("p".into(), Cells::from_iter([(Id::from("cell.1.0"), 1000)]));
    let r = Randomness::new(1);
    step_day(&c, &g, &l, &mut st, 0, &r);
    let p = &st.fields["p"];
    assert!(p["cell.0.0"] > 0 && p["cell.2.0"] > 0 && p["cell.1.0"] < 1000);
    run(&c, &g, &l, &mut st, 1..200, &r);
    assert!(st.fields.get("p").is_none(), "all back at the baseline");
}

#[test]
fn surveys_estimate_with_error_and_runs_replay() {
    let mut rng = Randomness::new(9).stream(&["survey"]);
    let found = survey_count(1000, 6000, &mut rng);
    assert!((520..=680).contains(&found), "{found}");
    let v = survey_value(1000, 9000, &mut rng);
    assert!((900..=1100).contains(&v));
    assert_eq!(survey_value(1000, 10_000, &mut rng), 1000);
    let c = cat(serde_json::json!({ "species": [frog()] }));
    let g = row(3, &[]);
    let l = land(&["wetland", "wetland", "wetland"]);
    let go = || {
        let mut st = NatureState::default();
        st.populations.insert("frog".into(), Cells::from_iter([(Id::from("cell.0.0"), 12)]));
        run(&c, &g, &l, &mut st, 0..300, &Randomness::new(42));
        st
    };
    assert_eq!(go(), go());
}

#[test]
fn a_sparse_species_lives_at_a_fraction_of_one_per_cell_over_its_home_range() {
    // A glider at 0.125 per cell (125 per 1,000) in a 20 x 20 woodland: about 50 in all. Crowding is felt over a home
    // range 3 cells each way (about 6 there). (A home range should hold about one or more: a sparse species with none
    // would feel no one in its own cell and pay no heed to its capacity.)
    let glider = |range: i64| serde_json::json!({ "id": "glider", "capacity_per_1000_cells": { "woodland": 125 }, "home_range": range,
        "growth_bps_per_year": 3000, "mortality_bps_per_year": 2000, "dispersal_bps_per_year": 1000, "dispersal_range": 8, "min_viable": 2, "detection_bps": 3000 });
    let cells: Vec<(Id, i64, i64)> = (0..20).flat_map(|y| (0..20).map(move |x| (Id::from(format!("cell.{x}.{y}")), x, y))).collect();
    let g = Ground::new(&cells, &[]);
    let l = land(&vec!["woodland"; 400]);
    let run_with = |range: i64, seed: u64| {
        let c = cat(serde_json::json!({ "species": [glider(range)] }));
        let mut st = NatureState::default();
        // (At its density: one per 8 cells. Scattered singletons, alone in their home ranges, couldn't breed: the Allee
        // effect, as it should be.)
        st.populations.insert("glider".into(), (0..50).map(|i| (g.cells[i * 8], 1)).collect());
        run(&c, &g, &l, &mut st, 0..3650, &Randomness::new(seed));
        total(&st, "glider")
    };
    // (Five seeds' mean; a few dispersers are lost off the woodland's edge.)
    let mean = (1..=5).map(|seed| run_with(3, seed)).sum::<i64>() / 5;
    assert!((35..=65).contains(&mean), "near its capacity: {mean}");
}


#[test]
fn a_gap_wider_than_the_dispersal_range_cuts_a_patch_off() {
    // Wetland, then grassland (crossable, but nothing lives there), then wetland: frogs start on the west only.
    let sp = |range: i64| serde_json::json!({ "id": "frog", "capacity_per_1000_cells": { "wetland": 50000 }, "growth_bps_per_year": 20000, "mortality_bps_per_year": 2000,
        "dispersal_bps_per_year": 20000, "dispersal_range": range, "min_viable": 1, "detection_bps": 5000 });
    // (Three rows, so a walk can wander; the wetland columns are at either end.)
    let reach = |gap: usize, range: i64| {
        let w = gap as i64 + 2;
        let cells: Vec<(Id, i64, i64)> = (0..3).flat_map(|y| (0..w).map(move |x| (Id::from(format!("cell.{x}.{y}")), x, y))).collect();
        let g = Ground::new(&cells, &[]);
        let covers: Vec<&str> = g.xy.iter().map(|(x, _)| if *x == 0 || *x == w - 1 { "wetland" } else { "grassland" }).collect();
        let mut st = NatureState::default();
        st.populations.insert("frog".into(), Cells::from_iter([(Id::from("cell.0.1"), 40)]));
        run(&cat(serde_json::json!({ "species": [sp(range)] })), &g, &land(&covers), &mut st, 0..1500, &Randomness::new(4));
        (0..3).map(|y| st.populations["frog"].get(format!("cell.{}.{y}", w - 1).as_str()).copied().unwrap_or(0)).sum::<i64>()
    };
    assert!(reach(2, 6) > 0, "a gap of 2 within a range of 6: crossed");
    assert_eq!(reach(8, 3), 0, "a gap of 8 beyond a range of 3: never crossed");
}

#[test]
fn a_spin_up_is_exactly_the_days_stepped_one_by_one() {
    let mut f = frog();
    f["tolerance"] = serde_json::json!({ "pollution": { "above": 300, "mortality_bps_per_day": 50 } });
    let c = cat(serde_json::json!({
        "fields": [{ "id": "pollution", "min": 0, "max": 1000000, "decay_bps_per_day": 100, "diffusion_bps_per_day": 500, "from_structures": { "works": 30 } }],
        "species": [f] }));
    let g = row(5, &[]);
    let mut l = land(&["built", "wetland", "wetland", "wetland", "wetland"]);
    l.anchored[0] = vec!["works".into()];
    let start = || {
        let mut st = NatureState::default();
        st.populations.insert("frog".into(), Cells::from_iter([(Id::from("cell.2.0"), 30)]));
        st
    };
    let r = Randomness::new(8);
    let mut one = start();
    run(&c, &g, &l, &mut one, -300..0, &r);
    let mut fast = start();
    spin_up(&c, &g, &l, &mut fast, -300, 300, &r);
    assert_eq!((one.fields, one.populations, one.extinct), (fast.fields, fast.populations, fast.extinct));
}

/// The same over a ground with everything a spin-up takes a shorter way through: fields that settle, one that goes
/// round a few states, a scale on the sources that changes on the way; species in few cells and in most of them, with
/// and without a home range, with barriers, one that dies out, one given a number below zero.
#[test]
fn a_spin_up_over_a_whole_ground_is_exactly_the_days_stepped_one_by_one() {
    let (w, h) = (12i64, 9i64);
    let cells: Vec<(Id, i64, i64)> = (0..h).flat_map(|y| (0..w).map(move |x| (Id::from(format!("cell.{x}.{y}")), x, y))).collect();
    let flows: Vec<FlowCfg> = (0..w - 1).map(|x| FlowCfg { from: format!("cell.{x}.4").into(), to: format!("cell.{}.4", x + 1).into() }).collect();
    let g = Ground::new(&cells, &flows);
    // (The ground's cells are in id order, not row by row.)
    let cover = |x: i64, y: i64| match (x, y) {
        (_, 4) => "riverbank",
        (5, _) => "road",
        (x, y) if x < 5 && y < 4 => "wetland",
        (x, _) if x > 8 => "woodland",
        (x, y) if (x + y) % 3 == 0 => "built",
        _ => "grassland",
    };
    let covers: Vec<&str> = g.xy.iter().map(|(x, y)| cover(*x, *y)).collect();
    let mut l = land(&covers);
    for (i, c) in covers.iter().enumerate() {
        if *c == "built" && i % 2 == 0 {
            l.anchored[i] = vec!["works".into()];
        }
    }
    let c = cat(serde_json::json!({
        "fields": [
            { "id": "pollution", "min": 0, "max": 1000000, "decay_bps_per_day": 300, "diffusion_bps_per_day": 800, "flow_bps_per_day": 5000, "from_structures": { "works": 40 }, "from_covers": { "grassland": 1 } },
            { "id": "water", "min": 0, "max": 1000000, "decay_bps_per_day": 1000, "flow_bps_per_day": 5000, "from_covers": { "riverbank": 1000, "wetland": -500 }, "spills_above": 3000, "spill_bps_per_day": 3000,
              "source_by_day": [{ "from_day": -500, "bps": 7000 }, { "from_day": -260, "bps": 14000 }, { "from_day": -40, "bps": 0 }] },
            { "id": "heat", "min": 0, "max": 12, "decay_bps_per_day": 5000, "from_covers": { "grassland": 10, "built": 12, "road": 12 } },
            // (Soaked up by as much as its sources give, less one a day: it goes back and forth.)
            { "id": "swing", "min": 0, "max": 9, "decay_bps_per_day": 10000, "baseline": 4, "from_covers": { "woodland": 7 } }
        ],
        "species": [
            { "id": "frog", "capacity_per_1000_cells": { "wetland": 9000, "riverbank": 2000 }, "home_range": 1, "growth_bps_per_year": 12000, "mortality_bps_per_year": 4000,
              "dispersal_bps_per_year": 1500, "dispersal_range": 8, "barriers": ["built", "road"], "min_viable": 4, "detection_bps": 5000,
              "tolerance": { "pollution": { "above": 60, "mortality_bps_per_day": 50 }, "water": { "above": 2500, "mortality_bps_per_day": 20 } } },
            { "id": "glider", "capacity_per_1000_cells": { "woodland": 400 }, "home_range": 4, "growth_bps_per_year": 3000, "mortality_bps_per_year": 2000,
              "dispersal_bps_per_year": 1000, "dispersal_range": 3, "barriers": ["built", "road"], "min_viable": 1, "detection_bps": 3000 },
            { "id": "wren", "capacity_per_1000_cells": { "grassland": 3000, "woodland": 1500, "riverbank": 2000 }, "home_range": 2, "growth_bps_per_year": 5000, "mortality_bps_per_year": 3000,
              "dispersal_bps_per_year": 1000, "dispersal_range": 20, "min_viable": 1, "detection_bps": 8000 },
            { "id": "moth", "capacity_per_1000_cells": { "grassland": 20000 }, "growth_bps_per_year": 8000, "mortality_bps_per_year": 5000,
              "dispersal_bps_per_year": 4000, "dispersal_range": 2, "min_viable": 2, "detection_bps": 2000 },
            { "id": "stray", "capacity_per_1000_cells": { "road": 10 }, "home_range": 1, "growth_bps_per_year": 100, "mortality_bps_per_year": 9000,
              "dispersal_bps_per_year": 100, "dispersal_range": 1, "min_viable": 9, "detection_bps": 2000 }
        ] }));
    for seed in [1, 8, 23] {
        let start = || {
            let mut st = NatureState::default();
            st.populations.insert("frog".into(), Cells::from_iter([(Id::from("cell.1.1"), 30), ("cell.3.4".into(), 12)]));
            st.populations.insert("glider".into(), Cells::from_iter([(Id::from("cell.10.2"), 3), ("cell.11.7".into(), 2), ("cell.9.0".into(), -2)]));
            st.populations.insert("wren".into(), g.cells.iter().step_by(2).map(|c| (*c, 2)).collect());
            st.populations.insert("moth".into(), g.cells.iter().step_by(3).map(|c| (*c, 5)).collect());
            st.populations.insert("stray".into(), Cells::from_iter([(Id::from("cell.6.0"), 3)]));
            st.fields.insert("pollution".into(), Cells::from_iter([(Id::from("cell.6.6"), 900)]));
            st
        };
        let r = Randomness::new(seed);
        let mut one = start();
        let gone: Vec<Id> = run(&c, &g, &l, &mut one, -500..0, &r).into_iter().flat_map(|d| d.extinct).collect();
        let mut fast = start();
        assert_eq!(spin_up(&c, &g, &l, &mut fast, -500, 500, &r), gone, "seed {seed}");
        assert_eq!((&one.fields, &one.populations, &one.extinct), (&fast.fields, &fast.populations, &fast.extinct), "seed {seed}");
        assert!(one.extinct.contains_key("stray") && total(&one, "wren") > 0 && total(&one, "frog") > 0, "seed {seed}: the species live and die as the test means them to");
    }
}

/// A field at the ends of the range the contracts allow steps without overflow, and exactly: the products of a value
/// and a rate pass 64 bits there (a test build stopped; a release build wrapped, to a different world).
#[test]
fn a_field_at_the_ends_of_the_contracts_range_steps_exactly() {
    const MAX_SAFE: i64 = 9_007_199_254_740_991;
    let g = row(3, &[FlowCfg { from: "cell.0.0".into(), to: "cell.1.0".into() }, FlowCfg { from: "cell.1.0".into(), to: "cell.2.0".into() }]);
    let l = land(&["grass", "grass", "grass"]);
    let field = |extra: serde_json::Value| {
        let mut f = serde_json::json!({ "id": "water", "min": -MAX_SAFE, "max": MAX_SAFE, "baseline": -MAX_SAFE });
        f.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
        cat(serde_json::json!({ "land_covers": [{ "id": "grass" }], "fields": [f] })).fields[0].clone()
    };
    let full = vec![MAX_SAFE, -MAX_SAFE, -MAX_SAFE];
    // All of what's above the baseline decays in a day: back to the baseline.
    assert_eq!(step_field_dense(&field(serde_json::json!({ "decay_bps_per_day": 10000 })), &g, &l, full.clone(), 0), vec![-MAX_SAFE; 3]);
    // Half of it: exactly half of twice the largest integer.
    assert_eq!(step_field_dense(&field(serde_json::json!({ "decay_bps_per_day": 5000 })), &g, &l, full.clone(), 0), vec![0, -MAX_SAFE, -MAX_SAFE]);
    // All of it carried downstream, spread to the one neighbour, or spilt over a level there.
    assert_eq!(step_field_dense(&field(serde_json::json!({ "flow_bps_per_day": 10000 })), &g, &l, full.clone(), 0), vec![-MAX_SAFE, MAX_SAFE, -MAX_SAFE]);
    assert_eq!(step_field_dense(&field(serde_json::json!({ "diffusion_bps_per_day": 10000 })), &g, &l, full.clone(), 0), vec![-MAX_SAFE, MAX_SAFE, -MAX_SAFE]);
    assert_eq!(step_field_dense(&field(serde_json::json!({ "spills_above": -MAX_SAFE, "spill_bps_per_day": 10000 })), &g, &l, full, 0), vec![-MAX_SAFE, MAX_SAFE, -MAX_SAFE]);
    // Ordinary values are as they were: 3 of 1,000 above a baseline of 0 decays by 30%, moves on by 25%.
    let f = field(serde_json::json!({ "min": 0, "max": 100000, "baseline": 0, "decay_bps_per_day": 3000, "flow_bps_per_day": 2500 }));
    assert_eq!(step_field_dense(&f, &g, &l, vec![1000, 0, 0], 0), vec![525, 175, 0]);
    assert_eq!(share(-7, 5000), -3);
    assert_eq!(share(7, 5000), 3);
}
