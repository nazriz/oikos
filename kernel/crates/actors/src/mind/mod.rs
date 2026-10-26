//! The citizen's mind (lane A2: participants/src/behaviour/citizen.ts's deciding half, mind.ts, inner.ts, wants.ts,
//! culture.ts, townmemory.ts, reading.ts, founding.ts, founded.ts). It implements `crate::citizen::mind::Mind`, the
//! seam the citizen's life calls (docs/port-guide.md, section 5.4).
//!
//! The parts, each a port of one TS module, rewritten for Rust:
//! - `person`: who someone is (values, temperament, need weights), how satisfied, experience-weighted attraction,
//!   CONSUMAT's strategies, appraising an option's facts, deciding; feelings, ties, a goal's pursuit (mind.ts).
//! - `inner`: trust, agency, attachments, views, dents, memory, hours (inner.ts).
//! - `wants`: wants and the openings that meet them (wants.ts).
//! - `culture`, `townmemory`: what a person takes those around them to do and approve of; what they remember of the
//!   town's public events (culture.ts, townmemory.ts).
//! - `reading`: what the read words of a paper do to the person (reading.ts).
//! - `founding`, `founded`: starting something with others, and the founded group's post as a kind (founding.ts,
//!   founded.ts).
//! - `citizen`: citizen.ts's deciding half, composing the rest behind the seam (`plan`: the week's mind half;
//!   `voice`: events, talk, civic life, petitions, word of mouth and the record; `talk`: the citizen's phrasing).
//! - `math`: deterministic `exp`/`ln` and JavaScript's rounding.
//! - `packed`: a JSON value kept as its text (what a person last wrote to their record).
//!
//! Conventions (all parts): state kept in integers (basis points; fixed point where TS kept a fraction that matters),
//! so a saved mind restores to the bit; floats only inside a computation, through `math`, rounded with `math::round`
//! (JavaScript's `Math.round`) before anything compares, draws on or records them.

pub mod citizen;
pub mod culture;
pub mod founded;
pub mod founding;
pub mod inner;
pub mod math;
pub mod packed;
pub mod person;
pub mod plan;
pub mod reading;
pub mod talk;
pub mod voice;
pub mod townmemory;
pub mod wants;

use crate::citizen::mind::{Born, Mind};
use crate::{Ctx, Cx};
use serde_json::Value;

/// The mind's own kinds (a founded group's founder post: founded.ts), A2's, in name order.
pub static KINDS: &[&dyn crate::Kind] = &[&founded::Founded];

/// A person's mind, drawn as the world's parameters and the person's own make it.
pub fn make(cx: &mut Cx, born: &Born) -> Result<Box<dyn Mind>, String> {
    citizen::make(cx, born)
}

/// A mind as its `save` left it.
pub fn restore(ctx: &Ctx, saved: Value) -> Result<Box<dyn Mind>, String> {
    citizen::restore(ctx, saved)
}

#[cfg(test)]
mod tests;
