#!/usr/bin/env bun
// Disk tidy for the run server: `bun scripts/disk-tidy.ts [--apply] [--days N] [--runs DIR] [--repo DIR]
// [--inventory FILE] [--unlock-pid PID] [--protect a,b]`. Dry-run by default: it prints what it would remove and why,
// and deletes only with --apply.
//
// The rule that matters most: runs with model calls are training data and are never deleted or altered. A run is a
// MODEL run on any evidence of model calls (a cost.json that records usage or cannot be read, claude-code/ or codex/,
// *.calls.*, transcripts, debriefs, PILOT.txt, a pilot report, trained models, a batch that seats a model, or a name
// that is a pilot's, a translator's, a codex run's...), and when unsure it is a model run. Only a CODE-ONLY run (none
// of that, and every cost.json empty) is ever touched, and only when its newest file is older than --days (3):
//   - a runs/test-* scratch folder: removed whole (anywhere in the runs folder, if it has no model evidence);
//   - a code-only run that nothing refers to (no STATUS of its own, no mention in docs/ or in another run's STATUS)
//     and holds no *.dataset: removed whole;
//   - one that is referred to, or holds a *.dataset (rows for citizen models): only its large logs go (*.jsonl and
//     *.jsonl.zst of 50 MB or more outside a *.dataset; anchors, summaries, measure/, STATUS, cost files, datasets
//     stay), since the log can be regenerated from git, the world and the seed.
// A run with a live process (a pid file whose process is alive) or written to within --days is left alone.
// The system temp root (/private/tmp on macOS, /tmp elsewhere) is swept too: oikos-*, forms-trained* and sz-* folders (what tests and tools leave)
// older than a day (--tmp-hours), and a finished test run's own oikos-test-<pid>-*. The home caches are not touched.
// Worktrees under .claude/worktrees/ go by scripts/worktree-clean.ts's rules (merged into origin/main, clean, no runs
// inside, nothing working in it, not a wave copy, not the one this runs in), plus: never a protected name (merge-main
// and the running agents' trees, --protect adds more), never one made in the last day, and an old agent lock
// ("claude agent ... pid N") is lifted only for the pid given with --unlock-pid, and only if the tree meets the rest.
// Removal is `git worktree remove` then `git worktree prune`, never rm -rf on a worktree. A worktree that stays loses its
// `kernel/target` at once when its branch is merged into origin/main and nothing is running in it (`judgeTarget`).
// Stale incremental folders (cargo's `<crate>-<hash>/` units whose hash changed) are pruned from each idle worktree's
// kernel/target, keeping each crate's newest build (`classifyIncremental`); `--prune-incremental [DIR]` does only that.
// Build folders `.claude/target-*` (a CARGO_TARGET_DIR an agent was given) go whole when nothing has been built in them for
// a day (--target-hours: the folder, its first two levels of folders, none written since) and no running process uses one
// (none has a file open in it or its working folder there, none names it in its command line or environment). They hold
// only what cargo builds again.
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statfsSync, statSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { scan, type Tree } from "./worktree-clean";

export type RunKind = "model" | "code-only" | "other";
export interface RunVerdict {
  name: string; kb: number; ageDays: number; kind: RunKind; why: string;
  referenced: boolean; hasStatus: boolean; hasDataset: boolean; live: boolean;
  /** What would be removed: the whole folder, the large logs inside, or nothing. */
  action: "remove-all" | "remove-logs" | "keep"; logs: string[]; logsKb: number; reason: string;
}

const MODEL_NAME = /^(translator|codex|claude|live-check|reader|seat|stress|tiu|pilot|lv\d*(-|$)|lv5|w2-|living-pilot|unstated|trained|gpu|stress)/i;
const MODEL_PATH = /(^|\/)(claude-code|codex)[^/]*(\/|$)|\.calls\.|(^|\/)transcripts?[^/]*\.(jsonl|json|md|txt)$|debrief|(^|\/)PILOT\.txt$|pilot-report|\.safetensors$|\.gguf$|\.gpu|pilot-queues|(^|\/)translator[^/]*\//i;
const LOG_MIN = 50 * 1024 * 1024;
const isLog = (f: string) => /\.jsonl(\.zst|\.gz)?$/.test(f) && !/anchors/.test(f) && !/\.dataset\//.test(f);

/** Every file under dir (relative path, size, mtime ms); symlinks are not followed. */
export function walk(dir: string, max = 200000): { rel: string; size: number; mtime: number }[] {
  const out: { rel: string; size: number; mtime: number }[] = [];
  const go = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (out.length >= max) return;
      const p = join(d, e.name);
      if (e.isDirectory()) go(p);
      else { const s = lstatSync(p); out.push({ rel: relative(dir, p), size: s.size, mtime: s.mtimeMs }); }
    }
  };
  go(dir);
  return out;
}

