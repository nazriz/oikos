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
