// Support payments, as the law that sets them out, the office that pays them and a claimant read them
// (docs/behaviour/boundary.md, "world.transfers"). A payment is a rule in three parts: who qualifies, how much, for how
// long. The law is a record its lawmaker publishes; nothing here holds any place's figures.

import type { StatementRecord } from "../contracts";
import { DAY, MONTH, type Book } from "./common";

/**
 * One payment of a support law. Sums are in the smallest unit of the world's money, for one payment (every
 * `every_days`), unless said otherwise.
 *
 * `who` (everything listed must hold):
 * - `from_age`, `to_age`: the claimant's age in years, both inclusive;
 * - `out_of_work`: it is for someone without work who is looking for it;
 * - `record`: contributions reported for the claimant to the payer (the employers' reports of a charge that names each
 *   worker): in at least `months` reports (one, if not said), within the last `within_months` (any time, if not said);
 * - `income_under`: the household's income for a month, as the claimant declares it, is under `amount` (for the whole
 *   household, or a head);
 * - `no_other_pension`: the claimant declares that nobody else pays them a pension, and the payer pays them no other
 *   payment for age;
 * - `children`: at least `least` children under `under_age` in the household, as declared.
 *
 * `amount`:
 * - `flat`: the same sum for everyone;
 * - `share_bps` of the claimant's previous pay for the same length of time (`of`: before or after what the tax law
 *   withholds), from the contributions record, no less than `least` and no more than `most` (one sum, or by age);
 *   `with_child_bps`: the share for a claimant who declares a child under 18 in the household;
 * - `household`: a sum for the household, with `per_member` for each of its members and `per_child` for each child under
 *   an age. One claim a household, by its head.
 *
 * `lasts` (not given: for as long as the claimant qualifies and claims): `days` from the day it is granted; `until_age`:
 * until the claimant reaches that age; `then`: the payment of this law that may be claimed when this one ends.
 */
export interface PaymentRule {
  id: string;
  name?: string;
  payer: string; // who pays (an entity)
  account: string; // and from which account
  every_days: number;
  who?: {
    from_age?: number;
    to_age?: number;
    out_of_work?: boolean;
    record?: { months?: number; within_months?: number };
    income_under?: { amount: number; per: "household" | "head" };
    no_other_pension?: boolean;
    children?: { least: number; under_age: number };
  };
  amount:
    | { flat: number }
    | { share_bps: number; with_child_bps?: number; of: "gross" | "net"; least?: number; most?: number | { from_age: number; amount: number }[] }
    | { household: number; per_member?: number; per_child?: { under_age: number; amount: number } };
  lasts?: { days?: number; until_age?: number; then?: string };
}

/** What a claimant declares on a claim, where the payment's rule asks: taken as stated by the office. */
export interface Declared {
  /** The household's income for a month, and how many live in it. */
  household_income?: number;
  household_members?: number;
  /** The dates of birth of the household's children. */
  children_born_at?: number[];
  /** Whether anyone else pays the claimant a pension. */
  other_pension?: boolean;
}

/** The support law in force that we've seen: the latest published and not withdrawn (none: no payments). */
export function supportLaw(book: Book): { id: string; payments: PaymentRule[] } | undefined {
  const laws = book.open("law").filter((r) => Array.isArray(r.data?.payments)).sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
  const l = laws[0];
  return l ? { id: l.id, payments: (l.data!.payments as PaymentRule[]).map((x) => ({ ...x, payer: x.payer ?? l.speaks_for! })) } : undefined;
}

/** A payment for those out of work (a stopgap while looking), as against one for age or for a household. */
export const forOutOfWork = (r: PaymentRule) => r.who?.out_of_work === true;
/** A payment made to a household, claimed by its head. */
export const forHousehold = (r: PaymentRule) => "household" in r.amount;
/** A payment for age: a pension. */
export const forAge = (r: PaymentRule) => !forOutOfWork(r) && !forHousehold(r) && r.who?.from_age !== undefined;

/** What a claim for this payment must declare (nothing: the rule asks for no declaration). */
export function declarationFor(r: PaymentRule, facts: { household_income: number; household_members: number; children_born_at: number[]; other_pension: boolean }): Declared | undefined {
  const d: Declared = {};
  if (r.who?.income_under) Object.assign(d, { household_income: facts.household_income, household_members: facts.household_members });
  if (forHousehold(r)) Object.assign(d, { household_members: facts.household_members });
  if (r.who?.children || ("household" in r.amount && r.amount.per_child) || ("share_bps" in r.amount && r.amount.with_child_bps !== undefined)) d.children_born_at = facts.children_born_at;
  if (r.who?.no_other_pension) d.other_pension = facts.other_pension;
  return Object.keys(d).length ? d : undefined;
}

