//! world.trade alone: the outside world's market, with factories' invoices and shops' orders scripted.

use super::*;
use crate::market::testkit::*;

const OUT: &str = "outside";

fn harness(extra: Value) -> Harness {
    let mut p = json!({ "account": "acc-outside", "sells": { "grain": 100 }, "buys": { "flour": { "unit_price": 450, "per_month": 300, "from": { "old-works": 250 } } }, "min_order": 10 });
    for (k, v) in extra.as_object().cloned().unwrap_or_default() {
        p[k] = v;
    }
    Harness::new(&WorldTrade, OUT, p)
}

fn world(extra: Vec<Value>, held: &[(&str, &str, i64)], txs: Value) -> Value {
    channels(vec![money(OUT, 0, txs), records("board", extra), holdings(held)])
}

fn all(p: &[String]) -> String {
    p.join("\n")
}

fn invoice(id: &str, at: i64, from: &str, q: i64, unit: i64) -> Value {
    statement(id, at, from, "invoice", &[OUT], json!({ "kind": "flour", "quantity": q, "from_at": format!("{from}-works"), "outcome": { "money": { "to": format!("acc-{from}"), "amount": (q * unit).to_string(), "for": "flour exported" } } }))
}

#[test]
fn it_publishes_its_world_prices_and_each_months_open_offer_to_any_seller() {
    let mut h = harness(json!({}));
    let t = all(&h.wake(3 * 3600, world(vec![], &[], json!([]))));
    assert!(t.contains("price_list") && t.contains("grain"), "{t}");
    assert!(t.contains("buying_offer") && t.contains("from any seller") && t.contains("quantity"), "{t}");
    assert!(t.contains("quantities"), "a named share is carried as a prior");
    let again = all(&h.wake(5 * DAY, world(vec![], &[], json!([]))));
    assert!(!again.contains("buying_offer"), "once a month");
    let next = all(&h.wake(31 * DAY, world(vec![], &[], json!([]))));
    assert!(next.contains("buying_offer") && next.contains("withdraw"), "{next}");
}

#[test]
fn a_factory_the_offer_never_named_is_paid_for_what_it_ships_up_to_the_months_appetite_and_the_rest_goes_back() {
    let mut h = harness(json!({}));
    h.wake(3 * 3600, world(vec![], &[], json!([])));
    // New works ships 200: all paid. Then another ships 150: only 100 of the 300 left is taken, 50 sent back.
    let inv1 = invoice("rec.10", 5 * DAY, "new", 200, 450);
    let t1 = all(&h.wake(6 * DAY, world(vec![inv1], &[("outside", "flour", 200)], json!([]))));
    assert!(t1.contains("200 flour bought") && t1.contains("settles=rec.10"), "{t1}");
    let inv2 = invoice("rec.11", 6 * DAY, "old", 150, 450);
    let t2 = all(&h.wake(7 * DAY, world(vec![inv2], &[("outside", "flour", 350)], json!([]))));
    assert!(t2.contains("100 flour bought"), "{t2}");
    assert!(t2.contains("quantity=\"50\"") && t2.contains("returned"), "50 beyond the month's appetite are sent back: {t2}");
}

#[test]
fn goods_that_have_not_come_are_not_paid_for_and_the_invoice_is_declined_after_the_wait() {
    let mut h = harness(json!({ "wait_days": 14 }));
    h.wake(3 * 3600, world(vec![], &[], json!([])));
    let inv = invoice("rec.10", 5 * DAY, "new", 100, 450);
    let t = all(&h.wake(6 * DAY, world(vec![inv], &[], json!([]))));
    assert!(!t.contains("bought"), "{t}");
    let t = all(&h.wake(25 * DAY, world(vec![], &[], json!([]))));
    assert!(t.contains("the goods haven't arrived"), "{t}");
}

