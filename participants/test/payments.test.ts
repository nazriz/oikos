// Support payments as a published law (docs/behaviour/boundary.md, "world.transfers"): the paying office applying a
// rule's three parts on what a claim states and on its own book, and a person claiming under it; on laws of no place.
import { expect, test } from "bun:test";
import { parseAmount } from "../src/calls";
import { currencyNow, inCurrency } from "../src/money";
import { transfers } from "../src/behaviour/world";
import { citizen } from "../src/behaviour/citizen";
import { paymentsInWords, stopsWorkAt, type PaymentRule } from "../src/behaviour/payments";
import { context, DAY, MONTH, person, statement, wake } from "./stepping";

inCurrency({ code: "XTS", minor_units: 2 });
const YEAR = 365 * DAY;
const by = { payer: "outside", account: "acc-o" };
const law = (payments: PaymentRule[]) => statement("law-support", 0, "law", { speaks_for: "outside", data: { support: "payments", payments } });
const taxLaw = statement("law-tax", 0, "law", { speaks_for: "outside", data: { tax: "income", charges: [{ id: "tax", schedule: [{ from: 0, rate_bps: 2000 }], collector: "outside", account: "acc-o" }] } });
const claim = (id: string, at: number, who: string, payment: string, age: number, declares?: object) => statement(id, at, "benefit_claim", { speaks_for: who, addressed_to: ["outside"], visible_to: [who, "outside"],
  data: { payment, account: `acc-${who}`, born_at: at - age * YEAR - DAY, ...(declares ? { declares } : {}) } });
const report = (id: string, at: number, staff: { worker: string; gross: number }[]) => statement(id, at, "withholding_report", { speaks_for: "firm", addressed_to: ["outside"], visible_to: ["firm", "outside"], data: { withheld: 1, paid: 1, staff } });
const office = () => transfers.create(context("outside-support-system", "outside", { account: "acc-o", publish_every_days: 30 }));
const at = (m: any, t: number, records: object[] = []) => wake(m, t, { book: { kind: "records", records } }, { entity: "outside" });
const decisions = (w: ReturnType<typeof wake>) => w.of("statement", "benefit_decision").map((c) => c.args.data);
const paid = (w: ReturnType<typeof wake>) => w.of("money").map((c) => [c.args.to, Number(parseAmount(c.args.amount, currencyNow())), c.args.from]);

test("a flat payment by age: granted to those in its ages, paid on its schedule from its account, counted in the published figures", () => {
  const m = office();
  const pension: PaymentRule = { id: "pension", ...by, account: "acc-fund", every_days: 14, who: { from_age: 67 }, amount: { flat: 50_000 } };
  const first = at(m, 0, [law([pension]), claim("c1", 0, "old", "pension", 70), claim("c2", 0, "young", "pension", 30), claim("c3", 0, "x", "nothing", 70)]);
  expect(decisions(first)).toEqual([{ claim: "c1", payment: "pension", granted: true, amount: 50_000, every: 14 * DAY }, { claim: "c2", payment: "pension", granted: false }, { claim: "c3", payment: "nothing", granted: false }]);
  expect(first.of("statement", "benefit_decision").map((c) => c.args.text)).toEqual(["Claim c1 granted: XTS 500.00 every 14 days.", "Claim c2 refused.", "Claim c3 refused."]);
  expect(paid(at(m, 13 * DAY))).toEqual([]);
  expect(paid(at(m, 14 * DAY))).toEqual([["acc-old", 50_000, "acc-fund"]]);
  const month = at(m, 30 * DAY);
  expect(paid(month)).toEqual([["acc-old", 50_000, "acc-fund"]]);
  expect(month.of("statement", "support_statistics")[0]!.args.data).toEqual({ recipients: { pension: 1 } });
  // With no law published, there is nothing to claim.
  expect(decisions(at(office(), 0, [claim("c1", 0, "old", "pension", 70)]))).toEqual([{ claim: "c1", payment: "pension", granted: false }]);
});

