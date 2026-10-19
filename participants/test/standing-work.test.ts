// Standing work (docs/behaviour/standing-work.md): an office's routine is its staff's, who follow the organisation's
// standing work orders. Here: which order is in force (the latest for a task; begun, not ended, not on hold); and the
// works office in its three parts: the whole office, as code runs one, keeps its own round with no order; the
// office-holder alone sets the orders, once, and does none of the round; the staff do the round only under an order.

import { expect, test } from "bun:test";
import { Book, StandingWork } from "../src/shared/common";
import { modules } from "../src/index";
import { inCurrency } from "../src/money";
import { context, DAY, statement, wake } from "./stepping";
import { engine } from "./engine";

inCurrency({ code: "XYZ", minor_units: 2 });

const order = (id: string, at: number, task: string, every: number, x: { first?: number; until?: number; on?: string[] } = {}) =>
  statement(id, at, "work_order", { author: "works-system", in_position: "works", addressed_to: ["city"], visible_to: ["city"], data: { work: { task, at: "town-hall", ...(x.on ? { on: x.on } : {}) }, every, ...(x.first !== undefined ? { first: x.first } : {}), ...(x.until !== undefined ? { until: x.until } : {}) } });
const hold = (id: string, at: number, held: string[]) => statement(id, at, "hold", { addressed_to: ["city"], visible_to: ["city"], data: { holds: held } });
const withdrawal = (id: string, at: number, of: string) => ({ id, at, record: "withdrawal", author: "works-system", in_position: "works", speaks_for: "city", visible_to: ["city"], withdraws: of });
const book = (...records: object[]) => { const b = new Book(); b.absorb({ t: 0, entity: "city", channels: { all: { kind: "records", records } }, outcomes: [], inbox: [] } as any); return b; };

test("the order in force for a task: the latest standing one, once begun, until it ends, and not while it is on hold", () => {
  const staff = new StandingWork("city", "staff");
  expect(staff.order(book(), "collect", 10 * DAY)).toBeUndefined();
  expect(staff.order(book(order("rec.1", DAY, "collect", 7 * DAY)), "collect", 10 * DAY)).toMatchObject({ id: "rec.1", every: 7 * DAY, from: DAY, at: "town-hall" });
  // Another task's order is not this task's; another organisation's is not ours.
  expect(staff.order(book(order("rec.1", DAY, "maintain", DAY)), "collect", 10 * DAY)).toBeUndefined();
  expect(staff.order(book({ ...order("rec.1", DAY, "collect", 7 * DAY), speaks_for: "school" }), "collect", 10 * DAY)).toBeUndefined();
  // Begun `first` after it was made; over at `until`.
  const dated = book(order("rec.1", DAY, "collect", 7 * DAY, { first: 3 * DAY, until: 30 * DAY }));
  expect([3, 4, 29, 30].map((d) => !!staff.order(dated, "collect", d * DAY))).toEqual([false, true, true, false]);
  // A later order takes the earlier one's place in what the staff follow; withdrawn, the earlier stands again.
  const two = [order("rec.1", DAY, "collect", 7 * DAY), order("rec.2", 5 * DAY, "collect", 14 * DAY, { on: ["apts-1"] })];
  expect(staff.order(book(...two), "collect", 10 * DAY)).toMatchObject({ id: "rec.2", every: 14 * DAY, on: ["apts-1"] });
  expect(staff.order(book(...two, withdrawal("rec.3", 6 * DAY, "rec.2")), "collect", 10 * DAY)).toMatchObject({ id: "rec.1" });
  // On hold: not followed; the hold withdrawn: followed again. A hold by someone else is not ours.
  const held = [order("rec.1", DAY, "collect", 7 * DAY), hold("rec.5", 8 * DAY, ["rec.1"])];
  expect(staff.order(book(...held), "collect", 10 * DAY)).toBeUndefined();
  expect(staff.order(book(...held, withdrawal("rec.6", 9 * DAY, "rec.5")), "collect", 10 * DAY)).toMatchObject({ id: "rec.1" });
  expect(staff.order(book(order("rec.1", DAY, "collect", 7 * DAY), { ...hold("rec.5", 8 * DAY, ["rec.1"]), speaks_for: "bank" }), "collect", 10 * DAY)).toMatchObject({ id: "rec.1" });
});