/** A sum for one payment in words a law's text can carry. */
export function paymentsInWords(payments: PaymentRule[], written: (amount: number) => string, payer: (r: PaymentRule) => string = (r) => `${r.payer} from ${r.account}`): string {
  const pct = (bps: number) => `${bps / 100}%`;
  return payments.map((r) => {
    const w = r.who ?? {};
    const who = [
      w.from_age !== undefined && w.to_age !== undefined ? `aged ${w.from_age} to ${w.to_age}` : w.from_age !== undefined ? `aged ${w.from_age} or over` : w.to_age !== undefined ? `aged ${w.to_age} or under` : "",
      w.out_of_work ? "out of work and looking for it" : "",
      w.record ? `with contributions reported for them in at least ${w.record.months ?? 1} month${(w.record.months ?? 1) === 1 ? "" : "s"}${w.record.within_months ? ` of the last ${w.record.within_months}` : ""}` : "",
      w.income_under ? `whose household's income for a month is under ${written(w.income_under.amount)}${w.income_under.per === "head" ? " a head" : ""}` : "",
      w.no_other_pension ? "paid no other pension" : "",
      w.children ? `with at least ${w.children.least} child${w.children.least === 1 ? "" : "ren"} under ${w.children.under_age} in the household` : "",
    ].filter(Boolean).join(", ");
    const a = r.amount;
    const much = "flat" in a ? written(a.flat)
      : "share_bps" in a ? `${pct(a.share_bps)}${a.with_child_bps !== undefined ? ` (${pct(a.with_child_bps)} with a child)` : ""} of their previous pay${a.of === "net" ? " after what is withheld from it" : ""}${a.least !== undefined ? `, at least ${written(a.least)}` : ""}${a.most === undefined ? "" : typeof a.most === "number" ? `, at most ${written(a.most)}` : `, at most ${a.most.map((m) => `${written(m.amount)} from age ${m.from_age}`).join(", ")}`}`
      : `${written(a.household)} a household${a.per_member ? `, and ${written(a.per_member)} for each member` : ""}${a.per_child ? `, and ${written(a.per_child.amount)} for each child under ${a.per_child.under_age}` : ""}`;
    const long = r.lasts ? [r.lasts.days !== undefined ? `for ${r.lasts.days} days` : "", r.lasts.until_age !== undefined ? `until the age of ${r.lasts.until_age}` : "", r.lasts.then ? `after which ${payments.find((x) => x.id === r.lasts!.then)?.name ?? r.lasts.then} may be claimed` : ""].filter(Boolean).join(", ") : "";
    return `${r.name ?? r.id}: to a person ${who || "who claims it"}, ${much} every ${r.every_days} days${long ? `, ${long}` : ""}; paid by ${payer(r)}`;
  }).join(". ");
}

/** The age, in whole years, of someone born at `born_at`, at `t`. */
export const ageIn = (born_at: number, t: number, year: number) => Math.floor((t - born_at) / year);

/**
 * The age at which someone in the labour force stops work, from the share of people in the labour force by age
 * (`curve`: bands in order of age, the first the reference; docs/behaviour/citizen.md, "Stopping work"). Of those in
 * the labour force in the reference band, the share still in it in a later band is that band's share over the
 * reference's; a person is given one number (`draw`, of 10,000) and stops at the start of the first band whose share
 * of the reference is at or below it. `undefined`: never, by this curve.
 */
export function stopsWorkAt(curve: { from: number; bps: number }[], draw: number): number | undefined {
  const base = curve[0]?.bps ?? 0;
  if (base <= 0) return curve[0]?.from;
  let kept = 10_000;
  for (const b of curve.slice(1)) {
    // (A share that rises again with age brings nobody back: the share kept only falls.)
    kept = Math.min(kept, Math.floor((b.bps * 10_000) / base));
    if (draw >= kept) return b.from;
  }
  return undefined;
}

