// A death at home (docs/behaviour/deaths.md), on what a townsperson is shown alone: an adult sees it at any wake at
// home, and of the adults there the first in the household's list reports it; a child with no adult of the household
// at home tells one, who reports it from wherever they are and learns from it where the household lives.

import { expect, test } from "bun:test";

import { SAYING } from "./sayings";
import { inCurrency } from "../src/money";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";
import { DAY, employment, lease, person, signed, statement, type Said } from "./stepping";
import { engine } from "./engine";
const citizen = engine("citizen.default");

inCurrency(PROFILE.values.currency);

const YEAR = 365 * DAY, HOUR = 3600, WAGE = 120_000;
const HOME = "apts-1/dwelling.1", WORK = "factory-1-works/workplace.1";
// c1 holds the lease and is the one who dies; c2 is their partner; c3 is a third adult; k1 is the couple's child, 12.
const household = statement("hh-1", 0, "household", { author: "genesis", speaks_for: "c1", visible_to: ["c1", "c2", "c3", "k1"], addressed_to: ["c1", "c2", "c3", "k1"], text: "Household: c1, c2, c3, k1.",
  data: { leaseholder: "c1", couples: [["c1", "c2"]], members: [
    { person: "c1", participant: "c1-self", born_at: -40 * YEAR, sex: "female" }, { person: "c2", participant: "c2-self", born_at: -38 * YEAR, sex: "male" },
    { person: "c3", participant: "c3-self", born_at: -30 * YEAR, sex: "male" }, { person: "k1", participant: "k1-self", born_at: -12 * YEAR, sex: "female", parents: ["c1", "c2"] }] } });
const START = [household, ...signed(employment("J2", 0, "factory-1", "c2", WAGE)), ...signed(employment("J3", 0, "factory-1", "c3", WAGE))];
const READINGS = { J2: { of: "agreement", status: "in_force" }, J3: { of: "agreement", status: "in_force" } };
// (Whom the family names to be told, as far as it knows them: here the bank and the energy retailer. The registry
// sends its entry to each: nobody is shown its register, docs/no-god-view.md.)
const PARAMS = { registry: "city", child_protection: "city", bank: "bank", utilities: { energy: "energy-co" } };
const TELL = ["bank", "energy-co"];
/** The home, with who is in it and who has left it; and a workplace someone may be at instead. */
const street = (atHome: string[], left: object[] = [], atWork: string[] = []) => [
  { cell: "cell.0.0", x: 0, y: 0, structure: { structure: "apts-1", type: "apartments", complete: true, spaces: [{ space: HOME, kind: "dwelling", capacity: 6, count: atHome.length, occupants: atHome, left }] } },
  ...(atWork.length ? [{ cell: "cell.5.0", x: 5, y: 0, structure: { structure: "factory-1-works", type: "works", complete: true, spaces: [{ space: WORK, kind: "workplace", capacity: 40, count: atWork.length, occupants: atWork }] } }] : [])];
const reports = (said: Said[]) => said.filter((c) => c.fn === "statement" && c.args.kind === "death_notification").map((c) => c.args.data);
const died = (t: number) => [{ occupant: "c1", reason: "died", at: t }];

async function adult(me: string) {
  const p = person(citizen, PARAMS, { me, age: me === "c2" ? 38 : 30 });
  await p.wake(DAY + 20 * HOUR, { records: START, readings: READINGS, balance: 300_000, street: street(["c1", "c2", "c3", "k1"]), in: HOME });
  return p;
}

test("of the adults at home, the first in the household's list reports a death there, whatever woke them; the other reports nothing", async () => {
  const at = 3 * DAY + 7 * HOUR;
  // Both at home in the morning, the week's plan days away: the partner (first of the survivors) reports, naming the
  // family; the third adult does not.
  const partner = await adult("c2");
  const said = await partner.wake(at, { street: street(["c2", "c3", "k1"], died(at - 4 * HOUR)), in: HOME, woke_for: "cadence" });
  expect(reports(said)).toEqual([{ deceased: "c1", tell: TELL, partner: "c2", children: ["k1"], adult_children: [] }]);
  expect(said.some((c) => c.fn === "statement" && c.args.kind === "household" && c.args.data.leaseholder === "c2" && c.args.data.members.length === 3)).toBe(true);
  // Seen again at the next wake: said once.
  expect(reports(await partner.wake(at + DAY, { street: street(["c2", "c3", "k1"], died(at - 4 * HOUR)), in: HOME }))).toEqual([]);
  const third = await adult("c3");
  expect(reports(await third.wake(at, { street: street(["c2", "c3", "k1"], died(at - 4 * HOUR)), in: HOME }))).toEqual([]);
});

