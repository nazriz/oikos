//! Trade in goods: prices published, orders placed and paid, goods delivered (ported from participants/src/behaviour/
//! trade.ts). Documented in docs/behaviour/trade.md.
//!
//! A seller publishes a price list (a statement of kind `price_list`: `goods`, a unit price in cents for each kind it
//! sells, and `account`, where to pay). A buyer orders (kind `order`, to the seller, seen by the two of them) and pays
//! the total in the same act: cash with order, as at a till or an online shop, or on the seller's terms (pay within
//! some days of delivery, against an invoice). Nothing in the world enforces any of it; it is how these participants
//! do business. The seller matches payments to orders by the account they came from, oldest order first, delivers
//! what it can once an order is paid in full, refunds what it could not deliver, and answers with a delivery note.
//!
//! Rewritten for Rust, not transliterated: the order book is a pair of ordered maps (orders waiting, money received),
//! read as records arrive (a cursor into the book's kind list, not a rescan); sums are `i64` cents; and a step's
//! "what follows" is a token (`TradeThen`) the plan hands back to [`then`], since Rust has no closures over state.

use crate::common::book::Book;
use crate::common::{bases_of, cents, data, money_words, Fields, DAY};
use crate::steps::{arg, because, call, json, pay, say, text, Done, Pay, Say, Step, Visible};
use crate::{Cx, Picture};
use oikos_sight::calls::Line;
use oikos_sight::{OutcomeStatus, Record, RecordBody};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

/// An order, as the seller reads it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Order {
    pub id: String,
    pub seller: String,
    pub buyer: String,
    pub kind: String,
    pub quantity: i64,
    pub unit_price: i64,
    pub to: String,
    pub at: String,
    pub account: String,
    pub placed: i64,
    /// The days the order is for, as the buyer says (a fortnight's shopping): served over that time.
    pub for_days: Option<i64>,
    /// Bought on the seller's terms: the days after delivery it is to be paid within (the order carries no payment).
    pub terms: Option<i64>,
}

impl Order {
    pub fn total(&self) -> i64 {
        self.quantity * self.unit_price
    }
}

/// What a seller's current list says: prices, where to pay, the least it sells in one order, where it is, the days
/// it gives to pay.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Offerings {
    pub prices: BTreeMap<String, i64>,
    pub account: Option<String>,
    pub min_order: Option<i64>,
    pub at: Option<String>,
    pub terms_days: Option<i64>,
}

fn goods_of(r: &Record) -> Option<BTreeMap<String, i64>> {
    let g = data(r).get("goods")?.as_object()?;
    Some(g.iter().filter_map(|(k, v)| v.as_i64().map(|x| (k.clone(), x))).collect())
}

/// A seller's latest standing price list that lists goods (newest by time; of two at the same moment, the later filed).
pub fn latest_list<'a>(book: &'a Book, seller: &str) -> Option<&'a std::sync::Arc<Record>> {
    book.open("price_list")
        .rev()
        .filter(|r| r.speaks_for.as_deref() == Some(seller) && data(r).get("goods").is_some())
        .fold(None, |best: Option<&std::sync::Arc<Record>>, r| match best {
            Some(b) if r.at <= b.at => Some(b),
            _ => Some(r),
        })
}

/// A seller's current prices for goods (its latest standing price list), the account it is paid into, the least it
/// sells in one order (a wholesaler's minimum), and where it is (a shop's premises, for collection).
pub fn goods_prices(book: &Book, seller: &str) -> Offerings {
    let Some(list) = latest_list(book, seller) else { return Offerings::default() };
    let d = data(list);
    Offerings {
        prices: goods_of(list).unwrap_or_default(),
        account: d.s("account").map(str::to_string),
        min_order: d.i("min_order"),
        at: d.s("at").map(str::to_string),
        terms_days: d.i("terms_days").filter(|n| *n > 0),
    }
}

/// What the entity holds of a kind at a place (its holdings channel), as a number.
pub fn held(pic: &Picture, at: &str, kind: &str) -> i64 {
    pic.channels
        .values()
        .filter_map(|c| match c {
            crate::sight::Seen::Holdings { holdings } => Some(holdings),
            _ => None,
        })
        .flat_map(|h| h.iter())
        .filter(|h| h.at == at && h.kind == kind)
        .map(|h| cents(h.quantity))
        .sum()
}

