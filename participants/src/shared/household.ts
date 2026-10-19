// Households: who lives together, as the world's people record it, and the
// occupancy standard they judge a home by. Documented in
// docs/behaviour/households.md, with sources.
//
// A household is content, never physics: a statement of kind "household"
// naming its members (with the birth date and sex the household knows them
// by), its couples, and who holds the lease. It's updated the way people
// update such things: a member publishes a new one citing the old, and
// withdraws the old. The kernel knows nothing of it; bodies occupy spaces.


export interface Member {
  person: string;
  /** How the household reaches them (their participant), if it knows. */
  participant?: string;
  born_at: number;
  sex: "female" | "male";
  /** Their parents, where the household knows them (members' ids). */
  parents?: string[];
}
export interface HouseholdData {
  /** The member who holds the lease (and searches, applies and signs for the household). */
  leaseholder: string;
  members: Member[];
  /** Couples living together, by person. */
  couples: [string, string][];
}

export const ADULT_YEARS = 18;

export const ageAt = (m: Member, t: number, year: number) => Math.floor((t - m.born_at) / year);

/**
 * An occupancy standard: how many bedrooms a household is judged to need. The rule's form is the same everywhere; its
 * figures are a place's own (a world's profile may state them: docs/behaviour/households.md).
 */
export interface OccupancyStandard {
  /** The most people to a bedroom. */
  per_bedroom: number;
  /** From this age, someone who is not one of a couple has a bedroom of their own. */
  own_from_age: number;
  /** Younger than this, children of different sexes share if that saves a bedroom. */
  mixed_under_age: number;
  /** Whether the living room is slept in: one bedroom fewer is needed. */
  living_room_slept_in?: boolean;
}

/** The standard where a world states none: the one statistics offices commonly apply (docs/behaviour/households.md). */
export const OCCUPANCY: OccupancyStandard = { per_bedroom: 2, own_from_age: ADULT_YEARS, mixed_under_age: 5 };

/**
 * Bedrooms a household needs by an occupancy standard (docs/behaviour/households.md; with the figures of `OCCUPANCY`,
 * the standard statistics offices commonly apply):
 *  - no more than so many people per bedroom (two);
 *  - a couple shares a bedroom;
 *  - a lone parent, and every other member of the age for a room of their own (18) or over, has their own;
 *  - those younger, of the same sex, share (in pairs);
 *  - the youngest (under 5) of different sexes share if that saves a bedroom;
 *  - someone living alone may live in a studio (0 bedrooms).
 */
export function bedroomsNeeded(h: HouseholdData, t: number, year: number, standard?: OccupancyStandard | null): number {
  const S = standard ?? OCCUPANCY;
  if (h.members.length === 1) return 0;
  const inCouple = new Set(h.couples.flat());
  const adults = h.members.filter((m) => ageAt(m, t, year) >= S.own_from_age);
  const children = h.members.filter((m) => ageAt(m, t, year) < S.own_from_age);
  let rooms = h.couples.length + adults.filter((m) => !inCouple.has(m.person)).length;
  // Same-sex children share as many to a room as the standard allows, oldest together, so those left over are the youngest.
  const boys = children.filter((m) => m.sex === "male").sort((a, b) => a.born_at - b.born_at);
  const girls = children.filter((m) => m.sex === "female").sort((a, b) => a.born_at - b.born_at);
  const per = Math.max(1, S.per_bedroom);
  rooms += Math.ceil(boys.length / per) + Math.ceil(girls.length / per);
  // The boys and the girls left over, all under the age for it, can share one room if they fit in it.
  const overB = boys.length % per, overG = girls.length % per;
  if (overB && overG && overB + overG <= per && [...boys.slice(-overB), ...girls.slice(-overG)].every((m) => ageAt(m, t, year) < S.mixed_under_age)) rooms -= 1;
  if (S.living_room_slept_in) rooms = Math.max(0, rooms - 1);
  return rooms;
}

// ------------------------------------------------------------------ drawing households, as the census counts them

/**
 * Households, as the census counts them. Shares are of households (basis points); see docs/behaviour/households.md
 * for the sources and what's simplified.
 */
