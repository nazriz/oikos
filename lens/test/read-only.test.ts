// Lens only reads a run (docs/design/lens.md section 2): making a run's bundle leaves every file in the run's folder
// byte- and mtime-identical, and its own files go only to its views folder.
import "./kernel-env"; // (first: where the kernel is, before anything reads it)
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockPilot } from "../../scripts/pilot-mock";
import { Lens } from "../src/server/service";
import { lensPaths, removeOwn } from "../src/server/paths";
import { bundleDir, relistBundles, servedBundle } from "../src/server/bundle";
import { foldVersions } from "../src/server/ingest";

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

test("a run's older bundle (an earlier log, or older folds) is served while its own is made", () => {
  const views = join(base, "stale-views");
  const put = (bytes: number, mtimeMs: number, folds: { [k: string]: number }, madeAt: string) => {
    const dir = bundleDir(views, "k", bytes, mtimeMs);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ key: "k", bytes, mtimeMs, folds, madeAt, errors: {} }));
    relistBundles();
    return dir;
  };
  const old = { ...foldVersions(), seat: -1 };
  const a = put(100, 1, old, "2026-11-26T00:00:00Z");
  expect(servedBundle(views, "k", 100, 1)).toMatchObject({ dir: a, stale: true }); // (older folds, same log)
  expect(servedBundle(views, "k", 50, 2)).toBeUndefined(); // (never a bundle of a longer log than this one)
  const b = put(200, 2, old, "2026-11-27T00:00:00Z");
  expect(servedBundle(views, "k", 300, 3)).toMatchObject({ dir: b, stale: true }); // (the newest made)
  const c = put(300, 3, foldVersions(), "2026-11-27T01:00:00Z");
  expect(servedBundle(views, "k", 300, 3)).toMatchObject({ dir: c, stale: false });
});

test("Lens refuses a views folder inside the runs folder, and deletes nothing outside its views folder", () => {
  const runs = join(base, "guard-runs"), views = join(base, "guard-views");
  expect(() => new Lens({ runs, views: join(runs, "views", "lens") }, { background: false })).toThrow(/inside the runs folder/);
  expect(() => lensPaths({ runs, views: runs })).toThrow(/inside the runs folder/);
  expect(() => removeOwn(views, join(runs, "x"))).toThrow(/refuses to delete/);
  expect(() => removeOwn(views, views)).toThrow(/refuses to delete/);
  expect(() => removeOwn(views, join(views, "..", "guard-runs"))).toThrow(/refuses to delete/);
});

test("the Data page serves only a run's own files, never its debriefs file nor anything outside the run", async () => {
  const { runFiles, servableFile } = await import("../src/server/run-data");
  const runs = join(base, "data-runs"), seed = join(runs, "exp", "x", "seed-1");
  mkdirSync(seed, { recursive: true });
  writeFileSync(join(runs, "exp", "x", "spec.json"), "{}");
  for (const f of ["arm.oklog", "arm.json", "arm.debriefs.jsonl"]) writeFileSync(join(seed, f), "{}");
  writeFileSync(join(runs, "secret.json"), "{}");
  const e = { key: "k", log: "exp/x/seed-1/arm.oklog", experiment: { dir: "exp/x" } } as any;
  const listed = runFiles(runs, e).map((f) => f.path);
  expect(listed).toContain("exp/x/spec.json");
  expect(listed.some((p) => p.includes("debriefs"))).toBe(false);
  expect(servableFile(runs, e, "exp/x/spec.json")).toBeTruthy();
  for (const p of ["exp/x/seed-1/arm.debriefs.jsonl", "secret.json", "../secret.json", "/etc/passwd"]) expect(servableFile(runs, e, p)).toBeUndefined();
  // (Records are paged and filtered as written: kind, the world's day, author or speaks_for, and words; never cut.)
  const { recordsPage } = await import("../src/server/run-data");
  const long = "x".repeat(5000);
  const all = [
    { t: 86_400 * 121 + 10, record: { id: "rec.1", kind: "law", author: "c0060-self", speaks_for: "city", text: long } },
    { t: 86_400 * 122, record: { id: "rec.2", kind: "budget", author: "c0060-self", text: "Budget for year 2" } },
    { t: 5, record: { id: "rec.3", kind: "price_list", author: "outside", text: "Sold from outside" } },
  ];
  const pg = (q: Record<string, string>) => recordsPage(all, new URLSearchParams(q));
  expect([pg({ kind: "law" }).matched, pg({ day: "122" }).matched, pg({ author: "city" }).matched, pg({ q: "outside" }).matched]).toEqual([1, 1, 1, 1]);
  expect((pg({ kind: "law" }).rows[0]!.record.text as string).length).toBe(5000);
  expect(pg({ limit: "2", offset: "2" }).rows.map((r) => r.record.id)).toEqual(["rec.3"]);
});
