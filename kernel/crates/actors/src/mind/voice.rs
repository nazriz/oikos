//! What happens to the person that is not an outcome (`Mind::event`: citizen.ts's inbox talk, deaths, notices,
//! grievances), civic life (citizen.ts `civic`), petitions (`voice`), word of mouth (`wordOfMouth`, `newsOfMine`) and
//! the person's own record (`writeRecord`).

use super::citizen::{CitizenMind, MONTH};
use super::culture::{culture_words, Route};
use super::inner;
use super::math::round;
use super::person::{Emotion, Need, Value};
use super::talk::{self, catching_up};
use super::townmemory::{self, EventKind, Taken};
use crate::citizen::mind::*;
use crate::common::{self, letters::message, petition_signatures, published_count, Book};
use crate::steps::{self, because, Say, Visible};
use crate::{Cx, DAY};
use oikos_sight::{Picture, RecordBody, Seen};
use serde_json::{json, Map, Value as Json};

fn route(close: bool) -> Route {
    if close {
        Route::CloseTie
    } else {
        Route::Tie
    }
}

impl CitizenMind {
    // -------------------------------------------------------------- events

    pub fn on_event(&mut self, cx: &mut Cx, pic: &Picture, book: &Book, life: &Life, e: Event, ways: &dyn Openings) -> Heard {
        let t = cx.t;
        match e {
            Event::Bereaved { who, adults } => {
                self.happened("bereaved", t, Some(&who), None);
                self.want_born(t, "loss", &["attend"], 1.0, Need::Meaning, Some(&who), None, None, "event");
                self.s.ties.drop(&who);
                self.s.contacts.retain(|(c, _)| *c != who);
                let close: Vec<String> = self.s.ties.closest(5, t).into_iter().map(|x| x.who).filter(|w| !adults.contains(w) && *w != who && w != self.me()).collect();
                if self.p.founding.is_some() {
                    let m = self.s.mourners.entry(who).or_default();
                    m.extend(close.iter().cloned());
                    m.extend(adults.iter().cloned());
                }
                Heard::Mourn(close)
            }
            Event::Conceived => {
                self.happened("child", t, None, None);
                Heard::Taken
            }
            Event::LeftHome { by, how } => {
                self.happened(if how == "left_on_order" { "left_on_order" } else { "evicted" }, t, Some(&by), None);
                Heard::Taken
            }
            Event::NoticeSeen { by, lease } => {
                if self.s.notice_seen.insert(lease.clone()) {
                    self.exp(&by, false, t, 20_000, false, None);
                    self.s.ties.add(&by, -3_000, t, Some("notice"));
                    self.s.feelings.feel(Emotion::Fear, &by, 5_000, t);
                    self.s.noticed_by = Some((by.clone(), t));
                    self.s.notice_over.remove(&lease);
                    if self.s.initiative {
                        self.want_born(t, "notice", &["occupancy"], 1.0, Need::Shelter, Some(&by), Some((&lease, "notice", &by)), None, "event");
                        self.s.trouble_to_tell.push(("notice".into(), by));
                    }
                }
                Heard::Taken
            }
            Event::OrderedOut { by } => {
                self.happened("ordered_out", t, Some(&by), None);
                Heard::Taken
            }
            Event::PutOut { by } => {
                self.happened("put_out", t, Some(&by), None);
                self.exp(&by, false, t, 20_000, false, None);
                if let Some(m) = &mut self.s.town {
                    m.saw(EventKind::PutOut, &by, t, t);
                }
                Heard::Taken
            }
            Event::RentRise { landlord, notice, rent, was, share_bps } => {
                if !self.s.initiative || rent <= was {
                    return Heard::Taken;
                }
                let with = (life.household > 1).then(|| life.leaseholder_is.clone().unwrap_or_else(|| self.me().to_string()));
                let size = (0.3 + share_bps as f64 / 1_000.0).min(1.5);
                let born = self.want_born(t, "rent_increase", &["money.from"], size, Need::Security, Some(&landlord), Some((&notice, "rent_increase", &landlord)), with.as_deref(), "event");
                if !life.household_adults.is_empty() {
                    self.s.trouble_to_tell.push(("rent_increase".into(), landlord.clone()));
                }
                let held = born.and_then(|_| self.s.wants.get("rent_increase", Some(&notice)).cloned());
                match held.filter(|w| w.tried == 0) {
                    Some(w) => Heard::Took(self.pursue(cx, pic, book, life, ways, &w).into_iter().collect()),
                    None => Heard::Took(vec![]),
                }
            }
            Event::Grieved { matter, party, about, amount, structure, size_bps, need, cause } => {
                let mut facts = Map::new();
                if let Some(a) = amount {
                    facts.insert("amount".into(), json!(a));
                }
                if let Some(c) = &cause {
                    facts.insert("cause".into(), json!(c));
                }
                if let Some(s) = &structure {
                    facts.insert("structure".into(), json!(s));
                }
                let mut o = Map::new();
                for (k, v) in [("t", json!(t)), ("domain", json!("friction")), ("option", json!(matter)), ("kind", json!("arose")), ("way", json!("mine")), ("from", json!(party)), ("facts", Json::Object(facts))] {
                    o.insert(k.into(), v);
                }
                self.outcome_rec(cx, life, None, o, true);
                self.exp(&party, false, t, 10_000, false, None);
                self.done_to(5_000);
                self.s.inner.note(inner::Remembered { t, what: "friction_arose".into(), about: Some(matter.clone()), size: round(amount.unwrap_or(0) as f64 / 100.0).clamp(0, 10_000), by: Some(party.clone()) });
                let need = Need::from_name(&need).unwrap_or(Need::Security);
                let seeks: &[&str] = if amount.unwrap_or(0) != 0 { &["money.to"] } else { &[] };
                let against = about.as_deref().map(|a| (a, matter.as_str(), party.as_str()));
                self.want_born(t, &matter, seeks, size_bps as f64 / 10_000.0, need, Some(&party), against, None, "event");
                Heard::Taken
            }
            Event::ServiceLapsed { whom, share_bps, days, complained } => {
                self.s.complained = complained;
                if share_bps > 0 {
                    self.s.feelings.feel(Emotion::Anger, &whom, share_bps.min(10_000), t);
                    let bearing = 5_000 + round((self.conformity() - 5_000) as f64 * 0.4);
                    let anger = self.s.feelings.level(Emotion::Anger, &whom, t);
                    if days >= 7 && anger >= bearing && !complained {
                        self.want_born(t, "service", &[], anger as f64 / 10_000.0, Need::Shelter, Some(&whom), None, None, "event");
                    }
                }
                Heard::Taken
            }
            Event::HouseholdTrouble { what, by, with } => {
                if self.s.initiative {
                    let happened = match what.as_str() {
                        "let_go" => "job_lost",
                        "notice" => "evicted",
                        _ => "rent_rise",
                    };
                    self.happened(happened, t, Some(&by), Some(0.5));
                    let seeks: &[&str] = match what.as_str() {
                        "notice" => &["occupancy"],
                        "let_go" => &["money.to"],
                        _ => &["money.from", "money.to"],
                    };
                    let need = if what == "notice" { Need::Shelter } else { Need::Security };
                    self.want_born(t, &what, seeks, 0.5, need, Some(&by), None, with.as_deref(), "event");
                }
                Heard::Taken
            }
            Event::Talk { from, person, text, re } => self.talk(cx, book, life, &from, &person, &text, re.as_deref()),
            // A grievance over (citizen.ts `ended`, and a refusal granted on review, 3647-3652): on the record, and its
            // want met or given up. Until 2026-10-18 the want outlived its grievance: with nothing left to answer it,
            // it was withdrawn again and again, each withdrawal an occasion to found something (port step 3).
            Event::Other { what, about: Some(about), facts } if what == "friction_ended" => {
                let s = |k: &str| facts.get(k).and_then(Json::as_str).unwrap_or_default().to_string();
                let (matter, how) = (s("matter"), s("how"));
                let days = facts.get("days").and_then(Json::as_i64).unwrap_or(0);
                self.s.inner.note(inner::Remembered { t, what: "friction_ended".into(), about: Some(matter.clone()), size: days.clamp(0, 10_000), by: Some(s("by")) });
                if let Some(w) = self.s.wants.get(&matter, Some(&about)).cloned() {
                    match facts.get("met").and_then(Json::as_str) {
                        Some("met") => self.s.wants.met(&w, t, Some(&how)),
                        Some("good") => self.want_met(cx, life, &w, &how, t),
                        _ => self.s.wants.give_up(&w, t, Some(&how)),
                    }
                }
                Heard::Taken
            }
            Event::Other { .. } => Heard::NotMine,
        }
    }

