//! Terrarium kernel: the world's laws of physics and its only writer.
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

pub mod blocks;
pub mod canon;
pub mod config;
pub mod contracts;
pub mod events;
pub mod exec;
pub mod geo;
pub mod kernel;
pub mod log;
pub mod money;
pub mod observe;
pub mod protocol;
pub mod rng;
pub mod run;
pub mod state;
pub mod statics;

pub use kernel::{Command, Kernel, ProtocolError};
pub use run::{replay, Run};
