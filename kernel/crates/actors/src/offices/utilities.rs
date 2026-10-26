//! utility.water and utility.energy: a water corporation and an energy retailer (docs/behaviour/utilities.md;
//! docs/design/world-expansion.md 6.1; docs/design/foundations-2.md section 2, law 8). Ported from
//! participants/src/behaviour/utilities.ts (water 0.3.0, energy 0.4.0); rewritten at foundations-2 C4 (water 0.4.0,
//! energy 0.5.0) for the network.
//!
//! **What flows is physics, not the utility's reckoning** (law 8). Each operates its network (world.network): its
//! supply's holding at the works or the substation feeds a tree of mains and services out to the homes, and the kernel
//! settles every connection by the network's physics. What a home uses is what its household sets its connection to;
//! the utility sees what it delivered on its meters. So the water corporation draws from the river what keeps its store
//! full (no assumed use a head), treats what its sewer brings back and puts it on the land at the works; the energy
//! retailer buys from the grid what its meters say the town is using. Neither shares anything out: who goes short is
//! where they are on the network and what the operator does (closing a connection, a rotation), never a rule here.
//!
//! **Connections are the operator's acts.** A household that takes up a home asks to be supplied (`supply_request`, with
//! the kind and the rate it will use); the operator opens a connection on the home's node (`n-<structure>`), and closes
//! it when the household leaves, dies or asks to stop (`supply_end`). The connections on its network, with the meters it
//! reads from afar, and its links are its own register (its holdings channel: declared `keeps: connections`).
//!
//! **Bills from meters.** Water meters are on the premises: before each round a reader goes round them (a visit, which
//! takes the corporation's time) and the bill is the service charge and what the meter moved since the last bill. Whom
//! the water bill goes to is the place's law (`bill_to`: the property's `owner`, by the roll, or the `occupant`, the
//! connection's own user: law data per profile, WM-12). Energy meters are read from afar: each customer is billed for
//! its days and what its meter moved.
//!
//! **What a successor reads from the file** (bug hunt 2026-10-17, finding 2), as before: rounds on the bills, the reading
//! billed at (`read_litres`, `read_to`), the meter rounds, the restriction notices, the orders without a delivery note.

use crate::common::{
    addressed_to, cents, data, filed_before, go_see, money_words, own_account, visited, work::ReportOf, work::Routine, work::WorkOrder, Book, Fields, Part, StandingWork, DAY, VISIT_MAX,
};
use crate::finance::frictions::{Answerer, Matter, Respondent, Truth};
use crate::market::trade::{self, Ordering};
use crate::offices::police::{param, spread};
use crate::steps::{arg, because, call, say, text, Done, Plan, Say, Step, Stepper, Visible};
use crate::{Actor, Ctx, Cx, Kind, Picture};
use oikos_rules::forms;
use oikos_rules::slip::{slip, SlipOptions};
use oikos_sight::{ConnectionItem, LinkItem, LookRequest, Record, Seen};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

/// The TS modules' manifests, the referee until the cut-over: a parameter whose description the TS module wrote is
/// taken from its file as written (the code writes no currency word of its own).
const WATER_TS: &str = include_str!("../../../../../participants/manifests/utility.water.json");
const ENERGY_TS: &str = include_str!("../../../../../participants/manifests/utility.energy.json");
fn ts_param(manifest: &str, name: &str) -> Value {
    serde_json::from_str::<Value>(manifest).ok().map(|m| m["params"][name].clone()).unwrap_or(Value::Null)
}

pub struct Water;
pub struct Energy;

/// The network as its operator's instruments show it: the connections on it (with the meters it reads from afar) and
/// its links.
fn network(pic: &Picture) -> (Vec<&ConnectionItem>, Vec<&LinkItem>) {
    let mut c = vec![];
    let mut l = vec![];
    for ch in pic.channels.values() {
        if let Seen::Holdings { connections, links, .. } = ch {
            c.extend(connections.iter());
            l.extend(links.iter());
        }
    }
    (c, l)
}

/// What the entity holds of a kind at a place.
fn held(pic: &Picture, at: &str, kind: &str) -> i64 {
    trade::held(pic, at, kind)
}

/// The node a structure is served at, if the network reaches it (a link of the operator's ends there).
fn node_of(links: &[&LinkItem], structure: &str) -> Option<String> {
    let n = format!("n-{structure}");
    links.iter().any(|l| l.to == n || l.from == n).then_some(n)
}

/// Who has gone (died, left, asked to stop) since when, as the file shows: person -> (when, died).
fn gone_of(book: &Book, me: &str) -> BTreeMap<String, (i64, bool)> {
    let mut gone: BTreeMap<String, (i64, bool)> = BTreeMap::new();
    let mut note = |who: &str, at: i64, died: bool| {
        let e = gone.entry(who.to_string()).or_insert((at, died));
        if at >= e.0 {
            *e = (at, died);
        }
    };
    for r in book.all("death_registration") {
        if let Some(d) = data(r).s("deceased") {
            note(d, r.at, true);
        }
    }
    for r in book.all("departure") {
        if let Some(w) = &r.speaks_for {
            note(w, r.at, false);
        }
    }
    for r in book.open("supply_end").filter(|r| addressed_to(r).iter().any(|a| a == me)) {
        if let Some(w) = &r.speaks_for {
            note(w, r.at, false);
        }
    }
    gone
}

