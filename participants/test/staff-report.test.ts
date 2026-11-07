// An office held by a seat gets its work done, and can see that it is (docs/behaviour/standing-work.md, "The staff's
// report"; docs/behaviour/firms.md, "An offer made on an advertisement"). In the wave's first works pilot a crew of
// five was taken on by offers that named the pay and the advertisement and nothing else: no place of work, so nobody
// came to the depot, nothing was collected in 180 days, and nothing the seat was shown said why. Here: an offer made on
// an advertisement is on the advertisement's terms (where the work is, what the post is); and the staff report what
// they did under each standing order, or why not, at once when it changes and each week otherwise.

import { expect, test } from "bun:test";
import { advertisedJob, Book, jobTerms, StandingWork } from "../src/shared/common";
import { modules, Roster } from "../src/index";
import { inCurrency } from "../src/money";
import { context, DAY, statement, wake } from "./stepping";
import { engine } from "./engine";

inCurrency({ code: "XYZ", minor_units: 2 });

const book = (...records: object[]) => { const b = new Book(); b.absorb({ t: 0, entity: "city", channels: { all: { kind: "records", records } }, outcomes: [], inbox: [] } as any); return b; };
const order = (id: string, at: number, task: string, every: number, x: object = {}) =>
  statement(id, at, "work_order", { author: "works-system", in_position: "works", addressed_to: ["city"], visible_to: ["city"], data: { work: { task, at: "town-hall" }, every }, ...x });
const posting = (id: string, role: string, space?: string) => statement(id, 0, "job_posting", { data: { wage: 300_000, period: 14 * DAY, role, ...(space ? { space, workplace: space.split("/")[0] } : {}) } });
const application = (id: string, who: string, to: string) => statement(id, DAY, "job_application", { speaks_for: who, addressed_to: ["city"], visible_to: [who, "city"], data: { posting: to, account: `acc-${who}` }, basis: to });
/** An offer of employment as a seat's words were written: the pay, and what it cites; no place of work unless `at`. */
const offer = (id: string, worker: string, x: { basis?: string | string[]; at?: string; text?: string; signed?: number } = {}) => [
  { id, at: x.signed ?? 0, author: "works-system", in_position: "works", speaks_for: "city", record: "agreement", visible_to: ["city", worker], ...(x.basis ? { basis: x.basis } : {}),
    terms: { template: "employment", parties: ["city", worker], ...(x.text ? { text: x.text } : {}), commitments: [{ who: "city", does: { outcome: { money: { from: "acc-city", to: `acc-${worker}`, amount: "300000" } } }, every: 14 * DAY },
      ...(x.at ? [{ who: worker, does: { outcome: { occupancy: { who: worker, in: x.at } } } }] : [])] } },
  ...["city", worker].map((as) => ({ id: `sig-${id}-${as}`, at: x.signed ?? 0, author: "x", record: "signature", agreement: id, as, visible_to: ["city", worker] }))];

test("an offer of employment that names no place of work, made on an advertisement, is for work where the advertisement says", () => {
  const ad = posting("rec.10", "works crew", "town-hall/workplace.1");
  // The advertisement cited itself; cited through the application that answered it; both, in either order.
  for (const basis of ["rec.10", "rec.11", ["rec.10", "rec.11"], ["rec.11", "rec.10"]]) {
    const b = book(ad, application("rec.11", "c0001", "rec.10"), ...offer("rec.20", "c0001", { basis }));
    expect(advertisedJob(b, b.records.get("rec.20"))?.id).toBe("rec.10");
    expect(jobTerms(b.records.get("rec.20"), "c0001", b)).toEqual({ wage: 300_000, period: 14 * DAY, workplace: "town-hall/workplace.1" });
  }
  // What the offer itself says of the place stands, whatever it cites.
  const said = book(ad, ...offer("rec.20", "c0001", { basis: "rec.10", at: "depot-2/workplace.1" }));
  expect(jobTerms(said.records.get("rec.20"), "c0001", said).workplace).toBe("depot-2/workplace.1");
  // It cites nothing, or an advertisement that names no place, or one the reader was never shown: no place of work.
  const none = book(ad, ...offer("rec.20", "c0001"));
  expect(jobTerms(none.records.get("rec.20"), "c0001", none).workplace).toBeUndefined();
  const bare = book(posting("rec.10", "works crew"), ...offer("rec.20", "c0001", { basis: "rec.10" }));
  expect(jobTerms(bare.records.get("rec.20"), "c0001", bare).workplace).toBeUndefined();
  const unseen = book(...offer("rec.20", "c0001", { basis: "rec.10" }));
  expect(jobTerms(unseen.records.get("rec.20"), "c0001", unseen).workplace).toBeUndefined();
  // Read without the reader's papers (the pay alone is wanted): as the agreement says, and no more.
  expect(jobTerms(none.records.get("rec.20"), "c0001")).toEqual({ wage: 300_000, period: 14 * DAY, workplace: undefined });
});