export interface HouseholdSpec {
  lone_bps: number;
  group_bps: number; // unrelated adults, and "other" families (e.g. siblings)
  couple_bps: number; // a couple, no children at home
  couple_children_bps: number;
  one_parent_bps: number;
  /** Children in a couple family, and in a one-parent family: shares with 1, 2 and 3. */
  children_couple: [number, number, number];
  children_one_parent: [number, number, number];
  same_sex_couple_bps: number;
  lone_parent_female_bps: number;
  adult_female_bps: number; // adults living alone or in groups
  child_male_bps: number; // the sex ratio at birth
  adult_ages: [number, number];
  /** The ages of adults living alone, as couples without children at home, or in groups: shares by band (basis points).
   * None: uniform over `adult_ages`. (A generator derives it from the census, less the parents the family shares imply.) */
  adult_age_bands?: { from: number; to: number; bps: number }[];
  /** The whole population by age band (the census): what `adult_age_bands` is derived from. */
  age_bands_bps?: { from: number; to: number; bps: number }[];
  mother_age_at_first_birth: [number, number];
  /** The oldest a child living with their parents can be (the census counts children of any age at home); 17 if none. */
  child_max_age?: number;
  group_size: [number, number];
  /** Extended households: a family with relatives beyond it living in the same home (a share of all households, beside
   * the five kinds above). None: no household is extended, and nothing is drawn for it. */
  extended_bps?: number;
  /** The family an extended household is built around: shares of a couple, a couple with children, one parent. None: in
   * proportion to `couple_bps`, `couple_children_bps` and `one_parent_bps`. */
  extended_nucleus?: [number, number, number];
  /** The relatives who live with that family: each kind's share of extended households, and how many of them (one if
   * not given; of parents, two at most). None: one other relative. */
  extensions?: Extension[];
  /** The occupancy standard households here judge a home by. None: `OCCUPANCY`. */
  occupancy?: OccupancyStandard;
  /** Where the profile states no `extended_bps`: the most households, of all, that have kin living with them (a
   * generator's ceiling when it places people with nothing coming in with a household that can carry them; nothing is
   * drawn from it). */
  kin_households_most_bps?: number;
}

/**
 * Relatives living with a family (docs/behaviour/households.md):
 *  - `parents`: a parent, or both, of the family's head, who keeps the lease;
 *  - `child_family`: the same people, the other way round: the family is a grown child's, living in the home of that
 *    child's parent or parents, who hold the lease;
 *  - `sibling`: brothers or sisters of the head;
 *  - `relative`: other adult relatives, of any age.
 */
export interface Extension { kind: "parents" | "child_family" | "sibling" | "relative"; share_bps: number; count?: [number, number] }

/** A drawn household: members by age (whole years), days since their last birthday and sex; couples by index; the leaseholder's index; and, in a family, each child's parents (the biological ones the world records: in a same-sex couple, the first partner). */
export interface DrawnHousehold {
  members: { age: number; day: number; sex: "female" | "male"; parents?: number[];
    /** Their age follows another member's without the world recording how they are related (a brother or sister). */
    tied?: boolean }[];
  couples: [number, number][];
  leaseholder: number;
  /** An extended household: which relatives live with the family. */
  extended?: Extension["kind"];
}