    /// A letter of talk (citizen.ts 1440-1531, after the household's own sayings).
    #[allow(clippy::too_many_arguments)]
    fn talk(&mut self, cx: &mut Cx, book: &Book, life: &Life, from: &str, person: &str, text: &str, re: Option<&str>) -> Heard {
        let t = cx.t;
        if let Some((by, matter)) = talk::wronged_heard(text) {
            self.exp(&by, false, t, 3_000, true, None);
            if self.p.founding.is_some() {
                self.s.heard_wronged.insert(person.into(), (by.clone(), matter.clone(), t));
            }
            let mut o = Map::new();
            for (k, v) in [("t", json!(t)), ("domain", json!("friction")), ("option", json!(matter)), ("kind", json!("told")), ("way", json!("mine")), ("from", json!(person)), ("facts", json!({ "by": by }))] {
                o.insert(k.into(), v);
            }
            self.outcome_rec(cx, life, None, o, false);
            return Heard::Taken;
        }
        if text == talk::UPBRINGING_ASK {
            self.s.asked_what_matters.push(from.into());
            return Heard::Taken;
        }
        if let Some(said) = talk::upbringing_heard(text) {
            if self.s.upbringing.asked_at.is_some() && !self.s.upbringing.settled {
                self.s.upbringing.told.push(said);
            }
            return Heard::Taken;
        }
        if self.s.culture.is_some() {
            let seen = culture_words::household_heard(text);
            if !seen.is_empty() {
                if self.s.upbringing.asked_at.is_some() && !self.s.upbringing.settled {
                    self.s.upbringing.culture.push((seen, culture_words::from_heard(text)));
                }
                return Heard::Taken;
            }
            if let Some(v) = culture_words::verdict_heard(text) {
                let close = self.s.ties.affinity(person, t) >= self.s.culture.as_ref().unwrap().p.close_affinity_bps;
                let env = self.env();
                let cul = self.s.culture.as_mut().unwrap();
                let dent = cul.judged(&env, v.conduct, v.did, v.approval, route(close));
                let warmth = cul.warmth();
                if dent > 0 {
                    self.s.inner.disapproved(dent, t, person);
                    self.s.ties.add(person, -round(dent as f64 / 2.0), t, Some("disapproved"));
                } else {
                    self.s.ties.add(person, warmth, t, Some("esteemed"));
                }
                return Heard::Taken;
            }
        }
        if let Some(gone) = talk::mourning_heard(text) {
            let close = self.s.ties.affinity(&gone, t);
            if close > 0 {
                self.happened("bereaved", t, Some(&gone), Some(close as f64 / 10_000.0));
                self.want_born(t, "loss", &["attend"], close as f64 / 10_000.0, Need::Meaning, Some(&gone), None, None, "event");
            } else {
                self.s.inner.remember(inner::Remembered { t, what: "death_told".into(), about: Some(gone.clone()), size: 1_000, by: None });
            }
            if self.p.founding.is_some() {
                self.s.mourners.entry(gone.clone()).or_default().insert(person.into());
            }
            self.s.ties.drop(&gone);
            self.s.contacts.retain(|(c, _)| *c != gone);
            self.s.told_us.remove(&gone);
            self.s.ties.add(person, 500, t, Some("mourned"));
            self.s.people_known.insert(person.into());
            return Heard::Taken;
        }
        if text == catching_up::ASK {
            self.s.asked_how.push(from.into());
            self.s.talked.insert(person.into(), t);
            self.s.ties.add(person, 300, t, Some("talked"));
            self.s.people_known.insert(person.into());
            return Heard::Taken;
        }
        if self.s.culture.is_some() {
            self.hear_culture(text, person, t, from);
            self.hear_town(text, t, person);
        }
        if let Some(told) = talk::heard_news(text) {
            self.s.told_us.insert(person.into(), (Box::new(told.clone()), t));
            self.s.talked.insert(person.into(), t);
            self.s.ties.add(person, 300, t, Some("talked"));
            self.s.people_known.insert(person.into());
            self.s.ties.trusted(person, true, 200);
            if let Some(b) = &told.let_go_by {
                if self.s.inner.trusted(b).is_some() || life.employer.as_deref() == Some(b.as_str()) {
                    self.exp(b, false, t, 10_000, true, None);
                }
            }
            if let Some(b) = &told.noticed_by {
                if self.s.inner.trusted(b).is_some() || life.landlord.as_deref() == Some(b.as_str()) {
                    self.exp(b, false, t, 10_000, true, None);
                }
            }
            let heard = |m: &mut CitizenMind, cx: &mut Cx, domain: &str, option: &str, payoff: i64, facts: Json| {
                let mut o = Map::new();
                for (k, v) in [("t", json!(t)), ("kind", json!("told")), ("way", json!("mine")), ("from", json!(person)), ("facts", facts)] {
                    o.insert(k.into(), v);
                }
                m.learn_rec(cx, life, domain, option, payoff, o, false, true);
            };
            if let (Some(shop), Some(served)) = (&told.shop, told.served) {
                heard(self, cx, "shop", shop, served, json!({ "served_bps": served }));
            }
            if let (Some(emp), Some(paid)) = (&told.employer, told.paid) {
                heard(self, cx, "job", emp, if paid { 10_000 } else { 0 }, json!({ "paid": paid }));
            }
            for host in &told.goes_to {
                let ids: Vec<String> = book.practices().filter(|g| g.speaks_for.as_deref().unwrap_or(&g.author) == host).map(|g| g.id.clone()).collect();
                for id in ids {
                    let pay = (7_000 + round(self.hold_to(host) as f64 * self.p.belief.meaning)).min(10_000);
                    heard(self, cx, "practice", &id, pay, json!({ "goes": true, "host": host }));
                }
            }
            for host in &told.holds_to {
                if self.hold_to(host) > 0 {
                    let bps = round((self.p.belief.told_bps * (5_000 + self.conformity())) as f64 / 10_000.0);
                    let belief = self.strengthened(host, bps);
                    let mut o = Map::new();
                    for (k, v) in [("t", json!(t)), ("domain", json!("belief")), ("option", json!(host)), ("kind", json!("told")), ("way", json!("mine")), ("from", json!(person)), ("belief", belief)] {
                        o.insert(k.into(), v);
                    }
                    self.outcome_rec(cx, life, None, o, false);
                }
            }
            return Heard::Taken;
        }
        let _ = re;
        if text == talk::ASK_HOME || text == talk::ASK_WORK {
            self.s.asked.push((from.into(), if text == talk::ASK_HOME { "home" } else { "work" }.into()));
            return Heard::Taken;
        }
        Heard::NotMine
    }

