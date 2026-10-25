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

test("--changed picks the tests that are changed, import a changed file (however far down) or name a changed data file, and says why", async () => {
  const dir = fixtures({
    "a.test.ts": `import { one } from "./lib/a";\ntest("a", () => expect(one()).toBe(1));`,
    "b.test.ts": `test("b", () => expect(1).toBe(1));`,
    "c.test.ts": `import { readFileSync } from "node:fs";\ntest("c", () => expect(readFileSync(import.meta.dir + "/data/town.yaml", "utf8")).toContain("x"));`,
    "d.test.ts": `test("d", () => expect(1).toBe(1));`,
  });
  const git = (...a: string[]) => { const p = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: dir, stdout: "pipe", stderr: "pipe" }); if (p.exitCode !== 0) throw new Error(p.stderr.toString()); };
  try {
    mkdirSync(join(dir, "lib")); mkdirSync(join(dir, "data"));
    writeFileSync(join(dir, "lib/a.ts"), `import { inner } from "./deep";\nexport const one = () => inner();\n`);
    writeFileSync(join(dir, "lib/deep.ts"), `export const inner = () => 1;\n`);
    writeFileSync(join(dir, "lib/alone.ts"), `export const nobody = 0;\n`);
    writeFileSync(join(dir, "data/town.yaml"), "x: 1\n");
    git("init", "-q", "-b", "main"); git("add", "."); git("commit", "-q", "-m", "base"); git("tag", "base");
    // Nothing changed: nothing chosen (no file here has a recorded time, so the fast tier is empty).
    const none = await runner_(dir, "--changed", "--base", "base");
    expect(none.out).toMatch(/^0 pass, 0 fail across 0 files/m);
    writeFileSync(join(dir, "lib/deep.ts"), `export const inner = () => 1; // changed\n`);
    writeFileSync(join(dir, "lib/alone.ts"), `export const nobody = 1;\n`);
    writeFileSync(join(dir, "data/town.yaml"), "x: 2\n");
    writeFileSync(join(dir, "d.test.ts"), `import { test, expect } from "bun:test";\ntest("d", () => expect(2).toBe(2));`);
    git("commit", "-q", "-am", "committed on the branch"); // (lib/deep.ts and the rest, committed: still changed since the base)
    writeFileSync(join(dir, "e.test.ts"), `import { test, expect } from "bun:test";\ntest("e", () => expect(1).toBe(1));`); // (new, untracked)
    const { code, out } = await runner_(dir, "--changed", "--base", "base");
    expect(code).toBe(0);
    expect(out).toMatch(/^  \+ a\.test\.ts .*: imports lib\/deep\.ts \(2 imports down\)$/m);
    expect(out).toMatch(/^  \+ c\.test\.ts .*: names data\/town\.yaml$/m);
    expect(out).toMatch(/^  \+ d\.test\.ts .*: changed itself$/m);
    expect(out).toMatch(/^  \+ e\.test\.ts .*: changed itself$/m);
    expect(out).toMatch(/^  no test imports or names: lib\/alone\.ts$/m);
    expect(out).not.toMatch(/b\.test\.ts/);
    expect(out).toMatch(/^4 pass, 0 fail across 4 files, .*\(fast tier and what changed\), 0 passed on rerun$/m);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 120_000);

