// Lengnick (2013), shared by the firms that follow it (firm.producer, firm.retailer): its parameters at the paper's
// Table 1 calibration, its price rule, and paying out what a firm holds beyond its buffer. Documented in
// docs/behaviour/producer.md and docs/behaviour/retailer.md.
//
// Lengnick, M. (2013), Agent-based macroeconomics: a baseline model. Journal of Economic Behavior & Organization 86,
// 102-120.

import type { Rng } from "../rng";
import { because, type Book, pay, say, type Step, usd } from "./common";

/** Table 1, as basis points of 1 (and months). */
export const LENGNICK = {
  phi_low_bps: 2500, // hire (or restock) when stock is below this share of last month's demand
  phi_high_bps: 10_000, // let one go when it's above this
  delta_bps: 190, // wage steps: up to 1.9%
  gamma_months: 24, // months fully staffed before the wage offered falls
  price_up_bound_bps: 11_500, // raise the price only while it's below 1.15 x marginal cost
  price_down_bound_bps: 10_250, // lower it only while it's above 1.025 x marginal cost
  theta_bps: 7500, // the chance a price change is made
  vartheta_bps: 200, // price steps: up to 2%
  chi_bps: 1000, // the liquidity buffer, as a share of the monthly wage bill
};
export type LengnickParams = typeof LENGNICK;

/**
 * The price rule: with stock low against last month's demand and the price under its upper bound over marginal cost,
 * raise it (with probability theta, by up to vartheta); with stock high and the price over its lower bound, cut it.
 * Returns the new price and, if it changed, why.
 */
export function movePrice(p: LengnickParams, rng: Rng, price: number, stock: number, demand: number, marginalCost: number): { price: number; why?: string } {
  const low = stock * 10_000 < p.phi_low_bps * demand;
  const high = stock * 10_000 > p.phi_high_bps * demand;
  if (low && price * 10_000 < p.price_up_bound_bps * marginalCost && rng.below(10_000) < p.theta_bps) {
    const up = rng.below(p.vartheta_bps + 1);
    const next = Math.ceil((price * (10_000 + up)) / 10_000);
    return { price: next, why: `Month's end: stock (${stock}) is low against last month's demand (${demand}), and our price is under ${p.price_up_bound_bps / 100}% of marginal cost (${usd(marginalCost)}): raising it ${up / 100}% to ${usd(next)}.` };
  }
  if (high && price * 10_000 > p.price_down_bound_bps * marginalCost && rng.below(10_000) < p.theta_bps) {
    const down = rng.below(p.vartheta_bps + 1);
    const next = Math.max(1, Math.floor((price * (10_000 - down)) / 10_000));
    return { price: next, why: `Month's end: stock (${stock}) is high against last month's demand (${demand}), and our price is over ${p.price_down_bound_bps / 100}% of marginal cost (${usd(marginalCost)}): cutting it ${down / 100}% to ${usd(next)}.` };
  }
  return { price };
}

/**
 * The wage rule: a job posting that has stood unfilled for a month raises the wage offered by up to delta; `fullMonths`
 * in a row with every position filled (gamma) lowers it by up to delta. Returns the new wage, the months fully staffed
 * so far, and why, if it changed.
 */
export function moveWage(p: LengnickParams, rng: Rng, wage: number, o: { unfilled: boolean; posting: boolean; staffed: boolean; fullMonths: number }): { wage: number; fullMonths: number; why?: string } {
  if (o.unfilled) {
    const up = rng.below(p.delta_bps + 1);
    const next = Math.floor((wage * (10_000 + up)) / 10_000);
    return { wage: next, fullMonths: 0, why: `a job we posted has gone unfilled for a month: offering ${up / 100}% more (${usd(next)} a fortnight)` };
  }
  if (!o.posting && o.staffed) {
    if (o.fullMonths + 1 >= p.gamma_months) {
      const down = rng.below(p.delta_bps + 1);
      const next = Math.floor((wage * (10_000 - down)) / 10_000);
      return { wage: next, fullMonths: 0, why: `fully staffed for ${p.gamma_months} months: offering ${down / 100}% less to new hires (${usd(next)} a fortnight)` };
    }
    return { wage, fullMonths: o.fullMonths + 1 };
  }
  return { wage, fullMonths: o.fullMonths };
}

/** A firm's shareholders, from its register (the latest `shareholders` statement it keeps). */
export function shareholders(book: Book, firm: string): { holder: string; account: string; shares: number }[] {
  return (book.open("shareholders").filter((r) => r.speaks_for === firm).sort((a, b) => b.at - a.at)[0]?.data?.holders ?? []) as { holder: string; account: string; shares: number }[];
}

/**
 * Paying out, at the month's end: out of what the month earned (what came in beyond what went out), what's held
 * beyond the buffer, to the shareholders by their shares, in batches (a program has at most 32 lines). Returns the
 * steps and what was paid.
 */
export function payOut(book: Book, firm: string, account: string, balance: number, buffer: number, earned: number, why: string): { steps: Step[]; paid: number } {
  const surplus = Math.min(balance - buffer, earned);
  if (surplus <= 0) return { steps: [], paid: 0 };
  return distribute(book, firm, account, surplus, `Month's end: we took in ${usd(earned)} more than we paid out this month, and hold ${usd(balance)} against a buffer of ${usd(buffer)} (${why}): paying ${usd(surplus)} to our shareholders by their shares`);
}

/** Paying an amount to a firm's shareholders by their shares, in batches (a program has at most 32 lines). */
export function distribute(book: Book, firm: string, account: string, amount: number, why: string, bankOf = "bank"): { steps: Step[]; paid: number } {
  const holders = shareholders(book, firm);
  const total = holders.reduce((x, h) => x + h.shares, 0);
  if (amount <= 0 || total <= 0) return { steps: [], paid: 0 };
  const lines = holders.map((h) => [h, Math.floor((amount * h.shares) / total)] as const).filter(([, x]) => x > 0);
  if (!lines.length) return { steps: [], paid: 0 };
  // One instruction to the bank for them all, as a share registry pays a dividend (docs/behaviour/bank-payment-system.md).
  const steps: Step[] = [because(`${why} (${lines.length} payment${lines.length > 1 ? "s" : ""}, in one instruction to the bank).`,
    say("request", `Please pay this dividend from ${account}: ${lines.length} payments.`, { to: [bankOf], data: { from: account, payments: lines.map(([h, x]) => ({ to: h.account, amount: String(x), for: "Dividend." })) } }))];
  return { steps, paid: lines.reduce((x, [, y]) => x + y, 0) };
}
