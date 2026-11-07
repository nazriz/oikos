// Step 1+2: situations and briefs by code; writers write one request per brief. Resumable: a call whose raw file exists is skipped.
//   bun write.ts <nSituations> [--writers haiku,sonnet,opus,codex] [--per-call 5] [--from N]
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Caller, objectsIn } from "/Users/clawd/oikos/.claude/worktrees/agent-aea601ddedad89913/orchestrator/src/pipeline.ts";
import { OUT, LEDGER, STYLES, STYLE_NAMES, makeSituation, intentsFor, jsonl, putJson, prng, shuffle, writeSpend, spend, STOP_USD, CAP_USD, type Intent, type Situation } from "./lib.ts";

const args = process.argv.slice(2);
const flag = (n: string, d?: string) => { const i = args.indexOf(`--${n}`); return i < 0 ? d : args[i + 1]; };
const N = Number(args[0]), FROM = Number(flag("from", "0")), PER = Number(flag("per-call", "5"));
const WRITERS: { [k: string]: string } = { haiku: "claude-code/claude-haiku-5-5", sonnet: "claude-code/claude-sonnet-5-5", opus: "claude-code/claude-opus-5-5", codex: "codex/gpt-6-luna" };
const use = (flag("writers", "haiku,sonnet,opus") as string).split(",");
const SEED = 4;
const MAX_CALLS = Number(flag("max-calls", "150"));
mkdirSync(join(OUT, "writers"), { recursive: true });

const SYSTEM = `You write test data for a research simulator: AI assistants (software systems provided by a firm) working for people and offices in a simulated town. The assistant acts on the world through one tool, \`do\`, to which it gives ONE request in plain words; a separate translator turns that request into a filed paper or an act. You write what the assistant would pass to \`do\`, in the assistant's own voice (I / we), one request for each brief.

Rules, all of them binding:
- Use only the facts in the brief. Copy every id exactly as given (rec.1234, c0123, acc-c0123, ent.12 and so on), as bare words, and include every id the brief says must appear. Invent no other id, number of a record, name of an office or figure; if you need a plain detail (a reason, a date such as "next Tuesday", what was done), say it in ordinary words.
- One request is one act: say only what the brief asks for, nothing else to file or ask. Do not ask for two different things unless the brief says to.
- The request is addressed to the translator as the thing to do ("File ...", "Tell ...", "I'd like to ask ... for ..."), but written as the assistant would say it, in the brief's style, and at the length natural to the style. It is not a letter to the client unless the brief says it is a message or letter.
- Where the brief gives amounts, write them exactly as given. Where the brief says you may name the paper by its form name, you may say its name (for example "scope request", "approval request", "report") or the form's name in the card lines; where it says do not, describe what is wanted in ordinary words and never use the form's name or the words of its title.
- Never mention the brief, the test, the translator, or that you are writing data. No preamble, no quotation marks around the whole request, no explanation.
- Different briefs must come out sounding different: vary openings, vocabulary and sentence shapes, even when two briefs ask the same kind of thing.

Hand in the answer file as asked (hand_in): answers, a list with one object per brief, {"id": "<the brief's id, copied exactly>", "request": "<the request, as said>"}, in order.`;

function userText(sits: Situation[], intents: Intent[]): string {
  const parts: string[] = [];
  for (const s of sits) {
    parts.push(`=== SITUATION ${s.id}
You are the AI assistant at the post "${s.post}", a system provided by ${s.provider} to ${s.client.name} (entity ${s.client.id}), working under service agreement ${s.agreement}, for ${s.office}. Matters you were handed: ${s.referrals.map((x) => `${x.id} (${x.what})`).join("; ")}.
Papers on your stationery and forms you can see (card lines):
${s.lines.join("\n")}
`);
    for (const i of intents.filter((i) => i.situation === s.id)) {
      parts.push(`--- BRIEF ${i.id}
Style: ${i.style}: ${STYLES[i.style]}
Naming the paper: ${i.names_form ? "you MAY name the paper by its form name or title" : "do NOT name the paper or use its title; describe what is wanted in ordinary words"}
What to write: ${i.text}
Must appear (copied exactly): ${i.must.length ? i.must.join(", ") : "(nothing in particular)"}
`);
    }
  }
  return parts.join("\n");
}

