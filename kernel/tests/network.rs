//! What flows (foundations-2 C3 and C3b, law 8; docs/nothing-from-nothing.md): connections settled at their kind's
//! period on each supply's tree, with no allocation rule. Who goes short follows from the network's physics, the
//! supply contracts in force and the operators' own acts:
//!
//! - water: the far end of a full main, and a node whose head is low, gets less, and nothing below the least head; a
//!   store run low lowers the head for everyone, the far end first;
//! - power: a link asked for more than its rating trips, and everything beyond it goes dark until its operator recloses
//!   it; a supply asked for more than it holds trips its own links;
//! - a drain carries what each connection lets out to its holder;
//! - a meter is what was delivered; every kind is conserved over holdings and what uses make of it;
//! - only its operator opens, closes, interrupts, restores and reroutes; its user sets its own rate; a rotation is a
//!   standing schedule, declared once.

mod common;

use common::*;
use oikos_kernel::events::EventBody;
use oikos_kernel::kernel::Command;
use oikos_kernel::run::Run;
use serde_json::{json, Value};

const DAY: i64 = 86_400;

/// The test world with a network: a water main, a feeder and a sewer from the shop (the city's works, substation and
/// treatment plant in one) out past the flats to the house at the far end (n0, n1, n2, n3).
fn world_with_network() -> Value {
    let mut c = world(&default_params());
    let cat = c["catalogue"].as_object_mut().unwrap();
    let res = cat.get_mut("resources").unwrap().as_array_mut().unwrap();
    res.push(json!({"id": "water", "unit": "L", "settle": "day"}));
    res.push(json!({"id": "wastewater", "unit": "L", "settle": "day"}));
    res.push(json!({"id": "energy", "unit": "kWh", "class": "dissipates", "settle": "hour"}));
    let tasks = cat.get_mut("tasks").unwrap().as_array_mut().unwrap();
    tasks.push(json!({"id": "use_water", "labour": 0, "consumes": {"water": "1"}, "produces": {"wastewater": "1"}}));
    tasks.push(json!({"id": "use_energy", "labour": 0, "consumes": {"energy": "1"}}));
    // (The pipes and sewers run in a line, n0 to n3; the wires are a main to n1 and a feeder from it to each home, the
    // flats' at n2 and the house's at n3, which is rated for one kWh an hour.)
    let mut links = vec![];
    for (mode, cap, loss, pairs) in [("pipe", 100, 30, [("n0", "n1"), ("n1", "n2"), ("n2", "n3")]), ("wire", 10, 0, [("n0", "n1"), ("n1", "n2"), ("n1", "n3")]), ("sewer", 1000, 0, [("n0", "n1"), ("n1", "n2"), ("n2", "n3")])] {
        for (i, (a, b)) in pairs.iter().enumerate() {
            links.push(json!({"id": format!("{mode}-{}", i + 1), "from": a, "to": b, "mode": mode, "capacity": cap, "loss_m": loss}));
        }
    }
    links[5]["capacity"] = json!(1);
    c["world"]["network"] = json!({
        "nodes": [{"id": "n0", "cell": "cell.0.2"}, {"id": "n1", "cell": "cell.0.0"}, {"id": "n2", "cell": "cell.1.0"}, {"id": "n3", "cell": "cell.1.1"}],
        "links": links,
        "supplies": [
            {"id": "works", "kind": "water", "mode": "pipe", "node": "n0", "holder": "city", "at": "s-shop", "physics": "pressure", "head_m": 40, "storage": "100000", "service_head_m": 20, "min_head_m": 5},
            {"id": "substation", "kind": "energy", "mode": "wire", "node": "n0", "holder": "city", "at": "s-shop", "physics": "rating"},
            {"id": "treatment", "kind": "wastewater", "mode": "sewer", "node": "n0", "holder": "city", "at": "s-shop", "physics": "drain"}
        ]
    });
    c["world"]["connections"] = json!([
        {"id": "w-flats", "kind": "water", "node": "n1", "holder": "bob", "at": "s-flats", "rate": 1000, "uses": "use_water"},
        {"id": "w-house", "kind": "water", "node": "n3", "holder": "alice", "at": "s-house", "rate": 1000, "uses": "use_water"},
        {"id": "e-flats", "kind": "energy", "node": "n2", "holder": "bob", "at": "s-flats", "rate": 48, "uses": "use_energy", "meter": "remote"},
        {"id": "e-house", "kind": "energy", "node": "n3", "holder": "alice", "at": "s-house", "rate": 48, "uses": "use_energy", "meter": "remote"},
        {"id": "s-flats", "kind": "wastewater", "node": "n1", "holder": "bob", "at": "s-flats", "rate": 100000},
        {"id": "s-house", "kind": "wastewater", "node": "n3", "holder": "alice", "at": "s-house", "rate": 100000}
    ]);
    let h = c["world"]["holdings"].as_array_mut().unwrap();
    h.push(json!({"kind": "water", "holder": "city", "at": "s-shop", "quantity": "100000"}));
    h.push(json!({"kind": "energy", "holder": "city", "at": "s-shop", "quantity": "100000"}));
    c
}

