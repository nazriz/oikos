// What a townsperson knows of land (docs/behaviour/ownership.md, "What an owner knows, and what is looked up"), on what
// they are shown alone. Nobody is shown the land register: a title of theirs reaches them as their own paper, and the
// rest is looked up where it is kept, once: the plan of a lot they hold, and, for a title passed to them, the title and
// the dealings in it, read in the order made. Whether they count a house as theirs is seen in whether they go on
// looking for one to rent.

import { expect, test } from "bun:test";

import { inCurrency } from "../src/money";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";
import { DAY, employment, person, signed, statement } from "./stepping";
import { engine } from "./engine";
const citizen = engine("citizen.default");

inCurrency(PROFILE.values.currency);

const REGISTER = { register: { lots: "lots", titles: "titles", dealings: "dealings" } };
const HOME = "house-7/dwelling.1";
const lot = (id: string, cell: string) => statement(id, 0, "lot", { text: `Lot ${id}.`, data: { cells: [cell] } });
const title = (id: string, holder: string, of: string) => ({ id, at: 0, record: "claim", author: "genesis", speaks_for: "city", visible_to: "public", position: "right", holder, about: { kind: "ownership", object: of } });
const transfer = (id: string, at: number, claim: string, to: string, by: string) => ({ id, at, record: "claim_transfer", author: `${by}-x`, speaks_for: by, visible_to: "public", claim, to });
/** The street as the person sees it: the house on the lot's cell, and who is in it. */
const street = (who: string[]) => [{ cell: "cell.3.4", x: 3, y: 4, structure: { structure: "house-7", type: "house", complete: true, spaces: [{ space: HOME, kind: "dwelling", capacity: 6, count: who.length, occupants: who }] } }];

/** A land register that answers searches as the kernel's does (a record by its id, a dealing by the title it names),
 * and keeps every look made of it or of the boards. */
function register(records: any[]) {
  const asked: { channel: string; query?: any }[] = [];
  const rounds: string[][] = []; // each look made, as the channels it asked through
  const shows: { [channel: string]: (r: any) => boolean } = { lots: (r) => r.kind === "lot", titles: (r) => r.record === "claim", dealings: (r) => r.record === "claim_transfer" || r.record === "claim_release" };
  const field = (r: any, f: string) => (f === "id" ? r.id : f === "claim" ? r.claim : f.startsWith("about.") ? r.about?.[f.slice(6)] : undefined);
  return {
    asked, rounds,
    of: (channel: string) => asked.filter((l) => l.channel === channel).map((l) => l.query?.where?.[0]?.value),
    looked: (looks: { channel: string; query?: any }[]) => {
      asked.push(...looks);
      rounds.push(looks.map((l) => l.channel));
      return Object.fromEntries(looks.filter((l) => shows[l.channel]).map((l) => [l.channel,
        records.filter((r) => shows[l.channel]!(r) && (l.query?.where ?? []).every((c: any) => c.op === "=" && field(r, c.field) === c.value)).sort((a, b) => a.at - b.at).slice(0, l.query?.limit ?? 20)]));
    },
  };
}
/** Is the person looking for a home to rent at this wake? (Someone who counts a home as theirs isn't.) */
const hunting = (r: ReturnType<typeof register>, from: number) => r.asked.slice(from).some((l) => l.channel === "homes");

test("an owner from the start knows their title unasked, looks up the plan of its lot once, and has their home", async () => {
  const reg = register([lot("lot-7", "cell.3.4"), lot("lot-8", "cell.9.9"), title("title-7", "c1", "lot-7"), title("title-8", "c2", "lot-8")]);
  const p = person(citizen, REGISTER);
  // Their own title is among their own papers; nothing else of the register is shown.
  await p.wake(DAY, { records: [title("title-7", "c1", "lot-7")], balance: 500_000, street: street(["c1"]), in: HOME, looked: reg.looked });
  expect(reg.of("lots")).toEqual(["lot-7"]);
  expect(reg.of("titles")).toEqual([]);
  // (One look: the plan is asked for with the glance at the boards, not in a look of its own before it; and no glance at
  // the homes to rent while it is out: an owner in the house it owns is not hunting for one (years at 10,000, 2026-10-31).)
  expect(reg.rounds).toEqual([["lots", "jobs", "petitions"]]);
  expect(reg.asked.find((l) => l.channel === "lots")!.query).toEqual({ where: [{ field: "id", op: "=", value: "lot-7" }], limit: 1 });
  // From then on they have a home (no hunt for one to rent), and never ask for the plan again.
  for (const day of [8, 15, 40]) {
    const from = reg.asked.length;
    await p.wake(day * DAY, { balance: 500_000, street: street(["c1"]), in: HOME, looked: reg.looked });
    expect(hunting(reg, from)).toBe(false);
  }
  expect(reg.of("lots")).toEqual(["lot-7"]);
});

