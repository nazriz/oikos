#!/usr/bin/env bun
// A machine-wide limit on heavy jobs: a pool of tokens ("slots") shared by every checkout and worktree of this user,
// so that several suites, builds and batches of runs share the cores instead of each taking all of them.
//   as a wrapper:  bun scripts/slots.ts [--weight K|half] [--priority high] [--what TEXT] -- <command...>
//   to look:       bun scripts/slots.ts status
//   as a library:  const slot = await take(1, "what it is"); try { ... } finally { slot.release(); }
// A token is a file `slot-<i>` in one directory outside any repo (~/.oikos/slots, or OIKOS_SLOTS_DIR), made by a hard
// link from a finished temporary file: taking one is atomic, and a token is never seen half written. It records the
// holder's pid, when it was taken, what for and where. A token whose holder is dead is reclaimed (under a short lock,
// so two reclaimers never remove a token a third has just taken). The pool is the core count less two (OIKOS_SLOTS=N
// sets it; OIKOS_SLOTS=off turns all of this off: every take succeeds at once). Waiters stand in a queue (files
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
// Waiting changes when a job starts and nothing else: nothing here is read by a run.

import { existsSync, linkSync, mkdirSync, readdirSync, readFileSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { availableParallelism, homedir } from "node:os";
import { dirname, join } from "node:path";

export interface Slot { weight: number; release(): void }
interface Holder { pid: number; since: number; what: string; cwd: string; priority?: number; owner?: string; borrow?: boolean; cap?: number | null }
interface Waiter extends Holder { weight: number; file: string }

export const slotsDir = () => process.env.OIKOS_SLOTS_DIR ?? join(homedir(), ".oikos", "slots");
export const slotsOff = () => (process.env.OIKOS_SLOTS ?? "").toLowerCase() === "off";
/** How many tokens the pool has. */
export function poolSize(): number {
  const n = Number(process.env.OIKOS_SLOTS);
  return Number.isInteger(n) && n > 0 ? n : Math.max(1, availableParallelism() - 2);
}
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
export async function take(weight = 1, what = process.argv.slice(1, 3).join(" "), o: { priority?: number; borrow?: boolean; cancel?: () => boolean; say?: (line: string) => void; pollMs?: number } = {}): Promise<Slot | undefined> {
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
  const body = { pid: process.pid, since: Date.now(), what, cwd: process.cwd(), owner: myOwner(), ...(priority ? { priority } : {}), ...(o.borrow ? { borrow: true } : {}), cap: Number.isFinite(cap) ? cap : null };
  const me = { ...body, weight: want };
  const got: string[] = [];
  const release = () => { for (const f of got.splice(0)) { remove(f); mine.delete(f); } };
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
  if (!s0.waiters.some((w) => (w.priority ?? 0) >= priority) && eligible(me, s0.holders, s0.waiters, cap) && grab(s0)) return { weight: want, release };
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
    if (head?.file === waitName && grab(s)) { leave(); return { weight: want, release }; }
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
  const slot = await take(weight, opt("what") ?? cmd.join(" ").slice(0, 80), { priority: high ? 1 : 0 });
  // (A build given K tokens compiles K at a time: cargo's own default is every core, whatever else is running.)
  const env = { ...insideSlot(weight), ...(high ? { OIKOS_SLOT_PRIORITY: "high" } : {}), ...(slot?.weight && slot.weight > 1 && !process.env.CARGO_BUILD_JOBS ? { CARGO_BUILD_JOBS: String(buildJobs(slot.weight)) } : {}) };
  const child = Bun.spawn(cmd, { stdin: "inherit", stdout: "inherit", stderr: "inherit", env });
  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as const) process.on(sig, () => child.kill(sig));
  const code = await child.exited;
  slot?.release();
  process.exit(child.signalCode ? 128 + (({ SIGHUP: 1, SIGINT: 2, SIGTERM: 15 } as Record<string, number>)[child.signalCode] ?? 1) : code);
}
