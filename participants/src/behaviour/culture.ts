// Culture: what a town holds in common (docs/design/ai-citizens.md section 14; docs/behaviour/culture.md).
//
// For a short list of conducts (each tied to one draw the code mind already makes) a person holds a picture of what
// those around them do and approve of, and their own leaning from their values. Nothing here is the town's: every
// figure is one person's belief, kept in their own record, moved only by what reaches them along a tie, by being
// there, or by what is published (`Culture.learn` refuses any other route). It is arithmetic only: no model, no
// clock, and no draw but a person's starting lean (on their own stream).
//
// The platform judges nothing. No conduct is marked as the one a good town has; no group is better or worse at any
// of them. Every size is a PLACEHOLDER unless docs/behaviour/culture.md names a source, one set for every conduct.
//
// Off (no `dials.culture` in the world's config): nothing here is entered, and the world is the one it was.

import { VALUES, type Value } from "./mind";

/** The conducts a world may hold, in the order the record keeps them. The list is closed, in code: at most 12. */
export const CONDUCTS = [
  "answer_tribunal", "stay_past_notice", "take_to_tribunal", "complain", "take_in", "join_union", "strike", "take_from_employer",
  // (An organisation's own conducts: a person holds a view of them, what landlords here do and whether it is right.)
  "apply_possession", "heads_before_hours", "order_possession",
] as const;
export type Conduct = (typeof CONDUCTS)[number];
export const MAX_CONDUCTS = 12;

/** The conducts a person makes a choice about today: each has a draw, and takes a term there. */
export const PERSONS_CONDUCTS: readonly Conduct[] = CONDUCTS.slice(0, 8);

/** Words for a conduct, in the world's terms: the occasion, and what doing it and not doing it are; and the thing done,
 * for what is said of it. A code person's phrasing, understood only in this phrasing (as every catching-up phrase is). */
export const WORDS: { [c in Conduct]?: { occasion: string; did: string; didNot: string; thing: string } } = {
  answer_tribunal: { occasion: "Served with an application for possession", did: "I answered it", didNot: "I did not answer it", thing: "answering an application for possession" },
  stay_past_notice: { occasion: "Told to vacate and unable to pay", did: "I was still there at the date", didNot: "I left by the date", thing: "staying past a notice to vacate" },
  take_to_tribunal: { occasion: "Wronged by an unlawful rent rise or an unpaid debt", did: "I applied to the tribunal", didNot: "I did not apply", thing: "applying to the tribunal" },
  complain: { occasion: "When a service failed", did: "I wrote to the town", didNot: "I did not write", thing: "writing to the town about a service" },
  take_in: { occasion: "Asked for a roof by someone known", did: "I said yes", didNot: "I said no", thing: "taking in someone who asks for a roof" },
  join_union: { occasion: "At a new job", did: "I joined the union", didNot: "I did not join", thing: "joining the union" },
  strike: { occasion: "Balloted on action", did: "I voted yes", didNot: "I voted no", thing: "voting for action" },
  take_from_employer: { occasion: "Short of money at work among goods", did: "I took some", didNot: "I took nothing", thing: "taking goods from an employer" },
};
/** What is said of a conduct, in five steps, and the middle of each (basis points). */
export const SAYINGS = [["plainly wrong", 1_000], ["wrong", 3_000], ["neither right nor wrong", 5_000], ["right", 7_000], ["plainly right", 9_000]] as const;

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
  /** Where a person comes from, told when asked how things are (only where the world has origin groups). */
  from: (group: string): string => `I come from the ${group} group.`,
  fromHeard: (text: string): string | undefined => /I come from the ([^\s.]+) group\./.exec(text)?.[1],
};

/** Which values speak to a conduct, and which way (ours, to test against data, as needs-from-values is): a signed list. */
export const VALUE_MAP: { [c in Conduct]: [Value, 1 | -1][] } = {
  answer_tribunal: [["conformity", 1], ["security", 1]],
  stay_past_notice: [["security", 1], ["conformity", -1]],
  take_to_tribunal: [["self_direction", 1], ["universalism", 1]],
  complain: [["self_direction", 1], ["universalism", 1], ["conformity", -1]],
  take_in: [["benevolence", 1], ["tradition", 1]],
  join_union: [["universalism", 1], ["benevolence", 1], ["power", -1]],
  strike: [["universalism", 1], ["benevolence", 1], ["security", -1]],
  take_from_employer: [["conformity", -1], ["tradition", -1], ["hedonism", 1]],
  apply_possession: [["power", 1], ["security", 1], ["benevolence", -1]],
  heads_before_hours: [["achievement", 1], ["benevolence", -1]],
  order_possession: [["conformity", 1], ["security", 1]],
};

