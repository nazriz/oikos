//! What a code citizen says and understands (citizen.ts `ASKING`, `CATCHING_UP`, `heardNews`, `WRONGED`, `MOURNING`,
//! `UPBRINGING_WORDS`, `CONSULT_THINGS`). A code citizen understands only its own phrasing, so every phrase is written
//! byte for byte as the TS wrote it and read back by the same rule its regular expression stated. Decided fresh: no
//! regular-expression engine (the crate takes no dependency); each reader is written out, with the TS expression it
//! follows beside it, and gives the same answer as that expression on every text (leftmost match, as `exec`).

/// Asking around for a home or work (citizen.ts `ASKING`).
pub const ASK_HOME: &str = "I'm looking for somewhere to live. Do you know of anywhere?";
pub const ASK_WORK: &str = "I'm looking for work. Do you know of anything going?";

/// Catching up with someone we know (citizen.ts `CATCHING_UP`).
pub mod catching_up {
    pub const ASK: &str = "How are things with you?";
    pub const NOTHING: &str = "Much the same.";
    pub fn shop(shop: &str, served: i64) -> String {
        let how = if served >= 9_000 {
            "it has what I need"
        } else if served >= 6_000 {
            "it mostly has what I need"
        } else {
            "it often runs short"
        };
        format!("I shop at {shop}; {how}.")
    }
    pub fn work(employer: &str, paid: bool) -> String {
        format!("I work for {employer}; {}.", if paid { "they pay on time" } else { "they've stopped paying me" })
    }
    pub fn union(member: bool) -> String {
        (if member { "I'm in the union." } else { "I'm not in the union." }).to_string()
    }
    pub fn goes(host: &str) -> String {
        format!("I go to {host}'s gatherings.")
    }
    pub fn holds(host: &str) -> String {
        format!("I hold to what {host} teaches.")
    }
    pub fn leans(host: &str) -> String {
        format!("I lean towards what {host} teaches.")
    }
    pub fn lost_work(employer: &str) -> String {
        format!("{employer} let me go.")
    }
    pub fn noticed(landlord: &str) -> String {
        format!("{landlord} has given me notice to leave my home.")
    }
    pub fn town(view: i64) -> String {
        let how = if view >= 2_000 {
            "well"
        } else if view <= -2_000 {
            "badly"
        } else {
            "well enough"
        };
        format!("I'd say the town is run {how}.")
    }
    pub fn after(list: &[(String, String)]) -> String {
        if list.is_empty() {
            return String::new();
        }
        let parts: Vec<String> = list.iter().map(|(about, way)| format!("{about} by {way}")).collect();
        format!("What I'm after: {}.", parts.join("; "))
    }
    pub fn gave_up(about: &str) -> String {
        format!("I've stopped trying about {about}: there's no use.")
    }
}

/// What someone's answer told us, in our phrasing (citizen.ts `News`).
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct News {
    pub shop: Option<String>,
    pub served: Option<i64>,
    pub employer: Option<String>,
    pub paid: Option<bool>,
    pub member: Option<bool>,
    pub goes_to: Vec<String>,
    pub holds_to: Vec<String>,
    pub leans_to: Vec<String>,
    pub let_go_by: Option<String>,
    pub noticed_by: Option<String>,
    /// 1 well, 0 well enough, -1 badly.
    pub town: Option<i64>,
    pub after: Vec<(String, String)>,
    pub gave_up: Option<String>,
}

fn is_space(c: char) -> bool {
    c.is_whitespace()
}

/// The run of characters before byte `end` that are none of `stop` (and not white space): `([^\s...]+)` ending at `end`.
fn run_before<'a>(text: &'a str, end: usize, stop: &[char]) -> &'a str {
    let head = &text[..end];
    let start = head.char_indices().rev().take_while(|(_, c)| !is_space(*c) && !stop.contains(c)).last().map(|(i, _)| i).unwrap_or(end);
    &text[start..end]
}

/// The run of characters from byte `start` that are none of `stop` (and not white space).
fn run_from<'a>(text: &'a str, start: usize, stop: &[char]) -> &'a str {
    let tail = &text[start..];
    let len = tail.char_indices().find(|(_, c)| is_space(*c) || stop.contains(c)).map(|(i, _)| i).unwrap_or(tail.len());
    &tail[..len]
}

/// `/<prefix>([^\s<stop>]+)<suffix>/` at its leftmost match: the captured run.
fn after_prefix(text: &str, prefix: &str, stop: &[char], suffixes: &[&str]) -> Option<(String, usize)> {
    let mut from = 0;
    while let Some(i) = text[from..].find(prefix) {
        let at = from + i + prefix.len();
        let run = run_from(text, at, stop);
        if !run.is_empty() {
            let rest = &text[at + run.len()..];
            for (k, s) in suffixes.iter().enumerate() {
                if rest.starts_with(s) {
                    return Some((run.to_string(), k));
                }
            }
        }
        from += i + 1;
    }
    None
}

