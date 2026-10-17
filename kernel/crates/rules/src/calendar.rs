//! The world's calendar: a reading of the clock, as config data (docs/design/names-and-dates.md section 5). The
//! kernel's time stays seconds from the world's start; this maps a moment to a civil date by the real Gregorian
//! calendar from the world's start date, with the week and its days off and the holidays as the profile states them.
//! Pure, in one place for the actors and (through the N-API module) the generator and the seat-side tools. What a date
//! is written as in words is the profile's (`forms`), done by whoever renders for a seat, not here.
//!
//! The port's lane that owns names and dates (docs/port-guide.md, section 8) adds the config's `calendar` section,
//! the shared test file in `contracts/test/`, and writing and reading dates in words; the type and the arithmetic are
//! fixed here so every lane can count in civil days now.

use serde::{Deserialize, Serialize};

/// A civil date.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct Date {
    pub year: i32,
    /// 1 to 12.
    pub month: u8,
    /// 1 to 31.
    pub day: u8,
}

/// A date is read from the config as `"2026-03-12"` (how the config writes one) or as its parts.
impl<'de> Deserialize<'de> for Date {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Either {
            Iso(String),
            Parts { year: i32, month: u8, day: u8 },
        }
        let date = match Either::deserialize(d)? {
            Either::Parts { year, month, day } => Date { year, month, day },
            Either::Iso(s) => {
                let bad = || serde::de::Error::custom(format!("not a date (YYYY-MM-DD): {s}"));
                let mut it = s.split('-');
                let (y, m, dd) = (it.next(), it.next(), it.next());
                if it.next().is_some() || s.len() != 10 {
                    return Err(bad());
                }
                Date { year: y.and_then(|x| x.parse().ok()).ok_or_else(bad)?, month: m.and_then(|x| x.parse().ok()).ok_or_else(bad)?, day: dd.and_then(|x| x.parse().ok()).ok_or_else(bad)? }
            }
        };
        if !(1..=12).contains(&date.month) || date.day < 1 || date.day > days_in_month(date.year, date.month) {
            return Err(serde::de::Error::custom(format!("not a date: {}-{}-{}", date.year, date.month, date.day)));
        }
        Ok(date)
    }
}

/// A day of the week, Monday 0 to Sunday 6 (ISO 8601's order; which day a place calls first is the profile's).
pub type Weekday = u8;

/// Days from 1970-01-01 to a civil date (H. Hinnant, "chrono-compatible low-level date algorithms").
pub fn days_from_civil(d: Date) -> i64 {
    let y = i64::from(d.year) - i64::from(d.month <= 2);
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let m = i64::from(d.month);
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + i64::from(d.day) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// The civil date of a day counted from 1970-01-01.
pub fn civil_from_days(z: i64) -> Date {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u8;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u8;
    let year = (yoe + era * 400 + i64::from(month <= 2)) as i32;
    Date { year, month, day }
}

/// The world's calendar: its first day, the days a week has off, and its holidays (each a civil date, as the profile
/// lists them for the run's years: a holiday that moves is listed by its date each year).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Calendar {
    pub start: Date,
    /// The days of rest (Monday 0 .. Sunday 6).
    #[serde(default)]
    pub weekend: Vec<Weekday>,
    #[serde(default)]
    pub holidays: Vec<Date>,
}

/// How the place writes and reads a date (the profile's `calendar`: docs/design/names-and-dates.md section 5): a pattern
/// with `{d}` (day), `{dd}` (two digits), `{month}` (the month's name), `{m}` (its number), `{y}` (year) and, in the long
/// form, `{weekday}`; the twelve month names and seven weekday names (Monday first) in the language seats read. All of it
/// is the config's: the code holds no month name, so a world without a style writes ISO dates (`2026-03-12`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DateStyle {
    #[serde(default)]
    pub format: Option<String>,
    #[serde(default)]
    pub long_format: Option<String>,
    #[serde(default)]
    pub months: Vec<String>,
    #[serde(default)]
    pub weekdays: Vec<String>,
}

const DAY: i64 = 86_400;

