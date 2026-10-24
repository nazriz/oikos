#!/usr/bin/env bun
// The machine on one screen: `bun scripts/status.ts`. Who is working (worktrees with a running process in them: branch,
// last commit and its age, processes, slots held), the merge (lock and queue: scripts/merge-lock.ts), the slots
// (scripts/slots.ts), the disk, and CI's last result on main (scripts/main-status.ts; `gh` asked too, when it answers).
// It reads and changes nothing (beyond what slots and the merge queue tidy of the dead as they are read).

import { join } from "node:path";
import { readStatus } from "./main-status";
import { mergeState } from "./merge-lock";
import { capSize, ownerOf, state } from "./slots";

const sh = (cmd: string[], cwd?: string, timeout = 5000) => {
  const p = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe", timeout });
  return p.exitCode === 0 ? p.stdout.toString() : "";
};
const ago = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 120 ? `${s}s` : s < 7200 ? `${Math.round(s / 60)}m` : s < 172_800 ? `${(s / 3600).toFixed(1)}h` : `${Math.round(s / 86400)}d`; };
const repo = join(import.meta.dir, "..");
const common = sh(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], repo).trim();
const top = common.replace(/\/\.git\/?$/, "");

// Worktrees, and the running processes whose working folder is in one.
const trees: { path: string; branch: string; head: string }[] = [];
let cur: { path: string; branch: string; head: string } | undefined;
for (const l of sh(["git", "worktree", "list", "--porcelain"], repo).split("\n")) {
  if (l.startsWith("worktree ")) trees.push(cur = { path: l.slice(9), branch: "(detached)", head: "" });
  else if (cur && l.startsWith("HEAD ")) cur.head = l.slice(5);
  else if (cur && l.startsWith("branch ")) cur.branch = l.slice(7).replace("refs/heads/", "");
}
const procs = new Map<string, Set<string>>(); // worktree -> commands
let pid = "";
for (const l of sh(["lsof", "-a", "-d", "cwd", "-u", process.env.USER ?? "", "-Fpcn"], undefined, 15_000).split("\n")) {
  if (l.startsWith("p")) pid = l.slice(1);
  else if (l.startsWith("n")) {
    const t = trees.filter((w) => l.slice(1) === w.path || l.slice(1).startsWith(w.path + "/")).sort((a, b) => b.path.length - a.path.length)[0];
    if (t && pid !== String(process.pid)) procs.set(t.path, (procs.get(t.path) ?? new Set()).add(pid));
  }
}
const slots = state();
const heldBy = new Map<string, number>();
for (const h of slots.holders) { const o = h.owner ?? ownerOf(h.cwd); heldBy.set(o, (heldBy.get(o) ?? 0) + 1); }

console.log(`== working (${procs.size} of ${trees.length} worktrees have a running process)`);
const rows = trees.filter((t) => procs.has(t.path) || heldBy.has(t.path)).map((t) => {
  const [sha, at, subject] = sh(["git", "log", "-1", "--format=%h%x00%ct%x00%s", t.head], repo).trim().split("\0");
  return { name: t.path === top ? "(main checkout)" : t.path.replace(`${top}/.claude/worktrees/`, ""), branch: t.branch, sha: sha ?? "", age: at ? ago(Date.now() - Number(at) * 1000) : "?", subject: (subject ?? "").slice(0, 60), procs: procs.get(t.path)?.size ?? 0, held: heldBy.get(t.path) ?? 0 };
}).sort((a, b) => b.held - a.held || b.procs - a.procs);
for (const r of rows) console.log(`  ${r.name.padEnd(22).slice(0, 22)} ${r.branch.padEnd(22).slice(0, 22)} ${r.sha} ${r.age.padStart(4)} ago  ${String(r.procs).padStart(2)} proc  ${r.held ? `${r.held} slot${r.held > 1 ? "s" : ""}` : "       "}  ${r.subject}`);

console.log("== merge");
const m = mergeState();
console.log(m.holder ? `  merging: pid ${m.holder.pid}, ${ago(Date.now() - m.holder.since)}: ${m.holder.branches.join(" + ")}` : "  no merge running");
for (const w of m.queue) if (w.pid !== m.holder?.pid) console.log(`  queued:  pid ${w.pid}, ${ago(Date.now() - w.since)}: ${w.branches.join(" + ")}`);

console.log(`== slots: ${slots.holders.length} of ${slots.size} held, ${slots.waiters.length} waiting; cap per checkout ${capSize(slots.size)}`);
const by = new Map<string, typeof slots.holders>();
// (One line per process and job: a suite holds a token per file, which would be a line each.)
for (const h of slots.holders) by.set(`${h.pid} ${h.what}`, [...(by.get(`${h.pid} ${h.what}`) ?? []), h]);
for (const hs of by.values()) console.log(`  held ${String(hs.length).padStart(2)}${hs[0]!.priority ? " HIGH" : ""}  pid ${hs[0]!.pid}  since ${ago(Date.now() - Math.min(...hs.map((h) => h.since))).padStart(4)}  ${hs[0]!.what.slice(0, 70)}`);
const ws = new Map<string, typeof slots.waiters>();
for (const w of slots.waiters) ws.set(`${w.pid} ${w.what}`, [...(ws.get(`${w.pid} ${w.what}`) ?? []), w]);
for (const w of ws.values()) console.log(`  waits ${String(w.reduce((a, x) => a + x.weight, 0)).padStart(2)}${w[0]!.priority ? " HIGH" : ""} pid ${w[0]!.pid}  since ${ago(Date.now() - Math.min(...w.map((x) => x.since))).padStart(4)}  ${w[0]!.what.slice(0, 70)}`);

console.log("== disk");
const df = sh(["df", "-h", repo]).trim().split("\n").pop()?.split(/\s+/) ?? [];
console.log(`  ${df[3] ?? "?"} free of ${df[1] ?? "?"} (${df[4] ?? "?"} used)   [bun scripts/disk-tidy.ts]`);

console.log("== CI on main");
const gh = sh(["gh", "run", "list", "--workflow", "ci", "--branch", "main", "--limit", "3", "--json", "conclusion,status,headSha,createdAt,displayTitle"], repo, 8000);
let shown = false;
try {
  for (const r of JSON.parse(gh) as { conclusion: string; status: string; headSha: string; createdAt: string; displayTitle: string }[]) {
    console.log(`  ${(r.conclusion || r.status).padEnd(11)} ${r.headSha.slice(0, 8)} ${ago(Date.now() - Date.parse(r.createdAt)).padStart(4)} ago  ${r.displayTitle.slice(0, 60)}`);
    shown = true;
  }
} catch { /* gh not there or not answering */ }
const st = readStatus();
console.log(st ? `  recorded on this machine: ${st.status} at ${st.sha.slice(0, 8)} (${st.at})` : shown ? "" : "  no result recorded yet (~/.oikos/main-ci.json)");