/** The sizes (docs/behaviour/culture.md; every one a placeholder unless the doc names a source). */
export interface CultureParams {
  /** Weight of the picture a person starts with (as if this many had been seen). */
  prior_weight: number;
  /** The spread of the lean a person starts with, and the movement per standard deviation of the values that speak to a conduct. */
  own_sd_bps: number;
  values_bps: number;
  /** What is seen is held to this much weight: the recent counts for more. */
  window: number;
  /** A sighting's weight: someone known (1), a close tie, a published count (up to). */
  known_weight: number;
  close_weight: number;
  published_weight: number;
  /** A tie is close at this affinity. */
  close_affinity_bps: number;
  /** `own` settles half the way to `approves` in this many days. */
  internalise_days: number;
  /** The decision term: the lean is the share of the standard deviation `sd_bps` the person is moved by, `w_does` and `w_approves` weigh what is done and what is approved. */
  sd_bps: number;
  w_does_bps: number;
  w_approves_bps: number;
  /** The sway of a lean on a rate (`swayed`): thousandths of the rate per standard deviation. */
  sway_milli: number;
  /** One's own conduct is told only if it sits within this of what one takes to be approved (or one's integrity is high). */
  conceal_bps: number;
  /** An integrity above this tells whatever it is. */
  integrity_tells_bps: number;
  /** What fraction (basis points) of the move of a number is kept before the record is written again: the record's grain, whole percent. */
  grain_percent: number;
  /** Placeholder for what is approved where the profile is silent. */
  approves_default_bps: number;
  /** Placeholder for what is done, for a conduct with no rate of its own and no figure. */
  does_default_bps: number;
  /** Most phrases a person adds to what they say when asked how things are. */
  phrases: number;
}
export const CULTURE_DEFAULTS: CultureParams = {
  prior_weight: 4, own_sd_bps: 1_500, values_bps: 500, window: 20, known_weight: 1, close_weight: 2, published_weight: 4, close_affinity_bps: 3_000,
  internalise_days: 1_095, sd_bps: 2_500, w_does_bps: 6_000, w_approves_bps: 4_000, sway_milli: 300, conceal_bps: 7_500, integrity_tells_bps: 7_000,
  grain_percent: 2, approves_default_bps: 5_000, does_default_bps: 5_000, phrases: 3,
};
const INTS: (keyof CultureParams)[] = Object.keys(CULTURE_DEFAULTS) as (keyof CultureParams)[];

/** The sizes the world gives, over the defaults, refusing any that would break the arithmetic (a weight below 1, a window
 * below the prior, a share outside 0..10000). */
export function cultureParams(given?: any): CultureParams {
  const p = { ...CULTURE_DEFAULTS, ...(given ?? {}) } as CultureParams;
  for (const k of INTS) if (!Number.isInteger(p[k]) || p[k] < 0) throw new Error(`dials.culture.step.${k}: a size is a whole number, not below 0; got ${p[k]}`);
  for (const k of ["own_sd_bps", "values_bps", "w_does_bps", "w_approves_bps", "close_affinity_bps", "conceal_bps", "integrity_tells_bps", "approves_default_bps", "does_default_bps"] as const)
    if (p[k] > 10_000) throw new Error(`dials.culture.step.${k}: a share is from 0 to 10000; got ${p[k]}`);
  for (const k of ["prior_weight", "window", "known_weight", "close_weight", "published_weight", "internalise_days", "sd_bps"] as const)
    if (p[k] < 1) throw new Error(`dials.culture.step.${k}: must be at least 1; got ${p[k]}`);
  if (p.window < p.prior_weight || p.window < p.published_weight) throw new Error("dials.culture.step.window: must hold the prior's and a published count's weight");
  if (p.sway_milli > 1_000) throw new Error(`dials.culture.step.sway_milli: a lean may move a rate by at most the whole of it per standard deviation; got ${p.sway_milli}`);
  if (p.phrases > 6) throw new Error(`dials.culture.step.phrases: at most 6 phrases a time; got ${p.phrases}`);
  return p;
}