// The works office's staff, with a round of two addresses; who is at the depot is the test's.
const params = { depot: "town-hall", workplace: "town-hall/workplace.1", landfill: "outside", wage: 300_000, period: 14 * DAY, round: "round", collect_labour: 60, collect_per_unit: 10_000, maintain_labour: 3600, maintain_per_unit: 100, depot_channel: "depot", part: "staff" };
const shown = (at: string[], ...records: object[]) => ({
  all: { kind: "records", records },
  round: { kind: "records", records: ["house-1", "house-2"].map((s) => statement(`round-${s}`, 0, "service_address", { visible_to: ["city"], data: { structure: s } })) },
  depot: { kind: "sites", cells: [{ cell: "cell.1.1", x: 1, y: 1, structure: { structure: "town-hall", type: "civic", at: "cell.1.1", complete: true, spaces: [{ space: "town-hall/workplace.1", kind: "workplace", capacity: 20, count: at.length, occupants: at }] } }] },
});
const staff = () => engine("city.works").create(context("works-staff-system", "city", params, { position: "works-staff" }));
const MONDAY = 7 * DAY + 8 * 3600;
const reports = (w: ReturnType<typeof wake>) => w.of("statement", "staff_report");

test("a crew whose offers named the advertisement is counted as the works crew; an offer for another office's post is not", () => {
  const papers = [posting("rec.10", "works crew", "town-hall/workplace.1"), posting("rec.12", "environmental scientist", "town-hall/workplace.1"), order("rec.1", DAY, "collect", 7 * DAY),
    ...offer("rec.20", "c0001", { basis: "rec.10" }), ...offer("rec.21", "c0002", { basis: "rec.10", text: "works crew" }), ...offer("rec.22", "c0009", { basis: "rec.12" })];
  const w = wake(staff(), MONDAY, shown(["c0001", "c0002", "c0009"], ...papers), { entity: "city" });
  // The round is worked by the two of the crew, and not by the scientist who shares the room.
  const by = w.of("work").filter((c) => c.args.task === "collect").map((c) => c.args.by);
  expect(by.length).toBe(2);
  for (const who of by) expect(who).toEqual(["c0001", "c0002"]);
  expect(reports(w)[0]!.args.data.staff.map((x: any) => x.person)).toEqual(["c0001", "c0002"]);
});

test("the staff report what they did under each order the day they first do it, and who was at work", () => {
  const papers = [order("rec.1", DAY, "collect", 7 * DAY), order("rec.2", DAY, "maintain", DAY), ...offer("rec.20", "c0001", { at: "town-hall/workplace.1" }), ...offer("rec.21", "c0002", { at: "town-hall/workplace.1" })];
  const w = wake(staff(), MONDAY, shown(["c0001"], ...papers), { entity: "city" });
  const [r] = reports(w);
  expect(r!.args.to).toEqual(["city"]);
  expect(r!.args.visible).toEqual(["city"]);
  expect(r!.args.data.office).toBe("works");
  expect(r!.args.data.orders).toEqual([
    { order: "rec.1", task: "collect", every: 7 * DAY, state: "followed", times: 2, units: 2, says: "carried out: 2 calls at addresses, 2 loads" },
    { order: "rec.2", task: "maintain", every: DAY, state: "followed", says: "in force; nothing fell due" }]);
  expect(r!.args.data.staff).toEqual([{ person: "c0001", last: MONDAY, task: "collect" }, { person: "c0002" }]);
  expect(r!.args.text).toBe("Report of the works crew, year 1, day 8, on the work under the office's standing work orders. collect (rec.1, every 7 days): carried out: 2 calls at addresses, 2 loads. maintain (rec.2, every 1 day): in force; nothing fell due. In post 2: c0001 last worked year 1, day 8 (collect); c0002 has not come in to work.");
});

