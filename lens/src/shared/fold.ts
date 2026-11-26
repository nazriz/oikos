// The one contract every slice of Lens's data layer meets. A run's log is read exactly once (the kernel's export of an
// .oklog, or a .jsonl / .jsonl.zst through orchestrator/src/logs.ts `logLines`), and every line is handed to every
// fold in turn. Each fold keeps only what its view needs and, at the end, returns a JSON-able value that the ingest
// writes to the run's bundle as `<fold name>.json` (or, for big columnar data, `files` of raw bytes beside it).
//
// Folds never write anywhere themselves and never see the run's folder: the ingest owns all I/O (Lens is read-only;
// docs/design/lens.md section 2). A fold must be cheap per line: 5 million lines go through every fold.

/** One parsed log line, as the kernel writes it (contracts/ log format). `body` is the event, command or annotation. */
export interface LogLine {
  seq: number;
  /** Seconds since the run began. */
  t: number;
  kind: "header" | "event" | "command" | "annotation" | "checkpoint" | "end" | string;
  body: any;
}

/** What the ingest knows about the run before the first line: where it came from, for folds that want it. */
export interface FoldContext {
  /** The run's id (the header's run_id once read). */
  runId: string;
  /** For an experiment fork: the arm's name ("deepseek-v4.1-flash", "code"); undefined for a plain run. */
  arm?: string;
  /** The folder the log is in (read-only; folds must not open it: the ingest passes what they need). */
  dir: string;
}

export interface FoldResult {
  /** Written as `<name>.json` in the bundle; the client reads it from `/api/run/<key>/<name>`. */
  json: unknown;
  /** Extra binary files (typed-array columns), written as `<name>.<file>.bin`, served at `/api/run/<key>/<name>/<file>`. */
  files?: { [file: string]: Uint8Array };
}

export interface Fold {
  /** A short, stable name: "town", "people", "seat", "pulse"... Also the bundle file's name. */
  readonly name: string;
  /** Bump when the fold's output changes shape: a bundle made by an older version is made again. */
  readonly version: number;
  /** Every line, header first, in seq order. */
  line(l: LogLine, ctx: FoldContext): void;
  /** After the last line. */
  finish(ctx: FoldContext): FoldResult | Promise<FoldResult>;
}

/** Folds are registered here by their owners (one import each), so the ingest runs them all in one pass. */
export type FoldFactory = () => Fold;
