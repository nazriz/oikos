//! The laws of how the world works, as tests (docs/design/foundations.md section 1; step F0, written first).
//!
//! Each test states what the kernel must keep or refuse. Those the kernel keeps today pass. Those it does not yet keep
//! are `#[ignore = "F<n>: ..."]`: written against the INTENDED interface (the plan's section 2: `by` on any act, a
//! work table keyed by record kind, a template's `does` and `supplier`, `deploy.to`), never red in the suite, and
//! switched on by the step that builds the thing (remove the `ignore`, adjust the names the step settles on).
//! `cargo test --test foundations -- --ignored` runs the pending ones, which must all fail today (F0 checked this).
//!
//! Law 6 (who may do what is data) and law 7 (information with its keeper) are kept already and have their own tests:
//! `statements_have_no_power.rs`, `knowing.rs` and `orchestrator/test/no-god-view.test.ts`. Law 1's money and goods are
//! `money_conservation.rs` and `conservation.rs`; what is added here is time.

mod common;

use common::*;
use oikos_kernel::events::EventBody;
use oikos_kernel::kernel::Command;
use oikos_kernel::run::Run;
use serde_json::{json, Value};

type R = Run<Vec<u8>>;

fn cmd(participant: &str, position: Option<&str>, blocks: Value) -> Command {
    Command::Act {
        participant: participant.into(),
        position: position.map(String::from).map(Into::into),
        blocks: serde_json::from_value(blocks).expect("the blocks parse"),
        by: vec![],
        provenance: json!({"via": "direct"}),
        reasoning: None,
        thinking: None,
    }
}

fn start(config: Value) -> R {
    Run::start(config, "foundations", Vec::new(), None).unwrap()
}

fn town() -> R {
    start(world(&default_params()))
}

/// The town with the world's table of act times set (`orchestration.act_time`), over the test world's stated default
/// (every act it does not name a second: foundations-2 P2).
fn town_with_times(table: Value) -> R {
    let mut c = world(&default_params());
    let mut table = table;
    table["default"] = json!(1);
    c["orchestration"]["act_time"] = table;
    start(c)
}

/// An act begun, not yet done: when it starts and when it is done.
fn begun(run: &mut R, c: &Command) -> (i64, i64) {
    match &run.command(c).unwrap().events[0].body {
        EventBody::ActionStarted { starts, done, .. } => (*starts, *done),
        other => panic!("{other:?}"),
    }
}

/// An act carried to its end: the code it was refused with (as the contract spells it), or None if it took effect.
fn outcome(run: &mut R, c: &Command) -> Option<String> {
    let r = step(run, c).expect("the command is accepted");
    r.events.iter().find_map(|e| match &e.body {
        EventBody::ActionRefused { code, .. } => Some(serde_json::to_value(code).unwrap().as_str().unwrap().to_string()),
        _ => None,
    })
}

fn applied(run: &mut R, c: &Command) -> Value {
    let r = step(run, c).expect("the command is accepted");
    let e = r.events.iter().find(|e| matches!(e.body, EventBody::ActionApplied { .. })).unwrap_or_else(|| panic!("not applied: {:?}", r.events));
    serde_json::to_value(&e.body).unwrap()
}

/// 4 units of `make` at 1,800 s a unit: two hours of carol's, at the shop where she works.
fn make(units: u64, performers: &[&str]) -> Command {
    cmd("developer-system", Some("developer"), json!([{"block": "work", "task": "make", "units": units, "at": "s-shop", "performers": performers}]))
}

/// A command naming who does the work (`by`, on the action).
fn cmd_by(participant: &str, position: Option<&str>, blocks: Value, by: &[&str]) -> Command {
    match cmd(participant, position, blocks) {
        Command::Act { participant, position, blocks, provenance, reasoning, thinking, .. } => Command::Act { participant, position, blocks, by: by.iter().map(|s| s.to_string()).map(Into::into).collect(), provenance, reasoning, thinking, },
        c => c,
    }
}


/// devco employs carol: an employment agreement both have signed (what lets devco name her in `by`: finding 5 of the review).
fn employ(run: &mut R, employer: &str, employer_participant: &str, position: Option<&str>, worker: &str) {
    let propose = cmd(employer_participant, position, json!([{"block": "propose_agreement", "terms": {"parties": [employer, worker], "commitments": [{"who": employer, "does": {"outcome": {"money": {"to": format!("acc-{worker}"), "amount": "100"}}}, "every": 2_592_000}]}, "speaks_for": employer}]));
    let r = step(run, &propose).expect("accepted");
    let _ = r;
    let id = run.kernel().state().record_order.iter().rev().find(|id| run.kernel().state().records[*id].record.body.kind_name() == "agreement").cloned().expect("an agreement");
    let sign_worker = cmd(&format!("{worker}-self"), None, json!([{"block": "sign_agreement", "agreement": id, "as": worker}]));
    step(run, &sign_worker).expect("accepted");
    let sign_employer = cmd(employer_participant, position, json!([{"block": "sign_agreement", "agreement": id, "as": employer}]));
    step(run, &sign_employer).expect("accepted");
}

