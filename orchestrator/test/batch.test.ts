// M3: batches, measurement and the cost report. A run's result never depends
// on being in a batch; measurement reads only the logs; the cost report keeps
// what was spent apart from what it would cost on the configured models.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { query, runQuery } from "@terrarium/measure";
import { runBatch, runOne, setPath } from "../src/batch";
import { costReport } from "../src/cost";
import { kernelBinary } from "../src/kernel";

const root = join(import.meta.dir, "../..");
const world = join(root, "worlds/town.yaml");
const DAY = 86_400;

test("--set overrides a path, reading JSON where it can", () => {
  const o: any = { a: { b: 1 } };
  for (const s of ["a.b=2", "a.c=llm", "d.e=[1,2]", "f=true"]) setPath(o, s);
  expect(o).toEqual({ a: { b: 2, c: "llm" }, d: { e: [1, 2] }, f: true });
  expect(() => setPath(o, "nothing")).toThrow();
});

test("a batch runs seeds in parallel, each exactly as it runs alone; its logs are measured and costed", async () => {
  const out = join(root, "runs", "test-batch");
  rmSync(out, { recursive: true, force: true });
  const sets = ["citizens=60", "mayor=llm"];
  const r = await runBatch({ world, seeds: 3, parallel: 3, out, until: 40 * DAY, sets });
  expect(r.runs.map((x) => x.seed)).toEqual([1, 2, 3]);
  expect(new Set(r.runs.map((x) => x.stateHash)).size).toBe(3); // different randomness, different towns' histories

  // The same seed alone, in this process: identical.
  const alone = await runOne({ world, seed: 2, out: join(out, "alone"), until: 40 * DAY, sets });
  expect(alone.stateHash).toBe(r.runs[1]!.stateHash);
  const bodies = (p: string) => readFileSync(p, "utf8").trim().split("\n").slice(1).map((l) => JSON.stringify(JSON.parse(l).body));
  expect(bodies(alone.logPath)).toEqual(bodies(r.runs[1]!.logPath));
  // And every log replays.
  for (const x of r.runs) expect(Bun.spawnSync([kernelBinary(), "replay", x.logPath, "--anchors", x.anchorsPath]).exitCode).toBe(0);

  // The manifest says what ran.
  const manifest = JSON.parse(readFileSync(join(out, "batch.json"), "utf8"));
  expect(manifest.sets).toEqual(sets);
  expect(manifest.runs.map((x: any) => x.state_hash)).toEqual(r.runs.map((x) => x.stateHash));

  // Measurement: every run's tables, read back together.
  const m = r.measureDir!;
  const overview = await runQuery(m, "overview");
  expect(overview.map((x) => x.seed)).toEqual([1, 2, 3]);
  expect(overview.map((x) => x.state_hash)).toEqual(r.runs.map((x) => x.stateHash.slice(0, 16)));
  // Tables agree with the kernel's own counts: every act is an act command, and refusals match.
  const acts = await query(m, "select run_id, count(*) as n, count(*) filter (where not applied) as refused from acts group by run_id order by run_id");
  expect(acts.map((x) => x.refused)).toEqual(r.runs.map((x) => x.refused));
  const transfers = await query(m, "select count(*) as n from transfers where amount <= 0");
  expect(transfers[0]!.n).toBe(0);
  const lang = await runQuery(m, "language-seats");
  expect(lang.length).toBe(3);

  // The cost report: nothing spent on the mock; a projection at the configured model's published price.
  const cost = await costReport(m);
  expect(cost.recorded_microusd).toBe(0);
  expect(cost.projected_microusd!).toBeGreaterThan(0);
  expect(cost.rows.every((x) => x.estimated)).toBe(true);
  expect(cost.rows.find((x) => x.purpose === "seat")!.projected).toBe("anthropic/claude-sonnet-5");
  expect(cost.text).toContain("mock's estimates");
  // The projection is the published price applied to the recorded tokens, exactly.
  const u = cost.rows.find((x) => x.purpose === "seat")!;
  expect(Math.abs(u.projected_microusd! - (u.input_tokens * 2 + u.output_tokens * 10))).toBeLessThanOrEqual(3); // $2 and $10 per million, rounded up per run
  const other = await costReport(m, { translatorModel: "anthropic/claude-haiku-4-5" });
  expect(other.rows.find((x) => x.purpose === "translator")!.projected).toBe("anthropic/claude-haiku-4-5");
}, 300_000);

test("an all-code batch reports no model calls", async () => {
  const out = join(root, "runs", "test-batch-code");
  rmSync(out, { recursive: true, force: true });
  const r = await runBatch({ world, seeds: 1, out, until: 20 * DAY, sets: ["citizens=40"] });
  expect((await costReport(r.measureDir!)).text).toContain("No model calls");
}, 300_000);
