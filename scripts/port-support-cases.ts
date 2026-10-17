// Writes contracts/test/support.json: claims decided by the TS support office (`world.transfers`) on a rule, what the
// claimant stated and the pay reported for them, with the TS's decision; the declarations a rule asks, a law's payments
// in words, and the age people stop work at, from the TS functions. The Rust `oikos_rules::support` is held to the same
// answers (kernel/crates/rules/src/support.rs tests). Run once; participants/test/port-rules.test.ts holds the TS to the file.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { inCurrency } from "../participants/src/money";
import { transfers } from "../participants/src/behaviour/world";
import { declarationFor, paymentsInWords, stopsWorkAt, type PaymentRule } from "../participants/src/behaviour/payments";
import { context, DAY, MONTH, statement, wake } from "../participants/test/stepping";

inCurrency({ code: "XTS", minor_units: 2 });
const YEAR = 365 * DAY;
const by = { payer: "outside", account: "acc-o" };
const taxData = { tax: "income", charges: [{ id: "tax", schedule: [{ from: 0, rate_bps: 2000 }], collector: "outside", account: "acc-o" }] };
const law = (payments: PaymentRule[]) => statement("law-support", 0, "law", { speaks_for: "outside", data: { support: "payments", payments } });
const taxLaw = statement("law-tax", 0, "law", { speaks_for: "outside", data: taxData });
const report = (id: string, at: number, gross: number) => statement(id, at, "withholding_report", { speaks_for: "firm", addressed_to: ["outside"], visible_to: ["firm", "outside"], data: { withheld: 1, paid: 1, staff: [{ worker: "w", gross }] } });

type Scenario = { name: string; rule: PaymentRule; t: number; age: number; declares?: object; months?: { at: number; gross: number }[] };
const share = (x: object, every = 30): PaymentRule => ({ id: "insurance", ...by, every_days: every, who: { out_of_work: true, record: {} }, amount: { share_bps: 6000, of: "gross", ...x } as any });
const pay2 = [{ at: MONTH, gross: 280_000 }, { at: 2 * MONTH, gross: 320_000 }];
const family: PaymentRule = { id: "family", ...by, every_days: 30, who: { income_under: { amount: 20_000, per: "head" }, children: { least: 1, under_age: 18 } }, amount: { household: 60_000, per_member: 1_000, per_child: { under_age: 6, amount: 15_000 } } };
const kids = [-3 * YEAR, -10 * YEAR];
const rec12: PaymentRule = { id: "insurance", ...by, every_days: 30, who: { out_of_work: true, record: { months: 12, within_months: 30 } }, amount: { flat: 10_000 } };
const months = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ at: (from + i) * MONTH, gross: 300_000 }));
const scenarios: Scenario[] = [
  { name: "flat pension in its ages", rule: { id: "pension", ...by, every_days: 14, who: { from_age: 67 }, amount: { flat: 50_000 } }, t: 0, age: 70 },
  { name: "flat pension too young", rule: { id: "pension", ...by, every_days: 14, who: { from_age: 67 }, amount: { flat: 50_000 } }, t: 0, age: 30 },
  { name: "ten months where twelve asked", rule: rec12, t: 10 * MONTH, age: 40, months: months(10) },
  { name: "twelve months asked and had", rule: rec12, t: 12 * MONTH, age: 40, months: months(12) },
  { name: "twelve months too long ago", rule: rec12, t: 45 * MONTH, age: 43, months: months(12) },
  { name: "share of gross pay", rule: share({}), t: 2 * MONTH, age: 40, months: pay2 },
  { name: "share of net pay", rule: share({ of: "net" }), t: 2 * MONTH, age: 40, months: pay2 },
  { name: "share of net pay with a child", rule: share({ of: "net", with_child_bps: 6700 }), t: 2 * MONTH, age: 40, months: pay2, declares: { children_born_at: [2 * MONTH - 5 * YEAR] } },
  { name: "share of net pay with no child", rule: share({ of: "net", with_child_bps: 6700 }), t: 2 * MONTH, age: 40, months: pay2, declares: { children_born_at: [] } },
  { name: "share with a least", rule: share({ least: 200_000 }), t: 2 * MONTH, age: 40, months: pay2 },
  ...[25, 40, 62].map((age) => ({ name: `share capped by age ${age}`, rule: share({ most: [{ from_age: 0, amount: 100_000 }, { from_age: 30, amount: 150_000 }, { from_age: 60, amount: 120_000 }] }), t: 2 * MONTH, age, months: pay2 })),
  { name: "a share with a most of one sum", rule: share({ most: 90_000 }), t: 2 * MONTH, age: 40, months: pay2 },
  { name: "share every 14 days", rule: share({}, 14), t: 2 * MONTH, age: 40, months: pay2 },
  { name: "share with no pay on file", rule: share({}), t: 2 * MONTH, age: 40, months: [] },
  { name: "a share over seven months of uneven pay", rule: share({}, 7), t: 8 * MONTH, age: 40, months: [100_001, 99_999, 300_001, 7, 123_457, 250_003, 80_009].map((gross, i) => ({ at: (i + 1) * MONTH, gross })) },
  { name: "lasts sixty days", rule: { id: "insurance", ...by, every_days: 30, who: { out_of_work: true }, amount: { flat: 10_000 }, lasts: { days: 60, then: "basic" } }, t: 0, age: 40 },
  { name: "lasts until sixty", rule: { id: "bridge", ...by, every_days: 30, amount: { flat: 1_000 }, lasts: { until_age: 60 } }, t: 0, age: 59 },
  ...[{ income: 70_000, members: 4, kids, n: "within the line" }, { income: 80_000, members: 4, kids, n: "over the line" }, { income: 10_000, members: 2, kids: [] as number[], n: "no child" }].map((c) => ({ name: `family payment ${c.n}`, rule: family, t: 0, age: 35, declares: { household_income: c.income, household_members: c.members, children_born_at: c.kids } })),
  { name: "family payment nothing declared", rule: family, t: 0, age: 35 },
  { name: "pension for those with no other, declared", rule: { id: "social", ...by, every_days: 30, who: { from_age: 70, no_other_pension: true }, amount: { flat: 2_000 } }, t: 0, age: 72, declares: { other_pension: false } },
  { name: "pension for those with no other, declared otherwise", rule: { id: "social", ...by, every_days: 30, who: { from_age: 70, no_other_pension: true }, amount: { flat: 2_000 } }, t: 0, age: 72, declares: { other_pension: true } },
  { name: "pension for those with no other, not stated", rule: { id: "social", ...by, every_days: 30, who: { from_age: 70, no_other_pension: true }, amount: { flat: 2_000 } }, t: 0, age: 72 },
];

