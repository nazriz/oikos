//! Nothing physical from nothing (law 8, docs/nothing-from-nothing.md; docs/design/foundations-2.md section 2). Over any
//! sequence of operations, every physical quantity is accounted for:
//!
//! - **Goods** (every resource kind): the total over the world's holdings and its edges changes only as work (a task's
//!   inputs and outputs) and construction (a building's materials) account for; nobody but an edge ever holds less
//!   than nought; and goods move only by their holder's own act.
//! - **Fields** (nature's integer quantities: a river's water, pollution): between nature's days, a field's total over
//!   the cells changes only by what work draws from it and emits to it; a day of nature is nature's own (its sources,
//!   decay and flow), declared on the field.
//!
//! - **A field that holds a kind** (C2: a river's water): the kind's total over holdings, edges, the field's cells and
//!   nature's edge (what nature's days have added and taken, `nature.edge`) changes only by what processes make and
//!   use; a draw moves what it takes into the drawer's holding, so nothing is drawn into nothing.
//!
//! This generalises `goods.rs` (phase B) to fields (foundations-2 C1) and to fields that hold a kind (C2).

use crate::common;

use common::*;
use oikos_kernel::events::EventBody;
use oikos_kernel::kernel::Command;
use oikos_kernel::run::Run;
use proptest::prelude::*;
use proptest::strategy::ValueTree;
use serde_json::{json, Value};
use std::collections::BTreeMap;

/// The test world with nature: a field on every cell (a stand-in for a river's water), a task that draws from it and
/// one that emits to it, both at the shop, where the developer holds goods.
fn world_with_fields() -> Value {
    let mut c = world(&default_params());
    let cat = c["catalogue"].as_object_mut().unwrap();
    cat.insert("land_covers".into(), json!([{"id": "water"}]));
    cat.insert("fields".into(), json!([{"id": "water", "min": 0, "max": 1_000_000_000, "decay_bps_per_day": 100, "diffusion_bps_per_day": 500, "from_covers": {"water": 40}}]));
    let tasks = cat.get_mut("tasks").unwrap().as_array_mut().unwrap();
    tasks.push(json!({"id": "draw", "labour": 0, "draws": {"field": "water", "per_unit": 3}}));
    tasks.push(json!({"id": "spill", "labour": 0, "emits": {"water": 2}}));
    c["world"]["fields"] = json!([{"field": "water", "cell": "cell.0.2", "value": 500}, {"field": "water", "cell": "cell.1.2", "value": 300}, {"field": "water", "cell": "cell.3.1", "value": 900}]);
    c
}

/// The same world, its field holding a kind (C2): the river's water is a stock, in litres.
fn world_with_a_kind() -> Value {
    let mut c = world_with_fields();
    c["catalogue"]["resources"].as_array_mut().unwrap().push(json!({"id": "water", "unit": "L"}));
    c["catalogue"]["fields"][0]["kind"] = json!("water");
    c
}

/// Each field's total over the cells (sparse: cells at the baseline, nought here, are not kept): the fields that hold
/// no kind (a field that holds one is counted with its kind, `kind_totals`).
fn field_totals<W: std::io::Write>(run: &Run<W>) -> BTreeMap<oikos_kernel::blocks::Id, i128> {
    let mut t = BTreeMap::new();
    for f in run.kernel().statics().config.catalogue.fields.iter().filter(|f| f.kind.is_none()) {
        let n = run.kernel().state().nature.as_deref().and_then(|n| n.fields.get(&f.id)).map_or(0, |m| m.values().map(|v| *v as i128).sum());
        t.insert(f.id, n);
    }
    t
}

/// Each kind's total: over holdings (edges' included), and for a kind a field holds, over its cells and nature's edge.
fn kind_totals<W: std::io::Write>(run: &Run<W>) -> BTreeMap<oikos_kernel::blocks::Id, i128> {
    let st = run.kernel().state();
    let mut t = st.total_goods();
    for f in &run.kernel().statics().config.catalogue.fields {
        let Some(k) = &f.kind else { continue };
        let n = st.nature.as_deref();
        let cells: i128 = n.and_then(|n| n.fields.get(&f.id)).map_or(0, |m| m.values().map(|v| *v as i128).sum());
        let edge = n.and_then(|n| n.edge.get(&f.id)).copied().unwrap_or(0);
        *t.entry(*k).or_insert(0) += cells + edge;
    }
    t
}

fn nature_day<W: std::io::Write>(run: &Run<W>) -> i64 {
    run.kernel().state().nature.as_deref().map_or(0, |n| n.day)
}

