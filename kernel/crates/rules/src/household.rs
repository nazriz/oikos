//! Households: who lives together, as the world's people record it, and the occupancy standard they judge a home by
//! (participants/src/behaviour/household.ts; docs/behaviour/households.md, with sources). The actors (the citizen's
//! life) and the generator share it.
//!
//! A household is content, never physics: a statement of kind "household" naming its members (with the birth date and
//! sex the household knows them by), its couples, and who holds the lease. The kernel knows nothing of it.

use serde::{Deserialize, Serialize};

pub const ADULT_YEARS: i64 = 18;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Sex {
    Female,
    Male,
}

/// A member as the household knows them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Member {
    pub person: String,
    /// How the household reaches them (their participant), if it knows.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub participant: Option<String>,
    pub born_at: i64,
    pub sex: Sex,
    /// Their parents, where the household knows them (members' ids).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parents: Option<Vec<String>>,
}

impl Member {
    /// How the household reaches them: their participant, else their person (household.ts `reach`).
    pub fn reach(&self) -> &str {
        self.participant.as_deref().unwrap_or(&self.person)
    }
}

/// A household's record (the `household` statement's data).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HouseholdData {
    /// The member who holds the lease (and searches, applies and signs for the household).
    pub leaseholder: String,
    pub members: Vec<Member>,
    /// Couples living together, by person.
    #[serde(default)]
    pub couples: Vec<[String; 2]>,
}

impl HouseholdData {
    /// The partner of `person` in the household, if they are one of a couple.
    pub fn partner_of(&self, person: &str) -> Option<&str> {
        self.couples.iter().find(|c| c.iter().any(|x| x == person)).and_then(|c| c.iter().find(|x| *x != person)).map(String::as_str)
    }
    pub fn member(&self, person: &str) -> Option<&Member> {
        self.members.iter().find(|m| m.person == person)
    }
}

/// Whole years of age at `t` (`year` seconds a year), rounded down (household.ts `ageAt`).
pub fn age_at(born_at: i64, t: i64, year: i64) -> i64 {
    (t - born_at).div_euclid(year.max(1))
}

/// An occupancy standard: how many bedrooms a household is judged to need. The rule's form is the same everywhere; its
/// figures are a place's own (a world's profile may state them).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct OccupancyStandard {
    /// The most people to a bedroom.
    pub per_bedroom: i64,
    /// From this age, someone who is not one of a couple has a bedroom of their own.
    pub own_from_age: i64,
    /// Younger than this, children of different sexes share if that saves a bedroom.
    pub mixed_under_age: i64,
    /// Whether the living room is slept in: one bedroom fewer is needed.
    #[serde(default)]
    pub living_room_slept_in: bool,
}

/// The standard where a world states none: the one statistics offices commonly apply (docs/behaviour/households.md).
pub const OCCUPANCY: OccupancyStandard = OccupancyStandard { per_bedroom: 2, own_from_age: ADULT_YEARS, mixed_under_age: 5, living_room_slept_in: false };

/// Bedrooms a household needs by an occupancy standard (household.ts `bedroomsNeeded`): no more than so many people
/// per bedroom; a couple shares; a lone parent and every other member of the age for a room of their own has one;
/// younger children of the same sex share (oldest together); the youngest of different sexes share if that saves a
/// room; someone living alone may live in a studio (0).
pub fn bedrooms_needed(h: &HouseholdData, t: i64, year: i64, standard: Option<&OccupancyStandard>) -> i64 {
    let s = standard.unwrap_or(&OCCUPANCY);
    if h.members.len() == 1 {
        return 0;
    }
    let in_couple = |p: &str| h.couples.iter().any(|c| c.iter().any(|x| x == p));
    let age = |m: &Member| age_at(m.born_at, t, year);
    let adults_alone = h.members.iter().filter(|m| age(m) >= s.own_from_age && !in_couple(&m.person)).count() as i64;
    let mut rooms = h.couples.len() as i64 + adults_alone;
    let children: Vec<&Member> = h.members.iter().filter(|m| age(m) < s.own_from_age).collect();
    let mut boys: Vec<&Member> = children.iter().copied().filter(|m| m.sex == Sex::Male).collect();
    let mut girls: Vec<&Member> = children.iter().copied().filter(|m| m.sex == Sex::Female).collect();
    // (Oldest first; a tie by id, so the order never rests on how the record listed them.)
    boys.sort_by(|a, b| a.born_at.cmp(&b.born_at).then_with(|| a.person.cmp(&b.person)));
    girls.sort_by(|a, b| a.born_at.cmp(&b.born_at).then_with(|| a.person.cmp(&b.person)));
    let per = s.per_bedroom.max(1);
    let (nb, ng) = (boys.len() as i64, girls.len() as i64);
    rooms += (nb + per - 1) / per + (ng + per - 1) / per;
    let (over_b, over_g) = (nb % per, ng % per);
    if over_b > 0 && over_g > 0 && over_b + over_g <= per {
        let left = boys[(nb - over_b) as usize..].iter().chain(girls[(ng - over_g) as usize..].iter());
        if left.into_iter().all(|m| age(m) < s.mixed_under_age) {
            rooms -= 1;
        }
    }
    if s.living_room_slept_in {
        rooms = (rooms - 1).max(0);
    }
    rooms
}

