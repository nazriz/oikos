//! firm.retailer alone, with shoppers, suppliers and its staff scripted (docs/port-guide.md section 4): retailer.ts's
//! tests (participants/test/retail.test.ts and the shop tests of the scenario files), rewritten to assert behaviour.

use super::*;
use crate::market::testkit::*;
use serde_json::json;

const SHOP: &str = "shop";
const H: i64 = 3600;

fn params(extra: Value) -> Value {
    let mut p = json!({
        "premises": "shop-1", "workplace": "shop-1-floor", "kind": "bread", "serve_labour": 1800, "price": 500, "demand": 20,
        "suppliers": ["mill"], "wage": 120_000, "period": 14 * DAY, "max_staff": 3, "min_staff": 1,
        "theta_bps": 10_000, "vartheta_bps": 400,
    });
    for (k, v) in extra.as_object().cloned().unwrap_or_default() {
        p[k] = v;
    }
    p
}

fn harness(extra: Value) -> Harness {
    Harness::new(&Retailer, SHOP, params(extra))
}

/// The shop's premises with its staff in the workplace.
fn premises(workers: &[&str]) -> Value {
    json!({ "town": { "kind": "sites", "as_of": 0, "cells": [{ "cell": "cell.1.1", "x": 1, "y": 1, "structure": {
        "structure": "shop-1", "type": "shop", "at": "cell.1.1", "w": 1, "h": 1, "complete": true,
        "spaces": [{ "space": "shop-1-floor", "kind": "workplace", "capacity": 6, "count": workers.len(), "occupants": workers }] } }] } })
}

fn employment(id: &str, worker: &str) -> Vec<Value> {
    vec![
        json!({ "id": id, "record": "agreement", "author": "shop-system", "at": 0, "visible_to": [SHOP, worker], "terms": { "template": "employment", "parties": [SHOP, worker],
            "commitments": [{ "who": SHOP, "does": { "outcome": { "money": { "to": format!("acc-{worker}"), "amount": "120000", "for": "Wages." } } }, "every": 14 * DAY },
                            { "who": worker, "does": { "outcome": { "work": { "at": "shop-1-floor" } } } }] } }),
        json!({ "id": format!("{id}-a"), "record": "signature", "author": "shop-system", "at": 0, "visible_to": [SHOP, worker], "agreement": id, "as": SHOP }),
        json!({ "id": format!("{id}-b"), "record": "signature", "author": format!("{worker}-self"), "at": 0, "visible_to": [SHOP, worker], "agreement": id, "as": worker }),
    ]
}

fn wholesale(id: &str, at: i64, seller: &str, price: i64, min: i64) -> Value {
    statement(id, at, seller, "price_list", &[], json!({ "goods": { "bread": price }, "account": format!("acc-{seller}"), "min_order": min }))
}

fn an_order(id: &str, at: i64, buyer: &str, qty: i64, unit: i64) -> Value {
    statement(id, at, buyer, "order", &[SHOP], json!({ "kind": "bread", "quantity": qty, "unit_price": unit, "deliver_to": buyer, "at": "home-1", "account": format!("acc-{buyer}") }))
}

fn all(programs: &[String]) -> String {
    programs.join("\n")
}

fn world(workers: &[&str], extra: Vec<Value>, stock: i64, balance: i64, txs: Value) -> Value {
    let mut recs = vec![];
    for (i, w) in workers.iter().enumerate() {
        recs.extend(employment(&format!("emp{i}"), w));
    }
    recs.extend(extra);
    channels(vec![money(SHOP, balance, txs), records("mine", recs), holdings(&[("shop-1", "bread", stock)]), premises(workers)])
}

#[test]
fn a_shop_publishes_its_price_as_a_list_and_an_offer_where_its_customers_can_see_it() {
    let mut h = harness(json!({}));
    let out = h.wake(DAY + 9 * H, world(&["w1"], vec![], 10, 1_000_000, json!([])));
    let t = all(&out);
    assert!(t.contains("price_list") && t.contains("bread") && t.contains("500"), "{t}");
    assert!(t.contains("take_up"), "one kind of goods is also an offer to order and pay");
    assert!(t.contains("visible=public"), "published to all unless it has a shopfront: {t}");
    let again = h.wake(DAY + 10 * H, world(&["w1"], vec![], 10, 1_000_000, json!([])));
    assert!(!all(&again).contains("price_list"), "published once while the price stands");
    let mut front = harness(json!({ "shopfront": true }));
    let t = all(&front.wake(DAY + 9 * H, world(&["w1"], vec![], 10, 1_000_000, json!([]))));
    assert!(t.contains("on=cell.1.1") && !t.contains("visible=public"), "put up at its premises, not sent to the town: {t}");
}

