//! Oikos's shared core (docs/design/rebuild.md section 4): what every consumer must compute identically:
//! canonical JSON and domain-separated hashes, money on the wire, and the keyed randomness streams.

#![forbid(unsafe_code)]
#![deny(clippy::float_arithmetic, clippy::float_cmp)]

pub mod canon;
mod canon_ser;
pub mod frozen;
pub mod id;
pub mod money;
pub mod rng;

pub use frozen::Frozen;
pub use id::Id;
