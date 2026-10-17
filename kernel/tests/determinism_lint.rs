//! Textual guard for the determinism rules, so they hold even when clippy
//! isn't run: no hash maps (iteration order), no floats, no wall-clock time,
//! no ambient randomness in kernel source.

#[test]
fn kernel_source_has_no_nondeterminism() {
    let forbidden = [
        ("HashMap", "iteration order is nondeterministic; use BTreeMap"),
        ("HashSet", "iteration order is nondeterministic; use BTreeSet"),
        ("f32", "no floating point in the world"),
        ("f64", "no floating point in the world"),
        ("SystemTime", "no wall-clock time"),
        ("Instant", "no wall-clock time"),
        ("thread_rng", "all randomness flows through rng::Randomness"),
        ("rand::", "all randomness flows through rng::Randomness"),
    ];
    // The kernel's own source and every crate's, all the way down (most of the kernel lives in crates/).
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut dirs = vec![root.join("src")];
    let mut crates: Vec<_> = std::fs::read_dir(root.join("crates")).unwrap().map(|e| e.unwrap().path().join("src")).filter(|p| p.is_dir()).collect();
    crates.sort();
    assert!(crates.len() >= 10, "the crates weren't found under {}", root.join("crates").display());
    dirs.extend(crates);
    let mut files = vec![];
    while let Some(dir) = dirs.pop() {
        for entry in std::fs::read_dir(&dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                dirs.push(path);
            } else if path.extension().is_some_and(|x| x == "rs") {
                files.push(path);
            }
        }
    }
    files.sort();
    assert!(files.iter().any(|f| f.ends_with("crates/world/src/exec.rs")), "the crates' source wasn't read");
    let mut violations = vec![];
    // The citizen's mind (lane A2) may compute with floats where a model needs them (a softmax, a half-life, a
    // z-score), as docs/port-guide.md section 2 allows: through its own deterministic `math` (IEEE basic operations
    // only, the same bits on any machine) and rounded to an integer before anything stores, compares, draws on or
    // records it. Its state is integers; actors_boundary.rs holds its other rules. Nowhere else.
    let floats_allowed = |p: &std::path::Path| p.strip_prefix(root).is_ok_and(|r| r.starts_with("crates/actors/src/mind"));
    for path in &files {
        let text = std::fs::read_to_string(path).unwrap();
        for (n, line) in text.lines().enumerate() {
            let code = line.split("//").next().unwrap();
            for (word, why) in forbidden {
                if (*word == *"f32" || *word == *"f64") && floats_allowed(path) {
                    continue;
                }
                let hit = code.match_indices(word).any(|(i, _)| {
                    let before = code[..i].chars().last();
                    let after = code[i + word.len()..].chars().next();
                    let boundary = |c: Option<char>| c.is_none_or(|c| !c.is_alphanumeric() && c != '_');
                    boundary(before) && (word.ends_with("::") || boundary(after))
                });
                if hit {
                    violations.push(format!("{}:{}: {word} ({why})", path.strip_prefix(root).unwrap().display(), n + 1));
                }
            }
        }
    }
    assert!(violations.is_empty(), "determinism violations:\n{}", violations.join("\n"));
}
