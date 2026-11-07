//! What flows (foundations-2 C3; docs/nothing-from-nothing.md): the network's state, the settlement of every
//! connection at its kind's period, and the physics of each supply's tree. Integers only, dense indices, one pass up each
//! tree and one down; separate trees are solved apart and applied in the supplies' order, so the result is the same on
//! one thread or many.
//!
//! **There is no allocation rule here.** Who goes short when a supply or a link cannot carry what is asked follows from
//! the network's physics alone: a pipe's head falls with its load and its height, so the far end and the high ground lose
//! pressure first; a wire asked for more than its rating trips and everything beyond it goes dark until its operator
//! recloses it; a supply asked for more than it holds trips its own links. What the supply contracts say and what the
//! operators do (valves, rotations, interruptions) reach this code only as the acts that set its state.
//!
//! Settlements are not logged one by one: the meter of each connection is state (hashed), and only acts on a connection
//! or a link, and a link's tripping, are in the log.

use crate::blocks::Id;
use crate::config::{Physics, Settle};
use crate::events::{EventBody, Timed};
use crate::money::{Money, MAX_MONEY};
use crate::state::State;
use crate::statics::Statics;
use oikos_contracts::network::{MeterKind, NetworkCfg, Trees};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::Arc;

/// What is fixed about the network for the run: its trees, each node's height (millimetres), and each link's capacity.
#[derive(Debug, Clone, Default)]
pub struct NetStatics {
    pub trees: Trees,
    pub height_mm: Vec<i64>,
    /// Each kind's settle period and its hour shape (cumulative, 25 points from 0 to 10,000), by kind id.
    pub kinds: BTreeMap<Id, (Settle, Option<Vec<i64>>)>,
}

impl NetStatics {
    pub fn of(n: &NetworkCfg, cat: &crate::config::Catalogue) -> NetStatics {
        let kinds = cat
            .resources
            .iter()
            .filter_map(|r| {
                let settle = r.settle?;
                let cum = r.shape_bps.as_ref().map(|s| {
                    let mut c = vec![0i64];
                    for x in s {
                        c.push(c.last().unwrap() + x);
                    }
                    c
                });
                Some((r.id, (settle, cum)))
            })
            .collect();
        NetStatics { trees: Trees::of(n), height_mm: n.nodes.iter().map(|x| x.height_m * 1000).collect(), kinds }
    }
}

/// A link's state: shut by its operator (a valve, a switch), tripped by its own protection, on a rotation its operator
/// declared (a standing schedule: off for `off` seconds of every `every`, from `from`), and what it carried at its last
/// settlement (what its operator's instruments read).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct LinkState {
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub shut: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub tripped: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rotation: Option<Rotation>,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub load: i64,
}

fn is_zero(x: &i64) -> bool {
    *x == 0
}

/// A standing schedule of a link off: for `off` seconds of every `every`, counted from `from`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rotation {
    pub every: i64,
    pub from: i64,
    pub off: i64,
}

impl Rotation {
    pub fn off_at(&self, t: i64) -> bool {
        t >= self.from && (t - self.from).rem_euclid(self.every.max(1)) < self.off
    }
}

/// A connection: its user's (`holder`) at a structure, on a node of a supply's tree, taking the supply's kind at `rate` a
/// day (or, on a drain, letting it out), with its meter: what has been delivered since it was opened.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Connection {
    pub id: Id,
    pub kind: Id,
    pub node: Id,
    pub supply: u32,
    pub holder: Id,
    pub at: Id,
    pub rate: i64,
    #[serde(with = "crate::money::amount")]
    pub meter: Money,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uses: Option<Id>,
    #[serde(default, skip_serializing_if = "is_on_site")]
    pub reading: MeterKind,
    /// Closed by its operator: it takes nothing until opened again (a disconnection).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub closed: bool,
    /// Interrupted by its operator (an interruptible customer cut): nothing until restored, its rate kept.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub interrupted: bool,
    /// The change stamp of its last act (opened, set, closed, interrupted).
    pub changed: u64,
}

