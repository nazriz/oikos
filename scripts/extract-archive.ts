#!/usr/bin/env bun
// extract-archive: the valuable content of every past model run, in a clean, format-independent dataset.
//
// The platform's log format is going to change (the kernel is being rebuilt), and the new world will not read the old
// logs. Real-model runs cannot be made again, so before any raw log is retired, what is worth keeping is read out of
// it, with the readers the platform already has (`situationsOf` and the corpus reader, the debrief collector), and
// written as versioned JSONL (zstd-compressed, one `.jsonl.zst` a run and kind) under one folder, with a manifest.
//
//   bun scripts/extract-archive.ts list      [--runs DIR] [--json]       the logs found, which are model runs and why
//   bun scripts/extract-archive.ts one LOG   [--out DIR]                 one log's seat requests, situations, transcripts,
//                                                                         notebooks, debriefs and exit accounts
//   bun scripts/extract-archive.ts runs      [--jobs N] [--only RE]      `one` for every model run (resumable: a run whose
//                                                                         shard is whole is skipped)
//   bun scripts/extract-archive.ts examples                              the translator's examples, deduplicated
//   bun scripts/extract-archive.ts findings                              pilot reviews, STATUS files, decisions-log entries
//   bun scripts/extract-archive.ts manifest                              the manifest (runs.jsonl, manifest.json)
//   bun scripts/extract-archive.ts verify    [--spot 20] [--seed N]      counts against each run's own reports; random items
//                                                                         checked against the raw logs
//
// Reads runs and writes only under --out (default <runs>/archive-2026-10-17). Never alters, moves or deletes anything
// in the runs folder, and calls no model. Schema: SCHEMA.md in the archive (written by `manifest`; source in
// docs/archive-schema.md).
//
// Never read here, by design: the held-out test cases (`~/oikos-private/translator/held-out.json`, translator/eval/
// held-out.ts), any `held_out: true` result in an evaluation file, and what a seat asked to be kept back from
// publication in its debrief (it is counted, never copied).

import { createHash } from "node:crypto";
import { closeSync, createReadStream, createWriteStream, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import zlib from "node:zlib";
import { accountRows, DebriefCollector, debriefRows } from "../orchestrator/src/debriefs";
import { runName, situationsOf, type Asked, type Situation } from "../orchestrator/src/in-situ";
import { isStoppedLog, logLines, realModelIn, runOf } from "../orchestrator/src/logs";
import { CASES } from "../translator/eval/cases";
import { PILOT_CASES } from "../translator/eval/pilot-cases";

export const ARCHIVE_VERSION = "1.0.0";
export const ARCHIVE_NAME = "archive-2026-10-17";
const HERE = dirname(import.meta.path);
const DEFAULT_RUNS = process.env.OIKOS_RUNS ?? "/Users/clawd/oikos/runs";

const DAY = 86_400;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

// ───────────────────────────── writing shards ─────────────────────────────

/** A zstd-compressed JSONL file, written to `<path>.part` and renamed when whole (so a shard that exists is complete). */
export class Shard {
  count = 0;
  bytes = 0; // uncompressed
  private readonly z = zlib.createZstdCompress({ params: { [zlib.constants.ZSTD_c_compressionLevel]: 12, [zlib.constants.ZSTD_c_windowLog]: 27 } });
  private readonly file;
  private readonly closed: Promise<void>;
  constructor(readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.file = createWriteStream(`${path}.part`);
    this.closed = new Promise((res, rej) => { this.file.on("close", res); this.file.on("error", rej); this.z.on("error", rej); });
    this.z.pipe(this.file);
  }
  async put(row: unknown): Promise<void> {
    const s = JSON.stringify(row) + "\n";
    this.count++;
    this.bytes += Buffer.byteLength(s);
    if (!this.z.write(s)) await new Promise<void>((r) => this.z.once("drain", () => r()));
  }
  /** Finish. A shard with no rows is not kept. Returns the size on disk (0 if none). */
  async end(): Promise<number> {
    this.z.end();
    await this.closed;
    if (this.count === 0) { rmSync(`${this.path}.part`, { force: true }); return 0; }
    renameSync(`${this.path}.part`, this.path);
    return statSync(this.path).size;
  }
}

/** The rows of a shard (`.jsonl.zst`, or plain `.jsonl`). */
export function readShard(path: string): any[] {
  const text = path.endsWith(".zst") ? Buffer.from(zlib.zstdDecompressSync(readFileSync(path))).toString("utf8") : readFileSync(path, "utf8");
  return text.split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

// ───────────────────────────── finding the logs ─────────────────────────────

export interface LogRec {
  path: string;
  /** Relative to the runs folder. */
  rel: string;
  /** The folder the log is in, relative to the runs folder; and the run's id (its log's name). */
  folder: string;
  id: string;
  /** A name safe for a file: folder and id. */
  key: string;
  bytes: number;
  kind: "model" | "code-only" | "duplicate" | "stopped" | "not-a-log";
  why: string;
  /** For a duplicate: the key of the log it copies. */
  copy_of?: string;
  spent_microusd?: number;
}

const SKIP_DIR = (name: string, depth: number) =>
  name.endsWith(".dataset") || name === "measure" || name === "ds" || name === "node_modules" || name === "worktrees" || name.startsWith("archive-") || (depth === 0 && name.startsWith("test-"));
const SEED_LOG = /\.seed\d+(\.stopped-\d+)?\.jsonl(\.zst)?$|^town\.seed\d+\.jsonl(\.zst)?$/;

export function* walkFiles(root: string, dir = root, depth = 0, maxDepth = 8): Generator<string> {
  if (depth > maxDepth) return;
  let names: string[];
  try { names = readdirSync(dir).sort(); } catch { return; }
  for (const n of names) {
    const p = join(dir, n);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) { if (!SKIP_DIR(n, depth)) yield* walkFiles(root, p, depth + 1, maxDepth); } else if (st.isFile()) yield p;
  }
}

/** A log's first line (its header), or undefined. Reads no more of the file than that line (a log can be gigabytes). */
export async function headerOf(path: string): Promise<any | undefined> {
  const raw = createReadStream(path);
  const stream = path.endsWith(".zst") ? raw.pipe(zlib.createZstdDecompress()) : raw;
  try {
    const parts: Buffer[] = [];
    for await (const chunk of stream) {
      const buf = chunk as Buffer;
      const nl = buf.indexOf(10);
      if (nl >= 0) { parts.push(buf.subarray(0, nl)); break; }
      parts.push(buf);
    }
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
  } catch { return undefined; } finally { raw.destroy(); stream.destroy(); }
}

/** How much of a log's start is searched for a real model's answers: a seat or a translator asks on the first days. */
const HEAD_BYTES = 400_000_000;

/** The first real model ("provider/model") a log's lines name, found with the shell's own tools (zstd, grep) so that a log
 * of a gigabyte costs seconds (the first 400 MB of it, uncompressed): a line that names a provider other than the mock and our own `decide` translator. A match
 * is then confirmed by reading the line (`realModelIn`'s rule). */
export async function quickRealModel(path: string): Promise<string | undefined> {
  const q = `'${path.replace(/'/g, `'\\''`)}'`;
  const read = path.endsWith(".zst") ? `zstd -dc ${q} 2>/dev/null | head -c ${HEAD_BYTES}` : `head -c ${HEAD_BYTES} ${q}`;
  const p = Bun.spawn(["sh", "-c", `${read} | grep -a -E '"annotation":"(usage|transcript|model_call_failed)"' | grep -a -v -E '"provider":"(mock|decide)"' | grep -a -E '"provider":"[^"]+"' | head -1`], { stdout: "pipe", stderr: "ignore" });
  const line = (await new Response(p.stdout).text()).trim();
  await p.exited;
  if (!line) return undefined;
  try {
    const b = JSON.parse(line).body;
    const provider = b?.provider ?? b?.data?.provider;
    if (typeof provider === "string" && provider !== "mock" && provider !== "decide") return `${provider}/${b?.model ?? b?.data?.model ?? "?"}`;
  } catch { /* (a line cut off) */ }
  return undefined;
}

/** Every log under the runs folder, which are runs with model calls, and why. Reads headers and summaries; a log with
 * no summary is read to find a real model's answers (`realModelIn`). */
export async function discover(runs: string, o: { deep?: boolean } = {}): Promise<LogRec[]> {
  const logs: LogRec[] = [];
  for (const p of walkFiles(runs)) {
    const n = basename(p);
    if (!SEED_LOG.test(n) || /\.anchors\.|\.debriefs\.|\.summary\./.test(n)) continue;
    const folder = relative(runs, dirname(p));
    const id = runOf(p);
    const key = `${folder}/${id}`.replace(/[^A-Za-z0-9._-]+/g, "__");
    logs.push({ path: p, rel: relative(runs, p), folder, id, key, bytes: statSync(p).size, kind: "model", why: "" });
  }
  // A resumed run's earlier logs are history; its current log holds the same answers.
  const have = new Set(logs.filter((l) => !isStoppedLog(l.path)).map((l) => l.path.replace(/\.zst$/, "")));
  const seen = new Map<string, LogRec>();
  for (const l of logs) {
    if (isStoppedLog(l.path)) {
      const current = l.path.replace(/\.stopped-\d+(\.jsonl)(\.zst)?$/, "$1");
      if (have.has(current)) { l.kind = "stopped"; l.why = "history of a resumed run: its answers are in the resumed log"; continue; }
    }
    // A plain and a compressed log of one run: the plain one is current (logs.ts).
    if (l.path.endsWith(".zst") && existsSync(l.path.slice(0, -4))) { l.kind = "duplicate"; l.why = "the plain log beside it is the run's current one"; l.copy_of = l.key.replace(/\.zst$/, ""); continue; }
    const header = await headerOf(l.path);
    if (!header || header.kind !== "header") { l.kind = "not-a-log"; l.why = "no header line"; continue; }
    // The same run copied to another folder: same header, same size.
    const ident = `${header.body?.config_hash}:${header.body?.initial_state_hash}:${header.body?.run_id}:${l.bytes}`;
    const first = seen.get(ident);
    if (first) { l.kind = "duplicate"; l.why = `byte-for-byte the size and header of ${first.rel}`; l.copy_of = first.key; continue; }
    seen.set(ident, l);
    const summaryPath = l.path.replace(/\.jsonl(\.zst)?$/, ".summary.json");
    let summary: any;
    try { summary = JSON.parse(readFileSync(summaryPath, "utf8")); } catch { /* (none: an older or cut-off run) */ }
    const calls = readdirSync(dirname(l.path)).filter((f) => f.endsWith(".calls.jsonl") && statSync(join(dirname(l.path), f)).size > 0);
    // (A run's summary leaves `spentMicroUsd` out when nothing was spent.)
    if (summary) {
      l.spent_microusd = summary.spentMicroUsd ?? 0;
      if (l.spent_microusd! > 0) { l.kind = "model"; l.why = `summary records ${l.spent_microusd} microusd spent`; continue; }
      if (calls.length) { l.kind = "model"; l.why = `a calls log (${calls[0]}) beside it`; continue; }
      // (A Codex seat costs nothing per call: spending nothing is not proof of no model. A batch whose sets seat a model, or that
      // names one, is read for a real model's answers; one that seats none is a code-only run.)
      let batch: any;
      try { batch = JSON.parse(readFileSync(join(dirname(l.path), "batch.json"), "utf8")); } catch { /* (none) */ }
      const seated = batch && (/=llm|model_seats|--composer/.test(JSON.stringify([batch.sets, batch.args]) ?? "") || [batch.model, batch.translator, batch.translator_first].some((m) => typeof m === "string" && m && !/^(mock|none)/.test(m)));
      if (!o.deep && batch && !seated) { l.kind = "code-only"; l.why = "summary records nothing spent, no calls log, and its batch seats no model"; continue; }
    }
    const real = await quickRealModel(l.path);
    if (real) { l.kind = "model"; l.why = `a real model's answers in the log (${real})`; } else { l.kind = "code-only"; l.why = "no real model's answers in the log"; }
  }
  return logs;
}

