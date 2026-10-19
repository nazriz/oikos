// What a firm, a landlord or another organisation wants (docs/design/ai-citizens.md 10a; docs/behaviour/firm-wants.md):
// to keep trading, to grow, to keep a customer, a tenant or a worker, to be rid of one, to pay less, to be thought well
// of. The wants are the organisation's, held in its own record and acted on by whoever holds its posts; how much each
// weighs is drawn from the values of whoever owns most of it, so two shops do not behave alike because their owners do
// not. Its routines (docs/behaviour/firms.md) remain what it does when no want presses: character sways the routines'
// own levers about the town's mean, and decides how it answers when someone asks something of it.
//
// Arithmetic only: no model, no draw but from the streams it is handed. Every size is a parameter (`org`); all are
// PLACEHOLDERS (no source was found for how often a landlord holds a rent or an employer gives a rise when asked).

import { type RecordChange } from "../module";
import type { Rng } from "../rng";
import type { Value } from "./mind";
import { swayed, Wants, wantParams, type WantEvent, type WantParams } from "./wants";
import { cultureDial } from "./culture";
import { Practice, PRACTICES, type PracticeRow } from "./practice";

export const ORG_WANTS = ["keep_trading", "grow", "keep", "be_rid", "pay_less", "standing"] as const;
export type OrgWant = (typeof ORG_WANTS)[number];
/** How much each standing want weighs with an organisation, in standard deviations from the town's mean owner. */
export type Character = { [w in OrgWant]: number };

/**
 * An organisation's character from its owner's values (Schwartz's ten, as the owner's own record has them), each a
 * mean of how far the owner sits from the town on the values that speak to it. The mapping is ours, to test against
 * data: security and tradition keep a business going; achievement, stimulation and power grow it; benevolence and
 * conformity hold on to those it deals with; power without benevolence is rid of them; power and achievement without
 * universalism or benevolence pay less; conformity, benevolence and universalism care how it is thought of.
 */
export function characterOf(owner: { [v: string]: number } | null | undefined, pop: { [v in Value]?: { mean_bps: number; sd_bps: number } } = {}): Character {
  const z = (v: Value) => {
    if (!owner || !Number.isFinite(owner[v])) return 0;
    const d = pop[v] ?? { mean_bps: 5_000, sd_bps: 1_500 };
    return Math.max(-3, Math.min(3, (owner[v]! - d.mean_bps) / Math.max(1, d.sd_bps)));
  };
  return {
    keep_trading: (z("security") + z("tradition")) / 2,
    grow: (z("achievement") + z("stimulation") + z("power")) / 3,
    keep: (z("benevolence") + z("conformity")) / 2,
    be_rid: (z("power") - z("benevolence")) / 2,
    pay_less: (z("power") + z("achievement") - z("universalism") - z("benevolence")) / 4,
    standing: (z("conformity") + z("benevolence") + z("universalism")) / 3,
  };
}

export interface OrgParams {
  /** Asked to hold a rent it has given notice of raising, to give a rise, to let a tenant under notice stay: how
   * often an organisation of the town's mean character says yes. PLACEHOLDERS: a place's own figure is its profile's
   * (`outlook.asked`: docs/profiles.md), given by the world. */
  hold_bps: number;
  rise_bps: number;
  stay_bps: number;
  /** How far a standard deviation of character sways those answers (a share of the rate). PLACEHOLDER. */
  answer: number;
  /** How far it sways a markup or a margin; and by how many months, a standard deviation, its patience with someone
   * who owes it. PLACEHOLDERS. */
  markup: number;
  patience_months: number;
  /** A rise is given only if what is in the bank covers this many pay periods of the new wage bill. PLACEHOLDER. */
  rise_cover_periods: number;
  wants: Partial<WantParams>;
}
export const ORG_DEFAULTS: OrgParams = { hold_bps: 3_000, rise_bps: 3_000, stay_bps: 3_000, answer: 0.5, markup: 0.3, patience_months: 0.5, rise_cover_periods: 3, wants: {} };

/**
 * An organisation's wants and character, for the module that runs its post. `lively`: whether it takes initiative
 * (its own draw against the world's dial, or as the world says); where it does not, every lever reads as the routine
 * has it and it answers nothing, so the organisation is the one it was before wants.
 */
export class Org {
  readonly lively: boolean;
  readonly character: Character;
  readonly wants: Wants;
  readonly p: OrgParams;
  /** Its habit, where the culture dial is on and it takes initiative (docs/behaviour/culture.md, "An office's practice"); absent otherwise. */
  readonly practice?: Practice;
  private readonly recent: { t: number; what: string; about?: string; size: number }[] = [];
  private since: { t: number; what: string; about?: string; size: number; by?: string }[] = [];
  private written = "";
  private readonly counts: { [what: string]: number } = {};
  private told: WantEvent[] = [];