fn msg(from: &str) -> Command {
    cmd(from, None, json!([{"block": "message", "to": ["bob-self"], "text": "hi"}]))
}

// ------------------------------------------------------------------------------------------------------------------
// Law 1. Nothing from nothing: money, goods and time are each held by someone and used once.
// ------------------------------------------------------------------------------------------------------------------

#[test]
fn law1_money_and_goods_cannot_be_overdrawn() {
    let mut run = town();
    // (Carol keeps her own money; everyone else's is the bank's to move.)
    let before = run.kernel().state().accounts["acc-carol"].balance;
    let pay = |amount: &str| cmd("carol-self", None, json!([{"block": "transfer", "from": "acc-carol", "to": "acc-bob", "amount": amount}]));
    assert_eq!(outcome(&mut run, &pay("999999999")).as_deref(), Some("insufficient_funds"));
    assert_eq!(run.kernel().state().accounts["acc-carol"].balance, before, "a refused payment moves nothing");
    let take = cmd("alice-self", None, json!([{"block": "work", "task": "eat", "units": 11, "at": "s-house", "performers": []}]));
    assert_eq!(outcome(&mut run, &take).as_deref(), Some("insufficient_quantity"));
    assert_eq!(run.kernel().state().holding("alice", "s-house", "goods"), 10, "nothing was used up");
}

/// A person is one timeline: however the acts are asked for, their intervals do not overlap, and the time they take is
/// the table's (here, a message is 120 s, a transfer 300 s, a publish 900 s).
#[test]
fn law1_a_person_never_does_two_things_at_once_and_each_takes_its_table_time() {
    let mut run = town_with_times(json!({"person": {"message": 120, "transfer": 300, "publish": 900}}));
    let publish = cmd("alice-self", None, json!([{"block": "publish", "kind": "notice", "text": "x"}]));
    let pay = cmd("alice-self", None, json!([{"block": "transfer", "from": "acc-alice", "to": "acc-bob", "amount": "1"}])); // (begun, so custody does not matter)
    let mut spans = vec![];
    for i in 0..12 {
        let (c, seconds) = match i % 3 {
            0 => (msg("alice-self"), 120),
            1 => (pay.clone(), 300),
            _ => (publish.clone(), 900),
        };
        let (s, d) = begun(&mut run, &c);
        assert_eq!(d - s, seconds, "an act takes its table's time");
        spans.push((s, d));
    }
    spans.sort();
    for w in spans.windows(2) {
        assert!(w[0].1 <= w[1].0, "alice's timeline overlaps itself: {w:?}");
    }
}

/// A system is as many timelines as it has lanes: never more acts in hand at once than lanes.
#[test]
fn law1_a_system_never_has_more_in_hand_than_it_has_lanes() {
    let mut c = world(&default_params());
    c["orchestration"]["act_time"] = json!({"default": 1, "system": {"message": 10}});
    for p in c["participants"].as_array_mut().unwrap() {
        if p["id"] == "mayor-system" {
            p["lanes"] = json!(2);
        }
    }
    let mut run = start(c);
    let m = cmd("mayor-system", Some("mayor"), json!([{"block": "message", "to": ["bob-self"], "text": "hi"}]));
    let spans: Vec<(i64, i64)> = (0..9).map(|_| begun(&mut run, &m)).collect();
    for (s, _) in &spans {
        let in_hand = spans.iter().filter(|(a, b)| a <= s && s < b).count();
        assert!(in_hand <= 2, "{in_hand} acts in hand at {s} on two lanes: {spans:?}");
    }
}

/// THE time ledger is one: what a person spends on `work` is not also free for something else (F1): `work` is placed on its performers' timelines like any act's time.
#[test]
fn law1_work_takes_the_performers_time_and_the_act_is_done_when_they_are() {
    let mut run = town();
    // Two hours of carol's at the shop. The act is done when her work is: at 7,200 s, not at the developer's 1 s.
    assert_eq!(begun(&mut run, &make(4, &["carol"])), (0, 7_200));
    // And she cannot, meanwhile, write a message: her next act begins when her work ends.
    assert_eq!(begun(&mut run, &msg("carol-self")).0, 7_200);
}

#[test]
fn law1_two_works_naming_one_performer_do_not_overlap() {
    let mut run = town();
    begun(&mut run, &make(2, &["carol"])); // one hour of hers
    let (second_starts, _) = begun(&mut run, &make(2, &["carol"]));
    assert!(second_starts >= 3_600, "carol's second hour began at {second_starts}, before her first was done at 3600");
}

