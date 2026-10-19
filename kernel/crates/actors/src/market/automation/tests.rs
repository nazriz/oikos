//! world.vendor with the Harness, and the buyer's library on its own (docs/port-guide.md section 4). The comparison's
//! cases assert behaviour, not TS's numbers.

use super::*;
use crate::market::testkit::{channels, ctx, money, records, statement, tx, Harness};
use serde_json::json;

const VENDOR: &str = "vendor";
const H: i64 = 3600;

fn offer_json(extra: Value) -> Value {
    let mut o = json!({
        "id": "sps", "title": "Self-service point", "for": "firms", "task": "serve", "template": "system-sps", "seconds": 300,
        "speed_bps": 10_000, "scope_bps": 3000, "setup": 2_325_000, "fee_per_year": 372_000, "exit": 465_000,
        "term_days": 1095, "notice_days": 90, "oversight_hours_per_month": 6,
    });
    for (k, v) in extra.as_object().cloned().unwrap_or_default() {
        o[k] = v;
    }
    o
}

fn params(extra: Value) -> Value {
    let mut p = json!({ "account": "acc-vendor", "offers": [offer_json(json!({}))] });
    for (k, v) in extra.as_object().cloned().unwrap_or_default() {
        p[k] = v;
    }
    p
}

fn harness(extra: Value) -> Harness {
    Harness::new(&Vendor, VENDOR, params(extra))
}

fn world(recs: Vec<Value>, txs: Value) -> Value {
    channels(vec![money(VENDOR, 0, txs), records("mine", recs)])
}

fn order(id: &str, at: i64, qty: i64, unit: i64) -> Value {
    statement(id, at, "shop", "order", &[VENDOR], json!({ "kind": "system:sps", "quantity": qty, "unit_price": unit, "deliver_to": "shop", "at": "shop-1", "account": "acc-shop" }))
}

fn all(p: &[String]) -> String {
    p.join("\n")
}

/// The licence the vendor offered for `order` (as the world would file it), signed by the buyer or not.
fn licence(id: &str, order: &str, signed: bool) -> Vec<Value> {
    let mut v = vec![
        json!({ "id": id, "record": "agreement", "author": "vendor-system", "at": 100, "visible_to": [VENDOR, "shop"], "basis": order, "terms": { "template": "licence", "parties": [VENDOR, "shop"], "commitments": [] } }),
        json!({ "id": format!("{id}-a"), "record": "signature", "author": "vendor-system", "at": 100, "visible_to": [VENDOR, "shop"], "agreement": id, "as": VENDOR }),
    ];
    if signed {
        v.push(json!({ "id": format!("{id}-b"), "record": "signature", "author": "shop-self", "at": 200, "visible_to": [VENDOR, "shop"], "agreement": id, "as": "shop" }));
    }
    v
}

// ---------------------------------------------------------------------------------------------- the comparison

fn task() -> Task {
    Task { units: 20_000, labour: 300, wage_month: 400_000, seconds_per_worker_month: 633_600, utilisation_bps: 8000, unit_price: 900, hiring_cost_weeks: 8 }
}

fn terms(scale: i64) -> Terms {
    Terms { fee_month: 31_000 * scale, setup: 2_325_000 * scale, exit: 465_000 * scale, seconds: 300, scope_bps: 3000, error_bps: 150, oversight_hours_per_month: 6, references: 0 }
}

#[test]
fn an_offer_that_frees_more_than_it_costs_clears_the_hurdle_and_a_dear_one_does_not() {
    let a = AdoptionParams::default();
    let cheap = appraise(&terms(1), 1, &task(), &a, 24, false);
    assert_eq!(cheap.units, 6000, "its scope is 30% of 20,000 units");
    assert!(cheap.saving > 0 && cheap.worth, "{cheap:?}");
    assert!(cheap.saving * 10_000 >= (cheap.running + cheap.amortised) * i128::from(10_000 + cheap.hurdle_bps) as i64);
    assert_eq!(cheap.net, cheap.saving - cheap.running - cheap.amortised);
    assert!(cheap.hands_milli > 0);
    let dear = appraise(&terms(40), 1, &task(), &a, 24, false);
    assert!(!dear.worth, "{dear:?}");
    assert!(best(&terms(40), &task(), &a, 24).is_none(), "no number of dear systems is worth it");
    assert_eq!(best(&terms(1), &task(), &a, 24).map(|x| x.worth), Some(true));
}

