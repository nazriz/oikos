//! What stands open at the offices that hear and decide, and at a lender's (participants/src/behaviour/
//! openbooks-venues.ts; docs/behaviour/office-books.md): the tribunal's member and registrar (`tribunal.member`,
//! `tribunal.registrar`), a complaints desk (`office.desk`), a union's organiser (`union.organiser`) and a bank's lending
//! office (`bank.lending`). One reader each, a plain restatement of what that module's code works out for itself wake
//! after wake from the same papers, read the same way. Nothing here decides or does anything, and nothing is read that the
//! office's code is not shown.
//!
//! Rewritten, not transliterated (see `openbooks.rs`): whole numbers, ordered collections, the same papers out. Where the
//! TS iterated a `Map` whose order shows (the notices an office has filed, a union's claims, a lender's loans) it is kept
//! as a list in the order the map would have held it. The lender keeps what the TS kept in memory (`loans`, `byAccount`,
//! where the office's account is, whether it has first looked, when each agreement was signed) and saves it with its book.

use super::books::{OfficeBooks, OpenHeading, OpenItem};
use super::openbooks::{
    addressed, amt, by_day, d as data_of, date_words, finite, has, heading, js, num, on, pressing, terms_of, text_of, usd, when, words, R,
};
use crate::common::{addressed_to, bases_of, kind as kind_of, made_at, own_account, Book, Fields, DAY, MONTH};
use crate::finance::frictions::paper;
use crate::{Picture, WorldInfo};
use oikos_sight::{Record, RecordBody};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

static NULL: Value = Value::Null;

// ---------------------------------------------------------------- small shared things

/// A value that is there and not null (what `??` takes).
fn nn(v: Option<&Value>) -> Option<&Value> {
    v.filter(|x| !x.is_null())
}

/// a template literal of `x ?? fallback`.
fn js_or(v: Option<&Value>, fallback: &str) -> String {
    nn(v).map_or_else(|| fallback.to_string(), |x| js(Some(x)))
}

/// a template literal of `Number(x) / 100`: basis points as a percentage, written as JavaScript writes the number
/// (exactly, from the whole number of basis points: "12.5", "7", "0.25"); "NaN" where it is not a whole number.
fn pct(v: Option<&Value>) -> String {
    let n = match v {
        Some(Value::Null) => Some(0),
        Some(Value::Bool(b)) => Some(i64::from(*b)),
        Some(x) => crate::papers::lenient::whole(x),
        None => None,
    };
    let Some(n) = n else { return "NaN".to_string() };
    let (sign, a) = if n < 0 { ("-", -n) } else { ("", n) };
    let (w, f) = (a / 100, a % 100);
    if f == 0 {
        format!("{sign}{w}")
    } else if f % 10 == 0 {
        format!("{sign}{w}.{}", f / 10)
    } else {
        format!("{sign}{w}.{f:02}")
    }
}

/// Whether a day named on a paper has come: the day itself counts, from its first hour (a case is decided "on or after
/// its day", and whoever sits that morning must find it on the list).
fn day_come(by: i64, t: i64) -> bool {
    by.div_euclid(DAY) <= t.div_euclid(DAY)
}

fn is_me(r: &Record, me: &str) -> bool {
    r.speaks_for.as_deref() == Some(me)
}

/// An amount in cents, or 0 where what is written is not one (venues' `money`).
fn money(v: Option<&Value>) -> i64 {
    amt(v)
}

/// The applications a paper is about: the one its data names, and any it cites.
fn apps_of(r: &Record) -> Vec<String> {
    let mut v: Vec<String> = vec![];
    if let Some(a) = data_of(r).s("application") {
        v.push(a.to_string());
    }
    for b in bases_of(r) {
        if !v.iter().any(|x| x ==b) {
            v.push(b.to_string());
        }
    }
    v
}

/// The matter an application or a notice is about, as the venue's papers name it.
fn matter_of(x: &Value) -> String {
    match nn(x.get("matter")).or_else(|| nn(x.get("kind"))) {
        Some(v) => words(Some(v)),
        None => "something".to_string(),
    }
}

// ---------------------------------------------------------------- venues: applications, notices, decisions

struct VForms {
    application: &'static [&'static str],
    notice: &'static str,
    response: &'static str,
    decision: &'static str,
}
const COMMON_FORMS: VForms = VForms { application: &[paper::APPLICATION], notice: paper::NOTICE, response: paper::RESPONSE, decision: paper::DECISION };
const TRIBUNAL_FORMS: VForms = VForms { application: &["tribunal_application"], notice: "hearing_notice", response: "tribunal_response", decision: "tribunal_order" };

/// What an office has filed on the applications made to it: its notices, its decisions, and who has answered.
struct Filed {
    me: String,
    forms: VForms,
    /// application -> our latest notice of it, in the order the applications were first noticed.
    notice: Vec<(String, R)>,
    /// Applications we have decided (or rejected, or whose maker has withdrawn them).
    decided: BTreeSet<String>,
    /// application -> who answered it.
    answers: BTreeMap<String, BTreeSet<String>>,
}

impl Filed {
    fn new(book: &Book, me: &str, forms: VForms) -> Filed {
        let mut notice: Vec<(String, R)> = vec![];
        for n in book.open(forms.notice) {
            if !is_me(n, me) {
                continue;
            }
            for a in apps_of(n) {
                match notice.iter().position(|(k, _)| *k == a) {
                    Some(i) => {
                        if notice[i].1.at <= n.at {
                            notice[i].1 = n.clone();
                        }
                    }
                    None => {
                        if -1 <= n.at {
                            notice.push((a, n.clone()));
                        }
                    }
                }
            }
        }
        let mut decided = BTreeSet::new();
        for dec in book.open(forms.decision) {
            if is_me(dec, me) {
                decided.extend(apps_of(dec));
            }
        }
        // (An application its maker has withdrawn stands open no longer.)
        for (a, _) in &notice {
            if book.withdrawn(a) {
                decided.insert(a.clone());
            }
        }
        let mut answers: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        for r in book.open(forms.response) {
            for a in apps_of(r) {
                answers.entry(a).or_default().insert(super::openbooks::jss(r.speaks_for.as_deref()));
            }
        }
        Filed { me: me.to_string(), forms, notice, decided, answers }
    }
    fn noticed(&self, app: &str) -> bool {
        self.notice.iter().any(|(k, _)| k == app)
    }
    fn answered(&self, application: &str, against: &str) -> bool {
        self.answers.get(application).is_some_and(|s| s.contains(against))
    }
}

/// `who`: the applicant the notice names, else whoever made the application, else "someone".
fn who_of(book: &Book, x: &Value, app: &str) -> String {
    let t = text_of(x.get("applicant"));
    if !t.is_empty() {
        return t.to_string();
    }
    match book.get(app).and_then(|r| r.speaks_for.as_deref()) {
        Some(s) => s.to_string(),
        None => "someone".to_string(),
    }
}

/// Applications addressed to the office that it has neither taken in (no notice of ours) nor decided.
fn untaken(book: &Book, filed: &Filed, why: &str, w: &WorldInfo) -> Vec<OpenItem> {
    let mut out = vec![];
    for kind in filed.forms.application {
        for a in book.open(kind) {
            if !addressed(a, &filed.me) || filed.noticed(&a.id) || filed.decided.contains(a.id.as_str()) {
                continue;
            }
            let x = data_of(a);
            let line = format!(
                "{}: {} applied {} about {}{}{}; {why}",
                a.id,
                super::openbooks::jss(a.speaks_for.as_deref()),
                date_words(a.at, w),
                matter_of(x),
                if on(x, "against") { format!(" against {}", js(x.get("against"))) } else { String::new() },
                if has(x, "amount") { format!(", seeking {}", usd(money(x.get("amount")), w)) } else { String::new() },
            );
            out.push(OpenItem::new(a.id, line).since(a.at).amount(has(x, "amount").then(|| money(x.get("amount")))));
        }
    }
    out
}

/// Applications the office has taken in (it has told the other side) and not decided: those still within the other
/// side's time to answer, and those whose time has run. A tribunal's own three kinds name a hearing day (`hearing_at`)
/// and have no `answer_by`: those are the member's own, not the lists', and are left to the caller (`aside`).
fn taken_in(book: &Book, filed: &Filed, t: i64, aside: &BTreeSet<String>, w: &WorldInfo) -> (Vec<OpenItem>, Vec<OpenItem>) {
    let (mut waiting, mut ran) = (vec![], vec![]);
    let mut seen: BTreeSet<&str> = BTreeSet::new();
    for (app, n) in &filed.notice {
        if !seen.insert(n.id.as_str()) {
            continue;
        }
        let x = data_of(n);
        if filed.decided.contains(app) || aside.contains(app) || !has(x, "answer_by") {
            continue;
        }
        let Some(by) = num(x.get("answer_by")) else { continue };
        let against = text_of(x.get("against"));
        let who = who_of(book, x, app);
        let amount = has(x, "amount").then(|| money(x.get("amount")));
        let what = format!(
            "{who}'s application {app} about {}{}{}",
            matter_of(x),
            if against.is_empty() { String::new() } else { format!(" against {against}") },
            match amount {
                Some(a) if a != 0 => format!(", seeking {}", usd(a, w)),
                _ => String::new(),
            }
        );
        let said = if against.is_empty() {
            String::new()
        } else if filed.answered(app, against) {
            format!("{against} has answered")
        } else {
            format!("{against} has not answered")
        };
        let shown = amount.filter(|a| *a != 0);
        if !day_come(by, t) {
            let line = format!(
                "{}: {what}, taken in {}; {} has until {} to answer{}",
                n.id,
                when(made_at(n), w),
                if against.is_empty() { "the other side" } else { against },
                date_words(by, w),
                if said.is_empty() { String::new() } else { format!(" ({said})") }
            );
            waiting.push(OpenItem::new(n.id, line).since(made_at(n)).due(Some(by)).amount(shown));
        } else {
            let line = format!(
                "{}: {what}, taken in {}; the time to answer {} {}{}; not decided",
                n.id,
                when(made_at(n), w),
                if t >= by { "ran out" } else { "runs out today," },
                date_words(by, w),
                if said.is_empty() { String::new() } else { format!(" ({said})") }
            );
            ran.push(OpenItem::new(n.id, line).since(by).due(Some(by)).amount(shown));
        }
    }
    (waiting, ran)
}

// ---------------------------------------------------------------- tribunal.member

