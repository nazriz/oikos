//! Pure rules the built-in actors and the world generator share (docs/design/rust-port.md 2.1, 1.1).
//!
//! A rule here is a function of the law (config data), the profile's figures as the config carries them, and keyed
//! randomness handed in: no world state, no I/O, no clock, and no place's figure written in code (the generality
//! backstop scans this crate). The generator calls these through the N-API module, so nothing is written twice.
//!
//! Each port agent adds the rules its modules share, one module per rule, with the TS function it replaces named in its
//! doc comment and its unit tests beside it:
//! - `slip`: the one way a decision goes wrong by chance (participants/src/slip.ts). Ported in the frame.
//! - `withholding`, `support`: tax withheld from a pay, support payments owed (behaviour/tax.ts, payments.ts): agent C1.
//! - `decisions`: what a decision waits for, its deadlines, review routes (behaviour/decisions.ts): agent D.
//! - `household`: drawing a household and its savings (behaviour/household.ts): agent A1.
//! - `forms`: an office's stationery (participants/src/module.ts `Issued`, `Taken`, `Routine`, `Answers`; papers.ts):
//!   the form types and the catalogue of the papers offices issue, as data, exported by name. Step 1b; lane E owns
//!   the catalogue's content from then on.
//! - `law`: reading a law's formal condition against an act (oikos-law), and writing a law from its figures by a
//!   schedule (common.ts `draftLaw`). Step 1b.
//! - `calendar`, `identity`: the world's civil dates and what things are called (docs/design/names-and-dates.md): the
//!   types and the date arithmetic are in the frame; names, references and dates in words are lane N's.

#![forbid(unsafe_code)]
#![deny(clippy::float_arithmetic, clippy::float_cmp)]

pub mod calendar;
pub mod forms;
pub mod household;
pub mod identity;
pub mod law;
pub mod slip;
