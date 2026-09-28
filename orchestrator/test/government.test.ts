// The town's government on a generated town with the code mayor (the all-code
// control): a budget goes through the council; a park goes through planning,
// the builder, an invoice, the mayor's approval and the finance officer; rates
// are levied and paid. Every step is people following (or not)
// procedures written as records; none of it is kernel mechanics.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@terrarium/worlds/generator/generate";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

test("budget, park and rates run through the town's own procedures", async () => {
  const config = generate({ ...spec, citizens: 80, mayor: "code" });
  // A payment from the town's account instructed by the mayor, a post the town
  // has not named as a signatory: the bank should decline it.
  config.world.records.push({ id: "mayor-direct", record: "statement", author: "mayor-system", in_position: "mayor", speaks_for: "city", at: 0, visible_to: ["city", "bank"], kind: "request", addressed_to: ["bank"],
    text: "Please pay the builder $12.34 from the town's account.", data: { outcome: { money: { from: "acc-city", to: "acc-builder", amount: 1234 } } } });
  const out = join(root, "runs", "test-government");
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config, runId: "government", outDir: out, until: 75 * DAY });
  const ev = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
  const recs = ev.filter((e) => e.event === "recorded").map((e) => e.record);
  const byId = new Map(recs.map((r) => [r.id, r]));
  const lotCells = (lot: string): string[] => config.world.records.find((r: any) => r.id === lot)?.data?.cells ?? [];

  // The budget: proposed by the mayor, balloted by the clerk, voted by councillors, adopted with the ballot as basis.
  const budget = recs.find((r) => r.kind === "budget");
  expect(budget?.author).toBe("council-clerk-system");
  const ballot = byId.get(budget.basis);
  expect(ballot?.kind).toBe("ballot");
  expect(byId.get(ballot.data.proposal)?.in_position).toBe("mayor");
  const result = recs.find((r) => r.kind === "ballot_result" && r.data.ballot === ballot.id);
  expect(result.data.passed).toBe(true);
  const votes = recs.filter((r) => r.record === "vote" && r.ballot === ballot.id);
  expect(votes.every((v) => v.author.startsWith("councillor-"))).toBe(true);
  expect(result.data.yes).toBe(votes.filter((v) => v.choice === "yes").length);

  // The park: permit, commission, construction, invoice, approval, payment by the finance officer.
  const app = recs.find((r) => r.kind === "permit_application" && r.in_position === "mayor");
  expect(recs.find((r) => r.kind === "permit_decision" && r.data.application === app.id)?.data.decision).toBe("granted");
  expect(ev.some((e) => e.event === "structure_started" && lotCells(app.data.lot).includes(e.on))).toBe(true);
  const invoice = recs.find((r) => r.kind === "invoice" && r.speaks_for === "builder" && (r.addressed_to ?? []).includes("city"));
  expect(recs.some((r) => r.kind === "approval" && r.in_position === "mayor" && r.data.invoice === invoice.id)).toBe(true);
  const order = recs.find((r) => r.kind === "request" && r.data?.outcome?.money?.settles === invoice.id);
  expect(order?.in_position).toBe("finance");
  expect(ev.some((e) => e.event === "transfer" && e.from === "acc-city" && e.to === "acc-builder" && e.amount === invoice.data.outcome.money.amount)).toBe(true);
  // No park was fined: the town followed its own planning law.
  expect(recs.some((r) => r.record === "claim" && r.about?.kind === "fine" && r.counterparty === "city")).toBe(false);

  // The instruction from a post the town didn't name: declined, with a message back.
  expect(ev.some((e) => e.event === "transfer" && e.from === "acc-city" && e.amount === 1234)).toBe(false);
  expect(ev.some((e) => e.event === "message_delivered" && e.participant === "bank-payments-system" && e.to.includes("mayor-system"))).toBe(true);
  expect(readFileSync(s.logPath, "utf8").includes("Request mayor-direct not carried out: mayor is not an authorised signatory")).toBe(true);

  // Rates (the town's tax): landlords are sent notices on the valuer's valuations, and pay them into the town's account.
  const notices = recs.filter((r) => r.kind === "rates_notice" && r.addressed_to[0].startsWith("landlord"));
  expect(notices.length).toBeGreaterThan(0);
  const claims = recs.filter((r) => r.record === "claim" && r.about?.kind === "rates" && r.counterparty.startsWith("landlord"));
  expect(claims.length).toBe(notices.length);
  expect(ev.some((e) => e.event === "transfer" && e.from.startsWith("acc-landlord") && e.to === "acc-city" && claims.some((c) => c.id === e.settles))).toBe(true);
}, 300_000);
