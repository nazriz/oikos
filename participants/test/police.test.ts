// The police station (docs/behaviour/deaths.md), on what it's shown alone: someone who has died at home with nobody
// there to say so is reported by the police, once the home has stood empty for a day and the time it takes to be found
// has passed; a home somebody lives in is left to those who live there.

import { expect, test } from "bun:test";
import { station } from "../src/behaviour/police";
import { inCurrency } from "../src/money";
import { context, DAY, employment, signed, statement, wake } from "./stepping";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";

inCurrency(PROFILE.values.currency);

const ME = "police";
const AS = { participant: "police-oic-system", position: "police-oic" };
const PARAMS = { building: "police-station", workplace: "police-station/workplace.1", account: "acc-police", officers: 1, wage: 380_000, tribunal: "tribunal",
  homes_channel: "homes", registry: "city" };
const genesis = signed(employment("job-1", 0, ME, "officer-1", 380_000));
const premises = { kind: "sites", as_of: 0, cells: [{ cell: "c0", structure: { structure: "police-station", type: "station", complete: true,
  spaces: [{ space: "police-station/workplace.1", kind: "workplace", capacity: 10, count: 1, occupants: ["officer-1"] }] } }] };
const home = (n: number, occupants: string[], left: { occupant: string; reason: string; at: number }[]) => ({ cell: `c${n}`, structure: { structure: `house-${n}`, type: "house", complete: true,
  spaces: [{ space: `house-${n}/dwelling.1`, kind: "dwelling", capacity: 6, count: occupants.length, occupants, left }] } });
const books = { kind: "accounts", accounts: [{ account: "acc-police", holder: ME, custodian: "bank", currency: "AUD", balance: "100000000" }], transactions: [] };

/** A station woken once a day until `until`: `homes(t)` is the town's homes as a look at them then shows them, and
 * `records(t)` what's new. Returns each death it reported, with the day. */
function days(until: number, found_after: object[], homes: (t: number) => any[], records: (t: number) => any[] = () => []) {
  const m = station.create(context(AS.participant, ME, { ...PARAMS, found_after }, { position: AS.position }));
  const reported: { day: number; who: string; found_at: string }[] = [];
  const ids = { n: 0 };
  let seen: any = { kind: "sites", as_of: -1, cells: [] };
  for (let d = 0; d <= until; d++) {
    const t = d * DAY + 10 * 3600;
    // (What it sees of the homes is what its last look showed; a wake ends with the day's look.)
    const w = wake(m, t, { books, mine: { kind: "records", records: [...(d === 0 ? genesis : []), ...records(t)] }, premises, homes: seen }, { entity: ME, as: AS, ids });
    for (const c of w.of("statement", "death_notification")) reported.push({ day: d, who: c.args.data.deceased, found_at: c.args.data.found_at });
    seen = { kind: "sites", as_of: t, cells: homes(t) };
  }
  return reported;
}

test("someone who died with nobody at home is reported once the home has stood empty and the time to be found has passed", () => {
  const died = 2 * DAY + 3 * 3600;
  // Found within 5 to 6 days, every one: the report comes at the first day's work after that, and not before.
  const band = [{ within_days: 5, bps: 0 }, { within_days: 6, bps: 10_000 }];
  const reported = days(12, band, (t) => [home(1, t < died ? ["ann"] : [], t < died ? [] : [{ occupant: "ann", reason: "died", at: died }])]);
  expect(reported.length).toBe(1);
  expect(reported[0]!.who).toBe("ann");
  expect(reported[0]!.found_at).toBe("house-1/dwelling.1");
  // Died early on day 2; found between 5 and 6 days on, so the time comes on day 7 or 8: reported at that day's work
  // (the home was seen standing empty long before).
  expect(reported[0]!.day).toBeGreaterThanOrEqual(7);
  expect(reported[0]!.day).toBeLessThanOrEqual(8);
});

test("found at once in the figures, the police still come only after the home has stood empty for a day", () => {
  const died = 2 * DAY + 3 * 3600;
  const reported = days(8, [{ within_days: 0, bps: 10_000 }], (t) => [home(1, t < died ? ["ann"] : [], t < died ? [] : [{ occupant: "ann", reason: "died", at: died }])]);
  expect(reported.map((r) => r.who)).toEqual(["ann"]);
  // Day 2's look is seven hours after the death: too soon to tell. Day 3's shows a day's stillness; reported on day 4.
  expect(reported[0]!.day).toBe(4);
});

test("a home somebody lives in is left to them: no report while anyone is there, or has been in or out within a day", () => {
  const died = 2 * DAY + 3 * 3600;
  // Bob lives with Ann: at home at every look.
  const shared = days(20, [{ within_days: 1, bps: 10_000 }], (t) => [home(1, ["bob"], t < died ? [] : [{ occupant: "ann", reason: "died", at: died }])]);
  expect(shared).toEqual([]);
  // Bob out at work at every look, but leaving home each morning: never a day's stillness.
  const commuting = days(20, [{ within_days: 1, bps: 10_000 }], (t) => [home(1, [], t < died ? [] : [{ occupant: "ann", reason: "died", at: died }, { occupant: "bob", reason: "left", at: t - 2 * 3600 }])]);
  expect(commuting).toEqual([]);
});

test("a death registered meanwhile (the landlord found them) is not reported again", () => {
  const died = 2 * DAY + 3 * 3600;
  const reported = days(12, [{ within_days: 5, bps: 0 }, { within_days: 6, bps: 10_000 }],
    (t) => [home(1, t < died ? ["ann"] : [], t < died ? [] : [{ occupant: "ann", reason: "died", at: died }])],
    (t) => (Math.floor(t / DAY) === 5 ? [statement("reg-1", t, "death_registration", { data: { deceased: "ann", reported_by: "landlord-1" } })] : []));
  expect(reported).toEqual([]);
});

test("the profile's bands are shares that add up, in rising days", () => {
  const bands = PROFILE.values.life.found_alone_after;
  expect(bands.reduce((n, b) => n + b.bps, 0)).toBe(10_000);
  for (let i = 1; i < bands.length; i++) expect(bands[i]!.within_days).toBeGreaterThan(bands[i - 1]!.within_days);
});