// ------------------------------------------------------------------ drawing households, as the census counts them
//
// The generator keeps calling the TS drawing (participants/src/behaviour/household.ts `drawHousehold`, `adultAgeBands`,
// `drawSavings`) until lane F wires it to this module through the N-API; the two are meant to draw the same households
// from the same draws (the same `below` calls in the same order), so one can replace the other without a new town.

/// A band of ages and its share (basis points).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgeBand {
    pub from: i64,
    pub to: i64,
    pub bps: i64,
}

/// Relatives living with a family (docs/behaviour/households.md).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExtensionKind {
    /// A parent, or both, of the family's head, who keeps the lease.
    Parents,
    /// The same people the other way round: the family is a grown child's, in the home of that child's parent or
    /// parents, who hold the lease.
    ChildFamily,
    /// Brothers or sisters of the head.
    Sibling,
    /// Other adult relatives, of any age.
    Relative,
}

/// One kind of extended household: its share of them, and how many relatives (one if not given; of parents, two at most).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Extension {
    pub kind: ExtensionKind,
    pub share_bps: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub count: Option<[i64; 2]>,
}

/// Households, as the census counts them. Shares are of households (basis points); see docs/behaviour/households.md
/// for the sources and what is simplified. Field names are the profile's own.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HouseholdSpec {
    pub lone_bps: i64,
    /// Unrelated adults, and "other" families (e.g. siblings).
    pub group_bps: i64,
    /// A couple, no children at home.
    pub couple_bps: i64,
    pub couple_children_bps: i64,
    pub one_parent_bps: i64,
    /// Children in a couple family, and in a one-parent family: shares with 1, 2 and 3.
    pub children_couple: [i64; 3],
    pub children_one_parent: [i64; 3],
    pub same_sex_couple_bps: i64,
    pub lone_parent_female_bps: i64,
    /// Adults living alone or in groups.
    pub adult_female_bps: i64,
    /// The sex ratio at birth.
    pub child_male_bps: i64,
    pub adult_ages: [i64; 2],
    /// The ages of adults living alone, as couples without children at home, or in groups: shares by band. None:
    /// uniform over `adult_ages`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub adult_age_bands: Option<Vec<AgeBand>>,
    /// The whole population by age band (the census): what `adult_age_bands` is derived from.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub age_bands_bps: Option<Vec<AgeBand>>,
    pub mother_age_at_first_birth: [i64; 2],
    /// The oldest a child living with their parents can be; 17 if none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub child_max_age: Option<i64>,
    pub group_size: [i64; 2],
    /// Extended households: a share of all households, beside the five kinds. None: none is extended.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extended_bps: Option<i64>,
    /// The family an extended household is built around: shares of a couple, a couple with children, one parent. None:
    /// in proportion to `couple_bps`, `couple_children_bps` and `one_parent_bps`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extended_nucleus: Option<[i64; 3]>,
    /// The relatives who live with that family. None: one other relative.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extensions: Option<Vec<Extension>>,
    /// The occupancy standard households here judge a home by. None: `OCCUPANCY`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub occupancy: Option<OccupancyStandard>,
    /// A generator's ceiling on households that have kin living with them; nothing is drawn from it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kin_households_most_bps: Option<i64>,
}

/// A member of a drawn household: whole years of age, days since the last birthday, and sex.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DrawnMember {
    pub age: i64,
    pub day: i64,
    pub sex: Sex,
    /// In a family, the child's parents as indices (the biological ones the world records: in a same-sex couple, the
    /// first partner).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parents: Option<Vec<usize>>,
    /// Their age follows another member's without the world recording how they are related (a brother or sister).
    #[serde(default, skip_serializing_if = "is_false")]
    pub tied: bool,
}

