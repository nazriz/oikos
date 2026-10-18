//! The mind's part of a citizen's week (citizen.ts `plan`'s mind half, and `wordOfMouth`, `voice`, `civic`,
//! `newsOfMine`): upbringing, attachments, drift and views, the goals of one who takes no initiative, wants born and
//! met, wants pursued by the ways open to them, founding, the union, groups made in the run, gatherings, civic life,
//! petitions and talk. Every act is a step life sends with its own (`Planned`); ways chosen for wants that are life's
//! acts go back as `Chosen` intents. Order is citizen.ts's, so draws come in the same order.

use super::citizen::{view_of, Attending, Begun, CitizenMind, Group, FUND_WORTH_MIN_BPS, MONTH};
use super::inner::Bond;
use super::culture::{culture_words, Conduct, Route};
use super::founding;
use super::math::round;
use super::person::{Emotion, Need, Pursuit, Value};
use super::talk;
use super::townmemory;
use super::wants::{self, SeekKey, Want, WantEventKind};
use crate::citizen::mind::*;
use crate::common::{self, letters::message, published_count, Book};
use crate::papers::agreements::{notice, sign};
use crate::steps::{self, because, call, json as jarg, text, Pay, Say, Visible};
use crate::{Cx, DAY};
use oikos_sight::{Picture, Record, RecordBody, Seen};
use serde_json::{json, Map, Value as Json};
use std::collections::{BTreeMap, BTreeSet};


fn statement(r: &Record) -> Option<(&str, &Json, Option<&Json>, Option<&Json>, &[String])> {
    match &r.body {
        RecordBody::Statement { kind, data, offer, practice, addressed_to, .. } => {
            Some((kind.as_str(), data.as_ref().unwrap_or(&Json::Null), offer.as_ref(), practice.as_ref(), addressed_to.as_deref().unwrap_or(&[])))
        }
        _ => None,
    }
}
fn speaker(r: &Record) -> &str {
    r.speaks_for.as_deref().unwrap_or(&r.author)
}
/// Money the taker pays an offer at once (its `who: taker` commitments' money with a payee).
fn asks_of(o: &Json) -> i64 {
    o.pointer("/terms/commitments").and_then(Json::as_array).map_or(0, |cs| {
        cs.iter().filter(|c| c.get("who").and_then(Json::as_str) == Some("taker")).filter_map(|c| c.pointer("/does/outcome/money")).filter(|m| m.get("to").is_some()).map(|m| jc(m.get("amount").unwrap_or(&Json::Null))).sum()
    })
}

impl CitizenMind {
    /// Party to an agreement in force with someone, of a template (none: any).
    fn party_with(&self, book: &Book, whom: &str, template: Option<&str>) -> bool {
        let me = self.me();
        book.of_type("agreement").any(|r| match &r.body {
            RecordBody::Agreement { terms } => {
                template.map_or(true, |t| terms.template.as_deref() == Some(t))
                    && terms.parties.iter().any(|p| p.as_str() == me)
                    && terms.parties.iter().any(|p| p.as_str() == whom)
                    && book.in_force(&r.id)
            }
            _ => false,
        })
    }
    pub fn member_of(&self, book: &Book, org: &str) -> bool {
        self.party_with(book, org, Some("membership"))
    }
    /// Whether an offer's eligibility lets us take it (members of, dealing with, named entities).
    fn eligible(&self, book: &Book, to: Option<&Json>) -> bool {
        let Some(to) = to else { return true };
        if let Some(m) = to.get("members_of").and_then(Json::as_str) {
            if !self.member_of(book, m) {
                return false;
            }
        }
        if let Some(d) = to.get("dealing_with").and_then(Json::as_str) {
            if !self.party_with(book, d, None) {
                return false;
            }
        }
        if let Some(es) = to.get("entities").and_then(Json::as_array) {
            if !es.iter().any(|e| e.as_str() == Some(self.me())) {
                return false;
            }
        }
        true
    }
    /// How much of a month of essentials a fund's stated draw covers (basis points, at most 10,000): citizen.ts
    /// `fundWorth`.
    fn fund_worth(&self, r: &Record) -> Option<i64> {
        let (_, _, offer, _, _) = statement(r)?;
        let host = speaker(r);
        let draw = offer?.pointer("/terms/commitments")?.as_array()?.iter().filter(|c| c.get("who").and_then(Json::as_str) == Some(host)).filter_map(|c| c.pointer("/does/outcome/money")).find(|m| m.get("amount").map_or(false, common::truthy))?;
        Some(((jc(draw.get("amount").unwrap_or(&Json::Null)) * 10_000) / self.p.essentials.max(1)).min(10_000))
    }

    // -------------------------------------------------------------- the week

    pub fn plan_all(&mut self, cx: &mut Cx, pic: &Picture, book: &Book, life: &Life, ways: &dyn Openings) -> Planned {
        let t = cx.t;
        let mut out = Planned::default();
        self.refresh_teachings(book);
        let fresh: Vec<_> = book.records().filter(|r| r.at >= self.s.last_planned_from).cloned().collect();
        let first_plan = !self.s.planned_once;
        // Culture: someone made in the run holds the picture lightly; a newcomer with no parents here is of a group
        // drawn from the profile's shares (citizen.ts 1733-1740).
        if first_plan && self.p.own_values.is_none() {
            let env = self.env();
            if let (Some(cul), Some(cd)) = (self.s.culture.as_mut(), self.p.cdial.as_ref()) {
                cul.arrive(t);
                let total: i64 = cd.shares.iter().map(|g| g.share_bps).sum();
                let parents = pic.body.as_ref().map_or(0, |b| b.parents.len());
                if cul.group().is_none() && !cd.shares.is_empty() && total > 0 && parents == 0 {
                    let mut r = cx.rng("culture-origin").below(total as u64) as i64;
                    let g = cd.shares.iter().find(|g| {
                        r -= g.share_bps;
                        r < 0
                    });
                    let id = g.or(cd.shares.last()).map(|g| g.id.clone()).unwrap_or_default();
                    cul.set_group(&env, cd, Some(&id), &BTreeSet::new());
                }
            }
        }
        // How long we had lived, worked and belonged here when the world began (citizen.ts 1743-1749).
        if first_plan {
            if let Some(st) = self.p.started.clone() {
                if let Some(d) = st.get("place_days").and_then(Json::as_i64).filter(|&d| d > 0) {
                    self.s.inner.start_attached(Bond::Place, "town", d, t);
                }
                let trade = life.industry.clone().or_else(|| life.employer.clone()).or_else(|| life.own_work.clone());
                if let (Some(d), Some(tr)) = (st.get("trade_days").and_then(Json::as_i64).filter(|&d| d > 0), trade) {
                    self.s.inner.start_attached(Bond::Trade, &tr, d, t);
                }
                if let Some(d) = st.get("group_days").and_then(Json::as_i64).filter(|&d| d > 0) {
                    let me = self.me().to_string();
                    let mut gs: Vec<String> = book
                        .of_type("agreement")
                        .filter_map(|a| match &a.body {
                            RecordBody::Agreement { terms }
                                if terms.template.as_deref() == Some("membership")
                                    && terms.parties.iter().any(|p| p.as_str() == me)
                                    && book.in_force(&a.id)
                                    && terms.commitments.iter().any(|c| c.who.as_str() == me && c.does.pointer("/outcome/attend").is_some()) =>
                            {
                                terms.parties.iter().map(|p| p.as_str().to_string()).find(|p| *p != me)
                            }
                            _ => None,
                        })
                        .collect();
                    gs.sort();
                    if let Some(g) = gs.first() {
                        self.s.inner.start_attached(Bond::Group, g, d, t);
                    }
                }
            }
        }
        self.s.planned_once = true;
        let adult = self.adult(life);
        // Asked by a child of ours what matters to us: said as it is (citizen.ts 1992-1999).
        if !self.s.asked_what_matters.is_empty() {
            let mut ranked = Value::ALL.to_vec();
            let vals = self.s.mind.person.values;
            ranked.sort_by(|a, b| vals[b.index()].cmp(&vals[a.index()]).then(a.name().cmp(b.name())));
            let most: Vec<&str> = ranked[..3].iter().map(|v| v.name()).collect();
            let least: Vec<&str> = ranked[7..].iter().rev().map(|v| v.name()).collect();
            let mut to: Vec<String> = std::mem::take(&mut self.s.asked_what_matters);
            to.sort();
            to.dedup();
            out.steps.push(because("Asked by one of ours what matters to us: telling them.", vec![message(&to, &talk::upbringing_say(&most, &least), None)]));
            if let Some(cul) = &self.s.culture {
                let mut words: Vec<String> = cul.group().map(culture_words::from).into_iter().collect();
                words.extend(cul.household().iter().map(|x| culture_words::household(x.conduct, x.does, x.approves)));
                let said = words.into_iter().filter(|w| !w.is_empty()).collect::<Vec<_>>().join(" ");
                out.steps.push(because("Asked by one of ours how things are here: telling them as we see it.", vec![message(&to, &said, None)]));
            }
        }
        // Come of age without values the world gave us: we ask the parents we live with, once (citizen.ts 2003-2031).
        if !self.s.upbringing.settled && adult {
            let parents: Vec<String> = {
                let ps = pic.body.as_ref().map(|b| b.parents.clone()).unwrap_or_default();
                let mut v: Vec<String> = life.household_adults.iter().filter(|a| ps.contains(a)).cloned().collect();
                v.sort();
                v
            };
            match self.s.upbringing.asked_at {
                None if parents.is_empty() => self.s.upbringing.settled = true,
                None => {
                    self.s.upbringing.asked_at = Some(t);
                    out.steps.push(because("Come of age: asking our parents what matters to them.", vec![message(&parents, talk::UPBRINGING_ASK, None)]));
                }
                Some(at) if self.s.upbringing.told.len() >= parents.len() || t - at >= 14 * DAY => {
                    self.s.upbringing.settled = true;
                    if !self.s.upbringing.told.is_empty() {
                        let a = super::inner::UPBRINGING_SHARE_BPS as f64 / 10_000.0;
                        let n = self.s.upbringing.told.len() as f64;
                        for v in Value::ALL {
                            let dd = self.p.values.of(v);
                            let (mean, sd) = (dd.mean_bps, dd.sd_bps);
                            let lean = self.s.upbringing.told.iter().map(|(most, least)| if most.iter().any(|x| x == v.name()) { 1.0 } else if least.iter().any(|x| x == v.name()) { -1.0 } else { 0.0 }).sum::<f64>() / n;
                            let own = self.s.mind.person.values[v.index()];
                            let x = mean as f64 + a * lean * sd as f64 + (1.0 - (a * a * 0.6) / n).sqrt() * (own - mean) as f64;
                            self.s.mind.person.values[v.index()] = round(x).clamp(0, 10_000);
                        }
                        self.s.mind.reweigh();
                        self.s.inner.remember(super::inner::Remembered { t, what: "came_of_age".into(), about: None, size: 5_000, by: None });
                    }
                    if self.s.culture.is_some() && !self.s.upbringing.culture.is_empty() {
                        let groups: Vec<String> = self.s.upbringing.culture.iter().filter_map(|(_, g)| g.clone()).collect();
                        let pictures: Vec<_> = self.s.upbringing.culture.iter().map(|(p, _)| p.clone()).collect();
                        let has = self.s.culture.as_ref().and_then(|c| c.group().map(String::from));
                        let group = has.or_else(|| match groups.len() {
                            0 => None,
                            1 => Some(groups[0].clone()),
                            k => Some(groups[cx.rng("culture-parent-group").below(k as u64) as usize].clone()),
                        });
                        let env = self.env();
                        let cd = self.p.cdial.clone().unwrap();
                        let cul = self.s.culture.as_mut().unwrap();
                        let taken = cul.adopt_household(&env, &pictures, t);
                        if let Some(g) = group {
                            cul.set_group(&env, &cd, Some(&g), &taken);
                        }
                    }
                }
                _ => {}
            }
        }
        // Attachments grow; trust and agency drift back; values drift (citizen.ts 2034-2039).
        let housed = life.housed != Housed::None;
        self.s.inner.attach(Bond::Place, housed.then_some("town"), t);
        let trade = life.employer.as_ref().map(|e| life.industry.clone().unwrap_or_else(|| e.clone())).or_else(|| life.own_work.clone());
        self.s.inner.attach(Bond::Trade, trade.as_deref(), t);
        let group = {
            let mut went: Vec<&String> = self.s.went_last.iter().collect();
            went.sort();
            went.into_iter().filter_map(|id| book.get(id).filter(|r| statement(r).is_some()).map(|r| speaker(r).to_string())).next()
        }
        .or_else(|| self.s.inner.sections().attached.get("group").map(|a| a.to.clone()).filter(|g| self.member_of(book, g)));
        self.s.inner.attach(Bond::Group, group.as_deref(), t);
        self.s.inner.settle(t);
        let drifted = {
            let draws = &mut *cx;
            self.s.inner.drift(&mut self.s.mind.person.values, &mut |purpose: &str| draws.rng(purpose), t)
        };
        if drifted {
            self.s.mind.reweigh();
        }
        self.s.levels = self.need_levels(life, t);
        // What we think of those who hold power over us (citizen.ts 2044-2049).
        for who in [life.landlord.clone().filter(|_| !life.owned), life.employer.clone()].into_iter().flatten() {
            if Some(&who) == life.employer.as_ref() {
                self.s.employers.insert(who.clone());
            }
            let k = self.kind_of(&who);
            let tr = self.trust_in(&who, &k, t);
            let think = 2 * (tr - 5_000) - self.s.feelings.level(Emotion::Anger, &who, t);
            let fear = self.fear_of(&who, t).max(self.fear_of("money", t));
            self.s.inner.view(&self.s.mind.person.values, &who, think, super::inner::Pressure { dependence: 8_000, fear, trust: tr, norm: None });
        }
        if let Some(b) = self.p.bank.clone() {
            self.trust_in(&b, "banks", t);
        }
        if let Some(u) = self.p.union.clone().filter(|u| self.member_of(book, u)) {
            self.trust_in(&u, "unions", t);
        }
        if self.level(Need::Security) < 5_000 {
            self.s.feelings.feel(Emotion::Fear, "money", (5_000 - self.level(Need::Security)) * 2, t);
        }
        if !self.s.initiative {
            self.goals(cx, life, book, t);
        }
        if self.s.initiative {
            self.wants_of_the_week(cx, life, book, t, &mut out);
        }
        // Culture: a body founded in the run, its purpose read as it reaches us (citizen.ts 2527-2530).
        if self.s.town.is_some() {
            for r in &fresh {
                if let Some(("purpose", data, ..)) = statement(r) {
                    let by = r.speaks_for.clone();
                    if let Some(by) = by.filter(|b| b != self.me()) {
                        if r.at > 0 && data.get("for").and_then(Json::as_str) != Some(self.me()) && self.s.read_news.insert(r.id.clone()) {
                            let strength = townmemory::paper_strength(3, &self.s.culture.as_ref().unwrap().p);
                            self.remember_town("founded", &by, r.at, t, false, strength);
                        }
                    }
                }
            }
        }
        self.union_and_groups(cx, pic, book, life, &fresh, t, &mut out);
        self.gatherings(cx, pic, book, life, t, &mut out);
        self.civic(cx, pic, book, life, t, &mut out);
        // Wants whose time has come (citizen.ts 4020-4041).
        if self.s.initiative {
            let persistence = self.z_value(Value::Achievement) + self.z_value(Value::SelfDirection) + self.za();
            let mut acted = 0;
            for w in self.s.wants.due(t, self.patience()) {
                if acted >= 2 {
                    break;
                }
                if w.tried_at == Some(t) {
                    continue;
                }
                if w.tried > 0 {
                    if let Some(way) = w.way.clone() {
                        let payoff = if way == "wait" { 3_000 } else { 2_000 };
                        let mut o = Map::new();
                        o.insert("t".into(), json!(t));
                        o.insert("kind".into(), json!("not_yet"));
                        o.insert("way".into(), json!("mine"));
                        o.insert("facts".into(), json!({ "about": w.about, "tried": w.tried }));
                        self.learn_rec(cx, life, "way", &kind_of_way(&way), payoff, o, true, false);
                        if way != "wait" {
                            self.tried(false, 5000);
                        }
                        if self.s.wants.worn_out(&w, t, persistence) == Some(wants::Worn::GivenUp) {
                            if w.about == "security" {
                                self.happened("ruined", t, None, None);
                            }
                            self.tried(false, 10000);
                            self.s.withdrew = Some((w.about.clone(), t));
                            continue;
                        }
                    }
                }
                if let Some(c) = self.pursue(cx, pic, book, life, ways, &w) {
                    out.chosen.push(c);
                }
                acted += 1;
            }
            self.tell_wants(cx, pic, book, life, &mut out);
        }
        self.voice(cx, book, pic, life, t, &mut out);
        self.word_of_mouth(cx, pic, book, life, t, &mut out);
        self.s.last_planned_from = t + 1;
        // (Asked a model this wake: awake again by the next tick, to decide with the answer.)
        if !cx.questions.is_empty() {
            out.wake_at = Some(out.wake_at.map_or(t + self.p.tick, |w| w.min(t + self.p.tick)));
        }
        if let Some(w) = self.s.practice_wake {
            out.wake_at = Some(out.wake_at.map_or(w, |x| x.min(w)));
        }
        out
    }

