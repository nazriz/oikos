//! A matter handed over as what happened, not as the finished act (docs/design/handing-over.md sections 3.1 and 4.3,
//! step H5): for each kind of paper that can be, the facts its principal gives (`facts_of`, read from the act its own
//! code would have sent: what happened and what it knows, never the paper's own figures worked out), how the code
//! assistant composes the paper from those facts (`compose`: the same working out the principal's code does), and which
//! of a paper's details a principal checks a draft on (`differs`: its material fields, not its words).
//!
//! One copy of each rule: the principal reads the facts, the code assistant composes, and a model in the seat is shown
//! the same facts and composes for itself. Where the facts cannot be read from an act (a shape this rule does not know),
//! the matter goes as the finished act, as before.

use crate::steps::{say, Say, Visible};
use oikos_sight::calls::{program_text, Line, Program, Value as Arg};
use serde_json::{json, Value};

/// The kinds of paper a matter can be handed over for, as what happened.
pub const MATTER_KINDS: &[&str] = &["delivery_note", "invoice"];

fn ids(a: Option<&Arg>) -> Vec<String> {
    match a {
        Some(Arg::Id(s)) | Some(Arg::Text(s)) => vec![s.clone()],
        Some(Arg::Json(Value::Array(v))) => v.iter().filter_map(|x| x.as_str().map(String::from)).collect(),
        Some(Arg::Json(Value::String(s))) => vec![s.clone()],
        _ => vec![],
    }
}

fn one(a: Option<&Arg>) -> Option<String> {
    ids(a).into_iter().next()
}

fn data(line: &Line) -> Value {
    match line.call.get("data") {
        Some(Arg::Json(v)) => v.clone(),
        _ => Value::Null,
    }
}

fn int(v: &Value) -> Option<i64> {
    v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse().ok()))
}

/// The facts of a matter, from the line its principal's code wrote for it and the rest of the same act (what the
/// principal does itself: the goods it moves). None where this kind's facts cannot be read from them.
pub fn facts_of(kind: &str, handed: &Line, own: &[Line]) -> Option<Value> {
    let d = data(handed);
    let buyer = one(handed.call.get("to"))?;
    let under = one(handed.call.get("basis"));
    match kind {
        "invoice" => {
            let q = int(&d["quantity"]).filter(|q| *q > 0)?;
            let m = &d["outcome"]["money"];
            let amount = int(&m["amount"])?;
            if amount % q != 0 {
                return None;
            }
            let mut f = json!({ "goods": d["kind"].as_str()?, "quantity": q, "sent_from": d["from_at"].as_str()?, "to": buyer, "unit_price": (amount / q).to_string(), "paid_into": m["to"].as_str()? });
            if let Some(u) = under {
                f["under"] = json!(u);
            }
            Some(f)
        }
        "delivery_note" => {
            let mut f = json!({ "order": d["order"].as_str()?, "to": buyer, "goods": d["kind"].as_str()?, "ordered": int(&d["ordered"])?, "delivered": int(&d["delivered"])?, "refund": int(&d["refund"])?.to_string() });
            for k in ["arrives", "declined", "pay_in_days"] {
                if let Some(v) = d.get(k).filter(|v| !v.is_null()) {
                    f[k] = v.clone();
                }
            }
            if let Some(p) = d.get("pay_to").and_then(Value::as_str) {
                f["paid_into"] = json!(p);
            }
            // (The price each was sold at, where the note says what is owed: its owed over what it delivered.)
            let delivered = int(&d["delivered"])?;
            if let Some(owed) = int(&d["owed"]) {
                if delivered <= 0 || owed % delivered != 0 {
                    return None;
                }
                f["unit_price"] = json!((owed / delivered).to_string());
            } else if let Some(u) = int(&d["unit_price"]) {
                f["unit_price"] = json!(u.to_string());
            }
            // (Where the goods went: the move the principal makes itself in the same act.)
            if let Some(g) = own.iter().find(|l| l.call.fn_ == "goods") {
                if let (Some(to), Some(at)) = (one(g.call.get("to")), one(g.call.get("at"))) {
                    f["delivered_to"] = json!(to);
                    f["delivered_at"] = json!(at);
                }
            }
            Some(f)
        }
        _ => None,
    }
}

