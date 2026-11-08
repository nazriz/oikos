// Translator v4: scope-request recall on the scope set (translator/eval/scope-requests.jsonl, a test set: read here to
// score, never to train), for any model as v4-score.ts takes them, by writer and by style. Each model's own answer
// (before release or cut-off), and as served at a cut-off on sureness if one is given (`--cut <model>=<sure>`, the
// model's 1% mark from v4-score): a scope request served as anything else is the miss the study cannot afford.
//   bun translator/model/v4-scope.ts --rows <out rows.jsonl>     writes the set as text rows (for text_model.py answer)
//   bun translator/model/v4-scope.ts --model decide/<name> --model text:<answers.jsonl> [--cut decide/x=0.9] --out <file.json>
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formsFiled, SITUATIONS } from "../eval/scope-situations";
import { AgreeAdapter, DecideAdapter, SERVING_CHECKS } from "./adapter";

const args = process.argv.slice(2);
const all = (k: string) => args.flatMap((a, i) => (a === `--${k}` ? [args[i + 1]!] : []));
const one = (k: string) => all(k)[0];
const cases: any[] = readFileSync(join(import.meta.dir, "../eval/scope-requests.jsonl"), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
if (one("rows")) {
  writeFileSync(one("rows")!, cases.map((c) => JSON.stringify({ id: c.id, request: c.request.replace(/[\r\n]/g, " "), forms: SITUATIONS[c.situation], program: "none(unclear)" })).join("\n") + "\n");
  process.exit(0);
}
const cuts = new Map(all("cut").map((c) => [c.slice(0, c.lastIndexOf("=")), Number(c.slice(c.lastIndexOf("=") + 1))]));
const report: any = { cases: cases.length, models: {} };
for (const m of all("model")) {
  const got = new Map<string, { program: string | null; sure: number; held?: boolean }>();
  if (m.startsWith("decide/")) {
    // (`decide/<a>+<b>`: two models agreeing, AgreeAdapter. A serving check's answer is the model's own, not served.)
    const a = m.includes("+") ? new AgreeAdapter(m.slice(7), { first: true, quiet: true, unreleased: true }) : new DecideAdapter(m.slice(7), { first: true, quiet: true, unreleased: true });
    await a.ready();
    for (const c of cases) { const x = await a.translate(c.request, SITUATIONS[c.situation]!, { draft: true }); got.set(c.id, { program: x.wrote ?? x.program, sure: x.sure, held: !!x.withheld && SERVING_CHECKS.includes(x.withheld) }); }
    a.close();
  } else for (const l of readFileSync(m.slice(5), "utf8").split("\n").filter((l) => l.trim())) { const x = JSON.parse(l); got.set(x.id, { program: x.program, sure: x.sure ?? 0 }); }
  const cut = cuts.get(m);
  const tally = (xs: any[]) => {
    const pos = xs.filter((c) => c.label === "scope"), neg = xs.filter((c) => c.label !== "scope");
    const filed = (c: any) => formsFiled(got.get(c.id)?.program ?? "").includes("scope_request");
    const served = (c: any) => cut === undefined || ((got.get(c.id)?.sure ?? 0) >= cut && got.get(c.id)?.program !== "none(unclear)" && !got.get(c.id)?.held);
    return { scope: pos.length, recognised: pos.filter(filed).length, others: neg.length, false_positives: neg.filter(filed).length,
      ...(cut !== undefined ? { scope_served_as_scope: pos.filter((c) => filed(c) && served(c)).length, scope_served_as_other: pos.filter((c) => !filed(c) && served(c)).length } : {}) };
  };
  const by = (k: string) => Object.fromEntries([...new Set(cases.map((c) => c[k]))].sort().map((v) => [v, tally(cases.filter((c) => c[k] === v))]));
  report.models[m] = { all: tally(cases), by_writer: by("writer"), by_style: by("style"), ...(cut !== undefined ? { cut } : {}) };
  console.error(m, JSON.stringify(report.models[m].all));
}
writeFileSync(one("out")!, JSON.stringify(report, null, 1));
