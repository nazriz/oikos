// Training rows from a run's captured citizen decisions (docs/citizen-data.md; contracts/citizen-data.schema.json).
//
// A run that captures writes `<run>.citizens.jsonl.zst` beside its log: each person's turns (a decision as their mind
// recorded it, with its draws), what they came to know of how things went, and each change to their record. This reads
// that stream alone (no log, no replay) and writes one Example a turn: the turn, the person's record folded as it
// stood when they decided, and every outcome that names the turn. Two passes: the first gathers the outcomes (and the
// segments of a run taken up again), the second folds records and writes, so only outcomes are held in memory.
//
// A turn on a day of a run that a real test case of the translator came from (translator/eval/pilot-cases.ts, read
// through in-situ.ts for its run and day only) is marked `exclude_from_training`: those stay out of all training. The
// held-out cases are never read here. Nothing is scored.

import { createReadStream, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import zlib from "node:zlib";
import { realTests, runName, type TestRef } from "./in-situ";

const DAY = 86_400;
export const FORMAT = "citizen-data/1";
export const EXAMPLE = "citizen-example/1";

/** The stream's rows, one at a time, in order (each line parsed), with the part of the stream it is in. */
async function* rowsOf(path: string): AsyncIterable<{ row: any; part: number }> {
  const raw = createReadStream(path);
  const input = path.endsWith(".zst") ? raw.pipe(zlib.createZstdDecompress()) : raw;
  let part = -1;
  for await (const line of createInterface({ input, crlfDelay: Infinity })) {
    if (!line) continue;
    const row = JSON.parse(line);
    if (row.row === "segment") {
      if (row.schema !== FORMAT) throw new Error(`${path}: a stream of ${row.schema}, not ${FORMAT}`);
      part++;
    } else if (part < 0) throw new Error(`${path}: no segment row before its first row`);
    yield { row, part };
  }
}

/** The capture beside a run's log, or in a run's folder: the file itself, a log beside it, or a folder with one. */
export function captureOf(path: string): string {
  if (existsSync(path) && statSync(path).isDirectory()) {
    const found = [...new Bun.Glob("*.citizens.jsonl.zst").scanSync({ cwd: path })].sort();
    if (found.length !== 1) throw new Error(`${path}: ${found.length ? `${found.length} captures (name one)` : "no captured citizen data (<run>.citizens.jsonl.zst)"}`);
    return join(path, found[0]!);
  }
  if (/\.citizens\.jsonl(\.zst)?$/.test(path)) return path;
  return path.replace(/\.jsonl(\.zst)?$/, ".citizens.jsonl.zst");
}

export interface CitizenDataSummary {
  run: string;
  turns: number;
  examples: number;
  excluded: number;
  outcomes: number;
  /** Outcomes naming a turn the stream has (the rest name none, or a turn before the stream began). */
  outcomes_joined: number;
  records: number;
  /** Turns made before the person's first record change (their record folded as empty). */
  before_record: number;
  by_domain: { [domain: string]: number };
}

/**
 * One Example a turn of the capture at `path`, written to `out` (JSON lines). `run`: the run's name for the test cases'
 * rule (default: its folder, as in-situ.ts names it); `tests`: the test cases (default: the real ones).
 */
export async function exportCitizenData(path: string, out: string, o: { run?: string; tests?: TestRef[] } = {}): Promise<CitizenDataSummary> {
  const run = o.run ?? runName(path);
  const testDays = new Set((o.tests ?? realTests()).filter((c) => c.run === run).map((c) => c.day));
  // Pass 1: the parts (a part from `from_t` replaces what earlier parts wrote from then on), and the outcomes.
  const from: number[] = [];
  const seen: { row: any; part: number }[] = [];
  let runId = "", outcomes = 0;
  for await (const x of rowsOf(path)) {
    if (x.row.row === "segment") {
      from[x.part] = x.row.from_t;
      runId ||= x.row.run;
    } else if (x.row.row === "outcome") seen.push(x);
  }
  // (A row of part i stands unless a later part begins at or before its moment.)
  const until = from.map((_, i) => Math.min(Infinity, ...from.slice(i + 1)));
  const stands = (row: any, part: number) => row.t < until[part]!;
  const outcomesOf = new Map<string, any[]>();
  for (const { row, part } of seen) {
    if (!stands(row, part)) continue;
    for (const x of row.outcomes as any[]) {
      outcomes++;
      if (typeof x.of !== "number") continue;
      const k = `${row.p}\u0000${x.of}`;
      (outcomesOf.get(k) ?? outcomesOf.set(k, []).get(k)!).push(x);
    }
  }
  // Pass 2: records folded, turns written.
  const records = new Map<string, { set: { [section: string]: unknown }; at: number }>();
  const w = Bun.file(out).writer();
  const s: CitizenDataSummary = { run: runId, turns: 0, examples: 0, excluded: 0, outcomes, outcomes_joined: 0, records: 0, before_record: 0, by_domain: {} };
  for await (const { row, part } of rowsOf(path)) {
    if (row.row === "segment" || !stands(row, part)) continue;
    if (row.row === "record") {
      s.records++;
      const r = records.get(row.p) ?? { set: {}, at: row.t };
      Object.assign(r.set, row.set);
      r.at = row.t;
      records.set(row.p, r);
    } else if (row.row === "turn") {
      s.turns++;
      const d = row.decision;
      const r = records.get(row.p);
      if (!r) s.before_record++;
      const joined = outcomesOf.get(`${row.p}\u0000${row.n}`) ?? [];
      if (joined.length) s.outcomes_joined += joined.length;
      const excluded = testDays.has(Math.floor(row.t / DAY));
      const ex: any = { schema: EXAMPLE, run: runId, t: row.t, participant: row.p, n: row.n, domain: d.domain, ...(d.choice !== undefined ? { choice: d.choice } : {}), decision: d, draws: row.draws, record: r ? r.set : {}, ...(r ? { record_at: r.at } : {}), outcomes: joined };
      if (excluded) {
        ex.exclude_from_training = true;
        s.excluded++;
      }
      w.write(`${JSON.stringify(ex)}\n`);
      s.examples++;
      s.by_domain[d.domain] = (s.by_domain[d.domain] ?? 0) + 1;
    }
  }
  await w.end();
  return s;
}
