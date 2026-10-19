// Another adult of a household (docs/behaviour/households.md "Other adults"), on what they're shown alone: they move
// when the leaseholder says, pay their share of the rent by standing order to the leaseholder, and leave town with the
// household; a move the world refuses; and a word from the leaseholder that reaches them while a wake of theirs is
// under way (the same-moment rule), which must not be left waiting.

import { expect, test } from "bun:test";

import { SAYING } from "./sayings";
import { inCurrency } from "../src/money";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";
import { DAY, employment, person, signed, statement, type Said } from "./stepping";
import { engine } from "./engine";
const citizen = engine("citizen.default");

inCurrency(PROFILE.values.currency);

const YEAR = 365 * DAY, HOUR = 3600, WAGE = 120_000;
const OLD = "apts-1/dwelling.1", NEW = "apts-3/dwelling.2";
// c1 holds the lease; c2 is the other adult (the one under test).
const household = statement("hh-1", 0, "household", { author: "genesis", speaks_for: "c1", visible_to: ["c1", "c2"], addressed_to: ["c1", "c2"], text: "Household: c1, c2.",
  data: { leaseholder: "c1", couples: [["c1", "c2"]], members: [{ person: "c1", participant: "c1-self", born_at: -40 * YEAR, sex: "female" }, { person: "c2", participant: "c2-self", born_at: -35 * YEAR, sex: "male" }] } });
const START = [household, ...signed(employment("J1", 0, "factory-1", "c2", WAGE))];
const READINGS = { J1: { of: "agreement", status: "in_force" } };
const wages = (t: number) => [{ t: t - DAY, from: "acc-factory-1", to: "acc-c2", amount: String(WAGE), currency: "AUD", by: "bank", memo: "wages" }];
/** The buildings around them, and who is in each home. */
const street = (homes: { [space: string]: string[] }) => Object.entries(homes).map(([space, occupants], i) => ({ cell: `cell.${i}.0`, x: i, y: 0, structure: { structure: space.split("/")[0], type: "apartments", complete: true, spaces: [{ space, kind: "dwelling", capacity: 6, count: occupants.length, occupants }] } }));
const from = (who: string, text: string, id = "m1") => ({ id, from: `${who}-self`, t: 0, text });
const moves = (said: Said[]) => said.filter((c) => c.fn === "occupancy").map((c) => c.args);
const ROUND = { work_start: 9 * HOUR, work_end: 17 * HOUR, work_days: 5, school_start: 9 * HOUR, school_end: 15 * HOUR };
/** The other adult, living with the household in the old home, after their first look around. Day 0 is a Monday; they
 * are woken in the evening unless a test says otherwise. */
async function member(params: object = {}) {
  const p = person(citizen, params, { me: "c2" });
  await p.wake(DAY + 20 * HOUR, { records: START, readings: READINGS, balance: 300_000, transactions: wages(DAY), street: street({ [OLD]: ["c1", "c2"] }), in: OLD });
  return p;
}

test("another adult moves when the leaseholder says: out of the old home and into the new, in one act; words from anyone else, or other words, move no one", async () => {
  const p = await member();
  const at = 2 * DAY + 20 * HOUR;
  const here = { street: street({ [OLD]: ["c2"], [NEW]: ["c1"] }), in: OLD, woke_for: "news" };
  // Someone outside the household saying the same; the leaseholder saying something else.
  expect(moves(await p.wake(at, { ...here, inbox: [from("c9", SAYING.moveIn(NEW))] }))).toEqual([]);
  expect(moves(await p.wake(at + HOUR, { ...here, inbox: [from("c1", "We should move somewhere bigger.")] }))).toEqual([]);
  const said = await p.wake(at + 2 * HOUR, { ...here, inbox: [from("c1", SAYING.moveIn(NEW))] });
  expect(moves(said)).toEqual([{ in: OLD, who: "c2", leave: "yes" }, { in: NEW }]);
  expect(said.filter((c) => c.fn === "occupancy").map((c) => c.why)).toEqual(Array(2).fill(`The household has a new home (${NEW}): moving in with them.`));
  // Told again (the leaseholder says it once; a second letter changes nothing): already there.
  expect(moves(await p.wake(at + 3 * HOUR, { street: street({ [NEW]: ["c1", "c2"] }), in: NEW, woke_for: "news", inbox: [from("c1", SAYING.moveIn(NEW), "m2")] }))).toEqual([]);
});