#[test]
fn a_paid_order_is_served_by_the_staff_there_goods_to_the_customer_and_a_delivery_note() {
    let mut h = harness(json!({}));
    let txs = json!([tx("acc-ann", "acc-shop", 1500, DAY + 8 * H, "Order: 3 bread.")]);
    let out = h.wake(DAY + 9 * H, world(&["w1"], vec![an_order("rec.50", DAY + 8 * H, "ann", 3, 500)], 10, 1_000_000, txs));
    let t = all(&out);
    assert!(t.contains("work(") && t.contains("task=serve") && t.contains("units=\"3\"") && t.contains("w1"), "{t}");
    assert!(t.contains("goods(") && t.contains("quantity=\"3\"") && t.contains("to=ann") && t.contains("from_at=shop-1"), "{t}");
    assert!(t.contains("delivery_note") && t.contains("Served: 3 bread"), "{t}");
    assert!(!t.contains("money("), "nothing to refund: {t}");
}

#[test]
fn what_it_cannot_serve_for_want_of_stock_is_refunded_and_counted_as_customers_turned_away() {
    let mut h = harness(json!({}));
    let txs = json!([tx("acc-ann", "acc-shop", 2000, DAY + 8 * H, "Order: 4 bread.")]);
    let out = h.wake(DAY + 9 * H, world(&["w1"], vec![an_order("rec.50", DAY + 8 * H, "ann", 4, 500)], 1, 1_000_000, txs));
    let t = all(&out);
    assert!(t.contains("units=\"1\""), "serves the one it has: {t}");
    // Next day the shelf is bare: the rest is refunded, and the note says so.
    let out = h.wake(2 * DAY + 9 * H, world(&["w1"], vec![], 0, 1_000_000, json!([])));
    let t = all(&out);
    assert!(t.contains("$15.00") && t.contains("Refund: 3 bread"), "refunds the three it could not: {t}");
    assert!(t.contains("Served 1 of the 4 bread ordered"), "{t}");
}

#[test]
fn an_order_at_a_price_since_raised_buys_what_its_money_buys_at_ours_and_one_for_something_it_does_not_sell_is_refunded_whole() {
    // (Until the cut-over, 2026-10-19, an order below the shop's price was refunded whole: a household that last saw the
    // shop's price before a rise went without until its next trip. A customer pays the price on the shelf, as at a till:
    // docs/behaviour/retailer.md, "Selling".)
    let mut h = harness(json!({}));
    let cheap = an_order("rec.50", DAY + 8 * H, "ann", 2, 400);
    let other = statement("rec.51", DAY + 8 * H, "bob", "order", &[SHOP], json!({ "kind": "cake", "quantity": 1, "unit_price": 900, "deliver_to": "bob", "at": "home-2", "account": "acc-bob" }));
    let too_little = an_order("rec.52", DAY + 8 * H, "cat", 1, 400);
    let txs = json!([tx("acc-ann", "acc-shop", 800, DAY + 8 * H, "Order"), tx("acc-bob", "acc-shop", 900, DAY + 8 * H, "Order"), tx("acc-cat", "acc-shop", 400, DAY + 8 * H, "Order")]);
    let out = h.wake(DAY + 9 * H, world(&["w1"], vec![cheap, other, too_little], 10, 1_000_000, txs));
    let t = all(&out);
    // (The note says what was ordered and the price charged: until 2026-10-26 it gave the one the money bought as the
    // number ordered, "Served: 1 bread", and a reader could not tell the order had been cut.)
    assert!(t.contains("Served 1 of the 2 bread ordered (at our price of $5.00 each); $3.00 refunded"), "800 at our 500 buys one: {t}");
    assert!(t.contains("\"ordered\":2") && t.contains("\"delivered\":1") && t.contains("\"unit_price\":500"), "ordered two, served one at 500: {t}");
    assert!(t.contains("Refund: what you paid over our price") && t.contains("\"refund\":300"), "the 300 over comes back with the note: {t}");
    assert!(!t.contains("\"unit_price\":400"), "an order at our price, or refunded whole, says no price of its own: {t}");
    assert!(t.contains("Served 0 of the 1 cake") && t.contains("Refund: 1 cake"), "{t}");
    assert!(t.contains("Served 0 of the 1 bread") && t.contains("Refund: 1 bread"), "400 buys none at 500: refunded whole: {t}");
}

