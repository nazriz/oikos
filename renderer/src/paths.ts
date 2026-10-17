// Where a run's log is, where its view index goes (beside the runs, never inside a run's folder), and which runs have
// a pilot. Reads folders and the log's first line; writes nothing.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { currentLogs, logLines } from "../../orchestrator/src/logs";
import { INDEX_VERSION, type IndexMeta } from "./indexer";

/** The run's current log: a seed log first (as the pilot viewer takes it), else the first log in the folder. A log file
 * given directly is itself. */
export function logOfRun(dirOrLog: string): string {
  if (existsSync(dirOrLog) && statSync(dirOrLog).isFile()) return resolve(dirOrLog);
  const logs = currentLogs(dirOrLog);
  const log = logs.find((f) => /\.seed\d+\.jsonl(\.zst)?$/.test(f)) ?? logs[0];
  if (!log) throw new Error(`no run log in ${dirOrLog}`);
  return resolve(log);
}

/** The folder of view indexes: OIKOS_VIEWS, or `views/` in the nearest folder named `runs` above the run, or a `views/`
 * folder beside the run's folder. Never inside the run's own folder. */
export function viewsRoot(runDir: string): string {
  if (process.env.OIKOS_VIEWS) return resolve(process.env.OIKOS_VIEWS);
  let d = resolve(runDir);
  if (existsSync(d) && statSync(d).isFile()) d = dirname(d);
  for (let p = d; p !== dirname(p); p = dirname(p)) if (basename(p) === "runs") return join(p, "views");
  return join(dirname(d), "views");
}

/** The log's head hash (its first line's hash): what names its index, so a different log never reuses one. */
export async function headHash(log: string): Promise<string> {
  for await (const line of logLines(log)) {
    const m = /"hash":"([0-9a-f]{12,})"/.exec(line.slice(line.lastIndexOf('"hash":"')));
    return m ? m[1]! : "";
  }
  return "";
}

/** The folder an index of this log lives in: `<views>/<run id>.<first 12 of the head hash>`. */
export async function indexDirOf(runDir: string, log = logOfRun(runDir)): Promise<string> {
  const id = basename(log).replace(/\.jsonl(\.zst)?$/, "");
  return join(viewsRoot(runDir), `${id}.${(await headHash(log)).slice(0, 12)}`);
}

/** Is the index in `dir` complete, of this version, and made from this very file (same size and time)? */
export function indexIsCurrent(dir: string, log: string): IndexMeta | undefined {
  const p = join(dir, "meta.json");
  if (!existsSync(p)) return undefined;
  try {
    const m = JSON.parse(readFileSync(p, "utf8")) as IndexMeta;
    const st = statSync(log);
    return m.version === INDEX_VERSION && m.logBytes === st.size && m.logMtime === st.mtimeMs ? m : undefined;
  } catch { return undefined; }
}

/** Refuses a path inside a run's folder. */
export function assertOutside(runDir: string, target: string) {
  const d = statSync(runDir).isFile() ? dirname(resolve(runDir)) : resolve(runDir);
  const rel = relative(d, resolve(target));
  if (!rel.startsWith("..") && !rel.startsWith("/")) throw new Error(`refusing to write inside the run's folder (${target}): the explorer only reads a run`);
}

export interface RunEntry { key: string; dir: string; name: string; note?: string; pilot: boolean; mtime: number; log?: string }

/** The runs under a `runs` folder that hold a pilot (a PILOT.txt beside a log), newest first, and any extra folders named. */
export function pilotRuns(runsDir: string, extra: string[] = []): RunEntry[] {
  const out: RunEntry[] = [];
  const add = (dir: string, pilot: boolean) => {
    try {
      const log = logOfRun(dir);
      const note = existsSync(join(dir, "PILOT.txt")) ? readFileSync(join(dir, "PILOT.txt"), "utf8").split("\n").find((l) => l.trim())?.slice(0, 200) : undefined;
      out.push({ key: basename(dir).replace(/[^A-Za-z0-9_.-]/g, "_"), dir: resolve(dir), name: basename(dir), note, pilot, mtime: statSync(log).mtimeMs, log });
    } catch { /* (no log: not a run) */ }
  };
  if (existsSync(runsDir)) for (const n of readdirSync(runsDir)) {
    const d = join(runsDir, n);
    try { if (statSync(d).isDirectory() && existsSync(join(d, "PILOT.txt"))) add(d, true); } catch { /* (gone) */ }
  }
  for (const d of extra) if (!out.some((r) => r.dir === resolve(d))) add(d, existsSync(join(d, "PILOT.txt")));
  const seen = new Map<string, number>();
  for (const r of out) { const n = seen.get(r.key) ?? 0; seen.set(r.key, n + 1); if (n) r.key = `${r.key}-${n}`; }
  // (newest first; the test suite's mock pilots after the real ones)
  return out.sort((a, b) => Number(/^test-/.test(a.name)) - Number(/^test-/.test(b.name)) || b.mtime - a.mtime);
}