#[test]
fn the_best_number_is_the_one_that_saves_most_and_stops_when_more_would_do_no_more() {
    let a = AdoptionParams::default();
    // One system (cap 8000 * 30 days / 300 s = 6912 units) already does all of the 6000 units in scope.
    assert_eq!(best(&terms(1), &task(), &a, 24).map(|x| x.n), Some(1));
    // A slow system: 40,000 s a unit, a unit a day of its time; it takes several to do the share in scope.
    let slow = Terms { seconds: 4_000, fee_month: 1_000, setup: 1_000, exit: 1_000, ..terms(1) };
    let x = best(&slow, &task(), &a, 24).expect("worth it");
    assert!(x.n > 1 && x.units <= 6000, "{x:?}");
}

#[test]
fn a_dearer_offer_stalls_adoption_and_the_same_offer_at_half_the_price_takes_it() {
    let a = AdoptionParams::default();
    let worth = |scale: i64| best(&terms(scale), &task(), &a, 24).is_some();
    let s = (1..400).find(|s| !worth(*s)).expect("some price is too dear");
    assert!(s >= 3, "the cheap offer is worth it by some margin: {s}");
    let p = 2 * (s - 1);
    assert!(!worth(p) && worth(p / 2), "at {p} times the list nobody takes it; at half it is taken");
    assert!(appraise(&terms(1), 1, &task(), &a, 36, false).amortised < appraise(&terms(1), 1, &task(), &a, 12, false).amortised, "a longer horizon spreads the set-up thinner");
}

#[test]
fn a_system_that_gets_half_its_units_wrong_or_does_a_sixtieth_of_the_task_is_not_worth_taking_at_the_list_price() {
    // (Ported from participants/test/automation.test.ts: "the same system at twice the price, or a worse one, is not worth it".)
    let a = AdoptionParams::default();
    // (The figures are this fixture's: a list-price system is worth it; one that gets half its units wrong, or does a sixtieth of the
    // task, is not.)
    assert!(best(&terms(1), &task(), &a, 24).is_some(), "the list-price system is worth it");
    assert!(best(&Terms { error_bps: 5_000, ..terms(1) }, &task(), &a, 24).is_none(), "it gets half its units wrong");
    assert!(best(&Terms { scope_bps: 50, ..terms(1) }, &task(), &a, 24).is_none(), "it can do a sixtieth of the task");
}

#[test]
fn each_known_client_eases_the_hurdle_never_below_nothing() {
    let a = AdoptionParams::default();
    let h = |refs: i64| appraise(&Terms { references: refs, ..terms(1) }, 1, &task(), &a, 24, false).hurdle_bps;
    assert_eq!((h(0), h(5), h(10), h(50)), (2000, 1000, 0, 0));
}

#[test]
fn a_standing_system_weighs_its_running_cost_and_its_exit_but_not_its_set_up() {
    let a = AdoptionParams::default();
    let x = appraise(&terms(1), 1, &task(), &a, 24, true);
    let y = appraise(&terms(1), 1, &task(), &a, 24, false);
    assert!(x.amortised < y.amortised);
    assert_eq!(x.amortised, 465_000 / 24 + i64::from(465_000 % 24 >= 12));
    assert_eq!(capacity_of(300, 8000), 30 * 86_400 * 8000 / 10_000 / 300);
    assert_eq!(capacity_of(0, 8000), 0);
}

fn lot(fee: i64, exit: i64) -> Lot {
    Lot {
        delivery: "rec.d".into(), order: "rec.o".into(), offer: "sps".into(), vendor: VENDOR.into(), account: "acc-vendor".into(), task: Some("serve".into()), kinds: vec![],
        title: "Self-service point".into(), systems: vec!["sys.1".into()], seconds: 300, scope_bps: 3000, error_bps: 150, fee_month: fee, exit, term_days: 1095, notice_days: 90,
        oversight_hours_per_month: 6, setup: 2_325_000, since: 0, agreement: Some("agr.1".into()), ending: false, ended: false,
    }
}

#[test]
fn a_licence_is_dropped_at_its_term_only_when_it_costs_more_than_leaving_and_hiring_again() {
    let a = AdoptionParams::default();
    assert!(!dropping(&lot(31_000, 465_000), &task(), &a, 24).drop, "it saves more than it costs: keep it");
    assert!(dropping(&lot(3_000_000, 465_000), &task(), &a, 24).drop, "a fee that eats the saving is worth leaving");
    let d = dropping(&lot(3_000_000, 465_000), &task(), &a, 24);
    assert!(d.leaving >= 465_000 && d.running > d.saving);
}

