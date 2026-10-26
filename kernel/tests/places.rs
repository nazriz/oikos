//! Places (contracts v0.5, D58): named areas of one ground, nested as a tree, each detailed (its cells exist) or
//! summarised (an area, simulated in aggregate). A region the size of a million cells costs nothing where it's
//! summarised; building happens only on detailed ground; a channel can look at a place; malformed trees are refused.

use crate::common;

use common::*;
use serde_json::{json, Value};
use oikos_kernel::blocks::Block;
use oikos_kernel::events::{EventBody, RefusalCode};
use oikos_kernel::run::Run;
use oikos_kernel::Command;

/// The test world, set on a 1000 x 1000 plane: a summarised region holding the (detailed) town, a detailed village
/// far away across it, and summarised farmland.
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
    c
}

fn build(run: &mut Run<Vec<u8>>, at: &str) -> Result<(), RefusalCode> {
    let cmd = direct("builder-system", Some("builder"), vec![Block::Construct { at: at.into(), structure_type: "park".into(), materials_at: Some("s-flats".into()), bind: None }]).unwrap();
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
fn a_place_is_seen_by_going_to_its_detailed_cells_and_no_seat_is_given_a_map_of_one() {
    // Until 2026-10-08 a channel could show a whole place (`area: {"place": ...}`), and this test gave the mayor the
    // village, the region and the farmland to look at. A map of a place is a whole view and can no longer be written
    // (docs/design/knowing.md): the world is refused.
    let mut c = region();
    let mayor = c["positions"].as_array_mut().unwrap().iter_mut().find(|p| p["id"] == "mayor").unwrap();
    mayor["channels"].as_array_mut().unwrap().push(json!({"id": "see-village", "kind": "sites", "way": "here", "area": {"place": "village"}}));
    assert!(Run::start(c, "places", Vec::new(), None).is_err(), "a map of a place is not a channel");
    // What is still true of places: a detailed place has cells that can be gone to, far away as it is; summarised
    // land has none.
    let mut run = Run::start(region(), "places", Vec::new(), None).unwrap();
    let village = go_and_see(&mut run, "mayor-system", "mayor/town", &["cell.900.900", "cell.902.901"]);
    assert_eq!(village.iter().map(|c| c.cell.as_str()).collect::<Vec<_>>(), ["cell.900.900", "cell.902.901"]);
    let looks = serde_json::from_value(json!([{"channel": "mayor/town", "visit": {"places": ["cell.300.300"]}}])).unwrap();
    assert!(run.command(&Command::Look { participant: "mayor-system".into(), only: None, looks }).is_err(), "summarised land has no cells to go to");
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
