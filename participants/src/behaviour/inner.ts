// The richer record of who a person is and how things stand with them (docs/design/ai-citizens.md 10c, 10d): trust in
// particular institutions, a sense of agency, attachments, a private and an expressed view of whoever holds power over
// them, dents to belonging and meaning, values that drift and are shocked, a bounded memory, and where the hours go.
// Arithmetic only: no model, no clock, no draw but from the stream it is handed (the kernel's keyed streams). The
// kernel holds the record and is its only writer (the `entity_record` command); this file computes what is written.
//
// Every size here is a parameter (`inner`, docs/behaviour/citizen.md "The record"). Unless that table names a source,
// a size is a PLACEHOLDER, as `sway` is: chosen small, to be replaced by a sourced figure.
//
// Basis points (0..10000) throughout, so the record is whole numbers.

import type { Rng } from "../rng";
import { VALUES, type Value } from "./mind";

/** Kinds of institution a place's survey gives confidence in (the profile's `outlook.trust`). A particular institution
 * (this bank, this council) starts from its kind's figure. */
export type TrustKind = string;

/** A place's figures for how people start out (its profile's `outlook`): the share with confidence in each kind of
 * institution, the share who say most people can be trusted, and how much control over their lives people feel. */
export interface Outlook {
  trust?: { [kind: string]: number };
  people_bps?: number;
  agency?: { mean_bps: number; sd_bps: number };
}

export interface InnerParams {
  trust: {
    /** Where trust in a kind of institution starts when the world gives no figure for it. PLACEHOLDER. */
    start_bps: number;
    /** How far people differ from their place's figure (one personal lean, a standard deviation). PLACEHOLDER. */
    spread_bps: number;
    /** How far a standard deviation of the conservation values (conformity, tradition, security) over the openness
     * values (self-direction, stimulation) raises trust in institutions (Devos, Spini and Schwartz 2002; size a PLACEHOLDER). */
    values_bps: number;
    /** A good experience moves trust this share of the way to complete. PLACEHOLDER. */
    good_bps: number;
    /** A bad one this share of the way to none: more than a good one builds (Slovic 1993's asymmetry; the ratio a PLACEHOLDER). */
    bad_bps: number;
    /** What someone else's experience, told to us, counts against our own (as EWA weighs forgone payoffs: delta). */
    heard_bps: number;
    /** Trust drifts back to where the person started, halving its distance in this long. PLACEHOLDER. */
    return_half_life_days: number;
    /** How many particular institutions a record keeps (the least used gives way). */
    kept: number;
  };
  agency: {
    /** Where no figure is given by the world: the mean and spread of how much control people feel. PLACEHOLDERS. */
    mean_bps: number;
    sd_bps: number;
    /** Something tried that worked moves it this share of the way up; one that failed, this share of the way down. PLACEHOLDERS. */
    worked_bps: number;
    failed_bps: number;
    /** Something done to the person that they had no say in (a notice, a redundancy, a rent rise). Losing work lowers
     * perceived control by about 0.3 of a standard deviation (Preuss and Hennecke 2018); with the placeholder spread
     * that is this many points off. */
    done_to_bps: number;
    /** It returns to the person's own level, halving its distance in this long (control perception recovers on
     * re-employment: Preuss and Hennecke 2018; the time a PLACEHOLDER). */
    return_half_life_days: number;
  };
  needs: {
    /** A dent to belonging or meaning heals, halving in this long. PLACEHOLDER. */
    dent_half_life_days: number;
    /** The dents, by what happened (share of the need, at full closeness). PLACEHOLDERS. */
    dents: { [what: string]: { belonging?: number; meaning?: number } };
  };
  values: {
    /** How alike a person's values are to their own after `stability_days` (a rank-order correlation, basis points):
     * 0.48 to 0.69 over 3.5 years in two German panels (docs/research/references.md); 0.6 taken. It includes
     * measurement error, so true values move less: an upper bound on drift. */
    stability_bps: number;
    stability_days: number;
    /** A shock's size, at full closeness (basis points of a value, on a scale whose spread is about 1,500). PLACEHOLDER. */
    shock_bps: number;
    /** Which values a shock moves, and which way (+1 or -1): directions from the literature (docs/behaviour/citizen.md). */
    shocks: { [what: string]: { [v in Value]?: number } };
  };
  views: {
    /** How much a person keeps to what they think whatever it costs, at the mean of their values (the rest is given
     * up to pressure). PLACEHOLDER. */
    integrity_bps: number;
    /** How far a standard deviation of self-direction and universalism over conformity and security raises it. PLACEHOLDER. */
    integrity_values_bps: number;
    /** How many power-holders a record keeps views of. */
    kept: number;
  };
  attach: {
    /** Attachment grows toward complete, halving its distance in this long: to the town lived in, the trade worked
     * at, the group taken part in. Length of residence is the main predictor of attachment to a place (Lewicka 2011,
     * to confirm); the times are PLACEHOLDERS. */
    place_half_life_days: number;
    trade_half_life_days: number;
    group_half_life_days: number;
    /** And fades, once the tie is cut, halving in this long. PLACEHOLDER. */
    fade_half_life_days: number;
  };
  memory: { recent: number; defining: number; /** An event at least this large is kept for good (the largest few). */ defining_bps: number };
}

