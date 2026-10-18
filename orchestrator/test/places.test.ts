// A town from any place's profile (docs/profiles.md): what the generator derives is derived the same for every
// place, and nothing in a generated town is one place's assumption. Checked on the worlds as generated, for every
// profile in worlds/profiles; the towns that are simulated are in places-run.test.ts.
//
// What each test guards, and what it was found by (2026-10-08, when eight more places were first generated):
//   - a firm's opening money is its working capital, not a stated sum (a stated sum that didn't fit a place's wages
//     left its factories unable to pay them within weeks);
//   - an hour's pay is a pay period's pay over the hours worked in it (the hours were a fixed day whatever the
//     profile's week, so a firm's labour cost was not the share of output its profile gave);
//   - an item of goods is a unit, and its size changes nothing but whole-number rounding, which is checked;
//   - money is written as the world's currency is, whatever its decimal places;
//   - the election law says what the profile's elections say;
//   - an institution a place doesn't have is absent, not present with a figure of nought;
//   - the pay period is the profile's.

import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { bedroomsNeeded, calls, chargesOn, formatMoney, OCCUPANCY, type OccupancyStandard } from "@oikos/participants";
import { generate, generateFrom } from "@oikos/worlds/generator/generate";
import { loadProfile, PROFILE_DIR, type Profile } from "@oikos/worlds/generator/profile";
import { officeAt, officeBy, officesBy } from "./lib/offices";

