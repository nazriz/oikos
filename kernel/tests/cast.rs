//! The cast of a world changes (v0.4, docs/design/v0.4-cast-and-land.md):
//! bodies arrive, leave, are born, fall ill, are injured and die, by physics;
//! participants come into being from templates and end; positions are created
//! and change hands, only by the organisation's own act. Nothing here is a
//! game rule: no spawning, no automatic succession, no health meter.

mod common;

use common::*;
use serde_json::{json, Value};
use oikos_kernel::events::{EventBody, RefusalCode};
use oikos_kernel::observe::{ChannelData, Observation};
use oikos_kernel::run::{Response, Run};
use oikos_kernel::state::{ConditionKind, DeathCause, ParticipantStatus};
use oikos_kernel::Command;

const DAY: i64 = 86_400;

fn town() -> Run<Vec<u8>> {
    Run::start(world(&default_params()), "cast", Vec::new(), None).unwrap()
}

fn act(run: &mut Run<Vec<u8>>, participant: &str, position: Option<&str>, blocks: Value) -> Response {
    run.done(&Command::Act {
        participant: participant.into(),
        position: position.map(String::from),
        blocks: serde_json::from_value(blocks).unwrap(),
        by: vec![],
        provenance: json!({"via": "direct"}),
        reasoning: None,
        thinking: None,
    })
    .unwrap()
}

fn refusal(r: &Response) -> Option<RefusalCode> {
    match &r.events[0].body {
        EventBody::ActionRefused { code, .. } => Some(*code),
        _ => None,
    }
}

fn observe(run: &mut Run<Vec<u8>>, p: &str) -> Observation {
    run.command(&Command::Observe { participant: p.into(), only: None }).unwrap().observation.unwrap()
}

fn created(r: &Response) -> Vec<(String, String)> {
    r.events
        .iter()
        .filter_map(|e| match &e.body {
            EventBody::PersonCreated { person, participant: Some(p), .. } => Some((person.clone(), p.clone())),
            _ => None,
        })
        .collect()
}

#[test]
fn someone_arrives_from_outside_carrying_their_money_and_can_leave_and_come_back() {
    let mut run = town();
    let total = run.kernel().state().total_money();
    // Only the outside world brings people in.
    let newcomer = json!([{"block": "arrive", "name": "Dana", "born_at": -28 * YEAR, "template": "newcomer", "carrying": "250000", "ref": "d"}]);
    assert_eq!(refusal(&act(&mut run, "mayor-system", Some("mayor"), newcomer.clone())), Some(RefusalCode::NotTheirs));
    let r = act(&mut run, "outside-system", Some("outside-trade"), newcomer);
    assert_eq!(refusal(&r), None);
    let (dana, par) = created(&r)[0].clone();
    let st = run.kernel().state();
    assert!(st.body(&dana).is_some_and(|b| b.present && b.alive));
    assert_eq!(st.participants[&par].person.as_deref(), Some(dana.as_str()));
    // Her traits were drawn from the template's range, and recorded.
    let thrift = st.participants[&par].traits.as_ref().unwrap()["thrift"].as_i64().unwrap();
    assert!((0..=100).contains(&thrift));
    assert_eq!(st.participants[&par].traits.as_ref().unwrap()["lean"], -20);
    assert!(r.events.iter().any(|e| matches!(&e.body, EventBody::ParticipantCreated { participant, traits: Some(_), .. } if *participant == par)));
    // Her money is in an account in her own custody; total money is unchanged (it came from outside).
    let acc = st.accounts.iter().find(|(_, a)| a.holder == dana).map(|(id, a)| (id.clone(), a.balance, a.custodian.clone())).unwrap();
    assert_eq!((acc.1, acc.2.as_str()), (250_000, dana.as_str()));
    assert_eq!(st.total_money(), total);
    // She sees her own body.
    let o = observe(&mut run, &par);
    assert_eq!(o.body.as_ref().map(|b| (b.present, b.alive)), Some((true, true)));

    // She moves in, then leaves the world: out of her home, still owning her money.
    assert_eq!(refusal(&act(&mut run, &par, None, json!([{"block": "occupy", "space": "s-flats/dwelling.2"}]))), None);
    let r = act(&mut run, &par, None, json!([{"block": "leave"}]));
    assert!(r.events.iter().any(|e| matches!(&e.body, EventBody::Vacated { reason: oikos_kernel::events::VacateReason::Departed, .. })));
    let st = run.kernel().state();
    assert!(!st.body(&dana).unwrap().present);
    assert!(st.accounts.contains_key(&acc.0));
    // Outside, she can't go into a space, but she can still act (write, pay from her own money).
    assert_eq!(refusal(&act(&mut run, &par, None, json!([{"block": "occupy", "space": "s-flats/dwelling.2"}]))), Some(RefusalCode::NotPresent));
    assert_eq!(refusal(&act(&mut run, &par, None, json!([{"block": "message", "to": ["alice"], "text": "Hello from abroad."}]))), None);
    // And the outside world can bring her back.
    let r = act(&mut run, "outside-system", Some("outside-trade"), json!([{"block": "arrive", "person": dana}]));
    assert_eq!(refusal(&r), None);
    assert!(run.kernel().state().body(&dana).unwrap().present);
}

