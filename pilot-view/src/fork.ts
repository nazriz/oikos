// An experiment's folders (orchestrator/src/experiment.ts) as the viewer's inputs: an experiment folder (`spec.json`,
// `seed-<n>/`) or one seed's folder (`base.oklog`, `<arm>.json`, `<arm>.oklog` or `<arm>.jsonl[.zst]`, `<arm>.calls.jsonl`,
// `<arm>.debriefs.jsonl`). Each model arm of each seed is one page; the code arm of the same seed is its twin. Only read.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { ForkInput } from "./build";

const readJson = (p: string): any => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return undefined; } };
const isDir = (p: string) => { try { return statSync(p).isDirectory(); } catch { return false; } };

/** An arm's log in a seed folder: the kernel's binary log, or JSONL (plain or compressed) from before it. */
export function armLog(seedDir: string, arm: string): string | undefined {
  for (const f of [`${arm}.oklog`, `${arm}.jsonl`, `${arm}.jsonl.zst`]) if (existsSync(join(seedDir, f))) return join(seedDir, f);
  return undefined;
}

/** Is this a seed folder of an experiment? */
export const isSeedDir = (dir: string) => existsSync(join(dir, "template-seats.json")) || (existsSync(join(dir, "snapshot.bin")) && existsSync(join(dir, "config.json")));

/** Is this an experiment's folder? */
export const isExperimentDir = (dir: string) => existsSync(join(dir, "spec.json")) && readdirSync(dir).some((n) => /^seed-/.test(n) && isDir(join(dir, n)) && isSeedDir(join(dir, n)));

/** The arms of a seed folder (by their `<arm>.json`), each with its steward. */
export function armsOf(seedDir: string): { name: string; steward: any; log?: string }[] {
  return readdirSync(seedDir).filter((n) => n.endsWith(".json") && !/^(cast|config|brains|template-seats|ledger|delegation|composer)\.json$/.test(n)).map((n) => n.slice(0, -5)).sort()
    .map((name) => ({ name, steward: readJson(join(seedDir, `${name}.json`))?.steward, log: armLog(seedDir, name) })).filter((a) => a.steward && a.log);
}

/** The seats of an arm: who made model calls (`<arm>.calls.jsonl`) and whose costs the arm counts, with the post each
 * took at the fork (`template-seats.json`, where it names it; otherwise the header's own holder). */
function seatsOf(seedDir: string, arm: string, result: any): { [seat: string]: string | undefined } {
  const seats = new Set<string>(Object.keys(result?.costs ?? {}).filter((s) => s !== "translator"));
  const calls = join(seedDir, `${arm}.calls.jsonl`);
  if (existsSync(calls)) for (const l of readFileSync(calls, "utf8").split("\n")) {
    if (!l.includes('"purpose":"participant"')) continue;
    try { const x = JSON.parse(l); if (x.seat) seats.add(String(x.seat)); } catch { /* (a last line cut off) */ }
  }
  const template = readJson(join(seedDir, "template-seats.json")) ?? {};
  return Object.fromEntries([...seats].sort().map((s) => [s, template[s]?.capacity as string | undefined]));
}

/** What the calls file says of an arm's model calls: by seat and purpose, with their cost (it holds no prompts). */
function callsSummary(seedDir: string, arm: string) {
  const p = join(seedDir, `${arm}.calls.jsonl`);
  if (!existsSync(p)) return null;
  const by: { [k: string]: { calls: number; usd: number; estimated: number } } = {};
  for (const l of readFileSync(p, "utf8").split("\n")) {
    if (!l.trim()) continue;
    try { const x = JSON.parse(l); const k = `${x.seat ?? x.subject ?? "?"} ${x.purpose ?? "?"} ${x.model ?? "?"}`; const b = (by[k] ??= { calls: 0, usd: 0, estimated: 0 }); b.calls++; b.usd += (x.cost_microusd ?? 0) / 1e6; if (x.estimated) b.estimated++; } catch { /* (cut off) */ }
  }
  return by;
}

/** Every page an experiment or seed folder makes: one per model arm (or the arm asked for), each with its code twin. */
export function forkInputs(dir: string, only?: string): { seedDir: string; arm: string; input: ForkInput }[] {
  const expDir = isExperimentDir(dir) ? dir : isSeedDir(dir) && existsSync(join(dir, "..", "spec.json")) ? join(dir, "..") : undefined;
  const seeds = isExperimentDir(dir) ? readdirSync(dir).filter((n) => /^seed-/.test(n) && isSeedDir(join(dir, n))).sort().map((n) => join(dir, n)) : [dir];
  const spec = expDir ? readJson(join(expDir, "spec.json")) : undefined;
  const experiment = spec?.name ?? (expDir ? basename(expDir) : basename(join(dir, "..")));
  const out: { seedDir: string; arm: string; input: ForkInput }[] = [];
  for (const seedDir of seeds) {
    const arms = armsOf(seedDir);
    const code = arms.find((a) => a.steward?.kind === "code");
    const model = arms.filter((a) => a.steward?.kind !== "code");
    const chosen = only ? arms.filter((a) => a.name === only) : model;
    if (only && !chosen.length) throw new Error(`no arm "${only}" in ${seedDir} (arms: ${arms.map((a) => a.name).join(", ") || "none"})`);
    for (const a of chosen) {
      const result = readJson(join(seedDir, `${a.name}.json`));
      const seed = basename(seedDir);
      out.push({
        seedDir, arm: a.name,
        input: {
          log: a.log!, name: `${experiment} ${seed} ${a.name}`, seats: seatsOf(seedDir, a.name, result), twinLog: code && code.name !== a.name ? code.log : undefined,
          info: { experiment, seed, arm: a.name, steward: a.steward, arms: arms.map((x) => x.name), forkDay: spec?.forkDay ?? null, untilDay: spec?.untilDay ?? null, post: spec?.post ?? null, limitUsd: result?.limitUsd ?? null, wakes: result?.wakes ?? null, debrief: result?.debrief ?? null, measures: result?.measures ?? null, calls: callsSummary(seedDir, a.name), twinArm: code && code.name !== a.name ? code.name : null },
        },
      });
    }
  }
  return out;
}