/// An act with several performers starts when every one of them is free (F1, plan 2.1).
#[test]
fn law1_an_act_starts_when_all_its_performers_are_free() {
    let mut run = town_with_times(json!({"person": {"message": 3_600}}));
    assert_eq!(begun(&mut run, &msg("carol-self")), (0, 3_600)); // carol is busy for an hour with her own affairs
    let (starts, _) = begun(&mut run, &make(1, &["carol"]));
    assert!(starts >= 3_600, "the work began at {starts} while carol was busy until 3600");
}

/// The daily limit is a body's, counted on the same ledger (F1): a day's work is the time on the timeline.
#[test]
fn law1_a_working_day_is_counted_on_the_timeline() {
    let mut run = town();
    // The day is 8 hours. Carol works 8 (16 units of 1,800 s ... of the task) and then has no time for anything else
    // that day: her own affairs wait until tomorrow.
    applied(&mut run, &make(16, &["carol"]));
    let (starts, _) = begun(&mut run, &msg("carol-self"));
    assert!(starts >= 8 * 3_600, "carol worked all day and then wrote a message at {starts}");
}

/// A refusal for want of working hours says whose hours and how many are left, as participants read it (a shop works out
/// from it what its crew can still serve): "<who> has <n> s of work left today; this needs <m>".
#[test]
fn law1_a_refusal_for_want_of_hours_says_how_many_are_left() {
    let mut run = town();
    applied(&mut run, &make(12, &["carol"])); // 6 of her 8 hours
    let r = step(&mut run, &make(8, &["carol"])).unwrap(); // 4 more
    let detail = r.events.iter().find_map(|e| match &e.body { EventBody::ActionRefused { detail, .. } => detail.clone(), _ => None }).expect("refused");
    assert_eq!(detail, "carol has 7200 s of work left today; this needs 14400");
}

// ------------------------------------------------------------------------------------------------------------------
// Law 2. All work takes time, and the time is read from what the work makes.
// ------------------------------------------------------------------------------------------------------------------

#[test]
fn law2_an_act_takes_effect_when_it_is_done_and_a_world_without_rows_runs_as_today() {
    let mut run = town(); // no table: every act is a second
    let before = run.kernel().state().accounts["acc-bob"].balance;
    let pay = cmd("carol-self", None, json!([{"block": "transfer", "from": "acc-carol", "to": "acc-bob", "amount": "7"}]));
    assert_eq!(begun(&mut run, &pay), (0, 1));
    assert_eq!(run.kernel().state().accounts["acc-bob"].balance, before, "begun, not done: nothing has moved");
    run.command(&Command::Advance { to: 1 }).unwrap();
    assert_eq!(run.kernel().state().accounts["acc-bob"].balance, before + 7);
}

#[test]
fn law2_the_table_is_by_block_and_by_who_does_it() {
    let mut run = town_with_times(json!({"person": {"message": 120}, "system": {"message": 5}}));
    let (s, d) = begun(&mut run, &cmd("mayor-system", Some("mayor"), json!([{"block": "message", "to": ["bob-self"], "text": "hi"}])));
    assert_eq!(d - s, 5);
    let (s, d) = begun(&mut run, &msg("alice-self"));
    assert_eq!(d - s, 120);
}

/// How long is not a property of the block but of what is made: a decision on a claim is not a notice (F2). The key's
/// spelling (`<block>/<kind>` here) is the plan's to settle at F2; what is fixed is that a record's kind can have a row.
#[test]
fn law2_time_is_read_from_the_kind_of_record_an_act_writes() {
    let mut run = town_with_times(json!({"person": {"publish": 900, "publish/benefit_decision": 2_400}}));
    let notice = cmd("alice-self", None, json!([{"block": "publish", "kind": "notice", "text": "a notice"}]));
    let decision = cmd("alice-self", None, json!([{"block": "publish", "kind": "benefit_decision", "text": "a decision"}]));
    let (s, d) = begun(&mut run, &notice);
    assert_eq!(d - s, 900, "a notice takes the block's time");
    let (s, d) = begun(&mut run, &decision);
    assert_eq!(d - s, 2_400, "a decision on a claim takes its row's time");
}

/// A `work` task's time is its labour a unit: the performers' timelines carry exactly that (the table's time is the
/// time charged), for a person and for a system by its template.
#[test]
fn law2_the_time_charged_is_the_tables_time() {
    let mut run = town();
    applied(&mut run, &make(3, &["carol"])); // 3 units x 1,800 s
    let busy: i64 = run.kernel().state().timelines.get("carol").map_or(0, |t| t.iter().copied().max().unwrap_or(0));
    assert_eq!(busy, 5_400, "carol's timeline should carry exactly the task's labour");
}

// ------------------------------------------------------------------------------------------------------------------
// Law 3. Only actors work: a person, or a system someone supplied. A system acts within its template.
// ------------------------------------------------------------------------------------------------------------------

