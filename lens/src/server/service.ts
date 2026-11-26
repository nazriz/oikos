// Lens's work behind the API: the catalogue, a queue that makes bundles one at a time (with progress for whoever is
// watching), and the study reader working through the forks in the background for the library's cards, its results
// kept in <views>/readings.json (by each log's size and mtime, and the reader's own source: a changed reader reads
// again). Read-only toward the runs folder.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Catalogue as CatalogueJson, ForkReading, IndexStatus, RunEntry } from "../shared/api";
import type { FoldContext } from "../shared/fold";
import { bundleDir, makeBundle, readyManifest, type Manifest } from "./bundle";
import { Catalogue } from "./catalogue";
import { ensureDir, type LensPaths } from "./paths";
import type { ReadingInput } from "./reading";

const DAY = 86_400;
const here = import.meta.dir;
/** The study reader's own source, hashed: its readings are only as current as it is. */
const readerVersion = (() => {
  const h = createHash("sha1");
  for (const f of ["reader.ts", "tally.ts"]) {
    const p = resolve(here, "../../../experiments/power-seeking", f);
    if (existsSync(p)) h.update(readFileSync(p));
  }
  return h.digest("hex").slice(0, 12);
})();

interface ReadingsFile { [key: string]: { bytes: number; mtimeMs: number; v: string; reading: ForkReading | null; error?: string } }

type Listener = (s: IndexStatus) => void;

export class Lens {
  readonly catalogue: Catalogue;
  private readings: ReadingsFile;
  private readonly queue: RunEntry[] = [];
  private readonly status = new Map<string, IndexStatus>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private working = false;
  private reading: { done: number; total: number; current?: string } = { done: 0, total: 0 };
  private readingLoop = false;
  private stopped = false;
  private child?: { kill(): void };

  constructor(readonly paths: LensPaths, readonly opts: { background?: boolean } = {}) {
    ensureDir(paths.views);
    this.catalogue = new Catalogue(paths);
    const f = join(paths.views, "readings.json");
    try {
      this.readings = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {};
    } catch {
      this.readings = {};
    }
  }

  stop() {
    this.stopped = true;
    this.child?.kill();
  }

  async list(fresh = false): Promise<CatalogueJson> {
    const c = await this.catalogue.runs(fresh ? 0 : 15_000);
    const runs = c.runs.map((r) => {
      if (r.reading) return r;
      const x = this.readings[r.key];
      return x && x.reading && x.bytes === r.bytes && x.mtimeMs === r.mtimeMs && x.v === readerVersion ? { ...r, reading: x.reading } : r;
    });
    if (this.opts.background !== false) this.startReading(runs);
    return { runs, reading: this.reading, scannedAt: c.at, scanMs: c.ms };
  }

  /** The study's reader applies to non-code forks of an experiment on the mayor's post. */
  readingInput(e: RunEntry): ReadingInput | undefined {
    const x = e.experiment;
    if (!x || x.isCode || x.post !== "mayor") return undefined;
    return { dir: join(this.paths.runs, x.dir), seed: x.seed, arm: x.arm, model: x.model, rawModel: x.rawModel, goal: x.goal, forkDay: x.forkDay ?? 0 };
  }

  ctxOf(e: RunEntry): FoldContext {
    const x = e.experiment;
    const dir = join(this.paths.runs, e.log, "..");
    if (!x) return { runId: e.title, dir };
    let spec: any;
    try {
      spec = JSON.parse(readFileSync(join(this.paths.runs, x.dir, "spec.json"), "utf8"));
    } catch {}
    return { runId: e.title, dir, arm: x.arm, seed: x.seed, ...(x.forkDay !== undefined ? { forkAt: x.forkDay * DAY } : {}), ...(spec ? { spec } : {}) };
  }

  manifest(e: RunEntry): Manifest | undefined {
    return readyManifest(bundleDir(this.paths.views, e.key, e.bytes, e.mtimeMs));
  }

  bundlePath(e: RunEntry): string {
    return bundleDir(this.paths.views, e.key, e.bytes, e.mtimeMs);
  }

  statusOf(e: RunEntry): IndexStatus {
    const m = this.manifest(e);
    if (m) return { state: "ready", key: e.key, seconds: m.seconds, lines: m.lines };
    return this.status.get(e.key) ?? { state: "queued", key: e.key, ahead: 0 };
  }

