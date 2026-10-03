//! What a seat knows: everything it has observed, indexed for the resolver (P8). The resolver fills gaps and turns
//! names into ids only from this; it never looks at the world beyond what the seat has seen. Kept from each
//! observation the engine delivers (its changes), as translator/src/knowledge.ts did.

use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone)]
pub struct AccountFact {
    pub holder: String,
    pub custodian: String,
}

#[derive(Debug, Clone)]
pub struct StructureFact {
    pub type_: String,
    pub at: String,
    pub spaces: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct CellFact {
    pub x: i64,
    pub y: i64,
    pub terrain: Option<String>,
    pub built: bool,
}

#[derive(Debug, Clone, Default)]
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
    /// position -> the organisation it acts for.
    pub positions: BTreeMap<String, String>,
    pub held: BTreeSet<String>,
    pub structures: BTreeMap<String, StructureFact>,
    pub cells: BTreeMap<String, CellFact>,
    /// lot -> its cells.
    pub lots: BTreeMap<String, Vec<String>>,
    /// Forms seen, by id (their statement records).
    pub forms: BTreeMap<String, Value>,
    pub entity: String,
    pub t: i64,
}

fn set_ordered(v: &mut Vec<(String, String)>, k: &str, val: &str) {
    match v.iter_mut().find(|(x, _)| x == k) {
        Some(e) => e.1 = val.to_string(),
        None => v.push((k.to_string(), val.to_string())),
    }
}

fn s(v: &Value) -> Option<&str> {
    v.as_str()
}

impl Knowledge {
    pub fn absorb(&mut self, obs: &Value) {
        self.entity = s(&obs["entity"]).unwrap_or_default().to_string();
        self.t = obs["t"].as_i64().unwrap_or(self.t);
        for p in obs["positions"].as_array().into_iter().flatten() {
            if let (Some(pos), Some(ent)) = (s(&p["position"]), s(&p["entity"])) {
                self.positions.insert(pos.into(), ent.into());
                self.held.insert(pos.into());
            }
        }
        for ch in obs["channels"].as_object().into_iter().flat_map(|m| m.values()) {
            match s(&ch["kind"]) {
                Some("accounts") => {
                    for a in ch["accounts"].as_array().into_iter().flatten() {
                        let id = s(&a["account"]).unwrap_or_default().to_string();
                        if a["closed"].as_bool() == Some(true) {
                            self.accounts.remove(&id);
                        } else {
                            self.accounts.insert(id, AccountFact { holder: s(&a["holder"]).unwrap_or_default().into(), custodian: s(&a["custodian"]).unwrap_or_default().into() });
                        }
                    }
                }
                Some("holdings") => {
                    for h in ch["holdings"].as_array().into_iter().flatten() {
                        let (kind, at) = (s(&h["kind"]).unwrap_or_default(), s(&h["at"]).unwrap_or_default());
                        let key = format!("{at}|{kind}");
                        if h["quantity"].as_str() == Some("0") {
                            self.holdings.remove(&key);
                        } else {
                            self.holdings.insert(key, (kind.into(), at.into()));
                        }
                    }
                }
                Some("sites") => {
                    for c in ch["cells"].as_array().into_iter().flatten() {
                        let id = s(&c["cell"]).unwrap_or_default().to_string();
                        let st = &c["structure"];
                        self.cells.insert(id, CellFact { x: c["x"].as_i64().unwrap_or(0), y: c["y"].as_i64().unwrap_or(0), terrain: s(&c["terrain"]).filter(|x| !x.is_empty()).map(String::from), built: st.is_object() });
                        if st.is_object() {
                            let spaces = st["spaces"].as_array().into_iter().flatten().filter_map(|sp| s(&sp["space"]).map(String::from)).collect();
                            self.structures.insert(s(&st["structure"]).unwrap_or_default().into(), StructureFact { type_: s(&st["type"]).unwrap_or_default().into(), at: s(&st["at"]).unwrap_or_default().into(), spaces });
                        }
                    }
                }
                Some("directory") => {
                    for e in ch["entities"].as_array().into_iter().flatten() {
                        let id = s(&e["entity"]).unwrap_or_default();
                        set_ordered(&mut self.names, id, s(&e["name"]).unwrap_or_default());
                        if let Some(p) = s(&e["participant"]) {
                            set_ordered(&mut self.participant_person, p, id);
                        }
                    }
                    for p in ch["positions"].as_array().into_iter().flatten() {
                        if let (Some(pos), Some(ent)) = (s(&p["position"]), s(&p["entity"])) {
                            self.positions.insert(pos.into(), ent.into());
                        }
                    }
                }
                Some("records") => {
                    for r in ch["records"].as_array().into_iter().flatten() {
                        self.add(r);
                    }
                }
                _ => {}
            }
        }
    }