/** The profile's figures for a conduct: what is done and what is approved, in basis points, either may be absent. */
export interface ConductFigures { does_bps?: number; approves_bps?: number }
/** The dial as the world carries it: which conducts are live, the sizes, and the profile's figures (the generator copies them, with the dial, from the profile). */
export interface CultureDial {
  conducts: Conduct[];
  params: CultureParams;
  /** The profile's figures by conduct, and by origin group (a group's figures replace the profile's for those who come from it). */
  figures: { [c: string]: ConductFigures };
  byOrigin: { [group: string]: { [c: string]: ConductFigures } };
  /** The profile's origin groups: the shares people are drawn from live in the generator; here only what a person needs to act on (homophily). */
  homophily_bps: number;
}
export function cultureDial(world: { dials?: { [name: string]: unknown } } | undefined): CultureDial | undefined {
  const d = world?.dials?.culture as any;
  if (!d || typeof d !== "object") return undefined;
  const conducts = Array.isArray(d.conducts) ? d.conducts : [...CONDUCTS];
  for (const c of conducts) if (!(CONDUCTS as readonly string[]).includes(c)) throw new Error(`dials.culture.conducts: ${c} is not a conduct the build knows`);
  if (conducts.length > MAX_CONDUCTS) throw new Error(`dials.culture.conducts: at most ${MAX_CONDUCTS}`);
  const params = cultureParams({ ...(d.step ?? {}), ...(Number.isInteger(d.sway_milli) ? { sway_milli: d.sway_milli } : {}) });
  return { conducts, params, figures: d.profile?.conducts ?? {}, byOrigin: d.profile?.by_origin ?? {}, homophily_bps: Number.isInteger(d.profile?.homophily_bps) ? d.profile.homophily_bps : 0 };
}

/** How a person's own situation reaches the arithmetic (closures over the citizen's mind, so this file knows no more of it). */
export interface CultureEnv {
  /** A value's standing against the town's, in standard deviations (-3..3). */
  z(v: Value): number;
  /** Conformity, belonging's weight and integrity, each 0..1. */
  conformity(): number;
  belonging(): number;
  integrity(): number;
  /** A starting lean for a conduct: a standard normal draw on the person's own stream. */
  draw(conduct: Conduct): number;
}

/** The ways a person may learn what others do; nothing else moves a picture (docs/no-god-view.md). */
export type Route = "tie" | "close_tie" | "here" | "published";
export const ROUTES: readonly Route[] = ["tie", "close_tie", "here", "published"];

const clamp = (x: number, lo = 0, hi = 10_000) => Math.max(lo, Math.min(hi, Math.round(x)));
const sd = (z: number) => Math.max(-3, Math.min(3, z));
const half = (days: number, h: number) => Math.pow(0.5, days / h);

/** A person's own act at an occasion, kept for `news_days` to be told: to whom already told, so it is counted once by each. */
interface Act { conduct: Conduct; did: boolean; t: number; told: Set<string> }

/** One person's norms: what they take those around them to do and approve of, what they think, what they say. */
export class Culture {
  readonly held: Conduct[];
  private readonly does = new Map<Conduct, number>();
  private readonly approves = new Map<Conduct, number>();
  private readonly ownBase = new Map<Conduct, number>();
  private readonly ownAt = new Map<Conduct, number>();
  private readonly zStart = new Map<Conduct, number>();
  private readonly n = new Map<Conduct, number>();
  /** What the profile says is done and approved (not the person's group's): the point the lean is measured from. */
  private readonly does0 = new Map<Conduct, number>();
  private readonly approves0 = new Map<Conduct, number>();
  private readonly acts = new Map<Conduct, Act>();

  /**
   * @param rates the conducts this person has a rate for in their world, and the rate (what is done there as calibrated)
   * @param group the origin group the person comes from, if the world has any
   */
  constructor(readonly p: CultureParams, readonly dial: CultureDial, private readonly env: CultureEnv, rates: { [c in Conduct]?: number }, readonly group?: string, t = 0) {
    const held: Conduct[] = [];
    for (const c of CONDUCTS) {
      if (!dial.conducts.includes(c)) continue;
      const fig = dial.figures[c], grp = group ? dial.byOrigin[group]?.[c] : undefined;
      // A conduct is held where the world gives it a rate or the profile gives a figure for it.
      if (rates[c] === undefined && fig?.does_bps === undefined && fig?.approves_bps === undefined && grp?.does_bps === undefined) continue;
      held.push(c);
      const does0 = fig?.does_bps ?? rates[c] ?? p.does_default_bps;
      const approves0 = fig?.approves_bps ?? p.approves_default_bps;
      this.does0.set(c, clamp(does0));
      this.approves0.set(c, clamp(approves0));
      this.does.set(c, clamp(grp?.does_bps ?? does0));
      this.approves.set(c, clamp(grp?.approves_bps ?? approves0));
      const z = this.zOf(c);
      this.zStart.set(c, z);
      this.ownBase.set(c, clamp(this.approves.get(c)! + p.own_sd_bps * env.draw(c) + p.values_bps * z));
      this.ownAt.set(c, t);
      this.n.set(c, p.prior_weight);
    }
    this.held = held;
  }

