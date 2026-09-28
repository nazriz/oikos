// Households: who lives together, as the world's people record it, and the
// occupancy standard they judge a home by. Documented in
// docs/behaviour/households.md, with sources.
//
// A household is content, never physics: a statement of kind "household"
// naming its members (with the birth date and sex the household knows them
// by), its couples, and who holds the lease. It's updated the way people
// update such things: a member publishes a new one citing the old, and
// withdraws the old. The kernel knows nothing of it; bodies occupy spaces.

import type { StatementRecord } from "../contracts";
import type { Book } from "./common";

export interface Member {
  person: string;
  /** How the household reaches them (their participant), if it knows. */
  participant?: string;
  born_at: number;
  /** As the household knows them (a trait, not physics: the kernel doesn't model sex). */
  sex: "female" | "male";
}
export interface HouseholdData {
  /** The member who holds the lease (and searches, applies and signs for the household). */
  leaseholder: string;
  members: Member[];
  /** Couples living together, by person. */
  couples: [string, string][];
}

export const ADULT_YEARS = 18;

/** The standing household record that lists `person`, if any (the newest). */
export function householdOf(book: Book, person: string): (StatementRecord & { data: HouseholdData }) | undefined {
  const mine = book.open("household").filter((r) => (r.data?.members as Member[] | undefined)?.some((m) => m.person === person));
  return mine.sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1))[0] as any;
}

export const ageAt = (m: Member, t: number, year: number) => Math.floor((t - m.born_at) / year);

/**
 * Bedrooms a household needs by the Canadian National Occupancy Standard, as
 * the ABS applies it (Census 2021, "Housing suitability (HOSD)"):
 *  - no more than two people per bedroom;
 *  - a couple shares a bedroom;
 *  - a lone parent, and every other member 18 or over, has their own;
 *  - under-18s of the same sex share (in pairs);
 *  - under-5s of different sexes share if that saves a bedroom;
 *  - someone living alone may live in a studio (0 bedrooms).
 */
export function bedroomsNeeded(h: HouseholdData, t: number, year: number): number {
  if (h.members.length === 1) return 0;
  const inCouple = new Set(h.couples.flat());
  const adults = h.members.filter((m) => ageAt(m, t, year) >= ADULT_YEARS);
  const children = h.members.filter((m) => ageAt(m, t, year) < ADULT_YEARS);
  let rooms = h.couples.length + adults.filter((m) => !inCouple.has(m.person)).length;
  // Same-sex children share in pairs, oldest together, so any child left over is the youngest.
  const boys = children.filter((m) => m.sex === "male").sort((a, b) => a.born_at - b.born_at);
  const girls = children.filter((m) => m.sex === "female").sort((a, b) => a.born_at - b.born_at);
  rooms += Math.ceil(boys.length / 2) + Math.ceil(girls.length / 2);
  // A leftover boy and a leftover girl, both under 5, can share.
  if (boys.length % 2 === 1 && girls.length % 2 === 1 && ageAt(boys.at(-1)!, t, year) < 5 && ageAt(girls.at(-1)!, t, year) < 5) rooms -= 1;
  return rooms;
}

// ------------------------------------------------------------------ what household members say to each other
//
// Code citizens understand only their own phrasing (as with asking around, D45): a language-model citizen
// understands anything, and would be understood by a code citizen only if it used these words.

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export const SAYING = {
  moveIn: (space: string) => `We've got ${space}. Time to move in.`,
  moveOut: (from: string) => `Our tenancy at ${from} has ended. Time to move out.`,
  leaving: () => "We're leaving town.",
  share: (cents: number, account: string) => `Your share of the rent is ${dollars(cents)} a month, paid to ${account}.`,
  pay: (cents: number) => `My pay is now ${dollars(cents)} a month.`,
};

export type Heard =
  | { kind: "moveIn"; space: string }
  | { kind: "moveOut"; from: string }
  | { kind: "leaving" }
  | { kind: "share"; cents: number; account: string }
  | { kind: "pay"; cents: number };

const cents = (s: string) => Math.round(Number(s) * 100);