test("a record of contributions: ten months on the office's book are refused where twelve are asked, and twelve are granted", () => {
  const rule: PaymentRule = { id: "insurance", ...by, every_days: 30, who: { out_of_work: true, record: { months: 12, within_months: 30 } }, amount: { flat: 10_000 } };
  const months = (n: number, from = 0) => Array.from({ length: n }, (_, i) => report(`r${from + i}`, (from + i) * MONTH, [{ worker: "w", gross: 300_000 }, { worker: "other", gross: 1 }]));
  const m = office();
  const ten = at(m, 10 * MONTH, [law([rule]), ...months(10), claim("c1", 10 * MONTH, "w", "insurance", 40)]);
  expect(decisions(ten)).toEqual([{ claim: "c1", payment: "insurance", granted: false, reason: "contributions are on our record for 10 months, and the payment asks for 12" }]);
  const twelve = at(m, 12 * MONTH, [...months(2, 10), claim("c2", 12 * MONTH, "w", "insurance", 40)]);
  expect(decisions(twelve)[0]).toMatchObject({ claim: "c2", granted: true, amount: 10_000 });
  // Thirty months on, those twelve are too long ago; and someone with no report at all has none.
  expect(decisions(at(m, 45 * MONTH, [claim("c3", 45 * MONTH, "w", "insurance", 43), claim("c4", 45 * MONTH, "never", "insurance", 43)])).map((d) => d.granted)).toEqual([false, false]);
});

test("a share of previous pay: of the mean monthly pay reported, before or after what the tax law withholds, within a least and a most by age", () => {
  const share = (x: object): PaymentRule => ({ id: "insurance", ...by, every_days: 30, who: { out_of_work: true, record: {} }, amount: { share_bps: 6000, of: "gross", ...x } as any });
  const book = [taxLaw, report("r1", MONTH, [{ worker: "w", gross: 280_000 }]), report("r2", 2 * MONTH, [{ worker: "w", gross: 320_000 }])];
  const amount = (rule: PaymentRule, age = 40, declares?: object) => decisions(at(office(), 2 * MONTH, [law([rule]), ...book, claim("c", 2 * MONTH, "w", "insurance", age, declares)]))[0]!.amount;
  expect(amount(share({}))).toBe(180_000); // 60% of a mean of 300,000
  expect(amount(share({ of: "net" }))).toBe(144_000); // the tax law takes a fifth of such a pay
  expect(amount(share({ of: "net", with_child_bps: 6700 }), 40, { children_born_at: [2 * MONTH - 5 * YEAR] })).toBe(160_800);
  expect(amount(share({ of: "net", with_child_bps: 6700 }), 40, { children_born_at: [] })).toBe(144_000);
  expect(amount(share({ least: 200_000 }))).toBe(200_000);
  const capped = share({ most: [{ from_age: 0, amount: 100_000 }, { from_age: 30, amount: 150_000 }, { from_age: 60, amount: 120_000 }] });
  expect([25, 40, 62].map((age) => amount(capped, age))).toEqual([100_000, 150_000, 120_000]);
  // A payment every 14 days is that share of fourteen days of the monthly pay.
  expect(decisions(at(office(), 2 * MONTH, [law([{ ...share({}), every_days: 14 }]), ...book, claim("c", 2 * MONTH, "w", "insurance", 40)]))[0]!.amount).toBe(84_000);
});

test("a payment for so many days stops on the day its time runs out, and the claimant is told what may be claimed next", () => {
  const m = office();
  const rules: PaymentRule[] = [
    { id: "insurance", ...by, every_days: 30, who: { out_of_work: true }, amount: { flat: 10_000 }, lasts: { days: 60, then: "basic" } },
    { id: "basic", ...by, every_days: 30, who: { out_of_work: true }, amount: { flat: 4_000 } },
  ];
  const granted = at(m, 0, [law(rules), claim("c1", 0, "w", "insurance", 40)]);
  expect(decisions(granted)).toEqual([{ claim: "c1", payment: "insurance", granted: true, amount: 10_000, every: 30 * DAY, until: 60 * DAY }]);
  expect(paid(at(m, 30 * DAY)).length).toBe(1);
  const last = at(m, 60 * DAY);
  expect(paid(last).length).toBe(1);
  expect(last.of("statement", "benefit_end").map((c) => [c.args.to, c.args.data])).toEqual([[["w"], { claim: "c1", payment: "insurance", ended: true, then: "basic" }]]);
  expect(paid(at(m, 90 * DAY))).toEqual([]);
  // Until an age: a payment granted to someone a month short of it is paid once.
  const n = office();
  const toAge: PaymentRule = { id: "bridge", ...by, every_days: 30, amount: { flat: 1_000 }, lasts: { until_age: 60 } };
  const born = -(60 * YEAR - 45 * DAY);
  at(n, 0, [law([toAge]), statement("c1", 0, "benefit_claim", { speaks_for: "w", addressed_to: ["outside"], data: { payment: "bridge", account: "acc-w", born_at: born } })]);
  const only = at(n, 30 * DAY); // (no other payment falls before the age: it ends with this one)
  expect(paid(only).length).toBe(1);
  expect(only.of("statement", "benefit_end").length).toBe(1);
  expect(paid(at(n, 60 * DAY))).toEqual([]);
});

