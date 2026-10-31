//! The world: its state, physics and records, and the only writer (docs/design/rebuild.md section 4). Commands in,
//! events out; the kernel refuses only what is physically impossible. What participants perceive of it is
//! `oikos-perception`'s, read-only; the loop around it is the engine's.

#![forbid(unsafe_code)]
#![deny(clippy::float_arithmetic, clippy::float_cmp)]

pub mod exec;
pub mod geo;
pub mod kernel;
pub mod network;
pub mod sites;
pub mod state;
pub mod statics;
pub mod travel;
pub mod ways;

pub use kernel::{Command, ProtocolError, World};

// The shared core and the contract types, where the kernel has always had them.
pub use oikos_contracts::{blocks, config, contracts, events, vocab};
pub use oikos_core::{canon, money, rng};
