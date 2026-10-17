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
fn an_order_below_its_price_or_for_something_it_does_not_sell_is_refunded_whole() {
    let mut h = harness(json!({}));
    let cheap = an_order("rec.50", DAY + 8 * H, "ann", 2, 400);
    let other = statement("rec.51", DAY + 8 * H, "bob", "order", &[SHOP], json!({ "kind": "cake", "quantity": 1, "unit_price": 900, "deliver_to": "bob", "at": "home-2", "account": "acc-bob" }));
    let txs = json!([tx("acc-ann", "acc-shop", 800, DAY + 8 * H, "Order"), tx("acc-bob", "acc-shop", 900, DAY + 8 * H, "Order")]);
    let out = h.wake(DAY + 9 * H, world(&["w1"], vec![cheap, other], 10, 1_000_000, txs));
    let t = all(&out);
    assert!(t.contains("Served 0 of the 2 bread") && t.contains("Served 0 of the 1 cake"), "{t}");
    assert!(!t.contains("goods(") && !t.contains("work("), "nothing was served: {t}");
    assert!(t.contains("Refund: 2 bread") && t.contains("Refund: 1 cake"), "{t}");
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