/// The tribunal's member (tribunal.member). Reads, as its code does: applications of kind `tribunal_application`
/// addressed to it; its own `hearing_notice`s (a notice of its three kinds names the hearing day, `hearing_at`; a notice
/// of one of its lists names the day the other side's time to answer runs out, `answer_by`); its own `tribunal_order`s,
/// which close a case; and `tribunal_response`s citing an application, from the respondent.
fn member(book: &Book, me: &str, t: i64, w: &WorldInfo) -> Vec<OpenHeading> {
    let filed = Filed::new(book, me, TRIBUNAL_FORMS);
    let not_yet = untaken(book, &filed, "not yet listed for a hearing", w);
    // (Our own three kinds: a hearing day.)
    let mut own_day: BTreeSet<String> = BTreeSet::new();
    let (mut due, mut waiting) = (vec![], vec![]);
    for (app, n) in &filed.notice {
        let x = data_of(n);
        if has(x, "answer_by") || filed.decided.contains(app) {
            continue;
        }
        let Some(day) = finite(x.get("hearing_at")) else { continue };
        own_day.insert(app.clone());
        let against = text_of(x.get("against"));
        let who = who_of(book, x, app);
        let what = format!("{who}'s application {app} ({}) against {}", words(x.get("kind")), if against.is_empty() { "someone" } else { against });
        let said = if against.is_empty() {
            String::new()
        } else if filed.answered(app, against) {
            format!("{against} has answered")
        } else {
            format!("{against} has not answered")
        };
        let said = if said.is_empty() { "no respondent named".to_string() } else { said };
        if day_come(day, t) {
            let line = format!("{}: {what}, listed {} for hearing on {}, which has come; no order made ({said})", n.id, date_words(n.at, w), date_words(day, w));
            due.push(OpenItem::new(n.id, line).since(day).due(Some(day)));
        } else {
            let line = format!("{}: {what}, listed {} to be heard on {} ({said})", n.id, date_words(n.at, w), date_words(day, w));
            waiting.push(OpenItem::new(n.id, line).since(n.at).due(Some(day)));
        }
    }
    // Applications for possession of a let home (docs/behaviour/justice.md, "Possession"): each with the home, what the
    // landlord says is owed, and whether the tenant has answered and with what, as the tribunal's own procedure reads
    // them.
    let (mut possession, mut possession_due) = (vec![], vec![]);
    for (app, n) in &filed.notice {
        let x = data_of(n);
        let a = book.get(app).map(|r| &**r);
        let ad = a.map_or(&NULL, data_of);
        if filed.decided.contains(app) || nn(x.get("matter")).or_else(|| nn(ad.get("matter"))).and_then(Value::as_str) != Some("possession") || own_day.contains(app) {
            continue;
        }
        own_day.insert(app.clone());
        let against = if text_of(x.get("against")).is_empty() { text_of(ad.get("against")) } else { text_of(x.get("against")) };
        let who = if !text_of(x.get("applicant")).is_empty() {
            text_of(x.get("applicant")).to_string()
        } else {
            (a.and_then(|r| r.speaks_for).unwrap_or_else(|| "someone".into())).to_string()
        };
        let by = finite(nn(x.get("answer_by")).or_else(|| x.get("hearing_at")));
        let answer = super::openbooks::latest(book.open(TRIBUNAL_FORMS.response).filter(|r| apps_of(r).contains(app) && r.speaks_for.as_deref() == Some(against)));
        // (What the file shows of how the tenant was told: the notice to vacate the application relies on, as the
        // application states it, and our own notice of hearing, on the record addressed to the tenant.)
        let relied = if on(ad, "notice") {
            format!(
                "; it relies on notice to vacate {}{}{}",
                js(ad.get("notice")),
                finite(ad.get("notice_given")).map_or(String::new(), |g| format!(", given {}", when(g, w))),
                finite(ad.get("notice_by")).map_or(String::new(), |g| format!(", to leave by {}", when(g, w))),
            )
        } else {
            String::new()
        };
        let to = addressed_to(n).join(" and ");
        let told = format!("; our notice of hearing {} is on the record, addressed to {}, since {}", n.id, if to.is_empty() { "both sides" } else { &to }, date_words(n.at, w));
        // (The tenant's answer as the tenant gave it, and the landlord's reply to it, where there is one.)
        let said = match answer {
            Some(ans) => answer_words(against, ans, w),
            None => format!("{} has not answered", if against.is_empty() { "the tenant" } else { against }),
        };
        let reply = super::openbooks::latest(book.all("tribunal_reply").filter(|r| r.speaks_for.as_deref() == Some(who.as_str()) && words_of(data_of(r).get("application")) == *app));
        let replied = match reply {
            Some(rp) => {
                let rd = data_of(rp);
                format!(
                    "; {who} replied {} ({}): its rent book shows {} owed{}{}",
                    date_words(rp.at, w),
                    rp.id,
                    usd(money(rd.get("owed")), w),
                    match rd.get("takes_plan") {
                        Some(Value::Bool(true)) => ", and it would take the plan offered",
                        Some(Value::Bool(false)) => ", and it would not take the plan offered",
                        _ => "",
                    },
                    if text_of(rd.get("words")).is_empty() { String::new() } else { format!("; \"{}\"", text_of(rd.get("words"))) },
                )
            }
            None => String::new(),
        };
        let owed = has(ad, "amount").then(|| money(ad.get("amount")));
        let line = format!(
            "{app}: {who} applies for possession of {} from {}{}{}{}{relied}; taken in {}{told}{}; {said}{replied}; not decided",
            js_or(ad.get("space"), "a let home"),
            if against.is_empty() { "its tenant" } else { against },
            if on(ad, "about") { format!(" (lease {})", js(ad.get("about"))) } else { String::new() },
            owed.map_or(String::new(), |o| format!(", saying {} of rent is owed", usd(o, w))),
            if on(ad, "breach") { ", and that a plan the tribunal set was not kept" } else { "" },
            date_words(n.at, w),
            by.map_or(String::new(), |by| format!(
                ", {}",
                if t >= by {
                    format!("the tenant's time to answer ran out {}", date_words(by, w))
                } else if day_come(by, t) {
                    format!("the tenant's time to answer runs out today, {}", date_words(by, w))
                } else {
                    format!("the tenant has until {} to answer", date_words(by, w))
                }
            )),
        );
        let item = OpenItem::new(app.clone(), line).since(a.map_or(n.at, |r| r.at)).due(by).amount(owed);
        if by.is_some_and(|b| day_come(b, t)) {
            possession_due.push(item);
        } else {
            possession.push(item);
        }
    }
    let (lists_waiting, lists_ran) = taken_in(book, &filed, t, &own_day, w);
    let mut listed = waiting;
    listed.extend(lists_waiting);
    [
        // (Every case that stands open, with the day the other side may answer by and whether an answer has come: those
        // whose day has come first, said in every paper for as long as they stand; then those waiting, the soonest
        // first, however long ago each was listed.)
        pressing(&format!("Applications for possession of a let home whose day has come, not decided{}", law_of_order(book)), possession_due),
        pressing("Cases listed whose hearing day has come, with no order made", due),
        pressing("Applications on the tribunal's lists whose time to answer has run, not decided", lists_ran),
        heading("Applications to the tribunal, not yet listed for a hearing", not_yet),
        by_day("Applications for possession of a let home, waiting for the tenant's time to answer", possession),
        by_day("Cases listed, waiting for their day", listed),
    ]
    .concat()
}

/// `String(x ?? "")`.
fn words_of(v: Option<&Value>) -> String {
    nn(v).map_or_else(String::new, |x| js(Some(x)))
}

/// A tenant's answer to an application for possession, as they gave it: what they told, in the order of the tribunal's
/// form, and nothing for what they left out (an answer that says little reads as one).
fn answer_words(against: &str, a: &Record, w: &WorldInfo) -> String {
    let x = data_of(a);
    let mut parts: Vec<String> = vec![];
    if on(x, "left") {
        parts.push(format!("they have left the home{}", finite(x.get("left_at")).map_or(String::new(), |l| format!(", on {}", date_words(l, w)))));
    }
    if has(x, "owes") {
        parts.push(format!("says {} is owed today{}", usd(money(x.get("owes")), w), if on(x, "disputes_sum") { ", less than the landlord says" } else { "" }));
    }
    if has(x, "paid") {
        parts.push(format!("says {} has been paid since", usd(money(x.get("paid")), w)));
    }
    if on(x, "disputes_notice") {
        parts.push("says the notice to vacate did not give the days the law asks".to_string());
    }
    if has(x, "offer") {
        parts.push(if money(x.get("offer")) > 0 {
            format!(
                "could pay {} {} toward what is owed, beyond the rent",
                usd(money(x.get("offer")), w),
                match finite(x.get("every_days")) {
                    Some(n) if n != 0 && n != 30 => format!("every {} days", js(x.get("every_days"))),
                    _ => "a month".to_string(),
                }
            )
        } else {
            "can pay nothing toward what is owed beyond the rent".to_string()
        });
    }
    if let Some(s) = finite(x.get("out_of_work_since")) {
        parts.push(format!("out of work since {}", date_words(s, w)));
    }
    if on(x, "pay_short") {
        parts.push("pay has come short of what was agreed".to_string());
    }
    match x.s("claim") {
        Some("refused") => parts.push(format!("a claim for support was refused{}", finite(x.get("claim_on")).map_or(String::new(), |c| format!(" on {}", date_words(c, w))))),
        Some("pending") => parts.push("a claim for support has been made and not decided".to_string()),
        _ => {}
    }
    if on(x, "ill") {
        parts.push("illness in the home".to_string());
    }
    if finite(x.get("people")).is_some() {
        let ages = match x.get("ages") {
            Some(Value::Array(a)) if !a.is_empty() => {
                format!(" (aged {})", a.iter().map(|v| if v.is_null() { String::new() } else { js(Some(v)) }).collect::<Vec<_>>().join(", "))
            }
            _ => String::new(),
        };
        parts.push(format!(
            "{} live in the home{}{ages}",
            js(x.get("people")),
            if finite(x.get("children")).is_some_and(|c| c != 0) { format!(", {} of them children", js(x.get("children"))) } else { String::new() }
        ));
    }
    if finite(x.get("lived_days")).is_some() {
        parts.push(format!("has lived there {} days", js(x.get("lived_days"))));
    }
    match x.s("go_to") {
        Some("nowhere") => parts.push("has nowhere else to go".to_string()),
        Some("someone_to_ask") => parts.push("has someone they could ask to take them in".to_string()),
        Some("means_for_another") => parts.push("has the means for another home".to_string()),
        _ => {}
    }
    format!(
        "{against} answered {} ({}){}",
        date_words(a.at, w),
        a.id,
        if parts.is_empty() { ", saying nothing more".to_string() } else { format!(": {}", parts.join("; ")) }
    )
}

