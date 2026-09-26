//! Applying blocks and scheduled effects to a State (v0.2).
//!
//! Blocks run against a scratch copy of the state; the caller commits it only
//! if every block in the action succeeds, which makes actions atomic.
//!
//! The only reasons a block can fail here are physics (custody, funds,
//! capacity, space, presence) and mechanics (references must point at things
//! that exist). Nothing here knows what any law, permit, lease or procedure
//! says (D18, D19).

use crate::blocks::{AgreementTerms, Block, Id, Record, RecordBody, Visibility};
use crate::canon::MAX_SAFE;
use crate::config::{BOUNDARY, PERSON};
use crate::events::{EventBody, RefusalCode, Timed, TransferReason, VacateReason};
use crate::state::{Account, Entity, Message, Sched, Scheduled, SeatStatus, State, Structure, Transaction};
use crate::statics::Statics;
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

pub struct Exec<'a> {
    pub s: &'a Statics,
    pub st: &'a mut State,
    /// The acting seat, and the entity it acts as.
    pub seat: &'a str,
    pub entity: &'a str,
    /// Local refs bound so far in this action.
    pub refs: BTreeMap<String, Id>,
    pub events: Vec<Timed>,
}

pub struct ExecResult {
    pub events: Vec<Timed>,
    pub created: BTreeMap<String, Id>,
}

/// Apply `blocks` for `seat` to `st`. On error, `st` is left partly modified
/// and must be discarded.
pub fn exec_action(s: &Statics, st: &mut State, seat: &str, blocks: &[Block]) -> R<ExecResult> {
    let entity = s.entity_of(seat).expect("seat exists").to_string();
    let mut ex = Exec { s, st, seat, entity: &entity, refs: BTreeMap::new(), events: vec![] };
    for (i, b) in blocks.iter().enumerate() {
        ex.block(b).map_err(|mut r| {
            r.block.get_or_insert(i);
            r
        })?;
    }
    Ok(ExecResult { events: ex.events, created: ex.refs })
}

/// Process one scheduled physical effect whose time has come.
pub fn scheduled(st: &mut State, item: Scheduled) -> Vec<Timed> {
    match item.what {
        Sched::StructureComplete { structure } => match st.structures.get_mut(&structure) {
            Some(x) if !x.complete && x.completes_at == Some(item.at) => {
                x.complete = true;
                x.completes_at = None;
                st.touch_structure(&structure);
                vec![Timed::new(item.at, EventBody::StructureCompleted { structure })]
            }
            // Demolished before completion: nothing to do.
            _ => vec![],
        },
    }
}

impl<'a> Exec<'a> {
    fn now(&self) -> i64 {
        self.st.t
    }

