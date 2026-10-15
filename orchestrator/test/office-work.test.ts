// An office held by a seat gets its work done (docs/decisions.md, 2026-10-09, "An office held by a seat gets its work
// done"). In the wave's first works pilot a model works manager advertised, took on a crew of five and set two standing
// work orders, and in 180 days nothing was collected: its offers of employment, as the translator wrote them, named the
// pay and the advertisement and no place of work, so nobody ever came to the depot; and nothing it was shown said so.
// Here a seat that follows a script asks for the same things in the same shapes, in a small town whose crew is still
// to be taken on:
//  - offers made on the office's advertisement: the crew comes to work where the advertisement says, the round is
//    collected, and the seat is shown who is in post, when each last worked and how each standing order stands;
//  - offers that cite nothing: the preview says the offer names no place of work, nobody comes, and the crew's report
//    and the seat's roster say that the order is not being carried out, and why.
// No model is called.

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { modules } from "@oikos/participants";
import { generate } from "@oikos/worlds/generator/generate";
import { runWorld } from "../src/run";
import { applicantsTo, offeredTo, postingFor, scriptedSeats, type Sitting } from "../../scripts/scripted-seats";
import { holderIdOf, officeAt, officeBy, officesBy } from "./lib/offices";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

// (The run's seed is pinned to one in which, in the 20 days, enough of those who apply are out of work and come to the depot to
// show the crew at work. With draws named for the day, 2026-10-12, the generated seed's applicants came after the run ended.)
async function worksSeat(citing: boolean) {
  const config = generate({ ...spec, opening_orders: false, model_seats: ["works"], works_crew_at_start: 0 });
  const own = officeAt(config, "works-staff").params;
  const wage = (own.wage / 100).toFixed(2), period = `${own.period / DAY} days`;
  const works: Sitting[] = [
    { day: 0, asks: () => [
      { what: "Advertise three posts on the works crew.", program: `form(account=acc-city, form=job_advertisement, period="${period}", posts="3", to=works, wage="${wage}")` },
      { what: "The crew collects from every address each week.", program: 'work(at=town-hall, every="once a week", task=collect)' },
      { what: "The crew keeps the town's assets up each day.", program: 'work(at=town-hall, every="every day", task=maintain)' }] },
    // An offer to each of up to three applicants on its own advertisement: the pay, and (or not) the advertisement.
    { day: 2, asks: (seen, me) => {
      const post = postingFor(seen, "works crew", me, "works/works-business");
      const had = offeredTo(me);
      const apps = post ? applicantsTo(seen, post.id).filter((a) => !had.has(a.speaks_for)).slice(0, 3) : [];
      return apps.length ? apps.map((a) => ({ what: `Offer ${a.speaks_for} employment on the works crew.`,
        program: `agreement(${citing ? `basis=${post.id}, ` : ""}template=employment, we_do=money(amount="${wage}", every="${period}", from=acc-city, to=acc-${a.speaks_for}), with=${a.speaks_for})` })) : undefined;
    } },
    ...[6, 9, 12, 15, 18].map((day) => ({ day, asks: () => [] })),
  ];
  const seats = scriptedSeats({ works });
  const s = await runWorld({ config: { ...config, seed: 4 }, runId: "office-work", outDir: mkdtempSync(join(tmpdir(), "oikos-office-work-")), until: 20 * DAY, adapter: seats.adapter, recordObservations: "none", recordDecisions: "none" });
  expect(s.participantErrors).toBe(0);
  const log = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const events = log.filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
  const records = events.filter((e) => e.event === "recorded").map((e) => e.record);
  const hired = records.filter((r) => r.record === "agreement" && r.terms.template === "employment" && r.in_position === "works").map((r) => String(r.terms.parties[1]));
  return { seats, events, records, hired, depot: String(own.workplace), shown: seats.shown.map((x) => x.text), staffId: holderIdOf(config, "works-staff") };
}

