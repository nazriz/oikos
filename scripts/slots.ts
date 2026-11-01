#!/usr/bin/env bun
// A machine-wide limit on heavy jobs: a pool of tokens ("slots") shared by every checkout and worktree of this user,
// so that several suites, builds and batches of runs share the cores instead of each taking all of them.
//   as a wrapper:  bun scripts/slots.ts [--weight K|half] [--priority high] [--what TEXT] -- <command...>
//   to look:       bun scripts/slots.ts status
//   as a library:  const slot = await take(1, "what it is"); try { ... } finally { slot.release(); }
// A token is a file `slot-<i>` in one directory outside any repo (~/.oikos/slots, or OIKOS_SLOTS_DIR), made by a hard
// link from a finished temporary file: taking one is atomic, and a token is never seen half written. It records the
// holder's pid, when it was taken, what for and where. A token whose holder is dead is reclaimed (under a short lock,
// so two reclaimers never remove a token a third has just taken). The pool follows the machine (below: elastic;
// OIKOS_SLOTS=N fixes it at N; OIKOS_SLOTS=off turns all of this off: every take succeeds at once). Waiters stand in a queue (files
// `wait-<pid>-<n>`, the oldest first), so a job of any weight gets its turn; a job asking more than the pool gets the
// whole pool. A process started inside a slot is marked by OIKOS_SLOT_HELD=<weight> in its environment and takes
// nothing more: a holder's children never wait on their parent (no deadlock against oneself). Where the mark is lost
// (a child given an environment of its own), a process one of whose ancestors holds a token takes nothing either.
// `bun test` run by hand takes one token for its process (scripts/slots-preload.ts, named in bunfig.toml).
// A job given priority (--priority high, OIKOS_SLOT_PRIORITY=high, inherited by its children: the merge's) stands ahead of
// every job without it in the queue, and a job without it never takes tokens past a waiting job with it. Nothing running
// is stopped: it starts when the next tokens are free.
// A cap per agent (2026-10-24): an agent is a checkout (the git worktree a job runs in; OIKOS_SLOT_OWNER names another),
// and no agent holds more than a quarter of the pool (OIKOS_SLOT_CAP=N, or none). A job asks at most the cap (a build
// asking half the cores gets the cap, and compiles that many at a time). Two kinds of job may go past it: the merge's
// (priority high: one batch at a time, by the merge lock), and a job that borrows (the test runner's tokens, held for one
// test file each: seconds), and that only while no other agent is waiting; once one is, the borrower takes nothing more
// until it is back under its cap, and its borrowed tokens come back as its files end.
// Elastic (2026-10-31, PL-4): with OIKOS_SLOTS unset the pool is the core count, and a job that is not the merge's starts
// only when the machine has room for it as it is now (`fits`): the load average plus what holders younger than a minute
// are expected to use (they are not in the load yet) plus the job's own expected use stay within the cores, and the free
// memory less what those young holders are still expected to grow into leaves the job's expected memory and a reserve. What a job is expected to use is by its class (test, build, run, other): a declared
// figure per token, replaced by the measured one (a moving average of cpu time over wall time, and peak memory, per token)
// once jobs of that class have ended under the wrapper or the test runner (`usage.json` beside the tokens). A job alone in
// the pool always starts; the head of the queue waits for room and nobody passes it. OIKOS_SLOTS=N fixes the pool at N
// with no reading of the machine, as before.
// Waiting changes when a job starts and nothing else: nothing here is read by a run.

