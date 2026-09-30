// Invariance (docs/design/rebuild.md 6.5, 8.1): what happens over a period mustn't depend on how often anyone wakes.
// A module that counts per wake instead of by elapsed time (the 23-shopping-trips bug) shows here as a jump when
// units are woken more often than their cadence. Perturbed runs are for tests only; the log says a run was perturbed.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

async function measure(name: string, perturb?: { extraWakesBps: number; seed: number }) {
  const { generate } = await import("@terrarium/worlds/generator/generate");
  const out = join(root, "runs", `test-invariance-${name}`);
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config: generate({ ...spec, citizens: 200 }), runId: name, outDir: out, until: 120 * DAY, perturb });
  const log = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const ev = log.filter((e) => e.kind === "event" && e.t >= 30 * DAY).map((e) => e.body); // after the first month
  const units = (task: string) => ev.filter((e) => e.event === "worked" && e.task === task).reduce((a, e) => a + e.units, 0);
  return {
    perturbed: log.some((e) => e.kind === "annotation" && e.body.data?.perturbed),
    wakes: s.wakes,
    measures: {
      goods_to_households: ev.filter((e) => e.event === "goods_moved" && /^c\d+$/.test(e.to)).reduce((a, e) => a + Number(e.quantity), 0),
      orders: ev.filter((e) => e.event === "recorded" && e.record.kind === "order" && /^c\d+$/.test(e.record.speaks_for)).length,
      transfers: ev.filter((e) => e.event === "transfer").length,
      made: units("make"),
      served: units("serve"),
      collected: units("collect"),
    },
  };
}

test("woken more often, the town does the same over time: nothing counts per wake", async () => {
  const base = await measure("base");
  const more = await measure("more-wakes", { extraWakesBps: 5000, seed: 7 });
  expect(base.perturbed).toBe(false);
  expect(more.perturbed).toBe(true);
  expect(more.wakes).toBeGreaterThan(base.wakes * 1.05);
  // Each measure within 10% (what different draws alone move it by, at this size), or it's listed here.
  const off = Object.entries(base.measures).map(([k, v]) => ({ measure: k, base: v, more_wakes: (more.measures as any)[k] as number }))
    .filter((x) => Math.abs(x.more_wakes - x.base) > 0.1 * Math.max(1, x.base));
  expect(off).toEqual([]);
}, 600_000);