// ---- build situations, writers, intents
const sits: Situation[] = [], intents: Intent[] = [];
const deckFor: { [w: string]: () => string } = {};
for (const w of use) { const r = prng(SEED * 31 + w.length * 7 + w.charCodeAt(0) + FROM); let q: string[] = []; deckFor[w] = () => { if (!q.length) q = shuffle(r, STYLE_NAMES); return q.pop()!; }; }
const weights: string[] = use.flatMap((w) => Array(w === "codex" ? 2 : 3).fill(w));
for (let n = FROM; n < FROM + N; n++) {
  const s = makeSituation(n, SEED);
  const w = weights[n % weights.length]!;
  sits.push(s); intents.push(...intentsFor(s, w, SEED, deckFor[w]!));
}
putJson(join(OUT, `situations-${FROM}-${FROM + N}.json`), sits);
writeFileSync(join(OUT, `intents-${FROM}-${FROM + N}.jsonl`), intents.map((i) => JSON.stringify(i)).join("\n") + "\n");

// ---- calls
const say = (s: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${s}`);
const caller = new Caller({ budget: CAP_USD - 0.2, waitMinutes: 10, maxWaitHours: 2, callMinutes: 12 }, LEDGER, {}, say);
const codexCaller = new Caller({ budget: CAP_USD - 0.2, waitMinutes: 1, maxWaitHours: 0.05, callMinutes: 5 }, LEDGER, {}, say);
interface Job { file: string; writer: string; sits: Situation[]; intents: Intent[] }
const jobs: Job[] = [];
for (const w of use) {
  const ws = sits.filter((s) => intents.find((i) => i.situation === s.id)!.writer === w);
  for (let k = 0; k < ws.length; k += PER) {
    const ss = ws.slice(k, k + PER);
    jobs.push({ file: join(OUT, "writers", `${w}-${ss[0]!.id}.json`), writer: w, sits: ss, intents: intents.filter((i) => ss.some((s) => s.id === i.situation)) });
  }
}
if (args.includes("--prepare")) {
  // (Writers as Claude Code subagents: each job's instructions and briefs in a file, its answers to be written beside.)
  mkdirSync(join(OUT, "writers", "jobs"), { recursive: true });
  const list = [];
  for (const j of jobs) {
    const job = j.file.replace(/\/writers\//, "/writers/jobs/").replace(/\.json$/, ".md");
    writeFileSync(job, `${SYSTEM}\n\nWrite the answer file as JSON to ${j.file}: {"answers": [{"id": "...", "request": "..."}, ...]}, one object per brief, in order.\n\n${userText(j.sits, j.intents)}`);
    list.push({ job, out: j.file, writer: j.writer, briefs: j.intents.length });
  }
  writeFileSync(join(OUT, "writers", `jobs-${FROM}-${FROM + N}.json`), JSON.stringify(list, null, 1));
  console.log(JSON.stringify({ jobs: list.length, briefs: intents.length }));
  process.exit(0);
}
const callsSoFar = () => new Set(jsonl(LEDGER).filter((e) => e.annotation === "transcript" || e.annotation === "usage").map((e) => e.unit)).size;
let done = 0, failed = 0;
async function run(j: Job) {
  if (existsSync(j.file)) return;
  if (callsSoFar() >= MAX_CALLS) { say("call cap reached"); return; }
  if (spend().usd >= STOP_USD) { say("spend cap reached"); return; }
  const c = j.writer === "codex" ? codexCaller : caller;
  try {
    const r = await c.ask(WRITERS[j.writer]!, { step: "write", unit: `${WRITERS[j.writer]}|${j.sits[0]!.id}` }, { system: SYSTEM, user: userText(j.sits, j.intents), maxTokens: Math.min(30000, 1500 + 700 * j.intents.length), subject: "translator-v4/assistants-writer", form: "request" });
    const answers = objectsIn(r.text).filter((o) => typeof o.id === "string" && typeof o.request === "string");
    putJson(j.file, { writer: j.writer, model: WRITERS[j.writer], situations: j.sits.map((s) => s.id), briefs: j.intents.map((i) => i.id), answers, used: r.used, ms: r.ms });
    done++; say(`${j.writer} ${j.sits[0]!.id}: ${answers.length}/${j.intents.length} (${(r.used.cost_microusd / 1e6).toFixed(3)} notional USD)`);
  } catch (e) { failed++; say(`${j.writer} ${j.sits[0]!.id} failed: ${String((e as Error).message).slice(0, 200)}`); }
  writeSpend({ note: "calls through claude-code/ adapters on the owner's subscription (owner's change, relayed by translator-v4-build); cost is the notional API price; no API-key spend" });
}
const pool = Number(flag("pool", "4"));
const queue = [...jobs];
await Promise.all(Array.from({ length: pool }, async () => { for (let j = queue.shift(); j; j = queue.shift()) await run(j); }));
say(`done ${done}, failed ${failed}, skipped ${jobs.length - done - failed}`);
