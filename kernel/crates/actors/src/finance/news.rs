//! firm.newspaper: the local paper's editor (participants/src/behaviour/news.ts; docs/behaviour/news.md; docs/design/
//! world-expansion.md 3.2). It reads the public record, and each week runs the most newsworthy items: a statement each,
//! put forward to be believed (an assertion), saying whether it is about the town's government and whether it reflects well
//! or badly on it (tone). The facts are the records'; what it runs, and how it judges what is a matter of judgement, are its
//! own (its leaning).
//!
//! **What changed from TS's 0.1.0, and why (risk register PC-7, A-3).** The paper only ever hurt the government: a petition
//! and a complaint were always tone -1, an environment report -1 on a fall and never +1 on a recovery, and no kind of item
//! could be good news. That is a kind-by-kind constant, not what a local paper does. A local paper reports what the record
//! shows, and whether it reads well or badly for the town's government is what the record shows: a request met or turned
//! down, a service delivered or not, a species recovering or falling. So here the tone of an item is decided by the record's
//! content, by one rule for every kind (below), and what the paper chooses to run is the news value of the item (its
//! weight: magnitude, conflict and relevance, after Galtung and Ruge 1965; Harcup and O'Neill 2001, 2017, who list both
//! "bad news" and "good news" among what makes news), tipped by the paper's leaning (slant by selection: Gentzkow and
//! Shapiro 2010) and by a premium for negative stories (`negativity_bps`: audiences attend more to negative news, Soroka and
//! McAdams 2015, Trussler and Soroka 2014; the premium's size is the profile's to source, so it is nought here). A town that
//! answers its petitions and grants what it can will read well; one that does not will read badly, and the steward sees it.
//! The old coin that let the leaning decide the tone of a neutral item is gone: a paper with a slant chooses and orders
//! stories, it does not make a neutral record bad or good (a framing effect, if wanted, is a want of its own, not a draw).
//!
//! The tone of an item (all the same for every town; the figure is a parameter): a petition is residents pressing the town
//! (-1); a complaint is a service not delivered (-1); the answer to a petition that puts it to the council is the town
//! delivering (+1), one that only says what the law already is, neutral; a permit granted is a request met (+1), one
//! refused a request turned down (-1); an environment report is -1 if any species fell by `change_bps` (20%: one standard
//! deviation of survey noise for a species found 15 at a time) or more and none rose as much, +1 if any rose as much and none
//! fell as much, and 0 otherwise; budgets, laws, ballot results, election notices and nominations are the process, 0.

use super::{manifest_of, spread};
use crate::common::{data, filed_before, text, Book, Fields, Answering, DAY};
use crate::steps::{because, say, Plan, Say, Step, Stepper, Visible};
use crate::{Actor, Ctx, Cx, Kind, Picture};
use oikos_rules::forms::Answers;
use oikos_sight::Record;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeSet;

pub struct Newspaper;

const MANIFEST: &str = include_str!("manifests/firm.newspaper.json");

const ANSWERS: (&str, &str) = ("the paper's editor", "The paper reports the public record. It prints no letters.");

fn answers() -> Answers {
    Answers { office: ANSWERS.0.into(), acts: ANSWERS.1.into(), forms: vec![], report: false }
}

/// What makes an item news, by the kind of record (placeholders): its weight, after news values.
const KINDS: &[(&str, i64)] = &[
    ("petition", 3),
    ("petition_response", 2),
    ("complaint", 1),
    ("environment_report", 2),
    ("budget", 2),
    ("law", 2),
    ("ballot_result", 4),
    ("election_notice", 3),
    ("nomination", 2),
    ("permit_decision", 1),
];