/// What the law on possession says of the order, from the law as published (its typed fields), for the head of the
/// member's list of cases to decide: the same words the law itself has. Nothing where no such law is on file.
fn law_of_order(book: &Book) -> String {
    let l = super::openbooks::latest(book.open("law").filter(|r| data_of(r).s("tenancy") == Some("possession")))
        .or_else(|| book.all("procedure").find(|r| data_of(r).s("law") == Some("law-possession") && has(data_of(r), "plan_consider")));
    let Some(l) = l else { return String::new() };
    let x = data_of(l);
    if !has(x, "plan_consider") {
        return String::new();
    }
    // (papers.ts `planLawWords`, as oikos_rules::forms::plan_law_words.)
    let words = oikos_rules::forms::plan_law_words(&oikos_rules::forms::PlanFigures {
        plan_months: nn(x.get("plan_months")).map_or(Some(0), |v| num(Some(v))).unwrap_or(0),
        plan_consider: x.s("plan_consider").map(String::from),
        plan_barred_rent_months: nn(x.get("plan_barred_rent_months")).and_then(|v| num(Some(v))),
        cure_days: nn(x.get("cure_days")).and_then(|v| num(Some(v))),
    });
    format!(". The law on the order (possession order form): {words} An application that does not meet what the law asks is dismissed")
}

// ---------------------------------------------------------------- tribunal.registrar

/// The tribunal's registrar (tribunal.registrar). Reads `enforcement_request`s addressed to it and the order each names
/// (a `tribunal_order` of finding `pay`, with its due date and amount); a request is answered by a `garnishee_order` of
/// ours for that order made after it, or an `enforcement_decline` citing it. The code also drops, without a paper, a
/// request whose unpaid sum is nothing: those are left out here as it leaves them.
fn registrar(book: &Book, me: &str, t: i64, w: &WorldInfo) -> Vec<OpenHeading> {
    let mut garnished: BTreeMap<String, Vec<i64>> = BTreeMap::new();
    for g in book.open("garnishee_order") {
        if is_me(g, me) {
            if let Some(o) = data_of(g).s("order") {
                garnished.entry(o.to_string()).or_default().push(g.at);
            }
        }
    }
    let mut declined: BTreeSet<&str> = BTreeSet::new();
    for dec in book.open("enforcement_decline") {
        if is_me(dec, me) {
            declined.extend(bases_of(dec).iter().map(|x| x.as_str()));
        }
    }
    let mut items = vec![];
    for r in book.open("enforcement_request") {
        let rd = data_of(r);
        let order = js(rd.get("order"));
        if !addressed(r, me) || declined.contains(r.id.as_str()) || garnished.get(&order).is_some_and(|v| v.iter().any(|at| *at >= r.at)) {
            continue;
        }
        let o = book.get(&order).map(|x| &**x);
        let od = o.map_or(&NULL, data_of);
        let pays = o.is_some_and(|o| kind_of(o) == Some("tribunal_order")) && od.s("finding") == Some("pay") && od.s("applicant") == r.speaks_for.as_deref() && on(od, "to");
        if !pays {
            let line = format!(
                "{}: {} asked {} for order {} to be enforced; no order of ours to pay them is on file; not answered",
                r.id,
                super::openbooks::jss(r.speaks_for.as_deref()),
                date_words(r.at, w),
                js_or(rd.get("order"), "(none named)")
            );
            items.push(OpenItem::new(r.id, line).since(r.at));
            continue;
        }
        let o = o.expect("an order");
        let unpaid = money(od.get("amount")).min(money(nn(rd.get("unpaid")).or_else(|| od.get("amount"))));
        if unpaid <= 0 {
            continue;
        }
        let due = num(od.get("due")).unwrap_or(0);
        let line = format!(
            "{}: {} asked {} for order {} to be enforced against {}, {} unpaid; the order falls due {}{}; not answered",
            r.id,
            super::openbooks::jss(r.speaks_for.as_deref()),
            date_words(r.at, w),
            o.id,
            js(od.get("against")),
            usd(unpaid, w),
            date_words(due, w),
            if t >= due { ", and that date has passed" } else { ", and that date has not come" }
        );
        items.push(OpenItem::new(r.id, line).since(r.at).amount(Some(unpaid)));
    }
    // Requests for a warrant of possession (docs/behaviour/justice.md, "Possession"): no warrant of ours on that order
    // since, and not declined.
    let mut warrants = vec![];
    let mut issued: BTreeMap<String, Vec<i64>> = BTreeMap::new();
    for wr in book.open("warrant") {
        if is_me(wr, me) {
            if let Some(o) = data_of(wr).s("order") {
                issued.entry(o.to_string()).or_default().push(wr.at);
            }
        }
    }
    for r in book.open("warrant_request") {
        let rd = data_of(r);
        let order = js(rd.get("order"));
        if !addressed(r, me) || declined.contains(r.id.as_str()) || issued.get(&order).is_some_and(|v| v.iter().any(|at| *at >= r.at)) {
            continue;
        }
        let o = book.get(&order).map(|x| &**x);
        let od = o.map_or(&NULL, data_of);
        let ours = o.is_some_and(|o| kind_of(o) == Some("tribunal_order")) && od.s("finding") == Some("possession") && od.s("applicant") == r.speaks_for.as_deref();
        let line = if ours {
            let o = o.expect("an order");
            let due = num(od.get("due")).unwrap_or(0);
            format!(
                "{}: {} asked {} for a warrant under order {}, for possession of {} from {}; the order's date is {}{}; no warrant issued",
                r.id,
                super::openbooks::jss(r.speaks_for.as_deref()),
                date_words(r.at, w),
                o.id,
                js_or(od.get("space"), "the home"),
                js(od.get("against")),
                date_words(due, w),
                if t >= due { ", which has passed" } else { ", which has not come" }
            )
        } else {
            format!(
                "{}: {} asked {} for a warrant under {}; no order for possession to them is on file; not answered",
                r.id,
                super::openbooks::jss(r.speaks_for.as_deref()),
                date_words(r.at, w),
                js_or(rd.get("order"), "(no order named)")
            )
        };
        warrants.push(OpenItem::new(r.id, line).since(r.at));
    }
    [heading("Requests to enforce an order, not answered", items), heading("Requests for a warrant of possession, not answered", warrants)].concat()
}

// ---------------------------------------------------------------- office.desk (and a union's cases)

/// The headings of a body that hears grievances on the common forms; `for_decision` says whether its staff put cases
/// before an office-holder, `of` what its matters are called.
fn venue_headings(book: &Book, me: &str, t: i64, for_decision: bool, of: &str, w: &WorldInfo) -> Vec<OpenHeading> {
    let filed = Filed::new(book, me, COMMON_FORMS);
    let before: Vec<&R> = if for_decision {
        book.open("case_for_decision").filter(|n| is_me(n, me) && data_of(n).s("application").is_some_and(|a| !filed.decided.contains(a))).collect()
    } else {
        vec![]
    };
    let to_decide: Vec<OpenItem> = before
        .iter()
        .map(|n| {
            let x = data_of(n);
            let claimed = x.get("case").and_then(|c| c.get("data")).and_then(|c| c.get("amount")).map_or(0, |a| money(Some(a)));
            let line = format!(
                "{}: application {} ({}) by {} against {}{}, put before the office-holder {}; not decided",
                n.id,
                js(x.get("application")),
                matter_of(x),
                js(x.get("applicant")),
                js(x.get("against")),
                if claimed != 0 { format!(", seeking {}", usd(claimed, w)) } else { String::new() },
                date_words(n.at, w)
            );
            OpenItem::new(n.id, line).since(n.at).amount((claimed != 0).then_some(claimed))
        })
        .collect();
    let put: BTreeSet<String> = before.iter().filter_map(|n| data_of(n).s("application").map(String::from)).collect();
    let (waiting, ran) = taken_in(book, &filed, t, &put, w);
    let not = untaken(book, &filed, "not yet taken in", w);
    [
        if for_decision { pressing("Cases put before the office-holder for decision, not decided", to_decide) } else { vec![] },
        heading(&format!("{of} taken in, waiting on the other side's answer"), waiting),
        heading(&format!("{of} whose time for the other side to answer has run, not decided"), ran),
        heading(&format!("{of} addressed to us, not yet taken in"), not),
    ]
    .concat()
}

// ---------------------------------------------------------------- union.organiser