/// Publishing (or republishing) a price list: the kinds of goods sold and their unit prices, and where to pay.
/// `on`: the cell it is put up on (a shop's prices in its window: seen by those who pass, not sent to the town).
/// With one kind of goods the statement is also an offer (docs/design/ai-citizens.md 2a): order, pay the unit price,
/// and the goods are delivered, per unit. (A list of several kinds is not one offer.)
pub fn price_list(prices: &BTreeMap<String, i64>, account: &str, words: &str, extra: Value, seller: Option<&str>, on: Option<&str>, public: bool) -> oikos_sight::calls::Call {
    let mut d = json!({ "goods": prices, "account": account });
    if let (Some(e), Some(o)) = (extra.as_object(), d.as_object_mut()) {
        for (k, v) in e {
            o.insert(k.clone(), v.clone());
        }
    }
    let mut extras: Vec<(&'static str, Value)> = vec![];
    if let (Some(seller), 1) = (seller, prices.len()) {
        let (k, p) = prices.iter().next().expect("one kind");
        if *p > 0 {
            extras.push((
                "offer",
                json!({ "by": seller, "take_up": "order", "terms": { "commitments": [
                    { "who": "taker", "does": { "outcome": { "money": { "to": account, "amount": p.to_string(), "for": k } } }, "per": "unit" },
                    { "who": seller, "does": { "outcome": { "goods": { "kind": k, "quantity": "1" } } }, "per": "unit" },
                ] } }),
            ));
        }
    }
    say(
        "price_list",
        words,
        Say { data: Some(d), visible: public.then_some(Visible::Public), on: on.map(str::to_string), extra: extras, ..Default::default() },
    )
}

/// Everything a buyer says in an order and how it pays.
#[derive(Debug, Clone)]
pub struct Ordering {
    pub me: String,
    pub seller: String,
    pub seller_account: String,
    pub kind: String,
    pub quantity: i64,
    pub unit_price: i64,
    pub to: Option<String>,
    pub at: String,
    pub from: String,
    pub why: String,
    pub retry_of: Option<String>,
    pub for_days: Option<i64>,
    /// On the seller's terms (docs/behaviour/trade.md, "Trade credit"): to be paid this many days after delivery, and
    /// nothing paid with the order.
    pub terms: Option<i64>,
}

/// An order for goods, paid with the order in the same act (or, on terms, nothing paid yet). The order's id is bound
/// as `order` (a step's outcome names it in `created.order`).
pub fn order<T>(o: &Ordering, cx: &Cx) -> Step<T> {
    let money = |n| money_words(n, &cx.ctx.world);
    let to = o.to.clone().unwrap_or_else(|| o.me.clone());
    let total = o.quantity * o.unit_price;
    let mut d = json!({ "kind": o.kind, "quantity": o.quantity, "unit_price": o.unit_price, "deliver_to": to, "at": o.at, "account": o.from });
    let dm = d.as_object_mut().expect("object");
    if let Some(r) = &o.retry_of {
        dm.insert("retry_of".into(), json!(r));
    }
    let (words, with_pay) = match o.terms {
        Some(days) => {
            dm.insert("pay_in_days".into(), json!(days));
            (format!("Order: {} {} at {} each ({}), delivered to {to} at {}. To be paid within {days} days of delivery, on your terms.", o.quantity, o.kind, money(o.unit_price), money(total), o.at), false)
        }
        None => {
            if let Some(f) = o.for_days {
                dm.insert("for_days".into(), json!(f));
            }
            (format!("Order: {} {} at {} each ({}), delivered to {to} at {}. Paid with this order.", o.quantity, o.kind, money(o.unit_price), money(total), o.at), true)
        }
    };
    let say_it = say("order", &words, Say { to: Some(vec![o.seller.clone()]), visible: Some(Visible::Only(vec![o.me.clone(), o.seller.clone()])), data: Some(d), ..Default::default() });
    let mut lines = vec![Line { bind: Some("order".into()), call: say_it }];
    if with_pay {
        lines.push(Line {
            bind: None,
            call: pay(&o.seller_account, total, Pay { from: Some(o.from.clone()), for_: Some(format!("Order: {} {}.", o.quantity, o.kind)), ..Default::default() }, cx),
        });
    }
    let mut s = Step::new(lines);
    s.why = Some(o.why.clone());
    s
}

/// Money promised to the bank in orders it has not yet paid out. An order is paid with a request to our bank, which
/// pays in its own batch (hours later); until then the balance we read has not fallen. A buyer that woke again
/// meanwhile and spent "what is left" spent the same money again. `owed` is what such requests still hold; `take`
/// clears them as payments out of our account to the seller are seen, and drops any older than `for_days` (a payment
/// we never saw: do not hold money for ever).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Committed {
    open: Vec<(String, i64, i64)>,
    for_days: i64,
}