    /// What a tie said of itself in culture's words (citizen.ts `hearCulture`).
    fn hear_culture(&mut self, text: &str, who: &str, t: i64, reply_to: &str) {
        let Some(cd) = self.p.cdial.clone() else { return };
        let close = self.s.ties.affinity(who, t) >= self.s.culture.as_ref().unwrap().p.close_affinity_bps;
        if let Some(heard) = culture_words::heard(text) {
            for d in &heard.did {
                let env = self.env();
                let cul = self.s.culture.as_mut().unwrap();
                cul.see_act(d.conduct, d.did, route(close));
                cul.note_heard(d.conduct, t);
                if let Some(r) = cul.react(&env, d.conduct, d.did, t) {
                    if r.tie != 0 {
                        self.s.ties.add(who, r.tie, t, Some(if r.tie < 0 { "disapproved" } else { "esteemed" }));
                    }
                    if let Some(v) = r.voice {
                        self.s.verdicts.push((reply_to.into(), culture_words::verdict(d.conduct, d.did, v)));
                    }
                }
            }
            let cul = self.s.culture.as_mut().unwrap();
            for s in &heard.says {
                cul.hear_said(s.conduct, s.bps, route(close));
            }
            for d in &heard.did {
                cul.learn_of(who, d.conduct, d.did, t);
            }
        }
        if let Some(a) = culture_words::about_heard(text) {
            if a.who != self.me() {
                let env = self.env();
                let r = self.s.culture.as_mut().unwrap().hear_about(&env, &a.who, a.conduct, a.did, a.approval, t, route(close));
                if let Some(r) = r.filter(|r| r.tie != 0) {
                    if self.s.ties.trust(&a.who).is_some() {
                        self.s.ties.add(&a.who, r.tie, t, Some(if r.tie < 0 { "disapproved" } else { "esteemed" }));
                    }
                }
            }
        }
        if let Some(g) = culture_words::from_heard(text) {
            if cd.homophily_bps > 0 {
                self.s.origin_seen.retain(|(w, _)| w != who);
                self.s.origin_seen.push((who.into(), g));
                while self.s.origin_seen.len() > self.p.max_contacts * 4 {
                    self.s.origin_seen.remove(0);
                }
                if self.same_origin(who) {
                    self.s.ties.add(who, round((300 * cd.homophily_bps) as f64 / 10_000.0), t, Some("talked"));
                }
            }
        }
    }

    fn same_origin(&self, who: &str) -> bool {
        let g = self.s.culture.as_ref().and_then(|c| c.group());
        g.is_some() && self.s.origin_seen.iter().find(|(w, _)| w == who).map(|(_, o)| o.as_str()) == g
    }

    /// What a tie told us of the town (citizen.ts `hearTown`).
    fn hear_town(&mut self, text: &str, t: i64, who: &str) {
        let Some(w) = townmemory::town_words::heard(text) else { return };
        let env = self.env();
        let (Some(cul), Some(mem)) = (self.s.culture.as_mut(), self.s.town.as_mut()) else { return };
        let against = townmemory::event_conduct(w.kind).map_or(false, |c| cul.read(&env, c, t).map_or(5_000, |r| r.own) < 5_000);
        if mem.heard_from(w.kind, &w.about, w.day, t, w.strength, w.hops, against) == Taken::Fresh {
            let held = mem.strength_of(w.kind, &w.about, w.day * DAY, t);
            self.bear_on_trust(w.kind, &w.about, held, t);
            let close = self.s.ties.affinity(who, t) >= self.s.culture.as_ref().unwrap().p.close_affinity_bps;
            let cul = self.s.culture.as_mut().unwrap();
            for (i, c) in townmemory::event_conducts(w.kind).iter().enumerate() {
                cul.saw_event(*c, route(close), held, if i == 0 { w.says } else { None });
            }
        }
    }

    /// An event become ours bears once on trust in whoever did it, by the sign of our own view (citizen.ts `bearOnTrust`).
    fn bear_on_trust(&mut self, kind: EventKind, about: &str, strength: i64, t: i64) {
        let Some(c) = townmemory::event_conduct(kind) else { return };
        let env = self.env();
        let Some(own) = self.s.culture.as_ref().and_then(|cul| cul.read(&env, c, t)).map(|r| r.own) else { return };
        if own == 5_000 {
            return;
        }
        let ok = townmemory::trust_direction(kind, own) > 0;
        let w = round(self.s.culture.as_ref().unwrap().bearing(strength, own) * 10_000.0);
        self.exp(about, ok, t, w, true, None);
    }

    /// Something public reached us (citizen.ts `remember`).
    pub fn remember_town(&mut self, kind: &str, about: &str, event_t: i64, t: i64, saw: bool, strength: i64) {
        let Some(k) = EventKind::from_name(kind) else { return };
        let Some(mem) = self.s.town.as_mut() else { return };
        let r = if saw { mem.saw(k, about, event_t, t) } else { mem.read(k, about, event_t, t, strength) };
        if r != Taken::Fresh {
            return;
        }
        let s = mem.strength_of(k, about, event_t, t);
        self.bear_on_trust(k, about, s, t);
    }

    // -------------------------------------------------------------- civic life (citizen.ts `civic`)

