//! utility.water and utility.energy: a water corporation and an energy retailer (docs/behaviour/utilities.md;
//! docs/design/world-expansion.md 6.1). Ported from participants/src/behaviour/utilities.ts (water 0.3.0, energy
//! 0.4.0) to Rust; the version strings are the TS manifests'.
//!
//! Water is physics: each day the corporation draws what the town uses from the river (a field), and when the river
//! can't give it, it says so (restrictions). Energy is bought from the grid (the outside) and supplied. Both bill: water
//! the owners of homes, by round; energy its customers, by round.
//!
//! **What a successor reads from the file** (bug hunt 2026-10-17, finding 2). Billing rounds are marked on the bills
//! themselves (`data.round`, the date the round fell due), so the next round is that date plus the order's rhythm and a
//! home already billed in a round is not billed again; the meter a home was last billed at is on its last bill
//! (`read_litres`); each meter reading is written into a meter round of the corporation's own (`meter_round`, to
//! itself), so a successor's round of readings goes only to the homes not read since it began; whether restrictions
//! stand is the latest of its own restriction notices; an energy customer's last bill is on the bill (`until`); orders
//! to the grid not yet delivered are its own `order` papers without a delivery note. In memory remain the caches of
//! papers sent and not yet seen back, the day last drawn for (a day's draw not made is not made up), a reader who is out,
//! and the units the network has supplied that are not yet taken from stock (`owed`).
//!
//! **Wrong assumption fixed (docs/risks.md WM-12, "use does not respond to anything").** (1) Each publishes its tariff
//! (`utility_tariff`, public: the unit price and the standing charge, and how often it bills), where before it was only
//! in the bills; those who use the service can read it. (2) Use responds to the price and to a restriction in the part
//! the utility itself reckons: `price_elasticity_bps` (the share by which use falls for each 100% rise of the price
//! over `reference_price_*`, Dalhuisen et al. 2003, a meta-analysis of residential water price elasticities, mean about
//! -0.4; Espey 1997; to confirm), and `restriction_cut_bps` (by how much use falls while restrictions stand: a
//! published restriction asks households to use less; Melbourne's 2007-09 stage 3 and 3a restrictions saw use fall by a
//! fifth or more: Water Services Association of Australia / Melbourne Water reports; to confirm). The defaults are no
//! response, so no profile's outcome changes until a profile gives its figures with their source. **Still not
//! answered:** the households' own use is physics in the world (the meter rises with those in the home) and citizens do
//! not read the tariff or a restriction; disconnection and hardship; who pays the bill is still the owner, not law data.
//!
//! **Compliance coins (PB-16).** The retailer answers a customer asking for a wrong bill to be put right, and a
//! tribunal's order, as the TS `Respondent` (lane D's) does: by drawing at the profile's rates. Here, where its own
//! books show the bill was wrong, it puts it right: an energy retailer is obliged to refund an overcharge it has found
//! (Australia: National Energy Retail Rules r.21; UK: Ofgem standards of conduct; to confirm) so there is no coin for
//! the cause the books state; the coin remains only where the books are silent (`grant_bps`). The `Respondent` is lane
//! D's (`finance::frictions`); the retailer's books answer it through `BillTruth`; the order to the grid is C2's
//! `market::trade::order`.
//!
//! Decided fresh: bills fall on the round's own date (a calendar, not drifting by the lateness of the wake); first wake
//! is spread by a hash of the participant id.

use crate::common::{
    addressed_to, cents, data, filed_before, go_see, money_words, own_account, variable_today, visited,
    work::ReportOf, work::Routine, work::WorkOrder, Book, Fields, Part, StandingWork, DAY, VISIT_MAX,
};
use crate::finance::frictions::{Answerer, Matter, Respondent, Truth};
use crate::market::trade::{self, Ordering};
use crate::offices::police::{param, spread};
use crate::steps::{arg, because, call, say, text, Done, Plan, Say, Step, Stepper, Visible};
use crate::{Actor, Ctx, Cx, Kind, Picture};
use oikos_rules::forms;
use oikos_rules::slip::{slip, SlipOptions};
use oikos_sight::{LookRequest, Record, Seen};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

pub struct Water;
pub struct Energy;

/// Price response as a share of use in basis points: use falls by `elasticity_bps` of the rise over the reference price
/// (a fall of 4000 bps for a rise of 100%), within 0 and twice the reference use. No reference price, no response.
fn price_factor_bps(price: i64, reference: i64, elasticity_bps: i64) -> i64 {
    if reference <= 0 || elasticity_bps == 0 {
        return 10_000;
    }
    let change = (price - reference) as i128 * elasticity_bps as i128 / reference as i128;
    (10_000 - change).clamp(0, 20_000) as i64
}

/// A tariff as a public notice: unit price and standing charge, so that whoever uses the service can read it.
fn tariff_step<T>(me: &str, book: &Book, service: &str, unit: &str, price: i64, standing: i64, standing_per: &str, every_days: i64, cx: &Cx) -> Option<Step<T>> {
    let latest = book.open("utility_tariff").filter(|r| r.speaks_for.as_deref() == Some(me) && data(r).s("service") == Some(service)).max_by_key(|r| r.at);
    if latest.is_some_and(|r| data(r).i("price_per_unit") == Some(price) && data(r).i("standing_charge") == Some(standing)) {
        return None;
    }
    let w = &cx.ctx.world;
    Some(because(
        format!("Our {service} tariff {} on file: publishing it for those who use the service.", if latest.is_some() { "has changed from the one" } else { "is not" }),
        vec![say(
            "utility_tariff",
            &format!("{service} tariff: {} a {unit}; standing charge {} {standing_per}; billed every {every_days} days.", money_words(price, w), money_words(standing, w)),
            Say { visible: Some(Visible::Public), data: Some(json!({ "service": service, "unit": unit, "price_per_unit": price, "standing_charge": standing, "standing_per": standing_per, "bill_every_days": every_days })), ..Default::default() },
        )],
    ))
}

/// The date the next round of bills falls due: the latest round on the bills we have sent plus the rhythm, or the
/// standing order's start plus the rhythm if the order is newer; with neither, one rhythm from the start.
fn next_round(last: Option<i64>, order: Option<&WorkOrder>, every: i64) -> i64 {
    last.unwrap_or(0).max(order.map_or(0, |o| o.from)) + every
}

