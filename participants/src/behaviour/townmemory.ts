// Town memory (docs/design/ai-citizens.md 14e; docs/behaviour/culture.md, "Town memory"): what a person carries of what happened to others and
// was public. Nothing here is the town's: a few typed slots in one person's own record, each with a strength that fades, and a count of the hands it
// has passed through. An event reaches a person only three ways and no fourth: they were there (their own place put them there), it was published and
// they read it, or someone they know told them. Telling is by the same typed phrases catching up uses; fading is worked out when read, from the days
// gone (nothing runs daily); there is no draw. Arithmetic only: no model, no clock.
//
// The platform judges nothing: what an event does to a person's trust is the sign of their OWN view of the conduct it shows, never the platform's.
// Every size is a PLACEHOLDER unless docs/behaviour/culture.md names a source; one set for every kind of event.

import type { CultureParams } from "./culture";

/** What a person may remember of the town, in the order the record keeps them (a closed list; the kinds that something in the world makes public). */
export const EVENT_KINDS = ["put_out", "strike", "ruling", "law", "vote", "founded"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
const HOWS = ["saw", "read", "told"] as const;
export type How = (typeof HOWS)[number];
const DAY = 86_400;

/** The conduct an event shows, for the sighting it is of that conduct and for the sign of its bearing on trust (a person's own view of that conduct). */
export const EVENT_CONDUCT: { [k in EventKind]?: "apply_possession" | "strike" } = { put_out: "apply_possession", strike: "strike" };

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
  say: (kind: EventKind, about: string, day: number, strengthBps: number, hops: number): string =>
    `Talk of the town: ${KIND_WORDS[kind]}, ${about}, day ${day}; I hold it at ${Math.max(1, Math.min(10, Math.round(strengthBps / 1_000)))} in 10, through ${hops} ${hops === 1 ? "hand" : "hands"}.`,
  /** What a phrase tells (found anywhere in a message, which joins a person's phrases): the kind, who it was about, the day, the teller's strength (basis points) and hands. */
  heard: (text: string): { kind: EventKind; about: string; day: number; strength: number; hops: number } | undefined => {
    const m = new RegExp(`Talk of the town: (${EVENT_KINDS.map((k) => KIND_WORDS[k]).join("|")}), ([^\\s,]+), day (\\d+); I hold it at (\\d+) in 10, through (\\d+) hands?\\.`).exec(text);
    if (!m) return undefined;
    const kind = EVENT_KINDS.find((k) => KIND_WORDS[k] === m[1])!;
    return { kind, about: m[2]!, day: Number(m[3]), strength: Number(m[4]) * 1_000, hops: Number(m[5]) };
  },
};

/** The paper's own weight for an item, by the kind of record it reports (docs/behaviour/news.md, KINDS); an event read in the paper is held at
 * `read_bps` times this over the heaviest. */
export const PAPER_WEIGHT: { [record: string]: { kind: EventKind; weight: number } } = {
  law: { kind: "law", weight: 2 }, budget: { kind: "law", weight: 2 }, ballot_result: { kind: "vote", weight: 4 }, permit_decision: { kind: "ruling", weight: 1 },
};
const PAPER_HEAVIEST = 4;
export const paperStrength = (weight: number, p: CultureParams): number => Math.round((p.read_bps * Math.min(weight, PAPER_HEAVIEST)) / PAPER_HEAVIEST);

/** One thing remembered. `first` is how strongly it was first held (rehearsal returns to it); `s0` how strongly at `at`; it fades from there. */
export interface Slot { kind: EventKind; about: string; day: number; how: How; hops: number; first: number; s0: number; at: number; told: Set<string> }

/** A slot as the record holds it, positional: [kind, about, event day, strength at `at` (whole percent), how, hops, `at` (day)]. The current strength is not
 * written (it fades by a formula anyone reading the record can apply): so the section changes only on an arrival or a rehearsal, never by the days going. */
export type HeardRow = [number, string, number, number, number, number, number];
export type HeardSection = HeardRow[];

/** What a person remembers of the town: at most `slots` events, a typed few. */
export class TownMemory {
  private readonly held: Slot[] = [];
  private cached: HeardSection | undefined;
  private dirty = true;
  /** Sightings already taken in (a departure seen by its space, who and when), so nothing seen twice is counted twice. */
  private readonly seen: string[] = [];
  constructor(readonly p: CultureParams) {}

  private half(how: How): number { return (how === "saw" ? this.p.half_life_seen_days : this.p.half_life_told_days) * DAY; }
  /** How strongly a slot is held at `now` (basis points): worked out from the days gone. */
  strength(s: Slot, now: number): number { return Math.round(s.s0 * Math.pow(0.5, Math.max(0, now - s.at) / this.half(s.how))); }
  private find(kind: EventKind, about: string, day: number): Slot | undefined { return this.held.find((s) => s.kind === kind && s.about === about && s.day === day); }
  all(): readonly Slot[] { return this.held; }
  size(): number { return this.held.length; }