#[test]
fn a_serving_the_world_refuses_waits_its_turn_and_its_note_still_refunds_what_was_paid_over_our_price() {
    // (Found 2026-10-26, "Main red after foundations-2 phase 1" in docs/decisions.md: what a note settles, the money paid
    // over our price and the number ordered, was forgotten when the serving was sent; a serving refused (a crew's day
    // short of time) or lapsed at the close waited its turn again, and the note of the one that went out refunded
    // nothing of the over-payment and gave the number the money bought as the number ordered.)
    let mut h = harness(json!({}));
    let txs = json!([tx("acc-ann", "acc-shop", 800, DAY + 8 * H, "Order")]);
    let first = all(&h.wake_refused(DAY + 9 * H, world(&["w1"], vec![an_order("rec.50", DAY + 8 * H, "ann", 2, 400)], 10, 1_000_000, txs), "no_time_left", "w1 has no time left today."));
    assert!(first.contains("task=serve"), "it tries to serve: {first}");
    let t = all(&h.wake(2 * DAY + 9 * H, world(&["w1"], vec![], 10, 1_000_000, json!([]))));
    assert!(t.contains("Served 1 of the 2 bread ordered (at our price of $5.00 each); $3.00 refunded"), "served next day, the 300 over still refunded: {t}");
    assert!(t.contains("\"refund\":300") && t.contains("\"ordered\":2") && t.contains("\"unit_price\":500"), "{t}");
}

#[test]
fn a_restock_is_spread_across_suppliers_by_price_and_delivery_and_not_all_given_to_the_cheapest() {
    let mut h = harness(json!({ "suppliers": ["mill", "farm"], "demand": 400 }));
    let book = vec![wholesale("rec.1", 0, "mill", 404, 10), wholesale("rec.2", 0, "farm", 400, 10)];
    let t = all(&h.wake(DAY + 9 * H, world(&["w1"], book, 2, 10_000_000, json!([]))));
    assert!(t.contains("acc-farm") && t.contains("acc-mill"), "both are ordered from: {t}");
    // (398 wanted: the cheaper farm 210, the mill 1% dearer 188, by (400/404)^10.)
    assert!(t.contains("\"quantity\":210,\"unit_price\":400") && t.contains("\"quantity\":188,\"unit_price\":404"), "{t}");
}

#[test]
fn an_order_unpaid_for_a_week_is_declined_and_money_with_no_order_is_sent_back() {
    let mut h = harness(json!({}));
    let unpaid = an_order("rec.50", DAY, "ann", 2, 500);
    let out = h.wake(DAY + 9 * H, world(&["w1"], vec![unpaid], 10, 1_000_000, json!([tx("acc-cat", "acc-shop", 100, DAY, "Order")])));
    assert!(!all(&out).contains("declined"), "not yet");
    let out = h.wake(9 * DAY, world(&["w1"], vec![], 10, 1_000_000, json!([])));
    assert!(all(&out).contains("declined: not paid"), "{}", all(&out));
}

#[test]
fn a_shop_short_of_stock_orders_from_the_cheapest_supplier_that_has_a_price_and_keeps_the_wages_aside() {
    let mut h = harness(json!({ "suppliers": ["mill", "farm", "dear"] }));
    let book = vec![wholesale("rec.1", 0, "mill", 430, 10), wholesale("rec.2", 0, "farm", 400, 10), wholesale("rec.3", 0, "dear", 700, 1)];
    let out = h.wake(DAY + 9 * H, world(&["w1"], book, 2, 1_000_000, json!([])));
    let t = all(&out);
    assert!(t.contains("order=statement(") || t.contains("order = statement("), "{t}");
    assert!(t.contains("to=farm") || t.contains("\"farm\""), "the cheapest: {t}");
    assert!(t.contains("kind=order") && t.contains("unit_price"), "{t}");
    assert!(t.contains("money(") && t.contains("acc-farm"), "cash with the order: {t}");
    // Nothing more that week; and with too little money to pay for the least order it buys none.
    let mut poor = harness(json!({ "suppliers": ["farm"] }));
    let t = all(&poor.wake(DAY + 9 * H, world(&["w1"], vec![wholesale("rec.2", 0, "farm", 400, 10)], 2, 90_000, json!([]))));
    assert!(!t.contains("acc-farm"), "after the wages there is not enough for the least order: {t}");
}