fn is_false(b: &bool) -> bool {
    !*b
}

/// A drawn household: members, couples by index, the leaseholder's index, and which relatives live with the family.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DrawnHousehold {
    pub members: Vec<DrawnMember>,
    pub couples: Vec<[usize; 2]>,
    pub leaseholder: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extended: Option<ExtensionKind>,
}

struct Drawer<'a, F: FnMut(i64) -> i64> {
    h: &'a HouseholdSpec,
    below: &'a mut F,
    members: Vec<DrawnMember>,
}

impl<F: FnMut(i64) -> i64> Drawer<'_, F> {
    fn within(&mut self, [lo, hi]: [i64; 2]) -> i64 {
        lo + (self.below)(hi - lo + 1)
    }
    fn chance(&mut self, bps: i64) -> bool {
        (self.below)(10_000) < bps
    }
    fn by_share(&mut self, shares: &[i64]) -> usize {
        let mut r = (self.below)(shares.iter().sum());
        for (i, s) in shares.iter().enumerate() {
            r -= s;
            if r < 0 {
                return i;
            }
        }
        shares.len() - 1
    }
    fn person(&mut self, age: i64, sex: Sex) -> usize {
        let day = (self.below)(365);
        self.members.push(DrawnMember { age, day, sex, parents: None, tied: false });
        self.members.len() - 1
    }
    fn clamp_age(&self, a: i64) -> i64 {
        a.max(self.h.adult_ages[0]).min(self.h.adult_ages[1])
    }
    fn adult_sex(&mut self) -> Sex {
        if self.chance(self.h.adult_female_bps) {
            Sex::Female
        } else {
            Sex::Male
        }
    }
    /// An adult not a parent at home: from the bands if given (a band by its share, then a year within it), else
    /// uniform. `at_most`: no older than that, for someone whose own parent lives with them.
    fn adult_age(&mut self, at_most: Option<i64>) -> i64 {
        let [lo, hi] = self.h.adult_ages;
        let top = at_most.map_or(hi, |a| a.min(hi).max(lo));
        let bands: Vec<AgeBand> = self
            .h
            .adult_age_bands
            .iter()
            .flatten()
            .filter(|b| b.bps > 0 && (at_most.is_none() || b.from <= top))
            .copied()
            .collect();
        if bands.is_empty() {
            return self.within([lo, top]);
        }
        let b = bands[self.by_share(&bands.iter().map(|x| x.bps).collect::<Vec<_>>())];
        let a = self.within([b.from.max(lo), b.to.min(top)]);
        self.clamp_age(a)
    }
    fn couple(&mut self, age: i64) -> [usize; 2] {
        let off = (self.below)(11) - 5;
        let other = self.clamp_age(age + off);
        if self.chance(self.h.same_sex_couple_bps) {
            let sex = if self.chance(5000) { Sex::Female } else { Sex::Male };
            let a = self.person(age, sex);
            return [a, self.person(other, sex)];
        }
        let a = self.person(age, Sex::Female);
        [a, self.person(other, Sex::Male)]
    }
    /// The family's relatives, once the family is drawn (its head: the one who would hold its lease).
    fn extended(&mut self, head: usize, mut couples: Vec<[usize; 2]>, ext: Option<&Extension>) -> DrawnHousehold {
        let Some(ext) = ext else { return DrawnHousehold { members: std::mem::take(&mut self.members), couples, leaseholder: head, extended: None } };
        let [lo, hi] = ext.count.unwrap_or([1, 1]);
        if matches!(ext.kind, ExtensionKind::Parents | ExtensionKind::ChildFamily) {
            // The generation above: older than the head by a mother's age at a first birth, as a parent is than an eldest child.
            let gap = self.within(self.h.mother_age_at_first_birth);
            let age = self.clamp_age(self.members[head].age + gap);
            let elders: Vec<usize> = if self.within([lo, hi]).min(2) == 2 {
                let c = self.couple(age);
                couples.push(c);
                c.to_vec()
            } else {
                let sex = self.adult_sex();
                vec![self.person(age, sex)]
            };
            let one = elders.len() == 2 && self.members[elders[0]].sex == self.members[elders[1]].sex;
            self.members[head].parents = Some(if one { vec![elders[0]] } else { elders.clone() });
            let leaseholder = if ext.kind == ExtensionKind::ChildFamily { elders[0] } else { head };
            return DrawnHousehold { members: std::mem::take(&mut self.members), couples, leaseholder, extended: Some(ext.kind) };
        }
        let n = self.within([lo, hi]);
        let mut apart = 0;
        for _ in 0..n {
            if ext.kind == ExtensionKind::Relative {
                let age = self.adult_age(None);
                let sex = self.adult_sex();
                self.person(age, sex);
                continue;
            }
            // A brother or sister: years apart as children are, older or younger.
            apart += 1 + (self.below)(4);
            let up = self.chance(5000);
            let age = self.clamp_age(self.members[head].age + if up { apart } else { -apart });
            let sex = self.adult_sex();
            let i = self.person(age, sex);
            self.members[i].tied = true;
        }
        DrawnHousehold { members: std::mem::take(&mut self.members), couples, leaseholder: head, extended: Some(ext.kind) }
    }
}

