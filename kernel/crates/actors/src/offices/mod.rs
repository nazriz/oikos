//! Lane E's actors (government.ts, institutions.ts, police.ts, tribunal.ts, desk.ts, school.ts, elections.ts, utilities.ts, books.ts; docs/port-guide.md, section 8). Each kind in a module of its own here, listed in
//! `KINDS` (the registry reads it: no lane edits another's list).

use crate::Kind;

pub mod hearing;
pub mod land;
pub mod staff;
pub mod books;
pub mod builder;
pub mod council;
pub mod desk;
pub mod elections;
pub mod planning;
pub mod police;
pub mod registry;
pub mod school;
pub mod treasury;
pub mod tribunal;
pub mod utilities;

/// Every kind of this lane, in name order.
pub static KINDS: &[&dyn Kind] = &[
    &registry::ChildProtection,
    &council::CouncilClerk,
    &council::Councillor,
    &elections::ElectoralOffice,
    &treasury::FinanceOfficer,
    &planning::Inspector,
    &council::MayorCode,
    &planning::PlanningOfficer,
    &treasury::RatesOfficer,
    &registry::CityRegistry,
    &treasury::TaxClerk,
    &treasury::Works,
    &builder::Builder,
    &registry::LandRegistry,
    &books::Clerk,
    &desk::Desk,
    &police::Station,
    &school::Principal,
    &tribunal::Member,
    &tribunal::Registrar,
    &utilities::Energy,
    &utilities::Water,
];

/// Where in its first hour an office first wakes: `base` seconds plus a spread of up to `span` that depends only on who
/// the participant is (TS drew `ctx.rng("first-wake")`; `Kind::first_wake` has no stream to draw from, and an office's
/// first wake needs spreading only so that they do not all act at the same second). FNV-1a of the participant's id.
pub fn spread(ctx: &crate::Ctx, base: i64, span: i64) -> i64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in ctx.participant.bytes() {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x100000001b3);
    }
    base + if span > 0 { (h % span as u64) as i64 } else { 0 }
}

/// A plan that keeps a `Book`: what `noting(book, stepper(...))` wrapped in TS (common.ts), so a law the book could
/// not read is said in the next act's reasons.
pub trait Booked: crate::steps::Plan {
    fn book_mut(&mut self) -> &mut crate::common::Book;
}

/// A stepper whose acts carry what its book could not read of the laws (`common::noted`).
pub struct Noting<P: Booked>(pub crate::steps::Stepper<P>);

impl<P: Booked> Noting<P> {
    pub fn new(plan: P) -> Self {
        Noting(crate::steps::Stepper::new(plan))
    }
    pub fn restore(saved: serde_json::Value) -> Result<Self, String> {
        Ok(Noting(crate::steps::Stepper::restore(saved)?))
    }
}

impl<P: Booked> crate::Actor for Noting<P> {
    fn step(&mut self, pic: &crate::Picture, cx: &mut crate::Cx) -> crate::Action {
        let a = self.0.step(pic, cx);
        crate::common::noted(self.0.plan.book_mut(), a)
    }
    fn beliefs(&self) -> Vec<crate::Belief> {
        self.0.beliefs()
    }
    fn sent(&mut self, action: &str) {
        self.0.sent(action)
    }
    fn save(&self) -> Result<serde_json::Value, String> {
        self.0.save()
    }
}

/// The forms of a group of the catalogue (papers.ts's export of that name), as a manifest's `issues` lists them.
pub fn forms_issued(group: &str) -> Vec<serde_json::Value> {
    oikos_rules::forms::group(group).iter().filter_map(|f| serde_json::to_value(f).ok()).collect()
}

/// A small rig for the unit tests of an office: an actor, a view, and records handed to it as an observation.
#[cfg(test)]
pub mod testing {
    use crate::{Action, Actor, Ctx, Cx, Draws, Kind, WorldInfo};
    use oikos_sight::{Observation, View};
    use serde_json::{json, Value};
    use std::sync::Arc;

    pub const DAY: i64 = 86_400;

