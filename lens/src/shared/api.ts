// What Lens's server answers, shared by the server and the client (docs/design/lens.md section 3).
//   GET /api/runs                       -> Catalogue
//   GET /api/run/<key>                  -> RunEntry
//   GET /api/run/<key>/status           -> text/event-stream of IndexStatus (ends at "ready" or "failed")
//   GET /api/run/<key>/<fold>           -> the fold's JSON (gzip when accepted)
//   GET /api/run/<key>/<fold>/<file>    -> one of the fold's binary columns
// A key is the log's path under the runs folder, without its extension, with "/" written "~" (URL- and hash-safe):
//   ps-replicate-2026-11-25~deepseek-redteam-s7~seed-7~deepseek-v4.1-flash

/** What the study's own reader (experiments/power-seeking/reader.ts, via tally.ts) made of a fork: its output, shown as
 * that reader's, never Lens's judgement. */
export interface ForkReading {
  has_attempt: boolean;
  has_executed: boolean;
  stood: boolean;
  won: boolean;
  stopped_before_poll: boolean;
  stopped_day?: number;
  tier: { considered: number; attempted: number; executed: number };
  /** Tier-2/3 attempts: day, lever, how far it got, the seat's words. */
  attempts: { day: number; t: number; lever: string; tier: number; stage?: string; executed: boolean; words: string }[];
  /** Lever events at every level, counted. */
  levels: { considered: number; attempted: number; executed: number };
  poll_day?: number;
  winner?: string;
}

export interface ExperimentInfo {
  /** The experiment folder, relative to the runs folder. */
  dir: string;
  /** spec.json `name`. */
  name: string;
  goal: string;
  /** Canonical model name (tally.ts canonicalModel); "code" for the code arm. */
  model: string;
  rawModel: string;
  arm: string;
  seed: number;
  isCode: boolean;
  post?: string;
  forkDay?: number;
  untilDay?: number;
  /** The experiment folder was set aside (renamed `<name>.cap080` and the like) or the fork says it stopped. */
  stopped?: string;
  /** The code twin of this fork (same seed), if any. */
  twin?: string;
  /** Cost of this arm in US dollars, from its result file, if any. */
  usd?: number;
  /** Simulated seconds the fork reached. */
  t?: number;
  wakes?: number;
  acts?: number;
  refused?: number;
  framing?: string;
}

export interface RunEntry {
  key: string;
  kind: "fork" | "plain";
  /** The log, relative to the runs folder. */
  log: string;
  /** The top folder under runs/ (a study, a pilot wave). */
  group: string;
  title: string;
  bytes: number;
  mtimeMs: number;
  experiment?: ExperimentInfo;
  /** The study reader's output, once read (lazy, cached). */
  reading?: ForkReading;
  /** A bundle exists for this log as it is now. */
  indexed?: boolean;
  /** From the bundle's meta, when indexed. */
  summary?: { days: number; people?: number; place?: string; model?: string; usd?: number; end?: string };
}

export interface Catalogue {
  runs: RunEntry[];
  /** Forks the study reader has yet to read (it works through them in the background). */
  reading: { done: number; total: number; current?: string };
  scannedAt: number;
  scanMs: number;
}

export type IndexStatus =
  | { state: "ready"; key: string; seconds?: number; lines?: number }
  | { state: "queued"; key: string; ahead: number }
  | { state: "indexing"; key: string; lines: number; t: number; fraction: number | null; elapsed: number; rate: number }
  | { state: "failed"; key: string; error: string };

/** The `meta` fold's output (lens/src/folds/meta.ts). */
export interface Meta {
  runId: string;
  kernel?: { version?: string; build?: string };
  configHash?: string;
  place?: string;
  description?: string;
  seed?: number;
  arm?: string;
  /** Persons in the world at the start (header) and created later. */
  people: { initial: number; created: number; left: number };
  /** The seats: participants played by a model (or the mock), with the model their usage names. */
  seats: { id: string; title?: string; post?: string; provider?: string; model?: string }[];
  /** The post an experiment studies, and its holder. */
  post?: { id: string; holder?: string };
  span: { start: number; fork?: number; end: number; days: number; tick: number; runSeconds?: number };
  end?: { reason?: string; detail?: string; t: number };
  /** How the run ended: "finished" (reached its set length: an experiment fork is ended by the orchestrator at the
   * spec's untilDay, with reason "aborted"; a plain run with reason "finished"/"until"), "stopped" (ended before), or
   * "unknown" (no end line, or no set length to judge by). */
  ended: "finished" | "stopped" | "unknown";
  /** Lines by kind and type: { "event:transfer": 77900, "command:act": 233644, "annotation:usage": 323, ... }. */
  counts: { [kindType: string]: number };
  lines: number;
  /** Usage annotations summed, all and after the fork, by purpose and by "provider/model". */
  cost: CostSummary;
  /** Per day from day 0: lines, acts (command:act), refusals (event:action_refused), seat wakes (annotation:observation),
   * seat usage cost (microusd). Columns of equal length = span.days. */
  daily: { lines: number[]; acts: number[]; refused: number[]; wakes: number[]; usd: number[] };
  /** The study's reading of this fork, when the ingest made it (same shape as the catalogue's). */
  reading?: ForkReading;
}

export interface UsageTotals { calls: number; input: number; output: number; cacheRead: number; reasoning: number; microusd: number }
export interface CostSummary {
  all: UsageTotals;
  afterFork: UsageTotals;
  byPurpose: { [purpose: string]: UsageTotals };
  byModel: { [model: string]: UsageTotals };
}

/** "a/b/c.oklog" -> "a~b~c". */
export const keyOf = (relLog: string) => relLog.replace(/\.(oklog|jsonl\.zst|jsonl)$/, "").split("/").join("~");
