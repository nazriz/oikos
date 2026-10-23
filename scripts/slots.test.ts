// The machine-wide slots (scripts/slots.ts), each test with a pool of its own in a temporary directory: concurrent
// takers never exceed the pool, a dead holder's tokens are reclaimed, a holder's child takes nothing (no deadlock),
// a heavy job gets its turn, and "off" is off.

import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const slots = join(import.meta.dir, "slots.ts");
const pool = () => mkdtempSync(join(tmpdir(), "oikos-slots-"));
/** The environment of a process outside any slot, with this pool. */
const env = (dir: string, size: number | "off", more: Record<string, string> = {}) => {
  const e: Record<string, string | undefined> = { ...process.env, OIKOS_SLOTS_DIR: dir, OIKOS_SLOTS: String(size), ...more };
  if (!("OIKOS_SLOT_HELD" in more)) delete e.OIKOS_SLOT_HELD;
  return e;
};
async function sh(cmd: string[], e: Record<string, string | undefined>) {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", env: e });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out, err };
}
/** A job that appends "+" when it starts and "-" when it ends to a shared file, 300 ms apart. */
const job = (trace: string) => ["sh", "-c", `printf + >> ${trace}; sleep 0.3; printf -- - >> ${trace}`];
const peak = (trace: string) => { let now = 0, max = 0; for (const c of existsSync(trace) ? readFileSync(trace, "utf8") : "") { now += c === "+" ? 1 : -1; max = Math.max(max, now); } return max; };

