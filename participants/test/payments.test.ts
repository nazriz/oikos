// Support payments as a published law (docs/behaviour/boundary.md, "world.transfers"): the paying office applying a
// rule's three parts on what a claim states and on its own book, and a person claiming under it; on laws of no place.
import { expect, test } from "bun:test";
import { parseAmount } from "../src/calls";
import { currencyNow, inCurrency } from "../src/money";

import { stopsWorkAt, type PaymentRule } from "../src/shared/payments";
import { context, DAY, MONTH, person, statement, wake } from "./stepping";
import { engine } from "./engine";
const citizen = engine("citizen.default");

inCurrency({ code: "XTS", minor_units: 2 });
const YEAR = 365 * DAY;
const by = { payer: "outside", account: "acc-o" };
const law = (payments: PaymentRule[]) => statement("law-support", 0, "law", { speaks_for: "outside", data: { support: "payments", payments } });
const taxLaw = statement("law-tax", 0, "law", { speaks_for: "outside", data: { tax: "income", charges: [{ id: "tax", schedule: [{ from: 0, rate_bps: 2000 }], collector: "outside", account: "acc-o" }] } });
const claim = (id: string, at: number, who: string, payment: string, age: number, declares?: object) => statement(id, at, "benefit_claim", { speaks_for: who, addressed_to: ["outside"], visible_to: [who, "outside"],
  data: { payment, account: `acc-${who}`, born_at: at - age * YEAR - DAY, ...(declares ? { declares } : {}) } });
const report = (id: string, at: number, staff: { worker: string; gross: number }[]) => statement(id, at, "withholding_report", { speaks_for: "firm", addressed_to: ["outside"], visible_to: ["firm", "outside"], data: { withheld: 1, paid: 1, staff } });
const at = (m: any, t: number, records: object[] = []) => wake(m, t, { book: { kind: "records", records } }, { entity: "outside" });
const decisions = (w: ReturnType<typeof wake>) => w.of("statement", "benefit_decision").map((c) => c.args.data);
const paid = (w: ReturnType<typeof wake>) => w.of("money").map((c) => [c.args.to, Number(parseAmount(c.args.amount, currencyNow())), c.args.from]);

// (The paying office's own cases, 6 of them, went with its TypeScript actor at the cut-over, 2026-10-19: the engine's are kernel/crates/actors/src/boundary/support.rs and support_law.rs, and contracts/test's shared support cases. What is left is the citizen's side and the law's words.)
test("the age at which someone stops work, drawn from the share in the labour force by age, gives those shares back", () => {
  const curve = [{ from: 25, bps: 8000 }, { from: 55, bps: 6000 }, { from: 60, bps: 4000 }, { from: 65, bps: 1000 }];
  const ages = Array.from({ length: 10_000 }, (_, draw) => stopsWorkAt(curve, draw));
  const still = (age: number) => ages.filter((a) => a === undefined || a > age).length / 10_000;
  expect(still(54)).toBe(1);
  expect(still(55)).toBe(0.75); // 6,000 of the 8,000 in it before
  expect(still(60)).toBe(0.5);
  expect(still(65)).toBe(0.125);
  expect(ages.filter((a) => a === undefined).length).toBe(1250); // an eighth never stop, by this curve
  // A share that rises again with age brings nobody back; a curve ending at nought stops everyone.
  expect([4999, 5000].map((draw) => stopsWorkAt([{ from: 25, bps: 8000 }, { from: 55, bps: 9000 }, { from: 60, bps: 4000 }], draw))).toEqual([undefined, 60]);
  expect(stopsWorkAt([{ from: 25, bps: 8000 }, { from: 65, bps: 5000 }, { from: 70, bps: 0 }], 0)).toBe(70);
});

