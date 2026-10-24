// A tax law as a list of charges (docs/behaviour/public-finance.md): the arithmetic, on laws of no place.
import { expect, test } from "bun:test";
import { annualTax, chargesOn, dayPayPeriod, taxLawOf, withheld, withholding, type Charge } from "../src";

const DAY = 86_400;
const to = { collector: "o", account: "a" };
const law = (...charges: Charge[]) => ({ id: "l", charges });
const of = (l: ReturnType<typeof law>, pay: number) => Object.fromEntries(chargesOn(l, pay).map((c) => [c.charge.id, c.amount]));

/** The law in its short form, as it was reckoned before a law was a list of charges. */
function shortForm(d: { brackets: { from: number; rate_bps: number }[]; levy_bps: number; levy_from: number }, income: number): number {
  const bands = [...d.brackets].sort((a, b) => a.from - b.from);
  let tax = 0;
  for (const [i, b] of bands.entries()) {
    const top = bands[i + 1]?.from ?? Infinity;
    if (income > b.from) tax += Math.floor(((Math.min(income, top) - b.from) * b.rate_bps) / 10_000);
  }
  if (income >= d.levy_from) tax += Math.floor((income * d.levy_bps) / 10_000);
  return tax;
}

test("a law in the short form is two charges, and comes to the same sums to the smallest unit", () => {
  const forms = [
    { brackets: [{ from: 0, rate_bps: 0 }, { from: 1_000_000, rate_bps: 2000 }, { from: 5_000_000, rate_bps: 4000 }], levy_bps: 100, levy_from: 2_000_000 },
    { brackets: [{ from: 0, rate_bps: 192 }, { from: 1_013_512, rate_bps: 640 }, { from: 8_602_213, rate_bps: 1088 }], levy_bps: 0, levy_from: 0 },
    { brackets: [{ from: 0, rate_bps: 0 }, { from: 1_234_901, rate_bps: 1933 }, { from: 6_987_901, rate_bps: 4200 }], levy_bps: 2115, levy_from: 723_601 },
  ];
  for (const d of forms) {
    const l = taxLawOf("l", { ...d, ...to })!;
    expect(l.charges.map((c) => c.id)).toEqual(d.levy_bps > 0 ? ["income-tax", "levy"] : ["income-tax"]);
    for (let income = 0; income < 30_000_000; income += 97_301) expect(annualTax(l, income)).toBe(shortForm(d, income));
    for (const at of [d.levy_from - 1, d.levy_from, ...d.brackets.flatMap((b) => [b.from, b.from + 1])]) expect(annualTax(l, at)).toBe(shortForm(d, at));
    // What is withheld from a pay is the whole, rounded down once, and its parts add up to it.
    for (const gross of [0, 1, 77_777, 211_356, 300_000, 999_999]) for (const days of [7, 14, 30]) {
      const yearly = Math.floor((gross * 365) / days);
      const w = withheld(l, gross, days * DAY);
      expect(w.total).toBe(gross > 0 ? Math.floor((shortForm(d, yearly) * days) / 365) : 0);
      expect(w.parts.reduce((x, c) => x + c.amount, 0)).toBe(w.total);
      expect(withholding(l, gross, days * DAY)).toBe(w.total);
    }
  }
  expect(taxLawOf("l", { rate_ppm: 4 })).toBeUndefined();
  expect(withholding(undefined, 100_000, 14 * DAY)).toBe(0);
});

