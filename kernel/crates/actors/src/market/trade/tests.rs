//! trade.ts's behaviour, as participants/test held it (docs/behaviour/trade.md), rewritten for the Rust order book.

use super::*;
use crate::market::testkit::*;
use crate::steps::Step;
use crate::{Ctx, Draws};
use oikos_sight::calls::program_text;
use oikos_sight::calls::Program;

fn order_rec(id: &str, at: i64, buyer: &str, seller: &str, qty: i64, unit: i64, extra: Value) -> Value {
    let mut d = json!({ "kind": "bread", "quantity": qty, "unit_price": unit, "deliver_to": buyer, "at": "home-1", "account": format!("acc-{buyer}") });
    for (k, v) in extra.as_object().cloned().unwrap_or_default() {
        d[k] = v;
    }
    statement(id, at, buyer, "order", &[seller], d)
}

fn text<T>(s: &Step<T>) -> String {
    program_text(&Program::Lines(s.lines.clone()))
}

fn world_ctx() -> (Ctx, Draws) {
    (ctx("shop", json!({})), Draws::new("shop-system", "shop-manager"))
}

#[test]
fn a_sellers_latest_list_is_the_one_that_counts_and_the_books_say_where_to_pay() {
    let book = book_of(vec![
        statement("rec.1", 10, "mill", "price_list", &[], json!({ "goods": { "flour": 400 }, "account": "acc-old", "min_order": 50 })),
        statement("rec.2", 20, "mill", "price_list", &[], json!({ "goods": { "flour": 430 }, "account": "acc-mill", "min_order": 50, "terms_days": 14, "at": "works-1" })),
        statement("rec.3", 25, "other", "price_list", &[], json!({ "goods": { "flour": 100 }, "account": "acc-other" })),
    ]);
    let l = goods_prices(&book, "mill");
    assert_eq!(l.prices["flour"], 430);
    assert_eq!((l.account.as_deref(), l.min_order, l.terms_days, l.at.as_deref()), (Some("acc-mill"), Some(50), Some(14), Some("works-1")));
    assert!(goods_prices(&book, "nobody").prices.is_empty());
}

#[test]
fn an_order_is_paid_in_full_before_it_is_due_and_oldest_first_and_an_unpaid_one_lapses_after_a_week() {
    let book = book_of(vec![
        order_rec("rec.5", 100, "ann", "shop", 2, 500, json!({})),
        order_rec("rec.6", 200, "bob", "shop", 1, 500, json!({})),
        order_rec("rec.7", 300, "cat", "shop", 3, 500, json!({})),
    ]);
    let mut b = OrderBook::new("shop", None, None);
    // Ann paid in full, Bob half, Cat nothing.
    let pic = picture(1000, "shop", channels(vec![money("shop", 0, json!([tx("acc-ann", "acc-shop", 1000, 900, "Order: 2 bread."), tx("acc-bob", "acc-shop", 250, 950, "Order: 1 bread.")]))]));
    b.take(&pic, Some("acc-shop"));
    let due = b.due(&book, 1000, |_| true);
    assert_eq!(due.paid.iter().map(|o| o.id.as_str()).collect::<Vec<_>>(), ["rec.5"]);
    assert!(due.unpaid.is_empty(), "nobody has waited a week yet");
    // A week on: Bob and Cat are declined (and not twice).
    let due = b.due(&book, 100 + 8 * DAY, |_| true);
    assert_eq!(due.unpaid.iter().map(|o| o.id.as_str()).collect::<Vec<_>>(), ["rec.6", "rec.7"]);
    assert!(b.due(&book, 100 + 9 * DAY, |_| true).unpaid.is_empty());
    // Bob's half payment is still his, held with no order waiting: given back.
    assert_eq!(b.unclaimed(&book), vec![("acc-bob".to_string(), 250)]);
    b.refunded("acc-bob");
    assert!(b.unclaimed(&book).is_empty());
}

#[test]
fn a_shop_that_cannot_take_an_order_on_makes_the_orders_after_it_wait_their_turn() {
    let book = book_of(vec![order_rec("rec.5", 100, "ann", "shop", 2, 500, json!({})), order_rec("rec.6", 200, "bob", "shop", 1, 500, json!({}))]);
    let mut b = OrderBook::new("shop", None, None);
    let pic = picture(1000, "shop", channels(vec![money("shop", 0, json!([tx("acc-ann", "acc-shop", 1000, 900, "Order"), tx("acc-bob", "acc-shop", 500, 950, "Order")]))]));
    b.take(&pic, Some("acc-shop"));
    let due = b.due(&book, 1000, |o| o.buyer != "ann");
    assert!(due.paid.is_empty(), "ann's is turned down, so bob's waits behind it: first come, first served");
    let due = b.due(&book, 1100, |_| true);
    assert_eq!(due.paid.len(), 2);
}

