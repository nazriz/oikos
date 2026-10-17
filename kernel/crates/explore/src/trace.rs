//! The causal trace (renderer/src/trace.ts; docs/design/renderer.md 5): from a change that reached someone, back
//! through the act that made it, who decided it and why, to the records it rested on, and theirs, as far as the log
//! goes. Each link is a sentence in the world's terms with its time, who decided, their class, and the line it comes
//! from. Nothing is inferred that the log does not say: an effect with no act is the world's; a payment made by a
//! standing instruction leads to the instruction.

use crate::inner::{Inner, DAY};
use crate::js::{clip, g, gs, jstr, jstr0, jstr_or, list, truthy};
use crate::world::{class_name, person_of_participant};
use crate::{Decider, Link, Role, Why};
use serde_json::Value;
use std::collections::HashSet;

/// Minor units as the world writes money (`money` of trace.ts).
pub fn money(s: &Inner, minor: Option<&Value>) -> String {
    let txt = jstr(minor);
    let digits = txt.strip_prefix('-').unwrap_or(&txt);
    if digits.is_empty() || !digits.bytes().all(|c| c.is_ascii_digit()) {
        return txt;
    }
    let c = &s.world().currency;
    let places = g(c, "minor_units").and_then(crate::js::num_i64).unwrap_or(2).max(0) as usize;
    let neg = txt.starts_with('-');
    let mut d = digits.to_string();
    while d.len() < places + 1 {
        d.insert(0, '0');
    }
    let int = &d[..d.len() - places];
    let group = gs(c, "group_mark").unwrap_or(",");
    let mut grouped = String::new();
    for (i, ch) in int.chars().enumerate() {
        if i > 0 && (int.len() - i) % 3 == 0 {
            grouped.push_str(group);
        }
        grouped.push(ch);
    }
    let dec = if places > 0 { format!("{}{}", gs(c, "decimal_mark").unwrap_or("."), &d[d.len() - places..]) } else { String::new() };
    format!("{}{}{}{}", if neg { "-" } else { "" }, gs(c, "symbol").unwrap_or(""), grouped, dec)
}

fn blocks(b: &Value) -> &[Value] {
    match b.get("blocks") {
        Some(Value::Array(a)) => a,
        _ => &[],
    }
}