    pub fn civic(&mut self, cx: &mut Cx, pic: &Picture, book: &Book, life: &Life, t: i64, out: &mut Planned) {
        let Some(town) = self.p.electoral_town.clone() else { return };
        if !self.adult(life) {
            return;
        }
        let me = self.me().to_string();
        let electoral = self.p.electoral_body.clone().unwrap_or_else(|| town.clone());
        if self.s.enrolled.is_none() {
            self.s.enrolled = Some(book.all("enrolment").any(|r| r.speaks_for.as_deref() == Some(me.as_str())));
        }
        if self.s.enrolled == Some(false) {
            self.s.enrolled = Some(true);
            let born = pic.body.as_ref().map_or(0, |b| b.born_at);
            out.steps.push(because(
                "Of voting age (or new to town) and not on the roll: enrolling, as the law requires.",
                vec![steps::say("enrolment", &format!("Enrolment: {me}."), Say { to: Some(vec![electoral.clone()]), visible: Some(Visible::Only(vec![me.clone(), electoral.clone()])), data: Some(json!({ "born_at": born })), ..Default::default() })],
            ));
        }
        if self.s.approved_at < 0 || t - self.s.approved_at >= 7 * DAY {
            self.s.approved_at = t;
            let signal = (2 * (self.satisfaction_now() - 5_000) - self.s.feelings.level(Emotion::Anger, &town, t)).clamp(-10_000, 10_000);
            self.s.approval = round(self.s.approval as f64 + (signal - self.s.approval) as f64 / self.p.civic.approval_memory_weeks.max(1) as f64);
            let said: Vec<i64> = self.news_now(t).filter_map(|(_, n)| n.town).collect();
            let fear = self.fear_of(&town, t).max(self.fear_of("money", t));
            let trust = self.trust_in(&town, "government", t);
            let norm = (!said.is_empty()).then(|| round((said.iter().sum::<i64>() * 6_000) as f64 / said.len() as f64));
            let approval = self.s.approval;
            self.s.inner.view(&self.s.mind.person.values, &town, approval, inner::Pressure { dependence: 3_000, fear, trust, norm });
        }
        let paper = self.p.paper.clone();
        if let (true, Some(paper)) = (self.s.reads_news, paper) {
            if self.s.town.is_some() {
                let items: Vec<_> = book.open("news").cloned().collect();
                for r in items {
                    let RecordBody::Statement { data, .. } = &r.body else { continue };
                    let kind = data.as_ref().and_then(|d| d.get("kind")).and_then(Json::as_str).unwrap_or_default();
                    let Some((ek, weight)) = townmemory::paper_weight(kind) else { continue };
                    if r.speaks_for.as_deref() != Some(paper.as_str()) || self.s.read_news.contains(&r.id) {
                        continue;
                    }
                    self.s.read_news.insert(r.id.clone());
                    let basis = common::bases_of(&r).first().and_then(|b| book.get(b)).cloned();
                    let by = basis.and_then(|b| b.speaks_for.clone()).or_else(|| self.p.electoral_town.clone());
                    if let Some(by) = by {
                        let strength = townmemory::paper_strength(weight, &self.s.culture.as_ref().unwrap().p);
                        self.remember_town(ek.name(), &by, r.at, t, false, strength);
                    }
                }
            }
            let items: Vec<_> = book.open("news").cloned().collect();
            for r in items {
                let RecordBody::Statement { data, .. } = &r.body else { continue };
                let d = data.clone().unwrap_or(Json::Null);
                if self.s.read_items.contains(&r.id) || r.speaks_for.as_deref() != Some(paper.as_str()) || d.get("about_office") != Some(&Json::Bool(true)) {
                    continue;
                }
                self.s.read_items.insert(r.id.clone());
                let tone = d.get("tone").and_then(Json::as_f64).unwrap_or(0.0).clamp(-1.0, 1.0);
                self.s.approval = (self.s.approval + round(tone * self.p.civic.news_weight_bps as f64)).clamp(-10_000, 10_000);
            }
        }
        // An election called: standing (citizen.ts 4665-4674).
        let notices: Vec<_> = book.open("election_notice").cloned().collect();
        for n in notices {
            let RecordBody::Statement { data, .. } = &n.body else { continue };
            let d = data.clone().unwrap_or(Json::Null);
            if self.s.stood_for.contains(&n.id) || t >= d.get("nominations_close_at").and_then(Json::as_i64).unwrap_or(0) {
                continue;
            }
            self.s.stood_for.insert(n.id.clone());
            let drive = 1.0 + 0.5 * self.z_value(Value::Achievement) + 0.5 * self.z_value(Value::Power) + if self.s.approval < 0 { -self.s.approval as f64 / 5_000.0 } else { 0.0 } + if self.s.initiative { self.s.wants.p.sway.agency * self.za() } else { 0.0 };
            if !self.s.stand_now.contains(&n.id) && (cx.rng(&format!("stand-{}", n.id)).below(10_000) as i64) >= Self::shifted(self.p.civic.stand_bps, drive - 1.0) {
                continue;
            }
            let mut vs = Value::ALL.to_vec();
            vs.sort_by(|a, b| self.z_value(*b).partial_cmp(&self.z_value(*a)).unwrap_or(std::cmp::Ordering::Equal).then(a.name().cmp(b.name())));
            let top: Vec<&str> = vs[..2].iter().map(|v| v.name()).collect();
            let office = d.get("office").cloned().unwrap_or(Json::Null);
            let platform = format!("Standing for {}: for {}.", office.as_str().unwrap_or_default(), top.join(" and "));
            out.steps.push(because(
                format!("An election: standing for office (drive {drive:.2}; we think the town is run {}).", if self.s.approval >= 0 { "well enough" } else { "badly" }),
                vec![steps::say("nomination", &platform, Say { to: Some(vec![electoral.clone()]), visible: Some(Visible::Public), data: Some(json!({ "office": office, "name": me, "values": top })), extra: vec![("assertion", json!({ "that": platform }))], ..Default::default() })],
            ));
        }
        // Voting (citizen.ts 4679-4696).
        let enrolled_at = book.open("enrolment").filter(|r| r.speaks_for.as_deref() == Some(me.as_str())).map(|r| r.at).min();
        let ballots: Vec<_> = book.open("ballot").cloned().collect();
        for b in ballots {
            let RecordBody::Statement { data, .. } = &b.body else { continue };
            let d = data.clone().unwrap_or(Json::Null);
            let opens = d.get("opens_at").and_then(Json::as_i64).unwrap_or(0);
            let closes = d.get("closes_at").and_then(Json::as_i64).unwrap_or(0);
            if self.s.voted.contains(&b.id) || d.get("electorate").and_then(Json::as_str) != Some("roll") || !enrolled_at.map_or(false, |e| e < b.at) || t < opens || t >= closes {
                continue;
            }
            self.s.voted.insert(b.id.clone());
            if (cx.rng(&format!("turnout-{}", b.id)).below(10_000) as i64) >= self.p.civic.turnout_bps {
                continue;
            }
            let cands = d.get("candidates").and_then(Json::as_array).cloned().unwrap_or_default();
            let mut scores: Vec<(String, String, i64)> = cands
                .iter()
                .map(|c| {
                    let cand = c.get("candidate").and_then(Json::as_str).unwrap_or_default().to_string();
                    let number = c.get("number").and_then(Json::as_str).map(String::from).unwrap_or_else(|| cand.clone());
                    let nom = c.get("nomination").and_then(Json::as_str).and_then(|id| book.get(id)).and_then(|r| match &r.body {
                        RecordBody::Statement { data, .. } => data.clone(),
                        _ => None,
                    });
                    let incumbent = nom.as_ref().and_then(|n| n.get("incumbent")).map_or(false, common::truthy);
                    let values: Vec<Value> = nom.as_ref().and_then(|n| n.get("values")).and_then(Json::as_array).map_or(vec![], |vs| vs.iter().filter_map(|v| v.as_str().and_then(Value::from_name)).collect());
                    let fit = if values.is_empty() { 0.0 } else { values.iter().map(|v| self.z_value(*v)).sum::<f64>() / values.len() as f64 };
                    let score = (if incumbent { self.s.approval } else { round(fit * self.p.civic.platform_weight_bps as f64) }) + if cand == self.p.participant { 100_000 } else { 0 };
                    (cand, number, score)
                })
                .collect();
            scores.sort_by(|x, y| y.2.cmp(&x.2).then(x.0.cmp(&y.0)));
            if scores.is_empty() {
                continue;
            }
            let mut dd = Map::new();
            for (k, v) in [("t", json!(t)), ("domain", json!("vote")), ("strategy", json!("deliberate")), ("choice", json!(scores[0].0)), ("options", Json::Array(scores.iter().map(|x| json!({ "key": x.0, "score": x.2 })).collect()))] {
                dd.insert(k.into(), v);
            }
            self.decision(cx, dd, &[]);
            let ranking = scores.iter().map(|x| x.1.as_str()).collect::<Vec<_>>().join(">");
            out.steps.push(because(
                format!("Voting: ranking the {} candidates (our approval of the town's government: {}).", scores.len(), self.s.approval),
                vec![common::vote(&b.id, &ranking, Some(Visible::Only(vec![electoral.clone()])))],
            ));
        }
    }

