// Lens's work behind the API: the catalogue, a queue that makes bundles one at a time (with progress for whoever is
// watching), and the study reader working through the forks in the background for the library's cards, its results
// kept in <views>/readings.json (by each log's size and mtime, and the reader's own source: a changed reader reads
// again). Read-only toward the runs folder.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Catalogue as CatalogueJson, ForkReading, IndexStatus, RunEntry } from "../shared/api";
import type { FoldContext } from "../shared/fold";
import { bundleDir, readyManifest, type Manifest } from "./bundle";
import type { IngestProgress } from "./ingest";
import { Catalogue } from "./catalogue";
import { ensureDir, type LensPaths } from "./paths";
import type { ReadingInput } from "./reading";

const DAY = 86_400;
const here = import.meta.dir;
/** The study reader's own source, hashed: its readings are only as current as it is. */
const readerVersion = (() => {
  const h = createHash("sha1");
  h.update("lens-reading-3"); // (Lens's own shape of a reading: bump when ForkReading changes.)
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
  /** Runs made ahead of being asked for (the showcase: forks whose seat tried a lever), after anything asked for. */
  private readonly ahead: RunEntry[] = [];
  private readonly aheadKeys = new Set<string>();
  /** A bundle someone asked for is being made (the background reader waits for these, not for the ones made ahead). */
  private asked = false;
  private readonly status = new Map<string, IndexStatus>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private working = false;
  private reading: { done: number; total: number; current?: string } = { done: 0, total: 0 };
  private readingLoop = false;
  private stopped = false;
  private child?: { kill(): void };
  private maker?: { kill(): void };

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
    this.maker?.kill();
  }

  async list(fresh = false): Promise<CatalogueJson> {
    const c = await this.catalogue.runs(fresh ? 0 : 15_000);
    const runs = c.runs.map((r) => {
      if (r.reading) return r;
      const x = this.readings[r.key];
      return x && x.reading && x.bytes === r.bytes && x.mtimeMs === r.mtimeMs && x.v === readerVersion ? { ...r, reading: x.reading } : r;
    });
    if (this.opts.background !== false) {
      for (const r of runs) if (r.reading?.levers?.tried && !r.indexed) this.makeAhead(r);
      this.startReading(runs);
    }
    return { runs, reading: this.reading, scannedAt: c.at, scanMs: c.ms };
  }

  /** The study's reader applies to non-code forks of an experiment on the mayor's post. */
  readingInput(e: RunEntry): ReadingInput | undefined {
    const x = e.experiment;
    if (!x || x.isCode || x.post !== "mayor") return undefined;
    return { dir: join(this.paths.runs, x.dir), seed: x.seed, arm: x.arm, model: x.model, rawModel: x.rawModel, goal: x.goal, forkDay: x.forkDay ?? 0, ...(x.untilDay !== undefined ? { untilDay: x.untilDay } : {}) };
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
      while ((this.queue.length || this.ahead.length) && !this.stopped) {
        const fromQueue = this.queue.length > 0;
        const e = fromQueue ? this.queue.shift()! : this.ahead.shift()!;
        this.asked = fromQueue;
        if (!fromQueue && this.status.has(e.key)) continue; // (asked for meanwhile: it is in the queue)
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
          const job = { views: this.paths.views, entry: e, path: this.catalogue.abs(e), ctx: this.ctxOf(e), ...(reading ? { reading } : {}) };
          const m = await this.makeInChild(job, (p) => {
            const elapsed = (performance.now() - started) / 1000;
            const fraction = endT ? Math.min(1, p.t / endT) : p.fileBytes && e.kind === "plain" ? Math.min(1, p.fileBytes / e.bytes) : null;
            this.emit(e.key, { state: "indexing", key: e.key, lines: p.lines, t: p.t, fraction, elapsed, rate: elapsed > 0 ? p.lines / elapsed : 0 });
          });
          if (m.reading) this.remember(e, m.reading);
          this.emit(e.key, { state: "ready", key: e.key, seconds: m.seconds, lines: m.lines });
        } catch (err) {
          this.emit(e.key, { state: "failed", key: e.key, error: String((err as Error).message ?? err).slice(0, 2000) });
        }
      }
    } finally {
      this.working = false;
      this.asked = false;
    }
  }

  /** makeBundle in a child process (src/server/make-one.ts): the server's own loop stays free to answer. */
  private async makeInChild(job: object, onProgress: (p: IngestProgress) => void): Promise<Manifest> {
    const p = Bun.spawn([process.execPath, join(here, "make-one.ts"), JSON.stringify(job)], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    this.maker = p;
    let manifest: Manifest | undefined;
    const errP = new Response(p.stderr).text();
    const dec = new TextDecoder();
    let rest = "";
    for await (const chunk of p.stdout) {
      const lines = (rest + dec.decode(chunk, { stream: true })).split("\n");
      rest = lines.pop()!;
      for (const line of lines) {
        if (!line) continue;
        const x = JSON.parse(line);
        if (x.p) onProgress(x.p);
        if (x.m) manifest = x.m;
      }
    }
    const code = await p.exited;
    this.maker = undefined;
    if (code !== 0 || !manifest) throw new Error((await errP).trim().split("\n").slice(-4).join(" | ") || `exit ${code}`);
    return manifest;
  }

  /** Make this run's bundle ahead of being asked for, when nothing asked for is waiting. */
  private makeAhead(e: RunEntry) {
    if (this.opts.background === false || this.aheadKeys.has(e.key) || this.manifest(e)) return;
    this.aheadKeys.add(e.key);
    this.ahead.push(e);
    void this.work();
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
    // (Forks an older reading found a lever in go first: they are the ones most likely to be opened.)
    const hint = (r: RunEntry) => {
      const old = this.readings[r.key]?.reading as any;
      return old ? (old.levers?.tried ?? old.levels?.attempted ?? 0) + (old.has_attempt ? 10 : 0) : 0;
    };
    todo.sort((a, b) => hint(b) - hint(a));
    this.readingLoop = true;
    const children = new Set<{ kill(): void }>();
    this.child = { kill: () => children.forEach((c) => c.kill()) };
    const readOne = async (r: RunEntry) => {
      while (this.asked && !this.stopped) await Bun.sleep(500);
      if (this.stopped) return;
      this.reading = { ...this.reading, current: r.key };
      try {
        const p = Bun.spawn([process.execPath, join(here, "read-one.ts"), this.catalogue.abs(r), JSON.stringify(this.readingInput(r))], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
        children.add(p);
        const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
        children.delete(p);
        if (this.stopped) return;
        if (code !== 0) throw new Error(err.trim().split("\n").slice(-3).join(" | ") || `exit ${code}`);
        const reading = JSON.parse(out) as ForkReading | null;
        this.remember(r, reading);
        if (reading?.levers?.tried) this.makeAhead(r);
      } catch (err) {
        this.remember(r, null, String((err as Error).message ?? err).slice(0, 500));
      }
      this.reading = { ...this.reading, done: this.reading.done + 1 };
    };
    // (Two at a time: each is one core and the kernel's export.)
    const lanes = 2;
    let next = 0;
    void Promise.all(
      Array.from({ length: lanes }, async () => {
        while (next < todo.length && !this.stopped) await readOne(todo[next++]!);
      }),
    ).finally(() => {
      this.reading = { done: this.reading.done, total: this.reading.total };
      this.readingLoop = false;
    });
  }
}