// ---------------------------------------------------------------------------------------------- the buyer's side

#[derive(Debug, Clone, PartialEq)]
struct Tok(AdoptionThen);
impl From<AdoptionThen> for Tok {
    fn from(t: AdoptionThen) -> Tok {
        Tok(t)
    }
}

fn offer_record(id: &str, o: Value) -> Value {
    let mut d = o;
    d["vendor"] = json!(VENDOR);
    d["account"] = json!("acc-vendor");
    d["fee_month"] = json!(31_000);
    d["error_bps"] = json!(150);
    d["references"] = json!(0);
    statement(id, 10, VENDOR, "system_offer", &[], d)
}

fn review_for() -> Review {
    Review { at: Some("shop-1".into()), task: "serve".into(), facts: task(), staff: 3, account: "acc-shop".into(), balance: 50_000_000, keep: 1_000_000 }
}

fn buyer_cx() -> (crate::Ctx, crate::Draws) {
    let c = ctx("shop", json!({}));
    let d = crate::Draws::new(&c.participant, "self");
    (c, d)
}

#[test]
fn a_firm_orders_the_system_that_pays_and_a_law_against_the_use_stops_it() {
    let offer = offer_record("rec.offer", offer_json(json!({})));
    let mut book = crate::market::testkit::book_of(vec![offer.clone()]);
    let (c, mut d) = buyer_cx();
    let mut cx = crate::market::testkit::cx_for(&c, &mut d, 40 * DAY);
    let mut fleet = Fleet::new("shop");
    let mut ad = Adoption::new("shop", AdoptionParams::default());
    let steps: Vec<Step<Tok>> = ad.review(&mut fleet, &mut book, 40 * DAY, &review_for(), &mut cx);
    assert_eq!(steps.len(), 1);
    let t = oikos_sight::calls::program_text(&steps[0].program());
    assert!(t.contains("kind=\"system:sps\"") || t.contains("system:sps"), "{t}");
    assert!(t.contains("quantity") && t.contains("2325000") || t.contains("$23,250.00"), "{t}");
    assert_eq!(steps[0].then, Some(Tok(AdoptionThen::Ordered { offer: "sps".into() })));
    // With an order out it does not order another.
    let again: Vec<Step<Tok>> = ad.review(&mut fleet, &mut book, 41 * DAY, &review_for(), &mut cx);
    assert!(again.is_empty());
    // If the order was refused, it may try again.
    ad.then(&AdoptionThen::Ordered { offer: "sps".into() }, crate::steps::Done::NotDone("lapsed"));
    assert_eq!(ad.review::<Tok>(&mut fleet, &mut book, 42 * DAY, &review_for(), &mut cx).len(), 1);

    // A law in force against deploying this task's systems: it keeps the law (compliance 100%).
    let law = statement("rec.law", 0, "city", "law", &[], json!({}));
    let mut law = law;
    law["adico"] = json!({ "deontic": "must_not" });
    law["formal"] = json!({ "language": "cel", "condition": "block.block == 'deploy' && block.task == 'serve'" });
    let mut book = crate::market::testkit::book_of(vec![offer.clone(), law.clone()]);
    let mut ad = Adoption::new("shop", AdoptionParams::default());
    assert!(ad.review::<Tok>(&mut fleet, &mut book, 40 * DAY, &review_for(), &mut cx).is_empty(), "the law stops adoption");
    // A firm that never keeps it takes the system all the same.
    let mut ad = Adoption::new("shop", AdoptionParams { compliance_bps: 0, ..AdoptionParams::default() });
    assert_eq!(ad.review::<Tok>(&mut fleet, &mut book, 40 * DAY, &review_for(), &mut cx).len(), 1);
}

#[test]
fn a_firm_that_cannot_pay_for_the_set_up_and_a_months_fee_does_not_order() {
    let mut book = crate::market::testkit::book_of(vec![offer_record("rec.offer", offer_json(json!({})))]);
    let (c, mut d) = buyer_cx();
    let mut cx = crate::market::testkit::cx_for(&c, &mut d, 40 * DAY);
    let mut ad = Adoption::new("shop", AdoptionParams::default());
    let poor = Review { balance: 2_000_000, ..review_for() };
    assert!(ad.review::<Tok>(&mut Fleet::new("shop"), &mut book, 40 * DAY, &poor, &mut cx).is_empty());
    let dear = offer_record("rec.offer", offer_json(json!({ "setup": 90_000_000, "fee_per_year": 12_000_000, "exit": 20_000_000 })));
    let mut book = crate::market::testkit::book_of(vec![dear]);
    assert!(ad.review::<Tok>(&mut Fleet::new("shop"), &mut book, 40 * DAY, &review_for(), &mut cx).is_empty(), "dear offers stall adoption");
}