import { existsSync, linkSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { availableParallelism, homedir, loadavg, totalmem, freemem } from "node:os";
import { dirname, join } from "node:path";

export interface Slot { weight: number; release(used?: Used): void }
/** What a job measured of itself when it ended: cpu time (its own and its waited children's), wall time, peak memory. */
export interface Used { cpuMs: number; wallMs: number; rssBytes: number }
export type JobClass = "test" | "build" | "run" | "other";
interface Holder { pid: number; since: number; what: string; cwd: string; priority?: number; owner?: string; borrow?: boolean; cap?: number | null; cls?: JobClass }
interface Waiter extends Holder { weight: number; file: string }

export const slotsDir = () => process.env.OIKOS_SLOTS_DIR ?? join(homedir(), ".oikos", "slots");
export const slotsOff = () => (process.env.OIKOS_SLOTS ?? "").toLowerCase() === "off";
const fixedPool = () => { const n = Number(process.env.OIKOS_SLOTS); return Number.isInteger(n) && n > 0 ? n : 0; };
/** Whether the pool follows the machine (OIKOS_SLOTS unset): see `fits`. */
export const elastic = () => !slotsOff() && !fixedPool();
/** How many tokens the pool has at most: OIKOS_SLOTS=N, or the cores (how many of them may be held now is `fits`'s). */
export function poolSize(): number {
  return fixedPool() || Math.max(1, availableParallelism());
}

/** The machine as it is now. */
export interface Readings { cores: number; load: number; freeMem: number; totalMem: number; now: number }
/** What one token of a class is expected to use: cores, and bytes of memory. */
export interface Use { cores: number; mem: number }
const GiB = 2 ** 30;
/**
 * Declared until measured: a token is a core (a build's cargo runs half as many jobs as tokens, each rustc several
 * threads: about one core a token); memory a guess per token, a test file's smaller.
 */
export const DECLARED: Record<JobClass, Use> = { test: { cores: 1, mem: 0.5 * GiB }, build: { cores: 1, mem: 1 * GiB }, run: { cores: 1, mem: 1 * GiB }, other: { cores: 1, mem: 1 * GiB } };
/** How long a new holder is not yet in the readings (the load average's minute; its memory still to grow): until then its expected use is added to them. */
export const GROWING_MS = 60_000;
/** The memory always left free: a tenth of the machine's, and at least 1 GiB. */
export const memReserve = (total: number) => Math.max(GiB, total / 10);
/**
 * The elastic rule: whether a job of `weight` tokens of class `cls` may start now, given who holds tokens (one entry a
 * token) and the machine's readings. Pure: the same readings give the same answer in every process. The merge's always
 * may (the static pool and the queue still hold it); a job may when nothing is held (so something always runs); otherwise
 * when cores and memory both have room for it.
 */
export function fits(job: { weight: number; cls?: JobClass; priority?: number }, holders: { cls?: JobClass; since: number }[], r: Readings, use: Partial<Record<JobClass, Use>> = {}): boolean {
  if ((job.priority ?? 0) > 0 || !holders.length) return true;
  const u = (c?: JobClass) => use[c ?? "other"] ?? DECLARED[c ?? "other"];
  // (Older holders are in the readings already. Not the larger of the load and every holder's expected use: a build's
  // measured average, 3.3 cores a token, held a lone test file back on 2026-10-31 while the build's last rustc used one.)
  const young = holders.filter((h) => r.now - h.since < GROWING_MS);
  const need = u(job.cls);
  return r.load + young.reduce((a, h) => a + u(h.cls).cores, 0) + job.weight * need.cores <= r.cores
    && r.freeMem - young.reduce((a, h) => a + u(h.cls).mem, 0) - job.weight * need.mem >= memReserve(r.totalMem);
}

/** Free memory as the system means it: what can be had without swapping (Linux MemAvailable; macOS free, inactive, speculative and purgeable pages). */
export function freeMemory(): number {
  try {
    if (process.platform === "linux") {
      const m = /^MemAvailable:\s+(\d+) kB/m.exec(readFileSync("/proc/meminfo", "utf8"));
      if (m) return Number(m[1]) * 1024;
    } else if (process.platform === "darwin") {
      const out = Bun.spawnSync(["vm_stat"]).stdout.toString();
      const page = Number(/page size of (\d+) bytes/.exec(out)?.[1] ?? 4096);
      const pages = (name: string) => Number(new RegExp(`^Pages ${name}:\\s+(\\d+)`, "m").exec(out)?.[1] ?? 0);
      const n = pages("free") + pages("inactive") + pages("speculative") + pages("purgeable");
      if (n) return n * page;
    }
  } catch { /* fall through */ }
  return freemem();
}
export const readings = (): Readings => ({ cores: availableParallelism(), load: loadavg()[0] ?? 0, freeMem: freeMemory(), totalMem: totalmem(), now: Date.now() });

const usagePath = (dir = slotsDir()) => join(dir, "usage.json");
/** The measured use per token of each class (a moving average), where any has been measured. */
export function measuredUse(dir = slotsDir()): Partial<Record<JobClass, Use>> {
  try { return JSON.parse(readFileSync(usagePath(dir), "utf8")); } catch { return {}; }
}
/** A job shorter than this teaches nothing (`cargo --version` would teach a build uses a fourteenth of a core). */
export const MEASURE_MIN_MS = 2000;
/** Folds one ended job into its class's average: new = 0.7 old + 0.3 this one (the first measured stands alone). */
export function foldUse(old: Use | undefined, used: Used, tokens: number): Use | undefined {
  if (!(used.wallMs >= MEASURE_MIN_MS) || !(tokens > 0)) return old;
  const now = { cores: used.cpuMs / used.wallMs / tokens, mem: used.rssBytes / tokens };
  return old ? { cores: 0.7 * old.cores + 0.3 * now.cores, mem: 0.7 * old.mem + 0.3 * now.mem } : now;
}
function recordUse(dir: string, cls: JobClass, used: Used, tokens: number): void {
  try {
    const all = measuredUse(dir);
    const next = foldUse(all[cls], used, tokens);
    if (!next) return;
    all[cls] = next;
    const tmp = join(dir, `.usage-${process.pid}-${serial++}`);
    writeFileSync(tmp, JSON.stringify(all));
    renameSync(tmp, usagePath(dir)); // (two writers at once: one update is lost, no file is half written)
  } catch { /* a measurement lost costs nothing but accuracy */ }
}
/** What a spawned child used, for `release`. */
export const usedBy = (p: { resourceUsage(): { cpuTime: { total: bigint | number }; maxRSS: number | bigint } | undefined }, t0: number): Used | undefined => {
  const r = p.resourceUsage();
  return r ? { cpuMs: Number(r.cpuTime.total) / 1000, wallMs: Date.now() - t0, rssBytes: Number(r.maxRSS) } : undefined;
};
/** Priority 1 (the merge's) goes ahead of 0 (everything else) in the queue; OIKOS_SLOT_PRIORITY=high sets it for a process and its children. */
export const defaultPriority = () => ((process.env.OIKOS_SLOT_PRIORITY ?? "").toLowerCase() === "high" ? 1 : 0);
/** The queue's order: higher priority first, then the oldest. */
export const queueOrder = (a: { priority?: number; since: number; pid: number; file: string }, b: { priority?: number; since: number; pid: number; file: string }) =>
  (b.priority ?? 0) - (a.priority ?? 0) || a.since - b.since || a.pid - b.pid || (a.file < b.file ? -1 : 1);
/** The checkout a directory belongs to (the nearest folder above it with a `.git`): the agent, for the cap. */
export function ownerOf(cwd: string): string {
  for (let d = cwd; d && d !== "/"; d = dirname(d)) if (existsSync(join(d, ".git"))) return d;
  return cwd;
}
const myOwner = () => process.env.OIKOS_SLOT_OWNER || ownerOf(process.cwd());
/** The most tokens one agent holds: a quarter of the pool (OIKOS_SLOT_CAP=N sets it, "none" lifts it). */
export function capSize(size = poolSize()): number {
  const c = (process.env.OIKOS_SLOT_CAP ?? "").toLowerCase();
  if (c === "none" || c === "off") return Infinity;
  const n = Number(c);
  return c && Number.isInteger(n) && n > 0 ? n : Math.max(1, Math.floor(size / 4));
}
/**
 * Whether a waiter may take its tokens now, by the cap: the merge's always; anyone whose agent would stay within the cap;
 * a borrower past it only while no other agent waits. (Its own part-taken tokens are not counted against it.)
 */
export function eligible(w: { pid: number; since: number; weight: number; owner?: string; cwd: string; priority?: number; borrow?: boolean; cap?: number | null }, holders: { pid: number; since: number; owner?: string; cwd: string }[], waiters: { owner?: string; cwd: string }[], defaultCap: number): boolean {
  if ((w.priority ?? 0) > 0) return true;
  // (The waiter's own cap, as it recorded it, so that every process judges the queue alike; null: none.)
  const cap = w.cap === null ? Infinity : w.cap ?? defaultCap;
  const owner = w.owner ?? ownerOf(w.cwd);
  const held = holders.filter((h) => (h.owner ?? ownerOf(h.cwd)) === owner && !(h.pid === w.pid && h.since === w.since)).length;
  if (held + w.weight <= cap) return true;
  return !!w.borrow && !waiters.some((x) => (x.owner ?? ownerOf(x.cwd)) !== owner);
}
/** The weight of the slot this process was started inside (0: none). */
export const heldByParent = () => Number(process.env.OIKOS_SLOT_HELD) || 0;
/**
 * The head of the queue: the first waiter the cap lets take. A waiter written by a checkout on an older slots.ts (no
 * `cap` in its file: from before the cap, 2026-10-24) is passed over: it waits for the strict oldest itself, and a
 * capped job ahead of it would otherwise hold every waiter of both versions for ever (seen 2026-10-24, 41 waiting with
 * 3 tokens free). It takes its turn once it is the oldest and nobody ahead of it is held back.
 */
export function headOf<W extends Parameters<typeof eligible>[0]>(waiters: W[], holders: Parameters<typeof eligible>[1], defaultCap: number): W | undefined {
  return waiters.find((w) => "cap" in w && eligible(w, holders, waiters, defaultCap));
}

/** Cargo jobs for a build holding `tokens`: half, since one rustc uses several cores (2026-10-24, load 30 on 14 cores). */
export const buildJobs = (tokens: number) => Math.max(1, Math.ceil(tokens / 2));

/**
 * The environment for a child started inside a slot of this weight. The engine runs as many threads as the slot's weight
 * (OIKOS_ENGINE_THREADS, unless set): with every core by default, a town in a slot of 1 used fourteen, and the machine ran
 * at load 44 on 14 cores (2026-10-25). Results do not depend on the thread count (the kernel's tests check one against many).
 */
export const insideSlot = (weight: number, env: Record<string, string | undefined> = process.env) => {
  const w = Math.max(weight, heldByParent(), 1);
  return { ...env, OIKOS_SLOT_HELD: String(w), OIKOS_ENGINE_THREADS: env.OIKOS_ENGINE_THREADS ?? String(w) };
};

/** Whether a process this one descends from holds a token (the mark in the environment can be lost on the way). */
function ancestorHolds(dir: string): boolean {
  let names: string[];
  try { names = readdirSync(dir).filter((f) => f.startsWith("slot-")); } catch { return false; }
  const holders = new Set(names.map((f) => read(join(dir, f))?.pid).filter((p) => p !== undefined && p !== process.pid));
  if (!holders.size) return false;
  const parent = new Map<number, number>();
  for (const line of Bun.spawnSync(["ps", "-A", "-o", "pid=,ppid="]).stdout.toString().split("\n")) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (pid) parent.set(pid, ppid ?? 0);
  }
  for (let p = parent.get(process.pid), n = 0; p && p > 1 && n < 64; p = parent.get(p), n++) if (holders.has(p)) return true;
  return false;
}

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; } };
const read = (path: string): Holder | undefined => { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return undefined; } };
const remove = (path: string) => { try { unlinkSync(path); } catch { /* already gone */ } };