// ───────────────────────────── the real test cases ─────────────────────────────

const norm = (s: string) => s.trim();
const start60 = (s: string) => norm(s).slice(0, 60);
export interface TestIndex {
  texts: Set<string>;
  starts: Set<string>;
  /** `<run folder's last part>|<draft id>` of each case. */
  drafts: Set<string>;
  /** `<run folder's last part>|<seat>|<day>` of each case. */
  days: { run: string; seat: string; day: number }[];
}
export function testIndex(): TestIndex {
  const ix: TestIndex = { texts: new Set(), starts: new Set(), drafts: new Set(), days: [] };
  for (const c of PILOT_CASES) {
    ix.texts.add(norm(c.request));
    if (start60(c.request).length >= 20) ix.starts.add(start60(c.request));
    const run = c.from.run.split("/").at(-1)!;
    ix.drafts.add(`${run}|${c.from.draft}`);
    ix.days.push({ run, seat: c.from.seat, day: c.from.day });
  }
  return ix;
}
const seatIs = (seat: string, participant: string) => participant === seat || participant.startsWith(`${seat}-`);
/** Whether a seat-day (the run's folder name, the seat, the day) is one a real test case comes from. */
export const isTestDay = (ix: TestIndex, run: string, seat: string, day: number) => ix.days.some((d) => d.run === run && d.day === day && seatIs(d.seat, seat));

// ───────────────────────────── one log ─────────────────────────────

/** The notebook a seat is shown at the top of what it reads, or undefined. */
export function notebookOf(input: unknown): string | undefined {
  if (typeof input !== "string" || !input.startsWith("Your notebook:")) return undefined;
  const end = input.indexOf("\n\nSince you last looked:");
  return (end < 0 ? input.slice("Your notebook:".length) : input.slice("Your notebook:".length, end)).trim();
}

/** What became of a request, in one word. */
export function outcomeOf(r: { drafted: boolean; result?: string; decision?: string; executed?: { applied: boolean } }): string {
  if (!r.drafted) return "not_taken_up";
  if (r.result === "failed") return "translation_failed";
  if (r.decision === "unanswered") return "unanswered";
  if (r.decision && r.decision !== "accept") return "declined";
  if (r.executed) return r.executed.applied ? "applied" : "refused_by_kernel";
  return r.decision === "accept" ? "accepted_not_carried_out" : "drafted_only";
}

/** A route without the forms list (it is repeated in every request; the request row holds the forms once). */
const slimRoute = (route: any) => {
  if (!route || typeof route !== "object") return route;
  const out: any = {};
  for (const [k, v] of Object.entries<any>(route)) out[k] = v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([kk]) => kk !== "forms_shown")) : v;
  return out;
};