#[test]
fn the_fleet_reads_a_delivery_signs_the_licence_and_counts_what_its_systems_do() {
    let delivery = statement("rec.d", 300, VENDOR, "system_delivery", &["shop"], json!({
        "order": "rec.o", "offer": "sps", "vendor": VENDOR, "account": "acc-vendor", "for": "firms", "task": "serve", "template": "system-sps", "title": "Self-service point",
        "seconds": 300, "speed_bps": 10_000, "scope_bps": 3000, "error_bps": 150, "systems": ["sys.1", "sys.2"], "fee_month": 31_000, "exit": 465_000,
        "term_days": 1095, "notice_days": 90, "oversight_hours_per_month": 6, "setup": 2_325_000 }));
    let mut recs = vec![delivery];
    recs.extend(licence("agr.1", "rec.o", false));
    let book = crate::market::testkit::book_of(recs);
    let mut fleet = Fleet::new("shop");
    fleet.absorb(&book);
    assert_eq!(fleet.in_service(Some("serve")).len(), 1);
    assert_eq!(fleet.working("serve").len(), 2);
    assert_eq!(fleet.fees("serve"), 62_000);
    assert_eq!(fleet.capacity("serve", 8000), 2 * capacity_of(300, 8000));
    assert_eq!(fleet.units_of("serve", 1000, 8000), 300, "the share in scope");
    assert_eq!(fleet.units_of("serve", 1_000_000, 8000), 2 * capacity_of(300, 8000), "as far as their month goes");
    let (c, mut d) = buyer_cx();
    let cx = crate::market::testkit::cx_for(&c, &mut d, 400);
    let steps: Vec<Step<()>> = fleet.paperwork(&book, "acc-shop", &cx);
    let t = oikos_sight::calls::program_text(&steps[0].program());
    assert!(t.contains("sign=agr.1") && t.contains("every") && t.contains("Licence agr.1"), "{t}");
    assert!(fleet.paperwork::<()>(&book, "acc-shop", &cx).is_empty(), "signed once");
    fleet.gone("sys.1");
    assert_eq!(fleet.working("serve").len(), 1, "a system the world refused is not counted again");
    fleet.gone("sys.2");
    assert!(fleet.in_service(Some("serve")).is_empty());
    let (restored, saved) = (serde_json::from_value::<Fleet>(serde_json::to_value(&fleet).unwrap()).unwrap(), fleet.clone());
    assert_eq!(restored, saved);
}

// ---------------------------------------------------------------------------------------------- the vendor

#[test]
fn the_vendor_publishes_what_it_sells_once_while_prices_and_clients_stand() {
    let mut h = harness(json!({}));
    let out = all(&h.wake(H, world(vec![], json!([]))));
    assert!(out.contains("system_offer") && out.contains("Self-service point") && out.contains("visible=public"), "{out}");
    assert!(out.contains("Order system:sps, paid with the order"), "{out}");
    assert!(out.contains("2325000") || out.contains("23,250.00"), "{out}");
    let again = all(&h.wake(DAY + H, world(vec![], json!([]))));
    assert!(!again.contains("system_offer"), "published once while nothing moves: {again}");
}

#[test]
fn a_falling_price_scenario_republishes_at_the_lower_price_and_never_below_one_cent() {
    let mut h = harness(json!({ "change_bps_per_year": -5000 }));
    let first = all(&h.wake(H, world(vec![], json!([]))));
    assert!(first.contains("23,250.00"), "{first}");
    let later = all(&h.wake(12 * MONTH + H, world(vec![], json!([]))));
    assert!(later.contains("withdraw=") || later.contains("Superseded"), "the old offer comes down: {later}");
    assert!(later.contains("11,625.00") || later.contains("11,624.99") || later.contains("11,625.01"), "half a year's... a year on, half the price: {later}");
    let (hi, lo) = (monthly_ratio(-5000), monthly_ratio(0));
    assert!(hi < S && lo == S, "{hi} {lo}");
    let pow12 = (0..12).fold(S, |v, _| v * hi / S);
    assert!(pow12 <= S / 2 && pow12 > S / 2 - S / 1_000_000, "twelve monthly steps are one year's: {pow12}");
}

