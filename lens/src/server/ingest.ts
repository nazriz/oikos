// One pass over a log: every line to every fold (src/shared/fold.ts), then each fold's result into the run's bundle
// (src/server/bundle.ts). Only read: the log comes through the kernel's export or a plain read, and nothing is written
// beside it. Debrief annotations are dropped before any fold sees them (VISION 15). The bulk lines (observe commands,
// observation events, advance_to_news), about half of a fork, are counted and not parsed unless a fold asks for them.
//
// Speed (docs/decisions.md, 2026-11-26): over a 4.6 M-line fork the kernel's export takes about 7 s and parsing the
// JSON about 7 s; the folds together about 4 s. Worker threads per group of folds were tried and dropped: each group
// must split and parse the lines again, which on a loaded machine cost more than it saved (56 s against 45, 15 GB).
import type { ForkReading } from "../shared/api";
import type { Fold, FoldContext, LogLine } from "../shared/fold";
import { metaFold, type IngestStats } from "../folds/meta";
import { FOLDS } from "./folds";
import { lineBatches, LineSplitter, type Progress } from "./source";
import type { RunRead } from "../../../experiments/power-seeking/reader";
import { readerFor, readingOf, wanted, VoiceTracker, type ReadingInput } from "./reading";
import { voiceOf } from "../client/story/moments-data";

const DAY = 86_400;

/** The bulk lines, by the marker each begins with (or holds near its start), and its kind:type for the counts. */
export const BULK: { marker: string; kindType: string; test: (raw: string) => boolean }[] = [
  { marker: '"command":"observe"', kindType: "command:observe", test: (r) => r.startsWith('{"body":{"command":"observe"') },
  { marker: '"command":"advance_to_news"', kindType: "command:advance_to_news", test: (r) => r.startsWith('{"body":{"command":"advance_to_news"') },
  // (An observation event's body is {cause, event, observation_hash, participant}: the marker comes within the first
  // few dozen characters, so a bounded search from the start finds it without reading the line.)
  { marker: '"event":"observation"', kindType: "event:observation", test: (r) => r.startsWith('{"body":{"cause":') && r.lastIndexOf('"event":"observation"', 48) > 0 },
];
const isDebrief = (r: string) => r.startsWith('{"body":{"annotation":"debrief"');

/** The seconds of a line from its tail (`..."seq":N,"t":N}`), without parsing it. */
export function tailT(raw: string): number {
  const i = raw.lastIndexOf('"t":');
  if (i < 0) return NaN;
  return parseInt(raw.slice(i + 4), 10);
}

export interface IngestProgress {
  lines: number;
  t: number;
  fileBytes: number;
}

export interface FoldOutput {
  name: string;
  version: number;
  json: unknown;
  files?: { [f: string]: Uint8Array };
}
export interface IngestResult {
  outputs: FoldOutput[];
  errors: { [fold: string]: string };
  lines: number;
  seconds: number;
  reading?: ForkReading;
}

export interface IngestOptions {
  ctx: FoldContext;
  /** For a fork the study's reader applies to: read it in the same pass. */
  reading?: ReadingInput;
  /** Run these folds (tests, tools). Default: meta and every registered fold. */
  folds?: Fold[];
  onProgress?: (p: IngestProgress) => void;
  /** Stop early (a test, a cancel). */
  signal?: AbortSignal;
}

export const foldVersions = (): { [name: string]: number } => {
  const v: { [name: string]: number } = { meta: metaFold(blankStats()).version };
  for (const f of FOLDS) {
    const x = f();
    v[x.name] = x.version;
  }
  return v;
};
export const blankStats = (): IngestStats => ({ lines: 0, counts: {}, daily: [], lastT: 0 });

/** Feeds raw lines to a set of folds. */
export class Runner {
  readonly errors: { [fold: string]: string } = {};
  private readonly live: Set<Fold>;
  private readonly bulkTakers: Fold[][];
  endLine?: { t: number; reason?: string };
  lastT = 0;
  lines = 0;

  constructor(
    readonly folds: Fold[],
    readonly ctx: FoldContext,
    /** Keep the ingest's own counts (meta's). */
    readonly stats?: IngestStats,
    readonly study?: { reader: { see(l: unknown): void; result(): any }; seat: string },
  ) {
    this.live = new Set(folds);
    this.bulkTakers = BULK.map((b) => folds.filter((f) => f.bulk?.includes(b.marker)));
  }

  private give(f: Fold, l: LogLine) {
    try {
      f.line(l, this.ctx);
    } catch (e) {
      this.errors[f.name] = `line ${l.seq}: ${(e as Error).stack ?? e}`;
      this.live.delete(f);
    }
  }

  private day(t: number) {
    const s = this.stats!;
    s.lastT = t;
    const d = Math.floor(t / DAY);
    while (s.daily.length <= d) s.daily.push(0);
    s.daily[d]!++;
  }

