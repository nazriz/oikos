// A finished run's trials, added to the model's ledger (adapter.ts `probationOf`; the owner's ruling, 2026-10-23: a form
// a `cards` model was not taught is ours once five seat-confirmed requests on it agree with what ours wrote).
//   bun translator/model/probation.ts decide/<name> <run's translations.jsonl (oikos dataset)>... [--write]
// For each request that went behind because a form was in its trial (`route.why: probation`) and whose draft the seat
// confirmed: one line {form, agree, run, draft} a form, `agree` whether ours meant the same (`route.agree`). Printed;
// with --write, appended to probation.jsonl beside the model (OIKOS_TRANSLATOR_MODELS/<name>). A line already in the
// ledger (same run and draft) is not added again. Nothing else in the model's folder is touched.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export interface Outcome { form: string; agree: boolean; run: string; draft: string }

/** The trials' outcomes in a run's translations (one line a request, as `oikos dataset` writes them). */
export function outcomesOf(lines: any[]): Outcome[] {
  const out: Outcome[] = [];
  for (const x of lines) {
    const r = x.route;
    if (!r || r.why !== "probation" || x.signoff?.decision !== "accept" || !Array.isArray(r.first?.trial)) continue;
    for (const form of r.first.trial) out.push({ form, agree: r.agree === true, run: String(x.run ?? ""), draft: String(x.draft ?? "") });
  }
  return out;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const [model, ...files] = args.filter((a) => a !== "--write");
  if (!model?.startsWith("decide/") || !files.length) throw new Error("usage: bun translator/model/probation.ts decide/<name> <translations.jsonl>... [--write]");
  const ledger = join(process.env.OIKOS_TRANSLATOR_MODELS ?? resolve(import.meta.dir, "../../runs/translator-model"), model.slice(7), "probation.jsonl");
  const had = new Set(existsSync(ledger) ? readFileSync(ledger, "utf8").split("\n").filter((l) => l.trim()).map((l) => { const x = JSON.parse(l); return `${x.run}|${x.draft}|${x.form}`; }) : []);
  const fresh = files.flatMap((f) => outcomesOf(readFileSync(f, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)))).filter((o) => !had.has(`${o.run}|${o.draft}|${o.form}`));
  for (const o of fresh) console.log(JSON.stringify(o));
  if (write && fresh.length) appendFileSync(ledger, fresh.map((o) => JSON.stringify(o)).join("\n") + "\n");
  console.error(`${fresh.length} outcomes${write ? ` added to ${ledger}` : " (not written: --write)"}`);
}
