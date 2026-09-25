//! Applying blocks and scheduled effects to a State. Blocks run against a
//! scratch copy of the state; the caller commits it only if every block in the
//! action succeeds, which is what makes actions atomic.

use crate::blocks::{AgreementDecision, AgreementTerms, Block, CreatableKind, Decision, Id, ParcelScope, RightKind, Rule};
use crate::canon::MAX_SAFE;
use crate::config::{EntityKind, Level};
use crate::events::{Event, EventDecision, EventName, OneOrMany, Reason, RefusalCode, Timed};
use crate::laws::{self, Statics};
use crate::state::{
    Agreement, AgreementStatus, EndReason, Entity, Message, Outcome, OutcomeStatus, Proposal, Right, Sched, Scheduled, SeatStatus, State,
    Structure,
};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Refusal {
    pub code: RefusalCode,
    pub block: Option<usize>,
    pub detail: Option<String>,
}

pub fn refuse(code: RefusalCode, detail: impl Into<String>) -> Refusal {
    Refusal { code, block: None, detail: Some(detail.into()) }
}

pub type R<T> = Result<T, Refusal>;

pub const MAX_TEXT: usize = 16384;
pub const MAX_NAME: usize = 200;
pub const MAX_MEMO: usize = 500;

pub struct Exec<'a> {
    pub s: &'a Statics,
    pub st: &'a mut State,
    /// The acting seat; None for scheduled effects.
    pub seat: Option<&'a str>,
    /// Local refs bound so far in this action.
    pub refs: BTreeMap<String, Id>,
    pub events: Vec<Timed>,
    /// Proposals whose last approval arrived in this action; applied after commit.
    pub triggered: Vec<(Id, Proposal)>,
}

pub struct ExecResult {
    pub events: Vec<Timed>,
    pub created: BTreeMap<String, Id>,
    pub triggered: Vec<(Id, Proposal)>,
}

/// Apply `blocks` for `seat` to `st`. On error, `st` is left partly modified
/// and must be discarded.
pub fn exec_action(s: &Statics, st: &mut State, seat: &str, blocks: &[Block]) -> R<ExecResult> {
    let mut ex = Exec { s, st, seat: Some(seat), refs: BTreeMap::new(), events: vec![], triggered: vec![] };
    for (i, b) in blocks.iter().enumerate() {
        ex.block(b).map_err(|mut r| {
            r.block.get_or_insert(i);
            r
        })?;
    }
    Ok(ExecResult { events: ex.events, created: ex.refs, triggered: ex.triggered })
}

fn check_len(s: &str, max: usize, what: &str, allow_empty: bool) -> R<()> {
    let n = s.chars().count();
    if n > max || (!allow_empty && n == 0) {
        return Err(refuse(RefusalCode::Malformed, format!("{what} must be {}..={max} characters", if allow_empty { 0 } else { 1 })));
    }
    Ok(())
}

fn positive(x: i64, what: &str) -> R<i64> {
    if (1..=MAX_SAFE).contains(&x) {
        Ok(x)
    } else {
        Err(refuse(RefusalCode::Malformed, format!("{what} must be between 1 and 2^53-1")))
    }
}

fn entity_kind_name(k: EntityKind) -> &'static str {
    match k {
        EntityKind::Person => "person",
        EntityKind::Government => "government",
        EntityKind::Council => "council",
        EntityKind::Agency => "agency",
        EntityKind::Firm => "firm",
        EntityKind::Trust => "trust",
        EntityKind::Union => "union",
        EntityKind::Club => "club",
        EntityKind::Cooperative => "cooperative",
        EntityKind::Boundary => "boundary",
    }
}

fn from_creatable(k: CreatableKind) -> EntityKind {
    match k {
        CreatableKind::Firm => EntityKind::Firm,
        CreatableKind::Trust => EntityKind::Trust,
        CreatableKind::Agency => EntityKind::Agency,
        CreatableKind::Union => EntityKind::Union,
        CreatableKind::Club => EntityKind::Club,
        CreatableKind::Cooperative => EntityKind::Cooperative,
    }
}

impl<'a> Exec<'a> {
    fn now(&self) -> i64 {
        self.st.t
    }

    pub fn emit(&mut self, e: Event) {
        self.events.push(Timed { t: self.st.t, event: e });
    }

    fn principal(&self) -> Id {
        let seat = self.seat.expect("block executed without a seat");
        self.s.seats[seat].principal.clone()
    }

    /// Resolve an id or `$ref`.
    fn r(&self, x: &str) -> R<Id> {
        match x.strip_prefix('$') {
            Some(name) => self
                .refs
                .get(name)
                .cloned()
                .ok_or_else(|| refuse(RefusalCode::UnknownRef, format!("${name} is not bound earlier in this action"))),
            None => Ok(x.to_string()),
        }
    }

