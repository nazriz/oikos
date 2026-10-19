// What a town's people say to each other, in the words the engine's citizens read back (kernel/crates/actors/src/mind/talk.rs,
// culture.rs, townmemory.rs, held by their own tests): the phrases a test hands a citizen to hear and reads back from what one says.
// These are the words of the deleted TypeScript citizen (participants/src/behaviour at the `pre-cutover` tag), kept as test data.

import { PERSONS_CONDUCTS, SAYINGS, WORDS, type Conduct, type CultureParams } from "../src/shared/culture";
import { EVENT_KINDS, type EventKind } from "../src/shared/townmemory";

/** The same acts in the third person, for what a person tells of someone else's (ordinary talk: "About p12: ...: they answered it. Of that, I say it is wrong."). */
export const THEY: { [c in Conduct]?: { did: string; didNot: string } } = {
  answer_tribunal: { did: "they answered it", didNot: "they did not answer it" },
  stay_past_notice: { did: "they were still there at the date", didNot: "they left by the date" },
  take_to_tribunal: { did: "they applied to the tribunal", didNot: "they did not apply" },
  complain: { did: "they wrote to the town", didNot: "they did not write" },
  take_in: { did: "they said yes", didNot: "they said no" },
  join_union: { did: "they joined the union", didNot: "they did not join" },
  strike: { did: "they voted yes", didNot: "they voted no" },
  take_from_employer: { did: "they took some", didNot: "they took nothing" },
};

/** How a person says what they did, and what they say of it. */
export const CULTURE_WORDS = {
  did: (c: Conduct, did: boolean): string => { const w = WORDS[c]; return w ? `${w.occasion}: ${did ? w.did : w.didNot}.` : ""; },
  says: (c: Conduct, says: number): string => { const w = WORDS[c]; if (!w) return ""; const s = SAYINGS[Math.max(0, Math.min(4, Math.floor(says / 2_000)))]![0]; return `I say ${w.thing} is ${s}.`; },
  /** What a phrase tells: the conducts done or not, and what is said of them (a step's middle). */
  heard: (text: string): { did: { conduct: Conduct; did: boolean }[]; says: { conduct: Conduct; bps: number }[] } | undefined => {
    const did: { conduct: Conduct; did: boolean }[] = [], says: { conduct: Conduct; bps: number }[] = [];
    for (const c of PERSONS_CONDUCTS) {
      const w = WORDS[c]!;
      if (text.includes(`${w.occasion}: ${w.did}.`)) did.push({ conduct: c, did: true });
      else if (text.includes(`${w.occasion}: ${w.didNot}.`)) did.push({ conduct: c, did: false });
      for (const [s, mid] of SAYINGS) if (text.includes(`I say ${w.thing} is ${s}.`)) says.push({ conduct: c, bps: mid });
    }
    return did.length || says.length ? { did, says } : undefined;
  },
  /** What I say to someone of what they did (step 4): of their doing it, or of their not doing it, how I judge it: how far it is right (the five steps of what is said of it, as approval of the act). */
  verdict: (c: Conduct, did: boolean, approvalBps: number): string => { const w = WORDS[c]; if (!w) return ""; const s = SAYINGS[Math.max(0, Math.min(4, Math.floor(approvalBps / 2_000)))]![0]; return `Of your ${did ? "" : "not "}${w.thing}: I say it is ${s}.`; },
  /** What a verdict tells: the conduct, whether it was of their doing or not doing, and how it judges the act (a step's middle). */
  verdictHeard: (text: string): { conduct: Conduct; did: boolean; approval: number } | undefined => {
    for (const c of PERSONS_CONDUCTS) {
      const w = WORDS[c]!;
      for (const did of [true, false]) for (const [s, mid] of SAYINGS) if (text === `Of your ${did ? "" : "not "}${w.thing}: I say it is ${s}.`) return { conduct: c, did, approval: mid };
    }
    return undefined;
  },
  /** What I tell of someone else's act, to someone who asks how things are (ordinary talk): who, the occasion and what they did, and how I judge the act (approval of it, as a verdict does). */
  about: (who: string, c: Conduct, did: boolean, approvalBps: number): string => {
    const w = WORDS[c], th = THEY[c];
    if (!w || !th) return "";
    return `About ${who}: ${w.occasion}: ${did ? th.did : th.didNot}. Of that, I say it is ${SAYINGS[Math.max(0, Math.min(4, Math.floor(approvalBps / 2_000)))]![0]}.`;
  },
  /** What such a phrase tells: of whom, the conduct, whether they did it, and how the teller judges their act (a step's middle). */
  aboutHeard: (text: string): { who: string; conduct: Conduct; did: boolean; approval: number } | undefined => {
    for (const c of PERSONS_CONDUCTS) {
      const w = WORDS[c]!, th = THEY[c]!;
      for (const did of [true, false]) for (const [s, mid] of SAYINGS) {
        const tail = `: ${w.occasion}: ${did ? th.did : th.didNot}. Of that, I say it is ${s}.`;
        const at = text.indexOf(tail);
        if (at < 0) continue;
        const head = text.lastIndexOf("About ", at);
        if (head < 0) continue;
        const who = text.slice(head + 6, at);
        if (who && !/\s/.test(who)) return { who, conduct: c, did, approval: mid };
      }
    }
    return undefined;
  },
  /** What a parent tells a child who asks (step 4): how I see it, in tenths: how many here do it, and how many would call it right. */
  household: (c: Conduct, doesBps: number, approvesBps: number): string => { const w = WORDS[c]; return w ? `As I see it, of ${w.thing}: ${Math.round(doesBps / 1_000)} in 10 do it, ${Math.round(approvesBps / 1_000)} in 10 would call it right.` : ""; },
  householdHeard: (text: string): { conduct: Conduct; does: number; approves: number }[] => {
    const out: { conduct: Conduct; does: number; approves: number }[] = [];
    for (const c of PERSONS_CONDUCTS) {
      const m = new RegExp(`As I see it, of ${WORDS[c]!.thing}: (\\d+) in 10 do it, (\\d+) in 10 would call it right\\.`).exec(text);
      if (m) out.push({ conduct: c, does: Number(m[1]) * 1_000, approves: Number(m[2]) * 1_000 });
    }
    return out;
  },
  /** Where a person comes from, told when asked how things are (only where the world has origin groups). */
  from: (group: string): string => `I come from the ${group} group.`,
  fromHeard: (text: string): string | undefined => /I come from the ([^\s.]+) group\./.exec(text)?.[1],
};

