//! Terrarium's shared core (docs/design/rebuild.md section 4): what every consumer must compute identically:
//! canonical JSON and domain-separated hashes, money on the wire, and the keyed randomness streams.

#![forbid(unsafe_code)]
#![deny(clippy::float_arithmetic, clippy::float_cmp)]

pub mod canon;
pub mod money;
pub mod rng;
