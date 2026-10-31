//! Building blocks and records, mirroring contracts/blocks.schema.json and
//! contracts/records.schema.json (v0.5). Field names and shapes must match
//! the schemas exactly; tests/conformance.rs checks that the contract
//! examples round-trip through these types.
//!
//! Opaque parts of the contracts (claim contents, commitments, statement
//! data, the Institutional Grammar breakdown, formal conditions) stay as JSON
//! values: the kernel stores them and never interprets them.

use crate::config::Channel;
use serde::{Deserialize, Serialize};
pub use oikos_core::Frozen;
use serde_json::Value;

/// An id, or a `$name` bound earlier in the same action.
pub type IdOrRef = String;
pub use oikos_core::Id;
/// The id of what passes (an act in progress, a message on its way): its own text, not interned, so it goes with what
/// it names (docs/design/performance.md, "A plan for what is left", R1). Every id of what lasts is an `Id`.
pub type Passing = String;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "block", rename_all = "snake_case", deny_unknown_fields)]
pub enum Block {
    // ---- physical ----
    Transfer {
        from: IdOrRef,
        to: IdOrRef,
        #[serde(with = "oikos_core::money::amount")]
        amount: oikos_core::money::Money,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        settles: Option<IdOrRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        per_instruction: Option<IdOrRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        memo: Option<String>,
        /// The line of a budget the payer says it is drawn on (a label the payer gives; the kernel reads nothing into it).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        line: Option<String>,
    },
    /// The holder moves some of its holding of a resource to someone's holding at a place (its own, or another's: a
    /// delivery, a handover, a shipment out of the world to an edge). Phase B.
    MoveGoods {
        kind: Id,
        #[serde(with = "oikos_core::money::amount")]
        quantity: oikos_core::money::Money,
        /// Where the goods are now (a structure, or for an edge, itself).
        from_at: IdOrRef,
        to: IdOrRef,
        /// Where they go (a structure, or for an edge, itself).
        to_at: IdOrRef,
    },
    /// Taking goods another holds at a structure where the taker is, without their consent (world-expansion 7.3).
    Take {
        kind: Id,
        #[serde(with = "oikos_core::money::amount")]
        quantity: oikos_core::money::Money,
        from: IdOrRef,
        at: IdOrRef,
    },
    OpenAccount {
        holder: IdOrRef,
        /// The account's currency; absent: the world's first (its default).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        currency: Option<Id>,
        #[serde(default, rename = "ref", skip_serializing_if = "Option::is_none")]
        bind: Option<String>,
    },
    CloseAccount {
        account: IdOrRef,
    },
    Construct {
        /// The corner cell of the footprint.
        at: Id,
        structure_type: Id,
        /// Where the builder's materials are (a structure it holds them at: its yard). Required when the type has
        /// materials (phase B).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        materials_at: Option<IdOrRef>,
        #[serde(default, rename = "ref", skip_serializing_if = "Option::is_none")]
        bind: Option<String>,
    },
    /// Begin bringing a structure down: its occupants leave at once; it comes down when its type's demolition labour
    /// has been worked (the task `demolish`, on it), or at once if its type needs none.
    Demolish {
        structure: IdOrRef,
    },
    /// Work (phase B): `units` of a task, at a structure, by performers who are there (in a space of the task's
    /// kind). Their time comes from each one's working day; the task's inputs from the actor's holding there; its
    /// outputs go to that holding; its changes to a structure's variables (`on`, or `at`). `on` may instead name a
    /// person there, or a space of `at` (everyone in it): the task's `on_body` applies to each body. The built-in tasks `build`
    /// and `demolish` work `on` a structure begun or coming down.
    Work {
        task: Id,
        units: u64,
        at: IdOrRef,
        performers: Vec<IdOrRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        on: Option<IdOrRef>,
        /// A survey (a task that `surveys`): of a species or a field, in these cells (one unit each).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        survey: Option<Survey>,
        /// An investigation (a task that `investigates`): of goods taken from someone, at a structure.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        investigate: Option<Investigate>,
    },
    /// A body goes into a space: the acting person, or someone they bring (`who`).
    Occupy {
        space: IdOrRef,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        who: Option<IdOrRef>,
        /// Law 9 (foundations-2 S2): the vehicle it goes by, driven (one it may drive, standing where it sets out); none, on
        /// foot.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        vehicle: Option<IdOrRef>,
    },
    /// A body comes out of a structure (every space it's in there) or one space.
    Vacate {
        occupant: IdOrRef,
        from: IdOrRef,
    },
    // ---- bodies ----
    /// Someone crosses into the world from outside: a newcomer (name, born_at, template) or someone
    /// returning (person). Done in a position of the boundary. `carrying`: money they bring.
    Arrive {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        person: Option<IdOrRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        name: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        born_at: Option<i64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        template: Option<Id>,
        #[serde(default, with = "oikos_core::money::opt_amount", skip_serializing_if = "Option::is_none")]
        carrying: Option<oikos_core::money::Money>,
        /// A newcomer's biological sex, where the world models it.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        sex: Option<crate::vocab::Sex>,
        /// A newcomer's body variables (others take the catalogue's `initial`).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        variables: Option<std::collections::BTreeMap<Id, i64>>,
        #[serde(default, rename = "ref", skip_serializing_if = "Option::is_none")]
        bind: Option<String>,
    },
    /// A body crosses out of the world: the acting person, or someone removed.
    Leave {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        person: Option<IdOrRef>,
        /// Which of the world's edges they leave by; absent: the default (the first).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        to: Option<Id>,
    },
    /// The acting person conceives a child (with another parent, if named); the child is born after gestation.
    Birth {
        name: String,
        template: Id,
        #[serde(default, rename = "with", skip_serializing_if = "Option::is_none")]
        other_parent: Option<IdOrRef>,
    },
    /// The acting person harms someone near them.
    Harm {
        person: IdOrRef,
    },
    // ---- participants and positions ----
    /// A new position of the acting organisation, vacant.
    CreatePosition {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        role: Option<String>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        channels: Vec<Channel>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        role_module: Option<Value>,
        #[serde(default, rename = "ref", skip_serializing_if = "Option::is_none")]
        bind: Option<String>,
    },
    /// Hand one of the acting organisation's positions to a participant, or to nobody.
    Appoint {
        position: IdOrRef,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        participant: Option<IdOrRef>,
    },
    /// The acting organisation, which supplies a template, delivers a new system from it to a client organisation
    /// (`to`; absent: itself). The system belongs to the client; the supplier may also switch it off (foundations F4).
    Deploy {
        template: Id,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        to: Option<IdOrRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        #[serde(default, rename = "ref", skip_serializing_if = "Option::is_none")]
        bind: Option<String>,
    },
    /// Switch off a system participant belonging to, or supplied by, the acting organisation.
    Retire {
        participant: IdOrRef,
    },
    // ---- records ----
    CreateEntity {
        kind: String,
        name: String,
        /// The new organisation's first position, held by the acting participant.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        first_position: Option<NewPosition>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        speaks_for: Option<IdOrRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        visible_to: Option<Visibility>,
        #[serde(default, rename = "ref", skip_serializing_if = "Option::is_none")]
        bind: Option<String>,
    },
    RecordClaim {
        position: Position,
        holder: IdOrRef,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        counterparty: Option<IdOrRef>,
        about: Value,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        basis: Option<BasisArg>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        speaks_for: Option<IdOrRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        visible_to: Option<Visibility>,
        #[serde(default, rename = "ref", skip_serializing_if = "Option::is_none")]
        bind: Option<String>,
    },
    TransferClaim {
        claim: IdOrRef,
        to: IdOrRef,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        basis: Option<BasisArg>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        speaks_for: Option<IdOrRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        visible_to: Option<Visibility>,
        #[serde(default, rename = "ref", skip_serializing_if = "Option::is_none")]
        bind: Option<String>,
    },
    ReleaseClaim {
        claim: IdOrRef,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        basis: Option<BasisArg>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        speaks_for: Option<IdOrRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        visible_to: Option<Visibility>,
        #[serde(default, rename = "ref", skip_serializing_if = "Option::is_none")]
        bind: Option<String>,
    },
    ProposeAgreement {
        terms: AgreementTerms,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        basis: Option<BasisArg>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        speaks_for: Option<IdOrRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        visible_to: Option<Visibility>,
        #[serde(default, rename = "ref", skip_serializing_if = "Option::is_none")]
        bind: Option<String>,
    },
    SignAgreement {
        agreement: IdOrRef,
        #[serde(rename = "as")]
        party: IdOrRef,
        #[serde(default, rename = "ref", skip_serializing_if = "Option::is_none")]
        bind: Option<String>,
    },
    GiveNotice {
        agreement: IdOrRef,
        #[serde(rename = "as")]
        party: IdOrRef,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        text: Option<String>,
        #[serde(default, rename = "ref", skip_serializing_if = "Option::is_none")]
        bind: Option<String>,
    },
    Publish {
        kind: String,
        text: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        data: Option<Value>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        adico: Option<Value>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        formal: Option<Value>,
        /// What someone may take up, on what terms (contracts: Offer; docs/design/ai-citizens.md 2a). Facts only; the
        /// kernel executes none of it.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        offer: Option<Value>,
        /// A recurring situation people may take part in (contracts: Practice; 2b). It has no power.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        practice: Option<Value>,
        /// Something put forward to be believed (contracts: Assertion; docs/design/contracts-0.7.md A1). No power.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        assertion: Option<Value>,
        /// A registry's act: an organisation registered or dissolved (contracts: Registry). Content, never physics.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        registry: Option<Value>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        basis: Option<BasisArg>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        addressed_to: Option<Vec<IdOrRef>>,
        /// A cell it's put up on: then it's seen by being near there.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        place: Option<Id>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        speaks_for: Option<IdOrRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        visible_to: Option<Visibility>,
        #[serde(default, rename = "ref", skip_serializing_if = "Option::is_none")]
        bind: Option<String>,
    },
    Withdraw {
        record: IdOrRef,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        text: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        basis: Option<BasisArg>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        speaks_for: Option<IdOrRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        visible_to: Option<Visibility>,
        #[serde(default, rename = "ref", skip_serializing_if = "Option::is_none")]
        bind: Option<String>,
    },
    Vote {
        ballot: IdOrRef,
        choice: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        speaks_for: Option<IdOrRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        visible_to: Option<Visibility>,
    },
    Message {
        to: Vec<Id>,
        text: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        re: Option<Id>,
    },
    // ---- what flows (foundations-2 C3, law 8) ----
    /// An act on a connection. Its operator (the holder of the supply whose tree the node is on) opens one (`open`, with
    /// the kind, the node, the user `to`, where `at`, the rate a day; or, naming a closed `connection`, opens it again),
    /// closes it (a disconnection), interrupts or restores it (an interruptible customer cut); its user or its operator
    /// sets its rate (`set`).
    Connection {
        op: ConnOp,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        connection: Option<IdOrRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        kind: Option<Id>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        node: Option<Id>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        to: Option<IdOrRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        at: Option<IdOrRef>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        rate: Option<i64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        uses: Option<Id>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        meter: Option<crate::network::MeterKind>,
        #[serde(default, rename = "ref", skip_serializing_if = "Option::is_none")]
        bind: Option<String>,
    },
    /// An act on a link by its operator: shut it (a valve closed, a feeder switched off), open it, reclose it after it
    /// tripped, or put it on a rotation (a standing schedule: off for `off` seconds of every `every`, from `from`; `off`
    /// nought ends it).
    Link {
        link: Id,
        op: LinkOp,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        every: Option<i64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        from: Option<i64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        off: Option<i64>,
    },
}