export type Route = "tie" | "close_tie" | "here" | "published";
export type HeardRow = [number, string, number, number, number, number, number];
export const ROUTES: readonly Route[] = ["tie", "close_tie", "here", "published"];

const HOWS = ["saw", "read", "told"] as const;

/**
 * The conducts an event is an instance of, for the sighting it is of each (docs/behaviour/culture.md, "Events join the picture"): a removal under a warrant is a landlord
 * applying for possession and a household staying past the notice; a walk-out is an instance of acting on a ballot for action. Only these two of the six kinds show
 * a conduct a person holds: a law, a ruling, a declared result and a founding are not someone's act of the kinds in the list (a declared result already reaches the
 * picture as a published count). The first conduct of a kind is the one whose said view travels with it.
 */
export const EVENT_CONDUCTS: { [k in EventKind]?: readonly Conduct[] } = { put_out: ["apply_possession", "stay_past_notice"], strike: ["strike"] };

/** Words for each kind, in the world's terms and without a judgement; a code person's phrasing, understood only in this phrasing. */
const KIND_WORDS: { [k in EventKind]: string } = {
  put_out: "a household put out of its home",
  strike: "a walk-out from work",
  ruling: "a decision published",
  law: "a law made",
  vote: "a result declared",
  founded: "a body founded",
};

export const TOWN_WORDS = {
  /** What I tell: the kind, who it was about, which day it was, how strongly I hold it (tenths), and through how many hands it came to me. */
  say: (kind: EventKind, about: string, day: number, strengthBps: number, hops: number, saysBps?: number): string =>
    `Talk of the town: ${KIND_WORDS[kind]}, ${about}, day ${day}; I hold it at ${Math.max(1, Math.min(10, Math.round(strengthBps / 1_000)))} in 10, through ${hops} ${hops === 1 ? "hand" : "hands"}.` +
    (saysBps === undefined ? "" : ` Of that, I say it is ${SAYINGS[Math.max(0, Math.min(4, Math.floor(saysBps / 2_000)))]![0]}.`),
  /** What a phrase tells (found anywhere in a message, which joins a person's phrases): the kind, who it was about, the day, the teller's strength (basis points) and hands. */
  heard: (text: string): { kind: EventKind; about: string; day: number; strength: number; hops: number; says?: number } | undefined => {
    const m = new RegExp(`Talk of the town: (${EVENT_KINDS.map((k) => KIND_WORDS[k]).join("|")}), ([^\\s,]+), day (\\d+); I hold it at (\\d+) in 10, through (\\d+) hands?\\.(?: Of that, I say it is (${SAYINGS.map(([w]) => w).join("|")})\\.)?`).exec(text);
    if (!m) return undefined;
    const kind = EVENT_KINDS.find((k) => KIND_WORDS[k] === m[1])!;
    const says = m[6] === undefined ? undefined : SAYINGS.find(([w]) => w === m[6])![1];
    return { kind, about: m[2]!, day: Number(m[3]), strength: Number(m[4]) * 1_000, hops: Number(m[5]), ...(says !== undefined ? { says } : {}) };
  },
};

/** The strength of a row of the record at day `day`, as anyone reading the record would work it out (the formula, not a stored figure). */
export function rowStrengthPct(row: HeardRow, day: number, p: Pick<CultureParams, "half_life_seen_days" | "half_life_told_days">): number {
  const half = HOWS[row[4]] === "saw" ? p.half_life_seen_days : p.half_life_told_days;
  return row[3] * Math.pow(0.5, Math.max(0, day - row[6]) / half);
}