impl Committed {
    pub fn new() -> Self {
        Committed { open: vec![], for_days: 3 }
    }
    pub fn add(&mut self, to: &str, amount: i64, at: i64) {
        self.open.push((to.to_string(), amount, at));
    }
    /// Take back an order that was not made.
    pub fn undo(&mut self, to: &str, amount: i64) {
        if let Some(i) = self.open.iter().position(|x| x.0 == to && x.1 == amount) {
            self.open.remove(i);
        }
    }
    pub fn take(&mut self, pic: &Picture, account: Option<&str>) {
        if let Some(account) = account {
            for tx in pic.transactions() {
                if tx.from != account {
                    continue;
                }
                if let Some(i) = self.open.iter().position(|x| x.0 == tx.to && x.1 == cents(tx.amount)) {
                    self.open.remove(i);
                }
            }
        }
        let keep = self.for_days * DAY;
        self.open.retain(|x| pic.t - x.2 < keep);
    }
    pub fn owed(&self) -> i64 {
        self.open.iter().map(|x| x.1).sum()
    }
}

/// A delivery note addressed to us, read: which order, how much came, what was refunded.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Delivered {
    pub order: String,
    pub kind: String,
    pub ordered: i64,
    pub delivered: i64,
    pub refund: i64,
    pub seller: String,
}

/// Delivery notes addressed to us, not yet read (only new ones are read: no rescanning).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Deliveries {
    cursor: usize,
}

impl Deliveries {
    pub fn take(&mut self, book: &Book, me: &str) -> Vec<Delivered> {
        let notes: Vec<_> = book.all("delivery_note").collect();
        let mut out = vec![];
        for n in notes.iter().skip(self.cursor) {
            if !crate::common::addressed_to(n).iter().any(|a| a == me) {
                continue;
            }
            let d = data(n);
            let delivered = d.i("delivered").unwrap_or(0);
            out.push(Delivered {
                order: d.s("order").unwrap_or_default().to_string(),
                kind: d.s("kind").unwrap_or_default().to_string(),
                ordered: d.i("ordered").unwrap_or(delivered),
                delivered,
                refund: d.i("refund").unwrap_or(0),
                seller: n.speaks_for.clone().unwrap_or_default(),
            });
        }
        self.cursor = notes.len();
        out
    }
}

/// What a seller that sells on terms (docs/behaviour/trade.md, "Trade credit") says of them: the days it gives to pay,
/// how long after the day an unpaid buyer is supplied no more on terms, and how long after it the debt is recorded.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SellingTerms {
    pub days: i64,
    pub stop_after_days: i64,
    pub claim_after_days: i64,
}

/// What a seller is owed for goods delivered on its terms and not yet paid for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Receivable {
    pub order: String,
    pub account: String,
    pub buyer: String,
    pub kind: String,
    pub quantity: i64,
    pub amount: i64,
    pub since: i64,
    pub days: i64,
}

/// `Invoice <order>:` at the start of a memo: the order it pays.
fn invoice_of(memo: &str) -> Option<&str> {
    let rest = memo.strip_prefix("Invoice ")?;
    let end = rest.find(':')?;
    let id = &rest[..end];
    (!id.is_empty() && !id.contains(char::is_whitespace)).then_some(id)
}

/// A payment that says it is a dividend or a tax is not money for an order, and is not sent back as a mistake: the
/// world's account is a market, a shareholder and a collector of tax at once, and a payment that names one of the
/// other two is that, whoever else the payer has dealt with (decisions log 2026-10-12, "The leftovers of the
/// firm-side work").
fn other_role(memo: &str) -> bool {
    let m = memo.to_ascii_lowercase();
    m.starts_with("dividend")
        || m.starts_with("income tax")
        || (m.starts_with("tax") && !m[3..].chars().next().is_some_and(|c| c.is_alphanumeric() || c == '_'))
        // (A founder's capital put into a business of their own is the founder's, not an order's payment: 2aacc8d8.)
        || (m.starts_with("capital") && !m[7..].chars().next().is_some_and(|c| c.is_alphanumeric() || c == '_'))
}