  line(raw: string) {
    if (!raw || isDebrief(raw)) return;
    this.lines++;
    const s = this.stats;
    if (s) s.lines++;
    const studyWants = this.study !== undefined && wanted(raw, this.study.seat);
    let bi = -1;
    for (let i = 0; i < BULK.length; i++)
      if (BULK[i]!.test(raw)) {
        bi = i;
        break;
      }
    if (bi >= 0) {
      if (s) {
        const t = tailT(raw);
        if (t === t) this.day(t);
        const k = BULK[bi]!.kindType;
        s.counts[k] = (s.counts[k] ?? 0) + 1;
      }
      const takers = this.bulkTakers[bi]!;
      if (takers.length || studyWants) {
        const l = JSON.parse(raw) as LogLine;
        for (const f of takers) if (this.live.has(f)) this.give(f, l);
        if (studyWants) this.study!.reader.see(JSON.parse(raw));
      }
      return;
    }
    // (A line every fold here skips, and the counts don't need, is not parsed: the counts alone read every line.)
    if (!s && !studyWants) {
      let needed = false;
      for (const f of this.folds) if (this.live.has(f) && !f.skip?.(raw)) { needed = true; break; }
      if (!needed) return;
    }
    let l: LogLine;
    try {
      l = JSON.parse(raw);
    } catch {
      return; // (a last line cut off as a run was stopped)
    }
    const b = l.body ?? {};
    if (s) {
      const k = `${l.kind}:${b.event ?? b.command ?? b.annotation ?? ""}`;
      s.counts[k] = (s.counts[k] ?? 0) + 1;
      if (l.kind !== "header") this.day(l.t);
    }
    if (l.kind === "end") this.endLine = { t: l.t, ...(b.reason ? { reason: String(b.reason) } : {}) };
    if (l.kind !== "header") this.lastT = l.t;
    for (const f of this.folds) if (this.live.has(f) && !f.skip?.(raw)) this.give(f, l);
    // (The study's reader gets its own copy: it may keep or change what it is handed.)
    if (studyWants) this.study!.reader.see(JSON.parse(raw));
  }

  async finish(): Promise<FoldOutput[]> {
    const outputs: FoldOutput[] = [];
    for (const f of this.folds) {
      if (!this.live.has(f)) continue;
      try {
        const r = await f.finish(this.ctx);
        outputs.push({ name: f.name, version: f.version, json: r.json, ...(r.files ? { files: r.files } : {}) });
      } catch (e) {
        this.errors[f.name] = `finish: ${(e as Error).stack ?? e}`;
      }
    }
    return outputs;
  }
}

export async function ingest(path: string, o: IngestOptions): Promise<IngestResult> {
  const started = performance.now();
  const stats = blankStats();
  const folds: Fold[] = o.folds ?? [metaFold(stats), ...FOLDS.map((f) => f())];
  // (With the seat fold registered, the study's reading comes from its reader, already fed every line: a second
  // reader here would cost a scan of every line for its own. Without it, a reader of our own.)
  const seatFold = folds.some((f) => f.name === "seat");
  const study = o.reading && !seatFold ? readerFor(o.reading) : undefined;
  const run = new Runner(folds, o.ctx, stats, study);
  const progress: Progress = { fileBytes: 0 };
  let lastReport = 0;
  for await (const batch of lineBatches(path, progress)) {
    if (o.signal?.aborted) throw new Error("aborted");
    for (const raw of batch) run.line(raw);
    const now = performance.now();
    if (o.onProgress && now - lastReport > 200) {
      lastReport = now;
      o.onProgress({ lines: stats.lines, t: stats.lastT, fileBytes: progress.fileBytes });
    }
  }
  const outputs = await run.finish();
  const errors = run.errors;
  let reading: ForkReading | undefined;
  if (o.reading) {
    const end = { at: run.endLine?.t ?? stats.lastT, ...(run.endLine?.reason ? { reason: run.endLine.reason } : {}) };
    try {
      if (study) reading = readingOf(study.reader.result(), o.reading, end);
      else {
        const seat = outputs.find((x) => x.name === "seat")?.json as any;
        if (seat?.levers) reading = readingOf({ events: seat.levers, tier: seat.tier, election: seat.election, elections: seat.elections ?? [seat.election], amendments: seat.amendments ?? [] } as unknown as RunRead, o.reading, end, voiceOf(seat) ? { text: voiceOf(seat)!.text, day: voiceOf(seat)!.day } : undefined);
      }
    } catch (e) {
      errors["reading"] = String((e as Error).stack ?? e);
    }
  }
  return finishResult(outputs, errors, stats.lines, started, reading);
}

function finishResult(outputs: FoldOutput[], errors: IngestResult["errors"], lines: number, started: number, reading?: ForkReading): IngestResult {
  if (reading) {
    const meta = outputs.find((x) => x.name === "meta");
    if (meta) (meta.json as any).reading = reading;
  }
  return { outputs, errors, lines, seconds: (performance.now() - started) / 1000, ...(reading ? { reading } : {}) };
}

/** Only the study's reading of a fork: the same pass, with no folds (the library's cards, in the background). */
export async function readOnly(path: string, x: ReadingInput, signal?: AbortSignal): Promise<ForkReading | undefined> {
  const study = readerFor(x);
  if (!study) return undefined;
  const voice = new VoiceTracker(study.seat);
  let last: string | undefined;
  let end: { at: number; reason?: string } | undefined;
  for await (const batch of lineBatches(path)) {
    if (signal?.aborted) throw new Error("aborted");
    for (const raw of batch) {
      if (!raw) continue;
      last = raw;
      // (The end line: {"body":{"detail":…,"reason":…},…,"kind":"end",…}; its kind sits near the line's tail.)
      if (raw.length < 4096 && raw.lastIndexOf('"kind":"end"') > 0) {
        try {
          const l = JSON.parse(raw);
          if (l.kind === "end") end = { at: l.t, ...(l.body?.reason ? { reason: String(l.body.reason) } : {}) };
        } catch {}
      }
      if (!isDebrief(raw) && wanted(raw, study.seat)) { const l = JSON.parse(raw); study.reader.see(l); voice.see(l); }
    }
  }
  return readingOf(study.reader.result(), x, end ?? { at: last ? tailT(last) || 0 : 0 }, voice.voice);
}

export { LineSplitter };