#[test]
fn a_supplier_that_states_terms_is_bought_from_on_them_so_stock_no_longer_comes_out_of_wages() {
    let mut h = harness(json!({ "suppliers": ["mill"] }));
    let terms = statement("rec.1", 0, "mill", "price_list", &[], json!({ "goods": { "bread": 430 }, "account": "acc-mill", "min_order": 10, "terms_days": 14 }));
    let out = h.wake(DAY + 9 * H, world(&["w1"], vec![terms], 2, 1_000_000, json!([])));
    let t = all(&out);
    assert!(t.contains("pay_in_days") && !t.contains("acc-mill\"") || t.contains("pay_in_days"), "{t}");
    assert!(t.contains("on its terms") || t.contains("pay_in_days"), "{t}");
    assert!(!t.contains("money("), "nothing paid with an order on terms: {t}");
}

#[test]
fn a_shop_short_of_hands_that_turns_customers_away_raises_its_price_at_the_months_end_and_never_cuts_it() {
    let mut h = harness(json!({ "demand": 20 }));
    let mut price_lists = vec![];
    // Each day a customer orders more than the one hand can serve, and the stock is low: three months of it.
    for day in 1..=95 {
        let t = day * DAY + 9 * H;
        let id = format!("rec.{}", 100 + day);
        let o = an_order(&id, t - H, "ann", 40, 600);
        let txs = json!([tx("acc-ann", "acc-shop", 40 * 600, t - H, "Order")]);
        let out = h.wake(t, world(&["w1"], vec![o], 3, 5_000_000, txs));
        for p in out.iter().filter(|p| p.contains("price_list")) {
            price_lists.push(p.clone());
        }
    }
    assert!(price_lists.len() >= 2, "it republished its price when it changed: {}", price_lists.len());
    let price = |p: &str| -> i64 {
        let i = p.find("goods={\"bread\":").map(|i| i + 15).or_else(|| p.find("bread\":").map(|i| i + 7)).expect("a price in the list");
        p[i..].chars().take_while(char::is_ascii_digit).collect::<String>().parse().unwrap()
    };
    let prices: Vec<i64> = price_lists.iter().map(|p| price(p)).collect();
    assert!(prices.windows(2).all(|w| w[1] >= w[0]), "a shop turning customers away never cuts: {prices:?}");
    assert!(prices.last().unwrap() > prices.first().unwrap(), "{prices:?}");
}

#[test]
fn a_shop_with_stock_it_cannot_sell_cuts_its_price_towards_cost_and_no_lower() {
    let mut h = harness(json!({ "suppliers": ["mill"], "demand": 5, "price": 700, "wage": 20_000 }));
    let book = vec![wholesale("rec.1", 0, "mill", 430, 10)];
    let mut lists = vec![];
    for day in 1..=130 {
        let t = day * DAY + 9 * H;
        let extra = if day == 1 { book.clone() } else { vec![] };
        let out = h.wake(t, world(&["w1"], extra, 400, 5_000_000, json!([])));
        lists.extend(out.into_iter().filter(|p| p.contains("price_list")));
    }
    let prices: Vec<i64> = lists
        .iter()
        .map(|p| {
            let i = p.find("bread\":").unwrap() + 7;
            p[i..].chars().take_while(char::is_ascii_digit).collect::<String>().parse().unwrap()
        })
        .collect();
    assert!(prices.len() >= 2 && prices.windows(2).all(|w| w[1] <= w[0]), "{prices:?}");
    // Marginal cost: 430 plus 1800 s of a 120000-a-fortnight wage (about 250 an hour on a 6-day week): never below 80% of it.
    assert!(*prices.last().unwrap() >= 534, "never below cost (430 + 104 of serving): {prices:?}");
}

#[test]
fn rivals_it_has_been_shown_pull_its_price_towards_theirs() {
    let rival = |id: &str, at: i64, who: &str, p: i64| statement(id, at, who, "price_list", &[], json!({ "goods": { "bread": p }, "account": format!("acc-{who}"), "at": format!("{who}-1") }));
    let mut h = harness(json!({ "price": 900, "demand": 60 }));
    let mut lists = vec![];
    for day in 1..=125 {
        let t = day * DAY + 9 * H;
        let extra = if day == 1 { vec![rival("rec.7", 0, "a", 600), rival("rec.8", 0, "b", 620), rival("rec.9", 0, "c", 640)] } else { vec![] };
        let o = an_order(&format!("rec.{}", 100 + day), t - H, "ann", 2, 900);
        let out = h.wake(t, world(&["w1"], [extra, vec![o]].concat(), 60, 5_000_000, json!([tx("acc-ann", "acc-shop", 1800, t - H, "Order")])));
        lists.extend(out.into_iter().filter(|p| p.contains("price_list")));
    }
    let first = lists.first().expect("a list");
    let last = lists.last().unwrap();
    let price = |p: &str| -> i64 { let i = p.find("bread\":").unwrap() + 7; p[i..].chars().take_while(char::is_ascii_digit).collect::<String>().parse().unwrap() };
    assert!(price(last) < price(first), "dearer than every rival it has seen, with no scarcity: it comes down ({} to {})", price(first), price(last));
}