#[test]
fn a_child_is_born_after_gestation_where_the_parent_is() {
    let mut run = town();
    // Alice (30) and Bob (25) aren't near each other (flats at the corner, house one diagonal away: they touch). Carol is 40.
    let r = act(&mut run, "alice-self", None, json!([{"block": "birth", "name": "Eve", "template": "child", "with": "bob"}]));
    assert_eq!(refusal(&r), None, "the house and the flats touch, so Alice and Bob are near");
    let due = match &r.events[1].body {
        EventBody::BirthStarted { parents, due } => {
            assert_eq!(parents, &vec!["alice".to_string(), "bob".to_string()]);
            *due
        }
        other => panic!("{other:?}"),
    };
    run.command(&Command::Advance { to: (due / TICK - 1) * TICK }).unwrap();
    assert!(!run.kernel().state().entities.values().any(|e| e.name == "Eve"), "not before it's due");
    let r = run.command(&Command::Advance { to: due }).unwrap();
    let eve = r
        .events
        .iter()
        .find_map(|e| match &e.body {
            EventBody::PersonCreated { person, parents, born_at, .. } => {
                assert_eq!(parents, &vec!["alice".to_string(), "bob".to_string()]);
                assert_eq!(*born_at, due);
                Some(person.clone())
            }
            _ => None,
        })
        .expect("born");
    let b = run.kernel().state().body(&eve).unwrap();
    assert!(b.present && b.alive);
    assert!(run.kernel().state().structures_of(&eve).is_empty(), "a newborn occupies nowhere until someone houses it");
    // A parent moves the child in with them: a body brought into a space by another.
    assert_eq!(refusal(&act(&mut run, "alice-self", None, json!([{"block": "occupy", "space": "s-house/dwelling.1", "who": eve}]))), None);
}

#[test]
fn birth_has_biology() {
    let mut run = town();
    // A newcomer who lives nowhere yet is nowhere in particular: nobody is near them.
    let r = act(&mut run, "outside-system", Some("outside-trade"), json!([{"block": "arrive", "name": "Dana", "born_at": -28 * YEAR, "template": "newcomer", "ref": "d"}]));
    let dana = created(&r)[0].0.clone();
    assert_eq!(refusal(&act(&mut run, "carol-self", None, json!([{"block": "birth", "name": "X", "template": "child", "with": dana}]))), Some(RefusalCode::TooFar));
    assert_eq!(refusal(&act(&mut run, "carol-self", None, json!([{"block": "birth", "name": "X", "template": "newcomer-typo"}]))), Some(RefusalCode::UnknownTemplate));
    // A system has no body.
    assert_eq!(refusal(&act(&mut run, "mayor-system", Some("mayor"), json!([{"block": "birth", "name": "X", "template": "child"}]))), Some(RefusalCode::NotAPerson));
    // Carol ages past 45.
    run.command(&Command::Advance { to: 7 * YEAR }).unwrap();
    if run.kernel().state().body("carol").unwrap().alive {
        assert_eq!(refusal(&act(&mut run, "carol-self", None, json!([{"block": "birth", "name": "X", "template": "child"}]))), Some(RefusalCode::NotFertile));
    }
}