/// A seller's order book. `take` reads each observation (payments into our account); `due` says which orders are now
/// paid in full (oldest first) and which have waited too long unpaid.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderBook {
    me: String,
    unpaid_days: i64,
    sells: Option<SellingTerms>,
    /// Paying account -> money received not yet set against an order.
    credit: BTreeMap<String, i64>,
    /// Order -> paid against its invoice (the payment's memo names the order).
    invoiced: BTreeMap<String, i64>,
    receivables: Vec<Receivable>,
    /// A debt we recorded (its claim) -> the buyer's account, until it is paid.
    claimed: BTreeMap<String, String>,
    /// Buyer's account -> debts of ours it has not paid.
    claimed_accounts: BTreeMap<String, i64>,
    settled: BTreeSet<String>,
    /// Accounts that have ordered from us.
    customers: BTreeSet<String>,
    /// Orders to us not yet settled.
    waiting: BTreeMap<String, Order>,
    /// How far through the orders seen we have read.
    cursor: usize,
}

/// What an order book finds due at a moment.
#[derive(Debug, Default)]
pub struct Due {
    pub paid: Vec<Order>,
    pub unpaid: Vec<Order>,
    pub stopped: Vec<Order>,
}

impl OrderBook {
    pub fn new(me: &str, unpaid_days: Option<i64>, sells: Option<SellingTerms>) -> Self {
        OrderBook {
            me: me.to_string(),
            unpaid_days: unpaid_days.unwrap_or(7),
            sells,
            credit: BTreeMap::new(),
            invoiced: BTreeMap::new(),
            receivables: vec![],
            claimed: BTreeMap::new(),
            claimed_accounts: BTreeMap::new(),
            settled: BTreeSet::new(),
            customers: BTreeSet::new(),
            waiting: BTreeMap::new(),
            cursor: 0,
        }
    }

    pub fn take(&mut self, pic: &Picture, account: Option<&str>) {
        let Some(account) = account else { return };
        for tx in pic.transactions() {
            if tx.to != account || tx.from == account {
                continue;
            }
            let x = cents(tx.amount);
            // Payment of a debt we recorded: it settles that claim, and is no order's payment.
            if let Some(s) = tx.settles.as_deref().filter(|s| self.claimed.contains_key(*s)) {
                let from = self.claimed.remove(s).unwrap_or_default();
                let n = self.claimed_accounts.get(&from).copied().unwrap_or(1);
                self.claimed_accounts.insert(from, (n - 1).max(0));
                continue;
            }
            let memo = tx.memo.as_deref().unwrap_or("");
            // Payment of an invoice (goods delivered on our terms): the memo names the order.
            if let Some(inv) = invoice_of(memo).filter(|i| self.receivables.iter().any(|r| r.order == *i)) {
                *self.invoiced.entry(inv.to_string()).or_insert(0) += x;
                continue;
            }
            if other_role(memo) {
                continue;
            }
            *self.credit.entry(tx.from.clone()).or_insert(0) += x;
        }
    }

    /// Goods delivered on terms: what we are now owed, and from when.
    pub fn bill(&mut self, o: &Order, quantity: i64, t: i64) {
        let Some(days) = o.terms.filter(|_| quantity > 0) else { return };
        self.receivables.push(Receivable {
            order: o.id.clone(),
            account: o.account.clone(),
            buyer: o.buyer.clone(),
            kind: o.kind.clone(),
            quantity,
            amount: quantity * o.unit_price,
            since: t,
            days,
        });
    }

    /// What we are owed and has not been paid.
    pub fn owed_to(&mut self) -> &[Receivable] {
        let paid = &self.invoiced;
        self.receivables.retain(|r| paid.get(&r.order).copied().unwrap_or(0) < r.amount);
        &self.receivables
    }

    /// Whether a buyer's account is one we supply no more on terms: it has not paid what it owed by `stop_after_days`
    /// after the day, or has a debt of ours unpaid.
    pub fn stopped(&mut self, account: &str, t: i64) -> bool {
        let Some(sells) = self.sells else { return false };
        self.claimed_accounts.get(account).copied().unwrap_or(0) > 0
            || self.owed_to().iter().any(|r| r.account == account && t > r.since + (r.days + sells.stop_after_days) * DAY)
    }