/// One kept line as a sentence in the world's terms.
pub fn describe(s: &Inner, e: &Value) -> String {
    let null = Value::Null;
    let b = e.get("body").unwrap_or(&null);
    let kind = gs(e, "kind").unwrap_or("");
    let cmd = gs(b, "command");
    if kind == "command" && cmd == Some("act") {
        let parts: Vec<String> = blocks(b)
            .iter()
            .map(|x| {
                let blk = gs(x, "block");
                match blk {
                    Some("publish") => format!(
                        "{}{}{}",
                        jstr_or(x.get("kind"), "statement"),
                        if truthy(x.get("addressed_to")) {
                            format!(" to {}", list(x.get("addressed_to")).join(", "))
                        } else {
                            String::new()
                        },
                        if truthy(x.get("text")) { format!(": “{}”", clip(&jstr0(x.get("text")), 220)) } else { String::new() }
                    ),
                    Some("transfer") => format!(
                        "pay {} from {} to {}{}",
                        money(s, x.get("amount")),
                        jstr(x.get("from")),
                        jstr(x.get("to")),
                        if truthy(x.get("memo")) { format!(" ({})", clip(&jstr0(x.get("memo")), 80)) } else { String::new() }
                    ),
                    Some("message") => format!("letter to {}: “{}”", list(x.get("to")).join(", "), clip(&jstr0(x.get("text")), 200)),
                    Some("occupy") | Some("vacate") => format!("{} {}", jstr(x.get("block")), jstr0(x.get("space"))),
                    _ => format!(
                        "{}{}{}",
                        jstr(x.get("block")),
                        if truthy(x.get("kind")) { format!(" {}", jstr(x.get("kind"))) } else { String::new() },
                        if truthy(x.get("text")) { format!(": “{}”", clip(&jstr0(x.get("text")), 200)) } else { String::new() }
                    ),
                }
            })
            .collect();
        let joined = parts.join("; ");
        return format!(
            "{}{}: {}",
            jstr(b.get("participant")),
            if truthy(b.get("as")) { format!(" as {}", jstr(b.get("as"))) } else { String::new() },
            if joined.is_empty() { "acted".to_string() } else { joined }
        );
    }
    if kind == "command" && cmd == Some("entity_record") {
        let keys: Vec<String> = match b.get("set") {
            Some(Value::Object(m)) => m.keys().cloned().collect(),
            _ => vec![],
        };
        return format!("{} changed their own record ({})", jstr(b.get("participant")), keys.join(", "));
    }
    if kind == "annotation" {
        if gs(b, "annotation") == Some("decision") {
            let d = g(b, "data").cloned().unwrap_or(Value::Null);
            let n = match d.get("options") {
                Some(Value::Array(a)) => a.len(),
                _ => 0,
            };
            return format!(
                "{} weighed {}: chose {} of {} options",
                jstr(b.get("subject")),
                jstr_or(d.get("domain"), "a choice"),
                jstr_or(d.get("choice"), "?"),
                n
            );
        }
        return format!(
            "{}{}",
            jstr(b.get("annotation")),
            if truthy(b.get("subject")) { format!(" ({})", jstr(b.get("subject"))) } else { String::new() }
        );
    }
    let ev = gs(b, "event").unwrap_or("");
    match ev {
        "transfer" => format!(
            "{} from {} to {}{}{}",
            money(s, b.get("amount")),
            jstr(b.get("from")),
            jstr(b.get("to")),
            if truthy(b.get("memo")) { format!(" ({})", clip(&jstr0(b.get("memo")), 100)) } else { String::new() },
            if truthy(b.get("per_instruction")) {
                format!(", by standing instruction {}", jstr(b.get("per_instruction")))
            } else {
                String::new()
            }
        ),
        "recorded" => {
            let r = g(b, "record").cloned().unwrap_or(Value::Object(Default::default()));
            let first = g(&r, "kind").or_else(|| g(&r, "record"));
            format!(
                "{} {} by {}{}{}",
                first.map(|v| jstr(Some(v))).unwrap_or_else(|| "record".into()),
                jstr0(r.get("id")),
                g(&r, "speaks_for").or_else(|| g(&r, "author")).map(|v| jstr(Some(v))).unwrap_or_else(|| "?".into()),
                if truthy(r.get("addressed_to")) { format!(" to {}", list(r.get("addressed_to")).join(", ")) } else { String::new() },
                if truthy(r.get("text")) { format!(": “{}”", clip(&jstr0(r.get("text")), 260)) } else { String::new() }
            )
        }
        "message_delivered" => {
            format!("letter {} from {} delivered to {}", jstr(b.get("message")), jstr(b.get("participant")), list(b.get("to")).join(", "))
        }
        "vacated" => format!(
            "{} left {} ({}{})",
            jstr(b.get("occupant")),
            jstr(b.get("space")),
            jstr_or(b.get("reason"), "moved"),
            if truthy(b.get("by")) { format!(", by {}", jstr(b.get("by"))) } else { String::new() }
        ),
        "action_refused" => format!("refused ({}): {}", jstr(b.get("code")), clip(&jstr0(b.get("detail")), 200)),
        "condition_began" => format!(
            "{} fell {} ({})",
            jstr(b.get("person")),
            if gs(b, "kind") == Some("injury") { "injured" } else { "ill" },
            jstr0(b.get("severity"))
        ),
        "condition_treated" => format!("{} treated by {}", jstr(b.get("person")), jstr_or(b.get("by"), "?")),
        "condition_ended" => format!("{} recovered", jstr(b.get("person"))),
        "person_died" => format!("{} died ({})", jstr(b.get("person")), jstr_or(b.get("died_of"), "?")),
        "person_left" => format!("{} left the town for {}", jstr(b.get("person")), jstr_or(b.get("to"), "elsewhere")),
        "person_arrived" => format!("{} arrived", jstr(b.get("person"))),
        "worked" => format!("work at {}: {} ({} units)", jstr(b.get("at")), jstr(b.get("task")), jstr_or(b.get("units"), "0")),
        "goods_moved" => {
            format!("{} {} moved from {} to {}", jstr(b.get("quantity")), jstr(b.get("kind")), jstr(b.get("from")), jstr(b.get("to")))
        }
        "appointed" => format!("appointed to {}", jstr(b.get("position"))),
        "body_changed" => format!("{}'s {} is now {}", jstr(b.get("person")), jstr(b.get("variable")), jstr(b.get("value"))),
        _ => {
            if let Some(ev) = g(b, "event") {
                jstr(Some(ev))
            } else {
                kind.to_string()
            }
        }
    }
}