fn conn<'a, W: std::io::Write>(run: &'a Run<W>, id: &str) -> &'a oikos_kernel::network::Connection {
    let ns = run.kernel().state().network.as_deref().unwrap();
    &ns.connections[ns.index.by_id[id]]
}

fn link_state<W: std::io::Write>(run: &Run<W>, id: &str) -> oikos_kernel::network::LinkState {
    let i = run.kernel().statics().net.as_ref().unwrap().trees.link_ix[id];
    run.kernel().state().network.as_deref().unwrap().links[i].clone()
}

fn advance(run: &mut Run<Vec<u8>>, to: i64) -> Vec<EventBody> {
    run.command(&Command::Advance { to }).unwrap().events.into_iter().map(|e| e.body).collect()
}

fn act(run: &mut Run<Vec<u8>>, participant: &str, position: Option<&str>, blocks: Value) -> Result<(), String> {
    let cmd = Command::Act { participant: participant.into(), position: position.map(String::from), blocks: serde_json::from_value(blocks).unwrap(), by: vec![], provenance: json!({"via": "direct"}), reasoning: None, thinking: None };
    let r = run.command(&cmd).map_err(|e| format!("{e:?}"))?;
    let done = r.events.iter().find_map(|e| match &e.body {
        EventBody::ActionStarted { done, .. } => Some(*done),
        _ => None,
    });
    let mut events: Vec<EventBody> = r.events.into_iter().map(|e| e.body).collect();
    if let Some(d) = done {
        events.extend(advance(run, d));
    }
    match events.iter().find_map(|e| match e {
        EventBody::ActionRefused { code, detail, .. } => Some(format!("{code:?}: {}", detail.clone().unwrap_or_default())),
        _ => None,
    }) {
        Some(why) => Err(why),
        None => Ok(()),
    }
}

/// The kinds' totals over every holding.
fn total(run: &Run<Vec<u8>>, kind: &str) -> i128 {
    run.kernel().state().total_goods().get(kind).copied().unwrap_or(0)
}

#[test]
fn the_far_end_of_a_full_main_goes_short_first_and_meters_are_deliveries() {
    let mut run = Run::start(world_with_network(), "network-water", Vec::new(), None).unwrap();
    advance(&mut run, DAY - 1);
    // At midnight the day's water: the main carries both homes' 1,000 litres to n1 and half of it on; it loses 30 m at
    // its capacity (2,400 litres a day), so n1 keeps 15 m of its 40 (between the least, 5, and the service head, 20: a
    // share) and the far end none.
    let flats = conn(&run, "w-flats").meter;
    let house = conn(&run, "w-house").meter;
    assert!(flats > 0 && flats < 1000, "the near home gets a share by its pressure ({flats})");
    assert_eq!(house, 0, "the far end of a full main gets nothing");
    // What was delivered was used (water in, wastewater out at the flats), the works' store fell by it, and the sewer took
    // the flats' wastewater back to the works the next midnight.
    assert_eq!(run.kernel().state().holding("city", "s-shop", "water"), 100_000 - flats);
    advance(&mut run, 2 * DAY - 1);
    let flats2 = conn(&run, "w-flats").meter;
    assert_eq!(run.kernel().state().holding("city", "s-shop", "wastewater"), flats, "a day's wastewater carried to the works");
    assert_eq!(run.kernel().state().holding("bob", "s-flats", "wastewater"), flats2 - flats, "the second day's waits at the flats until the next settlement");
    // The household at the far end turns its taps off: with the main carrying only the flats' use, the flats get it all.
    let mut run = Run::start(world_with_network(), "network-water-2", Vec::new(), None).unwrap();
    act(&mut run, "alice-self", None, json!([{"block": "connection", "op": "set", "connection": "w-house", "rate": 0}])).unwrap();
    let day0 = conn(&run, "w-flats").meter;
    advance(&mut run, DAY + 1);
    assert_eq!(conn(&run, "w-flats").meter - day0, 1000, "an unloaded main delivers the near home in full");
}