test("who does a routine: the whole office by its own practice, the staff by the order in force, the office-holder never", () => {
  const b = book(order("rec.1", DAY, "collect", 14 * DAY));
  expect(new StandingWork("city", "").does(book(), "collect", 10 * DAY, { every: 7 * DAY })).toEqual({ every: 7 * DAY });
  expect(new StandingWork("city", "staff").does(book(), "collect", 10 * DAY, { every: 7 * DAY })).toBeUndefined();
  expect(new StandingWork("city", "staff").does(b, "collect", 10 * DAY, { every: 7 * DAY })).toMatchObject({ every: 14 * DAY, order: { id: "rec.1" } });
  expect(new StandingWork("city", "seat").does(b, "collect", 10 * DAY, { every: 7 * DAY })).toBeUndefined();
});

// The works office, with a crew of two at the depot and a round of two addresses, each seen once and holding waste.
const params = { depot: "town-hall", workplace: "town-hall/workplace.1", landfill: "outside", wage: 300_000, period: 14 * DAY, round: "round", collect_labour: 60, collect_per_unit: 10_000, maintain_labour: 3600, maintain_per_unit: 100, depot_channel: "depot" };
const job = (id: string, worker: string) => [{ id, at: 0, author: "works-system", record: "agreement", visible_to: ["city", worker], terms: { template: "employment", parties: ["city", worker], commitments: [{ who: "city", does: { outcome: { money: { to: `acc-${worker}`, amount: "300000", for: "wages" } } }, every: 14 * DAY }] } },
  ...["city", worker].map((as) => ({ id: `sig-${id}-${as}`, at: 0, author: "x", record: "signature", agreement: id, as, visible_to: ["city", worker] }))];
const shown = (...extra: object[]) => ({
  all: { kind: "records", records: [...job("job-1", "c0001"), ...job("job-2", "c0002"), ...extra] },
  round: { kind: "records", records: ["house-1", "house-2"].map((s) => statement(`round-${s}`, 0, "service_address", { visible_to: ["city"], data: { structure: s } })) },
  depot: { kind: "sites", cells: [{ cell: "cell.1.1", x: 1, y: 1, structure: { structure: "town-hall", type: "civic", at: "cell.1.1", complete: true, spaces: [{ space: "town-hall/workplace.1", kind: "workplace", capacity: 20, count: 2, occupants: ["c0001", "c0002"] }] } }] },
});
const works = (part: string) => engine("city.works").create(context(`works${part === "staff" ? "-staff" : ""}-system`, "city", { ...params, part }, { position: part === "staff" ? "works-staff" : "works" }));
const collected = (w: ReturnType<typeof wake>) => w.of("work").filter((c) => c.args.task === "collect" && !c.args.every).map((c) => c.args.on).sort();
const MONDAY = 7 * DAY + 8 * 3600;

test("the whole works office collects its round with no order, as it always has", () => {
  expect(collected(wake(works(""), MONDAY, shown(), { entity: "city" }))).toEqual(["house-1", "house-2"]);
});

