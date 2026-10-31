//! Knowing (docs/design/knowing.md): information lives with whoever keeps it, and reaches a participant in four ways.
//! It is theirs; they are there, or go to look; it was published; or they asked its keeper for one specific thing.
//! A world that gives a seat anything else (a whole register for someone who does not keep it, a whole map, a
//! directory to read through) does not load, and a look that asks for "everything" is refused before it reaches
//! the log.

mod common;

use common::*;
use oikos_kernel::events::EventBody;
use oikos_kernel::observe::{ChannelData, Observation};
use oikos_kernel::run::Run;
use oikos_kernel::Command;
use serde_json::{json, Value};

const DAY: i64 = 86_400;

fn base() -> Value {
    world(&default_params())
}

/// The world with one more channel at a seat (a person's own: `None`; or a position's).
fn with_channel(position: Option<&str>, channel: Value) -> Value {
    let mut c = base();
    let seat = match position {
        None => c["participants"].as_array_mut().unwrap().iter_mut().find(|p| p["id"] == "alice-self").unwrap(),
        Some(pos) => c["positions"].as_array_mut().unwrap().iter_mut().find(|p| p["id"] == pos).unwrap(),
    };
    seat["channels"].as_array_mut().unwrap().push(channel);
    c
}

/// Why a world doesn't load (empty: it loads).
fn refused(c: Value) -> String {
    Run::start(c, "knowing", Vec::new(), None).err().map(|e| format!("{e:?}")).unwrap_or_default()
}

fn look(run: &mut Run<Vec<u8>>, participant: &str, looks: Value) -> Result<Observation, String> {
    let looks = serde_json::from_value(looks).map_err(|e| e.to_string())?;
    run.command(&Command::Look { participant: participant.into(), only: None, looks }).map(|o| o.observation.unwrap()).map_err(|e| format!("{e:?}"))
}

#[test]
fn a_whole_view_cannot_be_written() {
    // Each of these gave a seat everything of something. None is a channel any more: the world is not valid.
    for (what, position, channel) in [
        ("a map of everywhere", None, json!({"id": "x", "kind": "sites", "way": "here", "area": "all"})),
        ("a map of a place", None, json!({"id": "x", "kind": "sites", "way": "here", "area": {"place": "here"}})),
        ("a map of a list of cells", None, json!({"id": "x", "kind": "sites", "way": "here", "area": ["cell.0.0", "cell.1.0", "cell.2.0"]})),
        ("a map with no way", None, json!({"id": "x", "kind": "sites", "area": {"near": 0}})),
        ("a map near so far it is the town", None, json!({"id": "x", "kind": "sites", "way": "here", "area": {"near": 3}})),
        ("a visit with an area", None, json!({"id": "x", "kind": "sites", "way": "visit", "area": {"near": 0}})),
        ("a directory to read", None, json!({"id": "x", "kind": "directory"})),
        ("a directory shown", None, json!({"id": "x", "kind": "directory", "way": "here"})),
        ("any record", None, json!({"id": "x", "kind": "records", "way": "published", "match": {}})),
        ("a kind nobody published", None, json!({"id": "x", "kind": "records", "way": "published", "match": {"statement_kinds": ["lot"]}})),
        ("records by who they involve", None, json!({"id": "x", "kind": "records", "way": "mine", "match": {"involving": ["bob"]}})),
        ("a register kept by a person", None, json!({"id": "x", "kind": "records", "way": "kept", "match": {"statement_kinds": ["lot"]}})),
        ("a register kept by someone else", Some("developer"), json!({"id": "x", "kind": "records", "way": "kept", "match": {"statement_kinds": ["lot"]}})),
        ("a register shown unasked", None, json!({"id": "x", "kind": "records", "way": "ask", "of": "city", "by": ["id"], "match": {"statement_kinds": ["lot"]}})),
        ("an ask of someone who is not the keeper", None, json!({"id": "x", "kind": "records", "way": "ask", "of": "devco", "by": ["id"], "match": {"statement_kinds": ["lot"]}, "on_request": true})),
        ("an ask by a field the keeper does not answer by", None, json!({"id": "x", "kind": "records", "way": "ask", "of": "city", "by": ["speaks_for"], "match": {"statement_kinds": ["lot"]}, "on_request": true})),
        ("a holder's titles, for someone not listed", None, json!({"id": "x", "kind": "records", "way": "ask", "of": "city", "by": ["holder"], "match": {"records": ["claim"]}, "on_request": true})),
        ("a holder's titles, for an office not listed", Some("builder"), json!({"id": "x", "kind": "records", "way": "ask", "of": "city", "by": ["holder"], "match": {"records": ["claim"]}, "on_request": true})),
        ("a person's premises", None, json!({"id": "x", "kind": "sites", "way": "here", "area": {"premises": ["cell.1.1"]}})),
        ("a person's premises held by agreement", None, json!({"id": "x", "kind": "sites", "way": "here", "area": {"held": "occupancy"}})),
        ("notices at premises held by agreement", Some("builder"), json!({"id": "x", "kind": "records", "way": "here", "area": {"held": "occupancy"}, "match": {"statement_kinds": ["price_list"]}})),
        ("more publishers than a seat deals with", None, json!({"id": "x", "kind": "records", "way": "published", "match": {"statement_kinds": ["price_list"]}, "from": ["a", "b", "c", "d", "e", "f", "g", "h", "i"]})),
    ] {
        assert!(!refused(with_channel(position, channel)).is_empty(), "{what} should not load");
    }
    // The same seats, each by one of the ways: these load.
    for (what, position, channel) in [
        ("the ground around one", None, json!({"id": "x", "kind": "sites", "way": "here", "area": {"near": 1}})),
        ("an office's premises", Some("developer"), json!({"id": "x", "kind": "sites", "way": "here", "area": {"premises": ["cell.0.2"]}, "occupants": "names"})),
        ("an office's premises held by agreement", Some("builder"), json!({"id": "x", "kind": "sites", "way": "here", "area": {"held": "occupancy"}, "occupants": "names"})),
        ("places gone to", None, json!({"id": "x", "kind": "sites", "way": "visit"})),
        ("who's who, looked up", None, json!({"id": "x", "kind": "directory", "way": "ask"})),
        ("its own papers", None, json!({"id": "x", "kind": "records", "way": "mine", "match": {"statement_kinds": ["lot"]}})),
        ("what is published", None, json!({"id": "x", "kind": "records", "way": "published", "match": {"statement_kinds": ["law"]}})),
        ("a named supplier's lists", None, json!({"id": "x", "kind": "records", "way": "published", "match": {"statement_kinds": ["price_list"]}, "from": ["devco", "self"]})),
        ("the register, for its keeper", Some("mayor"), json!({"id": "x", "kind": "records", "way": "kept", "match": {"statement_kinds": ["lot"]}})),
        ("the register, asked", None, json!({"id": "x", "kind": "records", "way": "ask", "of": "city", "by": ["id"], "match": {"statement_kinds": ["lot"]}, "on_request": true})),
        ("a holder's titles, for the office listed", Some("developer"), json!({"id": "x", "kind": "records", "way": "ask", "of": "city", "by": ["holder"], "match": {"records": ["claim"]}, "on_request": true})),
    ] {
        assert_eq!(refused(with_channel(position, channel)), "", "{what} should load");
    }
    // Premises are one organisation's only.
    let mut c = with_channel(Some("developer"), json!({"id": "x", "kind": "sites", "way": "here", "area": {"premises": ["cell.0.2"]}}));
    c["positions"].as_array_mut().unwrap().iter_mut().find(|p| p["id"] == "builder").unwrap()["channels"].as_array_mut().unwrap().push(json!({"id": "y", "kind": "sites", "way": "here", "area": {"premises": ["cell.0.2"]}}));
    assert!(refused(c).contains("one organisation's premises only"));
    // And a position made during a run is held to the same: a founder can't give their new firm a register.
    let mut run = Run::start(base(), "knowing", Vec::new(), None).unwrap();
    let made = |run: &mut Run<Vec<u8>>, channels: Value| {
        let cmd = direct("developer-system", Some("developer"), serde_json::from_value(json!([{"block": "create_position", "title": "Clerk of works", "channels": channels}])).unwrap()).unwrap();
        matches!(step(run, &cmd).unwrap().events[0].body, EventBody::ActionApplied { .. })
    };
    assert!(!made(&mut run, json!([{"id": "x", "kind": "records", "way": "kept", "match": {"statement_kinds": ["lot"]}}])));
    assert!(made(&mut run, json!([{"id": "x", "kind": "records", "way": "mine", "match": {}}])));
}

