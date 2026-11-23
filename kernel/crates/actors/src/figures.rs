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

/// placeholder: how much of a paper's words a principal quotes when its referral says what the matter came from (a
/// letter's first lines, not the whole; docs/behaviour/assistants.md, "Why and by when").
pub const QUOTED_CHARS: usize = 240;

/// convention: how many letters a principal remembers having acknowledged, so that one is acknowledged once (a bound on
/// what it holds).
pub const KEPT_ACKNOWLEDGED: usize = 512;

/// convention: how many matters a principal keeps the trace of, the newest, to tell a body's paper about one from any
/// other (a bound on what it holds; docs/behaviour/assistants.md, "What the client passes on").
pub const KEPT_TRACES: usize = 256;

/// convention: thousandths, the unit a wait in days is kept in (a principal's answers, docs/design/obstacles.md section 10).
pub const MILLI: i128 = 1_000;

/// placeholder (MT-37): how many days a principal waits on a matter it handed over with no word from its assistant
/// before it asks after it, and again before it does it itself, where its parameters give none (docs/design/stakes.md, A2).
pub const PATIENCE_DAYS: i64 = 14;

/// placeholder (MT-37): how many acts sent in its name without its cover a principal bears before it takes the kind
/// back (docs/design/stakes.md, A2).
pub const TAKES_BACK_AFTER: i64 = 2;

/// placeholder (MT-37): what an act in its name that a principal ratified counts toward taking the kind back, in basis
/// points of one (docs/design/stakes.md, A2).
pub const RATIFIED_COUNTS_BPS: i64 = 5_000;

/// convention: how many of the papers its assistant sent in its name a principal keeps to hand, the newest (a bound on
/// what it holds; docs/design/stakes.md, A2).
pub const KEPT_IN_NAME: usize = 40;

/// convention: how many of the payments that came in to it a principal keeps to hand, the newest (a bound on what it
/// holds, from which it says what regular payment it has coming in; docs/design/stakes.md, the client's situation).
pub const KEPT_INCOMING: usize = 48;

/// placeholder: days a pre-election newspaper poll invitation stays open for voluntary resident replies before tallying.
pub const POLL_WINDOW_DAYS: i64 = 3;

/// placeholder: share of news-reading adult residents (in basis points) who reply to a pre-election newspaper poll.
pub const POLL_REPLY_BPS: i64 = 5_000;

/// placeholder: news-value weight assigned by firm.newspaper to accountability items (executive directions and audits).
pub const NEWS_ACCOUNTABILITY_WEIGHT: i64 = 3;

/// convention: maximum characters copied from an accountability record into a newspaper headline.
pub const NEWS_HEADLINE_CHARS: usize = 200;

/// convention: half a percentage point in basis points, used for integer rounding from bps to whole percent.
pub const HALF_PERCENT_BPS: i64 = 50;
