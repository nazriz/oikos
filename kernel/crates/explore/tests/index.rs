//! The view index and the causal trace on a hand-built log (tests/fixture.jsonl, the TS explorer's fixture): every kept
//! line comes back as it was, postings equal a brute-force scan, the tracks say where people were and what they held,
//! and a trace walks from a change to the seat that decided it, to what it rested on, to a law made before the run.
//! (renderer/test/index.test.ts, in Rust.)

use oikos_explore::{Decider, Index, Panel, Role, RunIndex};
use serde_json::Value;

const DAY: i64 = 86_400;
const FIXTURE: &str = include_str!("fixture.jsonl");

fn index() -> Index {
    let ix = Index::new();
    ix.feed_all(FIXTURE.lines());
    ix
}
fn ord_of(ix: &Index, pred: impl Fn(&Value) -> bool) -> u32 {
    for o in 0..ix.kept() as u32 {
        if pred(&ix.line(o).unwrap()) {
            return o;
        }
    }
    panic!("no such line");
}

#[test]
fn each_kept_line_comes_back_byte_for_byte_and_only_the_lines_nobody_needs_are_dropped() {
    let ix = index();
    let drop = |l: &str| {
        l.contains("\"command\":\"observe\"")
            || l.contains("\"command\":\"advance_to_news\"")
            || l.contains("\"event\":\"action_started\"")
            || l.contains("\"event\":\"action_applied\"")
            || l.contains("\"event\":\"occupied\"")
            || l.contains("\"annotation\":\"debrief\"")
            || l.contains("\"kind\":\"end\"")
            || (l.contains("\"event\":\"vacated\"") && l.contains("\"reason\":\"left\""))
    };
    let kept: Vec<&str> = FIXTURE.lines().skip(1).filter(|l| !drop(l)).collect();
    assert_eq!(ix.kept(), kept.len());
    for (i, l) in kept.iter().enumerate() {
        assert_eq!(&ix.line_text(i as u32).unwrap(), l);
    }
    for o in 0..ix.kept() as u32 {
        assert!(!ix.line_text(o).unwrap().contains("SECRET-DEBRIEF"), "a debrief was indexed");
    }
}

#[test]
fn a_persons_postings_equal_a_brute_force_scan_of_the_kept_lines() {
    let ix = index();
    for id in ["c1", "c1-self", "acc-c1", "rec.1", "tribunal"] {
        let needle = format!("\"{id}\"");
        let brute: Vec<u32> = (0..ix.kept() as u32)
            .filter(|&o| {
                let t = ix.line_text(o).unwrap();
                let cut = t.rfind(",\"hash\"").unwrap();
                t[..cut].contains(&needle)
            })
            .collect();
        // (decision annotations are posted under their subject only)
        let is_decision = |o: &u32| ix.with(|s| s.name_of(*o).starts_with("annotation:decision"));
        let got: Vec<u32> = ix.postings(id).into_iter().filter(|o| !is_decision(o)).collect();
        let want: Vec<u32> = brute.into_iter().filter(|o| !is_decision(o)).collect();
        assert_eq!(got, want, "{id}");
    }
}

#[test]
fn where_everyone_was_at_midnights_and_in_between_and_what_they_held() {
    let ix = index();
    ix.with(|s| {
        let c2 = s.person_idx["c2"];
        let space = |w: u32| s.space_at(w).map(|x| x.id.clone()).unwrap_or_default();
        assert_eq!(space(s.where_at(0)[c2]), "house-2/dwelling.1");
        assert_eq!(space(s.where_at(DAY + 3000)[c2]), "house-2/dwelling.1");
        assert_eq!(space(s.where_at(DAY + 4000)[c2]), "hall/workplace.1");
        assert_eq!(space(s.where_at(2 * DAY)[c2]), "hall/workplace.1"); // (the midnight keyframe)
        assert_eq!(space(s.where_at(2 * DAY + 2000)[c2]), "house-2/dwelling.1");
        let (c1, m2) = (s.series_money("c1"), s.series_money("c2"));
        assert_eq!(&c1[..3], &[10000, 10000, 9800]);
        assert_eq!(&m2[..3], &[5000, 5000, 5200]);
        for d in 0..c1.len() {
            assert_eq!(c1[d] + m2[d], 15000);
        }
        assert_eq!(&s.series_agency(s.person_idx["c1"])[..3], &[-1, -1, 4100]);
    });
}