#[test]
fn harm_needs_the_victim_near_and_causes_an_injury() {
    let mut run = town();
    // Carol's shop (row 2) is two rows from Bob's flats (row 0): too far with reach 1? The gap is one cell: within reach.
    let r = act(&mut run, "carol-self", None, json!([{"block": "harm", "person": "bob"}]));
    assert_eq!(refusal(&r), None);
    assert!(r.events.iter().any(|e| matches!(&e.body, EventBody::Harmed { person, .. } if person == "bob")));
    let conditions = &run.kernel().state().body("bob").unwrap().conditions;
    assert_eq!(conditions.len(), 1);
    assert_eq!(conditions[0].kind, ConditionKind::Injury);
    // Someone who has left the world is out of reach.
    act(&mut run, "bob-self", None, json!([{"block": "leave"}]));
    assert_eq!(refusal(&act(&mut run, "carol-self", None, json!([{"block": "harm", "person": "bob"}]))), Some(RefusalCode::NotPresent));
    // A system has no body to harm with.
    assert_eq!(refusal(&act(&mut run, "mayor-system", Some("mayor"), json!([{"block": "harm", "person": "alice"}]))), Some(RefusalCode::NotAPerson));
}

/// A world of many bodies, to check life's rates against its tables.
fn many(n: usize, life: Value, occupied: bool) -> Run<Vec<u8>> {
    let mut c = world(&default_params());
    let ents = c["world"]["entities"].as_array_mut().unwrap();
    for i in 0..n {
        // Everyone turns 31 at the end of the first year, so each year's draws are at the same moment.
        ents.push(json!({"id": format!("p{i}"), "kind": "person", "name": format!("p{i}"), "born_at": -30 * YEAR}));
    }
    if occupied {
        // A dangerous workplace everyone is in.
        c["catalogue"]["structure_types"].as_array_mut().unwrap().push(json!({"id": "mine", "category": "industrial", "build_time": DAY, "footprint": {"w": 1, "h": 1}, "injury_bps": 3000, "spaces": [{"kind": "workplace", "count": 1, "capacity": 100000}]}));
        c["world"]["structures"].as_array_mut().unwrap().push(json!({"id": "s-mine", "at": "cell.2.0", "type": "mine"}));
        let occ = c["world"]["occupancy"].as_array_mut().unwrap();
        for i in 0..n {
            occ.push(json!({"occupant": format!("p{i}"), "space": "s-mine/workplace.1"}));
        }
    }
    c["life"] = life;
    c["clock"]["run_seconds"] = json!(3 * YEAR);
    Run::start(c, "many", Vec::new(), None).unwrap()
}

fn count<F: Fn(&EventBody) -> bool>(run: &mut Run<Vec<u8>>, to: i64, f: F) -> usize {
    run.command(&Command::Advance { to }).unwrap().events.iter().filter(|e| f(&e.body)).count()
}

#[test]
fn deaths_follow_the_life_table() {
    // 10% a year from other causes, from the start (each body's first draw is as it enters the world, for what's left of
    // its year of age; here a whole year, as everyone's birthday is at the start). So by the end of year two, about 190 of
    // 1,000 have died (sd about 12).
    let mut run = many(1000, json!({"year": YEAR, "other_causes": {"by_age": [{"from": 0, "bps": 1000}]}}), false);
    let died = count(&mut run, 2 * YEAR - TICK, |e| matches!(e, EventBody::PersonDied { died_of: DeathCause::Other, .. }));
    assert!((150..=230).contains(&died), "{died} deaths, expected about 190");
    // The dead occupy nothing, and their participants have ended... (these bodies have none)
    let st = run.kernel().state();
    assert!(st.entities.values().filter_map(|e| e.body.as_ref()).filter(|b| !b.alive).count() >= died);
}

#[test]
fn illness_follows_its_table_and_can_kill() {
    let life = json!({"year": YEAR, "illness": {"by_age": [{"from": 0, "bps": 2000}, {"from": 100, "bps": 0}],
        "severity": [{"label": "minor", "share_bps": 5000, "days": [1, 3], "fatal_bps": 0}, {"label": "grave", "share_bps": 5000, "days": [2, 4], "fatal_bps": 5000}]}});
    let mut run = many(1000, life, false);
    let ill = count(&mut run, 2 * YEAR - TICK, |e| matches!(e, EventBody::ConditionBegan { kind: ConditionKind::Illness, .. }));
    // Two years' draws, of those alive at each: about 20% a year fall ill (about 380 in all).
    assert!((320..=440).contains(&ill), "{ill} illnesses, expected about 380");
    let died = run.kernel().state().entities.values().filter_map(|e| e.body.as_ref()).filter(|b| !b.alive).count();
    // Half the illnesses are grave, and half of those kill: about 95.
    assert!((60..=130).contains(&died), "{died} deaths from illness, expected about 95");
}