#[test]
fn a_dividend_or_a_tax_paid_in_is_not_money_for_an_order() {
    let book = book_of(vec![order_rec("rec.5", 100, "outside", "mill", 1, 500, json!({}))]);
    let mut b = OrderBook::new("mill", None, None);
    let pic = picture(1000, "mill", channels(vec![money("mill", 0, json!([tx("acc-outside", "acc-mill", 700, 900, "Dividend."), tx("acc-outside", "acc-mill", 300, 901, "Income tax withheld."), tx("acc-outside", "acc-mill", 90, 902, "Taxable income")]))]));
    b.take(&pic, Some("acc-mill"));
    assert!(b.due(&book, 1000, |_| true).paid.is_empty());
    assert!(b.unclaimed(&book).iter().all(|(_, x)| *x == 90 + 0) || b.unclaimed(&book).is_empty(), "only a payment that names no role is judged");
}

#[test]
fn an_order_on_terms_is_supplied_then_billed_and_a_buyer_that_does_not_pay_is_refused_and_then_has_its_debt_recorded() {
    let terms = SellingTerms { days: 14, stop_after_days: 7, claim_after_days: 30 };
    let on_terms = |id: &str, at: i64| order_rec(id, at, "shop", "mill", 100, 400, json!({ "pay_in_days": 14, "account": "acc-shop" }));
    let mut b = OrderBook::new("mill", None, Some(terms));
    let (ctx, mut draws) = world_ctx();
    let cx = cx_for(&ctx, &mut draws, 0);
    let book = book_of(vec![on_terms("rec.1", 0)]);
    let due = b.due(&book, 10, |_| true);
    assert_eq!(due.paid.len(), 1, "supplied against its promise: nothing paid with the order");
    b.bill(&due.paid[0], 100, 100);
    assert_eq!(b.owed_to().len(), 1);
    assert_eq!(b.owed_to()[0].amount, 40_000);
    // Not yet past its day plus the stop: still supplied.
    let book = book_of(vec![on_terms("rec.1", 0), on_terms("rec.2", 200)]);
    let t = 100 + (14 + 7) * DAY;
    assert!(!b.stopped("acc-shop", t));
    assert!(b.stopped("acc-shop", t + 1), "a week after the day, no more on terms");
    let due = b.due(&book, t + 1, |_| true);
    assert_eq!(due.stopped.len(), 1);
    // Thirty days after the day: the debt is recorded against the buyer.
    assert!(b.collect::<TradeThen>(100 + (14 + 30) * DAY, "acc-mill", &cx).is_empty());
    let steps = b.collect::<TradeThen>(100 + (14 + 30) * DAY + 1, "acc-mill", &cx);
    assert_eq!(steps.len(), 1);
    let words = text(&steps[0]);
    // (Bound as `claim`, so the world's answer carries the claim's id and a payment that settles it is known for what it is.)
    assert!(words.starts_with("claim = claim(") && words.contains("kind") && words.contains("against=shop") && words.contains("basis=rec.1"), "{words}");
    // A buyer that paid its invoice owes nothing.
    let mut b = OrderBook::new("mill", None, Some(terms));
    b.bill(&Order { id: "rec.9".into(), seller: "mill".into(), buyer: "shop".into(), kind: "flour".into(), quantity: 5, unit_price: 100, to: "shop".into(), at: "x".into(), account: "acc-shop".into(), placed: 0, for_days: None, terms: Some(14) }, 5, 0);
    let pic = picture(5, "mill", channels(vec![money("mill", 0, json!([tx("acc-shop", "acc-mill", 500, 4, "Invoice rec.9: 5 flour.")]))]));
    b.take(&pic, Some("acc-mill"));
    assert!(b.owed_to().is_empty());
}

#[test]
fn filling_an_order_delivers_refunds_the_rest_and_says_so_and_on_terms_sends_an_invoice() {
    let (ctx, mut draws) = world_ctx();
    let cx = cx_for(&ctx, &mut draws, 0);
    let o = Order { id: "rec.9".into(), seller: "shop".into(), buyer: "ann".into(), kind: "bread".into(), quantity: 4, unit_price: 500, to: "ann".into(), at: "home-1".into(), account: "acc-ann".into(), placed: 0, for_days: None, terms: None };
    let s: Step<TradeThen> = fill(&o, 3, "shop-1", "acc-shop", "serving", &cx);
    let t = text(&s);
    assert!(t.contains("goods(") && t.contains("quantity=\"3\""), "{t}");
    assert!(t.contains("money(") && t.contains("$5.00"), "a refund for the one not delivered: {t}");
    assert!(t.contains("delivery_note"), "{t}");
    assert!(s.then.is_some(), "a refused delivery refunds the whole order");
    let on_terms = Order { terms: Some(14), ..o.clone() };
    let s: Step<TradeThen> = fill(&on_terms, 4, "shop-1", "acc-shop", "wholesale", &cx);
    let t = text(&s);
    assert!(!t.contains("money("), "on terms nothing was paid, so nothing is refunded: {t}");
    assert!(t.contains("pay_to") && t.contains("pay_in_days") && t.contains("owed"), "{t}");
    let none: Step<TradeThen> = fill(&o, 0, "shop-1", "acc-shop", "out of stock", &cx);
    assert!(none.then.is_none());
}