/// A system may perform a work only if it is the acting organisation's and its template lists the task (F4).
#[test]
fn law3_a_system_with_no_row_for_a_work_cannot_perform_it() {
    let mut run = with_template(|t| {
        t["does"] = json!([{"block": "message"}]);
        t["supplier"] = json!("outside");
    });
    let bot = deliver_to(&mut run, "devco");
    // devco's own system, whose template lists no `make`: refused as incapable, and nobody's time is taken.
    assert_eq!(outcome(&mut run, &make(1, &[&bot])).as_deref(), Some("not_capable"));
    // Another organisation's system is not devco's to name (the template lists nothing of it, but it is not theirs).
    assert_eq!(outcome(&mut run, &make(1, &["builder-system"])).as_deref(), Some("not_theirs"));
}

/// A system whose template lists the work does it at the template's seconds a unit, on its own timeline: no person's
/// hours are taken (F4: "a system does a task, a person's hours are freed").
#[test]
fn law3_a_system_that_lists_the_work_does_it_and_frees_the_people() {
    let mut run = with_template(|t| {
        t["does"] = json!([{"block": "work", "task": "make", "seconds": 600}]);
        t["supplier"] = json!("outside");
    });
    let bot = deliver_to(&mut run, "devco");
    let goods = run.kernel().state().holding("devco", "s-shop", "goods");
    let c = make(4, &[&bot]);
    let (starts, done) = begun(&mut run, &c);
    assert_eq!(done - starts, 2_400, "4 units at the template's 600 s, not the task's 1,800 s");
    let r = run.command(&Command::Advance { to: done }).unwrap();
    let by = r.events.iter().find_map(|e| match &e.body { EventBody::ActionApplied { by, .. } => Some(by.clone()), _ => None }).expect("the work was done");
    assert_eq!(by, vec![bot.clone()]);
    assert!(run.kernel().state().holding("devco", "s-shop", "goods") > goods, "the system made goods");
    let st = run.kernel().state();
    assert!(st.timelines.get("carol").is_none(), "carol's time was not taken");
    assert_eq!(st.timelines[bot.as_str()].lanes.iter().copied().max(), Some(done));
}

/// A system has no working day (a person's limit): a long work is not refused for the hours it takes (F4).
#[test]
fn law3_a_system_in_service_does_not_tire() {
    let mut run = with_template(|t| {
        t["does"] = json!([{"block": "work", "task": "make", "seconds": 1_800}]);
        t["supplier"] = json!("outside");
    });
    let bot = deliver_to(&mut run, "devco");
    let day = world(&default_params())["catalogue"]["working_day"].as_i64().expect("the test world has a working day");
    let units = (day / 1_800) as u64 * 2; // two days of work for a person
    assert_eq!(outcome(&mut run, &make(units, &["carol"])).as_deref(), Some("no_time_left"), "a person is held to the day");
    assert_eq!(outcome(&mut run, &make(units, &[&bot])), None, "a system is not");
}

#[test]
fn law3_an_unknown_template_cannot_be_deployed() {
    let mut run = town();
    let c = cmd("mayor-system", Some("mayor"), json!([{"block": "deploy", "template": "no-such-template"}]));
    assert_eq!(outcome(&mut run, &c).as_deref(), Some("unknown_template"));
}

fn with_template(f: impl FnOnce(&mut Value)) -> R {
    let mut c = world(&default_params());
    let t = c["templates"].as_array_mut().unwrap().iter_mut().find(|t| t["id"] == "clerk-bot").unwrap();
    f(t);
    start(c)
}

/// Template fields (F4): `does` lists the blocks (or works) a system from it may do; `supplier` is the organisation
/// that delivers it. The names are the plan's (2.3); F4 settles the exact spelling.
#[test]
fn law3_a_system_acts_only_within_its_template() {
    let mut run = with_template(|t| {
        t["does"] = json!([{"block": "message"}]);
        t["supplier"] = json!("outside");
    });
    let bot = deliver(&mut run);
    applied(&mut run, &cmd("mayor-system", Some("mayor"), json!([{"block": "appoint", "position": "clerk", "participant": bot}])));
    let say = cmd(&bot, Some("clerk"), json!([{"block": "message", "to": ["bob-self"], "text": "ok"}]));
    assert_eq!(outcome(&mut run, &say), None, "what the template lists is allowed");
    let pay = cmd(&bot, Some("clerk"), json!([{"block": "transfer", "from": "acc-city", "to": "acc-bob", "amount": "1"}]));
    assert_eq!(outcome(&mut run, &pay).as_deref(), Some("not_capable"), "what it does not list is refused");
}