test("concurrent takers never hold more than the pool, and all of them get through", async () => {
  const dir = pool(), trace = join(dir, "trace");
  try {
    const done = await Promise.all(Array.from({ length: 9 }, () => sh(["bun", slots, "--", ...job(trace)], env(dir, 3))));
    expect(done.map((d) => d.code)).toEqual(Array(9).fill(0));
    expect(peak(trace)).toBeLessThanOrEqual(3);
    expect(peak(trace)).toBeGreaterThanOrEqual(2);
    expect(readdirSync(dir).filter((f) => f.startsWith("slot-") || f.startsWith("wait-"))).toEqual([]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 120_000);

test("weights count: jobs of weight 2 in a pool of 4 run two at a time, and a weight above the pool takes the whole pool", async () => {
  const dir = pool(), trace = join(dir, "trace");
  try {
    await Promise.all(Array.from({ length: 5 }, () => sh(["bun", slots, "--weight", "2", "--", ...job(trace)], env(dir, 4))));
    expect(peak(trace)).toBe(2);
    writeFileSync(trace, "");
    const big = await Promise.all(Array.from({ length: 3 }, () => sh(["bun", slots, "--weight", "99", "--", ...job(trace)], env(dir, 4))));
    expect(big.map((d) => d.code)).toEqual([0, 0, 0]);
    expect(peak(trace)).toBe(1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 120_000);

test("a weight that is no weight is refused at once, with the weights there are; nothing is queued", async () => {
  // (`--weight heavy` waited 29 minutes behind other jobs in silence: the third living pilot's review, fault 8.)
  const dir = pool(), trace = join(dir, "trace");
  try {
    for (const w of ["heavy", "0", "-2", "1.5", ""]) {
      const r = await sh(["bun", slots, "--weight", w, "--", ...job(trace)], env(dir, 2));
      expect(r.code).toBe(2);
      expect(r.err).toContain(`"${w}" is not a weight`);
      expect(r.err).toContain('"half"');
    }
    expect(existsSync(trace) ? readFileSync(trace, "utf8") : "").toBe("");
    expect(readdirSync(dir).filter((f) => f.startsWith("slot-") || f.startsWith("wait-"))).toEqual([]);
    expect((await sh(["bun", slots, "--weight", "half", "--", ...job(trace)], env(dir, 2))).code).toBe(0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 120_000);

test("a dead holder's token is reclaimed", async () => {
  const dir = pool();
  try {
    // A holder killed outright (no chance to release): its token stays behind, naming a dead pid.
    const holder = Bun.spawn(["bun", slots, "--what", "doomed", "--", "sleep", "60"], { stdout: "pipe", stderr: "pipe", env: env(dir, 1) });
    for (let i = 0; i < 1200 && !readdirSync(dir).includes("slot-0"); i++) await Bun.sleep(50);
    expect(readdirSync(dir)).toContain("slot-0");
    holder.kill("SIGKILL");
    await holder.exited;
    expect(readdirSync(dir)).toContain("slot-0");
    const next = await sh(["bun", slots, "--", "echo", "through"], env(dir, 1));
    expect(next.code).toBe(0);
    expect(next.out).toContain("through");
    // And a token naming a pid that never was (a crash long ago) goes the same way.
    writeFileSync(join(dir, "slot-0"), JSON.stringify({ pid: 2 ** 22 + 12345, since: 1, what: "ghost", cwd: "/" }));
    expect((await sh(["bun", slots, "--", "echo", "again"], env(dir, 1))).out).toContain("again");
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 120_000);

test("a holder's child takes nothing: nested use does not deadlock, even in a pool of one", async () => {
  const dir = pool();
  try {
    const nested = await sh(["bun", slots, "--", "bun", slots, "--weight", "5", "--", "bun", slots, "status"], env(dir, 1));
    expect(nested.code).toBe(0);
    expect(nested.out).toMatch(/^1 of 1 slots held, 0 waiting/m);
    // The library, the same: inside a slot, take() returns at once holding nothing.
    // The mark lost on the way (a child given an environment without it): known by its ancestry, it still takes nothing.
    const lost = await sh(["bun", slots, "--", "env", "-u", "OIKOS_SLOT_HELD", "bun", slots, "--", "echo", "inner ran"], env(dir, 1));
    expect(lost.code).toBe(0);
    expect(lost.out).toContain("inner ran");
    const lib = await sh(["bun", "-e", `import { take } from ${JSON.stringify(slots)}; const s = await take(3, "x"); console.log("weight", s.weight);`], env(dir, 1, { OIKOS_SLOT_HELD: "1" }));
    expect(lib.out).toContain("weight 0");
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 120_000);

test("status names holders and waiters; a waiter says it waits; off takes nothing", async () => {
  const dir = pool();
  try {
    const holder = Bun.spawn(["bun", slots, "--what", "the holder", "--", "sleep", "6"], { stdout: "pipe", stderr: "pipe", env: env(dir, 1) });
    for (let i = 0; i < 1200 && !readdirSync(dir).includes("slot-0"); i++) await Bun.sleep(50);
    const waiter = sh(["bun", slots, "--what", "the waiter", "--", "echo", "after"], env(dir, 1));
    for (let i = 0; i < 1200 && !readdirSync(dir).some((f) => f.startsWith("wait-")); i++) await Bun.sleep(50);
    const status = await sh(["bun", slots, "status"], env(dir, 1));
    expect(status.out).toMatch(/^1 of 1 slots held, 1 waiting/m);
    expect(status.out).toMatch(/held +1 +pid \d+ .*the holder/);
    expect(status.out).toMatch(/waits +1 +pid \d+ .*the waiter/);
    const off = await sh(["bun", slots, "--", "echo", "straight"], env(dir, "off"));
    expect(off.out).toContain("straight");
    const w = await waiter;
    expect(w.out).toContain("after");
    expect(w.err).toMatch(/slots: waiting \d+ s so far for 1 of 1 .*the waiter/);
    expect(w.err.split("\n").filter((l) => l.startsWith("slots: waiting")).length).toBe(1);
    await holder.exited;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 120_000);

test("the wrapper passes on its command's exit code", async () => {
  const dir = pool();
  try {
    expect((await sh(["bun", slots, "--", "sh", "-c", "exit 7"], env(dir, 2))).code).toBe(7);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 120_000);

test("a job with priority high goes ahead of earlier waiters without it", async () => {
  const dir = pool(), order = join(dir, "order");
  try {
    const mark = (name: string) => ["sh", "-c", `echo ${name} >> ${order}; sleep 0.2`];
    const holder = sh(["bun", slots, "--", "sleep", "1.5"], env(dir, 1));
    await Bun.sleep(600);
    const normal = sh(["bun", slots, "--", ...mark("normal")], env(dir, 1));
    await Bun.sleep(600);
    const high = sh(["bun", slots, "--priority", "high", "--", ...mark("high")], env(dir, 1));
    const done = await Promise.all([holder, normal, high]);
    expect(done.map((d) => d.code)).toEqual([0, 0, 0]);
    expect(readFileSync(order, "utf8").trim().split("\n")).toEqual(["high", "normal"]);
    const bad = await sh(["bun", slots, "--priority", "urgent", "--", "true"], env(dir, 1));
    expect(bad.code).toBe(2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 60_000);

test("queueOrder: priority first, then the oldest", async () => {
  const { queueOrder } = await import("./slots");
  const w = (file: string, since: number, priority?: number) => ({ file, since, pid: 1, ...(priority ? { priority } : {}) });
  expect([w("a", 1), w("b", 2, 1), w("c", 0)].sort(queueOrder).map((x) => x.file)).toEqual(["b", "c", "a"]);
});