#[test]
fn at_the_months_end_what_it_holds_beyond_its_buffer_goes_to_the_shareholders_by_their_shares() {
    let mut h = harness(json!({}));
    let holders = statement("rec.1", 0, SHOP, "shareholders", &[], json!({ "holders": [{ "holder": "ann", "account": "acc-ann", "shares": 7500 }, { "holder": "bob", "account": "acc-bob", "shares": 2500 }] }));
    // Open for a month, then a month-end with money in hand and a month of takings.
    h.wake(DAY + 9 * H, world(&["w1"], vec![holders], 10, 1_000_000, json!([])));
    let mut paid_out = String::new();
    for day in 2..=70 {
        let t = day * DAY + 9 * H;
        let out = h.wake(t, world(&["w1"], vec![], 10, 1_000_000 + day * 10_000, json!([])));
        paid_out.push_str(&all(&out));
    }
    assert!(paid_out.contains("dividend") && paid_out.contains("acc-ann") && paid_out.contains("acc-bob"), "{paid_out}");
}

#[test]
fn a_shop_just_founded_asks_the_bank_for_an_account_then_its_founder_for_the_capital_and_trades_only_once_set_up() {
    let mut h = harness(json!({ "founder": "ann", "capital": 5_000_000, "bank": "bank", "operator": "ann", "listing": null }));
    // No account yet.
    let out = h.wake(DAY, channels(vec![records("mine", vec![]), holdings(&[])]));
    assert!(all(&out).contains("account(") && all(&out).contains("at=bank"), "{}", all(&out));
    // The account opened: the capital is asked of the founder.
    let out = h.wake(DAY + H, channels(vec![money(SHOP, 0, json!([])), holdings(&[])]));
    let t = all(&out);
    assert!(t.contains("capital_call") && t.contains("acc-shop") && t.contains("ann"), "{t}");
    // The capital arrives: our shareholders are registered, and the business of one opens from its owner's home.
    let out = h.wake(DAY + 2 * H, channels(vec![money(SHOP, 5_000_000, json!([tx("acc-ann", "acc-shop", 5_000_000, DAY + H, "Capital")])), holdings(&[])]));
    let t = all(&out);
    assert!(t.contains("shareholders") && t.contains("acc-ann"), "{t}");
}

#[test]
fn a_shops_memory_saves_and_the_restored_shop_acts_as_the_original_would() {
    let mut a = harness(json!({}));
    let mut b = harness(json!({}));
    let txs = json!([tx("acc-ann", "acc-shop", 1000, DAY + 8 * H, "Order")]);
    let w = |extra: Vec<Value>| world(&["w1"], extra, 10, 1_000_000, txs.clone());
    a.wake(DAY + 9 * H, w(vec![an_order("rec.50", DAY + 8 * H, "ann", 2, 500)]));
    b.wake(DAY + 9 * H, w(vec![an_order("rec.50", DAY + 8 * H, "ann", 2, 500)]));
    b.save_and_restore();
    let next = |h: &mut Harness| h.wake(2 * DAY + 9 * H, world(&["w1"], vec![an_order("rec.51", 2 * DAY + 8 * H, "bob", 1, 500)], 8, 1_000_000, json!([tx("acc-bob", "acc-shop", 500, 2 * DAY + 8 * H, "Order")])));
    assert_eq!(next(&mut a), next(&mut b));
}

#[test]
fn the_same_shop_in_the_same_town_acts_the_same_way_twice() {
    let run = || {
        let mut h = harness(json!({}));
        let mut all_out = vec![];
        for day in 1..40 {
            let t = day * DAY + 9 * H;
            let o = an_order(&format!("rec.{}", 100 + day), t - H, "ann", 3, 500);
            all_out.extend(h.wake(t, world(&["w1"], vec![o], 6, 1_000_000, json!([tx("acc-ann", "acc-shop", 1500, t - H, "Order")]))));
        }
        all_out
    };
    assert_eq!(run(), run());
}

