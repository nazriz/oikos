// A post changes hands mid-run (bug hunt 2026-10-17, the test the reviewer recommended): the new holder's module starts from
// nothing, and is shown the office's whole file (every record it can see, and every payment its organisation has had, which the
// kernel hands a new holder as payments it has not yet been told of). Each office must carry on exactly as the holder before
// would have: its file intact, nothing done again, nothing lost. Compared with the same office whose holder never changed.

import { expect, test } from "bun:test";
import type { Observation } from "../src/contracts";
import { electoralOffice } from "../src/behaviour/elections";
import { landlord } from "../src/behaviour/firms";
import { callsOf, context, DAY, statement, wake } from "./stepping";
import { currencyNow, inCurrency } from "../src/money";
import { Randomness } from "../src/rng";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";

inCurrency(PROFILE.values.currency);

type Channels = { [id: string]: any };

/** Drives an office through `wakes` (what is new at each, by channel); at `swapAt` a new holder takes over: a fresh module, shown all the
 * office has on file (records seen, payments had, the latest of everything else). Returns what it did at each wake, as plain text. */
function drive(make: () => any, wakes: { t: number; channels: Channels; readings?: object }[], swapAt: number | undefined, o: { entity: string; as?: { participant: string; position?: string } }) {
  let m = make();
  const ids = { n: 0 };
  const history: Channels = {};
  const own: any[] = [];
  const out: { t: number; acts: string[] }[] = [];
  const absorb = (c: Channels) => {
    for (const [id, ch] of Object.entries(c)) {
      const h = history[id] ?? (history[id] = { ...ch, ...(ch.kind === "records" ? { records: [] } : ch.kind === "accounts" ? { transactions: [] } : {}) });
      if (ch.kind === "records") h.records = [...h.records, ...ch.records];
      else if (ch.kind === "accounts") { h.accounts = ch.accounts; h.transactions = [...h.transactions, ...ch.transactions]; }
      else history[id] = ch;
    }
  };
  let readings: object = {};
  for (const w of wakes) {
    let shown: Channels = w.channels;
    if (w.readings) readings = w.readings;
    if (swapAt !== undefined && w.t === swapAt) {
      m = make();
      // (The new holder's first look: all of it, the records made since included.)
      const all: Channels = {};
      for (const [id, ch] of Object.entries(history)) all[id] = ch.kind === "records" ? { ...ch, records: [...ch.records, ...own.splice(0), ...(w.channels[id]?.records ?? [])] } : ch.kind === "accounts" ? { ...ch, accounts: w.channels[id]?.accounts ?? ch.accounts, transactions: [...ch.transactions, ...(w.channels[id]?.transactions ?? [])] } : (w.channels[id] ?? ch);
      for (const [id, ch] of Object.entries(w.channels)) if (!(id in all)) all[id] = ch;
      shown = all;
    } else if (own.length) {
      const first = Object.keys(shown).find((id) => shown[id].kind === "records");
      if (first) shown = { ...shown, [first]: { ...shown[first], records: [...own.splice(0), ...shown[first].records] } };
    }
    absorb(w.channels);
    const r = wake(m, w.t, shown, { entity: o.entity, ...(o.as ? { as: o.as } : {}), ids, more: { readings } });
    // (What it made comes back to it as records: into the history for a successor, and to the holder who made it.)
    if (swapAt === undefined || w.t < swapAt) {
      own.push(...r.made);
      absorb({ [Object.keys(history).find((id) => history[id].kind === "records") ?? "mine"]: { kind: "records", records: r.made } });
    } else {
      own.push(...r.made);
      absorb({ [Object.keys(history).find((id) => history[id].kind === "records") ?? "mine"]: { kind: "records", records: r.made } });
    }
    out.push({ t: w.t, acts: r.said.map((c) => `${c.fn}:${JSON.stringify(c.args)}`.replace(/made\.\d+/g, "made")) });
  }
  return out;
}

