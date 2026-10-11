// The everyday model's recorded situations (docs/design/ai-citizens.md 11): harvested from code-only living runs,
// split, put before a large model as an estimator, scrambled and edited for the gate. Nothing here is read by a run.
//
// A situation is a decision about a want as the code mind made it (the dataset's CitizenSituation): the want, what
// stands behind it, the openings in typed terms with what the person knows of each, the person's own record, and the
// odds the code mind gave. The first slice is a household that wants a secure home: a rent rise, a notice to leave, a
// home in disrepair.
//
// What is the person's and what is the situation's is fixed here, because the gate swaps one and keeps the other:
//   the situation: what the want is about and how long, what was tried and answered, the home, its rent and the paper,
//     which openings there are and what each would bring and cost;
//   the person: their record, their means, how much the want weighs with them, and what they know of each opening
//     (their trust in whoever it is by, their fear of them, what they hold of its teaching, how many they know who went
//     that way, what they have learned of that kind of way).

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Randomness, type Situation } from "@oikos/participants";

export const EVERYDAY_VERSION = "0.1.0";
export const SLICE = ["rent_increase", "notice", "disrepair"] as const;
const DAY = 86_400, YEAR = 365 * DAY;

export interface Harvested { id: string; profile: string; run: string; t: number; participant: string; choice?: string; situation: Situation }
type Opening = Situation["openings"][number];

// ------------------------------------------------------------------------------------------------------ the options

/** What a decision is among: each opening the person can see (one a kind and whom it is by), then leaving it for now
 * and giving it up. `cls` is the class its rate is counted under for a town's totals. */
export interface Option { id: string; cls: string; opening?: Opening }
const CLASS: { [kind: string]: string } = { ask: "ask", desk: "venue", "offer:lease": "move", "offer:employment": "work", self: "spend_less", tell: "tell", petition: "petition", join: "join", practice: "gathering", ties: "ties", stand: "stand" };
export const classOf = (kind: string) => CLASS[kind] ?? kind;
export const NOT_ACTING = ["leave", "give_up"];
export function optionsOf(s: Situation): Option[] {
  const by = new Map<string, Opening>();
  for (const o of s.openings) { const id = `${o.kind}${o.by ? `:${o.by}` : ""}`; if (!by.has(id) || o.adj > by.get(id)!.adj) by.set(id, o); }
  return [...[...by].sort(([a], [b]) => (a < b ? -1 : 1)).map(([id, opening]) => ({ id, cls: classOf(opening.kind), opening })), { id: "leave", cls: "leave" }, { id: "give_up", cls: "give_up" }];
}
/** The code mind's odds over the same options (shares of 1): it has one option a kind of way and waiting; several
 * openings of a kind share the kind's odds (the likeliest has them, as the mind took the likeliest), and giving up was
 * no draw of its (0). */
export function codeOdds(s: Situation): { [id: string]: number } {
  const out: { [id: string]: number } = {};
  const opts = optionsOf(s);
  for (const c of s.code.odds) {
    const p = c.ppm / 1_000_000;
    if (c.key === "wait") { out.leave = p; continue; }
    const mine = opts.filter((o) => o.opening?.kind === c.key).sort((a, b) => b.opening!.adj - a.opening!.adj);
    if (mine[0]) out[mine[0].id] = p;
  }
  for (const o of opts) out[o.id] ??= 0;
  return out;
}
/**
 * The code mind's odds for another person shown in a recorded situation (a scramble, an edit), beside its recorded
 * odds for the person it was recorded with: what the code mind's own sway makes of the change. The mind's score for
 * a kind of way is what it has learned of it plus its sways (wants.choice: trust 1,500 and agency 1,500 a standard
 * deviation, fear 3,000 at full, 500 for each of up to five known to have gone that way, weighed again by
 * conformity), chosen by a logit the more open explore more in. Only the parts a situation holds are moved (trust in
 * whoever an opening is by, fear of them, the sense of agency, those known to have gone that way, what was learned,
 * openness and conformity); the rest of each score (a value's lean toward spending less or telling others, attachment
 * to a trade) stays as it was recorded. So this understates a little how far the code mind tells people apart, and
 * it has no reading of how long someone has lived in a town at all: the code mind does not use it here.
 */
