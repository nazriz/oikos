//! A person's recourse paperwork (docs/behaviour/frictions.md, justice.md; docs/design/handing-over.md section 4.3): the
//! papers a person writes to whoever did them wrong or to a body that hears the matter, and the order a clerk takes
//! them in for someone who has handed the want over.
//!
//! Shared by the citizen's own code (`citizen/recourse.rs`, the ways its mind chose: asking the landlord, asking for a
//! rise, asking a party to put something right, challenging a notice of rent increase, applying to a body that hears
//! the matter) and the code assistant at a provider's desk (`delegation/assistant.rs`, at want depth), so the paper is
//! the same to the letter whoever writes it. Pure: data in, data out. Each paper's words are said with the money words
//! the caller gives (the world's currency), never a place's figure written here.
//!
//! The clerk's order ([`next`]) is a procedure, not the person's choice: the person's own choice of way reads their
//! trust, fear and what they have learned, which a clerk has no sight of. A clerk writes first to whoever the want is
//! against or about; after their refusal, or no answer within the days given, applies to a body that says it hears the
//! matter, with a fee only within the limit it was given; otherwise it waits. Source for the order: consumer and tenancy
//! guidance (to confirm, ME-22).

use serde_json::{json, Value};

const DAY: i64 = 86_400;

/// A paper as it is to go: its kind, its words, why it is sent (the step's reason), to whom, who sees it, what it
/// cites and its data.
#[derive(Debug, Clone, PartialEq)]
pub struct Paper {
    pub kind: String,
    pub words: String,
    pub reason: String,
    pub to: Vec<String>,
    pub visible: Vec<String>,
    pub basis: Option<String>,
    pub data: Value,
}

/// Half away from zero (TS `Math.round` of a value of either sign).
fn div_round(n: i64, d: i64) -> i64 {
    if n >= 0 {
        (2 * n + d) / (2 * d)
    } else {
        -((-2 * n + d) / (2 * d))
    }
}

/// A tenant's lease, as the tenant knows it: whose it is, the landlord, the agreement, the home and its rent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Lease<'a> {
    pub me: &'a str,
    pub landlord: &'a str,
    pub agreement: &'a str,
    pub space: &'a str,
    pub rent: i64,
}

/// Asking the landlord to hold the rent where they mean to raise it (`rise`), or to let us stay on after a notice:
/// a `variation_request` citing the paper it is about. citizen.ts's `AskLandlord`.
pub fn ask_landlord(l: &Lease, about: &str, rise: bool, money: &dyn Fn(i64) -> String) -> Paper {
    let was = money(l.rent);
    let (reason, words, would) = if rise {
        (
            format!("Our landlord means to raise the rent: asking them to hold it at {was} a month."),
            format!("Request: please hold the rent for {} at {was} a month.", l.space),
            json!({ "who": l.me, "does": { "outcome": { "money": { "amount": l.rent.to_string() } } }, "every": MONTH }),
        )
    } else {
        (
            "Our landlord has given us notice: asking to stay on.".to_string(),
            format!("Request: please let us stay on at {}.", l.space),
            json!({ "who": l.landlord, "does": { "outcome": { "occupancy": { "who": l.me, "in": l.space } } } }),
        )
    };
    Paper {
        kind: "variation_request".into(),
        words,
        reason,
        to: vec![l.landlord.to_string()],
        visible: vec![l.me.to_string(), l.landlord.to_string()],
        basis: Some(about.to_string()),
        data: json!({ "agreement": l.agreement, "about": about, "would": would }),
    }
}

const MONTH: i64 = 30 * DAY;

/// Asking the employer for a rise, to `wage` every `period` seconds: a `variation_request` citing the employment.
/// citizen.ts's `AskRise`.
pub fn ask_rise(me: &str, employer: &str, agreement: &str, period: i64, wage: i64, money: &dyn Fn(i64) -> String) -> Paper {
    let days = div_round(period, DAY);
    let pay_words = money(wage);
    Paper {
        kind: "variation_request".into(),
        words: format!("Request: a rise in my pay, to {pay_words} every {days} days."),
        reason: format!("Asking our employer for a rise, to {pay_words} every {days} days."),
        to: vec![employer.to_string()],
        visible: vec![me.to_string(), employer.to_string()],
        basis: Some(agreement.to_string()),
        data: json!({ "agreement": agreement, "about": agreement, "would": { "who": employer, "does": { "outcome": { "money": { "amount": wage.to_string() } } }, "every": period } }),
    }
}