test("the works staff collect only under a standing order in force: none, on hold, named addresses, withdrawn", () => {
  expect(collected(wake(works("staff"), MONDAY, shown(), { entity: "city" }))).toEqual([]);
  expect(collected(wake(works("staff"), MONDAY, shown(order("rec.1", DAY, "collect", 7 * DAY)), { entity: "city" }))).toEqual(["house-1", "house-2"]);
  expect(collected(wake(works("staff"), MONDAY, shown(order("rec.1", DAY, "collect", 7 * DAY), hold("rec.2", 2 * DAY, ["rec.1"])), { entity: "city" }))).toEqual([]);
  expect(collected(wake(works("staff"), MONDAY, shown(order("rec.1", DAY, "collect", 7 * DAY, { on: ["house-2"] })), { entity: "city" }))).toEqual(["house-2"]);
  expect(collected(wake(works("staff"), MONDAY, shown(order("rec.1", DAY, "collect", 7 * DAY), withdrawal("rec.3", 2 * DAY, "rec.1")), { entity: "city" }))).toEqual([]);
  // An order for another task is not an order to collect.
  expect(collected(wake(works("staff"), MONDAY, shown(order("rec.1", DAY, "maintain", DAY)), { entity: "city" }))).toEqual([]);
});

test("the works staff take nobody on, stand nobody down and answer no letters: those are the office-holder's", () => {
  const budget = statement("budget-1", 0, "budget", { data: { year: 1, lines: { staff: 5 * Math.floor((300_000 * 365 * DAY) / (14 * DAY)) } } });
  const w = wake(works("staff"), MONDAY, shown(budget, order("rec.1", DAY, "collect", 7 * DAY)), { entity: "city", inbox: [{ id: "msg.1", t: MONDAY, from: "mayor-system", to: ["works-staff-system"], text: "How is the round?" }] });
  expect(w.of("statement", "job_posting")).toEqual([]);
  expect(w.of("message")).toEqual([]);
  expect(w.of("agreement")).toEqual([]);
});

test("the works manager, with the crew a post of its own, sets the standing orders once, recruits, and does none of the round", () => {
  const budget = statement("budget-1", 0, "budget", { data: { year: 1, lines: { staff: 5 * Math.floor((300_000 * 365 * DAY) / (14 * DAY)) } } });
  const m = works("seat");
  const first = wake(m, MONDAY, shown(budget), { entity: "city" });
  expect(first.of("work").map((c) => c.args)).toEqual([{ task: "collect", at: "town-hall", every: "7 days" }, { task: "maintain", at: "town-hall", every: "1 days" }]);
  expect(first.of("statement", "job_posting")).toHaveLength(1);
  expect(collected(first)).toEqual([]);
  // Next day: nothing more is set; what it does from here is by exception.
  const second = wake(m, MONDAY + DAY, { ...shown(), all: { kind: "records", records: [order("rec.1", MONDAY, "collect", 7 * DAY), order("rec.2", MONDAY, "maintain", DAY)] } }, { entity: "city", inbox: [{ id: "msg.1", t: MONDAY + DAY, from: "mayor-system", to: ["works-system"], text: "How is the round?" }] });
  expect(second.of("work")).toEqual([]);
  expect(second.of("message")[0]!.args.text).toContain("Standing work orders the crew follows: rec.1 (collect every 7 days), rec.2 (maintain every 1 days).");
});

test("every routine a module declares names a task, says what doing it is, and names a parameter of the module's for where", () => {
  const declared = Object.values(modules).flatMap((m) => (m.routines ?? []).map((r) => `${m.name}: ${r.task}`)).sort();
  expect(declared).toEqual(["city.council_clerk: enact", "city.rates_officer: levy", "city.registry: answer", "city.works: answer", "city.works: collect", "city.works: maintain", "clinic.practice: treat", "office.desk: answer", "police.station: call_at_homes", "police.station: carry_out_warrants", "police.station: look_into_reports", "school.principal: enrol", "school.principal: teach", "tribunal.member: answer", "utility.energy: bill", "utility.energy: supply_energy", "utility.water: bill", "utility.water: draw_water", "world.transfers: pay_claims"]);
  for (const m of Object.values(modules)) for (const r of m.routines ?? []) expect(r.what.length).toBeGreaterThan(40);
});
