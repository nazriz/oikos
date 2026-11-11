//! A form that writes a paper: the twin of `participants/src/forms.ts`, step for step, held to
//! `contracts/test/forms.json` (contracts/outcomes.schema.json, FormData `writes`; docs/behaviour/office-papers.md).
//! The writing itself is the rules crate's (`oikos_rules::form_papers`, since 2026-11-11: so that the code assistant
//! fills the same form a model fills, docs/design/broad-seats.md, G2); the reading of dates a seat writes stays here.

use oikos_rules::calendar::Dated;

const DAY: i64 = 86_400;

pub use oikos_rules::form_papers::{date_words, date_words_in, write_claim, write_paper};

/// `parse_date`, reading the world's calendar first ("12 March 2026", ISO), then the old "year N, day D".
pub fn parse_date_in(s: &str, now: i64, dated: Option<&Dated>) -> Result<i64, String> {
    if let Some(t) = dated.and_then(|d| d.read(s, now)) {
        return Ok(t);
    }
    parse_date(s).map_err(|e| match dated.and_then(|d| d.words(now, false)) {
        Some(example) => format!("not a date: {s}. A date is written like \"{example}\"."),
        None => e,
    })
}

fn not_a_date(s: &str) -> String {
    format!("not a date: {s}. A date is written like \"year 1, day 12\".")
}

/// A date as written ("year 2, day 40", or "day 40" of the first year): the moment that day begins. Bare digits are
/// a moment as a record has it, in seconds.
pub fn parse_date(s: &str) -> Result<i64, String> {
    // (The same date with its day first: "day 30 of year 1". 2026-11-10: two readers wrote one date both ways.)
    let lower = s.trim().to_lowercase().split_whitespace().collect::<Vec<_>>().join(" ");
    if let Some(turned) = crate::calls::day_first(&lower) {
        return parse_date(&turned);
    }
    let t = s.trim();
    if (1..=15).contains(&t.len()) && t.bytes().all(|b| b.is_ascii_digit()) {
        return Ok(t.parse().unwrap_or_default());
    }
    let digits = |rest: &str, max: usize| -> Option<(i64, usize)> {
        let n = rest.bytes().take_while(u8::is_ascii_digit).count();
        if n == 0 || n > max {
            None
        } else {
            Some((rest[..n].parse().ok()?, n))
        }
    };
    let word = |rest: &str, w: &str| rest.get(..w.len()).is_some_and(|p| p.eq_ignore_ascii_case(w));
    let mut rest = s.trim_start();
    let (mut year, mut day) = (None, None);
    if word(rest, "year") {
        let after = rest[4..].trim_start();
        let Some((n, len)) = digits(after, 6) else { return Err(not_a_date(s)) };
        year = Some(n);
        rest = after[len..].trim_start();
    }
    if let Some(r) = rest.strip_prefix(',') {
        rest = r.trim_start();
    }
    if word(rest, "day") {
        let after = rest[3..].trim_start();
        let Some((n, len)) = digits(after, 3) else { return Err(not_a_date(s)) };
        day = Some(n);
        rest = after[len..].trim_start();
    }
    // A day may be followed by a time of day, as the town's own papers write a moment ("year 1, day 289, 13:00").
    let mut of_day = 0;
    if day.is_some() && !rest.is_empty() {
        let at = rest.strip_prefix(',').map_or(rest, str::trim_start);
        let Some((h, hl)) = digits(at, 2) else { return Err(not_a_date(s)) };
        let Some(after) = at[hl..].strip_prefix(':') else { return Err(not_a_date(s)) };
        let two = |x: &str| -> Option<i64> { (x.len() >= 2 && x.as_bytes()[..2].iter().all(u8::is_ascii_digit)).then(|| x[..2].parse().ok()).flatten() };
        let Some(m) = two(after) else { return Err(not_a_date(s)) };
        let mut tail = &after[2..];
        let mut sec = 0;
        if let Some(x) = tail.strip_prefix(':') {
            let Some(v) = two(x) else { return Err(not_a_date(s)) };
            sec = v;
            tail = &x[2..];
        }
        if h > 23 || m > 59 || sec > 59 {
            return Err(not_a_date(s));
        }
        of_day = h * 3_600 + m * 60 + sec;
        rest = tail.trim_start();
    }
    if !rest.is_empty() || (year.is_none() && day.is_none()) {
        return Err(not_a_date(s));
    }
    let (year, day) = (year.unwrap_or(1), day.unwrap_or(1));
    if year < 1 || !(1..=365).contains(&day) {
        return Err(not_a_date(s));
    }
    Ok(((year - 1) * 365 + (day - 1)) * DAY + of_day)
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::calls::{parse_when_in, When};
    use serde_json::Value as Json;

    /// A world with a calendar reads and writes the place's dates, and still reads the old ones.
    #[test]
    fn dates_in_the_worlds_calendar() {
        let table: Json = serde_json::from_str(include_str!("../../../../contracts/test/dates.json")).unwrap();
        let dated = Dated::from_config(Some(&table["calendars"]["dmy"])).unwrap();
        let day = 86_400;
        let now = 21 * day; // 2 April 2026
        assert_eq!(date_words_in(0, Some(&dated)), "12 March 2026");
        assert_eq!(date_words_in(0, None), "year 1, day 1");
        assert_eq!(parse_date_in("15 April 2026", now, Some(&dated)), Ok(34 * day));
        assert_eq!(parse_date_in("year 1, day 22", now, Some(&dated)), Ok(21 * day), "an old paper still reads");
        assert_eq!(parse_date_in("15 April", now, Some(&dated)), Ok(34 * day), "this year's");
        assert_eq!(parse_date_in("31 February 2026", now, Some(&dated)).unwrap_err(), "not a date: 31 February 2026. A date is written like \"2 April 2026\".");
        assert!(parse_date_in("15 April 2026", now, None).is_err(), "no calendar: no such dates");
        assert_eq!(parse_when_in("from 15 April 2026", now, Some(&dated)), Ok(When::At(34 * day)));
        assert_eq!(parse_when_in("on the 3rd of May", now, Some(&dated)), Ok(When::At(52 * day)));
        assert_eq!(parse_when_in("in 14 days", now, Some(&dated)), Ok(When::In(14 * day)));
        assert_eq!(parse_when_in("a fortnight", now, Some(&dated)), Ok(When::In(14 * day)));
        assert_eq!(parse_when_in("year 1, day 40", now, Some(&dated)), Ok(When::At(39 * day)));
    }
}