/// An operation: one of the shared random ones, or work that draws from or emits to a field (at the shop, by the
/// developer, which holds there).
#[derive(Debug, Clone)]
enum COp {
    Common(Op),
    Draw(u8),
    Spill(u8),
}

fn cop_strategy() -> impl Strategy<Value = COp> {
    prop_oneof![
        8 => op_strategy().prop_map(COp::Common),
        1 => (1u8..40).prop_map(COp::Draw),
        1 => (1u8..40).prop_map(COp::Spill),
    ]
}

fn work_cmd(task: &str, units: u8) -> Command {
    Command::Act {
        participant: "developer-system".into(),
        position: Some("developer".into()),
        blocks: serde_json::from_value(json!([{"block": "work", "task": task, "units": units, "at": "s-shop", "performers": []}])).unwrap(),
        by: vec![],
        provenance: json!({"via": "direct"}),
        reasoning: None,
        thinking: None,
    }
}

/// Runs the operations, checking the invariant after each; returns how many goods moves, draws and emits there were.
fn check_run(config: Value, ops: &[COp]) -> Result<(usize, usize), TestCaseError> {
    let mut run = Run::start(config, "conservation", Vec::new(), None).unwrap();
    let mut expected = kind_totals(&run);
    let kind_of: BTreeMap<oikos_kernel::blocks::Id, oikos_kernel::blocks::Id> = run.kernel().statics().config.catalogue.fields.iter().filter_map(|f| f.kind.map(|k| (f.id, k))).collect();
    let mut fields = field_totals(&run);
    let tasks = run.kernel().statics().config.catalogue.tasks.clone();
    let types = run.kernel().statics().types.clone();
    let edges = run.kernel().statics().boundaries.clone();
    let (mut moved, mut drawn) = (0, 0);
    for op in ops {
        let cmd = match op {
            COp::Common(o) => match concretize(&run, o) {
                Some(c) => c,
                None => continue,
            },
            COp::Draw(u) => work_cmd("draw", *u),
            COp::Spill(u) => work_cmd("spill", *u),
        };
        let day = nature_day(&run);
        let Some(resp) = step(&mut run, &cmd) else { continue };
        let acting = resp.events.iter().find_map(|e| match &e.body {
            EventBody::ActionApplied { participant, position, .. } => run.kernel().state().acting_entity(participant, position.as_deref()),
            _ => None,
        });
        let mut field_change: BTreeMap<oikos_kernel::blocks::Id, i128> = BTreeMap::new();
        for e in &resp.events {
            match &e.body {
                EventBody::GoodsMoved { from, quantity, .. } => {
                    prop_assert!(*quantity > 0);
                    prop_assert_eq!(Some(from), acting.as_ref(), "goods moved by someone other than their holder");
                    moved += 1;
                }
                // What work and construction account for: inputs used up, outputs made, materials built in; and what
                // work drew from a field or emitted to one.
                EventBody::Worked { task, units, .. } => {
                    if let Some(t) = tasks.iter().find(|x| &x.id == task) {
                        for (k, per) in &t.consumes {
                            *expected.entry(k.to_string().into()).or_insert(0) -= per * *units as i128;
                        }
                        for (k, per) in &t.produces {
                            *expected.entry(k.to_string().into()).or_insert(0) += per * *units as i128;
                        }
                        if let Some(d) = &t.draws {
                            // (From a field that holds a kind, a draw moves it into a holding: the kind's total is unchanged.)
                            if fields.contains_key(d.field.as_str()) {
                                *field_change.entry(d.field.to_string().into()).or_insert(0) -= d.per_unit as i128 * *units as i128;
                            }
                            drawn += 1;
                        }
                        for (k, per) in &t.emits {
                            if fields.contains_key(k.as_str()) {
                                *field_change.entry(k.to_string().into()).or_insert(0) += *per as i128 * *units as i128;
                                drawn += 1;
                            }
                            // (Emitted to a field that holds a kind: the process's output, put on the cell.)
                            if let Some(kind) = kind_of.get(k.as_str()) {
                                *expected.entry(*kind).or_insert(0) += *per as i128 * *units as i128;
                                drawn += 1;
                            }
                        }
                    }
                }
                EventBody::StructureStarted { structure_type, .. } => {
                    for (k, q) in &types[structure_type].materials {
                        *expected.entry(k.to_string().into()).or_insert(0) -= q;
                    }
                }
                _ => {}
            }
        }
        let st = run.kernel().state();
        let mut have = kind_totals(&run);
        for k in expected.keys() {
            have.entry(*k).or_insert(0);
        }
        prop_assert_eq!(&have, &expected, "a kind not accounted for after {:?}", cmd);
        for h in st.holdings.values() {
            prop_assert!(h.quantity >= 0 || edges.contains(&h.holder), "{} holds {} of {} at {}", h.holder, h.quantity, h.kind, h.at);
        }
        // Fields: a step with no day of nature in it changes each field by what work drew and emitted, exactly. A day of
        // nature is nature's own (sources, decay, diffusion, flow); from then the totals are taken afresh.
        let now = field_totals(&run);
        if nature_day(&run) == day {
            for (f, before) in &fields {
                let want = before + field_change.get(f).copied().unwrap_or(0);
                prop_assert_eq!(now[f], want, "field {} not accounted for after {:?}", f, cmd);
            }
        }
        fields = now;
    }
    Ok((moved, drawn))
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 128, ..ProptestConfig::default() })]
    #[test]
    fn goods_are_conserved_and_move_only_by_their_holder(ops in proptest::collection::vec(op_strategy().prop_map(COp::Common), 1..120)) {
        check_run(world(&default_params()), &ops)?;
    }

    #[test]
    fn fields_change_only_by_what_work_draws_and_emits_and_by_nature(ops in proptest::collection::vec(cop_strategy(), 1..120)) {
        check_run(world_with_fields(), &ops)?;
    }

    #[test]
    fn a_kind_a_field_holds_is_conserved_over_holdings_cells_and_natures_edge(ops in proptest::collection::vec(cop_strategy(), 1..120)) {
        check_run(world_with_a_kind(), &ops)?;
    }
}

