//! Places (contracts v0.5, D58): named areas of one ground, nested as a tree, each detailed (its cells exist) or
//! summarised (an area, simulated in aggregate). A region the size of a million cells costs nothing where it's
//! summarised; building happens only on detailed ground; a channel can look at a place; malformed trees are refused.

mod common;

use common::*;
use serde_json::{json, Value};
use terrarium_kernel::blocks::Block;
use terrarium_kernel::events::{EventBody, RefusalCode};
use terrarium_kernel::observe::ChannelData;
use terrarium_kernel::run::Run;
use terrarium_kernel::Command;

/// The test world, set on a 1000 x 1000 plane: a summarised region holding the (detailed) town, a detailed village
/// far away across it, and summarised farmland. The mayor looks at each place.
fn region() -> Value {
    let mut c = world(&default_params());
    c["world"]["ground"]["w"] = json!(1000);
    c["world"]["ground"]["h"] = json!(1000);
    c["world"]["places"] = json!([
        {"id": "region", "kind": "region", "name": "The region", "area": {"x": 0, "y": 0, "w": 1000, "h": 1000}, "detailed": false},
        {"id": "here", "kind": "town", "within": "region", "area": {"x": 0, "y": 0, "w": 4, "h": 3}, "detailed": true},
        {"id": "village", "kind": "village", "within": "region", "area": {"x": 900, "y": 900, "w": 3, "h": 2}, "detailed": true},
        {"id": "farmland", "kind": "farmland", "within": "region", "area": {"x": 100, "y": 100, "w": 500, "h": 500}, "detailed": false},
    ]);
    let mayor = c["positions"].as_array_mut().unwrap().iter_mut().find(|p| p["id"] == "mayor").unwrap();
    let chans = mayor["channels"].as_array_mut().unwrap();
    for place in ["village", "region", "farmland"] {
        chans.push(json!({"id": format!("see-{place}"), "kind": "sites", "area": {"place": place}}));
    }
    c
}

/// One look (a first look delivers everything each channel covers; later looks, only changes: D42).
fn cells_seen(run: &mut Run<Vec<u8>>) -> impl Fn(&str) -> Vec<String> {
    let o = run.command(&Command::Observe { participant: "mayor-system".into(), only: None }).unwrap().observation.unwrap();
    move |channel| match &o.channels[&format!("mayor/{channel}")] {
        ChannelData::Sites { cells, .. } => cells.iter().map(|c| c.cell.clone()).collect(),
        other => panic!("{other:?}"),
    }
}

fn build(run: &mut Run<Vec<u8>>, at: &str) -> Result<(), RefusalCode> {
    let cmd = direct("builder-system", Some("builder"), vec![Block::Construct { at: at.into(), structure_type: "park".into(), materials_from: "acc-buildco".into(), bind: None }]).unwrap();
    match &step(run, &cmd).unwrap().events[0].body {
        EventBody::ActionApplied { .. } => Ok(()),
        EventBody::ActionRefused { code, .. } => Err(*code),
        other => panic!("{other:?}"),
    }
}

#[test]
fn only_detailed_places_have_cells_and_building_happens_only_there() {
    let mut run = Run::start(region(), "places", Vec::new(), None).unwrap();
    // 12 cells of town and 6 of village, not a million.
    assert_eq!(run.kernel().state().cells.len(), 12 + 6);
    assert_eq!(build(&mut run, "cell.901.900"), Ok(()), "the village is detailed ground");
    assert_eq!(build(&mut run, "cell.300.300"), Err(RefusalCode::UnknownCell), "the farmland is summarised: no cells to build on");
    assert_eq!(build(&mut run, "cell.2.2"), Ok(()), "the town is detailed too");
}

#[test]
fn a_channel_sees_a_places_detailed_cells() {
    let mut run = Run::start(region(), "places", Vec::new(), None).unwrap();
    let seen = cells_seen(&mut run);
    let village = seen("see-village");
    assert_eq!(village.len(), 6);
    assert!(village.iter().all(|c| c.starts_with("cell.90")), "{village:?}");
    // The region's cells are where it's detailed: the town and the village, found without walking a million cells.
    assert_eq!(seen("see-region").len(), 18);
    assert!(seen("see-farmland").is_empty(), "summarised land has no cells to see");
}

#[test]
fn a_place_tree_must_be_a_tree_on_the_ground() {
    fn places(c: &mut Value) -> &mut Vec<Value> {
        c["world"]["places"].as_array_mut().unwrap()
    }
    let bad = |edit: &dyn Fn(&mut Value)| {
        let mut c = region();
        edit(&mut c);
        Run::start(c, "places", Vec::new(), None).err().map(|e| format!("{e:?}")).unwrap_or_default()
    };
    assert!(bad(&|c| {
        places(c)[2].as_object_mut().unwrap().remove("within");
    })
    .contains("exactly one root"));
    assert!(bad(&|c| places(c)[2]["within"] = json!("nowhere")).contains("unknown place"));
    assert!(bad(&|c| places(c)[2]["area"] = json!({"x": 990, "y": 990, "w": 20, "h": 20})).contains("on the ground"));
    assert!(bad(&|c| {
        places(c)[1]["within"] = json!("farmland");
    })
    .contains("within farmland"));
    assert!(bad(&|c| {
        places(c)[0]["within"] = json!("here");
    })
    .contains("root"));
    assert!(bad(&|c| places(c)[3]["detailed"] = json!(true)).is_empty(), "500 x 500 detailed cells is within the limit");
    assert!(bad(&|c| {
        c["world"]["ground"]["w"] = json!(10_000);
        c["world"]["ground"]["h"] = json!(10_000);
        places(c)[0]["area"] = json!({"x": 0, "y": 0, "w": 10_000, "h": 10_000});
        places(c)[3]["area"] = json!({"x": 100, "y": 100, "w": 5000, "h": 5000});
        places(c)[3]["detailed"] = json!(true);
    })
    .contains("at most"));
    // Structures stand only on detailed ground.
    assert!(bad(&|c| c["world"]["structures"].as_array_mut().unwrap().push(json!({"id": "s-far", "at": "cell.300.300", "type": "park"}))).contains("detailed ground"));
}
