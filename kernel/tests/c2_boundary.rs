//! The outside world's census and support kinds (lane C2): their manifests are the ones the TS modules wrote, in every
//! key the TS file has, until the cut-over (docs/port-guide.md, section 2).

use serde_json::Value;

#[test]
fn the_ported_boundary_manifests_are_the_ts_ones() {
    for name in ["transfers", "funding", "grants", "statistics", "valuer", "disposal", "migration"] {
        let path = format!("{}/../participants/manifests/world.{name}.json", env!("CARGO_MANIFEST_DIR"));
        let ts: Value = serde_json::from_slice(&std::fs::read(&path).expect("the TS manifest")).expect("JSON");
        let kind = oikos_actors::registry::find(&format!("world.{name}")).unwrap_or_else(|| panic!("world.{name} is registered"));
        let rust = kind.manifest();
        for (k, v) in ts.as_object().unwrap() {
            assert_eq!(&rust[k], v, "world.{name}: {k}");
        }
    }
}

#[test]
fn idle_is_the_frames_stand_in_and_is_not_repeated() {
    assert!(oikos_actors::registry::find("idle").is_some());
    assert_eq!(oikos_actors::registry::kinds().iter().filter(|k| k.name() == "idle").count(), 1);
}