/// Who decided an act and the why the log gives for it.
fn act_link(s: &Inner, act_ord: u32, depth: u32, about: Option<&str>, action: Option<usize>) -> Link {
    let e = s.line(act_ord).unwrap_or(Value::Null);
    let null = Value::Null;
    let b = e.get("body").unwrap_or(&null);
    let participant = jstr(b.get("participant"));
    let p = s.participant_info(&participant);
    let cls = s.cls_of(&participant, about);
    let e_t = crate::js::gi(&e, "t").unwrap_or(0);
    let why = if cls == Decider::Seat {
        let prov = b.get("provenance");
        let via = prov.and_then(|p| gs(p, "via"));
        Why {
            kind: "seat".into(),
            text: if via == Some("translator") {
                format!(
                    "asked in its own words; the translator drafted {}, which the seat confirmed",
                    prov.and_then(|p| g(p, "draft")).map(|d| jstr(Some(d))).unwrap_or_else(|| "a draft".into())
                )
            } else {
                "the seat's own call".into()
            },
            seq: crate::js::gi(&e, "seq").map(|x| x as u64),
            ord: None,
        }
    } else {
        // A code citizen's choice: the decision it recorded just before acting, where the run recorded decisions.
        let posts = s.postings(&participant);
        let mut dec: Option<u32> = None;
        for &o in posts.iter().rev() {
            if o >= act_ord {
                continue;
            }
            if s.t(o) < e_t - 3600 {
                break;
            }
            if s.name_of(o) == "annotation:decision" {
                dec = Some(o);
                break;
            }
        }
        if let Some(dec) = dec {
            let line = s.line(dec).unwrap_or(Value::Null);
            let d = line.get("body").and_then(|b| g(b, "data")).cloned().unwrap_or(Value::Null);
            let opts: Vec<String> = match d.get("options") {
                Some(Value::Array(a)) => a.iter().take(5).map(|x| format!("{} {}", jstr(x.get("key")), jstr(x.get("score")))).collect(),
                _ => vec![],
            };
            Why {
                kind: "decision".into(),
                ord: Some(dec),
                seq: None,
                text: format!(
                    "weighed {}: {}; chose {}{}",
                    jstr_or(d.get("domain"), "a choice"),
                    opts.join(", "),
                    jstr(d.get("choice")),
                    if truthy(d.get("strategy")) { format!(" ({})", jstr(d.get("strategy"))) } else { String::new() }
                ),
            }
        } else if truthy(b.get("reasoning")) {
            Why { kind: "reason".into(), text: jstr(b.get("reasoning")), seq: None, ord: None }
        } else {
            let reason = blocks(b).iter().filter_map(|x| x.get("data").and_then(|d| g(d, "reason"))).find(|r| truthy(Some(r)));
            match reason {
                Some(r) => Why { kind: "reason".into(), text: jstr(Some(r)), seq: None, ord: None },
                None => Why {
                    kind: "none".into(),
                    text: format!(
                        "{}: reasoning not logged in this run",
                        p.and_then(|p| p.imp.clone()).unwrap_or_else(|| "its code".into())
                    ),
                    seq: None,
                    ord: None,
                },
            }
        }
    };
    let by = action.and_then(|a| s.performers_of(a));
    Link {
        ord: Some(act_ord),
        t: Some(e_t),
        depth,
        role: Role::Act,
        text: describe(s, &e),
        who: Some(participant),
        as_: g(b, "as").map(|v| jstr(Some(v))),
        cls: Some(cls),
        model: p.and_then(|p| p.model.clone()),
        by,
        why: Some(why),
        status: action.map(|a| s.action(a).status),
        record: None,
    }
}

