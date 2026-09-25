// The town's government on a generated town with the code mayor (the all-code
// control): a budget goes through the council; a park goes through planning,
// the builder, an invoice, the mayor's approval and the finance officer; tax
// is reported, assessed and paid. Every step is people following (or not)
// procedures written as records; none of it is kernel mechanics.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@terrarium/worlds/generator/generate";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

test("budget, park and tax run through the town's own procedures", async () => {
  const config = generate({ ...spec, citizens: 80, mayor: "code" });
  // A payment from the town's account instructed by the mayor's seat, which the
  // town has not named as a signatory: the bank should decline it.
  config.world.records.push({ id: "mayor-direct", record: "statement", author: "mayor", speaks_for: "city", at: 0, visible_to: ["city", "bank"], kind: "instruction", addressed_to: ["bank"],
    text: "Pay the builder $12.34 from the town's account.", data: { pay: 1234, from: "acc-city", to: "acc-builder" } });
  const out = join(root, "runs", "test-government");
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config, runId: "government", outDir: out, until: 75 * DAY });
  const ev = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
  const recs = ev.filter((e) => e.event === "recorded").map((e) => e.record);
  const byId = new Map(recs.map((r) => [r.id, r]));

  // The budget: proposed by the mayor, balloted by the clerk, voted by councillors, adopted with the ballot as basis.
  const budget = recs.find((r) => r.kind === "budget");
  expect(budget?.author).toBe("council-clerk");
  const ballot = byId.get(budget.basis);
  expect(ballot?.kind).toBe("ballot");
  expect(byId.get(ballot.data.proposal)?.author).toBe("mayor");
  const result = recs.find((r) => r.kind === "ballot_result" && r.data.ballot === ballot.id);
  expect(result.data.passed).toBe(true);
  const votes = recs.filter((r) => r.record === "vote" && r.ballot === ballot.id);
  expect(votes.every((v) => v.author.startsWith("councillor-"))).toBe(true);
  expect(result.data.yes).toBe(votes.filter((v) => v.choice === "yes").length);

  // The park: permit, commission, construction, invoice, approval, payment by the finance officer.
  const app = recs.find((r) => r.kind === "permit_application" && r.author === "mayor");
  expect(recs.find((r) => r.kind === "permit_decision" && r.data.application === app.id)?.data.decision).toBe("granted");
  expect(ev.some((e) => e.event === "structure_started" && e.parcel === app.data.parcel)).toBe(true);
  const invoice = recs.find((r) => r.kind === "invoice" && (r.addressed_to ?? []).includes("city"));
  expect(recs.some((r) => r.kind === "approval" && r.author === "mayor" && r.data.invoice === invoice.id)).toBe(true);
  const order = recs.find((r) => r.kind === "instruction" && r.data?.settles === invoice.id);
  expect(order?.author).toBe("finance");
  expect(ev.some((e) => e.event === "transfer" && e.from === "acc-city" && e.to === "acc-builder" && e.amount === invoice.data.amount)).toBe(true);
  // No park was fined: the town followed its own planning law.
  expect(recs.some((r) => r.record === "claim" && r.about?.kind === "fine" && r.counterparty === "city")).toBe(false);

  // The instruction from a seat the town didn't name: declined, with a message back.
  expect(ev.some((e) => e.event === "transfer" && e.from === "acc-city" && e.amount === 1234)).toBe(false);
  expect(ev.some((e) => e.event === "message_delivered" && e.seat === "bank-payments" && e.to.includes("mayor"))).toBe(true);
  expect(readFileSync(s.logPath, "utf8").includes("Instruction mayor-direct not carried out: mayor is not an authorised signatory")).toBe(true);

  // Tax: landlords report, the clerk assesses at the law's rate, and money arrives in the town's account.
  const reports = recs.filter((r) => r.kind === "tax_report");
  expect(reports.length).toBeGreaterThan(0);
  const claims = recs.filter((r) => r.record === "claim" && r.about?.kind === "tax");
  expect(claims.length).toBe(reports.filter((r) => r.data.rent_received >= 10).length);
  for (const c of claims) expect(c.about.amount).toBe(Math.floor((byId.get(c.basis).data.rent_received * 1000) / 10_000));
  expect(ev.some((e) => e.event === "transfer" && e.from.startsWith("acc-landlord") && e.to === "acc-city")).toBe(true);
}, 300_000);
