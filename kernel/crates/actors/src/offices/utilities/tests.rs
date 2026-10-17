//! utility.water and utility.energy, as participants/test held them and beyond: draws and restrictions, the bills of a
//! round and a successor that does not bill again, the energy customers' bills and the answer to a wrong one.

use super::*;
use crate::offices::police::tests::{ctx, st, Driver};

fn accounts(balance: i64) -> Seen {
    let a: oikos_sight::AccountItem = serde_json::from_value(json!({ "account": "acc-u", "holder": "police", "custodian": "bank", "currency": "AUD", "balance": balance.to_string() })).unwrap();
    Seen::Accounts { accounts: Arc::new(vec![a]), transactions: vec![] }
}

fn water_params() -> Value {
    json!({ "works": "works", "litres_per_person_per_day": 160, "price_per_kl": 300, "service_per_quarter": 9000, "meters": "meters" })
}
fn energy_params() -> Value {
    json!({ "depot": "depot", "grid": "grid", "units_per_customer_per_day": 10, "price_per_unit": 30, "supply_per_day": 110 })
}

fn estimate(people: i64) -> Arc<Record> {
    st("rec.1", 0, "population_estimate", "statistician", &[], json!({ "residents": people }))
}

fn roll() -> Vec<Arc<Record>> {
    vec![
        st("rec.2", 0, "property_roll", "valuer", &["police"], json!({ "lot": "lot-1", "owner": "owner-1", "buildings": [{ "structure": "home-1", "dwellings": 1 }, { "structure": "shed-1" }] })),
        st("rec.3", 0, "property_roll", "valuer", &["police"], json!({ "lot": "lot-2", "owner": "owner-2", "buildings": [{ "structure": "home-2", "dwellings": 2 }] })),
    ]
}

fn ts_manifest_holds(file: &str, rust: Value) {
    let ts: Value = serde_json::from_slice(&std::fs::read(format!("{}/../../../participants/manifests/{file}.json", env!("CARGO_MANIFEST_DIR"))).unwrap()).unwrap();
    for (k, v) in ts.as_object().unwrap() {
        if k == "params" {
            // (Each of the TS module's parameters is as it was; this port adds the response parameters of WM-12.)
            for (name, param) in v.as_object().unwrap() {
                assert_eq!(&rust["params"][name], param, "{file} param {name}");
            }
        } else {
            assert_eq!(&rust[k], v, "{file} {k}");
        }
    }
}

#[test]
fn the_manifests_are_the_ones_the_ts_modules_wrote() {
    ts_manifest_holds("utility.water", Water.manifest());
    ts_manifest_holds("utility.energy", Energy.manifest());
}

#[test]
fn the_works_draws_what_the_published_estimate_of_the_town_uses_and_publishes_its_tariff_once() {
    let mut s = Driver::new(&Water, ctx(water_params()));
    let w = s.wake(6 * 3600, vec![estimate(1000)], vec![], &|_| false);
    let draws = w.of("work");
    assert_eq!(draws.len(), 1, "{:?}", w.calls);
    assert!(draws[0].contains("160"), "1000 people at 160 litres is 160 kL: {}", draws[0]);
    assert_eq!(w.of("utility_tariff").len(), 1);
    // A successor that finds the tariff on file does not publish it again.
    let tariff = st("rec.9", 0, "utility_tariff", "police", &[], json!({ "service": "water", "price_per_unit": 300, "standing_charge": 9000 }));
    let mut next = Driver::new(&Water, ctx(water_params()));
    assert!(next.wake(DAY + 6 * 3600, vec![estimate(1000), tariff], vec![], &|_| false).of("utility_tariff").is_empty());
}

#[test]
fn a_river_that_cannot_give_it_brings_restrictions_and_they_are_lifted_when_it_can() {
    let mut s = Driver::new(&Water, ctx(water_params()));
    let w = s.wake(6 * 3600, vec![estimate(1000)], vec![], &|c| c.contains("work"));
    assert_eq!(w.of("water_restrictions").len(), 1, "{:?}", w.calls);
    // The next day it gives again: restrictions lifted (the notice is read from the file, so a successor knows too).
    let notice = st("rec.30", 6 * 3600, "water_restrictions", "police", &[], json!({ "since": 6 * 3600 }));
    let mut next = Driver::new(&Water, ctx(water_params()));
    let w = next.wake(DAY + 6 * 3600, vec![estimate(1000), notice], vec![], &|_| false);
    let lifted = w.of("water_restrictions");
    assert_eq!(lifted.len(), 1, "{:?}", w.calls);
    assert!(lifted[0].contains("lifted"));
}

