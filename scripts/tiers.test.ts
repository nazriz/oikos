// The two tiers of the suite (scripts/test-tiers.json, docs/dev-machine.md): every test file is in exactly one; the
// slow tier is named file by file with why; the backstops are in the gate; the gate's files stay short; and CI runs
// both tiers on every push to main and nightly, so every assertion still runs somewhere.

import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repo = join(import.meta.dir, "..");
const runner = join(import.meta.dir, "test.ts");
const list = (...a: string[]) => {
  const p = Bun.spawnSync(["bun", runner, "--list", "--no-build", ...a], { cwd: repo, stdout: "pipe", stderr: "pipe", env: { ...process.env, OIKOS_SLOTS: "off" } });
  return p.stdout.toString().split("\n").filter((l) => /\.test\.ts$/.test(l));
};
const tiers = JSON.parse(readFileSync(join(import.meta.dir, "test-tiers.json"), "utf8")) as { slow: Record<string, string> };
const times = JSON.parse(readFileSync(join(import.meta.dir, "test-times.json"), "utf8")) as Record<string, number>;
/** The most a gate file may take (by test-times.json): the gate is to end in a minute or two on twelve slots. */
const GATE_FILE_MAX = 90;

test("every test file is in exactly one tier", () => {
  const all = list("--tier", "all"), gate = list("--tier", "gate"), slow = list("--tier", "slow");
  expect(all.length).toBeGreaterThan(200);
  expect(gate.filter((f) => slow.includes(f))).toEqual([]);
  expect([...gate, ...slow].sort()).toEqual([...all].sort());
  expect(slow.sort()).toEqual(Object.keys(tiers.slow).sort());
});

test("the slow tier names files that are there, each with why", () => {
  for (const [f, why] of Object.entries(tiers.slow)) {
    expect({ f, there: existsSync(join(repo, f)) }).toEqual({ f, there: true });
    expect({ f, why: why.length > 10 }).toEqual({ f, why: true });
  }
});

test("the backstops are in the gate, and every gate file is short", () => {
  const src = readFileSync(runner, "utf8");
  const backstops = JSON.parse(/const BACKSTOPS = (\[[^\]]*\])/.exec(src)![1]!) as string[];
  for (const b of ["generality", "no-god-view", "all-work-takes-time", "risks", "unstated-run", "invariants-gate"]) expect(backstops.some((f) => f.includes(`/${b}.test.ts`))).toBe(true);
  for (const b of backstops) expect({ b, slow: Object.hasOwn(tiers.slow, b), there: existsSync(join(repo, b)) }).toEqual({ b, slow: false, there: true });
  const long = list("--tier", "gate").filter((f) => (times[f] ?? 0) > GATE_FILE_MAX).map((f) => `${f} ${times[f]}s`);
  expect(long).toEqual([]);
});

test("CI runs both tiers on every push to main and nightly", () => {
  const ci = readFileSync(join(repo, ".github/workflows/ci.yml"), "utf8");
  expect(ci).toMatch(/push:\s*\n\s*branches: \[main\]/);
  expect(ci).toMatch(/schedule:/);
  expect(ci).toMatch(/bun scripts\/test\.ts --tier gate/);
  expect(ci).toMatch(/bun scripts\/test\.ts --tier slow/);
});