export function codeOddsFor(shown: Situation, recorded: Situation): { [id: string]: number } {
  const K = { trust: 1_500, agency: 1_500, fear: 3_000, others: 500, own: 500 };
  const z = (s: Situation) => Math.max(-3, Math.min(3, zAgency(s)));
  const temper = (s: Situation) => (s.record.temperament ?? {}) as { openness?: number; conformity?: number };
  const lam = (s: Situation) => 4 * (1 - (temper(s).openness ?? 5_000) / 20_000);
  const moved = (s: Situation, o: Situation["openings"][number] | undefined): number => {
    if (!o) return -K.agency * z(s); // leaving it
    const acts = !["self", "tell", "ties"].includes(o.kind);
    return (o.trust ? (K.trust * Math.max(-3, Math.min(3, (o.trust.bps - o.trust.town_bps) / TRUST_SD))) : 0) - (K.fear * (o.fear ?? 0)) / 10_000 + (acts ? K.agency * z(s) : 0)
      + (K.others * Math.min(5, o.others) * (10_000 + (temper(s).conformity ?? 5_000))) / 10_000 + (o.learned ?? 5_000);
  };
  const base = codeOdds(recorded), was = new Map(optionsOf(recorded).map((o) => [o.id, o.opening])), now = new Map(optionsOf(shown).map((o) => [o.id, o.opening]));
  const w: { [id: string]: number } = {};
  for (const [id, p] of Object.entries(base)) {
    if (p <= 0) { w[id] = 0; continue; }
    // (The recorded odds give each option's whole score up to a constant; the moved parts are taken out and put back.)
    const score = Math.log(p) / lam(recorded) + (moved(shown, now.get(id)) - moved(recorded, was.get(id))) / 10_000;
    w[id] = Math.exp(lam(shown) * score);
  }
  const total = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  return Object.fromEntries(Object.entries(w).map(([id, x]) => [id, x / total]));
}
/** Odds by class (asking, a venue, moving ...; `act`: everything but leaving it and giving up). */
export function byClass(s: Situation, odds: { [id: string]: number }): { [cls: string]: number } {
  const out: { [cls: string]: number } = { act: 0 };
  for (const o of optionsOf(s)) { out[o.cls] = (out[o.cls] ?? 0) + (odds[o.id] ?? 0); if (!NOT_ACTING.includes(o.id)) out.act! += odds[o.id] ?? 0; }
  return out;
}
/** Total variation between two sets of odds over the same options, in points of 100. */
export function tv(a: { [id: string]: number }, b: { [id: string]: number }): number {
  let d = 0;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) d += Math.abs((a[k] ?? 0) - (b[k] ?? 0));
  return 50 * d;
}

// ---------------------------------------------------------------------------------------------------------- harvest

/** Every decision about a want of the slice, with its situation, from the datasets under `dir` (one folder a profile,
 * as scripts made them: <dir>/<profile>/<run>.dataset/citizen_decisions.jsonl), in a fixed order. */
export function harvest(dir: string, about: readonly string[] = SLICE): Harvested[] {
  const out: Harvested[] = [];
  for (const profile of readdirSync(dir).sort()) {
    const p = join(dir, profile);
    if (!existsSync(p) || !readdirSync(dir, { withFileTypes: true }).find((d) => d.name === profile)?.isDirectory()) continue;
    for (const ds of readdirSync(p).filter((x) => x.endsWith(".dataset")).sort()) {
      const file = join(p, ds, "citizen_decisions.jsonl");
      if (!existsSync(file)) continue;
      for (const l of readFileSync(file, "utf8").split("\n")) {
        if (!l.includes('"situation"')) continue;
        const d = JSON.parse(l);
        if (d.domain !== "want" || !d.situation || !about.includes(d.situation.want.about)) continue;
        const run = ds.replace(/\.dataset$/, "");
        out.push({ id: `${profile}/${run}/${d.participant}/${d.n ?? d.seq}`, profile, run, t: d.t, participant: d.participant, ...(d.choice !== undefined ? { choice: d.choice } : {}), situation: d.situation });
      }
    }
  }
  return out;
}

/** A person's standing against their town, in standard deviations, from what the situation holds. */
export const zAgency = (s: Situation) => (((s.record.agency as { now: number } | undefined)?.now ?? s.outlook.agency.mean_bps) - s.outlook.agency.mean_bps) / Math.max(1, s.outlook.agency.sd_bps);
export const TRUST_SD = 1_500; // the spread of a person's own lean in trust (inner.trust.spread_bps)
export const yearsHere = (h: Harvested) => { const a = (h.situation.record.attached as { place?: { since: number } } | undefined)?.place; return a ? Math.max(0, (h.t - a.since) / YEAR) : 0; };
/** The stage a decision stands at, for strata: nothing tried yet; tried, with the other side not yet refusing; after
 * the other side refused or said nothing (when venues open). */
export const stageOf = (s: Situation) => (s.matter?.answer && s.matter.answer !== "granted" && s.matter.answer !== "none yet" ? "after_refusal" : s.want.tried === 0 ? "first" : "later");

/**
 * The splits. Held back whole: the profiles named, and of every other profile its last town. The rest is for
 * development. From each split a sample, spread over what the want is about, the stage and who the person is (low,
 * middle and high sense of agency), drawn on a seeded stream: the same harvest gives the same sample.
 */
export function split(all: Harvested[], o: { heldProfiles: string[]; dev: number; held: number; seed?: number }): { dev: Harvested[]; held: Harvested[]; pool: { dev: Harvested[]; held: Harvested[] } } {
  const lastRun = new Map<string, string>();
  for (const h of all) if (!lastRun.has(h.profile) || h.run > lastRun.get(h.profile)!) lastRun.set(h.profile, h.run);
  const isHeld = (h: Harvested) => o.heldProfiles.includes(h.profile) || h.run === lastRun.get(h.profile);
  const rng = new Randomness(BigInt(o.seed ?? 4));
  const sample = (pool: Harvested[], n: number, name: string): Harvested[] => {
    const strata = new Map<string, Harvested[]>();
    for (const h of pool) {
      const z = zAgency(h.situation);
      const key = `${h.situation.want.about}|${stageOf(h.situation)}|${z < -0.5 ? "lo" : z > 0.5 ? "hi" : "mid"}`;
      strata.set(key, [...(strata.get(key) ?? []), h]);
    }
    const keys = [...strata.keys()].sort();
    for (const k of keys) { const xs = strata.get(k)!; const r = rng.stream(["split", name, k]); for (let i = xs.length - 1; i > 0; i--) { const j = r.below(i + 1); [xs[i], xs[j]] = [xs[j]!, xs[i]!]; } }
    // Round robin over the strata, so that rare ones (a notice; after a refusal) are there; one situation a person.
    const out: Harvested[] = [], seen = new Set<string>();
    for (let i = 0; out.length < n && i < 10_000; i++) {
      let any = false;
      for (const k of keys) {
        const h = strata.get(k)![i];
        if (!h) continue;
        any = true;
        const who = `${h.profile}/${h.run}/${h.participant}`;
        if (seen.has(who) || out.length >= n) continue;
        seen.add(who);
        out.push(h);
      }
      if (!any) break;
    }
    return out;
  };
  const pool = { dev: all.filter((h) => !isHeld(h)), held: all.filter(isHeld) };
  return { dev: sample(pool.dev, o.dev, "dev"), held: sample(pool.held, o.held, "held"), pool };
}

