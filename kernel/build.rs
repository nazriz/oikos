// Records the kernel build identity (git commit, "+dirty" if the tree has
// uncommitted changes) for log headers, and a fingerprint of the sources the
// engine is built from (its Rust, manifests and embedded contracts), so the
// host can tell a native module and a binary built from different sources
// apart (orchestrator/src/kernel.ts).
use std::path::{Path, PathBuf};
use std::process::Command;

fn git(args: &[&str]) -> Option<String> {
    let out = Command::new("git").args(args).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let p = e.path();
        if p.is_dir() {
            if p.file_name().is_some_and(|n| n != "target") {
                walk(&p, out);
            }
        } else if p.extension().is_some_and(|x| x == "rs" || x == "toml" || x == "json") {
            out.push(p);
        }
    }
}

/// FNV-1a over each file's path and bytes, in path order.
fn fingerprint() -> String {
    let mut files = vec![PathBuf::from("Cargo.toml"), PathBuf::from("Cargo.lock")];
    for d in ["src", "crates", "../contracts"] {
        walk(Path::new(d), &mut files);
    }
    files.sort();
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for f in &files {
        for b in f.to_string_lossy().bytes().chain(std::fs::read(f).unwrap_or_default()) {
            h = (h ^ b as u64).wrapping_mul(0x0100_0000_01b3);
        }
    }
    format!("{h:016x}")
}

fn main() {
    let rev = git(&["rev-parse", "--short=12", "HEAD"]).unwrap_or_else(|| "unknown".into());
    let dirty = git(&["status", "--porcelain", "--", "."]).map(|s| !s.is_empty()).unwrap_or(false);
    let build = if dirty { format!("{rev}+dirty") } else { rev };
    println!("cargo:rustc-env=OIKOS_BUILD={build}");
    println!("cargo:rustc-env=OIKOS_SOURCE={}", fingerprint());
    // (In a worktree `../.git` is a file that names the real git directory; a path that isn't there makes cargo
    // rebuild the engine on every invocation. So ask git where its directory is.)
    let git_dir = git(&["rev-parse", "--absolute-git-dir"]).unwrap_or_else(|| "../.git".into());
    println!("cargo:rerun-if-changed={git_dir}/HEAD");
    println!("cargo:rerun-if-changed={git_dir}/index");
    for p in ["src", "crates", "Cargo.toml", "Cargo.lock", "../contracts"] {
        println!("cargo:rerun-if-changed={p}");
    }
}