fn is_on_site(m: &MeterKind) -> bool {
    *m == MeterKind::OnSite
}

/// The network's state: each link's, each connection's, and how many connections acts have opened (their ids are
/// `conn.<n>`). The indexes by id, holder, structure and supply are derived and never serialised.
///
/// Its lists are persistent vectors and its indexes behind an `Arc`: an act's copy of the state, and the copy an act
/// that changes the network makes of it, share them, and the change copies only the link or connection it touches
/// (memory per person: no whole-world copies during a step). Serialised as the lists they are.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct NetState {
    pub links: imbl::Vector<LinkState>,
    #[serde(default, skip_serializing_if = "imbl::Vector::is_empty")]
    pub connections: imbl::Vector<Connection>,
    #[serde(default, skip_serializing_if = "is_zero_u64")]
    pub opened: u64,
    #[serde(skip)]
    pub index: Arc<NetIndex>,
}

fn is_zero_u64(x: &u64) -> bool {
    *x == 0
}

#[derive(Debug, Clone, Default)]
pub struct NetIndex {
    pub by_id: BTreeMap<Id, usize>,
    pub by_holder: BTreeMap<Id, Vec<usize>>,
    pub by_at: BTreeMap<Id, Vec<usize>>,
    pub by_supply: BTreeMap<u32, Vec<usize>>,
}

impl PartialEq for NetState {
    fn eq(&self, o: &Self) -> bool {
        self.links == o.links && self.connections == o.connections && self.opened == o.opened
    }
}
impl Eq for NetState {}

impl NetState {
    /// The indexes made again from the connections (after a load or a resume).
    pub fn reindex(&mut self) {
        self.index = Arc::default();
        for i in 0..self.connections.len() {
            self.index_one(i);
        }
    }
    fn index_one(&mut self, i: usize) {
        let c = &self.connections[i];
        let index = Arc::make_mut(&mut self.index);
        index.by_id.insert(c.id, i);
        index.by_holder.entry(c.holder).or_default().push(i);
        index.by_at.entry(c.at).or_default().push(i);
        index.by_supply.entry(c.supply).or_default().push(i);
    }
    /// A connection added (opened by an act, or at the start).
    pub fn add(&mut self, c: Connection) -> usize {
        self.connections.push_back(c);
        let i = self.connections.len() - 1;
        self.index_one(i);
        i
    }
}

/// The network at the start: every link as it is (open, not tripped), and the world's connections.
pub fn initial(s: &Statics) -> Option<Arc<NetState>> {
    let w = &s.config.world;
    let n = w.network.as_ref()?;
    let net = s.net.as_ref()?;
    let mut ns = NetState { links: imbl::Vector::from(vec![LinkState::default(); n.links.len()]), ..Default::default() };
    for c in &w.connections {
        let supply = net.trees.supply_of(n, &c.kind, &c.node).expect("validated") as u32;
        ns.add(Connection { id: c.id, kind: c.kind, node: c.node, supply, holder: c.holder, at: c.at, rate: c.rate, meter: 0, uses: c.uses, reading: c.meter, closed: false, interrupted: false, changed: 0 });
    }
    Some(Arc::new(ns))
}

/// The amount of a daily rate that falls in an hour of the day, for a kind settled hourly: by its shape (cumulative), so
/// the day's 24 parts add to the rate exactly; evenly where it has none.
fn in_hour(rate: i64, hour: i64, cum: Option<&Vec<i64>>) -> i64 {
    let r = rate as i128;
    let at = |h: i64| -> i128 {
        match cum {
            Some(c) => r * c[h as usize] as i128 / 10_000,
            None => r * h as i128 / 24,
        }
    };
    (at(hour + 1) - at(hour)) as i64
}

/// A share in basis points of what is asked, by pressure (millimetres of head): all of it at or above the service head,
/// none at or below the least, and between them the square root of how far the head is between the two (pressure-driven
/// delivery, Wagner, Shamir and Marks 1988, to confirm), in integers.
fn by_pressure(p: i64, least: i64, service: i64) -> i64 {
    if p >= service {
        return 10_000;
    }
    if p <= least {
        return 0;
    }
    isqrt(100_000_000i128 * (p - least) as i128 / (service - least) as i128) as i64
}

