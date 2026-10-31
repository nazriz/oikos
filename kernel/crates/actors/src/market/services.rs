//! Services anyone can buy (docs/design/delegation.md section 2; docs/design/foundations-2.md 7.1, step E1): a provider
//! sells the work of its systems under a service agreement, and a buyer engages it. Two halves, both ordinary dealings:
//!
//! * **`firm.provider`**, a provider of services (a [`Kind`]): an organisation, from outside the town or of it, that
//!   publishes what it sells (a `service_offer` for each: the kinds of matter, the levels, what it claims a matter takes
//!   its system and how often it slips, its prices and terms, and what becomes of the records), takes an order paid with
//!   its set-up, delivers a system to an organisation that orders (`system`, the supplier's act: the system belongs to
//!   the client, kernel F4), offers the **`service` agreement** (the fee each month, its notice and term, what leaving
//!   costs, and the records term as `attrs.records`), and switches its systems off when the agreement ends, is not
//!   signed, or is not paid for (the supplier's physical power, as `world.vendor` does).
//! * **A library for the buyer** ([`Engagements`]): what a principal has engaged, from its own papers, and the
//!   paperwork (signing, the fee set up as a standing payment, notice with the exit paid).
//!
//! Nothing here sets how much anyone buys: a buyer decides by its own rule (the `Delegating` principal) or by hand (a
//! seat). The offers are the outside world's technology as the profile gives it (a boundary condition, with its sources);
//! the claims in an offer are the provider's, and the slips its systems really make are the world's table of slips.

use super::trade::{self, Order, OrderBook};
use crate::common::{bases_of, cites, data, filed_before, money_words, withdraw, Book, DAY, MONTH};
use crate::papers::agreements::{self, Offer as AgreementOffer};
use crate::papers::delegation::{Records, ServiceDelivery, ServiceEnded, ServiceOffer};
use crate::papers::{self, Paper};
use crate::steps::{arg, because, call, json as arg_json, pay, say, text, Done, Pay, Plan, Say, Step, Stepper, Visible};
use crate::{Actor, Ctx, Cx, Kind, Picture};
use oikos_sight::calls::Line;
use oikos_sight::Record;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

/// The agreement's template.
pub const SERVICE: &str = "service";

/// What an order for a service is for: the kind of the order (`service:<offer>`).
pub fn order_kind(offer: &str) -> String {
    format!("service:{offer}")
}

/// The memo a client's fee carries, by which the provider knows the agreement is paid.
pub fn fee_memo(agreement: &str) -> String {
    format!("Service {agreement}.")
}

/// The offers a reader has been shown: the latest of each provider's, in provider-and-id order.
pub fn offers_of(book: &Book) -> Vec<(String, ServiceOffer)> {
    let mut latest: BTreeMap<String, (i64, String, ServiceOffer)> = BTreeMap::new();
    for r in book.open(ServiceOffer::KIND) {
        let Some(provider) = r.speaks_for else { continue };
        let Some(mut o) = papers::read::<ServiceOffer>(r) else { continue };
        if o.id.is_empty() || o.template.is_empty() {
            continue;
        }
        let key = format!("{provider}|{}", o.id);
        if latest.get(&key).is_some_and(|x| x.0 > r.at) {
            continue;
        }
        o.provider = provider.to_string();
        latest.insert(key, (r.at, r.id.to_string(), o));
    }
    latest.into_values().map(|(_, id, o)| (id, o)).collect()
}

// ------------------------------------------------------------------------------------------------ the provider

const OUTSIDE: &str = "What assistants can do, at what speed, how often they slip, at what price and on what terms, is the outside world's technology on offer, as world prices are. A provider of the outside world stands for it at the world's edge, as it is held in the profile with its source; nothing in the town can know or change it otherwise, and nothing here sets how much anyone delegates.";

pub struct Provider;