/// Every `/<prefix>([^\s<stop>]+)<suffix>/g` match, in order.
fn all_after_prefix(text: &str, prefix: &str, stop: &[char], suffix: &str) -> Vec<String> {
    let mut out = vec![];
    let mut from = 0;
    while let Some(i) = text[from..].find(prefix) {
        let at = from + i + prefix.len();
        let run = run_from(text, at, stop);
        if !run.is_empty() && text[at + run.len()..].starts_with(suffix) {
            out.push(run.to_string());
            from = at + run.len() + suffix.len();
        } else {
            from += i + 1;
        }
    }
    out
}

/// `/([^\s;]+)<suffix>/` at its leftmost match.
fn before_suffix(text: &str, suffix: &str) -> Option<String> {
    let mut from = 0;
    while let Some(i) = text[from..].find(suffix) {
        let end = from + i;
        let run = run_before(text, end, &[';']);
        if !run.is_empty() {
            return Some(run.to_string());
        }
        from = end + 1;
    }
    None
}

/// What someone's answer tells us, if it is in our phrasing (citizen.ts `heardNews`).
pub fn heard_news(text: &str) -> Option<News> {
    let mut n = News::default();
    let mut any = false;
    // /I shop at ([^\s;]+); (it has what I need|it mostly has what I need|it often runs short)\./
    if let Some((shop, k)) = after_prefix(text, "I shop at ", &[';'], &["; it has what I need.", "; it mostly has what I need.", "; it often runs short."]) {
        n.shop = Some(shop);
        n.served = Some([9_500, 7_500, 3_500][k]);
        any = true;
    }
    // /I work for ([^\s;]+); (they pay on time|they've stopped paying me)\./
    if let Some((employer, k)) = after_prefix(text, "I work for ", &[';'], &["; they pay on time.", "; they've stopped paying me."]) {
        n.employer = Some(employer);
        n.paid = Some(k == 0);
        any = true;
    }
    // /I'm (not )?in the union\./: the leftmost of the two.
    let yes = text.find("I'm in the union.");
    let no = text.find("I'm not in the union.");
    match (yes, no) {
        (Some(a), Some(b)) => n.member = Some(a < b),
        (Some(_), None) => n.member = Some(true),
        (None, Some(_)) => n.member = Some(false),
        _ => {}
    }
    any |= n.member.is_some();
    n.goes_to = all_after_prefix(text, "I go to ", &[';', '\''], "'s gatherings.");
    n.holds_to = all_after_prefix(text, "I hold to what ", &[';', '\''], " teaches.");
    n.leans_to = all_after_prefix(text, "I lean towards what ", &[';', '\''], " teaches.");
    any |= !n.goes_to.is_empty() || !n.holds_to.is_empty() || !n.leans_to.is_empty();
    n.let_go_by = before_suffix(text, " let me go.");
    n.noticed_by = before_suffix(text, " has given me notice to leave my home.");
    any |= n.let_go_by.is_some() || n.noticed_by.is_some();
    // /I'd say the town is run (well enough|well|badly)\./
    {
        let p = "I'd say the town is run ";
        let mut from = 0;
        while let Some(i) = text[from..].find(p) {
            let rest = &text[from + i + p.len()..];
            let v = if rest.starts_with("well enough.") {
                Some(0)
            } else if rest.starts_with("well.") {
                Some(1)
            } else if rest.starts_with("badly.") {
                Some(-1)
            } else {
                None
            };
            if v.is_some() {
                n.town = v;
                any = true;
                break;
            }
            from += i + 1;
        }
    }
    // /What I'm after: ([^.]+)\./
    if let Some(i) = text.find("What I'm after: ") {
        let rest = &text[i + "What I'm after: ".len()..];
        let len = rest.find('.').unwrap_or(rest.len());
        if len > 0 && rest.len() > len {
            n.after = rest[..len]
                .split("; ")
                .filter_map(|x| x.rfind(" by ").filter(|&k| k > 0).map(|k| (x[..k].to_string(), x[k + 4..].to_string())))
                .collect();
            any = true;
        }
    }
    // /I've stopped trying about ([^\s:]+): there's no use\./
    if let Some((about, _)) = after_prefix(text, "I've stopped trying about ", &[':'], &[": there's no use."]) {
        n.gave_up = Some(about);
        any = true;
    }
    any.then_some(n)
}

/// Telling someone we know that someone did wrong by us (citizen.ts `WRONGED`).
pub fn wronged_say(matter: &str, by: &str) -> String {
    format!("{by} has done wrong by me ({}).", matter.replace('_', " "))
}
/// `/^(\S+) has done wrong by me \(([a-z ]+)\)\.$/`: (by, matter).
pub fn wronged_heard(text: &str) -> Option<(String, String)> {
    let i = text.find(" has done wrong by me (")?;
    let by = &text[..i];
    if by.is_empty() || by.chars().any(is_space) {
        return None;
    }
    let rest = &text[i + " has done wrong by me (".len()..];
    let matter = rest.strip_suffix(").")?;
    if matter.is_empty() || !matter.chars().all(|c| c.is_ascii_lowercase() || c == ' ') {
        return None;
    }
    Some((by.to_string(), matter.replace(' ', "_")))
}

