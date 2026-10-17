//! `oikos-explore serve [--port N] [--single KEY] [--watch-stdin] [--run key=path[,pilot=pilot.json] ...]` serves the explorer's API
//! (docs/explorer.md, "The data layer (Rust)") on 127.0.0.1; `oikos-explore index <log>` reads a log and prints its meta.
//! Read-only: nothing here writes to a run.

#![allow(clippy::disallowed_types, clippy::disallowed_methods)]

use oikos_explore::service::{RunSpec, Service};
use oikos_explore::{Index, RunIndex};
use std::path::PathBuf;

fn usage() -> ! {
    eprintln!("usage: oikos-explore serve [--port N] [--single KEY] [--watch-stdin] [--run key=path[,pilot=pilot.json] ...]\n       oikos-explore index <log.jsonl|log.jsonl.zst>");
    std::process::exit(2);
}

fn main() {
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() {
        usage();
    }
    match args.remove(0).as_str() {
        "index" => {
            let Some(log) = args.first() else { usage() };
            let ix = Index::new();
            let t0 = std::time::Instant::now();
            if let Err(e) = ix.load_path(&PathBuf::from(log)) {
                eprintln!("oikos-explore: {log}: {e}");
                std::process::exit(1);
            }
            let mut m = ix.meta();
            m["wallSeconds"] = serde_json::json!((t0.elapsed().as_secs_f64() * 10.0).round() / 10.0);
            if let Some(o) = m.as_object_mut() {
                o.remove("spaces");
                o.remove("movesDay");
                o.remove("participants");
            }
            println!("{}", serde_json::to_string_pretty(&m).unwrap());
        }
        "serve" => {
            let mut port: u16 = 4322;
            let mut single: Option<String> = None;
            let mut watch_stdin = false;
            let mut runs: Vec<RunSpec> = vec![];
            let mut i = 0;
            while i < args.len() {
                match args[i].as_str() {
                    "--port" => {
                        i += 1;
                        port = args.get(i).and_then(|p| p.parse().ok()).unwrap_or_else(|| usage());
                    }
                    "--watch-stdin" => watch_stdin = true,
                    "--single" => {
                        i += 1;
                        single = Some(args.get(i).cloned().unwrap_or_else(|| usage()));
                    }
                    "--run" => {
                        i += 1;
                        let spec = args.get(i).cloned().unwrap_or_else(|| usage());
                        let mut parts = spec.split(',');
                        let Some((key, path)) = parts.next().and_then(|f| f.split_once('=')) else { usage() };
                        let mut pilot: Option<PathBuf> = None;
                        for extra in parts {
                            if let Some(p) = extra.strip_prefix("pilot=") {
                                pilot = Some(PathBuf::from(p));
                            }
                        }
                        if !std::path::Path::new(path).is_file() {
                            eprintln!("oikos-explore: no such log: {path}");
                            std::process::exit(1);
                        }
                        runs.push(RunSpec::file(key, path, pilot));
                    }
                    _ => usage(),
                }
                i += 1;
            }
            if runs.is_empty() {
                usage();
            }
            let single = single.or_else(|| if runs.len() == 1 { Some(runs[0].key.clone()) } else { None });
            let mut svc = Service::new(runs);
            if let Some(k) = single {
                svc = svc.single(&k);
            }
            let server = match svc.serve(("127.0.0.1", port)) {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("oikos-explore: {e}");
                    std::process::exit(1);
                }
            };
            println!("oikos-explore: http://{}/api/runs", server.addr());
            if watch_stdin {
                // (started by a parent that holds our stdin: when it goes, so do we, and nothing is left running)
                std::thread::spawn(|| {
                    let mut sink = [0u8; 256];
                    while matches!(std::io::Read::read(&mut std::io::stdin(), &mut sink), Ok(n) if n > 0) {}
                    std::process::exit(0);
                });
            }
            server.join();
        }
        _ => usage(),
    }
}