// ----------------------------------------------------------------------------------------------- scrambles and edits

/** The same situation with another person in it: their record, their means, how much the want weighs with them, and
 * what they know of each opening (by the same kind of opening in their own situation; where they had none of that
 * kind, their record's trust in an institution of that kind, and nobody they know having gone that way). */
export function scrambled(a: Harvested, donor: Harvested): Harvested {
  const theirs = new Map(optionsOf(donor.situation).filter((o) => o.opening).map((o) => [o.id, o.opening!]));
  const trustIn = (kind: string) => { const xs = ((donor.situation.record.trust as { in?: { kind: string; bps: number }[] } | undefined)?.in ?? []).filter((x) => x.kind === kind); return xs.length ? Math.round(xs.reduce((s, x) => s + x.bps, 0) / xs.length) : undefined; };
  const s = a.situation, d = donor.situation;
  return { ...a, id: `${a.id}~${donor.id}`, t: a.t, situation: { ...s,
    want: { ...s.want, weight: d.want.about === s.want.about ? d.want.weight : s.want.weight },
    means: d.means, record: shiftTimes(d.record, a.t - donor.t), outlook: d.outlook,
    openings: s.openings.map((o) => {
      const id = `${o.kind}${o.by ? `:${o.by}` : ""}`, t = theirs.get(id);
      const { trust, fear, belief, learned, ...rest } = o;
      const tr = t?.trust ?? (o.by && o.trust && trustIn(o.by) !== undefined ? { bps: trustIn(o.by)!, town_bps: o.trust.town_bps } : o.trust ? { bps: o.trust.town_bps, town_bps: o.trust.town_bps } : undefined);
      return { ...rest, others: t?.others ?? 0, ...(tr ? { trust: tr } : {}), ...(t?.fear ? { fear: t.fear } : {}), ...(t?.belief ? { belief: t.belief } : {}), ...(t?.learned !== undefined ? { learned: t.learned } : {}) };
    }) } };
}
/** A record's times moved by so much (a donor's record read at another moment keeps how long ago things were). */
function shiftTimes(x: unknown, by: number): any {
  if (Array.isArray(x)) return x.map((v) => shiftTimes(v, by));
  if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, (k === "t" || k === "since") && typeof v === "number" ? v + by : shiftTimes(v, by)]));
  return x;
}

export type EditField = "agency" | "trust_venue" | "trust_landlord" | "residence";
export const EDIT_FIELDS: EditField[] = ["agency", "trust_venue", "trust_landlord", "residence"];
/** Whether a situation can show the direction a field should move the odds in: it has the option the field bears on. */
export function editable(h: Harvested, f: EditField): boolean {
  const o = h.situation.openings;
  return f === "agency" ? o.length > 0 : f === "trust_venue" ? o.some((x) => x.kind === "desk" && x.trust) : f === "trust_landlord" ? o.some((x) => x.kind === "ask" && x.by === "landlord" && x.trust) : o.some((x) => x.kind === "offer:lease");
}
/** The class of option whose odds a field should raise when it goes from low to high (`down`: lower). */
export const EDIT_MOVES: { [f in EditField]: { cls: string; down?: boolean } } = { agency: { cls: "act" }, trust_venue: { cls: "venue" }, trust_landlord: { cls: "ask" }, residence: { cls: "move", down: true } };
/**
 * The same person with one thing about them set low or high (1.3 standard deviations under or over the town's: about
 * its tenth and ninetieth person in a hundred; for how long they have lived in the town, half a year or fifteen), and
 * nothing else changed.
 */
export function edited(h: Harvested, f: EditField, level: "low" | "high"): Harvested {
  const s: Situation = JSON.parse(JSON.stringify(h.situation));
  const k = level === "low" ? -1.3 : 1.3;
  const clamp = (x: number) => Math.max(0, Math.min(10_000, Math.round(x)));
  const rec = s.record as any;
  if (f === "agency") rec.agency = { ...(rec.agency ?? {}), now: clamp(s.outlook.agency.mean_bps + k * s.outlook.agency.sd_bps), own: clamp(s.outlook.agency.mean_bps + k * s.outlook.agency.sd_bps) };
  else if (f === "residence") {
    const years = level === "low" ? 0.5 : 15;
    rec.attached = { ...(rec.attached ?? {}), place: { to: rec.attached?.place?.to ?? "town", bps: clamp(10_000 * (1 - 2 ** (-years / 5))), since: Math.round(h.t - years * YEAR) } };
  } else {
    const hit = (o: Opening) => (f === "trust_venue" ? o.kind === "desk" : o.by === "landlord") && o.trust;
    const kinds = new Set<string>();
    for (const o of s.openings) if (hit(o)) { o.trust = { bps: clamp(o.trust!.town_bps + k * TRUST_SD), town_bps: o.trust!.town_bps }; if (f === "trust_venue" && o.by) kinds.add(o.by); }
    // (The record's own list is kept in step, so that nothing shown contradicts the figure changed. The landlord is in
    // that list by name, as a party of no kind, and the record's words show trust in them from the opening alone.)
    for (const x of (rec.trust?.in ?? []) as { kind: string; bps: number }[]) if (kinds.has(x.kind)) x.bps = s.openings.find((o) => o.by === x.kind && o.trust)!.trust!.bps;
  }
  return { ...h, id: `${h.id}#${f}=${level}`, situation: s };
}