/// Deliver a clerk-bot to an organisation the way the plan says: the supplier's act, naming the client (F4).
fn deliver_to(run: &mut R, client: &str) -> String {
    let r = applied(run, &cmd("outside-system", Some("outside-trade"), json!([{"block": "deploy", "template": "clerk-bot", "to": client, "ref": "bot"}])));
    r["created"]["bot"].as_str().expect("the delivered system's id").to_string()
}

fn deliver(run: &mut R) -> String {
    deliver_to(run, "city")
}

#[test]
fn law3_only_the_templates_supplier_delivers_a_system() {
    let mut run = with_template(|t| t["supplier"] = json!("outside"));
    // The city cannot make itself a system out of nothing (today it can: `deploy` makes one for the acting org).
    let own = cmd("mayor-system", Some("mayor"), json!([{"block": "deploy", "template": "clerk-bot"}]));
    assert_eq!(outcome(&mut run, &own).as_deref(), Some("not_supplier"));
    // The supplier delivers, to the city; the system belongs to the city.
    let bot = deliver(&mut run);
    assert_eq!(run.kernel().state().participants[bot.as_str()].owner.as_deref(), Some("city"));
    // A kind of system released later in the run (foundations-2 E2) is delivered to nobody before it exists.
    let mut run = with_template(|t| {
        t["supplier"] = json!("outside");
        t["released"] = json!(86_400);
    });
    let early = cmd("outside-system", Some("outside-trade"), json!([{"block": "deploy", "template": "clerk-bot", "to": "city"}]));
    assert_eq!(outcome(&mut run, &early).as_deref(), Some("unknown_template"));
    run.command(&Command::Advance { to: 86_400 }).unwrap();
    deliver(&mut run);
}

/// What a system runs on (foundations-2 P4): the clerk-bot needs 400 kg of the developer's materials at the shop a lane
/// (there are 1,000: room for two), and an hour of its work there is the recipe `eat` (a unit of goods used up). A
/// message takes it half an hour.
fn hosted(goods: &str) -> R {
    let mut c = world(&default_params());
    for h in c["world"]["holdings"].as_array_mut().unwrap() {
        if h["holder"] == "devco" && h["kind"] == "goods" {
            h["quantity"] = json!(goods);
        }
    }
    let t = c["templates"].as_array_mut().unwrap().iter_mut().find(|t| t["id"] == "clerk-bot").unwrap();
    t["supplier"] = json!("outside");
    t["does"] = json!([{"block": "message", "seconds": 1800}]);
    t["runs_on"] = json!({"hardware": "materials", "per_lane": 400, "holder": "devco", "at": "s-shop", "hour": "eat"});
    start(c)
}

#[test]
fn p4_a_system_runs_on_hardware_held_somewhere_and_its_work_draws_there() {
    let goods = |run: &R| run.kernel().state().holding("devco", "s-shop", "goods");
    let mut run = hosted("200");
    let bot = deliver(&mut run);
    deliver(&mut run);
    let third = cmd("outside-system", Some("outside-trade"), json!([{"block": "deploy", "template": "clerk-bot", "to": "city"}]));
    assert_eq!(outcome(&mut run, &third).as_deref(), Some("insufficient_quantity"), "no hardware left for a third");
    applied(&mut run, &cmd("mayor-system", Some("mayor"), json!([{"block": "appoint", "position": "clerk", "participant": bot}])));
    let say = cmd(&bot, Some("clerk"), json!([{"block": "message", "to": ["bob-self"], "text": "ok"}]));
    assert_eq!(outcome(&mut run, &say), None);
    assert_eq!(goods(&run), 200, "half an hour: nothing drawn yet");
    assert_eq!(outcome(&mut run, &say), None);
    assert_eq!(goods(&run), 199, "an hour of its work: the recipe's unit, at its host");
    // A host with nothing to run it on: the hour's work is refused.
    let mut run = hosted("0");
    let bot = deliver(&mut run);
    applied(&mut run, &cmd("mayor-system", Some("mayor"), json!([{"block": "appoint", "position": "clerk", "participant": bot}])));
    let say = cmd(&bot, Some("clerk"), json!([{"block": "message", "to": ["bob-self"], "text": "ok"}]));
    assert_eq!(outcome(&mut run, &say), None);
    assert_eq!(outcome(&mut run, &say).as_deref(), Some("insufficient_quantity"));
}

#[test]
fn law4_a_system_is_retired_by_its_owner_and_not_by_anyone_else() {
    let mut run = town();
    // (F4: it is delivered by its supplier to the city, which owns it.)
    let bot = deliver(&mut run);
    let by_stranger = cmd("developer-system", Some("developer"), json!([{"block": "retire", "participant": bot}]));
    assert_eq!(outcome(&mut run, &by_stranger).as_deref(), Some("not_theirs"));
    let by_owner = cmd("mayor-system", Some("mayor"), json!([{"block": "retire", "participant": bot}]));
    assert_eq!(outcome(&mut run, &by_owner), None);
}

