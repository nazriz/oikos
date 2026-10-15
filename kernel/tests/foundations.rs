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
//! `money_conservation.rs` and `goods.rs`; what is added here is time.

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
        position: position.map(String::from),
        blocks: serde_json::from_value(blocks).expect("the blocks parse"),
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

/// The town with the world's table of act times set (`orchestration.act_time`).
fn town_with_times(table: Value) -> R {
    let mut c = world(&default_params());
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
    c["orchestration"]["act_time"] = json!({"system": {"message": 10}});
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
#[ignore = "F2: the work table keyed by what an act makes (a block and the kind of record it writes)"]
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

/// Today `work` takes a body's hours only. A system named as a performer is refused (it has no working day). After F3
/// and F4 a system whose template lists the work may perform it; one whose template does not is still refused. This
/// holds in both states, for a system with no such row.
#[test]
fn law3_a_system_with_no_row_for_a_work_cannot_perform_it() {
    let mut run = town();
    let code = outcome(&mut run, &make(1, &["builder-system"]));
    assert!(code.is_some(), "a system with no template row for `make` was allowed to perform it");
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
#[ignore = "F4: a system acts only within its template's `does` (refusal `not_capable`)"]
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

/// Deliver a clerk-bot to the city the way the plan says: the supplier's act, naming the client (F4).
fn deliver(run: &mut R) -> String {
    let r = applied(run, &cmd("outside-system", Some("outside-trade"), json!([{"block": "deploy", "template": "clerk-bot", "to": "city", "ref": "bot"}])));
    r["created"]["bot"].as_str().expect("the delivered system's id").to_string()
}

#[test]
#[ignore = "F4: `deploy` is the supplier's act, naming the client organisation (`deploy.to`); refusal `not_supplier`"]
fn law3_only_the_templates_supplier_delivers_a_system() {
    let mut run = with_template(|t| t["supplier"] = json!("outside"));
    // The city cannot make itself a system out of nothing (today it can: `deploy` makes one for the acting org).
    let own = cmd("mayor-system", Some("mayor"), json!([{"block": "deploy", "template": "clerk-bot"}]));
    assert_eq!(outcome(&mut run, &own).as_deref(), Some("not_supplier"));
    // The supplier delivers, to the city; the system belongs to the city.
    let bot = deliver(&mut run);
    assert_eq!(run.kernel().state().participants[&bot].owner.as_deref(), Some("city"));
}

#[test]
fn law4_a_system_is_retired_by_its_owner_and_not_by_anyone_else() {
    let mut run = town();
    let r = applied(&mut run, &cmd("mayor-system", Some("mayor"), json!([{"block": "deploy", "template": "clerk-bot", "ref": "bot"}])));
    let bot = r["created"]["bot"].as_str().unwrap().to_string();
    let by_stranger = cmd("developer-system", Some("developer"), json!([{"block": "retire", "participant": bot}]));
    assert_eq!(outcome(&mut run, &by_stranger).as_deref(), Some("not_theirs"));
    let by_owner = cmd("mayor-system", Some("mayor"), json!([{"block": "retire", "participant": bot}]));
    assert_eq!(outcome(&mut run, &by_owner), None);
}

#[test]
#[ignore = "F4: the supplier may also switch a system off (a licence ended, the vendor's switch: lock-in is physical)"]
fn law4_a_system_is_switched_off_by_its_supplier_too() {
    let mut run = with_template(|t| t["supplier"] = json!("outside"));
    let bot = deliver(&mut run);
    let stranger = cmd("developer-system", Some("developer"), json!([{"block": "retire", "participant": bot}]));
    assert_eq!(outcome(&mut run, &stranger).as_deref(), Some("not_theirs"));
    let supplier = cmd("outside-system", Some("outside-trade"), json!([{"block": "retire", "participant": bot}]));
    assert_eq!(outcome(&mut run, &supplier), None);
}

/// A world loads only if every post's holder is a person or a system delivered from a template (F4(e)). The test
/// world's own systems name no template (they are hand-written); F4 updates the fixtures and turns this on.
#[test]
#[ignore = "F4: a world whose posts are held by systems no template made is refused at load"]
fn law3_a_world_with_a_free_holder_does_not_load() {
    let c = world(&default_params()); // mayor-system is a system with no template and no supplier
    assert!(Run::start(c, "foundations", Vec::new(), None).is_err(), "a post held by a system nobody supplied loaded");
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
#[ignore = "F3: `by` on any act, and recorded on the applied act"]
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
#[ignore = "F3: performers on any act; a person performer must be at the place the work asks (`not_at_work`)"]
fn law5_a_performer_who_is_not_there_cannot_do_the_work() {
    let mut run = town();
    // Alice is at home (s-house), not at a workplace of the shop: she cannot be the hand that sends this.
    let c = cmd("developer-system", Some("developer"), json!([{"block": "message", "to": ["bob-self"], "text": "hi", "by": ["alice"]}]));
    assert_eq!(outcome(&mut run, &c).as_deref(), Some("not_at_work"));
}