    /// Goals (HTN, lite) for one who takes no initiative (citizen.ts 2057-2099).
    fn goals(&mut self, cx: &mut Cx, life: &Life, _book: &Book, t: i64) {
        let g = self.p.goals.clone();
        let z = |m: &CitizenMind, v: Value| m.z_value(v);
        let ways: [(&str, Need, i64, Vec<(&str, bool, f64)>); 2] = [
            (
                "make ends meet",
                Need::Security,
                g.security_bps,
                vec![
                    ("better work", !life.retired && life.in_labour_force, z(self, Value::Achievement) + z(self, Value::Stimulation)),
                    ("spend less", true, z(self, Value::Security) + z(self, Value::Conformity)),
                    ("cheaper home", matches!(life.housed, Housed::Own | Housed::Rents) && life.leaseholder, z(self, Value::Security) - z(self, Value::Tradition)),
                ],
            ),
            (
                "more company",
                Need::Social,
                g.social_bps,
                vec![("catch up more", !self.s.contacts.is_empty(), z(self, Value::Benevolence)), ("try a gathering", self.s.knows_practices, (z(self, Value::Stimulation) + z(self, Value::Benevolence)) / 2.0)],
            ),
        ];
        for (goal, need, below, methods) in ways {
            let level = self.level(need);
            let pur = self.s.pursuits.get(goal).cloned();
            if level >= below {
                self.s.unmet_since.remove(goal);
                if let Some(p) = &pur {
                    if let Some(m) = p.method() {
                        let mut o = goal_outcome(t, goal, m, "met", need, level, below, p.since);
                        self.outcome_rec(cx, life, None, std::mem::take(&mut o), true);
                    }
                    self.s.pursuits.remove(goal);
                }
                continue;
            }
            self.s.unmet_since.entry(goal.into()).or_insert(t);
            let record = |m: &mut CitizenMind, cx: &mut Cx, choice: Option<&str>, options: &[(&str, bool, f64)]| {
                let mut d = Map::new();
                d.insert("t".into(), json!(t));
                d.insert("domain".into(), json!("goal"));
                d.insert("strategy".into(), json!("deliberate"));
                if let Some(c) = choice {
                    d.insert("choice".into(), json!(format!("{goal}: {c}")));
                }
                d.insert("options".into(), Json::Array(options.iter().map(|(k, _, zz)| json!({ "key": format!("{goal}: {k}"), "score": round(zz * 1_000.0) })).collect()));
                m.decision(cx, d, &[]);
            };
            let since = self.s.unmet_since[goal];
            if pur.is_none() && t - since >= g.unmet_days * DAY && t >= *self.s.rest_until.get(goal).unwrap_or(&0) {
                let mut open: Vec<(&str, bool, f64)> = methods.iter().copied().filter(|(_, ok, _)| *ok).collect();
                open.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal).then(a.0.cmp(b.0)));
                if !open.is_empty() {
                    self.s.pursuits.insert(goal.into(), Pursuit::new(goal, open.iter().map(|(m, _, _)| m.to_string()).collect(), t));
                    record(self, cx, Some(open[0].0), &open);
                }
            } else if let Some(p) = pur.filter(|p| t - p.since >= g.method_days * DAY) {
                if let Some(m) = p.method() {
                    let o = goal_outcome(t, goal, m, "not_met", need, level, below, p.since);
                    self.outcome_rec(cx, life, None, o, true);
                }
                let mut p2 = p.clone();
                let next = p2.next(t).map(String::from);
                let considered: Vec<(&str, bool, f64)> = methods.iter().copied().filter(|(m, _, _)| p.methods.iter().any(|x| x == m)).collect();
                record(self, cx, next.as_deref(), &considered);
                if next.is_none() {
                    if goal == "make ends meet" {
                        self.happened("ruined", t, None, None);
                    }
                    self.s.pursuits.remove(goal);
                    self.s.rest_until.insert(goal.into(), t + g.rest_days * DAY);
                } else {
                    self.s.pursuits.insert(goal.into(), p2);
                }
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn goal_outcome(t: i64, goal: &str, method: &str, kind: &str, need: Need, level: i64, below: i64, since: i64) -> Map<String, Json> {
    let mut o = Map::new();
    o.insert("t".into(), json!(t));
    o.insert("domain".into(), json!("goal"));
    o.insert("option".into(), json!(format!("{goal}: {method}")));
    o.insert("kind".into(), json!(kind));
    o.insert("way".into(), json!("mine"));
    o.insert("need".into(), json!(need.name()));
    o.insert("facts".into(), json!({ "level": level, "wanted": below, "days": (t - since).div_euclid(DAY) }));
    o
}

/// The kind of way a key names (citizen.ts `kindOfWay`).
pub fn kind_of_way(key: &str) -> String {
    if key.starts_with("offer:") {
        key.to_string()
    } else {
        key.split(':').next().unwrap_or(key).to_string()
    }
}

// ------------------------------------------------------------------ wants and their ways

/// A way with what the mind made of it.
#[derive(Debug, Clone)]
pub struct Weighed {
    pub o: Opening,
    pub adj: i64,
    pub others: i64,
}

impl CitizenMind {
    fn wants_of_the_week(&mut self, cx: &mut Cx, life: &Life, book: &Book, t: i64, out: &mut Planned) {
        let wp = self.s.wants.p.clone();
        // What befell us, told to the household's other adults; what befell one of them, told to us (citizen.ts 2482-2486).
        // (Life sends the telling: `troubles_to_tell`. A household's trouble told to us arrives as an event.)
        let _ = out;
        let heard: Vec<(String, News2)> = self.news_now(t).map(|(k, n)| (k.clone(), News2::of(n))).collect();
        for n in Need::ALL {
            let level = self.level(n);
            let short = *wp.unmet_bps.get(n.name()).or_else(|| wp.unmet_bps.get("other")).unwrap_or(&3_000);
            let held = self.s.wants.all().iter().find(|w| w.about == n.name()).cloned();
            if level >= short {
                self.s.short_since.remove(n.name());
                if let Some(h) = &held {
                    let met_at = if h.from == wants::Origin::Other { self.s.mind.p.aspiration_bps } else { short + wp.met_margin_bps };
                    if level >= met_at {
                        self.want_met(cx, life, h, "need met", t);
                    }
                }
                let copied = heard.iter().filter(|(_, x)| x.after_about(n.name())).count() as i64;
                let need_copies = (wp.copy_from - if self.conformity() >= 6_000 { 1 } else { 0 }).max(1);
                if held.is_none() && level < self.s.mind.p.aspiration_bps && copied >= need_copies {
                    let weight = round((wp.need_bps as f64 * 0.3 * self.s.mind.person.weights[n.index()] as f64) / 15_000.0);
                    self.s.wants.born(Want::new(n.name(), wants::seeks_of_need(n).to_vec(), weight, t, wants::Origin::Other), t);
                }
                continue;
            }
            if !self.s.short_since.contains_key(n.name()) {
                let since = if t < 7 * DAY { t - cx.rng(&format!("short-before-{}", n.name())).below((wp.unmet_days + 1) as u64) as i64 * DAY } else { t };
                self.s.short_since.insert(n.name().into(), since);
            }
            if held.is_none() && t - self.s.short_since[n.name()] >= wp.unmet_days * DAY {
                let weight = round((wp.need_bps as f64 * (0.5 + 0.5 * (1.0 - level as f64 / short.max(1) as f64)) * self.s.mind.person.weights[n.index()] as f64) / 15_000.0);
                let mut w = Want::new(n.name(), wants::seeks_of_need(n).to_vec(), weight, t, wants::Origin::Need);
                if matches!(n, Need::Security | Need::Shelter) && life.household > 1 {
                    w.with = life.leaseholder_is.clone().or_else(|| life.leaseholder.then(|| self.me().to_string()));
                }
                self.s.wants.born(w, t);
            }
        }
        // Wants born of what happened: met when what they sought has come about (citizen.ts 2512-2522).
        for w in self.s.wants.all().to_vec() {
            if w.from == wants::Origin::Need || Need::from_name(&w.about).is_some() {
                continue;
            }
            let lease = life.lease.clone();
            let no_with = w.with.is_none();
            let against = w.against.clone();
            if w.about == "let_go" && no_with && (life.employer.is_some() || life.own_work.is_some() || life.retired) {
                self.want_met(cx, life, &w, "in work", t);
            } else if w.about == "unpaid" && w.whom.is_some() && w.tried > 0 && !self.owed_by(book, w.whom.as_deref().unwrap()) {
                self.want_met(cx, life, &w, "paid", t);
            } else if w.about == "rent_increase" && against.as_ref().map_or(false, |a| book.withdrawn(&a.record)) {
                self.want_met(cx, life, &w, "withdrawn", t);
            } else if w.about == "notice" && no_with && against.as_ref().map_or(false, |a| self.s.notice_over.contains(&a.record)) {
                self.want_met(cx, life, &w, "the notice lapsed, or we were let stay", t);
            } else if (w.about == "rent_increase" || w.about == "notice") && no_with && against.as_ref().map_or(false, |a| {
                let has_home = matches!(life.housed, Housed::Own | Housed::Rents);
                if !has_home {
                    w.about == "rent_increase"
                } else {
                    life.landlord.as_deref() != Some(a.by.as_str()) || (w.about == "notice" && lease.as_deref() != Some(a.record.as_str()))
                }
            }) {
                let why = if matches!(life.housed, Housed::Own | Housed::Rents) { "housed elsewhere, or let stay" } else { "left" };
                self.want_met(cx, life, &w, why, t);
            } else if w.about == "loss" && self.s.inner.dent(Need::Meaning, t) + self.s.inner.dent(Need::Belonging, t) < 2_000 {
                self.want_met(cx, life, &w, "time, and company", t);
            } else if w.about == "service" && !self.s.complained && self.s.feelings.level(Emotion::Anger, w.whom.as_deref().unwrap_or(""), t) < 1_000 {
                self.want_met(cx, life, &w, "seen to", t);
            } else if w.with.is_some() && t - w.since >= 180 * DAY {
                self.s.wants.give_up(&w, t, Some("time passed"));
            }
        }
    }

    /// A debt owed us by this party still unpaid (a claim of ours, as the book holds it).
    fn owed_by(&self, book: &Book, whom: &str) -> bool {
        book.claims_by(crate::common::book::ClaimKey::Holder, self.me()).any(|c| match &c.body {
            RecordBody::Claim { holder, counterparty, about, .. } => {
                holder.as_str() == self.me()
                    && counterparty.as_deref() == Some(whom)
                    && about.get("kind").and_then(Json::as_str) == Some("debt")
                    && jc(about.get("amount").unwrap_or(&Json::Null)) > *self.s.settled_to_us.get(&c.id).unwrap_or(&0)
            }
            _ => false,
        })
    }

    /// A want met: what was tried worked (or waiting did), and it is no longer held (citizen.ts `wantMet`).
    fn want_met(&mut self, cx: &mut Cx, life: &Life, w: &Want, why: &str, t: i64) {
        if let Some(way) = &w.way {
            let mut o = Map::new();
            o.insert("t".into(), json!(t));
            o.insert("kind".into(), json!("worked"));
            o.insert("way".into(), json!("mine"));
            o.insert("facts".into(), json!({ "about": w.about, "why": why }));
            self.learn_rec(cx, life, "way", &kind_of_way(way), if way == "wait" { 7_000 } else { 10_000 }, o, true, false);
            if way != "wait" {
                self.tried(true, 10000);
            }
        }
        self.s.wants.met(w, t, Some(why));
    }

    /// The ways open for a want: life's, and the mind's own, each weighed (citizen.ts `waysFor`).
    pub fn ways_for(&self, pic: &Picture, book: &Book, life: &Life, ways: &dyn Openings, w: &Want, t: i64) -> Vec<Weighed> {
        let k = &self.s.wants.p.choice;
        let view = view_of(w);
        let ag = round(k.agency as f64 * self.za());
        let trust_of = |who: &str| round(k.trust as f64 * self.s.inner.z_trust_peek(&self.s.mind.person.values, who, &self.kind_of(who)) as f64 / 100.0);
        let fear_of = |who: &str| round(k.fear as f64 * self.fear_of(who, t).max(round(self.fear_of("money", t) as f64 / 2.0)) as f64 / 10_000.0);
        let env = self.env();
        let nw = |c: &str| match (&self.s.culture, Conduct::from_name(c)) {
            (Some(cul), Some(c)) => cul.way(&env, c, t),
            _ => 0,
        };
        let news: Vec<News2> = self.news_now(t).map(|(_, n)| News2::of(n)).collect();
        let after = |kind: &str| news.iter().filter(|n| n.after.iter().any(|(_, way)| way == kind)).count() as i64;
        let goes = |host: &str| news.iter().filter(|n| n.goes_to.iter().any(|h| h == host)).count() as i64;
        let mut out: Vec<Weighed> = vec![];
        let life_ways = ways.for_want(&view, t);
        let weigh = |o: &Opening| -> i64 {
            let by = o.by.as_deref().unwrap_or("");
            match o.kind.as_str() {
                "offer:employment" => k.own + ag - if life.employer.is_some() { round(k.own as f64 * 2.0 * self.s.wants.p.sway.attachment * self.z_attached(Bond::Trade)) } else { 0 },
                "offer:lease" => k.own + ag - if life.housed == Housed::Rents { k.own } else { 0 },
                "ask" => trust_of(by) - fear_of(by) + ag,
                "desk" if o.venue => {
                    let cost = o.cost.unwrap_or(0);
                    trust_of(by) + ag - k.venue - round(k.own as f64 * (cost as f64 / (self.p.essentials as f64 / 10.0).max(1.0)).min(4.0))
                }
                "desk" => trust_of(by) + ag + o.conduct.as_deref().map_or(0, nw),
                "petition" => ag - o.bears.first().map_or(0, |b| fear_of(b)),
                "stand" => ag + round(k.own as f64 * (self.z_value(Value::Achievement) + self.z_value(Value::Power)) / 2.0) - 4 * k.own,
                "tell" => round(k.own as f64 * self.z_value(Value::Benevolence)) - k.own,
                _ => 0,
            }
        };
        let others_of = |o: &Opening| o.others.unwrap_or_else(|| if matches!(o.kind.as_str(), "stand" | "tell") { 0 } else { after(&o.kind) });
        // The boards first (life's offers), as TS listed them.
        for o in life_ways.iter().filter(|o| o.kind.starts_with("offer:")) {
            out.push(Weighed { adj: weigh(o), others: others_of(o), o: o.clone() });
        }
        // Gatherings open to us, by host (the three we hold to most).
        let mut hosts: BTreeMap<String, i64> = BTreeMap::new();
        for r in book.practices() {
            let Some((_, _, _, Some(pr), _)) = statement(r) else { continue };
            if !self.open_role(book, pr) {
                continue;
            }
            hosts.insert(speaker(r).to_string(), round((k.belief * self.hold_to(speaker(r))) as f64 / 10_000.0));
        }
        let mut hs: Vec<(String, i64)> = hosts.into_iter().collect();
        hs.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        for (host, belief) in hs.into_iter().take(3) {
            let o = Opening { key: format!("practice:{host}"), kind: "practice".into(), by: Some(host.clone()), brings: vec!["attend".into()], ..Default::default() };
            out.push(Weighed { adj: k.own + belief + ag, others: goes(&host), o });
        }
        // The union, which bears on our employer only as we believe it does.
        if let (Some(u), Some(emp)) = (self.p.union.clone(), life.employer.clone()) {
            if !self.member_of(book, &u) {
                let peers = news.iter().filter(|n| n.employer.as_deref() == Some(emp.as_str()) && n.member == Some(true)).count() as i64;
                if self.hold_to(&u) > 0 || peers > 0 || self.s.mind.learned_known("membership", "member") {
                    let o = Opening { key: format!("join:{u}"), kind: "join".into(), by: Some(u.clone()), bears: vec![emp], intent: Intent::JoinUnion, ..Default::default() };
                    out.push(Weighed { adj: round((k.belief * self.hold_to(&u)) as f64 / 10_000.0) + trust_of(&u) + ag + nw("join_union"), others: peers, o });
                }
            }
        }
        // Life's other ways: asking, desks, petitions, elections, a grievance's.
        for o in life_ways.iter().filter(|o| !o.kind.starts_with("offer:")) {
            let mut o = o.clone();
            if let Intent::TellWronged { grievance, .. } = &o.intent {
                let whom: Vec<String> = self.s.ties.closest(3, t).into_iter().map(|x| x.who).filter(|x| self.s.contacts.iter().any(|(c, _)| c == x)).collect();
                o.intent = Intent::TellWronged { grievance: grievance.clone(), whom };
            }
            out.push(Weighed { adj: weigh(&o), others: others_of(&o), o });
        }
        // Petitions and elections are the mind's own (voice, civic).
        if self.s.willing && life.housed == Housed::Rents {
            for pet in self.petitions_seen(pic) {
                let id = pet.id.clone();
                if speaker(&pet) == self.me() || self.s.signed.contains(&id) || !tenant_petition(&pet) {
                    continue;
                }
                let lord = life.landlord.clone().unwrap_or_default();
                let o = Opening { key: format!("petition:{id}"), kind: "petition".into(), on: Some(id.clone()), bears: vec![lord.clone()], intent: Intent::Sign { petition: id }, ..Default::default() };
                out.push(Weighed { adj: ag - fear_of(&lord), others: published_count(book, &pet), o });
            }
        }
        if let Some(town) = self.p.electoral_town.clone() {
            for n in book.open("election_notice") {
                let closes = statement(n).and_then(|(_, d, ..)| d.get("nominations_close_at").and_then(Json::as_i64)).unwrap_or(0);
                if self.s.stood_for.contains(&n.id) || t >= closes {
                    continue;
                }
                let mut bears = vec![town.clone()];
                bears.extend(self.p.complain_to.clone());
                let o = Opening { key: format!("stand:{}", n.id), kind: "stand".into(), on: Some(n.id.clone()), bears, intent: Intent::Stand { notice: n.id.clone() }, ..Default::default() };
                out.push(Weighed { adj: ag + round(k.own as f64 * (self.z_value(Value::Achievement) + self.z_value(Value::Power)) / 2.0) - 4 * k.own, others: 0, o });
            }
        }
        // Something made in a run that offers membership (docs/behaviour/founding.md).
        if self.p.founding.is_some() && life.account.is_some() {
            let g = ways.grievance(&view);
            for s in book.open("membership") {
                let host = speaker(s).to_string();
                let Some((_, _, Some(o), _, _)) = statement(s) else { continue };
                if o.get("take_up").and_then(Json::as_str) != Some("join") || host == self.me() || Some(&host) == self.p.union.as_ref() || self.member_of(book, &host) || self.s.applied_to.contains(&host) {
                    continue;
                }
                if !self.eligible(book, o.get("to")) {
                    continue;
                }
                let asks = asks_of(o);
                if asks > life.savings {
                    continue;
                }
                let gathers = book.practices().any(|r| speaker(r) == host);
                let takes_up = g.as_ref().map_or(false, |g| book.hearings().any(|h| speaker(h) == host && hears(h, &g.matter)));
                let mut brings: Vec<String> = wants::brings_of(o, None).into_iter().filter(|x| *x != SeekKey::MoneyFrom).map(|x| x.name().to_string()).collect();
                if gathers && !brings.iter().any(|b| b == "attend") {
                    brings.push("attend".into());
                }
                let worth = self.fund_worth(s);
                let adj = k.own + round((k.belief * self.hold_to(&host)) as f64 / 10_000.0) + trust_of(&host) + ag
                    - round(k.own as f64 * (asks as f64 / (self.p.essentials as f64 / 10.0).max(1.0)).min(4.0))
                    + worth.map_or(0, |w| round(k.own as f64 * 2.0 * (w as f64 / 10_000.0 - 0.5)));
                let o = Opening {
                    key: format!("join:{host}"),
                    kind: "join".into(),
                    on: Some(s.id.clone()),
                    by: Some(host.clone()),
                    brings,
                    bears: if takes_up { vec![g.as_ref().unwrap().party.clone()] } else { vec![] },
                    cost: (asks > 0).then_some(asks),
                    intent: Intent::JoinGroup { host: host.clone(), offer: s.id.clone() },
                    ..Default::default()
                };
                out.push(Weighed { adj, others: goes(&host), o });
            }
        }
        // Our own conduct (spending less), and those we know.
        out.push(Weighed {
            adj: k.own + round(k.own as f64 * (self.z_value(Value::Security) + self.z_value(Value::Conformity)) / 2.0),
            others: after("self"),
            o: Opening { key: "self".into(), kind: "self".into(), brings: vec!["money.from".into()], ..Default::default() },
        });
        if !self.s.contacts.is_empty() {
            out.push(Weighed { adj: k.own + round(k.own as f64 * self.z_value(Value::Benevolence)), others: 0, o: Opening { key: "ties".into(), kind: "ties".into(), brings: vec!["attend".into()], ..Default::default() } });
        }
        out.retain(|x| wants::meets(w, &as_wants_opening(&x.o)));
        out
    }

    /// Whether a practice has a role open to us.
    fn open_role(&self, book: &Book, pr: &Json) -> bool {
        match pr.get("roles").and_then(Json::as_array) {
            None => true,
            Some(roles) => roles.iter().any(|x| x.get("open").and_then(Json::as_bool) == Some(true) && x.get("who").and_then(|w| w.get("members_of")).and_then(Json::as_str).map_or(true, |m| self.member_of(book, m))),
        }
    }

    /// Going after a want now: the way the mind takes, or none (citizen.ts `pursue`).
    pub fn pursue(&mut self, cx: &mut Cx, pic: &Picture, book: &Book, life: &Life, ways: &dyn Openings, w: &Want) -> Option<Chosen> {
        let t = cx.t;
        let k = self.s.wants.p.choice.clone();
        let found = self.ways_for(pic, book, life, ways, w, t);
        // (Trust read in weighing them is kept from now, as TS's reads kept it.)
        for by in found.iter().filter_map(|o| o.o.by.clone()).collect::<Vec<_>>() {
            let k = self.kind_of(&by);
            self.trust_in(&by, &k, t);
        }
        let mut best: BTreeMap<String, Weighed> = BTreeMap::new();
        for o in &found {
            match best.get(&o.o.kind) {
                Some(b) if o.adj <= b.adj => {}
                _ => {
                    best.insert(o.o.kind.clone(), o.clone());
                }
            }
        }
        let conf = self.conformity();
        let bump = *self.s.recourse_bump.get(&w.about).unwrap_or(&0);
        let mut options: Vec<(String, i64)> = best
            .values()
            .map(|o| {
                let v = o.adj + round((k.others * o.others.min(5) * (10_000 + conf)) as f64 / 10_000.0) + if o.o.kind == "ask" || o.o.kind == "desk" { bump } else { 0 };
                (o.o.kind.clone(), v)
            })
            .collect();
        options.push(("wait".into(), -k.own - round(k.agency as f64 * self.za())));
        options.sort_by(|a, b| a.0.cmp(&b.0));
        let purpose = format!("want-{}-{}", w.about, w.against.as_ref().map(|a| a.record.clone()).or_else(|| w.whom.clone()).unwrap_or_default());
        let mut rng = cx.rng(&purpose);
        let open = self.s.mind.person.temperament.openness;
        let (key, weights) = self.s.mind.learned("way").choose(&mut rng, &options, open);
        let total: i64 = weights.iter().sum::<i64>().max(1);
        let mut d = Map::new();
        d.insert("t".into(), json!(t));
        d.insert("domain".into(), json!("want"));
        d.insert("strategy".into(), json!("deliberate"));
        d.insert("choice".into(), json!(key));
        d.insert(
            "options".into(),
            Json::Array(
                options
                    .iter()
                    .map(|(kk, v)| {
                        let mut o = json!({ "key": kk, "score": self.s.mind.learned_get("way", kk) + v });
                        if self.s.mind.learned_known("way", kk) {
                            o["learned"] = json!(self.s.mind.learned_get("way", kk));
                        }
                        o
                    })
                    .collect(),
            ),
        );
        let odds: Vec<Json> = options.iter().zip(&weights).map(|((kk, _), wt)| json!({ "key": kk, "ppm": round((*wt as f64 * 1_000_000.0) / total as f64) })).collect();
        d.insert("situation".into(), self.situation(life, ways, w, &found, odds, t, Json::Null));
        self.decision(cx, d, &[]);
        let Some(way) = best.get(&key).cloned() else {
            self.s.wants.tried(w, "wait", t, None);
            if found.is_empty() {
                self.occasion(cx, pic, book, life, ways, w, "withdrew");
            }
            if found.is_empty() || self.za() < -1.0 {
                self.s.withdrew = Some((w.about.clone(), t));
                self.s.inner.note(super::inner::Remembered { t, what: "want_withdrew".into(), about: Some(w.about.clone()), size: w.weight, by: None });
                let mut facts = json!({ "weight": w.weight, "ways_seen": found.len() });
                if let Some(wh) = &w.whom {
                    facts["whom"] = json!(wh);
                }
                self.out(cx, life, t, "want", &w.about, "withdrew", "mine", facts);
            }
            return None;
        };
        // The mind's own acts; the rest go to life.
        match &way.o.intent {
            Intent::JoinGroup { host, .. } => {
                self.s.join_group.insert(host.clone());
            }
            Intent::JoinUnion => self.s.join_now = true,
            Intent::Sign { petition } => {
                self.s.sign_now.insert(petition.clone());
            }
            Intent::Stand { notice } => {
                self.s.stand_now.insert(notice.clone());
            }
            _ => {}
        }
        self.s.wants.tried(w, &way.o.key, t, way.o.on.as_deref());
        let mind_own = matches!(way.o.intent, Intent::JoinGroup { .. } | Intent::JoinUnion | Intent::Sign { .. } | Intent::Stand { .. } | Intent::Wait);
        (!mind_own).then(|| Chosen { want: w.about.clone(), opening: way.o.clone(), why: format!("{} by {}", w.about, way.o.kind) })
    }

    /// What has become of our wants since we last said (citizen.ts `tellWants`).
    fn tell_wants(&mut self, cx: &mut Cx, pic: &Picture, book: &Book, life: &Life, out: &mut Planned) {
        for e in self.s.wants.take() {
            let w = &e.want;
            if e.kind == WantEventKind::GivenUp {
                self.occasion(cx, pic, book, life, &crate::citizen::mind::NoOpenings, w, "given_up");
            }
            if e.kind == WantEventKind::GivenUp
                && life.employer.is_none()
                && life.own_work.is_none()
                && !life.retired
                && life.in_labour_force
                && self.s.discouraged_until == 0
                && (w.about == "let_go" || w.about == "unpaid" || (w.seeks.contains(&SeekKey::Work) && w.from != wants::Origin::Other))
            {
                let until = e.t + self.s.wants.p.rest_days * DAY;
                self.s.discouraged_until = until;
                out.intents.push(Intent::StopLooking { until });
                self.out(cx, life, e.t, "job", "search", "gave_up", "mine", json!({ "about": w.about, "days": (e.t - w.since).div_euclid(DAY) }));
            }
            let mut note = super::inner::Remembered { t: e.t, what: format!("want_{}", event_name(e.kind)), about: Some(w.about.clone()), size: w.weight, by: None };
            if e.kind == WantEventKind::Pursued {
                note.by = Some(kind_of_way(e.way.as_deref().unwrap_or("wait")));
            }
            self.s.inner.note(note);
            let mut facts = json!({ "weight": w.weight, "from": w.from.name(), "tried": w.tried });
            if let Some(way) = &e.way {
                facts["by"] = json!(kind_of_way(way));
            }
            if let Some(x) = &w.whom {
                facts["whom"] = json!(x);
            }
            if let Some(x) = &w.with {
                facts["with"] = json!(x);
            }
            if let Some(x) = &e.why {
                facts["why"] = json!(x);
            }
            facts["days"] = json!((e.t - w.since).div_euclid(DAY));
            self.out(cx, life, e.t, "want", &w.about, event_name(e.kind), "mine", facts);
        }
    }

    /// The situation a decision about a want was made in, for the record (citizen.ts `situationOf`): recording only.
    #[allow(clippy::too_many_arguments)]
    pub fn situation(&self, life: &Life, ways: &dyn Openings, w: &Want, found: &[Weighed], odds: Vec<Json>, t: i64, more: Json) -> Json {
        let g = ways.grievance(&view_of(w));
        let role = |who: &str| -> String {
            if life.landlord.as_deref() == Some(who) && !life.owned {
                "landlord".into()
            } else if life.employer.as_deref() == Some(who) {
                "employer".into()
            } else if w.whom.as_deref() == Some(who) || w.against.as_ref().map_or(false, |a| a.by == who) {
                "other_side".into()
            } else {
                self.kind_of(who)
            }
        };
        let mut want = json!({ "about": w.about, "from": w.from.name(), "weight": w.weight, "days": (t - w.since).div_euclid(DAY), "tried": w.tried, "grown": w.grown, "seeks": w.seeks.iter().map(|s| s.name()).collect::<Vec<_>>() });
        if w.with.is_some() {
            want["household"] = json!(true);
        }
        if let Some(x) = &w.whom {
            want["whom"] = json!(role(x));
        }
        if let Some(a) = &w.against {
            want["against"] = json!(a.kind);
        }
        if let Some(x) = &w.way {
            want["last_way"] = json!(kind_of_way(x));
        }
        let mut s = json!({ "v": 1, "want": want });
        if let Some(g) = &g {
            let mut m = json!({ "matter": g.matter, "days": (t - g.since).div_euclid(DAY), "venues": g.venues });
            if let Some(a) = g.asked_at {
                m["asked_days"] = json!((t - a).div_euclid(DAY));
                m["answer"] = json!(g.answer.clone().unwrap_or_else(|| "none yet".into()));
            }
            if let Some(a) = g.amount {
                m["amount"] = json!(a);
            }
            if g.told {
                m["told"] = json!(true);
            }
            s["matter"] = m;
        }
        if let Some(rent) = life.rent {
            let mut h = json!({ "rent": rent });
            if life.owned {
                h["owned"] = json!(true);
            }
            s["home"] = h;
        }
        s["means"] = json!({ "income": life.monthly_income, "savings": life.savings, "essentials": self.p.essentials });
        s["openings"] = Json::Array(
            found
                .iter()
                .map(|o| {
                    let mut x = json!({ "kind": o.o.kind, "brings": o.o.brings, "others": o.others, "adj": o.adj });
                    if let Some(by) = &o.o.by {
                        x["by"] = json!(role(by));
                        if let Some(tr) = self.s.inner.trusted(by) {
                            let town = self.p.outlook.trust.as_ref().and_then(|m| m.get(&self.kind_of(by))).copied().unwrap_or(self.s.inner.p.trust.start_bps);
                            x["trust"] = json!({ "bps": tr, "town_bps": town });
                        }
                        let f = self.s.feelings.level(Emotion::Fear, by, t);
                        if f > 0 {
                            x["fear"] = json!(f);
                        }
                        let b = self.hold_to(by);
                        if b > 0 {
                            x["belief"] = json!(b);
                        }
                    }
                    if o.o.undoes.is_some() {
                        x["undoes"] = json!(true);
                    }
                    if !o.o.bears.is_empty() {
                        x["bears"] = json!(true);
                    }
                    if let Some(c) = o.o.cost.filter(|&c| c != 0) {
                        x["cost"] = json!(c);
                    }
                    if self.s.mind.learned_known("way", &o.o.kind) {
                        x["learned"] = json!(self.s.mind.learned_get("way", &o.o.kind));
                    }
                    x
                })
                .collect(),
        );
        s["record"] = Json::Object(self.s.written.iter().filter(|(k, _)| k.as_str() != "hours").map(|(k, v)| (k.clone(), v.clone())).collect());
        let agency = self.p.outlook_json.get("agency").cloned().unwrap_or_else(|| json!({ "mean_bps": self.s.inner.p.agency.mean_bps, "sd_bps": self.s.inner.p.agency.sd_bps }));
        let mut outlook = json!({ "agency": agency });
        if let Some(pl) = self.p.attach_mean_place {
            outlook["place_bps"] = json!(pl);
        }
        s["outlook"] = outlook;
        s["code"] = json!({ "odds": odds });
        if let Json::Object(m) = more {
            for (k, v) in m {
                s[k] = v;
            }
        }
        s
    }

    // -------------------------------------------------------------- founding (citizen.ts `occasion`)

    #[allow(clippy::too_many_arguments)]
    pub fn occasion(&mut self, cx: &mut Cx, _pic: &Picture, book: &Book, life: &Life, ways: &dyn Openings, w: &Want, how: &str) {
        let t = cx.t;
        let Some(f) = self.p.founding.clone() else { return };
        if f.shapes.is_empty() || self.s.begun.is_some() || self.s.my_group.is_some() || life.leaving || t < self.s.found_rest || life.account.is_none() || !self.adult(life) {
            return;
        }
        let mates: BTreeSet<String> = life.household_adults.iter().cloned().collect();
        let mut sharers: BTreeMap<String, String> = BTreeMap::new();
        if w.with.is_some() || matches!(w.about.as_str(), "let_go" | "notice" | "rent_increase") {
            for who in &mates {
                sharers.insert(who.clone(), "of our household, holding it with us".into());
            }
        }
        for (who, (n, at)) in &self.s.told_us {
            if t - at > self.p.news_days * DAY || who == self.me() {
                continue;
            }
            if n.after.iter().any(|(a, _)| *a == w.about) {
                sharers.insert(who.clone(), "told us they are after the same".into());
            } else if n.gave_up.as_deref() == Some(w.about.as_str()) {
                sharers.insert(who.clone(), "told us they have stopped trying for the same".into());
            } else if w.about == "let_go" && n.let_go_by.is_some() {
                sharers.insert(who.clone(), format!("told us {} let them go", n.let_go_by.as_deref().unwrap()));
            } else if w.about == "notice" && n.noticed_by.is_some() {
                sharers.insert(who.clone(), format!("told us {} gave them notice", n.noticed_by.as_deref().unwrap()));
            }
        }
        for (who, (by, matter, at)) in &self.s.heard_wronged {
            if t - at <= self.p.news_days * DAY && (*matter == w.about || w.whom.as_deref() == Some(by.as_str())) {
                sharers.insert(who.clone(), format!("told us {by} did wrong by them ({})", matter.replace('_', " ")));
            }
        }
        if w.about == "loss" {
            if let Some(whom) = &w.whom {
                for who in self.s.mourners.get(whom).cloned().unwrap_or_default() {
                    if who != self.me() {
                        sharers.insert(who, format!("mourns {whom} too"));
                    }
                }
            }
        }
        if w.about == "disrepair" {
            for who in &life.neighbours {
                if who != self.me() && !sharers.contains_key(who) {
                    sharers.insert(who.clone(), "lives in the same building, which is in the same disrepair".into());
                }
            }
        }
        if (sharers.len() as i64) < f.shared_min || !sharers.keys().any(|who| !mates.contains(who)) {
            return;
        }
        let has_place = life.dwelling.is_some();
        let able: BTreeMap<founding::Shape, bool> = [(founding::Shape::Gathering, has_place), (founding::Shape::Fund, has_place), (founding::Shape::Cause, has_place), (founding::Shape::Business, self.p.can_found_business && !life.retired && life.in_labour_force)].into_iter().collect();
        let zs: BTreeMap<&str, f64> = Value::ALL.iter().map(|v| (v.name(), self.z_value(*v))).collect();
        let zv = |v: &str| zs.get(v).copied().unwrap_or(0.0);
        if !founding::shape_odds(&f, &w.about, w.whom.is_some(), &zv, &able).iter().any(|o| o.score > 0) {
            return;
        }
        self.s.found_rest = t + f.rest_days * DAY;
        let beyond = sharers.keys().filter(|who| !mates.contains(*who)).count();
        // Something we can see already answers it and would take us: we do not start another.
        let mut answers: Vec<String> = book
            .open("membership")
            .filter(|s| {
                let host = speaker(s);
                let Some((_, _, Some(o), _, _)) = statement(s) else { return false };
                if o.get("take_up").and_then(Json::as_str) != Some("join") || host == self.me() || Some(host) == self.p.union.as_deref() || self.s.refused_by.contains(host) {
                    return false;
                }
                if !self.member_of(book, host) && (!self.eligible(book, o.get("to")) || asks_of(o) > life.savings) {
                    return false;
                }
                if self.s.inner.z_trust_peek(&self.s.mind.person.values, host, &self.kind_of(host)) <= -100 {
                    return false;
                }
                if self.fund_worth(s).map_or(false, |x| x < FUND_WORTH_MIN_BPS) {
                    return false;
                }
                let takes_up = w.whom.is_some() && book.hearings().any(|h| speaker(h) == host && hears(h, &w.about));
                let brings: Vec<String> = wants::brings_of(o, None).into_iter().filter(|x| *x != SeekKey::MoneyFrom).map(|x| x.name().to_string()).collect();
                let op = Opening { key: format!("join:{host}"), kind: "join".into(), brings, bears: if takes_up { vec![w.whom.clone().unwrap()] } else { vec![] }, ..Default::default() };
                wants::meets(w, &as_wants_opening(&op))
            })
            .map(|s| speaker(s).to_string())
            .collect();
        answers.sort();
        let occasion = |answered: Option<(&str, usize)>| {
            let mut o = json!({ "how": how, "sharers": sharers.len(), "beyond_household": beyond });
            if let Some((a, n)) = answered {
                o["answered_by"] = json!(a);
                o["answering"] = json!(n);
            }
            json!({ "occasion": o })
        };
        let record = |m: &mut CitizenMind, cx: &mut Cx, choice: &str, found_score: i64, more: Json| {
            let mut d = Map::new();
            d.insert("t".into(), json!(t));
            d.insert("domain".into(), json!("found"));
            d.insert("strategy".into(), json!("deliberate"));
            d.insert("choice".into(), json!(choice));
            d.insert("options".into(), json!([{ "key": "found", "score": found_score, "others": sharers.len() }, { "key": "not", "score": 10_000 - found_score }]));
            d.insert("situation".into(), m.situation(life, ways, w, &[], vec![json!({ "key": "found", "weight": found_score }), json!({ "key": "not", "weight": 10_000 - found_score })], t, more));
            m.decision(cx, d, &[]);
        };
        if !answers.is_empty() {
            record(self, cx, "not", 0, occasion(Some((&answers[0], answers.len()))));
            return;
        }
        let chance = founding::chance_of(
            &f,
            &founding::Z {
                enterprise: (self.z_value(Value::Stimulation) + self.z_value(Value::SelfDirection) + self.z_value(Value::Achievement)) / 3.0,
                care: (self.z_value(Value::Benevolence) + self.z_value(Value::Universalism)) / 2.0,
                agency: self.za(),
                standing: self.z_attached(Bond::Place),
                ties: (self.s.ties.closest(5, t).len() as f64 - 2.5) / 1.5,
            },
        );
        let founds = (cx.rng(&format!("found-group-{}", w.about)).below(10_000) as i64) < chance;
        record(self, cx, if founds { "found" } else { "not" }, chance, occasion(None));
        if !founds {
            return;
        }
        let odds = founding::shape_odds(&f, &w.about, w.whom.is_some(), &zv, &able);
        let shape = founding::draw_of(&mut cx.rng(&format!("found-shape-{}", w.about)), &odds);
        let mut d = Map::new();
        d.insert("t".into(), json!(t));
        d.insert("domain".into(), json!("found_shape"));
        d.insert("strategy".into(), json!("deliberate"));
        if let Some(s) = &shape {
            d.insert("choice".into(), json!(s.name()));
        }
        d.insert("options".into(), Json::Array(odds.iter().map(|o| json!({ "key": o.key.name(), "score": o.score })).collect()));
        self.decision(cx, d, &[]);
        let Some(shape) = shape else { return };
        if shape == founding::Shape::Business {
            self.out(cx, life, t, "found", "business", "meant", "mine", json!({ "about": w.about, "sharers": sharers.len() }));
            cx_intent(&mut self.s.pending_intents, Intent::FoundBusiness { until: t + 180 * DAY });
            return;
        }
        let record_now: Json = Json::Object(self.s.written.iter().filter(|(k, _)| k.as_str() != "hours").map(|(k, v)| (k.clone(), v.clone())).collect());
        let g = ways.grievance(&view_of(w));
        let list: Vec<(String, String)> = sharers.into_iter().collect();
        let wo = founding::WantOf { about: w.about.clone(), whom: w.whom.clone() };
        let dues_open: Vec<i64> = if shape == founding::Shape::Fund && f.dues.iter().any(|&c| c > 0) { f.dues.iter().copied().filter(|&c| c > 0).collect() } else { f.dues.clone() };
        let world = &cx.ctx.world;
        let mut want = json!({ "about": w.about, "days": (t - w.since).div_euclid(DAY), "tried": w.tried, "weight": w.weight, "how": how });
        if let Some(x) = &w.whom {
            want["whom"] = json!(x);
        }
        if w.with.is_some() {
            want["befell"] = json!("household");
        }
        if let Some(x) = &w.way {
            want["way"] = json!(kind_of_way(x));
        }
        if let Some(g) = &g {
            if g.asked_at.is_some() {
                want["asked"] = json!(g.answer.clone().unwrap_or_else(|| "no answer".into()));
            }
            if g.venues > 0 {
                want["venues"] = json!(g.venues);
            }
            if let Some(a) = g.amount {
                want["amount"] = json!(common::money_words(a, world));
            }
        }
        let brief = json!({
            "idea": format!("idea.{}.{}", self.me(), t),
            "founder": self.me(),
            "record": record_now,
            "want": want,
            "sharers": list.iter().map(|(who, how)| json!({ "who": who, "how": how })).collect::<Vec<_>>(),
            "shape": shape.name(),
            "open": { "dues": dues_open.iter().map(|&c| Due { cents: c, words: if c > 0 { format!("{} a month", common::money_words(c, world)) } else { "nothing".into() } }).collect::<Vec<_>>(),
                "every_days": f.every_days, "starts_in_days": f.starts_in_days, "lasts_minutes": f.lasts_minutes, "place": "their own home" },
            "means": { "income": common::money_words(life.monthly_income, world), "savings": common::money_words(life.savings, world) },
            "dark": founding::dark_of(&w.about, &record_now, self.za()),
            "code": { "purpose": founding::plain_purpose(shape, &wo, list.len() as i64 + 1), "name": founding::plain_name(shape, self.me(), &wo) },
        });
        let piece = if self.p.compose {
            cx.ask(crate::Question { kind: "compose".into(), about: format!("idea.{}.{}", self.me(), t), body: brief.clone() });
            None
        } else {
            Some(Json::Null)
        };
        self.s.begun = Some(Begun { want: w.clone(), shape: shape.name().into(), sharers: list, brief, dues: dues_open, piece, sent: false, name_by: None, naming: false });
    }
}

fn cx_intent(v: &mut Vec<Intent>, i: Intent) {
    v.push(i);
}

fn event_name(k: WantEventKind) -> &'static str {
    match k {
        WantEventKind::Born => "born",
        WantEventKind::Pursued => "pursued",
        WantEventKind::Met => "met",
        WantEventKind::GivenUp => "given_up",
        WantEventKind::Grown => "grown",
        WantEventKind::Displaced => "displaced",
    }
}

/// Whether a hearing offer hears a matter.
fn hears(h: &Record, matter: &str) -> bool {
    statement(h).and_then(|(_, _, o, ..)| o).and_then(|o| o.get("hears")).and_then(Json::as_array).map_or(false, |hs| hs.iter().any(|x| x.get("about").and_then(Json::as_str) == Some(matter)))
}

/// A tenants' petition (its demand tagged `tenant_protection`).
fn tenant_petition(r: &Record) -> bool {
    statement(r).map_or(false, |(_, d, ..)| d.pointer("/demand/tags").and_then(Json::as_array).map_or(false, |tags| tags.iter().any(|x| x.as_str() == Some("tenant_protection"))))
}

pub fn as_wants_opening(o: &Opening) -> wants::Opening {
    wants::Opening {
        key: o.key.clone(),
        kind: o.kind.clone(),
        id: o.on.clone(),
        by: o.by.clone(),
        brings: o.brings.iter().filter_map(|b| wants::SEEK_KEYS.iter().copied().find(|k| k.name() == b)).collect(),
        undoes: o.undoes.as_ref().map(|r| wants::Undoes { record: Some(r.clone()), kinds: None }),
        bears: (!o.bears.is_empty()).then(|| o.bears.clone()),
    }
}

/// News as the plan reads it.
pub struct News2 {
    pub after: Vec<(String, String)>,
    pub goes_to: Vec<String>,
    pub employer: Option<String>,
    pub member: Option<bool>,
}
impl News2 {
    pub fn of(n: &talk::News) -> News2 {
        News2 { after: n.after.clone(), goes_to: n.goes_to.clone(), employer: n.employer.clone(), member: n.member }
    }
    fn after_about(&self, about: &str) -> bool {
        self.after.iter().any(|(a, _)| a == about)
    }
}

// ------------------------------------------------------------------ the union, groups made in the run, gatherings

impl CitizenMind {
    #[allow(clippy::too_many_arguments)]
    fn union_and_groups(&mut self, cx: &mut Cx, pic: &Picture, book: &Book, life: &Life, fresh: &[std::sync::Arc<Record>], t: i64, out: &mut Planned) {
        let _ = pic;
        let me = self.me().to_string();
        let account = life.account.clone();
        // Joining on starting a job, with the chance for its kind of employer (citizen.ts 2631-2662).
        if let (Some(u), Some(job), Some(emp)) = (self.p.union.clone(), life.job.clone(), life.employer.clone()) {
            let member = self.member_of(book, &u);
            let said = if self.s.join_asked != job && !life.retired && !member {
                let (about, thing, options) = talk::consult_join(&u);
                self.consult(cx, &about, thing, &options, life)
            } else {
                Ok(None)
            };
            if self.s.join_asked != job && !life.retired && said.is_ok() {
                self.s.join_asked = job.clone();
                let said = said.unwrap_or(None);
                let industry = life.industry.clone().unwrap_or_else(|| "other".into());
                let learned_member = if self.s.mind.learned_known("membership", "member") { (self.s.mind.learned_get("membership", "member") - 5_000) as f64 / 10_000.0 } else { 0.0 };
                let rate = *self.p.union_join_bps.get(&industry).or_else(|| self.p.union_join_bps.get("other")).unwrap_or(&0);
                let peers: Vec<bool> = self.news_now(t).filter_map(|(_, n)| (n.employer.as_deref() == Some(emp.as_str())).then_some(n.member).flatten()).collect();
                let peer_share = (!peers.is_empty()).then(|| (peers.iter().filter(|m| **m).count() as f64 * 10_000.0) / peers.len() as f64);
                let conform = peer_share.map_or(0.0, |ps| (self.p.sway.union_peers * self.conformity() as f64 * (ps - rate as f64)) / 10_000.0 / (rate.max(1) as f64));
                let creed = (self.p.sway.union_belief * self.hold_to(&u) as f64) / 10_000.0;
                let meant = said.as_ref().map_or(0.0, |s| (self.p.sway.consult * (*s.get("join").unwrap_or(&0) - *s.get("not").unwrap_or(&0)) as f64) / 10_000.0);
                let env = self.env();
                let lean = self.s.culture.as_ref().map_or(0.0, |c| (c.p.sway_milli as f64 / 1_000.0) * c.lean(&env, Conduct::JoinUnion, t));
                let chance = Self::shifted(rate, self.p.sway.union_join * (self.z_value(Value::Benevolence) + self.z_value(Value::Universalism)) / 2.0 + learned_member + conform + creed + meant + lean);
                let joins = !member && (cx.rng(&format!("join-{job}")).below(10_000) as i64) < chance;
                if !member {
                    if let Some(c) = &mut self.s.culture {
                        c.act(Conduct::JoinUnion, joins, t);
                    }
                    let mut d = Map::new();
                    d.insert("t".into(), json!(t));
                    d.insert("domain".into(), json!("membership"));
                    d.insert("strategy".into(), json!("deliberate"));
                    d.insert("choice".into(), json!(if joins { "join" } else { "not" }));
                    d.insert("options".into(), json!([{ "key": "join", "score": chance }, { "key": "not", "score": 10_000 - chance }]));
                    if let Some(c) = &self.s.culture {
                        d.insert("norm".into(), serde_json::to_value(c.norm(&self.env(), Conduct::JoinUnion, t)).unwrap_or(Json::Null));
                    }
                    self.decision(cx, d, if joins { &["member"] } else { &[] });
                }
                if joins {
                    let words = match &said {
                        Some(s) => format!(", thinking what it would mean to me: {} of 10 against {} not to", round(*s.get("join").unwrap_or(&0) as f64 / 1_000.0), round(*s.get("not").unwrap_or(&0) as f64 / 1_000.0)),
                        None => String::new(),
                    };
                    out.steps.push(because(
                        format!("A new job: joining the union ({}% of those working in {} do; for me, {}%{words}).", pct(rate), industry.replace('_', " "), pct(chance)),
                        vec![steps::say("membership_application", "Application to join.", Say { to: Some(vec![u.clone()]), visible: Some(Visible::Only(vec![me.clone(), u.clone()])), data: Some(json!({ "account": account, "employer": emp, "industry": industry })), ..Default::default() })],
                    ));
                }
            }
            if self.s.join_now && !member {
                self.s.join_asked = job.clone();
                out.steps.push(because(
                    "Joining the union: there is something at work we want put right.",
                    vec![steps::say("membership_application", "Application to join.", Say { to: Some(vec![u.clone()]), visible: Some(Visible::Only(vec![me.clone(), u.clone()])), data: Some(json!({ "account": account, "employer": emp, "industry": life.industry.clone().unwrap_or_else(|| "other".into()) })), ..Default::default() })],
                ));
            }
        }
        self.s.join_now = false;
        // Founding and what was founded (citizen.ts 2669-2736).
        if let (Some(f), Some(acc)) = (self.p.founding.clone(), account.clone()) {
            self.found_now(cx, book, life, &f, t, out);
            if let Some((org, _, _)) = self.s.my_group.clone() {
                if !self.member_of(book, &org) && !self.s.applied_to.contains(&org) && book.open("membership").any(|r| r.speaks_for.as_deref() == Some(org.as_str())) {
                    self.s.join_group.insert(org);
                }
            }
            for host in std::mem::take(&mut self.s.join_group) {
                self.s.applied_to.insert(host.clone());
                out.steps.push(because(format!("Asking to join {host}."), vec![steps::say("membership_application", "Application to join.", Say { to: Some(vec![host.clone()]), visible: Some(Visible::Only(vec![me.clone(), host.clone()])), data: Some(json!({ "account": acc })), ..Default::default() })]));
            }
            for r in fresh {
                if let Some(("wound_up", ..)) = statement(r) {
                    if let Some(h) = r.speaks_for.clone().filter(|h| self.s.groups.contains_key(h)) {
                        self.leave_group(cx, book, life, &h, "It has wound up.", "wound_up", t, out);
                    }
                }
            }
            let hosts: Vec<String> = self.s.groups.keys().cloned().collect();
            for host in hosts {
                let Some(m) = self.s.groups.get(&host).cloned() else { continue };
                if self.s.my_group.as_ref().map(|g| &g.0) != Some(&host) && t - m.went.max(m.t) >= f.leave_after_days * DAY {
                    self.leave_group(cx, book, life, &host, "We no longer come.", "left", t, out);
                    continue;
                }
                let standing = book.open("membership").find(|r| r.speaks_for.as_deref() == Some(host.as_str()));
                let draw = standing.and_then(|s| statement(s)).and_then(|(_, _, o, ..)| o).and_then(|o| o.pointer("/terms/commitments")).and_then(Json::as_array).and_then(|cs| {
                    cs.iter().filter(|c| c.get("who").and_then(Json::as_str) == Some(host.as_str())).filter_map(|c| c.pointer("/does/outcome/money")).find(|m| m.get("amount").map_or(false, common::truthy)).cloned()
                });
                let stated = standing.and_then(|s| statement(s)).and_then(|(_, d, ..)| d.get("fund").cloned());
                let qualifies = stated.as_ref().map_or(true, |st| t - m.t >= st.get("qualify_days").and_then(Json::as_i64).unwrap_or(0) * DAY && m.drew.map_or(true, |d| t - d >= st.get("every_days").and_then(Json::as_i64).unwrap_or(0) * DAY));
                let short = *self.s.wants.p.unmet_bps.get("security").unwrap_or(&3_000);
                if let Some(draw) = draw {
                    if qualifies && self.level(Need::Security) < short && m.claimed.map_or(true, |c| t - c >= 30 * DAY) {
                        let amount = jc(draw.get("amount").unwrap_or(&Json::Null));
                        self.s.groups.get_mut(&host).unwrap().claimed = Some(t);
                        out.steps.push(because(
                            format!("Short of money, and a member of {host}: asking to draw on its fund."),
                            vec![steps::say("fund_claim", &format!("Request: a draw on the fund, {}.", common::money_words(amount, &cx.ctx.world)), Say { to: Some(vec![host.clone()]), visible: Some(Visible::Only(vec![me.clone(), host.clone()])), data: Some(json!({ "amount": amount, "account": acc })), ..Default::default() })],
                        ));
                        self.out(cx, life, t, "membership", "member", "draw_asked", "mine", json!({ "with": host, "amount": amount }));
                    }
                }
            }
        }
        // A fund's answer to our asking (citizen.ts 2739-2752).
        for r in fresh {
            let Some(("fund_decision", data, _, _, to)) = statement(r) else { continue };
            let Some(host) = r.speaks_for.clone() else { continue };
            if !to.iter().any(|x| *x == me) {
                continue;
            }
            let granted = data.get("granted") == Some(&Json::Bool(true));
            let why = data.get("why").and_then(Json::as_str).unwrap_or_default().to_string();
            let stated = book.open("membership").find(|x| x.speaks_for.as_deref() == Some(host.as_str())).and_then(|s| statement(s)).and_then(|(_, d, ..)| d.get("fund").cloned());
            let m = self.s.groups.get(&host).cloned();
            let foretold = stated.as_ref().map_or(false, |st| {
                why == "the fund has not got it" || m.as_ref().map_or(false, |m| (why == "not yet a member long enough" && t - m.t < st.get("qualify_days").and_then(Json::as_i64).unwrap_or(0) * DAY) || why == "drew not long ago")
            });
            if granted {
                if let Some(g) = self.s.groups.get_mut(&host) {
                    g.drew = Some(t);
                }
            } else if !foretold {
                self.s.refused_by.insert(host.clone());
            }
            self.read_follows = true; // (the draw's outcome, below, names the paper)
            self.treated(cx, Treated { who: host.clone(), kind: String::new(), good: granted, weight_bps: Some(if granted || !foretold { 20_000 } else { 10_000 }), paper: Some(r.id.clone()), ..Default::default() });
            let facts = if granted { json!({ "with": host, "amount": jc(data.get("amount").unwrap_or(&Json::Null)) }) } else { json!({ "with": host, "why": why, "foretold": foretold }) };
            let mut o = Map::new();
            o.insert("t".into(), json!(t));
            o.insert("domain".into(), json!("membership"));
            o.insert("option".into(), json!("member"));
            o.insert("kind".into(), json!(if granted { "draw_paid" } else { "draw_refused" }));
            o.insert("way".into(), json!("mine"));
            o.insert("from".into(), json!(host));
            o.insert("facts".into(), facts);
            o.insert("paper".into(), json!(r.id));
            self.outcome_rec(cx, life, None, o, true);
        }
        // Membership offered to us: signed (citizen.ts 2753-2772); ballots (2773-2795).
        for r in fresh {
            if let RecordBody::Agreement { terms } = &r.body {
                if terms.template.as_deref() == Some("membership") && terms.parties.iter().any(|p| p.as_str() == me) && !book.signed_by(&r.id, &me) && !book.taken_back(&r.id) {
                    let host = terms.parties.iter().map(|p| p.as_str().to_string()).find(|p| *p != me).unwrap_or_default();
                    let of_run = self.p.founding.is_some() && Some(&host) != self.p.union.as_ref();
                    let dues = terms.commitments.iter().find(|c| c.who.as_str() == me && c.does.pointer("/outcome/money").is_some()).and_then(|c| c.does.pointer("/outcome/money")).cloned();
                    let dues_c = dues.as_ref().map(|d| jc(d.get("amount").unwrap_or(&Json::Null)));
                    let mut facts = json!({ "with": host });
                    if let Some(d) = dues_c {
                        facts["dues"] = json!(d);
                    }
                    self.out(cx, life, t, "membership", "member", "joined", "mine", facts);
                    let pay_dues = |cx: &Cx, why: &str| -> Vec<oikos_sight::calls::Call> {
                        match (&dues, &account) {
                            (Some(d), Some(acc)) => vec![steps::pay(d.get("to").and_then(Json::as_str).unwrap_or_default(), jc(d.get("amount").unwrap_or(&Json::Null)), Pay { from: Some(acc.clone()), every: Some(MONTH), first: Some(0), basis: Some(r.id.clone()), for_: Some(why.into()), ..Default::default() }, cx)],
                            _ => vec![],
                        }
                    };
                    if of_run {
                        self.s.groups.insert(host.clone(), Group { t, agreement: r.id.clone(), went: t, claimed: None, drew: None });
                        let ids: Vec<String> = book.practices().filter(|g| speaker(g) == host).map(|g| g.id.clone()).collect();
                        for id in ids {
                            self.s.stayed_last.remove(&id);
                            self.s.went_last.insert(id);
                        }
                        let belief = self.strengthened(&host, self.p.belief.told_bps);
                        if belief["after"] != belief["before"] {
                            let mut o = Map::new();
                            for (k, v) in [("t", json!(t)), ("domain", json!("belief")), ("option", json!(host)), ("kind", json!("joined")), ("way", json!("mine")), ("from", json!(host)), ("belief", belief)] {
                                o.insert(k.into(), v);
                            }
                            self.outcome_rec(cx, life, None, o, false);
                        }
                        let mut calls = vec![sign(&r.id)];
                        calls.extend(pay_dues(cx, "Dues."));
                        out.steps.push(because(format!("Joining {host}: signing{}.", if dues.is_some() { ", and paying the dues monthly" } else { "" }), calls));
                        continue;
                    }
                    let mut calls = vec![sign(&r.id)];
                    calls.extend(pay_dues(cx, "Union dues."));
                    out.steps.push(because("Joining the union: signing, and paying the dues monthly.", calls));
                }
                continue;
            }
            let Some((kind, data, _, _, to)) = statement(r) else { continue };
            if !to.iter().any(|x| *x == me) {
                continue;
            }
            if kind == "ballot_result" && data.get("employer").and_then(Json::as_str).is_some() && data.get("voted").and_then(Json::as_i64).unwrap_or(0) > 0 && !self.s.counted_ballots.contains(&r.id) {
                if let (Some(yes), Some(voted)) = (data.get("yes").and_then(Json::as_i64), data.get("voted").and_then(Json::as_i64)) {
                    if let Some(c) = &mut self.s.culture {
                        self.s.counted_ballots.insert(r.id.clone());
                        let share = round((yes * 10_000) as f64 / voted as f64);
                        c.see_share(Conduct::Strike, share, Route::Published);
                        c.hear_said(Conduct::Strike, share, Route::Published);
                    }
                }
            }
            let solidarity = (self.z_value(Value::Benevolence) + self.z_value(Value::Universalism)) / 2.0;
            if kind == "action_ballot" && data.get("employer").and_then(Json::as_str) == life.employer.as_deref() && life.employer.is_some() {
                if (cx.rng(&format!("turnout-{}", r.id)).below(10_000) as i64) < Self::shifted(self.p.ballot_turnout_bps, self.p.sway.turnout * solidarity) {
                    let env = self.env();
                    let lean = self.s.culture.as_ref().map_or(0.0, |c| (c.p.sway_milli as f64 / 1_000.0) * c.lean(&env, Conduct::Strike, t));
                    let yes_chance = Self::shifted(self.p.strike_vote_yes_bps, self.p.sway.strike_vote * (solidarity - self.z_value(Value::Security)) + lean);
                    let yes = (cx.rng(&format!("vote-{}", r.id)).below(10_000) as i64) < yes_chance;
                    if let Some(c) = &mut self.s.culture {
                        c.act(Conduct::Strike, yes, t);
                    }
                    if let Some(c) = &self.s.culture {
                        let mut d = Map::new();
                        for (k, v) in [("t", json!(t)), ("domain", json!("strike")), ("strategy", json!("deliberate")), ("choice", json!(if yes { "yes" } else { "no" })), ("options", json!([{ "key": "yes", "score": yes_chance }, { "key": "no", "score": 10_000 - yes_chance }])), ("norm", serde_json::to_value(c.norm(&self.env(), Conduct::Strike, t)).unwrap_or(Json::Null))] {
                            d.insert(k.into(), v);
                        }
                        self.decision(cx, d, &[]);
                    }
                    out.steps.push(because(format!("The union's protected action ballot: voting {}.", if yes { "yes" } else { "no" }), vec![common::vote(&r.id, if yes { "yes" } else { "no" }, None)]));
                }
            }
        }
    }