  /** The values that speak to a conduct, summed (signed, in standard deviations). */
  private zOf(c: Conduct): number { return VALUE_MAP[c].reduce((a, [v, s]) => a + s * this.env.z(v), 0); }
  has(c: Conduct): boolean { return this.does.has(c); }

  /** What I think myself: my starting lean and the values as they have moved since, settling toward what I take to be approved. */
  private own(c: Conduct, t: number): number {
    // (Settling is worked out when read, from the days gone: nothing runs daily.)
    const base = this.ownBase.get(c)!, at = this.ownAt.get(c)!, keep = half(Math.max(0, t - at) / 86_400, this.p.internalise_days);
    const settled = this.approves.get(c)! + (base - this.approves.get(c)!) * keep;
    return clamp(settled + this.p.values_bps * (this.zOf(c) - this.zStart.get(c)!));
  }
  /** What I say when asked: what I think, moved toward what I take to be approved by how much belonging weighs with me and what integrity leaves (the arithmetic of `Inner.view`). */
  private says(c: Conduct, t: number): number {
    const own = this.own(c, t), gap = Math.max(0, Math.min(1, this.env.belonging() * (1 - this.env.integrity()) * 4));
    return clamp(own + gap * (this.approves.get(c)! - own));
  }

  /** The four numbers and the weight held for a conduct (basis points), as of `t`. */
  read(c: Conduct, t: number): { does: number; approves: number; own: number; says: number; n: number } | undefined {
    if (!this.has(c)) return undefined;
    return { does: this.does.get(c)!, approves: this.approves.get(c)!, own: this.own(c, t), says: this.says(c, t), n: this.n.get(c)! };
  }

  /**
   * The lean at a conduct's decision, in standard deviations (-3..3): the conformist follows what is done and approved
   * about them, the one who is not follows themself (design 14d). With every figure at the profile's, it is the person's
   * own lean alone, which sums to nothing over a town.
   */
  lean(c: Conduct, t: number): number {
    if (!this.has(c)) return 0;
    const k = this.env.conformity(), P = this.p;
    const street = (P.w_does_bps * (this.does.get(c)! - this.does0.get(c)!) + P.w_approves_bps * (this.approves.get(c)! - this.approves0.get(c)!)) / 10_000;
    return sd((k * street + (1 - k) * (this.own(c, t) - this.approves0.get(c)!)) / P.sd_bps);
  }
  /** A rate (basis points) as this person's lean sways it: `swayed`, with this dial's sway. */
  term(bps: number, c: Conduct, t: number, sign: 1 | -1 = 1): number {
    return clamp(bps * (1 + (this.p.sway_milli / 1_000) * sign * this.lean(c, t)));
  }
  /** The numbers and the lean as whole integers, for the record of a decision (an outcome's facts). */
  facts(c: Conduct, t: number): { [k: string]: number } {
    const r = this.read(c, t);
    return r ? { norm_does: Math.round(r.does / 100), norm_approves: Math.round(r.approves / 100), norm_own: Math.round(r.own / 100), norm_says: Math.round(r.says / 100), norm_lean: Math.round(this.lean(c, t) * 100) } : {};
  }

  // ---------------------------------------------------------------- learning what others do

