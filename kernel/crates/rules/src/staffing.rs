//! How many clerks a keeper's counter needs (docs/risks.md PB-19: at 10,000 people thousands of questions asked of a
//! keeper were found held at the end of a run, because the keeper's post was staffed as for a small town whatever the
//! population).
//!
//! In the world an enquiry of a register is answered by a clerk's time (foundations F11: `answer` in the table of
//! work, seconds a question), one at a time, in the clerk's working hours. The questions asked grow with the people
//! who ask, so the staff must too: a registry is staffed to its caseload, as real ones are (workload-based
//! establishment). This is the pure sum the generator calls, through the N-API module, to size a keeper's counter; each
//! keeper's module declares its expected asks per 1,000 residents a year and the seconds an answer takes in its
//! manifest (`capacity`), both placeholders until sourced. Integers throughout.

/// Clerks needed (at least one) to answer `asks_per_1000_year` questions per 1,000 residents a year from `residents`
/// people, each taking `seconds_per_answer`, when a clerk has `clerk_seconds_a_day` to give to answering on
/// `working_days_a_year` days, and is to be busy no more than `utilisation_bps` of that time (queues grow without
/// bound as utilisation nears 10,000; 8,000 is the usual planning ceiling).
pub fn clerks_needed(residents: i64, asks_per_1000_year: i64, seconds_per_answer: i64, clerk_seconds_a_day: i64, working_days_a_year: i64, utilisation_bps: i64) -> i64 {
    let work = (residents.max(0) as i128) * (asks_per_1000_year.max(0) as i128) * (seconds_per_answer.max(0) as i128) / 1000;
    let per_clerk = (clerk_seconds_a_day.max(0) as i128) * (working_days_a_year.max(0) as i128) * (utilisation_bps.clamp(0, 10_000) as i128) / 10_000;
    if per_clerk == 0 {
        return 1;
    }
    (((work + per_clerk - 1) / per_clerk) as i64).max(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_staff_a_keeper_needs_grows_with_the_people_who_ask() {
        // 2,000 asks per 1,000 residents a year, ten minutes an answer, 4 hours a day for answering, 250 days, 80%.
        let need = |n| clerks_needed(n, 2_000, 600, 4 * 3600, 250, 8_000);
        assert_eq!(need(0), 1);
        assert_eq!(need(1_000), 1, "a small town needs one");
        assert_eq!(need(10_000), 5, "ten times the people, five clerks, where one left questions held");
        assert_eq!(need(100_000), 42);
    }
}