#[test]
fn its_manifest_is_the_ts_one_and_adds_only_what_the_port_adds() {
    let ts: Value = serde_json::from_str(MANIFEST).unwrap();
    let rust = manifest();
    for (k, v) in ts["params"].as_object().unwrap() {
        assert_eq!(&rust["params"][k], v, "{k}");
    }
    assert_eq!(rust["name"], ts["name"]);
    assert!(rust["params"]["price_adjust_bps"].is_object());
}

#[test]
fn premises_pay_when_the_custom_outruns_one_person_and_the_margin_pays_the_hands_and_the_rent() {
    // 300 a month wanted, 100 a worker: three at work (the owner and two hands), at 1,000 a unit, 30,000 a hand.
    assert_eq!(premises_pay(300, 100, 1_000, 30_000, 50_000, 6), (300 * 1_000 - 2 * 30_000 - 50_000, 3));
    // The room holds two: 200 served.
    assert_eq!(premises_pay(300, 100, 1_000, 30_000, 50_000, 2), (200 * 1_000 - 30_000 - 50_000, 2));
    // What one person serves alone gains nothing from premises: the rent is all it adds.
    let alone = 100 * 1_000;
    assert!(premises_pay(100, 100, 1_000, 30_000, 50_000, 6).0 < alone);
    // A thin margin does not pay the hands: worse than alone however much is wanted.
    assert!(premises_pay(300, 100, 100, 30_000, 50_000, 6).0 < 100 * 100);
}

// ---- a business of one in premises it leases (docs/behaviour/leasing.md) ----

const LEASE: &str = "rec.PL1";
/// The agreement reader's name, as the kernel signs its readings.
const READER: &str = "terms-0.2.0";

/// A business of one trading from its owner's home.
fn sole(extra: Value) -> Harness {
    let mut p = json!({ "operator": "ann", "premises": "home-1", "workplace": "home-1/dwelling.1", "premises_cell": "cell.1.1", "max_staff": 0, "min_staff": 0, "premises_board": "premises" });
    for (k, v) in extra.as_object().cloned().unwrap_or_default() {
        p[k] = v;
    }
    harness(p)
}

/// Its memory given a lease of unit-1 (as taking one leaves it), and where it traded before.
fn with_lease(h: &mut Harness) {
    fn find(v: &mut Value) -> Option<&mut serde_json::Map<String, Value>> {
        if v.as_object().is_some_and(|m| m.contains_key("premises_applied")) {
            return v.as_object_mut();
        }
        match v {
            Value::Object(m) => m.values_mut().find_map(find),
            Value::Array(a) => a.iter_mut().find_map(find),
            _ => None,
        }
    }
    let mut saved = h.actor.save().unwrap();
    let shop = find(&mut saved).expect("the shop's memory");
    shop.insert("lease".into(), json!({ "agreement": LEASE, "space": "unit-1/workplace.1", "structure": "unit-1", "cell": "cell.2.1", "room": 4, "rent": 250_000, "from": ["home-1", "home-1/dwelling.1", "cell.1.1"] }));
    shop["at"]["premises"] = json!("unit-1");
    shop["at"]["workplace"] = json!("unit-1/workplace.1");
    h.actor = h.kind.restore(&h.ctx, saved).unwrap();
}

/// The lease, signed by both, with the landlord's clause and, where the law gives one, ours.
fn the_lease(ours: Option<i64>) -> Vec<Value> {
    let mut termination = vec![json!({ "party": "landlord-1", "notice": DAY })];
    if let Some(n) = ours {
        termination.push(json!({ "party": SHOP, "notice": n }));
    }
    vec![
        json!({ "id": LEASE, "record": "agreement", "author": "landlord-1-office-system", "at": 0, "visible_to": [SHOP, "landlord-1"], "terms": { "template": "lease", "parties": ["landlord-1", SHOP], "term": 60 * MONTH, "termination": termination,
            "commitments": [{ "who": "landlord-1", "does": { "outcome": { "occupancy": { "who": SHOP, "in": "unit-1/workplace.1" } } } },
                            { "who": SHOP, "does": { "outcome": { "money": { "to": "acc-landlord-1", "amount": "250000", "for": "rent" } } }, "every": MONTH }] } }),
        json!({ "id": "sig-l", "record": "signature", "author": "landlord-1-office-system", "at": 0, "visible_to": [SHOP, "landlord-1"], "agreement": LEASE, "as": "landlord-1" }),
        json!({ "id": "sig-s", "record": "signature", "author": "ann-self", "at": 0, "visible_to": [SHOP, "landlord-1"], "agreement": LEASE, "as": SHOP }),
        // (Our standing order for its rent.)
        json!({ "id": "rec.order", "record": "statement", "author": "ann-self", "speaks_for": SHOP, "at": 0, "visible_to": [SHOP], "kind": "request", "text": "Pay the rent.", "basis": LEASE, "data": { "every": MONTH, "to": "acc-landlord-1", "amount": 250_000 } }),
    ]
}

