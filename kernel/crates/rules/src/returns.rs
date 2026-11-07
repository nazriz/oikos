//! The days returns of tax withheld from wages fall due (participants/src/behaviour/returns.ts; docs/behaviour/firms.md,
//! "Returns on the law's days"; docs/behaviour/public-finance.md).
//!
//! The tax law (a record its lawmaker publishes) lists its returns: which charges each reports, how often, and the day
//! of the month it is due by. Every payroll and the finance office's books call `next_return`: one function, from the
//! law on file and the day, so that nobody keeps a private counter and every employer's returns fall on the same days.
//! Nothing here holds any place's figures; every day is the law's, which a world's profile supplies.
//!
//! Two calendars. In a world with no calendar (the old towns) a date is "year 2, day 40": a year is twelve months of
//! 30 days counted from its first day (the twelfth takes the last five days of the year), and a quarter is three of
//! them (`next_return`, equal to the TS on the shared table `contracts/test/returns-calendar.json`). In a world with a
//! calendar (docs/design/names-and-dates.md) a month is the calendar's, a year starts in January, and a day the month
//! lacks is its last (`next_return_civil`): the port guide's rule that a month the law names is a calendar month.

use crate::calendar::{civil_from_days, days_from_civil, Calendar, Date};
use serde::{Deserialize, Serialize};
use oikos_core::Frozen;

const DAY: i64 = 86_400;
const YEAR: i64 = 365 * DAY;
pub const MONTHS_A_YEAR: i64 = 12;
const MONTH: i64 = 30 * DAY;

/// Where a return's day is counted from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum In {
    /// The day of the month after the period (the default).
    Following,
    /// The day of the period's last month (due within the month the pay was made in).
    Same,
}

/// A return the law asks: the charges it reports (left out: those no other return of the law reports), how many
/// months a period is (default 1), and the day it falls due by.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReturnRule {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub charges: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub every_months: Option<i64>,
    pub day: i64,
    #[serde(rename = "in", default, skip_serializing_if = "Option::is_none")]
    pub in_: Option<In>,
}

/// What a rule asks of a day: its period (from `from` up to `to`, seconds from the world's start) and the day it is due.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReturnDue {
    pub rule: ReturnRule,
    pub from: i64,
    pub to: i64,
    pub due: i64,
}

/// The return a charge falls under where the law names none: reported on the first day of the month after, monthly.
pub fn return_rest() -> ReturnRule {
    ReturnRule { id: "return-rest".into(), name: None, charges: None, every_months: None, day: 1, in_: Some(In::Following) }
}

/// A law's rules as the profile or the paper gives them, kept to what can be read (anything else is dropped).
/// `None` where the data is not a list.
pub fn return_rules_of(data: &Frozen) -> Option<Vec<ReturnRule>> {
    let list = data.as_array()?;
    Some(
        list.iter()
            .filter_map(|r| {
                let id = r.get("id")?.as_str()?.to_string();
                let day = r.get("day")?.as_i64()?;
                if !(1..=30).contains(&day) {
                    return None;
                }
                let every = match r.get("every_months") {
                    None | Some(Frozen::Null) => None,
                    Some(v) => {
                        let m = v.as_i64()?;
                        if ![1, 2, 3, 4, 6, 12].contains(&m) {
                            return None;
                        }
                        Some(m)
                    }
                };
                let in_ = match r.get("in") {
                    None | Some(Frozen::Null) => None,
                    Some(Frozen::String(s)) if &**s == "following" => Some(In::Following),
                    Some(Frozen::String(s)) if &**s == "same" => Some(In::Same),
                    Some(_) => return None,
                };
                Some(ReturnRule {
                    id,
                    name: r.get("name").and_then(|x| x.as_str()).map(String::from),
                    charges: r
                        .get("charges")
                        .and_then(|x| x.as_array())
                        .map(|a| a.iter().filter_map(|c| c.as_str().map(String::from)).collect()),
                    every_months: every,
                    day,
                    in_,
                })
            })
            .collect(),
    )
}

/// The returns a law has, each charge under exactly one: those the law names, and the rest under the open return (or
/// `return_rest`). `law`: the ids of its charges and its returns; no law: one rule for whatever is owed.
pub fn returns_of(law: Option<(&[&str], &[ReturnRule])>) -> Vec<ReturnRule> {
    let Some((charges, returns)) = law else { return vec![return_rest()] };
    let mut seen: Vec<&str> = vec![];
    let mut named = vec![];
    for r in returns.iter().filter(|r| r.charges.is_some()) {
        let mut mine = vec![];
        for c in r.charges.as_ref().unwrap() {
            if charges.contains(&c.as_str()) && !seen.contains(&c.as_str()) {
                seen.push(c.as_str());
                mine.push(c.clone());
            }
        }
        named.push(ReturnRule { charges: Some(mine), ..r.clone() });
    }
    let rest: Vec<String> = charges.iter().filter(|c| !seen.contains(c)).map(|c| c.to_string()).collect();
    if rest.is_empty() {
        return named;
    }
    let open = returns.iter().find(|r| r.charges.is_none()).cloned().unwrap_or_else(return_rest);
    named.push(ReturnRule { charges: Some(rest), ..open });
    named
}