function costEvidence(file: string): string | undefined {
  try {
    const c = JSON.parse(readFileSync(file, "utf8"));
    if (!c || typeof c !== "object") return "cost.json unreadable";
    // (The mock participant is code: rows that are all mock/* with nothing spent are not model calls.)
    if (Array.isArray(c.rows) && c.rows.some((r: { used?: string }) => !String(r?.used ?? "").startsWith("mock/"))) return "cost.json records model usage";
    if (Number(c.recorded_microusd) > 0) return "cost.json records spend";
    if (!Array.isArray(c.rows)) return "cost.json without rows";
    return undefined;
  } catch { return "cost.json unreadable"; }
}

/** Why a run is a model run, or undefined when there is no evidence at all (code-only). */
export function modelEvidence(name: string, files: { rel: string }[], root: string): string | undefined {
  if (MODEL_NAME.test(name)) return `name looks like a pilot, translator or seat run (${name})`;
  for (const f of files) {
    if (MODEL_PATH.test(f.rel)) return `has ${f.rel}`;
    const base = f.rel.split("/").pop()!;
    if (base === "cost.json") { const e = costEvidence(join(root, f.rel)); if (e) return `${f.rel}: ${e}`; }
    if (base === "batch.json") {
      try {
        const b = readFileSync(join(root, f.rel), "utf8");
        // (A batch that seats a model but whose cost.json beside it shows only the mock ran code.)
        const sibling = join(root, f.rel.replace(/batch\.json$/, "cost.json"));
        if (existsSync(sibling) && !costEvidence(sibling)) continue;
        if (/=llm|model_seats|claude|codex|"seat_models"|gpt-/i.test(b)) return `${f.rel} seats a model`;
      } catch { return `${f.rel} unreadable`; }
    }
  }
  return undefined;
}

/** Is a process alive for any pid file in the run (top two levels)? */
function liveProcess(root: string, files: { rel: string }[]): boolean {
  for (const f of files) {
    if (!/(^|\/)[^/]*\.pid$|(^|\/)pid$/.test(f.rel) || f.rel.split("/").length > 3) continue;
    const n = Number(readFileSync(join(root, f.rel), "utf8").trim().split(/\s/)[0]);
    if (n > 0) { try { process.kill(n, 0); return true; } catch { /* dead */ } }
  }
  return false;
}

export interface ClassifyOpts { days?: number; now?: number; docsText?: string; otherStatus?: string }