#[test]
fn an_organisation_sees_premises_it_holds_by_an_agreement_in_force_and_no_others_and_not_before() {
    // The builder's office is shown the ground of premises it holds by agreement: none yet.
    let c = with_channel(Some("builder"), json!({"id": "unit", "kind": "sites", "way": "here", "area": {"held": "occupancy"}, "occupants": "names"}));
    let mut run = Run::start(c, "knowing-held", Vec::new(), None).unwrap();
    let unit = |run: &mut Run<Vec<u8>>| -> Vec<oikos_kernel::observe::SiteCell> {
        let o = run.command(&Command::Observe { participant: "builder-system".into(), only: None }).unwrap().observation.unwrap();
        match o.channels.get("builder/unit") {
            Some(ChannelData::Sites { cells, .. }) => cells.clone(),
            other => panic!("{other:?} in {:?}", o.channels.keys()),
        }
    };
    assert!(unit(&mut run).is_empty(), "it holds nothing yet");
    // The developer lets it the shop's workplace: offered, it is not yet the builder's to be in.
    let offer = direct("developer-system", Some("developer"), serde_json::from_value(json!([
        {"block": "propose_agreement", "speaks_for": "devco", "ref": "lease", "terms": {"template": "lease", "parties": ["devco", "buildco"], "term": 365 * DAY,
            "commitments": [{"who": "devco", "does": {"outcome": {"occupancy": {"who": "buildco", "in": "s-shop/workplace.1"}}}}, {"who": "buildco", "does": {"outcome": {"money": {"to": "acc-devco", "amount": "100"}}}, "every": 30 * DAY}]}},
        {"block": "sign_agreement", "agreement": "$lease", "as": "devco"}])).unwrap()).unwrap();
    let r = step(&mut run, &offer).unwrap();
    let id = r.events.iter().find_map(|e| match &e.body { EventBody::Recorded { record } if matches!(record.body, oikos_kernel::blocks::RecordBody::Agreement { .. }) => Some(record.id), _ => None }).expect("the lease made");
    assert!(unit(&mut run).is_empty(), "offered, not held");
    let sign = direct("builder-system", Some("builder"), serde_json::from_value(json!([{"block": "sign_agreement", "agreement": id, "as": "buildco"}])).unwrap()).unwrap();
    step(&mut run, &sign).unwrap();
    // In force: the shop's ground, and who is in it, by name; nothing else.
    let cells = unit(&mut run);
    assert_eq!(cells.iter().map(|c| c.cell.as_str()).collect::<Vec<_>>(), vec!["cell.0.2"]);
    let sp = cells[0].structure.as_ref().unwrap().spaces.iter().find(|s| s.space == "s-shop/workplace.1").cloned().unwrap();
    assert_eq!(sp.occupants, Some(vec!["carol".into()]));
}