/// Connections to open and to close: each request since the requester's last going whose home has none of ours for
/// them yet; each open connection of a requester gone since it was opened. Steps for both.
fn connect_steps<T>(book: &Book, me: &str, kinds: &[(&str, Option<&str>, Option<i64>)], conns: &[&ConnectionItem], links: &[&LinkItem], cache: &mut BTreeSet<String>) -> Vec<Step<T>> {
    let gone = gone_of(book, me);
    let mut out = vec![];
    for r in book.open("supply_request").filter(|r| addressed_to(r).iter().any(|a| a == me)) {
        let Some(who) = r.speaks_for else { continue };
        if gone.get(who.as_str()).is_some_and(|(at, _)| *at >= r.at) {
            continue;
        }
        let d = data(r);
        let Some(home) = d.s("home") else { continue };
        let structure = crate::common::structure_of(home).to_string();
        let Some(node) = node_of(links, &structure) else { continue };
        // (A request names the kind it is for, the office's first: water, which brings the sewer with it; one that names
        // none is for energy, as the requests were before the network.)
        if d.s("kind").unwrap_or("energy") != kinds[0].0 {
            continue;
        }
        for (kind, uses, fixed) in kinds {
            let key = format!("{who}@{structure}/{kind}");
            if cache.contains(&key) || conns.iter().any(|c| c.holder == who && c.at == structure && c.kind == *kind && !c.closed) {
                continue;
            }
            cache.insert(key);
            let rate = fixed.unwrap_or_else(|| d.i("rate").unwrap_or(0).max(0));
            let mut args = vec![("op", Some(arg("open"))), ("kind", Some(arg(kind))), ("node", Some(arg(&node))), ("to", Some(arg(&who))), ("at", Some(arg(&structure))), ("rate", Some(text(rate.to_string())))];
            if let Some(u) = uses {
                args.push(("uses", Some(arg(u))));
            }
            out.push(because(format!("{who} asks to be supplied at {structure}: connecting their {kind}."), vec![call("connection", args)]));
        }
    }
    for c in conns.iter().filter(|c| !c.closed && kinds.iter().any(|k| k.0 == c.kind)) {
        let Some((at, died)) = gone.get(c.holder.as_str()) else { continue };
        let opened = book.all("supply_request").filter(|r| r.speaks_for.as_deref() == Some(c.holder.as_str())).map(|r| r.at).max().unwrap_or(-1);
        if *at < opened || !cache.insert(format!("close:{}", c.id)) {
            continue;
        }
        out.push(because(
            format!("{} has {}: disconnecting {} at {}.", c.holder, if *died { "died" } else { "gone, or asked to stop" }, c.kind, c.at),
            vec![call("connection", vec![("op", Some(arg("close"))), ("connection", Some(arg(&c.id)))])],
        ));
    }
    out
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
    treat_task: String,
    storage: i64,
    price_per_kl: i64,
    service_per_quarter: i64,
    bill_every_days: i64,
    bill_to: String,
    roll: String,
    meters: String,
    read_days: i64,
    part: String,
}