/// Taking a notice of rent increase that breaks the law to the tribunal: a `tribunal_application` citing the notice,
/// with the notice as evidence. citizen.ts's `ChallengeRent`.
pub fn challenge_rent(me: &str, tribunal: &str, by: &str, notice: &str, evidence: Value) -> Paper {
    Paper {
        kind: "tribunal_application".into(),
        words: format!("Application: the notice of rent increase {notice} from {by} breaks the law; we ask that it be found invalid."),
        reason: "A notice of rent increase that breaks the law: taking it to the tribunal, and paying the rent as it was meanwhile.".into(),
        to: vec![tribunal.to_string()],
        visible: vec![me.to_string(), tribunal.to_string(), by.to_string()],
        basis: Some(notice.to_string()),
        data: json!({ "kind": "rent_increase", "against": by, "notice": notice, "evidence": evidence }),
    }
}

/// Something gone wrong at someone's hands, as the one it happened to holds it: the matter (`disrepair`, `underpaid`,
/// `claim_refused`...), who it is against, the paper it is about, what is owed, where, and what is sought.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Matter {
    pub matter: String,
    pub party: String,
    pub about: Option<String>,
    pub amount: Option<i64>,
    pub structure: Option<String>,
    pub seeks: Option<String>,
}

/// Asking whoever it is against to put it right: a `review_request` to them, citing the paper it is about, with the
/// account a sum owed is paid into. citizen.ts's `AskPutRight`.
pub fn ask_put_right(me: &str, m: &Matter, account: &str, money: &dyn Fn(i64) -> String) -> Paper {
    let words = m.matter.replace('_', " ");
    let amt = m.amount.filter(|a| *a != 0).map(money);
    let mut data = json!({ "matter": m.matter, "against": m.party });
    if let Some(a) = &m.about {
        data["about"] = json!(a);
    }
    if let Some(a) = m.amount {
        data["amount"] = json!(a);
        data["account"] = json!(account);
    }
    if let Some(s) = &m.structure {
        data["structure"] = json!(s);
    }
    if let Some(s) = &m.seeks {
        data["seeks"] = json!(s);
    }
    Paper {
        kind: "review_request".into(),
        words: format!(
            "Request: please put this right ({words}{}{}).",
            amt.as_ref().map_or(String::new(), |a| format!(": {a} is owed to us")),
            m.structure.as_ref().map_or(String::new(), |s| format!(" at {s}"))
        ),
        reason: format!("Asking {} to put it right ({words}{}).", m.party, amt.as_ref().map_or(String::new(), |a| format!(", {a}"))),
        to: vec![m.party.clone()],
        visible: vec![me.to_string(), m.party.clone()],
        basis: m.about.clone(),
        data,
    }
}

/// An application to a body that hears a matter: which body, its notice of what it hears, the form it names, its fee,
/// and what is said with the matter (what was asked first and its answer, the particulars, the evidence, and when a
/// decision complained of was made, reviewed, or asked to be reviewed).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Applying {
    pub venue: String,
    pub hearing: String,
    pub form: String,
    pub cost: i64,
    pub asked: Option<i64>,
    pub answer: Option<String>,
    pub particulars: Value,
    pub evidence: Option<Value>,
    pub decided_on: Option<i64>,
    pub reviewed_on: Option<i64>,
    pub review_asked_on: Option<i64>,
}

