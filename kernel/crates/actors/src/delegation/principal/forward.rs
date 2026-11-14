//! What the client passes on (docs/behaviour/assistants.md, "What the client passes on"; docs/design/stakes.md, B1): a
//! principal who has handed a matter to an assistant passes on every paper it receives about that matter, as a client
//! forwards an agency's letters to its agent. One law for every kind of paper and every body: a paper is about a matter
//! when it cites a paper sent on the matter (a decision on a claim, a request for evidence for it, an answer to a review
//! request), or when it comes from whom the matter's paper went to and cites what that paper cited (a tribunal's notice
//! or order on the application a response answers). Only what was sent to the principal, and only what came after the
//! matter was handed over (what came before is in its facts). Its own act, at the table's row for a forward
//! (`publish/forward`), in its own time (the queue drains when its own code waits). A return and a recorded authority are
//! passed on in their own kind by a person, as before (the desk's procedure reads them so), and an organisation's
//! assistant post is shown those itself; neither goes again as a forward.

use super::*;

/// How many matters it keeps the trace of (the newest), and how many papers sent in its name not yet tied to one.
const TRACES: usize = crate::figures::KEPT_TRACES;
const UNTIED: usize = crate::figures::KEPT_OWN_PAPERS;

/// What it knows of a matter it handed over, from its own papers: the papers sent on it, the records it is about, and
/// whom its papers went to.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub(super) struct Trace {
    referral: String,
    kind: String,
    at: i64,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    papers: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    cites: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    to: Vec<String>,
}

/// A paper sent in its name from its assistant's post, not yet tied to a matter: (id, kind, to, cites, at).
pub(super) type Untied = (String, String, Vec<String>, Vec<String>, i64);

/// The addressees of a program's papers (`to`).
fn addressees_of(program: &str) -> Vec<String> {
    let mut v: Vec<String> = vec![];
    if let Ok(Program::Lines(lines)) = parse_program(program) {
        for l in lines {
            match l.call.get("to") {
                Some(oikos_sight::calls::Value::Id(s)) => v.push(s.clone()),
                Some(oikos_sight::calls::Value::Json(Value::Array(a))) => v.extend(a.iter().filter_map(Value::as_str).map(String::from)),
                Some(oikos_sight::calls::Value::Json(Value::String(s))) => v.push(s.clone()),
                _ => {}
            }
        }
    }
    v.sort();
    v.dedup();
    v
}

fn push_new(v: &mut Vec<String>, xs: impl IntoIterator<Item = String>) {
    for x in xs {
        if !v.contains(&x) {
            v.push(x);
        }
    }
}

impl State {
    /// Its traces brought up to date at a wake, where a service is in use: each matter on file with its assistant, and
    /// each paper its assistant sent in its name, which it sees as it is sent (it is theirs).
    pub(super) fn trace(&mut self, pic: &Picture) {
        if self.eng.live().next().is_none() {
            return;
        }
        let fresh: Vec<Trace> = self
            .matters
            .values()
            .filter_map(|m| {
                let rf = m.referral.clone()?;
                if self.traces.iter().any(|t| t.referral == rf) {
                    return None;
                }
                let mut cites = m.subjects.clone();
                if let Some(rs) = m.facts.as_ref().and_then(|f| f["records"].as_array()) {
                    push_new(&mut cites, rs.iter().filter_map(Value::as_str).map(String::from));
                }
                Some(Trace { referral: rf, kind: m.kind.clone(), at: m.at, papers: m.own.values().cloned().collect(), cites, to: addressees_of(&m.program) })
            })
            .collect();
        for t in fresh {
            self.traces.push(t);
        }
        if self.traces.len() > TRACES {
            let over = self.traces.len() - TRACES;
            self.traces.drain(..over);
        }
        for r in pic.all_records() {
            let RecordBody::Statement { kind, .. } = &r.body else { continue };
            let theirs = match &self.p.post {
                Some(post) => r.position.as_deref() == Some(post.as_str()),
                None => r.position.is_some() && r.position.as_deref() != self.position.as_deref(),
            };
            if r.speaks_for.as_deref() != Some(self.me.as_str()) || !theirs || PAPERS.contains(&kind.as_str()) {
                continue;
            }
            let id = r.id.to_string();
            if self.untied.iter().any(|u| u.0 == id) {
                continue;
            }
            let to: Vec<String> = addressed_to(r).iter().map(|x| x.to_string()).collect();
            let cites: Vec<String> = bases_of(r).iter().map(|x| x.to_string()).collect();
            match self.traces.iter_mut().find(|t| t.papers.contains(&id)) {
                Some(t) => {
                    push_new(&mut t.to, to);
                    push_new(&mut t.cites, cites);
                }
                None => {
                    self.untied.push((id, kind.to_string(), to, cites, r.at));
                    if self.untied.len() > UNTIED {
                        self.untied.remove(0);
                    }
                }
            }
        }
        // (A paper of a matter's kind sent after it was handed over, by an assistant that has not reported what it made
        // (a seat may not): tied to the oldest such matter with no paper yet, as matters are taken in turn. Its report,
        // where one names it, ties it where it belongs.)
        let untied = std::mem::take(&mut self.untied);
        for u in untied {
            match self.traces.iter_mut().find(|t| t.papers.is_empty() && t.kind == u.1 && t.at <= u.4) {
                Some(t) => {
                    t.papers.push(u.0);
                    push_new(&mut t.to, u.2);
                    push_new(&mut t.cites, u.3);
                }
                None => self.untied.push(u),
            }
        }
    }

