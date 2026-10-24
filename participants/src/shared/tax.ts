// Tax on pay, as an employer's payroll and an employee reckon it (docs/behaviour/public-finance.md). The law is a
// record its lawmaker publishes: a list of charges, each with what it is charged on, its schedule of rates, its reliefs
// and whom it is paid to. Nothing here holds any place's figures; every figure is the law's, which a world's profile
// supplies.

import type { Book } from "./common";
import { returnRulesOf, returnsOf, type ReturnRule } from "./returns";

const DAY = 86_400;
const YEAR = 365 * DAY;

/** A band of a schedule: the marginal rate on what lies above `from` (up to the next band's start). With
 * `rising_to_bps`, the marginal rate rises in a straight line from `rate_bps` at the band's start to that at its end. */
export interface Band { from: number; rate_bps: number; rising_to_bps?: number }

/** A sum (taken off the pay before it is charged, or off the charge): flat, or lost as pay rises (`tapers`: by `bps` of
 * each unit of a year's pay above `above`, never below nought). */
export interface Allowance { amount: number; tapers?: { above: number; bps: number } }

/** What is taken off a year's pay before a charge's schedule is applied: an allowance; a share of the pay, within a
 * least and a most; or what other charges of the same law take (contributions deducted before a tax). */
export type Deduction = Allowance | { share_bps: number; least?: number; most?: number } | { charges: string[] };

/** What is taken off a charge once reckoned: an allowance (a credit); or all of it, where what it is charged on is no
 * more than a sum (a rebate that leaves low incomes untaxed). Never below nought. */
export type Relief = Allowance | { none_due_up_to: number };

/**
 * One charge on pay. Amounts are a year's, in the smallest unit of the world's money.
 * - `base`: what it is charged on. A year's pay, unless `on` names another charge (then that charge's amount: a
 *   surcharge on a tax). `from`: nothing is due on pay below this, and all of it is charged from there. `up_to`: pay
 *   beyond this is not charged (a ceiling). `less`: what is taken off first.
 * - `schedule`: bands of marginal rates on the base (one band from nought is a flat rate).
 * - `reliefs`: what is taken off the charge.
 * - `collector`, `account`: whom it is paid to, and into which account.
 * - `itemised`: the employer's report of it names each worker and their pay (a contribution that builds a record).
 */
export interface Charge {
  id: string;
  name?: string;
  base?: { on?: string; from?: number; up_to?: number; less?: Deduction[] };
  schedule: Band[];
  reliefs?: Relief[];
  collector: string;
  account: string;
  itemised?: boolean;
}

/** A law taxing pay: its charges, in the order the law lists them. */
/** (`returns`: when each charge is reported and paid over; docs/behaviour/firms.md, "Returns on the law's days". None: every charge monthly, on the first day of the month after.) */
export interface IncomeTaxLaw { id: string; charges: Charge[]; returns?: ReturnRule[] }

/**
 * A tax law's terms, from its record's data. `charges` as above (a charge that names no collector is its lawmaker's).
 * A law in the short form (`brackets`, `levy_bps`, `levy_from`, `account`) is read as the two charges it is: marginal
 * rates on a year's pay, and a levy on the whole of a pay from a threshold, both paid into one account.
 */
export function taxLawOf(id: string, data: any, lawmaker?: string): IncomeTaxLaw | undefined {
  if (Array.isArray(data?.charges)) return { id, charges: data.charges.map((c: Charge) => ({ ...c, collector: c.collector ?? data.collector ?? lawmaker })), ...(returnRulesOf(data.returns)?.length ? { returns: returnRulesOf(data.returns) } : {}) };
  if (!Array.isArray(data?.brackets)) return undefined;
  const to = { collector: data.collector ?? lawmaker, account: data.account };
  return { id, charges: [
    { id: "income-tax", schedule: data.brackets, ...to },
    ...((data.levy_bps ?? 0) > 0 ? [{ id: "levy", base: { from: data.levy_from ?? 0 }, schedule: [{ from: 0, rate_bps: data.levy_bps }], ...to }] : []),
  ] };
}

/** The income tax law in force that we've seen: the latest published and not withdrawn (none: no income tax). */
export function incomeTaxLaw(book: Book): IncomeTaxLaw | undefined {
  const laws = book.open("law").filter((r) => r.data?.tax === "income" && (Array.isArray(r.data?.brackets) || Array.isArray(r.data?.charges))).sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
  const l = laws[0];
  return l ? taxLawOf(l.id, l.data, l.speaks_for) : undefined;
}

const allowance = (a: Allowance, pay: number) => Math.max(0, a.amount - (a.tapers && pay > a.tapers.above ? Math.floor(((pay - a.tapers.above) * a.tapers.bps) / 10_000) : 0));