    // -------------------------------------------------------------- petitions (citizen.ts `voice`)

    pub fn voice(&mut self, cx: &mut Cx, book: &Book, pic: &Picture, life: &Life, t: i64, out: &mut Planned) {
        let tenancy = life.housed == Housed::Rents && !life.owned;
        let lord = life.landlord.clone().unwrap_or_default();
        let burden = if tenancy && life.monthly_income > 0 { (life.rent.unwrap_or(0) * 10_000) / life.monthly_income } else { 0 };
        let noticed = tenancy && life.lease.as_ref().map_or(false, |l| book.notices(l).any(|n| n.party != self.me()));
        if noticed {
            let angry = self.felt(false, Emotion::Anger, &lord, 6_000, t);
            let lease = life.lease.clone().unwrap();
            if !self.s.notice_seen.contains(&lease) {
                let mut o = Map::new();
                for (k, v) in [("t", json!(t)), ("domain", json!("home")), ("option", json!(life.dwelling)), ("kind", json!("notice_received")), ("way", json!("mine")), ("facts", json!({ "from": lord })), ("felt", json!([angry]))] {
                    o.insert(k.into(), v);
                }
                self.outcome_rec(cx, life, Some(book), o, true);
            }
            self.s.notice_seen.insert(lease);
        }
        let aggrieved = tenancy && (burden >= self.p.rent_burden_grievance_bps || self.s.feelings.level(Emotion::Anger, &lord, t) >= self.p.aggrieved_bps);
        let open: Vec<_> = self.petitions_seen(pic).into_iter().filter(|x| super::plan::tenant_petition_pub(x)).collect();
        let me = self.me().to_string();
        for pet in &open {
            if pet.speaks_for.as_deref() == Some(me.as_str()) && t - pet.at >= self.p.petition_days * DAY && self.s.signed.insert(format!("closed-{}", pet.id)) {
                out.steps.push(because(format!("Closing our petition after {} days.", self.p.petition_days), vec![common::withdraw(&pet.id, Some("Petition closed."))]));
                self.out(cx, life, t, "petition", "start", "closed", "mine", json!({ "petition": pet.id, "signatures": petition_signatures(book, &pet.id) + 1, "days_open": (t - pet.at).div_euclid(DAY) }));
            }
        }
        let weighing = self.s.willing && aggrieved && open.is_empty();
        let starts = weighing && (cx.rng("petition").below(10_000) as i64) < self.p.petition_start_bps;
        if weighing {
            let mut d = Map::new();
            for (k, v) in [("t", json!(t)), ("domain", json!("petition")), ("strategy", json!("deliberate")), ("choice", json!(if starts { "start" } else { "not" })), ("options", json!([{ "key": "start", "score": self.p.petition_start_bps }, { "key": "not", "score": 10_000 - self.p.petition_start_bps }]))] {
                d.insert(k.into(), v);
            }
            self.decision(cx, d, &[]);
        }
        if starts {
            out.steps.push(because(
                format!("Aggrieved ({}) and no tenants' petition is open: starting one.", if noticed { "our landlord gave us notice".to_string() } else { format!("rent is {}% of household income", round(burden as f64 / 100.0)) }),
                vec![self.petition_call()],
            ));
            return;
        }
        let view = if self.s.initiative && tenancy { self.s.inner.view_of(&lord).cloned() } else { None };
        let hush = view.map_or(0.0, |v| ((v.private - v.expressed).abs() as f64 / 5_000.0).min(1.0));
        for pet in &open {
            if pet.speaks_for.as_deref() == Some(me.as_str()) {
                let n = petition_signatures(book, &pet.id) as i64 + 1;
                let last = self.s.counts_published.get(&pet.id).copied();
                if last.map_or(true, |(ln, at)| ln != n && t - at >= 3 * DAY) {
                    self.s.counts_published.insert(pet.id.clone(), (n, t));
                    out.steps.push(because("Publishing our petition's running count.", vec![steps::say("petition_count", &format!("{n} people have signed."), Say { basis: Some(pet.id.clone()), data: Some(json!({ "petition": pet.id, "signatures": n })), ..Default::default() })]));
                    self.out(cx, life, t, "petition", "start", "signatures", "mine", json!({ "petition": pet.id, "signatures": n, "days_open": (t - pet.at).div_euclid(DAY) }));
                }
                continue;
            }
            if self.s.signed.contains(&pet.id) || !self.s.willing {
                continue;
            }
            let share = (published_count(book, pet) as f64 * 10_000.0) / self.p.population as f64;
            let housed = life.housed != Housed::None;
            let signs = self.s.sign_now.contains(&pet.id) || (aggrieved && hush < 1.0) || (housed && share >= self.s.threshold as f64 * (1.0 + hush));
            if signs || !self.s.petition_seen.contains(&pet.id) {
                let mut d = Map::new();
                for (k, v) in [("t", json!(t)), ("domain", json!("petition")), ("strategy", json!(if aggrieved { "deliberate" } else { "imitate" })), ("choice", json!(if signs { "sign" } else { "not" })), ("options", json!([{ "key": "not", "score": self.s.threshold }, { "key": "sign", "score": round(share) }]))] {
                    d.insert(k.into(), v);
                }
                self.decision(cx, d, &[]);
            }
            self.s.petition_seen.insert(pet.id.clone());
            if signs {
                self.s.signed.insert(pet.id.clone());
                let why = if aggrieved { "Signing the tenants' petition: we're aggrieved ourselves.".to_string() } else { format!("Signing the tenants' petition: {}% of the town has signed, past our own threshold of {}%.", round(share / 100.0), round(self.s.threshold as f64 / 100.0)) };
                out.steps.push(because(why, vec![common::vote(&pet.id, "sign", None)]));
            }
        }
    }

