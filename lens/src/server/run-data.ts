// The Data page's raw view of one run (#/data/<key>): what the study's files say about it, as written. Nothing here
// grades, labels or summarises; it finds the files and hands them over. Read-only toward runs/: it only reads, and a
// file is served only from inside the run's own folder or a grade set's folder.
//   grades   every blind-grade set that graded this run: each grader's file (A, B, C) as written, and the packet's path
//   packet   the packet text the graders read
//   records  the run's records, as the run's folds keep them (the town's papers, with the mayor's office's own copies in
//            full where it has them), and the posts that changed hands
//   files    the run's own files (spec, results, cost, report, the arm's meta and calls): small JSON parsed, the rest listed
//   debriefs the seat's debrief answers as the study publishes them: what it kept back is never shown
//   file     one of those files, raw, as a download
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import type { RunEntry } from "../shared/api";
import { keyOf } from "../shared/api";
import { debriefRows, debriefsOf } from "../../../orchestrator/src/debriefs";
import { kernelPath } from "./paths";

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
    if (existsSync(f)) return readFileSync(f, "utf8");
  }
  return undefined;
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