  constructor(ctx: { rng: (purpose: string) => Rng; world: { dials?: { [name: string]: unknown } } }, given: { practice?: PracticeRow[]; initiative?: boolean | null; owner_values?: { [v: string]: number } | null; values?: { [v in Value]?: { mean_bps: number; sd_bps: number } }; org?: Partial<OrgParams> }) {
    const dial = Number(ctx.world.dials?.initiative_bps ?? 0);
    this.lively = given.initiative ?? (dial > 0 && ctx.rng("initiative").below(10_000) < dial);
    this.character = this.lively ? characterOf(given.owner_values, given.values) : characterOf(null);
    this.p = { ...ORG_DEFAULTS, ...(given.org ?? {}) };
    this.wants = new Wants(wantParams(this.p.wants));
    const cul = cultureDial(ctx.world);
    if (this.lively && cul) {
      this.practice = new Practice(cul.params, given.practice);
      // (An office is never new on day 1: it opens with the habit its character gives, so at the opening nothing moves.)
      for (const k of PRACTICES) this.practice.open(k, this.chanceOf(k, 0), 0);
    }
  }

  private chanceOf(what: "hold" | "rise" | "stay", worth: number): number {
    const c = this.character;
    const lean = (c.keep + c.standing) / 2 - (what === "rise" ? c.pay_less : what === "stay" ? c.be_rid : c.grow) + worth;
    return swayed(what === "hold" ? this.p.hold_bps : what === "rise" ? this.p.rise_bps : this.p.stay_bps, lean, this.p.answer);
  }

  /**
   * Asked something by someone it deals with: yes or no, by its character and the draw it is handed. `worth`: how
   * much the one asking is worth keeping, in standard deviations (a tenant who always paid, a hand long with us).
   * Holding a rent or letting a tenant stay sets keeping them and being thought well of against growing; a rise
   * sets them against paying less.
   */
  grants(what: "hold" | "rise" | "stay", rng: Rng, worth = 0, t = 0): { granted: boolean; chance: number } {
    let chance = this.chanceOf(what, worth);
    // (Its habit, where the culture dial is on: the rate is drawn part of the way from what its character gives toward what the office has in fact done. No draw is added.)
    if (this.practice) chance = this.practice.pulled(what, chance, this.chanceOf(what, 0));
    const granted = this.lively && rng.below(10_000) < chance;
    this.practice?.observe(what, t, granted);
    this.count(granted ? "granted" : "refused");
    return { granted, chance };
  }

  /** A markup or margin of its routine, as its character sways it: more for one that would grow, less for one that
   * would keep those it deals with. Symmetric about the town's mean, so the town's rents and prices stay put. */
  markup(bps: number): number {
    return this.lively ? swayed(bps, this.character.grow - this.character.keep, this.p.markup) : bps;
  }

  /** How many months it bears with someone who owes it before acting: longer for one that would keep them. Never
   * shorter than its routine's: under that, its own books cannot tell a payment a few days late from one not made,
   * so one that would be rid of a tenant acts when the routine does. (So this lever only lengthens: it is not
   * symmetric, and a town with wants gives a little less notice for arrears than one without.) */
  patience(months: number): number {
    return this.lively ? Math.max(months, months + Math.round(this.p.patience_months * (this.character.keep - this.character.be_rid))) : months;
  }

  /** Something happened to it (for its record's memory and reasons). */
  remember(t: number, what: string, about?: string, size = 1_000): void {
    const r = { t, what, ...(about !== undefined ? { about } : {}), size };
    this.recent.push(r);
    if (this.recent.length > 8) this.recent.shift();
    this.since.push(r);
    if (this.since.length > 16) this.since.shift();
  }
  count(what: string, n = 1): void {
    this.counts[what] = (this.counts[what] ?? 0) + n;
  }
  /** What has become of its wants since last asked (for whoever records outcomes). */
  takeWantEvents(): WantEvent[] {
    return this.told.splice(0);
  }

  /** The change to its record since it was last written, if any (contracts/entity-record.schema.json, OrganisationRecord). */
  change(circumstances: { [k: string]: number } = {}): RecordChange | null {
    if (!this.lively) return null;
    for (const e of this.wants.take()) {
      this.told.push(e);
      this.since.push({ t: e.t, what: `want_${e.kind}`, about: e.want.about, size: Math.round(e.want.weight), ...(e.kind === "pursued" && e.way ? { by: e.way.startsWith("offer:") ? e.way : e.way.split(":")[0]! } : {}) });
      if (this.since.length > 16) this.since.shift();
    }
    const bps = (z: number) => Math.max(0, Math.min(10_000, Math.round(5_000 + 1_000 * z)));
    const all = {
      character: Object.fromEntries(ORG_WANTS.map((w) => [w, bps(this.character[w])])),
      wants: this.wants.section(),
      memory: { recent: this.recent.map((r) => ({ ...r })) },
      ...(this.practice ? { practice: this.practice.section() } : {}),
      circumstances: { ...Object.fromEntries(Object.entries(this.counts).sort(([a], [b]) => (a < b ? -1 : 1))), ...circumstances },
    };
    const text = JSON.stringify(all);
    if (text === this.written) return null;
    const before = this.written ? JSON.parse(this.written) : {};
    const set = Object.fromEntries(Object.entries(all).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(before[k])));
    this.written = text;
    const because = this.since.splice(0);
    return { set, ...(because.length ? { because } : {}) };
  }
}
