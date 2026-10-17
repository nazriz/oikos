//! The firm body alone, under the two kinds that run over it (docs/port-guide.md section 4): a shop and a works with their
//! staff, bank, union and creditors scripted. What the stand-in body the market lane tests with never did: take staff on,
//! pay them, ask the bank, let someone go, answer a union, wind up.

use super::*;
use crate::market::producer::FirmProducer;
use crate::market::retailer::FirmRetailer;
use crate::market::testkit::*;

const SHOP: &str = "shop";
const H: i64 = 3600;

fn shop(extra: Value) -> Harness {
    let mut p = json!({
        "premises": "shop-1", "workplace": "shop-1-floor", "kind": "bread", "serve_labour": 1800, "price": 500, "demand": 20,
        "suppliers": ["mill"], "wage": 120_000, "period": 14 * DAY, "max_staff": 3, "min_staff": 1,
        "theta_bps": 10_000, "vartheta_bps": 400,
    });
    for (k, v) in extra.as_object().cloned().unwrap_or_default() {
        p[k] = v;
    }
    Harness::new(&FirmRetailer, SHOP, p)
}

fn premises(who: &str, space: &str, workers: &[&str]) -> Value {
    json!({ "town": { "kind": "sites", "as_of": 0, "cells": [{ "cell": "cell.1.1", "x": 1, "y": 1, "structure": {
        "structure": format!("{who}-1"), "type": "shop", "at": "cell.1.1", "w": 1, "h": 1, "complete": true,
        "spaces": [{ "space": space, "kind": "workplace", "capacity": 6, "count": workers.len(), "occupants": workers }] } }] } })
}

fn employment(firm: &str, id: &str, worker: &str) -> Vec<Value> {
    vec![
        json!({ "id": id, "record": "agreement", "author": format!("{firm}-system"), "at": 0, "visible_to": [firm, worker], "terms": { "template": "employment", "parties": [firm, worker],
            "commitments": [{ "who": firm, "does": { "outcome": { "money": { "to": format!("acc-{worker}"), "amount": "120000", "for": "Wages." } } }, "every": 14 * DAY },
                            { "who": worker, "does": { "outcome": { "work": { "at": "shop-1-floor" } } } }] } }),
        json!({ "id": format!("{id}-a"), "record": "signature", "author": format!("{firm}-system"), "at": 0, "visible_to": [firm, worker], "agreement": id, "as": firm }),
        json!({ "id": format!("{id}-b"), "record": "signature", "author": format!("{worker}-self"), "at": 0, "visible_to": [firm, worker], "agreement": id, "as": worker }),
    ]
}

fn town(workers: &[&str], extra: Vec<Value>, balance: i64) -> Value {
    let mut recs = vec![];
    for (i, w) in workers.iter().enumerate() {
        recs.extend(employment(SHOP, &format!("emp{i}"), w));
    }
    recs.extend(extra);
    channels(vec![money(SHOP, balance, json!([])), records("mine", recs), holdings(&[("shop-1", "bread", 10)]), premises("shop", "shop-1-floor", workers)])
}

fn all(p: &[String]) -> String {
    p.join("\n")
}

#[test]
fn a_shop_short_of_hands_advertises_a_job_and_sets_up_the_wages_of_those_it_has() {
    let mut h = shop(json!({ "min_staff": 2 }));
    let t = all(&h.wake(DAY + 9 * H, town(&["w1"], vec![], 1_000_000)));
    assert!(t.contains("job_posting") || t.contains("job_advertisement"), "one hand of the two it wants: it advertises: {t}");
    assert!(t.contains("Wages for w1"), "and the wage of the one it has is a standing order through its bank: {t}");
    // With the staff it wants, it advertises nothing.
    let mut full = shop(json!({ "min_staff": 1 }));
    let t = all(&full.wake(DAY + 9 * H, town(&["w1"], vec![], 1_000_000)));
    assert!(!t.contains("job_posting") && !t.contains("job_advertisement"), "{t}");
}

#[test]
fn short_of_the_next_pay_period_and_with_no_bank_to_ask_the_most_recent_hire_is_given_notice() {
    let mut h = shop(json!({ "min_staff": 2 }));
    let t = all(&h.wake(DAY + 9 * H, town(&["w1", "w2"], vec![], 100_000)));
    assert!(t.contains("notice=emp") && t.contains("we can't cover the wage bill"), "{t}");
    assert!(!t.contains("loan_application"), "no bank to ask: {t}");
}

#[test]
fn short_of_the_next_pay_period_with_a_bank_it_asks_for_working_capital_before_letting_anyone_go() {
    let mut h = shop(json!({ "min_staff": 2, "lender": "bank" }));
    let t = all(&h.wake(DAY + 9 * H, town(&["w1", "w2"], vec![], 100_000)));
    assert!(t.contains("loan_application") && t.contains("working capital"), "{t}");
    assert!(!t.contains("notice=emp"), "nobody is let go while it waits to hear: {t}");
}