  /** How strongly I hold a thing now, or 0. */
  strengthOf(kind: EventKind, about: string, eventT: number, now: number): number { const s = this.find(kind, about, Math.floor(eventT / DAY)); return s ? this.strength(s, now) : 0; }
  /** A sighting not yet counted (by key); remembered to a bound so a person's working state stays small. */
  newSighting(key: string): boolean {
    if (this.seen.includes(key)) return false;
    this.seen.push(key);
    if (this.seen.length > 200) this.seen.shift();
    return true;
  }

  /**
   * An event reaches me. Returns what became of it: `fresh` (a slot made: I had not held it), `again` (I held it, and it returns the way to what it first was: rehearsal),
   * or `dropped` (past `max_hops`, or weaker than everything I hold with the slots full). `strength` is how strongly it reaches me.
   */
  take(kind: EventKind, about: string, eventT: number, now: number, how: How, strength: number, hops: number): "fresh" | "again" | "dropped" {
    if (hops > this.p.max_hops) return "dropped";
    const day = Math.floor(eventT / DAY);
    const s = Math.max(0, Math.min(10_000, Math.round(strength)));
    const old = this.find(kind, about, day);
    if (old) {
      const now_ = this.strength(old, now);
      old.s0 = Math.min(10_000, Math.round(now_ + ((old.first - now_) * this.p.rehearse_bps) / 10_000));
      old.at = now;
      // (Seen is seen: a thing I saw does not become a thing I only heard.)
      if (hops < old.hops) old.hops = hops;
      this.dirty = true;
      return "again";
    }
    if (this.held.length >= this.p.slots) {
      let weakest = 0;
      for (let i = 1; i < this.held.length; i++) if (this.strength(this.held[i]!, now) < this.strength(this.held[weakest]!, now)) weakest = i;
      if (this.strength(this.held[weakest]!, now) >= s) return "dropped";
      this.held.splice(weakest, 1);
    }
    this.held.push({ kind, about, day, how, hops, first: s, s0: s, at: now, told: new Set() });
    this.dirty = true;
    return "fresh";
  }

  /** I saw it: my own place put me there. */
  saw(kind: EventKind, about: string, eventT: number, now: number) { return this.take(kind, about, eventT, now, "saw", this.p.seen_bps, 0); }
  /** I read it (the paper's item, a published paper). */
  read(kind: EventKind, about: string, eventT: number, now: number, strength: number) { return this.take(kind, about, eventT, now, "read", strength, 0); }
  /** Someone I know told me, holding it at `tellerStrength` through `hops` hands; the hearing is `pass_bps` of that, and more for what I hold against. */
  heardFrom(kind: EventKind, about: string, day: number, now: number, tellerStrength: number, hops: number, holdsAgainst: boolean) {
    const pass = this.p.pass_bps + (holdsAgainst ? this.p.negative_bps : 0);
    return this.take(kind, about, day * DAY, now, "told", Math.min(10_000, (tellerStrength * pass) / 10_000), hops + 1);
  }

  /**
   * What I tell someone who asks how things are: the one thing I hold strongest, above `tell_at_bps`, that I have not told them (each tie keeps what it was told).
   * Nothing is drawn. Returns the phrase, or none.
   */
  tell(asker: string, now: number): string | undefined {
    let best: Slot | undefined;
    for (const s of this.held) {
      if (s.told.has(asker)) continue;
      const v = this.strength(s, now);
      if (v < this.p.tell_at_bps) continue;
      if (!best || v > this.strength(best, now) || (v === this.strength(best, now) && (s.day > best.day || (s.day === best.day && s.about < best.about)))) best = s;
    }
    if (!best) return undefined;
    best.told.add(asker);
    if (best.told.size > 40) best.told.delete(best.told.values().next().value!);
    return TOWN_WORDS.say(best.kind, best.about, best.day, this.strength(best, now), best.hops);
  }

  /** The record's section, positional and small (a few dozen bytes a slot); the same array until something arrives. */
  section(): HeardSection {
    if (this.cached && !this.dirty) return this.cached;
    this.dirty = false;
    return (this.cached = this.held.map((s) => [EVENT_KINDS.indexOf(s.kind), s.about, s.day, Math.round(s.s0 / 100), HOWS.indexOf(s.how), s.hops, Math.floor(s.at / DAY)] as HeardRow));
  }
}

/** The strength of a row of the record at day `day`, as anyone reading the record would work it out (the formula, not a stored figure). */
export function rowStrengthPct(row: HeardRow, day: number, p: Pick<CultureParams, "half_life_seen_days" | "half_life_told_days">): number {
  const half = HOWS[row[4]] === "saw" ? p.half_life_seen_days : p.half_life_told_days;
  return row[3] * Math.pow(0.5, Math.max(0, day - row[6]) / half);
}
