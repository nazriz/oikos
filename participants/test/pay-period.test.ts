// Short of the next pay period (docs/behaviour/firms.md, credit.md): an employer lets the most recent hire go, and the
// next, until those it keeps can be paid; and nobody for want of a loan while a loan granted is on its way.
//
// Both were found in the 1,000-person town's logs (decisions log, 2026-10-08): a factory with the pay of 36 of its 40
// staff gave all 40 notice in 40 seconds, each act finding the same balance short for the same 40; and a shop signed
// for a loan and let someone go "with no loan to be had" two seconds before the bank paid it out.

import { expect, test } from "bun:test";

import { inCurrency } from "../src/money";
import { context, DAY, employment, signed, wake } from "./stepping";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";
import { engine } from "./engine";
const employer = engine("firm.employer");

inCurrency(PROFILE.values.currency);

const ME = "works";
const AS = { participant: "works-manager-system", position: "works-manager" };
const WAGE = 140_000;

/** An employer of five, woken at one moment after another (each act takes a moment) with `balance` in hand. */
function noticesGiven(balance: number, moments: number) {
  const m = employer.create(context(AS.participant, ME, { wage: WAGE, target_staff: 5 }, { position: AS.position }));
  const staff = [1, 2, 3, 4, 5].flatMap((n) => signed(employment(`job-${n}`, n, ME, `worker-${n}`, WAGE)));
  const books = { kind: "accounts", accounts: [{ account: "acc-works", holder: ME, custodian: "bank", currency: "AUD", balance: String(balance) }], transactions: [] };
  const given: string[] = [];
  const ids = { n: 0 };
  for (let i = 0; i < moments; i++) {
    const w = wake(m, 10 * DAY + i, { books, mine: { kind: "records", records: i === 0 ? staff : [] } }, { entity: ME, as: AS, ids });
    for (const c of w.said) if (c.fn === "agreement" && c.args.notice) given.push(c.args.notice);
  }
  return given;
}

test("short of a pay period for five, with the pay of three: the two most recent hires go, and no more however often it looks", () => {
  const given = noticesGiven(3 * WAGE + 1000, 12);
  expect(given).toEqual(["job-5", "job-4"]);
});

test("with the pay of all five, nobody goes; with the pay of none, all do", () => {
  expect(noticesGiven(5 * WAGE, 12)).toEqual([]);
  expect(noticesGiven(WAGE - 1, 12)).toEqual(["job-5", "job-4", "job-3", "job-2", "job-1"]);
});