const decisions = scenarios.map((s) => {
  const m = transfers.create(context("outside-support-system", "outside", { account: "acc-o" }));
  const claim = statement("c", s.t, "benefit_claim", { speaks_for: "w", addressed_to: ["outside"], visible_to: ["w", "outside"], data: { payment: s.rule.id, account: "acc-w", born_at: s.t - s.age * YEAR - DAY, ...(s.declares ? { declares: s.declares } : {}) } });
  const records = [law([s.rule]), taxLaw, ...(s.months ?? []).map((x, i) => report(`r${i}`, x.at, x.gross)), claim];
  const w = wake(m, s.t, { book: { kind: "records", records } }, { entity: "outside" });
  const d = w.of("statement", "benefit_decision").map((c) => c.args.data)[0]!;
  const within = s.rule.who?.record?.within_months;
  const since = within ? s.t - within * MONTH : -Infinity;
  const reports = (s.months ?? []).filter((x) => x.at >= since).sort((a, b) => b.at - a.at).map((x) => x.gross);
  const { claim: _c, payment: _p, every: _e, ...expect } = d;
  return { name: s.name, rule: s.rule, t: s.t, born_at: s.t - s.age * YEAR - DAY, ...(s.declares ? { declares: s.declares } : {}), reports, expect };
});

const facts = { household_income: 70_000, household_members: 3, children_born_at: [-3 * YEAR], other_pension: false };
const rules: PaymentRule[] = [family, rec12, share({ of: "net", with_child_bps: 6700, least: 5, most: [{ from_age: 0, amount: 100 }, { from_age: 30, amount: 150 }] }), { id: "social", ...by, every_days: 30, who: { from_age: 70, no_other_pension: true }, amount: { flat: 2_000 } },
  { id: "insurance", name: "Insurance", ...by, every_days: 30, who: { out_of_work: true, to_age: 66 }, amount: { flat: 10_000 }, lasts: { days: 60, until_age: 67, then: "basic" } }, { id: "basic", name: "Basic support", ...by, every_days: 30, who: { out_of_work: true }, amount: { flat: 4_000 } }];
const declarations = rules.map((r) => ({ name: r.id, rule: r, facts, declares: declarationFor(r, facts) ?? null }));
const words = [{ rules: [family] }, { rules }].map((c) => ({ ...c, words: paymentsInWords(c.rules, (n) => String(n)) }));
const curves = [[{ from: 25, bps: 8000 }, { from: 55, bps: 6000 }, { from: 60, bps: 4000 }, { from: 65, bps: 1000 }], [{ from: 25, bps: 8000 }, { from: 55, bps: 9000 }, { from: 60, bps: 4000 }], [{ from: 25, bps: 8000 }, { from: 65, bps: 5000 }, { from: 70, bps: 0 }], [{ from: 25, bps: 0 }], []];
const stops_work = curves.map((curve) => ({ curve, draws: [0, 1, 1249, 1250, 2499, 2500, 4999, 5000, 7499, 7500, 8749, 8750, 9999].map((d) => [d, stopsWorkAt(curve, d) ?? null]) }));
writeFileSync(join(import.meta.dir, "../contracts/test/support.json"), JSON.stringify({ description: "Claims decided by the TS support office (world.transfers) on a rule, with what the claimant stated and the pay reported for them (newest first, within the rule's window), plus the TS declarations, words and stopping ages: the answers the Rust oikos_rules::support gives too (scripts/port-support-cases.ts).", tax: taxData, decisions, declarations, words, stops_work }, null, 1) + "\n");
console.log(decisions.map((d) => `${d.name}: ${JSON.stringify(d.expect)}`).join("\n"));
