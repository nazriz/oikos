//! What household members say to each other (household.ts `SAYING`, `hear`; docs/behaviour/households.md). Code
//! citizens understand only their own phrasing (as with asking around): a model citizen understands anything, and is
//! understood by a code citizen only if it uses these words. The household's record and the occupancy standard are
//! pure rules, in `oikos_rules::household`, which the generator shares.

use super::person::Said;
use crate::WorldInfo;

/// An amount as the world writes its money, in the one form a code citizen reads back (calls.ts `amountText`).
pub fn sum(n: i64, world: &WorldInfo) -> String {
    let cur = world.currency.as_ref();
    let minor = cur.map_or(0, |c| u32::from(c.minor_units));
    let per = 10_i64.pow(minor);
    let mark = cur.map_or_else(String::new, |c| c.symbol.clone().unwrap_or_else(|| format!("{} ", c.code)));
    let whole = n.div_euclid(per);
    if minor > 0 {
        format!("{mark}{whole}.{:0width$}", n.rem_euclid(per), width = minor as usize)
    } else {
        format!("{mark}{whole}")
    }
}

/// An amount heard, if it is written as we write one.
fn heard_sum(s: &str, world: &WorldInfo) -> Option<i64> {
    let cur = world.currency.as_ref();
    let minor = cur.map_or(0, |c| u32::from(c.minor_units));
    let mark = cur.map_or_else(String::new, |c| c.symbol.clone().unwrap_or_else(|| format!("{} ", c.code)));
    let body = s.strip_prefix(&mark)?;
    let n = if minor > 0 {
        let (w, f) = body.split_once('.')?;
        if f.len() != minor as usize || !f.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        w.parse::<i64>().ok()? * 10_i64.pow(minor) + f.parse::<i64>().ok()?
    } else {
        body.parse::<i64>().ok()?
    };
    (sum(n, world) == s).then_some(n)
}

#[allow(non_snake_case)]
pub mod SAYING {
    use super::sum;
    use crate::WorldInfo;
    pub fn move_in(space: &str) -> String {
        format!("We've got {space}. Time to move in.")
    }
    pub fn move_out(from: &str) -> String {
        format!("Our tenancy at {from} has ended. Time to move out.")
    }
    pub fn leaving() -> String {
        "We're leaving town.".into()
    }
    pub fn share(cents: i64, account: &str, world: &WorldInfo) -> String {
        format!("Your share of the rent is {} a month, paid to {account}.", sum(cents, world))
    }
    pub fn pay(cents: i64, world: &WorldInfo) -> String {
        format!("My pay is now {} a month.", sum(cents, world))
    }
    pub fn died(person: &str, space: &str) -> String {
        format!("{person} has died at home, {space}.")
    }
    /// Something that has befallen the household, told by the member it happened to: `let_go`, `notice` or
    /// `rent_increase`.
    pub fn trouble(what: &str, by: &str) -> String {
        let w = match what {
            "let_go" => "has let me go",
            "notice" => "has given us notice to leave",
            _ => "is raising our rent",
        };
        format!("Trouble for us: {by} {w}.")
    }
}

/// One whitespace-free word.
fn word(s: &str) -> Option<&str> {
    (!s.is_empty() && !s.chars().any(char::is_whitespace)).then_some(s)
}

/// What a household message means, if it is in our own phrasing (household.ts `hear`).
pub fn hear(text: &str, world: &WorldInfo) -> Option<Said> {
    if let Some(r) = text.strip_prefix("We've got ").and_then(|r| r.strip_suffix(". Time to move in.")) {
        return word(r).map(|s| Said::MoveIn(s.into()));
    }
    if let Some(r) = text.strip_prefix("Our tenancy at ").and_then(|r| r.strip_suffix(" has ended. Time to move out.")) {
        return word(r).map(|s| Said::MoveOut(s.into()));
    }
    if text == SAYING::leaving() {
        return Some(Said::Leaving);
    }
    if let Some(r) = text.strip_prefix("Trouble for us: ").and_then(|r| r.strip_suffix('.')) {
        let (by, rest) = r.split_once(' ')?;
        let what = match rest {
            "has let me go" => "let_go",
            "has given us notice to leave" => "notice",
            "is raising our rent" => "rent_increase",
            _ => return None,
        };
        return word(by).map(|b| Said::Trouble { what: what.into(), by: b.into() });
    }
    if let Some(r) = text.strip_suffix('.') {
        if let Some((person, space)) = r.split_once(" has died at home, ") {
            if let (Some(p), Some(s)) = (word(person), word(space)) {
                return Some(Said::Died { person: p.into(), space: s.into() });
            }
        }
    }
    if let Some(r) = text.strip_prefix("Your share of the rent is ").and_then(|r| r.strip_suffix('.')) {
        let (amount, account) = r.rsplit_once(" a month, paid to ")?;
        let n = heard_sum(amount, world)?;
        return word(account).map(|a| Said::Share { cents: n, account: a.into() });
    }
    if let Some(r) = text.strip_prefix("My pay is now ").and_then(|r| r.strip_suffix(" a month.")) {
        return heard_sum(r, world).map(Said::Pay);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn world() -> WorldInfo {
        let currency = oikos_sight::calls::Currency { code: "AUD".into(), symbol: Some("$".into()), minor_units: 2, ..Default::default() };
        WorldInfo { currency: Some(currency), ..Default::default() }
    }

    #[test]
    fn what_a_household_says_is_heard_back_in_its_own_phrasing_only() {
        let w = world();
        assert_eq!(hear(&SAYING::move_in("b1/dwelling.2"), &w), Some(Said::MoveIn("b1/dwelling.2".into())));
        assert_eq!(hear(&SAYING::move_out("b1"), &w), Some(Said::MoveOut("b1".into())));
        assert_eq!(hear(&SAYING::leaving(), &w), Some(Said::Leaving));
        assert_eq!(hear(&SAYING::share(123_456, "acc-1", &w), &w), Some(Said::Share { cents: 123_456, account: "acc-1".into() }));
        assert_eq!(SAYING::pay(5, &w), "My pay is now $0.05 a month.");
        assert_eq!(hear(&SAYING::pay(5, &w), &w), Some(Said::Pay(5)));
        assert_eq!(hear("My pay is now $1,000.00 a month.", &w), None, "not as we write money");
        assert_eq!(hear(&SAYING::died("c1", "b1/dwelling.1"), &w), Some(Said::Died { person: "c1".into(), space: "b1/dwelling.1".into() }));
        assert_eq!(hear(&SAYING::trouble("notice", "landlord-1"), &w), Some(Said::Trouble { what: "notice".into(), by: "landlord-1".into() }));
        assert_eq!(hear("Hello there.", &w), None);
    }
}