    /// Leaving a group made in the run (citizen.ts `leave`).
    #[allow(clippy::too_many_arguments)]
    fn leave_group(&mut self, cx: &mut Cx, book: &Book, life: &Life, host: &str, why: &str, kind: &str, t: i64, out: &mut Planned) {
        let Some(m) = self.s.groups.remove(host) else { return };
        let mut lines = vec![];
        for o in book.all("request") {
            if common::cites(o, &m.agreement) && o.speaks_for.as_deref() == Some(self.me()) && !book.withdrawn(&o.id) {
                lines.push(common::withdraw(&o.id, Some(why)));
            }
        }
        if book.in_force(&m.agreement) {
            lines.push(notice(&m.agreement, why));
        }
        if !lines.is_empty() {
            out.steps.push(because(format!("{why} Leaving {host}."), lines));
        }
        self.out(cx, life, t, "membership", "member", kind, "mine", json!({ "with": host, "days": (t - m.t).div_euclid(DAY) }));
    }

    /// What we have begun, once its words are in hand: the organisation, with us in its first post (citizen.ts
    /// 2674-2699). A composed name goes to the translator as a seat's words would (`words`), and the founding waits
    /// for its answer; decided fresh: the act is then the same call with the name the translator made, since a code
    /// actor's steps are calls.
    fn found_now(&mut self, cx: &mut Cx, book: &Book, life: &Life, f: &founding::FoundingParams, t: i64, out: &mut Planned) {
        let _ = book;
        let me = self.me().to_string();
        let Some(place) = life.dwelling.clone() else { return };
        let Some(tpl) = f.template.clone() else { return };
        let Some(b) = self.s.begun.as_mut() else { return };
        if b.sent || b.naming || b.piece.is_none() {
            return;
        }
        let piece = b.piece.clone().filter(|p| !p.is_null() && p.get("declined") != Some(&Json::Bool(true)));
        if let (Some(name), None) = (piece.as_ref().and_then(|p| p.get("name")).and_then(Json::as_str).map(|n| n.split_whitespace().collect::<Vec<_>>().join(" ").replace('"', "'")), b.name_by.as_ref()) {
            if !name.is_empty() {
                let name: String = name.chars().take(100).collect();
                b.naming = true;
                cx.ask(crate::Question {
                    kind: "words".into(),
                    about: b.brief["idea"].as_str().unwrap_or_default().to_string(),
                    body: json!({ "what": "name", "text": format!("Found a {} called \"{name}\", with me in its first post as {}.", tpl.kind, tpl.title), "kind": tpl.kind, "title": tpl.title }),
                });
                return;
            }
        }
        b.sent = true;
        let room = (life.household as i64 + 4 - life.household as i64).max(1);
        let fill = |x: &Json| fill_founder(x, &me);
        let mut params = fill(&tpl.role_module.get("params").cloned().unwrap_or(json!({})));
        let name = b.brief["code"]["name"].as_str().unwrap_or_default().to_string();
        let mut want = json!({ "about": b.want.about, "since": b.want.since, "weight": b.want.weight });
        if let Some(w) = &b.want.whom {
            want["whom"] = json!(w);
        }
        let extra = json!({
            "founder": me, "shape": b.shape, "idea": b.brief["idea"], "name": name, "purpose": b.brief["code"]["purpose"], "want": want,
            "place": place, "place_room": room, "bank": f.bank, "founded_at": t,
            "dues": b.dues, "every_days": f.every_days, "starts_in_days": f.starts_in_days, "lasts_minutes": f.lasts_minutes, "at_seconds": f.at_seconds,
            "lapse_days": f.lapse_days, "min_members": f.min_members, "hall": f.hall, "fund": f.fund, "cause": f.cause,
        });
        if let (Json::Object(p), Json::Object(e)) = (&mut params, extra) {
            for (k, v) in e {
                p.insert(k, v);
            }
            if let Some(pc) = &piece {
                p.insert("composed".into(), json!({ "purpose": pc.get("purpose"), "asks": pc.get("asks"), "gathers": pc.get("gathers"), "choice": pc.get("choice"), "model": pc.get("model") }));
            }
            if tpl.role_module.pointer("/params/values").is_some() {
                let pp = &self.s.mind.person;
                p.insert("owner_values".into(), Json::Object(Value::ALL.iter().map(|v| (v.name().to_string(), json!(pp.values[v.index()]))).collect()));
            }
        }
        let mut module = fill(&tpl.role_module);
        module["params"] = params;
        let channels = fill(&Json::Array(tpl.channels.clone()));
        let why = format!("{} others we know are in the same case ({}), and nothing answers it: starting something of our own ({}).", b.sharers.len(), b.want.about.replace('_', " "), b.shape);
        // (Bound as `founded`, as citizen.ts wrote it: the world names what it made by that ref in the act's outcome, which
        // is how the founder learns its id. Unbound, no founder ever learned it and nothing founded was ever recorded.)
        let made = call("entity", vec![("kind", Some(steps::arg(&tpl.kind))), ("name", Some(text(name.clone()))), ("position", Some(text(tpl.title.clone()))), ("channels", Some(jarg(channels))), ("role_module", Some(jarg(module)))]);
        let mut st = because(why, vec![]);
        st.lines.push(oikos_sight::calls::Line { bind: Some("founded".into()), call: made });
        out.steps.push(st);
        self.s.pending_group = true;
    }