#[test]
fn a_dearer_world_price_shrinks_the_appetite_where_the_world_gives_an_elasticity() {
    let buys = json!({ "flour": { "unit_price": 450, "per_month": 300, "demand_elasticity_bps": 10_000 } });
    // A +20% demand-side price shock: flat appetite scaled by 1 - 1 x 0.2 = 80%.
    let p = |shock: Value| harness(json!({ "buys": buys, "shocks": shock }));
    let appetite = |h: &mut Harness| {
        let t = all(&h.wake(3 * 3600, world(vec![], &[], json!([]))));
        let i = t.find("\"quantity\":").expect("a quantity") + 11;
        t[i..].chars().take_while(char::is_ascii_digit).collect::<String>().parse::<i64>().unwrap()
    };
    assert_eq!(appetite(&mut p(json!([]))), 300);
    assert_eq!(appetite(&mut p(json!([{ "from_day": 0, "kind": "flour", "what": "price", "factor_bps": 12_000 }]))), 240);
    assert_eq!(appetite(&mut p(json!([{ "from_day": 0, "kind": "flour", "what": "demand", "factor_bps": 5_000 }]))), 150);
    // Without an elasticity the appetite is flat, as it was.
    assert_eq!(appetite(&mut harness(json!({ "shocks": [{ "from_day": 0, "kind": "flour", "what": "price", "factor_bps": 12_000 }] }))), 300);
}

#[test]
fn a_paid_order_for_what_it_sells_is_delivered_and_one_below_the_world_price_is_refunded() {
    let mut h = harness(json!({}));
    let ord = |id: &str, q: i64, unit: i64, who: &str| statement(id, DAY, who, "order", &[OUT], json!({ "kind": "grain", "quantity": q, "unit_price": unit, "deliver_to": who, "at": "works-1", "account": format!("acc-{who}") }));
    let txs = json!([tx("acc-a", "acc-outside", 2000, DAY, "Order"), tx("acc-b", "acc-outside", 1800, DAY, "Order")]);
    let t = all(&h.wake(DAY + 3600, world(vec![ord("rec.5", 20, 100, "a"), ord("rec.6", 20, 90, "b")], &[], txs)));
    assert!(t.contains("quantity=\"20\"") && t.contains("to=a") && t.contains("from_at=outside"), "{t}");
    assert!(t.contains("Refund: 20 grain") && t.contains("to=b") || t.contains("below the world price") || t.contains("Delivered 0 of the 20"), "{t}");
}

#[test]
fn world_prices_move_by_a_draw_named_for_the_good_and_the_month_and_the_same_world_moves_the_same_way() {
    let run = || {
        let mut h = harness(json!({ "price_process": { "grain": { "sd_bps": 800, "persistence_bps": 9000 } } }));
        let mut out = vec![];
        for m in 0..8 {
            out.extend(h.wake(m * 30 * DAY + 3 * 3600, world(vec![], &[], json!([]))));
        }
        out
    };
    let a = run();
    assert_eq!(a, run());
    let lists = a.iter().filter(|p| p.contains("price_list")).count();
    assert!(lists >= 2, "the list is republished as prices move: {lists}");
}

#[test]
fn the_schedule_of_purchases_pays_on_the_researchers_days() {
    let mut h = Harness::new(&ExportDemand, OUT, json!({ "purchases": [{ "to": "acc-works", "amount": 5000, "every": 7 * 86_400 }] }));
    let mine = |bal: i64| json!({ "money": { "kind": "accounts", "accounts": [{ "account": "acc-outside", "holder": OUT, "custodian": OUT, "currency": "USD", "balance": bal.to_string() }], "transactions": [] } });
    assert!(h.wake(DAY, mine(1_000_000)).is_empty());
    assert_eq!(h.wake(8 * DAY, mine(1_000_000)).len(), 1);
    assert!(h.wake(9 * DAY, mine(1_000_000)).is_empty());
    h.save_and_restore();
}

#[test]
fn manifests_are_the_ts_ones() {
    for (kind, file) in [(&WorldTrade as &dyn Kind, TRADE_MANIFEST), (&ExportDemand, EXPORT_MANIFEST)] {
        let ts: Value = serde_json::from_str(file).unwrap();
        for (k, v) in ts["params"].as_object().unwrap() {
            assert_eq!(&kind.manifest()["params"][k], v, "{k}");
        }
    }
}
