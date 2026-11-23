// Phase 2 W8 groundwork tests: opt-in multi-term election cycles (`election_term_days`),
// byte-identical default worlds, multi-term institutional measurement, and fork-and-intervene
// reversibility (policy reversal + oversight restoration, code mayors only).

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareReversibility, readMultiTermLog } from "@oikos/measure/reversibility";
import { generate } from "@oikos/worlds/generator/generate";
import { runExperiment, type ExperimentSpec } from "../src/experiment";
import { kernelBinary } from "../src/kernel";
import { inspectAtFork, oversightRestorationInterventions, policyReversalInterventions, reversibilityArms } from "../src/reversibility";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const townSpec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

test("omitting election_term_days keeps default worlds byte-identical and opt-in configures law and office", () => {
  const baseline = generate({ ...townSpec, citizens: 60, seed: 7 });
  const explicitUndef = generate({ ...townSpec, citizens: 60, seed: 7, election_term_days: undefined });
  expect(JSON.stringify(explicitUndef)).toBe(JSON.stringify(baseline));

  // Default law-elections text keeps "every 4 years" and actor term_days = 4 * 365.
  const baseLaw = baseline.world.records.find((r: any) => r.id === "law-elections");
  expect(baseLaw.text).toContain("every 4 years");
  expect(baseline.positions.find((p: any) => p.id === "electoral").role_module.params.term_days).toBe(4 * 365);

  // Opt-in multi-term world sets term_days on both actor params and schedule-elections law.
  const multi = generate({
    ...townSpec,
    citizens: 60,
    seed: 7,
    first_election_days: 60,
    election_term_days: 90,
    takes_office_days: 4,
    election_law: true,
  });
  const multiLaw = multi.world.records.find((r: any) => r.id === "law-elections");
  expect(multiLaw.text).toContain("every 90 days");
  expect(multiLaw.data.figures.term_days).toEqual({ value: 90 * DAY, unit: "seconds" });
  expect(multi.positions.find((p: any) => p.id === "electoral").role_module.params.term_days).toBe(90);
});