let serial = 0;
const mine = new Set<string>(); // token and waiter files this process has, removed when it exits
let exitHooked = false;
function hookExit() {
  if (exitHooked) return;
  exitHooked = true;
  process.on("exit", () => { for (const f of mine) remove(f); });
}

/** A file made whole and then linked into place: true if the name was free. */
function claim(dir: string, name: string, body: object): boolean {
  const tmp = join(dir, `.tmp-${process.pid}-${serial++}`);
  writeFileSync(tmp, JSON.stringify(body));
  try { linkSync(tmp, join(dir, name)); return true; } catch { return false; } finally { remove(tmp); }
}

/** Removes a token whose holder is dead. Under a lock (a directory; one left by a dead process is stale after 10 s). */
function reclaim(dir: string, name: string): void {
  const lock = join(dir, ".reclaim");
  try { mkdirSync(lock); } catch {
    try { if (Date.now() - statSync(lock).mtimeMs > 10_000) rmdirSync(lock); } catch { /* gone meanwhile */ }
    return; // someone else is reclaiming: look again on the next round
  }
  try {
    const h = read(join(dir, name));
    if (h ? !alive(h.pid) : existsSync(join(dir, name))) remove(join(dir, name));
  } finally { try { rmdirSync(lock); } catch { /* gone */ } }
}