#[test]
fn an_order_is_paid_with_the_order_or_left_to_the_sellers_terms() {
    let (ctx, mut draws) = world_ctx();
    let cx = cx_for(&ctx, &mut draws, 0);
    let base = Ordering { me: "shop".into(), seller: "mill".into(), seller_account: "acc-mill".into(), kind: "flour".into(), quantity: 10, unit_price: 400, to: None, at: "shop-1".into(), from: "acc-shop".into(), why: "restock".into(), retry_of: None, for_days: None, terms: None };
    let cash = text(&order::<TradeThen>(&base, &cx));
    assert!(cash.contains("order=statement(") || cash.starts_with("order = statement("), "{cash}");
    assert!(cash.contains("money(") && cash.contains("$40.00"), "{cash}");
    let credit = text(&order::<TradeThen>(&Ordering { terms: Some(14), ..base }, &cx));
    assert!(!credit.contains("money(") && credit.contains("pay_in_days"), "{credit}");
}

#[test]
fn what_a_buyer_owes_on_terms_is_paid_on_the_day_wages_first_and_not_twice() {
    let (ctx, mut draws) = world_ctx();
    let cx = cx_for(&ctx, &mut draws, 0);
    let note = statement("rec.30", 100, "mill", "delivery_note", &["shop"], json!({ "order": "rec.20", "kind": "flour", "ordered": 100, "delivered": 100, "refund": 0, "owed": 40_000, "pay_in_days": 14, "pay_to": "acc-mill" }));
    let book = book_of(vec![note]);
    let mut p = Payables::new("shop");
    p.take(&book);
    assert_eq!(p.owing(), 40_000);
    let due = 100 + 14 * DAY;
    assert!(p.pay::<TradeThen>(due - 1, "acc-shop", 1_000_000, 0, None, false, &cx).is_empty(), "not yet due");
    // On the day, with the wages kept aside there is not enough: nothing is paid.
    assert!(p.pay::<TradeThen>(due, "acc-shop", 100_000, 80_000, None, false, &cx).is_empty());
    let mut c = Committed::new();
    let steps = p.pay::<TradeThen>(due, "acc-shop", 100_000, 30_000, Some(&mut c), false, &cx);
    assert_eq!(steps.len(), 1);
    assert_eq!(c.owed(), 40_000);
    assert_eq!(p.owing(), 0);
    assert!(p.pay::<TradeThen>(due + 1, "acc-shop", 1_000_000, 0, None, false, &cx).is_empty(), "paid once");
    // Behind with a supplier: an invoice past its day.
    let mut p = Payables::new("shop");
    p.take(&book);
    assert!(p.behind("mill", due + 1) && !p.behind("mill", due - 1) && !p.behind("other", due + 1));
    // Told it is supplied on terms no more: no terms asked of that seller for thirty days.
    let told = book_of(vec![statement("rec.31", 500, "mill", "delivery_note", &["shop"], json!({ "order": "rec.21", "kind": "flour", "ordered": 1, "delivered": 0, "refund": 0, "declined": "overdue" }))]);
    let mut p = Payables::new("shop");
    p.take(&told);
    assert!(p.behind("mill", 500 + DAY) && !p.behind("mill", 500 + 31 * DAY));
}

#[test]
fn a_shops_price_list_is_also_an_offer_when_it_lists_one_kind_and_holdings_are_read_by_place() {
    let mut prices = BTreeMap::new();
    prices.insert("bread".to_string(), 500);
    let c = price_list(&prices, "acc-shop", "bread at $5.00", json!({ "at": "shop-1" }), Some("shop"), Some("cell.1.1"), false);
    let t = program_text(&Program::Lines(vec![Line { bind: None, call: c }]));
    assert!(t.contains("offer") && t.contains("take_up") && t.contains("cell.1.1"), "{t}");
    prices.insert("flour".to_string(), 100);
    let c = price_list(&prices, "acc-shop", "two kinds", json!({}), Some("shop"), None, true);
    let t = program_text(&Program::Lines(vec![Line { bind: None, call: c }]));
    assert!(!t.contains("take_up") && t.contains("visible=public"), "{t}");
    let pic = picture(0, "shop", holdings(&[("shop-1", "bread", 12), ("home", "bread", 3)]));
    assert_eq!(held(&pic, "shop-1", "bread"), 12);
    assert_eq!(held(&pic, "shop-1", "flour"), 0);
}