#[test]
fn the_contract_examples_load_or_are_refused_as_they_say() {
    let dir = |kind: &str| contracts_dir().join(format!("examples/{kind}/world-config"));
    let load = |p: &std::path::Path| Run::start(serde_json::from_slice(&std::fs::read(p).unwrap()).unwrap(), "knowing-examples", Vec::new(), None).err().map(|e| format!("{e:?}"));
    // The hamlet with every way of knowing loads; each world a schema can't rule out is refused when it's loaded, and
    // not for being malformed.
    assert_eq!(load(&dir("valid").join("knowing-four-ways.json")), None);
    let mut n = 0;
    for f in std::fs::read_dir(dir("refused")).unwrap().map(|f| f.unwrap().path()) {
        let why = load(&f).unwrap_or_else(|| panic!("{} should be refused", f.display()));
        assert!(!why.contains("violates the contract"), "{}: refused by the schema, not by the kernel's check: {why}", f.display());
        n += 1;
    }
    assert!(n >= 9);
    // And each world the schema rules out is refused there.
    for f in std::fs::read_dir(dir("invalid")).unwrap().map(|f| f.unwrap().path()) {
        assert!(load(&f).is_some(), "{} should not load", f.display());
    }
}

#[test]
fn the_keepers_and_what_is_published_are_declared_and_checked() {
    let bad = |edit: &dyn Fn(&mut Value)| {
        let mut c = base();
        edit(&mut c);
        refused(c)
    };
    assert!(bad(&|c| c["knowing"]["keepers"][0]["entity"] = json!("nobody")).contains("nobody"));
    assert!(!bad(&|c| c["knowing"]["keepers"][0]["why"] = json!("Because.")).is_empty(), "a keeper says why, in a sentence");
    assert!(bad(&|c| c["knowing"]["keepers"].as_array_mut().unwrap().push(json!({"entity": "city", "what": "lot", "why": "The town's registry makes the plan of each lot, said twice."}))).contains("twice"));
    assert!(bad(&|c| c["knowing"]["published"].as_array_mut().unwrap().push(json!({"what": "lot", "why": "Published as well as kept."}))).contains("one or the other"));
    assert!(bad(&|c| c["knowing"]["published"].as_array_mut().unwrap().push(json!({"what": "law", "why": "The law, said twice."}))).contains("twice"));
    assert!(!bad(&|c| c["knowing"]["keepers"][0]["answers"] = json!([{"by": "at"}])).is_empty(), "a keeper answers by what names a subject, not by when");
    // A board is read on request.
    let board = |on_request: bool| {
        let mut c = with_channel(None, if on_request { json!({"id": "x", "kind": "records", "way": "published", "match": {"statement_kinds": ["job_posting"]}, "on_request": true}) } else { json!({"id": "x", "kind": "records", "way": "published", "match": {"statement_kinds": ["job_posting"]}}) });
        c["knowing"]["published"].as_array_mut().unwrap().push(json!({"what": "job_posting", "why": "Jobs are advertised to whoever is looking.", "board": true, "most": 2}));
        c
    };
    assert!(refused(board(false)).contains("on request"));
    assert_eq!(refused(board(true)), "");
}

#[test]
fn a_board_is_read_a_few_at_a_time() {
    let mut c = with_channel(None, json!({"id": "jobs", "kind": "records", "way": "published", "match": {"statement_kinds": ["job_posting"]}, "on_request": true}));
    c["knowing"]["published"].as_array_mut().unwrap().push(json!({"what": "job_posting", "why": "Jobs are advertised to whoever is looking.", "board": true, "most": 2}));
    let mut run = Run::start(c, "knowing-board", Vec::new(), None).unwrap();
    for i in 0..5 {
        let cmd = direct("developer-system", Some("developer"), serde_json::from_value(json!([{"block": "publish", "kind": "job_posting", "text": format!("Job {i}."), "speaks_for": "devco", "data": {"wage": 100 + i}}])).unwrap()).unwrap();
        step(&mut run, &cmd).unwrap();
    }
    let read = |o: &Observation| match o.channels.get("jobs") {
        Some(ChannelData::Records { records, .. }) => records.len(),
        _ => 0,
    };
    // Never shown, and not read through: a look must search it, and gets at most the board's `most`.
    assert_eq!(read(&run.command(&Command::Observe { participant: "alice-self".into(), only: None }).unwrap().observation.unwrap()), 0);
    assert!(look(&mut run, "alice-self", json!([{"channel": "jobs"}])).unwrap_err().contains("searching"));
    assert_eq!(read(&look(&mut run, "alice-self", json!([{"channel": "jobs", "query": {"standing": true, "limit": 50}}])).unwrap()), 2);
    assert_eq!(read(&look(&mut run, "alice-self", json!([{"channel": "jobs", "query": {"where": [{"field": "data.wage", "op": "=", "value": 103}]}}])).unwrap()), 1);
    // A place that holds a list equals a value the list has, and differs from one it has not.
    let cmd = direct("developer-system", Some("developer"), serde_json::from_value(json!([{"block": "publish", "kind": "job_posting", "text": "Job at two sites.", "speaks_for": "devco", "data": {"wage": 1, "sites": ["s-shop", "s-house"]}}])).unwrap()).unwrap();
    step(&mut run, &cmd).unwrap();
    assert_eq!(read(&look(&mut run, "alice-self", json!([{"channel": "jobs", "query": {"where": [{"field": "data.sites", "op": "=", "value": "s-house"}]}}])).unwrap()), 1);
    assert_eq!(read(&look(&mut run, "alice-self", json!([{"channel": "jobs", "query": {"where": [{"field": "data.sites", "op": "=", "value": "s-flats"}]}}])).unwrap()), 0);
    assert_eq!(read(&look(&mut run, "alice-self", json!([{"channel": "jobs", "query": {"where": [{"field": "data.sites", "op": "!=", "value": "s-flats"}, {"field": "data.wage", "op": "=", "value": 1}]}}])).unwrap()), 1);
}

