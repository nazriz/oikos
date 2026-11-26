// Lens only reads a run (docs/design/lens.md section 2): making a run's bundle leaves every file in the run's folder
// byte- and mtime-identical, and its own files go only to its views folder.
import "./kernel-env"; // (first: where the kernel is, before anything reads it)
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockPilot } from "../../scripts/pilot-mock";
import { Lens } from "../src/server/service";
import { lensPaths, removeOwn } from "../src/server/paths";

const base = realpathSync(mkdtempSync(join(tmpdir(), "oikos-lens-ro-")));
afterAll(() => rmSync(base, { recursive: true, force: true }));

const snapshot = (dir: string) =>
  readdirSync(dir, { recursive: true })
    .map(String)
    .sort()
    .map((f) => {
      const p = join(dir, f);
      const s = statSync(p);
      return `${f}:${s.isDirectory() ? "d" : `${s.size}:${Bun.hash(readFileSync(p))}`}:${s.mtimeMs}`;
    });

test("making a run's bundle changes nothing in the run's folder", async () => {
  const runs = join(base, "runs");
  const entry = { name: "lens-ro", world: "worlds/town.yaml", sets: ["citizens=20", "mayor=llm"], until: 2 * 86_400 };
  const r = await mockPilot(entry, runs, 2);
  expect(r.reason ?? "").not.toContain("engine");
  expect(r.generated).toBe(true);
  const runDir = join(runs, "lens-ro");
  const before = snapshot(runDir);

  const views = join(base, "views");
  const lens = new Lens({ runs, views }, { background: false });
  const cat = await lens.list(true);
  const e = cat.runs.find((x) => x.kind === "plain");
  expect(e).toBeDefined();
  const states: string[] = [];
  await new Promise<void>((res, rej) =>
    lens.open(e!, (s) => {
      states.push(s.state);
      if (s.state === "ready") res();
      if (s.state === "failed") rej(new Error(s.error));
    }),
  );
  expect(states.at(-1)).toBe("ready");
  const m = lens.manifest(e!)!;
  expect(m.errors).toEqual({});
  const meta = JSON.parse(readFileSync(join(lens.bundlePath(e!), "meta.json"), "utf8"));
  expect(meta.lines).toBeGreaterThan(100);
  expect(meta.span.days).toBeGreaterThanOrEqual(2);
  // (No debrief reaches a fold; the meta's counts would show one.)
  expect(Object.keys(meta.counts).some((k) => k.includes("debrief"))).toBe(false);

  expect(snapshot(runDir)).toEqual(before);
  // Lens's own files are all under its views folder.
  expect(readdirSync(runs).sort()).toEqual(["lens-ro"]);
  // (Three seconds on a quiet machine; the mock run it makes first slows with the machine's load, as other agents' runs
  // share it: the suite's own limit, not a tighter one.)
}, 120_000);

test("Lens refuses a views folder inside the runs folder, and deletes nothing outside its views folder", () => {
  const runs = join(base, "guard-runs"), views = join(base, "guard-views");
  expect(() => new Lens({ runs, views: join(runs, "views", "lens") }, { background: false })).toThrow(/inside the runs folder/);
  expect(() => lensPaths({ runs, views: runs })).toThrow(/inside the runs folder/);
  expect(() => removeOwn(views, join(runs, "x"))).toThrow(/refuses to delete/);
  expect(() => removeOwn(views, views)).toThrow(/refuses to delete/);
  expect(() => removeOwn(views, join(views, "..", "guard-runs"))).toThrow(/refuses to delete/);
});
