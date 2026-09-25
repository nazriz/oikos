// Records the kernel build identity (git commit, "+dirty" if the tree has
// uncommitted changes) for log headers.
use std::process::Command;

fn git(args: &[&str]) -> Option<String> {
    let out = Command::new("git").args(args).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn main() {
    let rev = git(&["rev-parse", "--short=12", "HEAD"]).unwrap_or_else(|| "unknown".into());
    let dirty = git(&["status", "--porcelain", "--", "."]).map(|s| !s.is_empty()).unwrap_or(false);
    let build = if dirty { format!("{rev}+dirty") } else { rev };
    println!("cargo:rustc-env=TERRARIUM_BUILD={build}");
    println!("cargo:rerun-if-changed=../.git/HEAD");
    println!("cargo:rerun-if-changed=../.git/index");
}