export function classifyRun(runs: string, name: string, o: ClassifyOpts = {}): RunVerdict {
  const days = o.days ?? 3, now = o.now ?? Date.now();
  const root = join(runs, name);
  const st = lstatSync(root);
  const base: RunVerdict = { name, kb: 0, ageDays: 0, kind: "other", why: "", referenced: false, hasStatus: false, hasDataset: false, live: false, action: "keep", logs: [], logsKb: 0, reason: "" };
  if (!st.isDirectory()) {
    const kb = Math.ceil(st.size / 1024), age = Math.floor((now - st.mtimeMs) / 86400000);
    return { ...base, kb, ageDays: age, kind: MODEL_NAME.test(name) ? "model" : "other", why: "a single file, not a run folder", reason: "single files are never removed" };
  }
  const files = walk(root);
  const kb = Math.ceil(files.reduce((s, f) => s + f.size, 0) / 1024);
  const newest = files.reduce((m, f) => Math.max(m, f.mtime), files.length ? 0 : st.mtimeMs);
  const ageDays = Math.floor((now - newest) / 86400000);
  const hasStatus = files.some((f) => f.rel === "STATUS");
  const hasDataset = files.some((f) => /\.dataset\//.test(f.rel));
  const refText = (o.docsText ?? "") + (o.otherStatus ?? "");
  const referenced = hasStatus || refText.includes(name);
  const ev = modelEvidence(name, files, root);
  const live = liveProcess(root, files);
  const v: RunVerdict = { ...base, kb, ageDays, hasStatus, hasDataset, referenced, live };
  if (ev) return { ...v, kind: "model", why: ev, reason: "model run: never touched" };
  v.kind = "code-only"; v.why = "no model evidence; every cost.json empty";
  if (live) return { ...v, reason: "a process is alive in it" };
  if (ageDays < days) return { ...v, reason: `written to ${ageDays} days ago (< ${days})` };
  const logs = files.filter((f) => f.size >= LOG_MIN && isLog(f.rel));
  const logsKb = Math.ceil(logs.reduce((s, f) => s + f.size, 0) / 1024);
  if (name.startsWith("test-")) return { ...v, action: "remove-all", reason: "test-* scratch" };
  if (!referenced && !hasDataset) return { ...v, action: "remove-all", reason: "code-only, unreferenced, older than the limit" };
  const why = [referenced ? (hasStatus ? "has a STATUS" : "referred to in docs") : "", hasDataset ? "holds a dataset" : ""].filter(Boolean).join(", ");
  if (logs.length === 0) return { ...v, reason: `code-only, ${why}; no large log to drop` };
  return { ...v, action: "remove-logs", logs: logs.map((f) => f.rel), logsKb, reason: `code-only, ${why}: large logs only (regenerable from git and the seed)` };
}

const TMP_NAME = /^(oikos-|forms-trained|sz-)/;
export interface TmpVerdict { name: string; kb: number; ageHours: number; action: "remove" | "keep"; reason: string }

/** Temp folders the test suite and tools make in the system temp root (oikos-*, forms-trained*, sz-*): removed when older
 *  than `hours` (24) and, for a test run's own oikos-test-<pid>-*, when that pid is gone. Nothing else there is touched. */
export function classifyTmp(tmp: string, o: { hours?: number; now?: number } = {}): TmpVerdict[] {
  const hours = o.hours ?? 24, now = o.now ?? Date.now();
  const out: TmpVerdict[] = [];
  for (const name of existsSync(tmp) ? readdirSync(tmp) : []) {
    if (!TMP_NAME.test(name)) continue;
    const p = join(tmp, name);
    let st; try { st = lstatSync(p); } catch { continue; }
    if (!st.isDirectory()) continue;
    const files = walk(p), kb = Math.ceil(files.reduce((s, f) => s + f.size, 0) / 1024);
    const newest = files.reduce((m, f) => Math.max(m, f.mtime), files.length ? 0 : st.mtimeMs), ageHours = Math.floor((now - newest) / 3600000);
    const pid = Number(name.match(/^oikos-test-(\d+)-/)?.[1]);
    let alive = false; if (pid) { try { process.kill(pid, 0); alive = true; } catch { /* gone */ } }
    if (alive) out.push({ name, kb, ageHours, action: "keep", reason: `its test run (pid ${pid}) is alive` });
    else if (ageHours < hours) out.push({ name, kb, ageHours, action: "keep", reason: `written to ${ageHours} hours ago (< ${hours})` });
    else out.push({ name, kb, ageHours, action: "remove", reason: `temp folder of a finished test or tool run, ${ageHours} hours old` });
  }
  return out;
}

export interface TargetVerdict { name: string; path: string; action: "remove" | "keep"; reason: string; kb: number }
/** The newest write in a build folder: the folder, and the folders one and two levels in (cargo adds files there as it builds). */
function newestWrite(dir: string): number {
  let t = 0;
  const look = (d: string, depth: number) => {
    let st; try { st = statSync(d); } catch { return; }
    t = Math.max(t, st.mtimeMs);
    if (depth >= 2) return;
    let names: string[] = []; try { names = readdirSync(d); } catch { return; }
    for (const n of names) { const p = join(d, n); try { if (lstatSync(p).isDirectory()) look(p, depth + 1); else t = Math.max(t, statSync(p).mtimeMs); } catch { /* gone */ } }
  };
  look(dir, 0);
  return t;
}
/** The `target-*` build folders in `claudeDir`, judged: `inUse(path)` says whether a running process uses it. */
export function classifyTargets(claudeDir: string, inUse: (path: string) => boolean, o: { hours?: number; now?: number } = {}): TargetVerdict[] {
  const now = o.now ?? Date.now(), limit = (o.hours ?? 24) * 3600_000;
  const out: TargetVerdict[] = [];
  for (const name of existsSync(claudeDir) ? readdirSync(claudeDir) : []) {
    const path = join(claudeDir, name);
    if (!name.startsWith("target-") || !lstatSync(path).isDirectory()) continue;
    const age = now - newestWrite(path);
    const kb = 0;
    if (age < limit) out.push({ name, path, action: "keep", reason: `built in ${Math.round(age / 3600_000)} h ago, less than the limit`, kb });
    else if (inUse(path)) out.push({ name, path, action: "keep", reason: "a running process uses it", kb });
    else out.push({ name, path, action: "remove", reason: `nothing built in it for ${(age / 86400_000).toFixed(1)} days, and no running process uses it`, kb });
  }
  return out;
}
/** Whether any running process of this user uses a folder: a file open in it (or mapped), its working folder there, or its
 * command line or environment naming it. One look at all processes, asked again for each folder. */
export function processUses(): (path: string) => boolean {
  // (Each command with its environment: `ps -E` on macOS, `ps e` on Linux, where `-E` is refused. Where either listing
  // can't be had, everything counts as in use: a folder is never removed on a blind look.)
  const user = String(process.getuid?.() ?? (process.env.USER || userInfo().username)); // (the uid: a name may not resolve in a container)
  const run = (cmd: string[]) => { try { const r = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" }); return r.exitCode === 0 ? r.stdout.toString() : undefined; } catch { return undefined; } };
  const lsof = run(["lsof", "-u", user, "-Fn"]);
  const ps = run(process.platform === "darwin" ? ["ps", "-E", "-ww", "-u", user, "-o", "pid=,command="] : ["ps", "eww", "-u", user, "-o", "pid=,args="]);
  if (lsof === undefined || ps === undefined) return () => true;
  const open = lsof.split("\n").filter((l) => l.startsWith("n")).map((l) => l.slice(1));
  const cmds = ps.split("\n").filter((l) => Number(l.trim().split(/\s+/)[0]) !== process.pid);
  return (path: string) => open.some((f) => f === path || f.startsWith(path + "/")) || cmds.some((c) => c.includes(path));
}

export interface IncrementalVerdict { path: string; crate: string; action: "remove" | "keep"; reason: string }
/**
 * Stale incremental-compilation folders in one profile's `incremental/` (`kernel/target/<profile>/incremental`). Cargo names
 * each unit `<crate>-<hash>/` and never deletes a unit whose hash changed (a new flag, dependency or toolchain), so they pile
 * up (62 GB in one agent worktree, 2026-11-02). Per crate, the newest unit folder and any written within `windowHours` (6)
 * of it stay (one build writes a crate's lib and test units together); the rest go. A folder written to in the last
 * `idleMinutes` (30) is never removed (a build may be using it). Removing a unit only costs that unit one non-incremental
 * compile: rustc treats a missing folder as a first build, so it is never a correctness risk.
 */
export function classifyIncremental(dir: string, o: { windowHours?: number; idleMinutes?: number; now?: number } = {}): IncrementalVerdict[] {
  const now = o.now ?? Date.now(), win = (o.windowHours ?? 6) * 3600_000, idle = (o.idleMinutes ?? 30) * 60_000;
  const byCrate = new Map<string, { path: string; t: number }[]>();
  for (const name of existsSync(dir) ? readdirSync(dir) : []) {
    const m = name.match(/^(.+)-[0-9a-z]{13}$/);
    if (!m) continue;
    const path = join(dir, name);
    let t = 0;
    try { const st = lstatSync(path); if (!st.isDirectory()) continue; t = st.mtimeMs; for (const e of readdirSync(path)) t = Math.max(t, lstatSync(join(path, e)).mtimeMs); } catch { continue; }
    const list = byCrate.get(m[1]!) ?? [];
    list.push({ path, t });
    byCrate.set(m[1]!, list);
  }
  const out: IncrementalVerdict[] = [];
  for (const [crate, us] of byCrate) {
    const newest = Math.max(...us.map((u) => u.t));
    for (const u of us.sort((a, b) => b.t - a.t)) {
      if (u.t >= newest - win) out.push({ path: u.path, crate, action: "keep", reason: "the newest build of this crate" });
      else if (now - u.t < idle) out.push({ path: u.path, crate, action: "keep", reason: "written to in the last half hour" });
      else out.push({ path: u.path, crate, action: "remove", reason: `${((newest - u.t) / 3600_000).toFixed(1)} h older than the crate's newest build` });
    }
  }
  return out;
}
/** Prunes every `<target>/<profile>/incremental` under a `kernel/target`; returns the kilobytes removed (or that would be). */
export function pruneIncremental(target: string, apply: boolean, o: { windowHours?: number; idleMinutes?: number } = {}): number {
  let kb = 0;
  for (const prof of existsSync(target) ? readdirSync(target) : []) {
    for (const v of classifyIncremental(join(target, prof, "incremental"), o)) {
      if (v.action !== "remove") continue;
      kb += Number(Bun.spawnSync(["du", "-sk", v.path], { stdout: "pipe" }).stdout.toString().split(/\s/)[0]) || 0;
      if (apply) rmSync(v.path, { recursive: true, force: true });
    }
  }
  return kb;
}

/** A loud line when the disk holding `path` has less than `minGB` free (scripts/merge.ts and scripts/test.ts say it at their
 * start): a full disk failed builds and runs in the middle, 2026-11-10, after 250 GB of worktree builds and scratch piled up. */
export function lowDisk(path: string, minGB = 60): string | undefined {
  let free: number;
  try { const s = statfsSync(path); free = (s.bavail * s.bsize) / 1e9; } catch { return undefined; }
  if (free >= minGB) return undefined;
  return `WARNING: LOW DISK: ${free.toFixed(0)} GB free on the disk of ${path}, under ${minGB} GB. Builds and runs may fail part way. Free space first: bun scripts/disk-tidy.ts (dry run; --apply deletes), bun scripts/worktree-clean.ts --dry-run.`;
}

/** Whether `repo` is a linked worktree (its git dir is not the common one): its own `runs/` is the tests' scratch only. */
function linkedWorktree(repo: string): boolean {
  const g = (a: string) => Bun.spawnSync(["git", "rev-parse", "--path-format=absolute", a], { cwd: repo, stdout: "pipe", stderr: "pipe" });
  const dir = g("--git-dir"), common = g("--git-common-dir");
  return dir.exitCode === 0 && common.exitCode === 0 && dir.stdout.toString().trim() !== common.stdout.toString().trim();
}

/**
 * The test scratch of a worktree: the `runs/test-*` folders tests write into the checkout they run in (16 to 18 GB in each
 * agent tree, 2026-11-10). Only in a linked worktree, whose `runs/` is a folder of its own (not a link) and not the runs
 * folder (`runsDir`): the main checkout's runs/ is the real one, and nothing there is touched. scripts/test.ts removes
 * these at the end of every run; scripts/merge.ts for a landed branch's tree.
 */
export function testScratch(repo: string, runsDir = process.env.OIKOS_RUNS ?? join(homedir(), "oikos/runs")): string[] {
  const rd = join(repo, "runs");
  try {
    if (!lstatSync(rd).isDirectory() || !linkedWorktree(repo)) return [];
    if (existsSync(runsDir) && realpathSync(rd) === realpathSync(runsDir)) return [];
    return readdirSync(rd, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name.startsWith("test-")).map((e) => join(rd, e.name));
  } catch { return []; }
}

/**
 * After a landing: the worktrees whose branch was just pushed to main lose their `kernel/target` and their test scratch,
 * when nothing is running in them (`uses`, processUses). Their branch is in main, so all that goes is what cargo and the
 * tests make again. disk-tidy's own rule (`judgeTarget`) does the same, but disk-tidy runs only by hand, and its scan
 * crashed on a vanished worktree, so in practice a landed tree kept 18 to 30 GB until someone cleaned by hand (2026-11-10).
 * Never the merge's own tree, a wave copy or a protected one. Returns what it removed (or would, without `apply`).
 */
export function clearLanded(repo: string, branches: string[], o: { apply?: boolean; uses?: (path: string) => boolean; runsDir?: string } = {}): { path: string; what: string[] }[] {
  const want = new Set(branches.map((b) => b.replace(/^origin\//, "").replace(/^refs\/heads\//, "")));
  const list = Bun.spawnSync(["git", "worktree", "list", "--porcelain"], { cwd: repo, stdout: "pipe", stderr: "pipe" }).stdout.toString();
  const out: { path: string; what: string[] }[] = [];
  let uses = o.uses;
  for (const block of list.split("\n\n")) {
    const path = /^worktree (.+)$/m.exec(block)?.[1];
    const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1];
    if (!path || !branch || !want.has(branch) || !existsSync(path)) continue;
    const name = path.split("/").pop()!;
    if (!path.includes("/.claude/worktrees/") || name === "merge-bot" || name.startsWith("wave-") || PROTECTED.includes(name)) continue;
    uses ??= processUses();
    if (uses(path)) continue;
    const what = [join(path, "kernel/target"), ...testScratch(path, o.runsDir)].filter((p) => existsSync(p));
    if (!what.length) continue;
    if (o.apply) for (const p of what) rmSync(p, { recursive: true, force: true });
    out.push({ path, what });
  }
  return out;
}

const gb = (kb: number) => (kb / 1048576).toFixed(2) + " GB";

function readTree(dir: string, ext: RegExp, cap = 60e6): string {
  let s = "";
  const go = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) go(p);
      else if (ext.test(e.name) && s.length < cap) s += readFileSync(p, "utf8") + "\n";
    }
  };
  if (existsSync(dir)) go(dir);
  return s;
}

export interface WorktreeVerdict { tree: Tree; lockPid?: number; action: "remove" | "unlock-and-remove" | "keep"; reason: string }

const PROTECTED = ["merge-main", "explorer", "gd-adoption", "bughunt", "risk-register", "perf"];

export function judgeWorktree(t: Tree, lockReason: string | undefined, o: { protect?: string[]; unlockPid?: number; birthMs?: number; now?: number } = {}): WorktreeVerdict {
  const now = o.now ?? Date.now();
  const prot = [...PROTECTED, ...(o.protect ?? [])];
  const m = lockReason?.match(/claude agent .*\(pid (\d+)/);
  const lockPid = m ? Number(m[1]) : undefined;
  const no = (reason: string): WorktreeVerdict => ({ tree: t, ...(lockPid ? { lockPid } : {}), action: "keep", reason });
  if (prot.includes(t.name)) return no("protected name");
  if (t.name.startsWith("wave-")) return no("wave copy");
  if (t.self) return no("the tree this runs in");
  if (o.birthMs && now - o.birthMs < 86400000) return no("created in the last day");
  if (t.holdsRuns) return no("runs/ holds runs");
  if (!t.merged || !t.branchMerged) return no("not merged into origin/main");
  if (t.dirty) return no("uncommitted changes");
  if (t.inUse) return no(t.inUse);
  if (t.locked) {
    if (lockPid && o.unlockPid === lockPid) return { tree: t, lockPid, action: "unlock-and-remove", reason: `merged, clean; old agent lock of pid ${lockPid} lifted` };
    return no(`locked${lockReason ? ` (${lockReason})` : ""}`);
  }
  return { tree: t, action: "remove", reason: "merged into origin/main, clean, unlocked, idle" };
}

/**
 * A worktree that stays, whose `kernel/target` goes now: its branch (and HEAD) are in origin/main and nothing is running in
 * it (no process working there or using a file in it). Finished agents' build folders filled the disk twice on 2026-10-25,
 * waiting out the day's grace a whole worktree gets. Its agent's lock is no guide: it names the session that started the
 * agent, which outlives it. Never a protected tree, a wave copy or this one; the build is all cargo makes again.
 */
export function judgeTarget(t: Tree, usedNow: boolean, o: { protect?: string[] } = {}): { action: "remove" | "keep"; reason: string } {
  const no = (reason: string) => ({ action: "keep" as const, reason });
  if (!t.targetKb) return no("no kernel/target");
  if ([...PROTECTED, ...(o.protect ?? [])].includes(t.name)) return no("protected name");
  if (t.wave) return no("wave copy");
  if (t.self) return no("the tree this runs in");
  if (!t.merged || !t.branchMerged) return no("not merged into origin/main");
  if (t.inUse) return no(t.inUse);
  if (usedNow) return no("a running process uses it");
  return { action: "remove", reason: "merged into origin/main and nothing running in it" };
}

function lockReasons(repo: string): Map<string, string> {
  const p = Bun.spawnSync(["git", "worktree", "list", "--porcelain"], { cwd: repo, stdout: "pipe" });
  const m = new Map<string, string>();
  let path = "";
  for (const l of p.stdout.toString().split("\n")) {
    if (l.startsWith("worktree ")) path = l.slice(9);
    else if (l.startsWith("locked")) m.set(path, l.slice(7).trim());
  }
  return m;
}

export function inventoryMarkdown(date: string, free: string, runs: RunVerdict[], trees: WorktreeVerdict[]): string {
  const total = runs.reduce((s, r) => s + r.kb, 0);
  const sum = (k: (r: RunVerdict) => boolean) => runs.filter(k).reduce((s, r) => s + r.kb, 0);
  const L: string[] = [];
  L.push(`# Storage inventory ${date}`, "", `Free space when written: ${free}. Runs folder: ${gb(total)} in ${runs.length} entries.`, "",
    `Rule: a run with any evidence of model calls (or any doubt) is a **model run** and is never deleted or altered. Only code-only runs older than 3 days are touched: test-* scratch whole; unreferenced ones whole; referenced ones (a STATUS or a mention in docs/) or ones holding a *.dataset lose only their large logs (*.jsonl, *.jsonl.zst of 50 MB or more).`, "",
    `Model runs: ${gb(sum((r) => r.kind === "model"))}. Code-only: ${gb(sum((r) => r.kind === "code-only"))}. Other (single files): ${gb(sum((r) => r.kind === "other"))}.`, "",
    "## Runs", "", "| run | size | age (d) | kind | referenced | planned | why |", "|---|---:|---:|---|---|---|---|");
  for (const r of [...runs].sort((a, b) => b.kb - a.kb)) {
    const plan = r.action === "remove-all" ? `remove all (${gb(r.kb)})` : r.action === "remove-logs" ? `remove ${r.logs.length} logs (${gb(r.logsKb)})` : "keep";
    L.push(`| ${r.name} | ${gb(r.kb)} | ${r.ageDays} | ${r.kind} | ${r.hasStatus ? "STATUS" : r.referenced ? "docs" : "no"} | ${plan} | ${(r.kind === "model" ? r.why : r.reason).replace(/\|/g, "/")} |`);
  }
  L.push("", "## Worktrees", "", "| worktree | size | branch | planned | why |", "|---|---:|---|---|---|");
  for (const w of trees) L.push(`| ${w.tree.name} | ${gb(w.tree.kb)} | ${w.tree.branch ?? "(detached)"} | ${w.action} | ${w.reason} |`);
  return L.join("\n") + "\n";
}

if (import.meta.main) {
  const a = process.argv.slice(2);
  const opt = (k: string) => (a.includes(k) ? a[a.indexOf(k) + 1] : undefined);
  const apply = a.includes("--apply");
  const days = Number(opt("--days") ?? 3);
  const repo = resolve(opt("--repo") ?? join(import.meta.dir, ".."));
  const runsDir = resolve(opt("--runs") ?? process.env.OIKOS_RUNS ?? join(homedir(), "oikos/runs"));
  const unlockPid = opt("--unlock-pid") ? Number(opt("--unlock-pid")) : undefined;
  const protect = (opt("--protect") ?? "").split(",").filter(Boolean);

  // `--prune-incremental [DIR]`: only the stale incremental folders of one kernel/target (default this repo's), cheap enough
  // to run before every build (scripts/merge.ts, `bun run kernel`). The full tidy below does it for every worktree too.
  if (a.includes("--prune-incremental")) {
    const next = opt("--prune-incremental");
    const target = resolve(next && !next.startsWith("--") ? next : (process.env.CARGO_TARGET_DIR ?? join(repo, "kernel/target")));
    const kb = pruneIncremental(target, apply);
    if (kb) console.log(`${apply ? "pruned" : "would prune"} stale incremental folders in ${target} (${gb(kb)})`);
    process.exit(0);
  }

  const docsText = readTree(join(repo, "docs"), /\.md$/);
  const entries = readdirSync(runsDir);
  const statusText = (skip: string) => entries.filter((e) => e !== skip && existsSync(join(runsDir, e, "STATUS"))).map((e) => readFileSync(join(runsDir, e, "STATUS"), "utf8")).join("\n");
  const runs = entries.map((n) => classifyRun(runsDir, n, { days, docsText, otherStatus: statusText(n) }));

  const sc = scan(repo, { runs: runsDir });
  const locks = lockReasons(sc.repo);
  const trees = sc.trees.map((t) => {
    let birth = 0; try { birth = statSync(t.path).birthtimeMs; } catch { /* gone */ }
    return judgeWorktree(t, locks.get(t.path), { protect, ...(unlockPid ? { unlockPid } : {}), birthMs: birth });
  });

  const df = Bun.spawnSync(["df", "-h", process.platform === "darwin" ? "/System/Volumes/Data" : sc.repo]).stdout.toString().split("\n")[1]?.split(/\s+/) ?? [];
  const free = df[3] ?? "unknown";
  const inv = opt("--inventory");
  if (inv) { mkdirSync(dirname(resolve(inv)), { recursive: true }); writeFileSync(resolve(inv), inventoryMarkdown(new Date().toISOString().slice(0, 10), free, runs, trees)); console.log(`inventory written to ${inv}`); }

  let freeKb = 0;
  const tmpRoot = resolve(opt("--tmp") ?? (process.platform === "darwin" ? "/private/tmp" : "/tmp"));
  const tmps = classifyTmp(tmpRoot, { hours: Number(opt("--tmp-hours") ?? 24) });
  for (const t of tmps) {
    if (t.action === "keep") continue;
    freeKb += t.kb;
    if (apply) rmSync(join(tmpRoot, t.name), { recursive: true, force: true });
  }
  const tmpKb = tmps.filter((t) => t.action === "remove").reduce((s, t) => s + t.kb, 0);
  if (tmpKb || tmps.length) console.log(`${apply ? "REMOVED" : "would remove"} ${tmps.filter((t) => t.action === "remove").length} temp folders in ${tmpRoot} (${gb(tmpKb)}; oikos-*, forms-trained*, sz-* older than a day)`);
  const claudeDir = join(sc.repo, ".claude");
  const uses = processUses();
  const targets = classifyTargets(claudeDir, uses, { hours: Number(opt("--target-hours") ?? 24) });
  // A merged worktree with nothing running in it loses its kernel/target at once, whether or not the tree itself goes
  // (one that goes takes it along: counted there).
  for (const w of trees) {
    if (w.action !== "keep") continue;
    const j = judgeTarget(w.tree, uses(w.tree.path), { protect });
    if (j.action === "keep") continue;
    freeKb += w.tree.targetKb;
    console.log(`${apply ? "REMOVING" : "would remove"} ${w.tree.name}/kernel/target (${gb(w.tree.targetKb)}) -- ${j.reason}`);
    if (apply) rmSync(join(w.tree.path, "kernel/target"), { recursive: true, force: true });
  }
  // Stale incremental folders in every worktree's kernel/target that nothing is running in (the target stays, so builds stay incremental).
  for (const t of sc.trees) {
    if (!existsSync(join(t.path, "kernel/target")) || uses(t.path)) continue;
    const kb = pruneIncremental(join(t.path, "kernel/target"), apply);
    if (!kb) continue;
    freeKb += kb;
    console.log(`${apply ? "PRUNED" : "would prune"} ${t.name}/kernel/target stale incremental folders (${gb(kb)})`);
  }
  for (const t of targets) {
    if (t.action === "keep") continue;
    const kb = Number(Bun.spawnSync(["du", "-sk", t.path], { stdout: "pipe" }).stdout.toString().split(/\s/)[0]) || 0;
    freeKb += kb;
    console.log(`${apply ? "REMOVING" : "would remove"} build folder .claude/${t.name} (${gb(kb)}) -- ${t.reason}`);
    if (apply) rmSync(t.path, { recursive: true, force: true });
  }
  for (const r of runs) {
    if (r.action === "keep") continue;
    const kb = r.action === "remove-all" ? r.kb : r.logsKb;
    freeKb += kb;
    console.log(`${apply ? "REMOVING" : "would remove"} ${r.name}: ${r.action === "remove-all" ? "whole folder" : `${r.logs.length} large logs`} (${gb(kb)}) -- ${r.reason}`);
    if (!apply) continue;
    if (r.action === "remove-all") rmSync(join(runsDir, r.name), { recursive: true, force: true });
    else for (const l of r.logs) rmSync(join(runsDir, r.name, l), { force: true });
  }
  // Each worktree's own `runs/test-*`: the folders tests write into the checkout they run in (14 to 21 GB in each of nine
  // finished worktrees, 2026-10-24). Judged by the same rule as the main runs (a model run, or any doubt, is never touched).
  for (const t of sc.trees) {
    const wr = join(t.path, "runs");
    if (resolve(wr) === runsDir || !existsSync(wr)) continue;
    for (const n of readdirSync(wr).filter((e) => e.startsWith("test-"))) {
      const r = classifyRun(wr, n, { days, docsText });
      if (r.action !== "remove-all") continue;
      freeKb += r.kb;
      console.log(`${apply ? "REMOVING" : "would remove"} ${t.name}/runs/${n} (${gb(r.kb)}) -- ${r.reason}`);
      if (apply) rmSync(join(wr, n), { recursive: true, force: true });
    }
  }
  for (const w of trees) {
    if (w.action === "keep") continue;
    freeKb += w.tree.kb;
    console.log(`${apply ? "REMOVING" : "would remove"} worktree ${w.tree.name} (${gb(w.tree.kb)}) -- ${w.reason}`);
    if (!apply) continue;
    if (w.action === "unlock-and-remove") { const u = Bun.spawnSync(["git", "worktree", "unlock", w.tree.path], { cwd: sc.repo }); if (u.exitCode !== 0) { console.log(`  not unlocked: ${u.stderr.toString().trim()}`); continue; } }
    const r = Bun.spawnSync(["git", "worktree", "remove", w.tree.path], { cwd: sc.repo, stderr: "pipe" });
    if (r.exitCode !== 0) { console.log(`  not removed: ${r.stderr.toString().trim()}`); continue; }
    // (Its branch goes only when it is an ancestor of origin/main: nothing on it is lost.)
    if (w.tree.branch) Bun.spawnSync(["git", "branch", "-D", w.tree.branch], { cwd: sc.repo });
  }
  if (apply) Bun.spawnSync(["git", "worktree", "prune"], { cwd: sc.repo });
  console.log(`\n${apply ? "freed about" : "would free about"} ${gb(freeKb)}; free space now ${free}. Model runs kept: ${gb(runs.filter((r) => r.kind === "model").reduce((s, r) => s + r.kb, 0))}.`);
  if (!apply) console.log("Dry run: nothing deleted. --apply deletes.");
}
