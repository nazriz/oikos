// A town from another place's profile, run (docs/profiles.md; the generation-level checks are in places.test.ts).
// Three short runs of the small town, each holding one fault found on 2026-10-08 when eight more places were first
// generated: factories that could not pay their staff within weeks of the start; money counted as if every currency
// had two decimal places, and ages in seconds that passed 32 bits; and pay every fourteen days whatever the place.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { exportLogs, query, runQuery } from "@oikos/measure";
import { bedroomsNeeded, OCCUPANCY } from "@oikos/participants";
import { generate, generateFrom } from "@oikos/worlds/generator/generate";
import { loadProfile } from "@oikos/worlds/generator/profile";
import { runWorld } from "../src/run";
import { officeBy } from "./lib/offices";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const base = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

async function run(name: string, config: any, until: number) {
  const out = join(root, "runs", `test-places-${name}`);
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config, runId: name, outDir: out, until });
  expect(s.participantErrors).toBe(0);
  const log = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const ev = log.filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
  const cmds = log.filter((e) => e.kind === "command").map((e) => ({ t: e.t, ...e.body }));
  return { s, out, ev, cmds, recs: ev.filter((e) => e.event === "recorded").map((e) => e.record) };
}

test("factories in a place with other wages keep their staff: none is short of a pay period's wages in its first six weeks", async () => {
  // (The profile whose town first showed it: its factories could afford their first order of inputs from the sum
  // every profile then stated, and so had nothing left for wages a week in. The first profile's could not afford the
  // order, and so survived a little longer.)
  for (const profile of ["de-ni-2026", "au-vic-2026"]) {
    const config = generate({ ...base, profile });
    const staffAtStart = config.world.records.filter((r: any) => r.record === "agreement" && r.terms.template === "employment" && r.terms.parties[0].startsWith("factory-")).length;
    expect(staffAtStart).toBeGreaterThan(20);
    const { cmds, recs } = await run(`factories-${profile}`, config, 42 * DAY);
    const short = cmds.filter((c) => c.command === "act" && /^factory-/.test(c.participant) && /not enough for the next pay period|Can't cover the next pay period/.test(c.reasoning ?? ""));
    expect(short.map((c) => `${c.participant} day ${Math.floor(c.t / DAY)}: ${c.reasoning}`)).toEqual([]);
    // Nobody given notice by a factory in those weeks.
    const jobs = new Set(config.world.records.filter((r: any) => r.record === "agreement" && r.terms.template === "employment" && r.terms.parties[0].startsWith("factory-")).map((r: any) => r.id));
    expect(recs.filter((r: any) => r.record === "notice" && jobs.has(r.agreement) && /^factory-/.test(r.speaks_for ?? "")).length).toBe(0);
  }
}, 600_000);

test("a town whose money has no decimal places and whose people retire at 70 runs, and is measured in its own money", async () => {
  // A currency with no smaller unit, and a retirement age whose seconds don't fit 32 bits (two places' figures, in one
  // town: the money of one profile and the retirement age of another).
  const P = structuredClone(loadProfile("jp-akita-2026"));
  expect(P.values.currency.minor_units).toBe(0);
  P.values.retirement_age = 70;
  P.values.support.payments.find((r) => r.id === "pension")!.who!.from_age = 70;
  const config = generateFrom(base, P);
  const { s, out } = await run("no-decimals", config, 16 * DAY);
  const m = join(out, "measure");
  await exportLogs([s.logPath], m);
  const [r] = await query(m, "select currency, minor_units from runs");
  expect(r).toEqual({ currency: P.values.currency.code, minor_units: 0 });
  // Money across the edge, and the price households paid, are in the currency's own units: here, the log's own counts.
  const [month] = await runQuery(m, "economy/monthly");
  const [sum] = await query(m, `select sum(amount) filter (where "from" = 'acc-outside')::DOUBLE as came, sum(amount) filter (where "to" = 'acc-outside')::DOUBLE as went from transfers`);
  expect(month!.money_in).toBe(sum!.came as number);
  expect(month!.money_out).toBe(sum!.went as number);
  const retail = officeBy(config, "firm.retailer").params.price as number;
  expect(Math.abs((month!.price_paid as number) - retail)).toBeLessThan(0.1 * retail);
  const [town] = await runQuery(m, "town/economy");
  const [paid] = await query(m, `select coalesce(sum(amount), 0)::DOUBLE as n from transfers where "to" = 'acc-city'`);
  expect(town!.paid_to_town ?? 0).toBe(paid!.n as number);
  // The summary's ages (it failed outright from a retirement age of 69: an age in seconds in 32 bits).
  const [summary] = await runQuery(m, "economy/summary");
  expect(summary!.adults as number).toBeGreaterThan(100);
  expect(summary!.working_age as number).toBeLessThan(summary!.adults as number);
  expect(summary!.working_age as number).toBeGreaterThan(0);
  await runQuery(m, "town/gatherings");
}, 600_000);

test("a town paid monthly, with no payment to the unemployed and no rent or ballot law, runs: wages come once every thirty days", async () => {
  const P = structuredClone(loadProfile("au-vic-2026"));
  const restate = (w: number) => Math.round((w * 30) / 14);
  P.values.pay_period_days = 30;
  for (const k of ["shop", "factory", "construction"] as const) P.values.wages_per_pay_period[k] = restate(P.values.wages_per_pay_period[k]);
  P.values.health!.doctor_wage_per_pay_period = restate(P.values.health!.doctor_wage_per_pay_period);
  P.values.education!.teacher_wage_per_pay_period = restate(P.values.education!.teacher_wage_per_pay_period);
  P.values.crime!.officer_wage_per_pay_period = restate(P.values.crime!.officer_wage_per_pay_period);
  P.values.support.payments = P.values.support.payments.filter((r) => !r.who?.out_of_work);
  delete P.values.services.landfill_levy_per_tonne;
  delete P.values.credit.serviceability_buffer_bps;
  delete P.values.tenancy.rent_review_months;
  delete P.values.tenancy.rent_increase_notice_days;
  delete P.values.industrial_action.ballot_turnout_bps;
  delete P.values.industrial_action.ballot_pass_bps;
  delete P.values.industrial_action.notice_days;
  const config = generateFrom(base, P);
  const { ev, recs } = await run("monthly", config, 65 * DAY);
  // Each worker employed from the start to the end was paid wages once in each thirty days: twice in 65 days, or three
  // times where the first pay day came in the first five, and never less than 29 days apart.
  const jobs = config.world.records.filter((r: any) => r.record === "agreement" && r.terms.template === "employment");
  const ended = new Set(recs.filter((r: any) => r.record === "notice").map((r: any) => r.agreement));
  // (A wage payment: a transfer made on an instruction to pay wages, the town's first or one a firm wrote since.)
  const wageOrders = new Set([...config.world.records, ...recs].filter((r: any) => /^wages/i.test(r.data?.outcome?.money?.for ?? "")).map((r: any) => r.id));
  const wages = ev.filter((e) => e.event === "transfer" && wageOrders.has(e.per_instruction));
  const paid = new Map<string, number[]>();
  for (const w of wages) paid.set(w.to, [...(paid.get(w.to) ?? []), w.t]);
  const kept = jobs.filter((j: any) => !ended.has(j.id) && /^(factory|shop)-/.test(j.terms.parties[0]));
  expect(kept.length).toBeGreaterThan(40);
  for (const j of kept) {
    const times = paid.get(`acc-${j.terms.parties[1]}`) ?? [];
    // (Three for someone whose first pay day fell in the run's first five days.)
    // (Including a worker whose wage order was replaced by a rise: pay rises begin at the next pay run, never paying twice in a period.)
    expect({ worker: j.terms.parties[1], times: Math.min(2, times.length), early: times.length === 3 ? times[0]! <= 5 * DAY + DAY : false }).toEqual({ worker: j.terms.parties[1], times: 2, early: times.length === 3 });
    expect(times.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(29 * DAY);
  }
  // Nobody claimed or was paid a payment the place doesn't have.
  expect(recs.filter((r: any) => r.kind === "benefit_claim" && r.data?.payment === "unemployment")).toEqual([]);
  expect(recs.filter((r: any) => r.kind === "benefit_claim" && r.data?.payment === "pension").length).toBeGreaterThan(0);
  // The landfill, which charges nothing here, sent no invoice.
  expect(recs.filter((r: any) => r.kind === "invoice" && r.speaks_for === "outside" && /disposal|waste/.test(r.text ?? "")).length).toBe(0);
}, 600_000);

// Extended households (docs/behaviour/households.md): the profile whose census gives three-generation households (a
// quarter of its households), in the small town.
type Household = { leaseholder: string; members: { person: string; born_at: number; sex: "female" | "male"; parents?: string[] }[]; couples: [string, string][] };
const householdsOf = (config: any): Household[] => config.world.records.filter((r: any) => r.kind === "household").map((r: any) => r.data);
const threeGenerations = (h: Household) => h.members.some((m) => m.parents?.some((p) => h.members.find((x) => x.person === p)?.parents?.length));

test("a town with extended households runs: three generations share a home and its rent", async () => {
  const P = loadProfile("jp-akita-2026");
  expect(P.values.households.extended_bps).toBeGreaterThan(0);
  // (Every home let, so that each housed household has a lease and a rent to share.)
  const config = generateFrom({ ...base, ownership: false }, P);
  const three = householdsOf(config).filter(threeGenerations);
  const home0 = new Map<string, string>(config.world.occupancy.filter((o: any) => o.space.includes("/dwelling.")).map((o: any) => [o.occupant, o.space]));
  const housed = three.filter((h) => home0.has(h.leaseholder));
  expect(housed.length).toBeGreaterThan(0);
  const { s, out, ev } = await run("extended", config, 45 * DAY);
  // Nothing refused but the usual races (as the households test lists them, with the daily round).
  expect(ev.filter((e) => e.event === "action_refused" && !["not_present", "not_at_work", "capacity_exceeded", "no_time_left", "insufficient_quantity", "dead", "too_far", "participant_inactive", "flooded"].includes(e.code)).map((e) => e.code)).toEqual([]);
  // The household's money rules as they are, applied to the larger household: in a rented home every other adult with
  // pay has a standing order for a share of the rent to the leaseholder, grandparent and grown child alike, and the
  // bank pays it.
  const leased = housed.filter((h) => config.world.records.some((r: any) => r.terms?.template === "lease" && r.terms.parties[1] === h.leaseholder));
  const employed = new Set<string>(config.world.records.filter((r: any) => r.terms?.template === "employment").map((r: any) => r.terms.parties[1]));
  const orders: string[] = [];
  for (const h of leased) for (const m of h.members) {
    if (m.person === h.leaseholder || !employed.has(m.person)) continue;
    const order = config.world.records.find((r: any) => r.id === `share-${m.person}`);
    expect(order?.data.outcome.money).toMatchObject({ from: `acc-${m.person}`, to: `acc-${h.leaseholder}`, for: "Household share of the rent." });
    orders.push(order.id);
  }
  expect(orders.length).toBeGreaterThan(0);
  // (Not every one for the whole run: a share is told again when someone's pay changes, and stops with their job.)
  expect(ev.some((e) => e.event === "transfer" && orders.includes(e.per_instruction))).toBe(true);
  // And the town is measured as any other.
  const m = join(out, "measure");
  await exportLogs([s.logPath], m);
  const [hh] = await runQuery(m, "town/households");
  expect(Number(hh!.households)).toBeGreaterThan(0);
  for (const k of ["overcrowded", "over_three_a_room"]) expect(Number.isFinite(Number(hh![k] ?? 0))).toBe(true);
}, 600_000);

test("crowding is measured by the town's own standard and by one yardstick that is the same everywhere", async () => {
  // A town of small homes (studios that hold six, and a few one-bedroom houses), with a standard of its own stated:
  // the measure, on the town's first hour, counts what the standard's own rule counts for the same households and homes.
  const P = structuredClone(loadProfile("jp-akita-2026"));
  P.values.households.occupancy = { per_bedroom: 3, own_from_age: 21, mixed_under_age: 10, living_room_slept_in: true };
  P.values.homes = { bodies_per_bedroom: 2, bodies_besides: 6 };
  const rent = P.values.rents_per_month.apartment_units[0]!.rent;
  for (const [name, profile] of [["own-standard", P], ["common-standard", { ...P, values: { ...P.values, households: { ...P.values.households, occupancy: undefined } } }]] as const) {
    const config = generateFrom({ ...base, apartment_blocks: 6, houses: 4, apartment_units: [{ bedrooms: 0, count: 12, rent }], house_types: [{ id: "house", bedrooms: 1, share_bps: 10_000, rent }] }, profile);
    const { s, out } = await run(name, config, 3600);
    const m = join(out, "measure");
    await exportLogs([s.logPath], m);
    const [hh] = await runQuery(m, "town/households");
    const types = new Map<string, any>(config.catalogue.structure_types.map((t: any) => [t.id, t]));
    const bedrooms = new Map<string, number>();
    for (const st of config.world.structures) for (const sp of types.get(st.type)?.spaces ?? []) if (sp.kind === "dwelling") for (let k = 1; k <= sp.count; k++) bedrooms.set(`${st.id}/dwelling.${k}`, sp.attrs.bedrooms);
    const home = new Map<string, string>(config.world.occupancy.filter((o: any) => bedrooms.has(o.space)).map((o: any) => [o.occupant, o.space]));
    const housed = householdsOf(config).filter((h) => home.has(h.leaseholder));
    const S = profile.values.households.occupancy ?? OCCUPANCY;
    const crowded = housed.filter((h) => bedroomsNeeded(h, 3600, 365 * DAY, S) > bedrooms.get(home.get(h.leaseholder)!)!);
    const overThree = housed.filter((h) => h.members.length > 3 * (bedrooms.get(home.get(h.leaseholder)!)! + 1));
    expect(crowded.length).toBeGreaterThan(0);
    expect(overThree.length).toBeGreaterThan(0);
    expect({ name, overcrowded: Number(hh!.overcrowded), people: Number(hh!.people_overcrowded ?? 0) }).toEqual({ name, overcrowded: crowded.length, people: crowded.reduce((a, h) => a + h.members.length, 0) });
    expect({ name, over: Number(hh!.over_three_a_room), people: Number(hh!.people_over_three_a_room ?? 0) }).toEqual({ name, over: overThree.length, people: overThree.reduce((a, h) => a + h.members.length, 0) });
  }
}, 600_000);
