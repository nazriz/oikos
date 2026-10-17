//! The static world of a run, from its log's header alone (renderer/src/world.ts): the ground, structures and their
//! spaces, people, organisations, posts and who holds them, and the class of every participant.
//!
//! "Who decided" is by role in the world, not by what runs it (docs/design/renderer.md 10.2): every person is
//! simulated. Pure functions over the header's body; nothing here reads a file.

use crate::js::{g, gi, gs, jstr, num, Obj};
use crate::Decider;
use serde_json::Value;
use std::collections::HashMap;

/// The classes in the order the client and the track codes use (`CLASSES` of world.ts).
pub const CLASSES: [Decider; 5] = [Decider::Own, Decider::Person, Decider::System, Decider::Seat, Decider::World];
pub const CLASS_NAMES: [&str; 5] = ["self", "person", "system", "seat", "world"];

pub fn class_code(d: Decider) -> usize {
    match d {
        Decider::Own => 0,
        Decider::Person => 1,
        Decider::System => 2,
        Decider::Seat => 3,
        Decider::World => 4,
    }
}
pub fn class_name(d: Decider) -> &'static str {
    CLASS_NAMES[class_code(d)]
}
pub fn class_of_code(c: usize) -> Decider {
    CLASSES[c.min(4)]
}

#[derive(Debug, Clone)]
pub struct Structure {
    pub id: String,
    pub type_: String,
    pub category: String,
    pub x: i64,
    pub y: i64,
    pub w: f64,
    pub h: f64,
    pub spaces: i64,
    pub levels: f64,
}
#[derive(Debug, Clone)]
pub struct Person {
    pub id: String,
    pub participant: String,
    pub born: Option<Value>,
    pub sex: Option<Value>,
    pub household: Option<String>,
    pub name: Option<String>,
}
#[derive(Debug, Clone)]
pub struct Org {
    pub id: String,
    pub kind: Value,
    pub name: String,
    pub premises: Vec<usize>,
}
#[derive(Debug, Clone)]
pub struct Post {
    pub id: String,
    pub entity: Option<String>,
    pub title: Option<String>,
    pub role: Option<String>,
    pub holder: Option<String>,
    pub code: Option<String>,
}
#[derive(Debug, Clone)]
pub struct ParticipantInfo {
    pub id: String,
    pub kind: Option<String>,
    pub cls: Decider,
    pub imp: Option<String>,
    pub model: Option<String>,
    pub title: Option<String>,
    pub person: Option<String>,
}
#[derive(Debug, Clone)]
pub struct Household {
    pub id: String,
    pub members: Vec<String>,
    pub leaseholder: Option<String>,
}

#[derive(Debug, Clone)]
pub struct WorldStatic {
    pub run_id: String,
    pub name: String,
    pub description: String,
    pub seed: Value,
    pub currency: Value,
    pub ground: Value,
    pub water: Vec<(i64, i64)>,
    pub lots: Vec<(String, Vec<(i64, i64)>)>,
    pub structures: Vec<Structure>,
    pub persons: Vec<Person>,
    pub orgs: Vec<Org>,
    pub posts: Vec<Post>,
    pub participants: Vec<ParticipantInfo>,
    pub households: Vec<Household>,
    /// (occupant, space) at the start.
    pub occupancy: Vec<(String, String)>,
    /// Employment agreements in force at the start: (employer, employee, workplace structure index).
    pub jobs: Vec<(String, String, usize)>,
    /// Lot titles: (lot, holder).
    pub titles: Vec<(String, String)>,
}

/// "cell.56.36" as (56, 36).
pub fn cell_of(at: Option<&Value>) -> Option<(i64, i64)> {
    let s = match at? {
        Value::String(s) => s.as_str(),
        _ => return None,
    };
    let rest = s.strip_prefix("cell.")?;
    let (a, b) = rest.split_once('.')?;
    let p = |t: &str| -> Option<i64> {
        let digits = t.strip_prefix('-').unwrap_or(t);
        if digits.is_empty() || !digits.bytes().all(|c| c.is_ascii_digit()) {
            None
        } else {
            t.parse().ok()
        }
    };
    Some((p(a)?, p(b)?))
}

