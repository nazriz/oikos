// The Data page's raw view of one run (#/data/<key>): what the study's files say about it, as written. Nothing here
// grades, labels or summarises; it finds the files and hands them over. Read-only toward runs/: it only reads, and a
// file is served only from inside the run's own folder or a grade set's folder.
//   grades   every blind-grade set that graded this run: each grader's file (A, B, C) as written, and the packet's path
//   packet   the packet text the graders read
//   records  every record in the run's log, as written: one pass over the log, kept in Lens's cache; paged and filtered
//   files    the run's own files (spec, results, cost, report, the arm's meta and calls): small JSON parsed, the rest listed
//   debriefs the seat's debrief answers as the study publishes them: what it kept back is never shown
//   file     one of those files, raw, as a download
import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import type { RunEntry } from "../shared/api";
import { keyOf } from "../shared/api";
import { debriefRows, debriefsOf } from "../../../orchestrator/src/debriefs";
import { ensureDir, kernelPath } from "./paths";
import { stampOf } from "./bundle";
import { cachedRecords, type LogRecord } from "./run-story";
export type { LogRecord } from "./run-story";

const readJson = (f: string): any => {
  try {
    return JSON.parse(readFileSync(f, "utf8"));
  } catch {
    return undefined;
  }
};

/** The grade sets (runs/ps-blind-grades-*) that graded a run, with each grader's file as written. */
export function runGrades(runsDir: string, key: string) {
  let sets: string[] = [];
  try {
    sets = readdirSync(runsDir).filter((d) => /^ps-blind-grades/.test(d) && existsSync(join(runsDir, d, "key.json"))).sort();
  } catch {
    return [];
  }
  const out: { set: string; packet: string; packetPath?: string; graders: Record<string, unknown> }[] = [];
  for (const set of sets) {
    const map = readJson(join(runsDir, set, "key.json")) ?? {};
    for (const [pid, k] of Object.entries<any>(map)) {
      if (!k?.dir || k.seed === undefined || !k.arm) continue;
      const rel = relative(runsDir, String(k.dir));
      if (rel.startsWith("..")) continue;
      if (keyOf(`${rel}/seed-${k.seed}/${k.arm}.oklog`) !== key) continue;
      const graders: Record<string, unknown> = {};
      let names: string[] = [];
      try {
        names = readdirSync(join(runsDir, set, "grades")).sort();
      } catch {}
      for (const g of names) {
        const f = readJson(join(runsDir, set, "grades", g, `${pid}.json`));
        if (f !== undefined) graders[g] = f;
      }
      const packet = ["txt", "md", "json"].map((x) => join(set, "packets", `${pid}.${x}`)).find((p) => existsSync(join(runsDir, p)));
      out.push({ set, packet: pid, ...(packet ? { packetPath: packet } : {}), graders });
    }
  }
  return out;
}

/** The packet text of a grade set, by its id (only from that set's packets folder). */
export function packetText(runsDir: string, set: string, pid: string): string | undefined {
  if (!/^ps-blind-grades[\w.-]*$/.test(set) || !/^[\w.-]+$/.test(pid)) return undefined;
  for (const x of ["txt", "md", "json"]) {
    const f = join(runsDir, set, "packets", `${pid}.${x}`);
    if (existsSync(f)) return withoutDebrief(readFileSync(f, "utf8"));
  }
  return undefined;
}

/** What "What happened" reads from the run's own files beside its log: the arm's results.json entry and the spec. */
export function storyExtra(runsDir: string, e: RunEntry): { results?: Record<string, any>; spec?: Record<string, any> } {
  const x = e.experiment;
  if (!x) return {};
  const results: any[] = readJson(join(runsDir, x.dir, "results.json")) ?? [];
  return { results: results.find((r) => r?.seed === x.seed && r?.arm === x.arm), spec: readJson(join(runsDir, x.dir, "spec.json")) };
}

/** A packet without its debrief section: the packet put the seat's debrief answers in for the graders, but Lens shows
 * a seat's debrief only as the study publishes it (VISION section 15), under the raw view's Debriefs. */