    fn bind(&mut self, name: &Option<String>, id: &str) -> R<()> {
        if let Some(n) = name {
            if self.refs.insert(n.clone(), id.to_string()).is_some() {
                return Err(refuse(RefusalCode::DuplicateRef, format!("${n} is bound twice")));
            }
        }
        Ok(())
    }

    fn active(&self, id: &str) -> R<()> {
        match self.st.entities.get(id) {
            None => Err(refuse(RefusalCode::UnknownEntity, format!("no entity {id}"))),
            Some(e) if !e.active => Err(refuse(RefusalCode::EntityInactive, format!("{id} has been dissolved"))),
            Some(_) => Ok(()),
        }
    }

    fn actable(&self, id: &str) -> R<()> {
        self.active(id)?;
        let p = self.principal();
        if laws::can_act_for(self.st, &p, id) {
            Ok(())
        } else {
            Err(refuse(RefusalCode::NotAuthorized, format!("this seat cannot act for {id}")))
        }
    }

    /// A time `d` seconds from now, rounded up to a tick.
    fn later(&self, d: i64, what: &str) -> R<i64> {
        let d = positive(d, what)?;
        let at = self.now() + self.s.span(d);
        if at > MAX_SAFE {
            return Err(refuse(RefusalCode::Overflow, format!("{what} ends beyond the representable time range")));
        }
        Ok(at)
    }

    fn outcome(&mut self, seat: &str, o: Outcome) {
        if let Some(s) = self.st.seats.get_mut(seat) {
            s.new_outcomes.push(o);
        }
    }

    /// Move money. Every movement of money in the world goes through here and
    /// emits exactly one `transfer` event.
    pub fn pay(&mut self, from: &str, to: &str, amount: i64, reason: Reason, agreement: Option<&str>) -> R<()> {
        positive(amount, "amount")?;
        if from == self.s.boundary {
            return Err(refuse(RefusalCode::BoundaryProtected, "nobody may draw from the boundary"));
        }
        self.active(from)?;
        self.active(to)?;
        let fb = self.st.entities[from].balance;
        if fb < amount {
            return Err(refuse(RefusalCode::InsufficientFunds, format!("{from} holds {fb}, needs {amount}")));
        }
        if from != to {
            let tb = self.st.entities[to].balance;
            if tb.checked_add(amount).is_none_or(|x| x > MAX_SAFE) {
                return Err(refuse(RefusalCode::Overflow, format!("{to}'s balance would exceed 2^53-1")));
            }
            self.st.entities.get_mut(from).unwrap().balance -= amount;
            self.st.entities.get_mut(to).unwrap().balance += amount;
        }
        let mut e = Event::new(EventName::Transfer);
        e.from = Some(from.into());
        e.to = Some(OneOrMany::One(to.into()));
        e.amount = Some(amount);
        e.reason = Some(reason);
        e.agreement = agreement.map(Into::into);
        self.emit(e);
        Ok(())
    }

    pub fn end_agreement(&mut self, id: &str, reason: Reason) {
        let Some(a) = self.st.agreements.remove(id) else { return };
        let mut e = Event::new(EventName::AgreementEnded);
        e.agreement = Some(id.into());
        e.reason = Some(reason);
        self.emit(e);
        if let Some(r) = a.use_right {
            if self.st.rights.remove(&r).is_some() {
                let mut e = Event::new(EventName::RightEnded);
                e.right = Some(r);
                e.reason = Some(Reason::AgreementEnded);
                e.agreement = Some(id.into());
                self.emit(e);
            }
        }
    }

    fn resolve_terms(&self, t: &AgreementTerms) -> R<AgreementTerms> {
        Ok(match t.clone() {
            AgreementTerms::Lease { lessor, lessee, parcel, units, rent, period, term, notice } => {
                AgreementTerms::Lease { lessor: self.r(&lessor)?, lessee: self.r(&lessee)?, parcel, units, rent, period, term, notice }
            }
            AgreementTerms::Employment { employer, employee, workplace, wage, period, term, notice } => AgreementTerms::Employment {
                employer: self.r(&employer)?,
                employee: self.r(&employee)?,
                workplace,
                wage,
                period,
                term,
                notice,
            },
        })
    }

    /// Laws a lease must satisfy both when offered and when it activates.
    fn lease_checks(&self, lessor: &str, parcel: &str, units: u32, rent: i64, period: i64) -> R<()> {
        if !self.st.parcels.contains_key(parcel) {
            return Err(refuse(RefusalCode::UnknownParcel, format!("no parcel {parcel}")));
        }
        if !laws::holds_surface(self.st, parcel, lessor) {
            return Err(refuse(RefusalCode::RightNotHeld, format!("{lessor} does not hold the surface right on {parcel}")));
        }
        let sid = self.st.parcels[parcel]
            .structure
            .clone()
            .ok_or_else(|| refuse(RefusalCode::UnknownStructure, format!("nothing is built on {parcel}")))?;
        let s = &self.st.structures[&sid];
        if !s.complete {
            return Err(refuse(RefusalCode::StructureIncomplete, format!("{sid} is still under construction")));
        }
        let capacity = self.s.types[&s.structure_type].units as u64;
        let leased = laws::leased_units(self.st, parcel);
        if leased + units as u64 > capacity {
            return Err(refuse(RefusalCode::CapacityExceeded, format!("{sid} has {capacity} units, {leased} already let")));
        }
        if let Some(cap) = laws::rent_cap(self.s, self.st, parcel, false) {
            if !laws::within_rent_cap(rent, units, period, cap) {
                return Err(refuse(RefusalCode::RentCapViolation, format!("rent exceeds the cap of {cap} per unit per 30 days")));
            }
        }
        Ok(())
    }

