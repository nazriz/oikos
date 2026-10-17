//! Money as an actor sees it: its own accounts, what came in, bills and what settles them, published prices
//! (common.ts `ownAccount`, `ownBanked`, `noticesOf`, `billSettled`, `publishedPrice`, `broughtForward`; firms.ts
//! `receipts`). Amounts are `i64` in the smallest unit (cents); the kernel's balances are `i128` and are read through
//! `cents`, which saturates (no actor's arithmetic is near the bound: docs/port-guide.md, section 2).

use super::book::Book;
use super::{addressed_to, data, Fields};
use oikos_sight::{Picture, Record, RecordBody};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

/// An amount as an actor reckons with it: the kernel's `i128`, saturated to `i64` (money.ts `cents`).
pub fn cents(m: oikos_sight::Money) -> i64 {
    m.clamp(i128::from(i64::MIN), i128::from(i64::MAX)) as i64
}

/// One of an entity's accounts, its balance as a number for arithmetic.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OwnAccount {
    pub account: String,
    pub balance: i64,
    pub custodian: String,
    pub currency: String,
}

/// Its own account (held by the entity it acts for), the first shown.
pub fn own_account(pic: &Picture) -> Option<OwnAccount> {
    pic.accounts().find(|a| a.holder == pic.entity).map(|a| OwnAccount {
        account: a.account.clone(),
        balance: cents(a.balance),
        custodian: a.custodian.clone(),
        currency: a.currency.clone(),
    })
}

/// An entity's own account at a bank (not money it keeps itself).
pub fn own_banked(pic: &Picture, holder: &str) -> Option<OwnAccount> {
    pic.accounts().find(|a| a.holder == holder && a.custodian != holder).map(|a| OwnAccount {
        account: a.account.clone(),
        balance: cents(a.balance),
        custodian: a.custodian.clone(),
        currency: a.currency.clone(),
    })
}

/// What came into an account in this observation, by who paid it (firms.ts `receipts`): sums per payer, in id order.
pub fn receipts(pic: &Picture, account: &str) -> BTreeMap<String, i64> {
    let mut out = BTreeMap::new();
    for tx in pic.transactions() {
        if tx.to == account && tx.from != account {
            *out.entry(tx.from.clone()).or_insert(0) += cents(tx.amount);
        }
    }
    out
}

/// A rates bill is one thing on two papers (docs/behaviour/government.md, "One bill, two papers"): the notice to the
/// owner (a `rates_notice`) and the claim recorded against them, with the same sum and due day. The notices that go
/// with a rates claim.
pub fn notices_of<'a>(book: &'a Book, claim: &Record) -> Vec<&'a Arc<Record>> {
    let RecordBody::Claim { about, counterparty, .. } = &claim.body else { return vec![] };
    if about.s("kind") != Some("rates") {
        return vec![];
    }
    let (due, amount) = (about.get("due"), about.i("amount"));
    book.all("rates_notice")
        .filter(|n| {
            counterparty.as_ref().is_some_and(|c| addressed_to(n).contains(c)) && data(n).get("due") == due && data(n).i("amount") == amount
        })
        .collect()
}

/// Is a debt recorded against someone settled by what has been paid? A payment that names the claim, or for a rates
/// claim the notice that goes with it, settles the bill however many papers mention it.
pub fn bill_settled(book: &Book, claim: &Record, settled: &BTreeSet<String>) -> bool {
    settled.contains(&claim.id) || notices_of(book, claim).iter().any(|n| settled.contains(&n.id))
}

/// A builder's published price for a kind of building (`prices`) or for demolishing one (`demolition`): its latest
/// standing price list's.
pub fn published_price(book: &Book, builder: &str, kind_of_building: &str, what: &str) -> Option<i64> {
    let list = book
        .open("price_list")
        .filter(|r| (r.speaks_for.as_deref() == Some(builder) || r.author == builder) && data(r).get("prices").is_some())
        .max_by(|a, b| a.at.cmp(&b.at).then_with(|| super::filed_before(&b.id, &a.id)))?;
    data(list).get(what).and_then(|p| p.get(kind_of_building)).and_then(Value::as_i64)
}

/// Rent owed under a lease when the year began, as the landlord's statement of the rent account has it (a
/// `rent_statement` brought forward): how much, when the oldest of it fell due (a negative time), and the paper.
pub fn brought_forward(book: &Book, landlord: &str, lease: &str) -> Option<(i64, i64, String)> {
    let r = book
        .open("rent_statement")
        .filter(|x| x.speaks_for.as_deref() == Some(landlord) && data(x).s("lease") == Some(lease) && data(x).flag("brought_forward"))
        .max_by(|a, b| a.at.cmp(&b.at).then_with(|| super::filed_before(&b.id, &a.id)))?;
    let owed = data(r).i("owed").unwrap_or(0);
    (owed > 0).then(|| (owed, data(r).i("since").unwrap_or(0), r.id.clone()))
}
