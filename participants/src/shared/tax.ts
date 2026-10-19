// Tax on pay, as an employer's payroll and an employee reckon it (docs/behaviour/public-finance.md). The law is a
// record its lawmaker publishes: a list of charges, each with what it is charged on, its schedule of rates, its reliefs
// and whom it is paid to. Nothing here holds any place's figures; every figure is the law's, which a world's profile
// supplies.

import type { Book } from "./common";
import { MONTH_WORDS, returnRuleInWords, returnRulesOf, returnsOf, type ReturnRule } from "./returns";

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

/**
 * The rule `withheld` reckons by, in the words a tax law gives it, so that whoever works a pay's withholding out by
 * hand from the law comes to the figure every payroll comes to. It is said step by step, with each rounding, because
 * the step people take from habit is another one: a year as a whole number of pays (26 pays of 14 days), where the
 * world's year is 365 days and a pay is its days' share of it. The two differ by a little on every pay under any
 * schedule with more than one rate (wave 2a, 2026-10-09: an opening wage instruction and a finance seat's own sum
 * stood thirty hundredths apart, and the seat withdrew eight workers' wages for it).
 * `period_days`: the pay period the words give as their example; `work_days`: the working days of a week, where pay by
 * the day is reckoned (see `dayPayPeriod`).
 */
export function withholdingInWords(o: { period_days: number; work_days?: number }): string {
  const d = o.period_days;
  const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
  const perDay = o.work_days === undefined ? undefined : dayPayPeriod(o.work_days) / DAY;
  return [
    "Employers withhold each from every pay. What is withheld from a pay is reckoned in three steps, and in no other way.",
    `One: the pay is taken as a year's pay, by multiplying it by 365 and dividing by the number of days the pay is for, rounded down to the smallest unit of money. (A year is 365 days: a pay for ${days(d)} is ${d}/365 of a year's pay, and a year is not taken as a whole number of pays.)`,
    "Two: each charge is reckoned on that year's pay as set out above, each band's part rounded down.",
    "Three: the year's charges are added together, and that sum, multiplied by the number of days the pay is for and divided by 365, rounded down, is what is withheld from the pay.",
    "Of what is withheld, each charge's part is its own year's amount multiplied and divided the same way, rounded down, and what that leaves over goes with the first charge that takes anything.",
    ...(perDay === undefined ? [] : [`Pay for a day's work is taken as pay for ${Number(perDay.toFixed(4))} days: a week over its ${o.work_days} working days.`]),
  ].join(" ");
}

/** The span a day's pay is reckoned over, for what the law takes from it: a day's pay is pay for a working day, so a
 * year's is the working days of a year of it (the week over its working days), not every day of the year. */
export const dayPayPeriod = (workDaysAWeek: number) => Math.round((7 * 86_400) / Math.min(7, Math.max(1, workDaysAWeek)));

/** What's withheld from a pay of `gross` every `period` seconds, in all (rounded down). No law: nothing. */
export function withholding(law: IncomeTaxLaw | undefined, gross: number, period: number): number {
  return withheld(law, gross, period).total;
}

/** A law's charges in words, for the law's own text and for an office's report: each with what it is charged on, its
 * rates, its reliefs and where it is paid. `written` words a sum of money as the world writes it; `payee`, whom a charge
 * is paid to. */
export function chargesInWords(charges: Charge[], written: (amount: number) => string, payee: (c: Charge) => string = (c) => c.account): string {
  const pct = (bps: number) => `${bps / 100}%`;
  return charges.map((c) => {
    const b = c.base ?? {};
    const on = b.on !== undefined ? `on the ${charges.find((x) => x.id === b.on)?.name ?? b.on} due` : "on a year's pay";
    const less = (b.less ?? []).map((d) => ("charges" in d ? `less what is paid as ${d.charges.map((id) => charges.find((x) => x.id === id)?.name ?? id).join(", ")}`
      : "share_bps" in d ? `less ${pct(d.share_bps)} of it${d.least !== undefined ? `, at least ${written(d.least)}` : ""}${d.most !== undefined ? `, at most ${written(d.most)}` : ""}`
      : `less ${written(d.amount)}${d.tapers ? ` (reduced by ${pct(d.tapers.bps)} of pay above ${written(d.tapers.above)})` : ""}`));
    const bands = [...c.schedule].sort((x, y) => x.from - y.from);
    const rates = bands.length === 1 && bands[0]!.from === 0 && bands[0]!.rising_to_bps === undefined ? pct(bands[0]!.rate_bps)
      // (The first band is said by where it ends, "nothing up to" or "so much up to": no law says "above nought".)
      : bands.map((s, i) => {
          const rate = `${pct(s.rate_bps)}${s.rising_to_bps !== undefined ? ` rising to ${pct(s.rising_to_bps)}` : ""}`;
          if (s.from > 0) return `${rate} above ${written(s.from)}`;
          const next = bands[i + 1];
          return next ? `${s.rate_bps === 0 && s.rising_to_bps === undefined ? "nothing" : rate} up to ${written(next.from)}` : rate;
        }).join(", ");
    const reliefs = (c.reliefs ?? []).map((r) => ("none_due_up_to" in r ? `none due where that is ${written(r.none_due_up_to)} or less` : `less ${written(r.amount)} of the charge${r.tapers ? ` (reduced by ${pct(r.tapers.bps)} of pay above ${written(r.tapers.above)})` : ""}`));
    return `${c.name ?? c.id}: ${[on, ...(b.from ? [`from ${written(b.from)}`] : []), ...(b.up_to !== undefined ? [`up to ${written(b.up_to)}`] : []), ...less].join(", ")}: ${rates}${reliefs.length ? `; ${reliefs.join("; ")}` : ""}; paid to ${payee(c)}${c.itemised ? ", reported worker by worker" : ""}`;
  }).join(". ");
}

/** What the law says of the returns: which charges are reported together, how often, and the day each is due (returns.ts). */
export function returnsInWords(law: IncomeTaxLaw): string {
  const rules = returnsOf(law);
  const name = (id: string) => law.charges.find((c) => c.id === id)?.name ?? id;
  return `Employers report what they withheld, and pay it over with the report, in ${rules.length === 1 ? "this return" : "these returns"}: ${rules.map((r) => returnRuleInWords(r.id === "return-rest" ? { ...r, name: "Return of tax withheld from wages" } : r, (r.charges ?? []).map(name).join(", "))).join("; ")}. ${MONTH_WORDS}`;
}