#[test]
fn the_directory_is_a_look_up() {
    let mut run = Run::start(base(), "knowing-who", Vec::new(), None).unwrap();
    let dir = |o: &Observation| match o.channels.get("who") {
        Some(ChannelData::Directory { entities, positions }) => (entities.iter().map(|e| e.entity).collect::<Vec<_>>(), positions.iter().map(|p| p.position).collect::<Vec<_>>()),
        None => (vec!["(nothing)".into()], vec![]),
        other => panic!("{other:?}"),
    };
    // Nothing of it comes unasked, and a look that names nobody is refused.
    let o = run.command(&Command::Observe { participant: "alice-self".into(), only: None }).unwrap().observation.unwrap();
    assert!(!o.channels.contains_key("who"));
    assert!(look(&mut run, "alice-self", json!([{"channel": "who"}])).unwrap_err().contains("whom"));
    assert!(look(&mut run, "alice-self", json!([{"channel": "who", "who": {}}])).is_err());
    assert!(look(&mut run, "alice-self", json!([{"channel": "who", "who": {"entity": "bob", "position": "mayor"}}])).is_err(), "one thing at a time");
    assert!(look(&mut run, "alice-self", json!([{"channel": "who", "who": {"role": "mayor"}}])).is_err(), "whose office?");
    assert!(look(&mut run, "alice-self", json!([{"channel": "mine", "who": {"entity": "bob"}}])).is_err(), "only a directory is looked up in");
    // One entity; the person a participant acts as; one position and who holds it; by exact name.
    assert_eq!(dir(&look(&mut run, "alice-self", json!([{"channel": "who", "who": {"entity": "bob"}}])).unwrap()), (vec!["bob".into()], vec![]));
    assert_eq!(dir(&look(&mut run, "alice-self", json!([{"channel": "who", "who": {"participant": "bob-self"}}])).unwrap()), (vec!["bob".into()], vec![]));
    assert_eq!(dir(&look(&mut run, "alice-self", json!([{"channel": "who", "who": {"position": "mayor"}}])).unwrap()), (vec![], vec!["mayor".into()]));
    assert_eq!(dir(&look(&mut run, "alice-self", json!([{"channel": "who", "who": {"name": "carol"}}])).unwrap()), (vec!["carol".into()], vec![]));
    assert_eq!(dir(&look(&mut run, "alice-self", json!([{"channel": "who", "who": {"name": "Clerk"}}])).unwrap()), (vec![], vec!["clerk".into()]));
    // Nobody of that name, no such office: an empty answer, not an error and not everyone.
    assert_eq!(dir(&look(&mut run, "alice-self", json!([{"channel": "who", "who": {"name": "car"}}])).unwrap()), (vec![], vec![]));
    assert_eq!(dir(&look(&mut run, "alice-self", json!([{"channel": "who", "who": {"entity": "nobody"}}])).unwrap()), (vec![], vec![]));
    // An organisation's holders of one office (the positions of that role), and never the rest of its offices.
    let mut c = base();
    for p in c["positions"].as_array_mut().unwrap().iter_mut().filter(|p| p["id"] == "mayor" || p["id"] == "clerk") {
        p["role"] = json!(if p["id"] == "mayor" { "mayor" } else { "council_clerk" });
    }
    let mut run = Run::start(c, "knowing-who", Vec::new(), None).unwrap();
    assert_eq!(dir(&look(&mut run, "alice-self", json!([{"channel": "who", "who": {"entity": "city", "role": "council_clerk"}}])).unwrap()), (vec![], vec!["clerk".into()]));
    assert_eq!(dir(&look(&mut run, "alice-self", json!([{"channel": "who", "who": {"entity": "city", "role": "treasurer"}}])).unwrap()), (vec![], vec![]));
}

#[test]
fn a_register_answers_by_holder_only_those_it_is_bound_to() {
    // The developer is listed for a search by holder in this world (`knowing.keepers`: `to`); alice is not, and her
    // channel onto the titles could not even name the field (the first test). The developer asks whose a holder's
    // titles are and gets them, at most as many as the keeper gives at once.
    let c = with_channel(Some("developer"), json!({"id": "titles", "kind": "records", "way": "ask", "of": "city", "by": ["holder", "id"], "match": {"records": ["claim"]}, "on_request": true}));
    let mut run = Run::start(c, "knowing-holder", Vec::new(), None).unwrap();
    let titles = |o: &Observation| match o.channels.get("developer/titles") {
        Some(ChannelData::Records { records, .. }) => records.iter().map(|r| r.id).collect::<Vec<_>>(),
        _ => vec![],
    };
    let o = look(&mut run, "developer-system", json!([{"channel": "developer/titles", "query": {"where": [{"field": "holder", "op": "=", "value": "city"}], "order": {"field": "id"}, "limit": 200}}])).unwrap();
    assert_eq!(titles(&o), ["title-lot-a", "title-lot-d", "title-lot-g"]);
    assert!(look(&mut run, "developer-system", json!([{"channel": "developer/titles", "query": {"where": [{"field": "holder", "op": "!=", "value": ""}]}}])).is_err(), "everyone's titles is not a question about one holder");
}

