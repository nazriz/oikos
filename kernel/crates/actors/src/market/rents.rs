//! The market evidence a landlord reads at a rent review (docs/risks.md ME-14; docs/port-guide.md section 5.6, 3).
//!
//! Until now a landlord set a rent to the mean of its own like homes plus 5%, so its own rents were its reference and
//! each review raised the next: a ratchet decoupled from vacancy. Rents are set in a market by what homes like this
//! one let for and how long they stand empty. This module reads that from what the landlord can know: the rental
//! listings published on the boards it reads (the `rental_listing` paper, which lane C1 writes and every landlord and
//! every home-seeker reads), and when each came down (a listing is withdrawn when the home is let, or when its owner
//! gives up). It is a pure reading of a `Book`: C1 owns the rule that sets a rent and may call [`evidence`] and
//! [`reference`] for the market's side of it. Days on the market are the standard indicator of whether an asking rent is
//! above or below what the market bears (listing agents' own practice; Genesove and Mayer 2001 on asking prices and
//! time on market).
//!
//! What it cannot see: a rent agreed and never listed (a sitting tenant's), the rent a tenant finally paid (a listing
//! shows what was asked), or listings on a board the landlord does not read. A landlord with no evidence gets none and
//! must say so: [`reference`] returns `None` below `min_listings` and the caller keeps its own rule's fallback.

use crate::common::book::Book;
use crate::common::{data, Fields, DAY};
use crate::papers::{self, firms::RentalListing};
use serde::{Deserialize, Serialize};

/// What the listings a landlord has seen say about homes of a kind.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct RentEvidence {
    /// Asking rents of listings still standing, cents a month.
    pub open: Vec<i64>,
    /// Asking rents of listings taken down within the window (let, or withdrawn), with the days each stood.
    pub taken: Vec<(i64, i64)>,
    /// Of the open listings, how many have stood longer than `stale_days`.
    pub stale: usize,
    /// The lowest asking rent among the stale ones: a rent at which no one has yet taken a home.
    pub stale_floor: Option<i64>,
}

/// How the evidence is read.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct RentFigures {
    /// How far back taken listings count, in days.
    pub window_days: i64,
    /// A listing standing longer than this has not found a taker at its price.
    pub stale_days: i64,
    /// Fewest listings (open and taken) that make evidence.
    pub min_listings: usize,
}

impl Default for RentFigures {
    fn default() -> Self {
        RentFigures { window_days: 365, stale_days: 45, min_listings: 3 }
    }
}

/// The listings of homes of a type (and, where given, bedrooms) that the book holds, split into those still standing and
/// those taken down, as at `t`.
pub fn evidence(book: &Book, home_type: &str, bedrooms: Option<i64>, t: i64, f: &RentFigures) -> RentEvidence {
    let mut ev = RentEvidence::default();
    for r in book.all("rental_listing") {
        let Some(l) = papers::read::<RentalListing>(r) else { continue };
        if l.type_ != home_type || bedrooms.is_some_and(|b| l.bedrooms.is_some_and(|x| x != b)) || l.rent <= 0 {
            continue;
        }
        match book.withdrawn_at(&r.id) {
            Some(gone) if t - gone <= f.window_days * DAY => ev.taken.push((l.rent, ((gone - r.at) / DAY).max(0))),
            Some(_) => {}
            None => {
                ev.open.push(l.rent);
                if t - r.at > f.stale_days * DAY {
                    ev.stale += 1;
                    ev.stale_floor = Some(ev.stale_floor.map_or(l.rent, |x| x.min(l.rent)));
                }
            }
        }
    }
    ev
}

fn median(v: &mut [i64]) -> Option<i64> {
    v.sort_unstable();
    (!v.is_empty()).then(|| v[(v.len() - 1) / 2])
}