test("--affected: a planted change in a kernel file chooses the whole suite; a document only the tests that read documents; code the tests that reach it, through a spawned script too, and the backstops always", async () => {
  const dir = fixtures({
    "orchestrator/test/generality.test.ts": `test("g", () => expect(1).toBe(1));`,
    "t/unit.test.ts": `import { one } from "../lib/a";\ntest("u", () => expect(one()).toBe(1));`,
    "t/spawns.test.ts": `test("s", () => { Bun.spawnSync(["bun", "orchestrator/src/cli.ts"]); });`,
    "t/docs.test.ts": `import { readFileSync } from "node:fs";\ntest("d", () => { readFileSync("docs/x.md"); });`,
    "t/scans.test.ts": `import { readdirSync } from "node:fs";\ntest("w", () => { readdirSync("worlds/profiles/"); });`,
    "t/other.test.ts": `test("o", () => expect(1).toBe(1));`,
  });
  const git = (...a: string[]) => { const p = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: dir, stdout: "pipe", stderr: "pipe" }); if (p.exitCode !== 0) throw new Error(p.stderr.toString()); };
  const chosen = async () => (await runner_(dir, "--affected", "--list", "--base", "base")).out.split("\n").filter((l) => /\.test\.ts$/.test(l)).sort();
  const everything = ["orchestrator/test/generality.test.ts", "t/docs.test.ts", "t/other.test.ts", "t/scans.test.ts", "t/spawns.test.ts", "t/unit.test.ts"];
  try {
    for (const d of ["lib", "kernel/src", "docs", "worlds/profiles", "orchestrator/src"]) mkdirSync(join(dir, d), { recursive: true });
    writeFileSync(join(dir, "lib/a.ts"), `export const one = () => 1;\n`);
    writeFileSync(join(dir, "kernel/src/lib.rs"), "// kernel\n");
    writeFileSync(join(dir, "docs/x.md"), "x\n");
    writeFileSync(join(dir, "docs/y.md"), "y\n");
    writeFileSync(join(dir, "worlds/profiles/p.yaml"), "a: 1\n");
    writeFileSync(join(dir, "orchestrator/src/run.ts"), "export const run = 1;\n");
    writeFileSync(join(dir, "orchestrator/src/cli.ts"), `import { run } from "./run";\nconsole.log(run);\n`);
    git("init", "-q", "-b", "main"); git("add", "."); git("commit", "-q", "-m", "base"); git("tag", "base");
    // A planted change in a kernel file: the whole suite (and the kernel's tests).
    writeFileSync(join(dir, "kernel/src/lib.rs"), "// kernel changed\n");
    expect(await chosen()).toEqual(everything);
    git("checkout", "-q", "."); 
    // A document: the tests that read documents, and the backstop; not the rest.
    writeFileSync(join(dir, "docs/y.md"), "changed\n");
    expect(await chosen()).toEqual(["orchestrator/test/generality.test.ts", "t/docs.test.ts"]);
    git("checkout", "-q", ".");
    // A file a test does not import but a spawned script does, two imports down from a test that names the script.
    writeFileSync(join(dir, "orchestrator/src/run.ts"), "export const run = 2;\n");
    expect(await chosen()).toContain("t/spawns.test.ts");
    expect(await chosen()).not.toContain("t/docs.test.ts");
    git("checkout", "-q", ".");
    // Data in a folder a test scans without naming the file.
    writeFileSync(join(dir, "worlds/profiles/p.yaml"), "a: 2\n");
    expect(await chosen()).toEqual(expect.arrayContaining(["orchestrator/test/generality.test.ts", "t/scans.test.ts"]));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 120_000);

