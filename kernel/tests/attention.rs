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
    bob["channels"].as_array_mut().unwrap().push(json!({"id": "board", "kind": "records", "way": "published", "match": {"statement_kinds": ["notice"]}, "on_request": true}));
    Run::start(c, "attention", Vec::new(), None).unwrap()
}

fn post(run: &mut Run<Vec<u8>>, participant: &str, blocks: serde_json::Value) -> String {
    let r = run.done(&rb_act(participant, blocks)).unwrap();
    match &r.events[0].body {
        oikos_kernel::events::EventBody::ActionApplied { created: Some(c), .. } => c.values().next().unwrap().to_string(),
        other => panic!("{other:?}"),
    }
}

fn notice(run: &mut Run<Vec<u8>>, rent: i64, private: bool) -> String {
    let vis = if private { json!(["city"]) } else { json!("public") };
    post(run, "mayor", json!([{"block": "publish", "kind": "notice", "speaks_for": "city", "text": "To let.", "data": {"rent": rent}, "visible_to": vis, "ref": "n"}]))
}

fn board(o: &Observation) -> Option<(Vec<String>, bool)> {
    match o.channels.get("board")? {
        ChannelData::Records { records, search, .. } => { Some((records.iter().map(|r| r.id).map(|x| x.to_string()).collect(), search.is_some()))}
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
fn a_statement_taken_down_is_news_wherever_statements_like_it_are_shown() {
    // Bob's "book" shows notices (by kind); his "rules" shows whatever carries a formal condition (by field). Neither
    // names withdrawals, and both showed him the city's notice: when the city takes it down, each tells him so, once.
    let mut c = riverbend();
    let bob = c["participants"].as_array_mut().unwrap().iter_mut().find(|s| s["id"] == "bob-self").unwrap();
    bob["channels"].as_array_mut().unwrap().push(json!({"id": "book", "kind": "records", "way": "published", "match": {"statement_kinds": ["notice"]}}));
    bob["channels"].as_array_mut().unwrap().push(json!({"id": "rules", "kind": "records", "way": "published", "match": {"has": ["formal"]}}));
    bob["channels"].as_array_mut().unwrap().push(json!({"id": "statements", "kind": "records", "way": "published", "match": {"records": ["statement"], "statement_kinds": ["notice"]}}));
    let mut run = Run::start(c, "attention-withdrawn", Vec::new(), None).unwrap();
    let seen = |run: &mut Run<Vec<u8>>, channel: &str| -> Vec<String> {
        let o = run.command(&Command::Observe { participant: "bob-self".into(), only: None }).unwrap().observation.unwrap();
        match o.channels.get(channel) {
            Some(ChannelData::Records { records, .. }) => records.iter().map(|r| r.id).map(|x| x.to_string()).collect(),
            other => panic!("{other:?}"),
        }
    };
    let rule = post(&mut run, "mayor", json!([{"block": "publish", "kind": "notice", "speaks_for": "city", "text": "No ball games.",
        "formal": {"language": "cel", "condition": "block.block == 'publish'"}, "ref": "n"}]));
    let other = post(&mut run, "mayor", json!([{"block": "publish", "kind": "memo", "speaks_for": "city", "text": "A memo.", "ref": "n"}]));
    assert_eq!(seen(&mut run, "book"), vec![rule.clone()]);
    // Someone else "withdrawing" it takes nothing down, and is no news here; nor is the city withdrawing something else.
    post(&mut run, "alice-self", json!([{"block": "withdraw", "record": rule, "speaks_for": "alice", "ref": "w"}]));
    post(&mut run, "mayor", json!([{"block": "withdraw", "record": other, "speaks_for": "city", "ref": "w"}]));
    assert_eq!(seen(&mut run, "book"), Vec::<String>::new());
    // The city withdraws it: the withdrawal comes through both channels, and only once.
    let gone = post(&mut run, "mayor", json!([{"block": "withdraw", "record": rule, "speaks_for": "city", "ref": "w"}]));
    let o = run.command(&Command::Observe { participant: "bob-self".into(), only: None }).unwrap().observation.unwrap();
    for channel in ["book", "rules"] {
        match o.channels.get(channel) {
            Some(ChannelData::Records { records, .. }) => { assert_eq!(records.iter().map(|r| r.id).collect::<Vec<_>>(), vec![gone.clone()], "{channel}")}
            other => panic!("{other:?}"),
        }
    }
    // A channel that lists the records it shows, and not withdrawals, shows none.
    match o.channels.get("statements") {
        Some(ChannelData::Records { records, .. }) => assert!(records.is_empty()),
        other => panic!("{other:?}"),
    }
    assert_eq!(seen(&mut run, "book"), Vec::<String>::new());
    // The whole picture the channel covers has it too (what a view built from looks must equal).
    let full = run.full_view("bob-self").unwrap();
    match full.channels.get("book") {
        Some(ChannelData::Records { records, .. }) => { assert_eq!(records.iter().map(|r| r.id).collect::<Vec<_>>(), vec![rule, gone])}
        other => panic!("{other:?}"),
    }
}

#[test]
fn a_bad_look_is_refused_before_it_reaches_the_log() {
    let mut run = town();
    let bad = |q: serde_json::Value| { serde_json::from_value::<Vec<oikos_kernel::config::LookRequest>>(json!([{"channel": "board", "query": q}])).unwrap()};
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
    bob["channels"].as_array_mut().unwrap().push(json!({"id": "offers", "kind": "records", "way": "published", "match": {"has": ["offer"]}}));
    let mut run = Run::start(c, "attention-offers", Vec::new(), None).unwrap();
    let offered = post(&mut run, "mayor", json!([{"block": "publish", "kind": "festival_fund", "speaks_for": "city", "text": "Give to the harvest festival fund.",
        "offer": {"take_up": "join", "terms": {"commitments": [{"who": "taker", "does": {"outcome": {"money": {"to": "acc-city", "amount": "500"}}}, "every": 2_592_000}]}}, "ref": "o"}]));
    let plain = post(&mut run, "mayor", json!([{"block": "publish", "kind": "festival_fund", "speaks_for": "city", "text": "The fund raised $1,000.", "ref": "p"}]));
    let o = run.command(&Command::Observe { participant: "bob-self".into(), only: None }).unwrap().observation.unwrap();
    let seen: Vec<String> = match o.channels.get("offers") {
        Some(ChannelData::Records { records, .. }) => records.iter().map(|r| r.id).map(|x| x.to_string()).collect(),
        other => panic!("{other:?}"),
    };
    assert_eq!(seen, vec![offered]);
    assert!(!seen.contains(&plain));
    // An offer that says what it's worth to someone isn't one: facts only.
    let r = run.done(&rb_act("mayor", json!([{"block": "publish", "kind": "notice", "speaks_for": "city", "text": "Join us.", "offer": {"take_up": "join", "gives": "belonging"}}])));
    assert!(r.is_err(), "the contract refuses an offer stating its meaning");
}

#[test]
fn a_register_is_searched_for_a_named_record_and_for_what_became_of_a_title() {
    // Bob is shown no land register by default: its lots, its titles and the dealings in them are each looked up, by
    // a lot's own id, by what a title is about, and by the title a transfer or a release names.
    let mut c = riverbend();
    let bob = c["participants"].as_array_mut().unwrap().iter_mut().find(|s| s["id"] == "bob-self").unwrap();
    for (id, m, by) in [("lots", json!({"statement_kinds": ["lot"]}), json!(["id"])), ("titles", json!({"records": ["claim"]}), json!(["id", "about.object"])), ("dealings", json!({"records": ["claim_transfer", "claim_release"]}), json!(["claim", "id"]))] {
        bob["channels"].as_array_mut().unwrap().push(json!({"id": id, "kind": "records", "way": "ask", "of": "city", "by": by, "match": m, "on_request": true}));
    }
    let mut run = Run::start(c, "attention-register", Vec::new(), None).unwrap();
    let found = |run: &mut Run<Vec<u8>>, looks: serde_json::Value| -> std::collections::BTreeMap<String, Vec<String>> {
        let looks = serde_json::from_value(looks).unwrap();
        let o = run.command(&Command::Look { participant: "bob-self".into(), only: None, looks }).unwrap().observation.unwrap();
        let mut got = std::collections::BTreeMap::new();
        for ch in ["lots", "titles", "dealings"] {
            if let Some(ChannelData::Records { records, search, .. }) = o.channels.get(ch) {
                assert!(search.is_some());
                got.insert(ch.to_string(), records.iter().map(|r| r.id).map(|x| x.to_string()).collect());
            }
        }
        got
    };
    let o = run.command(&Command::Observe { participant: "bob-self".into(), only: None }).unwrap().observation.unwrap();
    assert!(["lots", "titles", "dealings"].iter().all(|ch| !o.channels.contains_key(*ch)), "none of the register comes unasked");
    // Alice passes her lot to carol, and carol to devco; the city's title to p00 is released.
    let first = post(&mut run, "alice-self", json!([{"block": "transfer_claim", "claim": "title-p11", "to": "carol", "ref": "t"}]));
    let second = post(&mut run, "carol-self", json!([{"block": "transfer_claim", "claim": "title-p11", "to": "devco", "ref": "t"}]));
    let released = post(&mut run, "mayor", json!([{"block": "release_claim", "claim": "title-p00", "speaks_for": "city", "ref": "r"}]));
    // One look: the lot by its id, its title by what it is about, the dealings in that title.
    let got = found(&mut run, json!([
        {"channel": "lots", "query": {"where": [{"field": "id", "op": "=", "value": "p11"}]}},
        {"channel": "titles", "query": {"where": [{"field": "about.object", "op": "=", "value": "p11"}]}},
        {"channel": "dealings", "query": {"where": [{"field": "claim", "op": "=", "value": "title-p11"}], "order": {"field": "at"}}}]));
    assert_eq!(got["lots"], vec![oikos_kernel::blocks::Id::new("p11")]);
    assert_eq!(got["titles"], vec![oikos_kernel::blocks::Id::new("title-p11")]);
    assert_eq!(got["dealings"].len(), 2);
    assert!(got["dealings"].contains(&first) && got["dealings"].contains(&second));
    // A title by its own id; a release is found by the title it names; a statement names no claim.
    let got = found(&mut run, json!([
        {"channel": "titles", "query": {"where": [{"field": "id", "op": "=", "value": "title-p00"}]}},
        {"channel": "dealings", "query": {"where": [{"field": "claim", "op": "=", "value": "title-p00"}]}}]));
    assert_eq!(got["titles"], vec![oikos_kernel::blocks::Id::new("title-p00")]);
    assert_eq!(got["dealings"], vec![released]);
    // By id, only what the channel shows and the other conditions allow: a title isn't found among the lots, nor one
    // that fails another condition, nor a record there is none of.
    let got = found(&mut run, json!([
        {"channel": "lots", "query": {"where": [{"field": "id", "op": "=", "value": "title-p11"}]}},
        {"channel": "titles", "query": {"where": [{"field": "id", "op": "=", "value": "title-p11"}, {"field": "about.object", "op": "=", "value": "p00"}]}},
        {"channel": "dealings", "query": {"where": [{"field": "id", "op": "=", "value": "nothing"}]}}]));
    assert!(got.values().all(|v| v.is_empty()), "{got:?}");
    // The register answers a question about one named thing, and nothing else (docs/design/knowing.md). Until
    // 2026-10-08 the last look here read every lot but one ("id != p11", fifty at a time), and a lot could be asked
    // for by a field the register has no entry under; both are refused now, before they reach the log: a look with no
    // subject, one that names it by a field the keeper does not answer by, one that only says what it is not, and
    // the register read through with no search at all.
    let refused = |run: &mut Run<Vec<u8>>, looks: serde_json::Value| { run.command(&Command::Look { participant: "bob-self".into(), only: None, looks: serde_json::from_value(looks).unwrap() }).is_err()};
    assert!(refused(&mut run, json!([{"channel": "lots", "query": {"where": [{"field": "id", "op": "!=", "value": "p11"}], "limit": 50}}])));
    assert!(refused(&mut run, json!([{"channel": "lots", "query": {"where": [{"field": "claim", "op": "=", "value": "title-p00"}]}}])));
    assert!(refused(&mut run, json!([{"channel": "lots", "query": {"standing": true, "limit": 200}}])));
    assert!(refused(&mut run, json!([{"channel": "titles"}])));
    // Nor does anyone not listed for it get a holder's titles by naming the holder: bob's channel could not even be
    // written with `by: ["holder"]` (the world would not load); asked through the channel he has, it is refused.
    assert!(refused(&mut run, json!([{"channel": "titles", "query": {"where": [{"field": "holder", "op": "=", "value": "alice"}]}}])));
    // And one answer is as many as the keeper gives at once: the titles to one lot, at most 20 here.
    let got = found(&mut run, json!([{"channel": "titles", "query": {"where": [{"field": "about.object", "op": "=", "value": "p11"}], "limit": 200}}]));
    assert_eq!(got["titles"], vec![oikos_kernel::blocks::Id::new("title-p11")]);
}
