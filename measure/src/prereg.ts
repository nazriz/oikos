// Pre-registration (docs/experiments.md, "Pre-registration"): an experiment states, before it runs, which measures it
// will read as primary, which arms it compares with which, over which seeds and days, and at what interval. The harness
// refuses to run an experiment whose spec differs from its registration, keeps a copy of the registration with its
// hash beside the results, and the report presents as primary only what was registered as primary; every other
// measure appears as exploratory. The idea is the registered report's (Nosek et al. 2018, "The preregistration
// revolution"; Chambers 2013 (to confirm)): fixing the analysis before the data is what separates a finding from a
// pattern found afterwards.
//
// A registration is a JSON or YAML file:
//
//   preregistration: 1
//   experiment: support-stewards            # the spec's name
//   registered: 2026-10-23                  # a date the author states (the harness also records the file's commit)
//   question: ...                           # plain words
//   post: outside-support
//   arms: [code, diligent, rubber-stamp]
//   reference: code
//   seeds: [1, 2, 3]
//   forkDay: 30
//   untilDay: 180
//   level: 0.95                             # the intervals' level
//   correction: bonferroni                  # over the primary comparisons (or none)
//   primary:                                # each: a measure, and the arms compared (arm minus vs)
//     - { measure: review_changed_share, arm: rubber-stamp, vs: code, expect: lower }
//   secondary:                              # registered, read after the primary, not corrected
//     - { measure: appeals_made, arm: rubber-stamp, vs: code }
//
// A comparison may instead be a difference in differences, `did: [A, B, C, D]` ((A - B) - (C - D)), for the
// counterfactual design (an act withheld in B and D). `expect` (higher, lower, none) is a prediction, stated so that it
// can be checked; it is not a judgement of which is better.

import { createHash } from "node:crypto";

export interface Comparison {
  measure: string;
  /** Arm minus `vs`. */
  arm?: string;
  vs?: string;
  /** (A - B) - (C - D), seed by seed. */
  did?: [string, string, string, string];
  expect?: "higher" | "lower" | "none";
}

export interface Preregistration {
  preregistration: 1;
  experiment: string;
  registered: string;
  question: string;
  post: string;
  arms: string[];
  reference: string;
  seeds: number[];
  forkDay: number;
  untilDay: number;
  level?: number;
  correction?: "bonferroni" | "none";
  primary: Comparison[];
  secondary?: Comparison[];
  /** Anything else the author wants on record (stopping rule, exclusions). */
  notes?: string;
}

/** The registration's own hash: of its text as filed. */
export const preregHash = (text: string) => createHash("sha256").update(text).digest("hex");

export function parsePrereg(text: string, file = "preregistration"): Preregistration {
  const raw = file.endsWith(".json") || text.trimStart().startsWith("{") ? JSON.parse(text) : Bun.YAML.parse(text);
  return raw as Preregistration;
}

/** What is wrong with a registration in itself, and against the measures that exist (`known`: names a ledger or the
 * harness gives). Empty: nothing. */
export function preregProblems(p: Preregistration, known: (name: string) => boolean): string[] {
  const out: string[] = [];
  if (p.preregistration !== 1) out.push(`preregistration must be 1 (the format's version), not ${JSON.stringify(p.preregistration)}`);
  for (const k of ["experiment", "registered", "question", "post", "reference"] as const) if (typeof p[k] !== "string" || !p[k]) out.push(`${k} is missing`);
  if (!Array.isArray(p.arms) || !p.arms.length) out.push("arms are missing");
  if (!Array.isArray(p.seeds) || !p.seeds.length) out.push("seeds are missing");
  if (!(p.forkDay >= 0) || !(p.untilDay > p.forkDay)) out.push("forkDay must come before untilDay");
  if (p.level !== undefined && !(p.level > 0 && p.level < 1)) out.push("level must be between 0 and 1");
  if (p.correction !== undefined && !["bonferroni", "none"].includes(p.correction)) out.push("correction is bonferroni or none");
  if (!Array.isArray(p.primary) || !p.primary.length) out.push("no primary comparison: a registration names at least one");
  const arms = new Set(p.arms ?? []);
  if (p.reference && !arms.has(p.reference)) out.push(`the reference ${p.reference} is not an arm`);
  const seen = new Set<string>();
  for (const [where, list] of [["primary", p.primary ?? []], ["secondary", p.secondary ?? []]] as const) {
    for (const c of list) {
      const key = comparisonKey(c, p.reference);
      if (seen.has(key)) out.push(`${where}: ${key} is registered twice`);
      seen.add(key);
      if (!c.measure || !known(c.measure)) out.push(`${where}: no measure "${c.measure}"`);
      const named = c.did ?? [c.arm, c.vs ?? p.reference];
      if (c.did ? c.did.length !== 4 : !c.arm) out.push(`${where}: ${c.measure}: name an arm (and vs), or did: [A, B, C, D]`);
      for (const a of named) if (a !== undefined && !arms.has(a)) out.push(`${where}: ${c.measure}: ${a} is not an arm`);
      if (c.expect !== undefined && !["higher", "lower", "none"].includes(c.expect)) out.push(`${where}: ${c.measure}: expect is higher, lower or none`);
    }
  }
  return out;
}

/** Where a spec and its registration disagree (the harness refuses to run until they agree). */
export function specMismatch(p: Preregistration, spec: { name: string; post: string; seeds: number[]; forkDay: number; untilDay: number; arms: { name: string }[]; reference?: string }): string[] {
  const out: string[] = [];
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  if (p.experiment !== spec.name) out.push(`the registration is of "${p.experiment}", the spec is "${spec.name}"`);
  if (p.post !== spec.post) out.push(`post: registered ${p.post}, spec ${spec.post}`);
  if (!same([...p.seeds].sort((a, b) => a - b), [...spec.seeds].sort((a, b) => a - b))) out.push(`seeds: registered ${p.seeds.join(",")}, spec ${spec.seeds.join(",")}`);
  if (p.forkDay !== spec.forkDay || p.untilDay !== spec.untilDay) out.push(`days: registered ${p.forkDay} to ${p.untilDay}, spec ${spec.forkDay} to ${spec.untilDay}`);
  const arms = spec.arms.map((a) => a.name);
  if (!same([...p.arms].sort(), [...arms].sort())) out.push(`arms: registered ${p.arms.join(",")}, spec ${arms.join(",")}`);
  if (p.reference !== (spec.reference ?? arms[0])) out.push(`reference: registered ${p.reference}, spec ${spec.reference ?? arms[0]}`);
  return out;
}

export const comparisonKey = (c: Comparison, reference?: string) => (c.did ? `${c.measure}: (${c.did[0]} - ${c.did[1]}) - (${c.did[2]} - ${c.did[3]})` : `${c.measure}: ${c.arm} - ${c.vs ?? reference ?? "reference"}`);