/**
 * What a claim for a payment comes to under its rule, on the facts the deciding office has: one function for the office that decides
 * and for the auditor that decides again from the file (docs/behaviour/auditor.md), so that "the law's conditions" is one reading.
 * `reported(since)`: the monthly pay reported for the claimant to the payer since a time, newest first; `paysOtherPension()`: whether the
 * payer pays the claimant another payment for age; `tax`: what the tax law withholds from a gross sum over so many seconds.
 */
export interface SupportFacts {
  year: number;
  reported: (since: number) => { at: number; gross: number }[];
  paysOtherPension: () => boolean;
  withheld: (gross: number, seconds: number) => number;
}
export type SupportDecision = { ok: true; amount: number; until?: number } | { ok: false; why?: string };
export function decideClaim(rule: PaymentRule | undefined, c: StatementRecord, t: number, facts: SupportFacts, usd: (cents: number) => string): SupportDecision {
  if (!rule || typeof c.data?.account !== "string" || !Number.isInteger(c.data?.born_at)) return { ok: false };
  const born = c.data.born_at as number;
  const age = Math.floor((t - born) / facts.year);
  const w = rule.who ?? {};
  const said: Declared = c.data?.declares ?? {};
  if (age < (w.from_age ?? -Infinity) || age > (w.to_age ?? Infinity)) return { ok: false };
  const members = Math.max(1, Math.floor(Number(said.household_members) || 1));
  const children = (under: number) => (Array.isArray(said.children_born_at) ? said.children_born_at : []).filter((b) => Number.isInteger(b) && Math.floor((t - b) / facts.year) < under).length;
  const record = w.record || "share_bps" in rule.amount ? facts.reported(w.record?.within_months ? t - w.record.within_months * MONTH : -Infinity) : [];
  if (w.record && record.length < (w.record.months ?? 1)) return { ok: false, why: `contributions are on our record for ${record.length} month${record.length === 1 ? "" : "s"}, and the payment asks for ${w.record.months ?? 1}` };
  if (w.income_under) {
    if (!Number.isInteger(said.household_income)) return { ok: false, why: "the claim doesn't state the household's income" };
    const income = w.income_under.per === "head" ? Math.floor(said.household_income! / members) : said.household_income!;
    if (income >= w.income_under.amount) return { ok: false, why: `the household's income as stated is not under ${usd(w.income_under.amount)}${w.income_under.per === "head" ? " a head" : ""}` };
  }
  if (w.no_other_pension) {
    if (said.other_pension !== false) return { ok: false, why: "the claim doesn't state that no other pension is paid" };
    if (facts.paysOtherPension()) return { ok: false, why: "we pay the claimant another pension" };
  }
  if (w.children && children(w.children.under_age) < w.children.least) return { ok: false, why: `the household as stated has fewer than ${w.children.least} child${w.children.least === 1 ? "" : "ren"} under ${w.children.under_age}` };
  const a = rule.amount;
  let amount: number;
  if ("flat" in a) amount = a.flat;
  else if ("share_bps" in a) {
    // Their previous pay for as long as one payment covers: the mean of the monthly pay reported for them (the last
    // twelve reports at most), before or after what the tax law withholds from such a pay.
    const last = record.slice(0, 12);
    if (!last.length) return { ok: false, why: "no pay is on our record for the claimant" };
    const gross = Math.floor((last.reduce((x, l) => x + l.gross, 0) / last.length) * rule.every_days / 30);
    const pay = a.of === "net" ? gross - facts.withheld(gross, rule.every_days * DAY) : gross;
    const most = a.most === undefined ? Infinity : typeof a.most === "number" ? a.most : [...a.most].sort((x, y) => y.from_age - x.from_age).find((b) => b.from_age <= age)?.amount ?? Infinity;
    amount = Math.min(most, Math.max(a.least ?? 0, Math.floor((pay * (a.with_child_bps !== undefined && children(18) > 0 ? a.with_child_bps : a.share_bps)) / 10_000)));
  } else amount = a.household + (a.per_member ?? 0) * members + (a.per_child ? a.per_child.amount * children(a.per_child.under_age) : 0);
  if (!(amount > 0)) return { ok: false, why: "the payment comes to nothing" };
  const ends = [rule.lasts?.days !== undefined ? t + rule.lasts.days * DAY : Infinity, rule.lasts?.until_age !== undefined ? born + rule.lasts.until_age * facts.year : Infinity];
  const until = Math.min(...ends);
  return { ok: true, amount, ...(until < Infinity ? { until } : {}) };
}