#[test]
fn a_dangerous_place_injures_the_people_in_it() {
    let life = json!({"year": YEAR, "injury": {"bps": 100, "severity": [{"label": "minor", "share_bps": 10000, "days": [1, 2], "fatal_bps": 0}]}});
    let mut safe = many(1000, life.clone(), false);
    let mut mine = many(1000, life, true);
    let hurt = |e: &EventBody| matches!(e, EventBody::ConditionBegan { kind: ConditionKind::Injury, .. });
    let a = count(&mut safe, 2 * YEAR - TICK, hurt);
    let b = count(&mut mine, 2 * YEAR - TICK, hurt);
    // 1% a year anywhere; in the mine, 1% + 30%.
    // (Two years of it, from the start.)
    assert!(a <= 45, "{a} injured at home, expected about 20");
    assert!((540..=700).contains(&b), "{b} injured in the mine, expected about 620");
}

#[test]
fn when_a_holder_dies_their_positions_fall_vacant_and_nobody_takes_them_automatically() {
    let mut run = town();
    // The city appoints Alice as its clerk.
    assert_eq!(refusal(&act(&mut run, "mayor-system", Some("mayor"), json!([{"block": "appoint", "position": "clerk", "participant": "alice-self"}]))), None);
    let o = observe(&mut run, "alice-self");
    assert!(o.positions.iter().any(|p| p.position == "clerk"));
    assert!(o.channels.contains_key("clerk/laws"), "the office's channels reach its holder");
    // Alice's body dies (a harsh year for her: harmed repeatedly until she dies).
    for i in 0..400 {
        if !run.kernel().state().body("alice").unwrap().alive {
            break;
        }
        act(&mut run, "bob-self", None, json!([{"block": "harm", "person": "alice"}]));
        run.command(&Command::Advance { to: (i + 1) * DAY }).unwrap();
    }
    let st = run.kernel().state();
    assert!(!st.body("alice").unwrap().alive, "she died");
    assert_eq!(st.participants["alice-self"].status, ParticipantStatus::Ended);
    assert_eq!(st.positions["clerk"].holder, None, "her office fell vacant");
    assert!(st.structures_of("alice").is_empty(), "the dead occupy nothing");
    // The dead don't act.
    assert_eq!(refusal(&act(&mut run, "alice-self", None, json!([{"block": "message", "to": ["bob"], "text": "boo"}]))), Some(RefusalCode::ParticipantInactive));
    // Nothing fills the vacancy until someone in the organisation acts.
    run.command(&Command::Advance { to: 500 * DAY }).unwrap();
    assert_eq!(run.kernel().state().positions["clerk"].holder, None);
}

#[test]
fn an_office_changes_hands_and_its_files_go_with_it_not_the_holders_memory() {
    let mut run = town();
    // The outside world, which supplies the system, delivers one to the city; the city appoints it to the clerk's office.
    let r = act(&mut run, "outside-system", Some("outside-trade"), json!([{"block": "deploy", "template": "clerk-bot", "to": "city", "ref": "bot"}]));
    assert_eq!(refusal(&r), None);
    let bot = match &r.events[0].body {
        EventBody::ActionApplied { created: Some(c), .. } => c["bot"].clone(),
        other => panic!("{other:?}"),
    };
    assert_eq!(refusal(&act(&mut run, "mayor-system", Some("mayor"), json!([{"block": "appoint", "position": "clerk", "participant": bot}]))), None);
    // Its first look through the office's channels: everything they cover.
    let o = observe(&mut run, &bot);
    let laws = |o: &Observation| match o.channels.get("clerk/laws") {
        Some(ChannelData::Records { records, .. }) => records.len(),
        _ => 0,
    };
    assert!(laws(&o) > 0);
    assert_eq!(laws(&observe(&mut run, &bot)), 0, "then only what's new");
    // A message to the office reaches whoever holds it.
    act(&mut run, "bob-self", None, json!([{"block": "message", "to": ["clerk"], "text": "Please register my lot."}]));
    assert_eq!(observe(&mut run, &bot).inbox.len(), 1);
    // The city hands the office to Alice: her first look is the office's full picture; the bot no longer sees it.
    act(&mut run, "mayor-system", Some("mayor"), json!([{"block": "appoint", "position": "clerk", "participant": "alice-self"}]));
    assert!(laws(&observe(&mut run, "alice-self")) > 0);
    assert!(!observe(&mut run, &bot).channels.contains_key("clerk/laws"));
    // The bot can't act in an office it no longer holds; the city retires it.
    assert_eq!(refusal(&act(&mut run, &bot, Some("clerk"), json!([{"block": "message", "to": ["bob"], "text": "x"}]))), Some(RefusalCode::NotInPosition));
    assert_eq!(refusal(&act(&mut run, "developer-system", Some("developer"), json!([{"block": "retire", "participant": bot}]))), Some(RefusalCode::NotTheirs));
    assert_eq!(refusal(&act(&mut run, "mayor-system", Some("mayor"), json!([{"block": "retire", "participant": bot}]))), None);
    assert_eq!(run.kernel().state().participants[&bot].status, ParticipantStatus::Ended);
}