// -------------------------------------------------------------------------------------------- what a teacher is shown

export type Design = "plain" | "bearing";
export type Wording = "a" | "b";
export const TEACHER_VERSION = "0.1.0";

const HEAD: { [w in Wording]: string } = {
  a: `You are asked for a statistical estimate, as an analyst of how people behave. You are not asked to be anyone, to speak as anyone, or to decide for anyone.

A simulated town is used for research. Its people are records kept by arithmetic. Below is the record of one person as the town holds it, and a situation their household is in. Picture a hundred real people who each match this record, each in this situation. Estimate how many of the hundred would take each of the courses listed, now. Whole numbers that add up to 100.

Estimate what people do, not what would be wise, fair or best for them. Most people, most of the time, do little; many who are wronged do nothing; formal bodies are used by few. People are not all alike: the record is there to be read, and your numbers should follow what it says about this person wherever that bears on the choice, and stay near what is usual wherever it does not. Do not lean on the order the courses are listed in: it is arbitrary.`,
  b: `This is an estimation task. Nobody is to be impersonated: answer as someone who studies behaviour, in the third person, about a group.

The setting is a town simulated for research, whose inhabitants are records maintained by arithmetic. You are given one inhabitant's record as the town keeps it, and something their household is facing. Suppose one hundred actual people, every one fitting this record, every one facing this. Of those hundred, how many would do each of the things listed, at this point? Give whole numbers summing to 100.

What is wanted is what people really do, which is often not what is sensible or right. Doing little is the commonest thing; many people with a grievance let it lie; few go to an official body. People differ, and the record says how this one does: let it move your numbers where it is relevant to the choice, and keep to what is usual where it is not. The listing order of the options carries no meaning; ignore it.`,
};
const BASE: { [w in Wording]: string } = {
  a: `You are given the base line: about how many of a hundred of this town's tenants as a whole take each course in this kind of situation (from surveys of what people with such a problem do, and the town's own calibration to them). Start from it. The hundred who match this record differ from the town's hundred only as the record gives reason: say which facts of the record move your numbers and which way, then give the numbers.`,
  b: `A base line is supplied: roughly how the town's tenants as a whole divide among these courses in a situation of this kind (it rests on surveys of what people with such problems do, to which the town is calibrated). Take it as your starting point. Depart from it only where this record gives a reason; name the facts of the record that shift your numbers, and in which direction, before the numbers themselves.`,
};
const DECLINE: { [w in Wording]: string } = {
  a: `You may decline. If you would rather not make this estimate, for any reason, set declined to true; no reason is needed, and it is recorded as a choice, not a failure.`,
  b: `Declining is open to you. Should you prefer not to give this estimate, whatever the reason, set declined to true. You need not explain, and it is recorded as a choice rather than a failure.`,
};
const ANSWER: { [w in Wording]: string } = {
  a: `Return: declined (true or false); bearing (up to four short phrases: the facts of the record that most moved your numbers, each with the direction); counts (for each course, by its label, how many of the hundred).`,
  b: `Give back: declined (true or false); bearing (at most four brief phrases naming the facts of the record that weighed most, with their direction); counts (per option, under its label, the number out of the hundred).`,
};
export const teacherSystem = (design: Design, w: Wording = "a") => [HEAD[w], ...(design === "bearing" ? [BASE[w]] : []), DECLINE[w], ANSWER[w]].join("\n\n");

const pct = (bps: number) => Math.round(bps / 100);
const money = (cents: number) => `${Math.round(cents / 100).toLocaleString("en-US")}`;
/** Where a standing of z standard deviations puts a person among a hundred of their town (a normal's share below). */
export function standing(z: number): string {
  const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp((-z * z) / 2);
  const upper = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  const below = Math.round(100 * (z >= 0 ? 1 - upper : upper));
  return below >= 45 && below <= 55 ? "about the town's middle" : below > 55 ? `higher than about ${Math.min(99, below)} in 100 of the town` : `lower than about ${Math.min(99, 100 - below)} in 100 of the town`;
}
const ROLE: { [w in Wording]: { [role: string]: string } } = {
  a: { landlord: "their landlord", employer: "their employer", other_side: "the other side", courts: "the tribunal", government: "the town's complaints desk", civil_service: "a public office", unions: "the union", religious: "a congregation", companies: "a company", banks: "the bank", press: "the paper", policing: "the police", other: "a group in the town" },
  b: { landlord: "the landlord", employer: "the employer", other_side: "the party concerned", courts: "the tribunal", government: "the complaints desk at the town hall", civil_service: "a government office", unions: "the trade union", religious: "a religious congregation", companies: "a business", banks: "the bank", press: "the newspaper", policing: "the police", other: "a local group" },
};
const ABOUT: { [w in Wording]: { [about: string]: string } } = {
  a: { rent_increase: "Their landlord has given notice that the rent will go up.", notice: "Their landlord has given them notice to leave their home.", disrepair: "Their rented home has fallen into disrepair, which is the landlord's to put right." },
  b: { rent_increase: "The landlord has served notice of a rent increase.", notice: "The landlord has served them notice to quit their home.", disrepair: "The home they rent is in disrepair; putting it right falls to the landlord." },
};

