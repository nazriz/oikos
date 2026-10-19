// The police station (docs/behaviour/deaths.md), on what it's shown alone: it is shown nobody's home. Asked to call at
// one (a neighbour who has seen nobody come out), an officer goes there, and whoever is found dead there is reported
// to the registry; a home nobody asked about is never gone to.

import { expect, test } from "bun:test";

import { inCurrency } from "../src/money";
import { context, DAY, employment, signed, statement, wake } from "./stepping";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";
import { engine } from "./engine";
const station = engine("police.station");

inCurrency(PROFILE.values.currency);

const ME = "police";
const AS = { participant: "police-oic-system", position: "police-oic" };
const PARAMS = { building: "police-station", workplace: "police-station/workplace.1", account: "acc-police", officers: 1, wage: 380_000, tribunal: "tribunal",
  calls_channel: "calls", registry: "city" };
const genesis = signed(employment("job-1", 0, ME, "officer-1", 380_000));
const premises = { kind: "sites", as_of: 0, cells: [{ cell: "c0", structure: { structure: "police-station", type: "station", complete: true,
  spaces: [{ space: "police-station/workplace.1", kind: "workplace", capacity: 10, count: 1, occupants: ["officer-1"] }] } }] };
const home = (n: number, occupants: string[], left: { occupant: string; reason: string; at: number }[]) => ({ cell: `c${n}`, structure: { structure: `house-${n}`, type: "house", complete: true,
  spaces: [{ space: `house-${n}/dwelling.1`, kind: "dwelling", capacity: 6, count: occupants.length, occupants, left }] } });
const books = { kind: "accounts", accounts: [{ account: "acc-police", holder: ME, custodian: "bank", currency: "AUD", balance: "100000000" }], transactions: [] };

const request = (id: string, t: number, n: number, since: number) => statement(id, t, "welfare_check_request", { speaks_for: "neighbour-1", addressed_to: [ME], visible_to: [ME, "neighbour-1"], data: { space: `house-${n}/dwelling.1`, structure: `house-${n}`, since } });

/** A station woken once a day until `until`, shown `records(t)` as they come; when it sets out for a home, what is
 * there (`homes`) is shown it at its next wake, as a visit's finding. Returns where it went, and each death reported. */
function days(until: number, homes: (t: number) => any[], records: (t: number) => any[] = () => []) {
  const m = station.create(context(AS.participant, ME, PARAMS, { position: AS.position }));
  const reported: { day: number; who: string; found_at: string }[] = [];
  const went: { day: number; places: string[] }[] = [];
  const ids = { n: 0 };
  let back: any;
  for (let d = 0; d <= until; d++) {
    const t = d * DAY + 10 * 3600;
    const calls = back ? { calls: back } : {};
    back = undefined;
    const w = wake(m, t, { books, mine: { kind: "records", records: [...(d === 0 ? genesis : []), ...records(t)] }, premises, ...calls }, { entity: ME, as: AS, ids });
    for (const c of w.of("statement", "death_notification")) reported.push({ day: d, who: c.args.data.deceased, found_at: c.args.data.found_at });
    for (const l of w.looks.filter((x: any) => x.visit)) {
      went.push({ day: d, places: l.visit.places });
      const cells = homes(t).filter((c) => l.visit.places.includes(c.structure.structure));
      back = { kind: "sites", as_of: t + 3600, visited: true, cells, seen_at: Object.fromEntries(cells.map((c) => [c.cell, t + 3600])), fresh: cells.map((c) => c.cell) };
    }
  }
  return { reported, went };
}

test("asked to call at a home, an officer goes there, and whoever is found dead is reported to the registry", () => {
  const died = 2 * DAY + 3 * 3600;
  const town = (t: number) => [home(1, t < died ? ["ann"] : [], t < died ? [] : [{ occupant: "ann", reason: "died", at: died }]), home(2, [], [{ occupant: "cy", reason: "died", at: DAY }])];
  // A neighbour asks on day 5, and another the day after about the same silence.
  const { reported, went } = days(12, town, (t) => (Math.floor(t / DAY) === 5 ? [request("ask-1", t, 1, died)] : Math.floor(t / DAY) === 6 ? [request("ask-2", t, 1, died)] : []));
  // They go the day they are asked, to that home alone, once; what they find comes when they are back.
  expect(went).toEqual([{ day: 5, places: ["house-1"] }]);
  expect(reported).toEqual([{ day: 6, who: "ann", found_at: "house-1/dwelling.1" }]);
});

test("nobody asks: nobody is called at, whoever has died there", () => {
  const { reported, went } = days(20, () => [home(1, [], [{ occupant: "ann", reason: "died", at: DAY }])]);
  expect(went).toEqual([]);
  expect(reported).toEqual([]);
});

