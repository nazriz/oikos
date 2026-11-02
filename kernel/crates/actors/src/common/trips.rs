//! What a planner knows of how long its people take to get to a site and back (law 9: all going takes the goers' time,
//! and their trip is part of their working day). It knows it from its own records: each act that took its people
//! somewhere comes back with how long they were on their way (`Outcome.trips`), and the planner keeps that for each site
//! it sent them to. A site it has never sent anyone to is reckoned at the average of those it has, or at nothing until
//! its first trip is back (the first time, a crew finds out). Never the network's timetable: nobody reads that whole.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Trips {
    /// For each site: the seconds a trip there and back took, the last time (a round's trip shared among its sites).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    per_site: BTreeMap<String, i64>,
}

impl Trips {
    /// An act that took its people to `sites` came back (or was refused for want of time, saying how long their trips
    /// would have been): the longest of their trips is the act's, shared evenly among the sites (a round goes by each).
    /// Done with nobody going anywhere: those sites are where the work is done from.
    pub fn record(&mut self, sites: &[String], o: &oikos_sight::Outcome) {
        if sites.is_empty() {
            return;
        }
        let longest = match o.trips.values().copied().max() {
            Some(x) => x,
            None if o.status == oikos_sight::OutcomeStatus::Applied => 0,
            None => return,
        };
        let each = (longest + sites.len() as i64 - 1) / sites.len() as i64;
        for s in sites {
            self.per_site.insert(s.clone(), each);
        }
    }

    /// The seconds a trip to `site` and back is reckoned at: as last time, else the average of the sites known, else none.
    pub fn of(&self, site: &str) -> i64 {
        if let Some(x) = self.per_site.get(site) {
            return *x;
        }
        if self.per_site.is_empty() {
            return 0;
        }
        self.per_site.values().sum::<i64>() / self.per_site.len() as i64
    }
}