test("nobody of the crew at the depot: the order is not carried out, and the report says so and why", () => {
  const papers = [order("rec.1", DAY, "collect", 7 * DAY), ...offer("rec.20", "c0001"), ...offer("rec.21", "c0002", { at: "town-hall/workplace.1" })];
  const w = wake(staff(), MONDAY, shown([], ...papers), { entity: "city" });
  expect(w.of("work")).toEqual([]);
  const [r] = reports(w);
  expect(r!.args.data.orders).toEqual([{ order: "rec.1", task: "collect", every: 7 * DAY, state: "not_carried_out",
    why: "none of the 2 in post was at the depot (town-hall/workplace.1) when the day's work was set out", says: "not carried out: none of the 2 in post was at the depot (town-hall/workplace.1) when the day's work was set out" },
    // (The crew's other routine has no order on file: said too.)
    { task: "maintain", every: 0, state: "no_order", says: "not being done: no standing work order for maintain is on file, and with none the staff do not do it (whoever holds the office makes one)" }]);
  // Who has nowhere to come to: the one whose agreement names no place of work and cites no advertisement.
  expect(r!.args.data.staff).toEqual([{ person: "c0001", no_place: true }, { person: "c0002" }]);
  expect(r!.args.text).toContain("In post 2: c0001 has not come in to work (no place of work in the employment agreement or the advertisement it cites); c0002 has not come in to work.");
  // Someone taken on today is expected tomorrow: nothing is reported on their first day.
  const today = wake(staff(), MONDAY, shown([], order("rec.1", DAY, "collect", 7 * DAY), ...offer("rec.20", "c0001", { at: "town-hall/workplace.1", signed: MONDAY - 3600 })), { entity: "city" });
  expect(reports(today)).toEqual([]);
});

test("with nobody in post there is nobody to report; a routine with no order on file is reported as not being done", () => {
  expect(reports(wake(staff(), MONDAY, shown([], order("rec.1", DAY, "collect", 7 * DAY)), { entity: "city" }))).toEqual([]);
  // (Wave 2c: a works crew of five collected nothing in 45 days and a clerk's drafters wrote no amendment into law in
  // 400, and neither office heard a word, because the staff reported only on orders that existed.)
  const [r] = reports(wake(staff(), MONDAY, shown(["c0001"], ...offer("rec.20", "c0001", { at: "town-hall/workplace.1" })), { entity: "city" }));
  expect(r!.args.data.orders.map((x: any) => [x.order, x.task, x.state])).toEqual([[undefined, "collect", "no_order"], [undefined, "maintain", "no_order"]]);
  expect(r!.args.text).toContain("collect: not being done: no standing work order for collect is on file, and with none the staff do not do it (whoever holds the office makes one).");
  // One routine ordered, the other not: each is said as it stands.
  const [one] = reports(wake(staff(), MONDAY, shown(["c0001"], order("rec.1", DAY, "collect", 7 * DAY), ...offer("rec.20", "c0001", { at: "town-hall/workplace.1" })), { entity: "city" }));
  expect(one!.args.data.orders.map((x: any) => [x.order, x.task, x.state === "no_order"])).toEqual([["rec.1", "collect", false], [undefined, "maintain", true]]);
});

