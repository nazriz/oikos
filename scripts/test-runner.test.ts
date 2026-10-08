// The runner's own behaviour (scripts/test.ts), on fixture test files written to a temporary directory and run with
// `--root`: a pass, a plain failure (never rerun), a timeout that passes alone (rerun), a timeout that never does.

import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const runner = join(import.meta.dir, "test.ts");

function fixtures(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "oikos-runner-"));
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), `import { test, expect } from "bun:test";\n${body}`);
  }
  return dir;
}
async function runner_(dir: string, ...extra: string[]) {
  const p = Bun.spawn(["bun", runner, "--root", dir, "--jobs", "3", ...extra], { stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out: out + err };
}
/** A test that overruns its 300 ms limit the first time it runs (a marker file records that) and is quick after. */
const slowOnce = (marker: string) => `import { existsSync, writeFileSync } from "node:fs";
test("slow once", async () => { const first = !existsSync(${JSON.stringify(marker)}); writeFileSync(${JSON.stringify(marker)}, "x"); if (first) await Bun.sleep(1500); expect(1).toBe(1); }, 300);`;

test("a pass, a failure and a load timeout are told apart, and only the timeout is rerun", async () => {
  const dir = fixtures({
    "a-pass.test.ts": `test("p", () => expect(1).toBe(1));`,
    "b-fail.test.ts": `test("f", () => expect(1).toBe(2));`,
    "c-late.test.ts": slowOnce(join(tmpdir(), `oikos-marker-${process.pid}-c`)),
  });
  try {
    const { code, out } = await runner_(dir);
    expect(code).toBe(1);
    expect(out).toMatch(/^ok +a-pass\.test\.ts/m);
    expect(out).toMatch(/^FAIL b-fail\.test\.ts/m);
    expect(out).not.toMatch(/b-fail\.test\.ts.*rerun/);
    expect(out).toMatch(/^LATE c-late\.test\.ts/m);
    expect(out).toMatch(/^PASSED ON RERUN \(timed out under load\) c-late\.test\.ts/m);
    expect(out).toMatch(/^\d+ pass, 1 fail across 3 files, 3 at a time, in \d+s, 1 passed on rerun$/m);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(join(tmpdir(), `oikos-marker-${process.pid}-c`), { force: true }); }
}, 120_000);

test("a test that times out every time fails after its rerun", async () => {
  const dir = fixtures({ "hang.test.ts": `test("h", async () => { await Bun.sleep(3000); }, 200);` });
  try {
    const { code, out } = await runner_(dir);
    expect(code).toBe(1);
    expect(out).toMatch(/^LATE hang\.test\.ts/m);
    expect(out).toMatch(/failed again on rerun/);
    expect(out).toMatch(/, 0 passed on rerun$/m);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 120_000);

test("a run stopped by a signal says so as its last line and stops its files", async () => {
  const dir = fixtures({ "long.test.ts": `test("l", async () => { await Bun.sleep(20000); }, 60000);` });
  try {
    const p = Bun.spawn(["bun", runner, "--root", dir, "--jobs", "1"], { stdout: "pipe", stderr: "pipe" });
    await Bun.sleep(1500);
    p.kill("SIGTERM");
    const out = await new Response(p.stdout).text();
    expect(await p.exited).toBe(143);
    expect(out.trim().split("\n").pop()).toMatch(/^stopped by signal SIGTERM after 0 of 1 files/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 120_000);

test("a file with a timeout and another kind of failure is not rerun", async () => {
  const dir = fixtures({ "mixed.test.ts": `test("h", async () => { await Bun.sleep(1000); }, 200);\ntest("f", () => expect(1).toBe(2));` });
  try {
    const { code, out } = await runner_(dir);
    expect(code).toBe(1);
    expect(out).toMatch(/^FAIL mixed\.test\.ts/m);
    expect(out).not.toMatch(/LATE|RERUN/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 120_000);
