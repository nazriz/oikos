// The sparse mind's robustness audit (docs/design/ai-citizens.md 4): before its answers are used with a real model,
// check that they don't hang on how the question is worded or how the person is binned, and that a kind's remembered
// answer stands for the other people of that kind. Answers that swing are reported, and a run can be told not to use
// them (`oikos run ... --consult --consult-avoid <report.json>`).
//
// The questions are a world's own: the things its citizens ask about (CONSULT_THINGS: joining its union, founding its
// kinds of venture), and people drawn from its profile's values, with needs and means varied, money in units of the
// world's own essentials. Every call is recorded (usage and transcript) beside the report: model answers are data.

import { CONSULT_THINGS, drawPerson, NEEDS, Randomness, type ConsultQuestion, type PopulationValues } from "@oikos/participants";
import { askOnce, kindOf, WORDINGS, type Budget, type LlmAdapter, type LlmIO, type Price } from "@oikos/participants/llm";

export const AUDIT_VERSION = "0.1.0";

export interface AuditOptions {
  /** A generated world's config: its citizens say what they'd ask about, and its profile who they are. */
  config: any;
  adapter: LlmAdapter;
  prices: Record<string, Price>;
  budget?: Budget;
  /** Kinds of person to sample per thing; people of each kind beyond the first, asked afresh (fidelity). */
  kinds?: number;
  fidelity?: number;
  /** A swing in the gap between the options above this (points of 10), or the options' order flipping, is unstable. */
  threshold?: number;
  seed?: number;
}

interface KindResult {
  kind: string;
  /** The gap between the first option's score and the second's (points of 10), as the base wording has it. */
  gap: number;
  /** The same gap in each other wording, and for other people of the kind asked afresh. */
  wordings: { [name: string]: number | null };
  fresh: (number | null)[];
  unstable: string[];
}

export interface AuditReport {
  version: string;
  model: string;
  threshold: number;
  things: { about: string; kinds: KindResult[]; swing: { [wording: string]: { mean: number; max: number } }; fidelity_mae: number | null; unstable: string[] }[];
  /** Kinds (and things) a run should not use: pass the report to --consult-avoid. */
  avoid: string[];
  calls: number;
}

const round = (x: number) => Math.round(x * 100) / 100;