export interface RunCounts {
  situations: number;
  seat_requests: number;
  seat_requests_test_flagged: number;
  translations: number;
  transcripts: number;
  transcripts_by_purpose: { [purpose: string]: number };
  mock_transcripts_left_out: number;
  notebooks: number;
  debriefs_published_rows: number;
  debriefs_kept_back_rows: number;
  debriefs_old_kind_kept_back: number;
  exit_accounts: number;
  usage_entries: number;
  cost_microusd: number;
  systems: number;
}
export interface RunResult {
  key: string;
  rel: string;
  run_id: string;
  folder: string;
  world?: string;
  seed?: number;
  seats: { [seat: string]: string };
  counts: RunCounts;
  test_cases_found: number;
  test_cases_missing: string[];
  unmatched_drafts: number;
  no_system: number;
  raw_log_bytes: number;
  shards: { [kind: string]: { rows: number; bytes_uncompressed: number; bytes: number } };
  not_extracted: string[];
  seconds: number;
}

const KINDS = ["seat_requests", "situations", "transcripts", "notebooks", "debriefs", "exit_accounts", "systems"] as const;
const OUTPUT_PURPOSES = new Set(["participant", "compose", "notebook", "account"]);
const INPUT_PURPOSES = new Set(["compose", "notebook", "account"]);

export const shardPath = (out: string, kind: string, key: string) => join(out, kind, `${key}.jsonl.zst`);

