// Credit (phase C, stage C2): the bank lends on its rules, from what it can see of the applicant's account; loans are
// agreements, paid out once signed and repaid by standing order; arrears and default follow missed repayments; the bank
// draws funding from outside when short. Households borrow when they'd miss their rent, firms before letting staff go.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { repayment } from "@oikos/participants";
import { generate } from "@oikos/worlds/generator/generate";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const MONTH = 30 * DAY;
const base = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

test("repayments are the credit-foncier formula's, in cents, rounded up", () => {
  expect(repayment(100_000, 1200, 12)).toBe(8885); // $1,000 at 12% over a year: $88.85 a month
  expect(repayment(1_000_000, 0, 10)).toBe(100_000); // no interest: the principal in equal parts
  expect(repayment(50_000_000, 739, 60)).toBe(999_286); // $500,000 at 7.39% over five years: $9,992.86 a month
});

test("loans follow applications on the bank's rules, are paid out once signed and repaid by standing order; arrears come before default", async () => {
  // Shops start with little money, so some borrow.
  const config = generate({ ...base, citizens: 160 });
  for (const a of config.world.accounts) if (/^acc-shop-/.test(a.id)) a.balance = "300000";
  const out = join(root, "runs", "test-credit");
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config, runId: "credit", outDir: out, until: 18 * MONTH });
  const log = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  expect(log.filter((e) => e.kind === "annotation" && (e.body.data?.call_unresolved || e.body.data?.call_unreadable))).toEqual([]);
  const ev = log.filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
  const recs = ev.filter((e) => e.event === "recorded").map((e) => e.record);
  const apps = new Map(recs.filter((r) => r.kind === "loan_application").map((r) => [r.id, r]));
  const loans = recs.filter((r) => r.record === "agreement" && r.terms.template === "loan");
  expect(apps.size).toBeGreaterThan(3);
  expect(loans.length).toBeGreaterThan(0);
  expect(recs.filter((r) => r.kind === "loan_decision" && !r.data.approved).length).toBeGreaterThan(0);
  const signed = new Set(recs.filter((r) => r.record === "signature").map((r) => `${r.agreement}|${r.as}`));
  for (const l of loans) {
    // An application first, by the borrower, for the amount lent.
    const app = apps.get(l.basis);
    const borrower = l.terms.parties[1];
    expect(app?.speaks_for).toBe(borrower);
    const principal = l.terms.commitments.find((c: any) => c.who === "bank").does.outcome.money;
    expect(principal.amount).toBe(String(app.data.amount));
    // Paid out only once signed, and then repaid by standing order.
    const payout = ev.find((e) => e.event === "transfer" && e.settles === l.id);
    if (payout) {
      expect(signed.has(`${l.id}|${borrower}`)).toBe(true);
      expect(recs.some((r) => r.kind === "request" && r.speaks_for === borrower && r.basis === l.id && r.data?.every === MONTH)).toBe(true);
    }
  }
  // One loan at a time: a borrower's loans don't overlap.
  const byBorrower = new Map<string, any[]>();
  for (const l of loans) byBorrower.set(l.terms.parties[1], [...(byBorrower.get(l.terms.parties[1]) ?? []), l]);
  for (const [, ls] of byBorrower) for (let i = 1; i < ls.length; i++) expect(ls[i].at - ls[i - 1].at).toBeGreaterThanOrEqual(ls[i - 1].terms.term);
  // Default only after arrears, and a debt recorded; a borrower in default is refused afterwards.
  for (const d of recs.filter((r) => r.kind === "loan_default")) {
    expect(recs.some((r) => r.kind === "loan_arrears" && r.data.loan === d.data.loan && r.at < d.at)).toBe(true);
    expect(recs.some((r) => r.record === "claim" && r.about?.kind === "debt" && r.basis === d.data.loan)).toBe(true);
    for (const later of recs.filter((r) => r.kind === "loan_decision" && r.addressed_to[0] === d.addressed_to[0] && r.at > d.at)) expect(later.data.approved).toBe(false);
  }
  // Funding: every draw is paid by the outside, settling it.
  for (const draw of recs.filter((r) => r.kind === "funding_draw")) expect(ev.some((e) => e.event === "transfer" && e.settles === draw.id && e.from === "acc-outside")).toBe(true);
}, 600_000);
