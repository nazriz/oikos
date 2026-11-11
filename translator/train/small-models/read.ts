// Small models' requests, step 3: two blind readers of two model families read every distinct request, as the
// pipeline's readers do (pipeline.ts `askReader`: the translator's prompt as the system message, reader-call.txt as the
// task, a batch of {id, request, forms} lines; each call in a fresh temporary directory of its adapter's own, with no
// tools, no settings and no session kept). A request left unanswered is asked once more, alone in a smaller batch.
//   bun translator/train/small-models/read.ts <split dir> <out dir> <reader>... [--batch 30] [--jobs 3] [--budget 40] [--cap 1500]
// `--cap`: the most reader calls in all (every call counted, retries too, from the ledger). Written under <out dir>:
// calls.jsonl (the ledger: every prompt and answer, kept), <reader>/batch-NNN.json, uniformity.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { translatorSystem } from "@oikos/translator";
import { askReader, Caller, implausiblyUniform } from "../../../orchestrator/src/pipeline";

const args = process.argv.slice(2);
const opt = (k: string, d: number) => (args.includes(`--${k}`) ? Number(args[args.indexOf(`--${k}`) + 1]) : d);
const pos = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const [split, outArg, ...readers] = pos as [string | undefined, string | undefined, ...string[]];
if (!split || !outArg || readers.length !== 2 || readers[0] === readers[1]) throw new Error("usage: bun read.ts <split dir> <out dir> <reader A> <reader B> [--batch N] [--jobs N] [--budget USD] [--cap N]");
if (readers.some((r) => r.includes("gpt-6-astra"))) throw new Error("gpt-6-astra is never used");
const out: string = outArg;
const BATCH = opt("batch", 30), JOBS = opt("jobs", 3), CAP = opt("cap", 1500);
mkdirSync(out, { recursive: true });
const ledger = join(out, "calls.jsonl");
const blind: { id: string; request: string; forms: string[] }[] = readFileSync(join(split, "blind.jsonl"), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
const system = translatorSystem();
const task = readFileSync(join(import.meta.dir, "../in-situ/reader-call.txt"), "utf8").trimEnd();
const say = (s: string) => console.error(`${new Date().toISOString()} ${s}`);
const caller = new Caller({ budget: opt("budget", 40), waitMinutes: 20, maxWaitHours: 6, callMinutes: 20 }, ledger, {}, say);
const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "-");
const callsSoFar = () => (existsSync(ledger) ? readFileSync(ledger, "utf8").split("\n").filter((l) => l.includes('"annotation":"usage"')).length : 0);

async function readAll(reader: string) {
  const dir = join(out, safe(reader));
  mkdirSync(dir, { recursive: true });
  const batches: { name: string; items: typeof blind }[] = [];
  for (let k = 0; k * BATCH < blind.length; k++) batches.push({ name: `batch-${String(k + 1).padStart(3, "0")}`, items: blind.slice(k * BATCH, (k + 1) * BATCH) });
  const one = async (b: { name: string; items: typeof blind }) => {
    const file = join(dir, `${b.name}.json`);
    if (existsSync(file)) return;
    if (callsSoFar() >= CAP) throw new Error(`the cap of ${CAP} reader calls is reached`);
    const r = await askReader(caller, reader, { step: "read", unit: `${safe(reader)}/${b.name}` }, system, task, b.items);
    writeFileSync(file, JSON.stringify({ reader, ids: b.items.map((x) => x.id), answers: r.answers, repaired: r.repaired, used: r.used, ms: r.ms }, null, 1));
    say(`${reader} ${b.name}: ${r.answers.length}/${b.items.length} in ${Math.round(r.ms / 1000)} s`);
  };
  const queue = [...batches];
  await Promise.all(Array.from({ length: JOBS }, async () => { for (let b; (b = queue.shift()); ) await one(b); }));
  // Asked once more: what a batch left unanswered, in a batch of its own.
  const got = new Set<string>();
  for (const b of batches) for (const a of JSON.parse(readFileSync(join(dir, `${b.name}.json`), "utf8")).answers) got.add(a.id);
  const missing = blind.filter((x) => !got.has(x.id));
  for (let k = 0; k * 10 < missing.length; k++) await one({ name: `again-${String(k + 1).padStart(3, "0")}`, items: missing.slice(k * 10, (k + 1) * 10) });
  const answers: { id: string; program: string }[] = [];
  const seen = new Set<string>();
  for (const f of [...batches.map((b) => b.name), ...Array.from({ length: Math.ceil(missing.length / 10) }, (_, k) => `again-${String(k + 1).padStart(3, "0")}`)])
    for (const a of JSON.parse(readFileSync(join(dir, `${f}.json`), "utf8")).answers) if (!seen.has(a.id)) { seen.add(a.id); answers.push(a); }
  writeFileSync(join(dir, "answers.json"), JSON.stringify({ reader, answers }, null, 1));
  return { reader, answered: answers.length, of: blind.length, uniform: implausiblyUniform(answers, true) ?? null };
}

const done = await Promise.all(readers.map(readAll));
writeFileSync(join(out, "uniformity.json"), JSON.stringify({ readers: done, calls: callsSoFar() }, null, 1));
console.log(JSON.stringify({ readers: done, calls: callsSoFar() }, null, 1));