test("an office's first day is not reported as work not ordered; said once, then weekly; and no more once the order is made", () => {
  const routines = new StandingWork("city", "staff");
  const none = book();
  const tell = (b: Book, day: number) => routines.report(b, day * DAY + 8 * 3600, { office: "council-clerk", from: "the clerk's drafters", tasks: { enact: ["amendments written into law"] } });
  expect(tell(none, 0)).toEqual([]);
  routines.note("enact", "1 amendment the council has passed and the clerk has declared waits to be written into law");
  const first = tell(none, 1);
  expect(first).toHaveLength(1);
  expect(JSON.stringify(first)).toContain("enact: not being done: no standing work order for enact is on file, and with none the staff do not do it (whoever holds the office makes one); 1 amendment the council has passed and the clerk has declared waits to be written into law.");
  for (let d = 2; d <= 7; d++) expect(tell(none, d)).toEqual([]);
  expect(tell(none, 8)).toHaveLength(1);
  // The order made: how it stands has changed, said the next day, and nothing of "no order" after.
  const made = book(order("rec.1", 9 * DAY, "enact", DAY));
  const after = tell(made, 10);
  expect(after).toHaveLength(1);
  expect(JSON.stringify(after)).not.toContain("no_order");
});

test("an order for a task the staff do not have, one on hold and one not yet begun are each said as they stand", () => {
  const hold = statement("rec.5", 2 * DAY, "hold", { addressed_to: ["city"], visible_to: ["city"], data: { holds: ["rec.2"] } });
  const papers = [order("rec.1", DAY, "sweep", 7 * DAY), order("rec.2", DAY, "maintain", DAY), hold, order("rec.3", 6 * DAY, "collect", 7 * DAY, { data: { work: { task: "collect", at: "town-hall" }, every: 7 * DAY, first: 30 * DAY } }),
    ...offer("rec.20", "c0001", { at: "town-hall/workplace.1" })];
  const [r] = reports(wake(staff(), MONDAY, shown(["c0001"], ...papers), { entity: "city" }));
  expect(r!.args.data.orders.map((x: any) => [x.order, x.state, x.says])).toEqual([
    ["rec.1", "no_such_task", 'not carried out: the staff have no routine called "sweep" (their routines: collect, maintain)'],
    ["rec.2", "on_hold", "on hold: not carried out while the hold stands"],
    ["rec.3", "not_begun", "begins year 1, day 37"]]);
});

test("a report at once when how an order stands changes, and each week otherwise", () => {
  const routines = new StandingWork("city", "staff");
  const b = book(order("rec.1", 0, "collect", 7 * DAY));
  const tell = (day: number) => routines.report(b, day * DAY + 8 * 3600, { office: "works", from: "the works crew", tasks: { collect: ["calls at addresses", "loads"] }, inPost: ["c0001"] }).length;
  routines.did("collect", 8 * 3600, { units: 3, by: ["c0001"] });
  expect(tell(0)).toBe(1); // the first
  for (let d = 1; d <= 6; d++) { routines.did("collect", d * DAY, { units: 1 }); expect(tell(d)).toBe(0); }
  routines.did("collect", 7 * DAY, { units: 1 });
  expect(tell(7)).toBe(1); // a week on
  routines.heldUp("collect", "none of the 1 in post was at the depot");
  expect(tell(8)).toBe(1); // it stopped: said the day it is found
  routines.heldUp("collect", "none of the 1 in post was at the depot");
  expect(tell(9)).toBe(0); // still stopped, for the same reason: next week
  routines.did("collect", 10 * DAY, { units: 1, by: ["c0001"] });
  expect(tell(10)).toBe(1); // carried out again
  // The office-holder and a whole office keep no such count and make no report.
  for (const part of ["", "seat"] as const) {
    const other = new StandingWork("city", part);
    other.did("collect", 0, { units: 1 });
    expect(other.report(b, 8 * 3600, { office: "works", from: "the works crew", tasks: { collect: ["calls"] }, inPost: ["c0001"] })).toEqual([]);
  }
});

test("the office-holder's list of its standing orders is its own organisation's: another body's order for the same task, seen on the file, is not among them", () => {
  const roster = new Roster(context("works-system", "city", {}, { position: "works" }), "city", "works", { role: "crew member" } as any, ["collect"]);
  roster.absorb({ t: 2 * DAY, entity: "city", channels: { all: { kind: "records", records: [
    order("ord-ours", DAY, "collect", 7 * DAY),
    order("ord-county", DAY, "collect", 7 * DAY, { author: "county-works", in_position: undefined, speaks_for: "county" }),
  ] } }, outcomes: [], inbox: [] } as any);
  expect(roster.orders(2 * DAY).map((o) => o.order)).toEqual(["ord-ours"]);
});
