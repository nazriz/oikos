//! utility.water and utility.energy (foundations-2 C4): the store kept full and restrictions, treatment of what the
//! sewer brings back, connections opened on request and closed at a household's going, bills from meters (the owner's
//! or the occupant's), the energy customers' bills from their meters and the answer to a wrong one, buying for what the
//! meters say is used, and a tripped feeder reclosed.

use super::*;
use crate::offices::police::tests::{ctx, st, Driver};

fn accounts(balance: i64) -> Seen {
    let a: oikos_sight::AccountItem = serde_json::from_value(json!({ "account": "acc-u", "holder": "police", "custodian": "bank", "currency": "XTS", "balance": balance.to_string() })).unwrap();
    Seen::Accounts { accounts: Arc::new(vec![a]), transactions: vec![] }
}

/// The office's holdings channel: what it holds, its network's connections and links.
fn stock(held: &[(&str, &str, i64)], conns: Vec<Value>, links: Vec<Value>) -> Seen {
    let holdings = held.iter().map(|(at, kind, q)| serde_json::from_value(json!({ "kind": kind, "at": at, "quantity": q.to_string() })).unwrap()).collect();
    Seen::Holdings {
        holdings: Arc::new(holdings),
        connections: Arc::new(conns.into_iter().map(|c| serde_json::from_value(c).unwrap()).collect()),
        links: Arc::new(links.into_iter().map(|l| serde_json::from_value(l).unwrap()).collect()),
    }
}

fn conn(id: &str, kind: &str, at: &str, holder: &str, meter: Option<i64>) -> Value {
    let mut c = json!({ "id": id, "kind": kind, "at": at, "node": format!("n-{at}"), "holder": holder, "rate": 100, "operated": true });
    if let Some(m) = meter {
        c["meter"] = json!(m.to_string());
    }
    c
}

fn link(id: &str, from: &str, to: &str, tripped: bool) -> Value {
    json!({ "id": id, "mode": "wire", "from": from, "to": to, "capacity": 10, "load": 0, "tripped": tripped })
}

fn water_params() -> Value {
    json!({ "works": "works", "storage": 100_000, "price_per_kl": 300, "service_per_quarter": 9000, "meters": "meters" })
}
fn energy_params() -> Value {
    json!({ "depot": "depot", "grid": "grid", "price_per_unit": 30, "supply_per_day": 110 })
}

fn roll() -> Vec<Arc<Record>> {
    vec![
        st("rec.2", 0, "property_roll", "valuer", &["police"], json!({ "lot": "lot-1", "owner": "owner-1", "buildings": [{ "structure": "home-1", "dwellings": 1 }, { "structure": "shed-1" }] })),
        st("rec.3", 0, "property_roll", "valuer", &["police"], json!({ "lot": "lot-2", "owner": "owner-2", "buildings": [{ "structure": "home-2", "dwellings": 2 }] })),
    ]
}