export const INNER_DEFAULTS: InnerParams = {
  trust: { start_bps: 5_000, spread_bps: 1_500, values_bps: 500, good_bps: 300, bad_bps: 600, heard_bps: 5_000, return_half_life_days: 730, kept: 12 },
  agency: { mean_bps: 5_000, sd_bps: 2_000, worked_bps: 300, failed_bps: 300, done_to_bps: 600, return_half_life_days: 365 },
  needs: {
    dent_half_life_days: 180,
    dents: {
      bereaved: { belonging: 4_000, meaning: 5_000 },
      job_lost: { belonging: 1_000, meaning: 3_000 },
      evicted: { belonging: 3_000, meaning: 1_000 },
      ruined: { meaning: 2_000 },
      turned_away: { belonging: 1_000 },
    },
  },
  values: {
    stability_bps: 6_000,
    stability_days: 1_278,
    shock_bps: 400,
    shocks: {
      // A death: threat raises security and tradition and lowers stimulation (Sortheix et al. 2019; Verkasalo et al.
      // 2006); the widowed grow more religious (Brown et al. 2004). No study of values after bereavement was found.
      bereaved: { security: 1, tradition: 1, benevolence: 1, stimulation: -1, hedonism: -1 },
      // A child: mothers' conservation values rise, fathers' do not (Lönnqvist, Leikas and Verkasalo 2018): the bearer's.
      child: { security: 1, conformity: 1, tradition: 1, stimulation: -1, hedonism: -1 },
      // Ruin: after the financial crisis security, tradition, conformity and benevolence rose and hedonism,
      // self-direction and stimulation fell among the young (Sortheix et al. 2019).
      ruined: { security: 1, tradition: 1, conformity: 1, benevolence: 1, hedonism: -1, self_direction: -1, stimulation: -1 },
      // Losing a home against one's will: by analogy with threat. PLACEHOLDER directions.
      evicted: { security: 1, self_direction: -1 },
    },
  },
  views: { integrity_bps: 5_000, integrity_values_bps: 1_500, kept: 4 },
  attach: { place_half_life_days: 1_825, trade_half_life_days: 1_095, group_half_life_days: 365, fade_half_life_days: 365 },
  memory: { recent: 8, defining: 4, defining_bps: 5_000 },
};

/** How far the adults who raise a child count in the child's values (docs/behaviour/citizen.md, "Upbringing"), of
 * 10,000. PLACEHOLDER: parents' and children's values are alike, but no figure for how alike was confirmed (a typical
 * correlation of 0.2 to 0.3 is recalled, to confirm: docs/research/references.md). */
