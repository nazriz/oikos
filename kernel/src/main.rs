//! terrarium-kernel CLI.
//!
//!   terrarium-kernel serve                         NDJSON protocol on stdin/stdout
//!   terrarium-kernel verify <log> [--anchors <f>]  check the hash chain (and witness)
//!   terrarium-kernel replay <log> [--anchors <f>]  replay and require a byte-identical log
//!   terrarium-kernel version

use std::process::ExitCode;

/// A faster allocator for the kernel binary (the kernel allocates heavily; no result depends on the allocator).
#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;
use terrarium_kernel::{log, protocol, run};

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
        Some("version") => {
            println!("terrarium-kernel {} ({})", run::KERNEL_VERSION, run::KERNEL_BUILD);
            Ok(())
        }
        _ => Err("usage: terrarium-kernel serve | verify <log> [--anchors <file>] | replay <log> [--anchors <file>] | version".into()),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}
