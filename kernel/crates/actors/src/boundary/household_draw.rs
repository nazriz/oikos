//! Drawing households as the census counts them, for the newcomers world.migration brings (household.ts `drawHousehold`,
//! `drawSavings`; docs/behaviour/households.md).
//!
//! **To be replaced** by `oikos_rules::household` when lane A1 lands: this is a verbatim copy of the drawing half of lane
//! A1's `rules/src/household.rs` (branch lane-a1, commit 97c0e4e6: `Sex`, `OccupancyStandard`, `HouseholdSpec`,
//! `DrawnHousehold`, `draw_household`, `draw_savings`), kept private here so this lane builds alone. Do not edit it; the
//! swap is deleting this file and changing one `use`. The occupancy standard and the adult-age-band estimate are not
//! used by the newcomers and were left out of the copy's reach (the band estimate is the generator's).

#![allow(dead_code)] // (a verbatim copy: the generator's parts are not used here)

use serde::{Deserialize, Serialize};

pub const ADULT_YEARS: i64 = 18;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Sex {
    Female,
    Male,
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
