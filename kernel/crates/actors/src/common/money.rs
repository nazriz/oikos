//! Money as an actor sees it: its own accounts, what came in, bills and what settles them, published prices
//! (common.ts `ownAccount`, `ownBanked`, `noticesOf`, `billSettled`, `publishedPrice`, `broughtForward`; firms.ts
//! `receipts`). Amounts are `i64` in the smallest unit (cents); the kernel's balances are `i128` and are read through
//! `cents`, which saturates (no actor's arithmetic is near the bound: docs/port-guide.md, section 2).

use super::book::Book;
use super::{addressed_to, data, Fields};
use oikos_sight::{Picture, Record, RecordBody};
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
        account: a.account.to_string(),
        balance: cents(a.balance),
        custodian: a.custodian.to_string(),
        currency: a.currency.to_string(),
    })
}

/// An entity's own account at a bank (not money it keeps itself).
pub fn own_banked(pic: &Picture, holder: &str) -> Option<OwnAccount> {
    pic.accounts().find(|a| a.holder == holder && a.custodian != holder).map(|a| OwnAccount {
        account: a.account.to_string(),
        balance: cents(a.balance),
        custodian: a.custodian.to_string(),
        currency: a.currency.to_string(),
    })
}

/// What came into an account in this observation, by who paid it (firms.ts `receipts`): sums per payer, in id order.
pub fn receipts(pic: &Picture, account: &str) -> BTreeMap<String, i64> {
    let mut out = BTreeMap::new();
    for tx in pic.transactions() {
        if tx.to == account && tx.from != account {
            *out.entry(tx.from.to_string()).or_insert(0) += cents(tx.amount);
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
            counterparty.as_ref().is_some_and(|c| addressed_to(n).iter().any(|x| x == &c.to_string())) && data(n).get("due") == due && data(n).i("amount") == amount
        })
        .collect()
}

/// Is a debt recorded against someone settled by what has been paid? A payment that names the claim, or for a rates
/// claim the notice that goes with it, settles the bill however many papers mention it.
pub fn bill_settled(book: &Book, claim: &Record, settled: &BTreeSet<String>) -> bool {
    settled.contains(claim.id.as_str()) || notices_of(book, claim).iter().any(|n| settled.contains(n.id.as_str()))
}

/// The rates notices on a file, by whom each is addressed to and what it asks (when due, how much), kept up as the file
/// grows: `bill_settled` for a rates office's every claim at every plan, without going through every notice for each
/// (both grow with each round of rates: by the second year of a 10,000-person town the search was the rates office's
/// whole wake). Answers as `bill_settled` does; a notice whose due date is not a whole number sends every question
/// back to it.
#[derive(Debug, Default, Clone)]
pub struct RatesNotices {
    seen: usize,
    odd: bool,
    by: std::collections::HashMap<(String, Option<i64>, Option<i64>), Vec<String>>,
}

impl RatesNotices {
    /// Takes in what has come to the file since last time.
    pub fn update(&mut self, book: &Book) {
        let all = book.all("rates_notice");
        let n = all.len();
        for r in all.skip(self.seen) {
            let due = data(r).get("due");
            let due_i = due.and_then(|d| d.as_i64());
            if due.is_some() && due_i.is_none() {
                self.odd = true;
            }
            let amount = data(r).i("amount");
            for a in addressed_to(r) {
                self.by.entry((a.to_string(), due_i, amount)).or_default().push(r.id.to_string());
            }
        }
        self.seen = n;
    }
    /// `bill_settled`, from the index.
    pub fn settled(&self, book: &Book, claim: &Record, settled: &BTreeSet<String>) -> bool {
        if settled.contains(claim.id.as_str()) {
            return true;
        }
        let RecordBody::Claim { about, counterparty, .. } = &claim.body else { return false };
        if about.s("kind") != Some("rates") {
            return false;
        }
        let due = about.get("due");
        if self.odd || (due.is_some() && due.and_then(|d| d.as_i64()).is_none()) {
            return bill_settled(book, claim, settled);
        }
        let Some(c) = counterparty else { return false };
        self.by.get(&(c.to_string(), due.and_then(|d| d.as_i64()), about.i("amount"))).is_some_and(|ns| ns.iter().any(|n| settled.contains(n.as_str())))
    }
}