  /** How much a sighting weighs by the way it came. */
  weight(route: Route): number {
    if (!ROUTES.includes(route)) throw new Error(`culture: a picture of what others do is moved only along a tie, by being there, or by what is published; not by "${route}" (docs/no-god-view.md)`);
    return route === "published" ? this.p.published_weight : route === "close_tie" ? this.p.close_weight : this.p.known_weight;
  }
  /** Saw one person do it, or not (a tie told me, or I was there). Each sighting moves `does` toward it by its weight over the weight held. */
  seeAct(c: Conduct, did: boolean, route: Route): void { this.moveDoes(c, did ? 10_000 : 0, this.weight(route)); }
  /** A published count: the share who did it, of those who met the occasion. */
  seeShare(c: Conduct, shareBps: number, route: Route = "published"): void { this.moveDoes(c, clamp(shareBps), this.weight(route)); }
  private moveDoes(c: Conduct, x: number, w: number): void {
    if (!this.has(c)) return;
    const held = Math.min(this.p.window, this.n.get(c)! + w);
    this.does.set(c, clamp(this.does.get(c)! + ((x - this.does.get(c)!) * w) / held));
    this.n.set(c, held);
    this.dirty = true;
  }
  /** Heard what someone says of it: the same rule on `approves`, from what others say, not what they are thought to think. */
  hearSaid(c: Conduct, bps: number, route: Route): void {
    if (!this.has(c)) return;
    const w = this.weight(route);
    this.approves.set(c, clamp(this.approves.get(c)! + ((clamp(bps) - this.approves.get(c)!) * w) / (this.n.get(c)! + w)));
    this.dirty = true;
  }

  // ---------------------------------------------------------------- telling

  /** My own act at an occasion: kept to be told. */
  act(c: Conduct, did: boolean, t: number): void { if (this.has(c)) this.acts.set(c, { conduct: c, did, t, told: new Set() }); }
  /** What I say when asked how things are, to `asker`: my recent acts (not those I would rather keep back, and none twice to the same person), and what I say of them. */
  tell(asker: string, t: number, newsDays: number): string[] {
    const out: string[] = [];
    const recent = [...this.acts.values()].filter((a) => t - a.t <= newsDays * 86_400).sort((a, b) => b.t - a.t || (a.conduct < b.conduct ? -1 : 1));
    for (const a of recent) {
      if (out.length >= this.p.phrases) break;
      if (a.told.has(asker)) continue;
      a.told.add(asker);
      const position = a.did ? 10_000 : 0;
      // (I mention what I did only if it sits within reach of what I take to be approved, or my integrity is high; what was seen cannot be kept back.)
      const tells = Math.abs(position - this.approves.get(a.conduct)!) <= this.p.conceal_bps || this.env.integrity() * 10_000 >= this.p.integrity_tells_bps;
      if (tells) out.push(CULTURE_WORDS.did(a.conduct, a.did));
      if (out.length < this.p.phrases) out.push(CULTURE_WORDS.says(a.conduct, this.says(a.conduct, t)));
    }
    for (const [c, a] of this.acts) if (t - a.t > newsDays * 86_400) this.acts.delete(c);
    return out.filter(Boolean);
  }

  // ---------------------------------------------------------------- the record

  /** The record's section: a conduct a row, its five numbers in order [does, approves, own, says, n], the first four in whole percent
   * (bounded: 12 rows, whatever the town or the time; the compact form keeps the log, which carries every rewrite, small). */
  section(t: number): { conduct: string; numbers: [number, number, number, number, number] }[] {
    // (Worked out again only when a picture has moved or `REFRESH_DAYS` have passed: `own` and `says` drift slowly with the days and the values,
    // and the record is written again only for a move of 2 in 100, so a month's staleness changes nothing written. Nothing runs daily.)
    if (this.cached && !this.dirty && t - this.cachedAt < REFRESH_DAYS * 86_400 && t >= this.cachedAt) return this.cached;
    this.dirty = false;
    this.cachedAt = t;
    return (this.cached = this.held.map((c) => {
      const r = this.read(c, t)!;
      return { conduct: c, numbers: [Math.round(r.does / 100), Math.round(r.approves / 100), Math.round(r.own / 100), Math.round(r.says / 100), Math.round(r.n)] as [number, number, number, number, number] };
    }));
  }
  private cached: { conduct: string; numbers: [number, number, number, number, number] }[] | undefined;
  private cachedAt = 0;
  private dirty = true;
}

/** How long the record's section may go without being worked out again when nothing moved a picture. */
export const REFRESH_DAYS = 30;

/** A standard normal from a stream (the sum of 12 uniforms less 6: the Irwin-Hall approximation the mind uses). */
export function standardNormal(rng: { below(n: number): number }): number {
  let s = 0;
  for (let i = 0; i < 12; i++) s += rng.below(1_000_001) / 1_000_000;
  return s - 6;
}

export const CULTURE_VALUES = VALUES;