impl Kind for Provider {
    fn name(&self) -> &'static str {
        "firm.provider"
    }
    fn version(&self) -> &'static str {
        "0.1.0"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/assistants.md"
    }
    fn manifest(&self) -> Value {
        let p = |schema: Value, default: Option<Value>, unit: Option<&str>, source: &str| {
            let mut m = json!({ "schema": schema, "source": source });
            if let Some(d) = default {
                m["default"] = d;
            }
            if let Some(u) = unit {
                m["unit"] = json!(u);
            }
            m
        };
        let int = |what: &str| json!({ "type": "integer", "description": what });
        json!({
            "name": self.name(), "version": self.version(), "doc": self.doc(),
            "params": {
                "account": p(json!({ "type": "string", "description": "the account it is paid into (the world must say)" }), Some(json!("")), None, "the account it is paid into (the world must say)"),
                "offers": p(json!({ "type": "array" }), Some(json!([])), None, "the world gives it (the profile's, with their sources)"),
                "releases": p(json!({ "type": "object" }), Some(json!({})), None, "the world gives it: the outside world's later releases of what an offer sells, a scenario's (none: the offers as made)"),
                "grace_days": p(int("a service unpaid this long (two months' fees and a fortnight) lets the provider switch its systems off"), Some(json!(75)), Some("days"), "placeholder"),
                "sign_days": p(int("a service whose agreement its client has not signed this long is switched off"), Some(json!(30)), Some("days"), "placeholder"),
                "unpaid_days": p(int("an order unpaid this long is declined"), Some(json!(7)), Some("days"), "placeholder"),
            },
            "perceives": [], "state": "none",
            "boundary": [{ "what": "assistants on offer", "why": OUTSIDE }],
            "answers": { "office": "a provider of assistants", "acts": "It publishes what it sells, sets up a service once its set-up is paid with an order (delivering a system to an organisation), offers the service agreement, and switches its systems off when the agreement ends or is not paid for. It takes no requests." },
        })
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        DAY
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        let p = Params {
            account: ctx.need("account", "firm.provider")?,
            offers: ctx.param("offers", vec![])?,
            unpaid_days: ctx.param("unpaid_days", 7)?,
            sign_days: ctx.param("sign_days", 30)?,
            grace_days: ctx.param("grace_days", 75)?,
            desk: ctx.param("desk", None)?,
            releases: ctx.param("releases", BTreeMap::new())?,
        };
        Ok(Box::new(Stepper::new(Providing {
            orders: OrderBook::new(&ctx.entity, Some(p.unpaid_days), None),
            me: ctx.entity.clone(),
            p,
            book: Book::new(),
            listed: BTreeMap::new(),
            services: vec![],
            clients: BTreeMap::new(),
        })))
    }
    fn restore(&self, _: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        Ok(Box::new(Stepper::<Providing>::restore(saved)?))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Params {
    account: String,
    /// What it sells, as the profile gives it (`provider`, `account` and `references` are filled in when published).
    offers: Vec<ServiceOffer>,
    unpaid_days: i64,
    sign_days: i64,
    grace_days: i64,
    /// Its own desk system, which writes a person's papers in their name (none: it serves only organisations).
    #[serde(default)]
    desk: Option<String>,
    /// Later releases of what an offer sells, by offer (foundations-2 E2): the scenario's. None: the offers as made.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    releases: BTreeMap<String, Vec<crate::market::automation::Release>>,
}

/// A service the provider has set up.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Served {
    order: String,
    delivery: Option<String>,
    client: String,
    offer: String,
    systems: Vec<String>,
    since: i64,
    agreement: Option<String>,
    last_paid: i64,
    ended: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Then {
    /// An offer published: its id is kept to be withdrawn when it is published again.
    Listed { offer: String, key: String },
    /// A system delivered to a paid order: the delivery paper and the agreement follow.
    Delivered { order: Order, offer: ServiceOffer },
    /// The delivery paper published: its id is the agreement's basis.
    Noted { order: String },
}

#[derive(Serialize, Deserialize)]
struct Providing {
    me: String,
    p: Params,
    book: Book,
    orders: OrderBook,
    /// Offer -> what it last published: its key (prices and clients) and its record.
    listed: BTreeMap<String, (String, Option<String>)>,
    services: Vec<Served>,
    /// Offer -> its clients (its references).
    clients: BTreeMap<String, BTreeSet<String>>,
}

impl Providing {
    /// An offer as it stands at `t`: the release out by then, if what it sells has later ones (its template, its claims, its
    /// prices), with its clients.
    fn now_offer(&self, o: &ServiceOffer, t: i64) -> ServiceOffer {
        use crate::market::automation::{at_release, release_at};
        let rel = release_at(&self.p.releases, &o.id, t);
        let mut x = ServiceOffer { provider: self.me.clone(), account: self.p.account.clone(), references: self.clients.get(&o.id).map_or(0, |c| c.len() as i64), ..o.clone() };
        if let Some(r) = rel {
            x.template = r.template.clone();
            x.claim_slip_bps = r.claim_slip_bps.unwrap_or(x.claim_slip_bps);
            if !r.claim_seconds.is_empty() {
                x.seconds = r.claim_seconds.clone();
            }
            x.fee_month = at_release(x.fee_month, rel);
            x.setup = at_release(x.setup, rel);
            x.exit = at_release(x.exit, rel);
        }
        x
    }

    fn words(&self, o: &ServiceOffer, cx: &Cx) -> String {
        let money = |n: i64| money_words(n, &cx.ctx.world);
        let levels: Vec<&str> = o.levels.iter().map(|l| l.words()).collect();
        format!(
            "{}: an assistant for {} that takes {} ({}), slipping, we say, {}% of the time. Set-up {}, {} a month, {}-day term ({} days' notice), {} to leave; {}. Order {}, paid with the order. {} client{}.",
            o.title,
            o.for_,
            o.kinds.join(", "),
            levels.join(", "),
            pct(o.claim_slip_bps),
            money(o.setup),
            money(o.fee_month),
            o.term_days,
            o.notice_days,
            money(o.exit),
            o.records.words(),
            order_kind(&o.id),
            o.references,
            if o.references == 1 { "" } else { "s" }
        )
    }

    /// The paper that goes with a service set up, and the agreement offered with it.
    fn delivery_step(&self, o: &Order, x: &ServiceOffer, ids: &[String], cx: &Cx) -> Step<Then> {
        let money = |n: i64| money_words(n, &cx.ctx.world);
        let paper = ServiceDelivery { order: o.id.clone(), offer: x.clone(), systems: ids.to_vec() };
        let mut agree = agreements::offer(
            &o.buyer,
            AgreementOffer {
                template: SERVICE.into(),
                term: Some(x.term_days * DAY),
                periodic: true,
                our_notice: Some(x.notice_days * DAY),
                their_notice: Some(x.notice_days * DAY),
                basis: Some(o.id.clone()),
                they: Some(pay(&self.p.account, x.fee_month, Pay { every: Some(MONTH), for_: Some(format!("Service of {}.", x.title)), ..Default::default() }, cx)),
                text: Some(format!(
                    "Service of {} to {}: {} a month, {} days, {} days' notice either way; {} to leave; {}. Systems: {}.",
                    x.title,
                    o.buyer,
                    money(x.fee_month),
                    x.term_days,
                    x.notice_days,
                    money(x.exit),
                    x.records.words(),
                    if ids.is_empty() { "the provider's own".to_string() } else { ids.join(", ") }
                )),
                ..Default::default()
            },
        );
        agree.args.push(("we_do".into(), text(format!("{} does the work of the service with its system{} ({}), and may switch {} off if the fee is not paid.", self.me, if ids.len() == 1 { "" } else { "s" }, ids.join(", "), if ids.len() == 1 { "it" } else { "them" }))));
        agree.args.push(("attrs".into(), arg_json(json!({ "records": x.records, "exit": x.exit, "offer": x.id }))));
        let note = say(
            ServiceDelivery::KIND,
            &format!("Set up for {}: {} ({}), at {} a month.", o.buyer, x.title, ids.join(", "), money(x.fee_month)),
            Say { to: Some(vec![o.buyer.clone()]), visible: Some(Visible::Only(vec![self.me.clone(), o.buyer.clone()])), basis: Some(o.id.clone()), data: Some(papers::data(&paper)), ..Default::default() },
        );
        let mut s = Step::new(vec![Line { bind: Some("delivery".into()), call: note }, Line { bind: None, call: agree }]);
        s.why = Some(format!("Set up {} for {}: publishing the delivery and offering the service agreement.", x.title, o.buyer));
        s.then(Then::Noted { order: o.id.clone() })
    }

    fn refund(&self, o: &Order, why: &str, cx: &Cx) -> Step<Then> {
        because(
            format!("{why}: sending {}'s money back.", o.buyer),
            vec![pay(&o.account, o.total(), Pay { from: Some(self.p.account.clone()), for_: Some(format!("Refund: {why}.")), ..Default::default() }, cx)],
        )
    }
}

fn pct(bps: i64) -> String {
    let w = bps / 100;
    match bps % 100 {
        0 => w.to_string(),
        r if r % 10 == 0 => format!("{w}.{}", r / 10),
        r => format!("{w}.{r:02}"),
    }
}

impl Plan for Providing {
    type Then = Then;

    fn absorb(&mut self, pic: &Picture, _: &mut Cx) {
        self.book.absorb(pic);
        self.orders.take(pic, Some(self.p.account.as_str()).filter(|a| !a.is_empty()));
        for tx in pic.transactions() {
            // "Service <agreement>." paid into our account: the service is paid for.
            let Some(rest) = tx.memo.as_deref().and_then(|m| m.strip_prefix("Service ")) else { continue };
            let id = rest.strip_suffix('.').unwrap_or(rest);
            if tx.to == self.p.account && !id.is_empty() && !id.contains(char::is_whitespace) {
                for s in &mut self.services {
                    if s.agreement.as_deref() == Some(id) {
                        s.last_paid = pic.t;
                    }
                }
            }
        }
    }

    fn plan(&mut self, pic: &Picture, cx: &mut Cx) -> Vec<Step<Then>> {
        let t = pic.t;
        let mut steps: Vec<Step<Then>> = vec![];
        // What it sells: published again when its prices or its clients change.
        for o in self.p.offers.clone() {
            let x = self.now_offer(&o, t);
            let mut key = format!("{}|{}|{}|{}", x.setup, x.fee_month, x.exit, x.references);
            // (A new release is published as the offer is: what it is, at its prices.)
            if self.p.releases.contains_key(&o.id) {
                key = format!("{key}|{}", x.template);
            }
            let was = self.listed.get(&o.id).cloned();
            if was.as_ref().is_some_and(|(k, _)| *k == key) {
                continue;
            }
            self.listed.insert(o.id.clone(), (key.clone(), was.as_ref().and_then(|(_, id)| id.clone())));
            let mut lines = vec![];
            if let Some((_, Some(old))) = &was {
                lines.push(Line { bind: None, call: withdraw(old, Some("Superseded.")) });
            }
            lines.push(Line { bind: Some("listed".into()), call: say(ServiceOffer::KIND, &self.words(&x, cx), Say { visible: Some(Visible::Public), data: Some(papers::data(&x)), ..Default::default() }) });
            let mut st = Step::new(lines).then(Then::Listed { offer: o.id.clone(), key });
            st.why = Some(if was.is_some() { format!("Our prices or clients have changed: publishing {} again.", o.title) } else { format!("What we sell: {}.", o.title) });
            steps.push(st);
        }
        // Orders paid in full: set the service up (a system delivered to an organisation), then the agreement.
        let due = self.orders.due(&self.book, t, |_| true);
        for o in due.paid {
            let id = o.kind.strip_prefix("service:").unwrap_or("");
            let Some(x) = self.p.offers.iter().find(|x| x.id == id).map(|b| self.now_offer(b, t)) else {
                steps.push(self.refund(&o, &format!("{} is not a service we sell", o.kind), cx));
                continue;
            };
            if o.unit_price < x.setup || o.quantity != 1 {
                steps.push(self.refund(&o, &format!("an order for {} is one set-up of {}", x.title, money_words(x.setup, &cx.ctx.world)), cx));
                continue;
            }
            if x.for_ != "organisations" {
                // (A person cannot hold a system: the provider's own desk writes their papers in their name, on the agreement.)
                let Some(desk) = self.p.desk.clone() else {
                    steps.push(self.refund(&o, &format!("{} has no desk to serve anyone from", x.title), cx));
                    continue;
                };
                self.clients.entry(x.id.clone()).or_default().insert(o.buyer.clone());
                self.services.push(Served { order: o.id.clone(), delivery: None, client: o.buyer.clone(), offer: x.id.clone(), systems: vec![], since: t, agreement: None, last_paid: t, ended: false });
                steps.push(self.delivery_step(&o, &x, &[desk], cx));
                continue;
            }
            let line = Line { bind: Some("sys0".into()), call: call("system", vec![("template", Some(arg(&x.template))), ("to", Some(arg(&o.buyer))), ("title", Some(text(x.title.clone())))]) };
            let mut st = Step::new(vec![line]).then(Then::Delivered { order: o.clone(), offer: x.clone() });
            st.why = Some(format!("{} has paid {} to set up {}: delivering its system.", o.buyer, money_words(o.total(), &cx.ctx.world), x.title));
            steps.push(st);
        }
        for o in due.unpaid {
            steps.push(trade::decline(&o, &self.me, "An order unpaid for a week: declining it."));
        }
        for (a, x) in self.orders.unclaimed(&self.book) {
            self.orders.refunded(&a);
            steps.push(trade::send_back(&a, x, &self.p.account, cx));
        }
        // Services: the agreement offered, and whether it stands. A service unsigned, ended or unpaid is switched off.
        let mut ids: Vec<usize> = (0..self.services.len()).collect();
        ids.sort_by(|a, b| filed_before(&self.services[*a].order, &self.services[*b].order));
        for i in ids {
            let s = self.services[i].clone();
            if s.ended {
                continue;
            }
            let a: Option<Arc<Record>> = match &s.agreement {
                Some(id) => self.book.get(id).cloned(),
                None => self.book.of_type("agreement").find(|r| cites(r, &s.order) && agreements::template_of(r) == Some(SERVICE)).cloned(),
            };
            if let (Some(a), None) = (&a, &s.agreement) {
                self.services[i].agreement = Some(a.id.to_string());
            }
            let unsigned = format!("{} has not signed the service agreement in {} days", s.client, self.p.sign_days);
            let waited = t - s.since >= self.p.sign_days * DAY;
            let why = match &a {
                None => waited.then(|| unsigned.clone()),
                Some(a) if self.book.taken_back(&a.id) => Some("the offer of the agreement was taken back".to_string()),
                Some(a) if !self.book.signed_by(&a.id, &s.client) => waited.then(|| unsigned.clone()),
                Some(a) if !self.book.in_force(&a.id) => Some("the service agreement has ended".to_string()),
                Some(_) if t - s.last_paid >= self.p.grace_days * DAY => Some(format!("the fee has not been paid for {} days", (t - s.last_paid) / DAY)),
                Some(_) => None,
            };
            let Some(why) = why else { continue };
            self.services[i].ended = true;
            let mut calls: Vec<_> = s.systems.iter().map(|x| call("system", vec![("retire", Some(arg(x)))])).collect();
            let ended = ServiceEnded { delivery: s.delivery.clone(), order: s.order.clone(), agreement: self.services[i].agreement.clone(), systems: s.systems.clone(), why: why.clone() };
            calls.push(say(
                ServiceEnded::KIND,
                &format!("The service to {} has ended ({why}): {} switched off.", s.client, if s.systems.is_empty() { "nothing".to_string() } else { s.systems.join(", ") }),
                Say {
                    to: Some(vec![s.client.clone()]),
                    visible: Some(Visible::Only(vec![self.me.clone(), s.client.clone()])),
                    basis: Some(s.delivery.clone().unwrap_or_else(|| s.order.clone())),
                    data: Some(papers::data(&ended)),
                    ..Default::default()
                },
            ));
            steps.push(because(format!("Ending the service to {}: {why}.", s.client), calls));
        }
        steps
    }

    fn then(&mut self, tok: &Then, done: Done, cx: &mut Cx) -> Vec<Step<Then>> {
        let Done::Outcome(out) = done else {
            if let Then::Delivered { order: o, .. } = tok {
                return vec![self.refund(o, "we could not set the service up", cx)];
            }
            return vec![];
        };
        match tok {
            Then::Listed { offer, key } => {
                if let Some(id) = out.created.as_ref().and_then(|c| c.get("listed")) {
                    self.listed.insert(offer.clone(), (key.clone(), Some(id.to_string())));
                }
                vec![]
            }
            Then::Delivered { order: o, offer: x } => {
                if !done.applied() {
                    return vec![self.refund(o, "we could not set the service up", cx)];
                }
                let ids: Vec<String> = out.created.as_ref().and_then(|c| c.get("sys0")).map(|x| x.to_string()).into_iter().collect();
                self.clients.entry(x.id.clone()).or_default().insert(o.buyer.clone());
                self.services.push(Served { order: o.id.clone(), delivery: None, client: o.buyer.clone(), offer: x.id.clone(), systems: ids.clone(), since: out.t, agreement: None, last_paid: out.t, ended: false });
                vec![self.delivery_step(o, x, &ids, cx)]
            }
            Then::Noted { order } => {
                if let Some(id) = out.created.as_ref().and_then(|c| c.get("delivery")) {
                    if let Some(s) = self.services.iter_mut().find(|s| &s.order == order) {
                        s.delivery = Some(id.to_string());
                    }
                }
                vec![]
            }
        }
    }
}

// ------------------------------------------------------------------------------------------------ the buyer's side

/// A service a principal has engaged, as its own papers show it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Engagement {
    pub delivery: String,
    pub order: String,
    pub offer: ServiceOffer,
    pub systems: Vec<String>,
    pub since: i64,
    pub agreement: Option<String>,
    /// The records term as the agreement states it (the offer's until it is read).
    pub records: Records,
    /// Notice given on it (by us).
    pub ending: bool,
    /// No longer in force, or the provider has said it has ended.
    pub ended: bool,
}