test("multi-term world runs 3 full election cycles with code mayors and readMultiTermLog captures all cycles", async () => {
  const cfg = generate({
    ...townSpec,
    citizens: 60,
    seed: 2,
    mayor: "code",
    first_election_days: 60,
    election_term_days: 90,
    takes_office_days: 4,
    election_law: true,
    newspaper_polls: true,
  }) as any;
  for (const c of [...cfg.participants.map((x: any) => x.controller), ...cfg.templates.map((x: any) => x.controller)]) {
    if (c?.params?.civic) c.params = { ...c.params, civic: { ...c.params.civic, stand_bps: 250 } };
  }

  const tmp = mkdtempSync(join(tmpdir(), "oikos-w8-multiterm-"));
  try {
    const cfgPath = join(tmp, "config.json");
    writeFileSync(cfgPath, JSON.stringify(cfg));
    const run = Bun.spawnSync(
      [kernelBinary(), "world", cfgPath, "--out", tmp, "--until", String(260 * DAY), "--threads", "2"],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(run.exitCode, run.stderr.toString()).toBe(0);

    const read = await readMultiTermLog(join(tmp, "world.jsonl"), cfg);
    expect(read.false_notices).toBe(0);
    expect(read.cycles.map((c) => c.poll_at)).toEqual([60 * DAY, 150 * DAY, 240 * DAY]);
    for (const c of read.cycles) {
      expect(c.result_at).toBeDefined();
      expect(c.winner).toBeTruthy();
      expect(c.takes_office_at).toBeDefined();
    }
    expect(read.newspaper.editions).toBeGreaterThan(10);
    expect(read.newspaper.polls.length).toBeGreaterThanOrEqual(3);
    expect(read.posts.editor?.total_vacant_days).toBe(0);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}, 120_000);

test("fork-and-intervene reversibility withdraws active executive directions and restores vacated oversight posts", async () => {
  // mayor: "llm" creates the dedicated `mayor-system` seat (`shares_body: true`) while every arm runs `steward: { kind: "code" }` (all-code).
  const baseCfg = generate({
    ...townSpec,
    citizens: 60,
    seed: 7,
    mayor: "llm",
    first_election_days: 60,
    election_term_days: 90,
    election_law: true,
    newspaper_polls: true,
  }) as any;

  const mayorHolder = String(baseCfg.positions.find((p: any) => p.id === "mayor").holder);
  const editorPos = baseCfg.positions.find((p: any) => p.id === "editor");
  const priorEditor = String(editorPos.holder);

  // Set up checkpoint preconditions: a standing mayor direction on file + editor post vacated at t=0.
  const dirId = "dir-w8-standing";
  baseCfg.world.records.push({
    id: dirId,
    record: "statement",
    author: mayorHolder,
    in_position: "mayor",
    speaks_for: "city",
    at: 0,
    visible_to: "public",
    addressed_to: ["city"],
    basis: "form-inspector-enforcement",
    kind: "direction",
    text: "Inspector enforcement: fines no.",
    data: { fines: "no" },
  });
  delete editorPos.holder;

  const out = mkdtempSync(join(tmpdir(), "oikos-w8-fork-"));
  try {
    // Fork at day 1, run to day 12 (inside city-appointments's 14-day automatic refill window so
    // continued remains vacant while oversight-restored immediately refills editor at the fork).
    const spec: ExperimentSpec = {
      name: "w8-reversibility-test",
      world: { config: baseCfg },
      post: "mayor",
      seeds: [7],
      forkDay: 1,
      untilDay: 12,
      arms: [
        { name: "continued", steward: { kind: "code" } },
        {
          name: "policy-reversal",
          steward: { kind: "code" },
          intervene: policyReversalInterventions(mayorHolder, [dirId]),
        },
        {
          name: "oversight-restored",
          steward: { kind: "code" },
          intervene: oversightRestorationInterventions(mayorHolder, [{ post: "editor", previous_holder: priorEditor }]),
        },
      ],
      reference: "continued",
      threads: 1,
      forksAtOnce: 3,
    };

    const res = await runExperiment(spec, { out, parallel: 0 });
    expect(res.results.length).toBe(3);
    for (const f of res.results) expect(f.error).toBeUndefined();

    const forkT = 1 * DAY;
    const sd = join(out, "seed-7");
    // Verify inspectAtFork detects the active direction from base.oklog, and reversibilityArms builds all 3 arms.
    const found = await inspectAtFork(join(sd, "base.oklog"), baseCfg);
    expect(found.mayorHolder).toBe(mayorHolder);
    expect(found.activeDirections).toContain(dirId);
    expect(found.vacatedPosts).toEqual([]); // editor opened vacant in config (no prior holder in base log)
    expect(reversibilityArms({ mayorHolder, activeDirections: found.activeDirections, vacatedPosts: [{ post: "editor", previous_holder: priorEditor }] }).map((a) => a.name)).toEqual([
      "continued",
      "policy-reversal",
      "oversight-restored",
    ]);
    const continued = await readMultiTermLog(join(sd, "continued.oklog"), baseCfg, { fromT: forkT, kernelBin: kernelBinary() });
    const reversed = await readMultiTermLog(join(sd, "policy-reversal.oklog"), baseCfg, { fromT: forkT, kernelBin: kernelBinary() });
    const restored = await readMultiTermLog(join(sd, "oversight-restored.oklog"), baseCfg, { fromT: forkT, kernelBin: kernelBinary() });

    const revCmp = compareReversibility(continued, reversed, forkT);
    expect(continued.directions.active).toContain(dirId);
    expect(reversed.directions.active).not.toContain(dirId);
    expect(revCmp.directions_reversed).toBe(1);
    expect(revCmp.active_directions_delta).toBe(-1);

    const restCmp = compareReversibility(continued, restored, forkT);
    expect(continued.posts.editor?.final_holder).toBeNull();
    expect(restored.posts.editor?.final_holder).toBe(priorEditor);
    expect(restCmp.oversight_restored).toEqual(["editor"]);
    expect(restCmp.vacancy_days_saved).toBeGreaterThan(9);
    // Restored newspaper editor resumes publishing editions.
    expect(restCmp.newspaper_editions_delta).toBeGreaterThan(0);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}, 180_000);