    fn activate(&mut self, id: &str) -> R<()> {
        let a = self.st.agreements[id].clone();
        if let AgreementTerms::Lease { lessor, parcel, units, rent, period, .. } = &a.terms {
            self.lease_checks(lessor, parcel, *units, *rent, *period)?;
        }
        let now = self.now();
        let ends_at = a.terms.term().map(|t| self.later(t, "term")).transpose()?;
        let first_payment = if a.terms.is_lease() { now } else { self.later(a.terms.period(), "period")? };
        let mut use_right = None;
        if let AgreementTerms::Lease { lessor, lessee, parcel, units, .. } = &a.terms {
            let rid = self.st.mint("rgt");
            self.st.rights.insert(
                rid.clone(),
                Right {
                    parcel: parcel.clone(),
                    kind: RightKind::Use,
                    holder: lessee.clone(),
                    grantor: Some(lessor.clone()),
                    until: ends_at,
                    units: Some(*units),
                    revocable: false,
                    under: Some(id.into()),
                },
            );
            let mut e = Event::new(EventName::RightCreated);
            e.right = Some(rid.clone());
            e.parcel = Some(parcel.clone());
            e.right_kind = Some(RightKind::Use);
            e.holder = Some(lessee.clone());
            e.grantor = Some(lessor.clone());
            e.units = Some(*units);
            e.until = ends_at;
            e.agreement = Some(id.into());
            self.emit(e);
            use_right = Some(rid);
        }
        self.st.schedule(first_payment, Sched::Payment { agreement: id.into() });
        if let Some(e) = ends_at {
            self.st.schedule(e, Sched::AgreementEnd { agreement: id.into() });
        }
        let ag = self.st.agreements.get_mut(id).unwrap();
        ag.status = AgreementStatus::Active;
        ag.activated_at = Some(now);
        ag.ends_at = ends_at;
        ag.end_reason = ends_at.map(|_| EndReason::Expired);
        ag.next_payment_at = Some(first_payment);
        ag.use_right = use_right;
        let mut e = Event::new(EventName::AgreementActivated);
        e.agreement = Some(id.into());
        self.emit(e);
        Ok(())
    }