/** Catching up with someone we know: the question, and a code citizen's answer (where they shop and how it serves them,
 * whom they work for and whether they're paid, whether they're in the union). Understood only in this phrasing. */
export const CATCHING_UP = {
  ask: "How are things with you?",
  shop: (shop: string, served: number) => `I shop at ${shop}; ${served >= 9_000 ? "it has what I need" : served >= 6_000 ? "it mostly has what I need" : "it often runs short"}.`,
  work: (employer: string, paid: boolean) => `I work for ${employer}; ${paid ? "they pay on time" : "they've stopped paying me"}.`,
  union: (member: boolean) => (member ? "I'm in the union." : "I'm not in the union."),
  goes: (host: string) => `I go to ${host}'s gatherings.`,
  holds: (host: string) => `I hold to what ${host} teaches.`,
  leans: (host: string) => `I lean towards what ${host} teaches.`,
  // (Since the richer record, docs/design/ai-citizens.md 10c: what was done to us lately, and what we say of how the
  // town is run: what we say, which is not always what we think.)
  lostWork: (employer: string) => `${employer} let me go.`,
  noticed: (landlord: string) => `${landlord} has given me notice to leave my home.`,
  town: (view: number) => `I'd say the town is run ${view >= 2_000 ? "well" : view <= -2_000 ? "badly" : "well enough"}.`,
  // (Since wants, docs/design/ai-citizens.md 10a: what we are trying to bring about and how, which those who copy us
  // may take up; and what we have stopped trying for.)
  after: (list: { about: string; way: string }[]) => (list.length ? `What I'm after: ${list.map((x) => `${x.about} by ${x.way}`).join("; ")}.` : ""),
  gaveUp: (about: string) => `I've stopped trying about ${about}: there's no use.`,
  nothing: "Much the same.",
};

export interface News { shop?: string; served?: number; employer?: string; paid?: boolean; member?: boolean; goesTo?: string[]; holdsTo?: string[]; leansTo?: string[];
  /** Who let them go, who gave them notice to leave their home; and what they say of how the town is run (1 well, 0 well enough, -1 badly). */
  letGoBy?: string; noticedBy?: string; town?: number;
  /** What they are after, and by what way; what they have stopped trying for. */
  after?: { about: string; way: string }[]; gaveUp?: string }

/** What someone's answer tells us, if it's in our phrasing (how well a shop serves: the middle of what the words say). */
export function heardNews(text: string): News | undefined {
  const n: News = {};
  let m: RegExpExecArray | null;
  if ((m = /I shop at ([^\s;]+); (it has what I need|it mostly has what I need|it often runs short)\./.exec(text))) {
    n.shop = m[1]!;
    n.served = m[2] === "it has what I need" ? 9_500 : m[2] === "it mostly has what I need" ? 7_500 : 3_500;
  }
  if ((m = /I work for ([^\s;]+); (they pay on time|they've stopped paying me)\./.exec(text))) {
    n.employer = m[1]!;
    n.paid = m[2] === "they pay on time";
  }
  if ((m = /I'm (not )?in the union\./.exec(text))) n.member = !m[1];
  const goes = [...text.matchAll(/I go to ([^\s;']+)'s gatherings\./g)].map((x) => x[1]!);
  if (goes.length) n.goesTo = goes;
  const holds = [...text.matchAll(/I hold to what ([^\s;']+) teaches\./g)].map((x) => x[1]!);
  if (holds.length) n.holdsTo = holds;
  const leans = [...text.matchAll(/I lean towards what ([^\s;']+) teaches\./g)].map((x) => x[1]!);
  if (leans.length) n.leansTo = leans;
  if ((m = /([^\s;]+) let me go\./.exec(text))) n.letGoBy = m[1]!;
  if ((m = /([^\s;]+) has given me notice to leave my home\./.exec(text))) n.noticedBy = m[1]!;
  if ((m = /I'd say the town is run (well enough|well|badly)\./.exec(text))) n.town = m[1] === "well" ? 1 : m[1] === "badly" ? -1 : 0;
  if ((m = /What I'm after: ([^.]+)\./.exec(text))) n.after = m[1]!.split("; ").flatMap((x) => { const i = x.lastIndexOf(" by "); return i > 0 ? [{ about: x.slice(0, i), way: x.slice(i + 4) }] : []; });
  if ((m = /I've stopped trying about ([^\s:]+): there's no use\./.exec(text))) n.gaveUp = m[1]!;
  return Object.keys(n).length ? n : undefined;
}


/** What a code citizen says when it asks around, and recognises when asked (a code citizen only understands its own phrasing). */
export const ASKING = { home: "I'm looking for somewhere to live. Do you know of anywhere?", work: "I'm looking for work. Do you know of anything going?" } as const;
