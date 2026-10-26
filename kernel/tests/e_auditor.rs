//! office.auditor alone in the Rust world (docs/port-guide.md, section 4): the town's finance office pays an invoice, the audit
//! law (a published paper) names it as a body to audit on its accounts, the auditor asks for its statement at the end of the
//! period, the finance office answers from its own books, and the auditor reports in public whether the books and the bank's
//! record reconcile. Every other kind stands idle. Run on one thread and on fourteen: the same world, byte for byte.

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
        stmt(
            "law-audit",
            "law",
            "The audit law.",
            json!({ "audit": { "auditor": "city", "office": "audit", "answer_within_days": 10, "report_within_days": 10,
                "bodies": [{ "body": "town_finance", "entity": "city", "every_days": 30, "checks": ["accounts"] }] } }),
            json!({}),
        ),
    ];
    let mut c = common::world(&common::WorldParams { extra_records: records, ..common::default_params() });
    c["clock"]["run_seconds"] = json!(70 * DAY);
    for p in c["participants"].as_array_mut().expect("participants") {
        if p["id"] == "finance-system" {
            p["controller"] = json!({ "type": "code", "impl": "city.finance_officer", "params": {} });
        }
        if p["id"] == "mayor-system" {
            p["controller"] = json!({ "type": "code", "impl": "office.auditor", "params": {} });
        }
        // The bank pays on the finance office's instruction (so the bank's record has the payment in it).
        if p["id"] == "bank-pay-system" {
            p["controller"] = json!({ "type": "code", "impl": "bank.payment_system", "params": { "verify_author": false, "town": "city" } });
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

fn recorded<'a>(log: &'a [Value], kind: &str) -> Vec<&'a Value> {
    log.iter().filter(|l| l["body"]["event"] == "recorded" && l["body"]["record"]["kind"] == kind).map(|l| &l["body"]["record"]).collect()
}

#[test]
fn the_auditor_asks_the_finance_office_for_its_statement_and_reports_that_the_books_and_the_bank_agree() {
    let (_, e) = run_code_world(town(), "auditor", Vec::new(), opts(2)).expect("the run");
    let log = lines(&e.into_log());
    let asked = recorded(&log, "audit_request");
    assert!(!asked.is_empty(), "the auditor asked");
    assert_eq!(asked[0]["data"]["ask"], "statement");
    assert_eq!(asked[0]["visible_to"], "public", "in public, addressed to no one");
    let answered = recorded(&log, "audit_answer");
    assert_eq!(answered.len(), 2, "each request answered once, from its own books");
    let first = &answered[0]["data"]["statement"];
    assert_eq!((first["books"].as_array().map(Vec::len), first["bank"].as_array().map(Vec::len)), (Some(1), Some(1)), "the payment is in the books and in the bank's record: {}", answered[0]);
    let reports = recorded(&log, "audit_report");
    assert_eq!(reports.len(), 2, "one report for each period ended in 70 days");
    assert_eq!(reports[0]["data"]["check"], "accounts");
    assert_eq!(reports[0]["data"]["reconciles"], true, "{}", reports[0]);
    assert_eq!(reports[0]["data"]["matched"], 1);
    assert_eq!(reports[1]["data"]["matched"], 0, "nothing was paid in the second");
    assert_eq!(reports[0]["visible_to"], "public");
    assert_eq!(recorded(&log, "audit_finding").len(), 2, "its working paper on each");
    // Every paper reads as its type.
    for r in &asked {
        assert!(r["data"]["answer_by"].as_i64().unwrap() > r["at"].as_i64().unwrap());
    }
}

#[test]
fn the_same_world_on_one_thread_and_on_fourteen_is_the_same_world() {
    let run = |threads| {
        let (hash, e) = run_code_world(town(), "auditor-threads", Vec::new(), opts(threads)).expect("the run");
        (hash, e.into_log())
    };
    let (h1, l1) = run(1);
    let (h14, l14) = run(14);
    assert_eq!(h1, h14);
    assert!(l1 == l14, "the logs are byte for byte the same");
}