fn clip(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

fn headline(kind: &str, r: &Record) -> String {
    let words = text(r);
    match kind {
        "petition" => format!("Residents petition the town: {}", clip(words, 160)),
        "petition_response" => format!("The town answers a petition: {}", clip(words, 160)),
        "complaint" => "A resident complains to the town about a service.".to_string(),
        "environment_report" => format!("The environment office reports: {}", clip(words, 200)),
        "budget" => format!("The council adopts the town's budget: {}", clip(words, 160)),
        "law" => format!("A new law: {}", clip(words, 200)),
        "nomination" => format!("A candidate stands: {}", clip(words, 200)),
        // (An election's result, its notice and a permit decision are told in the record's own words.)
        _ => clip(words, 220),
    }
}

/// Whether an item reflects well (+1), badly (-1) or neither (0) on the town's government, from what the record shows.
pub fn tone_of(kind: &str, r: &Record, change_bps: i64) -> i64 {
    match kind {
        "petition" | "complaint" => -1,
        "petition_response" => i64::from(data(r).s("answer").is_some_and(|a| a.contains("put to the council"))),
        "permit_decision" => match data(r).s("decision") {
            Some("granted") => 1,
            Some("refused") => -1,
            _ => 0,
        },
        "environment_report" => {
            let changes: Vec<i64> = data(r).get("species").and_then(|x| x.as_object()).map(|o| o.values().map(|s| s.i("change_bps").unwrap_or(0)).collect()).unwrap_or_default();
            let (fell, rose) = (changes.iter().any(|c| *c <= -change_bps), changes.iter().any(|c| *c >= change_bps));
            match (fell, rose) {
                (true, false) => -1,
                (false, true) => 1,
                (true, true) => -1,
                _ => 0,
            }
        }
        _ => 0,
    }
}

#[derive(Serialize, Deserialize)]
struct Paper {
    participant: String,
    /// The government it reports on (the world must say).
    town: String,
    /// Its rhythm: an edition a week, by an editor and reporters who are paid and whose time it takes.
    every_days: i64,
    items_per_edition: usize,
    /// -10,000 against the town's government to 10,000 for it (placeholder: none).
    leaning_bps: i64,
    /// A premium for a story that reflects badly on the town, over one of equal weight that does not (placeholder: none).
    negativity_bps: i64,
    /// A species' change that counts as a rise or a fall.
    change_bps: i64,
    book: Book,
    /// Records already reported.
    run: BTreeSet<String>,
    next: i64,
    edition: i64,
}

impl Kind for Newspaper {
    fn name(&self) -> &'static str {
        "firm.newspaper"
    }
    fn version(&self) -> &'static str {
        "0.2.0"
    }
    fn doc(&self) -> &'static str {
        "docs/behaviour/news.md"
    }
    fn manifest(&self) -> Value {
        let mut m = manifest_of(MANIFEST);
        m["version"] = self.version().into();
        m["answers"] = json!({ "office": ANSWERS.0, "acts": ANSWERS.1 });
        m["params"]["negativity_bps"] = json!({ "schema": { "type": "integer", "description": "a premium for a story that reflects badly on the town, over one of equal weight that does not" }, "unit": "bps", "default": 0, "source": "placeholder: Soroka and McAdams 2015 give the direction, not a size" });
        m["params"]["change_bps"] = json!({ "schema": { "type": "integer", "description": "a species' change in an environment report that counts as a fall or a rise" }, "unit": "bps", "default": 2000, "source": "placeholder: one standard deviation of survey noise" });
        m
    }
    fn cadence(&self, _: &Ctx) -> i64 {
        DAY
    }
    fn first_wake(&self, ctx: &Ctx) -> i64 {
        6 * 3600 + spread(ctx, "first-wake", 3600)
    }
    fn create(&self, ctx: &Ctx) -> Result<Box<dyn Actor>, String> {
        let town: String = ctx.need("town", "firm.newspaper")?;
        let paper = Paper {
            participant: ctx.participant.clone(),
            town,
            every_days: ctx.param("every_days", 7)?,
            items_per_edition: ctx.param::<i64>("items_per_edition", 5)?.max(0) as usize,
            leaning_bps: ctx.param("leaning_bps", 0)?,
            negativity_bps: ctx.param("negativity_bps", 0)?,
            change_bps: ctx.param("change_bps", 2000)?,
            book: Book::new(),
            run: BTreeSet::new(),
            next: (1 + spread(ctx, "first-edition", 7)) * DAY,
            edition: 0,
        };
        Ok(Box::new(Answering::new(Stepper::new(paper), answers())))
    }
    fn restore(&self, _: &Ctx, saved: Value) -> Result<Box<dyn Actor>, String> {
        let inner = Stepper::<Paper>::restore(saved.get("inner").cloned().ok_or("firm.newspaper: nothing saved")?)?;
        Ok(Box::new(Answering::restore(inner, answers(), &saved)?))
    }
}