/// Every period of a year and its months' starts, for a rule that spans `k` months (30-day months).
fn periods(year: i64, k: i64) -> Vec<(i64, i64, i64)> {
    let mut out = vec![];
    let mut m = 0;
    while m < MONTHS_A_YEAR {
        let last = m + k - 1;
        let to = if last == MONTHS_A_YEAR - 1 { (year + 1) * YEAR } else { year * YEAR + (last + 1) * MONTH };
        out.push((year * YEAR + m * MONTH, to, year * YEAR + last * MONTH));
        m += k;
    }
    out
}

/// The next return of a rule that falls due after the moment `after`: the period it reports and the day it is due
/// (the start of that day). Pure: the same law and day give the same answer to a payroll and to the books.
pub fn next_return(rule: &ReturnRule, after: i64) -> ReturnDue {
    let k = rule.every_months.unwrap_or(1).max(1);
    let day = rule.day.clamp(1, 30);
    let mut y = (after.div_euclid(YEAR) - 1).max(0);
    loop {
        for (from, to, last_month) in periods(y, k) {
            let base = if rule.in_ == Some(In::Same) { last_month } else { to };
            let due = base + (day - 1) * DAY;
            if due > after {
                return ReturnDue { rule: rule.clone(), from, to, due };
            }
        }
        y += 1;
    }
}

/// The days in the calendar month of a first-of-month day number.
fn month_len(year: i32, month: u8) -> i64 {
    let (ny, nm) = if month == 12 { (year + 1, 1) } else { (year, month + 1) };
    days_from_civil(Date { year: ny, month: nm, day: 1 }) - days_from_civil(Date { year, month, day: 1 })
}

fn first_of(year: i64, month0: i64) -> Date {
    // month0 may run past 11 (the month after December).
    let y = year + month0.div_euclid(12);
    Date { year: y as i32, month: (month0.rem_euclid(12) + 1) as u8, day: 1 }
}

/// `next_return` in a world with a calendar: calendar months, a year from January, and a day a month lacks is its last.
pub fn next_return_civil(cal: &Calendar, rule: &ReturnRule, after: i64) -> ReturnDue {
    let k = rule.every_months.unwrap_or(1).max(1);
    let day = rule.day.clamp(1, 30);
    let mut y = i64::from(cal.date(after).year) - 1;
    loop {
        let mut m = 0;
        while m < MONTHS_A_YEAR {
            let last = m + k - 1;
            let from = cal.moment(first_of(y, m));
            let to = cal.moment(first_of(y, last + 1));
            let base_month = if rule.in_ == Some(In::Same) { first_of(y, last) } else { first_of(y, last + 1) };
            let on = day.min(month_len(base_month.year, base_month.month));
            let due = cal.moment(Date { day: on as u8, ..base_month });
            if due > after {
                return ReturnDue { rule: rule.clone(), from, to, due };
            }
            m += k;
        }
        y += 1;
    }
}

/// The return of a rule that is due on the day `t` falls in, or the next, as the books look at it (a return due today
/// is still to come).
pub fn due_from(rule: &ReturnRule, t: i64) -> ReturnDue {
    next_return(rule, t.div_euclid(DAY) * DAY - 1)
}

/// `due_from` in a world with a calendar.
pub fn due_from_civil(cal: &Calendar, rule: &ReturnRule, t: i64) -> ReturnDue {
    next_return_civil(cal, rule, t.div_euclid(DAY) * DAY - 1)
}

/// A date as the old towns write one ("year 2, day 40"), for the words below.
pub fn return_day_words(t: i64) -> String {
    format!("year {}, day {}", t.div_euclid(YEAR) + 1, t.rem_euclid(YEAR) / DAY + 1)
}

/// A date as a world with a calendar writes the day of a return (ISO; lane N's words replace it through `when_words`).
pub fn return_civil_words(cal: &Calendar, t: i64) -> String {
    let d = civil_from_days(days_from_civil(cal.date(t)));
    format!("{:04}-{:02}-{:02}", d.year, d.month, d.day)
}

fn ordinal(n: i64) -> String {
    let suffix = if (11..=13).contains(&(n % 100)) {
        "th"
    } else {
        match n % 10 {
            1 => "st",
            2 => "nd",
            3 => "rd",
            _ => "th",
        }
    };
    format!("{n}{suffix}")
}

/// A rule in words, as the law says it. `charges`: the names of what it reports.
pub fn return_rule_in_words(r: &ReturnRule, charges: &str) -> String {
    let every = match r.every_months {
        None | Some(1) => "each month".to_string(),
        Some(3) => "each quarter".to_string(),
        Some(n) => format!("each {n} months"),
    };
    let when = if r.in_ == Some(In::Same) {
        format!("by the {} day of the month the pay was made in (the last month of the period)", ordinal(r.day))
    } else {
        format!("by the {} day of the month after", ordinal(r.day))
    };
    format!("{}: {charges} reported and paid over for {every}, {when}", r.name.as_deref().unwrap_or(&r.id))
}

