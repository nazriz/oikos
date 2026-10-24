// The merge lock (scripts/merge-lock.ts): one merge at a time, the next in line waits and then goes, a dead holder's
// lock is taken over; and the pre-push hook refuses a push to main from anyone not holding it.

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const lockLib = join(import.meta.dir, "merge-lock.ts");
const hook = join(import.meta.dir, "hooks", "pre-push");

test("one merge at a time: the second waits for the first, then goes; a dead holder's lock is taken", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oikos-merge-lock-"));
  const order = join(dir, "order");
  try {
    const merge = (name: string, ms: number) => Bun.spawn(["bun", "-e", `import { acquire } from ${JSON.stringify(lockLib)}; import { appendFileSync } from "node:fs";
      const l = await acquire([${JSON.stringify(name)}], { pollMs: 50, say: () => {} }); appendFileSync(${JSON.stringify(order)}, "${name} in\\n"); await Bun.sleep(${ms}); appendFileSync(${JSON.stringify(order)}, "${name} out\\n"); l.release();`], { env: { ...process.env, OIKOS_MERGE_DIR: dir }, stdout: "pipe", stderr: "pipe" });
    const a = merge("a", 600);
    await Bun.sleep(300);
    const b = merge("b", 10);
    expect([await a.exited, await b.exited]).toEqual([0, 0]);
    expect(readFileSync(order, "utf8").trim().split("\n")).toEqual(["a in", "a out", "b in", "b out"]);
    // A lock naming a pid that is gone is taken over at once.
    writeFileSync(join(dir, "lock"), JSON.stringify({ pid: 2 ** 22 + 4321, since: 1, branches: ["ghost"], cwd: "/" }));
    const c = merge("c", 10);
    expect(await c.exited).toBe(0);
    expect(readFileSync(order, "utf8")).toContain("c out");
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 60_000);

test("the pre-push hook: a push to main only with the lock held; other branches always", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oikos-merge-hook-"));
  try {
    const push = (ref: string, env: Record<string, string>) => {
      const p = Bun.spawnSync(["sh", hook, "origin", "url"], { stdin: Buffer.from(`refs/heads/x abc ${ref} def\n`), env: { PATH: process.env.PATH ?? "", HOME: dir, OIKOS_MERGE_DIR: dir, ...env }, stdout: "pipe", stderr: "pipe" });
      return { code: p.exitCode, err: p.stderr.toString() };
    };
    expect(push("refs/heads/feature", {}).code).toBe(0);
    const refused = push("refs/heads/main", {});
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("Only scripts/merge.ts pushes to main");
    expect(push("refs/heads/main", { OIKOS_MERGE_LOCK: "4242" }).code).toBe(1); // (no lock held by 4242)
    writeFileSync(join(dir, "lock"), JSON.stringify({ pid: 4242, since: 1, branches: ["x"], cwd: "/" }));
    expect(push("refs/heads/main", { OIKOS_MERGE_LOCK: "4242" }).code).toBe(0);
    expect(push("refs/heads/main", { OIKOS_MERGE_LOCK: "424" }).code).toBe(1); // (a prefix of the holder's pid is not it)
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