#[test]
fn law4_a_system_is_switched_off_by_its_supplier_too() {
    let mut run = with_template(|t| t["supplier"] = json!("outside"));
    let bot = deliver(&mut run);
    let stranger = cmd("developer-system", Some("developer"), json!([{"block": "retire", "participant": bot}]));
    assert_eq!(outcome(&mut run, &stranger).as_deref(), Some("not_theirs"));
    let supplier = cmd("outside-system", Some("outside-trade"), json!([{"block": "retire", "participant": bot}]));
    assert_eq!(outcome(&mut run, &supplier), None);
}

/// A world loads only if every post's holder is a person or a system delivered from a template (F4(e)). Delivery at
/// the start of a world is a record on the participant: its template and its supplier.
#[test]
fn law3_a_world_with_a_free_holder_does_not_load() {
    assert!(Run::start(world(&default_params()), "foundations", Vec::new(), None).is_ok(), "the test world's systems were all delivered");
    for (what, field) in [("a template", "template"), ("a supplier", "supplier")] {
        let mut c = world(&default_params());
        let mayor = c["participants"].as_array_mut().unwrap().iter_mut().find(|p| p["id"] == "mayor-system").unwrap();
        mayor.as_object_mut().unwrap().remove(field); // mayor-system, a system with no template, or no supplier
        let e = Run::start(c, "foundations", Vec::new(), None).err().unwrap_or_else(|| panic!("a post held by a system with no {what} loaded"));
        assert!(e.to_string().contains("nobody supplied"), "{e}");
    }
}

/// F5: there is no "no limit". A system's template says what it does, or the world does not load; and a system nobody
/// supplied, holding no post or not, is no system of the world.
#[test]
fn law3_a_systems_template_must_say_what_it_does() {
    for template in ["installed-system", "clerk-bot"] {
        let mut c = world(&default_params());
        let t = c["templates"].as_array_mut().unwrap().iter_mut().find(|t| t["id"] == template).unwrap();
        t.as_object_mut().unwrap().remove("does");
        let e = Run::start(c, "foundations", Vec::new(), None).err().unwrap_or_else(|| panic!("a system template with no `does` loaded ({template})"));
        assert!(e.to_string().contains("does"), "{e}"); // (the contract refuses it first; the kernel's own load check says the same)
    }
    // A template that lists nothing is a system that does nothing, not one with no limit.
    let mut run = with_template(|t| {
        t["does"] = json!([]);
    });
    let bot = deliver(&mut run);
    applied(&mut run, &cmd("mayor-system", Some("mayor"), json!([{"block": "appoint", "position": "clerk", "participant": bot}])));
    let say = cmd(&bot, Some("clerk"), json!([{"block": "message", "to": ["bob-self"], "text": "ok"}]));
    assert_eq!(outcome(&mut run, &say).as_deref(), Some("not_capable"));
}

/// F5: a model's seat in one post of a person is a participant of its own that shares the person's body: the person's own
/// participant goes on with the rest, and the one body has one timeline for both.
#[test]
fn law3_a_seat_beside_a_person_shares_their_body_and_time() {
    let seated = |own_too: bool| {
        let mut c = world(&default_params());
        let alice = c["participants"].as_array().unwrap().iter().find(|p| p["id"] == "alice-self").unwrap().clone();
        let mut seat = alice.clone();
        seat["id"] = json!("clerk-seat");
        seat["shares_body"] = json!(true);
        seat["channels"] = json!([]);
        if !own_too {
            c["participants"].as_array_mut().unwrap().retain(|p| p["id"] != "alice-self");
        }
        c["participants"].as_array_mut().unwrap().push(seat);
        c["positions"].as_array_mut().unwrap().iter_mut().find(|p| p["id"] == "clerk").unwrap()["holder"] = json!("clerk-seat");
        c
    };
    // A body's own participant beside the seat: loads. A seat with nobody's own beside it: refused.
    let mut run = start(seated(true));
    assert!(Run::start(seated(false), "foundations", Vec::new(), None).is_err(), "a seat for a body with no participant of its own loaded");
    // Two of a body's own are still refused.
    let mut twice = seated(true);
    twice["participants"].as_array_mut().unwrap().last_mut().unwrap()["shares_body"] = json!(false);
    assert!(Run::start(twice, "foundations", Vec::new(), None).is_err(), "two participants of one body's own loaded");
    // One timeline: what the seat does takes the person's time, and the person's own act waits for it.
    let say = cmd("clerk-seat", Some("clerk"), json!([{"block": "message", "to": ["bob-self"], "text": "from the post"}]));
    applied(&mut run, &say);
    let own = cmd("alice-self", None, json!([{"block": "message", "to": ["bob-self"], "text": "from herself"}]));
    applied(&mut run, &own);
    let t = &run.kernel().state().timelines["alice"];
    assert!(t.iter().any(|&x| x > 0), "the person's one timeline carries both: {t:?}");
}