    /// Taking part in gatherings (citizen.ts 3389-3488).
    fn gatherings(&mut self, cx: &mut Cx, pic: &Picture, book: &Book, life: &Life, t: i64, out: &mut Planned) {
        let me = self.me().to_string();
        let street = street_spaces(pic);
        let inside = |space: &str| street.is_none() || street.as_ref().unwrap().iter().any(|sp| sp.space == space && sp.occupants.as_ref().map_or(false, |o| o.contains(&me)));
        let there = |space: &str| -> Vec<String> { street.as_ref().map_or(vec![], |s| s.iter().find(|sp| sp.space == space).and_then(|sp| sp.occupants.clone()).unwrap_or_default().into_iter().filter(|o| *o != me).collect()) };
        if let Some(a) = self.s.attending.clone().filter(|a| t >= a.until) {
            let others = a.seen.clone().unwrap_or_else(|| there(&a.space));
            let got = a.gone || inside(&a.space);
            let meaning = round(self.hold_to(&a.host) as f64 * self.p.belief.meaning);
            let payoff = if got { (round((others.len() as f64).ln_1p_det() * 2_500.0) + meaning).min(10_000) } else { 0 };
            let (before, first) = self.was("practice", &a.practice);
            self.s.mind.learn("practice", &a.practice, payoff, &BTreeMap::new());
            let after = self.now("practice", &a.practice);
            let belief = got.then(|| self.strengthened(&a.host, round((self.p.belief.display_bps * others.len().min(20) as i64) as f64 / 20.0)));
            let mut facts = json!({ "host": a.host });
            if got {
                facts["others"] = json!(others.len());
            }
            if meaning != 0 {
                facts["meaning"] = json!(meaning);
            }
            let mut learned = json!({ "payoff": payoff, "before": before, "after": after });
            if first {
                learned["first"] = json!(true);
            }
            let mut o = Map::new();
            for (k, v) in [("t", json!(t)), ("domain", json!("practice")), ("option", json!(a.practice)), ("kind", json!(if got { "attended" } else { "turned_away" })), ("way", json!("here")), ("facts", facts), ("learned", learned)] {
                o.insert(k.into(), v);
            }
            if let Some(b) = belief.filter(|b| b["after"] != b["before"]) {
                o.insert("belief".into(), b);
            }
            self.outcome_rec(cx, life, None, o, true);
            if got {
                if !a.gone {
                    out.first.insert(0, because(format!("{}'s gathering is over ({} others were there): going home.", a.host, others.len()), vec![common::move_out(&a.space, &me)]));
                }
                self.s.company_at.insert(a.practice.clone(), others.len() as i64);
                if let Some(g) = self.s.groups.get_mut(&a.host) {
                    g.went = t;
                }
                for o in &others {
                    self.s.talked.insert(o.clone(), t);
                    self.s.ties.add(o, 100, t, Some("met"));
                    self.s.people_known.insert(o.clone());
                }
            }
            self.s.attending = None;
        }
        // Belief fades, a month at a time.
        let mut faded = self.s.faded_at.unwrap_or(t);
        while t - faded >= MONTH {
            faded += MONTH;
            for b in self.s.beliefs.values_mut() {
                *b -= round((*b * self.p.belief.fade_bps) as f64 / 10_000.0);
            }
        }
        self.s.faded_at = Some(faded);
        self.s.practice_wake = None;
        self.s.knows_practices = book.practices().next().is_some();
        let age_years = pic.body.as_ref().map_or(0.0, |b| (t - b.born_at) as f64 / self.p.year as f64);
        let friends_of: BTreeMap<String, i64> = {
            let mut m = BTreeMap::new();
            for (_, n) in self.news_now(t) {
                for h in &n.goes_to {
                    *m.entry(h.clone()).or_insert(0) += 1;
                }
            }
            m
        };
        let practices: Vec<std::sync::Arc<Record>> = book.practices().cloned().collect();
        for r in practices {
            let Some((_, _, _, Some(pr), _)) = statement(&r) else { continue };
            let may = match pr.get("roles").and_then(Json::as_array) {
                None => true,
                Some(roles) => roles.iter().any(|x| x.get("open").and_then(Json::as_bool) == Some(true) && self.may_come(book, x.get("who"), age_years)),
            };
            if !may {
                continue;
            }
            let first = pr.get("first").and_then(Json::as_i64).unwrap_or(r.at);
            let lasts = pr.get("lasts").and_then(Json::as_i64).unwrap_or(3_600);
            let every = pr.get("every").and_then(Json::as_i64).unwrap_or(7 * DAY).max(1);
            let at = pr.get("at").and_then(Json::as_str).unwrap_or_default().to_string();
            let host = speaker(&r).to_string();
            let mut start = first + ((t - first).max(0) / every) * every;
            if t >= start + lasts {
                start += every;
            }
            if t >= start {
                if self.s.going.get(&r.id) == Some(&start) && self.s.attending.is_none() {
                    self.s.going.remove(&r.id);
                    self.s.attending = Some(Attending { practice: r.id.clone(), host: host.clone(), space: at.clone(), until: start + lasts, gone: false, seen: None });
                    if !inside(&at) {
                        out.first.insert(0, because(format!("Going to {host}'s gathering."), vec![common::move_in(&at)]));
                    }
                }
            } else if start - t <= 7 * DAY && self.s.decided_for.get(&r.id) != Some(&start) {
                if !self.s.decided_for.contains_key(&r.id) {
                    if !self.s.mind.learned_known("practice", "stay") {
                        let mut o = Map::new();
                        for (k, v) in [("t", json!(t)), ("kind", json!("expected")), ("way", json!("mine"))] {
                            o.insert(k.into(), v);
                        }
                        self.learn_rec(cx, life, "practice", "stay", 5_000, o, false, false);
                    }
                    let ours = book.of_type("agreement").any(|a| match &a.body {
                        RecordBody::Agreement { terms } => terms.parties.iter().any(|p| p.as_str() == me) && book.in_force(&a.id) && terms.commitments.iter().any(|c| c.who.as_str() == me && c.does.pointer("/outcome/attend/practice").and_then(Json::as_str) == Some(r.id.as_str())),
                        _ => false,
                    });
                    if ours {
                        self.s.went_last.insert(r.id.clone());
                        if !self.s.mind.learned_known("practice", &r.id) {
                            let mut o = Map::new();
                            for (k, v) in [("t", json!(t)), ("kind", json!("expected")), ("way", json!("mine")), ("facts", json!({ "host": host, "member": true }))] {
                                o.insert(k.into(), v);
                            }
                            let pay = (7_000 + round(self.hold_to(&host) as f64 * self.p.belief.meaning)).min(10_000);
                            self.learn_rec(cx, life, "practice", &r.id, pay, o, false, false);
                        }
                    } else {
                        self.s.stayed_last.insert(r.id.clone());
                    }
                }
                self.s.decided_for.insert(r.id.clone(), start);
                let friends = *friends_of.get(&host).unwrap_or(&0);
                let meaning = round(self.hold_to(&host) as f64 * self.p.belief.meaning);
                let trying = self.pursuing("try a gathering") && !self.s.went_last.contains(&r.id);
                let d = Decide {
                    domain: "practice".into(),
                    options: vec![
                        Choice {
                            key: r.id.clone(),
                            facts: Some(Facts { money_per_month: 0, company: Some((*self.s.company_at.get(&r.id).unwrap_or(&0)).max(friends)), time_hours_per_month: Some(round(((lasts as f64 / 3_600.0) * MONTH as f64) / every as f64)), ..Default::default() }),
                            others: Some(friends),
                            meaning: Some(meaning),
                        },
                        Choice { key: "stay".into(), facts: Some(Facts { money_per_month: 0, ..Default::default() }), ..Default::default() },
                    ],
                    current: if self.s.went_last.contains(&r.id) { Some(r.id.clone()) } else if self.s.stayed_last.contains(&r.id) { Some("stay".into()) } else { None },
                    satisfied_here: trying.then_some(0),
                    doubt: trying.then_some(10_000),
                    purpose: Some(format!("practice-{}-{start}", r.id)),
                    ..Default::default()
                };
                let levels = self.need_levels(life, t);
                let got = self.decide_rec(cx, life, &d, levels);
                if got.key.as_deref() == Some(r.id.as_str()) {
                    self.s.going.insert(r.id.clone(), start);
                    self.s.went_last.insert(r.id.clone());
                    self.s.stayed_last.remove(&r.id);
                } else {
                    self.s.went_last.remove(&r.id);
                    self.s.stayed_last.insert(r.id.clone());
                    let mut o = Map::new();
                    for (k, v) in [("t", json!(t)), ("kind", json!("stayed")), ("way", json!("mine")), ("need", json!("social"))] {
                        o.insert(k.into(), v);
                    }
                    let social = self.level(Need::Social);
                    self.learn_rec(cx, life, "practice", "stay", social, o, true, false);
                }
            }
            if let Some(&next) = self.s.going.get(&r.id) {
                if next > t {
                    self.s.practice_wake = Some(self.s.practice_wake.map_or(next, |w| w.min(next)));
                }
            }
        }
        if let Some(a) = &self.s.attending {
            self.s.practice_wake = Some(self.s.practice_wake.map_or(a.until, |w| w.min(a.until)));
        }
    }

