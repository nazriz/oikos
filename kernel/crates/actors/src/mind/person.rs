//! participants/src/behaviour/mind.ts, in Rust (lane A2): who someone is, how satisfied, how they learn and decide,
//! their feelings and ties (docs/design/ai-citizens.md 3; docs/behaviour/citizen.md).
//!
//! The shared names (values, needs, emotions) are at the top: every part of the mind uses them.

use serde::{Deserialize, Serialize};

/// Schwartz's ten basic values (mind.ts `VALUES`), in TS's order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Value {
    SelfDirection,
    Stimulation,
    Hedonism,
    Achievement,
    Power,
    Security,
    Conformity,
    Tradition,
    Benevolence,
    Universalism,
}

impl Value {
    pub const ALL: [Value; 10] = [
        Value::SelfDirection,
        Value::Stimulation,
        Value::Hedonism,
        Value::Achievement,
        Value::Power,
        Value::Security,
        Value::Conformity,
        Value::Tradition,
        Value::Benevolence,
        Value::Universalism,
    ];
    pub fn name(self) -> &'static str {
        match self {
            Value::SelfDirection => "self_direction",
            Value::Stimulation => "stimulation",
            Value::Hedonism => "hedonism",
            Value::Achievement => "achievement",
            Value::Power => "power",
            Value::Security => "security",
            Value::Conformity => "conformity",
            Value::Tradition => "tradition",
            Value::Benevolence => "benevolence",
            Value::Universalism => "universalism",
        }
    }
    pub fn from_name(s: &str) -> Option<Value> {
        Value::ALL.into_iter().find(|v| v.name() == s)
    }
    pub fn index(self) -> usize {
        self as usize
    }
}

/// The needs a life meets or not (mind.ts `NEEDS`), in TS's order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Need {
    Subsistence,
    Shelter,
    Security,
    Social,
    Status,
    Belonging,
    Meaning,
}

impl Need {
    pub const ALL: [Need; 7] = [Need::Subsistence, Need::Shelter, Need::Security, Need::Social, Need::Status, Need::Belonging, Need::Meaning];
    pub fn name(self) -> &'static str {
        match self {
            Need::Subsistence => "subsistence",
            Need::Shelter => "shelter",
            Need::Security => "security",
            Need::Social => "social",
            Need::Status => "status",
            Need::Belonging => "belonging",
            Need::Meaning => "meaning",
        }
    }
    pub fn from_name(s: &str) -> Option<Need> {
        Need::ALL.into_iter().find(|v| v.name() == s)
    }
    pub fn index(self) -> usize {
        self as usize
    }
}

/// The emotions a person feels about someone or something (mind.ts `Emotion`), with their half-lives.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Emotion {
    Joy,
    Distress,
    Hope,
    Fear,
    Anger,
    Gratitude,
}

impl Emotion {
    pub const ALL: [Emotion; 6] = [Emotion::Joy, Emotion::Distress, Emotion::Hope, Emotion::Fear, Emotion::Anger, Emotion::Gratitude];
    pub fn name(self) -> &'static str {
        match self {
            Emotion::Joy => "joy",
            Emotion::Distress => "distress",
            Emotion::Hope => "hope",
            Emotion::Fear => "fear",
            Emotion::Anger => "anger",
            Emotion::Gratitude => "gratitude",
        }
    }
    pub fn from_name(s: &str) -> Option<Emotion> {
        Emotion::ALL.into_iter().find(|v| v.name() == s)
    }
    /// mind.ts `EMOTION_HALF_LIFE_DAYS`.
    pub fn half_life_days(self) -> i64 {
        match self {
            Emotion::Joy => 7,
            Emotion::Distress => 14,
            Emotion::Hope => 14,
            Emotion::Fear => 30,
            Emotion::Anger => 60,
            Emotion::Gratitude => 90,
        }
    }
}

/// A figure for each value (basis points), indexed by `Value::index`.
pub type Values = [i64; 10];
/// A figure for each need (basis points), indexed by `Need::index`.
pub type Needs = [i64; 7];

// ---- the rest of mind.ts follows (person, satisfaction, EWA, CONSUMAT, appraisal, decide, feelings, ties, pursuit).