/// The integer square root (Newton's method, in integers).
fn isqrt(n: i128) -> i128 {
    if n < 2 {
        return n.max(0);
    }
    let (mut x, mut y) = (n, (n + 1) / 2);
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    x
}

/// One tree's settlement: what each of its connections gets, the links that trip, and each link's load. Pure: the state
/// is read, not written.
struct Solved {
    supply: usize,
    deliveries: Vec<(usize, i64)>,
    trips: Vec<(usize, i64)>,
    loads: Vec<(usize, i64)>,
}

fn solve(s: &Statics, st: &State, ns: &NetState, k: usize, t: i64, hour: i64) -> Option<Solved> {
    let n = s.config.world.network.as_ref()?;
    let net = s.net.as_ref()?;
    let sup = &n.supplies[k];
    let tree = &net.trees.trees[k];
    if tree.order.is_empty() {
        return None;
    }
    let (settle, cum) = net.kinds.get(&sup.kind)?;
    let size = tree.order.len();
    let link_cap = |li: usize| n.links[li].capacity as i128 * if *settle == Settle::Day { 24 } else { 1 };
    let usable = |li: usize| {
        let l = &ns.links[li];
        !l.shut && !l.tripped && !l.rotation.is_some_and(|r| r.off_at(t))
    };
    // Lit: reached from the source over links that carry.
    let lit_of = |extra_trips: &[bool]| -> Vec<bool> {
        let mut lit = vec![false; size];
        lit[0] = true;
        for i in 1..size {
            let li = tree.link[i];
            lit[i] = lit[tree.parent[i]] && usable(li) && !extra_trips[i];
        }
        lit
    };
    // What each connection asks for this period.
    let mut asked: Vec<(usize, usize, i64)> = vec![];
    for &ci in ns.index.by_supply.get(&(k as u32)).into_iter().flatten() {
        let c = &ns.connections[ci];
        if c.closed || c.interrupted || c.rate <= 0 {
            continue;
        }
        let Some(&ni) = net.trees.node_ix.get(&c.node) else { continue };
        let Some(&local) = tree.local.get(&ni) else { continue };
        let mut a = if *settle == Settle::Hour { in_hour(c.rate, hour, cum.as_ref()) } else { c.rate };
        if sup.physics == Physics::Drain {
            a = a.min(st.holding(&c.holder, &c.at, &c.kind).clamp(0, i64::MAX as i128) as i64);
        }
        if a > 0 {
            asked.push((ci, local, a));
        }
    }
    let edge = s.is_boundary(&sup.holder);
    let held: i128 = if edge { i128::MAX / 4 } else { st.holding(&sup.holder, &sup.at, &sup.kind).max(0) };
    let mut no_trips = vec![false; size];
    let lit = lit_of(&no_trips);
    // Loads up the tree (reverse breadth-first order: every child before its parent).
    let loads_up = |lit: &[bool], take: &dyn Fn(usize, i64) -> i64| -> Vec<i128> {
        let mut load = vec![0i128; size];
        for &(ci, local, a) in &asked {
            if lit[local] {
                load[local] += take(ci, a) as i128;
            }
        }
        for i in (1..size).rev() {
            if !lit[i] {
                load[i] = 0;
            }
            let p = tree.parent[i];
            let l = load[i];
            load[p] += l;
        }
        load
    };
    let mut trips: Vec<(usize, i64)> = vec![];
    let mut deliveries: Vec<(usize, i64)> = vec![];
    let mut loads: Vec<(usize, i64)> = vec![];
    match sup.physics {
        Physics::Rating => {
            // Bottom up: a link asked for more than its rating trips (its protection opens), and carries nothing.
            let mut load = vec![0i128; size];
            for &(_, local, a) in &asked {
                if lit[local] {
                    load[local] += a as i128;
                }
            }
            for i in (1..size).rev() {
                if !lit[i] {
                    load[i] = 0;
                    continue;
                }
                let li = tree.link[i];
                if load[i] > link_cap(li) {
                    trips.push((li, load[i].min(i64::MAX as i128) as i64));
                    no_trips[i] = true;
                    load[i] = 0;
                }
                let p = tree.parent[i];
                let l = load[i];
                load[p] += l;
            }
            // The supply asked for more than it holds: its own links trip, and the tree goes dark (whoever is at the source
            // itself too: it does not ration itself).
            let short = load[0] > held;
            if short {
                for i in 1..size {
                    if tree.parent[i] == 0 && lit[i] && !no_trips[i] {
                        trips.push((tree.link[i], load[i].min(i64::MAX as i128) as i64));
                        no_trips[i] = true;
                    }
                }
            }
            let mut lit = lit_of(&no_trips);
            lit[0] = !short;
            for &(ci, local, a) in &asked {
                if lit[local] {
                    deliveries.push((ci, a));
                }
            }
            let carried = loads_up(&lit, &|_, a| a);
            for i in 1..size {
                loads.push((tree.link[i], carried[i].min(i64::MAX as i128) as i64));
            }
        }
        Physics::Drain => {
            for &(ci, local, a) in &asked {
                if lit[local] {
                    deliveries.push((ci, a));
                }
            }
            let carried = loads_up(&lit, &|_, a| a);
            for i in 1..size {
                loads.push((tree.link[i], carried[i].min(i64::MAX as i128) as i64));
            }
        }
        Physics::Pressure => {
            // The source's head falls as its store empties (a reservoir's level); heads down the tree lose, on each link, its
            // loss at capacity times its load over its capacity (the loads are what is asked: a linear stand-in for friction).
            let full = sup.head_m.unwrap_or(0) as i128 * 1000;
            let head0 = match sup.storage {
                Some(cap) if cap > 0 => full * held.min(cap) / cap,
                _ => {
                    if held > 0 {
                        full
                    } else {
                        0
                    }
                }
            };
            let (least, service) = (sup.min_head_m.unwrap_or(0) * 1000, sup.service_head_m.unwrap_or(0) * 1000);
            let asked_load = loads_up(&lit, &|_, a| a);
            let mut drop = vec![0i128; size];
            for i in 1..size {
                let li = tree.link[i];
                drop[i] = drop[tree.parent[i]] + n.links[li].loss_m as i128 * 1000 * asked_load[i] / link_cap(li).max(1);
            }
            let share_at = |h0: i128| -> Vec<i64> {
                (0..size)
                    .map(|i| {
                        let p = h0 - drop[i] - net.height_mm[tree.order[i]] as i128;
                        by_pressure(p.clamp(i64::MIN as i128, i64::MAX as i128) as i64, least, service)
                    })
                    .collect()
            };
            let total = |share: &[i64]| -> i128 { asked.iter().filter(|(_, l, _)| lit[*l]).map(|(_, l, a)| *a as i128 * share[*l] as i128 / 10_000).sum() };
            // What the store cannot give, it does not: its level falls until what is drawn is what it holds (the head that
            // delivers no more than is held, the highest such, found by halving: a fall of level, never a share-out).
            let mut h = head0;
            if total(&share_at(h)) > held {
                let (mut lo, mut hi) = (0i128, head0);
                while lo < hi {
                    let mid = (lo + hi + 1) / 2;
                    if total(&share_at(mid)) <= held {
                        lo = mid;
                    } else {
                        hi = mid - 1;
                    }
                }
                h = lo;
            }
            let share = share_at(h);
            let mut got: BTreeMap<usize, i64> = BTreeMap::new();
            for &(ci, local, a) in &asked {
                if lit[local] {
                    let g = (a as i128 * share[local] as i128 / 10_000) as i64;
                    if g > 0 {
                        deliveries.push((ci, g));
                        got.insert(ci, g);
                    }
                }
            }
            let carried = loads_up(&lit, &|ci, _| got.get(&ci).copied().unwrap_or(0));
            for i in 1..size {
                loads.push((tree.link[i], carried[i].min(i64::MAX as i128) as i64));
            }
        }
    }
    Some(Solved { supply: k, deliveries, trips, loads })
}