impl Kind for Water {
    fn name(&self) -> &'static str {
        "utility.water"
    }
    // 0.4.0 (foundations-2 C4, law 8): the network's operator; draws what keeps its store full, treats what the sewer
    // brings back, connects and disconnects households on request and at their going, bills from the meters it reads
    // (to the owner or the occupant, as the place's law has it). Ported from TS 0.3.0.
    fn version(&self) -> &'static str {
        "0.4.0"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/utilities.md"
    }
    fn manifest(&self) -> Value {
        json!({
            "name": self.name(), "version": self.version(), "doc": self.doc(),
            "params": {
                "bill_every_days": param("integer", None, json!(91), Some("days"), false, None),
                "bill_to": param("string", Some("whom the water bill goes to: the property's owner (by the roll) or the occupant (the connection's user), as the place's law has it"), json!("owner"), None, false, Some("law data: the profile's utilities.water.bill_to (WM-12)")),
                "meters": param("string", None, json!(""), None, false, None),
                "part": param("string", None, json!(""), None, false, None),
                "price_per_kl": ts_param(WATER_TS, "price_per_kl"),
                "read_days": param("integer", None, json!(21), Some("days"), false, None),
                "roll": param("string", None, json!("roll"), None, false, None),
                "service_per_quarter": param("integer", None, json!(0), None, false, None),
                "storage": param("integer", Some("what the works' store holds when full (litres): what the daily draw keeps it at"), json!(0), None, false, Some("placeholder")),
                "task": param("string", Some("the work that draws a kilolitre"), json!("draw_water"), None, false, Some("placeholder")),
                "treat_task": param("string", Some("the work that treats a kilolitre of wastewater and puts it back on the land"), json!("treat_wastewater"), None, false, Some("placeholder")),
                "works": param("string", Some("the water works (the world must say): where it draws from the river"), json!(""), None, true, None),
            },
            "perceives": [], "state": "none",
            "keeps": [
                { "what": "property_roll", "why": "Its customer roll: the valuer's roll of each property it supplies is given to it, as valuations are given to a rating authority." },
                { "what": "acquisition_notice", "why": "Its customer roll: each notice that land it supplies has changed hands is given to it." },
                { "what": "connections", "why": "Its network: the mains, services and connections it operates, with what its instruments read of them, are its own works and records (foundations-2 C3)." },
            ],
            "routines": [
                { "task": "draw_water", "at": "works", "every": 1, "what": "Each day the works draws from the river what keeps its store full, and says so when the river cannot give it; and treats what the sewer brought back." },
                { "task": "bill", "at": "works", "every": ["bill_every_days", 91], "what": "Before each round of bills a reader goes round the meters; then each bill is sent for the service charge and what its meter shows was used. How often the bills go out is the order's." },
            ],
            "answers": { "office": "the water corporation", "acts": "What it acts on: its roll of properties and its connections, each billed by its meter each quarter; a household's request to be supplied, and notice that it has gone; and the notices it is given of land changing hands and of building work." },
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
            treat_task: ctx.param("treat_task", "treat_wastewater".to_string())?,
            storage: ctx.param("storage", 0)?,
            price_per_kl: ctx.param("price_per_kl", 0)?,
            service_per_quarter: ctx.param("service_per_quarter", 0)?,
            bill_every_days: ctx.param("bill_every_days", 91)?,
            bill_to: ctx.param("bill_to", "owner".to_string())?,
            roll: ctx.param("roll", "roll".to_string())?,
            meters: ctx.param("meters", String::new())?,
            read_days: ctx.param("read_days", 21)?,
            part: ctx.param("part", String::new())?,
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
            gone_to: (0, BTreeSet::new()),
            last_day: -1,
            next_bill: 0,
            billing_every: 0,
            report_day: -1,
            restricted_cache: None,
            billed_cache: BTreeSet::new(),
            pending_round: None,
            connecting: BTreeSet::new(),
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
    /// A cache of what the meter rounds on file say, and of readings just brought back: what is billed (a building, or a
    /// connection where the occupant pays) -> (litres, when).
    readings: BTreeMap<String, (i64, i64)>,
    out: bool,
    out_since: i64,
    /// This round's meters gone to (the round's first day, and the structures): each is gone to once a round.
    #[serde(default)]
    gone_to: (i64, BTreeSet<String>),
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
    /// Connections asked to be opened or closed, until they are seen on the network.
    #[serde(default)]
    connecting: BTreeSet<String>,
}

/// The customer roll as the corporation's papers show it, in the order they were made: each lot, its owner, and the
/// buildings on it that hold dwellings.
struct Roll {
    owner: BTreeMap<String, String>,
    buildings: BTreeMap<String, BTreeSet<String>>,
    lot_of: BTreeMap<String, String>,
}

impl WaterWorks {
    fn occupant_pays(&self) -> bool {
        self.p.bill_to == "occupant"
    }

    fn roll(&self) -> Roll {
        let me = &self.me;
        let mut papers: Vec<&Arc<Record>> = vec![];
        for k in ["property_roll", "acquisition_notice", "building_notice"] {
            for r in self.book.open(k) {
                let rolled = k != "building_notice" && matches!(&r.body, oikos_sight::RecordBody::Statement { .. }) && data(r).s("lot").is_some();
                let noticed = k == "building_notice" && addressed_to(r).iter().any(|x| x ==me);
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

    /// Meter rounds on file: what each meter (a building's, or a connection's) read last, and which buildings hold no home.
    fn meter_book(&self) -> (BTreeMap<String, (i64, i64)>, BTreeSet<String>) {
        let mut read = self.readings.clone();
        let mut none = BTreeSet::new();
        for r in self.book.open("meter_round").filter(|r| r.speaks_for.as_deref() == Some(self.me.as_str())) {
            for x in data(r).get("read").and_then(Value::as_array).into_iter().flatten() {
                let key = x.s("connection").or_else(|| x.s("structure"));
                if let (Some(s), Some(l), Some(at)) = (key, x.i("litres"), x.i("at")) {
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
            (Some(f), Some(c)) => {
                if c.0 > f.0 {
                    c.1
                } else {
                    f.1
                }
            }
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
            let mut seen: BTreeSet<String> = BTreeSet::new();
            for c in back {
                let Some(st) = &c.structure else { continue };
                if !roll.lot_of.contains_key(st.structure.as_str()) || !seen.insert(st.structure.to_string()) {
                    continue;
                }
                let water: Vec<&oikos_sight::MeterView> = st.meters.iter().filter(|m| m.kind == "water").collect();
                if st.complete && !st.spaces.iter().any(|s| s.kind == "dwelling") {
                    none.push(st.structure.to_string());
                    continue;
                }
                if self.occupant_pays() {
                    for m in water {
                        let litres = cents(m.reading);
                        self.readings.insert(m.connection.to_string(), (litres, pic.t));
                        read.push(json!({ "connection": m.connection, "structure": st.structure, "litres": litres, "at": pic.t }));
                    }
                } else {
                    let litres: i64 = water.iter().map(|m| cents(m.reading)).sum();
                    self.readings.insert(st.structure.to_string(), (litres, pic.t));
                    read.push(json!({ "structure": st.structure, "litres": litres, "at": pic.t }));
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
        if let Some(round) = self.pending_round.take() {
            let n = round["read"].as_array().map_or(0, Vec::len);
            steps.push(because(
                format!("The reader is back from {n} meters: entering the readings in the meter book."),
                vec![say("meter_round", &format!("Meter readings: {n} meters read."), Say { to: Some(vec![me.clone()]), visible: Some(Visible::Only(vec![me.clone()])), data: Some(round), ..Default::default() })],
            ));
        }
        let bill_why = format!("Setting the billing round: the meters read and the bills sent every {} days, as a standing work order.", self.p.bill_every_days);
        let routines = [
            Routine { task: &self.p.task, at: &self.p.works, every: DAY, why: "Setting the works' daily draw, to keep the store full, as a standing work order." },
            Routine { task: "bill", at: &self.p.works, every: self.p.bill_every_days * DAY, why: &bill_why },
        ];
        steps.extend(self.routines.set::<WaterThen>(&self.book, &routines));
        let billing = self.routines.does(&self.book, "bill", t, self.p.bill_every_days * DAY);
        self.billing_now = billing.is_some();
        let every = billing.as_ref().map_or(self.p.bill_every_days * DAY, |b| b.0);
        self.billing_every = every;
        let last_round = self.book.open("invoice").filter(|r| r.speaks_for.as_deref() == Some(me.as_str()) && data(r).s("service") == Some("water")).filter_map(|r| data(r).i("round")).max();
        self.next_bill = next_round(last_round, billing.as_ref().and_then(|b| b.1.as_ref()), every);

        if let Some(s) = tariff_step(&me, &self.book, "water", "kL", self.p.price_per_kl, self.p.service_per_quarter, "a bill", self.p.bill_every_days, cx) {
            if self.part != Part::Seat {
                steps.push(s);
            }
        }
        // Connections: a household that asks is connected (water, and the sewer), and one gone disconnected.
        let (conns, links) = network(pic);
        if self.part != Part::Seat {
            let kinds = [("water", Some("use_water"), None), ("wastewater", None, Some(1_000_000))];
            steps.extend(connect_steps::<WaterThen>(&self.book, &me, &kinds, &conns, &links, &mut self.connecting));
        }

        // ---- each day: the store kept full from the river, and the sewer's wastewater treated ----
        let day = t.div_euclid(DAY);
        if day != self.last_day {
            self.last_day = day;
            if self.routines.does(&self.book, &self.p.task, t, DAY).is_some() {
                let have = held(pic, &self.p.works, "water");
                let kl = (self.p.storage - have).max(0).div_euclid(1000);
                if kl > 0 {
                    let c = call("work", vec![("task", Some(arg(&self.p.task))), ("units", Some(text(kl.to_string()))), ("at", Some(arg(&self.p.works)))]);
                    self.routines.did(&self.p.task, t, kl, &[]);
                    let mut st = because(format!("The store holds {have} litres of its {}: drawing {kl} kL from the river.", self.p.storage), vec![c]);
                    st.then = Some(WaterThen::Draw(kl));
                    steps.push(st);
                }
                let waste_kl = held(pic, &self.p.works, "wastewater").div_euclid(1000);
                if waste_kl > 0 {
                    steps.push(because(
                        format!("The sewer brought back {waste_kl} kL: treating it, and putting it back on the land."),
                        vec![call("work", vec![("task", Some(arg(&self.p.treat_task))), ("units", Some(text(waste_kl.to_string()))), ("at", Some(arg(&self.p.works)))])],
                    ));
                }
            }
        }

        // ---- the round's bills: the service charge and what each meter shows was used ----
        let roll = self.roll();
        let (readings, unmetered) = self.meter_book();
        let acc = own_account(pic);
        if let (true, Some(acc), true) = (t >= self.next_bill, acc.as_ref(), billing.is_some()) {
            let round = self.next_bill;
            let billed: BTreeSet<String> = self
                .book
                .open("invoice")
                .filter(|r| r.speaks_for.as_deref() == Some(me.as_str()) && data(r).i("round") == Some(round))
                .filter_map(|r| data(r).s("connection").or_else(|| data(r).s("home")).map(String::from))
                .chain(self.billed_cache.iter().filter_map(|k| k.strip_suffix(&format!("@{round}")).map(String::from)))
                .collect();
            // (Whom each bill goes to, and for which meter: the owner of a building on the roll, or the occupant of a connection.)
            let mut payers: Vec<(String, String, String)> = vec![];
            if self.occupant_pays() {
                for c in conns.iter().filter(|c| c.kind == "water" && roll.lot_of.contains_key(c.at.as_str())) {
                    payers.push((c.id.to_string(), c.at.to_string(), c.holder.to_string()));
                }
            } else {
                let mut homes: Vec<&String> = roll.lot_of.keys().collect();
                homes.sort();
                for h in homes {
                    if let Some(o) = roll.owner.get(&roll.lot_of[h]) {
                        payers.push((h.clone(), h.clone(), o.clone()));
                    }
                }
            }
            for (key, home, payer) in payers {
                if unmetered.contains(&home) || billed.contains(&key) || payer == me {
                    continue;
                }
                let read = readings.get(&key);
                let prev = self
                    .book
                    .open("invoice")
                    .filter(|r| r.speaks_for.as_deref() == Some(me.as_str()) && (data(r).s("connection") == Some(key.as_str()) || (data(r).s("connection").is_none() && data(r).s("home") == Some(key.as_str()))))
                    .filter_map(|r| data(r).i("read_litres"))
                    .max()
                    .unwrap_or(0);
                let kl = read.map_or(0, |(l, _)| (l - prev + 500).div_euclid(1000).max(0));
                let amount = self.p.service_per_quarter + kl * self.p.price_per_kl;
                self.routines.did("bill", t, 1, &[]);
                self.billed_cache.insert(format!("{key}@{round}"));
                let w = &cx.ctx.world;
                let mut d = json!({ "outcome": { "money": { "to": acc.account, "amount": amount.to_string() } }, "service": "water", "home": home, "kl": kl, "round": round });
                if self.occupant_pays() {
                    d["connection"] = json!(key);
                }
                if let Some((l, _)) = read {
                    d["read_litres"] = json!(l);
                }
                steps.push(because(
                    format!("The water bill for {home}: {} service, and {kl} kL at {}.", money_words(self.p.service_per_quarter, w), money_words(self.p.price_per_kl, w)),
                    vec![say(
                        "invoice",
                        &format!("Water bill for {home}: {} (service {}; {kl} kL used).", money_words(amount, w), money_words(self.p.service_per_quarter, w)),
                        Say { to: Some(vec![payer.clone()]), visible: Some(Visible::Only(vec![payer.clone(), me.clone()])), data: Some(d), ..Default::default() },
                    )],
                ));
            }
        }
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

    /// The round of meter readings before each round's bills: the reader goes to a visit's worth of buildings at a time,
    /// and to the next when back. Only those not read since the round began.
    fn looks(&mut self, pic: &Picture) -> Vec<LookRequest> {
        if self.p.meters.is_empty() || !self.billing_now {
            return vec![];
        }
        let begins = self.next_bill - self.p.read_days * DAY;
        if pic.t < begins {
            return vec![];
        }
        if self.out && pic.t - self.out_since > 2 * DAY {
            self.out = false;
        }
        if self.out {
            return vec![];
        }
        let roll = self.roll();
        let (readings, unmetered) = self.meter_book();
        if self.gone_to.0 != begins {
            self.gone_to = (begins, BTreeSet::new());
        }
        let gone = &self.gone_to.1;
        let to_read: Vec<String> = {
            let mut v: Vec<String> = roll.lot_of.keys().filter(|h| !unmetered.contains(*h) && !gone.contains(*h) && readings.get(*h).is_none_or(|(_, at)| *at < begins)).cloned().collect();
            v.sort();
            v.truncate(VISIT_MAX);
            v
        };
        if to_read.is_empty() {
            return vec![];
        }
        self.out = true;
        self.out_since = pic.t;
        self.gone_to.1.extend(to_read.iter().cloned());
        vec![go_see(&self.p.meters, &to_read)]
    }

    fn then(&mut self, token: &WaterThen, done: Done, cx: &mut Cx) -> Vec<Step<WaterThen>> {
        let WaterThen::Draw(kl) = token;
        let t = cx.t;
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
            self.routines.held_up(&self.p.task, if dry { "the river could not give what the store needs" } else { &reason });
        }
        let restricted = self.restricted();
        if dry && !restricted {
            self.restricted_cache = Some((t, true));
            out.push(because(
                "The river can't give what the store needs: announcing water restrictions.",
                vec![say("water_restrictions", "Water restrictions: the river is too low to supply the town as usual.", Say { visible: Some(Visible::Public), data: Some(json!({ "since": t })), ..Default::default() })],
            ));
        } else if !dry && applied && restricted {
            self.restricted_cache = Some((t, false));
            out.push(because(
                "The river supplies the town again: restrictions lifted.",
                vec![say("water_restrictions", "Water restrictions lifted.", Say { visible: Some(Visible::Public), data: Some(json!({ "lifted": t })), ..Default::default() })],
            ));
        }
        out
    }
}

// =========================================================================================================== energy

#[derive(Debug, Clone, Serialize, Deserialize)]
struct EnergyParams {
    depot: String,
    kind: String,
    grid: String,
    price_per_unit: i64,
    supply_per_day: i64,
    bill_every_days: i64,
    billing_over_bps: i64,
    respond: Value,
    part: String,
}

impl Kind for Energy {
    fn name(&self) -> &'static str {
        "utility.energy"
    }
    // 0.5.0 (foundations-2 C4, law 8): the network's operator; connects and disconnects households, buys from the grid
    // what its meters say is used, bills each customer from its meter. Ported from TS 0.4.0.
    fn version(&self) -> &'static str {
        "0.5.0"
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
                "price_per_unit": ts_param(ENERGY_TS, "price_per_unit"),
                "respond": param("object", Some("how it answers a customer who asks for a bill to be put right"), json!({}), None, false, Some("placeholder")),
                "supply_per_day": param("integer", None, json!(0), None, false, None),
            },
            "perceives": [], "state": "none",
            "issues": issues,
            "keeps": [
                { "what": "connections", "why": "Its network: the feeders, services and connections it operates, with the meters it reads from afar and what its instruments read of its links, are its own works and records (foundations-2 C3)." },
            ],
            "routines": [
                { "task": "bill", "at": "depot", "every": ["bill_every_days", 30], "what": "Each customer is sent a bill for the supply charge and what their meter shows they used; one who has gone, their last. How often the bills go out is the order's." },
            ],
            "answers": { "office": "the energy retailer", "acts": "What it acts on: its customers' connections, each billed by its meter; a household's request to be supplied; and notice that a customer has left or has died." },
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
            kind: ctx.param("kind", "energy".to_string())?,
            grid: ctx.need("grid", "utility.energy")?,
            price_per_unit: ctx.param("price_per_unit", 0)?,
            supply_per_day: ctx.param("supply_per_day", 0)?,
            bill_every_days: ctx.param("bill_every_days", 30)?,
            billing_over_bps: ctx.param("billing_over_bps", 0)?,
            respond: ctx.param("respond", json!({}))?,
            part: ctx.param("part", String::new())?,
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
            placing: vec![],
            report_day: -1,
            billed_cache: BTreeSet::new(),
            metered: None,
            tripped: BTreeMap::new(),
            connecting: BTreeSet::new(),
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
    /// Orders placed and not yet on the file (units, when): the file shows the rest (our `order` papers with no delivery).
    placing: Vec<(i64, i64)>,
    report_day: i64,
    /// Customers billed this round (`connection@round`) until their bills are seen on the file.
    billed_cache: BTreeSet<String>,
    /// The meters' total when last read, and when: what the town used a day since, which is what is bought for.
    #[serde(default)]
    metered: Option<(i64, i64, i64)>,
    /// When each link was last found tripped.
    #[serde(default)]
    tripped: BTreeMap<String, i64>,
    #[serde(default)]
    connecting: BTreeSet<String>,
}

impl Retailer {
    /// Units on order and not yet delivered: our own `order` papers without a delivery note, and orders just placed.
    fn on_order(&self, t: i64) -> i64 {
        let delivered: BTreeSet<String> = self.book.all("delivery_note").filter(|n| addressed_to(n).iter().any(|x| x == &self.me)).filter_map(|n| data(n).s("order").map(String::from)).collect();
        let filed: i64 = self
            .book
            .open("order")
            .filter(|o| o.speaks_for.as_deref() == Some(self.me.as_str()) && data(o).s("kind") == Some(self.p.kind.as_str()) && !delivered.contains(o.id.as_str()) && t - o.at < 30 * DAY)
            .map(|o| data(o).i("quantity").unwrap_or(0))
            .sum();
        filed + self.placing.iter().filter(|(_, at)| t - at < DAY).map(|(q, _)| q).sum::<i64>()
    }
}

impl Retailer {
    /// The operator's acts on its network (C3b): a link found tripped is reclosed by a crew; one that trips again within a
    /// week, with feeders under it, has those feeders put on a rotation (each off an hour in turn: a standing schedule,
    /// declared once), except a feeder that serves a connection on the operator's protected list. Nothing else is shared
    /// out: what each feeder carries is the network's.
    fn operate(&mut self, t: i64, conns: &[&ConnectionItem], links: &[&LinkItem]) -> Vec<Step<EnergyThen>> {
        let mut out = vec![];
        let protected: BTreeSet<String> = self.book.open("protected_customers").filter(|r| r.speaks_for.as_deref() == Some(self.me.as_str())).flat_map(|r| data(r).ids("connections").into_iter().map(String::from).collect::<Vec<_>>()).collect();
        let day = t.div_euclid(DAY);
        for l in links.iter().filter(|l| l.tripped) {
            // (Once a day for a link: the crew is sent, and until it is back the link still shows tripped.)
            if self.tripped.get(l.id.as_str()).is_some_and(|at| at.div_euclid(DAY) == day) {
                continue;
            }
            let again = self.tripped.get(l.id.as_str()).is_some_and(|at| t - at < 7 * DAY);
            self.tripped.insert(l.id.to_string(), t);
            let feeders: Vec<&&LinkItem> = links.iter().filter(|x| x.from == l.to && x.rotation.is_none()).collect();
            if again && feeders.len() >= 2 {
                // (What each feeder serves: the nodes under it.)
                let under = |root: &str| -> BTreeSet<String> {
                    let mut seen: BTreeSet<String> = BTreeSet::from([root.to_string()]);
                    let mut todo = vec![root.to_string()];
                    while let Some(n) = todo.pop() {
                        for x in links.iter().filter(|x| x.from == n) {
                            if seen.insert(x.to.to_string()) {
                                todo.push(x.to.to_string());
                            }
                        }
                    }
                    seen
                };
                let shed: Vec<&&&LinkItem> = feeders.iter().filter(|f| { let nodes = under(&f.to); !conns.iter().any(|c| protected.contains(c.id.as_str()) && nodes.contains(c.node.as_str())) }).collect();
                let k = shed.len() as i64;
                let hour = (t.div_euclid(3600) + 1) * 3600;
                for (i, f) in shed.iter().enumerate() {
                    out.push(because(
                        format!("{} tripped again within the week: putting feeder {} on a rotation, off an hour in every {k}.", l.id, f.id),
                        vec![call("link", vec![("link", Some(arg(&f.id))), ("op", Some(arg("rotate"))), ("every", Some(text(format!("{k} hours")))), ("off", Some(text("1 hour"))), ("from", Some(text(format!("{} seconds", hour + i as i64 * 3600 - t))))])],
                    ));
                }
            }
            out.push(because(format!("{} has tripped: a crew recloses it.", l.id), vec![call("link", vec![("link", Some(arg(&l.id))), ("op", Some(arg("reclose")))])]));
        }
        out
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
        let routines = [Routine { task: "bill", at: &self.p.depot, every: self.p.bill_every_days * DAY, why: &bill_why }];
        steps.extend(self.routines.set::<EnergyThen>(&self.book, &routines));
        let billing_by = self.routines.does(&self.book, "bill", t, self.p.bill_every_days * DAY);
        let day = t.div_euclid(DAY);
        let tell = |s: &mut Self, steps: &mut Vec<Step<EnergyThen>>, cx: &Cx| {
            if s.part != Part::Staff || s.report_day == day {
                return;
            }
            s.report_day = day;
            let office = s.position.strip_suffix("-staff").unwrap_or(&s.position).to_string();
            let o = ReportOf { office: &office, from: "the energy retailer's staff", tasks: vec![("bill", "bills", None)], ..Default::default() };
            steps.extend(s.routines.report::<EnergyThen>(&s.book, cx, &o));
        };
        if self.part != Part::Seat {
            if let Some(s) = tariff_step(&me, &self.book, "energy", &self.p.kind, self.p.price_per_unit, self.p.supply_per_day, "a day", self.p.bill_every_days, cx) {
                steps.push(s);
            }
        }
        let (conns, links) = network(pic);
        let kind = self.p.kind.clone();
        if self.part != Part::Seat {
            let kinds = [(kind.as_str(), Some("use_energy"), None)];
            steps.extend(connect_steps::<EnergyThen>(&self.book, &me, &kinds, &conns, &links, &mut self.connecting));
        }
        if self.part != Part::Seat {
            steps.extend(self.operate(t, &conns, &links));
        }
        let mine: Vec<&ConnectionItem> = conns.iter().copied().filter(|c| c.kind == kind).collect();
        // ---- what the town uses, from the meters: bought from the grid when the stock runs low ----
        let total: i64 = mine.iter().filter_map(|c| c.meter).map(cents).sum();
        let per_day = match self.metered {
            Some((was, at, _)) if t - at >= DAY => {
                let r = ((total - was).max(0) * DAY).div_euclid((t - at).max(1));
                self.metered = Some((total, t, r));
                r
            }
            Some((_, _, r)) => r,
            None => {
                // (At first, what the customers ask for a day.)
                let r: i64 = mine.iter().filter(|c| !c.closed).map(|c| c.rate).sum();
                self.metered = Some((total, t, r));
                r
            }
        };
        let have = held(pic, &self.p.depot, &kind);
        let on_order = self.on_order(t);
        let fortnight = per_day * 14;
        let grid = trade::goods_prices(&self.book, &self.p.grid);
        let (unit, grid_account) = (grid.prices.get(&kind).copied(), grid.account);
        let low = have + on_order < fortnight;
        let q = (per_day * 30).max(1);
        let w = &cx.ctx.world;
        let holds = format!("{have} {kind} held{}, the town using {per_day} a day", if on_order > 0 { format!(" and {on_order} on order") } else { String::new() });
        let note = if !low {
            holds
        } else if unit.is_none() || grid_account.is_none() {
            format!("{holds}, below a fortnight's use; the grid's price list is not on file, so nothing was ordered")
        } else if acc.as_ref().is_some_and(|a| a.balance < q * unit.unwrap_or(0)) {
            let u = unit.unwrap_or(0);
            format!("{holds}, below a fortnight's use; a month's from the grid ({q} at {} each) comes to {} and the account holds {}, so nothing was ordered: a smaller order is the office's to place on its order form", money_words(u, w), money_words(q * u, w), money_words(acc.as_ref().map_or(0, |a| a.balance), w))
        } else {
            format!("{holds}; a month's ({q}) ordered from the grid")
        };
        self.routines.note("bill", Some(note.clone()));
        if let (true, Some(a), Some(u), Some(ga), true) = (self.part != Part::Seat, acc.as_ref(), unit, grid_account.as_ref(), low) {
            if a.balance >= q * u {
                self.placing.push((q, t));
                let mut s = trade::order::<EnergyThen>(
                    &Ordering {
                        me: me.clone(),
                        seller: self.p.grid.clone(),
                        seller_account: ga.clone(),
                        kind: kind.clone(),
                        quantity: q,
                        unit_price: u,
                        to: None,
                        at: self.p.depot.clone(),
                        from: a.account.clone(),
                        why: format!("Below a fortnight's use: buying a month's from the grid ({q})."),
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
        // ---- the round's bills: each connection, the supply charge for its days and what its meter moved ----
        let last_round = self.book.open("invoice").filter(|r| r.speaks_for.as_deref() == Some(me.as_str()) && data(r).s("service") == Some("energy")).filter_map(|r| data(r).i("round")).max();
        let every = billing_by.as_ref().map_or(self.p.bill_every_days * DAY, |b| b.0);
        let next_bill = next_round(last_round, billing_by.as_ref().and_then(|b| b.1.as_ref()), every);
        let billing = billing_by.is_some() && t >= next_bill;
        if let (Some(acc), true) = (acc.as_ref(), billing_by.is_some()) {
            for c in &mine {
                let Some(meter) = c.meter.map(cents) else { continue };
                let last = self.book.open("invoice").filter(|i| i.speaks_for.as_deref() == Some(me.as_str()) && data(i).s("connection") == Some(c.id.as_str())).max_by_key(|i| data(i).i("until").unwrap_or(0));
                // (A connection closed is billed its last once; never again.)
                if c.closed && last.is_some_and(|l| data(l).i("read_to") == Some(meter)) {
                    continue;
                }
                if !billing && !c.closed {
                    continue;
                }
                let key = format!("{}@{}", c.id, if c.closed { -1 } else { next_bill });
                if self.billed_cache.contains(&key) {
                    continue;
                }
                let from = last.and_then(|l| data(l).i("until")).unwrap_or(0);
                let read_from = last.and_then(|l| data(l).i("read_to")).unwrap_or(0);
                let days = (t - from + DAY / 2).div_euclid(DAY).max(0);
                if days == 0 && meter == read_from {
                    continue;
                }
                self.billed_cache.insert(key);
                let used = (meter - read_from).max(0);
                // (A bill may be wrong: an estimated reading entered too high, so more units are billed than were used.)
                let wrong = slip(cx, "publish/invoice/metered_bill", &c.holder, &SlipOptions { days, lean: None });
                let units = if wrong { (used as i128 * (10_000 + self.p.billing_over_bps) as i128 + 5_000).div_euclid(10_000) as i64 } else { used };
                let amount = days * self.p.supply_per_day + units * self.p.price_per_unit;
                self.routines.did("bill", t, 1, &[]);
                let mut d = json!({ "outcome": { "money": { "to": acc.account, "amount": amount.to_string() } }, "service": "energy", "connection": c.id, "days": days, "units": units, "read_from": read_from, "read_to": meter, "until": t });
                if !c.closed {
                    d["round"] = json!(next_bill);
                }
                if wrong {
                    d["estimated"] = json!(true);
                }
                steps.push(because(
                    format!("{}'s energy bill: {days} days' supply and {units} units.", c.holder),
                    vec![say(
                        "invoice",
                        &format!("Energy bill: {} ({days} days' supply at {}; {units} units at {}).", money_words(amount, w), money_words(self.p.supply_per_day, w), money_words(self.p.price_per_unit, w)),
                        Say { to: Some(vec![c.holder.to_string()]), visible: Some(Visible::Only(vec![c.holder.to_string(), me.clone()])), data: Some(d), ..Default::default() },
                    )],
                ));
            }
        }
        if billing_by.is_some() {
            let next = if billing { t.max(next_bill) + every } else { next_bill };
            self.routines.note("bill", Some(format!("{note}; the next bills go out on {}", crate::common::when_words(next, &cx.ctx.world))));
        }
        // Customers who ask for a bill to be put right are answered by whoever does the billing, once.
        if billing_by.is_some() {
            if let Some(a) = &acc {
                let mut truth = BillTruth { me: me.clone(), price_per_unit: self.p.price_per_unit, supply_per_day: self.p.supply_per_day };
                steps.extend(self.resp.steps::<EnergyThen>(cx, &self.book, t, Some(&a.account), a.balance, None, &mut truth));
            }
        }
        tell(self, &mut steps, cx);
        steps
    }

    fn then(&mut self, token: &EnergyThen, done: Done, _cx: &mut Cx) -> Vec<Step<EnergyThen>> {
        let EnergyThen::Order(q) = token;
        if !done.applied() {
            if let Some(i) = self.placing.iter().position(|(x, _)| x == q) {
                self.placing.remove(i);
            }
        }
        vec![]
    }
}

/// What the retailer's own books say of a bill asked about: what it should have been, from the meter readings and the
/// days it names, against what was billed. Only a bill of ours, to the asker (frictions.ts `truth`).
struct BillTruth {
    me: String,
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
        let d = data(inv);
        let days = d.i("days").unwrap_or(0).max(0);
        let billed = d.get("outcome").and_then(|o| o.get("money")).and_then(|m| m.i("amount")).unwrap_or(0).max(0);
        let used = (d.i("read_to").unwrap_or(0) - d.i("read_from").unwrap_or(0)).max(0);
        let right = days * self.supply_per_day + used * self.price_per_unit;
        Some(Truth { owed: Some((billed - right).max(0)), done: None, wrong: Some(billed > right) })
    }
}

#[cfg(test)]
mod tests;