/// Applying to a body that hears the matter, on its form: the application to it, citing its notice of what it hears.
/// The fee, where there is one, is paid besides (a payment, the caller's). citizen.ts's `Venue` intent.
pub fn apply(me: &str, m: &Matter, account: &str, a: &Applying, t: i64, money: &dyn Fn(i64) -> String) -> Paper {
    let words = m.matter.replace('_', " ");
    let amt = m.amount.filter(|x| *x != 0).map(money);
    let asked_words = a.asked.map_or(String::new(), |at| {
        format!(
            "; we asked them {} days ago{}",
            (t - at).div_euclid(DAY),
            match a.answer.as_deref() {
                Some("refused") => " and they refused",
                Some("ignored") => " and had no answer",
                _ => "",
            }
        )
    });
    let mut data = json!({ "kind": m.matter, "matter": m.matter, "against": m.party, "particulars": a.particulars });
    let put = |d: &mut Value, k: &str, v: Option<Value>| {
        if let Some(v) = v {
            d[k] = v;
        }
    };
    put(&mut data, "about", m.about.clone().map(Value::from));
    put(&mut data, "amount", m.amount.map(Value::from));
    put(&mut data, "account", m.amount.map(|_| Value::from(account)));
    put(&mut data, "structure", m.structure.clone().map(Value::from));
    put(&mut data, "request", a.asked.map(|at| Value::from(format!("asked on day {}", at.div_euclid(DAY)))));
    put(&mut data, "seeks", m.seeks.clone().map(Value::from));
    put(&mut data, "evidence", a.evidence.clone());
    put(&mut data, "decided_on", a.decided_on.map(Value::from));
    put(&mut data, "reviewed_on", a.reviewed_on.map(Value::from));
    put(&mut data, "review_asked_on", a.review_asked_on.map(Value::from));
    let fee_words = if a.cost > 0 { format!(", with its fee of {}", money(a.cost)) } else { String::new() };
    Paper {
        kind: a.form.clone(),
        words: format!(
            "Application: {words} against {}{}{}{asked_words}.",
            m.party,
            amt.as_ref().map_or(String::new(), |x| format!("; {x} is owed to us")),
            m.structure.as_ref().map_or(String::new(), |s| format!("; at {s}"))
        ),
        reason: format!("Taking it to {}, which hears such things ({words} against {}){fee_words}.", a.venue, m.party),
        to: vec![a.venue.clone()],
        visible: vec![me.to_string(), a.venue.clone(), m.party.clone()],
        basis: Some(a.hearing.clone()),
        data,
    }
}

// ------------------------------------------------------------------ the clerk's order

/// What a clerk knows of a want handed over: the want's own fields, the facts its client gave, and what it found on
/// the published boards.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Case {
    /// The want's `about` (`rent_increase`, `notice`, `disrepair`, `underpaid`, `claim_refused`...).
    pub about: String,
    /// The paper the want is against, and who made it, where it is against one.
    pub against: Option<(String, String)>,
    /// The client's lease, where the want is about their home: (landlord, agreement, space, rent).
    pub lease: Option<(String, String, String, i64)>,
    /// The matter, where something went wrong at someone's hands.
    pub matter: Option<Matter>,
    /// When it was asked of the other side (by the client or for them), and what they answered, as the client knows.
    pub asked: Option<i64>,
    pub answer: Option<String>,
    /// The client's account (what a sum owed is paid into).
    pub account: Option<String>,
    /// The bodies whose published notices say they hear the matter: (venue, its notice, the form it names, its fee, and
    /// the account its fee is paid into).
    pub venues: Vec<(String, String, String, i64, Option<String>)>,
    /// The most it may pay in the matter (its brief's limit); none: nothing.
    pub limit: Option<i64>,
    /// The bodies it has been taken to already (by the client or for them).
    pub applied: Vec<String>,
}

/// The clerk's next step on a case.
#[derive(Debug, Clone, PartialEq)]
pub enum Next {
    /// Write to whoever the want is against or about (the landlord, or the party), with this paper.
    Ask(Paper),
    /// Apply to a body that hears the matter, with this paper and this fee (to whom, how much).
    Apply(Paper, Option<(String, i64)>),
    /// Asked already: wait for their answer until then.
    Wait(i64),
    /// Nothing a clerk's procedure can do, and why (in words).
    Nothing(String),
}

