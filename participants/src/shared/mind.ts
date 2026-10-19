// A citizen's mind in code (docs/design/ai-citizens.md 3): who a person is (values, temperament, needs), how they decide
// (CONSUMAT's four ways), and how they learn (experience-weighted attraction). Deterministic: randomness only from the
// participant's own streams. No world knowledge: a mind scores facts it's given (offers' typed terms), in the world's
// terms, and makes of them what its values make of them. Citations: docs/research/references.md.
//
// Numbers are basis points (0..10000) wherever they could reach a log, so records stay integers.

import type { Rng } from "../rng";

// ---------------------------------------------------------------- who a person is

/** Schwartz's ten basic values (Schwartz 1992): what a person believes in, measured across cultures. */
export const VALUES = ["self_direction", "stimulation", "hedonism", "achievement", "power", "security", "conformity", "tradition", "benevolence", "universalism"] as const;
export type Value = (typeof VALUES)[number];

/** Needs that rise and fall (Humanoid Agents; D2A). Belonging (being part of something: Baumeister and Leary 1995) and
 * meaning (D2A's "spiritual satisfaction"; Park 2005) since the richer record (docs/design/ai-citizens.md 10c). */
export const NEEDS = ["subsistence", "shelter", "security", "social", "status", "belonging", "meaning"] as const;
export type Need = (typeof NEEDS)[number];

/** A world's figures for drawing people: each value's importance (mean and spread, basis points), from its profile. */
export interface PopulationValues {
  values: { [v in Value]?: { mean_bps: number; sd_bps: number } };
}

/** How a person acts, apart from what they believe (Dwarf Fortress's facets beside its values). */
export interface Temperament {
  /** Trying what's new (stimulation, self-direction): exploration in learning, innovators to laggards (Rogers). */
  openness: number;
  /** Copying what most do (Boyd and Richerson's conformist bias; conformity, tradition). */
  conformity: number;
  /** Copying what the respected do (prestige bias; achievement, power). */
  prestige: number;
}

export interface Person {
  values: { [v in Value]: number };
  temperament: Temperament;
  /** How much each need weighs, set by values (Dwarf Fortress: values set needs). */
  weights: { [n in Need]: number };
}

const clamp = (x: number, lo = 0, hi = 10_000) => Math.max(lo, Math.min(hi, Math.round(x)));

/** A roughly normal draw (Irwin–Hall: the sum of 12 uniforms), as the petition thresholds are drawn. */
function normal(rng: Rng, mean: number, sd: number): number {
  let s = 0;
  for (let i = 0; i < 12; i++) s += rng.below(1_000_001) / 1_000_000;
  return mean + (s - 6) * sd;
}

/**
 * A person, drawn from a world's figures. Temperament and need weights follow from values, by Schwartz's motivational
 * goals: security weighs the security need; power and achievement, status; benevolence and conformity, company;
 * hedonism, consumption; stimulation and self-direction make a person open; conformity and tradition, a conformist;
 * achievement and power, one who copies the respected. (Our mapping, to test against data: docs/design/ai-citizens.md.)
 */
export function drawPerson(rng: Rng, pop: PopulationValues): Person {
  return personOf(drawValues(rng, pop));
}

/** A person's values, drawn from a world's figures. */
export function drawValues(rng: Rng, pop: PopulationValues): Person["values"] {
  return Object.fromEntries(VALUES.map((v) => {
    const d = pop.values[v] ?? { mean_bps: 5000, sd_bps: 1500 };
    return [v, clamp(normal(rng, d.mean_bps, d.sd_bps))];
  })) as Person["values"];
}

const avg = (...xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** How much each need weighs for someone of these values: 1, plus up to 1 more as its values say (so no need is ever
 * ignored). Belonging by benevolence, conformity and tradition; meaning by tradition, universalism and benevolence
 * (the religious value tradition and conformity most: Saroglou, Delpierre and Dernelle 2004, to confirm). */
export function needWeights(values: Person["values"]): Person["weights"] {
  const w = (x: number) => clamp(10_000 + x, 10_000, 20_000);
  return {
    subsistence: w(values.hedonism * 0.5),
    shelter: w(avg(values.security, values.tradition) * 0.5),
    security: w(values.security),
    social: w(avg(values.benevolence, values.conformity)),
    status: w(avg(values.power, values.achievement)),
    belonging: w(avg(values.benevolence, values.conformity, values.tradition)),
    meaning: w(avg(values.tradition, values.universalism, values.benevolence)),
  };
}

/** The person these values make: temperament and need weights follow from them (above). */
export function personOf(values: Person["values"]): Person {
  const temperament: Temperament = {
    openness: clamp(avg(values.stimulation, values.self_direction)),
    conformity: clamp(avg(values.conformity, values.tradition)),
    prestige: clamp(avg(values.achievement, values.power)),
  };
  return { values, temperament, weights: needWeights(values) };
}
