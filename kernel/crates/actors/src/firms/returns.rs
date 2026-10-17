//! The days returns of tax withheld from wages fall due (ported from participants/src/behaviour/returns.ts;
//! docs/behaviour/firms.md, "Returns on the law's days"). The calendar function is `oikos_rules::returns` (pure, held
//! to the TS on `contracts/test/returns-calendar.json`); every payroll and the finance office's books call it here, so
//! that nobody keeps a private counter and every employer's returns fall on the same days. In a world with a calendar,
//! `due_on` gives the civil month's day (docs/port-guide.md: a month the law names is a calendar month).

use crate::WorldInfo;
pub use oikos_rules::returns::{
    due_from, due_from_civil, next_return, next_return_civil, return_civil_words, return_day_words, return_rest, return_rule_in_words, return_rules_of,
    returns_of, In, ReturnDue, ReturnRule, MONTH_WORDS,
};

/// The next return of a rule after `after`, in the world's own months: the calendar's where it has one.
pub fn due_on(world: &WorldInfo, rule: &ReturnRule, after: i64) -> ReturnDue {
    match &world.calendar {
        Some(cal) => next_return_civil(cal, rule, after),
        None => next_return(rule, after),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use oikos_rules::calendar::{Calendar, Date};

    #[test]
    fn a_world_with_a_calendar_files_by_its_months_and_one_without_by_thirty_days() {
        let rule = ReturnRule { id: "m9".into(), name: None, charges: None, every_months: None, day: 9, in_: None };
        let old = WorldInfo::default();
        assert_eq!(due_on(&old, &rule, 0).due, 38 * 86_400);
        let cal = Calendar { start: Date { year: 2027, month: 1, day: 1 }, weekend: vec![], holidays: vec![] };
        let new = WorldInfo { calendar: Some(cal.clone()), ..Default::default() };
        assert_eq!(due_on(&new, &rule, cal.moment(Date { year: 2027, month: 1, day: 9 })).due, cal.moment(Date { year: 2027, month: 2, day: 9 }));
    }
}
