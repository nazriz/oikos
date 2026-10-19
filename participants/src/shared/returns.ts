// The days returns of tax withheld from wages fall due (docs/behaviour/firms.md, "Returns on the law's days"; docs/behaviour/public-finance.md).
// The tax law (a record its lawmaker publishes) lists its returns: which charges each reports, how often, and the day
// of the month it is due by. Every payroll and the finance office's books call `nextReturn`: one function, from the
// law on file and the day, so that nobody keeps a private counter and every employer's returns fall on the same days.
// Nothing here holds any place's figures; every day is the law's, which a world's profile supplies.

const DAY = 86_400;
const YEAR = 365 * DAY;

/**
 * The world's months. The world has no calendar of names: a year is 365 days and a date is "year 2, day 40". For the
 * law's "the Nth day of the following month" a year is twelve months of 30 days counted from its first day (month 1 is
 * days 1 to 30, month 12 is days 331 to 365: the last five days of the year are part of the twelfth month), and a
 * quarter is three of them. This is the only place the mapping is made.
 */
export const MONTHS_A_YEAR = 12;
const MONTH = 30 * DAY;

/** A return the law asks: the charges it reports (left out: those no other return of the law reports), how many
 * months a period is (default 1), and the day it falls due by, counted from the first day of the month after the
 * period (`in: "following"`, the default) or from the first day of the period's last month (`"same"`: due within the
 * month the pay was made in). */
export interface ReturnRule { id: string; name?: string; charges?: string[]; every_months?: number; day: number; in?: "following" | "same" }

/** What a rule asks of a day: its period (days `from` up to `to`, as seconds from the world's start) and the day it is due. */
export interface ReturnDue { rule: ReturnRule; from: number; to: number; due: number }

/** The return a charge falls under where the law names none: reported on the first day of the month after, monthly. */
export const RETURN_REST: ReturnRule = { id: "return-rest", day: 1, in: "following" };

/** A law's rules as the profile or the paper gives them, kept to what can be read (anything else is dropped). */
export function returnRulesOf(data: any): ReturnRule[] | undefined {
  if (!Array.isArray(data)) return undefined;
  const rules = data.filter((r: any) => r && typeof r.id === "string" && Number.isInteger(r.day) && r.day >= 1 && r.day <= 30 && (r.every_months === undefined || [1, 2, 3, 4, 6, 12].includes(r.every_months)) && (r.in === undefined || r.in === "following" || r.in === "same"))
    .map((r: any): ReturnRule => ({ id: r.id, ...(typeof r.name === "string" ? { name: r.name } : {}), ...(Array.isArray(r.charges) ? { charges: r.charges.filter((c: unknown) => typeof c === "string") } : {}), ...(r.every_months !== undefined ? { every_months: r.every_months } : {}), day: r.day, ...(r.in ? { in: r.in } : {}) }));
  return rules;
}

/** The returns a law has, each charge under exactly one: those the law names, and the rest under `RETURN_REST`
 * (or, with no law, one rule for whatever is owed: `charges` left out). */
export function returnsOf(law: { charges: { id: string }[]; returns?: ReturnRule[] } | undefined): ReturnRule[] {
  if (!law) return [RETURN_REST];
  const seen = new Set<string>();
  const named = (law.returns ?? []).filter((r) => r.charges).map((r) => ({ ...r, charges: r.charges!.filter((c) => law.charges.some((x) => x.id === c) && !seen.has(c) && !!seen.add(c)) }));
  const rest = law.charges.map((c) => c.id).filter((c) => !seen.has(c));
  const open = (law.returns ?? []).find((r) => !r.charges) ?? RETURN_REST;
  return rest.length ? [...named, { ...open, charges: rest }] : named;
}

/** Every period of a year (as seconds from the world's start) and its months' starts, for a rule that spans `k` months. */
function periods(year: number, k: number): { from: number; to: number; lastMonth: number }[] {
  const out = [];
  for (let m = 0; m < MONTHS_A_YEAR; m += k) {
    const last = m + k - 1;
    out.push({ from: year * YEAR + m * MONTH, to: last === MONTHS_A_YEAR - 1 ? (year + 1) * YEAR : year * YEAR + (last + 1) * MONTH, lastMonth: year * YEAR + last * MONTH });
  }
  return out;
}

/**
 * The next return of a rule that falls due after the moment `after`: the period it reports and the day it is due
 * (the start of that day). Pure: the same law and day give the same answer to a payroll and to the books.
 */
export function nextReturn(rule: ReturnRule, after: number): ReturnDue {
  const k = rule.every_months ?? 1;
  const day = Math.min(30, Math.max(1, rule.day));
  const y0 = Math.max(0, Math.floor(after / YEAR) - 1);
  for (let y = y0; ; y++) {
    for (const p of periods(y, k)) {
      // (Following: from the first day of the month after the period, which is the next period's first day.)
      const base = rule.in === "same" ? p.lastMonth : p.to;
      const due = base + (day - 1) * DAY;
      if (due > after) return { rule, from: p.from, to: p.to, due };
    }
  }
}

/** The return of a rule that is due on the day `t` falls in, or the next, as the books look at it (a return due today is still to come). */
export const dueFrom = (rule: ReturnRule, t: number): ReturnDue => nextReturn(rule, Math.floor(t / DAY) * DAY - 1);

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;

/** A rule in words, as the law says it. */
export function returnRuleInWords(r: ReturnRule, charges: string): string {
  const every = r.every_months === undefined || r.every_months === 1 ? "each month" : r.every_months === 3 ? "each quarter" : `each ${r.every_months} months`;
  const when = r.in === "same" ? `by the ${ordinal(r.day)} day of the month the pay was made in (the last month of the period)` : `by the ${ordinal(r.day)} day of the month after`;
  return `${r.name ?? r.id}: ${charges} reported and paid over for ${every}, ${when}`;
}

/** What a month is, said once where the returns are. */
export const MONTH_WORDS = "A month here is 30 days counted from the year's first day, and the twelfth takes the last five days of the year.";