test("told the tenancy has ended they move out; told their share of the rent they pay it monthly to the leaseholder, replace the order when it changes and stop it at nothing; told the household is leaving, they leave with it", async () => {
  const p = await member();
  const here = { street: street({ [OLD]: ["c1", "c2"] }), in: OLD, woke_for: "news" };
  const order = (said: Said[]) => said.filter((c) => c.fn === "money" && c.args.every).map((c) => c.args);
  const stopped = (said: Said[]) => said.filter((c) => c.fn === "statement" && c.args.withdraw).map((c) => c.args.withdraw);
  const first = await p.wake(3 * DAY, { ...here, inbox: [from("c1", SAYING.share(50_000, "acc-c1"))] });
  expect(order(first)).toEqual([{ to: "acc-c1", amount: "$500.00", from: "acc-c2", every: "30 days", first: "0 days", for: "Household share of the rent." }]);
  const share1 = first.find((c) => c.bind === "share")!.id!;
  // The same share again: nothing. A new share: the old order stopped, a new one made. Nothing to share: stopped.
  expect(order(await p.wake(4 * DAY, { ...here, inbox: [from("c1", SAYING.share(50_000, "acc-c1"), "m2")] }))).toEqual([]);
  const second = await p.wake(5 * DAY, { ...here, inbox: [from("c1", SAYING.share(60_000, "acc-c1"), "m3")] });
  expect(stopped(second)).toEqual([share1]);
  expect(order(second).map((o) => o.amount)).toEqual(["$600.00"]);
  const share2 = second.find((c) => c.bind === "share")!.id!;
  const none = await p.wake(6 * DAY, { ...here, inbox: [from("c1", SAYING.share(0, "acc-c1"), "m4")] });
  expect([stopped(none), order(none)]).toEqual([[share2], []]);
  // The tenancy ended: out (of the building they live in).
  const out = await p.wake(7 * DAY, { ...here, inbox: [from("c1", SAYING.moveOut("apts-1"), "m5")] });
  expect(moves(out)).toEqual([{ in: "apts-1", who: "c2", leave: "yes" }]);
  // Leaving town: notice at work, and gone.
  const gone = await p.wake(8 * DAY, { street: street({ [OLD]: [] }), woke_for: "news", inbox: [from("c1", SAYING.leaving(), "m6")] });
  expect(gone.map((c) => c.fn)).toEqual(["agreement", "statement", "presence"]);
  expect(gone[0]!.args).toMatchObject({ notice: "J1" });
  expect(gone[1]!.args).toMatchObject({ kind: "departure" });
  expect(gone[2]!.args).toEqual({ leave: "yes" });
  expect(gone[0]!.why).toBe("The household is leaving town: going with them.");
});

