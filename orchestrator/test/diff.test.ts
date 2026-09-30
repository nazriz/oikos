// The before/after diff (docs/design/rebuild.md 8.4): a batch against itself moves nothing; the same world's measures,
// changed, are found and flagged.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { diff, exportLogs } from "@terrarium/measure";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;

test("the diff finds nothing between a batch and itself, and lists every measure it compared", async () => {
  const { generate } = await import("@terrarium/worlds/generator/generate");
  const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
  const out = join(root, "runs", "test-diff");
  rmSync(out, { recursive: true, force: true });
  const logs: string[] = [];
  for (const seed of [1, 2]) logs.push((await runWorld({ config: { ...generate({ ...spec, citizens: 60 }), seed }, runId: `town.seed${seed}`, outDir: out, until: 20 * DAY })).logPath);
  await exportLogs(logs, join(out, "measure"));
  const rows = await diff(join(out, "measure"), join(out, "measure"));
  expect(rows.length).toBeGreaterThan(20);
  expect(rows.filter((r) => r.flagged)).toEqual([]);
  expect(rows.every((r) => r.n[0] === 2 && r.base === r.change)).toBe(true);
}, 300_000);
