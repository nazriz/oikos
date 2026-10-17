//! The actors' boundary (docs/design/rust-port.md 2.1; docs/no-god-view.md; docs/port-guide.md): what a built-in actor
//! can name is what it may know. A Rust crate can name only its direct dependencies, so these hold the line:
//! - the actors crate depends on what it is shown (`oikos-sight`), the shared core, the contract types and the shared
//!   rules, and on nothing that holds or reads the world;
//! - `oikos-sight` re-exports values only, never the state, the world, perception's functions or the resolver's
//!   knowledge;
//! - the rules crate depends on the core and the law reader alone;
//! - the actors' code keeps the determinism rules: no clock, no I/O, no threads of its own, no global state, no
//!   iterated `HashMap`, no randomness but the kernel's streams.

use std::path::PathBuf;

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

/// The `[dependencies]` of a crate's manifest, by name.
fn dependencies(manifest: &str) -> Vec<String> {
    let text = std::fs::read_to_string(root().join(manifest)).unwrap();
    let mut out = vec![];
    let mut inside = false;
    for line in text.lines() {
        let l = line.trim();
        if l.starts_with('[') {
            inside = l == "[dependencies]";
            continue;
        }
        if inside && !l.is_empty() && !l.starts_with('#') {
            if let Some((name, _)) = l.split_once('=') {
                out.push(name.trim().to_string());
            }
        }
    }
    out.sort();
    out
}

#[test]
fn an_actor_depends_on_what_it_is_shown_and_never_on_the_world() {
    assert_eq!(
        dependencies("crates/actors/Cargo.toml"),
        ["oikos-contracts", "oikos-core", "oikos-rules", "oikos-sight", "serde", "serde_json"]
    );
    // (The law reader is pure: a condition, an act and claims in, a verdict out.)
    assert_eq!(dependencies("crates/rules/Cargo.toml"), ["oikos-core", "oikos-law", "serde", "serde_json"]);
}

#[test]
fn what_an_actor_is_shown_is_values_only() {
    let lib = std::fs::read_to_string(root().join("crates/sight/src/lib.rs")).unwrap();
    let exports: Vec<&str> = lib.lines().filter(|l| l.trim_start().starts_with("pub use")).collect();
    assert!(!exports.is_empty());
    for line in &exports {
        for forbidden in [
            "State",
            "World",
            "observe",
            "full_view",
            "Knowledge",
            "Registers",
            "Statics",
            "Kernel",
            "RecordIndex",
            "Changes",
            "::*",
            "resolve,",
            "resolve}",
            "exec",
            "kernel",
        ] {
            assert!(!line.contains(forbidden), "oikos-sight may not hand an actor {forbidden}: {line}");
        }
    }
    // (Nor may a module of its own reach through: it names the world's crates only in `use` of value types.)
    for f in ["crates/sight/src/view.rs", "crates/sight/src/action.rs"] {
        let src = std::fs::read_to_string(root().join(f)).unwrap();
        for forbidden in [
            "oikos_world::state::State",
            "oikos_world::World",
            "oikos_world::kernel",
            "oikos_perception::observe",
            "oikos_resolver::Knowledge",
            "oikos_resolver::resolve",
        ] {
            assert!(!src.contains(forbidden), "{f} reaches {forbidden}");
        }
    }
}

fn rust_files(dir: PathBuf, out: &mut Vec<PathBuf>) {
    for e in std::fs::read_dir(dir).unwrap() {
        let p = e.unwrap().path();
        if p.is_dir() {
            rust_files(p, out);
        } else if p.extension().is_some_and(|x| x == "rs") {
            out.push(p);
        }
    }
}

#[test]
fn actors_keep_the_determinism_rules() {
    let mut files = vec![];
    rust_files(root().join("crates/actors/src"), &mut files);
    rust_files(root().join("crates/rules/src"), &mut files);
    assert!(files.len() >= 5);
    for f in files {
        let src = std::fs::read_to_string(&f).unwrap();
        for (forbidden, why) in [
            ("std::time", "a clock"),
            ("SystemTime", "a clock"),
            ("Instant::", "a clock"),
            ("std::fs", "I/O"),
            ("std::net", "I/O"),
            ("std::env", "the environment"),
            ("std::thread", "threads of its own (the engine shares the work)"),
            ("thread_local", "state shared between steps"),
            ("static mut", "global state"),
            ("OnceLock", "global state"),
            ("lazy_static", "global state"),
            ("Mutex", "state shared between actors"),
            ("RefCell", "hidden mutability (memory is the actor's own fields)"),
            ("HashMap", "an order that can change between runs (use BTreeMap; a lookup never iterated may use HashMap with `// lookup only` on its line)"),
            ("HashSet", "an order that can change between runs (use BTreeSet)"),
            ("rand::", "randomness not from the kernel's streams"),
        ] {
            for (i, line) in src.lines().enumerate() {
                let code = line.split("//").next().unwrap_or_default();
                if code.contains(forbidden) && !(forbidden == "HashMap" && line.contains("// lookup only")) {
                    panic!("{}:{}: {forbidden} ({why})", f.display(), i + 1);
                }
            }
        }
    }
}

#[test]
fn every_kind_is_registered_once_and_its_manifest_names_it() {
    let kinds = oikos_actors::registry::kinds();
    let mut names: Vec<&str> = kinds.iter().map(|k| k.name()).collect();
    let n = names.len();
    names.dedup();
    assert_eq!(names.len(), n, "a kind registered twice");
    for k in kinds {
        let m = k.manifest();
        assert_eq!(m["name"], k.name());
        assert_eq!(m["version"], k.version());
        assert_eq!(m["doc"], k.doc());
        assert!(root().join("..").join(k.doc()).exists(), "{}'s doc {} is missing", k.name(), k.doc());
    }
}