export const UPBRINGING = { share_bps: 5_000 };

/** Parameters as a world gives them, over the defaults (a world may set some and keep the rest). */
export function innerParams(given: any): InnerParams {
  const d = INNER_DEFAULTS;
  const g = given ?? {};
  return {
    trust: { ...d.trust, ...(g.trust ?? {}) },
    agency: { ...d.agency, ...(g.agency ?? {}) },
    needs: { ...d.needs, ...(g.needs ?? {}), dents: { ...d.needs.dents, ...(g.needs?.dents ?? {}) } },
    values: { ...d.values, ...(g.values ?? {}), shocks: { ...d.values.shocks, ...(g.values?.shocks ?? {}) } },
    views: { ...d.views, ...(g.views ?? {}) },
    attach: { ...d.attach, ...(g.attach ?? {}) },
    memory: { ...d.memory, ...(g.memory ?? {}) },
  };
}

const DAY = 86_400;
const clamp = (x: number, lo = 0, hi = 10_000) => Math.max(lo, Math.min(hi, Math.round(x)));
/** A share of the way up to complete, or down to none. */
const up = (x: number, bps: number) => x + ((10_000 - x) * Math.min(10_000, Math.max(0, bps))) / 10_000;
const down = (x: number, bps: number) => x - (x * Math.min(10_000, Math.max(0, bps))) / 10_000;
/** What is left of a distance after `dt` seconds at this half-life. */
const left = (dt: number, halfLifeDays: number) => (dt <= 0 ? 1 : Math.pow(0.5, dt / (halfLifeDays * DAY)));
/** A roughly normal draw (the sum of 12 uniforms), in standard deviations. */
function z(rng: Rng): number {
  let s = 0;
  for (let i = 0; i < 12; i++) s += rng.below(1_000_001) / 1_000_000;
  return s - 6;
}

/** Something that happened, as the record remembers it: when, what (a word of the mind's own), about whom, how large. */
export interface Remembered { t: number; what: string; about?: string; size: number; /** For what became of a want: the way taken. */ by?: string }

export interface Attachment { to: string; bps: number; since: number }

/** A view of someone who holds power over the person: what they think (-10,000 against .. 10,000 for), and what they say. */
export interface View { of: string; private: number; expressed: number }

/**
 * A child's values from those who raise them (docs/behaviour/citizen.md, "Upbringing"): the mean of the adults'
 * values, pulled toward the town's by what is not passed on, and their own part. The spread of values among
 * children is the town's (the own part is sized to make it so), so a town's rates do not move with who was whose
 * child. `share_bps`: how far the adults' mean counts.
 */
export function raisedValues(rng: Rng, pop: { [v in Value]?: { mean_bps: number; sd_bps: number } }, adults: { [v in Value]: number }[], share_bps: number): { [v in Value]: number } {
  const a = Math.max(0, Math.min(10_000, share_bps)) / 10_000;
  const n = Math.max(1, adults.length);
  return Object.fromEntries(VALUES.map((v) => {
    const d = pop[v] ?? { mean_bps: 5_000, sd_bps: 1_500 };
    const own = z(rng) * d.sd_bps;
    if (!adults.length) return [v, clamp(d.mean_bps + own)];
    const mean = adults.reduce((s, x) => s + x[v], 0) / n;
    // (The mean of n unrelated adults varies by sd squared over n: the own part makes up the rest of the town's spread.)
    return [v, clamp(d.mean_bps + a * (mean - d.mean_bps) + Math.sqrt(Math.max(0, 1 - (a * a) / n)) * own)];
  })) as { [v in Value]: number };
}

/**
 * The part of a person's inner life that the mind of sections 3 to 5 did not have. One per citizen; the citizen
 * module tells it what happened, and reads from it what a record holds.
 */
