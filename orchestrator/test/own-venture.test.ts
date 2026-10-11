// A business of one started in a run (docs/behaviour/entry.md, "Starting a business of one"): someone with a home to
// trade from and the savings founds it, puts in its capital, and works it alone; what it clears is paid to them. One
// that does not pay its owner a living for months is given up: it says it has closed, and its owner looks for work.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const base = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

async function run(name: string, days: number, change: (params: any) => void) {
  const config = generate(base);
  const citizens = config.participants.filter((p: any) => p.controller?.impl === "citizen.default");
  // (The town's own chance is small: nobody else starts one in the test.)
  for (const p of citizens) p.controller = { ...p.controller, params: { ...p.controller.params, found_own_ppm: 0 } };
  const age = (id: string) => -config.world.entities.find((e: any) => e.id === id).born_at / (365 * DAY);
  const housed = new Set(config.world.occupancy.map((o: any) => o.occupant));
  const employed = new Set(config.world.records.filter((r: any) => r.record === "agreement" && r.terms.template === "employment").map((r: any) => r.terms.parties[1]));
  const one = citizens.find((p: any) => p.controller.params.in_labour_force !== false && age(p.person) >= 25 && age(p.person) < 50 && housed.has(p.person) && !employed.has(p.person))!;
  expect(one).toBeDefined();
  config.world.accounts.find((a: any) => a.id === `acc-${one.person}`).balance = "20000000";
  one.controller.params.found_own_ppm = 1_000_000;
  change(one.controller.params);
  const out = join(root, "runs", `test-${name}`);
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config: { ...config, log: { ...config.log, detail: "lean" } }, runId: name, outDir: out, until: days * DAY, recordObservations: "none" });
  const log = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const ev = log.filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
  return { config, person: one.person as string, ev, recs: ev.filter((e) => e.event === "recorded").map((e) => e.record) };
}

test("the generated town offers the venture, at a chance derived from its profile's business birth rate", () => {
  const config = generate(base);
  const p = config.participants.find((x: any) => x.controller?.impl === "citizen.default").controller.params;
  const own = p.ventures.find((v: any) => v.own);
  expect(own.kind).toBe("own_account");
  expect(own.capital).toBeGreaterThan(0);
  expect(p.found_own_ppm).toBeGreaterThan(0);
  expect(p.found_own_ppm).toBeLessThan(100_000);
  expect(config.catalogue.tasks.some((t: any) => t.id === "sell")).toBe(true);
});

test("someone out of work with savings and a home starts a business of one, puts in its capital, sells from home and is paid what it clears", async () => {
  const { person, ev, recs } = await run("own-venture", 150, () => {});
  const made = ev.find((e) => e.event === "entity_created" && e.kind === "own_account");
  expect(made).toBeDefined();
  const firm = made.entity as string;
  const post = ev.find((e) => e.event === "position_created" && e.entity === firm);
  expect(post.role_module.code).toBe("firm.retailer");
  expect(post.role_module.params.operator).toBe(person);
  const call = recs.find((r) => r.kind === "capital_call" && r.speaks_for === firm);
  expect(call.addressed_to).toEqual([person]);
  expect(ev.some((e) => e.event === "transfer" && e.to === call.data.account && e.from === `acc-${person}`)).toBe(true);
  expect(recs.find((r) => r.kind === "shareholders" && r.speaks_for === firm)?.data.holders[0].holder).toBe(person);
  // It trades: its prices are up, its owner serves customers, and it pays them what it clears.
  expect(recs.some((r) => r.kind === "price_list" && r.speaks_for === firm)).toBe(true);
  expect(ev.some((e) => e.event === "worked" && e.task === "sell" && e.t > made.t)).toBe(true);
  expect(ev.some((e) => e.event === "transfer" && e.from === call.data.account && e.to === `acc-${person}`)).toBe(true);
  // Its owner is not looking for work.
  expect(recs.some((r) => r.kind === "job_application" && r.speaks_for === person && r.at > made.t + 14 * DAY)).toBe(false);
}, 600_000);

test("a business of one that does not pay its owner a living is given up: it closes, and its owner looks for work again", async () => {
  // (Judged after two months, against a living nobody's trade from home could clear: for the test.)
  const { person, ev, recs } = await run("own-venture-given-up", 200, (p) => Object.assign(p, { give_up_months: 2, give_up_below_bps: 1_000_000 }));
  const firm = ev.find((e) => e.event === "entity_created" && e.kind === "own_account")!.entity as string;
  const closure = recs.find((r) => r.kind === "closure" && r.speaks_for === firm);
  expect(closure).toBeDefined();
  expect(closure.data.given_up).toBe(true);
  expect(recs.some((r) => r.kind === "job_application" && r.speaks_for === person && r.at > closure.at)).toBe(true);
}, 600_000);