const root = join(import.meta.dir, "../..");
const DAY = 86_400, HOUR = 3600, MONTH = 30 * DAY;
const spec = { ...(Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any), citizens: 300 };
const ids = readdirSync(PROFILE_DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort();
const copy = (id: string): Profile => structuredClone(loadProfile(id));
/** Each profile's town, generated once. */
const towns = new Map<string, any>();
const town = (id: string) => towns.get(id) ?? (towns.set(id, generate({ ...spec, profile: id })), towns.get(id));
/** (Generating nine towns takes longer than a test's usual five seconds on a busy machine.) */
const SLOW = 120_000;

/** What a generated town's firms were given, read from the world itself. */
function firms(c: any) {
  const params = (impl: string) => officesBy(c, impl).map((o) => ({ entity: o.entity, ...o.params }));
  const staff = new Map<string, number>();
  for (const r of c.world.records) if (r.record === "agreement" && r.terms.template === "employment") staff.set(r.terms.parties[0], (staff.get(r.terms.parties[0]) ?? 0) + 1);
  const balance = (entity: string) => Number(c.world.accounts.find((a: any) => a.holder === entity).balance);
  const trade = officeBy(c, "world.trade").params;
  return { factories: params("firm.producer"), shops: params("firm.retailer"), staff, balance, trade };
}

test("a factory starts with the money to pay its staff and buy its inputs until its first sales, in every place", () => {
  for (const id of ids) {
    const f = firms(town(id));
    expect(f.factories.length).toBeGreaterThan(0);
    for (const x of f.factories) {
      // (One that starts with no staff has one worker's working capital: it can take a first one on.)
      const n = f.staff.get(x.entity) ?? 1;
      const monthly = Math.floor((n * x.working_day * x.work_days * 30) / 7 / x.labour_per_unit);
      const inputs = monthly * x.per_unit.inputs * f.trade.sells.inputs;
      const wages = (n * x.wage * MONTH) / x.period;
      // Its own rules: it orders up to half a month's inputs as soon as it has used any, and lets staff go when it
      // can't cover the next pay period. Both must be within what it starts with, with a month's wages to spare.
      expect({ id, firm: x.entity, enough: f.balance(x.entity) >= inputs / 2 + wages }).toEqual({ id, firm: x.entity, enough: true });
      // And it is its working capital, nothing a profile states: a month's wages and a month's inputs.
      expect(Math.abs(f.balance(x.entity) - (Math.floor(wages) + inputs))).toBeLessThanOrEqual(1);
    }
  }
}, SLOW);

test("a profile that states a firm's opening money is refused, saying why", () => {
  for (const k of ["factory", "shop"]) {
    const P = copy("au-vic-2026");
    (P.values.opening as any)[k] = 40_000_000;
    expect(() => generateFrom(spec, P)).toThrow(new RegExp(`opening\\.${k} is stated.*working capital`));
  }
}, SLOW);

test("an hour's work costs a firm what its profile's labour share says, whatever the place's working week and pay period", () => {
  for (const id of ids) {
    const P = loadProfile(id);
    const f = firms(town(id));
    const x = f.factories[0]!, s = f.shops[0]!;
    // The working day is the profile's week over the days worked; what an item's labour costs is the wage for the
    // time it takes, at the hours a pay period's wage is for.
    expect(x.working_day * x.work_days).toBe(P.values.ordinary_hours_per_week * HOUR);
    const hoursPaid = (x.working_day * x.work_days * (x.period / DAY)) / 7;
    const labourShare = ((x.wage / hoursPaid) * x.labour_per_unit) / x.price;
    expect(Math.abs(labourShare * 10_000 - P.values.industry.factory_labour_share_bps)).toBeLessThan(0.02 * P.values.industry.factory_labour_share_bps);
    const serveShare = ((s.wage / ((s.working_day * x.work_days * (s.period / DAY)) / 7)) * s.serve_labour) / s.price;
    expect(Math.abs(serveShare * 10_000 - P.values.industry.retail_labour_share_bps)).toBeLessThan(0.02 * P.values.industry.retail_labour_share_bps);
    // And an item's inputs cost the profile's input share, to the rounding the unit check allows.
    const inputShare = (x.per_unit.inputs * f.trade.sells.inputs) / x.price;
    expect(Math.abs(inputShare * 10_000 - P.values.industry.factory_input_share_bps)).toBeLessThanOrEqual(0.05 * P.values.industry.factory_input_share_bps);
  }
}, SLOW);

test("the size of an item of goods is a unit: twice the price, half the items, the same money and the same staff", () => {
  const one = copy("au-vic-2026"), two = copy("au-vic-2026");
  two.values.prices.goods_world = 2 * one.values.prices.goods_world!;
  const a = firms(generateFrom(spec, one)), b = firms(generateFrom(spec, two));
  const near = (x: number, y: number) => expect(Math.abs(x - y)).toBeLessThanOrEqual(0.02 * Math.max(x, y));
  expect(b.factories[0]!.price).toBe(2 * a.factories[0]!.price);
  near(b.factories[0]!.labour_per_unit, 2 * a.factories[0]!.labour_per_unit);
  a.factories.forEach((x: any, i: number) => near(a.balance(x.entity), b.balance(b.factories[i]!.entity)));
  a.shops.forEach((x: any, i: number) => {
    near(a.balance(x.entity), b.balance(b.shops[i]!.entity));
    expect(b.staff.get(b.shops[i]!.entity)).toBe(a.staff.get(x.entity));
    near(x.demand * x.price, b.shops[i]!.demand * b.shops[i]!.price);
  });
  near(a.trade.buys.goods.per_month * a.trade.buys.goods.unit_price, b.trade.buys.goods.per_month * b.trade.buys.goods.unit_price);
}, SLOW);

test("left out, an item of goods is half an hour of factory work; stated too small or too large, the profile is refused", () => {
  const P = copy("de-ni-2026");
  delete P.values.prices.goods_world;
  const f = firms(generateFrom(spec, P));
  expect(Math.abs(f.factories[0]!.labour_per_unit - HOUR / 2)).toBeLessThanOrEqual(1);
  // Too small: an item's inputs are a fraction of a unit, which no whole number is near.
  const small = copy("de-ni-2026");
  small.values.prices.goods_world = 100;
  expect(() => generateFrom(spec, small)).toThrow(/too small a unit.*prices\.goods_world/);
  // Too large: an item takes more than a working day.
  const large = copy("de-ni-2026");
  large.values.prices.goods_world = 100 * P.values.wages_per_pay_period.factory;
  expect(() => generateFrom(spec, large)).toThrow(/too large a unit.*prices\.goods_world/);
}, SLOW);

test("money in a generated town's laws and papers is written as its currency is, whatever its decimal places", () => {
  for (const id of ids) {
    const P = loadProfile(id);
    const cur = P.values.currency;
    const c = town(id);
    const whole = (n: number) => formatMoney(n, cur, cur.minor_units && n % 10 ** cur.minor_units === 0 ? { decimals: false } : {});
    const tax = c.world.records.find((r: any) => r.id === "law-income-tax");
    for (const c of P.values.public_finance.income_tax.charges) {
      if (c.schedule.length > 1) for (const b of c.schedule) if (b.from > 0) expect(tax.text).toContain(`above ${whole(b.from)}`); // (the first band is said by where it ends)
      if (c.base?.from) expect(tax.text).toContain(`from ${whole(c.base.from)}`);
      if (c.base?.up_to !== undefined) expect(tax.text).toContain(`up to ${whole(c.base.up_to)}`);
    }
    // A mortgage's words give its sums as money (a home loan agreed before the start).
    for (const loan of c.world.records.filter((r: any) => r.record === "agreement" && r.terms.template === "loan")) {
      const [lends, repays] = loan.terms.commitments.map((k: any) => Number(k.does.outcome.money.amount));
      expect(loan.terms.text).toContain(`lent ${loan.terms.parties[1]} ${whole(lends)} for`);
      expect(loan.terms.text).toContain(`repays ${whole(repays)} a month`);
    }
    // The finance office's brief gives the crew's yearly wage in whole units of the money.
    const finance = officeBy(c, "city.finance_officer").params;
    // (The figure is a sum in whole units, written as the place writes it: it reads back in the place's money to whole units.)
    const figure = /about (.+?) a year each/.exec(finance.budget_lines.staff)?.[1];
    expect(figure).toBeDefined();
    const staff = BigInt(calls.parseAmount(figure!, cur));
    expect([staff % 10n ** BigInt(cur.minor_units), formatMoney(staff, cur, { decimals: false })]).toEqual([0n, figure!]);
  }
  // (A currency with no decimal places is among them.)
  expect(ids.map((id) => loadProfile(id).values.currency.minor_units)).toContain(0);
}, SLOW);

test("the election law says what the profile's elections say: electors must vote only where the law there compels it", () => {
  const seen = new Set<boolean>();
  for (const id of ids) {
    const E = loadProfile(id).values.elections;
    if (!E) continue;
    seen.add(E.compulsory_voting);
    const law = town(id).world.records.find((r: any) => r.id === "law-elections");
    expect(law.adico.deontic).toBe(E.compulsory_voting ? "must" : "may");
    expect(law.text).toContain(E.compulsory_voting ? "must enrol and vote" : "may enrol and vote");
    expect(law.text).toContain(`every ${E.term_years} years`);
  }
  expect([...seen].sort()).toEqual([false, true]);
}, SLOW);

test("an institution a place doesn't have is absent from its town: no payment, levy, buffer or law with a figure of nought", () => {
  const P = copy("au-vic-2026");
  P.values.support.payments = P.values.support.payments.filter((r) => !r.who?.out_of_work);
  delete P.values.services.landfill_levy_per_tonne;
  delete P.values.credit.serviceability_buffer_bps;
  delete P.values.tenancy.rent_review_months;
  delete P.values.tenancy.rent_increase_notice_days;
  delete P.values.industrial_action.ballot_turnout_bps;
  delete P.values.industrial_action.ballot_pass_bps;
  delete P.values.industrial_action.notice_days;
  delete P.values.retirement_fund;
  const c = generateFrom(spec, P);
  const of = (impl: string) => officeBy(c, impl).params;
  // No payment to the unemployed: none paid, none claimed, none counted.
  expect(c.world.records.find((r: any) => r.id === "law-support").data.payments.map((r: any) => r.id)).toEqual(["pension"]);
  expect(of("world.migration").jobseekers_payment).toBeUndefined();
  // No landfill charge: no budget line for it, and the landfill is told no price.
  expect(of("world.disposal").price_per_tonne).toBeUndefined();
  expect(Object.keys(of("city.finance_officer").budget_lines)).not.toContain("services");
  expect(of("city.mayor_code").services_budget).toBe(0);
  // No buffer in the bank's assessment.
  expect(of("bank.lending").buffer_bps).toBe(0);
  // No law on rent increases or on industrial action, and no schedule for a law the town doesn't have.
  const laws = c.world.records.filter((r: any) => r.kind === "law").map((r: any) => r.id);
  expect(laws).not.toContain("law-rent-increases");
  expect(laws).not.toContain("law-industrial-action");
  expect(of("firm.landlord").rent_review_months).toBeNull();
  // (The schedules and their forms are there all the same: a council can make the law its town does not have.)
  expect(c.world.records.some((r: any) => r.id === "form-amend-industrial-action")).toBe(true);
  // No retirement fund.
  expect(c.world.entities.some((e: any) => e.kind === "retirement_fund")).toBe(false);
  expect(() => generateFrom({ ...spec, retirement_fund: true }, P)).toThrow(/retirement fund/);

  // Landlords without a law still review rents, where the profile says how often they do.
  const Q = copy("au-vic-2026");
  delete Q.values.tenancy.rent_review_months;
  delete Q.values.tenancy.rent_increase_notice_days;
  Q.values.tenancy.rent_review_practice_months = 12;
  const q = generateFrom(spec, Q);
  expect(officeBy(q, "firm.landlord").params.rent_review_months).toBe(12);
  expect(q.world.records.some((r: any) => r.id === "law-rent-increases")).toBe(false);

  // Notice of industrial action without a ballot: a law of the notice alone, with its schedule and amendment form.
  const N = copy("au-vic-2026");
  delete N.values.industrial_action.ballot_turnout_bps;
  delete N.values.industrial_action.ballot_pass_bps;
  N.values.industrial_action.notice_days = 14;
  const n = generateFrom(spec, N);
  const law = n.world.records.find((r: any) => r.id === "law-industrial-action");
  expect(law.data).toEqual({ schedule: "schedule-industrial-action", figures: { notice: { value: 14 * DAY, unit: "seconds" } } });
  expect(law.text).toBe("Industrial action is protected only where each of these holds. The employer has had written notice of it of at least 14 days.");
  expect(law.formal.condition).toBe(`block.block == 'publish' && block.kind == 'industrial_action' && (block.data.from - now < ${14 * DAY})`);

  // The reverse, a ballot and no notice: the ballot's two requirements, and nothing of notice.
  const B = copy("au-vic-2026");
  delete B.values.industrial_action.notice_days;
  const ballotOnly = generateFrom(spec, B).world.records.find((r: any) => r.id === "law-industrial-action");
  // (As a set: on the Rust world the law is drafted by the shared rule in Rust, whose maps are in key order; a JSON
  // object's key order is never relied on: docs/port-guide.md section 2. 2026-10-18, integration.)
  expect(Object.keys(ballotOnly.data.figures).sort()).toEqual(["majority", "turnout"]);
  expect(ballotOnly.text).toBe("Industrial action is protected only where each of these holds. At least 50% of the members concerned have voted in a ballot on it. More than 50% of the votes in a ballot of the members concerned are for it.");
  expect(ballotOnly.formal.condition).toBe("block.block == 'publish' && block.kind == 'industrial_action' && (block.data.voted * 10000 < 5000 * block.data.eligible || block.data.yes * 10000 <= 5000 * block.data.voted)");
  // A figure still stated as nought is taken as not stated: the law says nothing of it, and with nothing but noughts there is no law.
  const Z = copy("au-vic-2026");
  Object.assign(Z.values.industrial_action, { ballot_turnout_bps: 0, notice_days: 0 });
  const majorityOnly = generateFrom(spec, Z).world.records.find((r: any) => r.id === "law-industrial-action");
  expect(majorityOnly.text).toBe("Industrial action is protected only where each of these holds. More than 50% of the votes in a ballot of the members concerned are for it.");
  Object.assign(Z.values.industrial_action, { ballot_pass_bps: 0 });
  expect(generateFrom(spec, Z).world.records.some((r: any) => r.id === "law-industrial-action")).toBe(false);
  // No interest on overdue rates: the rating law has no "or else", and carries no rate of interest.
  const R = copy("au-vic-2026");
  delete R.values.public_finance.rates_penalty_interest_bps;
  const rates = generateFrom(spec, R).world.records.find((r: any) => r.id === "law-rates");
  expect(rates.text).not.toContain("interest");
  expect(rates.adico.or_else).toBeUndefined();
  expect("penalty_interest_bps" in rates.data).toBe(false);

  // In the profiles as they stand: no figure of nought stands for a rule a place does not have, and no town's law
  // states a nought, a duration in seconds or a share in basis points.
  for (const id of ids) {
    const V = loadProfile(id).values as any;
    for (const [what, v] of Object.entries({ levy: V.services.landfill_levy_per_tonne, buffer: V.credit.serviceability_buffer_bps, turnout: V.industrial_action.ballot_turnout_bps, majority: V.industrial_action.ballot_pass_bps,
      notice: V.industrial_action.notice_days, review: V.tenancy.rent_review_months, rent_notice: V.tenancy.rent_increase_notice_days, interest: V.public_finance.rates_penalty_interest_bps })) expect({ id, what, v }).not.toEqual({ id, what, v: 0 });
    for (const r of town(id).world.records.filter((x: any) => x.kind === "law")) for (const words of [r.text, ...Object.values(r.adico ?? {})] as string[]) {
      expect({ id, law: r.id, words }).not.toEqual({ id, law: r.id, words: expect.stringMatching(/\b0 (seconds?|minutes?|hours?|days?|weeks?|months?|years?)\b|(?<![\d.,])0%|\bseconds?\b|basis points|\bbps\b|above [^\d]{0,4}0(?![\d.,])/) });
    }
  }
}, SLOW);

test("wages are paid on the profile's pay period: a month's pay monthly makes the same town as a fortnight's fortnightly", () => {
  const fortnightly = copy("au-vic-2026"), monthly = copy("au-vic-2026");
  expect(fortnightly.values.pay_period_days).toBe(14);
  const restate = (w: number) => Math.round((w * 30) / 14);
  monthly.values.pay_period_days = 30;
  for (const k of ["shop", "factory", "construction"] as const) monthly.values.wages_per_pay_period[k] = restate(monthly.values.wages_per_pay_period[k]);
  monthly.values.health!.doctor_wage_per_pay_period = restate(monthly.values.health!.doctor_wage_per_pay_period);
  monthly.values.education!.teacher_wage_per_pay_period = restate(monthly.values.education!.teacher_wage_per_pay_period);
  monthly.values.crime!.officer_wage_per_pay_period = restate(monthly.values.crime!.officer_wage_per_pay_period);
  const a = generateFrom(spec, fortnightly), b = generateFrom(spec, monthly);
  const jobs = (c: any) => c.world.records.filter((r: any) => r.record === "agreement" && r.terms.template === "employment");
  expect(jobs(b).length).toBe(jobs(a).length);
  for (const j of jobs(b)) expect(j.terms.commitments[0].every).toBe(30 * DAY);
  for (const j of jobs(a)) expect(j.terms.commitments[0].every).toBe(14 * DAY);
  // Every standing order for wages is on the period, with its first payment inside the first one.
  for (const [c, days] of [[a, 14], [b, 30]] as const) for (const r of c.world.records.filter((r: any) => /^job-.*-wages$/.test(r.id))) {
    expect(r.data.every).toBe(days * DAY);
    expect(r.data.first).toBeGreaterThanOrEqual(DAY);
    expect(r.data.first).toBeLessThanOrEqual(days * DAY);
    expect(r.text).toContain(`every ${days} days`);
  }
  // Every employer's module is told the period; none is left on a default.
  for (const [c, days] of [[a, 14], [b, 30]] as const) for (const p of [...c.participants.map((x: any) => x.controller), ...c.positions.map((x: any) => x.role_module && { params: x.role_module.params })]) if (p?.params?.wage !== undefined && p?.params?.period !== undefined) expect(p.params.period).toBe(days * DAY);
  // The same work for the same money: an item takes the same time, firms start with the same staff and (to rounding) money.
  const fa = firms(a), fb = firms(b);
  expect(Math.abs(fb.factories[0]!.labour_per_unit - fa.factories[0]!.labour_per_unit)).toBeLessThanOrEqual(1);
  expect(Math.abs(fb.shops[0]!.serve_labour - fa.shops[0]!.serve_labour)).toBeLessThanOrEqual(1);
  expect([...fb.staff]).toEqual([...fa.staff]);
  for (const x of fa.factories) expect(Math.abs(fb.balance(x.entity) - fa.balance(x.entity))).toBeLessThan(0.001 * fa.balance(x.entity));
}, SLOW);

// ---- extended households, the occupancy standard and a home's room (docs/behaviour/households.md) ----

type HouseholdRecord = { leaseholder: string; members: { person: string; born_at: number; sex: "female" | "male"; parents?: string[] }[]; couples: [string, string][] };
/** A town's households as their records list them. */
const householdsOf = (c: any): HouseholdRecord[] => c.world.records.filter((r: any) => r.kind === "household").map((r: any) => r.data);
/** More than a family, as the record shows it: the head's own parent lives with them; or the head's child has a partner
 * or children of their own there; or a family (a couple, or someone's children) has an adult in it who is nobody's
 * partner, parent or child and does not head it. */
function extended(h: HouseholdRecord): boolean {
  const partnered = (p: string) => h.couples.some((c) => c.includes(p));
  const head = h.members.find((m) => m.person === h.leaseholder)!;
  if (head.parents?.length) return true;
  if (h.members.some((m) => m.parents?.includes(h.leaseholder) && (partnered(m.person) || h.members.some((k) => k.parents?.includes(m.person))))) return true;
  const family = h.couples.length > 0 || h.members.some((m) => m.parents?.length);
  return family && h.members.some((m) => m.person !== h.leaseholder && !m.parents?.length && !partnered(m.person));
}
/** Each dwelling of a town, with what its kind of building gives it (how many bodies it holds, its bedrooms), and who lives where. */
function dwellings(c: any) {
  const types = new Map<string, any>(c.catalogue.structure_types.map((t: any) => [t.id, t]));
  const of = new Map<string, { capacity: number; bedrooms: number }>();
  for (const s of c.world.structures) for (const sp of types.get(s.type)?.spaces ?? []) if (sp.kind === "dwelling") for (let k = 1; k <= sp.count; k++) of.set(`${s.id}/dwelling.${k}`, { capacity: sp.capacity, bedrooms: sp.attrs.bedrooms });
  const home = new Map<string, string>(c.world.occupancy.filter((o: any) => of.has(o.space)).map((o: any) => [o.occupant, o.space]));
  return { of, home };
}

test("extended households are generated only where a profile states them, at its share, and everyone has room", () => {
  for (const id of ids) {
    const H = loadProfile(id).values.households;
    const c = town(id);
    const hh = householdsOf(c);
    const found = hh.filter(extended);
    // (A profile that states none draws none. Since 2026-10-12 its town may still hold some: households that took in
    // kin with nothing coming in, as many as the town says it opened with and no more than the profile's ceiling:
    // docs/behaviour/households.md, "Taken in".)
    if (!H.extended_bps) {
      const taken = Number(/(\d+) households with nothing coming in live with kin/.exec(c.meta.description)?.[1] ?? 0);
      expect(found.length).toBeLessThanOrEqual(taken);
      expect(taken).toBeLessThanOrEqual(Math.ceil(((H.kin_households_most_bps ?? 0) * (hh.length + taken)) / 10_000));
    }
    else {
      // How many is a draw at the profile's share of households: within four standard deviations of it.
      const p = H.extended_bps / (H.lone_bps + H.group_bps + H.couple_bps + H.couple_children_bps + H.one_parent_bps + H.extended_bps);
      expect(found.length).toBeGreaterThan(0);
      expect(Math.abs(found.length - hh.length * p)).toBeLessThanOrEqual(4 * Math.sqrt(hh.length * p * (1 - p)));
      // The parents a household's record names are the person's parents in the world too.
      const entity = new Map<string, any>(c.world.entities.map((e: any) => [e.id, e]));
      for (const h of found) for (const m of h.members) if (m.parents) expect(entity.get(m.person).parents).toEqual(m.parents);
    }
    // In every town, whatever its households: nobody is put where there isn't the room, and a household with a home
    // is all in the one home.
    const { of, home } = dwellings(c);
    const living = new Map<string, number>();
    for (const space of home.values()) living.set(space, (living.get(space) ?? 0) + 1);
    for (const [space, n] of living) expect({ id, space, fits: n <= of.get(space)!.capacity }).toEqual({ id, space, fits: true });
    for (const h of hh) expect(new Set(h.members.map((m) => home.get(m.person))).size).toBe(1);
  }
}, SLOW);

test("the occupancy standard and a home's physical room are the profile's where it states them, and nobody's where it doesn't", () => {
  const params = (c: any, impl: string) => [...c.participants, ...(c.templates ?? [])].filter((x: any) => x.controller?.impl === impl).map((x: any) => x.controller.params).concat(officesBy(c, impl).filter((o) => o.holder.kind === "person").map((o) => o.params));
  // Not stated (no profile states either today): no citizen or landlord is given a standard, so each keeps its module's
  // own, and a home holds two for each bedroom and two besides: every town as it was.
  for (const id of ids) {
    const P = loadProfile(id);
    expect(P.values.households.occupancy).toBeUndefined();
    expect(P.values.homes).toBeUndefined();
    const c = town(id);
    expect(params(c, "citizen.default").length).toBeGreaterThan(0);
    expect(params(c, "citizen.default").every((p: any) => !("occupancy" in p))).toBe(true);
    expect(params(c, "firm.landlord").every((p: any) => !("max_people_per_bedroom" in p))).toBe(true);
    for (const d of dwellings(c).of.values()) expect(d.capacity).toBe(2 * d.bedrooms + 2);
  }
  // Stated: the people judge homes by it, landlords let by its ceiling, and homes hold what the profile says.
  const P = copy(ids[0]!);
  P.values.households.occupancy = { per_bedroom: 3, own_from_age: 21, mixed_under_age: 10, living_room_slept_in: true };
  P.values.homes = { bodies_per_bedroom: 3, bodies_besides: 1 };
  const c = generateFrom(spec, P);
  expect(params(c, "citizen.default").length).toBeGreaterThan(0);
  for (const p of params(c, "citizen.default")) expect(p.occupancy).toEqual(P.values.households.occupancy);
  for (const p of params(c, "firm.landlord")) expect(p.max_people_per_bedroom).toBe(3);
  for (const d of dwellings(c).of.values()) expect(d.capacity).toBe(3 * d.bedrooms + 1);
  // The same people (the standard and the room change no draw), and their first homes dealt by that standard: with
  // more to a bedroom and the living room slept in, no more households start short of the bedrooms their standard asks
  // than start short by the common one in the town as it is.
  const plain = generateFrom(spec, copy(ids[0]!));
  expect(householdsOf(c)).toEqual(householdsOf(plain));
  const short = (t: any, S: OccupancyStandard) => {
    const { of, home } = dwellings(t);
    return householdsOf(t).filter((h) => home.has(h.leaseholder) && bedroomsNeeded(h, 0, 365 * DAY, S) > of.get(home.get(h.leaseholder)!)!.bedrooms).length;
  };
  expect(short(c, P.values.households.occupancy)).toBeLessThanOrEqual(short(plain, OCCUPANCY));
}, SLOW);

test("every town opens with its first year's budget on file: adopted by its council on the papers its own procedure leaves, with the lines its mayor's office tables", () => {
  const YEAR = 365 * DAY;
  for (const id of ids) {
    const c = town(id);
    const P = loadProfile(id);
    const rec = (rid: string) => c.world.records.find((r: any) => r.id === rid);
    const written = (n: number) => formatMoney(n, P.values.currency, n % 10 ** P.values.currency.minor_units === 0 ? { decimals: false } : {});
    const budget = rec("budget-year-1"), ballot = rec(budget.basis), proposal = rec(ballot.data.proposal), result = c.world.records.find((r: any) => r.kind === "ballot_result" && r.data.ballot === ballot.id);
    // The papers: a proposal in the mayor's post on the council proposal form, the clerk's ballot of the council, a
    // vote for each councillor's post, the result, and the budget resting on the ballot, in the town's name.
    const form = rec("form-council-proposal");
    expect(proposal).toMatchObject({ kind: "proposal", in_position: "mayor", speaks_for: "city", addressed_to: ["city"], basis: form.id, author: "genesis", at: 0 });
    for (const k of Object.keys(proposal.data)) expect(Object.keys(form.data.fields)).toContain(k);
    expect(proposal.data).toMatchObject({ kind: "budget", year: 1 });
    expect(ballot).toMatchObject({ kind: "ballot", in_position: "council-clerk", basis: proposal.id, data: { proposal: proposal.id, electorate: "council", options: ["yes", "no"], closes_at: 0, tags: ["budget"] } });
    const councillors = c.positions.filter((x: any) => x.role === "councillor").map((x: any) => x.id).sort();
    const votes = c.world.records.filter((r: any) => r.record === "vote" && r.ballot === ballot.id);
    expect(votes.map((v: any) => v.in_position).sort()).toEqual(councillors);
    expect(result).toMatchObject({ in_position: "council-clerk", basis: ballot.id, data: { ballot: ballot.id, yes: votes.filter((v: any) => v.choice === "yes").length, no: 0, passed: true } });
    // The ballot says it is closed and names its result, in its words and its content; the result names who voted.
    expect(ballot.data).toMatchObject({ closed: true, result: result.id });
    expect(ballot.text).toStartWith(`Council ballot, held and closed before the year began (result ${result.id}: passed, ${councillors.length} for, 0 against): `);
    expect(result.data).toMatchObject({ voted_for: councillors, voted_against: [] });
    expect(result.text).toContain(`Voting for: ${councillors.join(", ")}; against: none.`);
    expect(budget).toMatchObject({ kind: "budget", in_position: "council-clerk", speaks_for: "city", visible_to: "public", basis: ballot.id, author: "genesis", at: 0 });
    // The budget is what the clerk's own form for an adopted budget writes: a year, and the town's lines.
    expect(Object.keys(budget.data).sort()).toEqual(["lines", "year"]);
    expect(budget.data.year).toBe(1);
    const finance = officeBy(c, "city.finance_officer").params;
    for (const k of Object.keys(budget.data.lines)) expect(Object.keys(finance.budget_lines)).toContain(k);
    // Its lines are the ones the mayor's office is given to table each year, and the proposal's amounts are the same.
    const mayor = officeAt(c, "mayor").params;
    expect(budget.data.lines).toEqual({ parks: mayor.park_budget, ...(mayor.road_budget ? { roads: mayor.road_budget } : {}), ...(mayor.staff_budget ? { staff: mayor.staff_budget } : {}), ...(mayor.administration_budget ? { administration: mayor.administration_budget } : {}), ...(mayor.services_budget ? { services: mayor.services_budget } : {}), ...(mayor.environment_budget ? { environment: mayor.environment_budget } : {}) });
    // (Written as the town writes its money, on a paper people read: no sum is a bare count of the smallest unit.)
    for (const [k, v] of Object.entries(budget.data.lines)) expect(proposal.data[k]).toBe(written(v as number));
    for (const v of Object.values(proposal.data)) expect(String(v)).not.toMatch(/^[0-9]{4,}$/);
    // The staff lines cover the wages the town is bound to at the start: every agreement it employs someone under, for a year.
    const wages = c.world.records.filter((r: any) => r.record === "agreement" && r.terms.template === "employment" && r.terms.parties[0] === "city")
      .reduce((sum: number, a: any) => sum + Math.floor((Number(a.terms.commitments[0].does.outcome.money.amount) * YEAR) / a.terms.commitments[0].every), 0);
    expect(wages).toBeGreaterThan(0);
    expect((budget.data.lines.staff ?? 0) + (budget.data.lines.administration ?? 0) + (budget.data.lines.environment ?? 0)).toBeGreaterThanOrEqual(wages);
    // Its words say each line and the sum as the town writes its money, the year in days, and that the council adopted it.
    for (const v of [...Object.values(budget.data.lines), Object.values(budget.data.lines).reduce((a: number, x: any) => a + x, 0)] as number[]) expect(budget.text).toContain(written(v));
    expect(budget.text).toContain("year 1 (day 0 to day 364)");
    expect(budget.text).toContain(`Adopted by the council before the year began (ballot ${ballot.id}).`);
    // The procedure the finance office follows names the budget for the year, and what holds while a year has none.
    expect(rec("proc-payments").text).toContain("only within the budget the council has adopted for the year");
    expect(rec("law-charter").text).toContain("at no more each month than a twelfth of the budget last adopted");
    // The mayor's office tables the next year's before the year ends.
    expect(mayor.budget_lead_days).toBeGreaterThan(officeBy(c, "city.council_clerk").params.vote_days);
  }
}, SLOW);

test("every standing payment a town opens with says who gave it, when and under what; the town's rest on its own signatory rule, and what it is paid or charged from outside has a paper behind it", () => {
  for (const id of ids) {
    const c = town(id);
    const P = loadProfile(id);
    const rec = (rid: string) => c.world.records.find((r: any) => r.id === rid);
    const written = (n: number) => formatMoney(n, P.values.currency, n % 10 ** P.values.currency.minor_units === 0 ? { decimals: false } : {});
    const standing = c.world.records.filter((r: any) => r.kind === "request" && r.author === "genesis" && Number.isInteger(r.data?.every));
    expect(standing.length).toBeGreaterThan(100);
    // Every one: an instruction to the bank from whoever it speaks for, given before the year began.
    for (const r of standing) expect(r.text).toMatch(/^Standing instruction to the bank, given (by \S+|for the town by its finance officer, the signatory the town has named for its account \(signatories-city\),) before the year began: pay /);
    // Every one that pays under an agreement cites it and names it in its words. (The one kind that rests on none is a
    // household member's share of the rent: an arrangement inside a household, and its words say whose lease it is.)
    for (const r of standing) {
      if (r.id.startsWith("share-")) expect(r.text).toContain("who holds the lease");
      else {
        expect(rec(r.basis)?.record).toBe("agreement");
        expect(r.text).toContain(` ${r.basis}`);
      }
    }
    // The town's: only its finance officer may instruct on its account, by the mandate the bank holds, and each of
    // its instructions was given in that post. Its words give the sum as the town writes money, how it comes from
    // the agreed wage, and the first pay day.
    const mandate = rec("signatories-city");
    expect(mandate).toMatchObject({ kind: "signatories", speaks_for: "city", addressed_to: ["bank"], basis: "law-charter", data: { account: "acc-city", positions: ["finance"] } });
    expect(mandate.text).toContain("given by resolution of the council before the year began");
    expect(mandate.text).toContain("only the finance officer puts a hold on a standing instruction, changes one or withdraws one");
    const towns = standing.filter((r: any) => r.speaks_for === "city");
    expect(towns.length).toBeGreaterThan(0);
    for (const r of towns) {
      expect(mandate.data.positions).toContain(r.in_position);
      const job = rec(r.basis), gross = Number(job.terms.commitments[0].does.outcome.money.amount), net = Number(r.data.outcome.money.amount);
      expect(r.text).toContain(written(net));
      if (net < gross) expect(r.text).toContain(`(the agreed ${written(gross)} less ${written(gross - net)} withheld under law-income-tax)`);
      expect(r.text).toContain(`first on year 1, day ${r.data.first / DAY + 1}.`);
      // (The agreement it pays under was signed for the town by the office that takes its crew on, or, for an administrative officer (a role of its own), by the finance officer.)
      expect(c.world.records.find((x: any) => x.record === "signature" && x.agreement === job.id && x.as === "city")).toMatchObject({ in_position: job.terms.text ? "finance" : "works" });
      expect(c.positions.some((x: any) => x.id === "works" && x.entity === "city")).toBe(true);
    }
    // What the town is paid from outside: the funder's determination is on file with it, and says what the grants
    // office pays by (the same figures the office is given).
    for (const g of officesBy(c, "world.grants")) {
      const q = g.params, paper = rec(`grant-${q.to}`);
      expect(paper).toMatchObject({ kind: "grant_determination", speaks_for: "outside", addressed_to: [q.to], author: "genesis", at: 0, data: { per_resident_per_year: String(q.per_resident_per_year), every_days: q.every_days, first_day: q.first_day, account: q.to_account } });
      expect(c.positions.find((x: any) => x.id === paper.in_position)?.holder).toBe(g.holder.id);
      expect(paper.text).toContain(`${written(q.per_resident_per_year)} a year for each resident`);
      expect(paper.text).toContain(`every ${q.every_days} days from year 1, day ${q.first_day + 1}`);
    }
    expect(rec("grant-city")).toBeDefined();
    // What the town is charged from outside: the landfill's charge is on file with it, where the place has one.
    const landfill = officeBy(c, "world.disposal").params;
    if (landfill.price_per_tonne === undefined) expect(rec("landfill-charges")).toBeUndefined();
    else {
      expect(rec("landfill-charges")).toMatchObject({ kind: "charges_notice", speaks_for: "outside", addressed_to: ["city"], data: { price_per_tonne: String(landfill.price_per_tonne), every_days: landfill.every_days } });
      expect(rec("landfill-charges").text).toContain(`${written(landfill.price_per_tonne)} a tonne`);
    }
  }
}, SLOW);

test("a town's opening budget against the grant it expects: where the grant is far more than everything the budget spends, the profile's own note on the figure says so, for its author", () => {
  // Nothing sets a budget's lines to what the town takes in (calibrate mechanisms, not outcomes). But a grant several
  // times the whole budget is a profile figure that means something other than the town's budget does (a real
  // municipality's whole transfer, against the few functions the town runs): a seat sees the surplus and asks. The
  // figure is its author's; what is held here is that it does not pass unremarked.
  const ratios: { [id: string]: number } = {};
  for (const id of ids) {
    // (A town of a thousand, the pilots' size: two of a budget's lines are sums that do not follow the town's size.)
    const c = generate({ ...spec, citizens: 1000, profile: id }), P = loadProfile(id);
    const budget = c.world.records.find((r: any) => r.id === "budget-year-1");
    const spending = Object.values(budget.data.lines as { [k: string]: number }).reduce((a, x) => a + x, 0);
    const residents = c.participants.filter((x: any) => x.kind === "person").length;
    const grants = P.values.public_finance.grants_per_resident_per_year * residents;
    ratios[id] = Math.round((grants * 100) / spending) / 100;
    const note = P.sources["public_finance.grants_per_resident_per_year"] ?? "";
    if (grants > 1.5 * spending) expect({ id, flagged: note.includes("FLAGGED FOR THIS PROFILE'S AUTHOR") }).toEqual({ id, flagged: true });
  }
  // (The two whose figure is a real municipality's whole general transfer, and the one placeholder sized to one. Foundations F5: the
  // budget now carries the town's administrative staff, a line of its own, which brought mx-jal-2026's grant (1.53 of the budget) under the bar.)
  expect(Object.keys(ratios).filter((id) => ratios[id]! > 1.5).sort()).toEqual(["br-mg-2026", "jp-akita-2026", "ke-nakuru-2026"]);
}, SLOW);

test("a council with almost no reserves opens with the same budget and a hundredth of the money: a budget it cannot meet", () => {
  const plain = generate({ ...spec, profile: ids[0] }), lean = generate({ ...spec, profile: ids[0], scenario: "lean-council" });
  const lines = (c: any) => c.world.records.find((r: any) => r.id === "budget-year-1").data.lines;
  const held = (c: any) => Number(c.world.accounts.find((a: any) => a.holder === "city").balance);
  expect(lines(lean)).toEqual(lines(plain));
  expect(held(lean) * 100).toBe(held(plain));
  // What it holds is less than a month of what the budget spends.
  expect(held(lean) * 12).toBeLessThan(Object.values(lines(lean)).reduce((a: number, v: any) => a + v, 0));
}, SLOW);

// One rule for what is withheld from a pay, in the law's own words (wave 2a's review of 2026-10-09, fault 4): in
// every profile's town the opening wage instruction is the agreed wage less what the tax law's three steps give,
// worked here step by step from the law's own data, and the law says those steps. (A finance seat that took a year
// as 26 pays came to another figure than the instruction's, and withdrew eight workers' wages.)
test("in every profile's town the opening wage instructions are what the tax law's own steps give, and the law says the steps", () => {
  const differing: string[] = [];
  for (const id of ids) {
    const c = town(id), V = loadProfile(id).values as any, days = V.pay_period_days as number;
    const records = c.world.records as any[];
    const law = records.find((r) => r.id === "law-income-tax");
    const orders = records.filter((r) => /^job-.*-wages$/.test(r.id));
    expect(orders.length).toBeGreaterThan(10);
    const offBooks = new Set(records.filter((r) => r.kind === "off_books").map((r) => r.data.agreement));
    if (law) {
      expect(law.text).toContain("What is withheld from a pay is reckoned in three steps, and in no other way. One: the pay is taken as a year's pay, by multiplying it by 365 and dividing by the number of days the pay is for, rounded down to the smallest unit of money.");
      expect(law.text).toContain(`a pay for ${days} days is ${days}/365 of a year's pay, and a year is not taken as a whole number of pays.`);
      expect(law.text).toContain("Three: the year's charges are added together, and that sum, multiplied by the number of days the pay is for and divided by 365, rounded down, is what is withheld from the pay.");
      expect(law.text).not.toContain("reckoned as a year's pay,");
    }
    const year = (pay: number) => (law ? chargesOn({ id: law.id, charges: law.data.charges }, pay).reduce((x, k) => x + k.amount, 0) : 0);
    let differ = 0;
    for (const o of orders) {
      const job = records.find((r) => r.id === o.basis);
      const gross = Number(job.terms.commitments[0].does.outcome.money.amount);
      expect(job.terms.commitments[0].every).toBe(days * DAY);
      // One, two, three.
      const yearly = Math.floor((gross * 365) / days);
      const byHand = offBooks.has(job.id) ? 0 : Math.floor((year(yearly) * days) / 365);
      expect({ id, order: o.id, net: Number(o.data.outcome.money.amount) }).toEqual({ id, order: o.id, net: gross - byHand });
      if (byHand > 0) expect(o.text).toContain(`less ${formatMoney(byHand, V.currency, byHand % 10 ** V.currency.minor_units === 0 ? { decimals: false } : {})} withheld under law-income-tax`);
      // (The calendar's route, a year of whole pays, for the record of where it differs.)
      const pays = Math.round(365 / days);
      if (!offBooks.has(job.id) && Math.floor(year(gross * pays) / pays) !== byHand) differ++;
    }
    if (differ) differing.push(id);
  }
  // Wherever a law's rates step, the calendar's route gives another figure: seven of the nine towns as the profiles stand.
  expect(differing.length).toBeGreaterThanOrEqual(5);
}, SLOW);
