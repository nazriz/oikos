// The letting office (docs/behaviour/firms.md), on what it's shown alone: arrears are judged lease by lease. A tenant on
// a renewed lease who stops paying gets notice after the months the landlord's rule says, however long they paid before.

import { expect, test } from "bun:test";
import type { Observation } from "../src/contracts";

import { parseAmount } from "../src/calls";
import { currencyNow, inCurrency } from "../src/money";
import { callsOf, statement } from "./stepping";
import { Randomness } from "../src/rng";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";
import { engine } from "./engine";
const landlord = engine("firm.landlord");

inCurrency(PROFILE.values.currency);

const DAY = 86_400, MONTH = 30 * DAY, WEEK = 7 * DAY;
const ME = "landlord-1", RENT = 150_000;
const ctx = (params: object): any => ({ participant: "landlord-1-office-system", entity: ME, rng: (k: string) => new Randomness(1n).stream([k]), world: { tickSeconds: 3600, runEnd: 2000 * DAY }, params });
const lease = (id: string, at: number, tenant: string, space: string, o: object = {}) => ({ id, at, author: "landlord-1-office-system", record: "agreement", visible_to: [ME, tenant], ...o,
  terms: { template: "lease", parties: [ME, tenant], commitments: [
    { who: ME, does: { outcome: { occupancy: { who: tenant, in: space } } } },
    { who: tenant, does: { outcome: { money: { from: `acc-${tenant}`, to: "acc-landlord", amount: String(RENT), for: "rent" } } }, every: MONTH },
  ] } });
const signed = (agreement: string, at: number, tenant: string) => [ME, tenant].map((as) => ({ id: `sig-${agreement}-${as}`, at, author: "x", record: "signature", agreement, as, visible_to: [ME, tenant] }));
const rentPaid = (t: number, tenant: string) => ({ t, from: `acc-${tenant}`, to: "acc-landlord", amount: String(RENT), currency: "AUD", by: "bank", memo: "rent" });

/** A landlord with two homes let for 12 months from day 0, woken weekly; `world(t)` says what's new and what its leases
 * read as then. Returns every call it made, with the time. */
function letting(until: number, world: (t: number, said: string) => { records?: any[]; transactions?: any[]; readings: object }) {
  const m = landlord.create(ctx({ develop: false, renew: true, min_term_months: 12, max_term_months: 12, arrears_months_before_notice: 2, spend_share_bps: 0, upkeep_share_bps: 0, base_rent: { house: RENT } }));
  const calls: { t: number; call: string }[] = [];
  const genesis = [
    { id: "lot-1", at: 0, author: "genesis", record: "statement", kind: "lot", speaks_for: "city", visible_to: "public", text: "Lot 1.", data: { cells: ["c1", "c2"] } },
    { id: "own-1", at: 0, author: "genesis", record: "claim", position: "right", holder: ME, about: { kind: "ownership", object: "lot-1" }, visible_to: "public" },
    lease("L1-a", 0, "ann", "s1/home"), ...signed("L1-a", 0, "ann"),
    lease("L1-b", 0, "bob", "s2/home"), ...signed("L1-b", 0, "bob"),
  ];
  const cells = ["s1", "s2"].map((s, i) => ({ cell: `c${i + 1}`, structure: { structure: s, type: "house", complete: true, spaces: [{ space: `${s}/home`, kind: "dwelling", capacity: 6, count: 1, attrs: { bedrooms: 2 } }] } }));
  let said = "";
  for (let t = 0; t <= until; t += WEEK) {
    const w = world(t, said);
    said = "";
    let o = { t, entity: ME, woke_for: "cadence", outcomes: [], readings: w.readings, channels: {
      mine: { kind: "records", records: [...(t === 0 ? genesis : []), ...(w.records ?? [])] },
      sites: { kind: "sites", cells },
      bank: { kind: "accounts", accounts: [{ account: "acc-landlord", holder: ME, custodian: "bank", currency: "AUD", balance: "100000000" }], transactions: w.transactions ?? [] },
    } } as unknown as Observation;
    for (let i = 0; i < 50; i++) {
      const a: any = m.step(o, undefined as any);
      if (a.type === "wait") break;
      calls.push({ t, call: a.call });
      said += `${a.call}\n`;
      o = { ...o, woke_for: "done", outcomes: [{ action: "call", t, status: "ok" }], channels: { ...o.channels, mine: { kind: "records", records: [] }, bank: { ...(o.channels as any).bank, transactions: [] } } } as unknown as Observation;
    }
  }
  return calls;
}

