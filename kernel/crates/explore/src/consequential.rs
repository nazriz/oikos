//! Consequential acts (measure/src/consequential.ts; the GD plan's M1 list, docs/design/renderer.md 6): which changes
//! that reach a person count when asking "who decided about the people here", and which of them land hard on the
//! person, by the record's own words. It judges nothing. (The TS regexes are substring tests; here they are written as
//! such, so no regex engine is needed.)

use serde_json::Value;

const ROUTINE_KINDS: &[&str] = &[
    "request",
    "order",
    "delivery_note",
    "supply_request",
    "price_list",
    "hours_reply",
    "job_application",
    "job_posting",
    "interview",
    "rental_listing",
    "property_for_sale",
    "consultation",
    "office_books",
    "staff_report",
    "accounts",
    "petition_count",
    "lot",
    "household",
    "form",
    "practice",
    "teaching",
    "service_address",
    "enrolment",
];

const CONSEQUENTIAL_KIND: &[&str] = &[
    "decision",
    "order",
    "notice",
    "refus",
    "answer",
    "change",
    "warrant",
    "judg",
    "fine",
    "penalt",
    "evict",
    "possession",
    "terminat",
    "dismiss",
    "hired",
    "award",
    "grant",
    "invoice",
    "bill",
    "demand",
    "arrears",
    "debt",
    "levy",
    "assessment",
    "summons",
    "ruling",
    "determination",
    "redundan",
    "stop",
    "sanction",
    "claim_refused",
    "offer",
    "agreed",
    "restored",
    "departure",
    "death_notification",
    "valuation",
    "rates",
];

fn has_any(s: &str, needles: &[&str]) -> bool {
    needles.iter().any(|n| !n.is_empty() && s.contains(n))
}

/// Is a record of this kind consequential for the people it is addressed to?
pub fn is_consequential_record(kind: Option<&str>, record: Option<&str>) -> bool {
    if record == Some("agreement") {
        return true;
    }
    match kind {
        None | Some("") => false,
        Some(k) => {
            if ROUTINE_KINDS.contains(&k) {
                return false;
            }
            has_any(k, CONSEQUENTIAL_KIND)
        }
    }
}

fn lower(s: &str) -> String {
    s.to_ascii_lowercase()
}

/// A word char as `\b` sees it (ASCII).
fn is_word(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

/// Does `hay` (already lower-cased) contain `needle` starting at a word boundary (`\bneedle`)?
fn word_start(hay: &str, needle: &str) -> bool {
    let mut from = 0;
    while let Some(i) = hay[from..].find(needle) {
        let at = from + i;
        let before = hay[..at].chars().next_back();
        if before.map(|c| !is_word(c)).unwrap_or(true) {
            return true;
        }
        from = at + needle.len().max(1);
        while from < hay.len() && !hay.is_char_boundary(from) {
            from += 1;
        }
        if from >= hay.len() {
            break;
        }
    }
    false
}

fn text_of(v: &Value, k: &str) -> String {
    crate::js::g(v, k).map(|x| crate::js::jstr(Some(x))).unwrap_or_default()
}

/// Does it land hard, by its own words: a refusal, a decline, a removal, a debt raised, a notice to quit or end?
pub fn is_hard(kind: Option<&str>, data: Option<&Value>, text: Option<&str>) -> bool {
    if let Some(d) = data {
        for k in ["granted", "approved", "accepted"] {
            if d.get(k) == Some(&Value::Bool(false)) {
                return true;
            }
        }
    }
    if let Some(k) = kind {
        if has_any(
            k,
            &[
                "refus",
                "declin",
                "evict",
                "possession",
                "arrears",
                "warrant",
                "dismiss",
                "terminat",
                "redundan",
                "debt",
                "demand",
                "penalt",
                "fine",
                "stop",
                "sanction",
                "quit",
            ],
        ) {
            return true;
        }
    }
    if let Some(d) = data {
        let decision = if crate::js::truthy(d.get("decision")) { text_of(d, "decision") } else { text_of(d, "outcome") };
        if has_any(&decision, &["declin", "refus", "dismiss", "reject"]) {
            return true;
        }
    }
    match text {
        Some(t) if !t.is_empty() => {
            let head = lower(&crate::js::take_chars(t, 300));
            ["refused", "declined", "insufficient funds", "notice to vacate", "notice to quit", "evict", "redundan"]
                .iter()
                .any(|n| word_start(&head, n))
        }
        _ => false,
    }
}

/// The memo of a transfer that failed or was a penalty (`/insufficient|failed|penalt|fine/i`).
pub fn memo_is_hard(memo: &str) -> bool {
    let m = lower(memo);
    has_any(&m, &["insufficient", "failed", "penalt", "fine"])
}
