// M3: batches, measurement and the cost report. A run's result never depends
// on being in a batch; measurement reads only the logs; the cost report keeps
// what was spent apart from what it would cost on the configured models.

import { expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { query, runQuery } from "@oikos/measure";
import { recipeArgs, runBatch, runOne, setPath } from "../src/batch";
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
  // (No budget on file at the start: the mock mayor proposes one in its first days, which is the run's translation.)
  const sets = ["citizens=60", "mayor=llm", "opening_budget=false"];
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
  const lang = await runQuery(m, "language-participants");
  expect(lang.length).toBe(3);

  // The cost report: nothing spent on the mock; a projection at the configured model's published price.
  const cost = await costReport(m);
  expect(cost.recorded_microusd).toBe(0);
  expect(cost.projected_microusd!).toBeGreaterThan(0);
  expect(cost.rows.every((x) => x.estimated)).toBe(true);
  expect(cost.rows.find((x) => x.purpose === "participant")!.projected).toBe("anthropic/claude-sonnet-5");
  expect(cost.text).toContain("mock's estimates");
  // The projection is the published price applied to the recorded tokens, exactly.
  const u = cost.rows.find((x) => x.purpose === "participant")!;
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

test("--keep measures: a code-only run's log gives way to its measures and a recipe that regenerates it; a model's run keeps its log", async () => {
  const out = join(root, "runs", "test-keep");
  rmSync(out, { recursive: true, force: true });
  const messages: string[] = [];
  const o = { world, seeds: 1, out, until: 20 * DAY, sets: ["citizens=40"], keep: "measures" as const, compress: false, log: (m: string) => messages.push(m) };
  const r = await runBatch(o);
  const run = r.runs[0]!;
  const recipePath = join(out, `${run.runId}.recipe.json`);
  const dirty = Bun.spawnSync(["git", "status", "--porcelain", "--untracked-files=no"], { cwd: root }).stdout.toString().trim() !== "";
  if (dirty) {
    // Uncommitted changes: the commit wouldn't regenerate it, so the log stays, and it says why.
    expect(messages.some((m) => m.includes("uncommitted changes"))).toBe(true);
    expect(existsSync(run.logPath)).toBe(true);
  } else {
    expect(existsSync(recipePath)).toBe(true);
    expect(existsSync(join(out, `${run.runId}.jsonl`))).toBe(false);
    expect(JSON.parse(readFileSync(recipePath, "utf8")).state_hash).toBe(run.stateHash);
  }
  expect(existsSync(join(out, "measure", "transfers"))).toBe(true);
  // The recipe's command regenerates the run exactly.
  const again = Bun.spawnSync([process.execPath, join(root, "orchestrator/src/cli.ts"), "run-one", ...recipeArgs(o, run.seed), "--out", join(out, "again")], { cwd: root });
  expect(again.exitCode).toBe(0);
  expect(JSON.parse(readFileSync(join(out, "again", `${run.runId}.summary.json`), "utf8")).stateHash).toBe(run.stateHash);

  // A language-model participant (the mock mayor): the log is always kept.
  const llm = await runBatch({ ...o, out: join(out, "llm"), sets: ["citizens=40", "mayor=llm"], log: (m: string) => messages.push(m) });
  expect(messages.some((m) => m.includes("language-model participants"))).toBe(true);
  expect(existsSync(llm.runs[0]!.logPath)).toBe(true);
}, 300_000);

test("a batch's spending limit caps the whole batch: each run gets what's left of it, and never spends past its own", async () => {
  // A stand-in for a paid provider (no network): every answer is "done for now", billed as a provider would (about 4
  // characters a token of what was sent).
  const server = Bun.serve({ port: 0, fetch: async (req) => Response.json({ content: [{ type: "tool_use", id: "x", name: "done_for_now", input: { days: 3 } }], usage: { input_tokens: Math.ceil((await req.text()).length / 4), output_tokens: 10 } }) });
  const out = join(root, "runs", "test-batch-budget");
  rmSync(out, { recursive: true, force: true });
  const env = process.env.OIKOS_ANTHROPIC_KEY;
  process.env.OIKOS_ANTHROPIC_KEY = "test-key";
  try {
    // Three at once: the first two hold $0.02 each, leaving the third $0.005 of the batch's $0.045.
    const r = await runBatch({ world, seeds: 3, parallel: 3, out, until: 60 * DAY, sets: ["citizens=40", "mayor=llm", "framing=simulation"], model: "anthropic/claude-haiku-4-5", baseUrl: `http://localhost:${server.port}`,
      budgetUsd: 0.02, batchBudgetUsd: 0.045, measure: false, compress: false });
    expect(r.runs.length).toBe(3);
    const entries = (p: string) => readFileSync(p, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const limitOf = (p: string) => entries(p).find((e) => e.kind === "annotation" && e.body.annotation === "orchestrator").body.data.llm.spending_limit_microusd;
    expect(r.runs.map((x) => limitOf(x.logPath))).toEqual([20_000, 20_000, 5_000]);
    // Never past its own, but for what the run's end (its debriefs) spent beyond it: the platform's overrun, told apart (2026-10-12).
    const own = (x: (typeof r.runs)[number]) => x.spentMicroUsd! - (x.platformOverrun?.microusd ?? 0);
    for (const x of r.runs) expect(own(x)).toBeLessThanOrEqual(limitOf(x.logPath));
    const total = r.runs.reduce((a, x) => a + x.spentMicroUsd!, 0);
    expect(total).toBeGreaterThan(0);
    expect(r.runs.reduce((a, x) => a + own(x), 0)).toBeLessThanOrEqual(45_000);
    expect(JSON.parse(readFileSync(join(out, "batch.json"), "utf8")).spending).toEqual({ limit_microusd: 45_000, spent_microusd: total });
    // Each stopped at its limit, saying so.
    for (const x of r.runs) {
      const end = entries(x.logPath).at(-1)!.body;
      expect(end.reason).toBe("aborted");
      expect(String(end.detail)).toContain("spending limit");
    }
  } finally {
    server.stop(true);
    if (env === undefined) delete process.env.OIKOS_ANTHROPIC_KEY;
    else process.env.OIKOS_ANTHROPIC_KEY = env;
  }
}, 300_000);
