// Income tax, as an employer's payroll and an employee reckon it (phase C, stage C4a). The law is a record the world
// publishes (its brackets, from the world's profile); nothing here holds any place's figures. Documented in
// docs/behaviour/public-finance.md.

import type { Book } from "./common";

const DAY = 86_400;
const YEAR = 365 * DAY;

/** An income tax law's terms: marginal rates on a year's income above each threshold, a levy on the whole of an
 * income from a threshold, and where withheld tax is paid. Amounts in cents a year. */
export interface IncomeTaxLaw {
  id: string;
  brackets: { from: number; rate_bps: number }[];
  levy_bps: number;
  levy_from: number;
  collector: string; // who collects it (an entity)
  account: string; // and into which account
}

/** The income tax law in force that we've seen: the latest published and not withdrawn (none: no income tax). */
export function incomeTaxLaw(book: Book): IncomeTaxLaw | undefined {
  const laws = book.open("law").filter((r) => r.data?.tax === "income" && Array.isArray(r.data?.brackets)).sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
  const l = laws[0];
  if (!l) return undefined;
  return { id: l.id, brackets: l.data.brackets, levy_bps: l.data.levy_bps ?? 0, levy_from: l.data.levy_from ?? 0, collector: l.data.collector ?? l.speaks_for!, account: l.data.account };
}

/** The tax on a year's income, in cents (rounded down). */
export function annualTax(law: IncomeTaxLaw, income: number): number {
  const bands = [...law.brackets].sort((a, b) => a.from - b.from);
  let tax = 0;
  for (const [i, b] of bands.entries()) {
    const top = bands[i + 1]?.from ?? Infinity;
    if (income > b.from) tax += Math.floor(((Math.min(income, top) - b.from) * b.rate_bps) / 10_000);
  }
  if (income >= law.levy_from) tax += Math.floor((income * law.levy_bps) / 10_000);
  return tax;
}

/** What's withheld from a pay of `gross` every `period` seconds: the year's tax on that pay, as a year's income, for one
 * period (rounded down). No law: nothing. */
export function withholding(law: IncomeTaxLaw | undefined, gross: number, period: number): number {
  if (!law || gross <= 0 || period <= 0) return 0;
  const yearly = Math.floor((gross * YEAR) / period);
  return Math.floor((annualTax(law, yearly) * period) / YEAR);
}