/// The unit as we see it there: who is in its workplace.
fn unit(here: &[&str]) -> Value {
    json!({ "unit": { "kind": "sites", "as_of": 0, "cells": [{ "cell": "cell.2.1", "x": 2, "y": 1, "structure": {
        "structure": "unit-1", "type": "shop-unit", "at": "cell.2.1", "w": 1, "h": 1, "complete": true,
        "spaces": [{ "space": "unit-1/workplace.1", "kind": "workplace", "capacity": 4, "count": here.len(), "occupants": here }] } }] } })
}

fn leased_world(here: &[&str], extra: Vec<Value>, stock: i64, balance: i64, txs: Value, ours: Option<i64>) -> Value {
    let mut recs = the_lease(ours);
    recs.extend(extra);
    channels(vec![money(SHOP, balance, txs), records("mine", recs), holdings(&[("unit-1", "bread", stock)]), unit(here)])
}

#[test]
fn in_premises_it_leases_a_business_serves_only_once_it_sees_its_owner_there() {
    let mut h = sole(json!({}));
    h.wake(DAY + 6 * H, channels(vec![money(SHOP, 1_000_000, json!([])), records("mine", vec![]), holdings(&[("home-1", "bread", 10)])]));
    with_lease(&mut h);
    h.readings = json!({ LEASE: { "of": "agreement", "status": "in_force", "ends_at": 60 * MONTH, "reader": READER } });
    let txs = json!([tx("acc-bob", "acc-shop", 1500, DAY + 8 * H, "Order: 3 bread.")]);
    // Its owner is not at the unit yet: nothing is served (no act the kernel would refuse for nobody there).
    let t = all(&h.wake(DAY + 9 * H, leased_world(&[], vec![an_order("rec.50", DAY + 8 * H, "bob", 3, 500)], 10, 1_000_000, txs, None)));
    assert!(!t.contains("work("), "nobody there to serve: {t}");
    // Its owner has come: served, there.
    let t = all(&h.wake(DAY + 10 * H, leased_world(&["ann"], vec![], 10, 1_000_000, json!([]), None)));
    assert!(t.contains("work(") && t.contains("units=\"3\"") && t.contains("at=unit-1") && t.contains("ann"), "{t}");
}

#[test]
fn a_rent_demand_is_paid_if_held_and_a_review_changes_the_rent_from_its_day_and_stops_the_old_order_after_its_last_payment() {
    let mut h = sole(json!({}));
    h.wake(DAY, channels(vec![money(SHOP, 1_000_000, json!([])), records("mine", vec![]), holdings(&[("home-1", "bread", 10)])]));
    with_lease(&mut h);
    h.readings = json!({ LEASE: { "of": "agreement", "status": "in_force", "ends_at": 60 * MONTH, "reader": READER } });
    let demand = statement("rec.d", 2 * DAY, "landlord-1", "review_request", &[SHOP], json!({ "matter": "arrears", "about": LEASE, "amount": 250_000, "account": "acc-landlord-1" }));
    let from = 3 * MONTH;
    let review = statement("rec.r", 2 * DAY, "landlord-1", "rent_review", &[SHOP], json!({ "lease": LEASE, "rent": 300_000, "from": from, "was": 250_000 }));
    let t = all(&h.wake(2 * DAY + H, leased_world(&["ann"], vec![demand, review], 10, 1_000_000, json!([]), None)));
    assert!(t.contains("money(") && t.contains("$2500.00") && t.contains("to=acc-landlord-1") && t.contains("Rent owed"), "the demand paid: {t}");
    assert!(t.contains("$3000.00") && t.contains("every="), "a new order at the new rent: {t}");
    assert!(!t.contains("withdraw=rec.order"), "the old order runs until its last payment: {t}");
    let t = all(&h.wake(from - DAY + H, leased_world(&["ann"], vec![], 10, 1_000_000, json!([]), None)));
    assert!(t.contains("withdraw=rec.order"), "stopped before the new rent's day: {t}");
    // A demand it cannot pay is left: the landlord has its remedies.
    let mut poor = sole(json!({}));
    poor.wake(DAY, channels(vec![money(SHOP, 100_000, json!([])), records("mine", vec![]), holdings(&[("home-1", "bread", 10)])]));
    with_lease(&mut poor);
    poor.readings = h.readings.clone();
    let demand = statement("rec.d", 2 * DAY, "landlord-1", "review_request", &[SHOP], json!({ "matter": "arrears", "about": LEASE, "amount": 250_000, "account": "acc-landlord-1" }));
    let t = all(&poor.wake(2 * DAY + H, leased_world(&["ann"], vec![demand], 10, 100_000, json!([]), None)));
    assert!(!t.contains("Rent owed"), "{t}");
}