/// The basis records an act or a record cites.
fn bases_of(e: &Value) -> Vec<String> {
    let null = Value::Null;
    let b = e.get("body").unwrap_or(&null);
    let mut out: Vec<String> = vec![];
    let mut add = |x: String| {
        if !out.contains(&x) {
            out.push(x)
        }
    };
    if let Some(r) = b.get("record") {
        for x in list(r.get("basis")) {
            add(x);
        }
    }
    for bl in blocks(b) {
        for x in list(bl.get("basis")) {
            add(x);
        }
        if truthy(bl.get("per_instruction")) {
            add(jstr(bl.get("per_instruction")));
        }
    }
    if truthy(b.get("per_instruction")) {
        add(jstr(b.get("per_instruction")));
    }
    if truthy(b.get("settles")) {
        add(jstr(b.get("settles")));
    }
    out
}

struct Walker<'a> {
    s: &'a Inner,
    about: Option<&'a str>,
    max: u32,
    out: Vec<Link>,
    seen: HashSet<u32>,
}

fn plain(depth: u32, role: Role, text: String) -> Link {
    Link {
        ord: None,
        t: None,
        depth,
        role,
        text,
        who: None,
        as_: None,
        cls: None,
        model: None,
        by: None,
        why: None,
        status: None,
        record: None,
    }
}