/// Draw one household from the shares (household.ts `drawHousehold`). `below(n)` is a uniform draw from 0..n-1 (the
/// caller's keyed stream). The draws are made in TS's order, so the same stream gives the same household.
pub fn draw_household(h: &HouseholdSpec, below: &mut impl FnMut(i64) -> i64) -> DrawnHousehold {
    let mut d = Drawer { h, below, members: vec![] };
    // (An extended household is a sixth kind only where the spec has any: without, the draws are those of the five.)
    let mut kinds = vec![h.lone_bps, h.group_bps, h.couple_bps, h.couple_children_bps, h.one_parent_bps];
    if h.extended_bps.is_some_and(|b| b != 0) {
        kinds.push(h.extended_bps.unwrap_or(0));
    }
    let drawn = d.by_share(&kinds);
    // An extended household: the family it is built around, then which relatives live with it.
    let kind = if drawn == 5 { 2 + d.by_share(&h.extended_nucleus.unwrap_or([h.couple_bps, h.couple_children_bps, h.one_parent_bps])) } else { drawn };
    let relatives: Vec<Extension> = match h.extensions.as_deref() {
        Some(x) if !x.is_empty() => x.to_vec(),
        _ => vec![Extension { kind: ExtensionKind::Relative, share_bps: 1, count: None }],
    };
    let ext = if drawn == 5 { Some(relatives[d.by_share(&relatives.iter().map(|x| x.share_bps).collect::<Vec<_>>())].clone()) } else { None };
    let ext = ext.as_ref();
    match kind {
        0 => {
            let age = d.adult_age(None);
            let sex = d.adult_sex();
            let i = d.person(age, sex);
            return DrawnHousehold { members: d.members, couples: vec![], leaseholder: i, extended: None };
        }
        1 => {
            let n = d.within(h.group_size);
            for _ in 0..n {
                let age = d.adult_age(None);
                let sex = d.adult_sex();
                d.person(age, sex);
            }
            return DrawnHousehold { members: d.members, couples: vec![], leaseholder: 0, extended: None };
        }
        2 => {
            // (With a parent of theirs in the home, no older than a parent's age allows.)
            let age = if matches!(ext.map(|e| e.kind), Some(ExtensionKind::Parents | ExtensionKind::ChildFamily)) {
                d.adult_age(Some(h.adult_ages[1] - h.mother_age_at_first_birth[0]))
            } else {
                d.adult_age(None)
            };
            let c = d.couple(age);
            return d.extended(c[0], vec![c], ext);
        }
        _ => {}
    }
    // Children first (the eldest sets the parents' ages: older by the mother's age at a first birth). The years between
    // one child and the next are drawn first, and the eldest is at least as old as they add up to.
    let n = 1 + d.by_share(if kind == 3 { &h.children_couple } else { &h.children_one_parent });
    let oldest = h.child_max_age.unwrap_or(17);
    let gaps: Vec<i64> = (1..n).map(|_| 1 + (d.below)(4)).collect();
    let span = oldest.min(gaps.iter().sum());
    let eldest = span + (d.below)(oldest - span + 1);
    let mut age = eldest;
    for i in 0..n {
        let sex = if d.chance(h.child_male_bps) { Sex::Male } else { Sex::Female };
        d.person(age, sex);
        age = (age - gaps.get(i).copied().unwrap_or(0)).max(0);
    }
    let gap = d.within(h.mother_age_at_first_birth);
    let parent_age = d.clamp_age(eldest + gap);
    let kids: Vec<usize> = (0..d.members.len()).collect();
    if kind == 3 {
        let c = d.couple(parent_age);
        let parents = if d.members[c[0]].sex == d.members[c[1]].sex { vec![c[0]] } else { vec![c[0], c[1]] };
        for &k in &kids {
            d.members[k].parents = Some(parents.clone());
        }
        return d.extended(c[0], vec![c], ext);
    }
    let sex = if d.chance(h.lone_parent_female_bps) { Sex::Female } else { Sex::Male };
    let lone = d.person(parent_age, sex);
    for &k in &kids {
        d.members[k].parents = Some(vec![lone]);
    }
    d.extended(lone, vec![], ext)
}