/// A union's organiser (union.organiser). Reads: its own `wage_claim`s and the `wage_offer`s addressed to it on them,
/// its `offer_accepted`, its `action_ballot`s (`data.closes`; the members it balloted are the ballot's addressees), the
/// `vote` records on them (the latest of each member, as the module counts them), its `ballot_result`s, its
/// `industrial_action` notices with its `stop_work` and `return_to_work`, the `enterprise_agreement`s addressed to it,
/// employers' public `closure` notices, `membership_application`s addressed to it and the membership agreements it holds,
/// and (where its params say it hears members' matters) the common forms of a venue.
fn union(book: &Book, me: &str, hears: bool, t: i64, w: &WorldInfo) -> Vec<OpenHeading> {
    let mut closed: BTreeSet<String> = BTreeSet::new();
    for c in book.open("closure") {
        let firm = text_of(data_of(c).get("firm"));
        closed.insert(if firm.is_empty() { super::openbooks::jss(c.speaks_for.as_deref()) } else { firm.to_string() });
    }
    let mut agreed_at: BTreeMap<String, i64> = BTreeMap::new(); // employer -> when an enterprise agreement was last sent to us
    for ea in book.open("enterprise_agreement") {
        if let (true, Some(e)) = (addressed(ea, me), data_of(ea).s("employer")) {
            let e = agreed_at.entry(e.to_string()).or_insert(0);
            *e = (*e).max(ea.at);
        }
    }
    let over = |employer: &str, since: i64| closed.contains(employer) || agreed_at.get(employer).copied().unwrap_or(-1) >= since;
    // ---- claims and offers ----
    let mut claims: Vec<(String, &R)> = vec![]; // employer -> our latest claim, in the order the employers were first claimed on
    for c in book.open("wage_claim") {
        if let (true, Some(e)) = (is_me(c, me), data_of(c).s("employer")) {
            match claims.iter().position(|(k, _)| k == e) {
                Some(i) => {
                    if claims[i].1.at <= c.at {
                        claims[i].1 = c;
                    }
                }
                None => {
                    if -1 <= c.at {
                        claims.push((e.to_string(), c));
                    }
                }
            }
        }
    }
    let ballots: Vec<&R> = book.open("action_ballot").filter(|b| is_me(b, me)).collect();
    let mut results: BTreeMap<String, &R> = BTreeMap::new();
    for r in book.open("ballot_result") {
        if is_me(r, me) {
            let mut bs = apps_of(r);
            if let Some(b) = data_of(r).s("ballot") {
                bs.push(b.to_string());
            }
            for b in bs {
                results.insert(b, r);
            }
        }
    }
    let mut failed: BTreeSet<&str> = BTreeSet::new(); // claims whose ballot found no mandate
    for b in &ballots {
        if results.get(b.id.as_str()).is_some_and(|r| data_of(r).get("passed") == Some(&Value::Bool(false))) {
            if let Some(c) = data_of(b).s("claim") {
                failed.insert(c);
            }
        }
    }
    let mut offer_of: BTreeMap<&str, &R> = BTreeMap::new(); // claim -> the latest offer on it
    for o in book.open("wage_offer") {
        if let (true, Some(c)) = (addressed(o, me), data_of(o).s("claim")) {
            if offer_of.get(c).map_or(-1, |x| x.at) <= o.at {
                offer_of.insert(c, o);
            }
        }
    }
    let mut accepted: BTreeSet<&str> = BTreeSet::new();
    for a in book.open("offer_accepted") {
        if is_me(a, me) {
            accepted.extend(bases_of(a).iter().map(|x| x.as_str()));
        }
    }
    let (mut no_offer, mut unanswered) = (vec![], vec![]);
    for (employer, c) in &claims {
        if over(employer, c.at) || failed.contains(c.id.as_str()) {
            continue;
        }
        let rise = pct(data_of(c).get("rise_bps"));
        let Some(o) = offer_of.get(c.id.as_str()) else {
            no_offer.push(
                OpenItem::new(c.id, format!("{}: our claim of {rise}% for everyone at {employer}, made {}, has had no offer from {employer}", c.id, date_words(c.at, w))).since(c.at),
            );
            continue;
        };
        if accepted.contains(o.id.as_str()) || ballots.iter().any(|b| data_of(b).s("claim") == Some(c.id.as_str()) && b.at >= o.at) {
            continue;
        }
        let line = format!(
            "{}: {employer} offered {}% on {} against our claim {} of {rise}%; not accepted and no ballot called",
            o.id,
            pct(data_of(o).get("rise_bps")),
            date_words(o.at, w),
            c.id
        );
        unanswered.push(OpenItem::new(o.id, line).since(o.at));
    }
    // ---- ballots ----
    let live: Vec<&&R> = ballots
        .iter()
        .filter(|b| !results.contains_key(b.id.as_str()) && finite(data_of(b).get("closes")).is_some() && !over(text_of(data_of(b).get("employer")), b.at))
        .collect();
    let mut voters: BTreeMap<&str, BTreeMap<String, &str>> = BTreeMap::new(); // ballot -> member -> latest choice
    if !live.is_empty() {
        let want: BTreeSet<&str> = live.iter().map(|b| b.id.as_str()).collect();
        let mut votes: Vec<(&R, &str, &str)> = book
            .of_type("vote")
            .filter_map(|v| match &v.body {
                RecordBody::Vote { ballot, choice } if want.contains(ballot.as_str()) => Some((v, ballot.as_str(), choice.as_str())),
                _ => None,
            })
            .collect();
        votes.sort_by_key(|(v, _, _)| v.at);
        for (v, ballot, choice) in votes {
            voters.entry(ballot).or_default().insert((v.speaks_for.unwrap_or_else(|| v.author.clone().into())).to_string(), choice);
        }
    }
    let (mut open_ballots, mut undeclared) = (vec![], vec![]);
    for b in live {
        let eligible: BTreeSet<&str> = addressed_to(b).iter().map(|x| x.as_str()).collect();
        let cast: Vec<&str> = voters.get(b.id.as_str()).map(|m| m.iter().filter(|(who, _)| eligible.contains(who.as_str())).map(|(_, c)| *c).collect()).unwrap_or_default();
        let yes = cast.iter().filter(|c| **c == "yes").count();
        let count = format!("{} of {} voted, {yes} yes, {} no", cast.len(), eligible.len(), cast.len() - yes);
        let closes = finite(data_of(b).get("closes")).unwrap_or(0);
        let employer = js(data_of(b).get("employer"));
        if t < closes {
            let line = format!("{}: our ballot of members at {employer} on protected action, called {}, closes {}; {count} on file", b.id, date_words(b.at, w), date_words(closes, w));
            open_ballots.push(OpenItem::new(b.id, line).since(b.at));
        } else {
            let line = format!("{}: our ballot of members at {employer} closed {}; {count} on file; no result declared", b.id, date_words(closes, w));
            undeclared.push(OpenItem::new(b.id, line).since(closes));
        }
    }
    // ---- action ----
    let stopped = |employer: &str, since: i64| book.open("stop_work").any(|s| is_me(s, me) && data_of(s).s("employer") == Some(employer) && s.at >= since);
    let returned = |employer: &str, since: i64| book.open("return_to_work").any(|s| is_me(s, me) && data_of(s).s("employer") == Some(employer) && s.at >= since);
    let (mut not_begun, mut not_ended) = (vec![], vec![]);
    for n in book.open("industrial_action") {
        let x = data_of(n);
        let (from, until, employer) = (finite(x.get("from")), finite(x.get("until")), text_of(x.get("employer")));
        let (Some(from), Some(until)) = (from, until) else { continue };
        if !is_me(n, me) || over(employer, n.at) || returned(employer, n.at) {
            continue;
        }
        let span = format!("{employer}, from {} until {}", date_words(from, w), date_words(until, w));
        if t < from && !stopped(employer, n.at) {
            not_begun.push(OpenItem::new(n.id, format!("{}: notice of action at {span}, given {}; not yet begun", n.id, date_words(n.at, w))).since(n.at));
        } else {
            not_ended.push(OpenItem::new(n.id, format!("{}: action at {span}, begun and not yet ended", n.id)).since(from));
        }
    }
    // ---- joining ----
    let (mut in_force, mut offered_on): (BTreeSet<&str>, BTreeSet<&str>) = (BTreeSet::new(), BTreeSet::new());
    for a in book.of_type("agreement") {
        let Some(terms) = terms_of(a) else { continue };
        if terms.template.as_deref() != Some("membership") || terms.parties.first().map(String::as_str) != Some(me) {
            continue;
        }
        offered_on.extend(bases_of(a).iter().map(|x| x.as_str()));
        if book.in_force(&a.id) {
            if let Some(p) = terms.parties.get(1) {
                in_force.insert(p.as_str());
            }
        }
    }
    let joining: Vec<OpenItem> = book
        .open("membership_application")
        .filter(|a| addressed(a, me) && !offered_on.contains(a.id.as_str()) && !in_force.contains(super::openbooks::jss(a.speaks_for.as_deref()).as_str()))
        .map(|a| {
            let line = format!(
                "{}: {} asked {} to join{}; no membership offered",
                a.id,
                super::openbooks::jss(a.speaks_for.as_deref()),
                date_words(a.at, w),
                data_of(a).s("employer").map_or(String::new(), |e| format!(", working at {e}"))
            );
            OpenItem::new(a.id, line).since(a.at)
        })
        .collect();
    [
        heading("Wage claims of ours with no offer from the employer", no_offer),
        heading("Offers on our claims, not answered", unanswered),
        heading("Ballots of ours open", open_ballots),
        heading("Ballots of ours closed, no result declared", undeclared),
        heading("Action notified, not yet begun", not_begun),
        heading("Action begun, not yet ended", not_ended),
        heading("Applications to join, no membership offered", joining),
        if hears { venue_headings(book, me, t, false, "Members' matters", w) } else { vec![] },
    ]
    .concat()
}

// ---------------------------------------------------------------- bank.lending

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Loan {
    id: String,
    borrower: String,
    account: String,
    principal: i64,
    payment: i64,
    months: i64,
    /// The loan's first payment named by its agreement (seconds after it began), if any.
    first_due: Option<i64>,
    /// When repayments began to count: the payout, or the first look at a loan already in force.
    start: Option<i64>,
    repaid: i64,
    paid_off: bool,
}

/// What the lender's office keeps in its head, as the code does: the loans it follows (in the order it came to know
/// them), the loans started on each borrower's account, where its own account is, whether it has first looked, and when
/// each agreement was signed (every signature, as `Book.signedTimes`).
#[derive(Debug, Default, Serialize, Deserialize)]
struct Lend {
    loans: Vec<Loan>,
    by_account: BTreeMap<String, Vec<String>>,
    own: Option<String>,
    adopted: bool,
    signed: BTreeMap<String, Vec<i64>>,
}

/// When a loan began: signed by the last party, else when the agreement was filed.
fn begins(book: &Book, id: &str) -> i64 {
    book.signed_at(id).or_else(|| book.get(id).map(|r| r.at)).unwrap_or(0)
}

/// `Number.isSafeInteger(x) && x > 0`.
fn safe_positive(v: Option<&Value>) -> Option<i64> {
    let n = match v? {
        Value::Number(n) => n.as_i64().or_else(|| n.as_f64().filter(|f| f.fract() == 0.0 && f.abs() <= 9_007_199_254_740_991.0).map(|f| f as i64))?,
        _ => return None,
    };
    (n > 0).then_some(n)
}

impl Lend {
    fn loan(&self, id: &str) -> Option<usize> {
        self.loans.iter().position(|l| l.id == id)
    }
    fn start_it(&mut self, i: usize, at: i64) {
        self.loans[i].start = Some(at);
        let (account, id) = (self.loans[i].account.clone(), self.loans[i].id.clone());
        self.by_account.entry(account).or_default().push(id);
    }
    fn counted_from(&self, book: &Book, i: usize) -> i64 {
        let l = &self.loans[i];
        if l.first_due.is_some() {
            begins(book, &l.id)
        } else {
            l.start.unwrap_or(0)
        }
    }

    fn absorb(&mut self, me: &str, book: &Book, pic: &Picture, fresh: &[R]) {
        if self.own.is_none() {
            self.own = own_account(pic).map(|a| a.account);
        }
        for r in fresh {
            if let RecordBody::Signature { agreement, .. } = &r.body {
                self.signed.entry(agreement.to_string()).or_default().push(r.at);
            }
            let Some(terms) = terms_of(r) else { continue };
            if terms.template.as_deref() != Some("loan") || terms.parties.first().map(String::as_str) != Some(me) || self.loan(&r.id).is_some() {
                continue;
            }
            let Some(who) = terms.parties.get(1) else { continue };
            let money_of = |p: &str| terms.commitments.iter().find(|c| c.who == p).and_then(|c| c.does.get("outcome")).and_then(|o| o.get("money")).filter(|m| !m.is_null());
            let Some(repay) = money_of(who) else { continue };
            let Some(account) = repay.get("from").filter(|f| crate::common::truthy(f)).and_then(Value::as_str) else { continue };
            let lent = money_of(me).filter(|m| crate::common::truthy(m));
            let payment = money(repay.get("amount"));
            let months = ((2 * terms.term.unwrap_or(0) + MONTH).div_euclid(2 * MONTH)).max(1);
            self.loans.push(Loan {
                id: r.id.to_string(),
                borrower: who.clone(),
                account: account.to_string(),
                principal: lent.map_or(payment * months, |m| money(m.get("amount"))),
                payment,
                months,
                first_due: safe_positive(terms.attrs.as_ref().and_then(|a| a.get("first_due"))),
                start: None,
                repaid: 0,
                paid_off: false,
            });
        }
        // (A loan in force when the office first looked is followed from then.)
        if !self.adopted {
            self.adopted = true;
            for i in 0..self.loans.len() {
                if book.in_force(&self.loans[i].id) {
                    self.start_it(i, pic.t);
                }
            }
        }
        for tx in pic.transactions() {
            let Some(own) = self.own.clone() else { break };
            let settles = tx.settles.as_deref().filter(|s| !s.is_empty());
            if tx.from == own && settles.is_some() {
                if let Some(i) = settles.and_then(|s| self.loan(s)) {
                    if self.loans[i].start.is_none() {
                        self.start_it(i, tx.t); // (the principal paid out)
                    }
                }
                continue;
            }
            if tx.to != own {
                continue;
            }
            if let Some(i) = settles.and_then(|s| self.loan(s)) {
                let l = &mut self.loans[i];
                l.paid_off = true;
                l.repaid = l.payment * l.months;
                continue;
            }
            let mut x = crate::common::cents(tx.amount);
            let mut ids: Vec<usize> = self.by_account.get(tx.from.as_str()).map(|v| v.iter().filter_map(|id| self.loan(id)).collect()).unwrap_or_default();
            ids.sort_by_key(|i| self.loans[*i].start.unwrap_or(0));
            for i in ids {
                if tx.t < self.counted_from(book, i) {
                    continue;
                }
                let l = &mut self.loans[i];
                let part = x.min((l.payment * l.months - l.repaid).max(0));
                l.repaid += part;
                x -= part;
                if x <= 0 {
                    break;
                }
            }
        }
    }