    pub fn block(&mut self, b: &Block) -> R<()> {
        match b {
            Block::CreateEntity { founder, kind, name, controller, bind } => {
                let founder = self.r(founder)?;
                self.actable(&founder)?;
                check_len(name, MAX_NAME, "name", false)?;
                let controller = match controller {
                    Some(c) => self.r(c)?,
                    None => founder.clone(),
                };
                self.active(&controller)?;
                if self.st.counters.created_entities >= self.s.config.caps.max_created_entities {
                    return Err(refuse(
                        RefusalCode::CapExceeded,
                        format!("the world allows {} created entities", self.s.config.caps.max_created_entities),
                    ));
                }
                let id = self.st.mint("ent");
                self.st.counters.created_entities += 1;
                let ek = from_creatable(*kind);
                self.st.entities.insert(
                    id.clone(),
                    Entity { kind: ek, name: name.clone(), controller: Some(controller.clone()), balance: 0, active: true },
                );
                let mut e = Event::new(EventName::EntityCreated);
                e.entity = Some(id.clone());
                e.entity_kind = Some(entity_kind_name(ek).into());
                e.name = Some(name.clone());
                e.founder = Some(founder);
                e.controller = Some(controller);
                self.emit(e);
                self.bind(bind, &id)
            }

            Block::DissolveEntity { entity, successor } => {
                let ent = self.r(entity)?;
                self.actable(&ent)?;
                let kind = self.st.entities[&ent].kind;
                if !matches!(
                    kind,
                    EntityKind::Firm
                        | EntityKind::Trust
                        | EntityKind::Agency
                        | EntityKind::Union
                        | EntityKind::Club
                        | EntityKind::Cooperative
                ) {
                    return Err(refuse(RefusalCode::InvalidKind, format!("a {} cannot be dissolved", entity_kind_name(kind))));
                }
                if self.s.jurisdictions.contains_key(&ent) {
                    return Err(refuse(RefusalCode::InvalidState, format!("{ent} holds a jurisdiction")));
                }
                let succ = self.r(successor)?;
                self.active(&succ)?;
                if succ == ent || laws::can_act_for(self.st, &ent, &succ) {
                    return Err(refuse(RefusalCode::InvalidState, "the successor must not be the entity or controlled by it"));
                }
                let ags: Vec<Id> =
                    self.st.agreements.iter().filter(|(_, a)| a.terms.parties().contains(&ent.as_str())).map(|(k, _)| k.clone()).collect();
                for a in ags {
                    self.end_agreement(&a, Reason::Dissolution);
                }
                let bal = self.st.entities[&ent].balance;
                if bal > 0 {
                    self.pay(&ent, &succ, bal, Reason::Dissolution, None)?;
                }
                let held: Vec<Id> = self.st.rights.iter().filter(|(_, r)| r.holder == ent).map(|(k, _)| k.clone()).collect();
                for rid in held {
                    self.st.rights.get_mut(&rid).unwrap().holder = succ.clone();
                    let mut e = Event::new(EventName::RightTransferred);
                    e.right = Some(rid);
                    e.from = Some(ent.clone());
                    e.to = Some(OneOrMany::One(succ.clone()));
                    self.emit(e);
                }
                for r in self.st.rights.values_mut().filter(|r| r.grantor.as_deref() == Some(ent.as_str())) {
                    r.grantor = Some(succ.clone());
                }
                for s in self.st.structures.values_mut().filter(|s| s.owner == ent) {
                    s.owner = succ.clone();
                }
                for e in self.st.entities.values_mut().filter(|e| e.controller.as_deref() == Some(ent.as_str())) {
                    e.controller = Some(succ.clone());
                }
                self.st.entities.get_mut(&ent).unwrap().active = false;
                let mut e = Event::new(EventName::EntityDissolved);
                e.entity = Some(ent);
                e.successor = Some(succ);
                self.emit(e);
                Ok(())
            }

            Block::Transfer { from, to, amount, memo } => {
                let from = self.r(from)?;
                let to = self.r(to)?;
                if let Some(m) = memo {
                    check_len(m, MAX_MEMO, "memo", true)?;
                }
                if from == self.s.boundary {
                    return Err(refuse(RefusalCode::BoundaryProtected, "nobody may draw from the boundary"));
                }
                self.actable(&from)?;
                self.pay(&from, &to, *amount, Reason::Block, None)
            }

            Block::TransferRight { right, to } => {
                let r = self.st.rights.get(right).cloned().ok_or_else(|| refuse(RefusalCode::UnknownRight, format!("no right {right}")))?;
                self.actable(&r.holder)?;
                if r.grantor.is_some() || r.under.is_some() {
                    return Err(refuse(RefusalCode::RightNotTransferable, "derived rights cannot be transferred"));
                }
                let to = self.r(to)?;
                self.active(&to)?;
                if r.kind == RightKind::Surface
                    && self.st.rights.values().any(|o| o.parcel == r.parcel && o.grantor.as_deref() == Some(r.holder.as_str()))
                {
                    return Err(refuse(RefusalCode::InvalidState, format!("{} is encumbered by rights granted from it", r.parcel)));
                }
                self.st.rights.get_mut(right).unwrap().holder = to.clone();
                if r.kind == RightKind::Surface {
                    // Structures are fixtures: they pass with the surface right.
                    if let Some(sid) = self.st.parcels[&r.parcel].structure.clone() {
                        let s = self.st.structures.get_mut(&sid).unwrap();
                        if s.owner == r.holder {
                            s.owner = to.clone();
                        }
                    }
                }
                let mut e = Event::new(EventName::RightTransferred);
                e.right = Some(right.clone());
                e.from = Some(r.holder);
                e.to = Some(OneOrMany::One(to));
                self.emit(e);
                Ok(())
            }

            Block::GrantRight { grantor, parcel, kind, to, units, duration, revocable, bind } => {
                let grantor = self.r(grantor)?;
                self.actable(&grantor)?;
                if !self.st.parcels.contains_key(parcel) {
                    return Err(refuse(RefusalCode::UnknownParcel, format!("no parcel {parcel}")));
                }
                if !laws::holds_surface(self.st, parcel, &grantor) {
                    return Err(refuse(RefusalCode::RightNotHeld, format!("{grantor} does not hold the surface right on {parcel}")));
                }
                let to = self.r(to)?;
                self.active(&to)?;
                if *units == Some(0) {
                    return Err(refuse(RefusalCode::Malformed, "units must be at least 1"));
                }
                let until = duration.map(|d| self.later(d, "duration")).transpose()?;
                let id = self.st.mint("rgt");
                let kind: RightKind = (*kind).into();
                self.st.rights.insert(
                    id.clone(),
                    Right {
                        parcel: parcel.clone(),
                        kind,
                        holder: to.clone(),
                        grantor: Some(grantor.clone()),
                        until,
                        units: *units,
                        revocable: *revocable,
                        under: None,
                    },
                );
                if let Some(u) = until {
                    self.st.schedule(u, Sched::RightExpire { right: id.clone() });
                }
                let mut e = Event::new(EventName::RightCreated);
                e.right = Some(id.clone());
                e.parcel = Some(parcel.clone());
                e.right_kind = Some(kind);
                e.holder = Some(to);
                e.grantor = Some(grantor);
                e.units = *units;
                e.until = until;
                self.emit(e);
                self.bind(bind, &id)
            }

            Block::RevokeRight { right } => {
                let r = self.st.rights.get(right).cloned().ok_or_else(|| refuse(RefusalCode::UnknownRight, format!("no right {right}")))?;
                let grantor =
                    r.grantor.clone().ok_or_else(|| refuse(RefusalCode::RightNotRevocable, "only granted rights can be revoked"))?;
                self.actable(&grantor)?;
                if r.under.is_some() || !r.revocable {
                    return Err(refuse(RefusalCode::RightNotRevocable, format!("{right} is not revocable")));
                }
                self.st.rights.remove(right);
                let mut e = Event::new(EventName::RightEnded);
                e.right = Some(right.clone());
                e.reason = Some(Reason::Revoked);
                self.emit(e);
                Ok(())
            }

            Block::Construct { owner, parcel, structure_type, contractor, bind } => {
                let owner = self.r(owner)?;
                self.actable(&owner)?;
                let p = self.st.parcels.get(parcel).ok_or_else(|| refuse(RefusalCode::UnknownParcel, format!("no parcel {parcel}")))?;
                let ty = self
                    .s
                    .types
                    .get(structure_type)
                    .ok_or_else(|| refuse(RefusalCode::UnknownStructureType, format!("no structure type {structure_type}")))?;
                if let Some(s) = &p.structure {
                    return Err(refuse(RefusalCode::ParcelOccupied, format!("{parcel} already has {s}")));
                }
                if !self
                    .st
                    .rights
                    .values()
                    .any(|r| r.parcel == *parcel && r.holder == owner && matches!(r.kind, RightKind::Surface | RightKind::Use))
                {
                    return Err(refuse(RefusalCode::RightNotHeld, format!("{owner} holds no surface or use right on {parcel}")));
                }
                if !laws::zoning_allows(self.s, self.st, parcel).contains(&ty.category) {
                    return Err(refuse(
                        RefusalCode::ZoningViolation,
                        format!("zoning on {parcel} does not allow {:?}", ty.category).to_lowercase(),
                    ));
                }
                let contractor = self.r(contractor)?;
                self.active(&contractor)?;
                let completes = self.later(ty.build_time, "build time")?;
                self.pay(&owner, &contractor, ty.cost, Reason::Construction, None)?;
                let id = self.st.mint("str");
                self.st.structures.insert(
                    id.clone(),
                    Structure {
                        parcel: parcel.clone(),
                        structure_type: structure_type.clone(),
                        owner: owner.clone(),
                        complete: false,
                        completes_at: Some(completes),
                    },
                );
                self.st.parcels.get_mut(parcel).unwrap().structure = Some(id.clone());
                self.st.schedule(completes, Sched::StructureComplete { structure: id.clone() });
                let mut e = Event::new(EventName::StructureStarted);
                e.structure = Some(id.clone());
                e.parcel = Some(parcel.clone());
                e.structure_type = Some(structure_type.clone());
                e.owner = Some(owner);
                e.at = Some(completes);
                self.emit(e);
                self.bind(bind, &id)
            }

            Block::Demolish { structure, contractor } => {
                let s = self
                    .st
                    .structures
                    .get(structure)
                    .cloned()
                    .ok_or_else(|| refuse(RefusalCode::UnknownStructure, format!("no structure {structure}")))?;
                self.actable(&s.owner)?;
                if laws::leased_units(self.st, &s.parcel) > 0 {
                    return Err(refuse(RefusalCode::StructureInUse, format!("{structure} has active leases")));
                }
                let contractor = self.r(contractor)?;
                self.active(&contractor)?;
                let cost = self.s.types[&s.structure_type].demolish_cost;
                self.pay(&s.owner, &contractor, cost, Reason::Demolition, None)?;
                self.st.structures.remove(structure);
                self.st.parcels.get_mut(&s.parcel).unwrap().structure = None;
                let mut e = Event::new(EventName::StructureDemolished);
                e.structure = Some(structure.clone());
                e.parcel = Some(s.parcel);
                e.owner = Some(s.owner);
                self.emit(e);
                Ok(())
            }

            Block::EnactRule { jurisdiction, rule, bind } => {
                self.actable(jurisdiction)?;
                let juris = self
                    .s
                    .jurisdictions
                    .get(jurisdiction)
                    .ok_or_else(|| refuse(RefusalCode::NoJurisdiction, format!("{jurisdiction} has no jurisdiction")))?;
                if let ParcelScope::List(l) = rule.parcels() {
                    if l.is_empty() || l.iter().collect::<BTreeSet<_>>().len() != l.len() {
                        return Err(refuse(RefusalCode::Malformed, "parcel list must be non-empty and unique"));
                    }
                    for p in l {
                        if !self.st.parcels.contains_key(p) {
                            return Err(refuse(RefusalCode::UnknownParcel, format!("no parcel {p}")));
                        }
                        if !juris.contains(p) {
                            return Err(refuse(RefusalCode::NoJurisdiction, format!("{p} is outside {jurisdiction}'s jurisdiction")));
                        }
                    }
                }
                match rule {
                    Rule::Zoning { allow, .. } if allow.iter().collect::<BTreeSet<_>>().len() != allow.len() => {
                        return Err(refuse(RefusalCode::Malformed, "zoning categories must be unique"));
                    }
                    Rule::RentCap { max_per_30d, .. } if !(0..=MAX_SAFE).contains(max_per_30d) => {
                        return Err(refuse(RefusalCode::Malformed, "rent cap out of range"));
                    }
                    _ => {}
                }
                let id = self.st.mint("rul");
                self.st.counters.rule_order += 1;
                let order = self.st.counters.rule_order;
                self.st.rules.insert(
                    id.clone(),
                    crate::state::RuleRec { jurisdiction: jurisdiction.clone(), rule: rule.clone(), enacted_at: self.now(), order },
                );
                let mut e = Event::new(EventName::RuleEnacted);
                e.rule = Some(id.clone());
                e.jurisdiction = Some(jurisdiction.clone());
                e.rule_body = Some(rule.clone());
                self.emit(e);
                self.bind(bind, &id)
            }

            Block::RepealRule { rule } => {
                let rec = self.st.rules.get(rule).cloned().ok_or_else(|| refuse(RefusalCode::UnknownRule, format!("no rule {rule}")))?;
                self.actable(&rec.jurisdiction)?;
                self.st.rules.remove(rule);
                let mut e = Event::new(EventName::RuleRepealed);
                e.rule = Some(rule.clone());
                e.jurisdiction = Some(rec.jurisdiction);
                self.emit(e);
                Ok(())
            }

            Block::ProposeAgreement { terms, offer_expires_after, bind } => {
                let terms = self.resolve_terms(terms)?;
                positive(terms.amount(), "amount")?;
                positive(terms.period(), "period")?;
                positive(terms.notice(), "notice")?;
                if let Some(t) = terms.term() {
                    positive(t, "term")?;
                }
                let [a, b] = terms.parties();
                let (a, b) = (a.to_string(), b.to_string());
                if a == b {
                    return Err(refuse(RefusalCode::Malformed, "an agreement needs two different parties"));
                }
                self.active(&a)?;
                self.active(&b)?;
                let principal = self.principal();
                let mine: Vec<Id> = [&a, &b].into_iter().filter(|p| laws::can_act_for(self.st, &principal, p)).cloned().collect();
                if mine.is_empty() {
                    return Err(refuse(RefusalCode::NotAParty, "this seat can act for neither party"));
                }
                match &terms {
                    AgreementTerms::Lease { lessor, parcel, units, rent, period, .. } => {
                        if *units == 0 {
                            return Err(refuse(RefusalCode::Malformed, "units must be at least 1"));
                        }
                        self.lease_checks(lessor, parcel, *units, *rent, *period)?;
                    }
                    AgreementTerms::Employment { workplace: Some(p), .. } if !self.st.parcels.contains_key(p) => {
                        return Err(refuse(RefusalCode::UnknownParcel, format!("no parcel {p}")));
                    }
                    AgreementTerms::Employment { .. } => {}
                }
                let expires_at = offer_expires_after.map(|d| self.later(d, "offer expiry")).transpose()?;
                let id = self.st.mint("agr");
                let accepted: BTreeSet<Id> = mine.iter().cloned().collect();
                self.st.agreements.insert(
                    id.clone(),
                    Agreement {
                        terms: terms.clone(),
                        status: AgreementStatus::Pending,
                        proposed_by: mine[0].clone(),
                        accepted: accepted.clone(),
                        expires_at,
                        activated_at: None,
                        ends_at: None,
                        end_reason: None,
                        next_payment_at: None,
                        use_right: None,
                    },
                );
                let mut e = Event::new(EventName::AgreementProposed);
                e.agreement = Some(id.clone());
                e.terms = Some(terms);
                e.by = Some(mine[0].clone());
                e.until = expires_at;
                self.emit(e);
                self.bind(bind, &id)?;
                if accepted.len() == 2 {
                    self.activate(&id)
                } else {
                    if let Some(x) = expires_at {
                        self.st.schedule(x, Sched::OfferExpire { agreement: id });
                    }
                    Ok(())
                }
            }

            Block::RespondAgreement { agreement, party, decision } => {
                let id = self.r(agreement)?;
                let a = self
                    .st
                    .agreements
                    .get(&id)
                    .cloned()
                    .ok_or_else(|| refuse(RefusalCode::UnknownAgreement, format!("no agreement {id}")))?;
                if a.status != AgreementStatus::Pending {
                    return Err(refuse(RefusalCode::InvalidState, format!("{id} is not awaiting responses")));
                }
                self.actable(party)?;
                if !a.terms.parties().contains(&party.as_str()) {
                    return Err(refuse(RefusalCode::NotAParty, format!("{party} is not a party to {id}")));
                }
                if a.accepted.contains(party) {
                    return Err(refuse(RefusalCode::AlreadyDecided, format!("{party} has already accepted {id}")));
                }
                let mut e = Event::new(EventName::AgreementResponded);
                e.agreement = Some(id.clone());
                e.by = Some(party.clone());
                e.decision = Some(match decision {
                    AgreementDecision::Accept => EventDecision::Accept,
                    AgreementDecision::Decline => EventDecision::Decline,
                });
                self.emit(e);
                match decision {
                    AgreementDecision::Decline => {
                        self.st.agreements.remove(&id);
                        Ok(())
                    }
                    AgreementDecision::Accept => {
                        let ag = self.st.agreements.get_mut(&id).unwrap();
                        ag.accepted.insert(party.clone());
                        if ag.accepted.len() == 2 {
                            self.activate(&id)
                        } else {
                            Ok(())
                        }
                    }
                }
            }

            Block::TerminateAgreement { agreement, party } => {
                let a = self
                    .st
                    .agreements
                    .get(agreement)
                    .cloned()
                    .ok_or_else(|| refuse(RefusalCode::UnknownAgreement, format!("no agreement {agreement}")))?;
                if a.status != AgreementStatus::Active {
                    return Err(refuse(RefusalCode::InvalidState, format!("{agreement} is not active")));
                }
                self.actable(party)?;
                if !a.terms.parties().contains(&party.as_str()) {
                    return Err(refuse(RefusalCode::NotAParty, format!("{party} is not a party to {agreement}")));
                }
                let notice_end = self.later(a.terms.notice(), "notice")?;
                let (end, reason) = match a.ends_at {
                    Some(e) if e <= notice_end => (e, EndReason::Expired),
                    _ => (notice_end, EndReason::Terminated),
                };
                if a.ends_at != Some(end) {
                    self.st.schedule(end, Sched::AgreementEnd { agreement: agreement.clone() });
                }
                let ag = self.st.agreements.get_mut(agreement).unwrap();
                ag.status = AgreementStatus::Ending;
                ag.ends_at = Some(end);
                ag.end_reason = Some(reason);
                let mut e = Event::new(EventName::AgreementNotice);
                e.agreement = Some(agreement.clone());
                e.by = Some(party.clone());
                e.at = Some(end);
                self.emit(e);
                Ok(())
            }

            Block::Message { to, text, re } => {
                check_len(text, MAX_TEXT, "text", true)?;
                if to.is_empty() || to.len() > 64 || to.iter().collect::<BTreeSet<_>>().len() != to.len() {
                    return Err(refuse(RefusalCode::Malformed, "recipients must be 1..=64 unique ids"));
                }
                let mut recipients = BTreeSet::new();
                for id in to {
                    if self.s.seats.contains_key(id) {
                        recipients.insert(id.clone());
                    } else if self.st.entities.contains_key(id) {
                        recipients.extend(self.s.seats.values().filter(|s| s.principal == *id).map(|s| s.id.clone()));
                    } else {
                        return Err(refuse(RefusalCode::UnknownEntity, format!("no seat or entity {id}")));
                    }
                }
                recipients.retain(|r| self.st.seats[r].status == SeatStatus::Active);
                let sender = self.seat.unwrap().to_string();
                let mid = self.st.mint("msg");
                let msg =
                    Message { id: mid.clone(), t: self.now(), from: sender.clone(), to: to.clone(), text: text.clone(), re: re.clone() };
                for r in &recipients {
                    self.st.seats.get_mut(r).unwrap().new_inbox.push(msg.clone());
                }
                let mut e = Event::new(EventName::MessageDelivered);
                e.message = Some(mid);
                e.seat = Some(sender);
                e.to = Some(OneOrMany::Many(recipients.into_iter().collect()));
                self.emit(e);
                Ok(())
            }

            Block::Decide { proposal, decision, note } => {
                if let Some(n) = note {
                    check_len(n, MAX_TEXT, "note", true)?;
                }
                let seat = self.seat.unwrap().to_string();
                let p = self
                    .st
                    .proposals
                    .get(proposal)
                    .cloned()
                    .ok_or_else(|| refuse(RefusalCode::UnknownProposal, format!("no open proposal {proposal}")))?;
                if !p.awaiting.contains(&seat) {
                    return Err(refuse(RefusalCode::NotApprover, format!("{proposal} is not awaiting this seat")));
                }
                if p.approved.contains(&seat) {
                    return Err(refuse(RefusalCode::AlreadyDecided, format!("this seat already approved {proposal}")));
                }
                let mut e = Event::new(EventName::ProposalDecided);
                e.proposal = Some(proposal.clone());
                e.by = Some(seat.clone());
                e.decision = Some(match decision {
                    Decision::Approve => EventDecision::Approve,
                    Decision::Reject => EventDecision::Reject,
                });
                self.emit(e);
                match (p.level, decision) {
                    (Level::Approval, Decision::Approve) => {
                        let pm = self.st.proposals.get_mut(proposal).unwrap();
                        pm.approved.insert(seat);
                        if pm.approved == pm.awaiting {
                            let done = self.st.proposals.remove(proposal).unwrap();
                            self.triggered.push((proposal.clone(), done));
                        }
                    }
                    (_, Decision::Reject) => {
                        self.st.proposals.remove(proposal);
                        let now = self.now();
                        self.outcome(
                            &p.seat,
                            Outcome {
                                action: p.action.clone(),
                                t: now,
                                status: OutcomeStatus::Rejected,
                                created: None,
                                refusal: None,
                                proposal: Some(proposal.clone()),
                                awaiting: None,
                            },
                        );
                    }
                    (_, Decision::Approve) => {
                        // A request is closed by the recipient's answer; nothing is applied.
                        self.st.proposals.remove(proposal);
                    }
                }
                Ok(())
            }
        }
    }