impl Plan for Paper {
    type Then = ();

    fn absorb(&mut self, pic: &Picture, _: &mut Cx) {
        self.book.absorb(pic);
    }

    fn plan(&mut self, pic: &Picture, _: &mut Cx) -> Vec<Step<()>> {
        let t = pic.t;
        if t < self.next {
            return vec![];
        }
        self.next = t + self.every_days * DAY;
        // What is new on the record, scored: its news value, tipped by our leaning (a paper for the government runs more of
        // what reflects well on it, and less of what does not) and by the premium on bad news.
        struct Item {
            r: std::sync::Arc<Record>,
            kind: &'static str,
            tone: i64,
            score: i64,
            headline: String,
        }
        let mut items: Vec<Item> = vec![];
        for (kind, weight) in KINDS {
            for r in self.book.open(kind) {
                if self.run.contains(r.id.as_str()) || r.author == self.participant {
                    continue;
                }
                let tone = tone_of(kind, r, self.change_bps);
                let mut score = *weight * 1000 * (10_000 + tone * self.leaning_bps) / 10_000;
                if tone < 0 {
                    score = score * (10_000 + self.negativity_bps) / 10_000;
                }
                items.push(Item { r: r.clone(), kind, tone, score: score + r.at.rem_euclid(1000), headline: headline(kind, r) });
            }
        }
        items.sort_by(|a, b| b.score.cmp(&a.score).then_with(|| filed_before(&a.r.id, &b.r.id)));
        for x in &items {
            self.run.insert(x.r.id.to_string());
        }
        let chosen = &items[..items.len().min(self.items_per_edition)];
        if chosen.is_empty() {
            return vec![]; // nothing new on the record: no edition this week
        }
        self.edition += 1;
        let calls = chosen
            .iter()
            .map(|x| {
                say(
                    "news",
                    &x.headline,
                    Say {
                        visible: Some(Visible::Public),
                        basis: Some(x.r.id.to_string()),
                        data: Some(json!({ "kind": x.kind, "tone": x.tone, "about_office": x.kind != "ballot_result" && x.kind != "nomination", "edition": self.edition })),
                        extra: vec![("assertion", json!({ "that": x.headline, "about": [self.town] }))],
                        ..Default::default()
                    },
                )
            })
            .collect();
        vec![because(format!("Edition {}: the {} most newsworthy items of {} new on the record.", self.edition, chosen.len(), items.len()), calls)]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::finance::kit::{arg, json_arg, records, statement, Rig, DAY};
    use oikos_sight::calls::Call;

    fn editor(params: Value) -> Rig {
        let mut p = json!({ "town": "city" });
        p.as_object_mut().unwrap().extend(params.as_object().unwrap().clone());
        Rig::new(&Newspaper, "paper", "editor-system", p)
    }
    fn edition(m: &mut Rig, t: i64, rs: Vec<Value>) -> Vec<Call> {
        m.at(t, json!({ "record": records(rs) }), json!([]))
    }
    const T0: i64 = 2 * DAY;
    fn rec(id: &str, at: i64, kind: &str, text: &str, who: Value, data: Value) -> Value {
        let mut r = statement(id, at, kind, who, data);
        r["text"] = text.into();
        r
    }
    /// One public record of each kind the paper counts as news. (Records of a weight tie by the last three digits of the
    /// second they were made: `at` here orders them within a weight.)
    fn records_of_every_kind() -> Vec<Value> {
        vec![
            rec("r-result", T0 + 1, "ballot_result", "Passed: 5 for, 0 against.", json!({}), json!({})),
            rec("r-petition", T0 + 9, "petition", "Petition: cap rent rises.", json!({ "author": "c1-self", "speaks_for": "c1" }), json!({})),
            rec("r-notice", T0 + 8, "election_notice", "Election notice.", json!({}), json!({})),
            rec("r-env", T0 + 7, "environment_report", "Trout are down.", json!({}), json!({ "species": { "trout": { "change_bps": -2000 }, "heron": { "change_bps": 300 } } })),
            rec("r-budget", T0 + 6, "budget", "The town's budget for year 1.", json!({}), json!({})),
            rec("r-law", T0 + 5, "law", "Sixty days' notice.", json!({}), json!({})),
            rec("r-nomination", T0 + 4, "nomination", "Standing for mayor.", json!({ "author": "c2-self", "speaks_for": "c2" }), json!({})),
            rec("r-complaint", T0 + 3, "complaint", "The bins.", json!({ "author": "c3-self", "speaks_for": "c3" }), json!({})),
            rec("r-permit", T0 + 2, "permit_decision", "Permit granted.", json!({}), json!({ "decision": "granted" })),
        ]
    }
    fn basis(said: &[Call]) -> Vec<String> {
        said.iter().map(|c| arg(c, "basis").unwrap()).collect()
    }
    fn items(said: &[Call]) -> Vec<Value> {
        said.iter().map(|c| json_arg(c, "data")).collect()
    }
    fn tone_of_each(said: &[Call]) -> std::collections::BTreeMap<String, i64> {
        items(said).iter().map(|i| (i["kind"].as_str().unwrap().to_string(), i["tone"].as_i64().unwrap())).collect()
    }

    #[test]
    fn an_edition_runs_the_most_newsworthy_new_records_by_the_weight_of_their_kind() {
        let mut m = editor(json!({ "items_per_edition": 9 }));
        let mut rs = records_of_every_kind();
        rs.push(statement("r-price", T0, "price_list", json!({}), json!({})));
        rs.push(statement("r-own", T0, "petition", json!({ "author": "editor-system", "speaks_for": "paper" }), json!({})));
        let said = edition(&mut m, 8 * DAY, rs);
        assert_eq!(basis(&said), ["r-result", "r-petition", "r-notice", "r-env", "r-budget", "r-law", "r-nomination", "r-complaint", "r-permit"].map(String::from));
        for c in &said {
            assert_eq!((c.fn_.as_str(), arg(c, "kind").unwrap(), arg(c, "visible").unwrap()), ("statement", "news".to_string(), "public".to_string()));
            assert_eq!(json_arg(c, "assertion")["about"], json!(["city"]));
            assert_eq!(json_arg(c, "assertion")["that"], json!(arg(c, "text").unwrap()));
            assert_eq!(json_arg(c, "data")["edition"], 1);
        }
        assert_eq!(arg(&said[1], "text").unwrap(), "Residents petition the town: Petition: cap rent rises.");
        // The default edition: the five weightiest.
        assert_eq!(basis(&edition(&mut editor(json!({})), 8 * DAY, records_of_every_kind())), ["r-result", "r-petition", "r-notice", "r-env", "r-budget"].map(String::from));
    }

    #[test]
    fn the_tone_of_an_item_is_what_the_record_shows_one_rule_for_every_kind() {
        let said = edition(&mut editor(json!({ "items_per_edition": 9 })), 8 * DAY, records_of_every_kind());
        let tone = tone_of_each(&said);
        assert_eq!(tone["petition"], -1);
        assert_eq!(tone["complaint"], -1);
        assert_eq!(tone["environment_report"], -1, "a species fell by a fifth");
        assert_eq!(tone["permit_decision"], 1, "a request met");
        for neutral in ["ballot_result", "election_notice", "budget", "law", "nomination"] {
            assert_eq!(tone[neutral], 0, "{neutral}");
        }
        assert_eq!(items(&said).iter().filter(|i| i["about_office"] == false).map(|i| i["kind"].as_str().unwrap().to_string()).collect::<Vec<_>>(), ["ballot_result", "nomination"]);
    }

    #[test]
    fn good_news_is_news_a_recovery_a_petition_taken_up_a_permit_granted_so_the_paper_can_read_well_for_a_town_that_does_well() {
        let rs = vec![
            rec("e1", T0 + 1, "environment_report", "Trout are back.", json!({}), json!({ "species": { "trout": { "change_bps": 2500 } } })),
            rec("e2", T0 + 2, "environment_report", "Mixed.", json!({}), json!({ "species": { "trout": { "change_bps": 2500 }, "heron": { "change_bps": -2500 } } })),
            rec("e3", T0 + 3, "environment_report", "Steady.", json!({}), json!({ "species": { "trout": { "change_bps": 300 } } })),
            rec("p1", T0 + 4, "petition_response", "Answer to petition x: put.", json!({}), json!({ "answer": "what it asks has been put to the council as an amendment" })),
            rec("p2", T0 + 5, "petition_response", "Answer to petition y: the law says so.", json!({}), json!({ "answer": "the law in force (law-1) already says what it asks." })),
            rec("d1", T0 + 6, "permit_decision", "Permit refused.", json!({}), json!({ "decision": "refused" })),
        ];
        let said = edition(&mut editor(json!({ "items_per_edition": 9 })), 8 * DAY, rs);
        let by: std::collections::BTreeMap<String, i64> = said.iter().map(|c| (arg(c, "basis").unwrap(), json_arg(c, "data")["tone"].as_i64().unwrap())).collect();
        assert_eq!(by, [("e1", 1), ("e2", -1), ("e3", 0), ("p1", 1), ("p2", 0), ("d1", -1)].map(|(k, v)| (k.to_string(), v)).into_iter().collect());
        // The same rule for a town where more goes well than ill: the print has both signs, and it follows the record.
        assert!(items(&said).iter().any(|i| i["tone"] == 1) && items(&said).iter().any(|i| i["tone"] == -1));
    }

    #[test]
    fn a_town_that_answers_its_petitions_reads_better_than_one_that_does_not_with_the_same_paper() {
        let petitions = |answered: bool| {
            let mut rs = vec![rec("pet", T0 + 1, "petition", "Petition.", json!({ "author": "c1-self", "speaks_for": "c1" }), json!({}))];
            if answered {
                rs.push(rec("ans", T0 + 2, "petition_response", "Answered.", json!({}), json!({ "answer": "put to the council" })));
            }
            let said = edition(&mut editor(json!({})), 8 * DAY, rs);
            items(&said).iter().map(|i| i["tone"].as_i64().unwrap()).sum::<i64>()
        };
        assert!(petitions(true) > petitions(false));
    }

    #[test]
    fn an_edition_every_every_days_of_whats_new_since_the_last_none_in_a_week_with_nothing_new() {
        let mut m = editor(json!({ "items_per_edition": 2, "every_days": 7 }));
        let first = edition(&mut m, 8 * DAY, records_of_every_kind());
        assert_eq!(basis(&first), ["r-result", "r-petition"].map(String::from));
        // Not again within the week, whatever comes in.
        let late = rec("r-late", 9 * DAY, "law", "A late law.", json!({}), json!({}));
        assert!(edition(&mut m, 9 * DAY, vec![late]).is_empty());
        assert!(edition(&mut m, 14 * DAY, vec![]).is_empty());
        // A week on: only what is new since (the seven it passed over last week are old news), as edition 2.
        let second = edition(&mut m, 15 * DAY, vec![]);
        assert_eq!(basis(&second), ["r-late".to_string()]);
        assert_eq!(json_arg(&second[0], "data")["edition"], 2);
        // A week with nothing new: no edition; the next one is edition 3.
        assert!(edition(&mut m, 22 * DAY, vec![]).is_empty());
        let third = edition(&mut m, 29 * DAY, vec![rec("r-next", 25 * DAY, "budget", "Next year's.", json!({}), json!({}))]);
        assert_eq!(json_arg(&third[0], "data")["edition"], 3);
    }

    #[test]
    fn the_leaning_tips_what_is_run_and_in_what_order_and_never_decides_the_tone_of_a_neutral_record() {
        // Wholly against the government: what reflects badly on it counts double, so a complaint (weight 1) runs level with the
        // weight-2 items.
        let against = edition(&mut editor(json!({ "leaning_bps": -10_000, "items_per_edition": 9 })), 8 * DAY, records_of_every_kind());
        let b = basis(&against);
        assert_eq!(b.last().unwrap(), "r-permit", "good news counts for nothing to it");
        // A refusal (weight 1, bad) against a law (weight 2, neutral): level for a paper wholly against the government, so the
        // later made runs first; behind it for a paper with no leaning.
        let pair = || vec![rec("law", T0 + 1, "law", "A law.", json!({}), json!({})), rec("refusal", T0 + 9, "permit_decision", "Refused.", json!({}), json!({ "decision": "refused" }))];
        assert_eq!(basis(&edition(&mut editor(json!({ "leaning_bps": -10_000, "items_per_edition": 2 })), 8 * DAY, pair())), ["refusal", "law"].map(String::from));
        assert_eq!(basis(&edition(&mut editor(json!({ "items_per_edition": 2 })), 8 * DAY, pair())), ["law", "refusal"].map(String::from));
        // Wholly for it: what reflects badly on it counts for nothing and runs last.
        let for_it = edition(&mut editor(json!({ "leaning_bps": 10_000, "items_per_edition": 9 })), 8 * DAY, records_of_every_kind());
        let last: std::collections::BTreeSet<String> = basis(&for_it)[6..].iter().cloned().collect();
        assert_eq!(last, ["r-complaint", "r-env", "r-petition"].map(String::from).into_iter().collect());
        // And no draw is left in it: a budget is told as neutral by any paper, however it leans, and the tone is the same in every paper.
        let budget = vec![rec("r-b", T0, "budget", "The budget.", json!({}), json!({}))];
        for leaning in [-10_000, -3000, 0, 3000, 10_000] {
            for who in ["editor-system", "other-paper-system"] {
                let mut m = Rig::new(&Newspaper, "paper", who, json!({ "town": "city", "leaning_bps": leaning }));
                assert_eq!(items(&edition(&mut m, 8 * DAY, budget.clone()))[0]["tone"], 0);
            }
        }
        for t in tone_of_each(&for_it).values().chain(tone_of_each(&against).values()) {
            assert!([-1, 0, 1].contains(t));
        }
    }

    #[test]
    fn a_premium_on_bad_news_puts_it_ahead_of_equally_weighty_good_news_and_none_by_default() {
        let rs = || {
            vec![
                rec("good", T0 + 1, "permit_decision", "Granted.", json!({}), json!({ "decision": "granted" })),
                rec("bad", T0, "permit_decision", "Refused.", json!({}), json!({ "decision": "refused" })),
            ]
        };
        // With no premium, equal weight: the tie-break (the second it was made) puts the later first.
        assert_eq!(basis(&edition(&mut editor(json!({ "items_per_edition": 2 })), 8 * DAY, rs())), ["good", "bad"].map(String::from));
        // With a premium, the bad runs first.
        assert_eq!(basis(&edition(&mut editor(json!({ "items_per_edition": 2, "negativity_bps": 2000 })), 8 * DAY, rs())), ["bad", "good"].map(String::from));
    }

    #[test]
    fn it_saves_and_restores_exactly() {
        let mut m = editor(json!({ "items_per_edition": 3 }));
        edition(&mut m, 8 * DAY, records_of_every_kind());
        let mut twin = editor(json!({ "items_per_edition": 3 }));
        edition(&mut twin, 8 * DAY, records_of_every_kind());
        m.snapshot_round_trip();
        let late = || vec![rec("r-late", 9 * DAY, "law", "A late law.", json!({}), json!({}))];
        for day in [15, 22] {
            assert_eq!(format!("{:?}", edition(&mut m, day * DAY, late())), format!("{:?}", edition(&mut twin, day * DAY, late())));
        }
    }
}