/** Draw one household from the shares. `below(n)` is a uniform draw from 0..n-1 (the caller's keyed stream). */
export function drawHousehold(H: HouseholdSpec, below: (n: number) => number): DrawnHousehold {
  const within = ([lo, hi]: [number, number]) => lo + below(hi - lo + 1);
  const chance = (bps: number) => below(10_000) < bps;
  const byShare = (shares: number[]) => {
    let r = below(shares.reduce((a, b) => a + b, 0));
    for (let i = 0; i < shares.length; i++) if ((r -= shares[i]!) < 0) return i;
    return shares.length - 1;
  };
  const members: DrawnHousehold["members"] = [];
  const person = (age: number, sex: "female" | "male") => members.push({ age, day: below(365), sex }) - 1;
  const clampAge = (a: number) => Math.max(H.adult_ages[0], Math.min(H.adult_ages[1], a));
  const adultSex = () => (chance(H.adult_female_bps) ? "female" : "male");
  // An adult not a parent at home: from the bands if given (a band by its share, then a year within it), else uniform.
  // (`atMost`: no older than that, for someone whose own parent lives with them.)
  const adultAge = (atMost?: number) => {
    const top = atMost === undefined ? H.adult_ages[1] : Math.max(H.adult_ages[0], Math.min(H.adult_ages[1], atMost));
    const bands = (H.adult_age_bands ?? []).filter((b) => b.bps > 0 && (atMost === undefined || b.from <= top));
    if (!bands.length) return within([H.adult_ages[0], top]);
    const b = bands[byShare(bands.map((x) => x.bps))]!;
    return clampAge(within([Math.max(b.from, H.adult_ages[0]), Math.min(b.to, top)]));
  };
  const couple = (age: number): [number, number] => {
    const other = clampAge(age + below(11) - 5);
    if (chance(H.same_sex_couple_bps)) {
      const sex = chance(5000) ? "female" : "male";
      return [person(age, sex), person(other, sex)];
    }
    return [person(age, "female"), person(other, "male")];
  };
  // (An extended household is a sixth kind only where the spec has any: without, the draws are those of the five.)
  const drawn = byShare([H.lone_bps, H.group_bps, H.couple_bps, H.couple_children_bps, H.one_parent_bps, ...(H.extended_bps ? [H.extended_bps] : [])]);
  // An extended household: the family it is built around, then which relatives live with it.
  const kind = drawn === 5 ? 2 + byShare(H.extended_nucleus ?? [H.couple_bps, H.couple_children_bps, H.one_parent_bps]) : drawn;
  const relatives: Extension[] = H.extensions?.length ? H.extensions : [{ kind: "relative", share_bps: 1 }];
  const ext = drawn === 5 ? relatives[byShare(relatives.map((x) => x.share_bps))]! : undefined;
  /** The family's relatives, once the family is drawn (its head: the one who would hold its lease). */
  const extended = (head: number, couples: [number, number][]): DrawnHousehold => {
    if (!ext) return { members, couples, leaseholder: head };
    const [lo, hi] = ext.count ?? [1, 1];
    if (ext.kind === "parents" || ext.kind === "child_family") {
      // The generation above: older than the head by a mother's age at a first birth, as a parent is than an eldest child.
      const age = clampAge(members[head]!.age + within(H.mother_age_at_first_birth));
      const elders = Math.min(2, within([lo, hi])) === 2 ? couple(age) : [person(age, adultSex())];
      if (elders.length === 2) couples = [...couples, elders as [number, number]];
      members[head]!.parents = elders.length === 2 && members[elders[0]!]!.sex === members[elders[1]!]!.sex ? [elders[0]!] : elders;
      return { members, couples, leaseholder: ext.kind === "child_family" ? elders[0]! : head, extended: ext.kind };
    }
    const n = within([lo, hi]);
    let apart = 0;
    for (let i = 0; i < n; i++) {
      if (ext.kind === "relative") { person(adultAge(), adultSex()); continue; }
      // A brother or sister: years apart as children are, older or younger.
      apart += 1 + below(4);
      members[person(clampAge(members[head]!.age + (chance(5000) ? apart : -apart)), adultSex())]!.tied = true;
    }
    return { members, couples, leaseholder: head, extended: ext.kind };
  };
  if (kind === 0) return { members, couples: [], leaseholder: person(adultAge(), adultSex()) };
  if (kind === 1) {
    const n = within(H.group_size);
    for (let i = 0; i < n; i++) person(adultAge(), adultSex());
    return { members, couples: [], leaseholder: 0 };
  }
  if (kind === 2) {
    // (With a parent of theirs in the home, no older than a parent's age allows.)
    const c = couple(ext?.kind === "parents" || ext?.kind === "child_family" ? adultAge(H.adult_ages[1] - H.mother_age_at_first_birth[0]) : adultAge());
    return extended(c[0], [c]);
  }
  // Children first (the eldest sets the parents' ages: older by the mother's age at a first birth).
  // (The years between one child and the next are drawn first, and the eldest is at least as old as they add up to.
  // Until 2026-10-08 the eldest's age came first and a younger child's stopped at nought: an eldest of one or two had
  // brothers and sisters all born in the same year as each other, and the town had half as many under-fives again as
  // the census.)
  const n = 1 + byShare(kind === 3 ? H.children_couple : H.children_one_parent);
  const oldest = H.child_max_age ?? 17;
  const gaps: number[] = [];
  for (let i = 1; i < n; i++) gaps.push(1 + below(4));
  const span = Math.min(oldest, gaps.reduce((a, b) => a + b, 0));
  const eldest = span + below(oldest - span + 1);
  let age = eldest;
  for (let i = 0; i < n; i++) {
    person(age, chance(H.child_male_bps) ? "male" : "female");
    age = Math.max(0, age - (gaps[i] ?? 0));
  }
  const parentAge = clampAge(eldest + within(H.mother_age_at_first_birth));
  const kids = members.map((_, i) => i);
  if (kind === 3) {
    const c = couple(parentAge);
    const parents = members[c[0]]!.sex === members[c[1]]!.sex ? [c[0]] : [c[0], c[1]];
    for (const k of kids) members[k]!.parents = parents;
    return extended(c[0], [c]);
  }
  const lone = person(parentAge, chance(H.lone_parent_female_bps) ? "female" : "male");
  for (const k of kids) members[k]!.parents = [lone];
  return extended(lone, []);
}