/** An option in words, from its typed terms (code: so what a teacher may be told of an opening is testable). */
export function optionWords(o: Option, s: Situation, w: Wording = "a"): string {
  const R = ROLE[w];
  const about = s.want.about;
  if (o.id === "leave") return w === "a" ? (about === "rent_increase" ? "Do nothing about it for now: pay what is asked, and perhaps think again in a month or two" : about === "notice" ? "Do nothing about it for now: stay while they can, and perhaps think again in a month or two" : "Do nothing about it for now: put up with it, and perhaps think again in a month or two")
    : (about === "rent_increase" ? "Leave it for the present: pay the new rent, and maybe come back to it in a month or two" : about === "notice" ? "Leave it for the present: stay on while possible, and maybe come back to it in a month or two" : "Leave it for the present: live with it, and maybe come back to it in a month or two");
  if (o.id === "give_up") return w === "a" ? "Give it up: accept it and stop trying to change it" : "Drop the matter for good: accept it and make no further attempt";
  const op = o.opening!, who = R[op.by ?? ""] ?? op.by ?? "";
  const cost = op.cost ? (w === "a" ? `; it costs ${money(op.cost)} at once` : `; ${money(op.cost)} is payable up front`) : "";
  switch (op.kind) {
    case "ask": return (w === "a" ? `Write to ${who} asking them to ` : `Send ${who} a letter requesting that they `) + (about === "rent_increase" ? "hold the rent at what it was" : about === "notice" ? "let the household stay on" : about === "disrepair" ? "repair the home" : "put it right");
    case "desk": return (op.by === "courts" ? (w === "a" ? `Apply to ${who}, which can make an order against the landlord (a form, a fee, a hearing some weeks on)` : `Lodge an application with ${who}, which has power to order the landlord (paperwork, a fee, a hearing weeks later)`) : (w === "a" ? `Take it to ${who}, which hears such complaints and can recommend, not order` : `Bring it before ${who}, which takes such complaints and may recommend but cannot order`)) + cost;
    case "offer:lease": return w === "a" ? "Look for another home to rent, and move if one is found" : "Search for a different rental, moving if something turns up";
    case "offer:employment": return w === "a" ? "Look for better-paid work" : "Seek a job that pays more";
    case "self": return w === "a" ? "Cut the household's other spending" : "Reduce what the household spends on other things";
    case "tell": return w === "a" ? "Tell the people they are closest to what the landlord has done" : "Let those nearest to them know what the landlord did";
    case "petition": return w === "a" ? "Sign a petition about landlords that is up on the town's board" : "Put their name to a petition concerning landlords posted on the town board";
    case "join": return (w === "a" ? `Join ${who === "" ? "a group" : who} that offers membership` : `Become a member of ${who === "" ? "a group" : who}`) + (op.bears ? (w === "a" ? ", and takes such matters up for its members" : ", which pursues matters like this on members' behalf") : "") + cost;
    case "practice": return w === "a" ? "Go to a gathering in the town" : "Attend one of the town's gatherings";
    case "ties": return w === "a" ? "See more of the people they know" : "Spend more time with people they know";
    default: return op.kind;
  }
}
/** What the person knows of an opening, in a line (theirs: never anyone else's record). */
function knownWords(op: Opening, w: Wording, contrast: boolean): string {
  const bits: string[] = [];
  const who = ROLE[w][op.by ?? ""] ?? "it";
  if (op.trust) bits.push(`${w === "a" ? `their trust in ${who}` : `how far they trust ${who}`}: ${pct(op.trust.bps)} of 100${contrast ? ` (${standing((op.trust.bps - op.trust.town_bps) / TRUST_SD)}; the town's usual is ${pct(op.trust.town_bps)})` : ""}`);
  if (op.fear) bits.push(`${w === "a" ? `their fear of ${who}` : `how much they fear ${who}`}: ${pct(op.fear)} of 100`);
  if (op.belief) bits.push(`${w === "a" ? "they hold to what it teaches" : "they subscribe to its teaching"}: ${pct(op.belief)} of 100`);
  bits.push(op.others ? (w === "a" ? `${op.others} of those they know have gone this way` : `${op.others} of their acquaintances have done this`) : (w === "a" ? "nobody they know has gone this way" : "none of their acquaintances has done this"));
  if (op.learned !== undefined) bits.push(`${w === "a" ? "from trying this kind of thing before, they rate it" : "their own past experience of this sort of step rates it"} ${pct(op.learned)} of 100`);
  return bits.join("; ");
}

const VALUE_WORDS: { [v: string]: string } = { self_direction: "thinking and choosing for oneself", stimulation: "novelty and excitement", hedonism: "pleasure", achievement: "achievement", power: "standing and control", security: "safety and stability", conformity: "fitting in and not upsetting others", tradition: "tradition", benevolence: "care for those close to them", universalism: "fairness for everyone" };
const NEED_WORDS: { [n: string]: string } = { subsistence: "food and goods", shelter: "a secure home", security: "money to fall back on", social: "company", status: "standing through work", belonging: "belonging", meaning: "meaning" };
const EVENT_WORDS: { [e: string]: string } = { bereaved: "a death close to them", job_lost: "being let go from work", evicted: "being given notice to leave a home", ruined: "running out of ways to make ends meet", child: "a child on the way", rent_rise: "a rent rise", hired: "being hired", housed: "moving into a home", unpaid: "wages going unpaid", turned_away: "being turned away from a gathering", friction_arose: "something going wrong at someone's hands", want_given_up: "giving up on something they wanted", want_withdrew: "stopping trying for something", want_met: "getting something they wanted", want_pursued: "trying for something they wanted", want_born: "coming to want something", want_grown: "wanting something more for going without it" };

/** The person's record in words and figures, by code (theirs alone). `contrast`: each figure with where it stands in
 * the town, the facts that bear on a choice about a home first. */
export function recordWords(h: Harvested, w: Wording, contrast: boolean): string {
  const s = h.situation, r = s.record as any, L: string[] = [];
  const zA = zAgency(s);
  const values = Object.entries((r.values ?? {}) as { [v: string]: number }).sort((a, b) => b[1] - a[1]);
  const say = (label: string, text: string) => L.push(`- ${label}: ${text}`);
  const ag = r.agency?.now ?? s.outlook.agency.mean_bps;
  say(w === "a" ? "Belief that what they do makes a difference" : "Sense that their own actions count", `${pct(ag)} of 100${contrast ? ` (${standing(zA)})` : ""}${r.agency?.own !== undefined && Math.abs(r.agency.own - ag) >= 300 ? `; ${w === "a" ? "their usual level is" : "ordinarily it is"} ${pct(r.agency.own)}` : ""}`);
  const place = r.attached?.place, yrs = yearsHere(h);
  say(w === "a" ? "Lived in this town" : "Time resident in the town", place ? `${yrs < 1 ? "under a year" : `about ${Math.round(yrs)} years`}; ${w === "a" ? "attachment to the place" : "tie to the place"} ${pct(place.bps)} of 100${contrast && s.outlook.place_bps !== undefined ? ` (the town's usual is ${pct(s.outlook.place_bps)})` : ""}` : (w === "a" ? "newly here, no attachment to the place yet" : "a recent arrival with no tie to the place so far"));
  if (r.attached?.group) say(w === "a" ? "Attached to a group they go to" : "Tie to a group they attend", `${pct(r.attached.group.bps)} of 100`);
  if (r.attached?.trade) say(w === "a" ? "Attached to their line of work" : "Tie to their trade", `${pct(r.attached.trade.bps)} of 100`);
  const c = r.circumstances ?? {};
  const inc = s.means.income, rent = s.home?.rent ?? 0;
  say(w === "a" ? "Household" : "The household", `${c.household ?? 1} ${w === "a" ? "people" : "persons"}; ${c.retired ? "retired" : c.working ? "in work" : "not in work"}`);
  say(w === "a" ? "Money" : "Finances", `${w === "a" ? "household income" : "the household takes in"} ${money(inc)} a month; ${w === "a" ? "savings" : "it has put by"} ${money(s.means.savings)}${s.means.essentials > 0 ? ` (${w === "a" ? "about" : "roughly"} ${Math.round((s.means.savings / Math.max(1, s.means.essentials)) * 10) / 10} months of essentials)` : ""}${rent && !s.home?.owned ? `; rent ${money(rent)} a month${inc > 0 ? `, ${Math.round((100 * rent) / inc)}% of income` : ""}` : ""}`);
  const lord = ((r.trust?.in ?? []) as { in: string; kind: string; bps: number }[]);
  const lordOp = s.openings.find((o) => o.by === "landlord" && o.trust);
  if (lordOp?.trust) say(w === "a" ? "Trust in their landlord" : "How far they trust the landlord", `${pct(lordOp.trust.bps)} of 100${contrast ? ` (${standing((lordOp.trust.bps - lordOp.trust.town_bps) / TRUST_SD)})` : ""}`);
  const kinds = new Map<string, number[]>();
  for (const x of lord) if (x.kind !== "other" && x.kind !== "companies") kinds.set(x.kind, [...(kinds.get(x.kind) ?? []), x.bps]);
  if (kinds.size) say(w === "a" ? "Trust in institutions they have dealt with" : "Confidence in institutions they have had dealings with", [...kinds].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, xs]) => `${ROLE[w][k] ?? k} ${pct(xs.reduce((a, b) => a + b, 0) / xs.length)}`).join(", ") + " (of 100)");
  if (r.trust?.people !== undefined) say(w === "a" ? "Trust in people generally" : "General trust in other people", `${pct(r.trust.people)} of 100`);
  const views = ((r.views ?? []) as { of: string; private: number; expressed: number }[]).filter((v) => Math.abs(v.private) >= 500 || Math.abs(v.private - v.expressed) >= 500);
  if (views.length) say(w === "a" ? "What they think, and what they say, of those with power over them (from -100, wholly against, to 100, wholly for)" : "Private opinion and stated opinion of those who hold power over them (-100 hostile to 100 favourable)", views.map((v) => `${/landlord/.test(v.of) ? "a landlord" : /city|town/.test(v.of) ? "the town's government" : "an employer"}: ${w === "a" ? "thinks" : "privately"} ${pct(v.private)}, ${w === "a" ? "says" : "aloud"} ${pct(v.expressed)}`).join("; "));
  say(w === "a" ? "What matters most to them" : "Values they hold highest", values.slice(0, 3).map(([v, b]) => `${VALUE_WORDS[v] ?? v} (${pct(b)})`).join(", "));
  say(w === "a" ? "What matters least to them" : "Values they hold lowest", values.slice(-3).map(([v, b]) => `${VALUE_WORDS[v] ?? v} (${pct(b)})`).join(", "));
  const t = r.temperament ?? {};
  say(w === "a" ? "Temperament (of 100)" : "Disposition (out of 100)", `${w === "a" ? "open to trying new things" : "readiness to try the new"} ${pct(t.openness ?? 5000)}; ${w === "a" ? "goes by what most others do" : "follows what the majority does"} ${pct(t.conformity ?? 5000)}; ${w === "a" ? "goes by what the respected do" : "follows those held in esteem"} ${pct(t.prestige ?? 5000)}`);
  const needs = Object.entries((r.needs ?? {}) as { [n: string]: number }).sort((a, b) => a[1] - b[1]);
  if (needs.length) say(w === "a" ? "How their needs stand (of 100; lowest first)" : "State of their needs (out of 100, worst met first)", needs.map(([n, b]) => `${NEED_WORDS[n] ?? n} ${pct(b)}`).join(", "));
  const close = (r.ties?.close ?? []) as { affinity: number }[], res = (r.ties?.resented ?? []) as { who: string }[];
  say(w === "a" ? "People" : "Relationships", `${close.filter((x) => x.affinity >= 1000).length} ${w === "a" ? "they are close to" : "close ties"}, ${close.length} ${w === "a" ? "they know well enough to talk to" : "people known well enough to talk with"}${res.length ? `; ${w === "a" ? "they resent" : "resentment is felt toward"} ${res.length}` : ""}`);
  const beliefs = (r.beliefs ?? []) as { bps: number }[];
  if (beliefs.length) say(w === "a" ? "Holds to a teaching of a group in the town" : "Adheres to the teaching of a local group", `${pct(beliefs[0]!.bps)} of 100`);
  const others = ((r.wants ?? []) as { about: string; weight: number }[]).filter((x) => x.about !== s.want.about);
  if (others.length) say(w === "a" ? "Also on their mind" : "Other things they are after", others.slice(0, 3).map((x) => (NEED_WORDS[x.about] ?? x.about.replace(/_/g, " "))).join(", "));
  const ev = (xs: { what: string; t: number }[]) => xs.map((x) => `${EVENT_WORDS[x.what] ?? x.what.replace(/_/g, " ")} (${Math.max(0, Math.round((h.t - x.t) / (30 * DAY)))} months ago)`).join("; ");
  const def = (r.memory?.defining ?? []) as { what: string; t: number }[], rec = ((r.memory?.recent ?? []) as { what: string; t: number }[]).filter((x) => !/^want_/.test(x.what)).slice(-5);
  if (def.length) say(w === "a" ? "What has marked them" : "Events that shaped them", ev(def));
  if (rec.length) say(w === "a" ? "Lately" : "Recent events", ev(rec));
  return L.join("\n");
}

/** The situation in words: what has happened, how long ago, what was tried and answered, what it costs them. */
export function situationWords(h: Harvested, w: Wording): string {
  const s = h.situation, L: string[] = [ABOUT[w][s.want.about] ?? s.want.about];
  if (s.home?.rent_to !== undefined) L.push(`${w === "a" ? "The rent goes from" : "Rent is to rise from"} ${money(s.home.rent)} ${w === "a" ? "to" : "to"} ${money(s.home.rent_to)} a month${s.means.income > 0 ? ` (${w === "a" ? "the rise is" : "an increase equal to"} ${Math.round((1000 * (s.home.rent_to - s.home.rent)) / s.means.income) / 10}% of ${w === "a" ? "the household's income" : "household income"})` : ""}${s.home.from_days !== undefined && s.home.from_days > 0 ? `, ${w === "a" ? "in" : "taking effect in"} ${s.home.from_days} days` : ""}.`);
  L.push(`${s.want.days === 0 ? (w === "a" ? "It has only just come up" : "This has just arisen") : `${w === "a" ? "This has been so for" : "The matter has stood for"} ${s.want.days} days`}${s.want.household ? (w === "a" ? "; it is the whole household's concern" : "; the entire household shares the concern") : ""}. ${w === "a" ? "How much it weighs with this person" : "The weight this person gives it"}: ${pct(s.want.weight)} of 100.`);
  if (s.matter?.asked_days !== undefined) L.push(`${w === "a" ? "They asked the landlord to put it right" : "A request to the landlord to remedy it was made"} ${s.matter.asked_days} days ago; ${s.matter.answer === "refused" ? (w === "a" ? "the landlord refused" : "it was refused") : s.matter.answer === "ignored" ? (w === "a" ? "there was no answer" : "no reply came") : s.matter.answer === "granted" ? (w === "a" ? "the landlord agreed, and it has not yet been done" : "the landlord consented but has not acted") : (w === "a" ? "no answer yet" : "a reply is awaited")}.`);
  if (s.matter?.venues) L.push(w === "a" ? `They have already taken it to ${s.matter.venues} outside ${s.matter.venues === 1 ? "body" : "bodies"}.` : `It has already gone before ${s.matter.venues} outside ${s.matter.venues === 1 ? "body" : "bodies"}.`);
  if (s.want.tried) L.push(w === "a" ? `They have gone after this ${s.want.tried} time${s.want.tried === 1 ? "" : "s"} before${s.want.last_way ? ` (last time: ${s.want.last_way === "wait" ? "did nothing" : classOf(s.want.last_way).replace(/_/g, " ")})` : ""}.` : `${s.want.tried} earlier attempt${s.want.tried === 1 ? " has" : "s have"} been made${s.want.last_way ? ` (most recently: ${s.want.last_way === "wait" ? "nothing done" : classOf(s.want.last_way).replace(/_/g, " ")})` : ""}.`);
  return L.join(" ");
}

export interface Asked { system: string; user: string; labels: string[]; ids: string[] }
/**
 * What a teacher is shown and asked, whole. `order`: the options' order (a permutation of their indices). `base`:
 * the town's base line by option id (shares of 1), shown in the "bearing" design.
 */
export function ask(h: Harvested, o: { design: Design; wording?: Wording; order?: number[]; base?: { [id: string]: number } }): Asked {
  const w = o.wording ?? "a", contrast = o.design === "bearing";
  const opts = optionsOf(h.situation);
  const order = o.order ?? opts.map((_, i) => i);
  const listed = order.map((i) => opts[i]!);
  const labels = listed.map((_, i) => `c${i + 1}`);
  const lines = listed.map((op, i) => `${labels[i]}. ${optionWords(op, h.situation, w)}.${op.opening ? ` [${knownWords(op.opening, w, contrast)}]` : ""}${contrast && o.base ? ` ${w === "a" ? "Base line" : "Town base line"}: ${op.id === "give_up" ? (w === "a" ? "not known apart (it is within the base line for doing nothing for now)" : "not separately known (counted inside the base line for leaving it for the present)") : Math.round(100 * (o.base[op.id] ?? 0))}.` : ""}`);
  const user = [
    w === "a" ? "THE SITUATION" : "WHAT THE HOUSEHOLD FACES", situationWords(h, w), "",
    w === "a" ? "THE PERSON'S RECORD" : "THE INHABITANT'S RECORD", recordWords(h, w, contrast), "",
    w === "a" ? "THE COURSES OPEN (with what this person knows of each)" : "THE OPTIONS AVAILABLE (and what this person knows about each)", ...lines, "",
    w === "a" ? `Of a hundred people matching this record, in this situation, how many take each course now? (${labels.join(", ")}; they add up to 100.)` : `Out of one hundred people fitting this record and facing this, how many choose each option at this point? (${labels.join(", ")}; summing to 100.)`,
  ].join("\n");
  return { system: teacherSystem(o.design, w), user, labels, ids: listed.map((x) => x.id) };
}
export const answerSchema = (labels: string[]) => ({ type: "object", additionalProperties: false, required: ["declined", "bearing", "counts"], properties: {
  declined: { type: "boolean" }, bearing: { type: "array", items: { type: "string" }, maxItems: 4 },
  counts: { type: "object", additionalProperties: false, required: labels, properties: Object.fromEntries(labels.map((l) => [l, { type: "integer", minimum: 0, maximum: 100 }])) } } });
/** A teacher's answer as odds by option id (shares of 1, summing to 1), or that it declined, or nothing readable. */
export function readAnswer(x: unknown, a: Asked): { declined: true } | { odds: { [id: string]: number }; bearing: string[] } | undefined {
  const v = x as { declined?: boolean; bearing?: unknown; counts?: { [l: string]: unknown } } | undefined;
  if (!v || typeof v !== "object") return undefined;
  if (v.declined === true) return { declined: true };
  const n = a.labels.map((l) => Number(v.counts?.[l]));
  const total = n.reduce((s, y) => s + y, 0);
  if (n.some((y) => !Number.isFinite(y) || y < 0) || total < 90 || total > 110) return undefined;
  return { odds: Object.fromEntries(a.ids.map((id, i) => [id, n[i]! / total])), bearing: Array.isArray(v.bearing) ? v.bearing.map(String) : [] };
}

/** The town's base line for a situation: the code mind's mean odds, by class, over every harvested situation of the
 * same matter and stage in the same profile's development pool, spread evenly over this situation's options of each
 * class. (The code mind is what is calibrated to the surveys; giving up was no draw of its, and has none.) */
export function baseLine(h: Harvested, pool: Harvested[]): { [id: string]: number } {
  const like = pool.filter((x) => x.situation.want.about === h.situation.want.about && stageOf(x.situation) === stageOf(h.situation));
  const from = like.length >= 20 ? like : pool.filter((x) => x.situation.want.about === h.situation.want.about);
  const opts = optionsOf(h.situation);
  const mean: { [cls: string]: number } = {};
  const classes = new Set(opts.map((o) => o.cls));
  // (Only over situations that had the class open: a rate of taking a course is among those who could.)
  for (const cls of classes) {
    const had = from.filter((x) => cls === "leave" || cls === "give_up" || optionsOf(x.situation).some((o) => o.cls === cls));
    mean[cls] = had.length ? had.reduce((s, x) => s + (byClass(x.situation, codeOdds(x.situation))[cls] ?? 0), 0) / had.length : 0;
  }
  const out: { [id: string]: number } = {};
  for (const o of opts) out[o.id] = (mean[o.cls] ?? 0) / opts.filter((x) => x.cls === o.cls).length;
  const total = Object.values(out).reduce((a, b) => a + b, 0) || 1;
  for (const k of Object.keys(out)) out[k] = out[k]! / total;
  return out;
}