#[test]
fn a_store_run_low_lowers_the_head_and_never_gives_more_than_it_holds() {
    let mut c = world_with_network();
    // (Only the flats on the main, a store of 1,000 litres holding 600: its head is three fifths of the full, the flats get
    // a share by their pressure, and the works' level falls further until what is drawn is no more than it holds.)
    c["world"]["connections"][1]["rate"] = json!(0);
    c["world"]["network"]["supplies"][0]["storage"] = json!("1000");
    for h in c["world"]["holdings"].as_array_mut().unwrap() {
        if h["kind"] == "water" {
            h["quantity"] = json!("600");
        }
    }
    let mut run = Run::start(c.clone(), "network-low", Vec::new(), None).unwrap();
    advance(&mut run, DAY - 1);
    let got = conn(&run, "w-flats").meter;
    assert!(got <= 600 && got > 0, "{got}");
    assert!(run.kernel().state().holding("city", "s-shop", "water") >= 0);
    // A store all but empty (a hundredth full) has no head left above the least: the taps run dry.
    c["world"]["network"]["supplies"][0]["storage"] = json!("60000");
    let mut run = Run::start(c, "network-dry", Vec::new(), None).unwrap();
    advance(&mut run, DAY - 1);
    assert_eq!(conn(&run, "w-flats").meter, 0);
}

#[test]
fn an_overloaded_feeder_trips_and_beyond_it_is_dark_until_its_operator_recloses_it() {
    let mut run = Run::start(world_with_network(), "network-power", Vec::new(), None).unwrap();
    // Each home asks two kWh an hour; the house's feeder is rated for one: it trips at the first settlement.
    let events = advance(&mut run, 1);
    assert!(events.iter().any(|e| matches!(e, EventBody::LinkChanged { link, op, by: None, .. } if link == "wire-3" && op == "tripped")), "{events:?}");
    assert!(link_state(&run, "wire-3").tripped);
    advance(&mut run, 10 * 3600);
    assert_eq!(conn(&run, "e-house").meter, 0, "nothing beyond a tripped link");
    assert_eq!(conn(&run, "e-flats").meter, 22, "the flats are supplied: two kWh an hour, eleven hours");
    // Only its operator recloses it; the house's own household cannot.
    assert!(act(&mut run, "alice-self", None, json!([{"block": "link", "link": "wire-3", "op": "reclose"}])).unwrap_err().contains("NotTheirs"));
    // The household asks for less than the rating, and the city's network recloses the feeder: the house is supplied.
    act(&mut run, "alice-self", None, json!([{"block": "connection", "op": "set", "connection": "e-house", "rate": 24}])).unwrap();
    act(&mut run, "mayor-system", Some("mayor"), json!([{"block": "link", "link": "wire-3", "op": "reclose"}])).unwrap();
    let before = conn(&run, "e-house").meter;
    { let to = run.kernel().t() + 5 * 3600; advance(&mut run, to); }
    assert!(!link_state(&run, "wire-3").tripped);
    assert_eq!(conn(&run, "e-house").meter - before, 5, "a kWh an hour once reclosed");
    // Energy used dissipates: what the substation gave is gone from the books, and nothing else.
    assert_eq!(total(&run, "energy"), 100_000 - conn(&run, "e-house").meter - conn(&run, "e-flats").meter);
}