/// A draw from a field that holds a kind is held by whoever drew it, where they drew it; a world that says nothing of
/// kinds draws as it always did (into nothing: the backstop's `vanishing` names it).
#[test]
fn a_draw_from_a_field_that_holds_a_kind_is_held() {
    let mut run = Run::start(world_with_a_kind(), "draw-held", Vec::new(), None).unwrap();
    let before = run.kernel().state().holding("devco", "s-shop", "water");
    let r = step(&mut run, &work_cmd("draw", 10)).expect("accepted");
    let done = r.events.iter().find_map(|e| match &e.body { EventBody::ActionStarted { done, .. } => Some(*done), _ => None }).unwrap();
    run.command(&Command::Advance { to: done }).unwrap();
    assert_eq!(run.kernel().state().holding("devco", "s-shop", "water") - before, 30, "ten units of three litres, held at the shop");
    let mut old = Run::start(world_with_fields(), "draw-gone", Vec::new(), None).unwrap();
    let r = step(&mut old, &work_cmd("draw", 10)).expect("accepted");
    let done = r.events.iter().find_map(|e| match &e.body { EventBody::ActionStarted { done, .. } => Some(*done), _ => None }).unwrap();
    old.command(&Command::Advance { to: done }).unwrap();
    assert!(old.kernel().state().holdings.values().all(|h| h.kind != "water"));
}

/// A world that holds a kind in a field refuses to load where it would count it from anything but nought, or names a
/// kind it does not have.
#[test]
fn a_field_holds_only_a_kind_the_world_has_counted_from_nought() {
    let refused = |edit: &dyn Fn(&mut Value)| {
        let mut c = world_with_a_kind();
        edit(&mut c);
        Run::start(c, "field-kind", Vec::new(), None).err().map(|e| format!("{e:?}"))
    };
    assert!(refused(&|_| {}).is_none());
    assert!(refused(&|c| c["catalogue"]["fields"][0]["kind"] = json!("milk")).unwrap().contains("holds no kind"));
    assert!(refused(&|c| c["catalogue"]["fields"][0]["baseline"] = json!(5)).unwrap().contains("from nought"));
    assert!(refused(&|c| c["catalogue"]["fields"][0]["min"] = json!(-5)).unwrap().contains("from nought"));
}

/// Not vacuous: goods do move (imports, deliveries) and edges go negative; work does draw from and emit to the field.
/// Over many short runs, since in one long run the shop and the house tend to be demolished early, and then there's
/// nowhere left to deliver.
#[test]
fn goods_do_move_and_fields_are_drawn() {
    let mut runner = proptest::test_runner::TestRunner::deterministic();
    let (mut n, mut d) = (0, 0);
    for _ in 0..50 {
        let ops = proptest::collection::vec(cop_strategy(), 60..61).new_tree(&mut runner).unwrap().current();
        let (m, x) = check_run(world_with_fields(), &ops).unwrap();
        n += m;
        d += x;
    }
    assert!(n > 20, "only {n} moves");
    assert!(d > 20, "only {d} draws and emits");
}