test("a title passed to them is read in the register, with the dealings in it, before the land counts as theirs", async () => {
  // The registry passes a dead parent's title to c1 (as the issuer of titles): the transfer names c1, the title doesn't.
  const passed = transfer("rec.50", 5 * DAY, "title-7", "c1", "city");
  const reg = register([lot("lot-7", "cell.3.4"), title("title-7", "c9", "lot-7"), passed]);
  const p = person(citizen, REGISTER);
  await p.wake(DAY, { balance: 500_000, street: street(["c1"]), in: HOME, looked: reg.looked });
  expect([reg.of("titles"), reg.of("dealings"), reg.of("lots")]).toEqual([[], [], []]);
  // With no title, they are looking for a home.
  let from = reg.asked.length;
  await p.wake(3 * DAY, { balance: 500_000, street: street(["c1"]), in: HOME, looked: reg.looked });
  expect(hunting(reg, from)).toBe(true);
  // The transfer arrives: the title and its dealings in one look, then the plan of the lot it names.
  from = reg.asked.length;
  await p.wake(8 * DAY, { records: [passed], balance: 500_000, street: street(["c1"]), in: HOME, looked: reg.looked });
  expect(reg.asked.slice(from).filter((l) => ["lots", "titles", "dealings"].includes(l.channel)).map((l) => [l.channel, l.query.where[0]])).toEqual([
    ["titles", { field: "id", op: "=", value: "title-7" }], ["dealings", { field: "claim", op: "=", value: "title-7" }], ["lots", { field: "id", op: "=", value: "lot-7" }]]);
  // Theirs now: no more hunting, and nothing asked twice.
  from = reg.asked.length;
  await p.wake(15 * DAY, { balance: 500_000, street: street(["c1"]), in: HOME, looked: reg.looked });
  expect(hunting(reg, from)).toBe(false);
  expect([reg.of("titles"), reg.of("dealings"), reg.of("lots")]).toEqual([["title-7"], ["title-7"], ["lot-7"]]);
});

test("a title that came down a chain is theirs only if each hand that passed it on held it", async () => {
  // c9's title, sold to c8, and by c8 to c1: borne out. The same last transfer with c8 never having held it: not.
  const sale = transfer("rec.40", 2 * DAY, "title-7", "c8", "c9"), on = transfer("rec.60", 6 * DAY, "title-7", "c1", "c8");
  for (const [chain, theirs] of [[[sale, on], true], [[on], false]] as const) {
    const reg = register([lot("lot-7", "cell.3.4"), title("title-7", "c9", "lot-7"), ...chain]);
    const p = person(citizen, REGISTER);
    await p.wake(DAY, { balance: 500_000, street: street(["c1"]), in: HOME, looked: reg.looked });
    await p.wake(8 * DAY, { records: [on], balance: 500_000, street: street(["c1"]), in: HOME, looked: reg.looked });
    expect(reg.of("titles")).toEqual(["title-7"]);
    // (The plan is looked up only for land that is theirs.)
    expect(reg.of("lots")).toEqual(theirs ? ["lot-7"] : []);
    const from = reg.asked.length;
    await p.wake(15 * DAY, { balance: 500_000, street: street(["c1"]), in: HOME, looked: reg.looked });
    expect(hunting(reg, from)).toBe(!theirs);
  }
});

test("what the register doesn't answer is asked once, not again and again", async () => {
  // A transfer naming a title the register has no record of, and a title of theirs whose lot has no plan.
  const reg = register([]);
  const p = person(citizen, REGISTER);
  await p.wake(DAY, { records: [title("title-7", "c1", "lot-7"), transfer("rec.9", 0, "title-x", "c1", "c5")], balance: 500_000, street: street(["c1"]), in: HOME, looked: reg.looked });
  for (const day of [8, 15]) await p.wake(day * DAY, { balance: 500_000, street: street(["c1"]), in: HOME, looked: reg.looked });
  expect([reg.of("titles"), reg.of("dealings"), reg.of("lots")]).toEqual([["title-x"], ["title-x"], ["lot-7"]]);
});

test("in a world that gives them no register to search, they look nothing up and know what they are shown", async () => {
  const reg = register([]);
  const p = person(citizen, {});
  await p.wake(DAY, { records: [lot("lot-7", "cell.3.4"), title("title-7", "c9", "lot-7"), transfer("rec.50", 0, "title-7", "c1", "c9")], balance: 500_000, street: street(["c1"]), in: HOME, looked: reg.looked });
  const from = reg.asked.length;
  await p.wake(8 * DAY, { balance: 500_000, street: street(["c1"]), in: HOME, looked: reg.looked });
  expect(hunting(reg, from)).toBe(false);
  expect(reg.asked.some((l) => ["lots", "titles", "dealings"].includes(l.channel))).toBe(false);
});

test("someone in work reads the enterprise agreements at their own workplace when they plan, and nobody else's", async () => {
  // (docs/behaviour/unions.md: every workplace's agreement used to be shown to everyone.)
  const reg = register([]);
  const p = person(citizen, { work_board: "work" });
  const job = { records: signed(employment("J1", 2 * DAY, "factory-1", "c1", 120_000)), readings: { J1: { of: "agreement", status: "in_force" } } };
  // Out of work at the first plan: nothing to read. In work from then on: their employer's, made since they started.
  await p.wake(3 * DAY, { ...job, balance: 500_000, looked: reg.looked });
  expect(reg.of("work")).toEqual([]);
  await p.wake(10 * DAY, { balance: 500_000, looked: reg.looked });
  await p.wake(17 * DAY, { balance: 500_000, looked: reg.looked });
  const asked = reg.asked.filter((l) => l.channel === "work");
  expect(asked.map((l) => l.query.where)).toEqual([0, 1].map(() => [{ field: "data.employer", op: "=", value: "factory-1" }, { field: "at", op: ">=", value: 2 * DAY }]));
  // With no board to read (a world that shows them the agreements), they ask for none.
  const q = person(citizen, {});
  const none = register([]);
  await q.wake(3 * DAY, { ...job, balance: 500_000, looked: none.looked });
  await q.wake(10 * DAY, { balance: 500_000, looked: none.looked });
  expect(none.of("work")).toEqual([]);
});