/// Add to a holding, settling (a stamp for the whole settlement), within the range of a quantity.
fn add_held(st: &mut State, holder: &str, at: &str, kind: &str, by: Money, stamp: u64) {
    if by == 0 {
        return;
    }
    let key = crate::state::holding_key(holder, at, kind);
    let q = st.holdings.get(&key).map_or(0, |h| h.quantity).saturating_add(by).clamp(-MAX_MONEY, MAX_MONEY);
    st.holdings.insert(key, crate::state::Holding { kind: kind.into(), holder: holder.into(), at: at.into(), quantity: q, changed: stamp });
}

/// Settle the network at `t` (an hour's boundary): every connection of a kind settled hourly, and at midnight of a kind
/// settled daily, by its supply's physics; deliveries moved from the supply's holding to the user's (and a use's recipe
/// run on them as they come), meters advanced, links' loads and trips recorded. The next settlement is scheduled.
pub fn settle(s: &Statics, st: &mut State, t: i64) -> Vec<Timed> {
    st.schedule(t + 3600, crate::state::Sched::Settle);
    let (Some(n), Some(net), Some(cur)) = (s.config.world.network.as_ref(), s.net.as_ref(), st.network.clone()) else { return vec![] };
    let midnight = t.rem_euclid(86_400) == 0;
    let hour = t.rem_euclid(86_400) / 3600;
    let due: Vec<usize> = (0..n.supplies.len()).filter(|&k| net.kinds.get(&n.supplies[k].kind).is_some_and(|(p, _)| *p == Settle::Hour || midnight)).collect();
    if due.is_empty() {
        return vec![];
    }
    // (Each tree apart: the same answers in any order; applied below in the supplies' order.)
    let solved: Vec<Solved> = due.iter().filter_map(|&k| solve(s, st, &cur, k, t, hour)).collect();
    let mut events = vec![];
    let stamp = st.stamp();
    let mut ns = (*cur).clone();
    for x in solved {
        let sup = &n.supplies[x.supply];
        for (li, load) in &x.trips {
            ns.links[*li].tripped = true;
            events.push(Timed::new(t, EventBody::LinkChanged { link: n.links[*li].id, op: "tripped".into(), by: None, load: Some(*load), capacity: Some(n.links[*li].capacity), rotation: None }));
        }
        for (li, load) in &x.loads {
            ns.links[*li].load = *load;
        }
        let mut out: Money = 0;
        for (ci, amount) in x.deliveries {
            let c = &mut ns.connections[ci];
            c.meter = c.meter.saturating_add(amount as Money);
            let (holder, at, kind, uses) = (c.holder, c.at, c.kind, c.uses);
            if sup.physics == Physics::Drain {
                add_held(st, &holder, &at, &kind, -(amount as Money), stamp);
                out -= amount as Money;
                continue;
            }
            out += amount as Money;
            match uses.and_then(|u| s.config.catalogue.tasks.iter().find(|x| x.id == u)) {
                // Used as it comes: the kind in, the use's outputs out, at the user's (law 8: use is a recipe at the user).
                Some(task) => {
                    for (k2, per) in &task.produces {
                        add_held(st, &holder, &at, k2, per.saturating_mul(amount as Money), stamp);
                    }
                    // (And what it emits to the world's counters: a kWh's emissions as it is used.)
                    for (k2, per) in &task.emits {
                        if let Some(v) = st.totals.get_mut(k2) {
                            *v = v.saturating_add(per.saturating_mul(amount));
                        }
                    }
                }
                None => add_held(st, &holder, &at, &kind, amount as Money, stamp),
            }
        }
        add_held(st, &sup.holder, &sup.at, &sup.kind, -out, stamp);
    }
    st.network = Some(Arc::new(ns));
    events
}