/// The structure a space belongs to ("apts-14/dwelling.5" is in apts-14) and its kind and number.
pub fn space_parts(space: &str) -> (String, String, i64) {
    match space.find('/') {
        None => (space.to_string(), String::new(), 0),
        Some(slash) => {
            let rest = &space[slash + 1..];
            match rest.rfind('.') {
                None => (space[..slash].to_string(), rest.to_string(), 0),
                Some(dot) => (space[..slash].to_string(), rest[..dot].to_string(), rest[dot + 1..].parse::<i64>().unwrap_or(0)),
            }
        }
    }
}

/// The person a participant stands for ("c0273-self" is c0273); anything else keeps its own id.
pub fn person_of_participant(p: &str) -> &str {
    p.strip_suffix("-self").unwrap_or(p)
}

fn is_par_n(id: &str) -> bool {
    id.strip_prefix("par.").map(|r| !r.is_empty() && r.bytes().all(|c| c.is_ascii_digit())).unwrap_or(false)
}

/// A participant's class from its header entry. An unknown participant is classed by its name: "-self" a person, the
/// rest an organisation's system.
pub fn class_of(p: Option<&Value>, id: &str) -> Decider {
    let Some(p) = p else {
        return if id.ends_with("-self") || is_par_n(id) {
            Decider::Person
        } else if id == "genesis" {
            Decider::World
        } else {
            Decider::System
        };
    };
    let ctl = g(p, "controller");
    if ctl.and_then(|c| gs(c, "type")) == Some("llm") {
        return Decider::Seat;
    }
    let imp = ctl.and_then(|c| g(c, "impl")).map(|v| jstr(Some(v))).unwrap_or_default();
    if gs(p, "kind") == Some("person") {
        return Decider::Person;
    }
    if imp.starts_with("world.") {
        return Decider::World;
    }
    Decider::System
}

fn levels_of(t: &str) -> Option<f64> {
    Some(match t {
        "house" => 1.0,
        "large-house" => 1.3,
        "apartments" => 3.2,
        "shop" => 1.1,
        "factory" => 1.8,
        "yard" => 0.5,
        "civic" => 2.4,
        "offices" => 3.4,
        "road" | "park" => 0.0,
        "station" => 1.6,
        "works" => 0.8,
        "substation" => 0.6,
        "clinic" | "school" => 2.0,
        _ => return None,
    })
}

fn arr(v: Option<&Value>) -> &[Value] {
    match v {
        Some(Value::Array(a)) => a.as_slice(),
        _ => &[],
    }
}

