//! Oikos's contract types (docs/design/rebuild.md section 4): blocks and records, the world config, events,
//! and the compiled JSON Schemas every input is validated against. Types only: nothing here runs the world.

#![forbid(unsafe_code)]
#![deny(clippy::float_arithmetic, clippy::float_cmp)]

pub mod blocks;
pub mod config;
pub mod contracts;
pub mod controller;
pub mod events;
pub mod network;
pub mod vocab;