#[test]
fn a_new_organisation_gets_its_first_position_and_its_founder_acts_for_it() {
    let mut run = town();
    let r = act(&mut run, "carol-self", None, json!([{"block": "create_entity", "kind": "cooperative", "name": "Carol's Co-op", "first_position": {"title": "Founder", "channels": [{"id": "books", "kind": "accounts"}], "ref": "founder"}, "ref": "coop"}]));
    assert_eq!(refusal(&r), None);
    let (coop, founder) = match &r.events[0].body {
        EventBody::ActionApplied { created: Some(c), .. } => (c["coop"].clone(), c["founder"].clone()),
        other => panic!("{other:?}"),
    };
    assert_eq!(run.kernel().state().positions[&founder].holder.as_deref(), Some("carol-self"));
    // Acting for the co-op: it hires Bob into a new position.
    let r = act(&mut run, "carol-self", Some(&founder), json!([{"block": "create_position", "title": "Manager", "ref": "m"}, {"block": "appoint", "position": "$m", "participant": "bob-self"}]));
    assert_eq!(refusal(&r), None);
    let (m, holder) = {
        let st = run.kernel().state();
        let (id, x) = st.positions.iter().find(|(_, x)| x.entity == coop && x.title.as_deref() == Some("Manager")).unwrap();
        (id.clone(), x.holder.clone())
    };
    assert_eq!(holder.as_deref(), Some("bob-self"));
    // Records made in the office say so.
    let r = act(&mut run, "bob-self", Some(&m), json!([{"block": "publish", "kind": "notice", "speaks_for": coop, "text": "Open Mondays."}]));
    let rec = r.events.iter().find_map(|e| match &e.body {
        EventBody::Recorded { record } => Some(record.clone()),
        _ => None,
    });
    let rec = rec.unwrap();
    assert_eq!((rec.author.as_str(), rec.position.as_deref()), ("bob-self", Some(m.as_str())));
}

#[test]
fn picked_traits_follow_their_weights() {
    // 2,000 newcomers: the share drawn "female" is the template's 48.69% within about four standard errors (±4.5 points).
    let mut run = town();
    let mut female = 0;
    for i in 0..2_000 {
        let r = act(&mut run, "outside-system", Some("outside-trade"), json!([{"block": "arrive", "name": format!("N{i}"), "born_at": -30 * YEAR, "template": "newcomer"}]));
        assert_eq!(refusal(&r), None);
        let (_, par) = created(&r)[0].clone();
        let sex = run.kernel().state().participants[&par].traits.as_ref().unwrap()["sex"].as_str().unwrap().to_string();
        assert!(sex == "female" || sex == "male");
        female += (sex == "female") as usize;
    }
    assert!((884..=1064).contains(&female), "{female} of 2000 drawn female");
}

#[test]
fn a_pick_needs_positive_integer_weights() {
    for bad in [json!({"pick": {}}), json!({"pick": {"a": 0}}), json!({"pick": {"a": -1}}), json!({"pick": {"a": 1.5}}), json!({"pick": [1, 2]})] {
        let t = Some(json!({ "x": bad }));
        assert!(oikos_kernel::config::check_traits("t", &t).is_err(), "{t:?}");
    }
    assert!(oikos_kernel::config::check_traits("t", &Some(json!({"x": {"pick": {"a": 0, "b": 3}}}))).is_ok());
}