export class Inner {
  /** The person's own lean toward trusting institutions, and their own level of agency: where each returns to. */
  readonly lean: number;
  readonly agencyBase: number;
  agency: number;
  private readonly trust = new Map<string, { kind: TrustKind; bps: number; base: number; used: number }>();
  private readonly dents: { belonging: { bps: number; t: number }; meaning: { bps: number; t: number } } = { belonging: { bps: 0, t: 0 }, meaning: { bps: 0, t: 0 } };
  readonly attached: { place?: Attachment; trade?: Attachment; group?: Attachment } = {};
  private readonly views = new Map<string, View>();
  private recent: Remembered[] = [];
  private defining: Remembered[] = [];
  /** What has happened since the record was last written (for the change's `because`). */
  private since: Remembered[] = [];
  private settledAt = 0;
  private driftedAt: number | null = null;
  /** Where the hours went since they were last read: seconds by what the person was at. */
  private hours: { [category: string]: number } = {};
  private hoursFrom = 0;

  /**
   * `values`: the person's (the mind's own object: drift and shocks change it in place). `zOf`: how far a value sits
   * from the town's mean, in standard deviations. `rng`: the person's stream for who they are.
   */
  constructor(rng: Rng, private readonly values: { [v in Value]: number }, private readonly pop: { [v in Value]?: { mean_bps: number; sd_bps: number } }, private readonly outlook: Outlook, readonly p: InnerParams) {
    this.lean = z(rng);
    const a = outlook.agency ?? { mean_bps: p.agency.mean_bps, sd_bps: p.agency.sd_bps };
    // (Those who value self-direction feel more in control: a tenth of the spread per standard deviation. PLACEHOLDER.)
    this.agencyBase = clamp(a.mean_bps + a.sd_bps * (z(rng) + 0.1 * this.zOf("self_direction")));
    this.agency = this.agencyBase;
  }

  zOf(v: Value): number {
    const d = this.pop[v] ?? { mean_bps: 5_000, sd_bps: 1_500 };
    return Math.max(-3, Math.min(3, (this.values[v] - d.mean_bps) / Math.max(1, d.sd_bps)));
  }

  // ---------------------------------------------------------------- trust in particular institutions

  private entry(who: string, kind: TrustKind, t: number) {
    let e = this.trust.get(who);
    if (!e) {
      const start = this.outlook.trust?.[kind] ?? this.p.trust.start_bps;
      const conserving = (this.zOf("conformity") + this.zOf("tradition") + this.zOf("security")) / 3 - (this.zOf("self_direction") + this.zOf("stimulation")) / 2;
      const base = clamp(start + this.p.trust.spread_bps * this.lean + this.p.trust.values_bps * conserving);
      e = { kind, bps: base, base, used: t };
      this.trust.set(who, e);
      // (Bounded: the one longest unused gives way.)
      if (this.trust.size > this.p.trust.kept) {
        const oldest = [...this.trust.entries()].filter(([k]) => k !== who).sort((a, b) => a[1].used - b[1].used || (a[0] < b[0] ? -1 : 1))[0]!;
        this.trust.delete(oldest[0]);
      }
    }
    e.used = Math.max(e.used, t);
    return e;
  }

  /** How far we trust this institution now (it is known to us from here on). */
  trustIn(who: string, kind: TrustKind, t: number): number {
    return Math.round(this.entry(who, kind, t).bps);
  }
  /** As it stands, if it is one we keep. */
  trusted(who: string): number | undefined {
    const e = this.trust.get(who);
    return e ? Math.round(e.bps) : undefined;
  }

  /** Something it did, to us (`weight` 1) or to someone who told us (`heard`): well or badly. */
  experience(who: string, kind: TrustKind, good: boolean, t: number, o: { weight?: number; heard?: boolean } = {}): { before: number; after: number } {
    const e = this.entry(who, kind, t);
    const before = Math.round(e.bps);
    const w = (o.weight ?? 1) * (o.heard ? this.p.trust.heard_bps / 10_000 : 1);
    e.bps = good ? up(e.bps, this.p.trust.good_bps * w) : down(e.bps, this.p.trust.bad_bps * w);
    return { before, after: Math.round(e.bps) };
  }