test("--gate: a change to a file a slow-tier test imports pulls that slow test into the gate, and no other slow test; one that reaches more than eight runs the canaries instead; the kernel the kernel canaries; a document none", async () => {
  const dir = fixtures({
    "t/fast.test.ts": `test("f", () => expect(1).toBe(1));`,
    "t/slow-town.test.ts": `import { one } from "../lib/town";\ntest("s", () => expect(one()).toBe(1));`,
    "t/slow-other.test.ts": `test("o", () => expect(1).toBe(1));`,
    "orchestrator/test/invariants.test.ts": `test("i", () => expect(1).toBe(1));`,
    "t/canary-town.test.ts": `test("c", () => expect(1).toBe(1));`,
    ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`t/wide-${i}.test.ts`, `import { all } from "../lib/shared";\ntest("w", () => expect(all).toBe(1));`])),
  });
  const git = (...a: string[]) => { const p = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: dir, stdout: "pipe", stderr: "pipe" }); if (p.exitCode !== 0) throw new Error(p.stderr.toString()); };
  const gate = async () => { const r = await runner_(dir, "--gate", "--list", "--base", "base"); return { out: r.out, files: r.out.split("\n").filter((l) => /\.test\.ts$/.test(l)).sort() }; };
  try {
    for (const d of ["lib", "scripts", "kernel/src", "docs"]) mkdirSync(join(dir, d), { recursive: true });
    writeFileSync(join(dir, "lib/town.ts"), `export const one = () => 1;\n`);
    writeFileSync(join(dir, "lib/alone.ts"), `export const two = () => 2;\n`);
    writeFileSync(join(dir, "lib/shared.ts"), `export const all = 1;\n`);
    writeFileSync(join(dir, "kernel/src/lib.rs"), "// kernel\n");
    writeFileSync(join(dir, "docs/x.md"), "x\n");
    writeFileSync(join(dir, "scripts/test-tiers.json"), JSON.stringify({ slow: { "t/slow-town.test.ts": "a town", "t/slow-other.test.ts": "another town", "orchestrator/test/invariants.test.ts": "the year", "t/canary-town.test.ts": "a pinned town", ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`t/wide-${i}.test.ts`, "a wide town"])) }, canary: { "orchestrator/test/invariants.test.ts": { why: "the invariants", kernel: true }, "t/canary-town.test.ts": { why: "a pinned town" } } }));
    git("init", "-q", "-b", "main"); git("add", "."); git("commit", "-q", "-m", "base"); git("tag", "base");
    // A file the slow town test imports: that test joins the gate, said as the slow tier's; the other slow tests do not.
    writeFileSync(join(dir, "lib/town.ts"), `export const one = () => 1; // changed\n`);
    const town = await gate();
    expect(town.files).toContain("t/slow-town.test.ts");
    expect(town.files).not.toContain("t/slow-other.test.ts");
    expect(town.files).not.toContain("orchestrator/test/invariants.test.ts");
    expect(town.out).toMatch(/^  \+ t\/slow-town\.test\.ts .*slow tier\): imports lib\/town\.ts$/m);
    git("checkout", "-q", ".");
    // A file nine slow tests reach: more than eight, so the canaries instead, and none of the nine.
    writeFileSync(join(dir, "lib/shared.ts"), `export const all = 1; // changed\n`);
    const wide = await gate();
    expect(wide.files.filter((f) => f !== "t/fast.test.ts")).toEqual(["orchestrator/test/invariants.test.ts", "t/canary-town.test.ts"]);
    expect(wide.out).toMatch(/reaches 9 of the slow tier.s files, more than 8: the canaries instead/);
    git("checkout", "-q", ".");
    // A file no slow test reaches: none of them.
    writeFileSync(join(dir, "lib/alone.ts"), `export const two = () => 3;\n`);
    expect((await gate()).files.filter((f) => f !== "t/fast.test.ts")).toEqual([]);
    git("checkout", "-q", ".");
    // The kernel: the canaries marked for it (here the invariants), not every slow test, nor the other canary.
    writeFileSync(join(dir, "kernel/src/lib.rs"), "// kernel changed\n");
    const kernel = await gate();
    expect(kernel.files).toContain("orchestrator/test/invariants.test.ts");
    expect(kernel.files).not.toContain("t/canary-town.test.ts");
    expect(kernel.files).not.toContain("t/slow-other.test.ts");
    git("checkout", "-q", ".");
    // A document: no slow test.
    writeFileSync(join(dir, "docs/x.md"), "changed\n");
    expect((await gate()).files.filter((f) => f.startsWith("t/slow") || f.includes("invariants"))).toEqual([]);
    git("checkout", "-q", ".");
    // Run, the slow test runs with the gate.
    writeFileSync(join(dir, "lib/town.ts"), `export const one = () => 1; // changed again\n`);
    const ran = await runner_(dir, "--gate", "--base", "base");
    expect(ran.out).toMatch(/^ok +t\/slow-town\.test\.ts/m);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 120_000);