const claims = (said: Awaited<ReturnType<ReturnType<typeof person>["wake"]>>) => said.filter((c) => c.fn === "statement" && c.args.kind === "benefit_claim").map((c) => c.args.data);
const answer = (id: string, t: number, who: string, c: any, granted: boolean, x: object = {}) => statement(id, t, "benefit_decision", { speaks_for: "outside", addressed_to: [who], visible_to: [who, "outside"], basis: c.id, data: { claim: c.id, payment: c.args.data.payment, granted, ...x } });

test("a person out of work claims the first payment for it the law lists, the next when that refuses, and the refused one not again until they are older", async () => {
  const rules: PaymentRule[] = [
    { id: "older", ...by, every_days: 30, who: { out_of_work: true, from_age: 50 }, amount: { flat: 6_000 } },
    { id: "basic", ...by, every_days: 30, who: { out_of_work: true }, amount: { flat: 4_000 } },
    { id: "pension", ...by, every_days: 30, who: { from_age: 67 }, amount: { flat: 9_000 } },
  ];
  const p = person(citizen, { year: YEAR }, { age: 40 });
  const first = await p.wake(DAY, { records: [law(rules)], balance: 500_000 });
  expect(claims(first)).toEqual([{ payment: "older", account: "acc-c1", born_at: -40 * YEAR }]);
  const c1 = first.find((c) => c.args.kind === "benefit_claim")!;
  // Refused (the office applies the age): the next one.
  expect(claims(await p.wake(2 * DAY, { records: [answer("d1", 2 * DAY, "c1", c1, false)] }))).toEqual([]);
  const third = await p.wake(3 * DAY);
  expect(claims(third).map((d) => d.payment)).toEqual(["basic"]);
  const c2 = third.find((c) => c.args.kind === "benefit_claim")!;
  // Granted: nothing more is claimed, and the refused one isn't asked for again at this age.
  expect(claims(await p.wake(4 * DAY, { records: [answer("d2", 4 * DAY, "c1", c2, true, { amount: 4_000, every: 30 * DAY })] }))).toEqual([]);
  expect(claims(await p.wake(40 * DAY))).toEqual([]);
});

test("a payment that turns on a record of contributions isn't claimed by someone who has not worked here", async () => {
  const rules: PaymentRule[] = [
    { id: "insurance", ...by, every_days: 30, who: { out_of_work: true, record: {} }, amount: { share_bps: 6000, of: "gross" }, lasts: { days: 60, then: "basic" } },
    { id: "basic", ...by, every_days: 30, who: { out_of_work: true }, amount: { flat: 4_000 } },
  ];
  const p = person(citizen, { year: YEAR }, { age: 40 });
  expect(claims(await p.wake(DAY, { records: [law(rules)], balance: 500_000 })).map((d) => d.payment)).toEqual(["basic"]);
  // With only the insurance in the law, such a person claims nothing.
  const q = person(citizen, { year: YEAR }, { age: 40 });
  expect(claims(await q.wake(DAY, { records: [law(rules.slice(0, 1))], balance: 500_000 }))).toEqual([]);
});

test("a pension is claimed at its own age by someone who has not stopped work, and a rule's declarations go on the claim", async () => {
  const rules: PaymentRule[] = [{ id: "pension", ...by, every_days: 30, who: { from_age: 67, no_other_pension: true, income_under: { amount: 300_000, per: "household" } }, amount: { flat: 9_000 } }];
  const works = person(citizen, { year: YEAR, stops_work_at: 72, retirement_age: 67 }, { age: 68 });
  const said = await works.wake(DAY, { records: [law(rules)], balance: 500_000 });
  expect(claims(said)).toEqual([{ payment: "pension", account: "acc-c1", born_at: -68 * YEAR, declares: { household_income: 0, household_members: 1, other_pension: false } }]);
  expect(said.find((c) => c.args.kind === "benefit_claim")!.why).toBe("At 68: claiming pension support.");
  // Too young for it: nothing is claimed.
  const young = person(citizen, { year: YEAR, retirement_age: 67 }, { age: 60 });
  expect(claims(await young.wake(DAY, { records: [law(rules)], balance: 500_000 }))).toEqual([]);
});