    fn emit(&mut self, body: EventBody) {
        self.events.push(Timed::new(self.st.t, body));
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

    fn ro(&self, x: &Option<String>) -> R<Option<Id>> {
        x.as_deref().map(|v| self.r(v)).transpose()
    }

    fn bind(&mut self, name: &Option<String>, id: &str) -> R<()> {
        if let Some(n) = name {
            if self.refs.insert(n.clone(), id.to_string()).is_some() {
                return Err(refuse(RefusalCode::DuplicateRef, format!("${n} is bound twice")));
            }
        }
        Ok(())
    }

    fn entity_exists(&self, id: &str) -> R<()> {
        if self.st.entities.contains_key(id) {
            Ok(())
        } else {
            Err(refuse(RefusalCode::UnknownEntity, format!("no entity {id}")))
        }
    }

    fn account(&self, id: &str) -> R<&Account> {
        self.st.accounts.get(id).ok_or_else(|| refuse(RefusalCode::UnknownAccount, format!("no account {id}")))
    }

    fn record_of_kind(&self, id: &str, kind: &str) -> R<&Record> {
        let r = &*self.st.records.get(id).ok_or_else(|| refuse(RefusalCode::UnknownRecord, format!("no record {id}")))?.record;
        if kind != "any" && r.body.kind_name() != kind {
            return Err(refuse(RefusalCode::WrongRecordKind, format!("{id} is a {}, not a {kind}", r.body.kind_name())));
        }
        Ok(r)
    }

    fn later(&self, d: i64) -> R<i64> {
        let at = self.now() + self.s.span(d.max(1));
        if at > MAX_SAFE {
            return Err(refuse(RefusalCode::Overflow, "ends beyond the representable time range"));
        }
        Ok(at)
    }

    /// The entity a record's author acts as (None for genesis).
    fn author_entity(&self, rec: &Record) -> Option<Id> {
        self.s.entity_of(&rec.author).map(String::from)
    }

    /// Move money between accounts. Every movement of money in the world goes
    /// through here and emits exactly one `transfer` event.
    #[allow(clippy::too_many_arguments)]
    fn move_money(
        &mut self,
        from: &str,
        to: &str,
        amount: i64,
        reason: TransferReason,
        settles: Option<Id>,
        per_instruction: Option<Id>,
        memo: Option<String>,
    ) -> R<()> {
        let src = self.account(from)?.clone();
        let dst = self.account(to)?.clone();
        if !(1..=MAX_SAFE).contains(&amount) {
            return Err(refuse(RefusalCode::Overflow, "amount out of range"));
        }
        if src.holder == self.s.boundary {
            // The outside world's account may go negative (money flowing in), within range.
            if src.balance.checked_sub(amount).is_none_or(|x| x < -MAX_SAFE) {
                return Err(refuse(RefusalCode::Overflow, "the outside world's account would go beyond -(2^53-1)"));
            }
        } else if src.balance < amount {
            return Err(refuse(RefusalCode::InsufficientFunds, format!("{from} holds {}, needs {amount}", src.balance)));
        }
        if from != to {
            if dst.balance.checked_add(amount).is_none_or(|x| x > MAX_SAFE) {
                return Err(refuse(RefusalCode::Overflow, format!("{to}'s balance would exceed 2^53-1")));
            }
            let c = self.st.stamp();
            let a = self.st.accounts.get_mut(from).unwrap();
            a.balance -= amount;
            a.changed = c;
            let b = self.st.accounts.get_mut(to).unwrap();
            b.balance += amount;
            b.changed = c;
        }
        let tx = Transaction {
            t: self.now(),
            from: from.into(),
            to: to.into(),
            amount,
            by: self.seat.into(),
            settles: settles.clone(),
            per_instruction: per_instruction.clone(),
            memo: memo.clone(),
        };
        let concerned: BTreeSet<&str> = [src.holder.as_str(), src.custodian.as_str(), dst.holder.as_str(), dst.custodian.as_str()].into();
        let seats: Vec<Id> = self.s.seats.values().filter(|x| concerned.contains(x.entity.as_str())).map(|x| x.id.clone()).collect();
        for seat in seats {
            self.st.seats.get_mut(&seat).unwrap().new_transactions.push(tx.clone());
        }
        self.emit(EventBody::Transfer {
            from: from.into(),
            to: to.into(),
            amount,
            by: self.seat.into(),
            reason,
            settles,
            per_instruction,
            memo,
        });
        Ok(())
    }

    /// Make and store a record authored by the acting seat. Checks only that
    /// everything it references exists.
    fn new_record(&mut self, body: RecordBody, speaks_for: Option<Id>, visible_to: Option<Visibility>, basis: Option<Id>) -> R<Id> {
        let visible_to = match visible_to {
            Some(Visibility::Only(ids)) => Visibility::only(ids.iter().map(|i| self.r(i)).collect::<R<Vec<_>>>()?),
            Some(v) => v,
            None => self.default_visibility(&body, speaks_for.as_deref())?,
        };
        let id = self.st.mint("rec");
        let rec = Record { id: id.clone(), author: self.seat.into(), speaks_for, at: self.now(), visible_to, basis, body };
        for e in rec.entities_named().into_iter().chain(rec.visibility_entities()) {
            self.entity_exists(e)?;
        }
        if let Some(b) = &rec.basis {
            self.record_of_kind(b, "any")?;
        }
        self.st.store(rec.clone());
        self.emit(EventBody::Recorded { record: Box::new(rec) });
        Ok(id)
    }

    /// Who sees a record when its author doesn't say (contracts/README.md,
    /// "Records"). The author's entity can always see its own records.
    fn default_visibility(&self, body: &RecordBody, speaks_for: Option<&str>) -> R<Visibility> {
        let mut base: Vec<Id> = vec![self.entity.to_string()];
        base.extend(speaks_for.map(String::from));
        let inherit = |id: &str| -> R<Visibility> { Ok(self.record_of_kind(id, "any")?.visible_to.clone()) };
        let widen = |v: Visibility, more: Vec<Id>| match v {
            Visibility::Public(_) => Visibility::public(),
            Visibility::Only(ids) => Visibility::only(ids.into_iter().chain(more)),
        };
        Ok(match body {
            RecordBody::EntityDeclaration { .. } => Visibility::public(),
            RecordBody::Claim { holder, counterparty: Some(c), .. } => {
                Visibility::only(base.into_iter().chain([holder.clone(), c.clone()]))
            }
            RecordBody::Claim { .. } => Visibility::public(),
            RecordBody::ClaimTransfer { claim, to } => widen(inherit(claim)?, base.into_iter().chain([to.clone()]).collect()),
            RecordBody::ClaimRelease { claim } => widen(inherit(claim)?, base),
            RecordBody::Agreement { terms } => Visibility::only(base.into_iter().chain(terms.parties.iter().cloned())),
            RecordBody::Signature { agreement, .. } | RecordBody::Notice { agreement, .. } => widen(inherit(agreement)?, base),
            RecordBody::Statement { addressed_to: Some(a), .. } => Visibility::only(base.into_iter().chain(a.iter().cloned())),
            RecordBody::Statement { .. } => Visibility::public(),
            RecordBody::Withdrawal { withdraws, .. } => widen(inherit(withdraws)?, base),
            RecordBody::Vote { ballot, .. } => {
                // A vote is seen by the voter and whoever runs the ballot, not by everyone.
                let b = self.record_of_kind(ballot, "statement")?;
                let counter = self.author_entity(b).or_else(|| b.speaks_for.clone());
                Visibility::only(base.into_iter().chain(counter))
            }
        })
    }

    fn resolve_terms(&self, t: &AgreementTerms) -> R<AgreementTerms> {
        let mut t = t.clone();
        for p in &mut t.parties {
            *p = self.r(p)?;
        }
        for c in &mut t.commitments {
            c.who = self.r(&c.who)?;
        }
        for x in t.termination.iter_mut().flatten() {
            x.party = self.r(&x.party)?;
        }
        Ok(t)
    }

    pub fn block(&mut self, b: &Block) -> R<()> {
        match b {
            // ---------------- physical ----------------
            Block::Transfer { from, to, amount, settles, per_instruction, memo } => {
                let (from, to) = (self.r(from)?, self.r(to)?);
                let custodian = self.account(&from)?.custodian.clone();
                if custodian != self.entity {
                    return Err(refuse(
                        RefusalCode::NotCustodian,
                        format!("{from} is held in custody by {custodian}; only {custodian}'s seats can move it"),
                    ));
                }
                let (settles, per_instruction) = (self.ro(settles)?, self.ro(per_instruction)?);
                for rec in settles.iter().chain(per_instruction.iter()) {
                    self.record_of_kind(rec, "any")?;
                }
                self.move_money(&from, &to, *amount, TransferReason::Payment, settles, per_instruction, memo.clone())
            }

            Block::OpenAccount { holder, bind } => {
                let holder = self.r(holder)?;
                self.entity_exists(&holder)?;
                let id = self.st.mint("acc");
                let c = self.st.stamp();
                self.st.accounts.insert(id.clone(), Account { holder: holder.clone(), custodian: self.entity.into(), balance: 0, changed: c });
                self.emit(EventBody::AccountOpened { account: id.clone(), holder, custodian: self.entity.into(), by: self.seat.into() });
                self.bind(bind, &id)
            }

            Block::CloseAccount { account } => {
                let account = self.r(account)?;
                let a = self.account(&account)?;
                if a.custodian != self.entity {
                    return Err(refuse(RefusalCode::NotCustodian, format!("{account} is held in custody by {}", a.custodian)));
                }
                if account == self.s.boundary_account {
                    return Err(refuse(RefusalCode::BoundaryProtected, "the outside world's account can't be closed"));
                }
                if a.balance != 0 {
                    return Err(refuse(RefusalCode::AccountNotEmpty, format!("{account} still holds {}", a.balance)));
                }
                let c = self.st.stamp();
                if let Some(gone) = self.st.accounts.remove(&account) {
                    self.st.closed_accounts.insert(account.clone(), crate::state::ClosedAccount { holder: gone.holder, custodian: gone.custodian, changed: c });
                }
                self.emit(EventBody::AccountClosed { account, by: self.seat.into() });
                Ok(())
            }

            Block::Construct { parcel, structure_type, materials_from, bind } => {
                let p = self.st.parcels.get(parcel).ok_or_else(|| refuse(RefusalCode::UnknownParcel, format!("no parcel {parcel}")))?;
                if let Some(x) = &p.structure {
                    return Err(refuse(RefusalCode::ParcelOccupied, format!("{parcel} already has {x}")));
                }
                let ty = self
                    .s
                    .types
                    .get(structure_type)
                    .ok_or_else(|| refuse(RefusalCode::UnknownStructureType, format!("no structure type {structure_type}")))?
                    .clone();
                let from = self.r(materials_from)?;
                if self.account(&from)?.holder != self.entity {
                    return Err(refuse(RefusalCode::NotHolder, format!("{from} isn't held by the builder {}", self.entity)));
                }
                let completes = self.later(ty.build_time)?;
                // Documented liberty (D25, accepted temporarily): materials are paid
                // straight to the outside world, not through the builder's bank.
                let boundary = self.s.boundary_account.clone();
                self.move_money(&from, &boundary, ty.materials_cost, TransferReason::Materials, None, None, None)?;
                let id = self.st.mint("str");
                self.st.structures.insert(
                    id.clone(),
                    Structure {
                        parcel: parcel.clone(),
                        structure_type: structure_type.clone(),
                        built_by: Some(self.entity.into()),
                        complete: false,
                        completes_at: Some(completes),
                    },
                );
                let c = self.st.stamp();
                let p = self.st.parcels.get_mut(parcel).unwrap();
                p.structure = Some(id.clone());
                p.changed = c;
                self.st.schedule(completes, Sched::StructureComplete { structure: id.clone() });
                self.emit(EventBody::StructureStarted {
                    structure: id.clone(),
                    parcel: parcel.clone(),
                    structure_type: structure_type.clone(),
                    built_by: self.entity.into(),
                    at: completes,
                });
                self.bind(bind, &id)
            }

            Block::Demolish { structure, costs_from } => {
                let sid = self.r(structure)?;
                let x = self
                    .st
                    .structures
                    .get(&sid)
                    .ok_or_else(|| refuse(RefusalCode::UnknownStructure, format!("no structure {sid}")))?
                    .clone();
                let from = self.r(costs_from)?;
                if self.account(&from)?.holder != self.entity {
                    return Err(refuse(RefusalCode::NotHolder, format!("{from} isn't held by {}", self.entity)));
                }
                let cost = self.s.types[&x.structure_type].demolition_cost;
                let boundary = self.s.boundary_account.clone();
                self.move_money(&from, &boundary, cost, TransferReason::Demolition, None, None, None)?;
                for occupant in self.st.occupancy.remove(&sid).unwrap_or_default().into_keys() {
                    self.st.moved(&occupant);
                    self.emit(EventBody::Vacated {
                        occupant,
                        structure: sid.clone(),
                        by: self.seat.into(),
                        reason: VacateReason::Demolition,
                    });
                }
                self.st.structures.remove(&sid);
                let c = self.st.stamp();
                let p = self.st.parcels.get_mut(&x.parcel).unwrap();
                p.structure = None;
                p.changed = c;
                self.emit(EventBody::StructureDemolished { structure: sid, by: self.seat.into() });
                Ok(())
            }

            Block::Occupy { structure, slot, count } => {
                let sid = self.r(structure)?;
                let x = self.st.structures.get(&sid).ok_or_else(|| refuse(RefusalCode::UnknownStructure, format!("no structure {sid}")))?;
                if !x.complete {
                    return Err(refuse(RefusalCode::StructureIncomplete, format!("{sid} is still being built")));
                }
                let cap = *self.s.types[&x.structure_type]
                    .capacity
                    .get(slot)
                    .ok_or_else(|| refuse(RefusalCode::UnknownSlot, format!("{sid} has no {slot} slots")))?
                    as u64;
                let used = self.st.occupied(&sid, slot);
                if *count == 0 || used + *count as u64 > cap {
                    return Err(refuse(RefusalCode::CapacityExceeded, format!("{sid} has {cap} {slot} slots, {used} taken")));
                }
                let arriving = !self.st.occupancy.get(&sid).is_some_and(|o| o.contains_key(self.entity));
                *self
                    .st
                    .occupancy
                    .entry(sid.clone())
                    .or_default()
                    .entry(self.entity.into())
                    .or_default()
                    .entry(slot.clone())
                    .or_default() += count;
                self.st.touch_structure(&sid);
                if arriving {
                    self.st.moved(self.entity);
                }
                self.emit(EventBody::Occupied { occupant: self.entity.into(), structure: sid, slot: slot.clone(), count: *count });
                Ok(())
            }

            Block::Vacate { occupant, structure } => {
                let (occupant, sid) = (self.r(occupant)?, self.r(structure)?);
                self.entity_exists(&occupant)?;
                let present = self.st.occupancy.get_mut(&sid).and_then(|occ| occ.remove(&occupant)).is_some();
                if !present {
                    return Err(refuse(RefusalCode::NotPresent, format!("{occupant} is not in {sid}")));
                }
                if self.st.occupancy.get(&sid).is_some_and(|o| o.is_empty()) {
                    self.st.occupancy.remove(&sid);
                }
                self.st.touch_structure(&sid);
                self.st.moved(&occupant);
                let reason = if occupant == self.entity { VacateReason::Left } else { VacateReason::Removed };
                self.emit(EventBody::Vacated { occupant, structure: sid, by: self.seat.into(), reason });
                Ok(())
            }

            // ---------------- records ----------------
            Block::CreateEntity { kind, name, speaks_for, visible_to, bind } => {
                if kind == PERSON || kind == BOUNDARY {
                    return Err(refuse(RefusalCode::ReservedKind, format!("a {kind} can't be created by an act")));
                }
                if self.st.counters.created_entities >= self.s.config.caps.max_created_entities {
                    return Err(refuse(
                        RefusalCode::CapExceeded,
                        format!("this world allows {} created entities", self.s.config.caps.max_created_entities),
                    ));
                }
                let speaks_for = self.ro(speaks_for)?;
                let id = self.st.mint("ent");
                self.st.counters.created_entities += 1;
                let c = self.st.stamp();
                self.st.entities.insert(id.clone(), Entity { kind: kind.clone(), name: name.clone(), changed: c, moved: 0 });
                self.emit(EventBody::EntityCreated { entity: id.clone(), kind: kind.clone(), name: name.clone() });
                self.new_record(
                    RecordBody::EntityDeclaration { entity: id.clone(), kind: kind.clone(), name: name.clone() },
                    speaks_for,
                    visible_to.clone(),
                    None,
                )?;
                self.bind(bind, &id)
            }

            Block::RecordClaim { position, holder, counterparty, about, basis, speaks_for, visible_to, bind } => {
                let body = RecordBody::Claim {
                    position: *position,
                    holder: self.r(holder)?,
                    counterparty: self.ro(counterparty)?,
                    about: about.clone(),
                };
                let id = self.new_record(body, self.ro(speaks_for)?, visible_to.clone(), self.ro(basis)?)?;
                self.bind(bind, &id)
            }

            Block::TransferClaim { claim, to, basis, speaks_for, visible_to, bind } => {
                let claim = self.r(claim)?;
                self.record_of_kind(&claim, "claim")?;
                let id = self.new_record(
                    RecordBody::ClaimTransfer { claim, to: self.r(to)? },
                    self.ro(speaks_for)?,
                    visible_to.clone(),
                    self.ro(basis)?,
                )?;
                self.bind(bind, &id)
            }

            Block::ReleaseClaim { claim, basis, speaks_for, visible_to, bind } => {
                let claim = self.r(claim)?;
                self.record_of_kind(&claim, "claim")?;
                let id = self.new_record(RecordBody::ClaimRelease { claim }, self.ro(speaks_for)?, visible_to.clone(), self.ro(basis)?)?;
                self.bind(bind, &id)
            }

            Block::ProposeAgreement { terms, basis, speaks_for, visible_to, bind } => {
                let terms = self.resolve_terms(terms)?;
                let id = self.new_record(RecordBody::Agreement { terms }, self.ro(speaks_for)?, visible_to.clone(), self.ro(basis)?)?;
                self.bind(bind, &id)
            }

            Block::SignAgreement { agreement, party, bind } => {
                let agreement = self.r(agreement)?;
                self.record_of_kind(&agreement, "agreement")?;
                let party = self.r(party)?;
                let id = self.new_record(RecordBody::Signature { agreement, party: party.clone() }, Some(party), None, None)?;
                self.bind(bind, &id)
            }

            Block::GiveNotice { agreement, party, text, bind } => {
                let agreement = self.r(agreement)?;
                self.record_of_kind(&agreement, "agreement")?;
                let party = self.r(party)?;
                let id =
                    self.new_record(RecordBody::Notice { agreement, party: party.clone(), text: text.clone() }, Some(party), None, None)?;
                self.bind(bind, &id)
            }

            Block::Publish { kind, text, data, adico, formal, basis, addressed_to, place, speaks_for, visible_to, bind } => {
                let addressed_to = addressed_to.as_ref().map(|a| a.iter().map(|x| self.r(x)).collect::<R<Vec<_>>>()).transpose()?;
                if let Some(p) = place {
                    if !self.st.parcels.contains_key(p) {
                        return Err(refuse(RefusalCode::UnknownParcel, format!("no parcel {p}")));
                    }
                }
                let body = RecordBody::Statement {
                    kind: kind.clone(),
                    text: text.clone(),
                    data: data.clone(),
                    adico: adico.clone(),
                    formal: formal.clone(),
                    addressed_to,
                    place: place.clone(),
                };
                let id = self.new_record(body, self.ro(speaks_for)?, visible_to.clone(), self.ro(basis)?)?;
                self.bind(bind, &id)
            }

            Block::Withdraw { record, text, basis, speaks_for, visible_to, bind } => {
                let record = self.r(record)?;
                self.record_of_kind(&record, "any")?;
                let id = self.new_record(
                    RecordBody::Withdrawal { withdraws: record, text: text.clone() },
                    self.ro(speaks_for)?,
                    visible_to.clone(),
                    self.ro(basis)?,
                )?;
                self.bind(bind, &id)
            }

            Block::Vote { ballot, choice, speaks_for, visible_to } => {
                let ballot = self.r(ballot)?;
                self.record_of_kind(&ballot, "statement")?;
                self.new_record(RecordBody::Vote { ballot, choice: choice.clone() }, self.ro(speaks_for)?, visible_to.clone(), None)?;
                Ok(())
            }

            Block::Message { to, text, re } => {
                let mut recipients = BTreeSet::new();
                for id in to {
                    if self.s.seats.contains_key(id) {
                        recipients.insert(id.clone());
                    } else if self.st.entities.contains_key(id) {
                        recipients.extend(self.s.seats.values().filter(|x| x.entity == *id).map(|x| x.id.clone()));
                    } else {
                        return Err(refuse(RefusalCode::UnknownEntity, format!("no seat or entity {id}")));
                    }
                }
                recipients.retain(|r| self.st.seats[r].status == SeatStatus::Active);
                let mid = self.st.mint("msg");
                let msg =
                    Message { id: mid.clone(), t: self.now(), from: self.seat.into(), to: to.clone(), text: text.clone(), re: re.clone() };
                for r in &recipients {
                    self.st.seats.get_mut(r).unwrap().new_inbox.push(msg.clone());
                }
                self.emit(EventBody::MessageDelivered { message: mid, seat: self.seat.into(), to: recipients.into_iter().collect() });
                Ok(())
            }
        }
    }
}