  // ---------------------------------------------------------------- agency

  /** Something we set out to do came off, or did not. */
  tried(worked: boolean, weight = 1): void {
    this.agency = worked ? up(this.agency, this.p.agency.worked_bps * weight) : down(this.agency, this.p.agency.failed_bps * weight);
  }
  /** Something was done to us that we had no say in. */
  doneTo(weight = 1): void {
    this.agency = Math.max(0, this.agency - this.p.agency.done_to_bps * weight);
  }

  // ---------------------------------------------------------------- belonging and meaning

  /** What is still felt of the dents to a need. */
  dent(need: "belonging" | "meaning", t: number): number {
    const d = this.dents[need];
    return Math.round(d.bps * left(t - d.t, this.p.needs.dent_half_life_days));
  }
  private dentBy(need: "belonging" | "meaning", bps: number, t: number): void {
    this.dents[need] = { bps: Math.min(10_000, this.dent(need, t) + bps), t };
  }

  // ---------------------------------------------------------------- attachments

  /** A week (or however long) more with what we are attached to, or with something else in its place, or without. */
  attach(which: "place" | "trade" | "group", to: string | undefined, t: number): void {
    const A = this.p.attach;
    const half = which === "place" ? A.place_half_life_days : which === "trade" ? A.trade_half_life_days : A.group_half_life_days;
    const a = this.attached[which];
    const dt = t - this.settledAt;
    if (a && (to === undefined || to !== a.to)) {
      // Cut: it fades; and a new one begins when the old has faded below what the new would start at (nothing).
      a.bps = a.bps * left(dt, A.fade_half_life_days);
      if (to !== undefined && a.bps < 500) this.attached[which] = { to, bps: 0, since: t };
      else if (to === undefined && a.bps < 50) delete this.attached[which];
    } else if (a) a.bps = 10_000 - (10_000 - a.bps) * left(dt, half);
    else if (to !== undefined) this.attached[which] = { to, bps: 0, since: t };
  }
  /** How strongly, now (0 if to nothing, or to something else). */
  attachedTo(which: "place" | "trade" | "group", to?: string): number {
    const a = this.attached[which];
    return a && (to === undefined || a.to === to) ? Math.round(a.bps) : 0;
  }
  /** A place lived in for this long before the world began (the generator's, or a newcomer's none). */
  startAttached(which: "place" | "trade" | "group", to: string, days: number, t: number): void {
    const A = this.p.attach;
    const half = which === "place" ? A.place_half_life_days : which === "trade" ? A.trade_half_life_days : A.group_half_life_days;
    this.attached[which] = { to, bps: 10_000 * (1 - left(days * DAY, half)), since: t - days * DAY };
  }

  // ---------------------------------------------------------------- what is thought and what is said

  /**
   * Our view of someone who holds power over us (Kuran 1995): what we think of them, and what we say. What is said
   * leans from what is thought toward what those around us say (`norm`; none heard: toward saying nothing, 0), by the
   * pressure we are under less our own integrity. Pressure is how much they could cost us (`dependence`, 0..10000:
   * they house us, employ us, govern us) times how afraid we are (`fear`, 0..10000) times how little we trust them
   * not to hold it against us.
   */
  view(of: string, think: number, o: { dependence: number; fear: number; trust: number; norm?: number }): View {
    const pressure = (o.dependence / 10_000) * (o.fear / 10_000) * (1 - o.trust / 10_000);
    const integrity = Math.max(0, Math.min(1, (this.p.views.integrity_bps + this.p.views.integrity_values_bps * ((this.zOf("self_direction") + this.zOf("universalism")) / 2 - (this.zOf("conformity") + this.zOf("security")) / 2)) / 10_000));
    const gap = Math.max(0, Math.min(1, pressure * (1 - integrity) * 4)); // (at full pressure and no integrity, wholly the norm; the 4 a PLACEHOLDER scale)
    const priv = clamp(think, -10_000, 10_000);
    const v: View = { of, private: priv, expressed: clamp(priv + gap * ((o.norm ?? 0) - priv), -10_000, 10_000) };
    this.views.delete(of);
    this.views.set(of, v);
    while (this.views.size > this.p.views.kept) this.views.delete(this.views.keys().next().value!);
    return v;
  }
  viewOf(of: string): View | undefined {
    return this.views.get(of);
  }
  forget(of: string): void {
    this.views.delete(of);
  }