    /// A TS module's manifest, as participants/manifests/<name>.json holds it (compiled in, so no test reads a file).
    pub fn ts_manifest(name: &str) -> Value {
        let text: &str = match name {
            "city.child_protection" => include_str!("../../../../../participants/manifests/city.child_protection.json"),
            "city.council_clerk" => include_str!("../../../../../participants/manifests/city.council_clerk.json"),
            "city.councillor" => include_str!("../../../../../participants/manifests/city.councillor.json"),
            "city.electoral_office" => include_str!("../../../../../participants/manifests/city.electoral_office.json"),
            "city.finance_officer" => include_str!("../../../../../participants/manifests/city.finance_officer.json"),
            "city.inspector" => include_str!("../../../../../participants/manifests/city.inspector.json"),
            "city.mayor_code" => include_str!("../../../../../participants/manifests/city.mayor_code.json"),
            "city.planning_officer" => include_str!("../../../../../participants/manifests/city.planning_officer.json"),
            "city.rates_officer" => include_str!("../../../../../participants/manifests/city.rates_officer.json"),
            "city.registry" => include_str!("../../../../../participants/manifests/city.registry.json"),
            "city.tax_clerk" => include_str!("../../../../../participants/manifests/city.tax_clerk.json"),
            "city.works" => include_str!("../../../../../participants/manifests/city.works.json"),
            "firm.builder" => include_str!("../../../../../participants/manifests/firm.builder.json"),
            "land.registry" => include_str!("../../../../../participants/manifests/land.registry.json"),
            "office.clerk" => include_str!("../../../../../participants/manifests/office.clerk.json"),
            "office.desk" => include_str!("../../../../../participants/manifests/office.desk.json"),
            "police.station" => include_str!("../../../../../participants/manifests/police.station.json"),
            "school.principal" => include_str!("../../../../../participants/manifests/school.principal.json"),
            "tribunal.member" => include_str!("../../../../../participants/manifests/tribunal.member.json"),
            "tribunal.registrar" => include_str!("../../../../../participants/manifests/tribunal.registrar.json"),
            "utility.energy" => include_str!("../../../../../participants/manifests/utility.energy.json"),
            "utility.water" => include_str!("../../../../../participants/manifests/utility.water.json"),
            other => panic!("no TS manifest for {other}"),
        };
        serde_json::from_str(text).expect("a manifest")
    }

    /// A statement as the world would record it.
    pub fn st(id: &str, at: i64, kind: &str, speaks_for: &str, to: &[&str], data: Value) -> Value {
        let mut r = json!({ "id": id, "record": "statement", "author": "p.x", "speaks_for": speaks_for, "at": at, "visible_to": "public", "kind": kind, "text": kind, "data": data });
        if !to.is_empty() {
            r["addressed_to"] = json!(to);
        }
        r
    }

    pub struct Rig {
        pub actor: Box<dyn Actor>,
        pub ctx: Ctx,
        view: View,
        draws: Draws,
        calls: u32,
    }

    impl Rig {
        pub fn new(kind: &dyn Kind, entity: &str, position: Option<&str>, params: Value) -> Rig {
            let ctx = Ctx {
                participant: format!("p.{entity}"),
                performer: Default::default(),
                entity: entity.into(),
                position: position.map(String::from),
                params: params.as_object().cloned().unwrap_or_default(),
                world: Arc::new(WorldInfo { tick: 60, run_end: 400 * DAY, ..Default::default() }),
            };
            let actor = kind.create(&ctx).expect("the kind is made");
            Rig { actor, ctx, view: View::default(), draws: Draws::new(&format!("p.{entity}"), position.unwrap_or("self")), calls: 0 }
        }
        /// The actor wakes at `t`, shown these records (new since its last look); its action.
        pub fn wake(&mut self, t: i64, records: &[Value]) -> Action {
            let obs: Observation = serde_json::from_value(json!({
                "participant": self.ctx.participant, "t": t, "status": "active", "outcomes": [], "inbox": [], "drafts": [],
                "channels": { "records": { "kind": "records", "records": records } },
            }))
            .expect("an observation");
            let pic = self.view.apply(obs, None, &self.ctx.entity, "cadence", DAY);
            let mut cx = Cx::new(pic.t, &self.ctx, &mut self.draws, 1, vec![]);
            let a = self.actor.step(&pic, &mut cx);
            if matches!(a, Action::Call { .. }) {
                self.calls += 1;
                self.actor.sent(&format!("act.{}", self.calls));
            }
            a
        }
        /// The program of a call action, as text (empty for anything else).
        pub fn text(a: &Action) -> String {
            match a {
                Action::Call { program, .. } => oikos_sight::calls::program_text(program),
                _ => String::new(),
            }
        }
        /// Wake until the actor waits (what it does in one day, in order), each call's text.
        pub fn day(&mut self, t: i64, records: &[Value]) -> Vec<String> {
            let mut out = vec![];
            let mut shown = records.to_vec();
            for _ in 0..40 {
                let a = self.wake(t, &shown);
                shown.clear();
                match a {
                    Action::Call { .. } => out.push(Self::text(&a)),
                    _ => break,
                }
            }
            out
        }
    }
}
