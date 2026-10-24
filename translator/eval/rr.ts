// A trained translator on the test pilots' own requests (translator v3's "RR": docs/design/translator-v3.md, section 3),
// offline: no seat is called, the only model asked is the local one. Each request is asked as a run asks the first of
// two translators; its answer is what the arrangement would do with it: a draft offered, a refusal that stands, or the
// request sent behind (and why). An offered draft is scored against the pilot's own audited draft for that request (a
// blind reader's verdict on the call the seat was offered: runs/pilots-six-2026-10-24/verdicts-*.jsonl): the same in
// meaning as a draft read right is right; as one read wrong, wrong, and "confirmed wrong" where the seat confirmed that
// draft in the pilot. A draft the same as no audited one is left to a blind reader (`--judged FILE`: lines of {id,
// verdict}); until then it is "to judge" and listed in --to-judge.
//
//   OIKOS_TRANSLATOR_MODELS=<models> bun translator/eval/rr.ts decide/<name> <rr-requests.jsonl> --runs <runs folder> [--json FILE] [--to-judge FILE] [--judged FILE]...
//
// rr-requests.jsonl: one line a request (pilot, draft, request, forms, call, signoff, verdict), as the v3 round's
// pilot-rows script writes it. These requests are test-only: never trained on (the owner's split, 2026-10-23).
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DecideAdapter } from "../model/adapter";
import { partsOf } from "../model/subset";
import { STANDS } from "../src/arrangement";
import { sameButForFreeText, sameMeaning } from "../train/meaning";

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i < 0 ? undefined : args.splice(i, 2)[1]; };
const flags = (name: string) => { const out: string[] = []; for (let v = flag(name); v !== undefined; v = flag(name)) out.push(v); return out; };
const jsonOut = flag("json"), toJudge = flag("to-judge"), runsDir = flag("runs") ?? "runs", judgedFiles = flags("judged");
const [model, file] = args;
if (!model?.startsWith("decide/") || !file) throw new Error("usage: bun translator/eval/rr.ts decide/<name> <rr-requests.jsonl> --runs <runs folder> [--json FILE] [--to-judge FILE] [--judged FILE]...");

const jl = (f: string): any[] => readFileSync(f, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
/** A run's opening config (the first line of its log). */
function configOf(dir: string): any {
  const log = readdirSync(dir).find((f) => /^town\.seed\d+\.jsonl\.zst$/.test(f))!;
  return JSON.parse(spawnSync("sh", ["-c", `zstd -dc '${join(dir, log)}' 2>/dev/null | head -1`], { maxBuffer: 1 << 30 }).stdout.toString()).body.config;
}
const judged = new Map<string, string>();
for (const f of judgedFiles) for (const x of jl(f)) judged.set(x.id, x.verdict);

type Outcome = "draft" | "refusal_stands" | "behind";
interface Row { id: string; pilot: string; outcome: Outcome; why?: string; program: string; wrote?: string; sure: number; ms: number; pilot_call: string | null; pilot_verdict: string | null; pilot_signoff: string | null; same?: boolean; verdict?: "right" | "wrong" | "unclear" | "to_judge"; confirmed_wrong?: boolean }
const rows: Row[] = [];
const cases = jl(file);
const currencies = new Map<string, any>();
const adapter = new DecideAdapter(model.slice(7), { first: true, quiet: true });
await adapter.ready();
for (const c of cases) {
  if (!currencies.has(c.pilot)) currencies.set(c.pilot, configOf(join(runsDir, c.pilot)).world.currencies?.[0]);
  const a = await adapter.translate(c.request, c.forms, { who: `${c.pilot}/${c.seat}` });
  const label = /^none\((\w+)\)$/.exec(a.program)?.[1];
  const outcome: Outcome = a.withheld ? "behind" : label ? (STANDS.includes(label) && a.sure >= 0.1 ? "refusal_stands" : "behind") : "draft";
  const why = a.withheld ?? (outcome === "behind" ? `refused ${label}` : undefined);
  const r: Row = { id: `${c.pilot}/${c.draft}`, pilot: c.pilot, outcome, ...(why ? { why } : {}), program: a.program, ...(a.wrote && a.wrote !== a.program ? { wrote: a.wrote } : {}), sure: Math.round(a.sure * 1000) / 1000, ms: Math.round(a.ms), pilot_call: c.call, pilot_verdict: c.verdict, pilot_signoff: c.signoff };
  if (outcome === "draft") {
    const ctx = { currency: currencies.get(c.pilot), forms: c.forms.map((l: string) => { const p = partsOf(l); const fields: { [k: string]: { type: string } } = {}; const f = l.indexOf(": fields "); if (f >= 0) for (const m of l.slice(f + 9).matchAll(/([^\s,()]+) \(([^)]*)\)/g)) fields[m[1]!] = { type: m[2]!.startsWith("one of ") ? "choice" : m[2]!.replace(/, required$/, "") }; return { form: p.name, to: /, to=([^,]+),/.exec(l)?.[1] ?? "", id: p.id, fields }; }) };
    if (c.call && !c.call.startsWith("none(")) {
      try { r.same = sameMeaning(a.program, c.call, ctx) || sameButForFreeText(a.program, c.call, ctx); } catch { r.same = a.program === c.call; }
    }
    const j = judged.get(r.id);
    if (r.same && (c.verdict === "right" || c.verdict === "wrong")) r.verdict = c.verdict;
    else if (j === "right" || j === "wrong" || j === "unclear") r.verdict = j;
    else if (r.same && c.verdict === "unclear") r.verdict = "unclear";
    else r.verdict = "to_judge";
    // (Confirmed wrong, as can be seen: wrong, and the same as a draft the seat confirmed in the pilot.)
    if (r.verdict === "wrong") r.confirmed_wrong = !!r.same && c.signoff === "accept";
  }
  rows.push(r);
}
adapter.close();

const tally = (xs: Row[]) => {
  const d = xs.filter((r) => r.outcome === "draft");
  return { requests: xs.length, drafts: d.length, right: d.filter((r) => r.verdict === "right").length, wrong: d.filter((r) => r.verdict === "wrong").length, unclear: d.filter((r) => r.verdict === "unclear").length, to_judge: d.filter((r) => r.verdict === "to_judge").length, confirmed_wrong: d.filter((r) => r.confirmed_wrong).length, refusals_standing: xs.filter((r) => r.outcome === "refusal_stands").length, behind: xs.filter((r) => r.outcome === "behind").length };
};
const by: { [k: string]: ReturnType<typeof tally> } = { all: tally(rows) };
for (const p of [...new Set(rows.map((r) => r.pilot))].sort()) by[p] = tally(rows.filter((r) => r.pilot === p));
const behindWhy: { [k: string]: number } = {};
for (const r of rows) if (r.outcome === "behind") behindWhy[r.why!] = (behindWhy[r.why!] ?? 0) + 1;
const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
const summary = { model, by, behind: behindWhy, ms: { p50: ms[Math.floor(ms.length / 2)], p95: ms[Math.floor(ms.length * 0.95)] } };
console.log(JSON.stringify(summary, null, 1));
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ ...summary, rows }, null, 1));
if (toJudge) writeFileSync(toJudge, rows.filter((r) => r.verdict === "to_judge").map((r) => { const c = cases.find((x) => `${x.pilot}/${x.draft}` === r.id); return JSON.stringify({ id: r.id, request: c.request, forms: c.forms, program: r.program }); }).join("\n") + "\n");