    /// Repayments missed before the year began, as the bank's statement of the loan account on file says.
    fn missed_of(&self, book: &Book, me: &str, l: &Loan) -> i64 {
        let x = super::openbooks::latest(book.open("loan_statement").filter(|r| is_me(r, me) && data_of(r).s("loan") == Some(l.id.as_str()) && on(data_of(r), "brought_forward")));
        x.map_or(0, |x| num(data_of(x).get("payments")).filter(|n| *n != 0).unwrap_or(0).max(0))
    }
    fn first_due_at(&self, book: &Book, me: &str, l: &Loan) -> Option<i64> {
        let start = l.start?;
        Some(l.first_due.map_or(start + MONTH, |f| begins(book, &l.id) + f) - self.missed_of(book, me, l) * MONTH)
    }

    fn open(&self, book: &Book, me: &str, t: i64, w: &WorldInfo) -> Vec<OpenHeading> {
        // ---- applications ----
        let mut decided: BTreeSet<String> = BTreeSet::new();
        for dec in book.open("loan_decision") {
            if is_me(dec, me) {
                decided.extend(apps_of(dec));
            }
        }
        let applications: Vec<OpenItem> = book
            .open("loan_application")
            .filter(|a| addressed(a, me) && !decided.contains(a.id.as_str()))
            .map(|a| {
                let x = data_of(a);
                let amount = num(x.get("amount")).unwrap_or(0);
                let months = num(x.get("months")).filter(|n| *n != 0).unwrap_or(12).max(1);
                let line = format!(
                    "{}: {} applied {} for {} over {months} months{}; not decided",
                    a.id,
                    super::openbooks::jss(a.speaks_for.as_deref()),
                    date_words(a.at, w),
                    usd(amount, w),
                    if on(x, "purpose") { format!(", for {}", js(x.get("purpose"))) } else { String::new() }
                );
                OpenItem::new(a.id, line).since(a.at).amount(Some(amount))
            })
            .collect();
        // ---- loans signed and not paid out ----
        let mut unpaid = vec![];
        for l in &self.loans {
            if l.start.is_some() || l.paid_off || !book.signed_by(&l.id, &l.borrower) {
                continue;
            }
            let at = self.signed.get(&l.id).and_then(|v| v.iter().max().copied()).unwrap_or_else(|| begins(book, &l.id));
            let line = format!(
                "{}: {} has signed the loan of {} ({} a month for {} months), signed {}; the principal has not been paid out",
                l.id,
                l.borrower,
                usd(l.principal, w),
                usd(l.payment, w),
                l.months,
                date_words(at, w)
            );
            unpaid.push(OpenItem::new(l.id.clone(), line).since(at).amount(Some(l.principal)));
        }
        // ---- loans behind ----
        let mut letters: BTreeMap<String, bool> = BTreeMap::new(); // loan -> a default notice (else only a letter of arrears)
        for k in ["loan_arrears", "loan_default"] {
            for r in book.open(k) {
                let named = text_of(data_of(r).get("loan"));
                let loan = if named.is_empty() { bases_of(r).first().map(|x| x.to_string()).unwrap_or_default() } else { named.to_string() };
                if is_me(r, me) && !loan.is_empty() && letters.get(&loan) != Some(&true) {
                    letters.insert(loan, k == "loan_default");
                }
            }
        }
        let mut behind = vec![];
        for l in &self.loans {
            let Some(first) = self.first_due_at(book, me, l) else { continue };
            if l.paid_off || l.payment <= 0 {
                continue;
            }
            let due_count = if t < first { 0 } else { l.months.min((t - first).div_euclid(MONTH) + 1) };
            let owing = due_count * l.payment - l.repaid;
            if owing <= 0 {
                continue;
            }
            let since = first + l.repaid.div_euclid(l.payment) * MONTH; // (the earliest payment not covered)
            if t - since < 7 * DAY {
                continue;
            }
            let line = format!(
                "{}: {} is {} behind on the loan ({} a month, {} months), since {}; {}",
                l.id,
                l.borrower,
                usd(owing, w),
                usd(l.payment, w),
                l.months,
                date_words(since, w),
                match letters.get(&l.id) {
                    Some(true) => "a default notice is on file",
                    Some(false) => "a letter of arrears is on file",
                    None => "no letter of arrears or default notice is on file",
                }
            );
            behind.push(OpenItem::new(l.id.clone(), line).since(since).amount(Some(owing)));
        }
        // ---- payout figures asked for ----
        let mut answered: BTreeSet<&str> = BTreeSet::new();
        for r in book.open("loan_payout") {
            if is_me(r, me) {
                answered.extend(bases_of(r).iter().map(|x| x.as_str()));
            }
        }
        let payouts: Vec<OpenItem> = book
            .open("loan_payout_request")
            .filter(|r| {
                addressed(r, me)
                    && !answered.contains(r.id.as_str())
                    && self.loan(&js(data_of(r).get("loan"))).is_some_and(|i| Some(self.loans[i].borrower.as_str()) == r.speaks_for.as_deref())
            })
            .map(|r| {
                let line = format!(
                    "{}: {} asked {} what it takes to pay off loan {}; not answered",
                    r.id,
                    super::openbooks::jss(r.speaks_for.as_deref()),
                    date_words(r.at, w),
                    js(data_of(r).get("loan"))
                );
                OpenItem::new(r.id, line).since(r.at)
            })
            .collect();
        [
            heading("Loan applications, not decided", applications),
            heading("Loans signed by the borrower, the principal not paid out", unpaid),
            heading("Loans behind", behind),
            heading("Payout figures asked for, not given", payouts),
        ]
        .concat()
    }
}

// ---------------------------------------------------------------- the readers

#[derive(PartialEq, Eq)]
enum Which {
    Member,
    Registrar,
    Desk,
    Union { hears: bool },
    Lending,
}

struct Reader {
    me: String,
    which: Which,
    book: Book,
    lend: Lend,
}

/// The reader of the books of the offices that hear and decide, a union's organiser and a lender's office, if `of` is
/// one of them.
pub fn reader(of: &str, me: &str, _office: &str, params: &serde_json::Map<String, Value>) -> Option<Box<dyn OfficeBooks>> {
    let which = match of {
        "tribunal.member" => Which::Member,
        "tribunal.registrar" => Which::Registrar,
        "office.desk" => Which::Desk,
        "union.organiser" => Which::Union { hears: params.get("hears").and_then(Value::as_array).is_some_and(|a| !a.is_empty()) },
        "bank.lending" => Which::Lending,
        _ => return None,
    };
    Some(Box::new(Reader { me: me.to_string(), which, book: Book::new(), lend: Lend::default() }))
}

impl OfficeBooks for Reader {
    fn absorb(&mut self, pic: &Picture) {
        let fresh = self.book.absorb(pic);
        if self.which == Which::Lending {
            self.lend.absorb(&self.me, &self.book, pic, &fresh);
        }
    }
    fn open(&self, t: i64, w: &WorldInfo) -> Vec<OpenHeading> {
        let (b, me) = (&self.book, self.me.as_str());
        match &self.which {
            Which::Member => member(b, me, t, w),
            Which::Registrar => registrar(b, me, t, w),
            Which::Desk => venue_headings(b, me, t, true, "Applications", w),
            Which::Union { hears } => union(b, me, *hears, t, w),
            Which::Lending => self.lend.open(b, me, t, w),
        }
    }
    fn save(&self) -> Result<Value, String> {
        Ok(json!({ "book": self.book.save(), "lending": serde_json::to_value(&self.lend).map_err(|e| e.to_string())? }))
    }
    fn restore(&mut self, saved: &Value) -> Result<(), String> {
        if saved.is_null() {
            return Ok(());
        }
        self.book = Book::restore(saved.get("book").cloned().unwrap_or(Value::Null))?;
        if let Some(l) = saved.get("lending").filter(|l| !l.is_null()) {
            self.lend = serde_json::from_value(l.clone()).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use oikos_sight::{AccountItem, ParticipantStatus, Seen, Transaction};
    use std::sync::Arc;

    // The books of the venues and the lender (participants/test/openbooks-venues.test.ts): what stands open at the
    // tribunal's member and registrar, a complaints desk, a union's organiser and a bank's lending office, read from papers
    // on hand-built pictures. For each: the state stands open and its item appears (id, since, amount); settled, it is
    // gone; and nothing changed, its line is the same on the next day.

    fn mk(of: &str, me: &str, params: Value) -> Box<dyn OfficeBooks> {
        reader(of, me, "office", params.as_object().unwrap_or(&serde_json::Map::new())).expect("a reader")
    }
    fn obs(t: i64, entity: &str, records: Vec<Value>, bank: Option<(Vec<AccountItem>, Vec<Transaction>)>) -> Picture {
        let mut channels = BTreeMap::new();
        let records: Vec<Arc<Record>> = records.into_iter().map(|v| Arc::new(serde_json::from_value(v).expect("a record"))).collect();
        channels.insert("mine".into(), Seen::Records { records, search: false });
        if let Some((accounts, transactions)) = bank {
            channels.insert("bank".into(), Seen::Accounts { accounts: Arc::new(accounts), transactions });
        }
        Picture {
            participant: format!("{entity}-system").into(),
            t,
            status: ParticipantStatus::Active,
            entity: entity.into(),
            as_position: None,
            body: None,
            positions: vec![],
            outcomes: vec![],
            inbox: vec![],
            channels,
            asking: vec![],
            readings: BTreeMap::new(),
            woke_for: "cadence".into(),
            since: 0,
        }
    }
    /// Merge `extra`'s keys into `base`; a null removes the key (an undefined field).
    fn merge(base: Value, extra: Value) -> Value {
        let mut m = base.as_object().cloned().unwrap_or_default();
        for (k, v) in extra.as_object().cloned().unwrap_or_default() {
            if v.is_null() {
                m.remove(&k);
            } else {
                m.insert(k, v);
            }
        }
        Value::Object(m)
    }
    fn st(id: &str, at: i64, kind: &str, speaks_for: &str, x: Value) -> Value {
        merge(json!({ "id": id, "at": at, "author": format!("{speaks_for}-x"), "record": "statement", "speaks_for": speaks_for, "visible_to": "public", "kind": kind, "text": id }), x)
    }
    fn heading_of<'a>(h: &'a [OpenHeading], what: &str) -> Option<&'a OpenHeading> {
        h.iter().find(|x| x.what == what)
    }
    fn lines_of(h: &[OpenHeading]) -> String {
        serde_json::to_string(&h.iter().map(|x| (&x.what, x.items.iter().map(|i| (&i.id, &i.line)).collect::<Vec<_>>())).collect::<Vec<_>>()).unwrap()
    }
    fn open(b: &dyn OfficeBooks, t: i64) -> Vec<OpenHeading> {
        b.open(t, &WorldInfo::default())
    }
    /// The same lines on the next day when nothing has changed.
    fn same(b: &dyn OfficeBooks, t: i64) {
        assert_eq!(lines_of(&open(b, t + DAY)), lines_of(&open(b, t)));
    }
    fn is(i: &OpenItem, id: &str, since: Option<i64>, amount: Option<i64>) {
        assert_eq!((i.id.as_str(), i.since, i.amount), (id, since, amount), "{}", i.line);
    }
    fn whats(h: &[OpenHeading]) -> Vec<&str> {
        h.iter().map(|x| x.what.as_str()).collect()
    }