    /// A buyer who has not paid `claim_after_days` after the day: the debt recorded against it (a claim, as a lender's
    /// on a default is), to be paid as any debt recorded against a firm is (docs/behaviour/insolvency.md).
    pub fn collect<T: From<TradeThen>>(&mut self, t: i64, seller_account: &str, cx: &Cx) -> Vec<Step<T>> {
        let Some(sells) = self.sells else { return vec![] };
        let mut steps = vec![];
        let late: Vec<Receivable> = self.owed_to().iter().filter(|r| t > r.since + (r.days + sells.claim_after_days) * DAY).cloned().collect();
        for r in late {
            self.receivables.retain(|x| *x != r);
            let owing = r.amount - self.invoiced.get(&r.order).copied().unwrap_or(0);
            *self.claimed_accounts.entry(r.account.clone()).or_insert(0) += 1;
            let why = format!(
                "{} has not paid for the {} {} we delivered on terms (order {}, {}), {} days past the day: recording the debt against them.",
                r.buyer,
                r.quantity,
                r.kind,
                r.order,
                money_words(owing, &cx.ctx.world),
                (t - r.since) / DAY - r.days
            );
            // (Bound as `claim`, so the world tells us the claim's id: a payment that settles it is then known for what it is.)
            let record = call(
                "claim",
                vec![
                    ("position", Some(arg("right"))),
                    ("holder", Some(arg(&self.me))),
                    ("about", Some(json(json!({ "kind": "debt", "amount": owing, "account": seller_account, "for": format!("{} {} delivered on terms, order {}: unpaid.", r.quantity, r.kind, r.order) })))),
                    ("against", Some(arg(&r.buyer))),
                    ("basis", Some(arg(&r.order))),
                ],
            );
            let mut s = Step::new(vec![Line { bind: Some("claim".into()), call: record }]);
            s.why = Some(why);
            s.then = Some(TradeThen::Claimed { account: r.account.clone() }.into());
            steps.push(s);
        }
        steps
    }

    /// Open orders to us, oldest first.
    fn open(&mut self, book: &Book) -> Vec<Order> {
        let orders: Vec<_> = book.all("order").collect();
        for r in orders.iter().skip(self.cursor) {
            if !crate::common::addressed_to(r).iter().any(|a| *a == self.me) || self.settled.contains(&r.id) {
                continue;
            }
            let d = data(r);
            let buyer = r.speaks_for.clone().unwrap_or_default();
            self.waiting.insert(
                r.id.clone(),
                Order {
                    id: r.id.clone(),
                    seller: self.me.clone(),
                    buyer: buyer.clone(),
                    kind: d.s("kind").unwrap_or_default().to_string(),
                    quantity: d.i("quantity").unwrap_or(0).max(0),
                    unit_price: d.i("unit_price").unwrap_or(0).max(0),
                    to: d.s("deliver_to").map(str::to_string).unwrap_or(buyer),
                    at: d.s("at").unwrap_or_default().to_string(),
                    account: d.s("account").unwrap_or_default().to_string(),
                    placed: r.at,
                    for_days: d.i("for_days").filter(|n| *n > 0),
                    terms: d.i("pay_in_days").filter(|n| *n > 0),
                },
            );
        }
        self.cursor = orders.len();
        let gone: Vec<String> = self.waiting.keys().filter(|id| self.settled.contains(*id) || book.withdrawn(id)).cloned().collect();
        for id in gone {
            self.waiting.remove(&id);
        }
        let mut v: Vec<Order> = self.waiting.values().cloned().collect();
        v.sort_by(|a, b| a.placed.cmp(&b.placed).then_with(|| crate::common::filed_before(&a.id, &b.id)));
        v
    }

    /// Orders paid in full (their payment set against them), and orders that have waited unpaid too long (dropped).
    /// `accept` says whether we can take an order on now (a shop's hands for the day): the first paid order it turns
    /// down waits, and so do the paid orders after it (first come, first served).
    pub fn due(&mut self, book: &Book, t: i64, accept: impl Fn(&Order) -> bool) -> Due {
        let mut out = Due::default();
        let mut full = false;
        for o in self.open(book) {
            let total = o.total();
            let have = self.credit.get(&o.account).copied().unwrap_or(0);
            self.customers.insert(o.account.clone());
            // On our terms (if we sell on any): supplied against its promise, unless it has not paid what it owed us.
            if o.terms.is_some() && self.sells.is_some() && total > 0 {
                self.settled.insert(o.id.clone());
                if self.stopped(&o.account, t) {
                    out.stopped.push(o);
                } else {
                    out.paid.push(o);
                }
                continue;
            }
            if total > 0 && have >= total {
                if full || !accept(&o) {
                    full = true;
                    continue;
                }
                self.credit.insert(o.account.clone(), have - total);
                self.settled.insert(o.id.clone());
                out.paid.push(o);
            } else if t - o.placed >= self.unpaid_days * DAY {
                self.settled.insert(o.id.clone());
                out.unpaid.push(o);
            }
        }
        out
    }