#[test]
fn use_responds_to_a_restriction_and_to_the_price_where_the_profile_says_so() {
    let mut p = water_params();
    p["restriction_cut_bps"] = json!(2000);
    p["price_elasticity_bps"] = json!(4000);
    p["reference_price_per_kl"] = json!(200); // the price stands 50% over the reference: use falls 20%
    let mut s = Driver::new(&Water, ctx(p.clone()));
    let w = s.wake(6 * 3600, vec![estimate(1000)], vec![], &|_| false);
    assert!(w.of("work")[0].contains("128"), "160 kL less 20%: {}", w.of("work")[0]);
    // Under a restriction (a day that is not a review day) a further fifth less: 160 * 0.8 * 0.8 = 102.4, rounded up.
    let notice = st("rec.30", 0, "water_restrictions", "police", &[], json!({ "since": 0 }));
    let mut r = Driver::new(&Water, ctx(p));
    let w = r.wake(3 * DAY + 6 * 3600, vec![estimate(1000), notice], vec![], &|_| false);
    assert!(w.of("work")[0].contains("103"), "{}", w.of("work")[0]);
}

#[test]
fn a_round_of_bills_goes_to_each_homes_owner_once_and_a_successor_does_not_repeat_it() {
    let t = 92 * DAY + 6 * 3600;
    let mut unmetered = water_params();
    unmetered["meters"] = json!("");
    let mut s = Driver::new(&Water, ctx(unmetered.clone()));
    let w = s.wake(t, [roll(), vec![estimate(100)]].concat(), vec![("books", accounts(10_000_000))], &|_| false);
    let bills = w.of("invoice");
    assert_eq!(bills.len(), 2, "one for each home, none for the shed: {:?}", w.calls);
    assert!(bills[0].contains("owner-1") && bills[1].contains("owner-2"));
    // The bills on the file: a successor starts no new round, bills nobody again.
    let sent: Vec<Arc<Record>> = ["home-1", "home-2"].iter().enumerate().map(|(i, home)| st(&format!("rec.{}", 40 + i), t, "invoice", "police", &["owner"], json!({ "service": "water", "home": home, "round": 91 * DAY, "kl": 0 }))).collect();
    let mut next = Driver::new(&Water, ctx(unmetered));
    let w = next.wake(t + DAY, [roll(), sent].concat(), vec![("books", accounts(10_000_000))], &|_| false);
    assert!(w.of("invoice").is_empty(), "{:?}", w.calls);
}

#[test]
fn the_reader_goes_to_the_meters_and_the_readings_are_billed_and_kept_on_the_file() {
    let t0 = 71 * DAY + 6 * 3600; // the round begins 21 days before the 91st day
    let mut s = Driver::new(&Water, ctx(water_params()));
    let w = s.wake(t0, roll(), vec![], &|_| false);
    assert_eq!(w.looks.len(), 1, "{:?}", w.looks);
    assert!(w.looks[0].to_string().contains("home-1") && w.looks[0].to_string().contains("home-2") && !w.looks[0].to_string().contains("shed-1"));
    // Back: the meters as they read, entered in the meter book, and billed at the round.
    let cell = |n: u32, litres: i64| -> oikos_sight::SiteCell {
        serde_json::from_value(json!({ "cell": format!("c{n}"), "x": n, "y": 0, "structure": { "structure": format!("home-{n}"), "type": "house", "at": format!("c{n}"), "w": 1, "h": 1, "complete": true,
            "variables": { "water_used": { "value": litres, "as_of_day": 71, "per_day": 0, "min": 0, "max": 100_000_000 } }, "spaces": [] } })).unwrap()
    };
    let back = Seen::Sites { as_of: t0 + 3600, cells: Arc::new(vec![cell(1, 40_000), cell(2, 25_000)]), visit: Some(oikos_sight::Visit { seen_at: Default::default(), fresh: vec!["c1".into(), "c2".into()] }) };
    let w = s.wake(t0 + DAY, vec![], vec![("meters", back)], &|_| false);
    assert_eq!(w.of("meter_round").len(), 1, "{:?}", w.calls);
    let w = s.wake(92 * DAY + 6 * 3600, vec![], vec![("books", accounts(10_000_000))], &|_| false);
    let bills = w.of("invoice");
    assert_eq!(bills.len(), 2);
    // 40 kL at 3.00 and 9000 service: 9000 + 12000 = 21000 cents.
    assert!(bills.iter().any(|b| b.contains("home-1") && b.contains("21000") && b.contains("read_litres")), "{bills:?}");
}

fn customer(id: &str, who: &str, at: i64) -> Arc<Record> {
    st(id, at, "supply_request", who, &["police"], json!({ "account": format!("acc-{who}") }))
}