#[test]
fn law3_a_system_nobody_supplied_does_not_load_even_when_it_holds_no_post() {
    let mut c = world(&default_params());
    let mut stray = c["participants"].as_array().unwrap().iter().find(|p| p["id"] == "mayor-system").unwrap().clone();
    stray["id"] = json!("stray-system");
    stray.as_object_mut().unwrap().remove("template");
    c["participants"].as_array_mut().unwrap().push(stray);
    let e = Run::start(c, "foundations", Vec::new(), None).err().expect("a system with no template loaded");
    assert!(e.to_string().contains("nobody supplied"), "{e}");
}

// ------------------------------------------------------------------------------------------------------------------
// Law 4. What works or holds value is owned and changes hands only by its holder's act.
// ------------------------------------------------------------------------------------------------------------------

#[test]
fn law4_money_moves_by_its_custodian_and_goods_by_their_holder() {
    let mut run = town();
    let bob_before = run.kernel().state().accounts["acc-bob"].balance;
    let take_bobs = cmd("alice-self", None, json!([{"block": "transfer", "from": "acc-bob", "to": "acc-alice", "amount": "1"}]));
    assert_eq!(outcome(&mut run, &take_bobs).as_deref(), Some("not_custodian"));
    assert_eq!(run.kernel().state().accounts["acc-bob"].balance, bob_before);
    let take_goods = cmd("alice-self", None, json!([{"block": "move_goods", "kind": "goods", "quantity": "1", "from_at": "s-shop", "to": "alice", "to_at": "s-house"}]));
    assert!(outcome(&mut run, &take_goods).is_some(), "someone else's goods were moved by a stranger");
    assert_eq!(run.kernel().state().holding("devco", "s-shop", "goods"), 200);
}

// ------------------------------------------------------------------------------------------------------------------
// Law 5. Every act has an author and its performers on record.
// ------------------------------------------------------------------------------------------------------------------

#[test]
fn law5_an_applied_act_records_who_acted_and_in_which_post() {
    let mut run = town();
    let e = applied(&mut run, &cmd("mayor-system", Some("mayor"), json!([{"block": "publish", "kind": "notice", "text": "x"}])));
    assert_eq!(e["participant"], "mayor-system");
    assert_eq!(e["as"], "mayor");
}

/// `by`: who did the work is on the record of the act (F3), read from the log, never inferred (the GD plan's M1).
#[test]
fn law5_the_performers_of_an_act_are_on_its_record() {
    let mut run = town();
    let work = cmd("developer-system", Some("developer"), json!([{"block": "work", "task": "make", "units": 1, "at": "s-shop", "performers": ["carol"]}]));
    let e = applied(&mut run, &work);
    assert_eq!(e["by"], json!(["carol"]), "the applied act names who did it");
    // An act without performers names its actor.
    let e = applied(&mut run, &msg("alice-self"));
    assert_eq!(e["by"], json!(["alice-self"]));
}

/// Any act may name performers; a person performer must be present where the work's row asks, alive and within their
/// day (F3): a clerk not at work cannot decide.
#[test]
fn law5_a_performer_who_is_not_there_cannot_do_the_work() {
    // The world says work is done in a workplace space (`orchestration.performers_in`). Alice is at home (s-house, a
    // dwelling), not at work: she cannot be the hand that sends this. Carol is at the shop's workplace: she can.
    let mut c = world(&default_params());
    c["orchestration"]["performers_in"] = json!("workplace");
    let mut run = start(c);
    employ(&mut run, "devco", "developer-system", Some("developer"), "alice");
    employ(&mut run, "devco", "developer-system", Some("developer"), "carol");
    let hi = json!([{"block": "message", "to": ["bob-self"], "text": "hi"}]);
    assert_eq!(outcome(&mut run, &cmd_by("developer-system", Some("developer"), hi.clone(), &["alice"])).as_deref(), Some("not_at_work"));
    assert_eq!(outcome(&mut run, &cmd_by("developer-system", Some("developer"), hi, &["carol"])), None);
}