impl Engagement {
    pub fn provider(&self) -> &str {
        &self.offer.provider
    }
}

/// What a principal has engaged: from its own papers (the provider's delivery, the agreement, the end). Saved with the
/// actor that holds it.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Engagements {
    me: String,
    all: Vec<Engagement>,
    signed: BTreeSet<String>,
    placed: BTreeSet<String>,
}

impl Engagements {
    pub fn new(me: &str) -> Engagements {
        Engagements { me: me.to_string(), ..Default::default() }
    }

    /// An order it placed for a service: a delivery for it is its own (two posts of one organisation each read their own).
    pub fn ordered(&mut self, order: &str) {
        self.placed.insert(order.to_string());
    }

    pub fn absorb(&mut self, book: &Book) {
        for r in book.all(ServiceDelivery::KIND) {
            if !crate::common::addressed_to(r).iter().any(|a| *a == self.me) || self.all.iter().any(|e| e.delivery == r.id.as_str()) {
                continue;
            }
            let Some(d) = papers::read::<ServiceDelivery>(r) else { continue };
            if !self.placed.contains(&d.order) {
                continue;
            }
            let mut offer = d.offer;
            if offer.provider.is_empty() {
                offer.provider = r.speaks_for.map(|x| x.to_string()).unwrap_or_default();
            }
            self.all.push(Engagement { delivery: r.id.to_string(), order: d.order, records: offer.records, offer, systems: d.systems, since: r.at, agreement: None, ending: false, ended: false });
        }
        for e in &mut self.all {
            let a = book.of_type("agreement").find(|x| cites(x, &e.order) && agreements::template_of(x) == Some(SERVICE) && agreements::parties_of(x).iter().any(|p| *p == self.me));
            if let Some(a) = a {
                e.agreement = Some(a.id.to_string());
                // (Notice given on it, by either party, however it came to be given: it is ending.)
                if book.notices(&a.id).next().is_some() {
                    e.ending = true;
                }
                if let Some(r) = agreement_records(a) {
                    e.records = r;
                }
            }
            let ended_by_provider = book.all(ServiceEnded::KIND).any(|r| data(r).get("order").and_then(|x| x.as_str()) == Some(e.order.as_str()) && crate::common::addressed_to(r).iter().any(|x| *x == self.me));
            e.ended = e.agreement.as_deref().is_some_and(|a| book.signed_by(a, &self.me) && !book.in_force(a)) || ended_by_provider;
        }
    }