pub fn world_of(header: &Value) -> WorldStatic {
    let nul = Value::Null;
    let c = header.get("config").unwrap_or(&nul);
    let w = c.get("world").unwrap_or(&nul);
    let types: HashMap<&str, &Value> =
        arr(c.get("catalogue").and_then(|x| x.get("structure_types"))).iter().filter_map(|t| Some((gs(t, "id")?, t))).collect();
    let mut structures = vec![];
    for s in arr(w.get("structures")) {
        let Some((x, y)) = cell_of(g(s, "at")) else { continue };
        let ty = gs(s, "type").unwrap_or("");
        let t = types.get(ty).copied();
        let spaces: i64 = arr(t.and_then(|t| t.get("spaces"))).iter().map(|x| gi(x, "count").unwrap_or(1)).sum();
        let cat = t.and_then(|t| gs(t, "category"));
        let levels = levels_of(ty).unwrap_or(if cat == Some("residential") { (spaces as f64 / 4.0).clamp(1.0, 6.0) } else { 1.2 });
        let fp = t.and_then(|t| g(t, "footprint"));
        structures.push(Structure {
            id: jstr(s.get("id")),
            type_: ty.to_string(),
            category: cat.unwrap_or("other").to_string(),
            x,
            y,
            w: fp.and_then(|f| crate::js::number(g(f, "w"))).unwrap_or(1.0),
            h: fp.and_then(|f| crate::js::number(g(f, "h"))).unwrap_or(1.0),
            spaces,
            levels,
        });
    }
    let struct_idx: HashMap<&str, usize> = structures.iter().enumerate().map(|(i, s)| (s.id.as_str(), i)).collect();
    let mut persons = vec![];
    let mut participants = vec![];
    for p in arr(c.get("participants")) {
        let id = jstr(p.get("id"));
        let cls = class_of(Some(p), &id);
        let ctl = g(p, "controller");
        let model = if ctl.and_then(|c| gs(c, "type")) == Some("llm") {
            let parts: Vec<String> = ["provider", "model"]
                .iter()
                .filter_map(|k| ctl.and_then(|c| g(c, k)))
                .filter(|v| crate::js::truthy(Some(v)))
                .map(|v| jstr(Some(v)))
                .collect();
            Some(parts.join("/"))
        } else {
            None
        };
        participants.push(ParticipantInfo {
            id,
            kind: gs(p, "kind").map(String::from),
            cls,
            imp: ctl.and_then(|c| g(c, "impl")).map(|v| jstr(Some(v))),
            model,
            title: g(p, "title").map(|v| jstr(Some(v))),
            person: g(p, "person").map(|v| jstr(Some(v))),
        });
    }
    let mut households = vec![];
    let mut household_of: HashMap<String, String> = HashMap::new();
    let mut lots: Vec<(String, Vec<(i64, i64)>)> = vec![];
    let mut titles = vec![];
    let mut jobs: Vec<(String, String, usize)> = vec![];
    for r in arr(w.get("records")) {
        let kind = gs(r, "kind");
        if kind == Some("household") {
            let members: Vec<String> = arr(r.get("data").and_then(|d| d.get("members"))).iter().map(|m| jstr(m.get("person"))).collect();
            households.push(Household {
                id: jstr(r.get("id")),
                members: members.clone(),
                leaseholder: r.get("data").and_then(|d| g(d, "leaseholder")).map(|v| jstr(Some(v))),
            });
            for m in members {
                household_of.insert(m, jstr(r.get("id")));
            }
        } else if kind == Some("lot") {
            lots.push((
                jstr(r.get("id")),
                arr(r.get("data").and_then(|d| d.get("cells"))).iter().filter_map(|c| cell_of(Some(c))).collect(),
            ));
        } else if gs(r, "record") == Some("claim")
            && r.get("about").and_then(|a| gs(a, "kind")) == Some("ownership")
            && gs(r, "position") == Some("right")
        {
            titles.push((jstr(r.get("about").and_then(|a| a.get("object"))), jstr(r.get("holder"))));
        } else if gs(r, "record") == Some("agreement") && r.get("terms").and_then(|t| gs(t, "template")) == Some("employment") {
            let terms = r.get("terms").unwrap();
            let parties: Vec<&Value> = arr(terms.get("parties")).iter().collect();
            for cm in arr(terms.get("commitments")) {
                let occ = cm.get("does").and_then(|d| d.get("outcome")).and_then(|o| o.get("occupancy"));
                if let Some(occ) = occ {
                    if crate::js::truthy(occ.get("in")) && crate::js::truthy(occ.get("who")) {
                        let who = occ.get("who").unwrap();
                        let employer = parties.iter().find(|x| ***x != *who).map(|x| jstr(Some(x))).unwrap_or_default();
                        let st = space_parts(&jstr(occ.get("in"))).0;
                        if let Some(&si) = struct_idx.get(st.as_str()) {
                            jobs.push((employer, jstr(Some(who)), si));
                        }
                    }
                }
            }
        }
    }
    for e in arr(w.get("entities")) {
        if gs(e, "kind") == Some("person") {
            let id = jstr(e.get("id"));
            let name = g(e, "name").filter(|n| crate::js::truthy(Some(n)) && jstr(Some(n)) != id).map(|n| jstr(Some(n)));
            persons.push(Person {
                participant: format!("{id}-self"),
                born: g(e, "born_at").cloned(),
                sex: g(e, "sex").cloned(),
                household: household_of.get(&id).cloned(),
                name,
                id,
            });
        }
    }
    // Employers' workplaces (a set that keeps first-seen order).
    let mut premises: HashMap<String, Vec<usize>> = HashMap::new();
    for (employer, _, si) in &jobs {
        let v = premises.entry(employer.clone()).or_default();
        if !v.contains(si) {
            v.push(*si);
        }
    }
    // An organisation with no workplace in the header (a landlord) is placed at the buildings on the lots it holds.
    let lot_cells: HashMap<&str, &Vec<(i64, i64)>> = lots.iter().map(|(id, c)| (id.as_str(), c)).collect();
    let struct_at_cell: HashMap<(i64, i64), usize> = structures.iter().enumerate().map(|(i, s)| ((s.x, s.y), i)).collect();
    let mut held: HashMap<String, Vec<usize>> = HashMap::new();
    for (lot, holder) in &titles {
        for xy in lot_cells.get(lot.as_str()).map(|c| c.as_slice()).unwrap_or(&[]) {
            if let Some(&si) = struct_at_cell.get(xy) {
                let cat = structures[si].category.as_str();
                if cat != "transport" && cat != "green" {
                    held.entry(holder.clone()).or_default().push(si);
                }
            }
        }
    }
    let orgs: Vec<Org> = arr(w.get("entities"))
        .iter()
        .filter(|e| gs(e, "kind") != Some("person"))
        .map(|e| {
            let id = jstr(e.get("id"));
            let prem = match premises.get(&id) {
                Some(p) => p.clone(),
                None => held.get(&id).map(|h| h.iter().take(12).copied().collect()).unwrap_or_default(),
            };
            Org {
                name: g(e, "name").map(|n| jstr(Some(n))).unwrap_or_else(|| id.clone()),
                kind: e.get("kind").cloned().unwrap_or(Value::Null),
                id,
                premises: prem,
            }
        })
        .collect();
    let posts: Vec<Post> = arr(c.get("positions"))
        .iter()
        .map(|p| Post {
            id: jstr(p.get("id")),
            entity: g(p, "entity").map(|v| jstr(Some(v))),
            title: g(p, "title").map(|v| jstr(Some(v))),
            role: g(p, "role").map(|v| jstr(Some(v))),
            holder: g(p, "holder").map(|v| jstr(Some(v))),
            code: p.get("role_module").and_then(|m| g(m, "code")).map(|v| jstr(Some(v))),
        })
        .collect();
    let mut water = vec![];
    let mut seen = std::collections::HashSet::new();
    for f in arr(w.get("flows")) {
        for k in ["from", "to"] {
            let at = f.get(k);
            if let Some(xy) = cell_of(at) {
                if seen.insert(jstr(at)) {
                    water.push(xy);
                }
            }
        }
    }
    let ground = {
        let gr = w.get("ground");
        let terrain: Vec<Value> = arr(gr.and_then(|g_| g_.get("terrain")))
            .iter()
            .map(|t| {
                let mut o = Obj::new();
                for k in ["x", "y", "w", "h", "label"] {
                    if let Some(v) = g(t, k) {
                        o = o.set(k, v.clone());
                    }
                }
                o.build()
            })
            .collect();
        let d = |k: &str| gr.and_then(|g_| g(g_, k)).cloned().unwrap_or(Value::from(1));
        Obj::new().set("w", d("w")).set("h", d("h")).set("cell", d("cell")).set("terrain", Value::Array(terrain)).build()
    };
    let occupancy = arr(w.get("occupancy")).iter().map(|o| (jstr(o.get("occupant")), jstr(o.get("space")))).collect();
    WorldStatic {
        run_id: jstr(g(header, "run_id").or(Some(&Value::String(String::new())))),
        name: c.get("meta").and_then(|m| g(m, "name")).map(|v| jstr(Some(v))).unwrap_or_default(),
        description: c.get("meta").and_then(|m| g(m, "description")).map(|v| jstr(Some(v))).unwrap_or_default(),
        seed: g(c, "seed").cloned().unwrap_or(Value::from(0)),
        currency: arr(w.get("currencies")).first().cloned().unwrap_or_else(|| Value::Object(Default::default())),
        ground,
        water,
        lots,
        structures,
        persons,
        orgs,
        posts,
        participants,
        households,
        occupancy,
        jobs,
        titles,
    }
}

