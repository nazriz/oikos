// Adoption by the numbers (docs/behaviour/automation.md): the real kernel, a generated town, code participants, no model. Systems are
// offered by the outside world's vendor at the profile's prices; a business takes one, or does not, by comparing what a task costs it
// with what it would cost with the system. Nothing sets who adopts or when: the same town, with the offers cheaper or dearer, or a
// law against a use, takes more, none, or none.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generateFrom } from "@oikos/worlds/generator/generate";
import { loadProfile } from "@oikos/worlds/generator/profile";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const base = { ...({ ...(Bun.YAML.parse(readFileSync(join(root, "worlds/town-300.yaml"), "utf8")) as any), shop_mix: false /* the single-goods town: this test holds a mechanism of it (docs/risks.md ME-19) */ }) };

/** The town with its profile\'s offers priced as `times` of today\'s (and optionally a law against serving by systems), run `days`. */
async function run(name: string, days: number, o: { times?: number; fall?: number; law?: boolean; tweak?: (P: any) => void } = {}) {
  const P = structuredClone(loadProfile(base.profile ?? "au-vic-2026")) as any;
  for (const x of P.values.automation.offers) for (const k of ["setup", "fee_per_year", "exit"]) x[k] = Math.round(x[k] * (o.times ?? 1));
  if (o.fall !== undefined) P.values.automation.price_fall_bps_per_year = o.fall;
  o.tweak?.(P);
  const config = generateFrom({ ...base, living: { initiative_bps: 10_000 } }, P) as any;
  if (o.law) config.world.records.push({ id: "law-no-serving-by-systems", record: "statement", author: "genesis", at: 0, visible_to: "public", speaks_for: "outside", kind: "law",
    text: "A shop must not take a system to serve its customers.", adico: { attribute: "shops", deontic: "must_not", aim: "take a system to serve", condition: "when it is offered one" },
    formal: { language: "cel", condition: "block.block == 'deploy' && block.task == 'serve'" } });
  const out = join(root, "runs", `test-${name}`);
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config: { ...config, log: { ...config.log, detail: "full" } }, runId: name, outDir: out, until: days * DAY, recordObservations: "none" });
  const log = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  rmSync(out, { recursive: true, force: true });
  const ev = log.filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
  const cmds = log.filter((e) => e.kind === "command").map((e) => ({ t: e.t, ...e.body }));
  return { config, ev, cmds, recs: ev.filter((e) => e.event === "recorded").map((e) => e.record) };
}
const delivered = (r: Awaited<ReturnType<typeof run>>) => r.ev.filter((e) => e.event === "participant_created" && e.kind === "system" && e.supplier === "vendors");

test("the town has a vendor that sells what its profile lists, at the profile\'s prices, and says so in public", async () => {
  const r = await run("auto-offers", 3, {});
  const offers = r.recs.filter((x) => x.kind === "system_offer");
  expect(offers.map((x) => x.data.id).sort()).toEqual(["case-handling-system", "production-cell", "self-service-point"]);
  const P = loadProfile(base.profile ?? "au-vic-2026").values.automation!;
  for (const o of offers) {
    const given = P.offers.find((x) => x.id === o.data.id)!;
    expect(o.data.setup).toBe(given.setup); // (today\'s prices, held)
    expect(o.speaks_for).toBe("vendors");
    expect(o.visible_to).toBe("public");
  }
  // Delivered from a template that says what it does, supplied by the vendor.
  const t = r.config.templates.find((x: any) => x.id === "self-service-point");
  expect(t).toMatchObject({ kind: "system", supplier: "vendors" });
  expect(t.does).toEqual([{ block: "work", task: "serve", seconds: expect.any(Number) }]);
}, 240_000);

test("a shop takes a system when the comparison favours it: it orders and pays, the vendor delivers, the licence is signed, the system serves, and a mistake is refunded", async () => {
  const r = await run("auto-adopt", 200, { times: 0.15 });
  const made = delivered(r).filter((e) => e.template === "self-service-point");
  expect(made.length).toBeGreaterThan(0);
  const one = made[0]!;
  expect(String(one.owner)).toMatch(/^shop-/);
  // Its reasons are in the log: the comparison with its figures.
  const reason = r.cmds.flatMap((c) => (c.reasoning ? [String(c.reasoning)] : [])).find((x) => x.startsWith("Taking") && x.includes("Self-service"));
  expect(reason).toMatch(/would do \d+ of the \d+ serve units a month/);
  // The order was paid with the order, to the vendor\'s account, at the price on offer.
  const order = r.recs.find((x) => x.kind === "order" && x.speaks_for === one.owner && x.data.kind === "system:self-service-point");
  expect(order).toBeDefined();
  expect(r.ev.some((e) => e.event === "transfer" && e.to === "acc-vendors" && String(e.memo ?? "").startsWith("Order: ") )).toBe(true);
  // The licence: offered by the vendor as an agreement, signed by the shop, with the fee set up each month.
  const licence = r.ev.find((e) => e.event === "recorded" && e.record.record === "agreement" && e.record.terms?.template === "licence" && e.record.terms.parties.includes(one.owner))?.record;
  expect(licence).toBeDefined();
  expect(r.ev.some((e) => e.event === "recorded" && e.record.record === "signature" && e.record.agreement === licence.id && e.record.speaks_for === one.owner)).toBe(true);
  expect(r.recs.some((x) => x.kind === "request" && x.speaks_for === one.owner && x.data?.every && x.basis === licence.id)).toBe(true);
  // The system does the work: a `work` of the task `serve` with the system as performer, applied by the kernel.
  const worked = r.cmds.filter((c) => (c.blocks ?? []).some((b: any) => b.block === "work" && b.task === "serve" && (b.performers ?? []).includes(one.participant)));
  expect(worked.length).toBeGreaterThan(0);
}, 480_000);

test("with the same town\'s offers dearer, nobody takes one: adoption stalls", async () => {
  const r = await run("auto-dear", 200, { times: 40 });
  expect(delivered(r)).toEqual([]);
  expect(r.recs.filter((x) => x.kind === "order" && String(x.data?.kind).startsWith("system:"))).toEqual([]);
}, 480_000);

test("with a law against the use in force, a shop that follows the law takes none; one that does not follow it takes one all the same", async () => {
  // (The law is against taking a system to serve: a system for another task, a factory's production cell, is no breach
  // of it. Until 2026-10-26 the test held that no system at all was delivered, which was true of the towns it ran; since
  // "Main red after foundations-2 phase 1" in docs/decisions.md factory-3 of this town takes a production cell on day 151.)
  const serving = (r: Awaited<ReturnType<typeof run>>) => delivered(r).filter((e) => r.config.templates.find((t: any) => t.id === e.template)?.does?.some((d: any) => d.task === "serve"));
  const kept = await run("auto-law", 200, { times: 0.15, law: true });
  expect(serving(kept)).toEqual([]);
  const broken = await run("auto-law-broken", 200, { times: 0.15, law: true, tweak: (P) => { P.values.automation.firms.compliance_bps = 0; } });
  expect(serving(broken).length).toBeGreaterThan(0);
}, 960_000);