    /// What its assistant reported a matter made: papers sent on it.
    pub(super) fn tie(&mut self, referral: &str, made: impl IntoIterator<Item = String>) {
        let Some(i) = self.traces.iter().position(|t| t.referral == referral) else { return };
        for id in made {
            for (j, t) in self.traces.iter_mut().enumerate() {
                if j != i {
                    t.papers.retain(|p| *p != id);
                }
            }
            if let Some(j) = self.untied.iter().position(|u| u.0 == id) {
                let u = self.untied.remove(j);
                push_new(&mut self.traces[i].to, u.2);
                push_new(&mut self.traces[i].cites, u.3);
            }
            push_new(&mut self.traces[i].papers, [id]);
        }
    }

    /// The matter a body's paper is about, if it is about one it handed over: `Some(None)` where it cites a paper its
    /// assistant sent in its name not yet tied to a matter.
    fn about_matter(&self, r: &Record) -> Option<Option<String>> {
        let from = r.speaks_for.as_deref().unwrap_or(r.author.as_str());
        let bases: Vec<&str> = bases_of(r).iter().map(|b| b.as_str()).collect();
        let hit = self.traces.iter().rev().find(|t| {
            r.at >= t.at && (bases.iter().any(|b| t.papers.iter().any(|p| p == b)) || (t.to.iter().any(|x| x == from) && bases.iter().any(|b| t.cites.iter().any(|c| c == b))))
        });
        if let Some(t) = hit {
            return Some(Some(t.referral.clone()));
        }
        self.untied.iter().any(|u| bases.contains(&u.0.as_str())).then_some(None)
    }

    /// Whether a paper sent to it is one to pass on to its assistant (the law above), not passed on yet: the matter it is
    /// about (`Some(None)`: a paper sent in its name not yet tied to one).
    fn to_pass_on(&self, r: &Record) -> Option<Option<String>> {
        let RecordBody::Statement { kind, .. } = &r.body else { return None };
        let skip = [crate::common::intake::RETURNED, crate::common::intake::RECORDED];
        if self.passed.contains(r.id.as_str())
            || r.author.as_str() == self.me.as_str()
            || r.speaks_for.as_deref() == Some(self.me.as_str())
            || PAPERS.contains(&kind.as_str())
            || skip.contains(&kind.as_str())
            || !addressed_to(r).iter().any(|a| *a == self.me)
            || self.letter(r)
        {
            return None;
        }
        self.about_matter(r)
    }

    /// Papers newly seen: each one to pass on is passed on now, or, for a person who deals with their post when they sit
    /// down to it (`answer_lag`), put in its post with the rest, and passed on then (`take`, from `sit_down`).
    pub(super) fn pass_on_seen(&mut self, pic: &Picture, lag: Option<i64>) {
        if self.traces.is_empty() && self.untied.is_empty() {
            return;
        }
        for r in pic.all_records() {
            if self.to_pass_on(r).is_none() {
                continue;
            }
            if lag.is_some() && self.by_post(r) {
                if !self.in_post.iter().any(|x| x == r.id.as_str()) {
                    self.book.take_all([r]);
                    self.in_post.push(r.id.to_string());
                }
            } else {
                self.forward(r);
            }
        }
    }

    /// A paper sent to it, passed on to its assistant where it is about a matter it handed over (the law above), once.
    pub(super) fn forward(&mut self, r: &Arc<Record>) {
        let Some(matter) = self.to_pass_on(r) else { return };
        let Some(agreement) = self.in_use().and_then(|e| e.agreement.clone()) else { return };
        self.passed.insert(r.id.to_string());
        let kind = crate::common::kind(r).unwrap_or_default().to_string();
        let by = r.speaks_for.as_deref().unwrap_or(r.author.as_str()).to_string();
        let f = Forward { paper: r.id.to_string(), kind, by: by.clone(), for_: self.me.clone(), matter, text: crate::common::text(r).to_string(), data: crate::common::data(r).to_value() };
        let words = format!("From {by}: {}", f.text);
        self.paper(Forward::KIND, &words, &agreement, &r.id, papers::data(&f), Then::Plain);
    }
}