test("a crew taken on by offers of the pay alone, made on the office's advertisement, comes to work and carries out the standing orders; the seat sees who worked and how each order stands", async () => {
  const { seats, events, records, hired, depot, shown, staffId } = await worksSeat(true);
  expect(hired.length).toBeGreaterThan(0);
  // The offers were of the pay alone: no place of work in them. Their preview says where the work is, by the advertisement.
  const offers = records.filter((r) => r.record === "agreement" && r.in_position === "works");
  for (const a of offers) expect(a.terms.commitments.map((c: any) => Object.keys(c.does.outcome)[0])).toEqual(["money"]);
  const preview = seats.previews.find((p) => p.text.includes("You will offer"))!.text;
  expect(preview).toMatch(new RegExp(`It names no place of work: it is made on the job advertisement rec\\.\\d+, so the work is where that advertisement says \\(${depot.replace(/[.\/]/g, "\\$&")}\\)\\.`));
  // The crew comes in, and the round is collected by them.
  const came = new Set(events.filter((e) => e.event === "occupied" && e.space === depot).map((e) => e.occupant));
  // (All but someone working out their notice at the job they are leaving for this one: with homes dealt by income,
  // 2026-10-12, fewer of this town's people are out of work and without a home on the day the posts are advertised,
  // two apply at first, and one of them is in a shop, gives a fortnight's notice there and comes after this run ends.)
  const leaving = new Set(records.filter((r) => r.record === "notice" && typeof r.as === "string" && hired.includes(r.as)).map((r) => r.as as string));
  expect(hired.filter((w) => came.has(w) || leaving.has(w)).length).toBe(hired.length);
  expect(hired.filter((w) => came.has(w)).length).toBeGreaterThan(0);
  const collected = events.filter((e) => e.event === "worked" && e.by === staffId && e.task === "collect");
  expect(collected.length).toBeGreaterThan(20);
  for (const c of collected) expect(c.performers.every((w: string) => hired.includes(w))).toBe(true);
  expect(records.filter((r) => r.kind === "complaint" && (r.addressed_to ?? []).includes("city"))).toEqual([]);
  // The crew's reports, on the town's own file: the first when the work began, and one a week after.
  const reports = records.filter((r) => r.kind === "staff_report");
  expect(reports.length).toBeGreaterThanOrEqual(2);
  expect(reports.length).toBeLessThanOrEqual(5);
  for (const r of reports) expect(r).toMatchObject({ speaks_for: "city", in_position: "works-staff", addressed_to: ["city"], visible_to: ["city"], data: { office: "works" } });
  expect(reports.some((r) => r.data.orders.some((o: any) => o.task === "collect" && o.state === "followed" && o.times > 0))).toBe(true);
  // What the seat is shown: with nobody in post, that its orders are carried out by nobody; then who is in post and
  // when each last worked, and each order as the crew last reported it; and the report itself, as a paper.
  expect(shown.some((x) => /Your standing work orders:\n- rec\.\d+, collect every 7 days: carried out by nobody: there is nobody in post\./.test(x))).toBe(true);
  const last = shown.filter((x) => x.includes("Staff of your office")).at(-1)!;
  expect(last).toMatch(/In post \(\d\): c\d+, since year 1, day \d+, under rec\.\d+, last at work year 1, day \d+ \((collect|maintain)\)/);
  expect(last).toMatch(/Your standing work orders, as your staff reported on year 1, day \d+ \(rec\.\d+\):\n- rec\.\d+, collect every 7 days: carried out: \d+ calls at addresses, \d+ loads/);
  expect(shown.some((x) => x.includes("Reports from the staff on the work under the standing work orders") && x.includes("Report of the works crew, year 1, day"))).toBe(true);
}, 600_000);

