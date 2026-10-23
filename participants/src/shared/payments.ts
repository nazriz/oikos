// Support payments, as the law that sets them out, the office that pays them and a claimant read them
// (docs/behaviour/boundary.md, "world.transfers"). A payment is a rule in three parts: who qualifies, how much, for how
// long. The law is a record its lawmaker publishes; nothing here holds any place's figures.


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