/// Households drawn to estimate adults' ages, when none is asked for (household.ts `adultAgeBands`' default).
pub const ADULT_AGE_BANDS_DRAWS: usize = 20_000;

/// The ages of adults whose age no family decides (living alone, as couples without children, or in groups), so that
/// all adults together follow the census (`age_bands_bps`): the census's adults in each band, less those the family
/// shares put there, parents and grown children still at home alike (estimated by drawing `n` households), as shares
/// (household.ts `adultAgeBands`). None without the census bands.
pub fn adult_age_bands(h: &HouseholdSpec, below: &mut impl FnMut(i64) -> i64, n: usize) -> Option<Vec<AgeBand>> {
    if h.age_bands_bps.as_ref().is_none_or(Vec::is_empty) {
        return None;
    }
    // (With extended households some of those a family places follow the age of someone it does not: the parent of a
    // couple with no children at home. So their ages are estimated a second time, with the first answer for the ages
    // nobody places. Without extended households one estimate is exact, and is all that is drawn.)
    let first = estimate(h, below, n, None);
    if h.extended_bps.is_some_and(|b| b != 0) {
        estimate(h, below, n, first)
    } else {
        first
    }
}

/// Fixed-point scale of a band's weight in `estimate`.
const WEIGHT: i128 = 1_000_000;

/// One estimate of `adult_age_bands`. The TS reckoned the shares in floating point; here they are in integers.
/// Rounding is decided fresh: a census band's share is cut to the adult ages in proportion to the years it keeps, as a
/// weight in millionths of a basis point (rounded down; the error is below a millionth of a basis point), the adults
/// each band needs is that weight's share of the adults drawn less those a family placed (also rounded down), and the
/// shares come out in whole basis points rounded half up. Census bands wholly outside the adult ages are left out
/// (the TS gave them a negative weight when above them).
fn estimate(h: &HouseholdSpec, below: &mut impl FnMut(i64) -> i64, n: usize, free: Option<Vec<AgeBand>>) -> Option<Vec<AgeBand>> {
    let census = h.age_bands_bps.as_ref()?;
    let [lo, hi] = h.adult_ages;
    // (band, weight in WEIGHT-ths of a basis point)
    let bands: Vec<(AgeBand, i128)> = census
        .iter()
        .filter(|b| b.to >= lo)
        .filter_map(|b| {
            let (from, to) = (b.from.max(lo), b.to.min(hi));
            let (kept, whole) = (to - from + 1, b.to - b.from + 1);
            (kept > 0 && whole > 0).then(|| (AgeBand { from, to, bps: 0 }, i128::from(b.bps) * i128::from(kept) * WEIGHT / i128::from(whole)))
        })
        .collect();
    let band = |age: i64| bands.iter().position(|(b, _)| age >= b.from && age <= b.to);
    let mut parents = vec![0_i128; bands.len()];
    let mut adults = 0_i128;
    let spec = HouseholdSpec { adult_age_bands: free, ..h.clone() };
    for _ in 0..n {
        let d = draw_household(&spec, below);
        for (i, m) in d.members.iter().enumerate() {
            if m.age < lo {
                continue;
            }
            adults += 1;
            // (Placed by a family: a parent, whose age follows the eldest child's, a grown child at home, or a brother
            // or sister of the head.)
            let placed = m.parents.is_some() || m.tied || d.members.iter().any(|k| k.parents.as_ref().is_some_and(|p| p.contains(&i)));
            if placed {
                if let Some(b) = band(m.age) {
                    parents[b] += 1;
                }
            }
        }
    }
    let total: i128 = bands.iter().map(|b| b.1).sum::<i128>().max(1);
    let need: Vec<i128> = bands.iter().zip(&parents).map(|((_, w), p)| (w * adults * WEIGHT / total - p * WEIGHT).max(0)).collect();
    let sum = need.iter().sum::<i128>().max(1);
    Some(bands.iter().zip(&need).map(|((b, _), x)| AgeBand { bps: ((x * 20_000 + sum) / (2 * sum)) as i64, ..*b }).collect())
}

