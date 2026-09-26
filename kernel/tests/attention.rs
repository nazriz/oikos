//! Attention: on-request channels are perceived only when the seat looks, and
//! a look through a records channel can be a search. Mechanical throughout: the
//! kernel compares named fields and never learns what they mean.

mod common;

use common::*;
use serde_json::json;
use terrarium_kernel::observe::{ChannelData, Observation};
use terrarium_kernel::run::Run;
use terrarium_kernel::Command;

fn town() -> Run<Vec<u8>> {
    let mut c = riverbend();
    let bob = c["seats"].as_array_mut().unwrap().iter_mut().find(|s| s["id"] == "bob-seat").unwrap();
    bob["channels"].as_array_mut().unwrap().push(json!({"id": "board", "kind": "records", "match": {"statement_kinds": ["notice"]}, "on_request": true}));
    Run::start(c, "attention", Vec::new(), None).unwrap()
}

fn post(run: &mut Run<Vec<u8>>, seat: &str, blocks: serde_json::Value) -> String {
    let r = run.command(&Command::Act { seat: seat.into(), blocks: serde_json::from_value(blocks).unwrap(), provenance: json!({"via": "direct"}), reasoning: None }).unwrap();
    match &r.events[0].body {
        terrarium_kernel::events::EventBody::ActionApplied { created: Some(c), .. } => c.values().next().unwrap().clone(),
        other => panic!("{other:?}"),
    }
}

fn notice(run: &mut Run<Vec<u8>>, rent: i64, private: bool) -> String {
    let vis = if private { json!(["city"]) } else { json!("public") };
    post(run, "mayor", json!([{"block": "publish", "kind": "notice", "speaks_for": "city", "text": "To let.", "data": {"rent": rent}, "visible_to": vis, "ref": "n"}]))
}

fn board(o: &Observation) -> Option<(Vec<String>, bool)> {
    match o.channels.get("board")? {
        ChannelData::Records { records, search } => Some((records.iter().map(|r| r.id.clone()).collect(), search.is_some())),
        _ => None,
    }
}

fn look(run: &mut Run<Vec<u8>>, query: Option<serde_json::Value>) -> Observation {
    let looks = serde_json::from_value(json!([{"channel": "board", "query": query}])).unwrap();
    run.command(&Command::Look { seat: "bob-seat".into(), looks }).unwrap().observation.unwrap()
}

#[test]
fn an_on_request_channel_is_perceived_only_when_the_seat_looks() {
    let mut run = town();
    notice(&mut run, 100_000, false);
    let o = run.command(&Command::Observe { seat: "bob-seat".into() }).unwrap().observation.unwrap();
    assert!(board(&o).is_none(), "an ordinary observation doesn't look through it");
    // A plain look delivers what's new since the last look (the first: everything), like any channel.
    let first = look(&mut run, None);
    assert_eq!(board(&first).unwrap().0.len(), 1);
    assert!(!board(&first).unwrap().1);
    assert_eq!(board(&look(&mut run, None)).unwrap().0.len(), 0, "nothing new since");
}

#[test]
fn a_search_filters_orders_and_limits_what_the_seat_may_see_now() {
    let mut run = town();
    let cheap = notice(&mut run, 80_000, false);
    let mid = notice(&mut run, 100_000, false);
    let dear = notice(&mut run, 150_000, false);
    let hidden = notice(&mut run, 90_000, true); // visible only to the city
    let q = json!({"standing": true, "where": [{"field": "data.rent", "op": "<=", "value": 120_000}], "order": {"field": "data.rent", "desc": true}, "limit": 2});
    let (ids, search) = board(&look(&mut run, Some(q.clone()))).unwrap();
    assert!(search);
    assert_eq!(ids, vec![mid.clone(), cheap.clone()], "dearest first, within budget, at most 2, and never what bob can't see");
    assert!(!ids.contains(&hidden) && !ids.contains(&dear));
    // A search is what matches now, every time: it doesn't consume anything.
    assert_eq!(board(&look(&mut run, Some(q.clone()))).unwrap().0, vec![mid.clone(), cheap.clone()]);

    // Standing: withdrawn by its own author, it's gone; withdrawn by someone else, it still stands.
    post(&mut run, "mayor", json!([{"block": "withdraw", "record": mid, "speaks_for": "city", "ref": "w"}]));
    post(&mut run, "alice-seat", json!([{"block": "withdraw", "record": cheap, "speaks_for": "alice", "ref": "w"}]));
    assert_eq!(board(&look(&mut run, Some(q))).unwrap().0, vec![cheap.clone()]);
    // Without `standing`, withdrawn records are still records.
    let all = json!({"where": [{"field": "data.rent", "op": "<=", "value": 120_000}]});
    assert_eq!(board(&look(&mut run, Some(all))).unwrap().0, vec![mid, cheap], "newest first by default");
}

#[test]
fn a_bad_look_is_refused_before_it_reaches_the_log() {
    let mut run = town();
    let bad = |q: serde_json::Value| serde_json::from_value::<Vec<terrarium_kernel::config::LookRequest>>(json!([{"channel": "board", "query": q}])).unwrap();
    assert!(run.command(&Command::Look { seat: "bob-seat".into(), looks: bad(json!({"where": [{"field": "rent", "op": "=", "value": 1}]})) }).is_err());
    assert!(run.command(&Command::Look { seat: "bob-seat".into(), looks: bad(json!({"limit": 1000})) }).is_err());
    let money = serde_json::from_value(json!([{"channel": "money", "query": {}}])).unwrap();
    assert!(run.command(&Command::Look { seat: "bob-seat".into(), looks: money }).is_err(), "only records channels can be searched");
}