  // ---------------------------------------------------------------- values: drift and shocks

  /**
   * Slow drift (docs/behaviour/citizen.md, "Values move"): each month every value takes a small random step and is
   * pulled a little toward the town's mean, sized so that a person's values after `stability_days` correlate with
   * their own before at `stability_bps`, and so that the spread of values across the town stays what it was.
   * Returns whether anything moved. The stream is the person's, for that month (the kernel's keyed streams).
   */
  drift(rng: (purpose: string) => Rng, t: number): boolean {
    const MONTH = 30 * DAY;
    if (this.driftedAt === null) {
      this.driftedAt = t;
      return false;
    }
    let moved = false;
    while (t - this.driftedAt >= MONTH) {
      this.driftedAt += MONTH;
      const r = rng(`values-drift-${this.driftedAt}`);
      // An Ornstein-Uhlenbeck step: keep = stability ^ (a month / stability_days); the step's spread makes up the rest.
      const keep = Math.pow(this.p.values.stability_bps / 10_000, MONTH / (this.p.values.stability_days * DAY));
      for (const v of VALUES) {
        const d = this.pop[v] ?? { mean_bps: 5_000, sd_bps: 1_500 };
        this.values[v] = clamp(d.mean_bps + keep * (this.values[v] - d.mean_bps) + Math.sqrt(1 - keep * keep) * d.sd_bps * z(r));
      }
      moved = true;
    }
    return moved;
  }

  /** A shock: the values it moves, each by the shock's size at this closeness (0..1), the way the literature says. */
  shock(what: string, closeness = 1): void {
    const dirs = this.p.values.shocks[what];
    if (!dirs) return;
    for (const v of VALUES) if (dirs[v]) this.values[v] = clamp(this.values[v] + dirs[v]! * this.p.values.shock_bps * Math.max(0, Math.min(1, closeness)));
  }

  // ---------------------------------------------------------------- what happens

  /**
   * Something happened to us or to someone we are tied to (`closeness` 0..1: 1 our own or our household's): it is
   * remembered, dents what it dents, and shocks what it shocks. `what` is a word the parameters know (bereaved,
   * job_lost, evicted, ruined, child, turned_away) or any other, which is only remembered.
   */
  happened(what: string, t: number, o: { about?: string; closeness?: number; size?: number } = {}): void {
    const c = Math.max(0, Math.min(1, o.closeness ?? 1));
    const dents = this.p.needs.dents[what];
    if (dents?.belonging) this.dentBy("belonging", dents.belonging * c, t);
    if (dents?.meaning) this.dentBy("meaning", dents.meaning * c, t);
    this.shock(what, c);
    const size = Math.round(o.size ?? Math.max(dents?.belonging ?? 0, dents?.meaning ?? 0, this.p.values.shocks[what] ? this.p.memory.defining_bps : 1_000) * c);
    this.remember({ t, what, ...(o.about !== undefined ? { about: o.about } : {}), size });
  }

  /** Something for a change's `because` only (what became of a want): said once with the record's next change, and
   * not among the things remembered. */
  note(r: Remembered): void {
    this.since.push(r);
    if (this.since.length > 16) this.since.shift();
  }