/// The clerk's fixed order (module doc): ask first; after a refusal or `answer_days` without an answer, apply to a body
/// that hears the matter, the first on the board whose fee is within the limit; else wait, or nothing. `me` is the
/// client, in whose name the paper goes.
pub fn next(c: &Case, me: &str, t: i64, answer_days: i64, money: &dyn Fn(i64) -> String) -> Next {
    // (A want about the client's home, against a paper of their landlord's: ask the landlord.)
    if let (Some((record, by)), Some((landlord, agreement, space, rent))) = (&c.against, &c.lease) {
        if (c.about == "rent_increase" || c.about == "notice") && by == landlord {
            if c.asked.is_none() {
                let l = Lease { me, landlord, agreement, space, rent: *rent };
                return Next::Ask(ask_landlord(&l, record, c.about == "rent_increase", money));
            }
            return match c.asked {
                Some(at) if c.answer.is_none() && t < at + answer_days * DAY => Next::Wait(at + answer_days * DAY),
                _ => Next::Nothing("asked of the landlord already: no body hears a request to stay on or to hold the rent".into()),
            };
        }
    }
    let Some(m) = &c.matter else { return Next::Nothing("nothing in what was given names whom to write to".into()) };
    let Some(account) = &c.account else { return Next::Nothing("no account of the client's was given".into()) };
    let Some(at) = c.asked else { return Next::Ask(ask_put_right(me, m, account, money)) };
    let refused = c.answer.as_deref().is_some_and(|a| a != "granted");
    let waited = c.answer.is_none() && t >= at + answer_days * DAY;
    if !refused && !waited {
        return match c.answer.as_deref() {
            Some(_) => Next::Nothing("they said yes: it is theirs to do".into()),
            None => Next::Wait(at + answer_days * DAY),
        };
    }
    let limit = c.limit.unwrap_or(0);
    let open: Vec<&(String, String, String, i64, Option<String>)> = c.venues.iter().filter(|(v, ..)| !c.applied.contains(v)).collect();
    if open.is_empty() && !c.applied.is_empty() {
        return Next::Nothing(format!("taken to {} already: its decision is awaited", c.applied.join(", ")));
    }
    let Some((venue, hearing, form, cost, fee_to)) = open.into_iter().find(|(v, _, _, cost, _)| *v != m.party && *v != me && *cost <= limit) else {
        return Next::Nothing(if c.venues.is_empty() { "no body on the board says it hears this".into() } else { "every body that hears it asks a fee beyond the limit".into() });
    };
    let a = Applying {
        venue: venue.clone(),
        hearing: hearing.clone(),
        form: form.clone(),
        cost: *cost,
        asked: Some(at),
        answer: c.answer.clone().or_else(|| waited.then(|| "ignored".to_string())),
        particulars: json!(format!("{} against {}.", m.matter.replace('_', " "), m.party)),
        ..Default::default()
    };
    let fee = fee_to.clone().filter(|_| *cost > 0).map(|to| (to, *cost));
    Next::Apply(apply(me, m, account, &a, t, money), fee)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn usd(n: i64) -> String {
        format!("${}.{:02}", n / 100, n % 100)
    }

    #[test]
    fn a_clerk_asks_first_then_after_a_refusal_or_silence_applies_within_its_limit() {
        let m = Matter { matter: "disrepair".into(), party: "landlord-1".into(), structure: Some("apts-1".into()), ..Default::default() };
        let mut c = Case { about: "disrepair".into(), matter: Some(m), account: Some("acc-c1".into()), venues: vec![("city".into(), "rec.5".into(), "application".into(), 0, Some("acc-city".into()))], ..Default::default() };
        let Next::Ask(p) = next(&c, "c1", 10 * DAY, 14, &usd) else { panic!("asks first") };
        assert_eq!((p.kind.as_str(), p.to.clone()), ("review_request", vec!["landlord-1".to_string()]));
        c.asked = Some(10 * DAY);
        assert_eq!(next(&c, "c1", 12 * DAY, 14, &usd), Next::Wait(24 * DAY));
        let Next::Apply(p, _) = next(&c, "c1", 24 * DAY, 14, &usd) else { panic!("applies after silence") };
        assert_eq!((p.kind.as_str(), p.basis.as_deref(), p.data["request"].as_str()), ("application", Some("rec.5"), Some("asked on day 10")));
        // (A body with a fee beyond its limit is not applied to; within it, it is.)
        c.answer = Some("refused".into());
        c.venues[0].3 = 5_000;
        assert!(matches!(next(&c, "c1", 15 * DAY, 14, &usd), Next::Nothing(_)));
        c.limit = Some(5_000);
        assert!(matches!(next(&c, "c1", 15 * DAY, 14, &usd), Next::Apply(_, Some((ref to, 5_000))) if to == "acc-city"));
        // (Taken there already: not again.)
        c.applied = vec!["city".into()];
        assert!(matches!(next(&c, "c1", 16 * DAY, 14, &usd), Next::Nothing(_)));
    }
}
