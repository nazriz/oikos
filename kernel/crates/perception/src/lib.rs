//! Perception (docs/design/rebuild.md section 4): what a participant perceives through its channels, its looks and
//! searches, and the readings of the agreements it sees. Read-only: the world marks what was delivered.

#![forbid(unsafe_code)]

mod observe;
pub use observe::*;

// (Where observe.rs has always found them.)
pub(crate) use terrarium_world::{blocks, config, geo, money, state, statics};