export async function consultAudit(o: AuditOptions): Promise<{ report: AuditReport; annotations: object[] }> {
  const kinds = o.kinds ?? 8, fidelity = o.fidelity ?? 2, threshold = o.threshold ?? 2;
  const citizen = o.config.participants.find((p: any) => p.controller?.impl === "citizen.default")?.controller?.params;
  if (!citizen) throw new Error("consult-audit: the world has no code citizens (citizen.default) to ask for");
  const pop: PopulationValues = citizen.values ?? { values: {} };
  const essentials = Number(citizen.essentials ?? 1);
  const things = [
    ...(citizen.union ? [CONSULT_THINGS.join(citizen.union)] : []),
    ...[...new Set<string>((citizen.ventures ?? []).map((v: any) => String(v.kind)))].map((k) => CONSULT_THINGS.found(k)),
  ];
  if (!things.length) throw new Error("consult-audit: the world's citizens have nothing to ask about (no union, no ventures)");

  const annotations: object[] = [];
  const io: LlmIO = { adapter: o.adapter, annotate: async (a) => void annotations.push(a), now: () => 0, prices: o.prices, ...(o.budget ? { budget: o.budget } : {}) };
  const seen = new Set<string>();
  const R = new Randomness(BigInt(o.seed ?? 1));
  let calls = 0;
  const gapOf = (s: { [k: string]: { mean: number } } | undefined, keys: string[]) => (s ? round((s[keys[0]!]!.mean - s[keys[1]!]!.mean) / 1_000) : null);

  const report: AuditReport = { version: AUDIT_VERSION, model: `${o.adapter.provider}/${o.adapter.model}`, threshold, things: [], avoid: [], calls: 0 };
  for (const th of things) {
    // People: drawn from the world's values; needs and means varied; grouped by kind until there are enough kinds with
    // enough people each.
    const r = R.stream(["consult-audit", th.about]);
    const byKind = new Map<string, ConsultQuestion[]>();
    for (let i = 0; i < 20_000 && [...byKind.values()].filter((xs) => xs.length > fidelity).length < kinds; i++) {
      const person = drawPerson(r, pop);
      const income = r.below(10) < 3 ? 0 : essentials * (2 + r.below(18));
      const q: ConsultQuestion = { ...th, person: {
        values: { ...person.values }, needs: Object.fromEntries(NEEDS.map((n) => [n, r.below(10_001)])),
        monthly_income: income, savings: essentials * r.below(60), household: 1 + r.below(4),
      } };
      const k = kindOf(q);
      const xs = byKind.get(k) ?? [];
      if (xs.length <= fidelity) byKind.set(k, [...xs, q]);
    }
    const chosen = [...byKind].filter(([, xs]) => xs.length > fidelity).sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(0, kinds);
    const keys = th.options.map((x) => x.key);
    const results: KindResult[] = [];
    for (const [kind, [first, ...others]] of chosen) {
      const ask = async (q: ConsultQuestion, w = WORDINGS.base!, who = "audit") => {
        calls++;
        return gapOf(await askOnce(io, q, who, seen, w, `consult-audit/${w.name}/${kind}`), keys);
      };
      const gap = await ask(first!);
      const wordings: KindResult["wordings"] = {};
      for (const w of Object.values(WORDINGS)) if (w.name !== "base") wordings[w.name] = await ask(first!, w);
      const fresh: (number | null)[] = [];
      for (const [i, q] of others.entries()) fresh.push(await ask(q, WORDINGS.base, `audit-${i + 1}`));
      const unstable: string[] = [];
      if (gap === null) unstable.push("unreadable");
      else {
        const check = (name: string, g: number | null) => {
          if (g === null) unstable.push(`${name}: unreadable`);
          else if (Math.abs(g - gap) > threshold) unstable.push(`${name}: swung ${round(g - gap)}`);
          else if (Math.sign(g) !== Math.sign(gap) && Math.abs(g) >= 0.5 && Math.abs(gap) >= 0.5) unstable.push(`${name}: flipped`);
        };
        for (const [name, g] of Object.entries(wordings)) check(name, g);
        fresh.forEach((g, i) => check(`someone else of the kind (${i + 1})`, g));
      }
      results.push({ kind, gap: gap ?? NaN, wordings, fresh, unstable });
    }
    const swing: { [w: string]: { mean: number; max: number } } = {};
    for (const w of Object.keys(WORDINGS).filter((x) => x !== "base")) {
      const d = results.filter((x) => Number.isFinite(x.gap) && x.wordings[w] !== null).map((x) => Math.abs(x.wordings[w]! - x.gap));
      swing[w] = { mean: d.length ? round(d.reduce((a, b) => a + b, 0) / d.length) : NaN, max: d.length ? round(Math.max(...d)) : NaN };
    }
    const f = results.flatMap((x) => (Number.isFinite(x.gap) ? x.fresh.filter((g): g is number => g !== null).map((g) => Math.abs(g - x.gap)) : []));
    const unstable = results.filter((x) => x.unstable.length).map((x) => x.kind);
    report.things.push({ about: th.about, kinds: results, swing, fidelity_mae: f.length ? round(f.reduce((a, b) => a + b, 0) / f.length) : null, unstable });
    report.avoid.push(...unstable);
    // Most kinds of this thing unstable: the thing itself isn't to be asked about.
    if (results.length && unstable.length * 2 > results.length) report.avoid.push(th.about);
  }
  report.calls = calls;
  return { report, annotations };
}

/** The report in words, for the terminal. */
export function auditText(r: AuditReport): string {
  const lines = [`Sparse-mind robustness audit (${r.model}; ${r.calls} calls; unstable: a swing over ${r.threshold} points of 10, or the options' order flipping)`];
  for (const t of r.things) {
    lines.push("", `${t.about}: ${t.kinds.length} kinds; ${t.unstable.length} unstable`);
    for (const [w, s] of Object.entries(t.swing)) lines.push(`  ${w.padEnd(18)} swing mean ${s.mean}, max ${s.max}`);
    lines.push(`  ${"fidelity".padEnd(18)} remembered vs fresh, mean ${t.fidelity_mae ?? "-"}`);
    for (const k of t.kinds.filter((x) => x.unstable.length)) lines.push(`  unstable: ${k.kind}: ${k.unstable.join("; ")}`);
  }
  lines.push("", r.avoid.length ? `A run can leave these out: --consult-avoid <this report> (${r.avoid.length})` : "Nothing to leave out.");
  return lines.join("\n");
}
