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
import { bedroomsNeeded, calls, formatMoney, OCCUPANCY, type OccupancyStandard } from "@oikos/participants";
import { generate, generateFrom } from "@oikos/worlds/generator/generate";
import { loadProfile, PROFILE_DIR, type Profile } from "@oikos/worlds/generator/profile";

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
  const params = (impl: string) => c.participants.filter((p: any) => p.controller.impl === impl).map((p: any) => ({ entity: p.owner as string, ...p.controller.params }));
  const staff = new Map<string, number>();
  for (const r of c.world.records) if (r.record === "agreement" && r.terms.template === "employment") staff.set(r.terms.parties[0], (staff.get(r.terms.parties[0]) ?? 0) + 1);
  const balance = (entity: string) => Number(c.world.accounts.find((a: any) => a.holder === entity).balance);
  const trade = c.participants.find((p: any) => p.controller.impl === "world.trade").controller.params;
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
      if (c.schedule.length > 1) for (const b of c.schedule) expect(tax.text).toContain(`above ${whole(b.from)}`);
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
    const finance = c.participants.find((p: any) => p.controller.impl === "city.finance_officer").controller.params;
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
  const of = (impl: string) => c.participants.find((p: any) => p.controller.impl === impl).controller.params;
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
  expect(c.world.records.some((r: any) => r.id === "schedule-industrial-action-notice")).toBe(false);
  // No retirement fund.
  expect(c.world.entities.some((e: any) => e.kind === "retirement_fund")).toBe(false);
  expect(() => generateFrom({ ...spec, retirement_fund: true }, P)).toThrow(/retirement fund/);

  // Landlords without a law still review rents, where the profile says how often they do.
  const Q = copy("au-vic-2026");
  delete Q.values.tenancy.rent_review_months;
  delete Q.values.tenancy.rent_increase_notice_days;
  Q.values.tenancy.rent_review_practice_months = 12;
  const q = generateFrom(spec, Q);
  expect(q.participants.find((p: any) => p.controller.impl === "firm.landlord").controller.params.rent_review_months).toBe(12);
  expect(q.world.records.some((r: any) => r.id === "law-rent-increases")).toBe(false);

  // Notice of industrial action without a ballot: a law of the notice alone, with its schedule and amendment form.
  const N = copy("au-vic-2026");
  delete N.values.industrial_action.ballot_turnout_bps;
  delete N.values.industrial_action.ballot_pass_bps;
  N.values.industrial_action.notice_days = 14;
  const n = generateFrom(spec, N);
  const law = n.world.records.find((r: any) => r.id === "law-industrial-action");
  expect(law.data.schedule).toBe("schedule-industrial-action-notice");
  expect(law.text).toContain("14 days");
  expect(law.text).not.toContain("ballot");
  expect(law.formal.condition).toBe(`block.block == 'publish' && block.kind == 'industrial_action' && block.data.from - now < ${14 * DAY}`);
  expect(n.world.records.some((r: any) => r.id === "form-amend-industrial-action-notice")).toBe(true);
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
  for (const [c, days] of [[a, 14], [b, 30]] as const) for (const p of c.participants) if (p.controller.params?.wage !== undefined && p.controller.params?.period !== undefined) expect(p.controller.params.period).toBe(days * DAY);
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
    if (!H.extended_bps) expect({ id, extended: found.length }).toEqual({ id, extended: 0 });
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
  const params = (c: any, impl: string) => [...c.participants, ...(c.templates ?? [])].filter((x: any) => x.controller?.impl === impl).map((x: any) => x.controller.params);
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
