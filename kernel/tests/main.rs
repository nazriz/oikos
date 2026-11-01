//! The kernel's integration tests, as one test program (`autotests = false` in kernel/Cargo.toml): each file here is a
//! module of it, and `common` is built once. Before, each of the ~50 files was its own program, compiled and linked on
//! its own against the whole kernel: one link where there were fifty (risk PL-4 (3), docs/decisions.md). A file is still
//! run by name: `cargo test --test main <file>::` (or `cargo nextest run --test main -E 'test(/^<file>::/)'`).
//! A new test file is a `mod` line here.

mod common;

mod a1_citizen;
mod a2_founded;
mod actors_boundary;
mod attention;
mod basis;
mod blog;
mod c1_employer;
mod c1_landlord;
mod c1_small;
mod c2_boundary;
mod c2_firms;
mod c2_shop_mix;
mod capacity;
mod cast;
mod cli;
mod config_stream;
mod conformance;
mod conservation;
mod d_bank;
mod departures;
mod determinism_lint;
mod e_auditor;
mod e_builder;
mod e_council;
mod e_planning;
mod e_police;
mod e_school;
mod e_treasury;
mod e_utilities;
mod engine;
mod entity_record;
mod explore_live;
mod foundation_fixes;
mod foundations;
mod generator_reach;
mod hash_chain;
mod host;
mod knowing;
mod mind_memory;
mod money_conservation;
mod nature;
mod network;
mod observations;
mod papers_typed;
mod perception;
mod physical_feasibility;
mod physics;
mod places;
mod position;
mod replay;
mod services;
mod snapshot;
mod space;
mod statements_have_no_power;
mod time;
mod travel;
mod work;

/// With `autotests = false`, a file in tests/ that no `mod` line names is never built or run: none may be left out.
#[test]
fn every_test_file_is_a_module_of_this_program() {
    let here = include_str!("main.rs");
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests");
    let mut missing = vec![];
    for e in std::fs::read_dir(&dir).unwrap() {
        let name = e.unwrap().file_name().into_string().unwrap();
        if let Some(m) = name.strip_suffix(".rs") {
            if m != "main" && !here.contains(&format!("\nmod {m};\n")) {
                missing.push(name);
            }
        }
    }
    assert!(missing.is_empty(), "test files no `mod` line in tests/main.rs names (so never run): {missing:?}");
}
