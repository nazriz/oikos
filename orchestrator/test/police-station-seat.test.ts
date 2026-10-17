// The police station when a model holds it (docs/behaviour/standing-work.md, "The police station"): its officers carry
// out warrants, look into reports and call at homes under standing work orders in force at the start, as the code
// station does; the office-holder hires and makes the orders and is told what the officers did. A mock seat whose brain
// is the station's own code stands for the model.

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
// (The town opens with the tribunal's orders for possession part-way through, so that warrants are asked for in the first months.)
// (Seed 7 and 330 days where it was seed 3 and 200: foundations F5 moved the town's draws and the tribunal's person-time, and no seed from 1 to 9 had two warrants carried out in 200 days; seed 7 has two in 330.)
// (Measured 2026-10-16 on the foundations-review branch, the code twin for 330 days, seeds 1 to 8, against the tree before foundations F5 (24c14ea): warrants issued 4, 3, 1, 1, 0, 1, 2, 2 now (14; executed 11) and 4, 2, 4, 4, 1, 1, 2, 3 before (21; executed 15); a tribunal's papers of hearing notice 54 against 78. Cases come later and fewer, as the tribunal's staff are people whose time is spent (F5, as intended), and the station carries out all but one of the warrants it is given. Seed 3, the original, issues one warrant, on day 301. So two warrants carried out in the one town is a rare draw now; seed 7 has two.)
// (450 days where it was 330, 2026-10-17, the bug hunt, finding 3: a landlord no longer takes a dead tenant to the tribunal, so one warrant fewer is issued in this town; no seed of 1 to 9 has two in 330 days (0, 1, 0, 1, 0, 0, 1, 1, 0), and seed 7 has two in 450, both carried out.)
const town = { ...spec, seed: 7, citizens: 300, profile: "ke-nakuru-2026", opening_caseload: true, living: { initiative_bps: 10_000, friction_bps: 60_000 } };

async function run(over: object, days: number, seated: boolean, tweak?: (config: any) => void): Promise<any[]> {
  const config = generate({ ...town, ...over, ...(seated ? { mayor: "llm", model_seats: ["police-oic"] } : {}) }) as any;
  for (const p of config.participants) if (p.controller?.type === "llm") p.controller.params.mock = { ...p.controller.params.mock, back_days: 3 };
  tweak?.(config);
  const out = mkdtempSync(join(tmpdir(), "oikos-police-"));
  const recs: any[] = [];
  try {
    const s = await runWorld({ config: { ...config, log: { ...config.log, detail: "lean" } }, runId: "police", outDir: out, until: days * DAY, recordObservations: "none" });
    expect(s.participantErrors).toBe(0);
    for (const l of readFileSync(s.logPath, "utf8").split("\n")) if (l.includes('"event":"recorded"')) { const r = JSON.parse(l).body.record; if (r?.record === "statement") recs.push(r); }
  } finally { rmSync(out, { recursive: true, force: true }); }
  return recs;
}
// (Each by the days from the registrar's warrant to the officers carrying it out: that is the station's work. When the warrant itself is issued is the tribunal's and
// its landlord's, and a seat in the station is a person's time spent, so what a town does elsewhere on other days is another town from there: foundations F6, where
// the same warrant was issued 28 days earlier in the town with the seat and carried out 8.4 days after in both.)
const executed = (recs: any[]) => recs.filter((r) => r.kind === "warrant_executed").map((r) => {
  const issued = recs.find((q) => q.kind === "warrant" && q.data?.lease === r.data.lease);
  return { warrant: r.data.lease, day: Math.floor((r.at - (issued?.at ?? 0)) / DAY), removed: r.data.removed };
}).sort((a, b) => (a.warrant < b.warrant ? -1 : 1));

test("a mock seat in the station over 450 days: the warrants are carried out as in the code twin, by the officers, under the orders in force at the start", async () => {
  const twin = await run({}, 450, false), seat = await run({}, 450, true);
  // The station's work is on the warrants both towns issued: when a warrant is issued is the tribunal's and its landlord's, and a seat in the station is a person's time spent, so
  // a town elsewhere is another town from there (foundations F8: with the support office asking for papers and looking at its refusals again, the twin issued a warrant on day 225 that
  // the town with the seat never did; no seed of 1 to 9 had two matching warrants and the same set issued in both). It is held to: every warrant both issued is carried out in both.
  const issuedIn = (recs: any[]) => new Set(recs.filter((r) => r.kind === "warrant").map((r) => r.data?.lease));
  const both = (recs: any[]) => executed(recs).filter((x) => issuedIn(twin).has(x.warrant) && issuedIn(seat).has(x.warrant));
  const a = both(twin), b = both(seat);
  expect(a.length).toBeGreaterThanOrEqual(2);
  expect(b.map((x) => x.warrant)).toEqual(a.map((x) => x.warrant));
  // (How many of a household were at home when the officer came is the hour's: it is not held equal.)
  for (const [i, x] of b.entries()) expect(Math.abs(x.day - a[i]!.day), x.warrant).toBeLessThanOrEqual(1);
  expect(seat.filter((r) => r.kind === "warrant_lapsed")).toEqual(twin.filter((r) => r.kind === "warrant_lapsed"));
  // The orders were in force at the start, made in the office's post before the year; the seat made none of its own.
  const orders = seat.filter((r) => r.kind === "work_order");
  expect(orders.filter((r) => r.in_position === "police-oic")).toEqual([]); // (genesis records are not "recorded" in the run: none made in it)
  // The office-holder is told what its officers did, in the staff's own words, as it comes.
  const reports = seat.filter((r) => r.kind === "staff_report" && r.data?.office === "police-oic");
  expect(reports.length).toBeGreaterThan(10);
  const said = reports.map((r) => r.text).join(" ");
  expect(said).toContain("carry_out_warrants");
  expect(said).toMatch(/carried out: \d+ days' work, \d+ warrants carried out/);
  const done = Math.max(...reports.flatMap((r) => (r.data.orders as any[]).filter((o) => o.task === "carry_out_warrants").map((o) => Number(o.units ?? 0))));
  expect(done).toBeGreaterThanOrEqual(1);
  // And the code twin made no staff report: a station run by code is as it was.
  expect(twin.filter((r) => r.kind === "staff_report" && r.data?.office === "police-oic")).toEqual([]);
}, 600_000);

test("with no standing order in force nothing is carried out, and the officers say so: nothing carries itself out", async () => {
  // (A seat's mock makes the office's orders at its first sitting, as an office-holder would, if none is on file; so that
  // the staff have none to follow, each order the town opens with is put on hold, by the office, before the year.)
  const seat = await run({}, 60, true, (config) => {
    for (const o of config.world.records.filter((r: any) => r.kind === "work_order" && r.in_position === "police-oic"))
      config.world.records.push({ id: `hold-${o.id}`, record: "statement", author: "genesis", at: 0, visible_to: o.visible_to, speaks_for: o.speaks_for, in_position: "police-oic", kind: "hold", addressed_to: o.addressed_to, text: `Please hold ${o.id}.`, data: { holds: [o.id] } });
  });
  expect(executed(seat)).toEqual([]);
  expect(seat.filter((r) => r.kind === "warrant").length).toBeGreaterThanOrEqual(1);
  const said = seat.filter((r) => r.kind === "staff_report" && r.data?.office === "police-oic").map((r) => r.text).join(" ");
  expect(said).toContain("on hold: not carried out while the hold stands");
}, 300_000);