/** Who holds tokens and who waits, the dead left out (their files are removed on the way). */
export function state(dir = slotsDir()): { size: number; holders: (Holder & { slot: string })[]; waiters: Waiter[] } {
  const holders: (Holder & { slot: string })[] = [], waiters: Waiter[] = [];
  if (existsSync(dir)) for (const f of readdirSync(dir).sort()) {
    if (f.startsWith("slot-")) {
      const h = read(join(dir, f));
      if (h && alive(h.pid)) holders.push({ ...h, slot: f });
      else reclaim(dir, f);
    } else if (f.startsWith("own-")) {
      const h = read(join(dir, f));
      if (!h || !alive(h.pid)) reclaim(dir, f);
    } else if (f.startsWith("wait-")) {
      const w = read(join(dir, f)) as Waiter | undefined;
      if (w && alive(w.pid)) waiters.push({ ...w, file: f });
      else if (w || Date.now() - (statSync(join(dir, f), { throwIfNoEntry: false })?.mtimeMs ?? Date.now()) > 10_000) remove(join(dir, f));
    }
  }
  waiters.sort(queueOrder);
  return { size: poolSize(), holders, waiters };
}

/**
 * Takes `weight` tokens, waiting for them if need be. Inside a slot already (a holder's child), or with slots off,
 * it returns at once holding nothing. `cancel` is asked while waiting: true gives up (the result is then undefined).
 */