/// A builder's published price for a kind of building (`prices`) or for demolishing one (`demolition`): its latest
/// standing price list's.
pub fn published_price(book: &Book, builder: &str, kind_of_building: &str, what: &str) -> Option<i64> {
    let list = book
        .open("price_list")
        .filter(|r| (r.speaks_for.as_deref() == Some(builder) || r.author == builder) && data(r).get("prices").is_some())
        .max_by(|a, b| a.at.cmp(&b.at).then_with(|| super::filed_before(&b.id, &a.id)))?;
    data(list).get(what).and_then(|p| p.get(kind_of_building)).and_then(|x| x.as_i64())
}

/// Rent owed under a lease when the year began, as the landlord's statement of the rent account has it (a
/// `rent_statement` brought forward): how much, when the oldest of it fell due (a negative time), and the paper.
pub fn brought_forward(book: &Book, landlord: &str, lease: &str) -> Option<(i64, i64, String)> {
    let r = book
        .open("rent_statement")
        .filter(|x| x.speaks_for.as_deref() == Some(landlord) && data(x).s("lease") == Some(lease) && data(x).flag("brought_forward"))
        .max_by(|a, b| a.at.cmp(&b.at).then_with(|| super::filed_before(&b.id, &a.id)))?;
    let owed = data(r).i("owed").unwrap_or(0);
    (owed > 0).then(|| (owed, data(r).i("since").unwrap_or(0), r.id.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn rec(v: serde_json::Value) -> Arc<Record> {
        Arc::new(serde_json::from_value(v).expect("a record"))
    }

    #[test]
    fn the_rates_notices_index_answers_as_the_search_through_the_file_does() {
        let notice = |id: &str, to: &str, due: serde_json::Value, amount: i64| {
            rec(json!({ "id": id, "record": "statement", "author": "rates-system", "speaks_for": "city", "at": 0, "visible_to": "public", "kind": "rates_notice", "text": "Rates.", "addressed_to": [to], "data": { "due": due, "amount": amount, "account": "acc-city" } }))
        };
        let claim = |id: &str, of: &str, due: serde_json::Value, amount: i64| {
            rec(json!({ "id": id, "record": "claim", "author": "rates-system", "speaks_for": "city", "at": 0, "visible_to": "public", "position": "right", "holder": "city", "counterparty": of, "about": { "kind": "rates", "due": due, "amount": amount } }))
        };
        let mut book = Book::new();
        book.take_all(&[notice("n1", "a", json!(100), 50), notice("n2", "b", json!(100), 50), notice("n3", "a", json!(200), 50)]);
        let mut idx = RatesNotices::default();
        idx.update(&book);
        let claims = [claim("c1", "a", json!(100), 50), claim("c2", "a", json!(200), 50), claim("c3", "b", json!(100), 60), claim("c4", "c", json!(100), 50)];
        for paid in [vec![], vec!["n1"], vec!["n3"], vec!["c3"], vec!["n2", "n3"]] {
            let settled: BTreeSet<String> = paid.iter().map(|x| x.to_string()).collect();
            for c in &claims {
                assert_eq!(idx.settled(&book, c, &settled), bill_settled(&book, c, &settled), "{} with {paid:?}", c.id);
            }
        }
        // (What comes to the file later is taken in.)
        book.take_all(&[notice("n4", "c", json!(100), 50)]);
        idx.update(&book);
        let settled: BTreeSet<String> = ["n4".to_string()].into();
        assert!(idx.settled(&book, &claims[3], &settled) && bill_settled(&book, &claims[3], &settled));
    }
}