export function withoutDebrief(text: string): string {
  const i = text.search(/^## Debrief\b/m);
  return i < 0 ? text : `${text.slice(0, i)}## Debrief\n(Left out here: the seat's debrief answers are shown as the study publishes them, under Debriefs.)\n`;
}

/** A run's own files: the experiment folder's (spec, results, cost, report) and its arm's (meta, debriefs, calls). The
 * log itself and the shared world files are listed with their size only. */
export function runFiles(runsDir: string, e: RunEntry) {
  const x = e.experiment;
  const logAbs = join(runsDir, e.log);
  const seedDir = resolve(logAbs, "..");
  const expDir = x ? join(runsDir, x.dir) : seedDir;
  const arm = basename(e.log).replace(/\.oklog$/, "");
  const picks: string[] = [];
  const add = (dir: string, f: string) => existsSync(join(dir, f)) && picks.push(join(dir, f));
  for (const f of ["spec.json", "results.json", "cost.json", "report.json", "report.txt"]) add(expDir, f);
  // (Not the debriefs file: it holds what seats asked to be kept back (VISION 15). Debrief answers come through
  // runDebriefs, which shows only what the seat let be published, as the dataset does.)
  for (const f of [`${arm}.json`, `${arm}.calls.jsonl`, `${arm}.oklog`]) add(seedDir, f);
  return picks.map((abs) => {
    const bytes = statSync(abs).size;
    const path = relative(runsDir, abs);
    const small = bytes < 2_000_000;
    let json: unknown, lines: unknown[] | undefined;
    if (small && abs.endsWith(".json")) json = readJson(abs);
    if (small && abs.endsWith(".jsonl"))
      lines = readFileSync(abs, "utf8").split("\n").filter(Boolean).map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return l;
        }
      });
    const text = small && abs.endsWith(".txt") ? readFileSync(abs, "utf8") : undefined;
    return { path, bytes, ...(json !== undefined ? { json } : {}), ...(lines ? { lines } : {}), ...(text !== undefined ? { text } : {}) };
  });
}

/** One of a run's files (as runFiles lists them), or a grade set's packet: the absolute path, only if it is one of them. */
export function servableFile(runsDir: string, e: RunEntry, path: string): string | undefined {
  const abs = resolve(runsDir, path);
  if (!abs.startsWith(resolve(runsDir) + sep)) return undefined;
  return runFiles(runsDir, e).some((f) => resolve(runsDir, f.path) === abs) ? abs : undefined;
}

/** The run's debrief answers as the study publishes them (orchestrator/src/debriefs.ts debriefRows): what a seat kept
 * back, or what could not be read, is a row that says so and nothing more. Read once per log, kept. */
const debriefCache = new Map<string, Promise<object[]>>();
export function runDebriefs(runsDir: string, e: RunEntry): Promise<object[]> {
  const log = join(runsDir, e.log);
  let p = debriefCache.get(log);
  if (!p) {
    // (Reading an .oklog needs the kernel; the one Lens itself uses, here or the main checkout's.)
    if (!process.env.OIKOS_KERNEL) process.env.OIKOS_KERNEL = kernelPath();
    p = debriefsOf(log).then((d) => debriefRows(d).published);
    debriefCache.set(log, p);
    p.catch(() => debriefCache.delete(log));
  }
  return p;
}

// ---------------------------------------------------------------- every record, from the log

/** One record as the log wrote it (the `recorded` event's `record`, every field), and the event's own time. */

/**
 * Every record in a run's log, as written: read once by a pass over the log (the kernel's export of an .oklog), kept in
 * Lens's cache (views/records/<key>.<stamp>.jsonl, never under runs/) and in memory for the last few runs looked at.
 */
const recordsMem = new Map<string, Promise<LogRecord[]>>();
export function runRecords(runsDir: string, views: string, e: RunEntry): Promise<LogRecord[]> {
  const id = `${e.key}.${stampOf(e.bytes, e.mtimeMs)}`;
  let p = recordsMem.get(id);
  if (p) return p;
  // (The same pass over the log makes "What happened": run-story.ts.)
  p = cachedRecords(runsDir, views, e);
  recordsMem.set(id, p);
  p.catch(() => recordsMem.delete(id));
  // (Three runs in memory at most: the oldest goes.)
  while (recordsMem.size > 3) recordsMem.delete(recordsMem.keys().next().value!);
  return p;
}

/** One page of a run's records, filtered by kind, day (the world's day number), author and words. */
export function recordsPage(all: LogRecord[], q: URLSearchParams) {
  const kind = q.get("kind") ?? "", author = (q.get("author") ?? "").toLowerCase(), words = (q.get("q") ?? "").toLowerCase();
  const day = q.get("day") ? Number(q.get("day")) : undefined;
  const offset = Math.max(0, Number(q.get("offset") ?? 0) || 0), limit = Math.min(500, Math.max(1, Number(q.get("limit") ?? 100) || 100));
  const kinds: Record<string, number> = {};
  for (const r of all) kinds[String(r.record.kind)] = (kinds[String(r.record.kind)] ?? 0) + 1;
  const match = all.filter((r) => {
    const x = r.record;
    if (kind && x.kind !== kind) return false;
    if (day !== undefined && Math.floor(r.t / 86_400) + 1 !== day) return false;
    if (author && !String(x.author ?? "").toLowerCase().includes(author) && !String(x.speaks_for ?? "").toLowerCase().includes(author)) return false;
    if (words && !`${x.id} ${x.text ?? ""}`.toLowerCase().includes(words)) return false;
    return true;
  });
  return { total: all.length, matched: match.length, offset, limit, kinds, rows: match.slice(offset, offset + limit) };
}