/** A schedule's charge on a base (each band rounded down). */
function scheduled(schedule: Band[], base: number): number {
  const bands = [...schedule].sort((a, b) => a.from - b.from);
  let due = 0;
  for (const [i, b] of bands.entries()) {
    const top = bands[i + 1]?.from ?? Infinity;
    if (base <= b.from) continue;
    const part = Math.min(base, top) - b.from;
    if (b.rising_to_bps === undefined || top === Infinity) due += Math.floor((part * b.rate_bps) / 10_000);
    else {
      // The marginal rate rises in a straight line across the band: the charge on a part of it is the part at the mean
      // of the rate at the band's start and the rate reached. (In whole numbers too large for a float.)
      const width = BigInt(top - b.from), x = BigInt(part);
      due += Number((x * (2n * BigInt(b.rate_bps) * width + BigInt(b.rising_to_bps - b.rate_bps) * x)) / (2n * width * 10_000n));
    }
  }
  return due;
}

/** What each charge of a law takes of a year's pay (rounded down), in the law's order. */
export function chargesOn(law: IncomeTaxLaw, pay: number): { charge: Charge; amount: number }[] {
  const done = new Map<string, number>();
  const doing = new Set<string>();
  const of = (id: string): number => {
    if (done.has(id)) return done.get(id)!;
    const c = law.charges.find((x) => x.id === id);
    if (!c || doing.has(id)) return 0; // (a charge on itself, or on one the law doesn't have: nothing)
    doing.add(id);
    const b = c.base ?? {};
    let amount = 0;
    if (b.on !== undefined || pay >= (b.from ?? 0)) {
      let base = b.on !== undefined ? of(b.on) : pay;
      if (b.up_to !== undefined) base = Math.min(base, b.up_to);
      for (const d of b.less ?? []) {
        if ("charges" in d) base -= d.charges.reduce((x, other) => x + of(other), 0);
        else if ("share_bps" in d) base -= Math.min(d.most ?? Infinity, Math.max(d.least ?? 0, Math.floor((pay * d.share_bps) / 10_000)));
        else base -= allowance(d, pay);
      }
      base = Math.max(0, base);
      amount = scheduled(c.schedule, base);
      for (const r of c.reliefs ?? []) amount = "none_due_up_to" in r ? (base <= r.none_due_up_to ? 0 : amount) : Math.max(0, amount - allowance(r, pay));
    }
    doing.delete(id);
    done.set(id, amount);
    return amount;
  };
  return law.charges.map((charge) => ({ charge, amount: of(charge.id) }));
}

/** Everything a law takes of a year's pay (rounded down, charge by charge). */
export function annualTax(law: IncomeTaxLaw, income: number): number {
  return chargesOn(law, income).reduce((x, c) => x + c.amount, 0);
}

/**
 * What's withheld from a pay of `gross` every `period` seconds, charge by charge: the pay reckoned as a year's, the
 * law's charges on that, and a pay period's part. The whole is rounded down once; each charge has its part rounded
 * down, and what that leaves over goes to the first that takes anything. No law: nothing.
 * The one reckoning of it: the opening wage instructions, every employer's payroll, a worker's own check of their pay
 * and a payment reckoned on net pay all call this, and the law's text says the same steps (`withholdingInWords`).
 */
export function withheld(law: IncomeTaxLaw | undefined, gross: number, period: number): { total: number; parts: { charge: Charge; amount: number }[] } {
  if (!law || gross <= 0 || period <= 0) return { total: 0, parts: [] };
  const yearly = Math.floor((gross * YEAR) / period);
  const year = chargesOn(law, yearly);
  const total = Math.floor((year.reduce((x, c) => x + c.amount, 0) * period) / YEAR);
  const parts = year.map((c) => ({ charge: c.charge, amount: Math.floor((c.amount * period) / YEAR) }));
  const taking = parts.filter((c, i) => year[i]!.amount > 0);
  if (taking[0]) taking[0].amount += total - taking.reduce((x, c) => x + c.amount, 0);
  return { total, parts: taking.filter((c) => c.amount > 0) };
}

/** The span a day's pay is reckoned over, for what the law takes from it: a day's pay is pay for a working day, so a
 * year's is the working days of a year of it (the week over its working days), not every day of the year. */
export const dayPayPeriod = (workDaysAWeek: number) => Math.round((7 * 86_400) / Math.min(7, Math.max(1, workDaysAWeek)));

/** What's withheld from a pay of `gross` every `period` seconds, in all (rounded down). No law: nothing. */
export function withholding(law: IncomeTaxLaw | undefined, gross: number, period: number): number {
  return withheld(law, gross, period).total;
}

