//! Mandate evaluation: which level (if any) a seat's mandate grants for a
//! block. Default deny; powers are checked in order and the first match wins.
//! For an action, the strictest level wins (direct < approval < request).

use crate::blocks::Block;
use crate::config::{Level, Mandate};
use std::collections::BTreeSet;

/// The amount a power's `max_amount` limit is compared against.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Amount {
    /// The block has no amount (e.g. message); amount limits don't restrict it.
    NotApplicable,
    Known(i64),
    /// The block has an amount but it can't be determined (e.g. unknown
    /// structure type). Powers with an amount limit do not match.
    Unknown,
}

pub fn power_level(mandate: &Mandate, block_name: &str, amount: Amount) -> Option<(Level, Vec<String>)> {
    for p in &mandate.powers {
        if !p.blocks.iter().any(|b| b == block_name) {
            continue;
        }
        let within = match (p.limits.as_ref().and_then(|l| l.max_amount), amount) {
            (None, _) | (Some(_), Amount::NotApplicable) => true,
            (Some(max), Amount::Known(a)) => a <= max,
            (Some(_), Amount::Unknown) => false,
        };
        if within {
            let targets = match p.level {
                Level::Direct => vec![],
                Level::Approval => p.approvers.clone().unwrap_or_default(),
                Level::Request => p.request_to.clone().unwrap_or_default(),
            };
            return Some((p.level, targets));
        }
    }
    None
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Verdict {
    /// Seats whose approval (or, for Request, attention) is needed.
    Allowed {
        level: Level,
        targets: BTreeSet<String>,
    },
    Denied {
        block: usize,
    },
}

/// `amount_of` supplies each block's amount (it may need world state).
pub fn evaluate(mandate: &Mandate, blocks: &[Block], amount_of: impl Fn(&Block) -> Amount) -> Verdict {
    let mut level = Level::Direct;
    let mut approvers = BTreeSet::new();
    let mut request_to = BTreeSet::new();
    for (i, b) in blocks.iter().enumerate() {
        match power_level(mandate, b.name(), amount_of(b)) {
            None => return Verdict::Denied { block: i },
            Some((l, targets)) => {
                level = level.max(l);
                match l {
                    Level::Direct => {}
                    Level::Approval => approvers.extend(targets),
                    Level::Request => request_to.extend(targets),
                }
            }
        }
    }
    let targets = match level {
        Level::Direct => BTreeSet::new(),
        Level::Approval => approvers,
        Level::Request => request_to,
    };
    Verdict::Allowed { level, targets }
}