#[test]
fn going_to_look_takes_time_and_shows_what_is_there_then() {
    // A world with travel: 600 seconds a cell. Half an hour to look at a place.
    let mut c = base();
    c["catalogue"]["travel"] = json!({"seconds_per_cell": 600});
    c["knowing"]["visit_seconds"] = json!(1800);
    let mut run = Run::start(c.clone(), "knowing-visit", Vec::new(), None).unwrap();
    // Alice (at home in s-house, cell 1.1) goes to look at the flats (cell 0.0): two cells there, two back, and half
    // an hour there.
    let looks: Vec<oikos_kernel::config::LookRequest> = serde_json::from_value(json!([{"channel": "town", "visit": {"places": ["s-flats"]}}])).unwrap();
    let out = run.command(&Command::Look { participant: "alice-self".into(), only: None, looks: looks.clone() }).unwrap();
    let (starts, done) = out.events.iter().find_map(|e| match &e.body {
        EventBody::VisitStarted { starts, done, places, .. } => {
            assert_eq!(places, &vec![oikos_kernel::blocks::Id::new("s-flats")]);
            Some((*starts, *done))
        }
        _ => None,
    }).expect("she sets out");
    assert_eq!((starts, done), (0, 2 * 600 + 2 * 600 + 1800));
    assert!(!out.observation.unwrap().channels.contains_key("town"), "nothing is seen until she has been");
    // While she is on her way, bob (who lives there) leaves the world: what she sees is the flats as she finds them.
    run.command(&Command::Advance { to: 1000 }).unwrap();
    let cmd = direct("bob-self", None, serde_json::from_value(json!([{"block": "leave"}])).unwrap()).unwrap();
    step(&mut run, &cmd).unwrap();
    run.command(&Command::Advance { to: done }).unwrap();
    let o = run.command(&Command::Observe { participant: "alice-self".into(), only: None }).unwrap().observation.unwrap();
    let Some(ChannelData::Sites { as_of, cells, visited, .. }) = o.channels.get("town") else { panic!("{:?}", o.channels.keys()) };
    assert_eq!((*as_of, *visited), (done, Some(true)));
    assert_eq!(cells.iter().map(|c| c.cell.as_str()).collect::<Vec<_>>(), ["cell.0.0", "cell.1.0"], "the building's footprint, and nothing else");
    let home = cells[0].structure.as_ref().unwrap().spaces.iter().find(|sp| sp.space == "s-flats/dwelling.1").unwrap();
    assert_eq!((home.count, home.occupants.as_ref()), (0, None), "from outside, she sees it is empty, not who lived there");
    // It is delivered once: her next observation has nothing of it.
    let o = run.command(&Command::Observe { participant: "alice-self".into(), only: None }).unwrap().observation.unwrap();
    assert!(!o.channels.contains_key("town"));
    // It was her time: a second visit begun while she is away starts when she is back.
    let mut run = Run::start(c.clone(), "knowing-visit", Vec::new(), None).unwrap();
    run.command(&Command::Look { participant: "alice-self".into(), only: None, looks: looks.clone() }).unwrap();
    let out = run.command(&Command::Look { participant: "alice-self".into(), only: None, looks }).unwrap();
    assert!(out.events.iter().any(|e| matches!(&e.body, EventBody::VisitStarted { starts, .. } if *starts == 4200)));
    // An office with no premises in the world comes in from the nearest edge of the ground and goes back out; one let
    // in (its channel says who is there by name) sees who.
    let mut c2 = c.clone();
    let mayor = c2["positions"].as_array_mut().unwrap().iter_mut().find(|p| p["id"] == "mayor").unwrap();
    mayor["channels"].as_array_mut().unwrap().push(json!({"id": "calls", "kind": "sites", "way": "visit", "occupants": "names"}));
    let mut run = Run::start(c2, "knowing-visit", Vec::new(), None).unwrap();
    let looks = serde_json::from_value(json!([{"channel": "mayor/calls", "visit": {"places": ["s-house", "cell.2.1"]}}])).unwrap();
    let out = run.command(&Command::Look { participant: "mayor-system".into(), only: None, looks }).unwrap();
    let done = out.events.iter().find_map(|e| match &e.body {
        EventBody::VisitStarted { done, .. } => Some(*done),
        _ => None,
    }).unwrap();
    // In to cell 1.1 from the edge (one cell in), across to 2.1 (one cell), out from 2.1 (one cell in from the east
    // edge of a 4 by 3 ground): three cells' travel, and two places looked at.
    assert_eq!(done, 3 * 600 + 2 * 1800);
    run.command(&Command::Advance { to: done }).unwrap();
    let o = run.command(&Command::Observe { participant: "mayor-system".into(), only: None }).unwrap().observation.unwrap();
    let Some(ChannelData::Sites { cells, .. }) = o.channels.get("mayor/calls") else { panic!() };
    assert_eq!(cells.len(), 2);
    assert_eq!(cells[0].structure.as_ref().unwrap().spaces[0].occupants, Some(vec!["alice".into()]));
    assert!(cells[1].structure.is_none());
    // A visit that names nowhere, too many places, or only somewhere that isn't: refused, and nobody sets out.
    let none = |run: &mut Run<Vec<u8>>, looks: Value| look(run, "mayor-system", looks).is_err();
    assert!(none(&mut run, json!([{"channel": "mayor/calls"}])));
    assert!(none(&mut run, json!([{"channel": "mayor/calls", "visit": {"places": []}}])));
    assert!(none(&mut run, json!([{"channel": "mayor/calls", "visit": {"places": ["nowhere"]}}])));
    assert!(none(&mut run, json!([{"channel": "mayor/street", "visit": {"places": ["s-house"]}}])), "what is here is seen, not gone to");
    assert!(none(&mut run, json!([{"channel": "mayor/calls", "visit": {"places": (0..17).map(|_| "s-house").collect::<Vec<_>>()}}])));
    // Somewhere that is, with somewhere that isn't: they set out for what is there, and pass the other by.
    assert!(!none(&mut run, json!([{"channel": "mayor/calls", "visit": {"places": ["s-house", "nowhere"]}}])));
}

