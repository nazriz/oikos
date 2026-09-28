// Money on the wire (contracts v0.5, D58): an exact integer in the smallest unit of its account's currency (cents,
// for a currency with two decimal places), written as a decimal string, so a world's amounts aren't limited by JSON's 2^53. Code does its arithmetic in
// ordinary numbers, which are exact up to 2^53 (about $90 trillion in cents): `cents` converts at the edge and throws
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

/** Money as people write it ("$1,234.56"), exact at any size: an amount on the wire, or a number of cents. */
export function formatMoney(a: Amount | number | bigint): string {
  const v = BigInt(a);
  const c = v < 0n ? -v : v;
  return `${v < 0n ? "-" : ""}$${(c / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${(c % 100n).toString().padStart(2, "0")}`;
}