test("a charge's base: pay above an allowance (one that tapers away), pay up to a ceiling, pay from a threshold", () => {
  const l = law(
    { id: "tax", base: { less: [{ amount: 1_000_000, tapers: { above: 8_000_000, bps: 5000 } }] }, schedule: [{ from: 0, rate_bps: 2000 }, { from: 3_000_000, rate_bps: 4000 }], ...to },
    { id: "fund", base: { up_to: 5_000_000 }, schedule: [{ from: 0, rate_bps: 600 }], collector: "o", account: "fund" },
    { id: "levy", base: { from: 2_000_000 }, schedule: [{ from: 0, rate_bps: 100 }], ...to },
  );
  expect(of(l, 900_000)).toEqual({ tax: 0, fund: 54_000, levy: 0 });
  expect(of(l, 2_000_000)).toEqual({ tax: 200_000, fund: 120_000, levy: 20_000 });
  expect(of(l, 6_000_000)).toEqual({ tax: 600_000 + 800_000, fund: 300_000, levy: 60_000 }); // the ceiling holds the fund's
  // The allowance is lost at half of each unit above 8,000,000: at 9,000,000 half of it is left; at 10,000,000, none.
  expect(of(l, 9_000_000).tax).toBe(600_000 + Math.floor((9_000_000 - 500_000 - 3_000_000) * 0.4));
  expect(of(l, 10_000_000).tax).toBe(600_000 + 7_000_000 * 0.4);
  expect(of(l, 12_000_000).tax).toBe(600_000 + 9_000_000 * 0.4);
});

test("deductions: a share of the pay within a least and a most, and what other charges take", () => {
  const l = law(
    { id: "fund", schedule: [{ from: 0, rate_bps: 1000 }], collector: "o", account: "fund" },
    { id: "tax", base: { less: [{ share_bps: 3000, least: 500_000, most: 1_500_000 }, { charges: ["fund"] }] }, schedule: [{ from: 0, rate_bps: 1000 }], ...to },
  );
  expect(of(l, 1_000_000).tax).toBe(Math.floor((1_000_000 - 500_000 - 100_000) / 10)); // the least
  expect(of(l, 3_000_000).tax).toBe(Math.floor((3_000_000 - 900_000 - 300_000) / 10));
  expect(of(l, 9_000_000).tax).toBe(Math.floor((9_000_000 - 1_500_000 - 900_000) / 10)); // the most
  expect(of(l, 400_000).tax).toBe(0); // never below nought
});

test("reliefs: a sum off the charge, and a rebate that leaves low incomes untaxed; a surcharge is a charge on a charge", () => {
  const l = law(
    { id: "tax", name: "Income tax", schedule: [{ from: 0, rate_bps: 1000 }, { from: 2_000_000, rate_bps: 2500 }], reliefs: [{ amount: 200_000 }], ...to },
    { id: "cess", base: { on: "tax" }, schedule: [{ from: 0, rate_bps: 400 }], ...to },
    { id: "other", schedule: [{ from: 0, rate_bps: 500 }, { from: 1_000_000, rate_bps: 1000 }], reliefs: [{ none_due_up_to: 3_000_000 }], ...to },
  );
  expect(of(l, 1_500_000)).toEqual({ tax: 0, cess: 0, other: 0 }); // the relief covers it; nothing below nought
  expect(of(l, 2_000_000)).toEqual({ tax: 0, cess: 0, other: 0 }); // 10% of 2,000,000 is the relief exactly
  expect(of(l, 3_000_000)).toEqual({ tax: 250_000, cess: 10_000, other: 0 });
  expect(of(l, 3_000_001).other).toBe(50_000 + 200_000); // past the rebate's line, the whole charge
});

test("a band whose rate rises in a straight line: the charge is the area under the line", () => {
  // From 1,000,000 the marginal rate rises from 14% to 24% at 2,000,000, then from 24% to 42% at 6,000,000, then stays.
  const l = law({ id: "tax", schedule: [{ from: 0, rate_bps: 0 }, { from: 1_000_000, rate_bps: 1400, rising_to_bps: 2400 }, { from: 2_000_000, rate_bps: 2400, rising_to_bps: 4200 }, { from: 6_000_000, rate_bps: 4200 }], ...to });
  const first = (x: number) => (x * (0.14 + (0.14 + (0.1 * x) / 1_000_000))) / 2;
  expect(annualTax(l, 1_000_000)).toBe(0);
  expect(annualTax(l, 1_500_000)).toBe(Math.floor(first(500_000)));
  expect(annualTax(l, 2_000_000)).toBe(190_000);
  expect(annualTax(l, 4_000_000)).toBe(190_000 + Math.floor((2_000_000 * (0.24 + 0.33)) / 2));
  expect(annualTax(l, 6_000_000)).toBe(190_000 + 1_320_000);
  expect(annualTax(l, 7_000_000)).toBe(190_000 + 1_320_000 + 420_000);
  // It never falls as pay rises, and its steps stay under the top rate.
  let last = 0;
  for (let pay = 0; pay <= 8_000_000; pay += 12_345) {
    const now = annualTax(l, pay);
    expect(now).toBeGreaterThanOrEqual(last);
    expect(now - last).toBeLessThanOrEqual(Math.ceil(12_345 * 0.42) + 1);
    last = now;
  }
});