/// What is done to a connection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnOp {
    Open,
    Set,
    Close,
    Interrupt,
    Restore,
}

impl ConnOp {
    pub fn name(&self) -> &'static str {
        match self {
            ConnOp::Open => "open",
            ConnOp::Set => "set",
            ConnOp::Close => "close",
            ConnOp::Interrupt => "interrupt",
            ConnOp::Restore => "restore",
        }
    }
}

/// What is done to a link.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LinkOp {
    Shut,
    Open,
    Reclose,
    Rotate,
}

impl LinkOp {
    pub fn name(&self) -> &'static str {
        match self {
            LinkOp::Shut => "shut",
            LinkOp::Open => "open",
            LinkOp::Reclose => "reclose",
            LinkOp::Rotate => "rotate",
        }
    }
}

impl Block {
    /// What the act makes, where the block names it: the row of the work table that is narrower than the block's own
    /// (`publish/<kind of record>`, `create_entity/<kind>`, `work/<task>`). Kinds are opaque labels to the kernel
    /// (docs/design/foundations.md law 2; F2).
    pub fn makes(&self) -> Option<String> {
        match self {
            Block::Publish { kind, .. } => Some(format!("publish/{kind}")),
            Block::CreateEntity { kind, .. } => Some(format!("create_entity/{kind}")),
            Block::Work { task, .. } => Some(format!("work/{task}")),
            Block::Connection { op, .. } => Some(format!("connection/{}", op.name())),
            Block::Link { op, .. } => Some(format!("link/{}", op.name())),
            _ => None,
        }
    }