    // ------------------------------------------------------------ tribunal.member

    fn application(id: &str, at: i64, data: Value) -> Value {
        st(id, at, "tribunal_application", "ann", json!({ "addressed_to": ["tribunal"], "data": merge(json!({ "kind": "debt", "against": "bob" }), data) }))
    }
    fn hearing_notice(id: &str, at: i64, app: &str, data: Value) -> Value {
        st(
            id,
            at,
            "hearing_notice",
            "tribunal",
            json!({ "addressed_to": ["ann", "bob"], "basis": app, "data": merge(json!({ "application": app, "kind": "debt", "applicant": "ann", "against": "bob" }), data) }),
        )
    }

    #[test]
    fn the_tribunal_an_application_not_yet_listed_then_listed_and_waiting_then_its_day_come_then_ordered() {
        let mut b = mk("tribunal.member", "tribunal", json!({}));
        let (t0, day) = (100 * DAY, 100 * DAY + 21 * DAY);
        b.absorb(&obs(t0, "tribunal", vec![application("rec.1", t0 - DAY, json!({}))], None));
        let h = open(&*b, t0);
        let first = heading_of(&h, "Applications to the tribunal, not yet listed for a hearing").unwrap();
        assert_eq!(first.items.len(), 1);
        is(&first.items[0], "rec.1", Some(t0 - DAY), None);
        same(&*b, t0);
        // Listed: out of the first heading, in the waiting one, with its day.
        b.absorb(&obs(t0 + DAY, "tribunal", vec![hearing_notice("rec.2", t0 + DAY, "rec.1", json!({ "hearing_at": day }))], None));
        let h = open(&*b, t0 + DAY);
        assert!(heading_of(&h, "Applications to the tribunal, not yet listed for a hearing").is_none());
        let w = &heading_of(&h, "Cases listed, waiting for their day").unwrap().items[0];
        is(w, "rec.2", Some(t0 + DAY), None);
        assert!(w.line.contains("bob has not answered"), "{}", w.line);
        same(&*b, t0 + 2 * DAY);
        // The day comes: no order yet, and the other side has answered.
        b.absorb(&obs(day, "tribunal", vec![st("rec.3", day - DAY, "tribunal_response", "bob", json!({ "basis": "rec.1", "addressed_to": ["tribunal"], "data": { "application": "rec.1" } }))], None));
        let h = open(&*b, day);
        let due = heading_of(&h, "Cases listed whose hearing day has come, with no order made").unwrap();
        is(&due.items[0], "rec.2", Some(day), None);
        assert!(due.items[0].line.contains("bob has answered"), "{}", due.items[0].line);
        same(&*b, day);
        // Ordered: gone.
        b.absorb(&obs(day + DAY, "tribunal", vec![st("rec.4", day, "tribunal_order", "tribunal", json!({ "basis": "rec.1", "data": { "application": "rec.1", "finding": "pay" } }))], None));
        assert!(open(&*b, day + DAY).is_empty());
    }

    #[test]
    fn the_tribunals_lists_an_application_taken_in_waits_on_the_other_side_then_its_time_runs_out_undecided_then_it_is_decided() {
        let mut b = mk("tribunal.member", "tribunal", json!({ "hears": [{ "about": "wage_theft" }] }));
        let (t0, by) = (50 * DAY, 50 * DAY + 21 * DAY);
        b.absorb(&obs(
            t0,
            "tribunal",
            vec![
                application("rec.1", t0, json!({ "kind": null, "matter": "wage_theft", "amount": 25_000 })),
                hearing_notice("rec.2", t0, "rec.1", json!({ "matter": "wage_theft", "kind": "wage_theft", "answer_by": by, "hearing_at": by, "amount": 25_000 })),
            ],
            None,
        ));
        let h = open(&*b, t0);
        let waiting = heading_of(&h, "Cases listed, waiting for their day").unwrap();
        is(&waiting.items[0], "rec.2", Some(t0), Some(25_000));
        assert!(waiting.items[0].line.contains("until year 1, day 72"), "{}", waiting.items[0].line);
        same(&*b, t0 + DAY);
        let h = open(&*b, by + DAY);
        let ran = heading_of(&h, "Applications on the tribunal's lists whose time to answer has run, not decided").unwrap();
        is(&ran.items[0], "rec.2", Some(by), Some(25_000));
        same(&*b, by + DAY);
        b.absorb(&obs(by + 2 * DAY, "tribunal", vec![st("rec.3", by + 2 * DAY, "tribunal_order", "tribunal", json!({ "basis": "rec.1", "data": { "application": "rec.1", "finding": "dismissed" } }))], None));
        assert!(open(&*b, by + 2 * DAY).is_empty());
    }

    // ------------------------------------------------------------ tribunal.registrar

    #[test]
    fn the_registrar_a_request_to_enforce_an_order_stands_until_a_garnishee_order_or_a_refusal_answers_it() {
        let mut b = mk("tribunal.registrar", "registry", json!({}));
        let (t0, due) = (200 * DAY, 210 * DAY);
        let order = st("ord.1", t0 - 20 * DAY, "tribunal_order", "tribunal", json!({ "data": { "finding": "pay", "applicant": "ann", "against": "bob", "to": "acc-ann", "amount": 10_000, "due": due } }));
        let req = st("rec.1", t0, "enforcement_request", "ann", json!({ "addressed_to": ["registry"], "data": { "order": "ord.1", "unpaid": 6_000 } }));
        b.absorb(&obs(t0, "registry", vec![order.clone(), req.clone()], None));
        let h = open(&*b, t0);
        let it = &heading_of(&h, "Requests to enforce an order, not answered").unwrap().items[0];
        is(it, "rec.1", Some(t0), Some(6_000));
        assert!(it.line.contains("that date has not come"), "{}", it.line);
        same(&*b, t0);
        let h = open(&*b, due + DAY);
        let it = &heading_of(&h, "Requests to enforce an order, not answered").unwrap().items[0];
        assert!(it.line.contains("that date has passed"), "{}", it.line);
        b.absorb(&obs(due + DAY, "registry", vec![st("rec.2", due + DAY, "garnishee_order", "registry", json!({ "basis": "ord.1", "data": { "order": "ord.1", "amount": 6_000 } }))], None));
        assert!(open(&*b, due + DAY).is_empty());
        // A refusal also answers.
        let mut c = mk("tribunal.registrar", "registry", json!({}));
        c.absorb(&obs(t0, "registry", vec![order, req], None));
        assert_eq!(open(&*c, t0).len(), 1);
        c.absorb(&obs(t0 + DAY, "registry", vec![st("rec.3", t0 + DAY, "enforcement_decline", "registry", json!({ "basis": "rec.1" }))], None));
        assert!(open(&*c, t0 + DAY).is_empty());
    }

    // ------------------------------------------------------------ office.desk

    fn apply(id: &str, at: i64, data: Value) -> Value {
        st(id, at, "application", "ann", json!({ "addressed_to": ["desk"], "data": merge(json!({ "matter": "rates_error", "against": "council" }), data) }))
    }
    fn notice(id: &str, at: i64, app: &str, by: i64) -> Value {
        st(
            id,
            at,
            "complaint_notice",
            "desk",
            json!({ "addressed_to": ["ann", "council"], "basis": app, "data": { "application": app, "matter": "rates_error", "applicant": "ann", "against": "council", "answer_by": by, "hearing_at": by } }),
        )
    }

    #[test]
    fn the_desk_untaken_then_taken_in_and_waiting_then_time_run_then_decided() {
        let mut b = mk("office.desk", "desk", json!({}));
        let (t0, by) = (80 * DAY, 80 * DAY + 14 * DAY);
        b.absorb(&obs(t0, "desk", vec![apply("rec.1", t0, json!({ "amount": 9_000 }))], None));
        let h = open(&*b, t0);
        is(&heading_of(&h, "Applications addressed to us, not yet taken in").unwrap().items[0], "rec.1", Some(t0), Some(9_000));
        same(&*b, t0);
        b.absorb(&obs(t0 + DAY, "desk", vec![notice("rec.2", t0 + DAY, "rec.1", by)], None));
        let h = open(&*b, t0 + DAY);
        assert!(heading_of(&h, "Applications addressed to us, not yet taken in").is_none());
        is(&heading_of(&h, "Applications taken in, waiting on the other side's answer").unwrap().items[0], "rec.2", Some(t0 + DAY), None);
        same(&*b, t0 + 2 * DAY);
        let h = open(&*b, by + DAY);
        is(&heading_of(&h, "Applications whose time for the other side to answer has run, not decided").unwrap().items[0], "rec.2", Some(by), None);
        same(&*b, by + DAY);
        b.absorb(&obs(by + DAY, "desk", vec![st("rec.3", by + DAY, "venue_decision", "desk", json!({ "basis": "rec.1", "data": { "application": "rec.1", "finding": "dismissed" } }))], None));
        assert!(open(&*b, by + DAY).is_empty());
    }

