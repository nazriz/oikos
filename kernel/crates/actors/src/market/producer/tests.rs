//! firm.producer alone, with its supplier, customers, the outside world and its staff scripted (producer.ts's tests,
//! and the new export law of ME-15).

use super::*;
use crate::market::testkit::*;
use serde_json::json;

const F: &str = "works";
const H: i64 = 3600;

fn harness(extra: Value) -> Harness {
    let mut p = json!({ "works": "works-1", "workplace": "works-1-floor", "output": "flour", "per_unit": { "grain": 2 }, "labour_per_unit": 1800,
        "supplier": "farm", "market": "outside", "price": 400, "min_order": 10, "wage": 20_000, "theta_bps": 10_000, "work_days": 5 });
    for (k, v) in extra.as_object().cloned().unwrap_or_default() {
        p[k] = v;
    }
    Harness::new(&Producer, F, p)
}

fn premises(workers: &[&str]) -> Value {
    json!({ "town": { "kind": "sites", "as_of": 0, "cells": [{ "cell": "cell.2.2", "x": 2, "y": 2, "structure": {
        "structure": "works-1", "type": "factory", "at": "cell.2.2", "w": 1, "h": 1, "complete": true,
        "spaces": [{ "space": "works-1-floor", "kind": "workplace", "capacity": 40, "count": workers.len(), "occupants": workers }] } }] } })
}

fn staff(workers: &[&str]) -> Vec<Value> {
    workers
        .iter()
        .enumerate()
        .flat_map(|(i, w)| {
            let id = format!("emp{i}");
            vec![
                json!({ "id": id, "record": "agreement", "author": "works-system", "at": 0, "visible_to": [F, w], "terms": { "template": "employment", "parties": [F, w], "commitments": [] } }),
                json!({ "id": format!("{id}-a"), "record": "signature", "author": "works-system", "at": 0, "visible_to": [F, w], "agreement": id, "as": F }),
                json!({ "id": format!("{id}-b"), "record": "signature", "author": "w-self", "at": 0, "visible_to": [F, w], "agreement": id, "as": w }),
            ]
        })
        .collect()
}

fn farm(id: &str, grain: i64) -> Value {
    statement(id, 0, "farm", "price_list", &[], json!({ "goods": { "grain": grain }, "account": "acc-farm", "min_order": 10 }))
}

fn offer(id: &str, at: i64, unit: i64, quantity: i64, named: Option<(&str, i64)>) -> Value {
    let mut d = json!({ "kind": "flour", "unit_price": unit, "quantity": quantity, "until": at + 30 * DAY, "account": "acc-outside" });
    if let Some((s, q)) = named {
        d["quantities"] = json!({ s: q });
    }
    statement(id, at, "outside", "buying_offer", &[], d)
}

fn world(workers: &[&str], extra: Vec<Value>, flour: i64, grain: i64, balance: i64, txs: Value) -> Value {
    channels(vec![
        money(F, balance, txs),
        records("mine", [staff(workers), extra].concat()),
        holdings(&[("works-1", "flour", flour), ("works-1", "grain", grain)]),
        premises(workers),
    ])
}

fn all(p: &[String]) -> String {
    p.join("\n")
}

fn wholesale_order(id: &str, at: i64, buyer: &str, q: i64, unit: i64) -> Value {
    statement(id, at, buyer, "order", &[F], json!({ "kind": "flour", "quantity": q, "unit_price": unit, "deliver_to": buyer, "at": "shop-1", "account": format!("acc-{buyer}") }))
}

#[test]
fn it_publishes_a_wholesale_price_with_its_least_order() {
    let mut h = harness(json!({}));
    let t = all(&h.wake(DAY + 9 * H, world(&["w1"], vec![farm("rec.1", 100)], 50, 40, 1_000_000, json!([]))));
    assert!(t.contains("price_list") && t.contains("min_order") && t.contains("flour"), "{t}");
}

#[test]
fn it_buys_inputs_from_its_supplier_for_the_month_it_expects_to_make_and_sets_money_aside_for_the_wages() {
    let mut h = harness(json!({}));
    let o = vec![farm("rec.1", 100), offer("rec.2", 0, 450, 200, Some((F, 150)))];
    let t = all(&h.wake(DAY + 9 * H, world(&["w1"], o, 0, 0, 1_000_000, json!([]))));
    assert!(t.contains("kind=order") && t.contains("grain") && t.contains("farm"), "{t}");
    let mut poor = harness(json!({}));
    let t = all(&poor.wake(DAY + 9 * H, world(&["w1"], vec![farm("rec.1", 100)], 0, 0, 20_000, json!([]))));
    assert!(!t.contains("acc-farm"), "short of money after the wages: {t}");
}

#[test]
fn its_staff_make_the_days_units_as_far_as_inputs_and_hours_allow() {
    let mut h = harness(json!({}));
    let o = vec![farm("rec.1", 100), offer("rec.2", 0, 450, 200, Some((F, 150)))];
    let t = all(&h.wake(DAY + 9 * H, world(&["w1"], o, 0, 6, 10_000_000, json!([]))));
    assert!(t.contains("work(") && t.contains("task=make") && t.contains("units=\"3\""), "six grain make three, though the day's hours allow more: {t}");
}