    pub fn name(&self) -> &'static str {
        match self {
            Block::Transfer { .. } => "transfer",
            Block::MoveGoods { .. } => "move_goods",
            Block::Take { .. } => "take",
            Block::Work { .. } => "work",
            Block::OpenAccount { .. } => "open_account",
            Block::CloseAccount { .. } => "close_account",
            Block::Construct { .. } => "construct",
            Block::Demolish { .. } => "demolish",
            Block::Occupy { .. } => "occupy",
            Block::Vacate { .. } => "vacate",
            Block::Arrive { .. } => "arrive",
            Block::Leave { .. } => "leave",
            Block::Birth { .. } => "birth",
            Block::Harm { .. } => "harm",
            Block::CreatePosition { .. } => "create_position",
            Block::Appoint { .. } => "appoint",
            Block::Deploy { .. } => "deploy",
            Block::Retire { .. } => "retire",
            Block::CreateEntity { .. } => "create_entity",
            Block::RecordClaim { .. } => "record_claim",
            Block::TransferClaim { .. } => "transfer_claim",
            Block::ReleaseClaim { .. } => "release_claim",
            Block::ProposeAgreement { .. } => "propose_agreement",
            Block::SignAgreement { .. } => "sign_agreement",
            Block::GiveNotice { .. } => "give_notice",
            Block::Publish { .. } => "publish",
            Block::Withdraw { .. } => "withdraw",
            Block::Vote { .. } => "vote",
            Block::Message { .. } => "message",
            Block::Connection { .. } => "connection",
            Block::Link { .. } => "link",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Position {
    Right,
    Liberty,
    Power,
    Immunity,
}

/// One record, or a list of them: how a basis is written (contracts: common Basis, records Basis).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum BasisForm<T = Id> {
    One(T),
    Several(Vec<T>),
}

/// The most records one act may cite.
pub const MAX_BASES: usize = 64;

fn listed<T: PartialEq + std::fmt::Display>(ids: &[T], at_least: usize) -> Result<(), String> {
    if ids.len() < at_least || ids.len() > MAX_BASES {
        return Err(format!("a basis written as a list names {at_least} to {MAX_BASES} records, not {}", ids.len()));
    }
    if let Some(twice) = ids.iter().enumerate().find(|(i, x)| ids[..*i].contains(x)) {
        return Err(format!("a basis names {} twice", twice.1));
    }
    Ok(())
}

/// What a block says its record rests on, as it was written: one record (or a `$name` bound earlier in the action),
/// or a list of them in the order cited (at least one, none twice). It is kept as written, so a command reads in the
/// log as it was given; the record made from it has the one stored form (`Basis`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "BasisForm<IdOrRef>", into = "BasisForm<IdOrRef>")]
pub struct BasisArg(BasisForm<IdOrRef>);

impl BasisArg {
    pub fn one(id: impl Into<IdOrRef>) -> Self {
        BasisArg(BasisForm::One(id.into()))
    }

