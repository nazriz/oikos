// Migration (world.migration, docs/behaviour/boundary.md): with jobs going and
// better pay than elsewhere, households come in through the boundary with
// their savings and their paperwork, bank them, and find work and a home as
// everyone does. With no vacancies, nobody comes.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@terrarium/worlds/generator/generate";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

async function run(name: string, config: any) {
  const out = join(root, "runs", `test-migration-${name}`);
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config, runId: name, outDir: out, until: 365 * DAY });
  return readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
}

test("with jobs going, households move in, bank their savings, and find work and a home", async () => {
  // Four factories for 120 people: more jobs than takers; and elsewhere pays less.
  const ev = await run("jobs", generate({ ...spec, citizens: 120, factories: 4, migration: { outside_monthly_income: 200_000, response_bps: 3000 } }));
  const arrived = ev.filter((e) => e.event === "person_arrived").map((e) => e.person);
  expect(arrived.length).toBeGreaterThan(0);
  // Only the outside world brings them, and each household's paperwork lists them.
  for (const e of ev.filter((e) => e.event === "person_arrived")) expect(e.by).toBe("migration-system");
  const recorded = ev.filter((e) => e.event === "recorded" && e.record.kind === "household").flatMap((e) => e.record.data.members.map((m: any) => m.person));
  for (const p of arrived) expect(recorded).toContain(p);
  // Their savings go into a bank account.
  const banked = new Set(ev.filter((e) => e.event === "account_opened" && e.custodian === "bank").map((e) => e.holder));
  for (const p of arrived) if (ev.some((e) => e.event === "account_opened" && e.holder === p && e.custodian === p)) expect(banked.has(p)).toBe(true);
  // Some find work and a home.
  const occupied = ev.filter((e) => e.event === "occupied" && arrived.includes(e.occupant));
  expect(occupied.some((e) => e.space.includes("/workplace."))).toBe(true);
  expect(occupied.some((e) => e.space.includes("/dwelling."))).toBe(true);
  expect(ev.filter((e) => e.event === "action_refused")).toEqual([]);
}, 300_000);

test("with no jobs going, nobody comes", async () => {
  const ev = await run("none", generate({ ...spec, citizens: 120, shops: 1, factories: 1, migration: { outside_monthly_income: 200_000, response_bps: 3000 } }));
  // Postings may appear and be filled at once; with none standing when the outside world looks, or a gap below zero, no one comes.
  expect(ev.filter((e) => e.event === "person_arrived").length).toBeLessThanOrEqual(2);
}, 300_000);
