// The taxpayer's account (docs/behaviour/public-finance.md, "The taxpayer's account"; risk PB-23). In lv-12 a clinic's manager
// paid a month's withheld tax by hand and the clinic's payroll officer paid it again with the return: nobody kept the clinic's
// account, so it could not be claimed back. Here, in a short run of a Mexican town, the clinic's manager pays the collector by hand
// (a scripted act, in the words a seat used); the collector states the credit to the clinic, and nobody else; the clinic's payroll
// officer claims it back (Mexico's law gives no set-off of withheld tax); the collector decides it in its time and repays it into the
// clinic's account. And the same town where nobody pays twice has no paper of the account at all.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const base = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
const KINDS = ["tax_statement", "tax_credit_claim", "tax_credit_decision", "tax_account_request"];

async function run(name: string, hand?: { day: number; amount: string }) {
  const config = generate({ ...base, profile: "mx-jal-2026", citizens: 80 });
  if (hand) {
    // (The clinic manager's post, for this test, does one thing: pays the collector by hand, in the words the lv-12 seat used.)
    const post = config.positions.find((p: any) => p.id === "clinic-manager");
    post.role_module = { code: "stub.script", params: { script: [{ at: hand.day * DAY, call: `money(amount="${hand.amount}", for="income tax withheld from wages", from=acc-clinic, to=acc-outside)` }] } };
  }
  const out = join(root, "runs", `test-taxpayer-account-${name}`);
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config, runId: name, outDir: out, until: 80 * DAY });
  const log = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  rmSync(out, { recursive: true, force: true });
  const recs = log.filter((e) => e.kind === "event" && e.body.event === "recorded").map((e) => ({ ...e.body.record, t: e.t }));
  const moved = log.filter((e) => e.kind === "event" && e.body.event === "transfer").map((e) => e.body);
  return { config, recs, moved, log };
}

test("a payment made twice is stated, claimed back by the payroll officer and repaid; where nobody pays twice nothing is written", async () => {
  const quiet = await run("quiet");
  expect(quiet.config.positions.some((p: any) => p.id === "outside-tax" && p.role_module.code === "world.tax_collector")).toBe(true);
  expect(quiet.recs.filter((r: any) => r.kind === "withholding_report").length).toBeGreaterThan(3);
  expect(quiet.recs.filter((r: any) => KINDS.includes(r.kind))).toEqual([]);

  const twice = await run("twice", { day: 50, amount: "$1000.00" });
  const st = twice.recs.filter((r: any) => r.kind === "tax_statement");
  expect(st.length).toBeGreaterThan(0);
  expect(st.every((r: any) => JSON.stringify(r.addressed_to) === JSON.stringify(["clinic"]))).toBe(true);
  expect(st[0].data.credit).toBe(100_000);
  const claims = twice.recs.filter((r: any) => r.kind === "tax_credit_claim");
  expect(claims.length).toBeGreaterThan(0);
  expect(claims[0].data.use).toBe("refund");
  expect(claims[0].speaks_for).toBe("clinic");
  expect(claims[0].data.amount).toBe(100_000);
  const granted = twice.recs.filter((r: any) => r.kind === "tax_credit_decision" && r.data.granted === true);
  expect(granted.map((r: any) => r.data.amount).reduce((a: number, b: number) => a + b, 0)).toBe(100_000);
  // The refund reached the clinic's account from the collector's, after the claim (the collector's time is on its timeline).
  // (The clinic is also paid its grant from the same account: the refund is the one the bank made on the collector's instruction.)
  const back = twice.moved.filter((m: any) => m.from === "acc-outside" && m.to === "acc-clinic" && String(m.memo ?? m.for ?? "").startsWith("Refund of tax"));
  expect(back.map((m: any) => String(m.amount))).toEqual(["100000"]);
  // Nobody else's account was written about.
  expect(twice.recs.filter((r: any) => KINDS.includes(r.kind)).every((r: any) => [r.speaks_for, ...(r.addressed_to ?? [])].every((x: string) => x === "clinic" || x === "outside"))).toBe(true);
}, 900_000);
