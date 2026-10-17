//! The citizen's mind (lane A2: participants/src/behaviour/citizen.ts's deciding half, mind.ts, inner.ts, wants.ts,
//! culture.ts, townmemory.ts, reading.ts, founding.ts, founded.ts). It implements `crate::citizen::mind::Mind`, the
//! seam the citizen's life calls (docs/port-guide.md, section 5).
//!
//! Until A2's port is in, `make` and `restore` give the plain stand-in, so that lane A1 can run its citizen; A2
//! replaces their bodies with its own mind and owns this directory.

use crate::citizen::mind::{Born, Mind, Plain};
use crate::{Ctx, Cx};
use serde_json::Value;

/// The mind's own kinds (a founded group's founder post: founded.ts), A2's, in name order.
pub static KINDS: &[&dyn crate::Kind] = &[];

/// A person's mind, drawn as the world's parameters and the person's own make it.
pub fn make(_cx: &mut Cx, _born: &Born) -> Result<Box<dyn Mind>, String> {
    Ok(Box::new(Plain::default()))
}

/// A mind as its `save` left it.
pub fn restore(_ctx: &Ctx, saved: Value) -> Result<Box<dyn Mind>, String> {
    Ok(Box::new(serde_json::from_value::<Plain>(saved).map_err(|e| e.to_string())?))
}