#[test]
fn a_supply_asked_for_more_than_it_holds_trips_its_own_links_and_the_town_goes_dark() {
    let mut c = world_with_network();
    for h in c["world"]["holdings"].as_array_mut().unwrap() {
        if h["kind"] == "energy" {
            h["quantity"] = json!("1");
        }
    }
    let mut run = Run::start(c, "network-short", Vec::new(), None).unwrap();
    let events = advance(&mut run, 1);
    assert!(events.iter().any(|e| matches!(e, EventBody::LinkChanged { link, op, .. } if link == "wire-1" && op == "tripped")), "the substation's own link trips: {events:?}");
    advance(&mut run, 6 * 3600);
    assert_eq!(conn(&run, "e-flats").meter, 0);
    assert_eq!(run.kernel().state().holding("city", "s-shop", "energy"), 1, "it gives nothing it cannot give everyone it is asked by");
}

#[test]
fn a_rotation_keeps_the_supply_from_tripping_and_an_interruptible_customer_is_cut_by_an_act() {
    // (C3b) The main into the town is rated for three kWh an hour and the two homes ask for four: it trips at the first
    // hour, and would again at every hour it is reclosed. The operator puts the two feeders on a rotation (each off every
    // other hour, declared once, as standing schedules) and recloses the main: it never trips again, and each home has
    // power half the hours.
    let mut c = world_with_network();
    c["world"]["network"]["links"][3]["capacity"] = json!(3);
    c["world"]["network"]["links"][5]["capacity"] = json!(10);
    let mut run = Run::start(c, "network-rotation", Vec::new(), None).unwrap();
    let first = advance(&mut run, 1);
    assert!(first.iter().any(|e| matches!(e, EventBody::LinkChanged { link, op, .. } if link == "wire-1" && op == "tripped")));
    act(&mut run, "mayor-system", Some("mayor"), json!([
        {"block": "link", "link": "wire-2", "op": "rotate", "every": 7200, "from": 0, "off": 3600},
        {"block": "link", "link": "wire-3", "op": "rotate", "every": 7200, "from": 3600, "off": 3600},
        {"block": "link", "link": "wire-1", "op": "reclose"}
    ])).unwrap();
    let events = advance(&mut run, 24 * 3600);
    assert!(!events.iter().any(|e| matches!(e, EventBody::LinkChanged { op, .. } if op == "tripped")), "no trip under the rotation");
    assert!(conn(&run, "e-house").meter > 0 && conn(&run, "e-flats").meter > 0);
    assert!((conn(&run, "e-house").meter - conn(&run, "e-flats").meter).abs() <= 2, "each home has power half the hours");
    // An interruptible customer is cut by an act of the operator's, and restored by another; the rate is kept.
    act(&mut run, "mayor-system", Some("mayor"), json!([{"block": "connection", "op": "interrupt", "connection": "e-flats"}])).unwrap();
    let m = conn(&run, "e-flats").meter;
    { let to = run.kernel().t() + 3 * 3600; advance(&mut run, to); }
    assert_eq!(conn(&run, "e-flats").meter, m, "nothing while interrupted");
    assert_eq!(conn(&run, "e-flats").rate, 48);
    assert!(act(&mut run, "bob-self", None, json!([{"block": "connection", "op": "restore", "connection": "e-flats"}])).unwrap_err().contains("NotTheirs"), "only the operator restores");
    act(&mut run, "mayor-system", Some("mayor"), json!([{"block": "connection", "op": "restore", "connection": "e-flats"}])).unwrap();
    { let to = run.kernel().t() + 3 * 3600; advance(&mut run, to); }
    assert!(conn(&run, "e-flats").meter > m);
}

