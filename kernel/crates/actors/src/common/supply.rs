//! A workplace's supply and its bills (law 8; risk WM-15; docs/behaviour/utilities.md, "Workplaces"). Shared by every
//! operator of a building whose work draws energy and water by the hour worked (a factory, a shop, the builder's yard,
//! the clinic, the school, the police station, the host's data centre):
//!
//! - **Its supply is asked for, as a household's is.** Where the building it works in has no open connection of its own
//!   for a kind, it writes to the kind's supplier (`supply_request`, as a household does), with what the building draws a
//!   day at full work (the connection's rate) and the most it keeps there (`up_to`: a day of it). The supplier opens the
//!   connection, an act of its own that takes its time; what flows is then what the work used (`up_to`), on the network's
//!   physics. A building it no longer works in: its supplier is asked to stop it (`supply_end`).
//! - **Its bills are paid by whoever pays its other bills**: each utility bill addressed to it (`invoice` with a
//!   `service`, the retailer's from its meter, the water corporation's to the owner or the occupant as the place's law
//!   has it), oldest first, when what is in hand covers it; one it cannot pay yet stays open and is paid when it can. Each
//!   payment is a payment act, and takes its payer's time as any does.
//!
//! Nothing here decides who goes short: that is the network's, the supply in force and the operators' acts.

use crate::common::{addressed_to, data, Book, Fields};
use crate::steps::{because, pay, say, Pay, Say, Step, Visible};
use crate::{Cx, Picture};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::BTreeSet;

/// Whom it asks, and what its building draws a day at full work (a kind with no supplier, or nought, is not asked for).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SupplyParams {
    #[serde(default)]
    pub water: String,
    #[serde(default)]
    pub energy: String,
    /// Litres and kWh a day at full work (the connection's rate, and the most kept).
    #[serde(default)]
    pub water_l: i64,
    #[serde(default)]
    pub energy_kwh: i64,
    /// What an hour of its work costs in energy and water at the place's tariffs (its plant's draw at the published
    /// prices, as the firm reckons it): a part of what making or serving a unit costs.
    #[serde(default)]
    pub cost_per_hour: i64,
}

impl SupplyParams {
    /// What `seconds` of its work cost in energy and water (rounded up).
    pub fn cost_of(&self, seconds: i64) -> i64 {
        (self.cost_per_hour * seconds.max(0) + 3599).div_euclid(3600)
    }
}

impl SupplyParams {
    fn kinds(&self) -> Vec<(&'static str, &str, i64)> {
        [("water", self.water.as_str(), self.water_l), ("energy", self.energy.as_str(), self.energy_kwh)].into_iter().filter(|(_, o, q)| !o.is_empty() && *q > 0).collect()
    }
}

/// What it remembers of its supply: requests made (`<structure>/<kind>`), ends asked for, and bills paid.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Supply {
    #[serde(default)]
    asked: BTreeSet<String>,
    #[serde(default)]
    ended: BTreeSet<String>,
    #[serde(default)]
    paid: BTreeSet<String>,
    /// Each connection's meter when last looked at for what a day draws: (meter, when).
    #[serde(default)]
    read: std::collections::BTreeMap<String, (i64, i64)>,
    /// What each connection was last asked to carry (asked again only for more).
    #[serde(default)]
    raised: std::collections::BTreeMap<String, i64>,
}

/// How many days of what its busiest day drew its supply carries and keeps (as its building was sized: two days at full work).
const KEEP_DAYS: i64 = 2;

/// Its own connections, as its holdings channel shows them (its own, not ones it operates).
fn own(pic: &Picture, me: &str) -> Vec<oikos_sight::ConnectionItem> {
    let mut out = vec![];
    for ch in pic.channels.values() {
        if let oikos_sight::Seen::Holdings { connections, .. } = ch {
            out.extend(connections.iter().filter(|c| c.holder == me && !c.operated).cloned());
        }
    }
    out
}