#[test]
fn a_wage_claim_from_a_union_is_answered_with_an_offer_by_what_the_shop_can_pay() {
    let mut h = shop(json!({}));
    let claim = statement("rec.30", DAY, "union", "wage_claim", &[SHOP], json!({ "employer": SHOP, "rise_bps": 500 }));
    let t = all(&h.wake(DAY + 9 * H, town(&["w1"], vec![claim], 1_000_000)));
    assert!(t.contains("wage_offer") && t.contains("rise_bps"), "{t}");
}

#[test]
fn a_debt_recorded_against_it_that_it_cannot_pay_holds_back_the_dividend_and_in_time_winds_it_up() {
    let debt = json!({ "id": "rec.40", "record": "claim", "author": "mill-system", "speaks_for": "mill", "at": 0, "visible_to": "public", "position": "right", "holder": "mill", "counterparty": SHOP,
        "about": { "kind": "debt", "amount": 900_000_000i64, "account": "acc-mill", "for": "goods" } });
    let holders = statement("rec.1", 0, SHOP, "shareholders", &[], json!({ "holders": [{ "holder": "ann", "account": "acc-ann", "shares": 10_000 }] }));
    let run = |with_debt: bool, days: i64| {
        let mut h = shop(json!({}));
        let mut text = String::new();
        for day in 1..=days {
            let extra = if day == 1 { [vec![holders.clone()], if with_debt { vec![debt.clone()] } else { vec![] }].concat() } else { vec![] };
            text.push_str(&all(&h.wake(day * DAY + 9 * H, town(&["w1"], extra, 1_000_000 + day * 10_000))));
            text.push('\n');
        }
        text
    };
    // Without the debt, a month's end with money in hand pays the shareholders; with it, nothing goes out.
    assert!(run(false, 55).contains("dividend"), "the control: a dividend is paid");
    let text = run(true, 140);
    assert!(!text.contains("dividend"), "no dividend while a debt recorded against it stands unpaid: {text}");
    assert!(text.contains("insolvency") && text.contains("being wound up"), "unpaid for 60 days, more than it has, no credit: it winds up: {text}");
    assert!(text.contains("has been wound up and has closed") && text.contains("Winding up: paying debt rec.40"), "{text}");
}

#[test]
fn a_shops_memory_with_its_staff_and_character_saves_and_the_restored_shop_acts_as_the_original_would() {
    let mut a = shop(json!({ "initiative": true, "owner_values": { "power": 9000, "benevolence": 1000 }, "min_staff": 2 }));
    let mut b = shop(json!({ "initiative": true, "owner_values": { "power": 9000, "benevolence": 1000 }, "min_staff": 2 }));
    a.wake(DAY + 9 * H, town(&["w1"], vec![], 1_000_000));
    b.wake(DAY + 9 * H, town(&["w1"], vec![], 1_000_000));
    b.save_and_restore();
    let next = |h: &mut Harness| h.wake(2 * DAY + 9 * H, town(&["w1"], vec![], 900_000));
    assert_eq!(next(&mut a), next(&mut b));
}

#[test]
fn a_works_short_of_stock_at_the_months_end_takes_a_hand_on() {
    let mut h = Harness::new(
        &FirmProducer,
        "works",
        json!({ "works": "works-1", "workplace": "works-1-floor", "output": "flour", "per_unit": { "grain": 2 }, "labour_per_unit": 1800,
            "supplier": "farm", "market": "outside", "price": 400, "min_order": 10, "wage": 20_000, "theta_bps": 10_000, "work_days": 5 }),
    );
    let offer = statement("rec.2", 0, "outside", "buying_offer", &[], json!({ "kind": "flour", "unit_price": 450, "quantity": 200, "until": 90 * DAY, "account": "acc-outside", "quantities": { "works": 150 } }));
    let world = |extra: Vec<Value>| {
        channels(vec![
            money("works", 5_000_000, json!([])),
            records("mine", extra),
            holdings(&[("works-1", "flour", 0), ("works-1", "grain", 0)]),
            premises("works", "works-1-floor", &[]),
        ])
    };
    let mut text = String::new();
    for day in 1..=33 {
        text.push_str(&all(&h.wake(day * DAY + 9 * H, world(if day == 1 { vec![offer.clone()] } else { vec![] }))));
    }
    assert!(text.contains("job_posting") || text.contains("job_advertisement"), "stock below the band of the demand it expects: it takes a hand on: {text}");
}

#[test]
fn the_same_firm_in_the_same_town_acts_the_same_way_twice() {
    let run = || {
        let mut h = shop(json!({ "min_staff": 2, "lender": "bank" }));
        (1..60).flat_map(|day| h.wake(day * DAY + 9 * H, town(&["w1"], vec![], 150_000 + day * 1_000))).collect::<Vec<_>>()
    };
    assert_eq!(run(), run());
}