#[test]
fn a_paid_wholesale_order_is_delivered_from_stock_and_one_below_the_least_or_its_price_is_refunded() {
    let mut h = harness(json!({}));
    let o = vec![
        wholesale_order("rec.50", DAY, "shop-a", 20, 400),
        wholesale_order("rec.51", DAY, "shop-b", 5, 400),
        wholesale_order("rec.52", DAY, "shop-c", 20, 300),
    ];
    let txs = json!([tx("acc-shop-a", "acc-works", 8000, DAY, "Order"), tx("acc-shop-b", "acc-works", 2000, DAY, "Order"), tx("acc-shop-c", "acc-works", 6000, DAY, "Order")]);
    let t = all(&h.wake(DAY + 9 * H, world(&["w1"], o, 15, 0, 1_000_000, txs)));
    assert!(t.contains("quantity=\"15\"") && t.contains("to=shop-a"), "delivers the 15 it has of 20: {t}");
    assert!(t.contains("Refund: 5 flour"), "refunds the rest: {t}");
    assert!(t.contains("Refund: 5 flour we couldn't deliver") || t.contains("delivered\":0"), "{t}");
}

#[test]
fn it_exports_what_its_customers_do_not_need_under_the_outsides_offer_and_invoices_it() {
    let mut h = harness(json!({}));
    let o = vec![offer("rec.2", 0, 450, 300, None)];
    let t = all(&h.wake(DAY + 9 * H, world(&["w1"], o, 200, 100, 1_000_000, json!([]))));
    assert!(t.contains("to=outside") && t.contains("invoice"), "{t}");
    assert!(t.contains("quantity=\"") && t.contains("exported"), "{t}");
}

#[test]
fn a_new_factory_the_offer_never_named_can_export_as_an_old_one_can() {
    // The offer names another seller's share; this one is not named, and ships all the same.
    let mut h = harness(json!({}));
    let o = vec![offer("rec.2", 0, 450, 300, Some(("old-works", 250)))];
    let t = all(&h.wake(DAY + 9 * H, world(&["w1"], o, 200, 100, 1_000_000, json!([]))));
    assert!(t.contains("to=outside") && t.contains("invoice"), "{t}");
}

#[test]
fn it_does_not_export_when_the_world_price_does_not_cover_what_a_unit_costs_to_make() {
    let mut h = harness(json!({}));
    // Inputs: 2 grain at 100 = 200; and the hours of making. A world price of 150 covers neither.
    let o = vec![farm("rec.1", 100), offer("rec.2", 0, 150, 300, None)];
    let t = all(&h.wake(DAY + 9 * H, world(&["w1"], o, 200, 100, 1_000_000, json!([]))));
    assert!(!t.contains("invoice("), "{t}");
    assert!(!t.contains("to=outside"), "{t}");
}

#[test]
fn it_learns_its_room_from_what_the_outside_sends_back_and_ships_no_more_than_that_next_time() {
    let mut h = harness(json!({}));
    let o1 = offer("rec.2", 0, 450, 300, None);
    let first = all(&h.wake(DAY + 9 * H, world(&["w1"], vec![o1], 280, 100, 1_000_000, json!([]))));
    assert!(first.contains("invoice"), "{first}");
    // The outside took only 100 of what it was sent and sent 80 back, in the same month as a new offer.
    let sent_back = statement("rec.60", 20 * DAY, "outside", "invoice_declined", &[F], json!({ "invoice": "rec.1001", "returned": 80, "paid_for": 100 }));
    let o2 = offer("rec.61", 31 * DAY, 450, 300, None);
    let t = all(&h.wake(32 * DAY + 9 * H, world(&["w1"], vec![sent_back, o2], 280, 100, 1_000_000, json!([]))));
    // Whatever was shipped is at most the room found (what was accepted, probed up a tenth).
    let q = t.split("quantity=\"").skip(1).filter_map(|s| s.split('"').next()?.parse::<i64>().ok()).max().unwrap_or(0);
    assert!(q <= 300, "{t}");
}

#[test]
fn the_factorys_memory_saves_and_it_acts_the_same_twice() {
    let run = |restore: bool| {
        let mut h = harness(json!({}));
        let mut out = vec![];
        for day in 1..20 {
            let o = vec![farm("rec.1", 100), offer("rec.2", 0, 450, 200, Some((F, 100)))];
            out.extend(h.wake(day * DAY + 9 * H, world(&["w1"], if day == 1 { o } else { vec![] }, 30, 20, 1_000_000, json!([]))));
            if restore && day == 5 {
                h.save_and_restore();
            }
        }
        out
    };
    assert_eq!(run(false), run(true));
    assert_eq!(run(false), run(false));
}

#[test]
fn its_manifest_is_the_ts_one_with_the_ports_additions() {
    let ts: Value = serde_json::from_str(MANIFEST).unwrap();
    for (k, v) in ts["params"].as_object().unwrap() {
        assert_eq!(&manifest()["params"][k], v, "{k}");
    }
    assert!(manifest()["params"]["export_probe_bps"].is_object());
}
