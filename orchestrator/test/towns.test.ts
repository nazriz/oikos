// Towns and runs (orchestrator/src/batch.ts, at its top): a batch's `seeds` runs one town several times; `towns` runs
// several towns. Until 2026-10-08 only the first existed, and "three seeds" was read as three towns.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { diff, diffText, drawn, drawnText, health, healthText } from "@oikos/measure";
import { batchShape, planRuns, recipeArgs, runBatch, runIdFor, runName, townSets } from "../src/batch";

const root = join(import.meta.dir, "../..");
const world = join(root, "worlds/town.yaml");
const DAY = 86_400;

test("what a batch runs: seeds are runs of one town; towns are towns, each run from its own seed", () => {
  // As it always was: the config's seed and those after it, no town named, the run's id unchanged.
  expect(planRuns(1, 3)).toEqual([{ seed: 1 }, { seed: 2 }, { seed: 3 }]);
  expect(planRuns(7, 1)).toEqual([{ seed: 7 }]);
  expect(runIdFor("worlds/town-1000.yaml", 2)).toBe("town-1000.seed2");
  expect(batchShape(planRuns(1, 3), true, 1)).toBe("1 town (generated from seed 1), 3 runs of it (run seeds 1 to 3)");
  expect(batchShape(planRuns(4, 1), false)).toBe("1 town (the world as given), 1 run of it (run seed 4)");
  // Towns: the spec's seed and those after it; a town's runs from its own seed, as with the spec's seed set to it.
  expect(planRuns(1, 1, 3, 1)).toEqual([{ town: 1, seed: 1 }, { town: 2, seed: 2 }, { town: 3, seed: 3 }]);
  expect(planRuns(5, 2, 2, 5)).toEqual([{ town: 5, seed: 5 }, { town: 5, seed: 6 }, { town: 6, seed: 6 }, { town: 6, seed: 7 }]);
  expect(runIdFor("worlds/town-1000.yaml", 6, 5)).toBe("town-1000.town5.seed6");
  expect(runName({ seed: 2 })).toBe("seed 2");
  expect(runName({ town: 2, seed: 3 })).toBe("town 2, seed 3");
  expect(batchShape(planRuns(1, 1, 3, 1), true, 1)).toBe("3 towns (generated from seeds 1 to 3), 1 run of each (run seeds from each town's own seed)");
  expect(batchShape(planRuns(1, 2, 1, 1), true, 1)).toBe("1 town (generated from seed 1), 2 runs of each (run seeds from each town's own seed)");
  expect(townSets(["citizens=40", "seed=9"], 3)).toEqual(["citizens=40", "seed=9", "seed=3"]);
  expect(townSets(["citizens=40"])).toEqual(["citizens=40"]);
  expect(recipeArgs({ world: "w.yaml", seeds: 1 }, 2, 2)).toEqual(["w.yaml", "--seed", "2", "--town", "2"]);
  expect(recipeArgs({ world: "w.yaml", seeds: 1 }, 2)).toEqual(["w.yaml", "--seed", "2"]);
  // Asked wrongly, it says so.
  expect(() => planRuns(1, 1, 0, 1)).toThrow(/--towns/);
  expect(() => planRuns(1, 1, 2)).toThrow(/a world given whole is one town/);
  expect(() => planRuns(1, 0)).toThrow(/--seeds/);
});

test("two towns are two towns, two seeds are one; each town's run is the run its own seed makes; diff and health say which they compared", async () => {
  const sets = ["citizens=40"];
  const o = { world, until: 10 * DAY, sets, overwrite: true, compress: false };
  const said: string[] = [];
  const towns = await runBatch({ ...o, towns: 2, seeds: 1, out: join(root, "runs", "test-towns"), log: (m) => said.push(m) });
  const seeds = await runBatch({ ...o, seeds: 2, out: join(root, "runs", "test-towns-seeds"), log: (m) => said.push(m) });
  expect(towns.runs.map((r) => [r.runId, r.town, r.seed])).toEqual([["town.town1.seed1", 1, 1], ["town.town2.seed2", 2, 2]]);
  expect(seeds.runs.map((r) => [r.runId, r.town, r.seed])).toEqual([["town.seed1", undefined, 1], ["town.seed2", undefined, 2]]);
  expect(said).toContain("  2 towns (generated from seeds 1 to 2), 1 run of each (run seeds from each town's own seed)");
  expect(said).toContain("  1 town (generated from seed 1), 2 runs of it (run seeds 1 to 2)");
  expect(said.some((m) => m.startsWith("  town 2, seed 2: "))).toBe(true);
  // Town 1 run with seed 1 is the same run either way; the second runs are not (another town; the same town again).
  expect(towns.runs[0]!.stateHash).toBe(seeds.runs[0]!.stateHash);
  expect(towns.runs[1]!.stateHash).not.toBe(seeds.runs[1]!.stateHash);
  // Town 2 is the town `--set seed=2` makes, run as that command runs it.
  const alone = await runBatch({ ...o, sets: [...sets, "seed=2"], seeds: 1, out: join(root, "runs", "test-towns-alone"), measure: false });
  expect(alone.runs[0]!.stateHash).toBe(towns.runs[1]!.stateHash);
  // The manifest says what ran.
  const manifest = (r: typeof towns) => JSON.parse(readFileSync(join(r.out, "batch.json"), "utf8"));
  expect(manifest(towns)).toMatchObject({ towns: [1, 2], runs_per_town: 1, seeds: [1, 2], runs: [{ town: 1, seed: 1 }, { town: 2, seed: 2 }] });
  expect(manifest(seeds)).toMatchObject({ towns: [1], runs_per_town: 2, seeds: [1, 2] });
  expect(manifest(seeds).runs[0].town).toBeUndefined();
  // Read back from the measurement tables alone: who was there at the start tells the towns apart.
  const [a, b] = [await drawn(towns.measureDir!), await drawn(seeds.measureDir!)];
  expect(a).toEqual({ runs: 2, towns: 2, perTown: [1, 1] });
  expect(b).toEqual({ runs: 2, towns: 1, perTown: [2] });
  expect(drawnText(a)).toBe("2 runs: 2 towns, 1 run of each");
  expect(drawnText(b)).toBe("2 runs of 1 town");
  expect(drawnText({ runs: 6, towns: 3, perTown: [2, 2, 2] })).toBe("6 runs: 3 towns, 2 runs of each");
  expect(drawnText({ runs: 1, towns: 1, perTown: [1] })).toBe("1 run of 1 town");
  expect(drawnText({ runs: 3 })).toContain("not known");
  const text = diffText(await diff(seeds.measureDir!, towns.measureDir!, ["economy/summary"]), [b, a]).split("\n");
  expect(text[0]).toBe("Baseline: 2 runs of 1 town. Change: 2 runs: 2 towns, 1 run of each.");
  expect(text[1]).toContain("One town run several times");
  expect(text[2]).toMatch(/measures compared \(2 runs against 2\); \d+ moved beyond the noise between runs \(3 standard errors\)\./);
  const h = healthText(await health(towns.measureDir!, [{ what: "employment_to_population_pct", value: 60 }]), a).split("\n");
  expect(h[0]).toMatch(/^Health: .* measures, over 2 runs: 2 towns, 1 run of each\.$/);
  expect(healthText(await health(seeds.measureDir!, []), b)).toContain("One town run several times");
}, 600_000);