/** What a household message means, if it's in our own phrasing. */
export function hear(text: string): Heard | undefined {
  let m: RegExpExecArray | null;
  if ((m = /^We've got (\S+)\. Time to move in\.$/.exec(text))) return { kind: "moveIn", space: m[1]! };
  if ((m = /^Our tenancy at (\S+) has ended\. Time to move out\.$/.exec(text))) return { kind: "moveOut", from: m[1]! };
  if (text === SAYING.leaving()) return { kind: "leaving" };
  if ((m = /^Your share of the rent is \$(\d+\.\d\d) a month, paid to (\S+)\.$/.exec(text))) return { kind: "share", cents: cents(m[1]!), account: m[2]! };
  if ((m = /^My pay is now \$(\d+\.\d\d) a month\.$/.exec(text))) return { kind: "pay", cents: cents(m[1]!) };
  return undefined;
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
  mother_age_at_first_birth: [number, number];
  group_size: [number, number];
}

export const DEFAULT_HOUSEHOLDS: HouseholdSpec = {
  // ABS Census 2021 (QuickStats, Australia): lone person 25.6%, group 3.9%, family 70.5% of households; of families,
  // couple without children 38.8%, couple with children 43.7%, one parent 15.9%, other 1.6% (counted here with groups).
  lone_bps: 2560,
  group_bps: 503,
  couple_bps: 2735,
  couple_children_bps: 3081,
  one_parent_bps: 1121,
  // AIFS, from the 2021 Census: couples with dependent children had 1 (35-36%), 2 (43-44%), 3+ (20-22%);
  // one-parent families 1 (51-52%), 2 (32-34%), 3+ (15-16%). "3+" is taken as 3.
  children_couple: [3550, 4350, 2100],
  children_one_parent: [5150, 3300, 1550],
  same_sex_couple_bps: 140, // ABS Census 2021: 1.4% of couples living together
  lone_parent_female_bps: 8000, // ABS Census 2021: one in five lone parents was male
  adult_female_bps: 5000, // about half (placeholder)
  child_male_bps: 5141, // ABS Births 2024: 105.8 boys per 100 girls
  adult_ages: [18, 64], // a working-age town: no retirees yet (there's no pension income to live on)
  mother_age_at_first_birth: [22, 36], // placeholder around ABS Births 2024's median age of mothers (32.1)
  group_size: [2, 3], // placeholder
};

/** A drawn household: members by age (whole years), days since their last birthday and sex; couples by index; the leaseholder's index; and, in a family, each child's parents (the biological ones the world records: in a same-sex couple, the first partner). */
export interface DrawnHousehold {
  members: { age: number; day: number; sex: "female" | "male"; parents?: number[] }[];
  couples: [number, number][];
  leaseholder: number;
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
  const couple = (age: number): [number, number] => {
    const other = clampAge(age + below(11) - 5);
    if (chance(H.same_sex_couple_bps)) {
      const sex = chance(5000) ? "female" : "male";
      return [person(age, sex), person(other, sex)];
    }
    return [person(age, "female"), person(other, "male")];
  };
  const kind = byShare([H.lone_bps, H.group_bps, H.couple_bps, H.couple_children_bps, H.one_parent_bps]);
  if (kind === 0) return { members, couples: [], leaseholder: person(within(H.adult_ages), adultSex()) };
  if (kind === 1) {
    const n = within(H.group_size);
    for (let i = 0; i < n; i++) person(within(H.adult_ages), adultSex());
    return { members, couples: [], leaseholder: 0 };
  }
  if (kind === 2) {
    const c = couple(within(H.adult_ages));
    return { members, couples: [c], leaseholder: c[0] };
  }
  // Children first (the eldest sets the parents' ages: older by the mother's age at a first birth).
  const n = 1 + byShare(kind === 3 ? H.children_couple : H.children_one_parent);
  const eldest = below(18);
  let age = eldest;
  for (let i = 0; i < n; i++) {
    person(age, chance(H.child_male_bps) ? "male" : "female");
    age = Math.max(0, age - 1 - below(4));
  }
  const parentAge = clampAge(eldest + within(H.mother_age_at_first_birth));
  const kids = members.map((_, i) => i);
  if (kind === 3) {
    const c = couple(parentAge);
    const parents = members[c[0]]!.sex === members[c[1]]!.sex ? [c[0]] : [c[0], c[1]];
    for (const k of kids) members[k]!.parents = parents;
    return { members, couples: [c], leaseholder: c[0] };
  }
  const lone = person(parentAge, chance(H.lone_parent_female_bps) ? "female" : "male");
  for (const k of kids) members[k]!.parents = [lone];
  return { members, couples: [], leaseholder: lone };
}
