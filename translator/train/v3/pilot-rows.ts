#!/usr/bin/env bun
// The six pilots' requests as examples (translator v3, 2026-10-25). For each pilot's dataset (oikos dataset), each
// request with what the translator was shown, its final call, who drafted it, the seat's answer, and the blind audit's
// verdict on it (runs/pilots-six-2026-10-24/verdicts-*.jsonl). Labels for training only where the audit said right.
//   bun translator/train/v3/pilot-rows.ts <out dir>
// Writes <out>/pilot-train.jsonl (lv-09, lv-11, lv-13: audited right, as training examples with spans; the train split)
// and <out>/rr-requests.jsonl (lv-08, lv-10, lv-12: every request, for scoring only; never training).
// Moved into git from runs/translator-v3-2026-10-25/scripts/pilot-rows.ts on 2026-11-10.
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { shown } from "../../model/adapter";
import { spansIn } from "../data";
import { withImplied } from "./implied";
import { cardRows } from "../../model/export";
const out = resolve(process.argv[2]!);
const R = process.env.OIKOS_RUNS ?? "/Users/clawd/oikos/runs";
const D = join(R, "translator-v3-2026-10-25/datasets");
const jl = (f: string): any[] => readFileSync(f, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
const verdict = new Map<string, any>();
for (const f of ["verdicts-1.jsonl", "verdicts-2.jsonl"]) for (const v of jl(join(R, "pilots-six-2026-10-24", f))) verdict.set(v.id, v);
const TEST = new Set(["lv-08", "lv-10", "lv-12"]);
/** A form's line as a FormSpec (translator/train/data.ts). */
export function specOf(line: string): any {
  const m = /^- ([^,]+), to=([^,]+), id ([^\s:]+)/.exec(line);
  if (!m) return undefined;
  const fields: any = {};
  const f = line.indexOf(": fields ");
  if (f >= 0) for (const x of line.slice(f + 9).matchAll(/([^\s,()]+) \(([^)]*)\)/g)) {
    const req = /, required$/.test(x[2]!);
    const t = x[2]!.replace(/, required$/, "");
    fields[x[1]!] = t.startsWith("one of ") ? { type: "choice", options: t.slice(7).split(" | "), ...(req ? { required: true } : {}) } : { type: t, ...(req ? { required: true } : {}) };
  }
  return { form: m[1], to: m[2], id: m[3], fields };
}
const train: any[] = [], rr: any[] = [];
const counts: any = {};
for (const p of readdirSync(D).sort()) {
  const ds = readdirSync(join(D, p)).find((x) => x.endsWith(".dataset"))!;
  for (const x of jl(join(D, p, ds, "translations.jsonl"))) {
    if (x.synthetic) continue;
    const input = x.exchange?.[0]?.input;
    if (typeof input !== "string") continue;
    const { request, forms } = shown(input);
    const v = verdict.get(`${p}/${x.draft}`);
    const c = (counts[p] ??= { requests: 0, audited: 0, right: 0, example: 0 });
    c.requests++;
    if (TEST.has(p)) {
      rr.push({ pilot: p, draft: x.draft, seat: x.participant, as: x.as, request, forms, call: x.call ?? null, result: x.result, translator: x.model, used: x.route?.used, why: x.route?.why, first: x.route?.first, behind: x.route?.behind ? { model: x.route.behind.model, result: x.route.behind.result, call: x.route.behind.call } : undefined, signoff: x.signoff?.decision ?? null, verdict: v?.verdict ?? null, why_wrong: v?.why });
      continue;
    }
    if (!v) continue;
    c.audited++;
    if (v.verdict !== "right" || !x.call || x.call.startsWith("none(")) continue;
    c.right++;
    const specs = forms.map(specOf).filter(Boolean);
    let spans;
    try { spans = withImplied(spansIn(request, x.call, specs), x.call, forms); } catch { continue; }
    const e = { id: `${p}/${x.draft}`, request, forms, program: x.call, kind: "positive", origin: "pilot", source: `pilot ${p}`, spans, groups: { part: `pilot ${p}`, writer: x.model ?? "", source: "the six pilots" } };
    if (!cardRows(e)) continue;
    c.example++;
    train.push(e);
  }
}
writeFileSync(join(out, "pilot-train.jsonl"), train.map((e) => JSON.stringify(e)).join("\n") + "\n");
writeFileSync(join(out, "rr-requests.jsonl"), rr.map((e) => JSON.stringify(e)).join("\n") + "\n");
console.log(JSON.stringify({ counts, train: train.length, rr: rr.length }, null, 1));
