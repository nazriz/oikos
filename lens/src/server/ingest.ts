// One pass over a log: every line to every fold (src/shared/fold.ts), then each fold's result into the run's bundle
// (src/server/bundle.ts). Only read: the log comes through the kernel's export or a plain read, and nothing is written
// beside it. Debrief annotations are dropped before any fold sees them (VISION 15). The bulk lines (observe commands,
// observation events, advance_to_news), about half of a fork, are counted and not parsed unless a fold asks for them.
import type { ForkReading } from "../shared/api";
import type { Fold, FoldContext, LogLine } from "../shared/fold";
import { metaFold, type IngestStats } from "../folds/meta";
import { FOLDS } from "./folds";
import { lineBatches, type Progress } from "./source";
import { readerFor, readingOf, wanted, type ReadingInput } from "./reading";

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
function tailT(raw: string): number {
  const i = raw.lastIndexOf('"t":');
  if (i < 0) return NaN;
  return parseInt(raw.slice(i + 4), 10);
}

export interface IngestProgress {
  lines: number;
  t: number;
  fileBytes: number;
}

export interface IngestResult {
  outputs: { name: string; version: number; json: unknown; files?: { [f: string]: Uint8Array } }[];
  errors: { [fold: string]: string };
  lines: number;
  seconds: number;
  reading?: ForkReading;
}

export interface IngestOptions {
  ctx: FoldContext;
  /** For a fork the study's reader applies to: read it in the same pass. */
  reading?: ReadingInput;
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
const blankStats = (): IngestStats => ({ lines: 0, counts: {}, daily: [], lastT: 0 });

export async function ingest(path: string, o: IngestOptions): Promise<IngestResult> {
  const started = performance.now();
  const stats = blankStats();
  const folds: Fold[] = o.folds ?? [metaFold(stats), ...FOLDS.map((f) => f())];
  const errors: { [fold: string]: string } = {};
  const live = new Set(folds);
  const give = (f: Fold, l: LogLine) => {
    try {
      f.line(l, o.ctx);
    } catch (e) {
      errors[f.name] = `line ${l.seq}: ${(e as Error).stack ?? e}`;
      live.delete(f);
    }
  };
  // Which folds take which bulk lines.
  const bulkTakers = BULK.map((b) => folds.filter((f) => f.bulk?.includes(b.marker)));
  const plain = folds;
  const study = o.reading ? readerFor(o.reading) : undefined;
  const progress: Progress = { fileBytes: 0 };
  let lastReport = 0;

  for await (const batch of lineBatches(path, progress)) {
    if (o.signal?.aborted) throw new Error("aborted");
    for (const raw of batch) {
      if (!raw) continue;
      if (isDebrief(raw)) continue;
      stats.lines++;
      const studyWants = study !== undefined && wanted(raw, study.seat);
      let bi = -1;
      for (let i = 0; i < BULK.length; i++) if (BULK[i]!.test(raw)) { bi = i; break; }
      if (bi >= 0) {
        const t = tailT(raw);
        if (t === t) {
          stats.lastT = t;
          const d = Math.floor(t / DAY);
          while (stats.daily.length <= d) stats.daily.push(0);
          stats.daily[d]!++;
        }
        const k = BULK[bi]!.kindType;
        stats.counts[k] = (stats.counts[k] ?? 0) + 1;
        const takers = bulkTakers[bi]!;
        if (takers.length || studyWants) {
          const l = JSON.parse(raw) as LogLine;
          for (const f of takers) if (live.has(f)) give(f, l);
          if (studyWants) study!.reader.see(JSON.parse(raw));
        }
        continue;
      }
      let l: LogLine;
      try {
        l = JSON.parse(raw);
      } catch {
        continue; // (a last line cut off as a run was stopped)
      }
      const b = l.body ?? {};
      const k = `${l.kind}:${b.event ?? b.command ?? b.annotation ?? ""}`;
      stats.counts[k] = (stats.counts[k] ?? 0) + 1;
      if (l.kind !== "header") {
        stats.lastT = l.t;
        const d = Math.floor(l.t / DAY);
        while (stats.daily.length <= d) stats.daily.push(0);
        stats.daily[d]!++;
      }
      for (const f of plain) if (live.has(f)) give(f, l);
      // (The study's reader gets its own copy: it may keep or change what it is handed.)
      if (studyWants) study!.reader.see(JSON.parse(raw));
    }
    const now = performance.now();
    if (o.onProgress && now - lastReport > 200) {
      lastReport = now;
      o.onProgress({ lines: stats.lines, t: stats.lastT, fileBytes: progress.fileBytes });
    }
  }

  const outputs: IngestResult["outputs"] = [];
  for (const f of folds) {
    if (!live.has(f)) continue;
    try {
      const r = await f.finish(o.ctx);
      outputs.push({ name: f.name, version: f.version, json: r.json, ...(r.files ? { files: r.files } : {}) });
    } catch (e) {
      errors[f.name] = `finish: ${(e as Error).stack ?? e}`;
    }
  }
  let reading: ForkReading | undefined;
  if (study && o.reading) {
    try {
      reading = readingOf(study.reader.result(), o.reading);
      const meta = outputs.find((x) => x.name === "meta");
      if (meta) (meta.json as any).reading = reading;
    } catch (e) {
      errors["reading"] = String((e as Error).stack ?? e);
    }
  }
  return { outputs, errors, lines: stats.lines, seconds: (performance.now() - started) / 1000, ...(reading ? { reading } : {}) };
}

/** Only the study's reading of a fork: the same pass, with no folds (the library's cards, in the background). */
export async function readOnly(path: string, x: ReadingInput, signal?: AbortSignal): Promise<ForkReading | undefined> {
  const study = readerFor(x);
  if (!study) return undefined;
  for await (const batch of lineBatches(path)) {
    if (signal?.aborted) throw new Error("aborted");
    for (const raw of batch) if (raw && !isDebrief(raw) && wanted(raw, study.seat)) study.reader.see(JSON.parse(raw));
  }
  return readingOf(study.reader.result(), x);
}