/// The test town, with bodies that have a sex (Alice and Carol female, Bob male) and newborns' sex drawn.
fn town_with_sexes() -> Run<Vec<u8>> {
    let mut w = world(&default_params());
    for e in w["world"]["entities"].as_array_mut().unwrap() {
        let sex = match e["id"].as_str().unwrap() {
            "alice" | "carol" => "female",
            "bob" => "male",
            _ => continue,
        };
        e["sex"] = json!(sex);
    }
    w["life"]["birth"]["female_bps"] = json!(4869);
    Run::start(w, "sexes", Vec::new(), None).unwrap()
}

#[test]
fn where_bodies_have_a_sex_only_a_female_body_bears_a_child_and_the_other_parent_is_male() {
    let mut run = town_with_sexes();
    let birth = |with: Option<&str>| match with {
        Some(w) => json!([{"block": "birth", "name": "Kim", "template": "child", "with": w}]),
        None => json!([{"block": "birth", "name": "Kim", "template": "child"}]),
    };
    assert_eq!(refusal(&act(&mut run, "bob-self", None, birth(None))), Some(RefusalCode::NotFertile));
    assert_eq!(refusal(&act(&mut run, "bob-self", None, birth(Some("alice")))), Some(RefusalCode::NotFertile));
    // Alice and Carol are both female: Carol can't be the other parent (she isn't near either, but biology is checked first).
    let r = act(&mut run, "alice-self", None, birth(Some("carol")));
    assert!(matches!(refusal(&r), Some(RefusalCode::NotFertile) | Some(RefusalCode::TooFar)));
    // Alice alone (a donor from elsewhere), or with Bob.
    assert_eq!(refusal(&act(&mut run, "alice-self", None, birth(Some("bob")))), None);
    run.command(&Command::Advance { to: 21 * DAY }).unwrap();
    let st = run.kernel().state();
    let kim = st.body("alice").unwrap().children[0].clone();
    assert_eq!(st.body("bob").unwrap().children, vec![kim.clone()]);
    let sex = st.body(&kim).unwrap().sex;
    assert!(sex.is_some(), "a newborn's sex is drawn where the world models it");
    // Both parents see the child in their own body's view; nobody else does.
    for parent in ["alice-self", "bob-self"] {
        let b = observe(&mut run, parent).body.unwrap();
        assert_eq!(b.children.len(), 1);
        assert_eq!((b.children[0].person.as_str(), b.children[0].sex, b.children[0].alive), (kim.as_str(), sex, true));
    }
    assert!(observe(&mut run, "carol-self").body.unwrap().children.is_empty());
}

#[test]
fn newborns_sex_follows_the_worlds_ratio() {
    // 1,500 births to Alice over time (the kernel doesn't stop overlapping pregnancies; behaviour would): the female
    // share is the world's 48.69% within about four standard errors (±5.2 points).
    let mut run = town_with_sexes();
    for i in 0..1_500 {
        assert_eq!(refusal(&act(&mut run, "alice-self", None, json!([{"block": "birth", "name": format!("B{i}"), "template": "child"}]))), None);
    }
    run.command(&Command::Advance { to: 21 * DAY }).unwrap();
    let st = run.kernel().state();
    let kids = &st.body("alice").unwrap().children;
    assert_eq!(kids.len(), 1_500);
    let female = kids.iter().filter(|k| st.body(k).unwrap().sex == Some(oikos_kernel::state::Sex::Female)).count();
    assert!((652..=809).contains(&female), "{female} of 1500 born female");
}

#[test]
fn those_who_share_a_space_see_who_left_it_and_why() {
    let mut run = town();
    // Alice moves in with Bob; then Bob leaves the world.
    assert_eq!(refusal(&act(&mut run, "alice-self", None, json!([{"block": "occupy", "space": "s-flats/dwelling.1"}]))), None);
    let _ = observe(&mut run, "alice-self"); // she's seen it as it was
    assert_eq!(refusal(&act(&mut run, "bob-self", None, json!([{"block": "leave"}]))), None);
    let o = observe(&mut run, "alice-self");
    let space = o
        .channels
        .values()
        .filter_map(|c| match c {
            ChannelData::Sites { cells, .. } => Some(cells),
            _ => None,
        })
        .flatten()
        .filter_map(|c| c.structure.as_ref())
        .flat_map(|s| s.spaces.iter())
        .find(|sp| sp.space == "s-flats/dwelling.1")
        .expect("she sees her home");
    let left = space.left.as_ref().expect("in her own home she sees who left");
    let last = left.last().unwrap();
    assert_eq!((last.occupant.as_str(), last.reason), ("bob", oikos_kernel::events::VacateReason::Departed));
    // Carol, who doesn't live there, sees how full it is, not who left.
    let o = observe(&mut run, "carol-self");
    for c in o.channels.values() {
        if let ChannelData::Sites { cells, .. } = c {
            for sp in cells.iter().filter_map(|c| c.structure.as_ref()).flat_map(|s| s.spaces.iter()) {
                if sp.space == "s-flats/dwelling.1" {
                    assert!(sp.left.is_none());
                }
            }
        }
    }
}