    /// A tenants' petition (risks PC-8, decided fresh): what it asks for is the world's (`petition_demand`, from its
    /// profile), never one place's figures in code; with none given it asks in words for longer notice and limits on
    /// rises, and proposes no figure of any law.
    fn petition_call(&self) -> oikos_sight::calls::Call {
        let d = &self.p.petition;
        let (words, text, aim) = match (d.notice_days, d.rise_cap_bps) {
            (Some(n), Some(c)) => (
                format!("Petition: landlords must give {n} days' notice, and may not raise rent by more than {}% a year.", pct(c)),
                format!("A landlord must give at least {n} days' notice to end a tenancy, and may not raise the rent by more than {}% in any 12 months.", pct(c)),
                format!("end a tenancy on less than {n} days' notice, or raise rent by more than {}% a year", pct(c)),
            ),
            (Some(n), None) => (format!("Petition: landlords must give {n} days' notice."), format!("A landlord must give at least {n} days' notice to end a tenancy."), format!("end a tenancy on less than {n} days' notice")),
            (None, Some(c)) => (
                format!("Petition: landlords may not raise rent by more than {}% a year.", pct(c)),
                format!("A landlord may not raise the rent by more than {}% in any 12 months.", pct(c)),
                format!("raise rent by more than {}% a year", pct(c)),
            ),
            (None, None) => (
                "Petition: landlords must give tenants longer notice, and limit how far they raise the rent.".to_string(),
                "A landlord must give tenants longer notice to end a tenancy than now, and limit rent rises.".to_string(),
                "end a tenancy on short notice, or raise rent without limit".to_string(),
            ),
        };
        let mut demand = json!({ "kind": "law", "text": text, "adico": { "attribute": "landlords", "deontic": "must_not", "aim": aim }, "tags": ["tenant_protection"] });
        if let (false, Some(n)) = (self.p.tenancy_schedule.is_empty(), d.notice_days) {
            demand["amend"] = json!({ "schedule": self.p.tenancy_schedule, "figures": { "notice": n * DAY } });
        }
        steps::say("petition", &words, Say { data: Some(json!({ "demand": demand })), ..Default::default() })
    }

    // -------------------------------------------------------------- word of mouth (citizen.ts `wordOfMouth`)

    pub fn word_of_mouth(&mut self, cx: &mut Cx, pic: &Picture, book: &Book, life: &Life, t: i64, out: &mut Planned) {
        let me = self.me().to_string();
        let structures: Vec<std::sync::Arc<oikos_sight::SiteStructure>> = match pic.channels.get("street") {
            Some(Seen::Sites { cells, .. }) => cells.iter().filter_map(|c| c.structure.clone()).collect(),
            _ => vec![],
        };
        for st in &structures {
            for sp in &st.spaces {
                for o in sp.occupants.iter().flatten() {
                    if *o != me {
                        if let Some(x) = self.s.contacts.iter_mut().find(|(c, _)| c == o) {
                            x.1 = t;
                        } else {
                            self.s.contacts.push((o.clone(), t));
                        }
                    }
                }
            }
        }
        if self.s.town.is_some() {
            self.witness_around(book, life, &structures, t);
        }
        if self.s.contacts.len() > self.p.max_contacts {
            let keeps = |m: &CitizenMind, k: &str, seen: i64| m.s.ties.affinity(k, t) + if t - seen <= MONTH { 2_000 } else { 0 };
            let mut keep = self.s.contacts.clone();
            keep.sort_by(|a, b| keeps(self, &b.0, b.1).cmp(&keeps(self, &a.0, a.1)).then(b.1.cmp(&a.1)).then(a.0.cmp(&b.0)));
            keep.truncate(self.p.max_contacts);
            self.s.contacts = keep;
        }
        let room = |st: &oikos_sight::SiteStructure, kind: &str| st.complete && st.spaces.iter().any(|sp| sp.kind == kind && if kind == "dwelling" { sp.count == 0 } else { sp.count < sp.capacity });
        for (from, want) in std::mem::take(&mut self.s.asked) {
            let lead = if want == "home" {
                structures.iter().find(|st| room(st, "dwelling")).map(|st| st.structure.clone())
            } else {
                life.workplace.as_ref().map(|w| common::structure_of(w).to_string()).filter(|ws| structures.iter().any(|st| &st.structure == ws && room(st, "workplace")))
            };
            if let Some(lead) = lead {
                if (cx.rng(&format!("pass-on-{from}")).below(10_000) as i64) < self.p.pass_on_bps {
                    let words = if want == "home" { format!("There looks to be room at {lead}, near me.") } else { format!("They have room at my work, {lead}.") };
                    out.steps.push(because("Asked about room: passing on what we can see.", vec![message(&[from], &words, Some(&lead))]));
                }
            }
        }
        for who in std::mem::take(&mut self.s.asked_how) {
            let words = self.news_of_mine(cx, Some(&who), life);
            out.steps.push(because("Asked how things are: telling them.", vec![message(&[who], &words, None)]));
        }
        for (to, text) in std::mem::take(&mut self.s.verdicts) {
            out.steps.push(because("Told what they did: saying what we make of it.", vec![message(&[to], &text, None)]));
        }
        let known: Vec<String> = self.s.contacts.iter().map(|(c, _)| c.clone()).collect();
        if self.s.next_catch_up.is_none() {
            self.s.next_catch_up = Some(t + cx.rng("catch-up").below(self.p.catch_up_days as u64) as i64 * DAY);
        }
        if t >= self.s.next_catch_up.unwrap() {
            self.s.next_catch_up = Some(t + round((self.p.catch_up_days * DAY) as f64 / if self.pursuing("catch up more") { 2.0 } else { 1.0 }));
            if !known.is_empty() {
                let mut pool = known.clone();
                pool.sort();
                let homophily = self.p.cdial.as_ref().map_or(0, |c| c.homophily_bps);
                let weights: Vec<i64> = pool.iter().map(|k| round((1_000 + self.s.ties.affinity(k, t).max(0)) as f64 * if self.same_origin(k) && homophily > 0 { 1.0 + homophily as f64 / 10_000.0 } else { 1.0 })).collect();
                let mut r = cx.rng("catch-up").below(weights.iter().sum::<i64>().max(1) as u64) as i64;
                let who = pool
                    .iter()
                    .zip(&weights)
                    .find(|(_, w)| {
                        r -= **w;
                        r < 0
                    })
                    .map(|(k, _)| k.clone())
                    .unwrap_or_else(|| pool.last().unwrap().clone());
                self.s.talked.insert(who.clone(), t);
                out.steps.push(because("Catching up with someone we know.", vec![message(&[who], catching_up::ASK, None)]));
            }
        }
        let has_home = matches!(life.housed, Housed::Own | Housed::Rents);
        for (want, needed, chance) in [("home", life.leaseholder && !has_home, self.p.ask_home_bps), ("work", life.employer.is_none() && life.own_work.is_none(), self.p.ask_work_bps)] {
            if !needed {
                self.s.asked_at.remove(want);
                continue;
            }
            if self.s.asked_at.get(want).map_or(false, |&a| t - a < self.p.ask_again_days * DAY) {
                continue;
            }
            self.s.asked_at.insert(want.into(), t);
            if !known.is_empty() && (cx.rng(&format!("ask-{want}")).below(10_000) as i64) < chance {
                let words = if want == "home" { talk::ASK_HOME } else { talk::ASK_WORK };
                out.steps.push(because(format!("Starting to look for {}: asking the people we know.", if want == "home" { "a home" } else { "work" }), vec![message(&known, words, None)]));
            }
        }
    }