#[test]
fn those_who_work_on_a_building_see_it_and_a_neighbour_sees_someone_leave_but_not_who() {
    let mut run = Run::start(base(), "knowing-seen", Vec::new(), None).unwrap();
    // Carol mends the house from the shop: the outcome of the work says what the house is like as she leaves it.
    let cmd = direct("developer-system", Some("developer"), serde_json::from_value(json!([{"block": "work", "task": "mend", "units": 1, "at": "s-shop", "performers": ["carol"], "on": "s-house"}])).unwrap()).unwrap();
    step(&mut run, &cmd).unwrap();
    let o = run.command(&Command::Observe { participant: "developer-system".into(), only: None }).unwrap().observation.unwrap();
    let seen = o.outcomes.last().and_then(|x| x.seen.first()).expect("the crew was there");
    assert_eq!(o.outcomes.last().unwrap().seen.len(), 1);
    assert_eq!(seen.structure, "s-house");
    assert!(seen.variables.as_ref().is_some_and(|v| v.contains_key("wear")));
    assert_eq!(seen.spaces[0].occupants, None, "at someone else's house they see how many, not who");
    // Alice lives next to the flats. From outside she sees how many are in bob's flat, and nobody leaving yet.
    let flat = |o: &Observation| match o.channels.get("street") {
        Some(ChannelData::Sites { cells, .. }) => cells.iter().filter_map(|c| c.structure.as_ref()).flat_map(|s| s.spaces.iter()).find(|sp| sp.space == "s-flats/dwelling.1").cloned(),
        _ => None,
    };
    let before = flat(&run.command(&Command::Observe { participant: "alice-self".into(), only: None }).unwrap().observation.unwrap()).unwrap();
    assert_eq!((before.count, before.seen_leaving, before.left.is_none()), (1, None, true));
    assert_eq!(before.seen_entering, Some(0), "he was in from the start: seen going in, never who");
    // Bob goes from the world: she sees that someone left, and when; never who.
    run.command(&Command::Advance { to: DAY }).unwrap();
    let cmd = direct("bob-self", None, serde_json::from_value(json!([{"block": "leave"}])).unwrap()).unwrap();
    step(&mut run, &cmd).unwrap();
    let after = flat(&run.command(&Command::Observe { participant: "alice-self".into(), only: None }).unwrap().observation.unwrap()).unwrap();
    assert_eq!((after.count, after.left.is_none()), (0, true));
    assert!(after.seen_leaving.is_some_and(|t| t >= DAY));
}

#[test]
fn a_visit_is_the_same_every_time() {
    let go = || {
        let mut c = base();
        c["catalogue"]["travel"] = json!({"seconds_per_cell": 600});
        let mut run = Run::start(c, "knowing-visit", Vec::new(), None).unwrap();
        let cells = go_and_see(&mut run, "alice-self", "town", &["s-flats", "cell.2.1", "s-shop"]);
        run.command(&Command::Advance { to: 3 * DAY }).unwrap();
        (serde_json::to_string(&cells).unwrap(), run.kernel().state_hash())
    };
    assert_eq!(go(), go());
}