/// Working for oneself (docs/behaviour/entry.md, "A person working for themself"): a person performs the tasks of a
/// business in which they hold the only position; a task that names no kind of space is done in a dwelling; a task set
/// in a kind of space the world's catalogue names (a market's pitch) is done there, and nowhere else.
#[test]
fn a_person_works_alone_in_their_own_business_at_home_or_at_a_pitch() {
    let mut w = world(&default_params());
    w["catalogue"]["tasks"].as_array_mut().unwrap().push(json!({"id": "sell", "labour": 600}));
    w["catalogue"]["tasks"].as_array_mut().unwrap().push(json!({"id": "sell_at_pitch", "labour": 600, "in": "pitch"}));
    w["catalogue"]["structure_types"].as_array_mut().unwrap().push(json!({"id": "market", "category": "commercial", "materials": {"materials": "10"}, "build_time": 86_400,
        "footprint": {"w": 1, "h": 1}, "spaces": [{"kind": "pitch", "count": 2, "capacity": 1}]}));
    w["world"]["structures"].as_array_mut().unwrap().push(json!({"id": "s-market", "at": "cell.2.2", "type": "market"}));
    for o in w["world"]["occupancy"].as_array_mut().unwrap() {
        if o["occupant"] == "bob" {
            o["space"] = json!("s-market/pitch.1");
        }
    }
    let mut run = Run::start(w, "own-work", Vec::new(), None).unwrap();
    let found = |run: &mut Run<Vec<u8>>, who: &str| {
        let r = act(run, who, None, json!([{"block": "create_entity", "kind": "own_account", "name": "A stall", "first_position": {"title": "Owner", "channels": [{"id": "books", "kind": "accounts"}], "ref": "owner"}, "ref": "firm"}]));
        assert_eq!(refusal(&r), None);
        match &r.events[0].body {
            EventBody::ActionApplied { created: Some(c), .. } => c["owner"].clone(),
            other => panic!("{other:?}"),
        }
    };
    // Alice, at home (a dwelling), in her own business: the only position, hers; the work, her own hours.
    let owner = found(&mut run, "alice-self");
    let r = act(&mut run, "alice-self", Some(&owner), json!([{"block": "work", "task": "sell", "units": 3, "at": "s-house", "performers": ["alice"]}]));
    assert_eq!(refusal(&r), None);
    assert!(r.events.iter().any(|e| matches!(&e.body, EventBody::Worked { task, labour: 1800, performers, .. } if task == "sell" && performers == &vec!["alice".to_string()])));
    // Her hours are hers once: a working day's, and no more.
    let r = act(&mut run, "alice-self", Some(&owner), json!([{"block": "work", "task": "sell", "units": 46, "at": "s-house", "performers": ["alice"]}]));
    assert_eq!(refusal(&r), Some(RefusalCode::NoTimeLeft));
    // A task set in a workplace is not done in a dwelling, and one set in a pitch is not done at home.
    let r = act(&mut run, "alice-self", Some(&owner), json!([{"block": "work", "task": "make", "units": 1, "at": "s-house", "performers": ["alice"]}]));
    assert_eq!(refusal(&r), Some(RefusalCode::NotAtWork));
    let r = act(&mut run, "alice-self", Some(&owner), json!([{"block": "work", "task": "sell_at_pitch", "units": 1, "at": "s-house", "performers": ["alice"]}]));
    assert_eq!(refusal(&r), Some(RefusalCode::NotAtWork));
    // Bob, at his pitch in the market, in his own business.
    let owner = found(&mut run, "bob-self");
    let r = act(&mut run, "bob-self", Some(&owner), json!([{"block": "work", "task": "sell_at_pitch", "units": 2, "at": "s-market", "performers": ["bob"]}]));
    assert_eq!(refusal(&r), None);
    assert!(r.events.iter().any(|e| matches!(&e.body, EventBody::Worked { task, labour: 1200, .. } if task == "sell_at_pitch")));
}