// =========================================================================================================== water

#[derive(Debug, Clone, Serialize, Deserialize)]
struct WaterParams {
    works: String,
    task: String,
    litres_per_person_per_day: i64,
    price_per_kl: i64,
    service_per_quarter: i64,
    bill_every_days: i64,
    roll: String,
    meter: String,
    meters: String,
    read_days: i64,
    part: String,
    restriction_cut_bps: i64,
    restriction_review_days: i64,
    price_elasticity_bps: i64,
    reference_price_per_kl: i64,
}

impl Kind for Water {
    fn name(&self) -> &'static str {
        "utility.water"
    }
    // Ported to Rust. TS 0.3.0: its staff's first round of bills falls due one period after the standing order came into
    // force, and they report the draws, the bills and when the next go out; 0.2.0: bills by its customer roll and the
    // meters it reads; draws what the published population uses; no longer shown the town or the land register.
    fn version(&self) -> &'static str {
        "0.3.0"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/utilities.md"
    }
    fn manifest(&self) -> Value {
        json!({
            "name": self.name(), "version": self.version(), "doc": self.doc(),
            "params": {
                "bill_every_days": param("integer", None, json!(91), Some("days"), false, None),
                "litres_per_person_per_day": param("integer", Some("what a person uses (the world's figure)"), json!(0), None, false, Some("placeholder")),
                "meter": param("string", None, json!("water_used"), None, false, None),
                "meters": param("string", None, json!(""), None, false, None),
                "part": param("string", None, json!(""), None, false, None),
                "price_elasticity_bps": param("integer", Some("by how much use falls for each 100% the price stands over the reference price (Dalhuisen et al. 2003: about 4000; to confirm); 0: use does not respond"), json!(0), Some("bps"), false, Some("placeholder")),
                "price_per_kl": param("integer", Some("the tariff (cents)"), json!(0), None, false, Some("placeholder")),
                "read_days": param("integer", None, json!(21), Some("days"), false, None),
                "reference_price_per_kl": param("integer", Some("the price use was reckoned at (cents a kilolitre); 0: none, so no price response"), json!(0), None, false, Some("placeholder")),
                "restriction_cut_bps": param("integer", Some("by how much use falls while restrictions stand (a published restriction asks for less); 0: none"), json!(0), Some("bps"), false, Some("placeholder")),
                "restriction_review_days": param("integer", Some("while restrictions stand with a cut, how often it draws the usual amount to see whether the river can give it"), json!(7), Some("days"), false, Some("placeholder")),
                "roll": param("string", None, json!("roll"), None, false, None),
                "service_per_quarter": param("integer", None, json!(0), None, false, None),
                "task": param("string", Some("the work that draws a kilolitre"), json!("draw_water"), None, false, Some("placeholder")),
                "works": param("string", Some("the water works (the world must say): where it draws from the river"), json!(""), None, true, None),
            },
            "perceives": [], "state": "none",
            "keeps": [
                { "what": "property_roll", "why": "Its customer roll: the valuer's roll of each property it supplies is given to it, as valuations are given to a rating authority." },
                { "what": "acquisition_notice", "why": "Its customer roll: each notice that land it supplies has changed hands is given to it." },
            ],
            "routines": [
                { "task": "draw_water", "at": "works", "every": 1, "what": "Each day the works draws from the river what the town uses, by the published estimate of how many live in it, and says so when the river cannot give it." },
                { "task": "bill", "at": "works", "every": ["bill_every_days", 91], "what": "Before each round of bills a reader goes round the meters; then each property's owner is sent a bill for the service charge and what its meter shows was used. How often the bills go out is the order's." },
            ],
            "answers": { "office": "the water corporation", "acts": "What it acts on: its roll of properties, each billed by its meter each quarter; and the notices it is given of land changing hands and of building work." },
        })
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        DAY
    }
    fn first_wake(&self, ctx: &Ctx) -> i64 {
        6 * 3600 + spread(&ctx.participant, 3600)
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        let p = WaterParams {
            works: ctx.need("works", "utility.water")?,
            task: ctx.param("task", "draw_water".to_string())?,
            litres_per_person_per_day: ctx.param("litres_per_person_per_day", 0)?,
            price_per_kl: ctx.param("price_per_kl", 0)?,
            service_per_quarter: ctx.param("service_per_quarter", 0)?,
            bill_every_days: ctx.param("bill_every_days", 91)?,
            roll: ctx.param("roll", "roll".to_string())?,
            meter: ctx.param("meter", "water_used".to_string())?,
            meters: ctx.param("meters", String::new())?,
            read_days: ctx.param("read_days", 21)?,
            part: ctx.param("part", String::new())?,
            restriction_cut_bps: ctx.param("restriction_cut_bps", 0)?,
            restriction_review_days: ctx.param("restriction_review_days", 7)?,
            price_elasticity_bps: ctx.param("price_elasticity_bps", 0)?,
            reference_price_per_kl: ctx.param("reference_price_per_kl", 0)?,
        };
        let me = ctx.entity.clone();
        let part = Part::from_param(&p.part);
        Ok(Box::new(Stepper::new(WaterWorks {
            routines: StandingWork::new(&me, part, []),
            position: ctx.position.clone().unwrap_or_default(),
            billing_now: part == Part::Whole,
            me,
            p,
            part,
            book: Book::new(),
            readings: BTreeMap::new(),
            out: false,
            out_since: 0,
            last_day: -1,
            next_bill: 0,
            billing_every: 0,
            report_day: -1,
            restricted_cache: None,
            billed_cache: BTreeSet::new(),
            pending_round: None,
        })))
    }
    fn restore(&self, _: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        Ok(Box::new(Stepper::<WaterWorks>::restore(saved)?))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
enum WaterThen {
    Draw(i64),
}

#[derive(Serialize, Deserialize)]
struct WaterWorks {
    me: String,
    position: String,
    p: WaterParams,
    part: Part,
    book: Book,
    routines: StandingWork,
    /// A cache of what the meter rounds on file say, and of readings just brought back: building -> (litres, when).
    readings: BTreeMap<String, (i64, i64)>,
    out: bool,
    out_since: i64,
    last_day: i64,
    next_bill: i64,
    billing_every: i64,
    billing_now: bool,
    report_day: i64,
    /// Whether restrictions stand, as we last said, until the file shows it (when, standing).
    restricted_cache: Option<(i64, bool)>,
    /// Homes billed in the round under way, until their bills are seen on the file: `home@round`.
    billed_cache: BTreeSet<String>,
    /// Readings just brought back, to be entered in the meter book.
    pending_round: Option<Value>,
}

/// The customer roll as the corporation's papers show it, in the order they were made: each lot, its owner, and the
/// buildings on it that hold dwellings.
struct Roll {
    owner: BTreeMap<String, String>,
    buildings: BTreeMap<String, BTreeSet<String>>,
    lot_of: BTreeMap<String, String>,
}

impl WaterWorks {
    fn roll(&self) -> Roll {
        let me = &self.me;
        let mut papers: Vec<&Arc<Record>> = vec![];
        for k in ["property_roll", "acquisition_notice", "building_notice"] {
            for r in self.book.open(k) {
                let rolled = k != "building_notice" && matches!(&r.body, oikos_sight::RecordBody::Statement { .. }) && data(r).s("lot").is_some();
                let noticed = k == "building_notice" && addressed_to(r).contains(me);
                if rolled || noticed {
                    papers.push(r);
                }
            }
        }
        papers.sort_by(|a, b| a.at.cmp(&b.at).then_with(|| filed_before(&a.id, &b.id)));
        let mut roll = Roll { owner: BTreeMap::new(), buildings: BTreeMap::new(), lot_of: BTreeMap::new() };
        for r in papers {
            let d = data(r);
            let kind = crate::common::kind(r).unwrap_or("");
            let add = |roll: &mut Roll, lot: &str, structure: &str| {
                roll.buildings.entry(lot.to_string()).or_default().insert(structure.to_string());
                roll.lot_of.insert(structure.to_string(), lot.to_string());
            };
            match kind {
                "property_roll" => {
                    let lot = d.s("lot").unwrap_or("");
                    roll.buildings.entry(lot.to_string()).or_default();
                    if let Some(o) = d.s("owner") {
                        roll.owner.insert(lot.to_string(), o.to_string());
                    }
                    for b in d.get("buildings").and_then(Value::as_array).into_iter().flatten() {
                        if b.get("dwellings").is_some_and(crate::common::truthy) {
                            if let Some(s) = b.s("structure") {
                                add(&mut roll, lot, s);
                            }
                        }
                    }
                }
                "acquisition_notice" => {
                    if let (Some(lot), Some(o)) = (d.s("lot"), d.s("owner")) {
                        roll.buildings.entry(lot.to_string()).or_default();
                        roll.owner.insert(lot.to_string(), o.to_string());
                    }
                }
                _ => {
                    // Notice of building work: a new building is connected (whether it is a home, its meter says when first
                    // read); one brought down is taken off.
                    if let Some(rm) = d.s("removes") {
                        if let Some(lot) = roll.lot_of.remove(rm) {
                            if let Some(b) = roll.buildings.get_mut(&lot) {
                                b.remove(rm);
                            }
                        }
                    } else if let (Some(lot), Some(s)) = (d.s("lot"), d.s("structure")) {
                        add(&mut roll, lot, s);
                    }
                }
            }
        }
        roll
    }

    /// Meter rounds on file: what each meter read last, and which are no home.
    fn meter_book(&self) -> (BTreeMap<String, (i64, i64)>, BTreeSet<String>) {
        let mut read = self.readings.clone();
        let mut none = BTreeSet::new();
        for r in self.book.open("meter_round").filter(|r| r.speaks_for.as_deref() == Some(self.me.as_str())) {
            for x in data(r).get("read").and_then(Value::as_array).into_iter().flatten() {
                if let (Some(s), Some(l), Some(at)) = (x.s("structure"), x.i("litres"), x.i("at")) {
                    if read.get(s).is_none_or(|(_, a)| *a <= at) {
                        read.insert(s.to_string(), (l, at));
                    }
                }
            }
            for s in data(r).ids("unmetered") {
                none.insert(s.to_string());
            }
        }
        (read, none)
    }

    fn restricted(&self) -> bool {
        let file = self.book.open("water_restrictions").filter(|r| r.speaks_for.as_deref() == Some(self.me.as_str())).max_by_key(|r| r.at).map(|r| (r.at, data(r).get("lifted").is_none()));
        match (file, self.restricted_cache) {
            (Some(f), Some(c)) => if c.0 > f.0 { c.1 } else { f.1 },
            (Some(f), None) => f.1,
            (None, Some(c)) => c.1,
            (None, None) => false,
        }
    }
}

impl Plan for WaterWorks {
    type Then = WaterThen;

    fn absorb(&mut self, pic: &Picture, _cx: &mut Cx) {
        self.book.absorb(pic);
        // The reader is back: each meter gone to, as it read.
        if !self.p.meters.is_empty() {
            let back = visited(pic, &self.p.meters);
            if !back.is_empty() {
                self.out = false;
            }
            let roll = self.roll();
            let mut read: Vec<Value> = vec![];
            let mut none: Vec<String> = vec![];
            for c in back {
                let Some(st) = &c.structure else { continue };
                if !roll.lot_of.contains_key(&st.structure) {
                    continue;
                }
                match st.variables.as_ref().and_then(|v| v.get(&self.p.meter)) {
                    None => {
                        if st.complete {
                            none.push(st.structure.clone());
                        }
                    }
                    Some(v) => {
                        let litres = variable_today(v, pic.t);
                        self.readings.insert(st.structure.clone(), (litres, pic.t));
                        read.push(json!({ "structure": st.structure, "litres": litres, "at": pic.t }));
                    }
                }
            }
            if !read.is_empty() || !none.is_empty() {
                self.pending_round = Some(json!({ "read": read, "unmetered": none }));
            }
        }
    }

    fn plan(&mut self, pic: &Picture, cx: &mut Cx) -> Vec<Step<WaterThen>> {
        let t = pic.t;
        let me = self.me.clone();
        let mut steps: Vec<Step<WaterThen>> = vec![];
        // The meters read, written into a meter round of our own (to ourselves alone), so that whoever holds the post next knows.
        if let Some(round) = self.pending_round.take() {
            let n = round["read"].as_array().map_or(0, Vec::len);
            steps.push(because(
                format!("The reader is back from {n} meters: entering the readings in the meter book."),
                vec![say("meter_round", &format!("Meter readings: {n} meters read."), Say { to: Some(vec![me.clone()]), visible: Some(Visible::Only(vec![me.clone()])), data: Some(round), ..Default::default() })],
            ));
        }
        let bill_why = format!("Setting the billing round: the meters read and the bills sent every {} days, as a standing work order.", self.p.bill_every_days);
        let routines = [
            Routine { task: &self.p.task, at: &self.p.works, every: DAY, why: "Setting the works' daily draw of what the town uses, as a standing work order." },
            Routine { task: "bill", at: &self.p.works, every: self.p.bill_every_days * DAY, why: &bill_why },
        ];
        steps.extend(self.routines.set::<WaterThen>(&self.book, &routines));
        let billing = self.routines.does(&self.book, "bill", t, self.p.bill_every_days * DAY);
        self.billing_now = billing.is_some();
        let every = billing.as_ref().map_or(self.p.bill_every_days * DAY, |b| b.0);
        self.billing_every = every;
        let last_round = self.book.open("invoice").filter(|r| r.speaks_for.as_deref() == Some(me.as_str()) && data(r).s("service") == Some("water")).filter_map(|r| data(r).i("round")).max();
        // (Under a standing order the round is the order's: the first bills go out one period after it came into force,
        // and a new order starts its own count.)
        self.next_bill = next_round(last_round, billing.as_ref().and_then(|b| b.1.as_ref()), every);

        if let Some(s) = tariff_step(&me, &self.book, "water", "kL", self.p.price_per_kl, self.p.service_per_quarter, "a bill", self.p.bill_every_days, cx) {
            if self.part != Part::Seat {
                steps.push(s);
            }
        }

        // ---- each day: what the town uses, drawn from the river ----
        // (What it uses is what its people use: the statistician's published estimate of how many there are, at the
        // world's figure a head. Nobody counts them at home.)
        let day = t.div_euclid(DAY);
        if day != self.last_day {
            let days = if self.last_day < 0 { 1 } else { day - self.last_day };
            self.last_day = day;
            let estimate = self.book.open("population_estimate").max_by_key(|r| r.at);
            let people = estimate.and_then(|r| data(r).get("residents").and_then(Value::as_f64)).map_or(0, |x| x.max(0.0).floor() as i64);
            // (Only while the draw is ours to make: a day it was not made is not made up.)
            let mut kl = 0;
            if self.routines.does(&self.book, &self.p.task, t, DAY).is_some() {
                // Use responds to the price, and to a restriction while it stands (but once a review period it draws the usual amount, to see whether the river can give it).
                let mut factor = price_factor_bps(self.p.price_per_kl, self.p.reference_price_per_kl, self.p.price_elasticity_bps);
                if self.restricted() && self.p.restriction_cut_bps > 0 {
                    let since = self.book.open("water_restrictions").filter(|r| r.speaks_for.as_deref() == Some(me.as_str()) && data(r).get("since").is_some()).max_by_key(|r| r.at).map_or(day, |r| r.at.div_euclid(DAY));
                    if (day - since).rem_euclid(self.p.restriction_review_days.max(1)) != 0 {
                        factor = (factor as i128 * (10_000 - self.p.restriction_cut_bps).max(0) as i128 / 10_000) as i64;
                    }
                }
                let litres = people as i128 * self.p.litres_per_person_per_day as i128 * days as i128 * factor as i128 / 10_000;
                kl = ((litres + 999) / 1000) as i64;
            }
            if kl > 0 {
                let c = call("work", vec![("task", Some(arg(&self.p.task))), ("units", Some(text(kl.to_string()))), ("at", Some(arg(&self.p.works)))]);
                self.routines.did(&self.p.task, t, kl, &[]);
                let mut st = because(format!("The town of {people} used about {kl} kL of water ({days} day{}): drawing it from the river.", if days > 1 { "s" } else { "" }), vec![c]);
                st.then = Some(WaterThen::Draw(kl));
                steps.push(st);
            }
        }

        // ---- the round's bills: to each home's owner, the service charge and what its meter shows was used ----
        let roll = self.roll();
        let (readings, unmetered) = self.meter_book();
        let acc = own_account(pic);
        if let (true, Some(acc), true) = (t >= self.next_bill, acc.as_ref(), billing.is_some()) {
            let round = self.next_bill;
            let mut homes: Vec<&String> = roll.lot_of.keys().collect();
            homes.sort();
            let billed: BTreeSet<String> = self
                .book
                .open("invoice")
                .filter(|r| r.speaks_for.as_deref() == Some(me.as_str()) && data(r).i("round") == Some(round))
                .filter_map(|r| data(r).s("home").map(String::from))
                .chain(self.billed_cache.iter().filter_map(|k| k.strip_suffix(&format!("@{round}")).map(String::from)))
                .collect();
            for h in homes {
                if unmetered.contains(h) || billed.contains(h) {
                    continue;
                }
                let lot = &roll.lot_of[h];
                let owner = roll.owner.get(lot);
                // (A meter not read this quarter is billed the service charge alone; what it shows is billed when it is read.)
                let read = readings.get(h);
                let prev = self
                    .book
                    .open("invoice")
                    .filter(|r| r.speaks_for.as_deref() == Some(me.as_str()) && data(r).s("home") == Some(h.as_str()))
                    .filter_map(|r| data(r).i("read_litres"))
                    .max()
                    .unwrap_or(0);
                let kl = read.map_or(0, |(l, _)| (l - prev + 500).div_euclid(1000).max(0));
                let Some(owner) = owner else { continue };
                if *owner == me {
                    continue;
                }
                let amount = self.p.service_per_quarter + kl * self.p.price_per_kl;
                self.routines.did("bill", t, 1, &[]);
                self.billed_cache.insert(format!("{h}@{round}"));
                let w = &cx.ctx.world;
                let mut d = json!({ "outcome": { "money": { "to": acc.account, "amount": amount.to_string() } }, "service": "water", "home": h, "kl": kl, "round": round });
                if let Some((l, _)) = read {
                    d["read_litres"] = json!(l);
                }
                steps.push(because(
                    format!("The water bill for {h}: {} service, and {kl} kL at {}.", money_words(self.p.service_per_quarter, w), money_words(self.p.price_per_kl, w)),
                    vec![say(
                        "invoice",
                        &format!("Water bill for {h}: {} (service {}; {kl} kL used).", money_words(amount, w), money_words(self.p.service_per_quarter, w)),
                        Say { to: Some(vec![owner.clone()]), visible: Some(Visible::Only(vec![owner.clone(), me.clone()])), data: Some(d), ..Default::default() },
                    )],
                ));
            }
        }
        // The staff's report to the office, once a day (docs/behaviour/standing-work.md, "The staff's report").
        if billing.is_some() {
            let dated = |x: i64| crate::common::when_words(x, &cx.ctx.world);
            let reads = if self.p.meters.is_empty() { String::new() } else { format!("the meters are read from {} and ", dated((self.next_bill - self.p.read_days * DAY).max(0))) };
            self.routines.note("bill", Some(format!("{reads}the next bills go out on {}", dated(self.next_bill))));
        }
        if self.part == Part::Staff && self.report_day != day {
            self.report_day = day;
            let office = self.position.strip_suffix("-staff").unwrap_or(&self.position).to_string();
            let o = ReportOf { office: &office, from: "the water corporation's staff", tasks: vec![(self.p.task.as_str(), "days' draw", Some("kL")), ("bill", "bills", None)], ..Default::default() };
            steps.extend(self.routines.report::<WaterThen>(&self.book, cx, &o));
        }
        steps
    }

    fn until(&self, pic: &Picture) -> Option<i64> {
        Some((pic.t.div_euclid(DAY) + 1) * DAY + 6 * 3600)
    }

    /// The round of meter readings before each round's bills: the reader goes to a visit's worth of meters at a time, and
    /// to the next when back. Only the meters not read since the round began.
    fn looks(&mut self, pic: &Picture) -> Vec<LookRequest> {
        if self.p.meters.is_empty() || !self.billing_now {
            return vec![];
        }
        let begins = self.next_bill - self.p.read_days * DAY;
        if pic.t < begins {
            return vec![];
        }
        // (A reader who found nothing where they went brings nothing back: after two days, the next sets out.)
        if self.out && pic.t - self.out_since > 2 * DAY {
            self.out = false;
        }
        if self.out {
            return vec![];
        }
        let roll = self.roll();
        let (readings, unmetered) = self.meter_book();
        let to_read: Vec<String> = {
            let mut v: Vec<String> = roll.lot_of.keys().filter(|h| !unmetered.contains(*h) && readings.get(*h).is_none_or(|(_, at)| *at < begins)).cloned().collect();
            v.sort();
            v.truncate(VISIT_MAX);
            v
        };
        if to_read.is_empty() {
            return vec![];
        }
        self.out = true;
        self.out_since = pic.t;
        vec![go_see(&self.p.meters, &to_read)]
    }

    fn then(&mut self, token: &WaterThen, done: Done, cx: &mut Cx) -> Vec<Step<WaterThen>> {
        let WaterThen::Draw(kl) = token;
        let t = cx.t;
        let me = self.me.clone();
        let mut out = vec![];
        let (dry, reason) = match done {
            Done::Outcome(o) if o.status != oikos_sight::OutcomeStatus::Applied => {
                let code = o.refusal.as_ref().map(|r| r.code);
                (code == Some(oikos_contracts::events::RefusalCode::FieldExhausted), format!("the draw was refused ({})", code.map_or("no reason given".to_string(), |c| format!("{c:?}"))))
            }
            Done::NotDone(why) => (false, why.to_string()),
            _ => (false, String::new()),
        };
        let applied = done.applied();
        if !applied {
            self.routines.undid(&self.p.task, *kl);
            self.routines.held_up(&self.p.task, if dry { "the river could not give what the town uses" } else { &reason });
        }
        let restricted = self.restricted();
        if dry && !restricted {
            self.restricted_cache = Some((t, true));
            out.push(because(
                "The river can't give what the town uses: announcing water restrictions.",
                vec![say("water_restrictions", "Water restrictions: the river is too low to supply the town as usual.", Say { visible: Some(Visible::Public), data: Some(json!({ "since": t })), ..Default::default() })],
            ));
        } else if !dry && applied && restricted {
            self.restricted_cache = Some((t, false));
            out.push(because(
                "The river supplies the town again: restrictions lifted.",
                vec![say("water_restrictions", "Water restrictions lifted.", Say { visible: Some(Visible::Public), data: Some(json!({ "lifted": t })), ..Default::default() })],
            ));
        }
        let _ = me;
        out
    }
}

// =========================================================================================================== energy

#[derive(Debug, Clone, Serialize, Deserialize)]
struct EnergyParams {
    depot: String,
    task: String,
    kind: String,
    grid: String,
    units_per_customer_per_day: i64,
    price_per_unit: i64,
    supply_per_day: i64,
    bill_every_days: i64,
    billing_over_bps: i64,
    respond: Value,
    part: String,
    price_elasticity_bps: i64,
    reference_price_per_unit: i64,
}

impl Kind for Energy {
    fn name(&self) -> &'static str {
        "utility.energy"
    }
    // Ported to Rust. TS 0.4.0: how often a bill is wrong is a slip at the rate of the world's table of slips (foundations
    // F7), no longer a parameter; 0.3.1: draws are named for the day and which time that is; 0.3.0: some bills are wrong,
    // and the retailer answers a customer who asks for a wrong bill to be put right from its own record of the bill;
    // 0.2.1: its staff's first bills fall due one period after the standing order came into force; 0.2.0: has an order
    // form of its own for buying from the grid; its staff report what they supplied and billed.
    fn version(&self) -> &'static str {
        "0.4.0"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/utilities.md"
    }
    fn manifest(&self) -> Value {
        let mut issues = forms::group("ORDER");
        issues.extend(forms::group("REMEDY_ANSWER"));
        issues.extend(forms::group("VENUE_ANSWERS"));
        json!({
            "name": self.name(), "version": self.version(), "doc": self.doc(),
            "params": {
                "bill_every_days": param("integer", None, json!(30), Some("days"), false, None),
                "billing_over_bps": param("integer", None, json!(0), Some("bps"), false, None),
                "depot": param("string", Some("where it takes the grid's supply, and supplies from (the world must say)"), json!(""), None, true, None),
                "grid": param("string", Some("whom it buys from (the outside's market)"), json!(""), None, true, Some("placeholder")),
                "kind": param("string", None, json!("energy"), None, false, None),
                "part": param("string", None, json!(""), None, false, None),
                "price_elasticity_bps": param("integer", Some("by how much use falls for each 100% the price stands over the reference price (to confirm); 0: use does not respond"), json!(0), Some("bps"), false, Some("placeholder")),
                "price_per_unit": param("integer", Some("the tariff (cents)"), json!(0), None, false, Some("placeholder")),
                "reference_price_per_unit": param("integer", Some("the price use was reckoned at (cents a unit); 0: none, so no price response"), json!(0), None, false, Some("placeholder")),
                "respond": param("object", Some("how it answers a customer who asks for a bill to be put right"), json!({}), None, false, Some("placeholder")),
                "supply_per_day": param("integer", None, json!(0), None, false, None),
                "task": param("string", Some("the work that supplies a unit, and the resource it uses"), json!("supply_energy"), None, false, Some("placeholder")),
                "units_per_customer_per_day": param("integer", Some("what a household uses (the world's figure)"), json!(0), None, false, Some("placeholder")),
            },
            "perceives": [], "state": "none",
            "issues": issues,
            "routines": [
                { "task": "supply_energy", "at": "depot", "every": 1, "what": "Each day the network supplies what the customers use from what the retailer holds, and more is bought from the grid when it runs below a fortnight's use. Those who ask to be supplied are taken on, and those gone taken off." },
                { "task": "bill", "at": "depot", "every": ["bill_every_days", 30], "what": "Each customer is sent a bill for the supply charge and what they used; one who has gone, their last. How often the bills go out is the order's." },
            ],
            "answers": { "office": "the energy retailer", "acts": "What it acts on: its customers' accounts, each billed each quarter; and notice that a customer has left or has died." },
        })
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        DAY
    }
    fn first_wake(&self, ctx: &Ctx) -> i64 {
        6 * 3600 + spread(&ctx.participant, 3600)
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        let p = EnergyParams {
            depot: ctx.need("depot", "utility.energy")?,
            task: ctx.param("task", "supply_energy".to_string())?,
            kind: ctx.param("kind", "energy".to_string())?,
            grid: ctx.need("grid", "utility.energy")?,
            units_per_customer_per_day: ctx.param("units_per_customer_per_day", 0)?,
            price_per_unit: ctx.param("price_per_unit", 0)?,
            supply_per_day: ctx.param("supply_per_day", 0)?,
            bill_every_days: ctx.param("bill_every_days", 30)?,
            billing_over_bps: ctx.param("billing_over_bps", 0)?,
            respond: ctx.param("respond", json!({}))?,
            part: ctx.param("part", String::new())?,
            price_elasticity_bps: ctx.param("price_elasticity_bps", 0)?,
            reference_price_per_unit: ctx.param("reference_price_per_unit", 0)?,
        };
        let me = ctx.entity.clone();
        let part = Part::from_param(&p.part);
        Ok(Box::new(Stepper::new(Retailer {
            routines: StandingWork::new(&me, part, []),
            position: ctx.position.clone().unwrap_or_default(),
            resp: Respondent::new(&me, &p.respond, vec![], true),
            me,
            p,
            part,
            book: Book::new(),
            last_day: -1,
            owed: 0,
            placing: vec![],
            report_day: -1,
            billed_cache: BTreeSet::new(),
        })))
    }
    fn restore(&self, _: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        Ok(Box::new(Stepper::<Retailer>::restore(saved)?))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
enum EnergyThen {
    /// An order to the grid for this many units, placed at this moment.
    Order(i64),
}

#[derive(Serialize, Deserialize)]
struct Retailer {
    me: String,
    position: String,
    p: EnergyParams,
    part: Part,
    book: Book,
    routines: StandingWork,
    resp: Respondent,
    last_day: i64,
    /// Units the network has supplied that are not yet taken from what we hold (no paper records it).
    owed: i64,
    /// Orders placed and not yet on the file (units, when): the file shows the rest (our `order` papers with no delivery).
    placing: Vec<(i64, i64)>,
    report_day: i64,
    /// Customers billed this round (`who@round`) until their bills are seen on the file.
    billed_cache: BTreeSet<String>,
}

/// An energy customer as our file shows them.
struct Customer {
    billed_to: i64,
    /// When they were last gone (died, left, asked to stop) after they asked to be supplied, if they are.
    gone_at: Option<i64>,
    died: bool,
}

impl Retailer {
    fn use_factor(&self) -> i64 {
        price_factor_bps(self.p.price_per_unit, self.p.reference_price_per_unit, self.p.price_elasticity_bps)
    }
    fn units_a_day(&self) -> i64 {
        (self.p.units_per_customer_per_day as i128 * self.use_factor() as i128 / 10_000) as i64
    }

    fn customers(&self) -> BTreeMap<String, Customer> {
        let me = &self.me;
        let mut gone: BTreeMap<String, (i64, bool)> = BTreeMap::new();
        let mut note = |who: &str, at: i64, died: bool| {
            let e = gone.entry(who.to_string()).or_insert((at, died));
            if at >= e.0 {
                *e = (at, died);
            }
        };
        for r in self.book.all("death_registration") {
            if let Some(d) = data(r).s("deceased") {
                note(d, r.at, true);
            }
        }
        for r in self.book.all("departure") {
            if let Some(w) = &r.speaks_for {
                note(w, r.at, false);
            }
        }
        for r in self.book.open("supply_end").filter(|r| addressed_to(r).contains(me)) {
            if let Some(w) = &r.speaks_for {
                note(w, r.at, false);
            }
        }
        let mut out: BTreeMap<String, Customer> = BTreeMap::new();
        for r in self.book.open("supply_request").filter(|x| addressed_to(x).contains(me)) {
            let (Some(who), Some(_)) = (r.speaks_for.as_ref(), data(r).s("account")) else { continue };
            if out.get(who).is_some_and(|c| c.billed_to >= r.at) {
                continue;
            }
            let billed_to = self
                .book
                .open("invoice")
                .filter(|i| i.speaks_for.as_deref() == Some(me.as_str()) && addressed_to(i).contains(who) && data(i).s("service") == Some("energy"))
                .filter_map(|i| data(i).i("until"))
                .max()
                .unwrap_or(r.at)
                .max(r.at);
            let g = gone.get(who).filter(|(at, _)| *at >= r.at);
            out.insert(who.clone(), Customer { billed_to, gone_at: g.map(|x| x.0), died: g.is_some_and(|x| x.1) });
        }
        // A customer gone and finally billed is no customer; one who died is not billed again.
        out.retain(|_, c| match c.gone_at {
            None => true,
            Some(g) => !c.died && c.billed_to < g,
        });
        out
    }

    /// Units on order and not yet delivered: our own `order` papers without a delivery note, and orders just placed.
    fn on_order(&self, t: i64) -> i64 {
        let delivered: BTreeSet<String> = self.book.all("delivery_note").filter(|n| addressed_to(n).contains(&self.me)).filter_map(|n| data(n).s("order").map(String::from)).collect();
        let filed: i64 = self
            .book
            .open("order")
            .filter(|o| o.speaks_for.as_deref() == Some(self.me.as_str()) && data(o).s("kind") == Some(self.p.kind.as_str()) && !delivered.contains(&o.id) && t - o.at < 30 * DAY)
            .map(|o| data(o).i("quantity").unwrap_or(0))
            .sum();
        filed + self.placing.iter().filter(|(_, at)| t - at < DAY).map(|(q, _)| q).sum::<i64>()
    }
}

impl Plan for Retailer {
    type Then = EnergyThen;

    fn absorb(&mut self, pic: &Picture, _cx: &mut Cx) {
        self.book.absorb(pic);
    }

    fn plan(&mut self, pic: &Picture, cx: &mut Cx) -> Vec<Step<EnergyThen>> {
        let t = pic.t;
        let me = self.me.clone();
        let mut steps: Vec<Step<EnergyThen>> = vec![];
        let acc = own_account(pic);
        let bill_why = format!("Setting the billing round: every customer billed every {} days, as a standing work order.", self.p.bill_every_days);
        let routines = [
            Routine { task: &self.p.task, at: &self.p.depot, every: DAY, why: "Setting the daily supply to our customers, as a standing work order." },
            Routine { task: "bill", at: &self.p.depot, every: self.p.bill_every_days * DAY, why: &bill_why },
        ];
        steps.extend(self.routines.set::<EnergyThen>(&self.book, &routines));
        let supplying = self.routines.does(&self.book, &self.p.task, t, DAY).is_some();
        let billing_by = self.routines.does(&self.book, "bill", t, self.p.bill_every_days * DAY);
        let day = t.div_euclid(DAY);
        let tell = |s: &mut Self, steps: &mut Vec<Step<EnergyThen>>, cx: &Cx| {
            if s.part != Part::Staff || s.report_day == day {
                return;
            }
            s.report_day = day;
            let office = s.position.strip_suffix("-staff").unwrap_or(&s.position).to_string();
            let o = ReportOf { office: &office, from: "the energy retailer's staff", tasks: vec![(s.p.task.as_str(), "days' supply", Some("units")), ("bill", "bills", None)], ..Default::default() };
            steps.extend(s.routines.report::<EnergyThen>(&s.book, cx, &o));
        };
        if self.part != Part::Seat {
            if let Some(s) = tariff_step(&me, &self.book, "energy", &self.p.kind, self.p.price_per_unit, self.p.supply_per_day, "a day", self.p.bill_every_days, cx) {
                steps.push(s);
            }
        }
        if !supplying && billing_by.is_none() {
            tell(self, &mut steps, cx);
            return steps;
        }
        let customers = self.customers();
        let per_day = self.units_a_day();
        // ---- each day: the network supplies what the customers use, from what we hold (bought from the grid) ----
        if day != self.last_day {
            let days = if self.last_day < 0 { 0 } else { day - self.last_day };
            self.last_day = day;
            self.owed += customers.values().filter(|c| c.gone_at.is_none()).count() as i64 * per_day * days;
        }
        let held = pic
            .channels
            .values()
            .find_map(|c| match c {
                Seen::Holdings { holdings } => holdings.iter().find(|x| x.at == self.p.depot && x.kind == self.p.kind).map(|x| cents(x.quantity)),
                _ => None,
            })
            .unwrap_or(0);
        let supply = if supplying { self.owed.min(held) } else { 0 };
        let n = customers.len() as i64;
        if supply > 0 {
            self.owed -= supply;
            steps.push(because(format!("Supplying the {supply} units our {n} customers used."), vec![call("work", vec![("task", Some(arg(&self.p.task))), ("units", Some(text(supply.to_string()))), ("at", Some(arg(&self.p.depot)))])]));
            self.routines.did(&self.p.task, t, supply, &[]);
        }
        // (Below a fortnight's use, with what's on order: a month's from the grid.)
        let on_order = self.on_order(t);
        let fortnight = n * per_day * 14;
        let grid = trade::goods_prices(&self.book, &self.p.grid);
        let (unit, grid_account) = (grid.prices.get(&self.p.kind).copied(), grid.account);
        let low = supplying && held - supply + on_order < fortnight + self.owed;
        if supplying {
            let q = (n * per_day * 30 + self.owed).max(1);
            let holds = format!("{} {} held{}", held - supply, self.p.kind, if on_order > 0 { format!(" and {on_order} on order") } else { String::new() });
            if self.owed > 0 && held - supply <= 0 {
                self.routines.held_up(&self.p.task, &format!("nothing is held to supply from: {} units used by customers are still to be supplied", self.owed));
            }
            let w = &cx.ctx.world;
            let note = if !low {
                holds
            } else if unit.is_none() || grid_account.is_none() {
                format!("{holds}, below a fortnight's use ({fortnight}); the grid's price list is not on file, so nothing was ordered")
            } else if acc.as_ref().is_some_and(|a| a.balance < q * unit.unwrap_or(0)) {
                let u = unit.unwrap_or(0);
                format!("{holds}, below a fortnight's use ({fortnight}); a month's from the grid ({q} at {} each) comes to {} and the account holds {}, so nothing was ordered: a smaller order is the office's to place on its order form", money_words(u, w), money_words(q * u, w), money_words(acc.as_ref().map_or(0, |a| a.balance), w))
            } else {
                format!("{holds}; a month's ({q}) ordered from the grid")
            };
            self.routines.note(&self.p.task, Some(note));
        }
        if let (true, Some(a), Some(u), Some(ga), true) = (supplying, acc.as_ref(), unit, grid_account.as_ref(), low) {
            let q = (n * per_day * 30 + self.owed).max(1);
            if a.balance >= q * u {
                self.placing.push((q, t));
                let mut s = trade::order::<EnergyThen>(
                    &Ordering {
                        me: me.clone(),
                        seller: self.p.grid.clone(),
                        seller_account: ga.clone(),
                        kind: self.p.kind.clone(),
                        quantity: q,
                        unit_price: u,
                        to: None,
                        at: self.p.depot.clone(),
                        from: a.account.clone(),
                        why: format!("Below a fortnight's supply: buying a month's from the grid ({q})."),
                        retry_of: None,
                        for_days: None,
                        terms: None,
                    },
                    cx,
                );
                s.then = Some(EnergyThen::Order(q));
                steps.push(s);
            }
        }
        // ---- the round's bills: each customer, the supply charge and their use; a customer gone, their last ----
        let last_round = self.book.open("invoice").filter(|r| r.speaks_for.as_deref() == Some(me.as_str()) && data(r).s("service") == Some("energy")).filter_map(|r| data(r).i("round")).max();
        let every = billing_by.as_ref().map_or(self.p.bill_every_days * DAY, |b| b.0);
        let next_bill = next_round(last_round, billing_by.as_ref().and_then(|b| b.1.as_ref()), every);
        let billing = billing_by.is_some() && t >= next_bill;
        if let (Some(acc), true) = (acc.as_ref(), billing_by.is_some()) {
            for (who, c) in &customers {
                let gone = c.gone_at.is_some();
                if !billing && !gone {
                    continue;
                }
                let key = format!("{who}@{}", if gone { c.gone_at.unwrap_or(0) } else { next_bill });
                if self.billed_cache.contains(&key) {
                    continue;
                }
                let days = (t - c.billed_to + DAY / 2).div_euclid(DAY).max(0);
                if days == 0 {
                    continue;
                }
                self.billed_cache.insert(key);
                // (A bill may be wrong: an estimated reading entered too high, so more units are billed than were used.)
                let wrong = slip(cx, "publish/invoice/metered_bill", who, &SlipOptions { days, lean: None });
                let base = per_day * days;
                let units = if wrong { (base as i128 * (10_000 + self.p.billing_over_bps) as i128 + 5_000).div_euclid(10_000) as i64 } else { base };
                let amount = days * self.p.supply_per_day + units * self.p.price_per_unit;
                self.routines.did("bill", t, 1, &[]);
                let w = &cx.ctx.world;
                let mut d = json!({ "outcome": { "money": { "to": acc.account, "amount": amount.to_string() } }, "service": "energy", "days": days, "units": units, "until": t, "round": if gone { Value::Null } else { json!(next_bill) } });
                if wrong {
                    d["estimated"] = json!(true);
                }
                if gone {
                    d.as_object_mut().map(|o| o.remove("round"));
                }
                steps.push(because(
                    format!("{who}'s energy bill: {days} days' supply and {units} units."),
                    vec![say(
                        "invoice",
                        &format!("Energy bill: {} ({days} days' supply at {}; {units} units at {}).", money_words(amount, w), money_words(self.p.supply_per_day, w), money_words(self.p.price_per_unit, w)),
                        Say { to: Some(vec![who.clone()]), visible: Some(Visible::Only(vec![who.clone(), me.clone()])), data: Some(d), ..Default::default() },
                    )],
                ));
            }
        }
        if billing_by.is_some() {
            let next = if billing { t.max(next_bill) + every } else { next_bill };
            self.routines.note("bill", Some(format!("the next bills go out on {}", crate::common::when_words(next, &cx.ctx.world))));
        }
        // Customers who ask for a bill to be put right are answered by whoever does the billing, once.
        if billing_by.is_some() {
            if let Some(a) = &acc {
                let mut truth = BillTruth { me: me.clone(), units_a_day: per_day, price_per_unit: self.p.price_per_unit, supply_per_day: self.p.supply_per_day };
                steps.extend(self.resp.steps::<EnergyThen>(cx, &self.book, t, Some(&a.account), a.balance, None, &mut truth));
            }
        }
        tell(self, &mut steps, cx);
        steps
    }

    fn then(&mut self, token: &EnergyThen, done: Done, _cx: &mut Cx) -> Vec<Step<EnergyThen>> {
        let EnergyThen::Order(q) = token;
        // (On order until it's delivered: the order's own acceptance does not clear it; a refused order was never placed.)
        if !done.applied() {
            if let Some(i) = self.placing.iter().position(|(x, _)| x == q) {
                self.placing.remove(i);
            }
        }
        vec![]
    }
}

/// What the retailer's own books say of a bill asked about: what it should have been, from the days it names, against
/// what was billed. Only a bill of ours, to the asker (frictions.ts `truth`).
struct BillTruth {
    me: String,
    units_a_day: i64,
    price_per_unit: i64,
    supply_per_day: i64,
}

impl Answerer<EnergyThen> for BillTruth {
    fn truth(&mut self, m: &Matter, from: &str, book: &Book, _t: i64) -> Option<Truth> {
        if m.matter != "bill" {
            return None;
        }
        let inv = book.get(m.about.as_deref()?)?;
        if crate::common::kind(inv) != Some("invoice") || inv.speaks_for.as_deref() != Some(self.me.as_str()) || !addressed_to(inv).iter().any(|x| x == from) || data(inv).s("service") != Some("energy") {
            return None;
        }
        let who_bill = data(inv);
        let days = who_bill.i("days").unwrap_or(0).max(0);
        let billed = who_bill.get("outcome").and_then(|o| o.get("money")).and_then(|m| m.i("amount")).unwrap_or(0).max(0);
        let right = days * self.supply_per_day + self.units_a_day * days * self.price_per_unit;
        Some(Truth { owed: Some((billed - right).max(0)), done: None, wrong: Some(billed > right) })
    }
}

#[cfg(test)]
mod tests;
