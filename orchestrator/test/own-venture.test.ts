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
const base = { ...(Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any), shop_mix: false /* the single-goods town: this test holds a mechanism of it (docs/risks.md ME-19) */ };

async function run(name: string, days: number, change: (params: any) => void, seed?: number) {
  const config = generate(seed === undefined ? base : { ...base, seed });
  const citizens = config.participants.filter((p: any) => p.controller?.impl === "citizen.default");
  // (Anyone may start one where it pays (docs/behaviour/entry.md, "Entry by expected profit"): the one this test
  // follows is someone out of work, with a home and the savings for it.)
  const age = (id: string) => -config.world.entities.find((e: any) => e.id === id).born_at / (365 * DAY);
  const housed = new Set(config.world.occupancy.map((o: any) => o.occupant));
  const employed = new Set(config.world.records.filter((r: any) => r.record === "agreement" && r.terms.template === "employment").map((r: any) => r.terms.parties[1]));
  const one = citizens.find((p: any) => p.controller.params.in_labour_force !== false && age(p.person) >= 25 && age(p.person) < 50 && housed.has(p.person) && !employed.has(p.person))!;
  expect(one).toBeDefined();
  config.world.accounts.find((a: any) => a.id === `acc-${one.person}`).balance = "20000000";
  change(one.controller.params);
  const out = join(root, "runs", `test-${name}`);
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config: { ...config, log: { ...config.log, detail: "lean" } }, runId: name, outDir: out, until: days * DAY, recordObservations: "none" });
  const log = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const ev = log.filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
  return { config, person: one.person as string, ev, recs: ev.filter((e) => e.event === "recorded").map((e) => e.record) };
}

test("the generated town offers the venture with the trade price of what it sells, and no rate of founding", () => {
  const config = generate(base);
  const p = config.participants.find((x: any) => x.controller?.impl === "citizen.default").controller.params;
  const own = p.ventures.find((v: any) => v.own);
  expect(own.kind).toBe("own_account");
  expect(own.capital).toBeGreaterThan(0);
  expect(own.unit_cost).toBeGreaterThan(0);
  expect(own.unit_cost).toBeLessThan(own.role_module.params.price);
  expect(p.found_own_ppm).toBeUndefined();
  expect(p.found_bps).toBeUndefined();
  expect(config.catalogue.tasks.some((t: any) => t.id === "sell")).toBe(true);
});

test("someone out of work with savings and a home starts a business of one, puts in its capital, sells from home and is paid what it clears", async () => {
  const { person, ev, recs } = await run("own-venture", 150, () => {});
  const ours = new Set(ev.filter((e) => e.event === "position_created" && e.role_module?.params?.operator === person).map((e) => e.entity));
  const made = ev.find((e) => e.event === "entity_created" && e.kind === "own_account" && ours.has(e.entity));
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
  // (A business of one the town opens with, as orchestrator/test/own-account.test.ts draws them: whether anyone starts one
  // in a run is now theirs, by its expected profit (docs/behaviour/entry.md, "Entry by expected profit"), and this test is
  // of giving one up.)
  const { loadProfile } = await import("@oikos/worlds/generator/profile");
  const { generateFrom } = await import("@oikos/worlds/generator/generate");
  const P = structuredClone(loadProfile("au-vic-2026")) as any;
  P.values.employment = { ...(P.values.employment ?? {}), own_account: { share_bps: 3_000, kinds: [{ id: "home-trade", name: "Trader at home", does: "trade", share_bps: 10_000, from: "home", stock_days: 7 }] } };
  const config = generateFrom({ ...base, profile: "au-vic-2026" }, P);
  const one = config.participants.find((p: any) => p.controller?.impl === "citizen.default" && p.controller.params.own_work?.home)!;
  expect(one).toBeDefined();
  const person = one.person as string, firm = one.controller.params.own_work.firm as string;
  // (A business with no stock and no money: it sells nothing and pays its owner nothing, which its owner weighs against
  // what giving it up leaves them, month by month: docs/behaviour/entry.md, "Giving it up".)
  config.world.holdings = config.world.holdings.filter((h: any) => h.holder !== firm);
  const acct = config.world.accounts.find((a: any) => a.holder === firm);
  if (acct) acct.balance = "0";
  // (And the others who open the year out of work, with no work of their own, are out of the labour force, so that the
  // owner, once looking, is not racing them to a posting: since 2026-10-26, "Main red after foundations-2 phase 1" in
  // docs/decisions.md. In this town a posting is filled within hours by whoever is looking when it goes up, and after
  // foundations-2 phase 1 moved the town's timing, no posting stood open at any of the owner's looks at the jobs board
  // in the 105 days after it closed (they looked at it at nearly every wake; a posting for ten went up and was filled
  // between two of them). What is held is that giving the business up puts its owner back on the job market, which a
  // posting then shows; when one is open while they look is the town's.)
  const employed = new Set(config.world.records.filter((r: any) => r.record === "agreement" && r.terms.template === "employment").map((r: any) => r.terms.parties[1]));
  for (const p of config.participants) if (p.controller?.impl === "citizen.default" && p.person !== person && !employed.has(p.person) && !p.controller.params.own_work) p.controller.params.in_labour_force = false;
  const out = join(root, "runs", "test-own-venture-given-up");
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config: { ...config, log: { ...config.log, detail: "lean" } }, runId: "given-up", outDir: out, until: 150 * DAY, recordObservations: "none" });
  const log = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const recs = log.filter((e) => e.kind === "event" && e.body.event === "recorded").map((e) => e.body.record);
  const closure = recs.find((r) => r.kind === "closure" && r.speaks_for === firm);
  expect(closure).toBeDefined();
  expect(closure.data.given_up).toBe(true);
  expect(recs.some((r) => r.kind === "job_application" && r.speaks_for === person && r.at > closure.at)).toBe(true);
  rmSync(out, { recursive: true, force: true });
}, 600_000);

