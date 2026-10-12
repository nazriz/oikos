// Returns on the law's days (docs/behaviour/firms.md, "Returns on the law's days"): in a short run of a town whose profile
// lists four returns by the 9th (and the housing levy's by the 13th), every employer's returns land on the calendar's days
// whatever day it began paying, a month with nothing withheld leaves no paper, and each report says which return it is.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { nextReturn, returnsOf, taxLawOf } from "@oikos/participants";
import { generate } from "@oikos/worlds/generator/generate";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const base = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

test("every employer's returns fall on the days the published law states", async () => {
  const config = generate({ ...base, profile: "ke-nakuru-2026", citizens: 80 });
  const out = join(root, "runs", "test-returns-run");
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config, runId: "returns-run", outDir: out, until: 100 * DAY });
  const log = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const recs = log.filter((e) => e.kind === "event" && e.body.event === "recorded").map((e) => e.body.record);
  const lawRecord = config.world.records.find((r: any) => r.id === "law-income-tax");
  expect(lawRecord.text).toContain("the 9th day of the month after");
  expect(lawRecord.text).toContain("NSSF contribution (NSSF Act 2013)");
  const law = taxLawOf(lawRecord.id, lawRecord.data, lawRecord.speaks_for)!;
  const rules = returnsOf(law);
  expect(rules.map((r) => [r.id, r.day])).toEqual([["paye", 9], ["nssf", 9], ["shif", 9], ["housing-levy", 13]]);
  const reports = recs.filter((r) => r.kind === "withholding_report");
  expect(reports.length).toBeGreaterThan(8);
  const filers = new Set(reports.map((r) => r.speaks_for));
  expect(filers.size).toBeGreaterThan(3);
  const days = new Set<string>();
  for (const r of reports) {
    const rule = rules.find((x) => x.id === r.data.return);
    expect(rule, `a report names its return: ${JSON.stringify(r.data)}`).toBeDefined();
    // The due day is the calendar's: the first of the rule's days after the period ended (these rules fall in the month after), whatever day the payroll started.
    expect(r.data.due).toBe(nextReturn(rule!, r.data.period_to - 1).due);
    // Filed on the day (the offices that look in every few days, by it, at their last look before: at most a week early; none later than the weekend after).
    expect(r.at).toBeGreaterThanOrEqual(r.data.due - 7 * DAY);
    expect(r.at).toBeLessThan(r.data.due + 3 * DAY); // (a due day on a weekend is filed on the Monday: a firm does not look in then)
    // Nothing withheld, no paper.
    expect(r.data.withheld).toBeGreaterThan(0);
    days.add(`${r.data.return}@${r.data.due / DAY}`);
  }
  // The days are the same for everyone: a return of one kind falls on one of the profile's days, three in this run.
  expect([...days].map((d) => d.split("@")[0]!).filter((x) => x === "paye").length).toBeLessThanOrEqual(3);
  expect([...days].map((d) => Number(d.split("@")[1])).every((d) => [38, 42, 68, 72, 98].includes(d))).toBe(true);
}, 600_000);