/**
 * The ages of adults whose age no family decides (living alone, as couples without children, or in groups), so that all
 * adults together follow the census (`age_bands_bps`): the census's adults in each band, less those the family shares
 * put there, parents and grown children still at home alike (estimated by drawing `n` households), as shares
 * (docs/behaviour/households.md). None without the census bands. (Until 2026-10-08 only parents were taken off: with
 * children at home up to their mid-twenties, the youngest bands were filled twice and every older band came up short.)
 */
export function adultAgeBands(H: HouseholdSpec, below: (n: number) => number, n = 20_000): HouseholdSpec["adult_age_bands"] {
  const census = H.age_bands_bps;
  if (!census?.length) return undefined;
  // (With extended households some of those a family places follow the age of someone it does not: the parent of a
  // couple with no children at home. So their ages are estimated a second time, with the first answer for the ages
  // nobody places. Without extended households one estimate is exact, and is all that is drawn.)
  const first = estimate(H, below, n, undefined);
  return H.extended_bps ? estimate(H, below, n, first) : first;
}

function estimate(H: HouseholdSpec, below: (n: number) => number, n: number, free: HouseholdSpec["adult_age_bands"]): HouseholdSpec["adult_age_bands"] {
  const census = H.age_bands_bps!;
  const [lo, hi] = H.adult_ages;
  const bands = census.filter((b) => b.to >= lo).map((b) => ({ from: Math.max(b.from, lo), to: Math.min(b.to, hi), bps: (b.bps * (Math.min(b.to, hi) - Math.max(b.from, lo) + 1)) / (b.to - b.from + 1) }));
  const band = (age: number) => bands.findIndex((b) => age >= b.from && age <= b.to);
  const parents = bands.map(() => 0);
  let adults = 0;
  for (let i = 0; i < n; i++) {
    const d = drawHousehold({ ...H, adult_age_bands: free }, below);
    for (const m of d.members) {
      if (m.age < lo) continue;
      adults++;
      // (Placed by a family: a parent, whose age follows the eldest child's, a grown child at home, or a brother or
      // sister of the head.)
      const placed = !!m.parents || !!m.tied || d.members.some((k) => k.parents?.includes(d.members.indexOf(m)));
      if (placed && band(m.age) >= 0) parents[band(m.age)]!++;
    }
  }
  const total = bands.reduce((x, b) => x + b.bps, 0);
  const need = bands.map((b, i) => Math.max(0, (b.bps / total) * adults - parents[i]!));
  const sum = need.reduce((a, b) => a + b, 0) || 1;
  return bands.map((b, i) => ({ from: b.from, to: b.to, bps: Math.round((need[i]! * 10_000) / sum) }));
}

/** A draw from percentiles 10, 25, 50, 75, 90 at the quantile `q` (of 10,000): linear between them, from nothing below
 * the 10th, and above the 90th up to three times it. */
export function drawSavings(pct: [number, number, number, number, number], q: number): number {
  const at = [0, 1000, 2500, 5000, 7500, 9000, 10_000];
  const v = [0, ...pct, pct[4] * 3];
  for (let i = 1; i < at.length; i++) if (q < at[i]!) return Math.floor(v[i - 1]! + ((v[i]! - v[i - 1]!) * (q - at[i - 1]!)) / (at[i]! - at[i - 1]!));
  return v[6]!;
}