#[test]
fn a_paid_order_is_delivered_then_the_delivery_is_published_and_the_licence_offered() {
    let mut h = harness(json!({}));
    h.wake(H, world(vec![], json!([])));
    let txs = json!([tx("acc-shop", "acc-vendor", 2 * 2_325_000, DAY, "Order: 2 system:sps.")]);
    let out = all(&h.wake(DAY + H, world(vec![order("rec.50", DAY, 2, 2_325_000)], txs)));
    assert!(out.contains("system(") && out.contains("template=system-sps") && out.contains("to=shop"), "{out}");
    assert!(out.matches("system(").count() >= 2, "one call for each system: {out}");
    assert!(out.contains("system_delivery") && out.contains("Delivered to shop: 2 of Self-service point"), "{out}");
    assert!(out.contains("agreement(") && out.contains("template=licence") && out.contains("then=periodic"), "the licence is offered: {out}");
    assert!(out.contains("basis=rec.50"), "{out}");
    assert!(out.contains("Licence of Self-service point."), "the fee is the client's to pay each month: {out}");
    // The next publication names the new client.
    let later = all(&h.wake(2 * DAY + H, world(vec![], json!([]))));
    assert!(later.contains("1 client."), "references count its clients: {later}");
}

#[test]
fn an_order_it_cannot_fill_at_the_price_asked_is_refunded() {
    let mut h = harness(json!({}));
    let txs = json!([tx("acc-shop", "acc-vendor", 1_000_000, DAY, "Order: 1 system:sps.")]);
    let out = all(&h.wake(DAY + H, world(vec![order("rec.50", DAY, 1, 1_000_000)], txs)));
    assert!(out.contains("Refund: system:sps is not on offer at"), "{out}");
    assert!(!out.contains("system("), "{out}");
}

#[test]
fn an_unpaid_order_is_declined_after_a_week_and_unclaimed_money_goes_back() {
    let mut h = harness(json!({}));
    let out = all(&h.wake(9 * DAY, world(vec![order("rec.50", DAY, 1, 2_325_000)], json!([]))));
    assert!(out.contains("declined: not paid"), "{out}");
    let mut h = harness(json!({}));
    h.wake(H, world(vec![order("rec.50", 0, 1, 2_325_000)], json!([tx("acc-shop", "acc-vendor", 2_325_000, 0, "Order: 1 system:sps.")])));
    let out = all(&h.wake(DAY, world(vec![], json!([tx("acc-shop", "acc-vendor", 500, DAY, "oops")]))));
    assert!(out.contains("Refund: no order of yours is waiting."), "{out}");
}

fn delivered(h: &mut Harness) {
    let txs = json!([tx("acc-shop", "acc-vendor", 2_325_000, DAY, "Order: 1 system:sps.")]);
    let out = all(&h.wake(DAY + H, world(vec![order("rec.50", DAY, 1, 2_325_000)], txs)));
    assert!(out.contains("system_delivery"), "{out}");
}

#[test]
fn a_system_whose_licence_is_not_signed_in_thirty_days_is_switched_off() {
    let mut h = harness(json!({}));
    delivered(&mut h);
    let early = all(&h.wake(20 * DAY, world(licence("agr.1", "rec.50", false), json!([]))));
    assert!(!early.contains("retire"), "{early}");
    let out = all(&h.wake(DAY + 31 * DAY, world(licence("agr.1", "rec.50", false), json!([]))));
    assert!(out.contains("retire=") && out.contains("system_ended") && out.contains("has not signed the licence in 30 days"), "{out}");
    let after = all(&h.wake(DAY + 32 * DAY, world(licence("agr.1", "rec.50", false), json!([]))));
    assert!(!after.contains("retire"), "switched off once: {after}");
}

#[test]
fn a_licence_unpaid_past_the_grace_switches_the_system_off_and_a_paid_one_keeps_it() {
    let mut h = harness(json!({}));
    delivered(&mut h);
    h.wake(10 * DAY, world(licence("agr.1", "rec.50", true), json!([]))); // (the licence is found on file)
    let paid = json!([tx("acc-shop", "acc-vendor", 31_000, 40 * DAY, "Licence agr.1.")]);
    let ok = all(&h.wake(40 * DAY + H, world(licence("agr.1", "rec.50", true), paid)));
    assert!(!ok.contains("retire"), "{ok}");
    let ok = all(&h.wake(100 * DAY, world(licence("agr.1", "rec.50", true), json!([]))));
    assert!(!ok.contains("retire"), "60 days after the last fee is within the grace: {ok}");
    let out = all(&h.wake(40 * DAY + 80 * DAY, world(licence("agr.1", "rec.50", true), json!([]))));
    assert!(out.contains("retire=") && out.contains("has not been paid for 79 days"), "{out}");
}