const AS = { participant: "electoral-system", position: "electoral" };

test("the electoral office carries on across a change of holder at any stage of the election: the notice, the ballot and the count are neither repeated nor lost", () => {
  const enrol = (who: string) => statement(`enrol-${who}`, 0, "enrolment", { author: `${who}-self`, speaks_for: who, addressed_to: ["city"], visible_to: [who, "city"] });
  const nom = (id: string, at: number, who: string) => statement(id, at, "nomination", { author: `${who}-self`, speaks_for: who, addressed_to: ["city"], data: { office: "mayor", name: who } });
  const people = ["c1", "c2", "c3", "c4", "c5", "c6"];
  const wakes: { t: number; channels: Channels }[] = [];
  const delta = new Map<number, any[]>();
  const add = (day: number, ...r: any[]) => delta.set(day, [...(delta.get(day) ?? []), ...r]);
  add(0, ...people.map(enrol));
  add(46, nom("nom-1", 46 * DAY, "c1"), nom("nom-2", 47 * DAY, "c2"));
  for (let day = 0; day <= 520; day++) wakes.push({ t: day * DAY, channels: { roll: { kind: "records", records: delta.get(day) ?? [] } } });
  // The ballot's number is only known once made: votes cast for it by whoever the test's scripted electors are, by looking at the record.
  const vote = (id: string, at: number, who: string, ballot: string, choice: string) => ({ id, at, record: "vote", author: `${who}-self`, speaks_for: who, visible_to: [who, "city"], ballot, choice });
  const make = () => electoralOffice.create(context("electoral-system", "city", { office: "mayor", office_title: "Mayor", first_poll_day: 100, term_days: 400 }, { position: "electoral" }));
  const baseline = drive(make, wakes, undefined, { entity: "city", as: AS });
  const results = baseline.flatMap((b) => b.acts).filter((a) => a.includes("ballot_result"));
  expect(results.length).toBeGreaterThanOrEqual(1);
  // Votes need the ballot's id: found from a first pass, then shown in a second.
  const ballotId = (() => { const ids = { n: 0 }; let id = ""; const m = make(); let own: any[] = []; for (const w of wakes.slice(0, 80)) { const r = wake(m, w.t, { roll: { kind: "records", records: [...own, ...w.channels.roll.records] } }, { entity: "city", as: AS, ids }); own = r.made; const b = r.made.find((x: any) => x.kind === "ballot"); if (b) id = b.id; } return id; })();
  expect(ballotId).not.toBe("");
  for (const [i, who] of people.entries()) add(90, vote(`v-${who}`, 90 * DAY, who, ballotId, i % 2 ? "1>2" : "2>1"));
  for (const w of wakes) w.channels = { roll: { kind: "records", records: delta.get(w.t / DAY) ?? [] } };
  const base = drive(make, wakes, undefined, { entity: "city", as: AS });
  expect(base.flatMap((b) => b.acts).some((a) => a.includes("ballot_result"))).toBe(true);
  for (const swapDay of [20, 41, 60, 75, 95, 101, 150, 300, 441]) {
    const swapped = drive(make, wakes, swapDay * DAY, { entity: "city", as: AS });
    const after = (x: typeof base) => x.filter((b) => b.t >= swapDay * DAY).map((b) => `${b.t / DAY}: ${b.acts.join(" | ")}`);
    expect(after(swapped), `a new holder on day ${swapDay}`).toEqual(after(base));
  }
});

// ------------------------------------------------------------------ a landlord's rent book

const DAYS = DAY, MONTH = 30 * DAY, WEEK = 7 * DAY, ME = "landlord-1", RENT = 150_000;