test("offers that cite no advertisement: the preview says there is no place of work, nobody comes, and the crew's report and the seat's roster say the order is not carried out and why", async () => {
  const { seats, events, records, hired, depot, shown, staffId } = await worksSeat(false);
  expect(hired.length).toBeGreaterThan(0);
  expect(seats.previews.find((p) => p.text.includes("You will offer"))!.text).toContain("It names no place of work and cites no job advertisement that does: whoever signs it is paid and has nowhere to come to work.");
  // (Nobody comes for this job. One of those taken on now holds another job of the town's at the same address, taken
  // from the environment office the day before, and comes for that: left out.)
  const elsewhere = new Set(records.filter((r) => r.record === "agreement" && r.terms.template === "employment" && r.in_position !== "works" && r.terms.commitments.some((c: any) => c.does?.outcome?.occupancy?.in === depot)).map((r) => String(r.terms.parties[1])));
  expect(events.filter((e) => e.event === "occupied" && e.space === depot && hired.includes(e.occupant) && !elsewhere.has(e.occupant))).toEqual([]);
  expect(events.filter((e) => e.event === "worked" && e.by === staffId && ["collect", "maintain"].includes(e.task))).toEqual([]); // (the staff post is a resident, whose own life takes work too)
  const reports = records.filter((r) => r.kind === "staff_report");
  expect(reports.length).toBeGreaterThanOrEqual(1);
  const collect = reports[0]!.data.orders.find((o: any) => o.task === "collect");
  expect(collect).toMatchObject({ state: "not_carried_out" });
  expect(collect.why).toMatch(new RegExp(`^none of the \\d in post was at the depot \\(${depot.replace(/[.\/]/g, "\\$&")}\\) when the day's work was set out$`));
  expect(reports[0]!.data.staff.every((x: any) => x.no_place === true && x.last === undefined)).toBe(true);
  // At the seat's next sitting: each in post has not come in, and why; each order is not carried out, and why.
  const last = shown.filter((x) => x.includes("Staff of your office")).at(-1)!;
  expect(last).toMatch(/under rec\.\d+, has not come in to work: no place of work in the employment agreement or in an advertisement it cites/);
  expect(last).toMatch(/- rec\.\d+, collect every 7 days: not carried out: none of the \d in post was at the depot/);
}, 600_000);