export async function take(weight = 1, what = process.argv.slice(1, 3).join(" "), o: { priority?: number; borrow?: boolean; cls?: JobClass; cancel?: () => boolean; say?: (line: string) => void; pollMs?: number } = {}): Promise<Slot | undefined> {
  const nothing: Slot = { weight: 0, release() {} };
  if (slotsOff() || heldByParent()) return nothing;
  const dir = slotsDir();
  mkdirSync(dir, { recursive: true });
  if (ancestorHolds(dir)) return nothing;
  hookExit();
  const size = poolSize();
  if (!Number.isFinite(weight)) throw new Error(`slots: ${weight} is not a weight (a number of tokens)`);
  const priority = o.priority ?? defaultPriority();
  const cap = capSize(size);
  const want = Math.max(1, Math.min(size, priority ? Infinity : cap, Math.round(weight)));
  const body = { pid: process.pid, since: Date.now(), what, cwd: process.cwd(), owner: myOwner(), ...(priority ? { priority } : {}), ...(o.borrow ? { borrow: true } : {}), cap: Number.isFinite(cap) ? cap : null, cls: o.cls ?? (o.borrow ? "test" : "other") };
  const me = { ...body, weight: want };
  const got: string[] = [];
  const release = (used?: Used) => {
    const tokens = got.filter((f) => f.includes("/slot-")).length;
    for (const f of got.splice(0)) { remove(f); mine.delete(f); }
    if (used && tokens) recordUse(dir, body.cls, used, tokens);
  };
  // (The machine is read only by a job about to take: the head of the queue, or one that finds nobody waiting.)
  const room = (holders: { cls?: JobClass; since: number }[]) => !elastic() || fits(me, holders, readings(), measuredUse(dir));
  // The cap is held by tokens of the checkout's own (`own-<checkout>-<i>`, i below the cap), taken before the pool's, so
  // that two jobs of one checkout starting at once cannot both find it under its cap. A borrower past the cap takes the
  // pool's alone, and only while no other checkout waits.
  const tag = Bun.hash(body.owner).toString(36);
  const capped = !priority && Number.isFinite(cap);
  const grab = (s: { waiters: Waiter[] }) => {
    if (capped) {
      let mineNow = got.filter((f) => f.includes(`/own-${tag}-`)).length;
      for (let i = 0; i < cap && mineNow < want; i++) {
        const path = join(dir, `own-${tag}-${i}`);
        if (got.includes(path)) continue;
        if (claim(dir, `own-${tag}-${i}`, body)) { got.push(path); mine.add(path); mineNow++; }
      }
      if (mineNow < want && !(o.borrow && !s.waiters.some((w) => (w.owner ?? ownerOf(w.cwd)) !== body.owner))) { release(); return false; }
    }
    let n = got.filter((f) => f.includes("/slot-")).length;
    for (let i = 0; i < size && n < want; i++) {
      const path = join(dir, `slot-${i}`);
      if (got.includes(path)) continue;
      if (claim(dir, `slot-${i}`, body)) { got.push(path); mine.add(path); n++; }
    }
    return n >= want;
  };
  // Nobody waiting: straight to the tokens. Otherwise, and if they aren't all free, into the queue.
  // (Tokens are held while waiting only by the head of the queue: a part taken here is given back first.)
  const s0 = state(dir);
  if (!s0.waiters.some((w) => (w.priority ?? 0) >= priority) && eligible(me, s0.holders, s0.waiters, cap) && room(s0.holders) && grab(s0)) return { weight: want, release };
  release();
  const waitName = `wait-${process.pid}-${serial++}`;
  const waitFile = join(dir, waitName);
  claim(dir, waitName, { ...body, weight: want });
  mine.add(waitFile);
  const leave = () => { remove(waitFile); mine.delete(waitFile); };
  const say = o.say ?? ((line: string) => console.error(line));
  const t0 = Date.now();
  let said = 0;
  for (;;) {
    if (o.cancel?.()) { release(); leave(); return undefined; }
    const s = state(dir); // (also reclaims the tokens of the dead)
    // (The queue's directory emptied under us, by a cleanup: back into it, rather than wait for ever outside it.)
    if (!s.waiters.some((w) => w.file === waitName)) { mkdirSync(dir, { recursive: true }); claim(dir, waitName, { ...body, weight: want }); await Bun.sleep(o.pollMs ?? 250); continue; }
    // Only the head of the queue takes tokens (it may hold some while it waits for the rest: nobody else is taking). The
    // head is the first waiter the cap lets take; a waiter held back by its agent's cap lets the next one go.
    const head = headOf(s.waiters, s.holders, cap);
    // (A head the machine has no room for yet waits, holding nothing, and nobody passes it: a big job is not starved by small ones.)
    const roomNow = head?.file !== waitName || room(s.holders.filter((h) => !(h.pid === me.pid && h.since === me.since)));
    if (head?.file === waitName && !roomNow && got.length) release();
    if (head?.file === waitName && roomNow && grab(s)) { leave(); return { weight: want, release }; }
    // (Another is the head now, a merge or an agent under its cap: the tokens we held while we were the head go back.)
    if (head?.file !== waitName && got.length) release();
    const waited = Date.now() - t0;
    if (waited >= 2000 && (!said || Date.now() - said >= 60_000)) {
      said = Date.now();
      const ahead = Math.max(0, s.waiters.findIndex((w) => w.file === waitName));
      const mine = s.holders.filter((h) => (h.owner ?? ownerOf(h.cwd)) === body.owner).length;
      const capped = !priority && mine + want > cap ? `; this checkout holds ${mine}, its cap is ${cap}` : "";
      say(`slots: waiting ${Math.round(waited / 1000)} s so far for ${want} of ${size} (${s.holders.length} held, ${ahead} ahead in the queue${capped}): ${what}   [bun scripts/slots.ts status]`);
    }
    await Bun.sleep(o.pollMs ?? 250);
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const ago = (t: number) => { const s = Math.round((Date.now() - t) / 1000); return s < 120 ? `${s} s` : s < 7200 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`; };
  if (args[0] === "status") {
    if (slotsOff()) console.log("slots are off (OIKOS_SLOTS=off)");
    const s = state();
    console.log(`${s.holders.length} of ${s.size} slots held, ${s.waiters.length} waiting (${slotsDir()}); cap per checkout ${capSize(s.size)}`);
    if (elastic()) {
      const r = readings(), use = measuredUse();
      const per = (Object.keys(DECLARED) as JobClass[]).map((c) => `${c} ${(use[c] ?? DECLARED[c]).cores.toFixed(2)} cores ${((use[c] ?? DECLARED[c]).mem / GiB).toFixed(1)} GiB${use[c] ? "" : " (declared)"}`).join("; ");
      console.log(`elastic: load ${r.load.toFixed(1)} on ${r.cores} cores, ${(r.freeMem / GiB).toFixed(1)} of ${(r.totalMem / GiB).toFixed(1)} GiB free; a token of another job ${fits({ weight: 1 }, s.holders, r, use) ? "would start now" : "would wait for room"}. Per token: ${per}`);
    }
    const by = new Map<string, (typeof s.holders)>();
    for (const h of s.holders) by.set(`${h.pid} ${h.since}`, [...(by.get(`${h.pid} ${h.since}`) ?? []), h]);
    for (const hs of by.values()) console.log(`  held ${String(hs.length).padStart(2)}  pid ${hs[0]!.pid}  for ${ago(hs[0]!.since)}  ${hs[0]!.what}  (${hs[0]!.cwd})`);
    for (const w of s.waiters) console.log(`  waits ${String(w.weight).padStart(2)}${w.priority ? " HIGH" : ""} pid ${w.pid}  for ${ago(w.since)}  ${w.what}  (${w.cwd})`);
    process.exit(0);
  }
  // (Options come first; the command starts after `--`, or at the first word that is not an option: bun itself takes
  // a `--` that follows the script's name.)
  const opts: Record<string, string> = {};
  while (args[0]?.startsWith("--") && args[0] !== "--") opts[args.shift()!.slice(2)] = args.shift() ?? "";
  if (args[0] === "--") args.shift();
  if (!args.length || Object.keys(opts).some((k) => k !== "weight" && k !== "what" && k !== "priority")) { console.error("usage: bun scripts/slots.ts [--weight K|half] [--priority high] [--what TEXT] -- <command...> | status"); process.exit(2); }
  const opt = (name: string) => opts[name];
  const w = opt("weight") ?? "1";
  // (A weight that is no weight is refused, with the ones there are: `--weight heavy` once waited 29 minutes behind
  // other jobs without a word, since a number that is not one never fits the pool: the third living pilot's review.)
  if (w !== "half" && !/^[1-9][0-9]{0,3}$/.test(w)) { console.error(`slots: "${w}" is not a weight. The weights: a whole number of tokens from 1 (1 by default; more than the pool takes the whole pool), or "half" (half the cores, as the kernel's build takes).`); process.exit(2); }
  const weight = w === "half" ? Math.ceil(availableParallelism() / 2) : Number(w);
  const cmd = args;
  if (opt("priority") !== undefined && opt("priority") !== "high" && opt("priority") !== "normal") { console.error('slots: --priority is "high" (the merge\'s: ahead of the queue) or "normal"'); process.exit(2); }
  const high = opt("priority") === "high" || (opt("priority") === undefined && defaultPriority() === 1);
  // (A cargo command is a build: its use per token is learned apart from everything else's.)
  const cls: JobClass = /\bcargo\b/.test(cmd.join(" ")) ? "build" : "other";
  const slot = await take(weight, opt("what") ?? cmd.join(" ").slice(0, 80), { priority: high ? 1 : 0, cls });
  // (A build given K tokens compiles K at a time: cargo's own default is every core, whatever else is running.)
  const env = { ...insideSlot(weight), ...(high ? { OIKOS_SLOT_PRIORITY: "high" } : {}), ...(slot?.weight && slot.weight > 1 && !process.env.CARGO_BUILD_JOBS ? { CARGO_BUILD_JOBS: String(buildJobs(slot.weight)) } : {}) };
  const t0 = Date.now();
  const child = Bun.spawn(cmd, { stdin: "inherit", stdout: "inherit", stderr: "inherit", env });
  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as const) process.on(sig, () => child.kill(sig));
  const code = await child.exited;
  slot?.release(child.signalCode ? undefined : usedBy(child, t0));
  process.exit(child.signalCode ? 128 + (({ SIGHUP: 1, SIGINT: 2, SIGTERM: 15 } as Record<string, number>)[child.signalCode] ?? 1) : code);
}
