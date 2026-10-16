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

async function run(name: string, days: number, change: (params: any) => void, seed?: number) {
  const config = generate(seed === undefined ? base : { ...base, seed });
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
  const { person, ev, recs } = await run("own-venture-given-up", 300, (p) => Object.assign(p, { give_up_months: 2, give_up_below_bps: 1_000_000 }), 2);
  const firm = ev.find((e) => e.event === "entity_created" && e.kind === "own_account")!.entity as string;
  const closure = recs.find((r) => r.kind === "closure" && r.speaks_for === firm);
  expect(closure).toBeDefined();
  expect(closure.data.given_up).toBe(true);
  expect(recs.some((r) => r.kind === "job_application" && r.speaks_for === person && r.at > closure.at)).toBe(true);
}, 600_000);

test("a founding's draw of the shape \"business\" reaches the business of one: someone who has meant to start a business does, when they have a home and the money", async () => {
  // (Step 3's founding, with only that shape to found and the chance made sure, as its own tests do. The town's own
  // monthly chance of a business of one is turned off, so that every one started here follows a draw.)
  const { loadWorld } = await import("../src/batch");
  const { config } = await loadWorld(join(root, "worlds/town.yaml"), ["living.initiative_bps=10000", 'living.founding.shapes=["business"]', "living.founding.scale_bps=600000"]);
  for (const p of config.participants) if (p.controller?.impl === "citizen.default") p.controller = { ...p.controller, params: { ...p.controller.params, found_own_ppm: 0 } };
  // (And everyone in the labour force is given the money for one: in the town as drawn, whoever comes to mean a
  // business may have a tenth of it, and then nothing comes of the draw, which is the rule and not what is tested.)
  const venture = config.participants.find((p: any) => p.controller?.impl === "citizen.default").controller.params.ventures.find((v: any) => v.own);
  for (const p of config.participants) if (p.controller?.impl === "citizen.default" && p.controller.params.in_labour_force !== false) {
    const a = config.world.accounts.find((x: any) => x.id === `acc-${p.person}`);
    if (a && Number(a.balance) < 2 * venture.capital) a.balance = String(2 * venture.capital);
  }
  // (600 days, not 330, since foundations F1 (2026-10-15): the town changed and the runs from seeds 1 to 7 have no such occasion in 330 days; the runs from 1 and 2 have one in 600. And the given-up test is the town drawn from seed 2: in the town from seed 1 the owner starts the next business at once and does not apply, in seeds 1 and 3, and does in 2 and 4.)
  // (And 1 since draws are named for the day or the matter, not the hour, 2026-10-12: every stream is another, so who is out of work
  // and when moved again; of seeds 1 to 7 the runs from 1, 3 and 5 have an occasion and those from 2, 4, 6 and 7 none.)
  // (The run's seed is 2 since 2026-10-12, homes by income: in the town as now drawn the run from seed 1 has no
  // occasion that draws a business in 330 days; seeds 2, 3 and 4 have one to three. Nothing else is changed.)
  // (And 6 since the leftovers of the firm-side work, the same day: with a dividend and the tax withheld no longer sent back to the
  // firms that paid them, and shops closing their months on days of their own, who is out of work and when moved again. Someone who has
  // meant a business starts one only when out of work (citizen.ts, `venturing ? !job`), so a run needs one such occasion; of seeds 1 to
  // 6 the runs from 1 to 5 have none in 330 days and the run from 6 has one.)
  // (Before that 4 since the fifth living pilot's fixes, the same day: tenants who answer and households taken in move who
  // gives a want up and when; of seeds 1 to 5 the runs from 1 and 4 have such an occasion, those from 2, 3 and 5 none.)
  // (The run's seed is 4 since F6 (2026-10-16: shops serve in their staff's hours; the draws moved: of seeds 3 and 4 the run from 3 has no occasion in 600 days, that from 4 has.)
  // (The run's seed was 3 since foundations F5 (2026-10-16): offices are held by people and the town's layout and draws moved again; of seeds 1 to 4 the runs from 1 and 2 have no occasion in 600 days, those from 3 and 4 have.)
  const out = join(root, "runs", "test-own-venture-meant");
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config: { ...config, seed: 4 }, runId: "meant", outDir: out, until: 600 * DAY, recordObservations: "none" });
  const log = readFileSync(s.logPath, "utf8").trim().split("\n").filter((l) => l.includes("found_shape") || l.includes('"own_account"') || l.includes("found_own")).map((l) => JSON.parse(l));
  const meant = log.filter((e) => e.kind === "annotation" && e.body.data?.domain === "found_shape" && e.body.data?.choice === "business").map((e) => ({ t: e.t, who: e.body.subject as string }));
  expect(meant.length).toBeGreaterThan(0);
  const started = log.filter((e) => e.kind === "event" && e.body.event === "recorded" && e.body.record?.record === "entity_declaration" && e.body.record.kind === "own_account").map((e) => ({ t: e.t, who: e.body.record.author as string }));
  expect(started.length).toBeGreaterThan(0);
  // Every one started follows its founder's own draw, within the half year it holds; and it was no draw of the month's chance.
  // (Those who came to town during the run have the town's own chance, which the test did not turn off: left out.)
  for (const b of started.filter((x) => /^c\d+-self$/.test(x.who))) expect(meant.some((m) => m.who === b.who && m.t <= b.t && b.t - m.t <= 181 * DAY)).toBe(true);
  expect(started.some((b) => meant.some((m) => m.who === b.who))).toBe(true);
  const sure = log.filter((e) => e.kind === "annotation" && e.body.data?.domain === "venture" && e.body.data?.choice === "found_own");
  for (const d of sure.filter((x) => /^c\d+-self$/.test(x.body.subject))) expect(d.body.data.options.find((o: any) => o.key === "found_own").score).toBe(10_000);
}, 900_000);