test("a move into the new home that the world refuses (the last tenants still there): with the daily round they go home to it when next they'd go home; without one it isn't tried again", async () => {
  const told = { street: street({ [OLD]: ["c2"], [NEW]: ["c8", "c9"] }), in: OLD, woke_for: "news", inbox: [from("c1", SAYING.moveIn(NEW))], refuse: (calls: Said[]) => (calls.some((c) => c.fn === "occupancy") ? "capacity_exceeded" : undefined) };
  // With the round (as the generated town has it): refused on Wednesday evening. Home is now the new home, so the
  // round takes them there: tried once more at once (refused again, and not again before where they belong next
  // changes), and again on Thursday evening, when they'd go home.
  const p = await member({ round: ROUND });
  expect(moves(await p.wake(2 * DAY + 20 * HOUR, told))).toEqual([{ in: OLD, who: "c2", leave: "yes" }, { in: NEW }, { in: NEW }]);
  expect(moves(await p.wake(2 * DAY + 21 * HOUR, { street: told.street, in: OLD }))).toEqual([]);
  const next = await p.wake(3 * DAY + 17 * HOUR, { street: street({ [OLD]: ["c2"], [NEW]: ["c1"] }), in: "factory-1/floor.1" });
  expect(next.map((c) => [c.args, c.why])).toEqual([[{ in: NEW }, `Home: ${NEW}.`]]);
  // DISAGREES WITH docs: households.md says the other adults "move when the leaseholder says". Without the daily round
  // (a world that gives citizens no `round`), a member whose move was refused counts itself as living in the new home
  // and never tries again: the leaseholder says it once, and nothing else takes the member there. (The leaseholder's
  // own refused move is tried again the next day: citizen.md "Signing and moving in".)
  const q = await member();
  expect(moves(await q.wake(2 * DAY + 20 * HOUR, told)).length).toBe(2);
  for (const day of [3, 4, 10, 17, 40]) expect(moves(await q.wake(day * DAY + 20 * HOUR, { street: street({ [OLD]: ["c2"], [NEW]: ["c1"] }), in: OLD, transactions: wages(day * DAY) }))).toEqual([]);
});

test("a leaseholder's word that reaches them as an act of theirs is done (both home from work at the same moment) waits for their next weekly plan", async () => {
  // DISAGREES WITH docs: households.md says the other adults "move when the leaseholder says" (and the town test, that
  // they follow at their next wake). With the daily round, a wake before the week's plan is due only takes them where
  // they belong, unless it's a wake for news. A word that arrives while an act of theirs is under way (going home from
  // work, as the leaseholder moves in and says so) comes with that act's end, not as news: it's kept, and heeded at
  // the next full plan, up to a week later, the member in the old home until then. (docs/gaps.md, phase A: "members
  // now follow a leaseholder a round later". Heeding it at once is a three-line change, tried on 2026-10-06 and taken
  // back out: it moves when people plan, and the deaths test, whose sightings of a death at home depend on that, fell
  // from 14 of 18 registered in time to 11. Reported, for a decision with that.)
  const p = await member({ round: ROUND });
  const t = 3 * DAY + 17 * HOUR; // work's end; they last planned two days before, at 20:00
  const home = street({ [OLD]: ["c2"], [NEW]: ["c1"] });
  expect(moves(await p.wake(t, { street: home, in: "factory-1/floor.1" }))).toEqual([{ in: OLD }]);
  expect(moves(await p.wake(t + 900, { street: home, in: OLD, woke_for: "done", inbox: [from("c1", SAYING.moveIn(NEW))] }))).toEqual([]);
  // Day after day, woken where they are (the old home), they stay...
  for (let h = 16; h < 123; h += 24) expect(moves(await p.wake(t + h * HOUR, { street: home, in: OLD, transactions: wages(t + h * HOUR) })).some((m) => m.in === NEW)).toBe(false);
  // ...until the week's plan, a week after their last (123 hours on): then they go.
  expect(moves(await p.wake(t + 123 * HOUR, { street: home, in: OLD, transactions: wages(t + 123 * HOUR) }))).toEqual([{ in: OLD, who: "c2", leave: "yes" }, { in: NEW }]);
  // The same word as news (it found them asleep, and woke them) is heeded at once.
  const q = await member({ round: ROUND });
  expect(moves(await q.wake(t + 3 * HOUR, { street: home, in: OLD, woke_for: "news", inbox: [from("c1", SAYING.moveIn(NEW))] }))).toEqual([{ in: OLD, who: "c2", leave: "yes" }, { in: NEW }]);
});