/// What the market says a home like this rents for, and how tight it is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reference {
    /// The rent homes like it were taken at (the median of those taken down within the window; else of those open).
    pub rent: i64,
    /// A rent no one has taken a home at: the lowest stale asking rent, if any.
    pub ceiling: Option<i64>,
    /// Of the homes listed, the share (bps) that stood longer than the stale days: tight markets let fast.
    pub slack_bps: i64,
    /// Listings it was made from.
    pub n: usize,
}

/// The market's reference rent, or none where the landlord has seen too few listings to say.
pub fn reference(ev: &RentEvidence, f: &RentFigures) -> Option<Reference> {
    let n = ev.open.len() + ev.taken.len();
    if n < f.min_listings {
        return None;
    }
    let mut taken: Vec<i64> = ev.taken.iter().map(|(r, _)| *r).collect();
    let mut open = ev.open.clone();
    let rent = median(&mut taken).or_else(|| median(&mut open))?;
    let slack_bps = if ev.open.is_empty() { 0 } else { (ev.stale as i64) * 10_000 / (n as i64) };
    Some(Reference { rent, ceiling: ev.stale_floor, slack_bps, n })
}

/// Whether a listing is one the landlord itself put up (its own standing listings are not the market's word on rents
/// it sets itself; a caller may drop them first).
pub fn is_by(book: &Book, listing_id: &str, landlord: &str) -> bool {
    book.get(listing_id).is_some_and(|r| r.speaks_for.as_deref() == Some(landlord) && data(r).s("space").is_some())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::market::testkit::*;
    use serde_json::json;

    fn listing(id: &str, at: i64, by: &str, rent: i64) -> serde_json::Value {
        statement(id, at, by, "rental_listing", &[], json!({ "structure": "b1", "space": format!("s{id}"), "type": "apartment", "bedrooms": 2, "rent": rent }))
    }
    fn withdrawal(id: &str, at: i64, of: &str) -> serde_json::Value {
        json!({ "id": id, "record": "withdrawal", "author": "x", "at": at, "visible_to": "public", "withdraws": of })
    }

    #[test]
    fn evidence_splits_standing_listings_from_those_taken_down_and_finds_the_stale_ones() {
        let book = book_of(vec![
            listing("rec.1", 0, "l1", 200_000),
            withdrawal("rec.2", 10 * DAY, "rec.1"),
            listing("rec.3", 20 * DAY, "l2", 210_000),
            withdrawal("rec.4", 30 * DAY, "rec.3"),
            listing("rec.5", 60 * DAY, "l3", 260_000),
            listing("rec.6", 100 * DAY, "l4", 205_000),
        ]);
        let f = RentFigures::default();
        let ev = evidence(&book, "apartment", Some(2), 120 * DAY, &f);
        assert_eq!(ev.taken, vec![(200_000, 10), (210_000, 10)]);
        assert_eq!(ev.open, vec![260_000, 205_000]);
        assert_eq!((ev.stale, ev.stale_floor), (1, Some(260_000)), "rec.5 has stood 60 days with no taker");
        let r = reference(&ev, &f).unwrap();
        assert_eq!(r.rent, 200_000, "the lower middle of what homes were taken at");
        assert_eq!((r.ceiling, r.n, r.slack_bps), (Some(260_000), 4, 2500));
        assert!(evidence(&book, "house", None, 120 * DAY, &f).open.is_empty(), "another type of home is another market");
    }

    #[test]
    fn too_few_listings_are_no_evidence_and_a_listing_taken_down_long_ago_is_forgotten() {
        let f = RentFigures { window_days: 90, ..Default::default() };
        let book = book_of(vec![listing("rec.1", 0, "l1", 200_000), withdrawal("rec.2", 10 * DAY, "rec.1"), listing("rec.3", 50 * DAY, "l2", 210_000)]);
        assert!(reference(&evidence(&book, "apartment", None, 60 * DAY, &f), &f).is_none(), "two listings: not enough");
        assert!(evidence(&book, "apartment", None, 200 * DAY, &f).taken.is_empty(), "beyond the window");
        let none = RentEvidence::default();
        assert!(reference(&none, &f).is_none());
    }
}
