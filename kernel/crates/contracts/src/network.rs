//! The world's network for what flows (foundations-2 C3; docs/nothing-from-nothing.md; docs/design/foundations-2.md
//! sections 2.1 and 3.1): nodes, links between them, the supplies that feed each tree of links, and the connections
//! that take from a supply (or give to a drain) at a node. Pipes and wires now; roads and paths join it later (law 9),
//! so a link has a mode, a length and a capacity an hour, and room for what a road adds (speed and energy a kilometre
//! by vehicle type).
//!
//! The kernel treats each supply's network as a tree (a meshed main is cut to a tree at load: the known limit) and
//! settles every connection at its kind's period in one pass. **There is no allocation rule here or in the kernel.** Who
//! goes short follows from three things only: where a connection sits on the network and what each link on the way can
//! carry (the physics); the supply contracts in force (content the kernel stores and never reads); and the operators'
//! own acts (valves shut, feeders on a rotation, connections interrupted).

use crate::blocks::Id;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

/// The network: its nodes, links and supplies.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NetworkCfg {
    pub nodes: Vec<NodeCfg>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub links: Vec<LinkCfg>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub supplies: Vec<SupplyCfg>,
}

/// A node: a junction of links, on a cell of the ground (or at an edge, where links leave the world), at a height.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NodeCfg {
    pub id: Id,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cell: Option<Id>,
    /// The world's edge it stands at, where links leave the world.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub edge: Option<Id>,
    /// Its height above the world's datum, in metres (a world that gives none is level).
    #[serde(default, skip_serializing_if = "is_zero")]
    pub height_m: i64,
}

/// A link between two nodes: a pipe, a wire (and later a road, a path, a rail line, a data line: the world's vocabulary).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LinkCfg {
    pub id: Id,
    pub from: Id,
    pub to: Id,
    pub mode: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub length_m: Option<i64>,
    /// What it carries an hour, at most, in the unit of what flows on it (a pipe's litres, a wire's kWh: its rating).
    pub capacity: i64,
    /// A pipe: the head it loses, in metres, carrying its capacity (a linear stand-in for friction: the loss is this times
    /// the flow over the capacity).
    #[serde(default, skip_serializing_if = "is_zero")]
    pub loss_m: i64,
}

/// How a supply's tree behaves.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Physics {
    /// Water: heads, losses on the links, delivery by pressure between a least head and a service head.
    Pressure,
    /// Power: ratings; a link asked for more than its rating trips, and so does the supply's own when it cannot give
    /// what is asked.
    Rating,
    /// A drain (a sewer): what each connection lets out is carried to the supply's holder.
    Drain,
}

/// A supply: a holder's holding of a kind at a structure (a water works, a substation), feeding the tree of links of a
/// mode that reaches out from its node; or, for a drain, the holding that what is let out goes to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SupplyCfg {
    pub id: Id,
    pub kind: Id,
    pub mode: String,
    pub node: Id,
    pub holder: Id,
    pub at: Id,
    pub physics: Physics,
    /// Pressure: the head at the source, in metres, when its store is full.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub head_m: Option<i64>,
    /// Pressure: what the store holds when full (its head falls as it empties: a reservoir's level).
    #[serde(default, skip_serializing_if = "Option::is_none", with = "oikos_core::money::opt_amount")]
    pub storage: Option<oikos_core::money::Money>,
    /// Pressure: at or above this head at a node, a connection there gets what it asks; at or below `min_head_m`, nothing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub service_head_m: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_head_m: Option<i64>,
}

/// Whose a meter's readings are: read from afar by its operator (an interval meter), or on the premises (read by going there).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum MeterKind {
    #[default]
    OnSite,
    Remote,
}

/// A connection at the start: a holder's at a structure, on a node, taking a kind from the supply whose tree the node is
/// on at `rate` a day (or, on a drain, letting it out), with a meter of what has been delivered.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConnectionCfg {
    pub id: Id,
    pub kind: Id,
    pub node: Id,
    pub holder: Id,
    pub at: Id,
    /// A day, in the kind's unit: what its user asks for (or, on a drain, the most it lets out).
    pub rate: i64,
    /// A process the user's use is (a task with no labour that uses the kind a unit at a time): what is delivered is used
    /// by it as it comes, so use is a recipe at the user (water in, wastewater out; energy in, dissipated).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uses: Option<Id>,
    #[serde(default, skip_serializing_if = "is_on_site")]
    pub meter: MeterKind,
}

fn is_zero(x: &i64) -> bool {
    *x == 0
}

fn is_on_site(m: &MeterKind) -> bool {
    *m == MeterKind::OnSite
}

/// The most a rate or a capacity may be (a quadrillion units a day or an hour).
pub const MAX_FLOW: i64 = 1_000_000_000_000_000;

