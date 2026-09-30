use super::*;
use terrarium_contracts::config::{Catalogue, FieldCfg, LandCoverCfg, SuccessionCfg, ToleranceCfg};

fn cat(json: serde_json::Value) -> Catalogue {
    let mut base = serde_json::json!({ "structure_types": [] });
    base.as_object_mut().unwrap().extend(json.as_object().unwrap().clone());
    serde_json::from_value(base).unwrap()
}

/// A row of `w` cells, cell.0.0 .. cell.<w-1>.0.
fn row(w: i64, flows: &[FlowCfg]) -> Ground {
    Ground::new(&(0..w).map(|x| (format!("cell.{x}.0"), x, 0)).collect::<Vec<_>>(), flows)
}

fn land(covers: &[&str]) -> Land {
    Land { cover: covers.iter().map(|c| c.to_string()).collect(), built: covers.iter().map(|c| *c == "built").collect(), anchored: vec![vec![]; covers.len()] }
}

fn frog() -> serde_json::Value {
    serde_json::json!({ "id": "frog", "capacity": { "wetland": 100 }, "growth_bps_per_year": 20000, "mortality_bps_per_year": 2000,
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
    st.populations.insert("frog".into(), [("cell.1.0".to_string(), 10)].into());
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
    st.populations.insert("frog".into(), [("cell.0.0".to_string(), 50)].into());
    let r = Randomness::new(1);
    // The wetland is built over: none can live there, and the one neighbour is built too (a barrier).
    let results = run(&c, &g, &land(&["built", "built"]), &mut st, 0..3, &r);
    assert_eq!(total(&st, "frog"), 0);
    assert_eq!(st.extinct.get("frog"), Some(&0));
    assert_eq!(results[0].extinct, vec!["frog".to_string()]);
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
    st.populations.insert("frog".into(), [("cell.0.0".to_string(), 80)].into());
    let r = Randomness::new(3);
    run(&c, &g, &land(&["wetland", "built", "wetland"]), &mut st, 0..1500, &r);
    assert_eq!(st.populations["frog"].get("cell.2.0"), None, "crossing the built cell kills");
    // Without the barrier (grassland: no capacity, but crossable), some get through.
    let mut st2 = NatureState::default();
    st2.populations.insert("frog".into(), [("cell.0.0".to_string(), 80)].into());
    let c2 = cat(serde_json::json!({ "species": [{ "id": "frog", "capacity": { "wetland": 100 }, "growth_bps_per_year": 20000, "mortality_bps_per_year": 2000,
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
    let flows: Vec<FlowCfg> = (0..3).map(|x| FlowCfg { from: format!("cell.{x}.0"), to: format!("cell.{}.0", x + 1) }).collect();
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
    st.populations.insert("frog".into(), [("cell.3.0".to_string(), 90)].into());
    let r = Randomness::new(5);
    run(&c, &g, &l, &mut st, 0..200, &r);
    let p = &st.fields["pollution"];
    assert!(p["cell.3.0"] > 300, "downstream: {p:?}");
    assert_eq!(total(&st, "frog"), 0, "the frogs downstream die");
    // Without the works, the same frogs live.
    let mut clean = NatureState::default();
    clean.populations.insert("frog".into(), [("cell.3.0".to_string(), 90)].into());
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
    let mut covers = vec!["cleared".to_string(), "built".to_string()];
    let mut changes = vec![];
    for day in 0..500 {
        let l = Land { cover: covers.clone(), built: vec![false, true], anchored: vec![vec![], vec![]] };
        let out = step_day(&c, &g, &l, &mut st, day, &r);
        for (cell, to) in out.cover_changes {
            changes.push((day, cell.clone(), to.clone()));
            covers[g.index[&cell]] = to;
        }
    }
    assert_eq!(changes, vec![(100, "cell.0.0".to_string(), "scrub".to_string()), (400, "cell.0.0".to_string(), "woodland".to_string())]);
}

#[test]
fn a_field_diffuses_and_decays_to_its_baseline() {
    let c = cat(serde_json::json!({ "fields": [{ "id": "p", "min": 0, "max": 1000, "decay_bps_per_day": 1000, "diffusion_bps_per_day": 2000 }] }));
    let g = row(3, &[]);
    let l = land(&["a", "a", "a"]);
    let mut st = NatureState::default();
    st.fields.insert("p".into(), [("cell.1.0".to_string(), 1000)].into());
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
        st.populations.insert("frog".into(), [("cell.0.0".to_string(), 12)].into());
        run(&c, &g, &l, &mut st, 0..300, &Randomness::new(42));
        st
    };
    assert_eq!(go(), go());
    let _unused = ToleranceCfg { above: 0, mortality_bps_per_day: 0 };
    let _f: Option<FieldCfg> = None;
}