    /// Money from a customer (an account that has ordered from us) that no order of theirs is waiting for: paid twice,
    /// or too late. Money from anyone else is theirs to ask about.
    pub fn unclaimed(&mut self, book: &Book) -> Vec<(String, i64)> {
        let open = self.open(book);
        for o in &open {
            self.customers.insert(o.account.clone());
        }
        let waiting: BTreeSet<&String> = open.iter().map(|o| &o.account).collect();
        self.credit.iter().filter(|(acc, x)| **x > 0 && self.customers.contains(*acc) && !waiting.contains(acc)).map(|(a, x)| (a.clone(), *x)).collect()
    }

    /// An order taken on whose act did not go through: it waits again, its payment set aside for it.
    pub fn reopen(&mut self, o: &Order) {
        self.settled.remove(&o.id);
        self.waiting.insert(o.id.clone(), o.clone());
        *self.credit.entry(o.account.clone()).or_insert(0) += o.total();
    }

    /// Returning unclaimed money (a refund): forget it once paid back.
    pub fn refunded(&mut self, account: &str) {
        self.credit.remove(account);
    }

    /// The claim a step recorded: the debt is settled when this claim is paid.
    pub fn claimed(&mut self, claim: &str, account: &str) {
        self.claimed.insert(claim.to_string(), account.to_string());
    }
}

/// Refusals that mean an order cannot be delivered at all: where it is to go, or whom to, is gone.
pub const UNDELIVERABLE: [&str; 3] = ["unknown_place", "unknown_entity", "unknown_structure"];

/// What follows from a trade step's outcome.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum TradeThen {
    /// A delivery refused (the place is gone): the whole order is refunded instead.
    DeliveryRefused { order: Order, from_at: String, pay_from: String },
    /// A debt recorded against a buyer: when it is paid, the debt is settled (the outcome names the claim).
    Claimed { account: String },
}

/// What a trade token asks of its plan after an outcome. The plan passes the book it keeps for orders to `book`.
pub fn then<T: From<TradeThen>>(tok: &TradeThen, done: Done, book: &mut OrderBook, cx: &Cx) -> Vec<Step<T>> {
    match tok {
        TradeThen::DeliveryRefused { order, from_at, pay_from } => match done {
            Done::Outcome(o) if o.status == OutcomeStatus::Refused => {
                let why = format!(
                    "We couldn't deliver order {} ({}): refunding it.",
                    order.id,
                    o.refusal.as_ref().map(|r| r.detail.clone().unwrap_or_else(|| format!("{:?}", r.code))).unwrap_or_default()
                );
                vec![fill_as(order, 0, from_at, pay_from, &why, cx)]
            }
            _ => vec![],
        },
        TradeThen::Claimed { account } => {
            if let Done::Outcome(o) = done {
                if let Some(id) = o.created.as_ref().and_then(|c| c.get("claim")) {
                    book.claimed(id, account);
                }
            }
            vec![]
        }
    }
}

/// Filling a paid order: deliver `quantity` (all, part or none of it) from where we keep it, refund the rest, and say
/// so in a delivery note. `pay_from` is our account; `from_at` where the goods are. If the delivery is refused (the
/// place it was to go is gone, say), the whole order is refunded instead.
pub fn fill<T: From<TradeThen>>(o: &Order, quantity: i64, from_at: &str, pay_from: &str, why: &str, cx: &Cx) -> Step<T> {
    let mut s = fill_as(o, quantity, from_at, pay_from, why, cx);
    if quantity > 0 {
        s.then = Some(TradeThen::DeliveryRefused { order: o.clone(), from_at: from_at.to_string(), pay_from: pay_from.to_string() }.into());
    }
    s
}

