// Translator v4, round 2, step 2a: the pilot's requests (both sides: the test side's keys are what parity is scored
// against, never trained on) as job files for two blind readers, Claude Code subagents on the owner's plan (Sonnet 5.5
// and Opus 5.5). A reader sees the translator's own prompt (system.md) and a batch of {id, request, forms}: not the
// other reader, not the seat's draft, not the model, side or seat (the ids are hashes).
//   bun translator/train/v4-pilot/jobs.ts <split dir> <answers dir> [--batch 75]
// Writes <answers dir>/system.md, jobs/<reader>-NNN.md and jobs.json. The answers come back to <answers dir>.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { translatorSystem } from "../../src/index";

const args = process.argv.slice(2);
const [split, answers] = args;
if (!split || !answers) throw new Error("usage: bun jobs.ts <split dir> <answers dir> [--batch N]");
const BATCH = Number(args[args.indexOf("--batch") + 1] ?? 75) || 75;
const blind = readFileSync(join(split, "blind.jsonl"), "utf8").split("\n").filter((l) => l.trim());
const task = readFileSync(join(import.meta.dir, "../in-situ/reader-call.txt"), "utf8").trimEnd();
mkdirSync(join(answers, "jobs"), { recursive: true });
writeFileSync(join(answers, "system.md"), translatorSystem());
const jobs: any[] = [];
for (const reader of ["sonnet", "opus"]) for (let k = 0; k * BATCH < blind.length; k++) {
  const batch = blind.slice(k * BATCH, (k + 1) * BATCH);
  const name = `${reader}-${String(k + 1).padStart(3, "0")}`;
  const out = join(answers, `${name}.json`), job = join(answers, "jobs", `${name}.md`);
  writeFileSync(job, `${task}\n\nWrite the answer file as JSON to ${out}: {"answers": [{"id": "...", "program": "..."}, ...]}, one object per line of BLIND, in order (the program JSON-escaped as a JSON string must be; the program itself as written).\n\n=== BLIND ===\n${batch.join("\n")}\n`);
  jobs.push({ reader, job, out, n: batch.length, done: existsSync(out) });
}
writeFileSync(join(answers, "jobs.json"), JSON.stringify(jobs, null, 1));
console.log(JSON.stringify({ requests: blind.length, batches: jobs.length }));