/// What a month is, said once where the returns are (the old towns').
pub const MONTH_WORDS: &str =
    "A month here is 30 days counted from the year's first day, and the twelfth takes the last five days of the year.";

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use serde_json::json;

    #[test]
    fn the_shared_table_of_due_days() {
        let table: Value = serde_json::from_str(include_str!("../../../../contracts/test/returns-calendar.json")).unwrap();
        let cases = table["cases"].as_array().unwrap();
        assert!(cases.len() > 10);
        for c in cases {
            let rule = return_rules_of(&Frozen::from(json!([c["rule"].clone()]))).unwrap().remove(0);
            let r = next_return(&rule, c["after"].as_i64().unwrap() * DAY);
            let got = (r.due / DAY, r.from / DAY, r.to / DAY);
            assert_eq!(got, (c["due"].as_i64().unwrap(), c["from"].as_i64().unwrap(), c["to"].as_i64().unwrap()), "{c}");
        }
    }

    #[test]
    fn a_return_due_today_is_still_to_come_and_the_day_after_the_next_shows() {
        let rule = ReturnRule { id: "m9".into(), name: None, charges: None, every_months: None, day: 9, in_: None };
        assert_eq!(due_from(&rule, 38 * DAY + 3_600).due, 38 * DAY);
        assert_eq!(due_from(&rule, 39 * DAY).due, 68 * DAY);
    }

    #[test]
    fn rules_are_kept_to_what_can_be_read_and_every_charge_falls_under_exactly_one() {
        let rules = return_rules_of(&Frozen::from(json!([
            { "id": "a", "day": 9, "charges": ["x"] }, { "id": "bad", "day": 31 }, { "id": "q", "day": 3, "every_months": 5 },
            { "day": 2 }, { "id": "s", "day": 4, "in": "same", "every_months": 3 },
        ])))
        .unwrap();
        assert_eq!(rules.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(), ["a", "s"]);
        assert!(return_rules_of(&Frozen::from(json!({}))).is_none());
        let by = returns_of(Some((&["x", "y"][..], &rules[..1])));
        assert_eq!(by.iter().map(|r| (r.id.as_str(), r.day, r.charges.clone().unwrap())).collect::<Vec<_>>(), vec![
            ("a", 9, vec!["x".to_string()]),
            ("return-rest", 1, vec!["y".to_string()]),
        ]);
        assert_eq!(returns_of(None), vec![return_rest()]);
        let none = returns_of(Some((&["a", "b"][..], &[][..])));
        assert_eq!((none.len(), none[0].day, none[0].charges.clone().unwrap()), (1, 1, vec!["a".to_string(), "b".to_string()]));
    }

    #[test]
    fn in_a_world_with_a_calendar_a_month_is_the_calendars() {
        let cal = Calendar { start: Date { year: 2027, month: 1, day: 1 }, weekend: vec![5, 6], holidays: vec![] };
        let on = |d: Date| cal.moment(d);
        // Due by the 30th of the month after: February has 28 days in 2027, so the 28th.
        let rule = ReturnRule { id: "r".into(), name: None, charges: None, every_months: None, day: 30, in_: None };
        let r = next_return_civil(&cal, &rule, on(Date { year: 2027, month: 1, day: 30 }));
        assert_eq!(r.due, on(Date { year: 2027, month: 2, day: 28 }));
        assert_eq!((r.from, r.to), (on(Date { year: 2027, month: 1, day: 1 }), on(Date { year: 2027, month: 2, day: 1 })));
        // A quarter, due by the 28th of the month after it: the second quarter's is on 28 July.
        let q = ReturnRule { every_months: Some(3), day: 28, ..rule.clone() };
        let r = next_return_civil(&cal, &q, on(Date { year: 2027, month: 4, day: 28 }));
        assert_eq!(r.due, on(Date { year: 2027, month: 7, day: 28 }));
        assert_eq!(r.from, on(Date { year: 2027, month: 4, day: 1 }));
        // Within the month the pay was made in.
        let s = ReturnRule { in_: Some(In::Same), day: 26, ..rule };
        assert_eq!(next_return_civil(&cal, &s, 0).due, on(Date { year: 2027, month: 1, day: 26 }));
        // The last quarter reaches into January.
        let last = next_return_civil(&cal, &q, on(Date { year: 2027, month: 10, day: 28 }));
        assert_eq!(last.due, on(Date { year: 2028, month: 1, day: 28 }));
        assert_eq!(last.to, on(Date { year: 2028, month: 1, day: 1 }));
    }

    #[test]
    fn the_words_of_a_rule() {
        let r = ReturnRule { id: "r".into(), name: Some("Return".into()), charges: None, every_months: Some(3), day: 21, in_: Some(In::Same) };
        assert_eq!(
            return_rule_in_words(&r, "tax"),
            "Return: tax reported and paid over for each quarter, by the 21st day of the month the pay was made in (the last month of the period)"
        );
        assert_eq!(ordinal(12), "12th");
        assert_eq!(ordinal(22), "22nd");
        assert_eq!(return_day_words(40 * DAY + YEAR), "year 2, day 41");
    }
}
