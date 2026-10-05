//! Attention: on-request channels are perceived only when the participant looks, and
//! a look through a records channel can be a search. Mechanical throughout: the
//! kernel compares named fields and never learns what they mean.

mod common;

use common::*;
use serde_json::json;
use oikos_kernel::observe::{ChannelData, Observation};
use oikos_kernel::run::Run;
use oikos_kernel::Command;

fn town() -> Run<Vec<u8>> {
    let mut c = riverbend();
    let bob = c["participants"].as_array_mut().unwrap().iter_mut().find(|s| s["id"] == "bob-self").unwrap();
    bob["channels"].as_array_mut().unwrap().push(json!({"id": "board", "kind": "records", "match": {"statement_kinds": ["notice"]}, "on_request": true}));
    Run::start(c, "attention", Vec::new(), None).unwrap()
}

fn post(run: &mut Run<Vec<u8>>, participant: &str, blocks: serde_json::Value) -> String {
    let r = run.done(&rb_act(participant, blocks)).unwrap();
    match &r.events[0].body {
        oikos_kernel::events::EventBody::ActionApplied { created: Some(c), .. } => c.values().next().unwrap().clone(),
        other => panic!("{other:?}"),
    }
}

fn notice(run: &mut Run<Vec<u8>>, rent: i64, private: bool) -> String {
    let vis = if private { json!(["city"]) } else { json!("public") };
    post(run, "mayor", json!([{"block": "publish", "kind": "notice", "speaks_for": "city", "text": "To let.", "data": {"rent": rent}, "visible_to": vis, "ref": "n"}]))
}

fn board(o: &Observation) -> Option<(Vec<String>, bool)> {
    match o.channels.get("board")? {
        ChannelData::Records { records, search, .. } => Some((records.iter().map(|r| r.id.clone()).collect(), search.is_some())),
        _ => None,
    }
}

fn look(run: &mut Run<Vec<u8>>, query: Option<serde_json::Value>) -> Observation {
    let looks = serde_json::from_value(json!([{"channel": "board", "query": query}])).unwrap();
    run.command(&Command::Look { participant: "bob-self".into(), only: None, looks }).unwrap().observation.unwrap()
}

#[test]
fn an_on_request_channel_is_perceived_only_when_the_seat_looks() {
    let mut run = town();
    notice(&mut run, 100_000, false);
    let o = run.command(&Command::Observe { participant: "bob-self".into(), only: None }).unwrap().observation.unwrap();
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
    post(&mut run, "alice-self", json!([{"block": "withdraw", "record": cheap, "speaks_for": "alice", "ref": "w"}]));
    assert_eq!(board(&look(&mut run, Some(q))).unwrap().0, vec![cheap.clone()]);
    // Without `standing`, withdrawn records are still records.
    let all = json!({"where": [{"field": "data.rent", "op": "<=", "value": 120_000}]});
    assert_eq!(board(&look(&mut run, Some(all))).unwrap().0, vec![mid, cheap], "newest first by default");
}

#[test]
fn a_bad_look_is_refused_before_it_reaches_the_log() {
    let mut run = town();
    let bad = |q: serde_json::Value| serde_json::from_value::<Vec<oikos_kernel::config::LookRequest>>(json!([{"channel": "board", "query": q}])).unwrap();
    assert!(run.command(&Command::Look { participant: "bob-self".into(), only: None, looks: bad(json!({"where": [{"field": "rent", "op": "=", "value": 1}]})) }).is_err());
    assert!(run.command(&Command::Look { participant: "bob-self".into(), only: None, looks: bad(json!({"limit": 1000})) }).is_err());
    let money = serde_json::from_value(json!([{"channel": "money", "query": {}}])).unwrap();
    assert!(run.command(&Command::Look { participant: "bob-self".into(), only: None, looks: money }).is_err(), "only records channels can be searched");
}

#[test]
fn a_channel_can_show_whatever_is_offered_whatever_it_is_called() {
    // Bob's "offers" channel shows statements having an offer (docs/design/ai-citizens.md 2d): a kind of offer nobody
    // configured for is seen as soon as it's put up, and a statement of the same kind without one isn't.
    let mut c = riverbend();
    let bob = c["participants"].as_array_mut().unwrap().iter_mut().find(|s| s["id"] == "bob-self").unwrap();
    bob["channels"].as_array_mut().unwrap().push(json!({"id": "offers", "kind": "records", "match": {"has": ["offer"]}}));
    let mut run = Run::start(c, "attention-offers", Vec::new(), None).unwrap();
    let offered = post(&mut run, "mayor", json!([{"block": "publish", "kind": "festival_fund", "speaks_for": "city", "text": "Give to the harvest festival fund.",
        "offer": {"take_up": "join", "terms": {"commitments": [{"who": "taker", "does": {"outcome": {"money": {"to": "acc-city", "amount": "500"}}}, "every": 2_592_000}]}}, "ref": "o"}]));
    let plain = post(&mut run, "mayor", json!([{"block": "publish", "kind": "festival_fund", "speaks_for": "city", "text": "The fund raised $1,000.", "ref": "p"}]));
    let o = run.command(&Command::Observe { participant: "bob-self".into(), only: None }).unwrap().observation.unwrap();
    let seen: Vec<String> = match o.channels.get("offers") {
        Some(ChannelData::Records { records, .. }) => records.iter().map(|r| r.id.clone()).collect(),
        other => panic!("{other:?}"),
    };
    assert_eq!(seen, vec![offered]);
    assert!(!seen.contains(&plain));
    // An offer that says what it's worth to someone isn't one: facts only.
    let r = run.done(&rb_act("mayor", json!([{"block": "publish", "kind": "notice", "speaks_for": "city", "text": "Join us.", "offer": {"take_up": "join", "gives": "belonging"}}])));
    assert!(r.is_err(), "the contract refuses an offer stating its meaning");
}
