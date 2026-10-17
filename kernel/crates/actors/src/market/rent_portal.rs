//! world.rent_portal: a letting portal, the outside world's listing site (as the property portals and the rental bond
//! boards of real towns are). New in the Rust world (docs/risks.md ME-14). Landlords set rents at a review by what
//! comparable homes let for and how many stand empty; a landlord sees only its own homes, so the market's word reaches it
//! as a published paper. The portal reads the rental listings that are public and when each came down, and every
//! `publish_every_days` publishes one `rental_evidence` statement per comparable type of home (type, bedrooms),
//! superseding the last.
//!
//! It counts only what it was shown: homes never listed (a sitting tenant's) are not in it, and a listing taken down is
//! counted as let (a home may be withdrawn for other reasons). That bias is the portal's, as it is for any listing site.

use crate::common::book::Book;
use crate::common::withdraw;
use crate::papers::{self, firms::RentalListing, market::RentalEvidence};
use crate::steps::{because, say, Plan, Say, Step, Stepper, Visible};
use crate::{Actor, Ctx, Cx, Kind, Picture, DAY};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;

pub struct RentPortal;

#[derive(Serialize, Deserialize)]
struct Portal {
    publish_every: i64,
    window: i64,
    next: i64,
    book: Book,
    /// The statements it has published (type, bedrooms) -> id, to supersede.
    standing: BTreeMap<String, String>,
}

/// What the portal has been shown, as evidence by comparable type.
pub fn survey(book: &Book, t: i64, window_days: i64) -> Vec<RentalEvidence> {
    let mut by: BTreeMap<(String, Option<i64>), RentalEvidence> = BTreeMap::new();
    for r in book.all("rental_listing") {
        let Some(l) = papers::read::<RentalListing>(r) else { continue };
        if l.rent <= 0 {
            continue;
        }
        let e = by.entry((l.type_.clone(), l.bedrooms)).or_insert_with(|| RentalEvidence { type_: l.type_.clone(), bedrooms: l.bedrooms, lets: vec![], asking: vec![], homes: 0, vacant: 0, window_days });
        match book.withdrawn_at(&r.id) {
            Some(gone) if t - gone <= window_days * DAY => {
                e.lets.push(l.rent);
                e.homes += 1;
            }
            Some(_) => {}
            None => {
                e.asking.push(l.rent);
                e.homes += 1;
                e.vacant += 1;
            }
        }
    }
    by.into_values().collect()
}

impl Plan for Portal {
    type Then = String;
    fn absorb(&mut self, pic: &Picture, _: &mut Cx) {
        self.book.absorb(pic);
    }
    fn plan(&mut self, pic: &Picture, _: &mut Cx) -> Vec<Step<String>> {
        if pic.t < self.next {
            return vec![];
        }
        self.next = pic.t + self.publish_every;
        let mut steps = vec![];
        for e in survey(&self.book, pic.t, self.window) {
            let key = format!("{}|{}", e.type_, e.bedrooms.map_or(String::new(), |b| b.to_string()));
            let mut calls = vec![];
            if let Some(old) = self.standing.get(&key) {
                calls.push(withdraw(old, Some("Superseded.")));
            }
            let words = format!("Homes to let, {}{}: {} let in the last {} days, {} standing.", e.type_, e.bedrooms.map_or(String::new(), |b| format!(", {b} bedrooms")), e.lets.len(), self.window, e.vacant);
            calls.push(say("rental_evidence", &words, Say { visible: Some(Visible::Public), data: Some(papers::data(&e)), ..Default::default() }));
            let mut s = because("The portal's monthly count of homes let and standing.", calls);
            if let Some(l) = s.lines.last_mut() {
                l.bind = Some("evidence".into());
            }
            s.then = Some(key);
            steps.push(s);
        }
        steps
    }
    fn until(&self, _: &Picture) -> Option<i64> {
        Some(self.next)
    }
    fn then(&mut self, key: &String, done: crate::steps::Done, _: &mut Cx) -> Vec<Step<String>> {
        if let crate::steps::Done::Outcome(o) = done {
            if let Some(id) = o.created.as_ref().and_then(|c| c.values().next()) {
                self.standing.insert(key.clone(), id.clone());
            }
        }
        vec![]
    }
}

impl Kind for RentPortal {
    fn name(&self) -> &'static str {
        "world.rent_portal"
    }
    fn version(&self) -> &'static str {
        "0.1.0"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/boundary.md"
    }
    fn manifest(&self) -> Value {
        json!({
            "name": self.name(), "version": self.version(), "doc": self.doc(),
            "params": {
                "publish_every_days": { "schema": { "type": "integer" }, "unit": "days", "default": 30, "source": "placeholder" },
                "window_days": { "schema": { "type": "integer" }, "unit": "days", "default": 90, "source": "placeholder" },
            },
            "perceives": [], "state": "none",
            "issues": ["rental_evidence"],
            "answers": { "office": "the letting portal", "acts": "It publishes a count of the rental listings it was shown, by kind of home. It takes no requests." },
        })
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        DAY
    }
    fn first_wake(&self, _: &Ctx) -> i64 {
        12 * 3600
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        let publish_every = ctx.param("publish_every_days", 30)? * DAY;
        let window = ctx.param("window_days", 90)?;
        Ok(Box::new(Stepper::new(Portal { publish_every, window, next: publish_every, book: Book::new(), standing: BTreeMap::new() })))
    }
    fn restore(&self, _: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        Ok(Box::new(Stepper::<Portal>::restore(saved)?))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::market::testkit::*;

    fn listing(id: &str, at: i64, ty: &str, bed: i64, rent: i64) -> Value {
        statement(id, at, "l1", "rental_listing", &[], json!({ "structure": "b", "space": id, "type": ty, "bedrooms": bed, "rent": rent }))
    }

    #[test]
    fn it_counts_lets_and_standing_listings_by_comparable_type() {
        let book = book_of(vec![
            listing("rec.1", 0, "apartment", 2, 200_000),
            json!({ "id": "rec.2", "record": "withdrawal", "author": "x", "at": 5 * DAY, "visible_to": "public", "withdraws": "rec.1" }),
            listing("rec.3", DAY, "apartment", 2, 210_000),
            listing("rec.4", DAY, "house", 3, 300_000),
        ]);
        let s = survey(&book, 10 * DAY, 90);
        assert_eq!(s.len(), 2);
        let apt = s.iter().find(|e| e.type_ == "apartment").unwrap();
        assert_eq!((apt.lets.clone(), apt.asking.clone(), apt.homes, apt.vacant), (vec![200_000], vec![210_000], 2, 1));
    }

    #[test]
    fn it_publishes_each_month_and_supersedes_its_last_count() {
        let mut h = Harness::new(&RentPortal, "portal", json!({ "publish_every_days": 30 }));
        let rl = vec![listing("rec.3", DAY, "apartment", 2, 210_000)];
        assert!(h.wake(10 * DAY, records("board", rl)).is_empty(), "not yet a month");
        let out = h.wake(31 * DAY, json!({}));
        assert!(out.iter().any(|p| p.contains("rental_evidence") && p.contains("visible=public")), "{out:?}");
        let out = h.wake(62 * DAY, json!({}));
        assert!(out.iter().any(|p| p.contains("withdraw")), "supersedes the last: {out:?}");
        h.save_and_restore();
    }
}