#[test]
fn it_bids_for_a_tender_that_asks_for_what_an_office_offer_does_and_for_none_other() {
    let office = offer_json(json!({ "id": "case", "title": "Case-handling system", "for": "offices", "kinds": ["rates_notice", "permit_decision"], "task": null }));
    let mut h = Harness::new(&Vendor, VENDOR, params(json!({ "offers": [offer_json(json!({})), office] })));
    let tender = statement("rec.t", 10, "rates", "tender", &[], json!({ "what": "write rates notices", "kinds": ["rates_notice"], "volume": 400, "closes": 40 * DAY, "term_days": 1095 }));
    let out = all(&h.wake(DAY, world(vec![tender], json!([]))));
    assert!(out.contains("kind=bid") && out.contains("Bid to rates for tender rec.t: Case-handling system"), "{out}");
    assert!(!out.contains("Bid to rates for tender rec.t: Self-service"), "{out}");
    let other = statement("rec.t2", 10, "rates", "tender", &[], json!({ "what": "x", "kinds": ["tax_return"], "volume": 4, "closes": 40 * DAY, "term_days": 10 }));
    assert!(!all(&h.wake(2 * DAY, world(vec![other], json!([])))).contains("kind=bid"));
    let closed = statement("rec.t3", 10, "rates", "tender", &[], json!({ "what": "x", "kinds": ["rates_notice"], "volume": 4, "closes": DAY, "term_days": 10 }));
    assert!(!all(&h.wake(3 * DAY, world(vec![closed], json!([])))).contains("kind=bid"), "a closed tender is not bid for");
}

#[test]
fn the_vendor_saves_and_restores_mid_licence_and_the_world_must_name_its_account() {
    let mut h = harness(json!({}));
    delivered(&mut h);
    h.save_and_restore();
    let out = all(&h.wake(DAY + 31 * DAY, world(licence("agr.1", "rec.50", false), json!([]))));
    assert!(out.contains("retire="), "the restored vendor remembers its licence: {out}");
    let mut p = params(json!({}));
    p["account"] = json!("");
    assert!(Vendor.create(&ctx(VENDOR, p)).is_err());
    let m = Vendor.manifest();
    assert_eq!(m["name"], "world.vendor");
    assert!(m["boundary"][0]["why"].as_str().is_some_and(|w| w.contains("outside world")));
}

#[test]
fn papers_and_numbers_read_as_the_ts_wrote_them() {
    // A published offer whose seconds were fractional in TS reads as whole seconds.
    let o: Offer = serde_json::from_value(offer_json(json!({ "seconds": 2.5, "oversight_hours_per_month": 5.5, "vendor": VENDOR, "fee_month": 1 }))).unwrap();
    assert_eq!((o.base.seconds, o.base.oversight_hours_per_month), (3, 6));
    // The offer is the paper type SystemOffer, and a bid is a Bid.
    let x = Offer { base: serde_json::from_value(offer_json(json!({}))).unwrap(), error_bps: 150, vendor: VENDOR.into(), account: "acc".into(), fee_month: 31_000, references: 0, record: String::new(), at: 0 };
    let v = serde_json::to_value(&x).unwrap();
    assert!(serde_json::from_value::<crate::papers::market::SystemOffer>(v.clone()).is_ok());
    let mut bid = v;
    bid["tender"] = json!("rec.t");
    assert!(serde_json::from_value::<crate::papers::market::Bid>(bid).is_ok());
    assert_eq!(pct(1500), "15");
    assert_eq!(pct(1250), "12.5");
    assert_eq!(tenths(1450), "1.5");
}

#[test]
fn the_vendor_is_registered_in_name_order_among_the_markets_kinds() {
    let names: Vec<&str> = crate::market::KINDS.iter().map(|k| k.name()).collect();
    assert!(names.contains(&"world.vendor"), "{names:?}");
    let _ = crate::Ctx::clone(&ctx(VENDOR, params(json!({}))));
}