/// A death told to those we are close to (citizen.ts `MOURNING`).
pub fn mourning_tell(who: &str) -> String {
    format!("I have sad news: {who} has died.")
}
/// `/^I have sad news: ([^\s;]+) has died\.$/`.
pub fn mourning_heard(text: &str) -> Option<String> {
    let who = text.strip_prefix("I have sad news: ")?.strip_suffix(" has died.")?;
    (!who.is_empty() && !who.chars().any(|c| is_space(c) || c == ';')).then(|| who.to_string())
}

/// Coming of age: asking the parents what matters (citizen.ts `UPBRINGING_WORDS`).
pub const UPBRINGING_ASK: &str = "What matters most to you in life?";
pub fn upbringing_say(most: &[&str], least: &[&str]) -> String {
    format!("What matters most to me: {}. Least: {}.", most.join(", "), least.join(", "))
}
/// `/^What matters most to me: ([a-z_, ]+)\. Least: ([a-z_, ]+)\.$/`: (most, least).
pub fn upbringing_heard(text: &str) -> Option<(Vec<String>, Vec<String>)> {
    let ok = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_lowercase() || c == '_' || c == ',' || c == ' ');
    let body = text.strip_prefix("What matters most to me: ")?.strip_suffix('.')?;
    let i = body.find(". Least: ")?;
    let (most, least) = (&body[..i], &body[i + ". Least: ".len()..]);
    (ok(most) && ok(least)).then(|| (most.split(", ").map(String::from).collect(), least.split(", ").map(String::from).collect()))
}

/// What a citizen asks the sparse mind about joining the union (citizen.ts `CONSULT_THINGS.join`): (about, thing,
/// options as (key, words)).
pub fn consult_join(union: &str) -> (String, &'static str, [(&'static str, &'static str); 2]) {
    (
        format!("join:{union}"),
        "Joining the workers' union on starting a new job. The union represents its members at work and bargains for their pay and conditions; members pay dues each month, and may be called out on strike, unpaid.",
        [("join", "join the union"), ("not", "don't join")],
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn news_said_is_news_heard() {
        let said = [
            catching_up::shop("shop.3", 9_000),
            catching_up::work("firm.2", false),
            catching_up::union(true),
            catching_up::goes("group.1"),
            catching_up::goes("church.1"),
            catching_up::holds("church.1"),
            catching_up::leans("group.1"),
            catching_up::lost_work("firm.9"),
            catching_up::noticed("landlord.4"),
            catching_up::town(-2_500),
            catching_up::after(&[("security".into(), "offer:employment".into()), ("notice".into(), "ask".into())]),
            catching_up::gave_up("rent_increase"),
        ]
        .join(" ");
        let n = heard_news(&said).unwrap();
        assert_eq!((n.shop.as_deref(), n.served), (Some("shop.3"), Some(9_500)));
        assert_eq!((n.employer.as_deref(), n.paid, n.member), (Some("firm.2"), Some(false), Some(true)));
        assert_eq!(n.goes_to, vec!["group.1", "church.1"]);
        assert_eq!((n.holds_to.len(), n.leans_to.len()), (1, 1));
        assert_eq!((n.let_go_by.as_deref(), n.noticed_by.as_deref(), n.town), (Some("firm.9"), Some("landlord.4"), Some(-1)));
        assert_eq!(n.after, vec![("security".to_string(), "offer:employment".to_string()), ("notice".to_string(), "ask".to_string())]);
        assert_eq!(n.gave_up.as_deref(), Some("rent_increase"));
        assert_eq!(heard_news(catching_up::NOTHING), None);
        assert_eq!(heard_news(&catching_up::town(2_000)).unwrap().town, Some(1));
        assert_eq!(heard_news(&catching_up::town(0)).unwrap().town, Some(0));
        assert_eq!(heard_news("I'm not in the union.").unwrap().member, Some(false));
    }

    #[test]
    fn words_of_wrong_death_and_upbringing_read_back() {
        assert_eq!(wronged_heard(&wronged_say("short_pay", "firm.1")), Some(("firm.1".into(), "short_pay".into())));
        assert_eq!(wronged_heard("firm 1 has done wrong by me (x)."), None);
        assert_eq!(mourning_heard(&mourning_tell("person.7")), Some("person.7".into()));
        assert_eq!(mourning_heard("I have sad news: a b has died."), None);
        let said = upbringing_say(&["benevolence", "security", "self_direction"], &["power", "hedonism", "stimulation"]);
        let (most, least) = upbringing_heard(&said).unwrap();
        assert_eq!((most[2].as_str(), least[0].as_str()), ("self_direction", "power"));
    }
}