impl Supply {
    /// Steps for the building it works in (`space`, a workplace space of it; none: it works in none) and the account its
    /// bills are paid from: a supply asked for where it has none; one where it no longer works asked to be stopped.
    pub fn ask<T>(&mut self, pic: &Picture, me: &str, space: Option<&str>, account: &str, p: &SupplyParams) -> Vec<Step<T>> {
        let mut steps = vec![];
        let here = space.map(|s| crate::common::structure_of(s).to_string());
        let mine = own(pic, me);
        for c in mine.iter().filter(|c| !c.closed && c.kind != "wastewater" && here.as_deref() != Some(c.at.as_str())) {
            let office = if c.kind == "energy" { &p.energy } else { &p.water };
            if office.is_empty() || !self.ended.insert(c.id.to_string()) {
                continue;
            }
            steps.push(because(
                format!("We no longer work at {}: asking for its {} to be stopped.", c.at, c.kind),
                vec![say("supply_end", &format!("Please stop the {} supply at {}: we no longer work there.", c.kind, c.at), Say { to: Some(vec![office.clone()]), visible: Some(Visible::Only(vec![me.to_string(), office.clone()])), data: Some(json!({ "connection": c.id, "kind": c.kind })), ..Default::default() })],
            ));
        }
        let (Some(space), Some(here)) = (space, here) else { return steps };
        // (What its work drew a day, from its own meters, read each day: where two days of its busiest are more than its
        // supply carries, it asks its supplier for a supply of that (a business asks its utility for a larger supply; the
        // operator sets it, its own act). Its work can outrun the building's sizing: its systems' work draws there as its
        // people's does, and the building was sized on its people at a working day.)
        for c in mine.iter().filter(|c| !c.closed && c.at == here && (c.kind == "energy" || c.kind == "water")) {
            let Some(m) = c.meter.map(crate::common::cents) else { continue };
            match self.read.get(c.id.as_str()).copied() {
                Some((was, at)) if pic.t - at >= crate::DAY => {
                    let day = ((m - was).max(0) * crate::DAY + (pic.t - at) - 1).div_euclid(pic.t - at);
                    self.read.insert(c.id.to_string(), (m, pic.t));
                    let want = day * KEEP_DAYS;
                    let office = if c.kind == "energy" { &p.energy } else { &p.water };
                    if want > c.rate.max(self.raised.get(c.id.as_str()).copied().unwrap_or(0)) && !office.is_empty() {
                        self.raised.insert(c.id.to_string(), want);
                        steps.push(because(
                            format!("Our work at {here} drew {day} {} in a day: asking for our supply to be {want}, two days of it.", c.kind),
                            vec![say(
                                "supply_request",
                                &format!("Supply request: {want} a day of {} at our workplace at {here}, on our connection {}.", c.kind, c.id),
                                Say { to: Some(vec![office.clone()]), visible: Some(Visible::Only(vec![me.to_string(), office.clone()])), data: Some(json!({ "account": account, "home": space, "kind": c.kind, "connection": c.id, "rate": want, "up_to": want })), ..Default::default() },
                            )],
                        ));
                    }
                }
                Some(_) => {}
                None => {
                    self.read.insert(c.id.to_string(), (m, pic.t));
                }
            }
        }
        for (kind, office, day) in p.kinds() {
            if mine.iter().any(|c| c.kind == kind && c.at == here && !c.closed) || !self.asked.insert(format!("{here}/{kind}")) {
                continue;
            }
            steps.push(because(
                format!("Our work at {here} draws {kind}: asking to be supplied, at {day} a day at full work."),
                vec![say(
                    "supply_request",
                    &format!("Supply request: {kind} for our workplace at {here}."),
                    Say { to: Some(vec![office.to_string()]), visible: Some(Visible::Only(vec![me.to_string(), office.to_string()])), data: Some(json!({ "account": account, "home": space, "kind": kind, "rate": day, "up_to": day })), ..Default::default() },
                )],
            ));
        }
        steps
    }

    /// Utility bills addressed to it, each paid from `account` when `in_hand` covers it, oldest first (`in_hand` is
    /// lowered by what is paid).
    pub fn pay<T>(&mut self, book: &Book, me: &str, account: &str, in_hand: &mut i64, cx: &Cx) -> Vec<Step<T>> {
        let mut steps = vec![];
        let mut open: Vec<_> = book.open("invoice").filter(|r| data(r).s("service").is_some() && addressed_to(r).iter().any(|x| *x == me) && !self.paid.contains(r.id.as_str())).cloned().collect();
        open.sort_by(|a, b| a.at.cmp(&b.at).then_with(|| crate::common::filed_before(&a.id, &b.id)));
        for inv in open {
            let money = data(&inv).get("outcome").and_then(|o| o.get("money")).cloned();
            let amount = money.as_ref().and_then(|m| m.get("amount")).and_then(crate::papers::lenient::whole).unwrap_or(0);
            let to = money.as_ref().and_then(|m| m.get("to")).and_then(|x| x.as_str()).unwrap_or("").to_string();
            if amount <= 0 || to.is_empty() {
                self.paid.insert(inv.id.to_string()); // nothing to pay by
                continue;
            }
            if *in_hand < amount {
                continue; // not yet
            }
            *in_hand -= amount;
            self.paid.insert(inv.id.to_string());
            let service = data(&inv).s("service").unwrap_or("utility").to_string();
            steps.push(because(
                format!("Paying our {service} bill."),
                vec![pay(&to, amount, Pay { from: Some(account.to_string()), for_: Some(format!("Paying the {service} bill.")), settles: Some(inv.id.to_string()), ..Default::default() }, cx)],
            ));
        }
        steps
    }

    /// How many of its utility bills it has not paid (for a report or a test).
    pub fn unpaid(&self, book: &Book, me: &str) -> usize {
        book.open("invoice").filter(|r| data(r).s("service").is_some() && addressed_to(r).iter().any(|x| *x == me) && !self.paid.contains(r.id.as_str())).count()
    }
}
