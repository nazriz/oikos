//! Land as an owner's papers show it (institutions.ts `ownerOf`, `ownLand`): who holds the title to a lot, and the lots
//! an owner holds with what stands on them. Read from the book alone, so the office that reads it (the mayor, the
//! planning officer, the registry) knows only what it has been shown (docs/no-god-view.md).

use crate::common::{cells_of, filed_before, Book, ClaimKey};
use oikos_sight::RecordBody;
use serde_json::Value;
use std::collections::BTreeMap;

/// A lot an owner holds: its cells and the structures its papers show on it, each with its type.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OwnLot {
    pub lot: String,
    pub cells: Vec<String>,
    pub structures: Vec<(String, String)>,
}

/// The holder of the standing title to a lot: the title's holder, after each transfer made by the holder or by whoever
/// issued the title (the land registry: a death's transmission, say).
pub fn owner_of(book: &Book, lot: &str) -> Option<String> {
    let titles: Vec<_> = book
        .claims_by(ClaimKey::Object, lot)
        .filter(|c| matches!(&c.body, RecordBody::Claim { about, .. } if about.get("kind").and_then(Value::as_str) == Some("ownership")) && !book.released(&c.id) && !book.withdrawn(&c.id))
        .collect();
    let mut holder = None;
    for c in &titles {
        if let RecordBody::Claim { holder: h, .. } = &c.body {
            holder = Some(h.clone());
        }
    }
    for r in book.of_type("claim_transfer") {
        if let RecordBody::ClaimTransfer { claim, to } = &r.body {
            if let Some(c) = titles.iter().find(|x| &x.id == claim) {
                if r.speaks_for.as_ref() == holder.as_ref() || r.speaks_for == c.speaks_for {
                    holder = Some(to.clone());
                }
            }
        }
    }
    holder
}

/// The land an owner holds, as its papers show it: its latest asset register, titles that have come to it since, and
/// the building notices addressed to it (a structure put up, or taken down), sorted by lot.
pub fn own_land(book: &Book, owner: &str) -> Vec<OwnLot> {
    let mut lots: BTreeMap<String, OwnLot> = BTreeMap::new();
    let register = book.open("asset_register").filter(|r| r.speaks_for.as_deref() == Some(owner)).max_by_key(|r| r.at);
    if let Some(reg) = register {
        for a in crate::common::data(reg).get("assets").and_then(Value::as_array).into_iter().flatten() {
            let Some(lot) = a.get("lot").and_then(Value::as_str) else { continue };
            let x = lots.entry(lot.to_string()).or_insert_with(|| OwnLot {
                lot: lot.to_string(),
                cells: a.get("cells").and_then(Value::as_array).map(|c| c.iter().filter_map(Value::as_str).map(String::from).collect()).unwrap_or_default(),
                structures: vec![],
            });
            if let (Some(s), Some(ty)) = (a.get("structure").and_then(Value::as_str), a.get("type").and_then(Value::as_str)) {
                if !s.is_empty() && !ty.is_empty() {
                    x.structures.push((s.to_string(), ty.to_string()));
                }
            }
        }
    }
    let own_cells = |lot: &str| cells_of(book, lot).into_iter().map(String::from).collect::<Vec<_>>();
    // (Land that has come to it since: its titles are its own papers.)
    for c in book.claims_by(ClaimKey::Holder, owner) {
        if let RecordBody::Claim { about, .. } = &c.body {
            if about.get("kind").and_then(Value::as_str) == Some("ownership") {
                if let Some(o) = about.get("object").and_then(Value::as_str) {
                    lots.entry(o.to_string()).or_insert_with(|| OwnLot { lot: o.to_string(), cells: own_cells(o), structures: vec![] });
                }
            }
        }
    }
    for r in book.of_type("claim_transfer") {
        if let RecordBody::ClaimTransfer { claim, to } = &r.body {
            if to != owner {
                continue;
            }
            if let Some(c) = book.get(claim) {
                if let RecordBody::Claim { about, .. } = &c.body {
                    if about.get("kind").and_then(Value::as_str) == Some("ownership") {
                        if let Some(o) = about.get("object").and_then(Value::as_str) {
                            lots.entry(o.to_string()).or_insert_with(|| OwnLot { lot: o.to_string(), cells: own_cells(o), structures: vec![] });
                        }
                    }
                }
            }
        }
    }
    let mut notices: Vec<_> = book.open("building_notice").filter(|n| crate::common::addressed_to(n).iter().any(|a| a == owner)).collect();
    notices.sort_by(|a, b| a.at.cmp(&b.at).then_with(|| filed_before(&a.id, &b.id)));
    for n in notices {
        let d = crate::common::data(n);
        if let Some(removes) = d.get("removes").and_then(Value::as_str) {
            for x in lots.values_mut() {
                x.structures.retain(|(s, _)| s != removes);
            }
        } else if let (Some(lot), Some(structure)) = (d.get("lot").and_then(Value::as_str), d.get("structure").and_then(Value::as_str)) {
            if let Some(x) = lots.get_mut(lot) {
                if !x.structures.iter().any(|(s, _)| s == structure) {
                    x.structures.push((structure.to_string(), d.get("structure_type").and_then(Value::as_str).unwrap_or("").to_string()));
                }
            }
        }
    }
    lots.into_values().filter(|x| owner_of(book, &x.lot).as_deref() == Some(owner)).collect()
}