fn fill_as<T>(o: &Order, quantity: i64, from_at: &str, pay_from: &str, why: &str, cx: &Cx) -> Step<T> {
    let money = |n| money_words(n, &cx.ctx.world);
    // (On terms nothing was paid, so nothing is refunded: the invoice is for what was delivered.)
    let refund = if o.terms.is_some() { 0 } else { (o.quantity - quantity) * o.unit_price };
    let mut calls = vec![];
    if quantity > 0 {
        calls.push(call(
            "goods",
            vec![("kind", Some(arg(&o.kind))), ("quantity", Some(text(quantity.to_string()))), ("to", Some(arg(&o.to))), ("at", Some(arg(&o.at))), ("from_at", Some(arg(from_at)))],
        ));
    }
    if refund > 0 {
        calls.push(pay(&o.account, refund, Pay { from: Some(pay_from.to_string()), for_: Some(format!("Refund: {} {} we couldn't deliver.", o.quantity - quantity, o.kind)), ..Default::default() }, cx));
    }
    let mut words = if quantity == o.quantity {
        format!("Delivered: {quantity} {} to {} at {}.", o.kind, o.to, o.at)
    } else {
        format!("Delivered {quantity} of the {} {} ordered{}.", o.quantity, o.kind, if refund > 0 { format!("; {} refunded", money(refund)) } else { String::new() })
    };
    let mut d = json!({ "order": o.id, "kind": o.kind, "ordered": o.quantity, "delivered": quantity, "refund": refund });
    if let (Some(days), true) = (o.terms, quantity > 0) {
        words.push_str(&format!(" Invoice: {}, to be paid within {days} days, into {pay_from}, naming the order ({}).", money(quantity * o.unit_price), o.id));
        let dm = d.as_object_mut().expect("object");
        dm.insert("owed".into(), json!(quantity * o.unit_price));
        dm.insert("pay_in_days".into(), json!(days));
        dm.insert("pay_to".into(), json!(pay_from));
    }
    calls.push(say(
        "delivery_note",
        &words,
        Say { to: Some(vec![o.buyer.clone()]), visible: Some(Visible::Only(vec![o.buyer.clone(), o.seller.clone()])), basis: Some(o.id.clone()), data: Some(d), ..Default::default() },
    ));
    because(why, calls)
}

/// An order declined unpaid: a note saying so.
pub fn decline<T>(o: &Order, me: &str, why: &str) -> Step<T> {
    because(
        why,
        vec![say(
            "delivery_note",
            &format!("Order {} declined: not paid.", o.id),
            Say {
                to: Some(vec![o.buyer.clone()]),
                visible: Some(Visible::Only(vec![o.buyer.clone(), me.to_string()])),
                basis: Some(o.id.clone()),
                data: Some(json!({ "order": o.id, "kind": o.kind, "ordered": o.quantity, "delivered": 0, "refund": 0, "declined": "unpaid" })),
                ..Default::default()
            },
        )],
    )
}

/// A seller's note that it will not supply an order on terms: the buyer has not paid what it owed.
pub fn decline_on_terms<T>(o: &Order, me: &str, why: &str) -> Step<T> {
    because(
        why,
        vec![say(
            "delivery_note",
            &format!("Order {} declined: {} has not paid what it owed on our terms.", o.id, o.buyer),
            Say {
                to: Some(vec![o.buyer.clone()]),
                visible: Some(Visible::Only(vec![o.buyer.clone(), me.to_string()])),
                basis: Some(o.id.clone()),
                data: Some(json!({ "order": o.id, "kind": o.kind, "ordered": o.quantity, "delivered": 0, "refund": 0, "declined": "overdue" })),
                ..Default::default()
            },
        )],
    )
}

/// Sending back money paid to us with no order waiting for it.
pub fn send_back<T>(account: &str, amount: i64, from: &str, cx: &Cx) -> Step<T> {
    because(
        "Money paid to us with no order waiting for it: sending it back.",
        vec![pay(account, amount, Pay { from: Some(from.to_string()), for_: Some("Refund: no order of yours is waiting.".into()), ..Default::default() }, cx)],
    )
}

/// One open invoice we owe (a delivery note of a supplier's, on terms).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Owed {
    order: String,
    seller: String,
    account: String,
    kind: String,
    quantity: i64,
    amount: i64,
    due: i64,
}

/// A buyer's side of trade on terms: what it owes suppliers for goods delivered and invoiced (the delivery note says
/// what, how long to pay and where), paid on the day, wages first. A buyer that is behind with a supplier buys from
/// it on terms no more (the supplier will not supply it), and one the supplier has recorded a debt against pays that
/// debt, not the invoice.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Payables {
    me: String,
    cursor: usize,
    open: Vec<Owed>,
    /// Seller -> when it last told us it would supply us on terms no more.
    refused: BTreeMap<String, i64>,
    /// Payments we have asked our bank for, which has not yet paid them out (its batch is hours later).
    sent: Vec<(i64, i64)>,
    sent_now: i64,
}

impl Payables {
    pub fn new(me: &str) -> Self {
        Payables { me: me.to_string(), cursor: 0, open: vec![], refused: BTreeMap::new(), sent: vec![], sent_now: 0 }
    }