fn ts_manifest_holds(file: &str, rust: Value) {
    let ts: Value = crate::offices::testing::ts_manifest(&file);
    for (k, v) in ts.as_object().unwrap() {
        if k == "params" {
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
fn the_works_keeps_its_store_full_treats_what_the_sewer_brings_back_and_publishes_its_tariff_once() {
    let mut s = Driver::new(&Water, ctx(water_params()));
    let w = s.wake(6 * 3600, vec![], vec![("stock", stock(&[("works", "water", 40_000), ("works", "wastewater", 25_400)], vec![], vec![]))], &|_| false);
    let works = w.of("work");
    assert_eq!(works.len(), 2, "{:?}", w.calls);
    assert!(works.iter().any(|c| c.contains("draw_water") && c.contains("60")), "a store of 100,000 litres holding 40,000 is topped up by 60 kL: {works:?}");
    assert!(works.iter().any(|c| c.contains("treat_wastewater") && c.contains("25")), "{works:?}");
    assert_eq!(w.of("utility_tariff").len(), 1);
    let tariff = st("rec.9", 0, "utility_tariff", "police", &[], json!({ "service": "water", "price_per_unit": 300, "standing_charge": 9000 }));
    let mut next = Driver::new(&Water, ctx(water_params()));
    assert!(next.wake(DAY + 6 * 3600, vec![tariff], vec![], &|_| false).of("utility_tariff").is_empty());
}

#[test]
fn a_river_that_cannot_give_it_brings_restrictions_and_they_are_lifted_when_it_can() {
    let mut s = Driver::new(&Water, ctx(water_params()));
    let w = s.wake(6 * 3600, vec![], vec![], &|c| c.contains("work"));
    assert_eq!(w.of("water_restrictions").len(), 1, "{:?}", w.calls);
    let notice = st("rec.30", 6 * 3600, "water_restrictions", "police", &[], json!({ "since": 6 * 3600 }));
    let mut next = Driver::new(&Water, ctx(water_params()));
    let w = next.wake(DAY + 6 * 3600, vec![notice], vec![], &|_| false);
    let lifted = w.of("water_restrictions");
    assert_eq!(lifted.len(), 1, "{:?}", w.calls);
    assert!(lifted[0].contains("lifted"));
}

#[test]
fn a_household_that_asks_is_connected_on_its_homes_node_and_one_that_dies_is_disconnected() {
    let ask = st("rec.5", DAY, "supply_request", "ann", &["police"], json!({ "account": "acc-ann", "home": "home-1/dwelling.1", "kind": "water", "rate": 320 }));
    let links = vec![link("pipe-home-1", "n-d00", "n-home-1", false)];
    let mut s = Driver::new(&Water, ctx(water_params()));
    let w = s.wake(DAY + 6 * 3600, vec![ask.clone()], vec![("stock", stock(&[("works", "water", 100_000)], vec![], links.clone()))], &|_| false);
    let opens = w.of("connection");
    assert_eq!(opens.len(), 2, "water, and the sewer with it: {:?}", w.calls);
    assert!(opens.iter().any(|c| c.contains("water") && c.contains("n-home-1") && c.contains("320") && c.contains("use_water")), "{opens:?}");
    // Its connections on the network, and its death on the file: disconnected, once.
    let conns = vec![conn("conn.1", "water", "home-1", "ann", None), conn("conn.2", "wastewater", "home-1", "ann", None)];
    let died = st("rec.7", 10 * DAY, "death_registration", "city", &["police"], json!({ "deceased": "ann" }));
    let w = s.wake(11 * DAY, vec![died], vec![("stock", stock(&[("works", "water", 100_000)], conns, links))], &|_| false);
    let closes: Vec<&String> = w.of("connection").into_iter().filter(|c| c.contains("close")).collect();
    assert_eq!(closes.len(), 2, "{:?}", w.calls);
}

#[test]
fn the_reader_goes_to_the_meters_and_the_owner_is_billed_what_they_moved() {
    let t0 = 71 * DAY + 6 * 3600;
    let mut s = Driver::new(&Water, ctx(water_params()));
    let w = s.wake(t0, roll(), vec![], &|_| false);
    assert_eq!(w.looks.len(), 1, "{:?}", w.looks);
    assert!(w.looks[0].to_string().contains("home-1") && w.looks[0].to_string().contains("home-2") && !w.looks[0].to_string().contains("shed-1"));
    let cell = |n: u32, litres: i64| -> oikos_sight::SiteCell {
        serde_json::from_value(json!({ "cell": format!("c{n}"), "x": n, "y": 0, "structure": { "structure": format!("home-{n}"), "type": "house", "at": format!("c{n}"), "w": 1, "h": 1, "complete": true,
            "meters": [{ "connection": format!("conn.{n}"), "kind": "water", "reading": litres.to_string() }], "spaces": [{ "space": format!("home-{n}/dwelling.1"), "kind": "dwelling", "capacity": 4, "count": 2 }] } })).unwrap()
    };
    let back = Seen::Sites { as_of: t0 + 3600, cells: Arc::new(vec![cell(1, 40_000), cell(2, 25_000)]), visit: Some(oikos_sight::Visit { seen_at: Default::default(), fresh: vec!["c1".into(), "c2".into()] }) };
    let w = s.wake(t0 + DAY, vec![], vec![("meters", back)], &|_| false);
    assert_eq!(w.of("meter_round").len(), 1, "{:?}", w.calls);
    let w = s.wake(92 * DAY + 6 * 3600, vec![], vec![("books", accounts(10_000_000))], &|_| false);
    let bills = w.of("invoice");
    assert_eq!(bills.len(), 2);
    assert!(bills.iter().any(|b| b.contains("owner-1") && b.contains("21000") && b.contains("read_litres")), "{bills:?}");
    // A successor that finds the bills on file bills nobody again this round.
    let sent: Vec<Arc<Record>> = ["home-1", "home-2"].iter().enumerate().map(|(i, home)| st(&format!("rec.{}", 40 + i), 92 * DAY, "invoice", "police", &["owner"], json!({ "service": "water", "home": home, "round": 91 * DAY, "kl": 0 }))).collect();
    let mut next = Driver::new(&Water, ctx(water_params()));
    let w = next.wake(93 * DAY, [roll(), sent].concat(), vec![("books", accounts(10_000_000))], &|_| false);
    assert!(w.of("invoice").is_empty(), "{:?}", w.calls);
}

#[test]
fn where_the_occupant_pays_each_connection_is_billed_to_its_user() {
    let mut p = water_params();
    p["bill_to"] = json!("occupant");
    p["meters"] = json!("");
    let mut s = Driver::new(&Water, ctx(p));
    let conns = vec![conn("conn.1", "water", "home-2", "tenant-a", None), conn("conn.2", "water", "home-2", "tenant-b", None)];
    let w = s.wake(92 * DAY + 6 * 3600, roll(), vec![("books", accounts(10_000_000)), ("stock", stock(&[("works", "water", 100_000)], conns, vec![]))], &|_| false);
    let bills = w.of("invoice");
    assert_eq!(bills.len(), 2, "{:?}", w.calls);
    assert!(bills.iter().any(|b| b.contains("tenant-a")) && bills.iter().any(|b| b.contains("tenant-b")) && !bills.iter().any(|b| b.contains("owner-2")));
}

#[test]
fn each_energy_customer_is_billed_for_its_days_and_its_meter_and_a_closed_one_its_last_once() {
    let t = 30 * DAY + 6 * 3600;
    let conns = vec![conn("conn.1", "energy", "home-1", "ann", Some(300)), { let mut c = conn("conn.2", "energy", "home-2", "bob", Some(90)); c["closed"] = json!(true); c }];
    let mut s = Driver::new(&Energy, ctx(energy_params()));
    let w = s.wake(t, vec![], vec![("books", accounts(10_000_000)), ("stock", stock(&[("depot", "energy", 10_000)], conns.clone(), vec![]))], &|_| false);
    let bills = w.of("Energy bill");
    assert_eq!(bills.len(), 2, "{:?}", w.calls);
    // 30 days: 30 * 110 supply + 300 units * 30.
    assert!(bills.iter().any(|b| b.contains("12300") && b.contains("ann")), "{bills:?}");
    // The closed connection's last bill on file: never billed again.
    let last = st("rec.51", t, "invoice", "police", &["bob"], json!({ "service": "energy", "connection": "conn.2", "days": 30, "units": 90, "read_from": 0, "read_to": 90, "until": t }));
    let first = st("rec.50", t, "invoice", "police", &["ann"], json!({ "service": "energy", "connection": "conn.1", "days": 30, "units": 300, "read_from": 0, "read_to": 300, "until": t, "round": 30 * DAY }));
    let mut next = Driver::new(&Energy, ctx(energy_params()));
    let w = next.wake(t + DAY, vec![first, last], vec![("books", accounts(10_000_000)), ("stock", stock(&[("depot", "energy", 10_000)], conns, vec![]))], &|_| false);
    assert!(w.of("Energy bill").is_empty(), "{:?}", w.calls);
}

#[test]
fn asked_to_put_a_wrong_bill_right_it_pays_what_it_overcharged_by_its_own_meter_readings() {
    let t = 31 * DAY + 6 * 3600;
    let bill = st("rec.70", 30 * DAY, "invoice", "police", &["ann"], json!({ "service": "energy", "connection": "conn.1", "days": 30, "units": 330, "read_from": 0, "read_to": 300, "until": 30 * DAY, "estimated": true, "outcome": { "money": { "to": "acc-u", "amount": "13200" } } }));
    let ask = st("rec.71", t - 3600, "review_request", "ann", &["police"], json!({ "matter": "bill", "about": "rec.70", "account": "acc-ann" }));
    let mut s = Driver::new(&Energy, ctx(energy_params()));
    let w = s.wake(t, vec![bill, ask], vec![("books", accounts(10_000_000)), ("stock", stock(&[("depot", "energy", 10_000)], vec![conn("conn.1", "energy", "home-1", "ann", Some(300))], vec![]))], &|_| false);
    let answers = w.of("remedy_answer");
    assert_eq!(answers.len(), 1, "{:?}", w.calls);
    assert!(answers[0].contains("900"), "13200 billed, 12300 right: {}", answers[0]);
}

#[test]
fn low_stock_is_bought_for_what_the_meters_say_is_used_once_and_not_again_while_on_order() {
    let t = 2 * DAY + 6 * 3600;
    let list = st("rec.20", 0, "price_list", "grid", &[], json!({ "goods": { "energy": 50 }, "account": "acc-grid" }));
    let conns = vec![conn("conn.1", "energy", "home-1", "ann", Some(0))];
    let mut s = Driver::new(&Energy, ctx(energy_params()));
    let w = s.wake(t, vec![list.clone()], vec![("books", accounts(100_000_000)), ("stock", stock(&[("depot", "energy", 10)], conns.clone(), vec![]))], &|_| false);
    assert_eq!(w.of("Order:").len(), 1, "{:?}", w.calls);
    let order = st("rec.80", t, "order", "police", &["grid"], json!({ "kind": "energy", "quantity": 3000 }));
    let mut next = Driver::new(&Energy, ctx(energy_params()));
    let w = next.wake(t + DAY, vec![list, order], vec![("books", accounts(100_000_000)), ("stock", stock(&[("depot", "energy", 10)], conns, vec![]))], &|_| false);
    assert!(w.of("Order:").is_empty(), "{:?}", w.calls);
}

#[test]
fn a_tripped_feeder_is_reclosed_and_one_that_trips_again_has_the_feeders_under_it_put_on_a_rotation() {
    let links = vec![link("wire-main", "n-substation", "n-d00", true), link("wire-a", "n-d00", "n-a", false), link("wire-b", "n-d00", "n-b", false)];
    let mut s = Driver::new(&Energy, ctx(energy_params()));
    let w = s.wake(6 * 3600, vec![], vec![("stock", stock(&[("depot", "energy", 10_000)], vec![], links.clone()))], &|_| false);
    assert_eq!(w.of("reclose").len(), 1, "{:?}", w.calls);
    assert!(w.of("rotate").is_empty());
    let w = s.wake(DAY + 6 * 3600, vec![], vec![("stock", stock(&[("depot", "energy", 10_000)], vec![], links))], &|_| false);
    assert_eq!(w.of("rotate").len(), 2, "each feeder under it off an hour in turn: {:?}", w.calls);
}

#[test]
fn a_saved_works_steps_as_the_original() {
    let mut s = Driver::new(&Water, ctx(water_params()));
    s.wake(6 * 3600, roll(), vec![], &|_| false);
    let saved = s.actor.save().unwrap();
    let mut back = Driver::restore(&Water, ctx(water_params()), saved.clone());
    assert_eq!(back.actor.save().unwrap(), saved);
    let a = s.wake(DAY + 6 * 3600, vec![], vec![], &|_| false);
    let b = back.wake(DAY + 6 * 3600, vec![], vec![], &|_| false);
    assert_eq!(a.calls, b.calls);
}
