// An organisation's practice: how an office has carried on, "as things are done here" (docs/design/ai-citizens.md 14g, as
// ruled on 2026-10-13; docs/behaviour/culture.md, "An office's practice").
//
// For each answer an organisation gives when asked (to hold a rent, to let a tenant under notice stay, to give a rise)
// it keeps how many times the occasion arose, how many times it said yes, and since when the count runs. That is the
// office's own habit, held in its own record, and it outlasts whoever holds the office. Basis: organisations act by
// routines that outlast those who made them (Nelson and Winter 1982); the practice of an office is made at its counter
// and handed on (Lipsky 1980); what was laid down early persists (Stinchcombe 1965). (To confirm: docs/research/references.md.)
//
// WHAT IT IS NOT. It is not shown to a seat as ready counts (the owner's ruling, 2026-10-13: "sounds like a god like
// view"): a seat that wants to know how its office has acted looks through the office's own papers, as a real office-holder
// does (docs/behaviour/culture.md). This file is read only by code holders, and only where the culture dial is on.
// Arithmetic only: no model, no draw, no clock. It judges nothing: no rate is the good one.

import type { CultureParams } from "./culture";

const DAY = 86_400;
/** The answers an organisation keeps a practice of, in the order the record keeps them. Closed; at most 6. */
export const PRACTICES = ["hold", "rise", "stay"] as const;
export type PracticeOf = (typeof PRACTICES)[number];

/** A practice as the record writes it. */
export interface PracticeRow { of: PracticeOf; occasions: number; did: number; since: number }

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export class Practice {
  private readonly rows = new Map<PracticeOf, PracticeRow>();
  constructor(private readonly p: Pick<CultureParams, "practice_window_days" | "practice_min_occasions" | "practice_inertia_bps" | "practice_opening">, restored?: PracticeRow[]) {
    for (const r of restored ?? []) if ((PRACTICES as readonly string[]).includes(r.of)) this.rows.set(r.of, { ...r });
  }

  /** An office is never new on day 1: where it holds no practice of an answer, it opens with a past at the rate its character gives (`bps`), a whole number of occasions. */
  open(of: PracticeOf, bps: number, t: number): void {
    if (this.rows.has(of)) return;
    const n = this.p.practice_opening;
    this.rows.set(of, { of, occasions: n, did: clamp(Math.round((n * bps) / 10_000), 0, n), since: Math.floor(t / DAY) });
  }

  /** The occasion arose and was answered, yes or no. Counts roll: when the window has run, the older half is let go. */
  observe(of: PracticeOf, t: number, did: boolean): void {
    const r = this.rows.get(of);
    if (!r) { this.rows.set(of, { of, occasions: 1, did: did ? 1 : 0, since: Math.floor(t / DAY) }); return; }
    const day = Math.floor(t / DAY);
    if (day - r.since > this.p.practice_window_days) {
      r.occasions = Math.max(1, Math.round(r.occasions / 2));
      r.did = clamp(Math.round(r.did / 2), 0, r.occasions);
      r.since += Math.floor(this.p.practice_window_days / 2);
    }
    r.occasions += 1;
    if (did) r.did += 1;
  }

  /** Its own habit as a rate, once there are enough occasions to be one. */
  rate(of: PracticeOf): number | undefined {
    const r = this.rows.get(of);
    return r && r.occasions >= this.p.practice_min_occasions ? Math.round((r.did * 10_000) / r.occasions) : undefined;
  }

  /** A code holder's rate: `chance` is what its character and the asker give; `baseline` is what its character alone gives. Its habit pulls the rate `inertia` of the way from the baseline: at the opening habit is the baseline, so nothing moves. */
  pulled(of: PracticeOf, chance: number, baseline: number): number {
    const rate = this.rate(of);
    if (rate === undefined) return chance;
    return clamp(Math.round(chance + ((rate - baseline) * this.p.practice_inertia_bps) / 10_000), 0, 10_000);
  }

  /** The record's section: at most six rows, in the closed order, each under 70 bytes. */
  section(): PracticeRow[] {
    return PRACTICES.flatMap((k) => (this.rows.has(k) ? [{ ...this.rows.get(k)! }] : []));
  }
}
