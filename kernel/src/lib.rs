//! Terrarium kernel: the world's laws of physics and its only writer.
//!
//! Inputs are commands (act / advance / observe / resign); outputs are events,
//! observations and a hash-chained log that replays byte-identically. The
//! contracts in ../contracts are the source of truth for every type that
//! crosses the kernel boundary.

#![forbid(unsafe_code)]
#![deny(clippy::float_arithmetic, clippy::float_cmp)]

pub mod blocks;
pub mod canon;
pub mod config;
pub mod contracts;
pub mod events;
pub mod exec;
pub mod kernel;
pub mod laws;
pub mod log;
pub mod mandate;
pub mod observe;
pub mod protocol;
pub mod rng;
pub mod run;
pub mod state;

pub use kernel::{Command, Kernel, ProtocolError};
pub use run::{replay, Run};
