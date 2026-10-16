// Firms that fail (phase C, stage C3): a firm that can't pay its debts as they fall due is insolvent; it says so,
// lets everyone go, stops buying and making, sells what it has, then pays what it owes before its shareholders get
// anything, and closes.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { runWorld } from "../src/run";
import { officeAt, officeBy, officesBy } from "./lib/offices";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const base = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

test("a factory with no customers and no credit is wound up: everyone let go, what it owes paid, then it closes", async () => {
  const config = generate(base);
  // Factory 2: little money, and no export customers (the world market buys none of its goods).
  const acc = config.world.accounts.find((a: any) => a.id === "acc-factory-2");
  acc.balance = "200000";
  const trader = officeAt(config, "outside-trade").params;
  trader.buys.goods.from["factory-2"] = 0;
  // ... nor the town's shops (with the energy retailer's ordering loop fixed, 2026-10-02, they bought from it, and it
  // didn't fail).
  for (const p of [...config.participants, ...(config.positions ?? [])]) for (const prm of [p.controller?.params, p.role_module?.params]) if (Array.isArray(prm?.suppliers)) prm.suppliers = prm.suppliers.filter((x: string) => x !== "factory-2");
  // ... who also find wholesalers by their lists, and since 2026-10-08 choose among those at one price each in its own
  // order, not all the first by name: so its list asks more than anyone pays (three times the imports' price).
  const own = [...config.participants, ...(config.positions ?? [])].flatMap((p: any) => [p.controller?.params, p.role_module?.params]).find((prm: any) => prm?.works === "factory-2-works");
  own.price = 3 * own.price;
  // ... and nothing in stock to sell (a firm with goods to sell can still pay).
  config.world.holdings = config.world.holdings.filter((h: any) => h.holder !== "factory-2");
  const out = join(root, "runs", "test-insolvency");
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config, runId: "insolvency", outDir: out, until: 200 * DAY });
  const log = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  expect(log.filter((e) => e.kind === "annotation" && (e.body.data?.call_unresolved || e.body.data?.call_unreadable))).toEqual([]);
  const ev = log.filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
  const recs = ev.filter((e) => e.event === "recorded").map((e) => e.record);
  // Insolvent: said publicly, after trying to borrow.
  const insolvency = recs.find((r) => r.kind === "insolvency" && r.speaks_for === "factory-2");
  expect(insolvency).toBeDefined();
  expect(recs.some((r) => r.kind === "loan_application" && r.speaks_for === "factory-2" && r.at <= insolvency.at)).toBe(true);
  // Everyone let go (each employment ended by notice), and nobody hired after.
  const jobs = [...config.world.records, ...recs].filter((r: any) => r.record === "agreement" && r.terms.template === "employment" && r.terms.parties[0] === "factory-2");
  const noticed = new Set(recs.filter((r) => r.record === "notice").map((r) => r.agreement));
  const signed = (id: string) => [...config.world.records, ...recs].filter((r: any) => r.record === "signature" && r.agreement === id).length === 2;
  for (const j of jobs.filter((j: any) => signed(j.id))) expect(noticed.has(j.id)).toBe(true);
  expect(recs.filter((r) => r.kind === "job_posting" && r.speaks_for === "factory-2" && r.at > insolvency.at)).toEqual([]);
  // No more making or buying once winding up.
  expect(ev.filter((e) => e.event === "worked" && e.task === "make" && e.at === "factory-2-works" && e.t > insolvency.at)).toEqual([]);
  expect(recs.filter((r) => r.kind === "order" && r.speaks_for === "factory-2" && r.at > insolvency.at)).toEqual([]);
  // Closed after the wind-up period; after that, it only sells its premises (docs/behaviour/entry.md).
  const closure = recs.find((r) => r.kind === "closure" && r.speaks_for === "factory-2");
  expect(closure).toBeDefined();
  // (Counted from the day the wind-up was decided; its record lands behind the manager's other acts of that day, each of which takes a person's time, so the
  // record can be a few hours later than the decision the 60 days run from: 2.8 hours here, foundations F6, where the manager's timeline was busier. A day's room.)
  expect(closure.at - insolvency.at).toBeGreaterThanOrEqual(59 * DAY);
  const actsAfter = log.filter((e) => e.kind === "command" && e.body.command === "act" && e.body.as === "factory-2-manager" && e.t > closure.at);
  expect(actsAfter.length).toBeGreaterThan(0);
  expect(actsAfter.every((e) => /premises/.test(e.body.reasoning ?? ""))).toBe(true);
  // Creditors before shareholders: nothing to shareholders unless every debt recorded against it was paid.
  const debts = recs.filter((r) => r.record === "claim" && r.about?.kind === "debt" && r.counterparty === "factory-2");
  if (closure.data.to_shareholders > 0) for (const d of debts) expect(closure.data.debts_paid).toContain(d.id);
}, 600_000);