    /// Process one scheduled effect whose time has come (`st.t` == its time).
    pub fn scheduled(&mut self, item: Scheduled) {
        let at = item.at;
        match item.what {
            Sched::StructureComplete { structure } => {
                if let Some(s) = self.st.structures.get_mut(&structure) {
                    if !s.complete && s.completes_at == Some(at) {
                        s.complete = true;
                        s.completes_at = None;
                        let (parcel, owner) = (s.parcel.clone(), s.owner.clone());
                        let mut e = Event::new(EventName::StructureCompleted);
                        e.structure = Some(structure);
                        e.parcel = Some(parcel);
                        e.owner = Some(owner);
                        self.emit(e);
                    }
                }
            }
            Sched::Payment { agreement } => {
                let Some(a) = self.st.agreements.get(&agreement).cloned() else { return };
                if a.status == AgreementStatus::Pending || a.next_payment_at != Some(at) || a.ends_at.is_some_and(|e| at >= e) {
                    return;
                }
                let (payer, payee) = a.terms.payer_payee();
                let (payer, payee) = (payer.to_string(), payee.to_string());
                let mut amount = a.terms.amount();
                let reason = match &a.terms {
                    AgreementTerms::Lease { parcel, units, period, .. } => {
                        if let Some(cap) = laws::rent_cap(self.s, self.st, parcel, true) {
                            amount = amount.min(laws::capped_rent(*units, *period, cap));
                        }
                        Reason::Rent
                    }
                    AgreementTerms::Employment { .. } => Reason::Wage,
                };
                if amount > 0 {
                    if let Err(r) = self.pay(&payer, &payee, amount, reason, Some(&agreement)) {
                        let mut e = Event::new(EventName::PaymentFailed);
                        e.agreement = Some(agreement.clone());
                        e.from = Some(payer);
                        e.amount = Some(amount);
                        e.code = Some(r.code);
                        self.emit(e);
                        self.end_agreement(&agreement, Reason::Breach);
                        return;
                    }
                }
                let next = at + self.s.span(a.terms.period());
                let ag = self.st.agreements.get_mut(&agreement).unwrap();
                if next <= MAX_SAFE && ag.ends_at.is_none_or(|e| next < e) {
                    ag.next_payment_at = Some(next);
                    self.st.schedule(next, Sched::Payment { agreement });
                } else {
                    ag.next_payment_at = None;
                }
            }
            Sched::AgreementEnd { agreement } => {
                let Some(a) = self.st.agreements.get(&agreement) else { return };
                if a.ends_at == Some(at) {
                    let reason = match a.end_reason {
                        Some(EndReason::Terminated) => Reason::Terminated,
                        _ => Reason::Expired,
                    };
                    self.end_agreement(&agreement, reason);
                }
            }
            Sched::OfferExpire { agreement } => {
                let Some(a) = self.st.agreements.get(&agreement) else { return };
                if a.status == AgreementStatus::Pending && a.expires_at == Some(at) {
                    self.st.agreements.remove(&agreement);
                    let mut e = Event::new(EventName::AgreementLapsed);
                    e.agreement = Some(agreement);
                    self.emit(e);
                }
            }
            Sched::RightExpire { right } => {
                let Some(r) = self.st.rights.get(&right) else { return };
                if r.until == Some(at) && r.under.is_none() {
                    self.st.rights.remove(&right);
                    let mut e = Event::new(EventName::RightEnded);
                    e.right = Some(right);
                    e.reason = Some(Reason::Expired);
                    self.emit(e);
                }
            }
        }
    }
}