impl Walker<'_> {
    fn walk(&mut self, o: u32, depth: u32, role: Role) {
        if self.seen.contains(&o) || self.out.len() > 60 {
            return;
        }
        self.seen.insert(o);
        let e = self.s.line(o).unwrap_or(Value::Null);
        let null = Value::Null;
        let b = e.get("body").unwrap_or(&null);
        let is_act = gs(&e, "kind") == Some("command") && gs(b, "command") == Some("act");
        if is_act {
            self.out.push(act_link(self.s, o, depth, self.about, None));
        } else {
            let mut l = plain(depth, role, describe(self.s, &e));
            l.ord = Some(o);
            l.t = crate::js::gi(&e, "t");
            l.record = b.get("record").and_then(|r| g(r, "id")).map(|v| jstr(Some(v)));
            self.out.push(l);
            let a = self.s.action_of(o);
            if a >= 0 {
                let act_ord = self.s.actions[a as usize][0];
                if act_ord >= 0 && !self.seen.contains(&(act_ord as u32)) {
                    self.seen.insert(act_ord as u32);
                    self.out.push(act_link(self.s, act_ord as u32, depth, self.about, Some(a as usize)));
                    let act_line = self.s.line(act_ord as u32).unwrap_or(Value::Null);
                    self.walk_bases(&act_line, depth + 1);
                }
            } else if bases_of(&e).is_empty() && gs(&e, "kind") == Some("event") {
                let mut l = plain(
                    depth,
                    Role::World,
                    "no act of anyone's: the world (a scheduled payment, a life event, nature, a rule taking its course)".into(),
                );
                l.cls = Some(Decider::World);
                self.out.push(l);
            }
        }
        self.walk_bases(&e, depth + 1);
    }

    fn walk_bases(&mut self, e: &Value, depth: u32) {
        let bases = bases_of(e);
        if depth > self.max {
            if !bases.is_empty() {
                self.out.push(plain(depth, Role::Stop, format!("… and further back (depth {})", self.max)));
            }
            return;
        }
        let null = Value::Null;
        let b = e.get("body").unwrap_or(&null);
        for id in bases {
            let Some((ord, rec)) = self.s.record(&id) else {
                self.out.push(plain(depth, Role::Stop, format!("{id}: not a record of this run")));
                continue;
            };
            let Some(ord) = ord else {
                let first = g(&rec, "kind").or_else(|| g(&rec, "record")).map(|v| jstr(Some(v))).unwrap_or_else(|| "undefined".into());
                let by = g(&rec, "speaks_for").or_else(|| g(&rec, "author")).map(|v| jstr(Some(v))).unwrap_or_else(|| "undefined".into());
                let mut l = plain(
                    depth,
                    Role::Genesis,
                    format!(
                        "{first} {id} by {by}, made before the run{}",
                        if truthy(rec.get("text")) { format!(": “{}”", clip(&jstr0(rec.get("text")), 200)) } else { String::new() }
                    ),
                );
                l.record = Some(id.clone());
                l.cls = Some(Decider::World);
                self.out.push(l);
                continue;
            };
            let mut instructions: Vec<String> = vec![];
            if truthy(b.get("per_instruction")) {
                instructions.push(jstr(b.get("per_instruction")));
            }
            for bl in blocks(b) {
                if truthy(bl.get("per_instruction")) {
                    instructions.push(jstr(bl.get("per_instruction")));
                }
            }
            let role = if instructions.contains(&id) { Role::Instruction } else { Role::Basis };
            self.walk(ord, depth, role);
        }
    }
}

/// The trace of one kept line: newest first, down to depth `max`. `about`: the person it is traced for.
pub fn trace(s: &Inner, ord: u32, about: Option<&str>, max: u32) -> Vec<Link> {
    if (ord as usize) >= s.kept() {
        return vec![];
    }
    let mut w = Walker { s, about, max, out: vec![], seen: HashSet::new() };
    w.walk(ord, 0, Role::Change);
    w.out
}

/// What a kept line is, for a list: its time, sentence, who decided it for `about`, hard or not.
pub struct EventRow {
    pub ord: u32,
    pub t: i64,
    pub day: i64,
    pub name: String,
    pub text: String,
    pub who: Option<String>,
    pub cls: Decider,
    pub own: bool,
}
impl EventRow {
    pub fn to_value(&self) -> Value {
        crate::js::Obj::new()
            .set("ord", self.ord)
            .set("t", self.t)
            .set("day", self.day)
            .set("name", self.name.clone())
            .set("text", self.text.clone())
            .opt("who", self.who.clone())
            .set("cls", class_name(self.cls))
            .set("own", self.own)
            .build()
    }
}
pub fn event_row(s: &Inner, ord: u32, about: Option<&str>) -> EventRow {
    let e = s.line(ord).unwrap_or(Value::Null);
    let null = Value::Null;
    let b = e.get("body").unwrap_or(&null);
    let who: Option<String> =
        if gs(&e, "kind") == Some("command") { g(b, "participant").map(|v| jstr(Some(v))) } else { s.who_of(ord).map(String::from) };
    let cls = match &who {
        Some(w) if !w.is_empty() => s.cls_of(w, about),
        _ => Decider::World,
    };
    let t = crate::js::gi(&e, "t").unwrap_or(0);
    let own = matches!((&who, about), (Some(w), Some(a)) if !w.is_empty() && !a.is_empty() && person_of_participant(w) == a);
    EventRow { ord, t, day: (t as f64 / DAY as f64).floor() as i64, name: s.name_of(ord).to_string(), text: describe(s, &e), who, cls, own }
}
