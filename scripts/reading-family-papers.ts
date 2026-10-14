// Seats' own words from past pilots' logs, for the reading gate's author's-family check (design 13f). The logs are read
// only, never changed. A past pilot holds almost no worded decision by a seat (a decision's reason is a code module's
// template), so what is taken is what seats wrote in their own words: each draft's `proposal`, the seat's request in
// its own sentences, tagged as a paper is before it leaves a run (names, ids, sums, days). Chosen by a rule fixed before
// any reader is asked: 30 to 120 words after tagging; per family, runs in turn, within a run by the hash of the draft's
// id, at most `--per-run` from one run, until `--n` for the family.
//
//   bun scripts/reading-family-papers.ts --out <file> [--n 16] [--per-run 4]

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Tagger } from "../participants/src/llm/reading-tags";

const RUNS = process.env.OIKOS_RUNS ?? "/Users/clawd/oikos/runs";
/** (run, log, family): the seat model's family in each. The largest Claude model's pilots are left out. */
const SOURCES: { run: string; log: string; family: "claude" | "gpt" }[] = [
  { run: "lv-03", log: "town-3000.seed402.jsonl.zst", family: "claude" },
  { run: "lv-01", log: "town-1000.seed401.jsonl.zst", family: "claude" },
  { run: "w2-12-flood", log: "town-1000.seed112.jsonl.zst", family: "claude" },
  { run: "w2-27-flood", log: "town-1000.seed127.jsonl.zst", family: "claude" },
  { run: "w2-45-lean", log: "town-1000.seed145.jsonl.zst", family: "claude" },
  { run: "w2-51-townhall", log: "town-1000.seed151.jsonl.zst", family: "claude" },
  { run: "w2-53-townhall", log: "town-1000.seed153.jsonl.zst", family: "claude" },
  { run: "w2-42-townworks", log: "town-1000.seed142.jsonl.zst", family: "claude" },
  { run: "w2-04-townhall", log: "town-1000.seed104.jsonl.zst", family: "claude" },
  { run: "w2-17-newmoney", log: "town-1000.seed117.jsonl.zst", family: "claude" },
  { run: "pilot-18", log: "town-1000.seed10.jsonl", family: "gpt" },
  { run: "pilot-9", log: "town-1000.seed1.jsonl", family: "gpt" },
  { run: "w2-22-townhall", log: "town-1000.seed922.jsonl.zst", family: "gpt" },
  { run: "w2-23-newplace", log: "town-1000.seed923.jsonl.zst", family: "gpt" },
  { run: "w2-33-works", log: "town-1000.seed133.jsonl.zst", family: "gpt" },
];

const args = process.argv.slice(2);
const flag = (n: string, d?: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1]! : d; };
const N = Number(flag("n", "16")), PER_RUN = Number(flag("per-run", "4")), out = flag("out");
if (!out) throw new Error("--out <file>");

async function* lines(path: string): AsyncGenerator<string> {
  const p = path.endsWith(".zst") ? Bun.spawn(["zstd", "-dc", path], { stdout: "pipe" }) : Bun.spawn(["cat", path], { stdout: "pipe" });
  const dec = new TextDecoder();
  let rest = "";
  for await (const chunk of p.stdout as unknown as AsyncIterable<Uint8Array>) {
    rest += dec.decode(chunk, { stream: true });
    let i: number;
    while ((i = rest.indexOf("\n")) >= 0) { yield rest.slice(0, i); rest = rest.slice(i + 1); }
  }
  if (rest) yield rest;
}

interface Cand { run: string; family: string; draft: string; as: string; text: string; key: string }
const pool: Cand[] = [];
for (const s of SOURCES) {
  const path = join(RUNS, s.run, s.log);
  if (!existsSync(path)) { console.error(`missing ${path}`); continue; }
  let world: { names: string[]; currency?: { code: string; symbol: string; unit_words?: string[] } } | undefined;
  let first = true;
  for await (const line of lines(path)) {
    if (first) {
      first = false;
      const w = JSON.parse(line).body.config.world;
      world = { names: (w.entities ?? []).map((e: any) => e.name).filter(Boolean), ...(w.currencies?.[0] ? { currency: { code: w.currencies[0].code, symbol: w.currencies[0].symbol, unit_words: w.currencies[0].unit_words } } : {}) };
      continue;
    }
    if (!line.includes('"draft"')) continue;
    let o: any;
    try { o = JSON.parse(line); } catch { continue; }
    const b = o.body;
    if (b?.annotation !== "draft" || typeof b.draft?.proposal !== "string") continue;
    const text = new Tagger(world as any).tag(b.draft.proposal);
    const n = text.split(/\s+/).length;
    if (n < 30 || n > 120) continue;
    pool.push({ run: s.run, family: s.family, draft: String(b.draft.id), as: String(b.draft.as), text, key: createHash("sha256").update(`${s.run}/${b.draft.id}`).digest("hex") });
  }
  console.error(`${s.run}: ${pool.filter((c) => c.run === s.run).length} candidates`);
}

const chosen: Cand[] = [];
for (const family of ["claude", "gpt"]) {
  const byRun = new Map<string, Cand[]>();
  for (const c of pool.filter((x) => x.family === family)) byRun.set(c.run, [...(byRun.get(c.run) ?? []), c]);
  for (const v of byRun.values()) v.sort((a, b) => (a.key < b.key ? -1 : 1));
  let taken = 0;
  for (let round = 0; round < PER_RUN && taken < N; round++) for (const [, v] of [...byRun].sort()) { if (taken >= N) break; const c = v[round]; if (c) { chosen.push(c); taken++; } }
}
writeFileSync(out, JSON.stringify({ note: "Seats' own words (draft proposals), tagged; chosen by a rule fixed before any reader was asked (scripts/reading-family-papers.ts).", papers: chosen.map((c) => ({ family: c.family, run: c.run, draft: c.draft, as: c.as, kind: "an instruction an office's holder gives, in their own words", standing: "addressee", paper: c.text })) }, null, 1));
console.error(`wrote ${chosen.length} papers: ${["claude", "gpt"].map((f) => `${f} ${chosen.filter((c) => c.family === f).length}`).join(", ")}`);