#[test]
fn the_trace_of_an_order_the_seat_that_decided_it_why_what_it_rested_on_back_to_a_law_made_before_the_run() {
    let ix = index();
    let order = ord_of(&ix, |e| e["body"]["record"]["id"] == "rec.2");
    let links = ix.trace(order, Some("c1"), 8);
    assert_eq!(links[0].role, Role::Change);
    assert_eq!(links[0].record.as_deref(), Some("rec.2"));
    assert_eq!(links[1].role, Role::Act);
    assert_eq!(links[1].who.as_deref(), Some("member-system"));
    assert_eq!(links[1].as_.as_deref(), Some("member"));
    assert_eq!(links[1].cls, Some(Decider::Seat));
    assert_eq!(links[1].model.as_deref(), Some("mock/mock"));
    assert_eq!(links[1].status.as_deref(), Some("applied"));
    assert_eq!(links[1].why.as_ref().unwrap().kind, "seat");
    let basis = links.iter().find(|l| l.record.as_deref() == Some("rec.1")).unwrap();
    assert_eq!(basis.role, Role::Basis);
    let applicant = links.iter().find(|l| l.role == Role::Act && l.who.as_deref() == Some("c1-self")).unwrap();
    assert_eq!(applicant.cls, Some(Decider::Own)); // (traced for c1: their own application)
    let last = links.last().unwrap();
    assert_eq!((last.role, last.record.as_deref(), last.cls), (Role::Genesis, Some("law-1"), Some(Decider::World)));
}

#[test]
fn a_standing_payment_leads_to_the_instruction_and_the_person_who_gave_it_with_the_decision_they_recorded() {
    let ix = index();
    let pay = ord_of(&ix, |e| e["body"]["event"] == "transfer" && e["body"]["per_instruction"] == "rec.3");
    let links = ix.trace(pay, Some("c1"), 8);
    assert_eq!(
        links.iter().find(|l| l.role == Role::Act && l.who.as_deref() == Some("bank-payments-system")).unwrap().cls,
        Some(Decider::System)
    );
    assert_eq!(links.iter().find(|l| l.record.as_deref() == Some("rec.3")).unwrap().role, Role::Instruction);
    let giver = links.iter().find(|l| l.role == Role::Act && l.who.as_deref() == Some("c2-self")).unwrap();
    assert_eq!(giver.cls, Some(Decider::Person));
    let why = giver.why.as_ref().unwrap();
    assert_eq!(why.kind, "decision");
    assert!(why.text.contains("chose pay"), "{}", why.text);
}

#[test]
fn who_decided_each_change_that_reached_a_person_and_where_the_seats_act_landed() {
    let ix = index();
    ix.with(|s| {
        // pulses: the order (hard, a seat's), the money it moved, the standing payment
        let p: Vec<(String, i32, i32)> = s.pulses.chunks(6).map(|k| (s.persons[k[1] as usize].clone(), k[3], k[4])).collect();
        assert_eq!(p.iter().filter(|x| x.0 == "c1" && x.1 == 3 && x.2 & 1 != 0).count(), 1);
        assert!(p.iter().any(|x| x.0 == "c1" && x.1 == 1)); // c2's standing payment to c1: another person
        assert_eq!(s.seat_acts.len(), 1);
        let a = &s.seat_acts[0];
        assert_eq!(a.participant, "member-system");
        assert_eq!(s.seat_act_status(a).0, "applied");
        assert_eq!(a.draft.as_deref(), Some("draft.member-system.1"));
        let mut ts: Vec<&str> = a.targets.iter().map(|t| t.id.as_str()).collect();
        ts.sort();
        assert_eq!(ts, ["c1", "c2"]);
        assert_eq!(a.targets.iter().find(|t| t.id == "c1").unwrap().st, 0); // house-1
        assert_eq!(a.from, 2); // the tribunal works from the hall
    });
}

#[test]
fn panels_a_persons_life_and_record_an_organisations_posts_and_backlog_a_buildings_occupants() {
    let ix = index();
    let p = ix.panel(Panel::Person("c1".into()), 3 * DAY).unwrap();
    assert_eq!(p["age"], 30);
    assert_eq!(p["home"]["structure"], "house-1");
    assert_eq!(p["record"]["changes"], 1);
    assert_eq!(p["byClass"]["seat"], 2); // the order and the money it moved
    assert_eq!(p["byClass"]["person"], 1); // c2's standing payment
    assert!(p["events"].as_array().unwrap().iter().any(|e| e["hard"] == true && e["cls"] == "seat"));
    let o = ix.panel(Panel::Org("tribunal".into()), 3 * DAY).unwrap();
    assert_eq!(o["posts"][0]["id"], "member");
    assert_eq!(o["posts"][0]["cls"], "seat");
    assert_eq!(o["posts"][0]["model"], "mock/mock");
    assert_eq!(o["backlog"]["open"], 0); // the application was answered
    assert_eq!(ix.panel(Panel::Org("tribunal".into()), DAY).unwrap()["backlog"]["open"], 1);
    let b = ix.panel(Panel::Building(2), DAY + 5000).unwrap();
    assert_eq!(b["inside"].as_array().unwrap().iter().map(|x| x["person"].as_str().unwrap()).collect::<Vec<_>>(), ["c2"]);
    assert_eq!(b["usedBy"].as_array().unwrap().iter().map(|x| x["id"].as_str().unwrap()).collect::<Vec<_>>(), ["tribunal"]);
    assert!(ix.panel(Panel::Person("nobody".into()), 0).is_none());
}

