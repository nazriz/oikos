// Writes contracts/test/withholding.json: tax laws (the unit tests' and every profile's) with what the TS `withheld`
// and `chargesOn` give on a spread of pays, so that the Rust `oikos_rules::withholding` is held to the same sums
// (kernel/crates/rules/src/withholding.rs tests; docs/port-guide.md, lane C1). Run once; the file is the shared cases after,
// and participants/test/port-rules.test.ts holds the TS to it.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chargesOn, dayPayPeriod, taxLawOf, withheld } from "../participants/src/behaviour/tax";

const DAY = 86_400;
const to = { collector: "outside", account: "a" };
const laws: { name: string; law: unknown }[] = [
  { name: "short form", law: { brackets: [{ from: 0, rate_bps: 0 }, { from: 1_000_000, rate_bps: 2000 }, { from: 5_000_000, rate_bps: 4000 }], levy_bps: 100, levy_from: 2_000_000, ...to } },
  { name: "short form, odd figures", law: { brackets: [{ from: 0, rate_bps: 192 }, { from: 1_013_512, rate_bps: 640 }, { from: 8_602_213, rate_bps: 1088 }], levy_bps: 0, ...to } },
  { name: "base, ceiling, threshold, tapering allowance", law: { charges: [
    { id: "tax", base: { less: [{ amount: 1_000_000, tapers: { above: 8_000_000, bps: 5000 } }] }, schedule: [{ from: 0, rate_bps: 2000 }, { from: 3_000_000, rate_bps: 4000 }], ...to },
    { id: "fund", base: { up_to: 5_000_000 }, schedule: [{ from: 0, rate_bps: 600 }], ...to },
    { id: "levy", base: { from: 2_000_000 }, schedule: [{ from: 0, rate_bps: 100 }], ...to }] } },
  { name: "deductions", law: { charges: [
    { id: "fund", schedule: [{ from: 0, rate_bps: 1000 }], ...to },
    { id: "tax", base: { less: [{ share_bps: 3000, least: 500_000, most: 1_500_000 }, { charges: ["fund"] }] }, schedule: [{ from: 0, rate_bps: 1000 }], ...to }] } },
  { name: "reliefs and a surcharge", law: { charges: [
    { id: "tax", name: "Income tax", schedule: [{ from: 0, rate_bps: 1000 }, { from: 2_000_000, rate_bps: 2500 }], reliefs: [{ amount: 200_000 }], ...to },
    { id: "cess", base: { on: "tax" }, schedule: [{ from: 0, rate_bps: 400 }], ...to },
    { id: "other", schedule: [{ from: 0, rate_bps: 500 }, { from: 1_000_000, rate_bps: 1000 }], reliefs: [{ none_due_up_to: 3_000_000 }], ...to }] } },
  { name: "rising bands", law: { charges: [{ id: "tax", schedule: [{ from: 0, rate_bps: 0 }, { from: 1_000_000, rate_bps: 1400, rising_to_bps: 2400 }, { from: 2_000_000, rate_bps: 2400, rising_to_bps: 4200 }, { from: 6_000_000, rate_bps: 4200 }], ...to }] } },
  { name: "two charges", law: { charges: [{ id: "tax", schedule: [{ from: 0, rate_bps: 0 }, { from: 1_000_000, rate_bps: 1000 }, { from: 3_000_000, rate_bps: 2000 }], ...to }, { id: "levy", schedule: [{ from: 0, rate_bps: 500 }], ...to }] } },
];
const dir = join(import.meta.dir, "../worlds/profiles");
for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
  const p = JSON.parse(readFileSync(join(dir, f), "utf8"));
  const pf = p.values?.public_finance;
  if (pf?.income_tax?.charges) laws.push({ name: `profile ${f}`, law: { charges: pf.income_tax.charges.map(({ paid_to, ...c }: any) => ({ ...c, ...to })), ...(pf.returns ? { returns: pf.returns } : {}) } });
}
const grosses = [0, 1, 77_777, 211_356, 300_000, 999_999, 5_000_000];
const periods = [7 * DAY, 14 * DAY, 30 * DAY, dayPayPeriod(5)];
const annual = [0, 500_000, 1_500_000, 3_000_000, 6_000_000, 12_000_000, 40_000_000, 150_000_000];
const cases = laws.map(({ name, law }) => {
  const l = taxLawOf("l", law, "outside")!;
  return {
    name, law,
    pays: grosses.flatMap((gross) => periods.map((period) => { const w = withheld(l, gross, period); return { gross, period, total: w.total, parts: w.parts.map((c) => [c.charge.id, c.amount]) }; })),
    annual: annual.map((pay) => ({ pay, charges: chargesOn(l, pay).map((c) => [c.charge.id, c.amount]) })),
  };
});
writeFileSync(join(import.meta.dir, "../contracts/test/withholding.json"), JSON.stringify({ description: "Tax laws and what the TS withheld/chargesOn give on a spread of pays: the answers the Rust oikos_rules::withholding gives too (scripts/port-withholding-cases.ts).", cases }) + "\n");
