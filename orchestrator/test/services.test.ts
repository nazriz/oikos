// The town's services (phase C, stage C4b): the works office hires the crew the budget's staff line pays for, and the
// finance officer pays them; the crew collects waste from homes as it builds up, takes it to the landfill (which
// invoices the town, and the town pays), and keeps the town's assets up. With no staff in the budget, nobody collects,
// waste piles up in homes, and people complain to the town.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@terrarium/worlds/generator/generate";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const base = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

async function run(name: string, config: any, days: number) {
  const out = join(root, "runs", `test-services-${name}`);
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config, runId: name, outDir: out, until: days * DAY });
  const log = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  expect(log.filter((e) => e.kind === "annotation" && (e.body.data?.call_unresolved || e.body.data?.call_unreadable)).map((e) => e.body.data)).toEqual([]);
  const ev = log.filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
  return { ev, recs: ev.filter((e) => e.event === "recorded").map((e) => e.record) };
}

test("a crew the budget pays for collects the waste, takes it to the landfill, and keeps the town's assets up", async () => {
  const config = generate({ ...base, mayor: "code" });
  const { ev, recs } = await run("crew", config, 100);
  // The town's crew (from the start, and any the works office hires), paid by the finance officer's standing orders.
  const all = [...config.world.records, ...recs];
  const jobs = all.filter((r: any) => r.record === "agreement" && r.terms.template === "employment" && r.terms.parties[0] === "city");
  expect(jobs.length).toBeGreaterThanOrEqual(1);
  expect(recs.filter((r) => jobs.includes(r)).every((j) => j.in_position === "works")).toBe(true);
  const wages = all.filter((r: any) => r.kind === "request" && r.speaks_for === "city" && jobs.some((j: any) => j.id === r.basis) && r.data?.every);
  expect(wages.length).toBeGreaterThanOrEqual(1);
  expect(wages.every((w: any) => w.in_position === "finance")).toBe(true);
  expect(ev.some((e) => e.event === "transfer" && e.from === "acc-city" && wages.some((w) => w.id === e.per_instruction))).toBe(true);
  // Collecting: every home building has its waste collected, from the depot, by the crew.
  const homes = config.world.structures.filter((st: any) => ["house", "large-house", "apartments"].includes(st.type)).map((st: any) => st.id);
  const collected = new Set(ev.filter((e) => e.event === "worked" && e.task === "collect" && e.at === "town-hall").map((e) => e.on));
  for (const h of homes) expect(collected.has(h)).toBe(true);
  // To the landfill weekly, with a docket; the landfill invoices the town; the finance officer pays it.
  const dockets = recs.filter((r) => r.kind === "disposal_docket" && r.speaks_for === "city");
  expect(dockets.length).toBeGreaterThanOrEqual(8);
  const invoices = recs.filter((r) => r.kind === "invoice" && r.speaks_for === "outside" && (r.addressed_to ?? []).includes("city"));
  expect(invoices.length).toBeGreaterThanOrEqual(2);
  expect(ev.some((e) => e.event === "transfer" && e.from === "acc-city" && e.to === "acc-outside" && invoices.some((i) => i.id === e.settles))).toBe(true);
  // Upkeep: the hall is maintained.
  expect(ev.some((e) => e.event === "worked" && e.task === "maintain" && e.on === "town-hall")).toBe(true);
  // Nobody needs to complain.
  expect(recs.filter((r) => r.kind === "complaint").length).toBeLessThanOrEqual(2);
}, 600_000);

test("with no staff in the budget the crew is let go, nobody collects the waste, and people complain to the town", async () => {
  const config = generate({ ...base, mayor: "code" });
  config.participants.find((p: any) => p.id === "mayor-system").controller.params.staff_budget = 0;
  const { ev, recs } = await run("no-crew", config, 100);
  // Once the budget is adopted, the crew is let go (with notice); after that, nothing is collected.
  const notices = recs.filter((r) => r.record === "notice" && r.text === "Redundancy: the budget doesn't pay for the position.");
  expect(notices.length).toBeGreaterThanOrEqual(1);
  const gone = Math.max(...notices.map((n) => n.at)) + 14 * DAY;
  expect(ev.some((e) => e.event === "worked" && e.task === "collect" && e.t > gone + DAY)).toBe(false);
  const complaints = recs.filter((r) => r.kind === "complaint" && r.at > gone);
  expect(complaints.length).toBeGreaterThan(5);
  for (const c of complaints) {
    expect(c.addressed_to).toEqual(["city"]);
    expect(c.data.days).toBeGreaterThanOrEqual(14);
  }
}, 600_000);
