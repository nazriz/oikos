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
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Date {
    pub year: i32,
    /// 1 to 12.
    pub month: u8,
    /// 1 to 31.
    pub day: u8,
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

const DAY: i64 = 86_400;

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
}