test("a tenant on a renewed lease who stops paying gets notice after two unpaid months, as one on a first lease would", () => {
  const END = 12 * MONTH; // the first leases' term
  let renewedAt: number | undefined;
  const calls = letting(20 * MONTH, (t, said) => {
    const records: any[] = [];
    // The landlord offered both a new lease (within its notice period of the old one's end): each tenant signs it.
    if (renewedAt === undefined && /agreement\(.*basis=L1-a/s.test(said) && /agreement\(.*basis=L1-b/s.test(said)) {
      renewedAt = t;
      for (const [id, who, space] of [["L2-a", "ann", "s1/home"], ["L2-b", "bob", "s2/home"]] as const) records.push(lease(id, t, who, space, { basis: id.replace("L2", "L1") }), ...signed(id, t, who));
    }
    const first = t < END ? { status: "in_force", ends_at: END } : { status: "ended", ends_at: END, ended_by: "term" };
    const second = { status: "in_force", ends_at: 24 * MONTH };
    const readings = { "L1-a": { of: "agreement", ...first }, "L1-b": { of: "agreement", ...first }, ...(renewedAt !== undefined ? { "L2-a": { of: "agreement", ...second }, "L2-b": { of: "agreement", ...second } } : {}) };
    // Rent, monthly in advance, on the same days all along (the new lease's from the day the old one ends). Ann pays
    // every month of the first lease and nothing under the second; Bob never misses.
    const transactions: any[] = [];
    for (let due = 0; due <= t; due += MONTH) if (due > t - WEEK) {
      if (due < END) transactions.push(rentPaid(due, "ann"));
      transactions.push(rentPaid(due, "bob"));
    }
    return { records, transactions, readings };
  });
  expect(renewedAt).toBeGreaterThanOrEqual(END - 60 * DAY);
  expect(renewedAt).toBeLessThan(END);
  const notices = calls.filter((c) => /agreement\(notice=/.test(c.call));
  // One notice: on Ann's new lease, at the first wake once two months of it are unpaid. Never on Bob's, nor the old ones.
  expect(notices.map((n) => /notice=([\w-]+)/.exec(n.call)![1])).toEqual(["L2-a"]);
  expect(notices[0]!.t).toBeGreaterThanOrEqual(END + 2 * MONTH);
  expect(notices[0]!.t).toBeLessThan(END + 2 * MONTH + WEEK);
});

test("a letting office is shown its own titles and looks up the plan of each of its lots, once, before it plans (nobody is shown the register)", () => {
  const m = landlord.create(ctx({ develop: false, renew: false, spend_share_bps: 0, upkeep_share_bps: 0, base_rent: { house: RENT }, register: { lots: "lots" } }));
  const plans: { [lot: string]: string[] } = { "lot-1": ["c1"], "lot-2": ["c2"] };
  const title = (lot: string, holder = ME) => ({ id: `own-${lot}`, at: 0, author: "genesis", record: "claim", position: "right", holder, about: { kind: "ownership", object: lot }, visible_to: "public" });
  const cells = ["s1", "s2", "s3"].map((s, i) => ({ cell: `c${i + 1}`, structure: { structure: s, type: "house", complete: true, spaces: [{ space: `${s}/home`, kind: "dwelling", capacity: 6, count: 0, attrs: { bedrooms: 2 } }] } }));
  const asked: string[] = [];
  const listed: string[] = [];
  const wake = (t: number, records: any[]) => {
    let o: any = { t, entity: ME, woke_for: "cadence", outcomes: [], readings: {}, channels: { mine: { kind: "records", records }, sites: { kind: "sites", cells },
      bank: { kind: "accounts", accounts: [{ account: "acc-landlord", holder: ME, custodian: "bank", currency: "AUD", balance: "100000000" }], transactions: [] } } };
    for (let i = 0; i < 50; i++) {
      const a: any = m.step(o, undefined as any);
      if (a.type === "wait") break;
      if (a.type === "look") {
        expect(a.looks).toHaveLength(1);
        expect(a.looks[0].channel).toBe("lots");
        expect(a.looks[0].query).toEqual({ where: [{ field: "id", op: "=", value: a.looks[0].query.where[0].value }], limit: 1 });
        const lot = a.looks[0].query.where[0].value as string;
        asked.push(lot);
        o = { ...o, outcomes: [], channels: { ...o.channels, mine: { kind: "records", records: [] }, lots: { kind: "records", search: true, records: plans[lot] ? [{ id: lot, at: 0, author: "genesis", record: "statement", kind: "lot", speaks_for: "city", visible_to: "public", text: lot, data: { cells: plans[lot] } }] : [] } } };
        continue;
      }
      listed.push(...[...String(a.call).matchAll(/"structure":"([\w-]+)"/g)].map((x) => x[1]!));
      o = { ...o, woke_for: "done", outcomes: [{ action: "call", t, status: "ok" }], channels: { ...o.channels, mine: { kind: "records", records: [] } } };
    }
  };
  // Its two titles, and one that is somebody else's: the plans of its own two are looked up, then its homes are listed.
  wake(0, [title("lot-1"), title("lot-2"), title("lot-3", "landlord-2")]);
  expect(asked).toEqual(["lot-1", "lot-2"]);
  expect([...new Set(listed)].sort()).toEqual(["s1", "s2"]);
  // Later wakes ask nothing more; a title with no plan in the register is asked about once.
  wake(WEEK, [title("lot-9")]);
  wake(2 * WEEK, []);
  expect(asked).toEqual(["lot-1", "lot-2", "lot-9"]);
});

// ------------------------------------------------------------------ building: an offer the builder declines

interface Made { t: number; fn: string; args: { [k: string]: any }; id?: string }

/** A landlord with two homes let and an empty lot, woken weekly from day 0 to `until`: `world(t, last)` gives what is
 * new that week, having seen what the landlord did the week before (each call, with the id the world gave what it
 * made). Returns every call. */
function developing(until: number, world: (t: number, last: Made[]) => any[], balance: number | ((t: number) => number) = 100_000_000, post?: (t: number, last: Made[]) => any[],
  town: { built?: (t: number) => string[]; paid?: (t: number) => any[] } = {}): Made[] {
  const m = landlord.create(ctx({ develop: true, develop_type: "house", develop_window_days: 90, renew: false, spend_share_bps: 0, upkeep_share_bps: 0, base_rent: { house: RENT }, builder: "builder", city: "city" }));
  const lot = (id: string, cells: string[]) => statement(id, 0, "lot", { data: { cells } });
  const title = (l: string) => ({ id: `own-${l}`, at: 0, author: "genesis", record: "claim", position: "right", holder: ME, about: { kind: "ownership", object: l }, visible_to: "public" });
  // (Two empty lots: lot-2 and lot-3. `town.built(t)`: the empty cells with a building begun on them by then.)
  const genesis = [lot("lot-1", ["c1", "c2"]), lot("lot-2", ["c3"]), lot("lot-3", ["c4"]), title("lot-1"), title("lot-2"), title("lot-3"),
    lease("L1-a", 0, "ann", "s1/home"), ...signed("L1-a", 0, "ann"), lease("L1-b", 0, "bob", "s2/home"), ...signed("L1-b", 0, "bob")];
  const cells = [...["s1", "s2"].map((s, i) => ({ cell: `c${i + 1}`, structure: { structure: s, type: "house", complete: true, spaces: [{ space: `${s}/home`, kind: "dwelling", capacity: 6, count: 1, attrs: { bedrooms: 2 } }] } })), ];
  const sites = (t: number) => [...cells, ...["c3", "c4"].map((c) => ((town.built?.(t) ?? []).includes(c) ? { cell: c, structure: { structure: `new-${c}`, type: "house", complete: false, spaces: [] } } : { cell: c }))];
  const readings = { "L1-a": { of: "agreement", status: "in_force", ends_at: 2000 * DAY }, "L1-b": { of: "agreement", status: "in_force", ends_at: 2000 * DAY } };
  const all: Made[] = [];
  let last: Made[] = [];
  let n = 0;
  const wake = (t: number, woke_for: string, records: any[]) => {
    const made: Made[] = [];
    let o = { t, entity: ME, woke_for, outcomes: [], readings, channels: { mine: { kind: "records", records }, sites: { kind: "sites", cells: sites(t) },
      bank: { kind: "accounts", accounts: [{ account: "acc-landlord", holder: ME, custodian: "bank", currency: "AUD", balance: String(typeof balance === "number" ? balance : balance(t)) }], transactions: woke_for === "cadence" ? (town.paid?.(t) ?? []) : [] } } } as unknown as Observation;
    for (let i = 0; i < 50; i++) {
      const a: any = m.step(o, undefined as any);
      if (a.type === "wait") break;
      const created: { [name: string]: string } = {};
      for (const c of callsOf(a, t)) {
        const id = `made-${++n}`;
        if (c.bind) created[c.bind] = id;
        made.push({ t, fn: c.fn, args: c.args, id });
      }
      // (An act takes a minute, as in a world: the landlord plans again when its acts are done, a little later, on
      // what it was shown when the wake began. The bank has moved nothing yet.)
      o = { ...o, t: o.t + 60, woke_for: "done", outcomes: [{ action: `act-${n}`, t: o.t + 60, status: "applied", created }], channels: { ...o.channels, mine: { kind: "records", records: [] }, bank: { ...(o.channels as any).bank, transactions: [] } } } as unknown as Observation;
    }
    all.push(...made);
    return made;
  };
  for (let t = 0; t <= until; t += WEEK) {
    last = wake(t, "cadence", [...(t === 0 ? genesis : []), ...world(t, last)]);
    // The post, a day on: what came in answer to that week's acts, which wakes the landlord (if anything came).
    const letters = post?.(t + DAY, last) ?? [];
    if (letters.length) wake(t + DAY, "news", letters);
  }
  return all;
}
const priceList = (id: string, at: number, house: number) => statement(id, at, "price_list", { speaks_for: "builder", data: { prices: { house }, demolition: { house: 1_000_000 } } });
const declined = (id: string, at: number, agreement: string, data: object) => statement(id, at, "offer_declined", { speaks_for: "builder", addressed_to: [ME], visible_to: [ME, "builder"], basis: agreement, data: { agreement, ...data } });
const granted = (t: number, application: string) => statement(`pd-${application}`, t, "permit_decision", { addressed_to: [ME], data: { application, decision: "granted" } });
const isApplication = (c: Made) => c.fn === "form" && c.args.form === "permit_application";

test("a landlord whose offer the builder declines for the price offers again a week on, at what the builder charges now, and once", () => {
  let first: string | undefined, second: string | undefined, third: string | undefined;
  const offers: Made[] = [];
  const said = developing(60 * WEEK, (t, last) => [...(t === 0 ? [priceList("pl-1", 0, 27_000_000)] : []), ...last.filter(isApplication).map((c) => granted(t, c.id!))], 100_000_000, (t, last) => {
    // The builder's answers come by post the day after, and wake the landlord.
    const out: any[] = [];
    for (const c of last) {
      if (c.fn !== "structure") continue;
      offers.push(c);
      // The first offer crosses a change of prices: declined, the letter naming the price (the landlord holds no
      // list as late as the letter).
      if (!first) out.push(declined("no-1", t, (first = c.id!), { price: "28000000" }));
      // The second is declined too, and a list later than that letter is out before the landlord plans again.
      else if (!second) out.push(declined("no-2", t - 3600, (second = c.id!), { price: "28500000" }), priceList("pl-3", t, 29_000_000));
      // The third: the builder says the lot is taken.
      else if (!third) out.push(declined("no-3", t, (third = c.id!), { reason: "site_taken" }));
    }
    return out;
  });
  // Three offers for the one lot: at the list, then at the letter's price, then at the later list's; each a week
  // after the last, not on the day the letter came and woke it, and none repeated while nothing new has come.
  // (A fourth follows the second application, half a year on: a new plan, at the list then standing.)
  expect(offers.map((o) => [o.args.on, o.args.by, Number(parseAmount(o.args.price, currencyNow()))])).toEqual([["lot-2", "builder", 27_000_000], ["lot-2", "builder", 28_000_000], ["lot-2", "builder", 29_000_000], ["lot-2", "builder", 29_000_000]]);
  expect(offers[1]!.t - offers[0]!.t).toBe(WEEK);
  expect(offers[2]!.t - offers[1]!.t).toBe(WEEK);
  for (const o of offers) expect(o.t % WEEK).toBe(0);
  // Told the lot is taken, it gives the plan up, and waits as long as after a refusal it accepts before applying again.
  const apps = said.filter(isApplication);
  expect(apps).toHaveLength(2);
  expect(apps[1]!.t - offers[2]!.t).toBeGreaterThanOrEqual(180 * DAY);
  expect(apps[1]!.t - offers[2]!.t).toBeLessThan(180 * DAY + 2 * WEEK);
  expect(offers[3]!.t).toBeGreaterThan(apps[1]!.t);
});

test("a landlord who cannot pay the builder's new price keeps its permit and waits; one whose offer stands does nothing more", () => {
  // Enough to begin at the first list (one and a half times its price); not enough for the price the letter names.
  let first: string | undefined;
  const short = developing(40 * WEEK, (t, last) => {
    const out: any[] = t === 0 ? [priceList("pl-1", 0, 27_000_000)] : [];
    for (const c of last) {
      if (isApplication(c)) out.push(granted(t, c.id!));
      if (c.fn === "structure" && !first) out.push(declined("no-1", t, (first = c.id!), { price: "60000000" }));
    }
    return out;
  }, 41_000_000);
  expect(short.filter((c) => c.fn === "structure")).toHaveLength(1);
  expect(short.filter(isApplication)).toHaveLength(1);
  // Not declined: one offer, and the landlord waits for its building.
  const waiting = developing(40 * WEEK, (t, last) => [...(t === 0 ? [priceList("pl-1", 0, 27_000_000)] : []), ...last.filter(isApplication).map((c) => granted(t, c.id!))]);
  expect(waiting.filter((c) => c.fn === "structure")).toHaveLength(1);
  expect(waiting.filter(isApplication)).toHaveLength(1);
});

// ------------------------------------------------------------------ building: what it owes, and its invoices

const PRICE = 27_000_000;
const invoice = (id: string, at: number, agreement: string, amount = PRICE) => statement(id, at, "invoice", { speaks_for: "builder", addressed_to: [ME], visible_to: [ME, "builder"], basis: agreement, data: { agreement, outcome: { money: { to: "acc-builder", amount: String(amount), for: "building a house" } } } });
const amountOf = (c: Made) => Number(parseAmount(c.args.amount, currencyNow()));

/** A town for one landlord with two empty lots: permits are granted; the builder begins a house a week after it is
 * asked and invoices its price then; the bank pays what the landlord tells it to by the week after, out of `money`
 * (which `spend(t)` may also draw on). Returns the landlord's calls and what it was invoiced. */
function building(until: number, money: number, spend: (t: number) => number = () => 0) {
  const offers: Made[] = [], invoices: { id: string; at: number }[] = [], payments: Made[] = [];
  const begun = new Map<string, number>(); // cell -> when
  let due: any[] = []; // what the bank pays by the next week
  const said = developing(until, (t, last) => {
    const out: any[] = t === 0 ? [priceList("pl-1", 0, PRICE)] : [];
    for (const c of last) {
      if (isApplication(c)) out.push(granted(t, c.id!));
      if (c.fn === "structure") {
        offers.push(c);
        begun.set(c.args.on === "lot-2" ? "c3" : "c4", t);
        invoices.push({ id: `inv-${c.id}`, at: t });
        out.push(invoice(`inv-${c.id}`, t, c.id!));
      }
      if (c.fn === "money" && c.args.settles) {
        payments.push(c);
        money -= amountOf(c);
        due.push({ t, from: "acc-landlord", to: "acc-builder", amount: String(amountOf(c)), currency: "AUD", by: "bank", settles: c.args.settles });
      }
    }
    money -= spend(t);
    return out;
  }, () => money, undefined, { built: (t) => [...begun].filter(([, at]) => at <= t).map(([c]) => c), paid: () => due.splice(0) });
  return { said, offers, invoices, payments };
}

test("a landlord asks for a second house only on money the first does not need", () => {
  // Twice the price and a fifth: enough to begin one (one and a half times the price), and after that one's price is
  // set aside, not enough to begin another. (On the balance alone it asked for both, and could pay for one.)
  const one = building(60 * WEEK, (PRICE * 22) / 10);
  expect(one.offers.map((o) => o.args.on)).toEqual(["lot-2"]);
  expect(one.said.filter(isApplication)).toHaveLength(1);
  expect(one.payments.map((c) => [c.args.settles, amountOf(c)])).toEqual([[one.invoices[0]!.id, PRICE]]);
  // Two and a half times the price and a little: one house's price aside, it can still begin another; both are paid.
  const two = building(60 * WEEK, (PRICE * 26) / 10);
  expect(two.offers.map((o) => o.args.on)).toEqual(["lot-2", "lot-3"]);
  expect(two.payments.map((c) => c.args.settles).sort()).toEqual(two.invoices.map((i) => i.id).sort());
});

test("an invoice that comes when the landlord is short stays open, and is paid when it can be, once", () => {
  // Enough to begin and to ask. In the week the house is begun and invoiced the money has gone elsewhere; ten weeks
  // on it is back. (When the house is asked for: found by a first run with nothing spent.)
  const t0 = building(60 * WEEK, (PRICE * 16) / 10).offers[0]!.t;
  const short = building(60 * WEEK, (PRICE * 16) / 10, (t) => (t === t0 + WEEK ? PRICE : t === t0 + 11 * WEEK ? -PRICE : 0));
  expect(short.offers.map((o) => o.t)).toEqual([t0]);
  expect(short.invoices).toEqual([{ id: short.invoices[0]!.id, at: t0 + WEEK }]);
  // Not paid while short (three fifths of the price in hand); paid at the plan when the money is back; never again.
  expect(short.payments.map((c) => [c.args.settles, amountOf(c), c.t])).toEqual([[short.invoices[0]!.id, PRICE, t0 + 11 * WEEK]]);
});

// Bug hunt 2026-10-17, finding 3: a tenant who dies, and the household still living there. Read from the papers the landlord has, not from who
// was seen where when it looked.
test("a tenant whose death is registered: notice on the lease, the tenancy offered to the household member, and no possession sought against the dead", () => {
  const m = landlord.create(ctx({ develop: false, renew: true, min_term_months: 12, max_term_months: 12, arrears_months_before_notice: 2, spend_share_bps: 0, upkeep_share_bps: 0, base_rent: { house: RENT }, landlord_notice_days: 60,
    possession: { tribunal: "tribunal" } }));
  const base = lease("L1-a", 0, "ann", "s1/home");
  const genesis = [
    { id: "lot-1", at: 0, author: "genesis", record: "statement", kind: "lot", speaks_for: "city", visible_to: "public", text: "Lot 1.", data: { cells: ["c1"] } },
    { id: "own-1", at: 0, author: "genesis", record: "claim", position: "right", holder: ME, about: { kind: "ownership", object: "lot-1" }, visible_to: "public" },
    { ...base, terms: { ...base.terms, text: "ann rents home s1/home from landlord-1 for 1500.00 a month, to live there with their household: ann, pat." } }, ...signed("L1-a", 0, "ann"),
  ];
  const death = statement("rec.d1", 5 * WEEK, "death_registration", { speaks_for: "city", addressed_to: [ME], visible_to: [ME, "city"], data: { deceased: "ann", partner: "pat", children: [] } });
  const cells = [{ cell: "c1", structure: { structure: "s1", type: "house", complete: true, spaces: [{ space: "s1/home", kind: "dwelling", capacity: 6, count: 1, attrs: { bedrooms: 2 } }] } }];
  const said: { t: number; call: string }[] = [];
  const readings = { "L1-a": { of: "agreement", status: "in_force", ends_at: 12 * MONTH } };
  for (let t = 0; t <= 20 * WEEK; t += WEEK) {
    let o = { t, entity: ME, woke_for: "cadence", outcomes: [], readings, channels: {
      mine: { kind: "records", records: t === 0 ? genesis : t === 5 * WEEK ? [death] : [] },
      sites: { kind: "sites", cells },
      bank: { kind: "accounts", accounts: [{ account: "acc-landlord", holder: ME, custodian: "bank", currency: "AUD", balance: "100000000" }], transactions: [] },
    } } as unknown as Observation;
    for (let i = 0; i < 50; i++) {
      const a: any = m.step(o, undefined as any);
      if (a.type === "wait") break;
      said.push({ t, call: a.call });
      o = { ...o, woke_for: "done", outcomes: [{ action: "call", t, status: "ok" }], channels: { ...o.channels, mine: { kind: "records", records: [] }, bank: { ...(o.channels as any).bank, transactions: [] } } } as unknown as Observation;
    }
  }
  const after = said.filter((c) => c.t >= 5 * WEEK).map((c) => c.call).join("\n");
  expect(after).toMatch(/agreement\(notice=L1-a/);
  expect(after).toMatch(/agreement\(.*pat/s); // the tenancy offered to the one still there
  expect(after).not.toMatch(/tribunal_application|notice_to_vacate/);
});