/// The network checked against the world: ids once each; links between nodes; a supply's kind declared and settled, its
/// holder an entity holding at a structure (an edge at itself); a pressure supply's heads; each connection on a node a
/// supply of its kind reaches, at a structure, with a use that is a recipe of the kind.
pub fn validate(c: &crate::config::Config) -> Result<(), String> {
    let w = &c.world;
    let Some(n) = &w.network else {
        if !w.connections.is_empty() {
            return Err("connections need a network to be on (world.network)".into());
        }
        return Ok(());
    };
    let mut ids = BTreeSet::new();
    let mut once = |id: &str, what: &str| if ids.insert(format!("{what}:{id}")) { Ok(()) } else { Err(format!("network: duplicate {what} {id}")) };
    let structures: BTreeSet<&str> = w.structures.iter().map(|s| s.id.as_str()).collect();
    let entities: BTreeSet<&str> = w.entities.iter().map(|e| e.id.as_str()).collect();
    let nodes: BTreeSet<&str> = n.nodes.iter().map(|x| x.id.as_str()).collect();
    for x in &n.nodes {
        once(&x.id, "node")?;
        if let Some(e) = &x.edge {
            if !w.boundaries.contains(e) {
                return Err(format!("network: node {} stands at {e}, which is not an edge of the world", x.id));
            }
        }
        if x.height_m.abs() > 100_000 {
            return Err(format!("network: node {}'s height is out of range", x.id));
        }
    }
    for l in &n.links {
        once(&l.id, "link")?;
        if !nodes.contains(l.from.as_str()) || !nodes.contains(l.to.as_str()) || l.from == l.to {
            return Err(format!("network: link {} joins no two nodes of the network", l.id));
        }
        if !(1..=MAX_FLOW).contains(&l.capacity) || !(0..=100_000).contains(&l.loss_m) || l.length_m.is_some_and(|x| !(0..=100_000_000).contains(&x)) {
            return Err(format!("network: link {}'s capacity, loss or length is out of range", l.id));
        }
    }
    let resources: BTreeMap<&str, &crate::config::ResourceCfg> = c.catalogue.resources.iter().map(|r| (r.id.as_str(), r)).collect();
    for s in &n.supplies {
        once(&s.id, "supply")?;
        let r = resources.get(s.kind.as_str()).ok_or_else(|| format!("network: supply {} is of no kind the world declares ({})", s.id, s.kind))?;
        if r.settle.is_none() {
            return Err(format!("network: supply {}: its kind {} says how it is settled (`settle`)", s.id, s.kind));
        }
        if !nodes.contains(s.node.as_str()) || !entities.contains(s.holder.as_str()) {
            return Err(format!("network: supply {} is on no node, or held by no entity", s.id));
        }
        let edge = w.boundaries.contains(&s.holder) && s.at == s.holder;
        if !edge && !structures.contains(s.at.as_str()) {
            return Err(format!("network: supply {} is held at {}, which is no structure", s.id, s.at));
        }
        if s.physics == Physics::Pressure {
            let (Some(h), Some(sv), Some(lo)) = (s.head_m, s.service_head_m, s.min_head_m) else {
                return Err(format!("network: supply {} is fed by pressure: it gives its head, and the service and least heads", s.id));
            };
            if !(1..=100_000).contains(&h) || lo < 0 || sv <= lo || sv > 100_000 || s.storage.is_some_and(|x| x <= 0) {
                return Err(format!("network: supply {}: heads 0 <= least < service, a positive head and store", s.id));
            }
        }
    }
    let trees = Trees::of(n);
    let tasks: BTreeMap<&str, &crate::config::TaskCfg> = c.catalogue.tasks.iter().map(|t| (t.id.as_str(), t)).collect();
    for x in &w.connections {
        once(&x.id, "connection")?;
        if trees.supply_of(n, &x.kind, &x.node).is_none() {
            return Err(format!("connection {}: no supply of {} reaches node {}", x.id, x.kind, x.node));
        }
        if !entities.contains(x.holder.as_str()) || !structures.contains(x.at.as_str()) {
            return Err(format!("connection {}: its holder is no entity, or it is at no structure", x.id));
        }
        if !(0..=MAX_FLOW).contains(&x.rate) {
            return Err(format!("connection {}: its rate is out of range", x.id));
        }
        if let Some(u) = &x.uses {
            check_use(&tasks, &c.catalogue.fields.iter().map(|f| f.id.as_str()).collect(), u, &x.kind).map_err(|e| format!("connection {}: {e}", x.id))?;
        }
    }
    Ok(())
}

