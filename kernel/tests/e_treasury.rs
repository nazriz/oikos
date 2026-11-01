//! Lane E, the treasury offices alone in the Rust world (docs/port-guide.md, section 4): the finance officer pays an
//! invoice addressed to the town within its adopted budget; the rates officer levies on a valuation and writes the
//! town's claim; every other kind stands idle. Run on one thread and on fourteen: the same world, byte for byte.

use crate::common;

use oikos_kernel::engine::{run_code_world, EngineOptions};
use serde_json::{json, Value};

const DAY: i64 = 86_400;

fn stmt(id: &str, kind: &str, text: &str, data: Value, extra: Value) -> Value {
    let mut r = json!({ "id": id, "record": "statement", "author": "genesis", "at": 0, "visible_to": "public", "kind": kind, "speaks_for": "city", "text": text, "data": data });
    for (k, v) in extra.as_object().cloned().unwrap_or_default() {
        r[k] = v;
    }
    r
}

fn town() -> Value {
    let records = vec![
        stmt("budget-year-1", "budget", "The budget for year 1.", json!({ "year": 1, "lines": { "parks": 10_000_000 } }), json!({})),
        stmt("inv-1", "invoice", "For the park.", json!({ "outcome": { "money": { "to": "acc-buildco", "amount": "2000000", "for": "a park" } } }), json!({ "addressed_to": ["city"], "speaks_for": "buildco" })),
        stmt("law-rates", "law", "Rates are levied on the value of land.", json!({ "tax": "rates", "rate_ppm": 10_000, "instalments": 4, "due_days": 30, "penalty_interest_bps": 0 }), json!({})),
        stmt("val-1", "valuation", "Lot lot-c valued.", json!({ "lot": "lot-c", "owner": "alice", "land": 1_000_000, "value": 40_000_000, "year": 1 }), json!({ "addressed_to": ["alice", "city"], "speaks_for": "outside" })),
    ];
    let mut c = common::world(&common::WorldParams { extra_records: records, ..common::default_params() });
    c["clock"]["run_seconds"] = json!(60 * DAY);
    for p in c["participants"].as_array_mut().expect("participants") {
        if p["id"] == "finance-system" {
            p["controller"] = json!({ "type": "code", "impl": "city.finance_officer", "params": {} });
        }
        if p["id"] == "mayor-system" {
            p["controller"] = json!({ "type": "code", "impl": "city.rates_officer", "params": { "first_day": 1 } });
        }
    }
    c
}

fn lines(log: &[u8]) -> Vec<Value> {
    log.split(|b| *b == b'\n').filter(|l| !l.is_empty()).map(|l| serde_json::from_slice(l).expect("a log line")).collect()
}

fn opts(threads: usize) -> EngineOptions {
    EngineOptions { threads, stand_in: Some("idle".into()), share_at: 1, ..Default::default() }
}

#[test]
fn the_finance_officer_pays_an_invoice_within_the_budget_and_the_rates_officer_levies_on_the_valuation() {
    let (_, e) = run_code_world(town(), "treasury", Vec::new(), opts(2)).expect("the run");
    let text = String::from_utf8(e.into_log()).expect("text");
    let log = lines(text.as_bytes());
    assert!(log.iter().any(|l| l["body"]["transfer"]["settles"] == "inv-1" || (l.to_string().contains("\"settles\":\"inv-1\"") && l.to_string().contains("2000000"))), "the invoice was paid");
    let notices: Vec<&Value> = log.iter().filter(|l| l["body"]["event"] == "recorded" && l["body"]["record"]["kind"] == "rates_notice").map(|l| &l["body"]["record"]).collect();
    assert_eq!(notices.len(), 1, "one instalment in 60 days");
    assert_eq!(notices[0]["data"]["amount"], 100_000, "40,000,000 at 1% a year, a quarter");
    assert!(log.iter().any(|l| l["body"]["event"] == "recorded" && l["body"]["record"]["record"] == "claim" && l["body"]["record"]["about"]["kind"] == "rates"), "and the town's claim beside it");
}

#[test]
fn the_same_world_on_one_thread_and_on_fourteen_is_the_same_world() {
    let run = |threads| {
        let (hash, e) = run_code_world(town(), "treasury-threads", Vec::new(), opts(threads)).expect("the run");
        (hash, e.into_log())
    };
    let (h1, l1) = run(1);
    let (h14, l14) = run(14);
    assert_eq!(h1, h14);
    assert!(l1 == l14, "the logs are byte for byte the same");
}
