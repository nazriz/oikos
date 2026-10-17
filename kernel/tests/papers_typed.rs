//! Every paper one module writes for another has a Rust type (docs/port-guide.md, section 5): each statement kind the TS
//! behaviour modules write by name (`say("kind"`, a form's `writes.kind`), and each kind the generator files at genesis
//! that a module reads, is in `oikos_actors::papers::kinds()`, or is listed below with why it is not. Until the
//! cut-over the TS is the referee; after it, the TS is gone and this test checks the list alone.

use std::collections::BTreeSet;
use std::path::PathBuf;

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

/// Kinds written that no other module reads as data, or that are not papers between modules.
const UNTYPED: &[(&str, &str)] = &[
    // (Record types, not statement kinds: the contract types them.)
    ("agreement", "a record type"),
    ("claim", "a record type"),
    ("signature", "a record type"),
    ("notice", "a record type, and a statement kind founded.ts writes (typed in mind.rs)"),
];

/// The `"kind"` of every `say("kind"` in a source.
fn said(src: &str) -> Vec<String> {
    let mut out = vec![];
    for (i, _) in src.match_indices("say(\"") {
        let rest = &src[i + 5..];
        if let Some(end) = rest.find('"') {
            let k = &rest[..end];
            if !k.is_empty() && k.bytes().all(|b| b.is_ascii_lowercase() || b == b'_') {
                out.push(k.to_string());
            }
        }
    }
    out
}

/// The kinds a source reads by name: `open("kind")`, `all("kind")`, `standingOf("kind")`, `new Latest("kind"`.
fn read(src: &str) -> Vec<String> {
    let mut out = vec![];
    for pat in ["open(\"", ".all(\"", "standingOf(\"", "new Latest(\""] {
        for (i, _) in src.match_indices(pat) {
            let rest = &src[i + pat.len()..];
            if let Some(end) = rest.find('"') {
                let k = &rest[..end];
                if !k.is_empty() && k.bytes().all(|b| b.is_ascii_lowercase() || b == b'_') {
                    out.push(k.to_string());
                }
            }
        }
    }
    out
}

#[test]
fn every_kind_written_by_name_is_typed() {
    let dir = root().join("participants/src/behaviour");
    let Ok(entries) = std::fs::read_dir(&dir) else { return };
    let mut written = BTreeSet::new();
    for e in entries {
        let p = e.unwrap().path();
        if p.extension().is_some_and(|x| x == "ts") {
            let src = std::fs::read_to_string(&p).unwrap();
            written.extend(said(&src));
            written.extend(read(&src));
        }
    }
    let forms: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(root().join("kernel/crates/rules/forms/papers.json")).unwrap()).unwrap();
    for g in forms.as_object().unwrap().values() {
        let list = g.as_array().cloned().unwrap_or_else(|| vec![g.clone()]);
        for f in list {
            written.insert(f["writes"]["kind"].as_str().unwrap().to_string());
        }
    }
    let typed: BTreeSet<String> = oikos_actors::papers::kinds().into_iter().map(|(k, _)| k.to_string()).collect();
    let untyped: BTreeSet<&str> = UNTYPED.iter().map(|x| x.0).collect();
    let missing: Vec<&String> = written.iter().filter(|k| !typed.contains(*k) && !untyped.contains(k.as_str())).collect();
    assert!(missing.is_empty(), "statement kinds written with no paper type: {missing:?}");
    assert!(written.len() >= 100, "only {} kinds found: the scan is broken", written.len());
}