#[test]
fn connections_are_opened_closed_and_set_only_by_whoever_may() {
    let mut run = Run::start(world_with_network(), "network-acts", Vec::new(), None).unwrap();
    // The operator opens a connection for a user, on a node its supply reaches; a user cannot open one, nor can anyone
    // on a node no supply of the kind reaches.
    let open = json!([{"block": "connection", "op": "open", "kind": "water", "node": "n2", "to": "carol", "at": "s-shop", "rate": 200, "ref": "c"}]);
    assert!(act(&mut run, "carol-self", None, open.clone()).unwrap_err().contains("NotTheirs"));
    act(&mut run, "mayor-system", Some("mayor"), open).unwrap();
    let id = run.kernel().state().network.as_deref().unwrap().connections.last().unwrap().id.clone();
    assert_eq!(id, "conn.1");
    // Its user sets its rate; someone else may not.
    let why = act(&mut run, "bob-self", None, json!([{"block": "connection", "op": "set", "connection": id, "rate": 5}])).unwrap_err();
    assert!(why.contains("NotTheirs"), "{why}");
    act(&mut run, "carol-self", None, json!([{"block": "connection", "op": "set", "connection": id, "rate": 300}])).unwrap();
    assert_eq!(conn(&run, &id).rate, 300);
    // The operator closes it (a disconnection: somebody's act), and nothing flows.
    act(&mut run, "mayor-system", Some("mayor"), json!([{"block": "connection", "op": "close", "connection": id}])).unwrap();
    advance(&mut run, 2 * DAY);
    assert_eq!(conn(&run, &id).meter, 0);
    assert!(act(&mut run, "mayor-system", Some("mayor"), json!([{"block": "connection", "op": "open", "kind": "water", "node": "nowhere", "to": "carol", "at": "s-shop", "rate": 1}])).unwrap_err().contains("UnknownRef"));
    // A valve shut by the operator darkens what is beyond it.
    act(&mut run, "mayor-system", Some("mayor"), json!([{"block": "link", "link": "pipe-1", "op": "shut"}])).unwrap();
    let m = conn(&run, "w-flats").meter;
    { let to = run.kernel().t() + 2 * DAY; advance(&mut run, to); }
    assert_eq!(conn(&run, "w-flats").meter, m, "nothing beyond a shut valve");
}

#[test]
fn every_kind_is_conserved_over_holdings_and_what_uses_make_of_it() {
    let mut run = Run::start(world_with_network(), "network-conserved", Vec::new(), None).unwrap();
    let kinds = ["water", "wastewater", "energy"];
    let start: Vec<i128> = kinds.iter().map(|k| total(&run, k)).collect();
    advance(&mut run, 5 * DAY);
    // Water delivered was used into wastewater, litre for litre; energy delivered dissipated; nothing else changed.
    let water: i128 = ["w-flats", "w-house"].iter().map(|c| conn(&run, c).meter).sum();
    let energy: i128 = ["e-flats", "e-house"].iter().map(|c| conn(&run, c).meter).sum();
    assert_eq!(total(&run, "water"), start[0] - water);
    assert_eq!(total(&run, "wastewater"), start[1] + water);
    assert_eq!(total(&run, "energy"), start[2] - energy);
    assert!(water > 0 && energy > 0);
    // Nobody but an edge below nought.
    assert!(run.kernel().state().holdings.values().all(|h| h.quantity >= 0));
}

#[test]
fn a_meter_is_the_users_and_the_operators_own_and_nobody_elses() {
    use oikos_kernel::observe::ChannelData;
    let mut run = Run::start(world_with_network(), "network-sight", Vec::new(), None).unwrap();
    advance(&mut run, DAY + 1);
    let flows = |run: &mut Run<Vec<u8>>, p: &str| -> (Vec<String>, usize) {
        let o = run.command(&Command::Observe { participant: p.into(), only: None }).unwrap().observation.unwrap();
        let mut ids = vec![];
        let mut links = 0;
        for ch in o.channels.values() {
            if let ChannelData::Holdings { connections, links: l, .. } = ch {
                ids.extend(connections.iter().map(|c| format!("{}{}", c.id, if c.meter.is_some() { "+meter" } else { "" })));
                links += l.len();
            }
        }
        ids.sort();
        (ids, links)
    };
    // A household sees its own connections with their meters; nobody else's; no links.
    assert_eq!(flows(&mut run, "bob-self"), (vec!["e-flats+meter".into(), "s-flats+meter".into(), "w-flats+meter".into()], 0));
    // The operator keeps its network: every connection on it, the meters it reads from afar (the energy's), and its links.
    let (ids, links) = flows(&mut run, "mayor-system");
    assert_eq!(links, 9);
    assert!(ids.contains(&"e-house+meter".to_string()) && ids.contains(&"w-house".to_string()), "{ids:?}");
    // Someone with no connection sees none.
    assert_eq!(flows(&mut run, "carol-self"), (vec![], 0));
}