/// An organisation founded in a run keeps a record of its own where the post made with it says so (its role module's
/// `keeps_record`, with a `code`): the kernel takes that organisation's record from whoever holds the post, names the
/// post's module as the keeper, and from nobody else. A post made without it keeps none, as before.
#[test]
fn an_organisation_founded_in_a_run_keeps_a_record_through_the_post_made_with_it() {
    use std::collections::BTreeMap;
    let set = |participant: &str, entity: &str| Command::EntityRecord { participant: participant.into(), entity: Some(entity.into()), set: serde_json::from_value::<BTreeMap<String, Value>>(json!({"character": {"keep": 5000}})).unwrap(), because: None };
    let mut run = town();
    let found = |run: &mut Run<Vec<u8>>, module: Value| {
        let r = act(run, "carol-self", None, json!([{"block": "create_entity", "kind": "cooperative", "name": "Carol's Co-op", "first_position": {"title": "Founder", "channels": [{"id": "books", "kind": "accounts"}], "role_module": module, "ref": "founder"}, "ref": "coop"}]));
        assert_eq!(refusal(&r), None);
        match &r.events[0].body {
            EventBody::ActionApplied { created: Some(c), .. } => c["coop"].clone(),
            other => panic!("{other:?}"),
        }
    };
    let kept = found(&mut run, json!({"code": "firm.retailer", "params": {}, "keeps_record": true}));
    let r = run.command(&set("carol-self", &kept)).unwrap();
    match &r.events[0].body {
        EventBody::EntityRecorded { entity, keeper, .. } => assert_eq!((entity.as_str(), keeper.as_deref()), (kept.as_str(), Some("firm.retailer"))),
        other => panic!("{other:?}"),
    }
    // Nobody but the holder of that post; and an organisation whose post does not say so keeps none.
    assert!(run.command(&set("dave-self", &kept)).is_err());
    let plain = found(&mut run, json!({"code": "firm.retailer", "params": {}}));
    let e = run.command(&set("carol-self", &plain)).unwrap_err();
    assert!(e.to_string().contains("has no bookkeeping named for its record"), "{e}");
}

#[test]
fn an_advance_to_news_stops_at_the_moment_a_body_gives_news_and_not_at_the_next_wake() {
    // Foundations F7. News of a body (a condition begun) reaches its person when it happens: an advance towards a far wake
    // stops at that moment (after all that is scheduled for it), so the person's unit wakes then, whoever else wakes next.
    // `Advance` is as it was: it goes to the time asked.
    let life = json!({"year": YEAR, "illness": {"by_age": [{"from": 0, "bps": 5000}, {"from": 100, "bps": 0}],
        "severity": [{"label": "minor", "share_bps": 10000, "days": [1, 3], "fatal_bps": 0}]}});
    let far = 2 * YEAR - TICK;
    let mut stops = many(300, life.clone(), false);
    let (mut now, mut news, mut stopped_early) = (0, 0, 0);
    while now < far {
        let r = stops.command(&Command::AdvanceToNews { to: far }).unwrap();
        let t = stops.kernel().t();
        assert!(t > now || t == far, "time moves on");
        let began: Vec<i64> = r.events.iter().filter(|e| matches!(e.body, EventBody::ConditionBegan { .. } | EventBody::ConditionEnded { .. })).map(|_| t).collect();
        news += began.len();
        if t < far {
            stopped_early += 1;
            // It stopped where the news was: every event of the advance is at or before that moment, and some body's news is among them.
            assert!(!began.is_empty(), "it stopped at {t} with no news of a body");
        }
        now = t;
    }
    assert!(stopped_early > 20 && news > 20, "{stopped_early} stops for {news} pieces of news");
    // The same town, advanced plainly, comes to the same end state: the stops lose and add nothing.
    let mut plain = many(300, life, false);
    plain.command(&Command::Advance { to: far }).unwrap();
    assert_eq!(stops.kernel().state_hash().unwrap(), plain.kernel().state_hash().unwrap());
}
