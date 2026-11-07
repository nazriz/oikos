// Step 3a: the writers' requests as blind files for two readers (Claude Code subagents), and the readers' job files.
//   bun blind.ts <situations json> <intents jsonl> [--batch 100]
// Writes <OUT>/requests.jsonl (Unlabelled, with the intent beside), <OUT>/blind.jsonl (shuffled {id, request, forms}),
// <OUT>/readers/jobs/<reader>-NNN.md (the reader task and a batch; the translator's own prompt in readers/system.md),
// <OUT>/readers/jobs.json.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { translatorSystem } from "../../src/index";
import { OUT, jsonl, prng, shuffle } from "./lib.ts";

const args = process.argv.slice(2);
const BATCH = Number(args[args.indexOf("--batch") + 1] ?? 100) || 100;
const sits: any[] = JSON.parse(readFileSync(args[0]!, "utf8"));
const intents = new Map(jsonl(args[1]!).map((i: any) => [i.id, i]));
const byId = new Map(sits.map((s) => [s.id, s]));
const requests: any[] = [];
let missing = 0;
for (const f of readdirSync(join(OUT, "writers")).filter((f) => f.endsWith(".json") && !f.startsWith("jobs"))) {
  let x: any;
  try { x = JSON.parse(readFileSync(join(OUT, "writers", f), "utf8")); } catch { console.error(`not JSON: ${f}`); continue; }
  for (const a of x.answers ?? []) {
    const i: any = intents.get(a.id);
    if (!i || typeof a.request !== "string" || !a.request.trim()) { missing++; continue; }
    const s = byId.get(i.situation);
    requests.push({ id: a.id, request: a.request.trim(), forms: s.lines, from: { situation: s.id, writer: `claude-code/claude-${i.writer}-5-5 (subagent)` }, currency: s.currency, intent: i });
  }
}
writeFileSync(join(OUT, "requests.jsonl"), requests.map((r) => JSON.stringify(r)).join("\n") + "\n");
const blind = shuffle(prng(77), requests.map((r) => ({ id: r.id, request: r.request, forms: r.forms })));
writeFileSync(join(OUT, "blind.jsonl"), blind.map((b) => JSON.stringify(b)).join("\n") + "\n");
const task = readFileSync(join(import.meta.dir, "../in-situ/reader-call.txt"), "utf8").trimEnd();
mkdirSync(join(OUT, "readers", "jobs"), { recursive: true });
writeFileSync(join(OUT, "readers", "system.md"), translatorSystem());
const jobs: any[] = [];
for (const reader of ["sonnet", "haiku"]) for (let k = 0; k * BATCH < blind.length; k++) {
  const batch = blind.slice(k * BATCH, (k + 1) * BATCH);
  const out = join(OUT, "readers", `${reader}-${String(k + 1).padStart(3, "0")}.json`);
  const job = join(OUT, "readers", "jobs", `${reader}-${String(k + 1).padStart(3, "0")}.md`);
  writeFileSync(job, `${task}\n\nWrite the answer file as JSON to ${out}: {"answers": [{"id": "...", "program": "..."}, ...]}, one object per line of BLIND, in order (the program JSON-escaped as a JSON string must be; the program itself as written).\n\n=== BLIND ===\n${batch.map((b) => JSON.stringify(b)).join("\n")}\n`);
  jobs.push({ reader, job, out, n: batch.length, done: existsSync(out) });
}
writeFileSync(join(OUT, "readers", "jobs.json"), JSON.stringify(jobs, null, 1));
console.log(JSON.stringify({ requests: requests.length, missing, batches: jobs.length }));
