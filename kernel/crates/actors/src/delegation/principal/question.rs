//! A question to the client (docs/behaviour/assistants.md, "A question to the client"; docs/design/stakes.md, B3): an
//! assistant asks its principal one named thing about a matter it was handed, and the principal answers from its own
//! records, in its own time (a person when they sit down to their post; an organisation's post on its wake), at the
//! table's row for an answer (`publish/question_answer`), or says it cannot say. What it may be asked is a small set its
//! code can answer from what is its own: what its account stands at; a paper of its own or sent to it, named by id; who
//! someone the matter names is, as its own papers have them; what a named detail of the hand-over is. Anything else,
//! and anything not its own, is "we cannot say". It never works out a cost and never advises: an answer is a fact it
//! holds, or none.

use super::*;

/// The words of an answer that cannot say (fixed).
const CANNOT: &str = "We cannot say.";

impl State {
    /// Its answer to a question from its assistant, as its own paper to it.
    pub(super) fn answer_question(&mut self, id: &str, pic: &Picture, cx: &mut Cx) {
        let Some(r) = self.book.get(id).cloned() else { return };
        let Some(q) = papers::read::<Question>(&r) else { return };
        let date = |at: i64| crate::common::when_words(at, &cx.ctx.world);
        let money = |n: i64| money_words(n, &cx.ctx.world);
        // (The matter: a referral of its own.)
        let referral = self.book.get(&q.referral).filter(|x| x.speaks_for.as_deref() == Some(self.me.as_str())).and_then(|x| papers::read::<Referral>(x));
        let agreement = referral.as_ref().map(|x| x.agreement.clone()).or_else(|| self.in_use().and_then(|e| e.agreement.clone())).unwrap_or_default();
        let (known, answer, words) = match (&referral, q.about) {
            (None, _) => (false, Value::Null, format!("{} is not a matter we handed you.", q.referral)),
            (Some(_), Asked::Balance) => {
                let own = pic.accounts().find(|a| a.account.as_str() == self.p.account || (self.p.account.is_empty() && a.holder.as_str() == self.me.as_str()));
                match own {
                    Some(a) => {
                        let b = crate::common::money::cents(a.balance);
                        (true, json!({ "account": a.account.as_str(), "balance": b, "at": pic.t }), format!("Our account {} stands at {} today.", a.account, money(b)))
                    }
                    None => (false, Value::Null, CANNOT.to_string()),
                }
            }
            (Some(_), Asked::Document) => match q.paper.as_deref().and_then(|p| self.held_paper(p, pic)) {
                Some(p) => {
                    let days: Vec<String> = p.dates.iter().map(|(k, d)| format!("{} {}", k.replace('_', " "), date(*d))).collect();
                    let said = format!(
                        "Our {} {} from {}, of {}{}: \"{}\"",
                        p.kind.replace('_', " "),
                        p.id,
                        p.from,
                        date(p.at),
                        if days.is_empty() { String::new() } else { format!(", naming {}", days.join(" and ")) },
                        p.text
                    );
                    (true, json!({ "paper": p.id, "kind": p.kind, "from": p.from, "at": p.at, "dates": p.dates.iter().map(|(k, d)| json!({ "named": k, "at": d })).collect::<Vec<_>>() }), said)
                }
                None => (false, Value::Null, format!("We hold no paper {}.", q.paper.as_deref().unwrap_or("of that name"))),
            },
            (Some(x), Asked::Party) => match q.name.as_deref().filter(|n| !n.is_empty()) {
                Some(who) => self.party(x, who, pic, &date),
                None => (false, Value::Null, CANNOT.to_string()),
            },
            (Some(x), Asked::Detail) => match q.name.as_deref().map(str::trim).filter(|n| !n.is_empty()).and_then(|n| detail_of(x, n).map(|v| (n.to_string(), v))) {
                Some((n, v)) => (true, json!({ "detail": n, "value": v }), format!("In this matter, {} is {}.", n.replace('_', " "), value_words(&v))),
                None => (false, Value::Null, format!("The matter has no {}.", q.name.as_deref().unwrap_or("such detail").replace('_', " "))),
            },
            // (Nothing typed: it cannot say, and points to what it said of the matter when it handed it over, the
            // referral's own words of its position, where it gave any.)
            (Some(x), Asked::Other) if !x.why.is_empty() => (false, Value::Null, format!("{CANNOT} What we told you of this matter when we handed it over: {}", x.why.join(" "))),
            (Some(_), Asked::Other) => (false, Value::Null, CANNOT.to_string()),
        };
        let a = QuestionAnswer { question: id.to_string(), referral: q.referral.clone(), about: q.about, known, answer };
        self.paper(QuestionAnswer::KIND, &words, &agreement, id, papers::data(&a), Then::Plain);
    }

    /// A paper it holds, by id: one sent to it, one of its own, or one in its book.
    fn held_paper(&self, id: &str, pic: &Picture) -> Option<PaperIn> {
        if let Some(p) = self.papers_in.iter().find(|p| p.id == id) {
            return Some(p.clone());
        }
        if let Some((_, v)) = self.own_papers.iter().find(|(x, _)| x == id) {
            let dates = crate::papers::delegation::dates_named(&v["data"]).into_iter().map(|(k, d)| (k.to_string(), d)).collect();
            return Some(PaperIn { id: id.to_string(), at: 0, kind: v["kind"].as_str().unwrap_or_default().to_string(), from: self.me.clone(), text: quoted(v["text"].as_str().unwrap_or_default()), dates });
        }
        let r = self.book.get(id).cloned().or_else(|| pic.all_records().find(|r| r.id.as_str() == id).cloned())?;
        let mine = r.speaks_for.as_deref() == Some(self.me.as_str()) || addressed_to(&r).iter().any(|a| *a == self.me);
        paper_in(&r).filter(|p| mine && !PAPERS.contains(&p.kind.as_str()))
    }