    pub fn all(&self) -> &[Engagement] {
        &self.all
    }

    /// Those in force (signed or not yet ended).
    pub fn live(&self) -> impl Iterator<Item = &Engagement> {
        self.all.iter().filter(|e| !e.ended)
    }

    pub fn by_agreement(&self, agreement: &str) -> Option<&Engagement> {
        self.all.iter().find(|e| e.agreement.as_deref() == Some(agreement))
    }

    /// The agreements offered to us: signed, with the fee set up to be paid each month.
    pub fn paperwork<T>(&mut self, book: &Book, from: &str, cx: &Cx) -> Vec<Step<T>> {
        let mut steps = vec![];
        for e in &self.all {
            let Some(id) = e.agreement.clone() else { continue };
            if e.ended || self.signed.contains(&id) || book.signed_by(&id, &self.me) || book.taken_back(&id) {
                continue;
            }
            let Some(a) = book.get(&id).filter(|a| agreements::template_of(a) == Some(SERVICE)) else { continue };
            self.signed.insert(id.clone());
            let fee = agreements::commitment_of(a, &self.me).0.and_then(|o| o.money).map_or(e.offer.fee_month, |m| m.amount);
            steps.push(because(
                format!("The service agreement for {} ({id}) is as ordered: signing it, and setting up its fee of {} a month.", e.offer.title, money_words(fee, &cx.ctx.world)),
                vec![
                    agreements::sign(&id),
                    pay(&e.offer.account, fee, Pay { from: Some(from.to_string()), every: Some(MONTH), first: Some(MONTH), for_: Some(fee_memo(&id)), basis: Some(id.clone()), ..Default::default() }, cx),
                ],
            ));
        }
        steps
    }