    /// What invoices we asked our bank to pay in the last few days come to: the balance we read has not yet fallen by it.
    pub fn pending(&mut self, t: i64) -> i64 {
        self.sent.retain(|x| t - x.0 < 3 * DAY);
        self.sent.iter().map(|x| x.1).sum()
    }

    /// Invoices on the delivery notes addressed to us (only new ones are read); debts recorded against us for an order
    /// of ours are paid as debts.
    pub fn take(&mut self, book: &Book) {
        let notes: Vec<_> = book.all("delivery_note").collect();
        for n in notes.iter().skip(self.cursor) {
            if !crate::common::addressed_to(n).iter().any(|a| *a == self.me) {
                continue;
            }
            let d = data(n);
            if d.s("declined") == Some("overdue") {
                if let Some(s) = &n.speaks_for {
                    self.refused.insert(s.clone(), n.at);
                }
            }
            let (owed, days) = (d.i("owed").unwrap_or(0), d.i("pay_in_days").unwrap_or(0));
            let (true, true, Some(pay_to)) = (owed > 0, days > 0, d.s("pay_to")) else { continue };
            self.open.push(Owed {
                order: d.s("order").unwrap_or_default().to_string(),
                seller: n.speaks_for.clone().unwrap_or_default(),
                account: pay_to.to_string(),
                kind: d.s("kind").unwrap_or_default().to_string(),
                quantity: d.i("delivered").unwrap_or(0),
                amount: owed,
                due: n.at + days * DAY,
            });
        }
        self.cursor = notes.len();
        if !self.open.is_empty() {
            let claimed: BTreeSet<String> = book
                .of_type("claim")
                .filter(|c| matches!(&c.body, RecordBody::Claim { counterparty: Some(cp), about, .. } if *cp == self.me && about.get("kind").and_then(Value::as_str) == Some("debt")))
                .flat_map(|c| bases_of(c).to_vec())
                .collect();
            self.open.retain(|x| !claimed.contains(&x.order));
        }
    }

    /// What we owe suppliers, in all.
    pub fn owing(&self) -> i64 {
        self.open.iter().map(|o| o.amount).sum()
    }

    /// Whether we are behind with a supplier (an invoice past its day), or it has lately told us it supplies us on
    /// terms no more (`retry_days` after which we try again).
    pub fn behind(&self, seller: &str, t: i64) -> bool {
        self.open.iter().any(|o| o.seller == seller && t > o.due) || self.refused.get(seller).is_some_and(|at| t - at < 30 * DAY)
    }

    /// Closing or winding up: every invoice we owe, due or not, oldest first, while the account covers it. What was
    /// paid, and the steps.
    pub fn settle<T>(&mut self, t: i64, from: &str, balance: i64, committed: Option<&mut Committed>, cx: &Cx) -> (Vec<Step<T>>, i64) {
        let steps = self.pay(t, from, balance, 0, committed, true, cx);
        (steps, self.sent_now)
    }

    /// Invoices that have fallen due, oldest first, paid while we can and keep `keep` in hand (the next pay day's
    /// wages come first).
    pub fn pay<T>(&mut self, t: i64, from: &str, balance: i64, keep: i64, mut committed: Option<&mut Committed>, all: bool, cx: &Cx) -> Vec<Step<T>> {
        let mut lines = vec![];
        self.sent_now = 0;
        let mut left = balance - keep - self.pending(t);
        let mut order: Vec<Owed> = self.open.clone();
        order.sort_by(|a, b| a.due.cmp(&b.due).then_with(|| a.order.cmp(&b.order)));
        for o in order {
            if (!all && o.due > t) || o.amount > left {
                continue;
            }
            left -= o.amount;
            self.sent_now += o.amount;
            self.open.retain(|x| *x != o);
            self.sent.push((t, o.amount));
            if let Some(c) = committed.as_deref_mut() {
                c.add(&o.account, o.amount, t);
            }
            let late = if t - o.due >= DAY { format!(", {} days late", (t - o.due) / DAY) } else { String::new() };
            lines.push(because(
                format!("Our invoice for {} {} from {} (order {}) falls due: paying {}{late}.", o.quantity, o.kind, o.seller, o.order, money_words(o.amount, &cx.ctx.world)),
                vec![pay(&o.account, o.amount, Pay { from: Some(from.to_string()), for_: Some(format!("Invoice {}: {} {}.", o.order, o.quantity, o.kind)), ..Default::default() }, cx)],
            ));
        }
        lines
    }
}

#[cfg(test)]
mod tests;
