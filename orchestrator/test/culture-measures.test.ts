// Culture's measures, read from a log (docs/behaviour/culture.md, "Measures"; orchestrator/src/culture-measures.ts): norm
// shares over time by conduct and group, spread across people, verdicts voiced, talk about conduct, standing lost and
// gained, the gap between said and thought, events remembered and how far they travelled, tipping events. Held on the
// definitions (a pure function on made-up decisions) and on a small real run (a full log, so decisions are in it).
// Nothing here judges: no figure is a target. No model is called.

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { currentLogs } from "../src/logs";
import { exportDataset } from "../src/dataset";
import { cultureMeasures, renderCultureMeasures, tippingEvents, TIPPING, type Dec } from "../src/culture-measures";
import { pilotReport } from "../src/pilot-report";
import { runWorld } from "../src/run";

const DAY = 86_400;
const root = join(import.meta.dir, "../..");
const base = Bun.YAML.parse(readFileSync(join(root, "worlds/town-300.yaml"), "utf8")) as any;

const decs = (group: (i: number) => string, days: [number, number][], rate: (day: number) => number, per = 12): Dec[] =>
  days.flatMap(([from, to]) => Array.from({ length: to - from }, (_, d) => from + d).flatMap((day) => Array.from({ length: per }, (_, i) => ({ t: day * DAY + i, who: `p${i}`, conduct: "join_union", did: i < Math.round(per * rate(day)), approves: 40 + (day > 100 ? 20 : 0) }))));

test("a tipping event is a group's rate of doing a conduct moving from under a third to over two thirds (or back) inside 90 days; a slow drift is none", () => {
  const groups = { origin: new Map(Array.from({ length: 12 }, (_, i) => [`p${i}`, "a"] as [string, string])) };
  // A rate that is 10% for 100 days and 90% from day 120: a tipping event up, with the approval before and after.
  const up = tippingEvents(decs(() => "a", [[0, 200]], (d) => (d < 110 ? 0.1 : 0.9)), groups);
  expect(up.filter((e) => e.grouping === "origin").length).toBeGreaterThan(0);
  const e = up.find((x) => x.grouping === "origin")!;
  expect(e.direction).toBe("up");
  expect(e.rate_before_bps).toBeLessThan(TIPPING.low_bps);
  expect(e.rate_after_bps).toBeGreaterThan(TIPPING.high_bps);
  expect(e.to_day - e.from_day).toBeLessThanOrEqual(TIPPING.within_days);
  expect(e.approves_before).not.toBeNull();
  // The same rise spread over 300 days crosses no window pair inside 90 days: not a tipping event.
  const slow = tippingEvents(decs(() => "a", [[0, 330]], (d) => 0.1 + (0.8 * d) / 330), groups);
  expect(slow.length).toBe(0);
  // And back down.
  expect(tippingEvents(decs(() => "a", [[0, 200]], (d) => (d < 110 ? 0.9 : 0.1)), groups).some((x) => x.direction === "down")).toBe(true);
  // Too few decisions in a window is no rate.
  expect(tippingEvents(decs(() => "a", [[0, 200]], (d) => (d < 110 ? 0.1 : 0.9), 12).filter((d) => Math.floor(d.t / DAY) % 20 === 0 && d.who === "p0"), groups).length).toBe(0);
});

test("a run with culture on is measured from its log: norm shares by group, verdicts and talk counted, events remembered, decisions read; one without it has none", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oikos-cm-"));
  try {
    const config = generate({ ...base, seed: 1, living: { initiative_bps: 10_000, friction_bps: 30_000, culture: true }, opening_caseload: true }) as any;
    await runWorld({ config, runId: "town-300.seed1", outDir: join(dir, "on"), until: 40 * DAY });
    const log = currentLogs(join(dir, "on"))[0]!;
    const m = await cultureMeasures(log, { days: [10, 20, 30, 40], nearEvents: ["put_out"] });
    expect(m).toBeDefined();
    expect(m.norm_shares.length).toBeGreaterThan(0);
    const first = m.norm_shares.find((s: any) => s.grouping === "all" && s.day === 10);
    for (const k of ["does", "approves", "own", "says", "does_sd", "approves_sd", "voiced_pct", "pluralistic_pct", "gap_own_says", "people"]) expect(typeof first[k]).toBe("number");
    expect(first.people).toBeGreaterThan(50);
    expect(m.groupings).toContain("origin"); // (the town-300 profile has origin groups)
    expect(m.norm_shares.some((s: any) => s.grouping === "origin")).toBe(true);
    expect(m.norm_shares.some((s: any) => s.grouping === "near_put_out")).toBe(true);
    expect(m.memory.length).toBe(4);
    expect(m.decisions_recorded).toBeGreaterThan(0);
    expect(typeof m.talk.about).toBe("number");
    expect(m.tipping.definition).toContain("under 33.33%");
    // Through the report and the dataset, as existing measures are.
    const report = await pilotReport(join(dir, "on"), false);
    expect(report.culture?.norm_shares.length).toBeGreaterThan(0);
    expect(renderCultureMeasures(report.culture).join("\n")).toContain("culture");
    const manifest = await exportDataset(log, join(dir, "ds"), {});
    expect(manifest.run).toBeDefined();
    // Without the dial: nothing to measure, and the report says nothing of culture.
    const off = generate({ ...base, seed: 1, living: { initiative_bps: 10_000 } }) as any;
    await runWorld({ config: off, runId: "town-300.seed1", outDir: join(dir, "off"), until: 5 * DAY });
    const offLog = currentLogs(join(dir, "off"))[0]!;
    expect(await cultureMeasures(offLog)).toBeUndefined();
    expect((await pilotReport(join(dir, "off"), false)).culture).toBeUndefined();
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 240_000);