  /** How far the sense of agency sits from the town's mean, in standard deviations (docs/behaviour/citizen.md, "Readers"). */
  zAgency(): number {
    const a = this.outlook.agency ?? { mean_bps: this.p.agency.mean_bps, sd_bps: this.p.agency.sd_bps };
    return Math.max(-3, Math.min(3, (this.agency - a.mean_bps) / Math.max(1, a.sd_bps)));
  }
  /** How far trust in this institution sits from the town's figure for its kind, in standard deviations of the
   * personal lean. */
  zTrust(who: string, kind: TrustKind, t: number): number {
    const start = this.outlook.trust?.[kind] ?? this.p.trust.start_bps;
    return Math.max(-3, Math.min(3, (this.entry(who, kind, t).bps - start) / Math.max(1, this.p.trust.spread_bps)));
  }

  /** Kept: among the last few, and, if large, among the few that defined us (the largest, kept for good). */
  remember(r: Remembered): void {
    this.since.push(r);
    if (this.since.length > 16) this.since.shift();
    this.recent.push(r);
    if (this.recent.length > this.p.memory.recent) this.recent.shift();
    if (r.size >= this.p.memory.defining_bps) {
      this.defining.push(r);
      if (this.defining.length > this.p.memory.defining) {
        // The smallest goes (of equals, the latest: the first to define us stays).
        let drop = 0;
        for (let i = 1; i < this.defining.length; i++) if (this.defining[i]!.size <= this.defining[drop]!.size) drop = i;
        this.defining.splice(drop, 1);
      }
    }
  }

  // ---------------------------------------------------------------- time

  /** Time passing: trust and agency drift back to the person's own. Called at each plan. */
  settle(t: number): void {
    const dt = t - this.settledAt;
    if (dt <= 0) return;
    const kt = left(dt, this.p.trust.return_half_life_days);
    for (const e of this.trust.values()) e.bps = e.base + (e.bps - e.base) * kt;
    this.agency = this.agencyBase + (this.agency - this.agencyBase) * left(dt, this.p.agency.return_half_life_days);
    this.settledAt = t;
  }

  /** Seconds spent at something (work, learning, gathering, care, home, away): where the hours go. */
  spent(category: string, seconds: number): void {
    if (seconds > 0) this.hours[category] = (this.hours[category] ?? 0) + Math.round(seconds);
  }
  /** Someone whose first hour in the world is `t` (they came to town then): their hours are counted from there. */
  hoursBegin(t: number): void {
    this.hours = {};
    this.hoursFrom = t;
  }
  /** The hours since they were last taken, and from when; they start again from `t`. */
  takeHours(t: number): { from: number; to: number; seconds: { [category: string]: number } } {
    const out = { from: this.hoursFrom, to: t, seconds: Object.fromEntries(Object.entries(this.hours).sort(([a], [b]) => (a < b ? -1 : 1))) };
    this.hours = {};
    this.hoursFrom = t;
    return out;
  }

  // ---------------------------------------------------------------- the record's sections

  /** What has happened since this was last asked: for a change's `because`. */
  takeSince(): Remembered[] {
    return this.since.splice(0);
  }

  sections(): { agency: { now: number; own: number }; trust: { in: string; kind: string; bps: number }[]; attached: { [which: string]: Attachment }; views: View[]; memory: { recent: Remembered[]; defining: Remembered[] } } {
    const whole = (a: Attachment) => ({ to: a.to, bps: Math.round(a.bps), since: Math.round(a.since) });
    return {
      agency: { now: Math.round(this.agency), own: this.agencyBase },
      trust: [...this.trust.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([who, e]) => ({ in: who, kind: e.kind, bps: Math.round(e.bps) })),
      attached: Object.fromEntries((["group", "place", "trade"] as const).flatMap((k) => (this.attached[k] ? [[k, whole(this.attached[k]!)]] : []))),
      views: [...this.views.values()].sort((a, b) => (a.of < b.of ? -1 : 1)).map((v) => ({ ...v })),
      memory: { recent: this.recent.map((r) => ({ ...r })), defining: this.defining.map((r) => ({ ...r })) },
    };
  }
}