/// Days in a month of a year.
pub fn days_in_month(year: i32, month: u8) -> u8 {
    let next = if month == 12 { Date { year: year + 1, month: 1, day: 1 } } else { Date { year, month: month + 1, day: 1 } };
    civil_from_days(days_from_civil(next) - 1).day
}

impl DateStyle {
    fn pattern(&self, long: bool) -> Option<&str> {
        let f = if long { self.long_format.as_deref().or(self.format.as_deref()) } else { self.format.as_deref() };
        (self.months.len() == 12).then_some(f).flatten()
    }

    /// The civil date of moment `t` in words, as the place writes one ("12 March 2026"); with `long`, with the weekday
    /// ("Thursday 12 March 2026"). A style with no pattern writes ISO ("2026-03-12").
    pub fn words(&self, cal: &Calendar, t: i64, long: bool) -> String {
        let d = cal.date(t);
        let Some(pattern) = self.pattern(long) else { return format!("{:04}-{:02}-{:02}", d.year, d.month, d.day) };
        let weekday = self.weekdays.get(usize::from(cal.weekday(t))).map_or("", String::as_str);
        pattern
            .replace("{weekday}", weekday)
            .replace("{month}", &self.months[usize::from(d.month) - 1])
            .replace("{dd}", &format!("{:02}", d.day))
            .replace("{d}", &d.day.to_string())
            .replace("{m}", &d.month.to_string())
            .replace("{y}", &d.year.to_string())
    }

    /// A date as a person writes it, read to the moment that day begins: in the place's order ("12 March 2026",
    /// "March 12, 2026", "12.03.2026"), with or without the weekday, "12th", a month's three-letter short form, a missing
    /// year (this year's: the year of `now`), or ISO ("2026-03-12"). Words round it ("on", "from") are the caller's. None:
    /// not a date (a day the month lacks, a year before 1000, anything else). No guessing between two readings: a numeric
    /// date is read in the place's order only, ISO excepted.
    pub fn parse(&self, cal: &Calendar, text: &str, now: i64) -> Option<i64> {
        #[derive(Debug, Clone, Copy)]
        enum Tok {
            Num(i64, usize),
            Month(u8),
        }
        let lower = text.trim().to_lowercase();
        let mut rest = lower.as_str();
        // A weekday first ("thursday, 12 march 2026").
        for w in &self.weekdays {
            let w = w.to_lowercase();
            let short: String = w.chars().take(3).collect();
            for cand in [w.as_str(), short.as_str()] {
                if let Some(r) = rest.strip_prefix(cand) {
                    if r.chars().next().is_none_or(|c| !c.is_alphanumeric()) {
                        rest = r.trim_start_matches([' ', ',', '.']);
                    }
                }
            }
        }
        let months: Vec<String> = self.months.iter().map(|m| m.to_lowercase()).collect();
        let mut toks: Vec<Tok> = vec![];
        let mut chars = rest.char_indices().peekable();
        while let Some(&(i, c)) = chars.peek() {
            if c.is_ascii_digit() {
                let mut j = i;
                while let Some(&(k, d)) = chars.peek() {
                    if d.is_ascii_digit() {
                        j = k + 1;
                        chars.next();
                    } else {
                        break;
                    }
                }
                let digits = &rest[i..j];
                toks.push(Tok::Num(digits.parse().ok()?, digits.len()));
            } else if c.is_alphabetic() {
                let mut j = i;
                while let Some(&(k, d)) = chars.peek() {
                    if d.is_alphabetic() {
                        j = k + d.len_utf8();
                        chars.next();
                    } else {
                        break;
                    }
                }
                let word = &rest[i..j];
                if matches!(word, "st" | "nd" | "rd" | "th" | "of" | "the") {
                    continue;
                }
                let m = months.iter().position(|m| m == word).or_else(|| {
                    // The short form: three letters or more of one month only ("mar", "sept").
                    let hits: Vec<usize> = months.iter().enumerate().filter(|(_, m)| word.chars().count() >= 3 && m.starts_with(word)).map(|(n, _)| n).collect();
                    (hits.len() == 1).then(|| hits[0])
                })?;
                toks.push(Tok::Month(m as u8 + 1));
            } else if matches!(c, ' ' | ',' | '.' | '-' | '/') {
                chars.next();
            } else {
                return None;
            }
        }
        let place_order = || -> Vec<char> {
            // The order of day, month, year in the place's pattern.
            let f = self.format.as_deref().unwrap_or("{y}-{m}-{d}");
            let mut at: Vec<(usize, char)> = vec![];
            for (tag, c) in [("{dd}", 'd'), ("{d}", 'd'), ("{month}", 'm'), ("{m}", 'm'), ("{y}", 'y')] {
                if let Some(i) = f.find(tag) {
                    at.push((i, c));
                }
            }
            at.sort();
            at.into_iter().map(|x| x.1).collect()
        };
        let year_now = i64::from(cal.date(now).year);
        let (d, m, y) = match toks.as_slice() {
            [Tok::Num(a, la), Tok::Month(m), Tok::Num(b, lb)] if *lb == 4 && *la <= 2 => (*a, i64::from(*m), *b),
            [Tok::Num(a, la), Tok::Month(m), Tok::Num(b, lb)] if *la == 4 && *lb <= 2 => (*b, i64::from(*m), *a),
            [Tok::Month(m), Tok::Num(a, la), Tok::Num(b, lb)] if *la <= 2 && *lb == 4 => (*a, i64::from(*m), *b),
            [Tok::Num(a, la), Tok::Month(m)] if *la <= 2 => (*a, i64::from(*m), year_now),
            [Tok::Month(m), Tok::Num(a, la)] if *la <= 2 => (*a, i64::from(*m), year_now),
            [Tok::Num(a, la), Tok::Num(b, lb), Tok::Num(c, lc)] => {
                if *la == 4 && *lb <= 2 && *lc <= 2 {
                    (*c, *b, *a)
                } else if *lc == 4 && *la <= 2 && *lb <= 2 {
                    match place_order().as_slice() {
                        ['m', 'd', 'y'] => (*b, *a, *c),
                        ['d', 'm', 'y'] => (*a, *b, *c),
                        _ => return None,
                    }
                } else {
                    return None;
                }
            }
            _ => return None,
        };
        if !(1000..=9999).contains(&y) || !(1..=12).contains(&m) || d < 1 || d > i64::from(days_in_month(y as i32, m as u8)) {
            return None;
        }
        Some(cal.moment(Date { year: y as i32, month: m as u8, day: d as u8 }))
    }
}