// What is withheld from a pay, worked by hand from the law's own words (wave 2a's review of 2026-10-09, fault 4). A
// finance seat reckoned a wage's withholding from the law as a person with a calendar would, a year of 26 pays, and
// came to a sum thirty hundredths from the opening wage instruction's, which every payroll reckons by days: 365 over
// the days of the pay. It withdrew eight workers' wages for it. The law said only "reckoned as a year's pay". It now
// says the three steps and each rounding, and they are the function's.
test("what is withheld from a pay is what the law's three steps give, worked by hand; the calendar's route gives another figure", () => {
  // A law of no place: nothing up to 1,000,000 a year, 10% above it, 20% above 3,000,000; and 5% of all of it.
  const l = law({ id: "tax", schedule: [{ from: 0, rate_bps: 0 }, { from: 1_000_000, rate_bps: 1000 }, { from: 3_000_000, rate_bps: 2000 }], ...to }, { id: "levy", schedule: [{ from: 0, rate_bps: 500 }], ...to });
  const gross = 236_000, days = 14;
  // One: the pay as a year's pay, by days, rounded down.
  const yearly = Math.floor((gross * 365) / days);
  expect(yearly).toBe(6_152_857);
  // Two: each charge on that, each band's part rounded down.
  const tax = Math.floor(((3_000_000 - 1_000_000) * 10) / 100) + Math.floor(((yearly - 3_000_000) * 20) / 100);
  const levy = Math.floor((yearly * 5) / 100);
  expect([tax, levy]).toEqual([830_571, 307_642]);
  // Three: added, and a pay's days of 365 of the sum, rounded down.
  const byHand = Math.floor(((tax + levy) * days) / 365);
  expect(byHand).toBe(43_657);
  const w = withheld(l, gross, days * DAY);
  expect(w.total).toBe(byHand);
  expect(withholding(l, gross, days * DAY)).toBe(byHand);
  // Each charge's part: its own year's amount the same way, rounded down, the odd unit with the first.
  const parts = [Math.floor((tax * days) / 365), Math.floor((levy * days) / 365)];
  expect(w.parts.map((c) => c.amount)).toEqual([parts[0]! + (byHand - parts[0]! - parts[1]!), parts[1]!]);
  // The route a calendar suggests (26 pays in a year) comes to a different figure: which is why the law spells its own.
  const pays = 26, calendarYear = gross * pays;
  const byCalendar = Math.floor((Math.floor(((3_000_000 - 1_000_000) * 10) / 100) + Math.floor(((calendarYear - 3_000_000) * 20) / 100) + Math.floor((calendarYear * 5) / 100)) / pays);
  expect(byCalendar).toBe(43_615);
  expect(byCalendar).not.toBe(byHand);
  // Pay by the day: a day's pay is pay for a week over its working days.
  expect(dayPayPeriod(5) / DAY).toBe(1.4);
  expect(withheld(l, 23_600, dayPayPeriod(5)).total).toBe(Math.floor((annualTax(l, Math.floor((23_600 * 365 * DAY) / dayPayPeriod(5))) * dayPayPeriod(5)) / (365 * DAY)));
  // (The words that say those steps are the engine's, and are tested with it: kernel/crates/rules/src/withholding.rs.)
});