#[test]
fn customers_are_billed_for_their_days_and_a_customer_who_has_died_is_not() {
    let t = 30 * DAY + 6 * 3600;
    let mut s = Driver::new(&Energy, ctx(energy_params()));
    let w = s.wake(t, vec![customer("rec.5", "ann", 0), customer("rec.6", "bob", 0), st("rec.7", 10 * DAY, "death_registration", "city", &["police"], json!({ "deceased": "bob" }))], vec![("books", accounts(10_000_000))], &|_| false);
    let bills = w.of("Energy bill");
    assert_eq!(bills.len(), 1, "{:?}", w.calls);
    // 30 days: 30 * 110 supply + 300 units * 30.
    assert!(bills[0].contains("12300") && bills[0].contains("ann"), "{}", bills[0]);
    // With that bill on file a successor sends none until the next round.
    let sent = st("rec.50", t, "invoice", "police", &["ann"], json!({ "service": "energy", "days": 30, "units": 300, "until": t, "round": 30 * DAY, "outcome": { "money": { "to": "acc-u", "amount": "12300" } } }));
    let mut next = Driver::new(&Energy, ctx(energy_params()));
    let w = next.wake(t + DAY, vec![customer("rec.5", "ann", 0), sent], vec![("books", accounts(10_000_000))], &|_| false);
    assert!(w.of("Energy bill").is_empty(), "{:?}", w.calls);
}

#[test]
fn asked_to_put_a_wrong_bill_right_it_pays_what_it_overcharged_without_a_coin() {
    let t = 31 * DAY + 6 * 3600;
    let bill = st("rec.70", 30 * DAY, "invoice", "police", &["ann"], json!({ "service": "energy", "days": 30, "units": 330, "until": 30 * DAY, "outcome": { "money": { "to": "acc-u", "amount": "15000" } } }));
    let ask = st("rec.71", t - 3600, "review_request", "ann", &["police"], json!({ "matter": "bill", "about": "rec.70", "account": "acc-ann" }));
    let mut s = Driver::new(&Energy, ctx(energy_params()));
    let w = s.wake(t, vec![customer("rec.5", "ann", 0), bill, ask], vec![("books", accounts(10_000_000))], &|_| false);
    let answers = w.of("remedy_answer");
    assert_eq!(answers.len(), 1, "{:?}", w.calls);
    assert!(answers[0].contains("granted") || answers[0].contains("yes"), "{}", answers[0]);
    assert!(answers[0].contains("2700"), "15000 billed, 12300 right: {}", answers[0]);
}

#[test]
fn low_stock_is_bought_from_the_grid_once_and_not_again_while_it_is_on_order() {
    let t = 2 * DAY + 6 * 3600;
    let list = st("rec.20", 0, "price_list", "grid", &[], json!({ "goods": { "energy": 50 }, "account": "acc-grid" }));
    let records = vec![customer("rec.5", "ann", 0), list];
    let mut s = Driver::new(&Energy, ctx(energy_params()));
    let w = s.wake(t, records.clone(), vec![("books", accounts(100_000_000))], &|_| false);
    assert_eq!(w.of("Order:").len(), 1, "{:?}", w.calls);
    // The order on the file, undelivered: not ordered again.
    let order = st("rec.80", t, "order", "police", &["grid"], json!({ "kind": "energy", "quantity": 300 }));
    let mut next = Driver::new(&Energy, ctx(energy_params()));
    let w = next.wake(t + DAY, [records, vec![order]].concat(), vec![("books", accounts(100_000_000))], &|_| false);
    assert!(w.of("Order:").is_empty(), "{:?}", w.calls);
}

#[test]
fn the_price_factor_is_neutral_without_a_reference_and_falls_as_the_price_rises() {
    assert_eq!(price_factor_bps(300, 0, 4000), 10_000);
    assert_eq!(price_factor_bps(300, 200, 0), 10_000);
    assert_eq!(price_factor_bps(300, 200, 4000), 8_000);
    assert_eq!(price_factor_bps(100, 200, 4000), 12_000);
    assert_eq!(price_factor_bps(10_000, 100, 4000), 0);
}

#[test]
fn a_saved_works_steps_as_the_original() {
    let mut s = Driver::new(&Water, ctx(water_params()));
    s.wake(6 * 3600, [roll(), vec![estimate(100)]].concat(), vec![], &|_| false);
    let saved = s.actor.save().unwrap();
    let mut back = Driver::restore(&Water, ctx(water_params()), saved.clone());
    assert_eq!(back.actor.save().unwrap(), saved);
    let a = s.wake(DAY + 6 * 3600, vec![], vec![], &|_| false);
    let b = back.wake(DAY + 6 * 3600, vec![], vec![], &|_| false);
    assert_eq!(a.calls, b.calls);
}
