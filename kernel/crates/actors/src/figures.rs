//! The engine's figure registry (law 11: docs/design/foundations-2.md 5.1, step N4). A number the built-in actors compute
//! with is a convention (a unit, a count of days in a week, basis points), a parameter its module reads, or a figure
//! declared here once, its class first in its comment (`sourced`, `to_confirm`, `derived`, `fitted`, `placeholder` or
//! `convention`) and then its source or why. orchestrator/test/every-number-has-a-basis.test.ts refuses a figure here with
//! no class, and counts the literals still written in the actors' code (its inventory only shrinks): moving one here, or
//! into a module's parameters, lowers its file's count.
//!
//! Empty at its start (2026-11-08): the actors' 1,300 or so literals are still where they are written, counted by file.

/// convention: how many of its own papers a principal keeps to hand to send a copy of when its assistant asks for one
/// by name (a bound on what it holds, not a behaviour; docs/behaviour/assistants.md, "Answers to requests").
pub const KEPT_OWN_PAPERS: usize = 64;

/// convention: how many letters a principal remembers having acknowledged, so that one is acknowledged once (a bound on
/// what it holds).
pub const KEPT_ACKNOWLEDGED: usize = 512;
