//! oikos-kernel CLI.
//!
//!   oikos-kernel serve                         NDJSON protocol on stdin/stdout
//!   oikos-kernel verify <log> [--anchors <f>]  check the hash chain (and witness)
//!   oikos-kernel replay <log> [--anchors <f>]  replay and require a byte-identical log
//!   oikos-kernel version
//!   oikos-kernel world <config.json> --out <dir> [--run-id ID] [--until S] [--threads N] [--stand-in KIND]
//!                                              run a world in the engine, its actors in Rust, with no seats
//!   oikos-kernel manifests                     every actor kind's manifest, as JSON

use std::process::ExitCode;

/// A faster allocator for the kernel binary (the kernel allocates heavily; no result depends on the allocator).
#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;
use oikos_kernel::{log, protocol, run};

fn read(path: &str) -> Result<Vec<u8>, String> {
    std::fs::read(path).map_err(|e| format!("{path}: {e}"))
}

fn anchors_arg(args: &[String]) -> Result<Option<Vec<u8>>, String> {
    match args.iter().position(|a| a == "--anchors") {
        Some(i) => args.get(i + 1).ok_or("--anchors needs a path".to_string()).and_then(|p| read(p)).map(Some),
        None => Ok(None),
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        Some("serve") => {
            let stdin = std::io::stdin();
            protocol::serve(stdin.lock(), std::io::stdout().lock()).map_err(|e| e.to_string())
        }
        Some("verify") if args.len() >= 2 => (|| {
            let v = log::verify(&read(&args[1])?, anchors_arg(&args)?.as_deref()).map_err(|e| e.to_string())?;
            println!(
                "ok: {} entries, head {}, {}, {} anchors checked",
                v.entries.len(),
                v.head,
                if v.complete { "complete" } else { "incomplete (no end entry)" },
                v.anchors_checked
            );
            Ok(())
        })(),
        Some("replay") if args.len() >= 2 => (|| {
            let r = run::replay(&read(&args[1])?, anchors_arg(&args)?.as_deref()).map_err(|e| e.to_string())?;
            if let Some(d) = &r.build_differs {
                eprintln!("note: {d}");
            }
            println!("ok: {} entries replayed byte-identically; final state {}", r.entries, r.state_hash);
            Ok(())
        })(),
        Some("world") if args.len() >= 2 => world(&args),
        Some("manifests") => {
            let all: Vec<serde_json::Value> = oikos_actors::registry::kinds().iter().map(|k| k.manifest()).collect();
            println!("{}", serde_json::to_string_pretty(&all).unwrap_or_default());
            Ok(())
        }
        Some("version") => {
            println!("oikos-kernel {} ({}) source {}", run::KERNEL_VERSION, run::KERNEL_BUILD, run::KERNEL_SOURCE);
            Ok(())
        }
        _ => Err("usage: oikos-kernel serve | verify <log> [--anchors <file>] | replay <log> [--anchors <file>] | world <config.json> --out <dir> [--run-id ID] [--until S] [--threads N] [--stand-in KIND] | manifests | version".into()),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}

/// `world`: a world run in the engine with its actors in Rust, to its end or `--until`; prints its final state hash.
fn world(args: &[String]) -> Result<(), String> {
    let flag = |name: &str| args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned();
    let config: serde_json::Value = serde_json::from_slice(&read(&args[1])?).map_err(|e| format!("{}: {e}", args[1]))?;
    let out = flag("--out").ok_or("--out <dir> is needed")?;
    std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
    let run_id = flag("--run-id").unwrap_or_else(|| "world".into());
    let mut opts = oikos_kernel::engine::EngineOptions::default();
    if let Some(n) = flag("--threads") {
        opts.threads = n.parse().map_err(|_| "--threads N")?;
    }
    opts.until = flag("--until").map(|u| u.parse::<i64>()).transpose().map_err(|_| "--until S")?;
    opts.stand_in = flag("--stand-in");
    let log = std::io::BufWriter::new(std::fs::File::create(format!("{out}/{run_id}.jsonl")).map_err(|e| e.to_string())?);
    let (hash, e) = oikos_kernel::engine::run_code_world(config, &run_id, log, opts)?;
    println!("{{\"run_id\":{:?},\"state_hash\":{:?},\"t\":{},\"steps\":{}}}", run_id, hash, e.t(), e.steps);
    Ok(())
}
