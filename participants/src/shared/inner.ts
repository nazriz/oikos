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

/** How far the adults who raise a child count in the child's values (docs/behaviour/citizen.md, "Upbringing"), of
 * 10,000. PLACEHOLDER: parents' and children's values are alike, but no figure for how alike was confirmed (a typical
 * correlation of 0.2 to 0.3 is recalled, to confirm: docs/research/references.md). */
export const UPBRINGING = { share_bps: 5_000 };
const clamp = (x: number, lo = 0, hi = 10_000) => Math.max(lo, Math.min(hi, Math.round(x)));
/** A roughly normal draw (the sum of 12 uniforms), in standard deviations. */
function z(rng: Rng): number {
  let s = 0;
  for (let i = 0; i < 12; i++) s += rng.below(1_000_001) / 1_000_000;
  return s - 6;
}

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
