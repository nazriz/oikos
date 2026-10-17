//! What a seat knows: everything it has observed, indexed for the resolver (P8). The resolver fills gaps and turns
//! names into ids only from this; it never looks at the world beyond what the seat has seen. Kept from each
//! observation the engine delivers (its changes), as translator/src/knowledge.ts did.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountFact {
    pub holder: String,
    pub custodian: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StructureFact {
    pub type_: String,
    pub at: String,
    pub spaces: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CellFact {
    pub x: i64,
    pub y: i64,
    pub terrain: Option<String>,
    pub built: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Knowledge {
    pub withdrawn: BTreeSet<String>,
    pub accounts: BTreeMap<String, AccountFact>,
    /// `at|kind` -> (kind, at).
    pub holdings: BTreeMap<String, (String, String)>,
    /// entity -> accounts it has asked to be paid into.
    pub stated: BTreeMap<String, BTreeSet<String>>,
    /// entity -> name, in the order first learned (a name found later for the same entity replaces it in place).
    pub names: Vec<(String, String)>,
    /// participant -> the person it acts as.
    pub participant_person: Vec<(String, String)>,
    /// Where each entity stands in `names`, and each participant in `participant_person` (kept with them by
    /// `set_ordered`, the only way into either): a directory of a whole town is taken in without looking through the
    /// list for each line of it.
    names_at: BTreeMap<String, usize>,
    participant_at: BTreeMap<String, usize>,
    /// position -> the organisation it acts for.
    pub positions: BTreeMap<String, String>,
    /// position -> what it's called, as the participant has been told: (its title, its role), either possibly empty.
    pub position_words: BTreeMap<String, (String, String)>,
    pub held: BTreeSet<String>,
    /// (What's known of a building is shared with whoever else was shown it the same.)
    pub structures: BTreeMap<String, Arc<StructureFact>>,
    pub cells: BTreeMap<String, CellFact>,
    /// lot -> its cells. (Shared with every seat that has seen the lot: a register of lots is shown to many. The
    /// map itself is a persistent one, so seats that learned the same register at one look share it too: `Registers`.)
    pub lots: Lots,
    /// Forms seen, by id (their statement records; shared likewise).
    pub forms: BTreeMap<Arc<str>, Arc<Value>>,
    /// Statements seen that are addressed to someone: who each is addressed to (whoever acts on it). What a hold on
    /// one is addressed to.
    pub addressed: BTreeMap<Arc<str>, Arc<[String]>>,
    /// A routine of the seat's office as its own procedure states it (a paper on its file): task -> the procedure,
    /// and the routine's published rhythm where it has one (how often, or the paper that sets when). What a standing
    /// work order that does not say how often follows.
    pub routines: BTreeMap<String, RoutineFact>,
    pub entity: String,
    pub t: i64,
    /// How the world's money is written (its config's first currency): how the resolver reads and writes amounts.
    /// Absent (a seat nothing has been said to about the world's money): amounts can't be read. (Not saved: whoever
    /// reads a snapshot back gives it the world's again.)
    #[serde(skip)]
    pub currency: Option<crate::calls::Currency>,
}

/// A routine as a procedure states it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RoutineFact {
    pub procedure: String,
    pub every: Option<i64>,
    pub schedule: Option<String>,
}

/// What a record adds to what a seat knows, worked out from the record alone (never from what the seat knew before):
/// the same for every seat it's shown to, so whoever delivers one record to many seats can work it out once.
#[derive(Debug, Clone, Default)]
pub struct RecordFacts {
    /// A withdrawal: the record it takes down.
    withdraws: Option<String>,
    /// An entity's declaration: the entity, and its name.
    declares: Option<(String, String)>,
    /// A form: its id, and the record itself.
    form: Option<(Arc<str>, Arc<Value>)>,
    /// A lot: its id, and its cells.
    lot: Option<(Arc<str>, Arc<[String]>)>,
    /// Someone asking to be paid names where the money should go: who, and the account.
    stated: Option<(String, String)>,
    /// A statement addressed to someone: its id, and who it is addressed to.
    addressed: Option<(Arc<str>, Arc<[String]>)>,
    /// A procedure that states routines: each task, as it states it.
    routines: Vec<(String, RoutineFact)>,
}

impl RecordFacts {
    pub fn of(r: &Value) -> RecordFacts {
        let mut facts = RecordFacts::default();
        let kind = s(&r["record"]).unwrap_or_default();
        if kind == "withdrawal" {
            facts.withdraws = s(&r["withdraws"]).map(String::from);
        }
        if kind == "entity_declaration" {
            if let (Some(e), Some(n)) = (s(&r["entity"]), s(&r["name"])) {
                facts.declares = Some((e.into(), n.into()));
            }
        }
        if kind == "statement" {
            let id: Arc<str> = s(&r["id"]).unwrap_or_default().into();
            if let Some(to) = r["addressed_to"].as_array().filter(|a| !a.is_empty()) {
                facts.addressed = Some((id.clone(), to.iter().filter_map(|x| x.as_str().map(String::from)).collect()));
            }
            if s(&r["kind"]) == Some("procedure") {
                for x in r["data"]["routines"].as_array().into_iter().flatten() {
                    if let Some(task) = s(&x["task"]) {
                        facts.routines.push((task.to_string(), RoutineFact { procedure: id.to_string(), every: x["every"].as_i64().filter(|e| *e > 0), schedule: s(&x["schedule"]).filter(|p| !p.is_empty()).map(String::from) }));
                    }
                }
            }
            match s(&r["kind"]) {
                Some("form") => facts.form = Some((id, Arc::new(r.clone()))),
                Some("lot") => {
                    if let Some(cells) = r["data"]["cells"].as_array() {
                        facts.lot = Some((id, cells.iter().filter_map(|c| c.as_str().map(String::from)).collect()));
                    }
                }
                _ => {}
            }
            // Someone asking to be paid names where the money should go.
            let m = &r["data"]["outcome"]["money"];
            if let (Some(who), Some(to)) = (s(&r["speaks_for"]), s(&m["to"])) {
                if m.get("from").is_none() {
                    facts.stated = Some((who.into(), to.into()));
                }
            }
        }
        facts
    }
}

/// What a cell of ground, as a sites channel shows it, adds to what a seat knows, worked out from that alone.
#[derive(Debug, Clone)]
pub struct CellFacts {
    cell: String,
    fact: CellFact,
    /// The building on it: its id, and what's known of it.
    structure: Option<(String, Arc<StructureFact>)>,
}

impl CellFacts {
    /// What a cell adds, said outright by whoever has the cell in a shape of its own: as `of` reads it from the
    /// cell's JSON (a terrain that is no word at all is none; a building is its id and what's known of it).
    pub fn new(cell: &str, x: i64, y: i64, terrain: Option<&str>, structure: Option<(&str, Arc<StructureFact>)>) -> CellFacts {
        CellFacts { cell: cell.to_string(), fact: CellFact { x, y, terrain: terrain.filter(|x| !x.is_empty()).map(String::from), built: structure.is_some() }, structure: structure.map(|(id, fact)| (id.to_string(), fact)) }
    }

    pub fn of(c: &Value) -> CellFacts {
        let st = &c["structure"];
        CellFacts {
            cell: s(&c["cell"]).unwrap_or_default().to_string(),
            fact: CellFact { x: c["x"].as_i64().unwrap_or(0), y: c["y"].as_i64().unwrap_or(0), terrain: s(&c["terrain"]).filter(|x| !x.is_empty()).map(String::from), built: st.is_object() },
            structure: st.is_object().then(|| {
                let spaces = st["spaces"].as_array().into_iter().flatten().filter_map(|sp| s(&sp["space"]).map(String::from)).collect();
                (s(&st["structure"]).unwrap_or_default().into(), Arc::new(StructureFact { type_: s(&st["type"]).unwrap_or_default().into(), at: s(&st["at"]).unwrap_or_default().into(), spaces }))
            }),
        }
    }
}

/// lot -> its cells.
pub type Lots = imbl::OrdMap<Arc<str>, Arc<[String]>>;

/// How long a list of lots is taken in as a whole.
const A_REGISTER: usize = 32;

/// How many registers are kept to be shared.
const REGISTERS_KEPT: usize = 8;

/// The registers of lots that seats have been shown whole, each with the map a seat that knew of no lot makes of it:
/// a town's register is shown, the same list, to every seat that reads it, and each seat's map of it would be the
/// same map. Kept by whoever holds many seats' knowledge (a session); never part of what any seat knows.
#[derive(Debug, Default)]
pub struct Registers {
    lists: Vec<(Vec<Arc<RecordFacts>>, Lots)>,
}

impl Registers {
    /// The map a seat that knows of no lot makes of this list, if every record in it is a lot and nothing more
    /// (learning them one by one from nothing gives exactly this map: each lot's cells, the last said of each).
    fn of(&mut self, list: &[Arc<RecordFacts>]) -> Option<Lots> {
        if list.len() < A_REGISTER || !list.iter().all(|f| f.lot.is_some() && f.withdraws.is_none() && f.declares.is_none() && f.form.is_none() && f.stated.is_none() && f.addressed.is_none() && f.routines.is_empty()) {
            return None;
        }
        if let Some((_, lots)) = self.lists.iter().find(|(known, _)| known.len() == list.len() && known.iter().zip(list).all(|(a, b)| Arc::ptr_eq(a, b))) {
            return Some(lots.clone());
        }
        let lots: Lots = list.iter().filter_map(|f| f.lot.clone()).collect();
        if self.lists.len() == REGISTERS_KEPT {
            self.lists.remove(0);
        }
        self.lists.push((list.to_vec(), lots.clone()));
        Some(lots)
    }
}

/// What a channel delivered that's handed to `Knowledge::absorb_with` beside the observation, in the order delivered:
/// what its records add (a records channel), or its cells (a sites channel).
#[derive(Debug, Clone, Default)]
pub struct Shown {
    pub records: Vec<Arc<RecordFacts>>,
    pub cells: Vec<Arc<CellFacts>>,
}

/// An observation as a seat's knowledge takes it in (`Knowledge::absorb_seen`): what it reads of one, and nothing
/// else of it. Read from the observation's JSON (`Seen::of`), or put together by whoever holds the observation in a
/// shape of its own (the same thing, read the same way: where JSON has no member, a word here is empty).
#[derive(Debug, Clone, Default)]
pub struct Seen<'a> {
    /// The seat's own entity (empty: none).
    pub entity: &'a str,
    pub t: Option<i64>,
    /// The positions it holds.
    pub positions: Vec<SeenPosition<'a>>,
    /// Its channels, by path, in path order.
    pub channels: Vec<(&'a str, SeenChannel<'a>)>,
}