#[test]
fn a_keeper_answers_in_its_own_time_a_clerk_slowly_and_a_system_fast() {
    // Foundations F11 (docs/design/foundations.md law 7): a question put to a register's keeper is its performer's work, and
    // takes the performer's time. The world's table of work names the seconds an answer takes (`answer`), for a person and for
    // a system; the keeper's own posts say who answers. A world with no row for it is answered at once, as it always was.
    let titles = json!({"id": "titles", "kind": "records", "way": "ask", "of": "city", "by": ["holder", "id"], "match": {"records": ["claim"]}, "on_request": true});
    let ask = |a: &str| json!([{"channel": "developer/titles", "query": {"where": [{"field": "holder", "op": "=", "value": a}], "order": {"field": "id"}, "limit": 200}}]);
    let got = |o: &Observation| match o.channels.get("developer/titles") {
        Some(ChannelData::Records { records, .. }) => records.iter().map(|r| r.id).collect::<Vec<_>>(),
        _ => vec![],
    };
    let asked = |run: &mut Run<Vec<u8>>| -> (Observation, Vec<(i64, i64, String)>) {
        let looks = serde_json::from_value(ask("city")).unwrap();
        let out = run.command(&Command::Look { participant: "developer-system".into(), only: None, looks }).unwrap();
        let by = out.events.iter().filter_map(|e| match &e.body { EventBody::AskStarted { starts, done, by, .. } => Some((*starts, *done, by.to_string())), _ => None }).collect();
        (out.observation.unwrap(), by)
    };
    // No row: at once.
    let mut run = Run::start(with_channel(Some("developer"), titles.clone()), "knowing-ask-0", Vec::new(), None).unwrap();
    let (o, by) = asked(&mut run);
    assert!(by.is_empty());
    assert_eq!(got(&o), ["title-lot-a", "title-lot-d", "title-lot-g"]);
    // The keeper's posts are held by systems that answer in two minutes: nothing now, the answer at two minutes, once.
    let mut c = with_channel(Some("developer"), titles.clone());
    c["orchestration"]["act_time"]["system"]["answer"] = json!(120);
    let mut run = Run::start(c, "knowing-ask-1", Vec::new(), None).unwrap();
    let (o, by) = asked(&mut run);
    assert_eq!(by.len(), 1);
    assert_eq!((by[0].0, by[0].1), (0, 120));
    assert!(got(&o).is_empty(), "not answered yet");
    assert_eq!(o.asking, ["developer/titles"], "and it says a question is out");
    run.command(&Command::Advance { to: 119 }).unwrap();
    let o = run.command(&Command::Observe { participant: "developer-system".into(), only: None }).unwrap().observation.unwrap();
    assert!(got(&o).is_empty());
    assert_eq!(o.asking, ["developer/titles"]);
    let r = run.command(&Command::Advance { to: 120 }).unwrap();
    assert!(r.events.iter().any(|e| matches!(&e.body, EventBody::AskAnswered { participant, .. } if participant == "developer-system")));
    let o = run.command(&Command::Observe { participant: "developer-system".into(), only: None }).unwrap().observation.unwrap();
    assert_eq!(got(&o), ["title-lot-a", "title-lot-d", "title-lot-g"], "as the register is when it is answered");
    assert!(o.asking.is_empty());
    let o = run.command(&Command::Observe { participant: "developer-system".into(), only: None }).unwrap().observation.unwrap();
    assert!(got(&o).is_empty(), "given once");
    // Two questions together: the keeper's two systems answer one each, at once; a third waits behind the first free.
    let (_, a) = asked(&mut run);
    let (_, b) = asked(&mut run);
    let (_, c3) = asked(&mut run);
    let ends: Vec<i64> = [&a, &b, &c3].iter().map(|x| x[0].1).collect();
    assert_eq!(ends, vec![240, 240, 360]);
    // One clerk, a person, who is paid for ten minutes an answer: the second question waits for the first.
    let mut c = with_channel(Some("developer"), titles);
    c["orchestration"]["act_time"]["person"]["answer"] = json!(600);
    for s in ["mayor-system", "finance-system"] {
        c["participants"].as_array_mut().unwrap().retain(|p| p["id"] != s);
    }
    let mut c = c;
    for pos in c["positions"].as_array_mut().unwrap().iter_mut().filter(|p| p["entity"] == "city") {
        pos["holder"] = json!("alice-self");
    }
    let mut run = Run::start(c, "knowing-ask-2", Vec::new(), None).unwrap();
    let (_, a) = asked(&mut run);
    let (_, b) = asked(&mut run);
    assert_eq!((a[0].0, a[0].1, a[0].2.as_str()), (0, 600, "alice-self"));
    assert_eq!((b[0].0, b[0].1), (600, 1200), "one clerk answers one at a time");
}

#[test]
fn an_advance_to_news_stops_where_a_keeper_answers_an_office() {
    // Foundations F11: an answer comes at no one's wake, so the clock must stop at it for the office that asked to be woken then (and not at
    // whichever wake comes next, which in a pilot and in its twin is another unit's, at another second).
    let titles = json!({"id": "titles", "kind": "records", "way": "ask", "of": "city", "by": ["holder", "id"], "match": {"records": ["claim"]}, "on_request": true});
    let mut c = with_channel(Some("developer"), titles);
    c["orchestration"]["act_time"]["system"]["answer"] = json!(120);
    let mut run = Run::start(c, "knowing-ask-news", Vec::new(), None).unwrap();
    let looks = serde_json::from_value(json!([{"channel": "developer/titles", "query": {"where": [{"field": "holder", "op": "=", "value": "city"}], "limit": 200}}])).unwrap();
    run.command(&Command::Look { participant: "developer-system".into(), only: None, looks }).unwrap();
    run.command(&Command::AdvanceToNews { to: 10_000 }).unwrap();
    assert_eq!(run.kernel().t(), 120, "it stops where the answer is");
    run.command(&Command::AdvanceToNews { to: 10_000 }).unwrap();
    assert_eq!(run.kernel().t(), 10_000);
}