#[test]
fn a_closing_business_asks_to_surrender_a_lease_that_gives_it_no_notice_and_pays_the_price_or_gives_its_own_notice_where_it_does() {
    for ours in [None, Some(180 * DAY)] {
        let mut h = sole(json!({}));
        h.wake(DAY, channels(vec![money(SHOP, 2_000_000, json!([])), records("mine", vec![]), holdings(&[("home-1", "bread", 10)])]));
        with_lease(&mut h);
        h.readings = json!({ LEASE: { "of": "agreement", "status": "in_force", "ends_at": 60 * MONTH, "reader": READER } });
        let closed = statement("rec.c", 2 * DAY, "ann", "trading_from", &[SHOP], json!({ "closed": true }));
        let t = all(&h.wake(2 * DAY + H, leased_world(&["ann"], vec![closed], 10, 2_000_000, json!([]), ours)));
        assert!(!t.contains("\"closure\"") && !t.contains("kind=closure"), "it does not close while the lease binds it: {t}");
        match ours {
            None => {
                assert!(t.contains("surrender_request") && t.contains(LEASE), "{t}");
                let terms = statement("rec.st", 3 * DAY, "landlord-1", "surrender_terms", &[SHOP], json!({ "lease": LEASE, "price": 750_000, "account": "acc-landlord-1" }));
                let t = all(&h.wake(3 * DAY + H, leased_world(&["ann"], vec![terms], 10, 2_000_000, json!([]), ours)));
                assert!(t.contains("money(") && t.contains("$7500.00") && t.contains("surrender"), "the price paid: {t}");
            }
            Some(_) => assert!(t.contains(&format!("notice={LEASE}")) && !t.contains("surrender_request"), "its own notice: {t}"),
        }
    }
}

#[test]
fn when_its_lease_ends_a_business_stops_the_rent_takes_its_stock_back_and_tells_its_owner() {
    let mut h = sole(json!({}));
    h.wake(DAY, channels(vec![money(SHOP, 1_000_000, json!([])), records("mine", vec![]), holdings(&[("home-1", "bread", 10)])]));
    with_lease(&mut h);
    h.readings = json!({ LEASE: { "of": "agreement", "status": "ended", "ends_at": 2 * DAY, "ended_by": "notice", "reader": READER } });
    let t = all(&h.wake(3 * DAY, leased_world(&["ann"], vec![], 7, 1_000_000, json!([]), None)));
    assert!(t.contains("withdraw=rec.order"), "the rent stopped: {t}");
    assert!(t.contains("goods(") && t.contains("at=home-1") && t.contains("from_at=unit-1") && t.contains("quantity=\"7\""), "its stock back home: {t}");
    assert!(t.contains("trading_at") && t.contains("\"back\":true") || t.contains("back"), "its owner told: {t}");
}

#[test]
fn premises_are_weighed_while_leased_as_taking_them_was_and_a_unit_that_adds_nothing_to_one_person_loses_its_rent() {
    let h = sole(json!({}));
    let mut s = Shop::new(&h.ctx, Params::read(&h.ctx).unwrap(), PlainBody::new(SHOP));
    s.price = 500;
    s.unit_cost = 300;
    s.lease = Some(Lease { rent: 250_000, room: 4, ..Default::default() });
    let alone = (s.p.hours_per_worker_month() / s.p.serve_labour.max(1)).max(1);
    // Custom one person serves: the unit adds only its rent.
    s.last_demand = alone / 2;
    assert_eq!(s.lease_loss(), 250_000);
    // Custom for four, at a margin that pays three hands and the rent: it pays.
    s.last_demand = 4 * alone;
    s.price = 5_000;
    assert_eq!(s.lease_loss(), 0, "{:?}", s.premises_weighing(250_000, 4));
}