/** Read one log and write its shards under `out`. */
export async function extractLog(rec: Pick<LogRec, "path" | "rel" | "folder" | "id" | "key" | "bytes">, out: string, ix = testIndex()): Promise<RunResult> {
  const t0 = Date.now();
  const writers = Object.fromEntries(KINDS.map((k) => [k, new Shard(shardPath(out, k, rec.key))])) as { [k in (typeof KINDS)[number]]: Shard };
  const folderName = rec.folder.split("/").at(-1)!;
  const run = runName(rec.path);
  const short = run.replace(/^runs\//, "");
  const collector = new DebriefCollector(rec.path);
  const counts: RunCounts = { situations: 0, seat_requests: 0, seat_requests_test_flagged: 0, translations: 0, transcripts: 0, transcripts_by_purpose: {}, mock_transcripts_left_out: 0, notebooks: 0, debriefs_published_rows: 0, debriefs_kept_back_rows: 0, debriefs_old_kind_kept_back: 0, exit_accounts: 0, usage_entries: 0, cost_microusd: 0, systems: 0 };
  let world: string | undefined, seed: number | undefined;
  const pendingUsage = new Map<string, any[]>();
  const perDay = new Map<string, number>(); // seat|day -> n (as situationsOf numbers its situations)
  const lastNotebook = new Map<string, string>();
  const systemsSeen = new Set<string>();
  const pending: Promise<void>[] = []; // writes in flight, in order
  const queue = (p: () => Promise<void>) => { pending.push(p()); };
  const putSystem = async (text: string | undefined): Promise<string | undefined> => {
    if (!text) return undefined;
    const id = sha(text);
    if (!systemsSeen.has(id)) { systemsSeen.add(id); counts.systems++; await writers.systems.put({ schema: "system/1", sha256: id, text }); }
    return id;
  };

  const take = (e: any) => {
    const b = e.body ?? {};
    if (e.kind === "header") { world = b.config?.meta?.name; seed = b.config?.seed; }
    if (e.kind === "header" || e.kind === "annotation") collector.add(e);
    if (e.kind !== "annotation") return;
    if (b.annotation === "usage") {
      counts.usage_entries++;
      counts.cost_microusd += b.cost_microusd ?? 0;
      const k = `${b.subject}|${b.purpose}`;
      (pendingUsage.get(k) ?? pendingUsage.set(k, []).get(k)!).push(b);
      return;
    }
    if (b.annotation !== "transcript") return;
    const d = b.data ?? {};
    const usage = pendingUsage.get(`${b.subject}|${d.purpose}`)?.shift();
    if (d.provider === "mock") { counts.mock_transcripts_left_out++; return; }
    const day = Math.floor(e.t / DAY);
    let situation_id: string | undefined;
    if (d.purpose === "participant") {
      const k = `${b.subject}|${day}`;
      const n = (perDay.get(k) ?? 0) + 1;
      perDay.set(k, n);
      situation_id = `${short}/${b.subject}/d${day}/${n}`;
    }
    counts.transcripts++;
    counts.transcripts_by_purpose[d.purpose] = (counts.transcripts_by_purpose[d.purpose] ?? 0) + 1;
    const inputText = typeof d.input === "string" ? d.input : JSON.stringify(d.input ?? "");
    const row: any = {
      schema: "transcript/1", run_key: rec.key, run: rec.id, seq: e.seq, t: e.t, day, seat: b.subject, purpose: d.purpose, model: `${d.provider}/${d.model}`, turn: d.turn,
      ...(d.ref ? { draft_id: d.ref } : {}), ...(situation_id ? { situation_id } : {}), ...(d.system_sha256 ? { system_sha256: d.system_sha256 } : {}), input_chars: inputText.length,
      tokens: usage ? { input: usage.input_tokens ?? 0, output: usage.output_tokens ?? 0, cache_read: usage.cache_read_tokens ?? 0, cache_write: usage.cache_write_tokens ?? 0, cost_microusd: usage.cost_microusd ?? 0 } : null,
    };
    if (INPUT_PURPOSES.has(d.purpose)) row.input = d.input;
    if (OUTPUT_PURPOSES.has(d.purpose) || (d.purpose === "translator" && !d.ref)) row.output = d.output;
    else row.output_omitted = d.purpose === "debrief" ? "a debrief's words are published, or kept back, only by the debrief rows" : d.purpose === "translator" ? "the translator's exchange is in the request it answered" : "purpose not on the list of those kept in full";
    queue(() => writers.transcripts.put(row));
    if (d.purpose === "participant") {
      const nb = notebookOf(d.input);
      if (nb !== undefined && lastNotebook.get(b.subject) !== nb) {
        lastNotebook.set(b.subject, nb);
        counts.notebooks++;
        queue(() => writers.notebooks.put({ schema: "notebook/1", run_key: rec.key, run: rec.id, t: e.t, day, seat: b.subject, model: `${d.provider}/${d.model}`, situation_id, notebook: nb }));
      }
    }
  };

  const sit = await situationsOf(rec.path, { run, keepCorpus: true, onEntry: take });
  await Promise.all(pending);

  // Situations: what each model turn of a seat read (system prompt by id).
  const situationOf = new Map<string, Situation>();
  for (const s of sit.situations) {
    situationOf.set(s.id, s);
    const system_id = await putSystem(s.system);
    counts.situations++;
    await writers.situations.put({ schema: "situation/1", id: s.id, run_key: rec.key, run: rec.id, seat: s.seat, day: s.day, n: s.n, turn: s.turn, model: s.model, system_id, shown: s.shown, ...(s.forms ? { forms: s.forms } : {}), ...(s.currency ? { currency: s.currency } : {}), ...(s.partial ? { partial: true } : {}), test: s.test });
  }

  // Seat requests: every request a seat made through `do`, joined to its translation and what became of it.
  const rows = new Map((sit.corpus ?? []).map((r) => [r.draft, r]));
  const askedBy = new Map<string, { s: Situation; a: Asked }>();
  for (const s of sit.situations) for (const a of s.requests) if (a.draft) askedBy.set(a.draft, { s, a });
  const testDays = new Set<string>();
  for (const s of sit.situations) if (s.test) testDays.add(`${s.seat}|${s.day}`);
  const emit = async (o: { s?: Situation; a?: Asked; x?: any; request: string; seat: string; day: number }) => {
    const { s, a, x } = o;
    const forms = a?.forms ?? s?.forms;
    const test_case = !!a?.test || ix.texts.has(norm(o.request)) || (x ? ix.drafts.has(`${folderName}|${x.draft}`) : false);
    const test_like = ix.starts.has(start60(o.request));
    const test_seat_day = testDays.has(`${o.seat}|${o.day}`) || isTestDay(ix, folderName, o.seat, o.day);
    const outcome = outcomeOf({ drafted: !!x, result: x?.result, decision: x?.signoff?.decision, executed: x?.executed });
    const system_id = x ? await putSystem(x.system) : undefined;
    counts.seat_requests++;
    if (test_case || test_like || test_seat_day) counts.seat_requests_test_flagged++;
    if (x) counts.translations++;
    await writers.seat_requests.put({
      schema: "seat_request/1", run_key: rec.key, run: rec.id, seat: o.seat, office: x?.as ?? null, model: s?.model ?? null, day: o.day, t: x?.t ?? null, situation_id: s?.id ?? null, turn: s?.turn ?? null,
      request: o.request, ...(forms ? { forms } : {}),
      draft_id: x?.draft ?? null,
      translation: x ? {
        translator_model: x.model ?? null, translator_version: x.translator?.version ?? null, system_id: system_id ?? null, synthetic: x.synthetic,
        route: slimRoute(x.route) ?? null, exchange: x.exchange, retries: x.retries, result: x.result, call: x.call ?? null, summary: x.summary ?? null, check: x.check ?? null,
        ...(x.caveats ? { caveats: x.caveats } : {}), ...(x.failure ? { failure: x.failure } : {}),
      } : null,
      decision: x?.signoff?.decision ?? null, decision_note: x?.signoff?.note ?? null,
      executed: x?.executed ? { applied: x.executed.applied, ...(x.executed.refusal ? { refusal: x.executed.refusal } : {}) } : null,
      outcome,
      test_case, test_like, test_seat_day, exclude_from_training: test_case || test_like || test_seat_day,
    });
  };
  for (const s of sit.situations) for (const a of s.requests) await emit({ s, a, x: a.draft ? rows.get(a.draft) : undefined, request: a.request, seat: s.seat, day: s.day });
  // Translations that no `do` of a situation accounts for (a participant that is not a model seat's turn: kept, with no situation).
  for (const x of rows.values()) {
    if (askedBy.has(x.draft) || x.synthetic) continue;
    await emit({ x, request: x.proposal ?? "", seat: x.participant, day: Math.floor(x.t / DAY) });
  }

  // Debriefs (published rows only; what a seat kept back is counted, never written) and exit accounts.
  const d = collector.finish();
  const { published, withheld } = debriefRows(d);
  for (const r of published) { counts.debriefs_published_rows++; await writers.debriefs.put({ schema: "debrief/1", run_key: rec.key, ...r }); }
  counts.debriefs_kept_back_rows = withheld.length;
  counts.debriefs_old_kind_kept_back = d.old.length;
  for (const r of accountRows(d)) { counts.exit_accounts++; await writers.exit_accounts.put({ schema: "exit_account/1", run_key: rec.key, ...r }); }

  const shards: RunResult["shards"] = {};
  for (const k of KINDS) { const w = writers[k]; const rows_ = w.count, ub = w.bytes; shards[k] = { rows: rows_, bytes_uncompressed: ub, bytes: await w.end() }; }
  const not_extracted: string[] = [];
  if (sit.no_system) not_extracted.push(`${sit.no_system} seat turns whose system prompt the log does not hold (their requests are kept, with no situation)`);
  if (d.words_apart_missing?.length) not_extracted.push(`words of the debrief of ${d.words_apart_missing.join(", ")} (the file beside the log is not there)`);
  if (counts.debriefs_kept_back_rows) not_extracted.push(`${counts.debriefs_kept_back_rows} debrief answers the seats asked to keep back (counted only)`);
  return {
    key: rec.key, rel: rec.rel, run_id: rec.id, folder: rec.folder, world, seed, seats: d.models, counts, test_cases_found: sit.tests_found, test_cases_missing: sit.tests_missing, unmatched_drafts: sit.unmatched_drafts, no_system: sit.no_system,
    raw_log_bytes: rec.bytes, shards, not_extracted, seconds: Math.round((Date.now() - t0) / 100) / 10,
  };
}

// ───────────────────────────── translator examples ─────────────────────────────

const SPLIT_ORDER = ["real_test", "test", "held_back", "validation_real", "validation", "train", "pool"] as const;
type Split = (typeof SPLIT_ORDER)[number];

/** Which split a file puts its rows in, from where and what it is called. */
export function splitOf(rel: string): Split {
  const n = basename(rel).replace(/\.jsonl$/, "");
  const parts = rel.split("/");
  if (/held-back/.test(n)) return "held_back";
  if (/^test-pilots|^tests?-|^tests?$/.test(n) || parts.includes("tests")) return "test";
  if (/validation-real/.test(n)) return "validation_real";
  if (/^validation/.test(n)) return "validation";
  if (/^train/.test(n)) return "train";
  return "pool";
}

/** The key of an example: the same request, the same forms and the same answer are one example. */
export const exampleKey = (r: { request: string; forms?: string[]; program?: string; gold?: string }) => sha(`${r.request}\0${(r.forms ?? []).join("\n")}\0${r.gold ?? r.program ?? ""}`);

const FIELDS = ["kind", "shape", "style", "spans", "written_by", "verified_by", "source", "origin", "currency", "part", "gold", "program", "forms", "note", "gap", "ignore", "as", "pilot"];

export interface ExampleRow {
  schema: "translator_example/1";
  key: string;
  request: string;
  forms: string[];
  program: string | null;
  gold: string | null;
  ids: string[];
  splits: string[];
  split: string;
  ever_in_train: boolean;
  files: string[];
  occurrences: number;
  [k: string]: unknown;
}

/** Whether a file's first row has the shape of a translator example (or a reject). */
export function sniff(path: string): "example" | "reject" | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const buf = Buffer.alloc(1 << 20);
    const n = readSync(fd, buf, 0, buf.length, 0);
    const line = buf.subarray(0, n).toString("utf8").split("\n")[0] ?? "";
    const r = JSON.parse(line);
    if (typeof r?.request !== "string") return undefined;
    if (typeof r.program === "string" || typeof r.gold === "string") return "example";
    if (r.answers && typeof r.why === "string") return "reject";
  } catch { /* (not JSON, or the first line is longer than a megabyte) */ } finally { if (fd !== undefined) closeSync(fd); }
  return undefined;
}

async function* jsonlRows(path: string): AsyncGenerator<{ row: any; line: number }> {
  let line = 0;
  for await (const l of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) {
    line++;
    if (!l.trim()) continue;
    try { yield { row: JSON.parse(l), line }; } catch { /* (a last line cut off) */ }
  }
}

export interface ExamplesResult { files: { rel: string; kind: string; split: string; rows: number; bytes: number }[]; examples: number; rejects: number; rows_read: number; real_test_cases: number; eval_cases: number; flagged_exclude: number; held_out_results_dropped: number; eval_results: number; bytes: number }