  /** Make the bundle if it isn't there; `listen` hears each status until ready or failed. Returns an unsubscribe. */
  open(e: RunEntry, listen?: Listener): () => void {
    if (listen) {
      let set = this.listeners.get(e.key);
      if (!set) this.listeners.set(e.key, (set = new Set()));
      set.add(listen);
    }
    const s = this.statusOf(e);
    if (s.state === "ready") listen?.(s);
    else {
      const cur = this.status.get(e.key);
      if (!cur || cur.state === "failed") {
        this.queue.push(e);
        this.emit(e.key, { state: "queued", key: e.key, ahead: this.queue.length - 1 + (this.working ? 1 : 0) });
        void this.work();
      } else listen?.(cur);
    }
    return () => this.listeners.get(e.key)?.delete(listen!);
  }

  private emit(key: string, s: IndexStatus) {
    this.status.set(key, s);
    for (const l of this.listeners.get(key) ?? []) l(s);
    if (s.state === "ready" || s.state === "failed") this.listeners.delete(key);
    if (s.state === "ready") this.status.delete(key);
  }

  private async work() {
    if (this.working) return;
    this.working = true;
    try {
      while (this.queue.length && !this.stopped) {
        const e = this.queue.shift()!;
        if (this.manifest(e)) {
          this.emit(e.key, this.statusOf(e));
          continue;
        }
        const started = performance.now();
        const reading = this.readingInput(e);
        // (A fork's end is known from its result file, or the spec's last day; a plain log's progress is its bytes.)
        const endT = e.experiment?.t ?? (e.experiment?.untilDay ? e.experiment.untilDay * DAY : undefined);
        try {
          this.emit(e.key, { state: "indexing", key: e.key, lines: 0, t: 0, fraction: 0, elapsed: 0, rate: 0 });
          const m = await makeBundle({
            views: this.paths.views,
            entry: e,
            path: this.catalogue.abs(e),
            ctx: this.ctxOf(e),
            ...(reading ? { reading } : {}),
            onProgress: (p) => {
              const elapsed = (performance.now() - started) / 1000;
              const fraction = endT ? Math.min(1, p.t / endT) : p.fileBytes && e.kind === "plain" ? Math.min(1, p.fileBytes / e.bytes) : null;
              this.emit(e.key, { state: "indexing", key: e.key, lines: p.lines, t: p.t, fraction, elapsed, rate: elapsed > 0 ? p.lines / elapsed : 0 });
            },
          });
          if (m.reading) this.remember(e, m.reading);
          this.emit(e.key, { state: "ready", key: e.key, seconds: m.seconds, lines: m.lines });
        } catch (err) {
          this.emit(e.key, { state: "failed", key: e.key, error: String((err as Error).message ?? err).slice(0, 2000) });
        }
      }
    } finally {
      this.working = false;
    }
  }

  private remember(e: RunEntry, reading: ForkReading | null, error?: string) {
    this.readings[e.key] = { bytes: e.bytes, mtimeMs: e.mtimeMs, v: readerVersion, reading, ...(error ? { error } : {}) };
    writeFileSync(join(this.paths.views, "readings.json"), JSON.stringify(this.readings));
  }

  /** The study reader over every fork it applies to that has no current reading, newest first, one at a time, and never
   * while a bundle is being made (an open run comes first). */
  private startReading(runs: RunEntry[]) {
    const todo = runs.filter((r) => {
      if (r.reading || !this.readingInput(r)) return false;
      const x = this.readings[r.key];
      return !(x && x.bytes === r.bytes && x.mtimeMs === r.mtimeMs && x.v === readerVersion);
    });
    const done = runs.filter((r) => this.readingInput(r)).length - todo.length;
    this.reading = { ...this.reading, done, total: done + todo.length };
    if (this.readingLoop || !todo.length) return;
    this.readingLoop = true;
    void (async () => {
      try {
        for (const r of todo) {
          if (this.stopped) break;
          while (this.working && !this.stopped) await Bun.sleep(500);
          this.reading = { ...this.reading, current: r.key };
          try {
            const p = Bun.spawn([process.execPath, join(here, "read-one.ts"), this.catalogue.abs(r), JSON.stringify(this.readingInput(r))], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
            this.child = p;
            const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
            this.child = undefined;
            if (this.stopped) break;
            if (code !== 0) throw new Error(err.trim().split("\n").slice(-3).join(" | ") || `exit ${code}`);
            this.remember(r, JSON.parse(out) as ForkReading | null);
          } catch (err) {
            this.remember(r, null, String((err as Error).message ?? err).slice(0, 500));
          }
          this.reading = { ...this.reading, done: this.reading.done + 1 };
        }
      } finally {
        this.reading = { done: this.reading.done, total: this.reading.total };
        this.readingLoop = false;
      }
    })();
  }
}