#[derive(Debug, Clone)]
pub struct SeenPosition<'a> {
    pub position: &'a str,
    pub entity: &'a str,
    pub title: &'a str,
    pub role: &'a str,
}

#[derive(Debug, Clone)]
pub struct SeenAccount<'a> {
    pub account: &'a str,
    pub holder: &'a str,
    pub custodian: &'a str,
    pub closed: bool,
}

#[derive(Debug, Clone)]
pub struct SeenHolding<'a> {
    pub kind: &'a str,
    pub at: &'a str,
    /// Nothing is left of it there.
    pub gone: bool,
}

#[derive(Debug, Clone)]
pub struct SeenEntity<'a> {
    pub entity: &'a str,
    pub name: &'a str,
    pub participant: Option<&'a str>,
}

/// A channel as delivered: what a seat's knowledge reads of its kind. A records or sites channel's own records or
/// cells here are those in the observation itself; those handed over beside it are `Shown`.
#[derive(Debug, Clone)]
pub enum SeenChannel<'a> {
    Accounts(Vec<SeenAccount<'a>>),
    Holdings(Vec<SeenHolding<'a>>),
    Sites(Vec<CellFacts>),
    Directory { entities: Vec<SeenEntity<'a>>, positions: Vec<SeenPosition<'a>> },
    Records(Vec<RecordFacts>),
    Other,
}

impl<'a> Seen<'a> {
    /// An observation's JSON, read.
    pub fn of(obs: &'a Value) -> Seen<'a> {
        let list = |v: &'a Value| v.as_array().into_iter().flatten();
        let position = |p: &'a Value| Some(SeenPosition { position: s(&p["position"])?, entity: s(&p["entity"])?, title: s(&p["title"]).unwrap_or_default(), role: s(&p["role"]).unwrap_or_default() });
        Seen {
            entity: s(&obs["entity"]).unwrap_or_default(),
            t: obs["t"].as_i64(),
            positions: list(&obs["positions"]).filter_map(position).collect(),
            channels: obs["channels"]
                .as_object()
                .into_iter()
                .flat_map(|m| m.iter())
                .map(|(path, ch)| {
                    let channel = match s(&ch["kind"]) {
                        Some("accounts") => SeenChannel::Accounts(
                            list(&ch["accounts"])
                                .map(|a| SeenAccount { account: s(&a["account"]).unwrap_or_default(), holder: s(&a["holder"]).unwrap_or_default(), custodian: s(&a["custodian"]).unwrap_or_default(), closed: a["closed"].as_bool() == Some(true) })
                                .collect(),
                        ),
                        Some("holdings") => SeenChannel::Holdings(
                            list(&ch["holdings"]).map(|h| SeenHolding { kind: s(&h["kind"]).unwrap_or_default(), at: s(&h["at"]).unwrap_or_default(), gone: h["quantity"].as_str() == Some("0") }).collect(),
                        ),
                        Some("sites") => SeenChannel::Sites(list(&ch["cells"]).map(CellFacts::of).collect()),
                        Some("directory") => SeenChannel::Directory {
                            entities: list(&ch["entities"]).map(|e| SeenEntity { entity: s(&e["entity"]).unwrap_or_default(), name: s(&e["name"]).unwrap_or_default(), participant: s(&e["participant"]) }).collect(),
                            positions: list(&ch["positions"]).filter_map(position).collect(),
                        },
                        Some("records") => SeenChannel::Records(list(&ch["records"]).map(RecordFacts::of).collect()),
                        _ => SeenChannel::Other,
                    };
                    (path.as_str(), channel)
                })
                .collect(),
        }
    }
}

fn set_ordered(v: &mut Vec<(String, String)>, at: &mut BTreeMap<String, usize>, k: &str, val: &str) {
    debug_assert_eq!(at.get(k).copied(), v.iter().position(|(x, _)| x == k), "the list and where each stands in it disagree");
    match at.get(k) {
        Some(i) => v[*i].1 = val.to_string(),
        None => {
            at.insert(k.to_string(), v.len());
            v.push((k.to_string(), val.to_string()));
        }
    }
}

fn s(v: &Value) -> Option<&str> {
    v.as_str()
}

impl Knowledge {
    /// A seat that knows nothing yet, in a world whose money is written this way.
    pub fn new(currency: Option<crate::calls::Currency>) -> Self {
        Knowledge { currency, ..Default::default() }
    }

    pub fn absorb(&mut self, obs: &Value) {
        self.absorb_with(obs, &BTreeMap::new());
    }

    /// As `absorb`, for an observation whose records and cells are handed over beside it: `shown` has, by channel
    /// path, what each record (`RecordFacts::of`) or cell (`CellFacts::of`) that channel delivered adds, in the order
    /// delivered, and the observation's own `records` or `cells` there are empty. The same as absorbing the
    /// observation with them in place.
    pub fn absorb_with(&mut self, obs: &Value, shown: &BTreeMap<String, Shown>) {
        self.absorb_sharing(obs, shown, &mut Registers::default());
    }

    /// As `absorb_with`, by a holder of many seats' knowledge: a register of lots a seat is shown whole is held once
    /// between the seats shown it (`Registers`). What the seat knows is the same.
    pub fn absorb_sharing(&mut self, obs: &Value, shown: &BTreeMap<String, Shown>, registers: &mut Registers) {
        self.absorb_seen(&Seen::of(obs), shown, registers);
    }

    /// As `absorb_sharing`, for an observation read already (`Seen`): by whoever has it in a shape of its own, and
    /// needn't make JSON of it to say what it holds.
    pub fn absorb_seen(&mut self, obs: &Seen, shown: &BTreeMap<String, Shown>, registers: &mut Registers) {
        self.entity = obs.entity.to_string();
        self.t = obs.t.unwrap_or(self.t);
        for p in &obs.positions {
            self.positions.insert(p.position.into(), p.entity.into());
            self.position_words.insert(p.position.into(), (p.title.into(), p.role.into()));
            self.held.insert(p.position.into());
        }
        for (path, ch) in &obs.channels {
            match ch {
                SeenChannel::Accounts(accounts) => {
                    for a in accounts {
                        if a.closed {
                            self.accounts.remove(a.account);
                        } else {
                            self.accounts.insert(a.account.to_string(), AccountFact { holder: a.holder.into(), custodian: a.custodian.into() });
                        }
                    }
                }
                SeenChannel::Holdings(holdings) => {
                    for h in holdings {
                        let key = format!("{}|{}", h.at, h.kind);
                        if h.gone {
                            self.holdings.remove(&key);
                        } else {
                            self.holdings.insert(key, (h.kind.into(), h.at.into()));
                        }
                    }
                }
                SeenChannel::Sites(cells) => {
                    for c in cells {
                        self.see(c);
                    }
                    for facts in shown.get(*path).into_iter().flat_map(|x| &x.cells) {
                        self.see(facts);
                    }
                }
                SeenChannel::Directory { entities, positions } => {
                    for e in entities {
                        set_ordered(&mut self.names, &mut self.names_at, e.entity, e.name);
                        if let Some(p) = e.participant {
                            set_ordered(&mut self.participant_person, &mut self.participant_at, p, e.entity);
                        }
                    }
                    for p in positions {
                        self.positions.insert(p.position.into(), p.entity.into());
                        self.position_words.insert(p.position.into(), (p.title.into(), p.role.into()));
                    }
                }
                SeenChannel::Records(records) => {
                    for r in records {
                        self.learn(r);
                    }
                    let beside = shown.get(*path).map_or(&[][..], |x| &x.records);
                    // (A whole register of lots, to a seat that knows of none: the map of it, shared.)
                    match if self.lots.is_empty() { registers.of(beside) } else { None } {
                        Some(lots) => self.lots = lots,
                        None => {
                            for facts in beside {
                                self.learn(facts);
                            }
                        }
                    }
                }
                SeenChannel::Other => {}
            }
        }
    }

    /// Take in a cell as a sites channel showed it.
    fn see(&mut self, facts: &CellFacts) {
        self.cells.insert(facts.cell.clone(), facts.fact.clone());
        if let Some((id, structure)) = &facts.structure {
            self.structures.insert(id.clone(), structure.clone());
        }
    }

    /// Take in what a record adds.
    fn learn(&mut self, facts: &RecordFacts) {
        if let Some(w) = &facts.withdraws {
            self.withdrawn.insert(w.clone());
            self.lots.remove(w.as_str());
        }
        if let Some((e, n)) = &facts.declares {
            set_ordered(&mut self.names, &mut self.names_at, e, n);
        }
        if let Some((id, r)) = &facts.form {
            self.forms.insert(id.clone(), r.clone());
        }
        if let Some((id, cells)) = &facts.lot {
            self.lots.insert(id.clone(), cells.clone());
        }
        if let Some((who, to)) = &facts.stated {
            self.stated.entry(who.clone()).or_default().insert(to.clone());
        }
        if let Some((id, to)) = &facts.addressed {
            self.addressed.insert(id.clone(), to.clone());
        }
        for (task, fact) in &facts.routines {
            self.routines.insert(task.clone(), fact.clone());
        }
    }

    /// A routine as the seat's own procedure states it; none where no procedure it has seen names the task, or that
    /// procedure is withdrawn.
    pub fn routine(&self, task: &str) -> Option<&RoutineFact> {
        self.routines.get(task).filter(|r| !self.withdrawn.contains(&r.procedure))
    }

    fn name_of(&self, e: &str) -> Option<&str> {
        self.names_at.get(e).map(|i| self.names[*i].1.as_str())
    }

    /// The entity an id refers to: a participant's person, a position's organisation, or the entity itself.
    pub fn entity_of(&self, id: &str) -> String {
        self.participant_at.get(id).map(|i| self.participant_person[*i].1.clone()).or_else(|| self.positions.get(id).cloned()).unwrap_or_else(|| id.to_string())
    }

    /// The entity acting in a capacity: a position's organisation, or (as itself) the seat's own.
    pub fn acting_for(&self, as_: Option<&str>) -> String {
        as_.and_then(|a| self.positions.get(a)).filter(|x| !x.is_empty()).cloned().unwrap_or_else(|| self.entity.clone())
    }

    pub fn accounts_of(&self, entity: &str) -> Vec<String> {
        let mut out: BTreeSet<String> = self.accounts.iter().filter(|(_, a)| a.holder == entity).map(|(k, _)| k.clone()).collect();
        out.extend(self.stated.get(entity).into_iter().flatten().cloned());
        out.into_iter().collect()
    }

    pub fn is_account(&self, id: &str) -> bool {
        self.accounts.contains_key(id) || self.stated.values().any(|s| s.contains(id))
    }

    pub fn has_name(&self, e: &str) -> bool {
        self.name_of(e).is_some()
    }

    /// Entities with a name, as written (case aside).
    /// What a name the participant wrote refers to: the ids it could mean (one, if it's clear). In order, the first
    /// that finds anything: someone or something called that; an id written out ("works" for the post works; pilot 8:
    /// a letter to "works" came back "you don't know of anyone called works"); a post by its title or its role ("the
    /// works manager", "planning officer"). Tried as written, then without a leading "the" (translator/src/knowledge.ts
    /// is the same, word for word).
    pub fn by_name(&self, name: &str) -> Vec<String> {
        let written = name.trim().to_string();
        let lower = written.to_lowercase();
        let bare = match lower.strip_prefix("the") {
            Some(rest) if rest.starts_with(char::is_whitespace) => rest.trim_start().to_string(),
            _ => lower.clone(),
        };
        // ("the planning job", "the works office": the post, said with the word for a post.)
        let mut post = bare.clone();
        for word in ["job", "post", "position", "office"] {
            if let Some(rest) = bare.strip_suffix(word) {
                if rest.ends_with(char::is_whitespace) {
                    post = rest.trim_end().to_string();
                    break;
                }
            }
        }
        for (n, id) in [(lower.clone(), written), (bare.clone(), bare), (post.clone(), post)] {
            let mut called: Vec<String> = self.names.iter().filter(|(_, x)| x.to_lowercase() == n).map(|(k, _)| k.clone()).collect();
            called.sort();
            if !called.is_empty() {
                return called;
            }
            if self.names.iter().any(|(k, _)| *k == id) || self.positions.contains_key(&id) || self.participant_person.iter().any(|(k, _)| *k == id) {
                return vec![id];
            }
            // (A map in key order: sorted already.)
            let posts: Vec<String> = self
                .position_words
                .iter()
                .filter(|(_, (title, role))| {
                    let role = role.to_lowercase();
                    (!title.is_empty() && title.to_lowercase() == n) || (!role.is_empty() && (role == n || role.replace('_', " ") == n))
                })
                .map(|(k, _)| k.clone())
                .collect();
            if !posts.is_empty() {
                return posts;
            }
        }
        Vec::new()
    }

    pub fn name(&self, id: &str) -> String {
        let e = self.entity_of(id);
        match self.name_of(&e) {
            Some(n) if n != e => format!("{n} ({e})"),
            _ => e,
        }
    }

    pub fn places_holding(&self, kind: &str) -> Vec<String> {
        let mut v: Vec<String> = self.holdings.values().filter(|(k, _)| k == kind).map(|(_, at)| at.clone()).collect();
        v.sort();
        v
    }

    /// Standing forms (their records).
    pub fn standing_forms(&self) -> Vec<&Value> {
        // (An office's own stationery, the papers it issues, is known only to a seat that holds the office.)
        self.forms
            .values()
            .map(|f| &**f)
            .filter(|f| !self.withdrawn.contains(f["id"].as_str().unwrap_or_default()))
            .filter(|f| !(f["data"].get("writes").is_some_and(|w| !w.is_null()) && f["data"]["office"].as_str().is_some_and(|o| !self.held.contains(o))))
            .collect()
    }

    /// The standing form, by its name or its record's id, published by an institution a participant, position or
    /// entity id names (the latest).
    pub fn form(&self, to: &str, name: &str) -> Option<&Value> {
        let ent = self.entity_of(to);
        let named: Vec<&Value> = self.standing_forms().into_iter().filter(|f| f["data"]["form"].as_str() == Some(name) || f["id"].as_str() == Some(name)).collect();
        // One office's own form (a direction it takes, a paper it issues) is that office's: named by the office, it
        // is that one and no other of the same name.
        let offices: Vec<&Value> = named.iter().copied().filter(|f| f["data"]["office"].as_str() == Some(to)).collect();
        let among: Vec<&Value> = if !offices.is_empty() {
            offices
        } else {
            // (Named by anything else, one office's form is found only by its organisation itself: another office of
            // the same organisation is not where it goes.)
            named
                .into_iter()
                .filter(|f| f["data"]["office"].as_str().is_none() || f["speaks_for"].as_str() == Some(to))
                .filter(|f| {
                    f["author"].as_str() == Some(to)
                        || f["in_position"].as_str() == Some(to)
                        || f["speaks_for"].as_str() == Some(ent.as_str())
                        || f["data"]["submit_to"].as_array().is_some_and(|a| a.iter().any(|x| x.as_str() == Some(ent.as_str())))
                })
                .collect()
        };
        let mut best: Option<&Value> = None;
        for f in among {
            // (The latest; of several at once, the first seen.)
            if best.is_none_or(|b| f["at"].as_i64() > b["at"].as_i64()) {
                best = Some(f);
            }
        }
        best
    }

    /// Whose form it is, as a call's `to` names it: the office it is one office's form of, else the post it was made
    /// in, else whom it speaks for (or its author).
    pub fn form_of(f: &Value) -> String {
        f["data"]["office"].as_str().or(f["in_position"].as_str()).or(f["speaks_for"].as_str()).or(f["author"].as_str()).unwrap_or_default().to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_name_as_written_then_a_description() {
        let mut k = Knowledge::default();
        k.absorb(&json!({ "entity": "city", "t": 0, "positions": [], "channels": { "who": { "kind": "directory",
            "entities": [{ "entity": "builder", "name": "Millbrook Builders" }, { "entity": "bank", "name": "Millbrook Bank" }],
            "positions": [{ "position": "planning", "entity": "city", "role": "planning_officer", "title": "Planning Officer" },
                          { "position": "works", "entity": "city", "role": "works_manager" },
                          { "position": "clerk-a", "entity": "city", "role": "clerk" }, { "position": "clerk-b", "entity": "city", "role": "clerk" }] } } }));
        assert_eq!(k.by_name("Millbrook Builders"), vec!["builder"]);
        assert_eq!(k.by_name("works"), vec!["works"]);
        assert_eq!(k.by_name("the builder"), vec!["builder"]);
        assert_eq!(k.by_name("The Bank"), vec!["bank"]);
        assert_eq!(k.by_name("the planning officer"), vec!["planning"]);
        assert_eq!(k.by_name("works manager"), vec!["works"]);
        assert_eq!(k.by_name("the clerk"), vec!["clerk-a", "clerk-b"]); // two of them: the participant is asked which
        assert_eq!(k.by_name("the planning job"), vec!["planning"]);
        assert_eq!(k.by_name("works office"), vec!["works"]);
        assert!(k.by_name("the theatre").is_empty());
        assert!(k.by_name("thebuilder").is_empty());
    }

    /// A register of lots taken in whole, and shared, is what its records taken in one by one are.
    #[test]
    fn a_register_taken_in_whole_is_its_lots_taken_in_one_by_one() {
        let lot = |i: usize, cells: &[&str]| json!({ "id": format!("lot-{i}"), "record": "statement", "kind": "lot", "speaks_for": "city", "data": { "cells": cells } });
        let facts = |records: &[Value]| -> Vec<Arc<RecordFacts>> { records.iter().map(|r| Arc::new(RecordFacts::of(r))).collect() };
        let obs = json!({ "entity": "c1", "t": 5, "positions": [], "channels": { "lots": { "kind": "records", "records": [] } } });
        let shown = |list: &[Arc<RecordFacts>]| -> BTreeMap<String, Shown> { [("lots".to_string(), Shown { records: list.to_vec(), cells: vec![] })].into() };
        // One by one: what `learn` does with each, from nothing.
        let plain = |before: &Knowledge, list: &[Arc<RecordFacts>]| {
            let mut k = before.clone();
            k.absorb_with(&obs, &BTreeMap::new());
            for f in list {
                k.learn(f);
            }
            format!("{k:?}")
        };
        let mut many: Vec<Value> = (0..40).map(|i| lot(i, &[&format!("cell.{i}.0"), &format!("cell.{i}.1")])).collect();
        many.push(lot(3, &["cell.9.9"])); // said again: the last said stands
        let register = facts(&many);
        let mut registers = Registers::default();
        let mut seats: Vec<Knowledge> = vec![];
        for _ in 0..3 {
            let mut k = Knowledge::default();
            k.absorb_sharing(&obs, &shown(&register), &mut registers);
            assert_eq!(format!("{k:?}"), plain(&Knowledge::default(), &register));
            assert_eq!(k.lots.get("lot-3").map(|c| c.to_vec()), Some(vec!["cell.9.9".to_string()]));
            seats.push(k);
        }
        assert_eq!(registers.lists.len(), 1, "one register, made once for the three seats");
        // What a seat learns later is its own: the others' is as it was.
        let later = facts(&[lot(41, &["cell.41.0"]), json!({ "id": "w1", "record": "withdrawal", "withdraws": "lot-2" })]);
        let before = seats[0].clone();
        seats[0].absorb_sharing(&obs, &shown(&later), &mut registers);
        assert_eq!(format!("{:?}", seats[0]), plain(&before, &later));
        assert!(seats[0].lots.get("lot-2").is_none() && seats[1].lots.get("lot-2").is_some() && seats[1].lots.get("lot-41").is_none());
        // A list that isn't lots alone, a short one, and one shown to a seat that knows of a lot already: one by one.
        let mut mixed = many.clone();
        mixed.insert(7, json!({ "id": "w2", "record": "withdrawal", "withdraws": "lot-5" }));
        for (list, knows) in [(facts(&mixed), false), (facts(&many[..10]), false), (register.clone(), true)] {
            let mut k = Knowledge::default();
            if knows {
                k.absorb_sharing(&obs, &shown(&facts(&[lot(99, &["cell.0.0"])])), &mut registers);
            }
            let before = k.clone();
            k.absorb_sharing(&obs, &shown(&list), &mut registers);
            assert_eq!(format!("{k:?}"), plain(&before, &list));
        }
        assert_eq!(registers.lists.len(), 1);
        // The same lots in a list of its own (other records, as another look would hand them): a register of its own.
        let again = facts(&many);
        let mut k = Knowledge::default();
        k.absorb_sharing(&obs, &shown(&again), &mut registers);
        assert_eq!(format!("{k:?}"), plain(&Knowledge::default(), &again));
        assert_eq!(registers.lists.len(), 2);
    }
}