/// A draw from percentiles 10, 25, 50, 75, 90 at the quantile `q` (of 10,000): linear between them, from nothing below
/// the 10th, and above the 90th up to three times it (household.ts `drawSavings`). Cents, rounded down.
pub fn draw_savings(pct: [i64; 5], q: i64) -> i64 {
    const AT: [i64; 7] = [0, 1000, 2500, 5000, 7500, 9000, 10_000];
    let v = [0, pct[0], pct[1], pct[2], pct[3], pct[4], pct[4] * 3];
    for i in 1..AT.len() {
        if q < AT[i] {
            return v[i - 1] + ((v[i] - v[i - 1]) * (q - AT[i - 1])).div_euclid(AT[i] - AT[i - 1]);
        }
    }
    v[6]
}

#[cfg(test)]
mod tests {
    use super::*;

    const Y: i64 = 365 * 86_400;
    fn m(p: &str, age: i64, sex: Sex, t: i64) -> Member {
        Member { person: p.into(), participant: None, born_at: t - age * Y - 1, sex, parents: None }
    }

    #[test]
    fn bedrooms_by_the_common_standard() {
        let t = 40 * Y;
        let alone = HouseholdData { leaseholder: "a".into(), members: vec![m("a", 30, Sex::Female, t)], couples: vec![] };
        assert_eq!(bedrooms_needed(&alone, t, Y, None), 0, "a studio will do");
        let family = HouseholdData {
            leaseholder: "a".into(),
            members: vec![m("a", 35, Sex::Female, t), m("b", 36, Sex::Male, t), m("k1", 3, Sex::Male, t), m("k2", 2, Sex::Female, t)],
            couples: vec![["a".into(), "b".into()]],
        };
        assert_eq!(bedrooms_needed(&family, t, Y, None), 2, "the couple, and two small children of either sex together");
        let older = HouseholdData { members: vec![m("a", 35, Sex::Female, t), m("b", 36, Sex::Male, t), m("k1", 9, Sex::Male, t), m("k2", 7, Sex::Female, t)], ..family.clone() };
        assert_eq!(bedrooms_needed(&older, t, Y, None), 3, "a boy and a girl past five have a room each");
        let group = HouseholdData { leaseholder: "a".into(), members: vec![m("a", 25, Sex::Male, t), m("b", 26, Sex::Female, t), m("c", 30, Sex::Male, t)], couples: vec![] };
        assert_eq!(bedrooms_needed(&group, t, Y, None), 3);
        let lr = OccupancyStandard { living_room_slept_in: true, ..OCCUPANCY };
        assert_eq!(bedrooms_needed(&group, t, Y, Some(&lr)), 2);
    }

    // ---- drawing (participants/test/household.test.ts) ----

    use oikos_core::rng::Randomness;

    /// An invented place: round figures, no census behind them.
    fn spec() -> HouseholdSpec {
        let band = |from, to, bps| AgeBand { from, to, bps };
        serde_json::from_value(serde_json::json!({
            "lone_bps": 2500, "group_bps": 500, "couple_bps": 2500, "couple_children_bps": 3000, "one_parent_bps": 1500,
            "children_couple": [3500, 4500, 2000], "children_one_parent": [5000, 3500, 1500],
            "same_sex_couple_bps": 150, "lone_parent_female_bps": 8000, "adult_female_bps": 5000, "child_male_bps": 5100,
            "adult_ages": [18, 99], "mother_age_at_first_birth": [22, 36], "child_max_age": 24, "group_size": [2, 3],
            "age_bands_bps": [band(0, 4, 500), band(5, 9, 600), band(10, 14, 600), band(15, 19, 600), band(20, 24, 600),
                band(25, 34, 1200), band(35, 44, 1200), band(45, 54, 1200), band(55, 64, 1300), band(65, 74, 1200), band(75, 99, 1000)],
        }))
        .unwrap()
    }
    fn draws(h: &HouseholdSpec, n: usize) -> Vec<DrawnHousehold> {
        let mut r = Randomness::new(1).stream(&["draw"]);
        let mut below = |k: i64| r.below(k as u64) as i64;
        (0..n).map(|_| draw_household(h, &mut below)).collect()
    }
    fn with_bands(mut h: HouseholdSpec, n: usize) -> HouseholdSpec {
        let mut r = Randomness::new(1).stream(&["bands"]);
        h.adult_age_bands = adult_age_bands(&h, &mut |k| r.below(k as u64) as i64, n);
        h
    }
    fn kinds_total(h: &HouseholdSpec) -> i64 {
        h.lone_bps + h.group_bps + h.couple_bps + h.couple_children_bps + h.one_parent_bps + h.extended_bps.unwrap_or(0)
    }