export async function extractExamples(runs: string, out: string, ix = testIndex()): Promise<ExamplesResult> {
  const dir = join(out, "translator");
  const files: ExamplesResult["files"] = [];
  const byKey = new Map<string, ExampleRow>();
  const rejects = new Map<string, any>();
  let rowsRead = 0;
  for (const p of walkFiles(runs)) {
    if (!p.endsWith(".jsonl") || SEED_LOG.test(p) || /calls\.jsonl$|\.anchors\.|\.debriefs\./.test(p)) continue;
    const kind = sniff(p);
    if (!kind) continue;
    const rel = relative(runs, p);
    const split = splitOf(rel);
    let n = 0;
    for await (const { row } of jsonlRows(p)) {
      if (typeof row.request !== "string") continue;
      n++;
      rowsRead++;
      if (kind === "reject") {
        const k = sha(`${row.request}\0${row.why}`);
        const r = rejects.get(k);
        if (r) { r.occurrences++; if (!r.files.includes(rel) && r.files.length < 40) r.files.push(rel); } else rejects.set(k, { schema: "translator_reject/1", key: k, request: row.request, why: row.why, detail: row.detail ?? null, answers: row.answers, ids: [row.id], from: row.from ?? null, files: [rel], occurrences: 1 });
        continue;
      }
      if (typeof row.program !== "string" && typeof row.gold !== "string") continue;
      const forms: string[] = Array.isArray(row.forms) ? row.forms : [];
      const key = exampleKey({ request: row.request, forms, program: row.program, gold: row.gold });
      let e = byKey.get(key);
      if (!e) {
        e = { schema: "translator_example/1", key, request: row.request, forms, program: row.program ?? null, gold: row.gold ?? null, ids: [], splits: [], split: split, ever_in_train: false, files: [], occurrences: 0 };
        byKey.set(key, e);
      }
      e.occurrences++;
      if (row.id !== undefined && !e.ids.includes(String(row.id)) && e.ids.length < 20) e.ids.push(String(row.id));
      if (!e.splits.includes(split)) e.splits.push(split);
      if (!e.files.includes(rel) && e.files.length < 40) e.files.push(rel);
      for (const f of FIELDS) if (row[f] !== undefined && e[f] === undefined) e[f] = row[f];
    }
    files.push({ rel, kind, split, rows: n, bytes: statSync(p).size });
  }
  // The real test cases and the seen evaluation cases of the repository (keys as the repository holds them).
  let flagged = 0;
  const finalise = (e: ExampleRow) => {
    e.splits.sort((a, b) => SPLIT_ORDER.indexOf(a as Split) - SPLIT_ORDER.indexOf(b as Split));
    e.split = e.splits[0]!;
    e.ever_in_train = e.splits.includes("train");
    const src = typeof e.source === "string" ? e.source : "";
    const m = /^([^/]+)\/([^/]+)\/d(\d+)\//.exec(src);
    const runBase = e.ids.map((i) => i.split("/")[0]).find(Boolean);
    const draftId = e.ids.find((i) => /\/draft\./.test(i));
    e.real_test_case = ix.texts.has(norm(e.request)) || (draftId !== undefined && ix.drafts.has(`${draftId.split("/")[0]}|${draftId.split("/").slice(1).join("/")}`)) || e.ids.some((i) => PILOT_CASES.some((c) => c.id === i));
    e.test_seat_day = !!m && isTestDay(ix, m[1]!, m[2]!, Number(m[3]));
    e.test_like = ix.starts.has(start60(e.request));
    e.exclude_from_training = !!(e.real_test_case || e.test_seat_day || e.test_like);
    void runBase;
    if (e.exclude_from_training) flagged++;
    return e;
  };
  mkdirSync(dir, { recursive: true });
  const ex = new Shard(join(dir, "examples.jsonl.zst"));
  for (const e of [...byKey.values()].sort((a, b) => (a.key < b.key ? -1 : 1))) await ex.put(finalise(e));
  const exBytes = await ex.end();
  const rj = new Shard(join(dir, "rejects.jsonl.zst"));
  for (const r of [...rejects.values()].sort((a, b) => (a.key < b.key ? -1 : 1))) await rj.put(r);
  const rjBytes = await rj.end();
  const cases = new Shard(join(dir, "cases.jsonl.zst"));
  for (const c of PILOT_CASES) await cases.put({ schema: "translator_case/1", set: "real", id: c.id, request: c.request, expect: c.expect, ignore: c.ignore ?? null, gap: c.gap ?? null, forms: c.forms ?? null, note: c.note ?? null, from: c.from, pilot: c.pilot, real_test_case: true, exclude_from_training: true });
  for (const c of CASES) await cases.put({ schema: "translator_case/1", set: "seen", id: c.id, request: c.request, expect: c.expect, ignore: c.ignore ?? null, as: c.as ?? null, was_held_out: !!c.was_held_out, note: c.note ?? null, real_test_case: false, exclude_from_training: false });
  await cases.end();
  // Evaluation results (a model's answers to the seen cases): a result of a held-out case is dropped, unread past its flag.
  const ev = new Shard(join(dir, "eval_results.jsonl.zst"));
  let dropped = 0, evRows = 0;
  for (const p of walkFiles(runs, runs, 0, 5)) {
    if (!/translator|eval|reader-comparison|live-check|^codex\//.test(relative(runs, p)) || !p.endsWith(".json")) continue;
    if (statSync(p).size > 50e6) continue;
    let j: any;
    try { j = JSON.parse(readFileSync(p, "utf8")); } catch { continue; }
    if (!j || typeof j.model !== "string" || !Array.isArray(j.results)) continue;
    for (const r of j.results) {
      if (r?.held_out === true || r?.held_out === "true") { dropped++; continue; }
      if (typeof r?.id !== "string") continue;
      evRows++;
      await ev.put({ schema: "translator_eval_result/1", file: relative(runs, p), model: j.model, id: r.id, pass: r.pass ?? null, got: r.got ?? null, expect: r.expect ?? null, ...(r.request ? { request: r.request } : {}) });
    }
  }
  await ev.end();
  return { files, examples: byKey.size, rejects: rejects.size, rows_read: rowsRead, real_test_cases: PILOT_CASES.length, eval_cases: CASES.length, flagged_exclude: flagged, held_out_results_dropped: dropped, eval_results: evRows, bytes: exBytes + rjBytes };
}

// ───────────────────────────── findings ─────────────────────────────

/** The run folders and run ids a text names, from the list of those that exist. */
export function citesIn(text: string, names: string[]): string[] {
  const hit = new Set<string>();
  for (const n of names) {
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(^|[^A-Za-z0-9_-])${esc}($|[^A-Za-z0-9_-])`).test(text)) hit.add(n);
  }
  return [...hit].sort();
}

/** A markdown document in sections (by `##` headings; text before the first heading is its own section). */
export function sections(md: string): { heading: string; level: number; text: string; line: number }[] {
  const out: { heading: string; level: number; text: string; line: number }[] = [];
  let cur: { heading: string; level: number; text: string[]; line: number } = { heading: "", level: 0, text: [], line: 1 };
  md.split("\n").forEach((l, i) => {
    const m = /^(#{1,3}) (.+)$/.exec(l);
    if (m && m[1]!.length <= 2) {
      out.push({ heading: cur.heading, level: cur.level, text: cur.text.join("\n").trim(), line: cur.line });
      cur = { heading: m[2]!.trim(), level: m[1]!.length, text: [], line: i + 1 };
    } else cur.text.push(l);
  });
  out.push({ heading: cur.heading, level: cur.level, text: cur.text.join("\n").trim(), line: cur.line });
  return out.filter((s) => s.heading || s.text);
}

export async function extractFindings(runs: string, repo: string, out: string): Promise<{ rows: number; reviews: number; status: number; decisions: number; cited_runs: number; bytes: number }> {
  // Names a finding can cite: run folders (any depth up to 2) and run ids, kept to names long enough to mean something.
  const names = new Set<string>();
  for (const d of readdirSync(runs)) {
    try { if (!statSync(join(runs, d)).isDirectory() || d.startsWith("archive-")) continue; } catch { continue; }
    names.add(d);
    try { for (const s of readdirSync(join(runs, d))) { try { if (statSync(join(runs, d, s)).isDirectory() && s.length >= 6 && !/^(measure|queues|tools|worlds|scratch|part\d+|read|out|data|logs|step\d)$/.test(s)) names.add(`${d}/${s}`); } catch { /* */ } } } catch { /* */ }
  }
  const list = [...names].filter((n) => n.length >= 4 && !/^(codex|calib|twin|data|queues|tools|worlds|scores|logs|models|scripts|pod)$/.test(n));
  const w = new Shard(join(out, "findings", "findings.jsonl.zst"));
  const c = { reviews: 0, status: 0, decisions: 0 };
  const cited = new Set<string>();
  const put = async (source: string, kind: string, heading: string, text: string, line: number) => {
    const cites = citesIn(`${heading}\n${text}`, list);
    for (const x of cites) cited.add(x);
    await w.put({ schema: "finding/1", kind, source, line, heading, text, cites });
  };
  const queues = join(runs, "pilot-queues");
  if (existsSync(queues)) for (const f of readdirSync(queues).sort()) {
    if (!f.endsWith(".review.md")) continue;
    const md = readFileSync(join(queues, f), "utf8");
    for (const s of sections(md)) { c.reviews++; await put(`runs/pilot-queues/${f}`, "pilot_review", s.heading, s.text, s.line); }
  }
  for (const p of walkFiles(runs, runs, 0, 3)) {
    const n = basename(p);
    if (n === "STATUS" || (/^(review|bughunt)-.*\.md$/.test(n) && dirname(p) === runs) || /^(PILOT\.txt|NOTE|README\.md|README\.txt)$/.test(n) && !p.includes("/translator-model/")) {
      if (statSync(p).size > 2e6) continue;
      const kind = n === "STATUS" ? "run_status" : n.endsWith(".md") ? "review_document" : "run_note";
      c.status++;
      await put(`runs/${relative(runs, p)}`, kind, n, readFileSync(p, "utf8"), 1);
    }
  }
  const dec = join(repo, "docs", "decisions.md");
  if (existsSync(dec)) for (const s of sections(readFileSync(dec, "utf8"))) {
    // (Only the entries that name a run.)
    if (!citesIn(`${s.heading}\n${s.text}`, list).length) continue;
    c.decisions++;
    await put("docs/decisions.md", "decision", s.heading, s.text, s.line);
  }
  const rows = w.count;
  const bytes = await w.end();
  return { rows, ...c, cited_runs: cited.size, bytes };
}

// ───────────────────────────── manifest ─────────────────────────────

const dirSize = (d: string): number => { let n = 0; for (const f of walkFiles(d, d, 0, 6)) n += statSync(f).size; return n; };

export async function writeManifest(runs: string, out: string, logs: LogRec[]): Promise<any> {
  const results: RunResult[] = [];
  const dir = join(out, "manifest");
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(join(out, ".done"), { withFileTypes: true }).filter((x) => x.name.endsWith(".json"))) results.push(JSON.parse(readFileSync(join(out, ".done", f.name), "utf8")));
  results.sort((a, b) => (a.key < b.key ? -1 : 1));
  const byKey = new Map(results.map((r) => [r.key, r]));
  const w = new Shard(join(dir, "runs.jsonl.zst"));
  const tot: any = { runs_extracted: 0, seat_requests: 0, translations: 0, situations: 0, transcripts: 0, notebooks: 0, debriefs_published_rows: 0, exit_accounts: 0, cost_microusd: 0, raw_log_bytes_of_extracted: 0, test_flagged_requests: 0 };
  for (const l of logs) {
    const r = byKey.get(l.key);
    if (r) {
      tot.runs_extracted++;
      tot.seat_requests += r.counts.seat_requests; tot.translations += r.counts.translations; tot.situations += r.counts.situations; tot.transcripts += r.counts.transcripts; tot.notebooks += r.counts.notebooks;
      tot.debriefs_published_rows += r.counts.debriefs_published_rows; tot.exit_accounts += r.counts.exit_accounts; tot.cost_microusd += r.counts.cost_microusd; tot.raw_log_bytes_of_extracted += r.raw_log_bytes; tot.test_flagged_requests += r.counts.seat_requests_test_flagged;
    }
    await w.put({ schema: "manifest_run/1", key: l.key, log: `runs/${l.rel}`, folder: l.folder, run_id: l.id, raw_log_bytes: l.bytes, classification: l.kind, why: l.why, copy_of: l.copy_of ?? null, extracted: r ?? null,
      not_extracted: r ? r.not_extracted : l.kind === "model" ? ["extraction did not complete"] : [l.kind === "code-only" ? "no model calls: nothing to extract (the log can be made again from git and the seed)" : l.why] });
  }
  await w.end();
  const kinds: any = {};
  for (const k of [...KINDS, "findings", "translator", "manifest"]) kinds[k] = existsSync(join(out, k)) ? dirSize(join(out, k)) : 0;
  const rawModel = logs.filter((l) => l.kind === "model").reduce((a, l) => a + l.bytes, 0);
  const manifest = {
    archive: ARCHIVE_NAME, version: ARCHIVE_VERSION, made: new Date().toISOString(), runs_folder: runs,
    logs_found: logs.length, by_classification: Object.fromEntries(["model", "code-only", "duplicate", "stopped", "not-a-log"].map((k) => [k, logs.filter((l) => l.kind === k).length])),
    model_runs_not_extracted: logs.filter((l) => l.kind === "model" && !byKey.has(l.key)).map((l) => l.rel),
    totals: tot, raw_model_run_logs_bytes: rawModel, archive_bytes_by_kind: kinds, archive_bytes: dirSize(out) - dirSize(join(out, ".done")),
    runs_folder_bytes: undefined as number | undefined,
  };
  writeFileSync(join(dir, "totals.json"), JSON.stringify(manifest, null, 1) + "\n");
  copyDoc(out);
  return manifest;
}

/** SCHEMA.md into the archive, from the repository's docs/archive-schema.md. */
export function copyDoc(out: string): void {
  const src = join(HERE, "..", "docs", "archive-schema.md");
  if (existsSync(src)) writeFileSync(join(out, "SCHEMA.md"), readFileSync(src, "utf8"));
  writeFileSync(join(out, "RESTRICTIONS.txt"), "debriefs/ and exit_accounts/ hold welfare evidence (VISION section 15): published debrief answers only, never an answer a seat asked to keep back. They are never training data, and no export of this archive for training may include them (docs/archive-schema.md, 'Restrictions'). Rows with exclude_from_training true (a real test case, a request that begins as one, a seat-day one comes from) are never training data either.\n");
}

// ───────────────────────────── verification ─────────────────────────────

/** A seeded generator (mulberry32), so a spot-check can be repeated. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export interface Check { run: string; ok: boolean; what: string; detail?: string }

/** A run's counts against its own reports (its pilot-report.json, summary.json, dataset). */
export function countChecks(r: RunResult, runs: string): Check[] {
  const checks: Check[] = [];
  const dir = join(runs, r.folder);
  const log = join(runs, r.rel);
  const read = (p: string) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return undefined; } };
  const summary = read(log.replace(/\.jsonl(\.zst)?$/, ".summary.json"));
  const report = read(join(dir, "pilot-report.json"));
  const add = (what: string, ok: boolean, detail?: string) => checks.push({ run: r.key, ok, what, ...(detail ? { detail } : {}) });
  if (summary && typeof summary.spentMicroUsd === "number") add("cost: sum of usage entries equals summary.spentMicroUsd", r.counts.cost_microusd === summary.spentMicroUsd, `${r.counts.cost_microusd} vs ${summary.spentMicroUsd}`);
  if (report?.cost?.model_calls !== undefined && report.run === r.run_id) add("model calls: usage entries equal the pilot report's cost.model_calls", r.counts.usage_entries - r.counts.mock_transcripts_left_out === report.cost.model_calls || r.counts.usage_entries === report.cost.model_calls, `${r.counts.usage_entries} (${r.counts.mock_transcripts_left_out} mock) vs ${report.cost.model_calls}`);
  const reqs = report?.translator_arrangement?.requests;
  if (typeof reqs === "number" && report.run === r.run_id) add("translations: equal the pilot report's translator_arrangement.requests", r.counts.translations === reqs, `${r.counts.translations} vs ${reqs}`);
  const ds = join(dir, `${r.run_id}.dataset`, "translations.jsonl");
  if (existsSync(ds) && statSync(ds).size < 2e9) {
    const n = readFileSync(ds, "utf8").split("\n").filter((l) => l && !JSON.parse(l).synthetic).length;
    add("translations: equal the run's own dataset translations.jsonl (non-synthetic)", r.counts.translations === n, `${r.counts.translations} vs ${n}`);
  }
  return checks;
}

export interface Spot { kind: string; where: string; item: string; ok: boolean; detail: string }

/** Is `needle` a line's worth of the JSON text of a string (escaped as JSON escapes it)? */
const jsonText = (s: string) => JSON.stringify(s).slice(1, -1);

/** Check items chosen at random against the raw logs and files they came from. */
export async function spotCheck(runs: string, out: string, repo: string, n: number, seed: number): Promise<Spot[]> {
  const rand = rng(seed);
  const done = readdirSync(join(out, ".done")).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(out, ".done", f), "utf8")) as RunResult);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const mix: [string, number][] = [["seat_request", Math.ceil(n * 0.3)], ["transcript", Math.ceil(n * 0.2)], ["notebook", Math.round(n * 0.1)], ["debrief", Math.round(n * 0.15)], ["example", Math.round(n * 0.15)], ["finding", n]];
  const plan: { kind: string; run?: RunResult; row: any }[] = [];
  const rowsOf = (r: RunResult, kind: string, dir: string) => (r.shards[dir]?.rows ? readShard(shardPath(out, dir, r.key)) : []);
  for (const [kind, k] of mix) {
    const dir = { seat_request: "seat_requests", transcript: "transcripts", notebook: "notebooks", debrief: "debriefs" }[kind];
    let tries = 0, got = 0;
    while (got < k && plan.length < n && tries++ < 200) {
      if (dir) {
        const r = pick(done.filter((x) => x.shards[dir]?.rows));
        if (!r) break;
        const rows = rowsOf(r, kind, dir).filter((x) => kind !== "debrief" || (x.answer !== undefined && !x.kept_back));
        if (!rows.length) continue;
        plan.push({ kind, run: r, row: pick(rows) });
        got++;
      } else if (kind === "example") {
        const rows = readShard(join(out, "translator", "examples.jsonl.zst"));
        plan.push({ kind, row: pick(rows) });
        got++;
      } else {
        const rows = readShard(join(out, "findings", "findings.jsonl.zst"));
        plan.push({ kind, row: pick(rows) });
        got++;
      }
    }
  }
  const results: Spot[] = [];
  const byRun = new Map<string, typeof plan>();
  for (const p of plan) if (p.run) (byRun.get(p.run.key) ?? byRun.set(p.run.key, []).get(p.run.key)!).push(p);
  for (const [key, items] of byRun) {
    const r = items[0]!.run!;
    const path = join(runs, r.rel);
    const found = new Map<(typeof items)[number], Spot>();
    const lastUsage = new Map<string, any>();
    const wantSeq = new Map<number, (typeof items)[number][]>();
    for (const it of items) if (it.kind === "transcript") (wantSeq.get(it.row.seq) ?? wantSeq.set(it.row.seq, []).get(it.row.seq)!).push(it);
    for await (const line of logLines(path)) {
      if (!line.includes('"annotation"')) continue;
      const isUsage = line.includes('"annotation":"usage"');
      const isTr = line.includes('"annotation":"transcript"');
      if (isUsage) { const e = JSON.parse(line); lastUsage.set(`${e.body.subject}|${e.body.purpose}`, e.body); continue; }
      for (const it of items) {
        if (found.has(it)) continue;
        const row = it.row;
        const where = `${r.rel}`;
        if (it.kind === "transcript" && isTr && line.includes(`"seq":${row.seq},`)) {
          const e = JSON.parse(line), d = e.body.data, u = lastUsage.get(`${e.body.subject}|${d.purpose}`);
          const same = e.t === row.t && e.body.subject === row.seat && d.purpose === row.purpose && d.turn === row.turn && (row.output === undefined || JSON.stringify(d.output) === JSON.stringify(row.output)) && (!u || !row.tokens || (u.cost_microusd === row.tokens.cost_microusd && u.output_tokens === row.tokens.output));
          found.set(it, { kind: "transcript", where, item: `${row.seat} seq ${row.seq} (${row.purpose})`, ok: same, detail: same ? "seq, time, seat, purpose, turn, output and tokens equal the raw entry" : "differs from the raw entry" });
        } else if (it.kind === "notebook" && isTr && line.includes(`"t":${row.t}}`) && line.includes(`"subject":"${row.seat}"`)) {
          const e = JSON.parse(line);
          if (e.t === row.t && e.body.subject === row.seat && notebookOf(e.body.data?.input) === row.notebook) found.set(it, { kind: "notebook", where, item: `${row.seat} day ${row.day}`, ok: true, detail: "equals the notebook at the top of the seat's raw input" });
        } else if (it.kind === "seat_request" && row.draft_id && line.includes(`"annotation":"draft"`) && line.includes(`"id":"${row.draft_id}"`)) {
          const e = JSON.parse(line), d = e.body.draft;
          if (d?.id === row.draft_id) {
            const ok = d.proposal === row.request && d.call === row.translation?.call && d.participant === row.seat;
            found.set(it, { kind: "seat_request", where, item: row.draft_id, ok, detail: ok ? "request, call and seat equal the raw draft" : "differs from the raw draft" });
          }
        } else if (it.kind === "seat_request" && !row.draft_id && isTr && line.includes(jsonText(row.request).slice(0, 60))) {
          const e = JSON.parse(line), d = e.body.data;
          if (e.body.subject === row.seat && Array.isArray(d.output) && d.output.some((u: any) => u?.name === "do" && u.input?.what === row.request)) found.set(it, { kind: "seat_request", where, item: `(never taken up) ${row.request.slice(0, 50)}`, ok: true, detail: "the request is in a raw `do` of the seat, with no draft" });
        } else if (it.kind === "debrief" && line.includes('"annotation":"debrief"') && line.includes(`"subject":"${row.seat}"`)) {
          // (The words are in the file beside the log where the log holds the interview without them.)
          const beside = path.replace(/\.jsonl(\.zst)?$/, ".debriefs.jsonl");
          const raw = line + (existsSync(beside) ? readFileSync(beside, "utf8") : "");
          const ok = raw.includes(jsonText(String(row.answer ?? row.question)));
          found.set(it, { kind: "debrief", where, item: `${row.seat} / ${row.step}`, ok, detail: ok ? "the published answer is in the run's raw debrief record" : "the answer was not found in the raw record" });
        }
      }
      if (found.size === items.length) break;
    }
    for (const it of items) results.push(found.get(it) ?? { kind: it.kind, where: r.rel, item: String(it.row.draft_id ?? it.row.seq ?? it.row.step ?? it.row.day), ok: false, detail: "not found in the raw log" });
    void key;
  }
  for (const it of plan.filter((p) => !p.run)) {
    if (it.kind === "example") {
      const file = join(runs, it.row.files[0]);
      let ok = false;
      for await (const { row } of jsonlRows(file)) if (row.request === it.row.request && (row.gold ?? row.program) === (it.row.gold ?? it.row.program)) { ok = true; break; }
      results.push({ kind: "example", where: it.row.files[0], item: it.row.request.slice(0, 60), ok, detail: ok ? "a raw line of the file has the same request and answer" : "no raw line matches" });
    } else {
      const f = it.row.source.startsWith("runs/") ? join(runs, it.row.source.slice(5)) : join(repo, it.row.source);
      const ok = existsSync(f) && (it.row.heading === "" || it.row.heading === basename(f) || readFileSync(f, "utf8").includes(it.row.heading));
      results.push({ kind: "finding", where: it.row.source, item: it.row.heading.slice(0, 60), ok, detail: ok ? "the heading is in the source file" : "heading not found in the source file" });
    }
  }
  return results;
}

