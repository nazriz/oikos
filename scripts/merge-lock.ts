#!/usr/bin/env bun
// The merge lock: one merge to main at a time, machine-wide, and only by scripts/merge.ts.
//   as a library: const lock = await acquire(["branch-a", "branch-b"]); try { ... } finally { lock.release(); }
//   to look:      bun scripts/merge-lock.ts status
// The lock is a file (`lock` in ~/.oikos/merge, or OIKOS_MERGE_DIR) made by a hard link from a finished temporary file,
// as the slots' tokens are: taking it is atomic. It names the holder's pid, when, what it merges and from where. A merge
// that finds it taken waits in a queue (files `wait-<pid>`, the oldest first) and says so once a minute; a holder that
// died leaves the lock behind, and the next in line sees its pid is dead and takes it.
// The push to main is guarded by a git pre-push hook (scripts/hooks/pre-push, installed into the repository's common
// hooks folder by merge.ts and scripts/setup-mini.sh): it refuses a push to main unless the pusher holds this lock
// (OIKOS_MERGE_LOCK=<the holder's pid> in its environment, as merge.ts sets it for its own push).

import { existsSync, linkSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Entry { pid: number; since: number; branches: string[]; cwd: string }
export const mergeDir = () => process.env.OIKOS_MERGE_DIR ?? join(homedir(), ".oikos", "merge");
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; } };
const read = (p: string): Entry | undefined => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return undefined; } };
const remove = (p: string) => { try { unlinkSync(p); } catch { /* gone */ } };
let serial = 0;
function claim(dir: string, name: string, body: Entry): boolean {
  const tmp = join(dir, `.tmp-${process.pid}-${serial++}`);
  writeFileSync(tmp, JSON.stringify(body));
  try { linkSync(tmp, join(dir, name)); return true; } catch { return false; } finally { remove(tmp); }
}

/** The holder (if alive) and the queue, oldest first; the files of the dead are removed on the way. */
export function mergeState(dir = mergeDir()): { holder?: Entry; queue: Entry[] } {
  if (!existsSync(dir)) return { queue: [] };
  let holder = read(join(dir, "lock"));
  if (holder && !alive(holder.pid)) { remove(join(dir, "lock")); holder = undefined; }
  else if (!holder && existsSync(join(dir, "lock"))) { remove(join(dir, "lock")); }
  const queue: Entry[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.startsWith("wait-")) continue;
    const w = read(join(dir, f));
    if (w && alive(w.pid)) queue.push(w); else remove(join(dir, f));
  }
  queue.sort((a, b) => a.since - b.since || a.pid - b.pid);
  return { ...(holder ? { holder } : {}), queue };
}

/** Takes the lock, waiting in line for it. `say` hears a line once a minute while it waits. */
export async function acquire(branches: string[], o: { say?: (line: string) => void; pollMs?: number } = {}): Promise<{ release(): void }> {
  const dir = mergeDir();
  mkdirSync(dir, { recursive: true });
  const body: Entry = { pid: process.pid, since: Date.now(), branches, cwd: process.cwd() };
  const waitFile = join(dir, `wait-${process.pid}`);
  writeFileSync(waitFile, JSON.stringify(body));
  const lockFile = join(dir, "lock");
  let held = false;
  const release = () => { remove(waitFile); if (held && read(lockFile)?.pid === process.pid) remove(lockFile); held = false; };
  process.on("exit", release);
  const say = o.say ?? ((l: string) => console.error(l));
  const t0 = Date.now();
  let said = 0;
  for (;;) {
    const s = mergeState(dir);
    if (!s.holder && s.queue[0]?.pid === process.pid && claim(dir, "lock", body)) { held = true; remove(waitFile); return { release }; }
    if (Date.now() - t0 > 2000 && (!said || Date.now() - said > 60_000)) {
      said = Date.now();
      say(`merge: waiting ${Math.round((Date.now() - t0) / 1000)} s for the merge lock, held by pid ${s.holder?.pid ?? "?"} (${s.holder?.branches.join(", ") ?? "?"}); ${Math.max(0, s.queue.findIndex((w) => w.pid === process.pid))} ahead   [bun scripts/status.ts]`);
    }
    if (!existsSync(waitFile)) writeFileSync(waitFile, JSON.stringify(body)); // (a cleanup removed it: back in line)
    await Bun.sleep(o.pollMs ?? 500);
  }
}

/** The pre-push hook's source, and where it goes: the repository's common hooks folder, shared by every worktree. */
export const HOOK = join(import.meta.dir, "hooks", "pre-push");
export function installHook(gitCommonDir: string): boolean {
  if (!existsSync(HOOK)) return false;
  const to = join(gitCommonDir, "hooks", "pre-push");
  const text = readFileSync(HOOK, "utf8");
  if (existsSync(to) && readFileSync(to, "utf8") === text) return false;
  mkdirSync(join(gitCommonDir, "hooks"), { recursive: true });
  writeFileSync(to, text, { mode: 0o755 });
  return true;
}

if (import.meta.main) {
  const [cmd] = process.argv.slice(2);
  if (cmd === "status") {
    const s = mergeState();
    const ago = (t: number) => `${Math.round((Date.now() - t) / 60_000)} min`;
    console.log(s.holder ? `merging: pid ${s.holder.pid} for ${ago(s.holder.since)}: ${s.holder.branches.join(", ")}` : "no merge running");
    for (const w of s.queue) if (w.pid !== s.holder?.pid) console.log(`  queued: pid ${w.pid} for ${ago(w.since)}: ${w.branches.join(", ")}`);
  } else if (cmd === "install-hook") {
    const common = Bun.spawnSync(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"]).stdout.toString().trim();
    console.log(installHook(common) ? `installed ${join(common, "hooks/pre-push")}` : "hook already current");
  } else { console.error("usage: bun scripts/merge-lock.ts status | install-hook"); process.exit(2); }
}