/// A use is a recipe that takes no one's time and uses the kind one unit at a time, and nothing else.
pub fn check_use(tasks: &BTreeMap<&str, &crate::config::TaskCfg>, fields: &BTreeSet<&str>, task: &str, kind: &str) -> Result<(), String> {
    let t = tasks.get(task).ok_or_else(|| format!("its use {task} is no task of the world's"))?;
    let only = t.consumes.len() == 1 && t.consumes.get(kind) == Some(&1);
    // (Its emissions reach the world's counters as it is used; one to a field would be put on no cell, so it is refused.)
    let to_fields = t.emits.keys().any(|k| fields.contains(k.as_str()));
    if t.labour != 0 || !only || to_fields || t.draws.is_some() || !t.changes.is_empty() || t.on_body.is_some() || t.collects.is_some() {
        return Err(format!("its use {task} is a recipe that takes no time and uses one {kind} a unit, and nothing else"));
    }
    Ok(())
}

/// Each supply's tree, found at load: from its node, over the links of its mode, breadth first in the links' order;
/// a link that would close a loop is cut (the known limit: a meshed main's second path is ignored). Nodes are claimed by
/// the first supply (in the order given) to reach them, for each mode.
#[derive(Debug, Clone, Default)]
pub struct Trees {
    pub node_ix: BTreeMap<Id, usize>,
    pub link_ix: BTreeMap<Id, usize>,
    pub trees: Vec<Tree>,
    /// For each supply's mode and each node: the supply whose tree it is on.
    pub on: BTreeMap<(String, usize), usize>,
    /// For each link: the supply whose tree it is in (none: cut, or reached by no supply).
    pub link_tree: Vec<Option<usize>>,
    /// Links cut to make the trees.
    pub cut: Vec<usize>,
}

/// One supply's tree: its nodes in breadth-first order (the source first), each with its parent (a place in `order`)
/// and the link from the parent; and each node's place in it.
#[derive(Debug, Clone, Default)]
pub struct Tree {
    pub order: Vec<usize>,
    pub parent: Vec<usize>,
    pub link: Vec<usize>,
    pub local: BTreeMap<usize, usize>,
}

pub const ROOT: usize = usize::MAX;

impl Trees {
    pub fn of(n: &NetworkCfg) -> Trees {
        let node_ix: BTreeMap<Id, usize> = n.nodes.iter().enumerate().map(|(i, x)| (x.id.clone(), i)).collect();
        let link_ix: BTreeMap<Id, usize> = n.links.iter().enumerate().map(|(i, x)| (x.id.clone(), i)).collect();
        // (Each node's links, in the links' order.)
        let mut adj: Vec<Vec<usize>> = vec![vec![]; n.nodes.len()];
        for (i, l) in n.links.iter().enumerate() {
            if let (Some(&a), Some(&b)) = (node_ix.get(&l.from), node_ix.get(&l.to)) {
                adj[a].push(i);
                adj[b].push(i);
            }
        }
        let mut on: BTreeMap<(String, usize), usize> = BTreeMap::new();
        let mut link_tree = vec![None; n.links.len()];
        let mut trees = vec![];
        for (k, s) in n.supplies.iter().enumerate() {
            let mut t = Tree::default();
            let Some(&root) = node_ix.get(&s.node) else {
                trees.push(t);
                continue;
            };
            if on.contains_key(&(s.mode.clone(), root)) {
                trees.push(t);
                continue;
            }
            on.insert((s.mode.clone(), root), k);
            t.local.insert(root, 0);
            t.order.push(root);
            t.parent.push(ROOT);
            t.link.push(ROOT);
            let mut i = 0;
            while i < t.order.len() {
                let here = t.order[i];
                for &li in &adj[here] {
                    let l = &n.links[li];
                    if l.mode != s.mode || link_tree[li].is_some() {
                        continue;
                    }
                    let other = if node_ix[&l.from] == here { node_ix[&l.to] } else { node_ix[&l.from] };
                    if on.contains_key(&(s.mode.clone(), other)) {
                        continue;
                    }
                    on.insert((s.mode.clone(), other), k);
                    link_tree[li] = Some(k);
                    t.local.insert(other, t.order.len());
                    t.order.push(other);
                    t.parent.push(i);
                    t.link.push(li);
                }
                i += 1;
            }
            trees.push(t);
        }
        // (A link of a mode a tree reached, joining two of its nodes, closes a loop: it is cut.)
        let cut = (0..n.links.len()).filter(|&li| link_tree[li].is_none()).collect();
        Trees { node_ix, link_ix, trees, on, link_tree, cut }
    }

    /// The supply of a kind whose tree a node is on.
    pub fn supply_of(&self, n: &NetworkCfg, kind: &str, node: &str) -> Option<usize> {
        let ni = *self.node_ix.get(node)?;
        n.supplies.iter().enumerate().find(|(k, s)| s.kind == kind && self.on.get(&(s.mode.clone(), ni)) == Some(k)).map(|(k, _)| k)
    }
}