    /// Giving notice on a service: the notice, the exit paid, and the fee's standing order taken down.
    pub fn leave<T>(&mut self, book: &Book, agreement: &str, from: &str, why: &str, cx: &Cx) -> Vec<Step<T>> {
        let Some(e) = self.all.iter_mut().find(|e| e.agreement.as_deref() == Some(agreement)) else { return vec![] };
        if e.ending || e.ended {
            return vec![];
        }
        e.ending = true;
        let orders: Vec<String> = book
            .open("request")
            .filter(|r| r.speaks_for.as_deref() == Some(self.me.as_str()) && data(r).get("every").is_some_and(|x| !x.is_null() && x != &json!(0)) && bases_of(r).iter().any(|b| *b == agreement))
            .map(|r| r.id.to_string())
            .collect();
        let mut calls = vec![agreements::notice(agreement, &format!("We are ending the service of {}.", e.offer.title))];
        if e.offer.exit > 0 {
            calls.push(pay(&e.offer.account, e.offer.exit, Pay { from: Some(from.to_string()), for_: Some(format!("Exit of service {agreement}.")), ..Default::default() }, cx));
        }
        calls.extend(orders.iter().map(|o| withdraw(o, Some("The service is ending."))));
        vec![because(why, calls)]
    }
}

/// The records term a service agreement states (`attrs.records`).
pub fn agreement_records(a: &Record) -> Option<Records> {
    match &a.body {
        oikos_sight::RecordBody::Agreement { terms } => terms.attrs.as_ref().and_then(|x| x.get("records")).and_then(|v| v.as_str()).and_then(|w| serde_json::from_value(Value::String(w.to_string())).ok()),
        _ => None,
    }
}

#[cfg(test)]
mod tests;