test("a letting office carries on across a change of holder: rents paid are seen as paid, no tenant who pays is pursued, and one who does not is, once", () => {
  const lease = (id: string, tenant: string, space: string) => ({ id, at: 0, author: "landlord-1-office-system", record: "agreement", visible_to: [ME, tenant],
    terms: { template: "lease", parties: [ME, tenant], commitments: [
      { who: ME, does: { outcome: { occupancy: { who: tenant, in: space } } } },
      { who: tenant, does: { outcome: { money: { from: `acc-${tenant}`, to: "acc-landlord", amount: String(RENT), for: "rent" } } }, every: MONTH }] } });
  const sign = (agreement: string, tenant: string) => [ME, tenant].map((as) => ({ id: `sig-${agreement}-${as}`, at: 0, author: "x", record: "signature", agreement, as, visible_to: [ME, tenant] }));
  const genesis = [
    { id: "lot-1", at: 0, author: "genesis", record: "statement", kind: "lot", speaks_for: "city", visible_to: "public", text: "Lot 1.", data: { cells: ["c1", "c2"] } },
    { id: "own-1", at: 0, author: "genesis", record: "claim", position: "right", holder: ME, about: { kind: "ownership", object: "lot-1" }, visible_to: "public" },
    lease("L1-a", "ann", "s1/home"), ...sign("L1-a", "ann"), lease("L1-b", "bob", "s2/home"), ...sign("L1-b", "bob"),
  ];
  const cells = ["s1", "s2"].map((s, i) => ({ cell: `c${i + 1}`, structure: { structure: s, type: "house", complete: true, spaces: [{ space: `${s}/home`, kind: "dwelling", capacity: 6, count: 1, attrs: { bedrooms: 2 } }] } }));
  const rentPaid = (t: number, tenant: string) => ({ t, from: `acc-${tenant}`, to: "acc-landlord", amount: String(RENT), currency: "AUD", by: "bank", memo: "rent" });
  const wakes: { t: number; channels: Channels; readings: object }[] = [];
  for (let t = 0; t <= 6 * MONTH; t += WEEK) {
    const transactions: any[] = [];
    // Ann pays for four months and then stops; Bob never misses. Rent, monthly in advance.
    for (let due = 0; due <= t; due += MONTH) if (due > t - WEEK && (due <= 3 * MONTH || due === 0)) transactions.push(rentPaid(due, "ann"));
    for (let due = 0; due <= t; due += MONTH) if (due > t - WEEK) transactions.push(rentPaid(due, "bob"));
    wakes.push({ t, readings: { "L1-a": { of: "agreement", status: "in_force", ends_at: 12 * MONTH }, "L1-b": { of: "agreement", status: "in_force", ends_at: 12 * MONTH } }, channels: {
      mine: { kind: "records", records: t === 0 ? genesis : [] },
      sites: { kind: "sites", cells },
      bank: { kind: "accounts", accounts: [{ account: "acc-landlord", holder: ME, custodian: "bank", currency: "AUD", balance: "100000000" }], transactions },
    } });
  }
  const make = () => landlord.create({ participant: "landlord-1-office-system", entity: ME, rng: (k: string) => new Randomness(1n).stream([k]), world: { tickSeconds: 3600, runEnd: 2000 * DAY },
    params: { develop: false, renew: true, min_term_months: 12, max_term_months: 12, arrears_months_before_notice: 2, spend_share_bps: 0, upkeep_share_bps: 0, base_rent: { house: RENT } } } as any);
  const base = drive(make, wakes, undefined, { entity: ME });
  const acts = base.flatMap((b) => b.acts);
  expect(acts.some((a) => /agreement.*notice/.test(a) || /notice/.test(a))).toBe(true); // (Ann is pursued)
  for (const week of [2, 6, 10, 14, 18, 22]) {
    const swapAt = week * WEEK;
    const swapped = drive(make, wakes, swapAt, { entity: ME });
    const after = (x: typeof base) => x.filter((b) => b.t >= swapAt).map((b) => `${b.t / DAY}: ${b.acts.join(" | ")}`);
    expect(after(swapped), `a new holder in week ${week}`).toEqual(after(base));
  }
});