    /// A removal carried out in a building we are in, seen (citizen.ts `witnessAround`).
    fn witness_around(&mut self, book: &Book, life: &Life, around: &[std::sync::Arc<oikos_sight::SiteStructure>], t: i64) {
        let Some(by) = book.open("law").find_map(|r| match &r.body {
            RecordBody::Statement { data: Some(d), .. } if d.get("tenancy").and_then(Json::as_str) == Some("possession") => d.get("enforced_by").and_then(Json::as_str).map(String::from),
            _ => None,
        }) else {
            return;
        };
        let (witness_days, seen_bps) = match &self.s.culture {
            Some(c) => (c.p.witness_days, c.p.seen_bps),
            None => return,
        };
        let me = self.me().to_string();
        for st in around {
            for sp in &st.spaces {
                for d in sp.left.iter().flatten() {
                    if serde_json::to_value(&d.reason).ok().and_then(|x| x.as_str().map(String::from)).as_deref() != Some("removed") || d.occupant == me || life.household_adults.contains(&d.occupant) || d.at > t || t - d.at > witness_days * DAY {
                        continue;
                    }
                    if !self.s.town.as_mut().unwrap().new_sighting(&format!("{}|{}|{}", sp.space, d.occupant, d.at)) {
                        continue;
                    }
                    self.remember_town("put_out", &by, d.at, t, true, seen_bps);
                    let cul = self.s.culture.as_mut().unwrap();
                    cul.see_act(super::culture::Conduct::ApplyPossession, true, Route::Here);
                    cul.see_act(super::culture::Conduct::StayPastNotice, true, Route::Here);
                }
            }
        }
    }

    /// What we'd tell someone who asks how we are (citizen.ts `newsOfMine`): from the news life gives and what we hold.
    pub fn news_of_mine(&mut self, cx: &mut Cx, asker: Option<&str>, life: &Life) -> String {
        let t = self.s.last_seen;
        let mut parts: Vec<String> = vec![];
        if let (Some(shop), Some(served)) = (&life.shop, life.served_bps) {
            if self.s.mind.learned_known("shop", shop) {
                parts.push(catching_up::shop(shop, served));
            }
        }
        if let Some(emp) = &life.employer {
            parts.push(catching_up::work(emp, !life.claimed_wages));
            if self.p.union.is_some() {
                parts.push(catching_up::union(self.p.union.as_ref().map_or(false, |u| life.member_of.contains(u))));
            }
        }
        let mut went: Vec<&String> = self.s.went_last.iter().collect();
        went.sort();
        for id in went {
            if let Some(h) = self.s.practice_hosts.get(id) {
                parts.push(catching_up::goes(h));
            }
        }
        let mut holds: Vec<String> = vec![];
        let mut leans: Vec<String> = vec![];
        for (host, ids) in &self.s.teachings {
            let ids: Vec<i64> = ids.iter().map(|id| *self.s.beliefs.get(id).unwrap_or(&0)).collect();
            if ids.iter().any(|&b| b >= self.p.belief.tell_at_bps) {
                holds.push(host.clone());
            }
            if ids.iter().any(|&b| b >= self.p.belief.affiliate_bps && b < self.p.belief.tell_at_bps) {
                leans.push(host.clone());
            }
        }
        parts.extend(holds.iter().map(|h| catching_up::holds(h)));
        parts.extend(leans.iter().map(|h| catching_up::leans(h)));
        if let Some((by, at)) = &self.s.let_go {
            if t - at <= self.p.news_days * DAY && life.employer.is_none() {
                parts.push(catching_up::lost_work(by));
            }
        }
        if let Some((by, at)) = &self.s.noticed_by {
            if t - at <= self.p.news_days * DAY {
                parts.push(catching_up::noticed(by));
            }
        }
        if let Some(town) = &self.p.electoral_town {
            if let Some(v) = self.s.inner.view_of(town) {
                parts.push(catching_up::town(v.expressed));
            }
        }
        if self.s.initiative && !self.s.wants.all().is_empty() {
            let list: Vec<(String, String)> = self.s.wants.all().iter().filter_map(|w| w.way.as_ref().map(|way| (w.about.clone(), super::plan::kind_of_way(way)))).take(3).collect();
            parts.push(catching_up::after(&list));
        }
        if let (true, Some((about, at))) = (self.s.initiative, &self.s.withdrew) {
            if t - at <= self.p.news_days * DAY {
                parts.push(catching_up::gave_up(about));
            }
        }
        if self.s.culture.is_some() {
            let homophily = self.p.cdial.as_ref().map_or(0, |c| c.homophily_bps);
            if let Some(g) = self.s.culture.as_ref().and_then(|c| c.group().map(String::from)).filter(|_| homophily > 0) {
                parts.push(culture_words::from(&g));
            }
            if let Some(asker) = asker {
                let env = self.env();
                let days = self.p.news_days;
                let told = self.s.culture.as_mut().unwrap().tell(&env, asker, t, days);
                parts.extend(told);
                let mut rng = cx.rng("culture-gossip");
                let mut roll = || rng.below(10_000) as i64;
                if let Some(g) = self.s.culture.as_mut().unwrap().gossip(&env, asker, t, &mut roll) {
                    parts.push(g);
                }
                let cul = self.s.culture.clone().unwrap();
                let view = move |k: EventKind| -> Option<i64> {
                    let c = townmemory::event_conduct(k)?;
                    let says = cul.read(&env, c, t)?.says;
                    (says / 2_000 != 2).then_some(says)
                };
                if let Some(m) = &mut self.s.town {
                    if let Some(x) = m.tell(asker, t, Some(&view)) {
                        parts.push(x);
                    }
                }
            }
        }
        let words = parts.into_iter().filter(|x| !x.is_empty()).collect::<Vec<_>>().join(" ");
        if words.is_empty() {
            catching_up::NOTHING.to_string()
        } else {
            words
        }
    }

