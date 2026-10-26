//! Oikos kernel: the world's laws of physics and its only writer.
//!
//! Physics, plus a place to keep records (contracts v0.5, D18-D22, D47, D58). Inputs are
//! commands (act / advance / observe / look / opt_out); outputs are events,
//! observations and a hash-chained log that replays byte-identically. The
//! kernel refuses only what is physically impossible; laws, ownership and
//! authority are records it stores and never judges. The contracts in
//! ../contracts are the source of truth for every type that crosses the
//! kernel boundary.

#![forbid(unsafe_code)]
#![deny(clippy::float_arithmetic, clippy::float_cmp)]

pub mod blog;
pub mod engine;
pub mod host;
pub mod kernel;
pub mod log;
pub mod protocol;
pub mod rules_api;
pub mod run;
pub mod stream;

// The world (its state, physics and records: the only writer) and perception (read-only), as crates of their own,
// where the kernel has always had them.
pub use oikos_perception as observe;
pub use oikos_world::{exec, geo, network, state, statics};

pub use kernel::{Command, Kernel, ProtocolError};
pub use run::{replay, Run};

// The shared core and the contract types, re-exported where the kernel has always had them.
pub use oikos_contracts::{blocks, config, contracts, events, vocab};
pub use oikos_core::{canon, money, rng};
pub mod pool;
pub mod schedule;
pub mod spool;