    /// The records cited, in order.
    pub fn ids(&self) -> &[IdOrRef] {
        match &self.0 {
            BasisForm::One(id) => std::slice::from_ref(id),
            BasisForm::Several(ids) => ids,
        }
    }
}

impl TryFrom<BasisForm<IdOrRef>> for BasisArg {
    type Error = String;
    fn try_from(f: BasisForm<IdOrRef>) -> Result<Self, String> {
        if let BasisForm::Several(ids) = &f {
            listed(ids, 1)?;
        }
        Ok(BasisArg(f))
    }
}

impl From<BasisArg> for BasisForm<IdOrRef> {
    fn from(b: BasisArg) -> BasisForm<IdOrRef> {
        b.0
    }
}

/// What a record says it rests on: the records it cites, in the order cited, none twice and at least one. It has one
/// written form: a single record is its id alone (as every record written before a basis could be several), and
/// only two or more are a list. The kernel checks that each exists and nothing else about them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "BasisForm", into = "BasisForm")]
pub struct Basis(Vec<Id>);

impl Basis {
    /// These records, in order, each kept where it is first named; nothing at all if there are none.
    pub fn of(ids: impl IntoIterator<Item = Id>) -> Option<Basis> {
        let mut out: Vec<Id> = vec![];
        for id in ids {
            if !out.contains(&id) {
                out.push(id);
            }
        }
        (!out.is_empty()).then_some(Basis(out))
    }