test("what a claim declares is taken as stated: a household over the income line is refused; a household's payment counts its members and children", () => {
  const family: PaymentRule = { id: "family", ...by, every_days: 30, who: { income_under: { amount: 20_000, per: "head" }, children: { least: 1, under_age: 18 } }, amount: { household: 60_000, per_member: 1_000, per_child: { under_age: 6, amount: 15_000 } } };
  const kids = [-3 * YEAR, -10 * YEAR];
  const d = (declares?: object) => decisions(at(office(), 0, [law([family]), claim("c", 0, "head", "family", 35, declares)]))[0]!;
  expect(d({ household_income: 70_000, household_members: 4, children_born_at: kids })).toMatchObject({ granted: true, amount: 60_000 + 4_000 + 15_000 });
  expect(d({ household_income: 80_000, household_members: 4, children_born_at: kids })).toMatchObject({ granted: false, reason: "the household's income as stated is not under XTS 200.00 a head" });
  expect(d({ household_income: 10_000, household_members: 2, children_born_at: [] }).granted).toBe(false); // no child
  expect(d().granted).toBe(false); // nothing declared
  expect(paymentsInWords([family], (n) => String(n))).toContain("whose household's income for a month is under 20000 a head, with at least 1 child under 18 in the household, 60000 a household, and 1000 for each member, and 15000 for each child under 6 every 30 days");
});

test("a pension for those with no other: the claimant declares it, and the office refuses someone it pays another pension itself", () => {
  const rules: PaymentRule[] = [
    { id: "contributory", ...by, every_days: 30, who: { from_age: 60 }, amount: { flat: 9_000 } },
    { id: "social", ...by, every_days: 30, who: { from_age: 70, no_other_pension: true }, amount: { flat: 2_000 } },
  ];
  const m = office();
  const first = at(m, 0, [law(rules), claim("c1", 0, "a", "social", 72, { other_pension: false }), claim("c2", 0, "b", "social", 72, { other_pension: true }), claim("c3", 0, "c", "social", 72), claim("c4", 0, "d", "contributory", 72)]);
  expect(decisions(first).map((x) => x.granted)).toEqual([true, false, false, true]);
  expect(decisions(at(m, DAY, [claim("c5", DAY, "d", "social", 72, { other_pension: false })]))[0]).toMatchObject({ granted: false, reason: "we pay the claimant another pension" });
  // Both of the first two are paid: a person may draw more than one payment, each on its own claim.
  expect(decisions(at(m, 2 * DAY, [claim("c6", 2 * DAY, "a", "contributory", 72)]))[0]!.granted).toBe(true);
  expect(paid(at(m, 32 * DAY)).filter(([to]) => to === "acc-a").map(([, n]) => n).sort()).toEqual([2_000, 9_000]);
});

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

test("a person out of work claims the first payment for it the law lists, the next when that refuses or runs out, and none again until they are older", async () => {
  const rules: PaymentRule[] = [
    { id: "insurance", ...by, every_days: 30, who: { out_of_work: true, record: {} }, amount: { share_bps: 6000, of: "gross" }, lasts: { days: 60, then: "basic" } },
    { id: "basic", ...by, every_days: 30, who: { out_of_work: true }, amount: { flat: 4_000 } },
    { id: "pension", ...by, every_days: 30, who: { from_age: 67 }, amount: { flat: 9_000 } },
  ];
  const p = person(citizen, { year: YEAR }, { age: 40 });
  const first = await p.wake(DAY, { records: [law(rules)], balance: 500_000 });
  expect(claims(first)).toEqual([{ payment: "insurance", account: "acc-c1", born_at: -40 * YEAR }]);
  const c1 = first.find((c) => c.args.kind === "benefit_claim")!;
  // Refused (no record): the next one, at once.
  const second = await p.wake(2 * DAY, { records: [answer("d1", 2 * DAY, "c1", c1, false)] });
  expect(claims(second).map((d) => d.payment)).toEqual([]);
  const third = await p.wake(3 * DAY);
  expect(claims(third).map((d) => d.payment)).toEqual(["basic"]);
  const c2 = third.find((c) => c.args.kind === "benefit_claim")!;
  // Granted: nothing more is claimed, and the refused one isn't asked for again at this age.
  expect(claims(await p.wake(4 * DAY, { records: [answer("d2", 4 * DAY, "c1", c2, true, { amount: 4_000, every: 30 * DAY })] }))).toEqual([]);
  expect(claims(await p.wake(40 * DAY))).toEqual([]);
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