/// The accounts in the header: (id, holder, opening balance in cents).
pub fn accounts_of(header: &Value) -> Vec<(String, String, String)> {
    arr(header.get("config").and_then(|c| c.get("world")).and_then(|w| w.get("accounts")))
        .iter()
        .map(|a| (jstr(a.get("id")), jstr(a.get("holder")), crate::js::jstr_or(a.get("balance"), "0")))
        .collect()
}

impl WorldStatic {
    /// The client's `world` object (the `/world` route): the static world without its occupancy, lots and accounts, with
    /// only the participants who are not persons, and the lots' cells.
    pub fn client_json(&self, extra_structures: &[String]) -> Value {
        let s = |x: &Option<String>| x.clone().map(Value::from);
        let structures: Vec<Value> = self
            .structures
            .iter()
            .map(|s| {
                Obj::new()
                    .set("id", s.id.clone())
                    .set("type", s.type_.clone())
                    .set("category", s.category.clone())
                    .set("x", s.x)
                    .set("y", s.y)
                    .set("w", num(s.w))
                    .set("h", num(s.h))
                    .set("spaces", s.spaces)
                    .set("levels", num(s.levels))
                    .build()
            })
            .collect();
        let persons: Vec<Value> = self
            .persons
            .iter()
            .map(|p| {
                Obj::new()
                    .set("id", p.id.clone())
                    .set("participant", p.participant.clone())
                    .opt("born", p.born.clone())
                    .opt("sex", p.sex.clone())
                    .opt("household", s(&p.household))
                    .opt("name", s(&p.name))
                    .build()
            })
            .collect();
        let orgs: Vec<Value> = self
            .orgs
            .iter()
            .map(|o| {
                Obj::new()
                    .set("id", o.id.clone())
                    .set("kind", o.kind.clone())
                    .set("name", o.name.clone())
                    .set("premises", o.premises.iter().map(|&i| Value::from(i)).collect::<Vec<_>>())
                    .build()
            })
            .collect();
        let posts: Vec<Value> = self
            .posts
            .iter()
            .map(|p| {
                Obj::new()
                    .set("id", p.id.clone())
                    .opt("entity", s(&p.entity))
                    .opt("title", s(&p.title))
                    .opt("role", s(&p.role))
                    .opt("holder", s(&p.holder))
                    .opt("code", s(&p.code))
                    .build()
            })
            .collect();
        let participants: Vec<Value> = self
            .participants
            .iter()
            .filter(|p| p.cls != Decider::Person)
            .map(|p| {
                Obj::new()
                    .set("id", p.id.clone())
                    .opt("kind", s(&p.kind))
                    .set("cls", class_name(p.cls))
                    .opt("impl", s(&p.imp))
                    .opt("model", s(&p.model))
                    .opt("title", s(&p.title))
                    .opt("person", s(&p.person))
                    .build()
            })
            .collect();
        let households: Vec<Value> = self
            .households
            .iter()
            .map(|h| Obj::new().set("id", h.id.clone()).set("members", h.members.clone()).opt("leaseholder", s(&h.leaseholder)).build())
            .collect();
        let jobs: Vec<Value> =
            self.jobs.iter().map(|(a, b, c)| Value::Array(vec![a.clone().into(), b.clone().into(), (*c).into()])).collect();
        let titles: Vec<Value> =
            self.titles.iter().map(|(l, h)| Obj::new().set("lot", l.clone()).set("holder", h.clone()).build()).collect();
        let water: Vec<Value> = self.water.iter().map(|(x, y)| Value::Array(vec![(*x).into(), (*y).into()])).collect();
        let lot_cells: Vec<Value> = self
            .lots
            .iter()
            .map(|(_, c)| Value::Array(c.iter().map(|(x, y)| Value::Array(vec![(*x).into(), (*y).into()])).collect()))
            .collect();
        Obj::new()
            .set("runId", self.run_id.clone())
            .set("name", self.name.clone())
            .set("description", self.description.clone())
            .set("seed", self.seed.clone())
            .set("currency", self.currency.clone())
            .set("ground", self.ground.clone())
            .set("water", water)
            .set("structures", structures)
            .set("persons", persons)
            .set("orgs", orgs)
            .set("posts", posts)
            .set("participants", participants)
            .set("households", households)
            .set("jobs", jobs)
            .set("titles", titles)
            .set("extraStructures", extra_structures.to_vec())
            .set("lotCells", lot_cells)
            .build()
    }
}