/// The paper the code assistant composes from a matter's facts, as the act it sends (the call language), in the name of
/// `me` (whom it works for). The same working out its principal's code does (`market/producer.rs`, `market/trade.rs`).
pub fn compose(kind: &str, f: &Value, me: &str, money: &dyn Fn(i64) -> String) -> Option<String> {
    let buyer = f["to"].as_str()?.to_string();
    let visible = Some(Visible::Only(vec![me.to_string(), buyer.clone()]));
    let (bind, call) = match kind {
        "invoice" => {
            let q = int(&f["quantity"])?;
            let unit = int(&f["unit_price"])?;
            let goods = f["goods"].as_str()?;
            let d = json!({ "kind": goods, "quantity": q, "from_at": f["sent_from"].as_str()?,
                "outcome": { "money": { "to": f["paid_into"].as_str()?, "amount": (q * unit).to_string(), "for": format!("{q} {goods} exported") } } });
            let words = format!("Invoice: {q} {goods} at {} each, {}.", money(unit), money(q * unit));
            (Some("invoice".to_string()), say("invoice", &words, Say { to: Some(vec![buyer]), visible, basis: f["under"].as_str().map(String::from), data: Some(d), ..Default::default() }))
        }
        "delivery_note" => {
            let order = f["order"].as_str()?;
            let goods = f["goods"].as_str()?;
            let (ordered, delivered, refund) = (int(&f["ordered"])?, int(&f["delivered"])?, int(&f["refund"])?);
            let mut d = json!({ "order": order, "kind": goods, "ordered": ordered, "delivered": delivered, "refund": refund });
            let words = match f.get("declined").and_then(Value::as_str) {
                Some(why) => {
                    d["declined"] = json!(why);
                    if why == "overdue" { format!("Order {order} declined: {buyer} has not paid what it owed on our terms.") } else { format!("Order {order} declined: not paid.") }
                }
                None => {
                    if let Some(a) = f.get("arrives").filter(|v| !v.is_null()) {
                        d["arrives"] = a.clone();
                    }
                    let mut w = if delivered == ordered {
                        format!("Delivered: {delivered} {goods} to {} at {}.", f["delivered_to"].as_str().unwrap_or(&buyer), f["delivered_at"].as_str().unwrap_or("the place ordered"))
                    } else {
                        format!("Delivered {delivered} of the {ordered} {goods} ordered{}.", if refund > 0 { format!("; {} refunded", money(refund)) } else { String::new() })
                    };
                    if let (Some(days), Some(unit)) = (int(&f["pay_in_days"]), int(&f["unit_price"])) {
                        let pay_to = f["paid_into"].as_str()?;
                        w.push_str(&format!(" Invoice: {}, to be paid within {days} days, into {pay_to}, naming the order ({order}).", money(delivered * unit)));
                        d["owed"] = json!(delivered * unit);
                        d["pay_in_days"] = json!(days);
                        d["pay_to"] = json!(pay_to);
                    } else if let Some(unit) = int(&f["unit_price"]) {
                        d["unit_price"] = json!(unit);
                    }
                    w
                }
            };
            (None, say("delivery_note", &words, Say { to: Some(vec![buyer]), visible, basis: Some(order.to_string()), data: Some(d), ..Default::default() }))
        }
        _ => return None,
    };
    Some(program_text(&Program::Lines(vec![Line { bind, call }])))
}

/// The material details of a kind of paper: what a principal checks a draft on (its words are the assistant's).
fn material(kind: &str) -> &'static [&'static str] {
    match kind {
        "invoice" => &["quantity", "outcome.money.amount", "outcome.money.to"],
        "delivery_note" => &["order", "delivered", "refund", "owed", "pay_to", "declined"],
        _ => &[],
    }
}

fn at<'a>(v: &'a Value, path: &str) -> &'a Value {
    path.split('.').fold(v, |x, k| x.get(k).unwrap_or(&Value::Null))
}