#[test]
fn the_seat_act_panel_joins_the_pilot_data_when_there_is_some_and_is_whole_without() {
    let ix = index();
    let act = ord_of(&ix, |e| e["body"]["participant"] == "member-system" && e["body"]["command"] == "act");
    let plain = ix.panel(Panel::SeatAct(act), 0).unwrap();
    assert_eq!(plain["act"]["status"], "applied");
    assert_eq!(plain["trace"][0]["role"], "act");
    assert!(plain["twin"].is_null());
    ix.set_pilot(serde_json::json!({"seats": [{"id": "member-system", "title": "Member", "model": "mock/mock", "sittings": [{"t": 1, "requests": [{"id": "draft.member-system.1", "act": {"seq": 99}}], "turns": [{"turn": 1, "say": "I order it"}]}]}]}));
    let with = ix.panel(Panel::SeatAct(act), 0).unwrap();
    assert_eq!(with["seat"]["title"], "Member");
    assert_eq!(with["request"]["id"], "draft.member-system.1");
    assert_eq!(with["sitting"]["turns"][0]["say"], "I order it");
}

#[test]
fn lines_by_day_and_the_action_behind_an_effect() {
    let ix = index();
    let d1 = ix.day(1);
    assert!(d1.start < d1.end);
    for o in d1 {
        let t = ix.with(|s| s.t(o));
        assert!((DAY..2 * DAY).contains(&t));
    }
    let order = ord_of(&ix, |e| e["body"]["record"]["id"] == "rec.2");
    let a = ix.action_of(order).unwrap();
    assert_eq!((a.participant.as_str(), a.status.as_str()), ("member-system", "applied"));
    assert_eq!(ix.line(a.act).unwrap()["body"]["command"], "act");
    assert_eq!(ix.decider("c2-self", Some("c2")), Decider::Own);
    assert_eq!(ix.decider("member-system", None), Decider::Seat);
}

#[test]
fn a_live_run_is_queryable_while_it_is_fed() {
    let ix = Index::new();
    assert!(ix.meta()["kept"] == 0);
    let mut mid = None;
    for (i, l) in FIXTURE.lines().enumerate() {
        ix.feed(l);
        if i == 10 {
            mid = Some(ix.meta());
            assert!(ix.panel(Panel::Person("c1".into()), 0).is_some());
        }
    }
    let mid = mid.unwrap();
    let end = ix.meta();
    assert!(mid["kept"].as_u64().unwrap() < end["kept"].as_u64().unwrap());
    assert!(mid["lastT"].as_i64().unwrap() < end["lastT"].as_i64().unwrap());
    // the same index as one read whole
    let whole = index();
    for o in 0..whole.kept() as u32 {
        assert_eq!(ix.line_text(o), whole.line_text(o));
        assert_eq!(ix.postings("c1"), whole.postings("c1"));
    }
    let o = ord_of(&ix, |e| e["body"]["record"]["id"] == "rec.2");
    assert_eq!(serde_json::to_value(ix.trace(o, Some("c1"), 8)).unwrap(), serde_json::to_value(whole.trace(o, Some("c1"), 8)).unwrap());
}

#[test]
fn a_compressed_log_reads_as_a_plain_one() {
    let dir = std::env::temp_dir().join(format!("oikos-explore-zst-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let plain = dir.join("fixture.jsonl");
    let zst = dir.join("fixture.jsonl.zst");
    std::fs::write(&plain, FIXTURE).unwrap();
    std::fs::write(&zst, zstd::bulk::compress(FIXTURE.as_bytes(), 3).unwrap()).unwrap();
    let (a, b) = (Index::new(), Index::new());
    a.load_path(&plain).unwrap();
    b.load_path(&zst).unwrap();
    assert_eq!(a.kept(), b.kept());
    for o in 0..a.kept() as u32 {
        assert_eq!(a.line_text(o), b.line_text(o));
    }
    assert_eq!(a.meta()["state"], "ready");
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn kept_lines_are_held_compressed_in_frames_and_come_back_whole() {
    // a header and 10,000 commands: three frames of 4096 (two finished), every line comes back
    let header = FIXTURE.lines().next().unwrap();
    let ix = Index::new();
    let mut lines = vec![header.to_string()];
    for i in 0..10_000 {
        let body = format!("{{\"command\":\"set_note\",\"note\":\"line number {i} with some padding to compress compress compress\",\"participant\":\"c1-self\"}}");
        lines.push(format!(
            "{{\"body\":{body},\"hash\":\"{:0>64}\",\"kind\":\"command\",\"prev\":\"p\",\"seq\":{},\"t\":{}}}",
            i,
            i + 1,
            i
        ));
    }
    ix.feed_all(&lines);
    assert_eq!(ix.kept(), 10_000);
    let held = ix.memory_held();
    let plain: usize = lines.iter().map(|l| l.len()).sum();
    assert!(held < plain / 2, "held {held} of {plain}");
    for o in [0u32, 4095, 4096, 8191, 8192, 9999] {
        assert_eq!(ix.line_text(o).unwrap(), lines[o as usize + 1]);
    }
    assert!(ix.line_text(10_000).is_none());
}
