// The cost report: what a batch of runs spent on models, from the usage
// annotations every model call leaves in the log (CLAUDE.md: every run
// records token usage and cost).
//
// Two figures, never mixed:
//   recorded:  what was actually spent, priced when each call was made;
//   projected: what the same calls would have cost on each participant's configured
//              model, at published prices (orchestrator/prices.json). While
//              participants run on the mock, token counts are the mock's estimates,
//              so this is an order of magnitude, not a budget.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { query } from "@terrarium/measure";
import type { Price } from "@terrarium/seats/llm";

export interface PriceFile {
  source: string;
  retrieved: string;
  models: { [key: string]: Price };
}

export function loadPrices(path = join(import.meta.dir, "../prices.json")): PriceFile {
  return JSON.parse(readFileSync(path, "utf8"));
}

const usd = (micro: number) => `$${(micro / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const n = (x: number) => x.toLocaleString("en-US");

export interface CostRow {
  subject: string;
  purpose: string;
  used: string;
  projected?: string;
  assumed?: boolean;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  recorded_microusd: number;
  projected_microusd?: number;
  estimated: boolean;
}

export interface CostReport {
  runs: number;
  years: number;
  rows: CostRow[];
  recorded_microusd: number;
  projected_microusd?: number;
  per_run_projected_microusd?: { min: number; mean: number; max: number };
  prices: { source: string; retrieved: string };
  unpriced: string[];
  text: string;
}

/** The cost report for the runs exported to `dir` (a measurement folder). */
export async function costReport(dir: string, o: { translatorModel?: string; prices?: PriceFile } = {}): Promise<CostReport> {
  const prices = o.prices ?? loadPrices();
  const runs = await query(dir, "select run_id, end_t from runs order by run_id");
  const years = runs.reduce((a, r) => a + Number(r.end_t) / (365 * 86_400), 0);
  const usage = (await query(dir, `
    select run_id, subject, purpose, provider || '/' || model as used, count(*) as calls,
      sum(input_tokens) as input_tokens, sum(output_tokens) as output_tokens, sum(cache_read_tokens) as cache_read_tokens, sum(cache_write_tokens) as cache_write_tokens,
      sum(cost_microusd) as recorded_microusd
    from usage group by all order by run_id, subject, purpose`).catch(() => [])) as any[];
  const configured = (await query(dir, "select run_id, participant, configured from participants where controller = 'llm'").catch(() => [])) as any[];
  const modelOf = new Map(configured.map((r) => [`${r.run_id} ${r.participant}`, r.configured as string]));

  const unpriced = new Set<string>();
  const price = (model: string, u: any) => {
    const p = prices.models[model];
    if (!p) {
      unpriced.add(model);
      return undefined;
    }
    return Math.ceil((u.input_tokens * p.input + u.output_tokens * p.output + u.cache_read_tokens * (p.cache_read ?? p.input) + u.cache_write_tokens * (p.cache_write ?? p.input)) / 1e6);
  };

  // What each call would have gone to: a participant's own configured model; the translator's isn't in the world
  // config, so it's the one given, or the participants' model when they all share one.
  const rows = new Map<string, CostRow>();
  const perRun = new Map<string, number>();
  for (const u of usage) {
    let projected: string | undefined, assumed = false;
    if (u.purpose === "translator") {
      const models = [...new Set(configured.filter((r) => r.run_id === u.run_id).map((r) => r.configured))];
      projected = o.translatorModel ?? (models.length === 1 ? models[0] : undefined);
      assumed = !o.translatorModel;
    } else projected = modelOf.get(`${u.run_id} ${u.subject}`);
    const cost = projected ? price(projected, u) : undefined;
    if (cost !== undefined) perRun.set(u.run_id, (perRun.get(u.run_id) ?? 0) + cost);
    const key = `${u.subject} ${u.purpose} ${u.used} ${projected ?? ""}`;
    const r: CostRow = rows.get(key) ?? { subject: u.subject, purpose: u.purpose, used: u.used, projected, assumed, calls: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, recorded_microusd: 0, estimated: u.used.startsWith("mock/") };
    r.calls += u.calls;
    r.input_tokens += u.input_tokens;
    r.output_tokens += u.output_tokens;
    r.cache_read_tokens += u.cache_read_tokens;
    r.cache_write_tokens += u.cache_write_tokens;
    r.recorded_microusd += u.recorded_microusd;
    if (cost !== undefined) r.projected_microusd = (r.projected_microusd ?? 0) + cost;
    rows.set(key, r);
  }
  const list = [...rows.values()];
  const recorded = list.reduce((a, r) => a + r.recorded_microusd, 0);
  const priced = list.filter((r) => r.projected_microusd !== undefined);
  const projected = priced.length ? priced.reduce((a, r) => a + r.projected_microusd!, 0) : undefined;
  const runCosts = runs.map((r) => perRun.get(r.run_id as string) ?? 0);
  const perRunStats = projected !== undefined && runCosts.length ? { min: Math.min(...runCosts), mean: Math.round(runCosts.reduce((a, b) => a + b, 0) / runCosts.length), max: Math.max(...runCosts) } : undefined;
  const calls = list.reduce((a, r) => a + r.calls, 0);
  const mock = list.length > 0 && list.every((r) => r.estimated);

  const out: string[] = [];
  out.push(`Cost report: ${runs.length} run${runs.length === 1 ? "" : "s"}, ${years.toFixed(1)} simulated years in all.`, "");
  if (!calls) out.push("No model calls: every participant was run by code. Recorded: $0.00.");
  else {
    out.push(`Recorded: ${usd(recorded)} over ${n(calls)} model calls${mock ? " (every call went to the mock adapter, which costs nothing)" : ""}.`, "");
    const table = [["subject", "purpose", "priced as", "calls", "input tokens", "output tokens", "projected"]];
    for (const r of list) table.push([r.subject, r.purpose, r.projected ? `${r.projected}${r.assumed ? " *" : ""}` : "(no model configured)", n(r.calls), n(r.input_tokens), n(r.output_tokens), r.projected_microusd !== undefined ? usd(r.projected_microusd) : "not priced"]);
    const w = table[0]!.map((_, i) => Math.max(...table.map((row) => row[i]!.length)));
    out.push(`Projected, had each call gone to its participant's configured model (prices: ${prices.source}, retrieved ${prices.retrieved}):`);
    for (const row of table) out.push(`  ${row.map((c, i) => (i >= 3 ? c.padStart(w[i]!) : c.padEnd(w[i]!))).join("  ")}`);
    if (projected !== undefined) {
      out.push("", `  Total: ${usd(projected)}.${perRunStats ? ` Per run: ${usd(perRunStats.mean)} on average (${usd(perRunStats.min)} to ${usd(perRunStats.max)}).` : ""} Per simulated year: ${usd(years ? projected / years : 0)}.`);
    }
    if (list.some((r) => r.assumed && r.projected)) out.push("  * The translator's model isn't set by the world; it's priced as the participants' model (--translator-model to choose another).");
    if (unpriced.size) out.push(`  Not priced (no published price recorded in orchestrator/prices.json): ${[...unpriced].join(", ")}.`);
    if (mock) {
      out.push("", "How far to trust the projection:",
        "  - Token counts are the mock's estimates (about 4 characters a token), not a provider's count.",
        "  - The mock answers with bare tool calls. A real model also writes its reasoning, so output tokens are an underestimate.",
        "  - How often a participant acts, and how much it asks, came from the mock's code brain. A real model will act differently.",
        "  - No prompt caching is assumed. Each call re-sends the instructions and the report, so caching would cut the input cost.");
    }
  }
  return {
    runs: runs.length, years, rows: list, recorded_microusd: recorded, projected_microusd: projected, per_run_projected_microusd: perRunStats,
    prices: { source: prices.source, retrieved: prices.retrieved }, unpriced: [...unpriced], text: out.join("\n"),
  };
}