    /// The records cited, in order (never empty).
    pub fn ids(&self) -> &[Id] {
        &self.0
    }

    /// The record cited first.
    pub fn first(&self) -> &str {
        &self.0[0]
    }

    pub fn cites(&self, record: &str) -> bool {
        self.0.iter().any(|x| x == record)
    }
}

impl TryFrom<BasisForm> for Basis {
    type Error = String;
    fn try_from(f: BasisForm) -> Result<Self, String> {
        match f {
            BasisForm::One(id) => Ok(Basis(vec![id])),
            BasisForm::Several(ids) => {
                listed(&ids, 2)?;
                Ok(Basis(ids))
            }
        }
    }
}

impl From<Basis> for BasisForm {
    fn from(mut b: Basis) -> BasisForm {
        if b.0.len() == 1 {
            BasisForm::One(b.0.remove(0))
        } else {
            BasisForm::Several(b.0)
        }
    }
}

/// `"public"`, or the entities whose participants may perceive the record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Visibility {
    Public(PublicMarker),
    Only(Vec<Id>),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PublicMarker {
    Public,
}

impl Visibility {
    pub fn public() -> Self {
        Visibility::Public(PublicMarker::Public)
    }

    /// Visible to exactly these entities (sorted and de-duplicated).
    pub fn only(ids: impl IntoIterator<Item = Id>) -> Self {
        let set: std::collections::BTreeSet<Id> = ids.into_iter().collect();
        Visibility::Only(set.into_iter().collect())
    }

    pub fn allows(&self, entity: &str) -> bool {
        match self {
            Visibility::Public(_) => true,
            Visibility::Only(ids) => ids.iter().any(|i| i == entity),
        }
    }
}

/// A position to create: its title and role (presentation), what it sees, and how a code participant does the job.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NewPosition {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub channels: Vec<Channel>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role_module: Option<Value>,
    #[serde(default, rename = "ref", skip_serializing_if = "Option::is_none")]
    pub bind: Option<String>,
}

/// A survey (nature): what's counted or measured, and where.
/// What an investigation is of: the latest taking of goods of a kind from someone at a structure.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Investigate {
    pub from: IdOrRef,
    pub at: IdOrRef,
    pub kind: Id,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Survey {
    pub of: Id,
    pub cells: Vec<Id>,
}

/// An agreement's terms. Apart from who the parties are, all of it is opaque data.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AgreementTerms {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template: Option<String>,
    pub parties: Vec<IdOrRef>,
    pub commitments: Vec<Commitment>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub term: Option<i64>,
    /// After the term: `periodic`, it continues until ended by notice (absent: it ends with its term).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub then: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub termination: Option<Vec<Termination>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attrs: Option<Frozen>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Commitment {
    pub who: IdOrRef,
    pub does: Frozen,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub every: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Termination {
    pub party: IdOrRef,
    pub notice: i64,
}

// ---- records ----------------------------------------------------------------

/// Author of the records a world begins with.
pub const GENESIS: &str = "genesis";

/// A stored record. Append-only: records are never edited or removed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Record {
    pub id: Id,
    /// A participant id, or "genesis".
    pub author: Id,
    /// The position the author made it in (absent: as themselves). Not `position`: a claim's
    /// Hohfeld position has that name.
    #[serde(default, rename = "in_position", skip_serializing_if = "Option::is_none")]
    pub position: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speaks_for: Option<Id>,
    pub at: i64,
    pub visible_to: Visibility,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub basis: Option<Basis>,
    /// Who did the work of making it, where that was not the author itself (the action's `by`; foundations F3).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub by: Option<Vec<Id>>,
    #[serde(flatten)]
    pub body: RecordBody,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "record", rename_all = "snake_case")]
