//! Building blocks, mirroring contracts/blocks.schema.json. Field names and
//! shapes must match the schema exactly; tests/conformance.rs checks that the
//! contract examples round-trip through these types.

use serde::{Deserialize, Serialize};

/// An id, or a `$name` bound earlier in the same action.
pub type IdOrRef = String;
pub type Id = String;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "block", rename_all = "snake_case", deny_unknown_fields)]
pub enum Block {
    CreateEntity {
        founder: IdOrRef,
        kind: CreatableKind,
        name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        controller: Option<IdOrRef>,
        #[serde(default, rename = "ref", skip_serializing_if = "Option::is_none")]
        bind: Option<String>,
    },
    DissolveEntity {
        entity: IdOrRef,
        successor: IdOrRef,
    },
    Transfer {
        from: IdOrRef,
        to: IdOrRef,
        amount: i64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        memo: Option<String>,
    },
    TransferRight {
        right: Id,
        to: IdOrRef,
    },
    GrantRight {
        grantor: IdOrRef,
        parcel: Id,
        kind: GrantableRight,
        to: IdOrRef,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        units: Option<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        duration: Option<i64>,
        revocable: bool,
        #[serde(default, rename = "ref", skip_serializing_if = "Option::is_none")]
        bind: Option<String>,
    },
    RevokeRight {
        right: Id,
    },
    Construct {
        owner: IdOrRef,
        parcel: Id,
        structure_type: Id,
        contractor: IdOrRef,
        #[serde(default, rename = "ref", skip_serializing_if = "Option::is_none")]
        bind: Option<String>,
    },
    Demolish {
        structure: Id,
        contractor: IdOrRef,
    },
    EnactRule {
        jurisdiction: Id,
        rule: Rule,
        #[serde(default, rename = "ref", skip_serializing_if = "Option::is_none")]
        bind: Option<String>,
    },
    RepealRule {
        rule: Id,
    },
    ProposeAgreement {
        terms: AgreementTerms,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        offer_expires_after: Option<i64>,
        #[serde(default, rename = "ref", skip_serializing_if = "Option::is_none")]
        bind: Option<String>,
    },
    RespondAgreement {
        agreement: IdOrRef,
        #[serde(rename = "as")]
        party: Id,
        decision: AgreementDecision,
    },
    TerminateAgreement {
        agreement: Id,
        #[serde(rename = "as")]
        party: Id,
    },
    Message {
        to: Vec<Id>,
        text: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        re: Option<Id>,
    },
    Decide {
        proposal: Id,
        decision: Decision,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        note: Option<String>,
    },
}

impl Block {
    pub fn name(&self) -> &'static str {
        match self {
            Block::CreateEntity { .. } => "create_entity",
            Block::DissolveEntity { .. } => "dissolve_entity",
            Block::Transfer { .. } => "transfer",
            Block::TransferRight { .. } => "transfer_right",
            Block::GrantRight { .. } => "grant_right",
            Block::RevokeRight { .. } => "revoke_right",
            Block::Construct { .. } => "construct",
            Block::Demolish { .. } => "demolish",
            Block::EnactRule { .. } => "enact_rule",
            Block::RepealRule { .. } => "repeal_rule",
            Block::ProposeAgreement { .. } => "propose_agreement",
            Block::RespondAgreement { .. } => "respond_agreement",
            Block::TerminateAgreement { .. } => "terminate_agreement",
            Block::Message { .. } => "message",
            Block::Decide { .. } => "decide",
        }
    }
}

pub const BLOCK_NAMES: [&str; 15] = [
    "create_entity",
    "dissolve_entity",
    "transfer",
    "transfer_right",
    "grant_right",
    "revoke_right",
    "construct",
    "demolish",
    "enact_rule",
    "repeal_rule",
    "propose_agreement",
    "respond_agreement",
    "terminate_agreement",
    "message",
    "decide",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CreatableKind {
    Firm,
    Trust,
    Agency,
    Union,
    Club,
    Cooperative,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GrantableRight {
    Use,
    Access,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RightKind {
    Surface,
    Subsurface,
    Use,
    Access,
}

impl From<GrantableRight> for RightKind {
    fn from(g: GrantableRight) -> Self {
        match g {
            GrantableRight::Use => RightKind::Use,
            GrantableRight::Access => RightKind::Access,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StructureCategory {
    Residential,
    Commercial,
    Industrial,
    Civic,
    Green,
}

pub const ALL_CATEGORIES: [StructureCategory; 5] = [
    StructureCategory::Residential,
    StructureCategory::Commercial,
    StructureCategory::Industrial,
    StructureCategory::Civic,
    StructureCategory::Green,
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgreementDecision {
    Accept,
    Decline,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Decision {
    Approve,
    Reject,
}

/// `"all"` or an explicit list of parcel ids.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ParcelScope {
    All(AllMarker),
    List(Vec<Id>),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AllMarker {
    All,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Rule {
    Zoning { parcels: ParcelScope, allow: Vec<StructureCategory> },
    RentCap { parcels: ParcelScope, max_per_30d: i64, applies_to: RentCapScope },
}

impl Rule {
    pub fn parcels(&self) -> &ParcelScope {
        match self {
            Rule::Zoning { parcels, .. } | Rule::RentCap { parcels, .. } => parcels,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RentCapScope {
    NewAgreements,
    AllPayments,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum AgreementTerms {
    Lease {
        lessor: IdOrRef,
        lessee: IdOrRef,
        parcel: Id,
        units: u32,
        rent: i64,
        period: i64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        term: Option<i64>,
        notice: i64,
    },
    Employment {
        employer: IdOrRef,
        employee: IdOrRef,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        workplace: Option<Id>,
        wage: i64,
        period: i64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        term: Option<i64>,
        notice: i64,
    },
}

impl AgreementTerms {
    /// (payer, payee) of the periodic payment.
    pub fn payer_payee(&self) -> (&str, &str) {
        match self {
            AgreementTerms::Lease { lessor, lessee, .. } => (lessee, lessor),
            AgreementTerms::Employment { employer, employee, .. } => (employer, employee),
        }
    }

    pub fn parties(&self) -> [&str; 2] {
        match self {
            AgreementTerms::Lease { lessor, lessee, .. } => [lessor, lessee],
            AgreementTerms::Employment { employer, employee, .. } => [employer, employee],
        }
    }

    pub fn amount(&self) -> i64 {
        match self {
            AgreementTerms::Lease { rent, .. } => *rent,
            AgreementTerms::Employment { wage, .. } => *wage,
        }
    }

    pub fn period(&self) -> i64 {
        match self {
            AgreementTerms::Lease { period, .. } | AgreementTerms::Employment { period, .. } => *period,
        }
    }

    pub fn term(&self) -> Option<i64> {
        match self {
            AgreementTerms::Lease { term, .. } | AgreementTerms::Employment { term, .. } => *term,
        }
    }

    pub fn notice(&self) -> i64 {
        match self {
            AgreementTerms::Lease { notice, .. } | AgreementTerms::Employment { notice, .. } => *notice,
        }
    }

    pub fn is_lease(&self) -> bool {
        matches!(self, AgreementTerms::Lease { .. })
    }
}