/// A calendar and the words it is written in, read together from the config's `calendar` section: what the resolver and
/// the seat-side tools hold (the actors hold the two parts in `WorldInfo`).
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Dated {
    pub calendar: Option<Calendar>,
    pub style: DateStyle,
}

impl Dated {
    /// From a config's `calendar` section; None where the world has none (or it is not a calendar).
    pub fn from_config(section: Option<&serde_json::Value>) -> Option<Dated> {
        let s = section?;
        Some(Dated { calendar: Some(serde_json::from_value(s.clone()).ok()?), style: serde_json::from_value(s.clone()).ok()? })
    }
    pub fn words(&self, t: i64, long: bool) -> Option<String> {
        self.calendar.as_ref().map(|c| self.style.words(c, t, long))
    }
    pub fn read(&self, text: &str, now: i64) -> Option<i64> {
        self.style.parse(self.calendar.as_ref()?, text, now)
    }
}

impl Calendar {
    /// The civil date of moment `t` (seconds from the world's start).
    pub fn date(&self, t: i64) -> Date {
        civil_from_days(days_from_civil(self.start) + t.div_euclid(DAY))
    }
    /// The moment a civil date begins (negative before the world's start).
    pub fn moment(&self, d: Date) -> i64 {
        (days_from_civil(d) - days_from_civil(self.start)) * DAY
    }
    /// The day of the week of moment `t`.
    pub fn weekday(&self, t: i64) -> Weekday {
        // (1970-01-01 was a Thursday: 3.)
        ((days_from_civil(self.date(t)) + 3).rem_euclid(7)) as Weekday
    }
    /// Whether moment `t` falls on a working day (not a day of rest, not a holiday).
    pub fn working_day(&self, t: i64) -> bool {
        !self.weekend.contains(&self.weekday(t)) && !self.holidays.contains(&self.date(t))
    }
    /// The first moment of the same day-of-month `months` later (the calendar's month, not 30 days); a day the month
    /// lacks is its last (31 January plus a month is 28 or 29 February).
    pub fn months_after(&self, t: i64, months: i64) -> i64 {
        let d = self.date(t);
        let m0 = i64::from(d.year) * 12 + i64::from(d.month) - 1 + months;
        let (year, month) = (m0.div_euclid(12) as i32, (m0.rem_euclid(12) + 1) as u8);
        let last = civil_from_days(
            days_from_civil(Date {
                year: if month == 12 { year + 1 } else { year },
                month: if month == 12 { 1 } else { month + 1 },
                day: 1,
            }) - 1,
        )
        .day;
        self.moment(Date { year, month, day: d.day.min(last) })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dates_weekdays_leap_years_and_calendar_months() {
        let c = Calendar {
            start: Date { year: 2026, month: 3, day: 12 },
            weekend: vec![5, 6],
            holidays: vec![Date { year: 2026, month: 4, day: 3 }],
        };
        assert_eq!(c.date(0), Date { year: 2026, month: 3, day: 12 });
        assert_eq!(c.weekday(0), 3, "12 March 2026 is a Thursday");
        assert!(c.working_day(0));
        assert!(!c.working_day(2 * DAY), "a Saturday");
        assert!(!c.working_day(c.moment(Date { year: 2026, month: 4, day: 3 })), "a holiday");
        assert_eq!(c.date(c.moment(Date { year: 2028, month: 2, day: 29 })), Date { year: 2028, month: 2, day: 29 });
        let jan31 = c.moment(Date { year: 2027, month: 1, day: 31 });
        assert_eq!(c.date(c.months_after(jan31, 1)), Date { year: 2027, month: 2, day: 28 });
        assert_eq!(c.date(c.months_after(jan31, 13)), Date { year: 2028, month: 2, day: 29 });
        for z in -800_000..800_000i64 {
            if z % 997 == 0 {
                assert_eq!(days_from_civil(civil_from_days(z)), z);
            }
        }
    }

    /// The shared cases (contracts/test/dates.json): what participants/src/calendar.ts is held to as well.
    #[test]
    fn dates_in_words_and_back_as_the_shared_cases_have_them() {
        let table: serde_json::Value = serde_json::from_str(include_str!("../../../../contracts/test/dates.json")).unwrap();
        let build = |name: &str| -> (Calendar, DateStyle) {
            let c = &table["calendars"][name];
            let d = c["start"].as_str().unwrap();
            let n = |a: usize, b: usize| d[a..b].parse::<u32>().unwrap();
            let cal = Calendar {
                start: Date { year: n(0, 4) as i32, month: n(5, 7) as u8, day: n(8, 10) as u8 },
                weekend: serde_json::from_value(c["weekend"].clone()).unwrap(),
                holidays: vec![],
            };
            (cal, serde_json::from_value(c.clone()).unwrap())
        };
        let now = table["now"].as_i64().unwrap();
        for w in table["words"].as_array().unwrap() {
            let (cal, style) = build(w["calendar"].as_str().unwrap());
            let t = w["t"].as_i64().unwrap();
            assert_eq!(style.words(&cal, t, w["long"].as_bool().unwrap()), w["text"].as_str().unwrap(), "{w}");
        }
        for r in table["reads"].as_array().unwrap() {
            let (cal, style) = build(r["calendar"].as_str().unwrap());
            assert_eq!(style.parse(&cal, r["text"].as_str().unwrap(), now), r["at"].as_i64(), "{r}");
        }
        for r in table["refused"].as_array().unwrap() {
            let (cal, style) = build(r["calendar"].as_str().unwrap());
            assert_eq!(style.parse(&cal, r["text"].as_str().unwrap(), now), None, "{r}");
        }
    }
}