test("with the first of the survivors out, the adult who is at home reports it", async () => {
  const at = 3 * DAY + 11 * HOUR;
  const third = await adult("c3");
  const said = await third.wake(at, { street: street(["c3", "k1"], died(at - HOUR)), in: HOME });
  expect(reports(said)).toEqual([{ deceased: "c1", tell: TELL, partner: "c2", children: ["k1"], adult_children: [] }]);
});

test("a child with no adult of the household at home tells the first of its adults, once; with one at home, nobody", async () => {
  const at = 3 * DAY + 16 * HOUR;
  const told = (said: Said[]) => said.filter((c) => c.fn === "message").map((c) => [c.args.to, c.args.text]);
  const child = person(citizen, PARAMS, { me: "k1", age: 12, sex: "female" });
  await child.wake(DAY + 20 * HOUR, { records: [household], street: street(["c1", "c2", "c3", "k1"]), in: HOME });
  // Home from school; a parent has died there and the other adults are out.
  expect(told(await child.wake(at, { street: street(["k1"], died(at - 5 * HOUR)), in: HOME }))).toEqual([[["c2-self"], SAYING.died("c1", HOME)]]);
  expect(told(await child.wake(at + HOUR, { street: street(["k1"], died(at - 5 * HOUR)), in: HOME }))).toEqual([]);
  // Another child, with an adult of the household at home: it is the adult's to see.
  const other = person(citizen, PARAMS, { me: "k1", age: 12, sex: "female" });
  await other.wake(DAY + 20 * HOUR, { records: [household], street: street(["c1", "c2", "c3", "k1"]), in: HOME });
  expect(told(await other.wake(at, { street: street(["c3", "k1"], died(at - 5 * HOUR)), in: HOME }))).toEqual([]);
});

test("an adult told by a child of the household reports it from where they are; told by anyone else, they do not", async () => {
  const at = 3 * DAY + 16 * HOUR;
  const partner = await adult("c2");
  const atWork = { street: street([], [], ["c2"]), in: WORK, woke_for: "news" };
  expect(reports(await partner.wake(at, { ...atWork, inbox: [{ id: "m0", from: "c9-self", t: at, text: SAYING.died("c1", HOME) }] }))).toEqual([]);
  const said = await partner.wake(at + HOUR, { ...atWork, inbox: [{ id: "m1", from: "k1-self", t: at, text: SAYING.died("c1", HOME) }] });
  expect(reports(said)).toEqual([{ deceased: "c1", tell: TELL, partner: "c2", children: ["k1"], adult_children: [] }]);
  // Home that evening, the death still among the home's departures: nothing more to report.
  expect(reports(await partner.wake(at + 3 * HOUR, { street: street(["c2", "k1"], died(at - 5 * HOUR)), in: HOME }))).toEqual([]);
});

test("an adult who lives in a home reports the death there of someone not of their household, naming no family", async () => {
  // c9 rents the home and lives in it; c1 (of another household, the home let again over c9's head) dies there.
  const lodger = person(citizen, PARAMS, { me: "c9", age: 30 });
  const tenancy = signed(lease("L9", 0, "landlord-1", "c9", HOME, 100_000));
  await lodger.wake(DAY + 20 * HOUR, { records: tenancy, readings: { L9: { of: "agreement", status: "in_force" } }, balance: 300_000, street: street(["c1", "c9"]), in: HOME });
  const at = 3 * DAY + 7 * HOUR;
  const said = await lodger.wake(at, { street: street(["c9"], died(at - 4 * HOUR)), in: HOME, woke_for: "cadence" });
  expect(reports(said)).toEqual([{ deceased: "c1", found_at: HOME }]);
  // Once.
  expect(reports(await lodger.wake(at + DAY, { street: street(["c9"], died(at - 4 * HOUR)), in: HOME }))).toEqual([]);
});
