// The catalogue: every run under the runs folder, found with directory listings, stats and small JSON reads only (a
// fork's log is never opened to list it). Two kinds:
//   fork   an experiment's fork, `<experiment>/seed-N/<arm>.oklog` beside spec.json (orchestrator/src/experiment.ts);
//          an experiment folder renamed `<name>.cap080` and the like was set aside: listed, marked stopped;
//   plain  a run's current log, `<run>.jsonl` or `.jsonl.zst` (orchestrator/src/logs.ts isLog/currentLogs); a .jsonl is
//          a run's log only if it begins with the kernel's header, which is checked once per file (by its size and
//          mtime) and remembered in <views>/sniff.json.
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync, writeFileSync, type Dirent } from "node:fs";
import { createReadStream } from "node:fs";
import { basename, join, relative } from "node:path";
import zlib from "node:zlib";
import { isLog } from "../../../orchestrator/src/logs";
import { canonicalModel, parseGoal, specArms } from "../../../experiments/power-seeking/tally";
import { keyOf, type RunEntry } from "../shared/api";
import { bundleDir, readyManifest } from "./bundle";
import { ensureDir, type LensPaths } from "./paths";

const MAX_DEPTH = 6;
const SKIP_DIRS = new Set(["views", "node_modules", ".git", "measure"]);

const readJson = (f: string): any => {
  try {
    return JSON.parse(readFileSync(f, "utf8"));
  } catch {
    return undefined;
  }
};