pub enum RecordBody {
    Claim {
        position: Position,
        holder: Id,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        counterparty: Option<Id>,
        about: Frozen,
    },
    ClaimTransfer {
        claim: Id,
        to: Id,
    },
    ClaimRelease {
        claim: Id,
    },
    Agreement {
        terms: AgreementTerms,
    },
    Signature {
        agreement: Id,
        #[serde(rename = "as")]
        party: Id,
    },
    Notice {
        agreement: Id,
        #[serde(rename = "as")]
        party: Id,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        text: Option<String>,
    },
    Statement {
        kind: Id,
        text: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        data: Option<Frozen>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        adico: Option<Frozen>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        formal: Option<Frozen>,
        /// What someone may take up, on what terms (contracts: Offer; docs/design/ai-citizens.md 2a). Facts only; the
        /// kernel executes none of it.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        offer: Option<Frozen>,
        /// A recurring situation people may take part in (contracts: Practice; 2b). It has no power.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        practice: Option<Frozen>,
        /// Something put forward to be believed (contracts: Assertion; docs/design/contracts-0.7.md A1). No power.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        assertion: Option<Frozen>,
        /// A registry's act: an organisation registered or dissolved (contracts: Registry). Content, never physics.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        registry: Option<Frozen>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        addressed_to: Option<Vec<Id>>,
        /// The cell it's put up on, if any.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        place: Option<Id>,
    },
    Withdrawal {
        withdraws: Id,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        text: Option<String>,
    },
    Vote {
        ballot: Id,
        choice: String,
    },
    EntityDeclaration {
        entity: Id,
        kind: String,
        name: String,
    },
}

impl RecordBody {
    pub fn kind_name(&self) -> &'static str {
        match self {
            RecordBody::Claim { .. } => "claim",
            RecordBody::ClaimTransfer { .. } => "claim_transfer",
            RecordBody::ClaimRelease { .. } => "claim_release",
            RecordBody::Agreement { .. } => "agreement",
            RecordBody::Signature { .. } => "signature",
            RecordBody::Notice { .. } => "notice",
            RecordBody::Statement { .. } => "statement",
            RecordBody::Withdrawal { .. } => "withdrawal",
            RecordBody::Vote { .. } => "vote",
            RecordBody::EntityDeclaration { .. } => "entity_declaration",
        }
    }

    /// Records this record points at (they must exist).
    pub fn records_referenced(&self) -> Vec<&str> {
        match self {
            RecordBody::ClaimTransfer { claim, .. } | RecordBody::ClaimRelease { claim } => vec![claim],
            RecordBody::Signature { agreement, .. } | RecordBody::Notice { agreement, .. } => vec![agreement],
            RecordBody::Withdrawal { withdraws, .. } => vec![withdraws],
            RecordBody::Vote { ballot, .. } => vec![ballot],
            _ => vec![],
        }
    }
}

impl Record {
    /// Every entity this record names directly. Used by `involving` channel
    /// filters and to check that references exist.
    pub fn entities_named(&self) -> Vec<&str> {
        let mut v: Vec<&str> = vec![];
        if let Some(s) = &self.speaks_for {
            v.push(s);
        }
        match &self.body {
            RecordBody::Claim { holder, counterparty, .. } => {
                v.push(holder);
                v.extend(counterparty.as_deref());
            }
            RecordBody::ClaimTransfer { to, .. } => v.push(to),
            RecordBody::Agreement { terms } => {
                v.extend(terms.parties.iter().map(String::as_str));
                v.extend(terms.commitments.iter().map(|c| c.who.as_str()));
                v.extend(terms.termination.iter().flatten().map(|t| t.party.as_str()));
            }
            RecordBody::Signature { party, .. } | RecordBody::Notice { party, .. } => v.push(party),
            RecordBody::Statement { addressed_to, .. } => v.extend(addressed_to.iter().flatten().map(Id::as_str)),
            RecordBody::EntityDeclaration { entity, .. } => v.push(entity),
            RecordBody::ClaimRelease { .. } | RecordBody::Withdrawal { .. } | RecordBody::Vote { .. } => {}
        }
        v
    }

    /// Entities in the visibility list (they must exist, but a record isn't
    /// "about" someone just because they can see it).
    pub fn visibility_entities(&self) -> Vec<&str> {
        match &self.visible_to {
            Visibility::Only(ids) => ids.iter().map(Id::as_str).collect(),
            Visibility::Public(_) => vec![],
        }
    }
}