/// Review of the foundations, finding 4: an answer needs a performer who is there and on duty, and counts against their working
/// day; a keeper with nobody in post does not answer at once and for free.
#[test]
fn an_answer_needs_a_performer_present_and_on_duty_and_counts_against_the_day() {
    let titles = json!({"id": "titles", "kind": "records", "way": "ask", "of": "city", "by": ["holder", "id"], "match": {"records": ["claim"]}, "on_request": true});
    let got = |o: &Observation| match o.channels.get("developer/titles") {
        Some(ChannelData::Records { records, .. }) => records.iter().map(|r| r.id).collect::<Vec<_>>(),
        _ => vec![],
    };
    let ask = |run: &mut Run<Vec<u8>>| {
        let looks = serde_json::from_value(json!([{"channel": "developer/titles", "query": {"where": [{"field": "holder", "op": "=", "value": "city"}], "order": {"field": "id"}, "limit": 200}}])).unwrap();
        let out = run.command(&Command::Look { participant: "developer-system".into(), only: None, looks }).unwrap();
        let started = out.events.iter().filter(|e| matches!(e.body, EventBody::AskStarted { .. })).count();
        (out.observation.unwrap(), started)
    };
    let observe = |run: &mut Run<Vec<u8>>| run.command(&Command::Observe { participant: "developer-system".into(), only: None }).unwrap().observation.unwrap();
    // One clerk holds every post of the city; the world says work is done in a workplace; an answer is ten minutes of hers.
    let mut c = with_channel(Some("developer"), titles);
    c["orchestration"]["act_time"]["person"]["answer"] = json!(600);
    c["orchestration"]["performers_in"] = json!("workplace");
    for s in ["mayor-system", "finance-system"] {
        c["participants"].as_array_mut().unwrap().retain(|p| p["id"] != s);
    }
    for pos in c["positions"].as_array_mut().unwrap().iter_mut().filter(|p| p["entity"] == "city") {
        pos["holder"] = json!("alice-self");
    }
    let mut run = Run::start(c, "knowing-ask-3", Vec::new(), None).unwrap();
    // She is at home, not at work: nobody answers. The question is held, not answered at once.
    let (o, started) = ask(&mut run);
    assert_eq!(started, 0, "nobody was on duty to start it");
    assert!(got(&o).is_empty(), "answered at once with nobody there");
    assert_eq!(o.asking, ["developer/titles"]);
    run.command(&Command::Advance { to: 5 * 3_600 }).unwrap();
    assert!(got(&observe(&mut run)).is_empty(), "still nobody there");
    // She goes to a workplace: the next hour's look takes the question up, and ten minutes later it is answered.
    run.command(&direct("alice-self", None, serde_json::from_value(json!([{"block": "vacate", "occupant": "alice", "from": "s-house"}, {"block": "occupy", "space": "s-shop/workplace.1", "who": "alice"}])).unwrap()).unwrap()).unwrap();
    run.command(&Command::Advance { to: 5 * 3_600 + 3_600 + 3_600 }).unwrap();
    let o = observe(&mut run);
    assert_eq!(got(&o), ["title-lot-a", "title-lot-d", "title-lot-g"], "answered once she was there: {:?}", o.asking);
    // Her answers count against her working day (eight hours here): the 48th is the last it has room for, the next is held.
    let mut answered = 0;
    for _ in 0..60 {
        let (_, started) = ask(&mut run);
        if started == 0 {
            break;
        }
        answered += 1;
    }
    assert_eq!(answered, 47, "the 48th answer of ten minutes fills eight hours with the first: the rest wait");
    assert_eq!(run.kernel().state().timelines["alice"].worked, Some((0, 8 * 3_600)), "and they were counted against her day");
}

/// Review of the foundations, finding 4: a registry whose posts have fallen vacant is not faster than a staffed one.
#[test]
fn a_keeper_with_every_post_vacant_does_not_answer_at_once() {
    let titles = json!({"id": "titles", "kind": "records", "way": "ask", "of": "city", "by": ["holder", "id"], "match": {"records": ["claim"]}, "on_request": true});
    let mut c = with_channel(Some("developer"), titles);
    c["orchestration"]["act_time"]["system"]["answer"] = json!(120);
    for pos in c["positions"].as_array_mut().unwrap().iter_mut().filter(|p| p["entity"] == "city") {
        pos.as_object_mut().unwrap().remove("holder");
    }
    let mut run = Run::start(c, "knowing-ask-4", Vec::new(), None).unwrap();
    let looks = serde_json::from_value(json!([{"channel": "developer/titles", "query": {"where": [{"field": "holder", "op": "=", "value": "city"}], "order": {"field": "id"}, "limit": 200}}])).unwrap();
    let o = run.command(&Command::Look { participant: "developer-system".into(), only: None, looks }).unwrap().observation.unwrap();
    assert!(!matches!(o.channels.get("developer/titles"), Some(ChannelData::Records { records, .. }) if !records.is_empty()), "answered at once with nobody in post");
    assert_eq!(o.asking, ["developer/titles"]);
}

/// Bug hunt 2026-10-17, finding 6: two answers from one register's keeper, arriving together, are both shown.
#[test]
fn two_answers_from_one_keeper_arriving_together_are_both_shown() {
    let titles = json!({"id": "titles", "kind": "records", "way": "ask", "of": "city", "by": ["holder", "id"], "match": {"records": ["claim"]}, "on_request": true});
    let mut c = with_channel(Some("developer"), titles);
    c["orchestration"]["act_time"]["system"]["answer"] = json!(120);
    let mut run = Run::start(c, "knowing-two-answers", Vec::new(), None).unwrap();
    for holder in ["city", "devco"] {
        let looks = serde_json::from_value(json!([{"channel": "developer/titles", "query": {"where": [{"field": "holder", "op": "=", "value": holder}], "order": {"field": "id"}, "limit": 200}}])).unwrap();
        run.command(&Command::Look { participant: "developer-system".into(), only: None, looks }).unwrap();
    }
    run.command(&Command::Advance { to: 120 }).unwrap();
    let o = run.command(&Command::Observe { participant: "developer-system".into(), only: None }).unwrap().observation.unwrap();
    let ids: Vec<String> = match o.channels.get("developer/titles") {
        Some(ChannelData::Records { records, .. }) => records.iter().map(|r| r.id).map(|x| x.to_string()).collect(),
        other => panic!("{other:?}"),
    };
    assert!(ids.contains(&"title-lot-a".to_string()), "the first answer: {ids:?}");
    assert!(ids.contains(&"title-lot-b".to_string()), "the second answer was lost: {ids:?}");
}