    /// Who someone a matter names is, as its own papers have them: the details of the matter that name them, the
    /// papers of the act that go to them, and the papers it holds from them or sent to them.
    fn party(&self, x: &Referral, who: &str, pic: &Picture, date: &dyn Fn(i64) -> String) -> (bool, Value, String) {
        let mut roles: Vec<String> = vec![];
        if let Some(d) = x.facts.as_ref() {
            for papers in [d.get("papers").and_then(Value::as_array).cloned().unwrap_or_default(), vec![d.clone()]] {
                for p in papers {
                    for (k, v) in p.as_object().into_iter().flatten() {
                        if v.as_str() == Some(who) && !roles.contains(k) {
                            roles.push(k.clone());
                        }
                    }
                }
            }
        }
        let mut sent: Vec<String> = vec![];
        if let Some(Ok(Program::Lines(ls))) = x.calls.as_deref().map(parse_program) {
            for l in ls {
                let to = match l.call.get("to") {
                    Some(oikos_sight::calls::Value::Id(s)) => vec![s.clone()],
                    Some(oikos_sight::calls::Value::Json(Value::Array(a))) => a.iter().filter_map(Value::as_str).map(String::from).collect(),
                    _ => vec![],
                };
                if to.iter().any(|t| t == who) {
                    sent.extend(super::super::kind_of(&l));
                }
            }
        }
        let mut theirs: Vec<PaperIn> = self.papers_in.iter().filter(|p| p.from == who).cloned().collect();
        for r in pic.all_records() {
            if r.speaks_for.as_deref() == Some(who) && x.facts.as_ref().is_some_and(|f| f.to_string().contains(&format!("\"{}\"", r.id))) && !theirs.iter().any(|p| p.id == r.id.as_str()) {
                theirs.extend(paper_in(r));
            }
        }
        let ours: Vec<String> = self.own_papers.iter().filter(|(_, v)| v["data"].to_string().contains(&format!("\"{who}\"")) || v["text"].as_str().is_some_and(|t| t.contains(who))).map(|(id, v)| format!("{} {id}", v["kind"].as_str().unwrap_or("paper").replace('_', " "))).collect();
        if roles.is_empty() && sent.is_empty() && theirs.is_empty() && ours.is_empty() {
            return (false, Value::Null, format!("We know nothing of {who} beyond this matter's papers."));
        }
        let mut said = vec![];
        if !roles.is_empty() {
            said.push(format!("In this matter {who} is the {}.", roles.iter().map(|r| r.replace('_', " ")).collect::<Vec<_>>().join(" and the ")));
        }
        if !sent.is_empty() {
            said.push(format!("Our {} goes to {who}.", sent.iter().map(|k| k.replace('_', " ")).collect::<Vec<_>>().join(" and ")));
        }
        // (The papers the matter cites, by the details that name them: where to look for what it rests on.)
        let cites: Vec<String> = x.facts.as_ref().and_then(Value::as_object).into_iter().flatten().filter_map(|(k, v)| v.as_str().filter(|s| s.starts_with("rec.")).map(|s| format!("{} {s}", k.replace('_', " ")))).collect();
        if !roles.is_empty() && !cites.is_empty() {
            said.push(format!("The matter rests on its {}.", cites.join(" and ")));
        }
        theirs.sort_by_key(|p| std::cmp::Reverse(p.at));
        for p in theirs.iter().take(3) {
            said.push(format!("We hold {who}'s {} {} of {}: \"{}\"", p.kind.replace('_', " "), p.id, date(p.at), p.text));
        }
        if !ours.is_empty() {
            said.push(format!("Our papers to them: {}.", ours.iter().rev().take(3).cloned().collect::<Vec<_>>().join(", ")));
        }
        let answer = json!({ "party": who, "roles": roles, "papers_to": sent, "papers_from": theirs.iter().take(3).map(|p| p.id.clone()).collect::<Vec<_>>() });
        (true, answer, said.join(" "))
    }
}

/// A named detail of a matter as it was handed over: in its facts (or one of its papers' facts), or in its act's calls.
fn detail_of(x: &Referral, name: &str) -> Option<Value> {
    let key = name.replace(' ', "_");
    if let Some(d) = x.facts.as_ref() {
        if let Some(v) = d.get(&key).filter(|v| !v.is_null() && key != "composed_on") {
            return Some(v.clone());
        }
        for p in d.get("papers").and_then(Value::as_array).into_iter().flatten() {
            if let Some(v) = p.get(&key).filter(|v| !v.is_null()) {
                return Some(v.clone());
            }
        }
    }
    if let Some(Ok(Program::Lines(ls))) = x.calls.as_deref().map(parse_program) {
        for l in ls {
            if let Some(oikos_sight::calls::Value::Json(Value::Object(d))) = l.call.get("data") {
                if let Some(v) = d.get(&key) {
                    return Some(v.clone());
                }
            }
        }
    }
    None
}

/// A detail's value in words: as it stands (a list joined).
fn value_words(v: &Value) -> String {
    match v {
        Value::String(s) => s.replace('_', " "),
        Value::Array(a) => a.iter().map(value_words).collect::<Vec<_>>().join(", "),
        Value::Null => "nothing".into(),
        other => other.to_string(),
    }
}
