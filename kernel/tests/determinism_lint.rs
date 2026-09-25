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
    let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut violations = vec![];
    for entry in std::fs::read_dir(&src).unwrap() {
        let path = entry.unwrap().path();
        let text = std::fs::read_to_string(&path).unwrap();
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
                    violations.push(format!("{}:{}: {word} ({why})", path.file_name().unwrap().to_string_lossy(), n + 1));
                }
            }
        }
    }
    assert!(violations.is_empty(), "determinism violations:\n{}", violations.join("\n"));
}
