// Money on the wire (contracts v0.5, D58): an exact integer in the smallest unit of its account's currency, written
// as a decimal string, so a world's amounts aren't limited by JSON's 2^53. Code does its arithmetic in ordinary
// numbers, which are exact up to 2^53 (about 90 trillion units of a currency with two decimal places): `cents`
// converts at the edge and throws
// beyond that rather than rounding. A module that ever needs more would work in bigint.

/** An amount or balance as the contracts write it: a decimal-string integer. */
export type Amount = string;

/** An amount as a number, for arithmetic. Exact, or an error: never rounded. Accepts a number too (content data may hold one). */
export function cents(a: Amount | number | null | undefined): number {
  if (a === null || a === undefined) return 0;
  if (typeof a === "number") {
    if (!Number.isSafeInteger(a)) throw new Error(`not an exact amount: ${a}`);
    return a;
  }
  if (!/^(0|-?[1-9][0-9]{0,37})$/.test(a)) throw new Error(`not an amount: ${JSON.stringify(a)}`);
  const n = Number(a);
  if (!Number.isSafeInteger(n)) throw new Error(`amount ${a} is beyond 2^53: exact on the wire, but too large for this code's arithmetic`);
  return n;
}

/** A number of cents as the contracts write it. */
export function amount(n: number | bigint): Amount {
  if (typeof n === "number" && !Number.isSafeInteger(n)) throw new Error(`not an exact amount: ${n}`);
  return String(n);
}

/**
 * How a world's money is written (its config's `world.currencies` entry): the sign or code before an amount (or after
 * it), the words after it, how many decimal places its smallest unit is, and how its place writes numbers: the
 * decimal mark, the mark and size of groups of digits, a space beside the sign, the words for large numbers. The
 * platform has none of its own: every amount in words is read and written in a currency the world declares.
 */
export interface Currency {
  code: string;
  /** Decimal places of its smallest unit. */
  minor_units: number;
  /** The sign written before an amount; absent: its code. */
  symbol?: string;
  /** The words written after an amount for its unit. */
  unit_words?: string[];
  /** The words for its smallest unit; the first is the singular. */
  minor_words?: string[];
  /** The mark written before the decimals. Absent: a point, unless the group mark is a point (then a comma). */
  decimal_mark?: string;
  /** The mark written between groups of digits (a space may be a no-break one; an apostrophe straight or curly).
   * Absent: a comma, or a point where the decimal mark is a comma. */
  group_mark?: string;
  /** Digits in threes ([3]) or the last three and then twos ([3, 2]). Absent: threes written; threes read, and twos
   * too where the group mark is a comma. */
  grouping?: number[];
  /** The sign (or code) is written after the digits. */
  symbol_after?: boolean;
  /** A space stands between the sign and the digits (a code is always set off by one). */
  symbol_spaced?: boolean;
  /** The words its place writes for large numbers, in lower case, with their values: read, never written. */
  number_words?: { [word: string]: number };
}

/** The decimal mark and group mark a currency writes with. */
export function marksOf(cur: Currency): { decimal: string; group: string } {
  const decimal = cur.decimal_mark ?? (cur.group_mark === "." ? "," : ".");
  return { decimal, group: cur.group_mark ?? (decimal === "," ? "." : ",") };
}

/** Whole digits grouped as the currency groups them (in threes unless it says [3, 2]), with its group mark. */
export function groupDigits(whole: string, cur: Currency): string {
  const { group } = marksOf(cur);
  const second = cur.grouping?.[1] ?? 3;
  let out = "";
  for (let i = 0; i < whole.length; i++) {
    const fromRight = whole.length - i;
    if (i > 0 && (fromRight === 3 || (fromRight > 3 && (fromRight - 3) % second === 0))) out += group;
    out += whole[i];
  }
  return out;
}

/** An amount in the currency's smallest unit as people write it: its sign (or its code and a space) before the digits
 * or, where the currency says so, after them; the whole units grouped as the currency groups them (in threes unless it
 * says [3, 2]) with its group mark; its decimals after its decimal mark (left off with `decimals: false`: whole units,
 * for a round figure). Exact at any size. (The kernel's resolver writes the same: `format_money`.) */
export function formatMoney(a: Amount | number | bigint, cur: Currency, o: { decimals?: boolean } = {}): string {
  const v = BigInt(a);
  const c = v < 0n ? -v : v;
  const per = 10n ** BigInt(cur.minor_units);
  const { decimal } = marksOf(cur);
  const whole = groupDigits((c / per).toString(), cur);
  let number = whole;
  if (cur.minor_units > 0 && o.decimals !== false) number += `${decimal}${(c % per).toString().padStart(cur.minor_units, "0")}`;
  // (A code, being letters, is always set off from the digits.)
  const sign = cur.symbol ?? cur.code;
  const gap = cur.symbol === undefined || cur.symbol_spaced ? " " : "";
  return `${v < 0n ? "-" : ""}${cur.symbol_after ? `${number}${gap}${sign}` : `${sign}${gap}${number}`}`;
}

// The money of the world a participant is in, while it takes its step. A code participant's rules write amounts in
// many places (reasons, letters, calls); rather than hand the currency to each, whoever steps a participant says whose
// world it's in first (`inCurrency`: the run, from the world's config), and the rules' words read it. A step is
// synchronous, so two worlds in one process can't cross. Nothing is assumed: wording an amount with no world's money
// set is an error.
let current: Currency | undefined;

/** Say which world's money amounts are worded in from here on (a world's config: its first currency). */
export function inCurrency(cur: Currency | undefined): void {
  current = cur;
}

/** The money of the world now being stepped. */
export function currencyNow(): Currency {
  if (!current) throw new Error("no world's money has been set: say which with inCurrency(config.world.currencies[0]) before wording an amount");
  return current;
}

/** An amount as people in the world now being stepped write it. */
export const moneyNow = (a: Amount | number | bigint): string => formatMoney(a, currencyNow());

/**
 * An amount counted out in the currency's smallest unit, by its name ("1500 cents", where the smallest unit is the
 * cent), as a ledger or a posted notice gives a figure; a currency whose smallest unit has no name is written as its
 * money is. (The plural is the last of the currency's `minor_words`.)
 */
export function inSmallest(a: Amount | number | bigint, cur: Currency): string {
  const words = cur.minor_words ?? [];
  return words.length ? `${a} ${words[words.length - 1]}` : formatMoney(a, cur);
}

