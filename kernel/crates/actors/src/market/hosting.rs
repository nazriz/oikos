//! firm.host: a hosting firm (docs/design/foundations-2.md 7.3 and step E5; docs/behaviour/hosting.md). It holds the
//! hardware the systems of its clients run on (kernel `runs_on`, foundations-2 P4), in a building of its own on the
//! town's network: its energy and water come over the feeders and the main as anyone's do, and its client systems' work
//! draws them from what it holds there. Its plant draws what the work does not, all day (servers idle, cooling,
//! lighting): each day it uses what it holds beyond what it keeps in hand for the work. It pays the bills addressed to
//! it, from the fees its clients pay. It sets no price and decides no client's use: it is the building's operator.

use super::trade;
use crate::common::{addressed_to, data, own_account, Book, DAY};
use crate::steps::{arg, because, call, pay, text, Pay, Plan, Step, Stepper};
use crate::{Actor, Ctx, Cx, Kind, Picture};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeSet;

/// What the plant draws of a kind beyond the work: its recipe (`task`, a unit of the kind used up) and what it keeps in
/// hand for its clients' work (`keep`).
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Plant {
    task: String,
    kind: String,
    keep: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Params {
    /// Its building, where the hardware is held and the network delivers.
    at: String,
    #[serde(default)]
    plant: Vec<Plant>,
}

pub struct Host;

impl Kind for Host {
    fn name(&self) -> &'static str {
        "firm.host"
    }
    fn version(&self) -> &'static str {
        "0.1.0"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/hosting.md"
    }
    fn manifest(&self) -> Value {
        json!({
            "name": self.name(), "version": self.version(), "doc": self.doc(),
            "params": {
                "at": { "schema": { "type": "string", "description": "its building (the world must say)" }, "default": "", "source": "the world gives it (its building)" },
                "plant": { "schema": { "type": "array" }, "default": [], "source": "the world gives it: what its plant draws beyond the work, by kind, and what it keeps in hand for the work" },
            },
            "perceives": [], "state": "none",
            "answers": { "office": "a hosting firm", "acts": "It runs the building where its clients' systems run, and pays its bills. It takes no requests." },
        })
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        DAY
    }
    fn first_wake(&self, _: &Ctx) -> i64 {
        23 * 3600
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        let p = Params { at: ctx.need("at", "firm.host")?, plant: ctx.param("plant", vec![])? };
        Ok(Box::new(Stepper::new(Hosting { me: ctx.entity.clone(), p, book: Book::new(), answered: BTreeSet::new() })))
    }
    fn restore(&self, _: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        Ok(Box::new(Stepper::<Hosting>::restore(saved)?))
    }
}

#[derive(Serialize, Deserialize)]
struct Hosting {
    me: String,
    p: Params,
    book: Book,
    /// Invoices paid (or with nothing to pay by).
    answered: BTreeSet<String>,
}

impl Plan for Hosting {
    type Then = ();

    fn absorb(&mut self, pic: &Picture, _: &mut Cx) {
        self.book.absorb(pic);
    }

    fn plan(&mut self, pic: &Picture, cx: &mut Cx) -> Vec<Step<()>> {
        let mut steps = vec![];
        // The plant's own draw: what came in beyond what is kept in hand for the clients' work.
        for pl in &self.p.plant {
            let over = trade::held(pic, &self.p.at, &pl.kind) - pl.keep;
            if over > 0 {
                steps.push(because(
                    format!("The plant's day beyond the work (idle hardware, cooling): {over} {} used.", pl.kind),
                    vec![call("work", vec![("task", Some(arg(&pl.task))), ("units", Some(text(over.to_string()))), ("at", Some(arg(&self.p.at)))])],
                ));
            }
        }
        // Bills addressed to us: each paid when the account covers it, oldest first.
        let Some(acct) = own_account(pic) else { return steps };
        let mut in_hand = acct.balance;
        let open: Vec<_> = self.book.open("invoice").cloned().collect();
        for inv in open {
            if self.answered.contains(inv.id.as_str()) || !addressed_to(&inv).iter().any(|x| *x == self.me) {
                continue;
            }
            let Some(money) = data(&inv).get("outcome").and_then(|o| o.get("money")).cloned() else {
                self.answered.insert(inv.id.to_string());
                continue;
            };
            let amount = money.get("amount").and_then(crate::papers::lenient::whole).unwrap_or(0);
            let to = money.get("to").and_then(|x| x.as_str()).unwrap_or("").to_string();
            if amount <= 0 || to.is_empty() {
                self.answered.insert(inv.id.to_string());
                continue;
            }
            if in_hand < amount {
                continue;
            }
            in_hand -= amount;
            self.answered.insert(inv.id.to_string());
            steps.push(because(
                "Paying a bill addressed to us.",
                vec![pay(&to, amount, Pay { from: Some(acct.account.clone()), for_: Some("Paying an invoice.".into()), settles: Some(inv.id.to_string()), ..Default::default() }, cx)],
            ));
        }
        steps
    }
}
