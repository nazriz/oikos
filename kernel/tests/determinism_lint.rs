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
    // (crates/explore is the read-only explorer's data layer: it reads a finished or live log and answers a viewer; it
    // is outside the world, nothing it computes is read back, so its hash maps, floats and clock (a status line's
    // seconds) cannot change a result. Its output order is by sorted maps and vectors, and tests/ there check it.)
    let mut crates: Vec<_> = std::fs::read_dir(root.join("crates")).unwrap().map(|e| e.unwrap().path()).filter(|p| p.file_name().is_some_and(|n| n != "explore")).map(|p| p.join("src")).filter(|p| p.is_dir()).collect();
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
    for path in &files {
        let text = std::fs::read_to_string(path).unwrap();
        for (n, line) in text.lines().enumerate() {
            let code = line.split("//").next().unwrap();
            for (word, why) in forbidden {
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