#[test]
fn a_world_whose_network_says_nothing_coherent_is_refused_at_load() {
    let refused = |edit: &dyn Fn(&mut Value)| {
        let mut c = world_with_network();
        edit(&mut c);
        Run::start(c, "network-refused", Vec::new(), None).err().map(|e| format!("{e:?}"))
    };
    assert!(refused(&|_| {}).is_none());
    assert!(refused(&|c| c["world"]["connections"][0]["node"] = json!("n9")).unwrap().contains("no supply of water reaches"));
    assert!(refused(&|c| c["world"]["network"]["supplies"][0].as_object_mut().unwrap().remove("service_head_m").map(|_| ()).unwrap_or(())).unwrap().contains("fed by pressure"));
    assert!(refused(&|c| c["catalogue"]["resources"][2].as_object_mut().unwrap().remove("settle").map(|_| ()).unwrap_or(())).unwrap().contains("settled"));
    assert!(refused(&|c| c["world"]["connections"][0]["uses"] = json!("make")).unwrap().contains("its use make"));
    assert!(refused(&|c| c["world"]["network"]["links"][0]["to"] = json!("n0")).unwrap().contains("joins no two nodes"));
}

#[test]
fn a_loop_is_cut_to_a_tree_at_load_and_the_same_world_settles_the_same() {
    let mut c = world_with_network();
    // A second main from the works to the far end closes a loop: it is cut (the known limit), and the far end is fed as before.
    c["world"]["network"]["links"].as_array_mut().unwrap().push(json!({"id": "pipe-loop", "from": "n3", "to": "n0", "mode": "pipe", "capacity": 100, "loss_m": 30}));
    let run = Run::start(c.clone(), "network-loop", Vec::new(), None).unwrap();
    let net = run.kernel().statics().net.clone().unwrap();
    // (Breadth first from the works, n3 is reached by the second main first: the last link of the line closes the loop
    // and is cut, and the far end is fed by the second main.)
    assert_eq!(net.trees.cut, vec![net.trees.link_ix["pipe-3"]]);
    let mut a = Run::start(c.clone(), "network-det-a", Vec::new(), None).unwrap();
    let mut b = Run::start(c, "network-det-b", Vec::new(), None).unwrap();
    advance(&mut a, 3 * DAY);
    advance(&mut b, 3 * DAY);
    assert_eq!(a.kernel().state_hash().unwrap(), b.kernel().state_hash().unwrap());
}

/// A scarce kind at an edge (C6): the outside sells no more of it than its quantity a period, refused `beyond_supply`
/// beyond it, and sells again in the next period. Every other kind is unlimited at its price.
#[test]
fn a_scarce_kind_runs_out_at_the_edge_and_comes_again_the_next_period() {
    let mut c = world_with_network();
    c["world"]["scarce"] = json!([{"edge": "outside", "kind": "goods", "quantity": "30", "every": 10 * DAY}]);
    let mut run = Run::start(c, "network-scarce", Vec::new(), None).unwrap();
    let sell = |q: i64| json!([{"block": "move_goods", "kind": "goods", "quantity": q.to_string(), "from_at": "outside", "to": "devco", "to_at": "s-shop"}]);
    act(&mut run, "outside-system", Some("outside-trade"), sell(20)).unwrap();
    assert!(act(&mut run, "outside-system", Some("outside-trade"), sell(20)).unwrap_err().contains("BeyondSupply"));
    act(&mut run, "outside-system", Some("outside-trade"), sell(10)).unwrap();
    // (Materials are not scarce: unlimited at the edge's price.)
    act(&mut run, "outside-system", Some("outside-trade"), json!([{"block": "move_goods", "kind": "materials", "quantity": "100000", "from_at": "outside", "to": "devco", "to_at": "s-shop"}])).unwrap();
    { let to = 10 * DAY + 1; advance(&mut run, to); }
    act(&mut run, "outside-system", Some("outside-trade"), sell(30)).unwrap();
    // A world that names a scarce kind of no edge, or of no kind, does not load.
    let mut bad = world_with_network();
    bad["world"]["scarce"] = json!([{"edge": "devco", "kind": "goods", "quantity": "30", "every": DAY}]);
    assert!(Run::start(bad, "network-scarce-bad", Vec::new(), None).is_err());
}