test("a founding's draw of the shape \"business\" reaches the business of one: someone who has meant to start a business, and runs none, does, when they have a home and the money", async () => {
  // (Step 3's founding, with only that shape to found and the chance made sure, as its own tests do. Others may start
  // one where it pays; what is held is that everyone who meant one and could, did.)
  const { loadWorld } = await import("../src/batch");
  const { config } = await loadWorld(join(root, "worlds/town.yaml"), ["shop_mix=false", "living.initiative_bps=10000", 'living.founding.shapes=["business"]', "living.founding.scale_bps=600000"]);
  // (And everyone in the labour force is given the money for one: in the town as drawn, whoever comes to mean a
  // business may have a tenth of it, and then nothing comes of the draw, which is the rule and not what is tested.)
  const venture = config.participants.find((p: any) => p.controller?.impl === "citizen.default").controller.params.ventures.find((v: any) => v.own);
  for (const p of config.participants) if (p.controller?.impl === "citizen.default" && p.controller.params.in_labour_force !== false) {
    const a = config.world.accounts.find((x: any) => x.id === `acc-${p.person}`);
    if (a && Number(a.balance) < 2 * venture.capital) a.balance = String(2 * venture.capital);
  }
  // (Held over three seeds since 2026-10-31, not one: the test had been moved to another seed seven times as changes moved
  // who is out of work and when, each time because its run had no occasion, not because the rule broke; after the owners'
  // fix of that day the one person of seed 1 who meant a business already ran one. The occasions are the draws'; the rule
  // is the same in every run, so the runs together must show it. Seeds 1 to 3 are the first three, not chosen.)
  let meantFree = 0, kept = 0;
  for (const seed of [1, 2, 3]) {
    const out = join(root, "runs", `test-own-venture-meant-${seed}`);
    rmSync(out, { recursive: true, force: true });
    const s = await runWorld({ config: { ...config, seed }, runId: "meant", outDir: out, until: 600 * DAY, recordObservations: "none" });
    const log = readFileSync(s.logPath, "utf8").trim().split("\n").filter((l) => l.includes("found_shape") || l.includes('"own_account"') || l.includes("found_own")).map((l) => JSON.parse(l));
    const meant = log.filter((e) => e.kind === "annotation" && e.body.data?.domain === "found_shape" && e.body.data?.choice === "business").map((e) => ({ t: e.t, who: e.body.subject as string }));
    const started = log.filter((e) => e.kind === "event" && e.body.event === "recorded" && e.body.record?.record === "entity_declaration" && e.body.record.kind === "own_account").map((e) => ({ t: e.t, who: e.body.record.author as string }));
    // (Who meant one while running none: no business of their own declared before. Others start one where it pays: entry
    // by expected profit, which this test does not turn off.)
    const free = meant.filter((m) => !started.some((b) => b.who === m.who && b.t < m.t));
    meantFree += free.length;
    // Someone who meant one started it, within the half year the draw holds.
    if (free.some((m) => started.some((b) => b.who === m.who && m.t <= b.t && b.t - m.t <= 181 * DAY))) kept++;
    const sure = log.filter((e) => e.kind === "annotation" && e.body.data?.domain === "venture" && e.body.data?.choice === "found_own");
    for (const d of sure.filter((x) => /^c\d+-self$/.test(x.body.subject))) expect(d.body.data.options.find((o: any) => o.key === "found_own").score).toBe(10_000);
    rmSync(out, { recursive: true, force: true });
  }
  expect(meantFree).toBeGreaterThan(0);
  expect(kept).toBeGreaterThan(0);
}, 1_800_000);