    #[test]
    fn adults_ages_follow_the_census_grown_children_counted() {
        let h = with_bands(spec(), 5_000);
        let (lo, census) = (h.adult_ages[0], h.age_bands_bps.clone().unwrap());
        let share = |from: i64, to: i64| -> i64 {
            census.iter().map(|c| c.bps * (c.to.min(to) - c.from.max(from) + 1).max(0) * 1000 / (c.to - c.from + 1)).sum()
        };
        let (mut adults, mut young, mut old) = (0_i64, 0_i64, 0_i64);
        for d in draws(&h, 20_000) {
            for m in d.members.iter().filter(|m| m.age >= lo) {
                adults += 1;
                young += i64::from(m.age < 25);
                old += i64::from(m.age >= 67);
            }
        }
        let (pct, cen) = (|n: i64| 10_000 * n / adults, |f: i64, t: i64| 10_000 * share(f, t) / share(lo, 200));
        assert!((pct(young) - cen(lo, 24)).abs() < 250, "{} vs {}", pct(young), cen(lo, 24));
        assert!((pct(old) - cen(67, 200)).abs() < 250, "{} vs {}", pct(old), cen(67, 200));
    }

    #[test]
    fn no_two_children_of_a_family_are_the_same_age() {
        let h = with_bands(spec(), 2_000);
        let (mut people, mut under5, mut twins) = (0, 0, 0);
        for d in draws(&h, 20_000) {
            let kids: Vec<i64> = d.members.iter().filter(|m| m.parents.is_some()).map(|m| m.age).collect();
            let set: std::collections::BTreeSet<_> = kids.iter().collect();
            twins += i64::from(set.len() < kids.len());
            people += d.members.len() as i64;
            under5 += d.members.iter().filter(|m| m.age < 5).count() as i64;
        }
        assert_eq!(twins, 0);
        let c = h.age_bands_bps.as_ref().unwrap();
        let census = 10_000 * c.iter().filter(|b| b.from < 5).map(|b| b.bps).sum::<i64>() / c.iter().map(|b| b.bps).sum::<i64>();
        assert!((10_000 * under5 / people - census).abs() < 150);
    }

    #[test]
    fn a_spec_with_no_extended_households_draws_what_it_drew_before_the_kind_existed() {
        let plain = draws(&spec(), 2_000);
        assert!(plain.iter().all(|d| d.extended.is_none()));
        assert_eq!(draws(&HouseholdSpec { extended_bps: Some(0), ..spec() }, 2_000), plain);
        let extras = HouseholdSpec {
            extended_nucleus: Some([1, 1, 1]),
            extensions: Some(vec![Extension { kind: ExtensionKind::Parents, share_bps: 1, count: None }]),
            ..spec()
        };
        assert_eq!(draws(&extras, 2_000), plain);
        let (mut a, mut b) = (Randomness::new(1).stream(&["bands"]), Randomness::new(1).stream(&["bands"]));
        assert_eq!(
            adult_age_bands(&HouseholdSpec { extended_bps: Some(0), ..spec() }, &mut |k| b.below(k as u64) as i64, 1_000),
            adult_age_bands(&spec(), &mut |k| a.below(k as u64) as i64, 1_000)
        );
    }