/// Who is to be at work is looked at when the work begins, not when it ends (F3; F1 had found the plan wrong here): a
/// work that queued behind other time is refused at its start, at once, if its performer is gone by then; it never
/// takes anyone's time to the end.
#[test]
fn law5_presence_is_looked_at_when_the_work_begins() {
    let mut run = town_with_times(json!({"person": {"vacate": 3_600}}));
    // Carol leaves the shop (an hour, her own affairs). Meanwhile, ordered now when she is there, a work of hers queues
    // behind that hour.
    begun(&mut run, &cmd("carol-self", None, json!([{"block": "vacate", "occupant": "carol", "from": "s-shop"}])));
    let r = run.command(&make(1, &["carol"])).unwrap();
    assert!(r.events.iter().any(|e| matches!(e.body, EventBody::ActionStarted { starts: 3_600, .. })), "the work waits for carol: {:?}", r.events);
    let goods = run.kernel().state().holding("devco", "s-shop", "goods");
    let r = run.command(&Command::Advance { to: 3_601 }).unwrap();
    let refused = r.events.iter().find_map(|e| match &e.body { EventBody::ActionRefused { code, .. } => Some(serde_json::to_value(code).unwrap()), _ => None });
    assert_eq!(refused, Some(json!("not_at_work")), "refused when it was to begin (3600), not when it would have ended (5400): {:?}", r.events);
    assert_eq!(run.kernel().state().holding("devco", "s-shop", "goods"), goods, "nothing was made");
    // Her hour for the work is given back: she is free from then.
    assert_eq!(begun(&mut run, &msg("carol-self")).0, 3_601, "carol's time was not kept for work that never began");
}

/// An action that names others to do its work: the act's time is theirs, shared, and the actor is held a second.
#[test]
fn law5_an_act_naming_performers_takes_their_time_shared() {
    let mut c = world(&default_params());
    c["orchestration"]["act_time"] = json!({"default": 1, "person": {"message": 600}, "system": {"message": 1_200}});
    c["orchestration"]["performers_in"] = json!("workplace");
    let mut run = start(c);
    employ(&mut run, "devco", "developer-system", Some("developer"), "carol");
    let t0 = run.kernel().state().t;
    let m = cmd_by("developer-system", Some("developer"), json!([{"block": "message", "to": ["bob-self"], "text": "hi"}]), &["carol"]);
    let (s, d) = begun(&mut run, &m);
    // Carol does the work, so it takes her own row's time (a person's message is 600 s), not the system's 1,200 (finding 8).
    assert_eq!(d - s, 600, "carol is charged a person's 600 s for a message, not the ordering system's 1,200 s");
    assert!(s >= t0);
    assert_eq!(run.kernel().state().timelines["carol"].lanes.iter().copied().max(), Some(d));
    let e = applied(&mut run, &m);
    assert_eq!(e["by"], json!(["carol"]));
}

/// A record says who did the work of making it when that was not its author (F3).
#[test]
fn law5_a_record_names_who_made_it_when_not_its_author() {
    let mut c = world(&default_params());
    c["orchestration"]["performers_in"] = json!("workplace");
    let mut run = start(c);
    employ(&mut run, "devco", "developer-system", Some("developer"), "carol");
    let publish = |by: &[&str]| cmd_by("developer-system", Some("developer"), json!([{"block": "publish", "kind": "notice", "text": "x"}]), by);
    let by_of = |run: &mut R, c: &Command| {
        let r = step(run, c).unwrap();
        r.events.iter().find_map(|e| match &e.body { EventBody::Recorded { record } => Some(record.by.clone()), _ => None }).expect("a record")
    };
    assert_eq!(by_of(&mut run, &publish(&["carol"])), Some(vec!["carol".into()]));
    assert_eq!(by_of(&mut run, &publish(&[])), None, "the author did it: nothing to add");
}

/// A person who holds two posts of one organisation is told of a payment through each: the first to look does not take
/// it from the other (F6: a body's payroll officer and its other office, held by the same member of staff, were told
/// in turn, and the payroll never heard of the wages it had paid, so never paid over the tax withheld).
#[test]
fn a_person_holding_two_posts_of_one_organisation_is_told_of_a_payment_in_each() {
    let mut c = world(&default_params());
    for id in ["devco-office", "devco-payroll"] {
        c["positions"].as_array_mut().unwrap().push(json!({"id": id, "entity": "devco", "title": id, "channels": [{"id": "money", "kind": "accounts"}], "role_module": {"code": "test"}, "holder": "bob-self"}));
    }
    let mut run = start(c);
    let pay = cmd("carol-self", None, json!([{"block": "transfer", "from": "acc-carol", "to": "acc-devco", "amount": "5"}]));
    applied(&mut run, &pay);
    let told = |run: &mut R, post: &str| -> usize {
        let o = run.command(&Command::Observe { participant: "bob-self".into(), only: Some(post.into()) }).unwrap().observation.unwrap();
        match o.channels.get(format!("{post}/money").as_str()) {
            Some(oikos_kernel::observe::ChannelData::Accounts { transactions, .. }) => transactions.len(),
            other => panic!("no accounts channel: {other:?}"),
        }
    };
    assert_eq!(told(&mut run, "devco-office"), 1, "the office is told");
    assert_eq!(told(&mut run, "devco-payroll"), 1, "and so is the payroll, after the office has looked");
    assert_eq!(told(&mut run, "devco-office"), 0, "told once");
}