/// How a paper drafted for a matter differs from the one its principal's own code would have sent, on the kind's
/// material details and its addressees: the names of those that differ (none: as it would have sent it). `asked` is the
/// principal's own line for it; `kind`, `to` and `data` are the draft's paper.
pub fn differs(kind: &str, asked: &Line, drafted_kind: &str, to: &[String], drafted: &Value) -> Vec<String> {
    let mut out = vec![];
    if drafted_kind != kind {
        out.push("kind".to_string());
    }
    let mut a = ids(asked.call.get("to"));
    let mut b = to.to_vec();
    a.sort();
    b.sort();
    if a != b {
        out.push("to".to_string());
    }
    let mine = data(asked);
    for f in material(kind) {
        let (x, y) = (at(&mine, f), at(drafted, f));
        let same = x == y || (int(x).is_some() && int(x) == int(y));
        if !same {
            out.push((*f).to_string());
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use oikos_sight::calls::parse_program;

    fn line(text: &str) -> Line {
        match parse_program(text).unwrap() {
            Program::Lines(mut l) => l.remove(0),
            Program::None(_) => panic!("no line"),
        }
    }
    fn money(n: i64) -> String {
        format!("${}.{:02}", n / 100, n % 100)
    }

    /// The generator offers these kinds as what happened (participants/src/kinds/assistants.ts, `MATTER_KINDS`): one list.
    #[test]
    fn the_generator_offers_the_kinds_composed_here() {
        let ts = include_str!("../../../../../participants/src/kinds/assistants.ts");
        let listed = format!("MATTER_KINDS = [{}]", MATTER_KINDS.iter().map(|k| format!("\"{k}\"")).collect::<Vec<_>>().join(", "));
        assert!(ts.contains(&listed), "{listed}");
    }

    /// The code assistant, given the facts its principal reads from its own act, composes the same paper: the same
    /// details, the same addressees, and (for these kinds) the same words.
    #[test]
    fn facts_read_from_an_act_compose_the_same_paper() {
        let inv = line("invoice = statement(basis=rec.16, data={\"from_at\":\"factory-1-works\",\"kind\":\"goods\",\"outcome\":{\"money\":{\"amount\":\"23750000\",\"for\":\"2375 goods exported\",\"to\":\"acc-factory-1\"}},\"quantity\":2375}, kind=invoice, text=\"Invoice: 2375 goods at $100.00 each, $237,500.00.\", to=[\"outside\"], visible=[\"factory-1\",\"outside\"])");
        let f = facts_of("invoice", &inv, &[]).expect("facts");
        assert_eq!(f["unit_price"], json!("10000"));
        assert!(f.get("outcome").is_none() && f.get("amount").is_none(), "what the paper works out is not given: {f}");
        let made = compose("invoice", &f, "factory-1", &money).unwrap();
        let back = line(&made);
        assert_eq!(back.bind.as_deref(), Some("invoice"));
        assert_eq!(differs("invoice", &inv, "invoice", &ids(back.call.get("to")), &data(&back)), Vec::<String>::new());
        let note = line("statement(basis=rec.9, data={\"delivered\":3,\"kind\":\"goods\",\"order\":\"rec.9\",\"ordered\":5,\"owed\":3000,\"pay_in_days\":30,\"pay_to\":\"acc-f1\",\"refund\":0}, kind=delivery_note, text=\"x\", to=[\"shop-1\"], visible=[\"shop-1\",\"f1\"])");
        let goods = line("goods(at=shop-1-premises, carried=yes, from_at=works, kind=goods, quantity=\"3\", to=shop-1)");
        let f = facts_of("delivery_note", &note, &[goods]).expect("facts");
        assert!(f.get("owed").is_none() && f["unit_price"] == json!("1000"), "{f}");
        let made = line(&compose("delivery_note", &f, "f1", &money).unwrap());
        assert_eq!(differs("delivery_note", &note, "delivery_note", &ids(made.call.get("to")), &data(&made)), Vec::<String>::new());
        assert!(matches!(made.call.get("text"), Some(Arg::Text(t)) if t.contains("Invoice: $30.00, to be paid within 30 days, into acc-f1")));
        // (A draft that invoices for more is found on the detail that differs.)
        let mut more = data(&made);
        more["owed"] = json!(4000);
        assert_eq!(differs("delivery_note", &note, "delivery_note", &["shop-1".into()], &more), vec!["owed".to_string()]);
    }
}
