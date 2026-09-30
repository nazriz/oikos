//! The resolver (docs/design/translator-and-resolver.md section 8), in the engine: the call language, what each seat
//! knows (from the observations the engine delivers), and a call to the seat's own acts.

pub mod calls;
pub mod knowledge;
pub mod resolve;

pub use knowledge::Knowledge;
pub use resolve::{resolve, Resolution, RESOLVER_VERSION};