    #[test]
    fn the_desk_a_case_put_before_the_office_holder_stands_until_the_office_holder_decides_it() {
        let mut b = mk("office.desk", "desk", json!({}));
        let t0 = 90 * DAY;
        let note = st(
            "rec.5",
            t0,
            "case_for_decision",
            "desk",
            json!({ "visible_to": ["desk"], "basis": "rec.1", "data": { "application": "rec.1", "matter": "rates_error", "applicant": "ann", "against": "council", "case": { "data": { "amount": 7_000 } } } }),
        );
        b.absorb(&obs(t0, "desk", vec![apply("rec.1", t0 - 20 * DAY, json!({})), notice("rec.2", t0 - 19 * DAY, "rec.1", t0 - 5 * DAY), note], None));
        let h = open(&*b, t0);
        is(&heading_of(&h, "Cases put before the office-holder for decision, not decided").unwrap().items[0], "rec.5", Some(t0), Some(7_000));
        // (It is not also counted as a case whose time has run.)
        assert!(heading_of(&h, "Applications whose time for the other side to answer has run, not decided").is_none());
        same(&*b, t0);
        b.absorb(&obs(t0 + DAY, "desk", vec![st("rec.6", t0 + DAY, "venue_decision", "desk", json!({ "basis": "rec.1", "data": { "application": "rec.1", "finding": "pay" } }))], None));
        assert!(open(&*b, t0 + DAY).is_empty());
    }

    // ------------------------------------------------------------ union.organiser

    #[test]
    fn the_union_a_claim_with_no_offer_then_an_offer_unanswered_then_accepted() {
        let mut b = mk("union.organiser", "union", json!({}));
        let t0 = 120 * DAY;
        b.absorb(&obs(t0, "union", vec![st("rec.1", t0, "wage_claim", "union", json!({ "addressed_to": ["firm"], "data": { "employer": "firm", "rise_bps": 450, "members": 8 } }))], None));
        let h = open(&*b, t0);
        let it = &heading_of(&h, "Wage claims of ours with no offer from the employer").unwrap().items[0];
        is(it, "rec.1", Some(t0), None);
        assert!(it.line.contains("our claim of 4.5% for everyone at firm"), "{}", it.line);
        same(&*b, t0);
        b.absorb(&obs(t0 + 5 * DAY, "union", vec![st("rec.2", t0 + 5 * DAY, "wage_offer", "firm", json!({ "addressed_to": ["union"], "data": { "employer": "firm", "claim": "rec.1", "rise_bps": 200 } }))], None));
        let h = open(&*b, t0 + 5 * DAY);
        assert!(heading_of(&h, "Wage claims of ours with no offer from the employer").is_none());
        let it = &heading_of(&h, "Offers on our claims, not answered").unwrap().items[0];
        is(it, "rec.2", Some(t0 + 5 * DAY), None);
        assert!(it.line.contains("firm offered 2% on"), "{}", it.line);
        same(&*b, t0 + 6 * DAY);
        b.absorb(&obs(t0 + 6 * DAY, "union", vec![st("rec.3", t0 + 6 * DAY, "offer_accepted", "union", json!({ "basis": "rec.2", "data": { "claim": "rec.1" } }))], None));
        assert!(open(&*b, t0 + 6 * DAY).is_empty());
    }

    #[test]
    fn the_union_a_ballot_open_with_the_votes_on_file_closed_with_no_result_then_declared_action_notified_and_begun() {
        let mut b = mk("union.organiser", "union", json!({}));
        let (t0, closes) = (130 * DAY, 140 * DAY);
        let ballot = st("rec.1", t0, "action_ballot", "union", json!({ "addressed_to": ["m1", "m2", "m3"], "data": { "employer": "firm", "claim": "rec.0", "closes": closes } }));
        let vote = |id: &str, who: &str, at: i64, choice: &str| json!({ "id": id, "at": at, "author": who, "record": "vote", "ballot": "rec.1", "choice": choice, "visible_to": ["union"] });
        b.absorb(&obs(
            t0,
            "union",
            vec![ballot, vote("v1", "m1", t0 + DAY, "yes"), vote("v2", "m2", t0 + DAY, "no"), vote("v3", "m2", t0 + 2 * DAY, "yes"), vote("v4", "stranger", t0 + DAY, "yes")],
            None,
        ));
        let h = open(&*b, t0 + 3 * DAY);
        let it = &heading_of(&h, "Ballots of ours open").unwrap().items[0];
        is(it, "rec.1", Some(t0), None);
        assert!(it.line.contains("2 of 3 voted, 2 yes, 0 no"), "{}", it.line); // (m2's latest vote counts; a stranger's does not)
        same(&*b, t0 + 3 * DAY);
        let h = open(&*b, closes + DAY);
        is(&heading_of(&h, "Ballots of ours closed, no result declared").unwrap().items[0], "rec.1", Some(closes), None);
        same(&*b, closes + DAY);
        // Action notified.
        let (from, until) = (closes + 5 * DAY, closes + 7 * DAY);
        b.absorb(&obs(
            closes + 2 * DAY,
            "union",
            vec![
                st("rec.2", closes + 2 * DAY, "ballot_result", "union", json!({ "basis": "rec.1", "data": { "ballot": "rec.1", "passed": true } })),
                st("rec.3", closes + 2 * DAY, "industrial_action", "union", json!({ "data": { "employer": "firm", "from": from, "until": until } })),
            ],
            None,
        ));
        let h = open(&*b, closes + 3 * DAY);
        assert!(heading_of(&h, "Ballots of ours closed, no result declared").is_none());
        is(&heading_of(&h, "Action notified, not yet begun").unwrap().items[0], "rec.3", Some(closes + 2 * DAY), None);
        same(&*b, closes + 3 * DAY);
        let h = open(&*b, from + DAY);
        is(&heading_of(&h, "Action begun, not yet ended").unwrap().items[0], "rec.3", Some(from), None);
        b.absorb(&obs(until, "union", vec![st("rec.4", until, "return_to_work", "union", json!({ "data": { "employer": "firm" } }))], None));
        assert!(open(&*b, until).is_empty());
    }

    #[test]
    fn the_union_an_application_to_join_stands_until_a_membership_is_offered_members_matters_only_where_it_hears_them() {
        let apps = vec![
            st("rec.1", 10 * DAY, "membership_application", "ann", json!({ "addressed_to": ["union"], "data": { "employer": "firm" } })),
            merge(apply("rec.2", 11 * DAY, json!({})), json!({ "addressed_to": ["union"] })),
        ];
        let mut b = mk("union.organiser", "union", json!({}));
        b.absorb(&obs(12 * DAY, "union", apps.clone(), None));
        let h = open(&*b, 12 * DAY);
        is(&heading_of(&h, "Applications to join, no membership offered").unwrap().items[0], "rec.1", Some(10 * DAY), None);
        assert!(heading_of(&h, "Members' matters addressed to us, not yet taken in").is_none()); // (no list of matters it hears)
        same(&*b, 12 * DAY);
        let mut c = mk("union.organiser", "union", json!({ "hears": [{ "about": "rates_error" }] }));
        c.absorb(&obs(12 * DAY, "union", apps, None));
        let h = open(&*c, 12 * DAY);
        is(&heading_of(&h, "Members' matters addressed to us, not yet taken in").unwrap().items[0], "rec.2", Some(11 * DAY), None);
        // A membership offered on it (an agreement citing the application) answers it.
        let membership = json!({ "id": "agr.1", "at": 13 * DAY, "author": "union-x", "record": "agreement", "visible_to": ["union", "ann"], "basis": "rec.1",
            "terms": { "template": "membership", "parties": ["union", "ann"], "commitments": [] } });
        b.absorb(&obs(13 * DAY, "union", vec![membership], None));
        assert!(heading_of(&open(&*b, 13 * DAY), "Applications to join, no membership offered").is_none());
    }

    // ------------------------------------------------------------ bank.lending

    fn accounts() -> Vec<AccountItem> {
        vec![AccountItem { account: "acc-bank".into(), holder: "bank".into(), custodian: "bank".into(), currency: "XTS".into(), balance: 100_000_000, closed: None }]
    }
    fn loan_agreement(id: &str, at: i64, attrs: Option<Value>) -> Value {
        let mut terms = json!({ "template": "loan", "parties": ["bank", "ann"], "term": 12 * MONTH,
            "commitments": [
                { "who": "bank", "does": { "outcome": { "money": { "from": "acc-bank", "to": "acc-ann", "amount": "120000", "for": "principal" } } } },
                { "who": "ann", "does": { "outcome": { "money": { "from": "acc-ann", "to": "acc-bank", "amount": "10000", "for": "repayment" } } }, "every": MONTH } ] });
        if let Some(a) = attrs {
            terms["attrs"] = a;
        }
        json!({ "id": id, "at": at, "author": "bank-x", "record": "agreement", "visible_to": ["bank", "ann"], "terms": terms })
    }
    fn sig(agr: &str, who: &str, at: i64) -> Value {
        json!({ "id": format!("sig-{agr}-{who}"), "at": at, "author": format!("{who}-x"), "record": "signature", "agreement": agr, "as": who, "visible_to": ["bank", "ann"] })
    }
    fn tx(t: i64, from: &str, to: &str, amount: i128, settles: Option<&str>) -> Transaction {
        Transaction { t, from: from.into(), to: to.into(), amount, currency: "XTS".into(), by: "bank".into(), settles: settles.map(String::from).map(Into::into), per_instruction: None, memo: None, line: None }
    }
    fn bank(txs: Vec<Transaction>) -> Option<(Vec<AccountItem>, Vec<Transaction>)> {
        Some((accounts(), txs))
    }

    #[test]
    fn lending_an_application_not_decided_then_decided() {
        let mut b = mk("bank.lending", "bank", json!({}));
        let t0 = 60 * DAY;
        b.absorb(&obs(
            t0,
            "bank",
            vec![st("rec.1", t0, "loan_application", "ann", json!({ "addressed_to": ["bank"], "data": { "amount": 500_000, "months": 24, "account": "acc-ann", "purpose": "a car" } }))],
            bank(vec![]),
        ));
        let h = open(&*b, t0);
        let it = &heading_of(&h, "Loan applications, not decided").unwrap().items[0];
        is(it, "rec.1", Some(t0), Some(500_000));
        assert!(it.line.contains("over 24 months, for a car; not decided"), "{}", it.line);
        same(&*b, t0);
        b.absorb(&obs(t0 + DAY, "bank", vec![st("rec.2", t0 + DAY, "loan_decision", "bank", json!({ "basis": "rec.1", "data": { "application": "rec.1", "approved": false } }))], bank(vec![])));
        assert!(open(&*b, t0 + DAY).is_empty());
    }