// An office that buys from outside can place the order (the shake-down review, fault 3). In the first utilities pilot
// the energy seat's stock ran low and it had no paper to order with: its payments to the world market, with no order
// waiting for them, were sent back, and the market's letters never said what an order is. Here the seat has the
// office's order form, which says how buying is done; an order on it, paid in full, is delivered; a payment alone is
// sent back, as before.
test("an energy seat orders from the grid on its own order form and is delivered; a payment with no order is sent back; its stationery says how", async () => {
  const config = generate({ ...spec, opening_orders: false, model_seats: ["energy-operations"] });
  const market = officeAt(config, "outside-trade").params;
  const own = officeAt(config, "energy-operations-staff").params;
  const price = (market.sells.energy / 100).toFixed(2), least = Math.max(market.min_order ?? 100, 500);
  const sum = (n: number) => ((n * market.sells.energy) / 100).toFixed(2);
  const energy: Sitting[] = [
    { day: 0, asks: () => [
      { what: "The staff supply the customers each day.", program: `work(at=${own.depot}, every="every day", task=supply_energy)` },
      { what: "The staff bill the customers each month.", program: `work(at=${own.depot}, every="every 30 days", task=bill)` }] },
    { day: 3, asks: () => [{ what: `Order ${least} energy from outside, paying with the order.`,
      program: `form(account=acc-energy-co, at=${own.depot}, deliver_to=energy-co, form=order, kind="energy", quantity="${least}", seller=outside, to=energy-operations, unit_price="${price}")\nmoney(amount="${sum(least)}", for="Order: ${least} energy.", from=acc-energy-co, to=acc-outside)` }] },
    { day: 6, asks: () => [{ what: "Pay the outside world for 700 energy.", program: `money(amount="${sum(700)}", for="700 energy", from=acc-energy-co, to=acc-outside)` }] },
    { day: 9, asks: () => [] },
  ];
  const seats = scriptedSeats({ "energy-operations": energy });
  const s = await runWorld({ config, runId: "office-order", outDir: mkdtempSync(join(tmpdir(), "oikos-office-order-")), until: 11 * DAY, adapter: seats.adapter, recordObservations: "none", recordDecisions: "none" });
  expect(s.participantErrors).toBe(0);
  const events = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
  const records = events.filter((e) => e.event === "recorded").map((e) => e.record);
  // The order: the paper the staff's own orders to the grid are, made by the seat; delivered once paid.
  const order = records.find((r) => r.kind === "order" && r.in_position === "energy-operations")!;
  expect(order).toMatchObject({ speaks_for: "energy-co", addressed_to: ["outside"], data: { kind: "energy", quantity: least, unit_price: market.sells.energy, deliver_to: "energy-co", at: own.depot, account: "acc-energy-co" } });
  expect(events.some((e) => e.event === "goods_moved" && e.from === "outside" && e.to === "energy-co" && e.kind === "energy" && Number(e.quantity) === least && e.t >= order.at)).toBe(true);
  expect(records.some((r) => r.kind === "delivery_note" && r.data?.order === order.id && r.data.delivered === least)).toBe(true);
  // The payment with no order: the market sends it back, and delivers nothing for it.
  const bare = String(700 * market.sells.energy);
  const out = events.find((e) => e.event === "transfer" && e.from === "acc-energy-co" && e.to === "acc-outside" && e.amount === bare)!;
  expect(out).toBeDefined();
  expect(events.some((e) => e.event === "transfer" && e.from === "acc-outside" && e.to === "acc-energy-co" && e.amount === bare && e.t >= out.t)).toBe(true);
  expect(events.filter((e) => e.event === "goods_moved" && e.from === "outside" && e.to === "energy-co" && Number(e.quantity) === 700)).toEqual([]);
  // What the seat is told: its order form among its stationery, with what it is for and how the order is paid.
  const form = seats.shown[0]!.system.split("\n").find((l) => l.startsWith("- [form-energy-operations-order]"))!;
  expect(form).toContain("How the office buys from a supplier, the outside world's market among them");
  expect(form).toContain("The form pays nothing by itself: pay the whole sum");
  expect(form).toContain("sends back money that comes with no order waiting for it");
  // And its staff's report says what was supplied and what is held.
  expect(records.some((r) => r.kind === "staff_report" && r.data.office === "energy-operations" && /supply_energy \(rec\.\d+, every 1 day\): carried out: \d+ days' supply, \d+ units; \d+ energy held/.test(r.text))).toBe(true);
}, 600_000);

// A billing order is followed from when it is made (the shake-down review, fault 7). In the first utilities pilot the
// water seat ordered bills every 30 days and none went out in 43: the billing staff kept the office's own first date
// (a quarter in) whatever the order said, and nothing told the seat when bills were due. Here the first round goes
// out one period after the order, and each office's staff report how its orders stand.
test("bills go out one period after a standing billing order is made; the staff of the water, rates, clinic and school offices each report how their orders stand", async () => {
  const config = generate({ ...spec, opening_orders: false, model_seats: ["water-operations", "rates", "clinic-manager", "principal"] });
  const params = (id: string) => officeAt(config, `${id}-staff`).params;
  const at = { water: params("water-operations").works, clinic: params("clinic-manager").building, school: params("principal").building };
  const idle = [4, 8, 11, 14].map((day) => ({ day, asks: () => [] }));
  const seats = scriptedSeats({
    "water-operations": [{ day: 0, asks: () => [
      { what: "The works draws what the town uses each day.", program: `work(at=${at.water}, every="every 1 day", task=draw_water)` },
      { what: "Bills every 10 days.", program: `work(at=${at.water}, every="every 10 days", task=bill)` }] }, ...idle],
    rates: [{ day: 0, asks: () => [{ what: "The clerks send the notices at each instalment.", program: 'work(at=rates, every="every 91 days", task=levy)' }] }, ...idle],
    "clinic-manager": [{ day: 0, asks: () => [{ what: "The doctors see those waiting each working day.", program: `work(at=${at.clinic}, every="every day", task=treat)` }] }, ...idle],
    principal: [{ day: 0, asks: () => [
      { what: "Every classroom is taught each school day.", program: `work(at=${at.school}, every="every day", task=teach)` },
      { what: "Enrolments are answered.", program: `work(at=${at.school}, every="every day", task=enrol)` }] }, ...idle],
  });
  const s = await runWorld({ config, runId: "office-bills", outDir: mkdtempSync(join(tmpdir(), "oikos-office-bills-")), until: 16 * DAY, adapter: seats.adapter, recordObservations: "none", recordDecisions: "none" });
  expect(s.participantErrors).toBe(0);
  const records = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.kind === "event" && e.body.event === "recorded").map((e) => e.body.record);
  // The water bills: the first round ten days after the order, and not before.
  const order = records.find((r) => r.kind === "work_order" && r.data.work.task === "bill")!;
  const bills = records.filter((r) => r.kind === "invoice" && r.data?.service === "water" && r.in_position === "water-operations-staff");
  expect(bills.length).toBeGreaterThan(10);
  expect(Math.min(...bills.map((b) => b.at))).toBeGreaterThanOrEqual(order.at + 10 * DAY);
  expect(Math.min(...bills.map((b) => b.at))).toBeLessThan(order.at + 11 * DAY);
  // Before them, the staff's report said when they were due; after, that they went.
  const of = (office: string) => records.filter((r) => r.kind === "staff_report" && r.data.office === office);
  expect(of("water-operations")[0]!.text).toMatch(/draw_water \(rec\.\d+, every 1 day\): carried out: 1 days' draw, \d+ kL\. bill \(rec\.\d+, every 10 days\): in force; nothing fell due; the meters are read from year 1, day 1 and the next bills go out on year 1, day 11\./);
  expect(of("water-operations").some((r) => r.data.orders.some((o: any) => o.task === "bill" && o.state === "followed" && o.times === bills.length))).toBe(true);
  // The rates clerks, the doctors and the teachers report too, each to their own office.
  expect(of("rates").find((r) => /levy \(rec\./.test(r.text))!.text).toMatch(/^Report of the rates clerks, year 1, day \d+, on the work under the office's standing work orders( since year 1, day \d+)?\. levy \(rec\.\d+, every 91 days\): in force; nothing fell due; (no property has been valued yet|the next notices go out on year 1, day \d+)/);
  // (The first report of the rates clerks and of the teachers that has the order in it: the person in the seat has the rest of their own time to spend as well, and the first report, on the second day, can come before the order is made: foundations F5.)
  // (Some report of theirs, not the first: the town's one doctor is now someone whose first working day is the
  // fourth, and the first report says, rightly, that nobody was at the clinic when it opened.)
  expect(of("clinic-manager").some((r) => /^Report of the clinic's doctors, .*treat \(rec\.\d+, every 1 day\): (carried out: \d+ patients seen|in force; nothing fell due).* In post \d+: c\d+ /.test(r.text))).toBe(true);
  expect(of("principal").find((r) => /teach \(rec\.\d+, every 1 day\): carried out/.test(r.text))!.text).toMatch(/^Report of the school's teachers, .*teach \(rec\.\d+, every 1 day\): carried out: \d+ lessons.* In post \d+: c\d+ last worked year 1, day \d+ \(teach\)/);
  // And the seats that have a roster see it there: when each last worked, and each order as reported.
  const roster = seats.shown.filter((x) => x.seat === "principal" && x.text.includes("Staff of your office")).at(-1)!.text;
  expect(roster).toMatch(/last at work year 1, day \d+ \(teach\)/);
  expect(roster).toMatch(/- rec\.\d+, teach every 1 day: carried out: \d+ lessons/);
}, 600_000);

test("every office that buys in has an order form that says how buying is done; the world market's answer to a letter says what an order is", () => {
  for (const name of ["utility.energy", "firm.retailer", "firm.producer", "firm.builder"]) {
    const order = (modules[name]!.issues ?? []).find((f) => f.form === "order");
    expect(`${name}: ${order?.does ?? ""}`).toMatch(/: How the office buys from a supplier.*pay the whole sum.*delivers once an order is paid in full/);
    expect(order!.writes.kind).toBe("order");
  }
  expect(modules["world.trade"]!.answers!.acts).toContain("a paper on the buyer's own order form, addressed to it, with the whole sum paid into the account its price list names");
  expect(modules["world.trade"]!.answers!.acts).toContain("sends back money that comes with no order waiting for it");
});