// ───────────────────────────── command line ─────────────────────────────

function flag(args: string[], name: string, def?: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
}

async function cli(args: string[]) {
  const cmd = args[0];
  const runs = resolve(flag(args, "runs", DEFAULT_RUNS)!);
  const out = resolve(flag(args, "out", join(runs, ARCHIVE_NAME))!);
  const repo = resolve(HERE, "..");
  const cachePath = join(out, ".logs.json");
  const loadLogs = async (): Promise<LogRec[]> => {
    if (existsSync(cachePath) && !args.includes("--rescan")) return JSON.parse(readFileSync(cachePath, "utf8"));
    const logs = await discover(runs, { deep: args.includes("--deep") });
    mkdirSync(out, { recursive: true });
    writeFileSync(cachePath, JSON.stringify(logs));
    return logs;
  };
  if (cmd === "list") {
    const logs = await loadLogs();
    if (args.includes("--json")) return void console.log(JSON.stringify(logs, null, 1));
    for (const l of logs) console.log(`${l.kind.padEnd(10)} ${(l.bytes / 1e6).toFixed(0).padStart(7)} MB  ${l.rel}  (${l.why})`);
    const by = (k: string) => logs.filter((l) => l.kind === k);
    console.log(`\n${logs.length} logs: ${by("model").length} model runs (${(by("model").reduce((a, l) => a + l.bytes, 0) / 1e9).toFixed(1)} GB), ${by("code-only").length} code-only, ${by("duplicate").length} duplicates, ${by("stopped").length} stopped-history, ${by("not-a-log").length} not logs`);
  } else if (cmd === "one") {
    const path = resolve(args[1]!);
    const r = await extractLog({ path, rel: relative(runs, path), folder: relative(runs, dirname(path)), id: runOf(path), key: flag(args, "key", `${relative(runs, dirname(path))}/${runOf(path)}`.replace(/[^A-Za-z0-9._-]+/g, "__"))!, bytes: statSync(path).size }, out);
    mkdirSync(join(out, ".done"), { recursive: true });
    writeFileSync(join(out, ".done", `${r.key}.json`), JSON.stringify(r));
    console.log(JSON.stringify({ key: r.key, counts: r.counts, seconds: r.seconds }));
  } else if (cmd === "runs") {
    const maxMb = Number(flag(args, "max-mb", "1e9"));
    const logs = (await loadLogs()).filter((l) => l.kind === "model" && l.bytes <= maxMb * 1e6 && (!flag(args, "only") || new RegExp(flag(args, "only")!).test(l.rel)));
    const jobs = Number(flag(args, "jobs", "2"));
    mkdirSync(join(out, ".done"), { recursive: true });
    const todo = logs.filter((l) => !existsSync(join(out, ".done", `${l.key}.json`))).sort((a, b) => b.bytes - a.bytes);
    console.log(`${todo.length} of ${logs.length} model runs to do, ${jobs} at a time`);
    let next = 0;
    const worker = async () => {
      while (next < todo.length) {
        const l = todo[next++]!;
        const p = Bun.spawn(["bun", join(HERE, "extract-archive.ts"), "one", l.path, "--runs", runs, "--out", out, "--key", l.key], { stdout: "pipe", stderr: "pipe" });
        const [o, e] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
        const code = await p.exited;
        console.log(code === 0 ? `ok   ${l.rel} ${o.trim().slice(0, 200)}` : `FAIL ${l.rel} exit ${code}: ${e.slice(-600)}`);
      }
    };
    await Promise.all(Array.from({ length: jobs }, worker));
  } else if (cmd === "examples") {
    const r = await extractExamples(runs, out);
    mkdirSync(join(out, "manifest"), { recursive: true });
    writeFileSync(join(out, "manifest", "examples.json"), JSON.stringify(r, null, 1) + "\n", { flag: "w" });
    console.log(JSON.stringify({ ...r, files: r.files.length }));
  } else if (cmd === "findings") {
    const r = await extractFindings(runs, repo, out);
    mkdirSync(join(out, "manifest"), { recursive: true });
    writeFileSync(join(out, "manifest", "findings.json"), JSON.stringify(r, null, 1) + "\n");
    console.log(JSON.stringify(r));
  } else if (cmd === "manifest") {
    const m = await writeManifest(runs, out, await loadLogs());
    console.log(JSON.stringify(m, null, 1));
  } else if (cmd === "verify") {
    const results: RunResult[] = readdirSync(join(out, ".done")).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(out, ".done", f), "utf8")));
    const checks = results.flatMap((r) => countChecks(r, runs));
    const spot = await spotCheck(runs, out, repo, Number(flag(args, "spot", "20")), Number(flag(args, "seed", "20261017")));
    const found = results.reduce((a, r) => a + r.test_cases_found, 0);
    const v = { made: new Date().toISOString(), runs: results.length, count_checks: { total: checks.length, ok: checks.filter((c) => c.ok).length, failed: checks.filter((c) => !c.ok) }, test_cases: { in_repository: PILOT_CASES.length, found_in_runs_extracted: found, missing_by_run: results.filter((r) => r.test_cases_missing.length).map((r) => ({ run: r.key, missing: r.test_cases_missing.length })) }, spot_check: { items: spot.length, ok: spot.filter((x) => x.ok).length, seed: Number(flag(args, "seed", "20261017")), results: spot } };
    mkdirSync(join(out, "manifest"), { recursive: true });
    writeFileSync(join(out, "manifest", "verification.json"), JSON.stringify(v, null, 1) + "\n");
    console.log(JSON.stringify({ count_checks: { total: v.count_checks.total, ok: v.count_checks.ok }, failed: v.count_checks.failed, spot_check: { items: v.spot_check.items, ok: v.spot_check.ok }, spot_failed: spot.filter((x) => !x.ok) }, null, 1));
  } else {
    console.error("usage: extract-archive.ts list|one LOG|runs|examples|findings|manifest [--runs DIR] [--out DIR]");
    process.exit(2);
  }
}

if (import.meta.main) await cli(process.argv.slice(2));