    #[test]
    fn lending_a_loan_the_borrower_signed_and_the_principal_not_paid_out_until_it_is_paid_out() {
        let mut b = mk("bank.lending", "bank", json!({}));
        let t0 = 40 * DAY;
        b.absorb(&obs(t0, "bank", vec![], bank(vec![])));
        b.absorb(&obs(t0 + DAY, "bank", vec![loan_agreement("agr.1", t0 + DAY, None), sig("agr.1", "bank", t0 + DAY), sig("agr.1", "ann", t0 + 2 * DAY)], bank(vec![])));
        let h = open(&*b, t0 + 3 * DAY);
        is(&heading_of(&h, "Loans signed by the borrower, the principal not paid out").unwrap().items[0], "agr.1", Some(t0 + 2 * DAY), Some(120_000));
        same(&*b, t0 + 3 * DAY);
        b.absorb(&obs(t0 + 4 * DAY, "bank", vec![], bank(vec![tx(t0 + 4 * DAY, "acc-bank", "acc-ann", 120_000, Some("agr.1"))])));
        assert!(heading_of(&open(&*b, t0 + 4 * DAY), "Loans signed by the borrower, the principal not paid out").is_none());
    }

    #[test]
    fn lending_a_loan_falls_behind_a_month_after_it_started_with_the_letter_of_ours_on_file_a_repayment_settles_it() {
        let mut b = mk("bank.lending", "bank", json!({}));
        let t0 = 40 * DAY;
        // In force when the office first looked: followed from then.
        b.absorb(&obs(t0, "bank", vec![loan_agreement("agr.1", t0 - 100 * DAY, None), sig("agr.1", "bank", t0 - 100 * DAY), sig("agr.1", "ann", t0 - 100 * DAY)], bank(vec![])));
        assert!(open(&*b, t0 + MONTH + 3 * DAY).is_empty()); // (a payment under a week late is not yet listed)
        let t1 = t0 + MONTH + 10 * DAY;
        let h = open(&*b, t1);
        let it = &heading_of(&h, "Loans behind").unwrap().items[0];
        is(it, "agr.1", Some(t0 + MONTH), Some(10_000));
        assert!(it.line.contains("no letter of arrears or default notice is on file"), "{}", it.line);
        same(&*b, t1);
        // The letter of arrears is filed: the line says so; two months on, the sum is 20000 from the same day.
        b.absorb(&obs(t1, "bank", vec![st("rec.1", t1, "loan_arrears", "bank", json!({ "basis": "agr.1", "data": { "loan": "agr.1", "behind": 10_000 } }))], bank(vec![])));
        let h = open(&*b, t1);
        let it = &heading_of(&h, "Loans behind").unwrap().items[0];
        assert!(it.line.contains("a letter of arrears is on file"), "{}", it.line);
        same(&*b, t1);
        let h = open(&*b, t0 + 2 * MONTH + 10 * DAY);
        let it = &heading_of(&h, "Loans behind").unwrap().items[0];
        assert_eq!((it.since, it.amount), (Some(t0 + MONTH), Some(20_000)));
        // The borrower's payments of two months come in: nothing is behind.
        b.absorb(&obs(t1 + DAY, "bank", vec![], bank(vec![tx(t1 + DAY, "acc-ann", "acc-bank", 10_000, None), tx(t1 + DAY, "acc-ann", "acc-bank", 10_000, None)])));
        assert!(open(&*b, t0 + 2 * MONTH + 10 * DAY).is_empty());
    }

    #[test]
    fn lending_a_first_repayment_named_by_the_agreement_falls_due_when_it_says_not_a_month_after() {
        let mut b = mk("bank.lending", "bank", json!({}));
        let (t0, began) = (40 * DAY, 35 * DAY);
        b.absorb(&obs(
            t0,
            "bank",
            vec![loan_agreement("agr.1", began, Some(json!({ "first_due": 10 * DAY }))), sig("agr.1", "bank", began), sig("agr.1", "ann", began)],
            bank(vec![]),
        ));
        assert!(open(&*b, began + 10 * DAY + 3 * DAY).is_empty());
        let h = open(&*b, began + 20 * DAY);
        is(&heading_of(&h, "Loans behind").unwrap().items[0], "agr.1", Some(began + 10 * DAY), Some(10_000));
        same(&*b, began + 20 * DAY);
    }

    #[test]
    fn lending_a_payout_figure_asked_for_stands_until_it_is_given() {
        let mut b = mk("bank.lending", "bank", json!({}));
        let t0 = 40 * DAY;
        b.absorb(&obs(
            t0,
            "bank",
            vec![
                loan_agreement("agr.1", t0 - 100 * DAY, None),
                sig("agr.1", "bank", t0 - 100 * DAY),
                sig("agr.1", "ann", t0 - 100 * DAY),
                st("rec.1", t0, "loan_payout_request", "ann", json!({ "addressed_to": ["bank"], "data": { "loan": "agr.1" } })),
            ],
            bank(vec![]),
        ));
        is(&heading_of(&open(&*b, t0), "Payout figures asked for, not given").unwrap().items[0], "rec.1", Some(t0), None);
        same(&*b, t0);
        b.absorb(&obs(t0 + DAY, "bank", vec![st("rec.2", t0 + DAY, "loan_payout", "bank", json!({ "basis": "rec.1", "data": { "loan": "agr.1", "amount": 90_000 } }))], bank(vec![])));
        assert!(open(&*b, t0 + DAY).is_empty());
    }

    #[test]
    fn a_lenders_books_are_carried_on_by_a_snapshot() {
        let mut b = mk("bank.lending", "bank", json!({}));
        let t0 = 40 * DAY;
        b.absorb(&obs(t0, "bank", vec![loan_agreement("agr.1", t0 - 100 * DAY, None), sig("agr.1", "bank", t0 - 100 * DAY), sig("agr.1", "ann", t0 - 100 * DAY)], bank(vec![])));
        let saved = b.save().expect("saved");
        let mut c = mk("bank.lending", "bank", json!({}));
        c.restore(&saved).expect("restored");
        let t1 = t0 + MONTH + 10 * DAY;
        assert_eq!(lines_of(&open(&*c, t1)), lines_of(&open(&*b, t1)));
        assert_eq!(c.save().unwrap(), saved);
    }

    // ------------------------------------------------------------ possession (docs/behaviour/justice.md)

    #[test]
    fn the_tribunals_books_show_an_application_for_possession_with_the_home_what_is_said_to_be_owed_and_whether_the_tenant_has_answered_and_with_what_the_registrars_show_a_warrant_asked_for_and_not_issued() {
        let mut b = mk("tribunal.member", "tribunal", json!({ "hears": [{ "about": "possession" }] }));
        let (t0, by) = (90 * DAY, 90 * DAY + 21 * DAY);
        let app = st(
            "rec.1",
            t0,
            "tribunal_application",
            "landlord-1",
            json!({ "addressed_to": ["tribunal"], "data": { "kind": "possession", "matter": "possession", "against": "ann", "about": "lease-a", "amount": 260_000, "space": "apts-1/dwelling.1" } }),
        );
        let hn = st(
            "rec.2",
            t0,
            "hearing_notice",
            "tribunal",
            json!({ "addressed_to": ["landlord-1", "ann"], "basis": "rec.1", "data": { "application": "rec.1", "kind": "possession", "matter": "possession", "applicant": "landlord-1", "against": "ann", "answer_by": by, "hearing_at": by } }),
        );
        b.absorb(&obs(t0, "tribunal", vec![app, hn], None));
        let (hh, ripe) = ("Applications for possession of a let home, waiting for the tenant's time to answer", "Applications for possession of a let home whose day has come, not decided");
        let h = open(&*b, t0 + DAY);
        let item = &heading_of(&h, hh).unwrap().items[0];
        is(item, "rec.1", Some(t0), Some(260_000));
        assert!(item.line.contains("landlord-1 applies for possession of apts-1/dwelling.1 from ann (lease lease-a)"), "{}", item.line);
        assert!(item.line.contains("ann has not answered"), "{}", item.line);
        same(&*b, t0 + DAY);
        // (It is under that heading and no other.)
        assert_eq!(whats(&open(&*b, t0 + DAY)), vec![hh]);
        b.absorb(&obs(
            t0 + 5 * DAY,
            "tribunal",
            vec![st("rec.3", t0 + 5 * DAY, "tribunal_response", "ann", json!({ "basis": "rec.1", "addressed_to": ["tribunal"], "data": { "application": "rec.1", "paid": 60_000, "offer": 30_000 } }))],
            None,
        ));
        // The day the tenant may answer by: from its first hour the case is among those whose day has come, said in every
        // paper of the clerk's (`always`), and no longer among those waiting.
        assert_eq!(whats(&open(&*b, by - DAY)), vec![hh]);
        assert_eq!(heading_of(&open(&*b, by - DAY), hh).unwrap().items[0].due, Some(by));
        let morning = by.div_euclid(DAY) * DAY + 3600;
        let h = open(&*b, morning);
        assert_eq!(h.iter().map(|x| (x.what.as_str(), x.always)).collect::<Vec<_>>(), vec![(ripe, true)]);
        let h = open(&*b, by + DAY);
        let item = &heading_of(&h, ripe).unwrap().items[0];
        assert!(item.line.contains("ann answered"), "{}", item.line);
        assert!(item.line.contains("has been paid since; could pay"), "{}", item.line);
        assert!(item.line.contains("the tenant's time to answer ran out"), "{}", item.line);
        let order = st(
            "rec.4",
            by + DAY,
            "tribunal_order",
            "tribunal",
            json!({ "basis": "rec.1", "data": { "application": "rec.1", "kind": "possession", "applicant": "landlord-1", "against": "ann", "about": "lease-a", "finding": "possession", "due": by + 15 * DAY, "space": "apts-1/dwelling.1" } }),
        );
        b.absorb(&obs(by + DAY, "tribunal", vec![order.clone()], None));
        assert!(open(&*b, by + 2 * DAY).is_empty());
        // The registrar: a warrant asked for on that order, until one is issued.
        let mut r = mk("tribunal.registrar", "tribunal", json!({}));
        r.absorb(&obs(
            by + 16 * DAY,
            "tribunal",
            vec![order, st("rec.5", by + 16 * DAY, "warrant_request", "landlord-1", json!({ "addressed_to": ["tribunal"], "basis": "rec.4", "data": { "order": "rec.4" } }))],
            None,
        ));
        let ww = "Requests for a warrant of possession, not answered";
        let h = open(&*r, by + 17 * DAY);
        let line = &heading_of(&h, ww).unwrap().items[0].line;
        assert!(line.contains("for possession of apts-1/dwelling.1 from ann"), "{line}");
        assert!(line.contains("which has passed; no warrant issued"), "{line}");
        r.absorb(&obs(by + 18 * DAY, "tribunal", vec![st("rec.6", by + 18 * DAY, "warrant", "tribunal", json!({ "basis": "rec.4", "data": { "order": "rec.4", "lease": "lease-a" } }))], None));
        assert!(heading_of(&open(&*r, by + 19 * DAY), ww).is_none());
    }
}