    fn may_come(&self, book: &Book, who: Option<&Json>, age_years: f64) -> bool {
        let Some(w) = who else { return true };
        w.get("members_of").and_then(Json::as_str).map_or(true, |m| self.member_of(book, m))
            && w.get("holds").is_none()
            && w.get("entities").and_then(Json::as_array).map_or(true, |es| es.iter().any(|e| e.as_str() == Some(self.me())))
            && w.get("min_age_years").and_then(Json::as_f64).map_or(true, |a| age_years >= a)
            && w.get("dealing_with").and_then(Json::as_str).map_or(true, |d| self.party_with(book, d, None))
    }

    /// What the petitions board showed at the last look (a search's answer: citizen.ts `found.petitions`).
    pub fn petitions_seen(&self, pic: &Picture) -> Vec<std::sync::Arc<Record>> {
        match pic.channels.get("petitions") {
            Some(Seen::Records { records, search: true }) => records.clone(),
            _ => self.s.petitions_found.clone(),
        }
    }
}

trait Log1p {
    fn ln_1p_det(self) -> f64;
}
impl Log1p for f64 {
    /// ln(1 + x), deterministic (`math::ln`).
    fn ln_1p_det(self) -> f64 {
        super::math::ln(1.0 + self)
    }
}

fn pct(bps: i64) -> String {
    let x = bps as f64 / 100.0;
    if x.fract() == 0.0 {
        format!("{}", x as i64)
    } else {
        let s = format!("{x}");
        s
    }
}

/// The spaces of the street channel's structures, where the picture has one.
pub fn street_spaces(pic: &Picture) -> Option<Vec<oikos_sight::SiteSpace>> {
    match pic.channels.get("street") {
        Some(Seen::Sites { cells, .. }) => Some(cells.iter().filter_map(|c| c.structure.as_ref()).flat_map(|s| s.spaces.iter().cloned()).collect()),
        _ => None,
    }
}

/// An amount as a paper writes it in JSON (whole cents, or digits).
pub fn jc(v: &Json) -> i64 {
    crate::papers::lenient::whole(v).unwrap_or(0)
}

/// A tenants' petition, for the voice.
pub fn tenant_petition_pub(r: &Record) -> bool {
    tenant_petition(r)
}

/// A founding template with `{founder}` filled in, in every string (citizen.ts `fill`).
pub fn fill_founder(x: &Json, me: &str) -> Json {
    match x {
        Json::String(s) => Json::String(s.replace("{founder}", me)),
        Json::Array(a) => Json::Array(a.iter().map(|y| fill_founder(y, me)).collect()),
        Json::Object(m) => Json::Object(m.iter().map(|(k, y)| (k.clone(), fill_founder(y, me))).collect()),
        _ => x.clone(),
    }
}

/// A due as a founding's brief states it (ComposeBrief `open.dues[]`: the amount in the world's smallest unit and in
/// words).
#[derive(serde::Serialize)]
struct Due {
    cents: i64,
    words: String,
}
