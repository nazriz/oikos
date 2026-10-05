// A fingerprint of the sources the law reader is built from (its manifest, this file and src/), so the TypeScript
// side can refuse a WebAssembly module built from other sources (participants/src/law.ts computes the same one).
use std::path::Path;

fn main() {
    let mut files = vec!["Cargo.toml".to_string(), "build.rs".to_string()];
    for e in std::fs::read_dir(Path::new("src")).unwrap().flatten() {
        files.push(format!("src/{}", e.file_name().to_string_lossy()));
    }
    files.sort();
    // FNV-1a over each file's path and bytes, in path order.
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for f in &files {
        for b in f.bytes().chain(std::fs::read(f).unwrap_or_default()) {
            h = (h ^ b as u64).wrapping_mul(0x0100_0000_01b3);
        }
    }
    println!("cargo:rustc-env=OIKOS_LAW_SOURCE={h:016x}");
    println!("cargo:rerun-if-changed=src");
    println!("cargo:rerun-if-changed=Cargo.toml");
    println!("cargo:rerun-if-changed=build.rs");
}