test("a call that finds nobody dead reports nothing; a death known to be registered is not reported again", () => {
  const empty = days(8, () => [home(1, [], [{ occupant: "ann", reason: "left", at: DAY }])], (t) => (Math.floor(t / DAY) === 3 ? [request("ask-1", t, 1, DAY)] : []));
  expect(empty.went.length).toBe(1);
  expect(empty.reported).toEqual([]);
  const known = days(8, () => [home(1, [], [{ occupant: "ann", reason: "died", at: DAY }])],
    (t) => (Math.floor(t / DAY) === 3 ? [request("ask-1", t, 1, DAY), statement("reg-1", t, "death_registration", { data: { deceased: "ann", reported_by: "landlord-1" } })] : []));
  expect(known.went.length).toBe(1);
  expect(known.reported).toEqual([]);
});

test("a death someone at home outlived is not found again at a later call; one nobody outlived is", () => {
  // Ann died on day 1 with Bob at home, who lived on there and left on day 60; a neighbour asks on day 70.
  const lived = days(75, () => [home(1, [], [{ occupant: "ann", reason: "died", at: DAY }, { occupant: "bob", reason: "left", at: 60 * DAY }])], (t) => (Math.floor(t / DAY) === 70 ? [request("ask-1", t, 1, 60 * DAY)] : []));
  expect(lived.went.length).toBe(1);
  expect(lived.reported).toEqual([]);
  // Bob died there too, alone, two months after: he is found, and she is not found a second time.
  const both = days(75, () => [home(1, [], [{ occupant: "ann", reason: "died", at: DAY }, { occupant: "bob", reason: "died", at: 60 * DAY }])], (t) => (Math.floor(t / DAY) === 70 ? [request("ask-1", t, 1, 60 * DAY)] : []));
  expect(both.reported.map((r) => r.who)).toEqual(["bob"]);
  // Two who died within the day of each other, nobody left to say so: both are found.
  const together = days(12, () => [home(1, [], [{ occupant: "ann", reason: "died", at: DAY }, { occupant: "bob", reason: "died", at: DAY + 3600 }])], (t) => (Math.floor(t / DAY) === 5 ? [request("ask-1", t, 1, DAY)] : []));
  expect(together.reported.map((r) => r.who).sort()).toEqual(["ann", "bob"]);
});

test("a warrant of possession: carried out, it says how many of the household were there and were put out; nobody there, nobody is said to have been removed; one withdrawn is not gone on", () => {
  // (docs/behaviour/justice.md, "A warrant, and a home already left": 11 of 23 warrants in the fifth living pilot were
  // said to have put a household out of a home it had left; every call to put someone out had been refused.)
  const warrant = (id: string, tenant: string, household: string[], n: number) => statement(id, 0, "warrant", { speaks_for: "tribunal", addressed_to: [ME], visible_to: [ME, "tribunal", tenant, "landlord-1"],
    data: { order: `order-${id}`, lease: `lease-${tenant}`, tenant, landlord: "landlord-1", space: `house-${n}/dwelling.1`, structure: `house-${n}`, household, not_before: DAY, until: 20 * DAY } });
  const go = (records: any[], gone: Set<string>) => {
    const m = station.create(context(AS.participant, ME, PARAMS, { position: AS.position }));
    wake(m, 10 * 3600, { books, mine: { kind: "records", records: [...genesis, ...records] }, premises }, { entity: ME, as: AS });
    return wake(m, 2 * DAY + 10 * 3600, { books, mine: { kind: "records", records: [] }, premises }, { entity: ME, as: AS, refuse: (c) => c.fn === "occupancy" && gone.has(String(c.args.who)) });
  };
  // Two of three were not there: the one there is put out, and the paper says one.
  const some = go([warrant("w1", "t1", ["t1", "t2", "t3"], 1)], new Set(["t2", "t3"]));
  expect(some.of("occupancy").map((c) => c.args.who)).toEqual(["t1", "t2", "t3"]);
  expect(some.of("statement", "warrant_executed").map((c) => c.args.data)).toMatchObject([{ warrant: "w1", removed: 1 }]);
  // Nobody was there: possession is given all the same, both are told, and the paper says nobody was put out.
  const none = go([warrant("w2", "t4", ["t4", "t5"], 2)], new Set(["t4", "t5"]));
  const done = none.of("statement", "warrant_executed");
  expect(done.map((c) => c.args.data)).toMatchObject([{ warrant: "w2", removed: 0, tenant: "t4" }]);
  expect(done[0]!.args.text).toContain("0 were there and were put out");
  expect(done[0]!.args.to).toEqual(["t4", "landlord-1"]);
  // Withdrawn by the registrar before its day (the landlord said the tenant had gone): no officer goes.
  const off = go([warrant("w3", "t6", ["t6"], 3), { id: "wd-1", at: 0, record: "withdrawal", author: "tribunal-registrar-system", speaks_for: "tribunal", withdraws: "w3", visible_to: [ME, "tribunal"] }], new Set());
  expect(off.of("occupancy")).toEqual([]);
  expect(off.of("statement", "warrant_executed")).toEqual([]);
});

test("the profile's bands are shares that add up, in rising days", () => {
  const bands = PROFILE.values.life.found_alone_after;
  expect(bands.reduce((n, b) => n + b.bps, 0)).toBe(10_000);
  for (let i = 1; i < bands.length; i++) expect(bands[i]!.within_days).toBeGreaterThan(bands[i - 1]!.within_days);
});
