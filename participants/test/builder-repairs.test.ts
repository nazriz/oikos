// A builder asked to repair: it takes a repair order once the money for it has come in, and its crew does the work in
// its own hours, oldest order first, telling the orderer when it is done; with no repair task it knows of none.

import { expect, test } from "bun:test";

import { inCurrency } from "../src/money";
import { context, DAY, employment, signed, statement, wake } from "./stepping";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";
import { engine } from "./engine";
const builder = engine("firm.builder");

inCurrency(PROFILE.values.currency);

const ME = "builder-1", YARD = "yard-1", HOUR = 3600, PRICE = 1_000;
const params = (more: object = {}) => ({ supplier: "supplier-1", yard: YARD, workplace: `${YARD}/shed`, working_day: 8 * HOUR, work_days: 7, ...more });
const REPAIR = { repair_task: "repair", repair_labour: HOUR, repair_price: PRICE };
const crew = ["w1", "w2"];
const jobs = crew.flatMap((w, i) => signed(employment(`J${i}`, 0, ME, w, 150_000)));
const order = (id: string, at: number, structure: string, units: number, account = "acc-landlord-1") =>
  statement(id, at, "repair_order", { author: "landlord-1-office", speaks_for: "landlord-1", addressed_to: [ME], visible_to: ["landlord-1", ME], data: { structure, units, account } });
const pay = (from: string, cents: number, at: number) => ({ from, to: `acc-${ME}`, amount: String(cents), at, for: "repair" });
const yard = { kind: "sites", as_of: 0, cells: [{ cell: "cell.1", structure: { structure: YARD, type: "yard", spaces: [{ space: `${YARD}/shed`, occupants: crew }] } }] };

/** One builder through some days; each day's wake shows it what is new that day: records, and money received. */
function days(m: any, plan: { [day: number]: { records?: any[]; paid?: any[] } }, n: number) {
  const out: ReturnType<typeof wake>[] = [];
  const ids = { n: 0 };
  const held: any[] = [...jobs];
  for (let d = 1; d <= n; d++) {
    held.push(...(plan[d]?.records ?? []));
    const books = { kind: "accounts", accounts: [{ account: `acc-${ME}`, holder: ME, custodian: "bank", currency: "AUD", balance: "100000000" }], transactions: plan[d]?.paid ?? [] };
    // (What the builder has said is shown it again, as the world would.)
    const w = wake(m, d * DAY + 9 * HOUR, { books, mine: { kind: "records", records: held }, yard }, { entity: ME, as: { participant: `${ME}-office-system` }, ids });
    held.push(...w.made);
    out.push(w);
  }
  return out;
}
const create = (more: object) => builder.create(context(`${ME}-office-system`, ME, params(more)));
const work = (ws: ReturnType<typeof wake>[]) => ws.flatMap((w) => w.of("work")).filter((c) => c.args.task === "repair");
const said = (ws: ReturnType<typeof wake>[], kind: string) => ws.flatMap((w) => w.of("statement", kind));

test("with no repair task, a repair order is ignored and the builder does what it did", () => {
  const plan = { 2: { records: [order("o1", 2 * DAY, "home-1", 3)], paid: [pay("acc-landlord-1", 3 * PRICE, 2 * DAY)] } };
  const withOrder = days(create({}), plan, 20);
  const without = days(create({}), {}, 20);
  expect(withOrder.map((w) => w.said.map((c) => [c.fn, c.args]))).toEqual(without.map((w) => w.said.map((c) => [c.fn, c.args])));
  expect(said(withOrder, "repair_declined")).toEqual([]);
});

test("an order whose money has come is repaired over the days the crew's hours allow, then the orderer is told", () => {
  // Two workers of eight hours: sixteen units a day, at an hour a unit; 40 units take three days.
  const ws = days(create(REPAIR), { 2: { records: [order("o1", 2 * DAY, "home-1", 40)], paid: [pay("acc-landlord-1", 40 * PRICE, 2 * DAY)] } }, 8);
  const calls = work(ws);
  expect(calls.map((c) => Number(c.args.units))).toEqual([16, 16, 8]);
  expect(calls.every((c) => c.args.on === "home-1" && c.args.at === YARD)).toBe(true);
  expect(calls[0]!.t).toBeGreaterThan(2 * DAY - 1);
  const done = said(ws, "repair_done");
  expect(done.length).toBe(1);
  expect(done[0]!.args).toMatchObject({ to: ["landlord-1"], basis: "o1", data: { order: "o1", structure: "home-1", units: 40 } });
  expect(said(ws, "repair_declined")).toEqual([]);
});

test("orders are done oldest first, whatever the order they were paid in", () => {
  const ws = days(create(REPAIR), {
    2: { records: [order("old", 2 * DAY, "home-1", 20), order("new", 2 * DAY + 100, "home-2", 10, "acc-landlord-2")], paid: [pay("acc-landlord-2", 10 * PRICE, 2 * DAY), pay("acc-landlord-1", 20 * PRICE, 2 * DAY)] },
  }, 8);
  expect(work(ws).map((c) => [c.args.on, Number(c.args.units)])).toEqual([["home-1", 16], ["home-1", 4], ["home-2", 10]]);
  expect(said(ws, "repair_done").map((c) => c.args.basis)).toEqual(["old", "new"]);
});

test("an order whose money has not come in 14 days is declined in writing, once", () => {
  const ws = days(create(REPAIR), { 2: { records: [order("o1", 2 * DAY, "home-1", 5)], paid: [pay("acc-landlord-1", 2 * PRICE, 2 * DAY)] } }, 30);
  expect(work(ws)).toEqual([]);
  const declined = said(ws, "repair_declined");
  expect(declined.length).toBe(1);
  expect(declined[0]!.args).toMatchObject({ to: ["landlord-1"], basis: "o1", data: { order: "o1", structure: "home-1" } });
  expect(declined[0]!.t).toBeGreaterThanOrEqual(16 * DAY);
});