    // -------------------------------------------------------------- the record (citizen.ts `writeRecord`)

    pub fn write_record(&mut self, cx: &mut Cx, life: &Life) {
        let t = cx.t;
        let adult = life.adult;
        let sec = self.s.inner.sections();
        let tie = |x: &super::person::Tie| {
            let mut o = json!({ "who": x.who, "affinity": x.affinity, "trust": x.trust });
            if let Some(l) = &x.last {
                o["last"] = json!({ "what": l.what, "t": l.t });
            }
            o
        };
        let pp = self.s.mind.person.clone();
        let mut all: Vec<(String, Json)> = vec![
            ("values".into(), super::citizen::named(&Value::ALL.map(|v| (v.name(), pp.values[v.index()])))),
            ("temperament".into(), json!({ "openness": pp.temperament.openness, "conformity": pp.temperament.conformity, "prestige": pp.temperament.prestige })),
        ];
        if adult {
            all.push(("needs".into(), super::citizen::named(&Need::ALL.map(|n| (n.name(), self.s.levels[n.index()])))));
        }
        all.push(("agency".into(), serde_json::to_value(&sec.agency).unwrap_or(Json::Null)));
        all.push(("trust".into(), json!({ "people": self.p.outlook.people_bps.unwrap_or(self.s.inner.p.trust.start_bps), "in": sec.trust })));
        all.push(("attached".into(), serde_json::to_value(&sec.attached).unwrap_or(Json::Null)));
        all.push(("views".into(), serde_json::to_value(&sec.views).unwrap_or(Json::Null)));
        all.push(("ties".into(), json!({ "close": self.s.ties.closest(5, t).iter().map(tie).collect::<Vec<_>>(), "resented": self.s.ties.resented(3, t).iter().map(tie).collect::<Vec<_>>() })));
        let mut bel: Vec<(&String, &i64)> = self.s.beliefs.iter().filter(|(_, &b)| b > 0).collect();
        bel.sort_by(|a, b| b.1.cmp(a.1).then(a.0.cmp(b.0)));
        let beliefs: Vec<Json> = bel
            .into_iter()
            .take(6)
            .map(|(teaching, bps)| {
                let mut o = json!({ "teaching": teaching, "bps": bps });
                if let Some(from) = self.s.teachings.iter().find(|(_, ids)| ids.contains(teaching)).map(|(h, _)| h.clone()) {
                    o["from"] = json!(from);
                }
                o
            })
            .collect();
        all.push(("beliefs".into(), Json::Array(beliefs)));
        all.push(("wants".into(), if self.s.initiative { serde_json::to_value(self.s.wants.section()).unwrap_or(Json::Null) } else { json!([]) }));
        let env = self.env();
        if let Some(cul) = &mut self.s.culture {
            let norms = serde_json::to_value(cul.section(&env, t)).unwrap_or(Json::Null);
            if cul.section_version() != self.s.norms_version {
                self.s.norms_version = cul.section_version();
                all.push(("norms".into(), norms));
            }
        }
        if let Some(mem) = &mut self.s.town {
            let heard = serde_json::to_value(mem.section()).unwrap_or(Json::Null);
            if mem.section_version() != self.s.heard_version && (heard.as_array().map_or(false, |a| !a.is_empty()) || self.s.written.contains_key("heard")) {
                self.s.heard_version = mem.section_version();
                all.push(("heard".into(), heard));
            }
        }
        all.push(("memory".into(), serde_json::to_value(&sec.memory).unwrap_or(Json::Null)));
        let mut circ = json!({ "household": life.household.max(1), "housed": if life.housed != Housed::None { 1 } else { 0 }, "working": if life.employer.is_some() || life.own_work.is_some() { 1 } else { 0 }, "retired": if life.retired { 1 } else { 0 } });
        if adult {
            circ["income"] = json!(life.monthly_income);
            circ["savings"] = json!(life.savings);
        }
        all.push(("circumstances".into(), circ));
        if t - self.s.hours_at >= 7 * DAY {
            self.s.hours_at = t;
            all.push(("hours".into(), serde_json::to_value(self.s.inner.take_hours(t)).unwrap_or(Json::Null)));
        }
        let norms_grain = self.p.cdial.as_ref().map_or(0, |c| c.params.grain_percent);
        let grain = |k: &str| match k {
            "agency" => 50,
            "trust" => 100,
            "attached" | "views" => 200,
            "ties" => 500,
            "beliefs" => 100,
            "norms" => norms_grain,
            _ => 0,
        };
        let mut set = Map::new();
        for (k, v) in all {
            let changed = match self.s.written.get(&k).map(|p| p.value()) {
                None => true,
                Some(was) if k == "circumstances" => {
                    let strip = |x: &Json| {
                        let mut y = x.clone();
                        if let Some(o) = y.as_object_mut() {
                            o.insert("income".into(), json!(0));
                            o.insert("savings".into(), json!(0));
                        }
                        y
                    };
                    moved(&strip(&v), &strip(&was), 0)
                        || ["income", "savings"].iter().any(|m| {
                            let (a, b) = (v.get(*m).and_then(Json::as_i64).unwrap_or(0), was.get(*m).and_then(Json::as_i64).unwrap_or(0));
                            (a - b).abs() * 20 > b.abs().max(1)
                        })
                }
                Some(was) => moved(&v, &was, grain(&k)),
            };
            if changed {
                self.s.written.insert(k.clone(), super::packed::Packed::of(&v));
                set.insert(k, v);
            }
        }
        let since = self.s.inner.take_since();
        let because: Vec<Json> = since.iter().rev().take(16).rev().map(|r| serde_json::to_value(r).unwrap_or(Json::Null)).collect();
        if !set.is_empty() {
            let mut change = json!({ "set": set });
            if !because.is_empty() {
                change["because"] = Json::Array(because);
            }
            cx.set_record(change);
        }
    }
}

/// Whether a section has moved enough to be written again (citizen.ts `moved`).
fn moved(a: &Json, b: &Json, grain: i64) -> bool {
    match (a, b) {
        (Json::Number(x), Json::Number(y)) => (x.as_f64().unwrap_or(0.0) - y.as_f64().unwrap_or(0.0)).abs() > grain as f64,
        (Json::Object(x), Json::Object(y)) => x.len() != y.len() || x.iter().any(|(k, v)| y.get(k).map_or(true, |w| moved(v, w, grain))),
        (Json::Array(x), Json::Array(y)) => x.len() != y.len() || x.iter().zip(y).any(|(v, w)| moved(v, w, grain)),
        _ => a != b,
    }
}

fn pct(bps: i64) -> String {
    if bps % 100 == 0 {
        format!("{}", bps / 100)
    } else {
        format!("{}", bps as f64 / 100.0)
    }
}

