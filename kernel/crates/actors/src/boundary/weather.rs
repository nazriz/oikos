//! world.weather: the weather bureau (the outside world's, as a state's or nation's is). Ported from
//! participants/src/behaviour/world.ts (`weather`, 0.1.0) as the port's worked example (docs/port-guide.md).
//!
//! It knows the weather the world will have (`events`: heavy rain, drought, heatwaves, each from a day for some days;
//! the run's weather, drawn from the climate by the generator) and warns of each publicly `lead_days` ahead, saying
//! when it is expected to end. It changes nothing: the weather comes whether or not anyone listens. Documented in
//! docs/behaviour/weather.md. Its knowledge of the future is declared (`boundary`), as the no-god-view rule requires.

use crate::steps::{because, say, Plan, Say, Step, Stepper, Visible};
use crate::{Actor, Ctx, Cx, Kind, Picture, DAY};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Spell {
    kind: String,
    from_day: i64,
    days: i64,
}

pub struct Weather;

const FUTURE: &str = "The weather is fixed before the run, like the ground: this module stands for it at the world's edge, and is handed the spells to come so that it can warn of each a few days ahead. Nothing in the world can know or change them otherwise.";

impl Kind for Weather {
    fn name(&self) -> &'static str {
        "world.weather"
    }
    fn version(&self) -> &'static str {
        "0.1.0"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/weather.md"
    }
    fn manifest(&self) -> Value {
        json!({
            "name": self.name(), "version": self.version(), "doc": self.doc(),
            "params": {
                "events": { "schema": { "type": "array" }, "default": [], "source": "placeholder" },
                "lead_days": { "schema": { "type": "integer" }, "unit": "days", "default": 2, "source": "placeholder" },
            },
            "perceives": [], "state": "none",
            "boundary": [{ "what": "future", "why": FUTURE }],
            "answers": { "office": "the weather bureau", "acts": "It publishes its warnings as it issues them. It takes no requests." },
        })
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        DAY
    }
    fn first_wake(&self, _: &Ctx) -> i64 {
        6 * 3600
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        let events: Vec<Spell> = ctx.param("events", vec![])?;
        let lead_days: i64 = ctx.param("lead_days", 2)?;
        Ok(Box::new(Stepper::new(Bureau { events, lead_days, next: 0, run_end: ctx.world.run_end })))
    }
    fn restore(&self, _: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        Ok(Box::new(Stepper::<Bureau>::restore(saved)?))
    }
}

#[derive(Serialize, Deserialize)]
struct Bureau {
    events: Vec<Spell>,
    lead_days: i64,
    /// The spells warned of so far (they are in order).
    next: usize,
    run_end: i64,
}

fn said(kind: &str) -> &str {
    match kind {
        "heavy_rain" => "Heavy rain",
        "drought" => "Drought",
        "heatwave" => "Heatwave",
        other => other,
    }
}

impl Bureau {
    fn warn_at(&self, e: &Spell) -> i64 {
        ((e.from_day - self.lead_days) * DAY + 6 * 3600).max(0)
    }
}

impl Plan for Bureau {
    type Then = ();
    fn absorb(&mut self, _: &Picture, _: &mut Cx) {}
    fn plan(&mut self, pic: &Picture, _: &mut Cx) -> Vec<Step<()>> {
        let mut steps = vec![];
        while self.next < self.events.len() && self.warn_at(&self.events[self.next]) <= pic.t {
            let e = &self.events[self.next];
            self.next += 1;
            let (from, until) = (e.from_day * DAY, (e.from_day + e.days) * DAY);
            let w = said(&e.kind);
            steps.push(because(
                format!("{w} expected from day {} for {} days: warning the public.", e.from_day, e.days),
                vec![say(
                    "weather_warning",
                    &format!("{w} warning: expected from day {} for about {} days.", e.from_day + 1, e.days),
                    Say {
                        visible: Some(Visible::Public),
                        data: Some(json!({ "kind": e.kind, "from": from, "until": until })),
                        ..Default::default()
                    },
                )],
            ));
        }
        steps
    }
    fn until(&self, _: &Picture) -> Option<i64> {
        Some(self.events.get(self.next).map_or(self.run_end + DAY, |e| self.warn_at(e)))
    }
}
