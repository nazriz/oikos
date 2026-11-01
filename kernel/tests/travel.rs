//! Travel's things (docs/design/travel.md; law 9): a world may declare vehicle types and vehicles its entities own; they
//! are checked when it is loaded, and the vehicles are kept in the state as their owners' things (driving them:
//! `space.rs`). A world without them is the world it was, to the hash.

use crate::common;

use oikos_kernel::run::Run;
use serde_json::{json, Value};

fn with_travel(t: Value) -> Value {
    let mut c = common::riverbend();
    c["travel"] = t;
    c
}

fn good() -> Value {
    json!({
        "vehicle_types": [{ "id": "van", "seats": 2, "load_kg": 1200, "speed_kmh": 90 }],
        "vehicles": [{ "id": "van-1", "type": "van", "owner": "buildco", "at": "cell.0.0", "drivers": ["alice"] }]
    })
}

#[test]
fn a_worlds_vehicles_are_checked_and_its_vehicles_kept_as_their_owners_things() {
    let run = Run::start(with_travel(good()), "travel", Vec::new(), None).unwrap();
    let v = &run.kernel().state().vehicles["van-1"];
    assert_eq!((v.type_.as_str(), v.owner.as_str(), v.at.as_str()), ("van", "buildco", "cell.0.0"));
    let plain = Run::start(common::riverbend(), "travel", Vec::new(), None).unwrap();
    assert_ne!(run.kernel().state_hash().unwrap(), plain.kernel().state_hash().unwrap(), "a vehicle is part of the world");
}

#[test]
fn a_vehicle_of_no_type_owner_or_speed_or_driven_by_nobody_is_refused() {
    let bad = |f: &dyn Fn(&mut Value)| {
        let mut t = good();
        f(&mut t);
        Run::start(with_travel(t), "travel", Vec::new(), None).err().map(|e| e.to_string()).unwrap_or_default()
    };
    assert!(bad(&|t| t["vehicles"][0]["type"] = json!("bus")).contains("not declared"));
    assert!(bad(&|t| t["vehicles"][0]["owner"] = json!("nobody")).contains("no entity"));
    assert!(bad(&|t| t["vehicles"][0]["drivers"] = json!(["nobody"])).contains("no entity"));
    assert!(bad(&|t| t["vehicle_types"][0]["speed_kmh"] = json!(0)).contains("invalid config"));
}