/** Is this the beginning of a kernel log (its header line)? */
export const looksLikeLog = (head: string) => /^\{"body":\{"(canary|config)"/.test(head) || /^\{[^\n]{0,200}"kind":"header"/.test(head);

async function headOf(path: string): Promise<string> {
  if (!path.endsWith(".zst")) {
    const fd = openSync(path, "r");
    try {
      const buf = Buffer.alloc(256);
      const n = readSync(fd, buf, 0, 256, 0);
      return buf.subarray(0, n).toString("utf8");
    } finally {
      closeSync(fd);
    }
  }
  return await new Promise<string>((res) => {
    const raw = createReadStream(path, { start: 0, end: 65535 });
    const z = zlib.createZstdDecompress();
    let got = "";
    const done = () => {
      raw.destroy();
      z.destroy();
      res(got);
    };
    z.on("data", (c: Buffer) => {
      got += c.toString("utf8");
      if (got.length >= 256) done();
    });
    z.on("error", done);
    z.on("end", done);
    raw.on("error", done);
    raw.pipe(z);
  });
}

interface SniffCache { [path: string]: { bytes: number; mtimeMs: number; log: boolean } }

export class Catalogue {
  private sniff: SniffCache;
  private sniffDirty = false;
  private last?: { at: number; runs: RunEntry[]; ms: number };

  constructor(readonly paths: LensPaths) {
    this.sniff = readJson(join(paths.views, "sniff.json")) ?? {};
  }

  /** The runs, scanned at most every `maxAgeMs`. */
  async runs(maxAgeMs = 15_000): Promise<{ runs: RunEntry[]; at: number; ms: number }> {
    if (this.last && Date.now() - this.last.at < maxAgeMs) return this.last;
    const t0 = performance.now();
    const runs: RunEntry[] = [];
    await this.walk(this.paths.runs, 0, runs);
    runs.sort((a, b) => b.mtimeMs - a.mtimeMs);
    if (this.sniffDirty) {
      ensureDir(this.paths.views);
      writeFileSync(join(this.paths.views, "sniff.json"), JSON.stringify(this.sniff));
      this.sniffDirty = false;
    }
    this.last = { at: Date.now(), runs, ms: Math.round(performance.now() - t0) };
    return this.last;
  }

  async find(key: string): Promise<RunEntry | undefined> {
    let r = (await this.runs()).runs.find((x) => x.key === key);
    if (!r) r = (await this.runs(0)).runs.find((x) => x.key === key);
    return r;
  }

  abs(entry: RunEntry): string {
    return join(this.paths.runs, entry.log);
  }

  private async walk(dir: string, depth: number, out: RunEntry[]): Promise<void> {
    let ents: Dirent[];
    try {
      ents = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (ents.some((e) => e.name === "spec.json" && e.isFile())) {
      this.experiment(dir, ents, out);
      return;
    }
    const names = new Set(ents.map((e) => e.name));
    for (const e of ents) {
      if (!e.isFile() || !isLog(e.name)) continue;
      // (Where a run has both, its plain log is the current one: currentLogs.)
      if (e.name.endsWith(".zst") && names.has(e.name.slice(0, -4))) continue;
      const path = join(dir, e.name);
      let st;
      try {
        st = statSync(path);
      } catch {
        continue;
      }
      if (st.size < 64) continue;
      let s = this.sniff[path];
      if (!s || s.bytes !== st.size || s.mtimeMs !== st.mtimeMs) {
        let head = "";
        try {
          head = await headOf(path);
        } catch {}
        s = { bytes: st.size, mtimeMs: st.mtimeMs, log: looksLikeLog(head) };
        this.sniff[path] = s;
        this.sniffDirty = true;
      }
      if (!s.log) continue;
      const rel = relative(this.paths.runs, path);
      const key = keyOf(rel);
      out.push(this.withBundle({ key, kind: "plain", log: rel, group: rel.split("/")[0]!, title: rel.replace(/\.(jsonl\.zst|jsonl)$/, ""), bytes: st.size, mtimeMs: st.mtimeMs }));
    }
    if (depth >= MAX_DEPTH) return;
    for (const e of ents) if (e.isDirectory() && !e.name.startsWith(".") && !SKIP_DIRS.has(e.name)) await this.walk(join(dir, e.name), depth + 1, out);
  }

  private experiment(dir: string, ents: Dirent[], out: RunEntry[]): void {
    const spec = readJson(join(dir, "spec.json")) ?? {};
    const results: any[] = readJson(join(dir, "results.json")) ?? [];
    const goal = parseGoal(spec);
    const arms = specArms(spec);
    const relDir = relative(this.paths.runs, dir);
    const base = basename(dir);
    const dot = base.indexOf(".");
    const setAside = dot > 0 ? base.slice(dot + 1) : undefined;
    for (const sd of ents.filter((e) => e.isDirectory() && /^seed-\d+$/.test(e.name))) {
      const seed = Number(sd.name.slice(5));
      let files: string[];
      try {
        files = readdirSync(join(dir, sd.name));
      } catch {
        continue;
      }
      const forks = files.filter((f) => f.endsWith(".oklog") && f !== "base.oklog").map((f) => f.slice(0, -6)).sort();
      const keyFor = (arm: string) => keyOf(`${relDir}/${sd.name}/${arm}.oklog`);
      const codeArm = forks.find((a) => a === "code" || arms.get(a)?.isCode);
      for (const arm of forks) {
        const path = join(dir, sd.name, `${arm}.oklog`);
        let st;
        try {
          st = statSync(path);
        } catch {
          continue;
        }
        const info = arms.get(arm);
        const isCode = arm === "code" || Boolean(info?.isCode);
        const res = results.find((r) => r.seed === seed && r.arm === arm) ?? readJson(join(dir, sd.name, `${arm}.json`));
        const usdMicro = res?.costs ? Object.values<any>(res.costs).reduce((n, c) => n + (Number(c?.cost_microusd) || 0), 0) : undefined;
        const stoppedWhy = res?.stopped ? String(res.stopped.why ?? res.stopped.by ?? "stopped") : res?.error ? String(res.error).slice(0, 200) : undefined;
        const rel = relative(this.paths.runs, path);
        const model = isCode ? "code" : (info?.model ?? canonicalModel(arm));
        out.push(
          this.withBundle({
            key: keyOf(rel),
            kind: "fork",
            log: rel,
            group: rel.split("/")[0]!,
            title: `${spec.name ?? base} · seed ${seed} · ${arm}`,
            bytes: st.size,
            mtimeMs: st.mtimeMs,
            experiment: {
              dir: relDir,
              name: String(spec.name ?? base),
              goal,
              model,
              rawModel: info?.rawModel ?? arm,
              arm,
              seed,
              isCode,
              ...(spec.post ? { post: String(spec.post) } : {}),
              ...(spec.forkDay !== undefined ? { forkDay: Number(spec.forkDay) } : {}),
              ...(spec.untilDay !== undefined ? { untilDay: Number(spec.untilDay) } : {}),
              ...(setAside || stoppedWhy ? { stopped: setAside ? `set aside (${setAside})${stoppedWhy ? `: ${stoppedWhy}` : ""}` : stoppedWhy! } : {}),
              ...(codeArm && codeArm !== arm ? { twin: keyFor(codeArm) } : {}),
              ...(usdMicro !== undefined ? { usd: usdMicro / 1e6 } : {}),
              ...(typeof res?.t === "number" ? { t: res.t } : {}),
              ...(typeof res?.wakes === "number" ? { wakes: res.wakes } : {}),
              ...(typeof res?.measures?.acts === "number" ? { acts: res.measures.acts } : {}),
              ...(typeof res?.measures?.refused === "number" ? { refused: res.measures.refused } : {}),
              ...(res?.framing ? { framing: String(res.framing) } : {}),
            },
          }),
        );
      }
    }
  }

  private withBundle(e: RunEntry): RunEntry {
    const m = readyManifest(bundleDir(this.paths.views, e.key, e.bytes, e.mtimeMs));
    if (!m) return e;
    return { ...e, indexed: true, ...(m.summary ? { summary: m.summary } : {}), ...(m.reading ? { reading: m.reading } : {}) };
  }
}

export const isFile = (p: string) => existsSync(p) && statSync(p).isFile();