    fn add(&mut self, r: &Value) {
        let kind = s(&r["record"]).unwrap_or_default();
        if kind == "withdrawal" {
            if let Some(w) = s(&r["withdraws"]) {
                self.withdrawn.insert(w.into());
                self.lots.remove(w);
            }
        }
        if kind == "entity_declaration" {
            if let (Some(e), Some(n)) = (s(&r["entity"]), s(&r["name"])) {
                set_ordered(&mut self.names, e, n);
            }
        }
        if kind == "statement" {
            let id = s(&r["id"]).unwrap_or_default().to_string();
            match s(&r["kind"]) {
                Some("form") => {
                    self.forms.insert(id.clone(), r.clone());
                }
                Some("lot") => {
                    if let Some(cells) = r["data"]["cells"].as_array() {
                        self.lots.insert(id.clone(), cells.iter().filter_map(|c| c.as_str().map(String::from)).collect());
                    }
                }
                _ => {}
            }
            // Someone asking to be paid names where the money should go.
            let m = &r["data"]["outcome"]["money"];
            if let (Some(who), Some(to)) = (s(&r["speaks_for"]), s(&m["to"])) {
                if m.get("from").is_none() {
                    self.stated.entry(who.into()).or_default().insert(to.into());
                }
            }
        }
    }

    fn name_of(&self, e: &str) -> Option<&str> {
        self.names.iter().find(|(k, _)| k == e).map(|(_, v)| v.as_str())
    }

    /// The entity an id refers to: a participant's person, a position's organisation, or the entity itself.
    pub fn entity_of(&self, id: &str) -> String {
        self.participant_person.iter().find(|(k, _)| k == id).map(|(_, v)| v.clone()).or_else(|| self.positions.get(id).cloned()).unwrap_or_else(|| id.to_string())
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
    pub fn by_name(&self, name: &str) -> Vec<String> {
        let n = name.trim().to_lowercase();
        let mut v: Vec<String> = self.names.iter().filter(|(_, x)| x.to_lowercase() == n).map(|(k, _)| k.clone()).collect();
        v.sort();
        // (An id written in quotes is that id: "works" for the post works. Pilot 8: a letter to "works" came back
        // "you don't know of anyone called works".)
        let id = name.trim();
        if v.is_empty() && (self.names.iter().any(|(k, _)| k == id) || self.positions.contains_key(id) || self.participant_person.iter().any(|(k, _)| k == id)) {
            v.push(id.to_string());
        }
        v
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
        self.forms.values().filter(|f| !self.withdrawn.contains(f["id"].as_str().unwrap_or_default())).collect()
    }

    /// The standing form, by its name or its record's id, published by an institution a participant, position or
    /// entity id names (the latest).
    pub fn form(&self, to: &str, name: &str) -> Option<&Value> {
        let ent = self.entity_of(to);
        let mut best: Option<&Value> = None;
        for f in self.standing_forms().into_iter().filter(|f| {
                (f["data"]["form"].as_str() == Some(name) || f["id"].as_str() == Some(name))
                    && (f["author"].as_str() == Some(to)
                        || f["in_position"].as_str() == Some(to)
                        || f["speaks_for"].as_str() == Some(ent.as_str())
                        || f["data"]["submit_to"].as_array().is_some_and(|a| a.iter().any(|x| x.as_str() == Some(ent.as_str()))))
        }) {
            // (The latest; of several at once, the first seen.)
            if best.is_none_or(|b| f["at"].as_i64() > b["at"].as_i64()) {
                best = Some(f);
            }
        }
        best
    }
}