    #[test]
    fn extended_households_come_at_the_stated_share_and_each_relative_is_what_it_says() {
        let base = spec();
        let ext = |kind, count| Extension { kind, share_bps: 2500, count: Some(count) };
        let h = HouseholdSpec {
            extended_bps: Some(kinds_total(&base) / 3),
            extensions: Some(vec![
                ext(ExtensionKind::Parents, [1, 2]),
                ext(ExtensionKind::ChildFamily, [2, 2]),
                ext(ExtensionKind::Sibling, [1, 2]),
                ext(ExtensionKind::Relative, [1, 3]),
            ]),
            ..base
        };
        let [lo, hi] = h.adult_ages;
        let [gap_lo, gap_hi] = h.mother_age_at_first_birth;
        let all = draws(&h, 20_000);
        let of = |k: ExtensionKind| all.iter().filter(|d| d.extended == Some(k)).collect::<Vec<_>>();
        let pct100 = |n: usize| 10_000 * n as i64 / all.len() as i64;
        assert!((pct100(all.iter().filter(|d| d.extended.is_some()).count()) - 2500).abs() < 150);
        for k in [ExtensionKind::Parents, ExtensionKind::ChildFamily, ExtensionKind::Sibling, ExtensionKind::Relative] {
            assert!((pct100(of(k).len()) - 625).abs() < 100, "{k:?}");
        }
        let three_gen = |d: &DrawnHousehold| d.members.iter().any(|m| m.parents.iter().flatten().any(|&p| d.members[p].parents.as_ref().is_some_and(|x| !x.is_empty())));
        for d in of(ExtensionKind::Parents) {
            let head = &d.members[d.leaseholder];
            let ps = head.parents.as_ref().unwrap();
            let first = &d.members[ps[0]];
            assert!(first.age == hi || (first.age - head.age >= gap_lo && first.age - head.age <= gap_hi));
            if ps.len() == 2 {
                assert!(d.couples.iter().any(|c| c.contains(&ps[0]) && c.contains(&ps[1])));
            }
        }
        assert!(of(ExtensionKind::Parents).iter().any(|d| d.members[d.leaseholder].parents.as_ref().unwrap().len() == 1));
        assert!(of(ExtensionKind::Parents).iter().any(|d| d.couples.len() == 2));
        for d in of(ExtensionKind::ChildFamily) {
            let elder = &d.members[d.leaseholder];
            let child = d.members.iter().find(|m| m.age >= lo && m.parents.as_ref().is_some_and(|p| p.contains(&d.leaseholder))).unwrap();
            assert!(elder.age == hi || (elder.age - child.age >= gap_lo && elder.age - child.age <= gap_hi));
            assert!(d.couples.iter().any(|c| c.contains(&d.leaseholder)));
        }
        assert!(of(ExtensionKind::Parents).iter().any(|d| three_gen(d)));
        assert!(of(ExtensionKind::ChildFamily).iter().any(|d| three_gen(d)));
        assert!(!all.iter().filter(|d| !matches!(d.extended, Some(ExtensionKind::Parents | ExtensionKind::ChildFamily))).any(three_gen));
        for d in of(ExtensionKind::Sibling) {
            let sibs: Vec<_> = d.members.iter().filter(|m| m.tied).collect();
            assert!(sibs.len() == 1 || sibs.len() == 2);
            let head = d.members[d.leaseholder].age;
            assert!(sibs.iter().all(|s| s.age >= lo && s.age <= hi && (s.age != head || head == lo || head == hi)));
        }
        for d in of(ExtensionKind::Relative) {
            let others: Vec<_> =
                d.members.iter().enumerate().filter(|(i, m)| *i != d.leaseholder && m.parents.is_none() && !m.tied && !d.couples.iter().any(|c| c.contains(i))).collect();
            assert!((1..=3).contains(&others.len()));
            assert!(others.iter().all(|(_, o)| o.age >= lo));
        }
        assert!(!all.iter().filter(|d| d.extended.is_none()).any(|d| d.members.iter().any(|m| m.tied) || three_gen(d)));
        assert!(all.iter().flat_map(|d| &d.members).all(|m| m.age <= hi));
    }

    #[test]
    fn a_draw_is_the_same_from_the_same_stream_and_the_spec_reads_a_profile() {
        assert_eq!(draws(&spec(), 200), draws(&spec(), 200));
        let back: HouseholdSpec = serde_json::from_value(serde_json::to_value(spec()).unwrap()).unwrap();
        assert_eq!(back, spec());
        let d = &draws(&spec(), 1)[0];
        assert_eq!(serde_json::from_value::<DrawnHousehold>(serde_json::to_value(d).unwrap()).unwrap(), *d);
    }

    #[test]
    fn savings_are_drawn_between_the_percentiles() {
        let p = [1000, 2500, 5000, 10_000, 20_000];
        assert_eq!(draw_savings(p, 0), 0);
        assert_eq!(draw_savings(p, 500), 500, "halfway from nothing to the 10th");
        assert_eq!(draw_savings(p, 1000), 1000);
        assert_eq!(draw_savings(p, 1750), 1750, "halfway from the 10th to the 25th");
        assert_eq!(draw_savings(p, 5000), 5000, "the median is the 50th percentile");
        assert_eq!(draw_savings(p, 9000), 20_000);
        assert_eq!(draw_savings(p, 9500), 40_000, "halfway from the 90th to three times it");
        assert_eq!(draw_savings(p, 9999), 59_960);
        assert_eq!(draw_savings(p, 10_000), 60_000);
    }
}
