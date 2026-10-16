// Everyday frictions, and how they are heard (docs/behaviour/frictions.md): the arithmetic of a rate; what an
// organisation does when asked to put something right, told of a complaint, or ordered to; how a venue hears an
// application; and a townsperson to whom something has happened: pay come short, a home in disrepair. A grievance
// never executes itself: money moves when the other side pays, a venue's decision is words, and nothing reaches
// the claims a firm pays without question.

import { expect, test } from "bun:test";
import { citizen } from "../src/behaviour/citizen";
import { Book, callAction } from "../src/behaviour/common";
import { desk, Hearings, HEARING_DEFAULTS, hearingOffer } from "../src/behaviour/desk";
import { chancePpm, frictionDial, PAPER, Respondent } from "../src/behaviour/frictions";
import { inCurrency } from "../src/money";
import { OUTCOMES } from "../src/module";
import { Randomness } from "../src/rng";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";
import { callsOf, context, DAY, employment, lease, person, signed, standingOrder, statement, wake, type Said } from "./stepping";

inCurrency(PROFILE.values.currency);
const rng = (k: string) => new Randomness(7n).stream(["test", k]);

test("a yearly rate becomes a period's chance in whole numbers, scaled by the dial, and nothing with the dial off", () => {
  expect(chancePpm(3_650, 1, 10_000)).toBe(1_000); // 36.5% a year: one in a thousand a day
  expect(chancePpm(3_650, 1, 20_000)).toBe(2_000);
  expect(chancePpm(3_650, 1, 0)).toBe(0);
  expect(chancePpm(0, 30, 10_000)).toBe(0);
  expect(chancePpm(10_000, 3_650, 10_000)).toBe(1_000_000); // never over certainty
  expect(frictionDial({})).toBe(0);
  expect(frictionDial({ dials: { friction_bps: 5_000 } })).toBe(5_000);
});

// ---------------------------------------------------------------- an organisation asked, told, ordered

const book = (records: any[]) => {
  const b = new Book();
  b.absorb({ t: 0, entity: "shop-1", participant: "x", channels: { mine: { kind: "records", records } }, inbox: [], outcomes: [], woke_for: "cadence" } as any);
  return b;
};
const request = (id: string, data: object, from = "c1") => statement(id, DAY, PAPER.request, { author: `${from}-self`, speaks_for: from, addressed_to: ["shop-1"], visible_to: [from, "shop-1"], data });
const said = (steps: any[]): Said[] => steps.flatMap((s) => callsOf(callAction(s) as any));

test("asked to put right what its books say it owes, an organisation that will pays exactly that and says so; one that will not says no or nothing", () => {
  const yes = new Respondent(rng, "shop-1", null, { params: { grant_bps: { underpaid: 10_000 } }, truth: () => ({ owed: 4_200 }) });
  const s = said(yes.steps(book([request("r1", { matter: "underpaid", about: "J1", amount: 9_999, account: "acc-c1" })]), 2 * DAY, "acc-shop-1", 1_000_000));
  expect(s.filter((c) => c.fn === "money").map((c) => [c.args.to, c.args.amount, c.args.settles])).toEqual([["acc-c1", "$42.00", "r1"]]);
  expect(s.find((c) => c.args.kind === PAPER.answer)!.args.data).toEqual({ request: "r1", matter: "underpaid", granted: true, amount: 4_200 });
  // Once: the same request on file again is not answered twice.
  const no = new Respondent(rng, "shop-1", null, { params: { grant_bps: { underpaid: 0 }, answers_bps: 10_000 }, truth: () => ({ owed: 4_200 }) });
  const b = book([request("r1", { matter: "underpaid", about: "J1", amount: 4_200, account: "acc-c1" })]);
  const n = said(no.steps(b, 2 * DAY, "acc-shop-1", 1_000_000));
  expect(n.some((c) => c.fn === "money")).toBe(false);
  expect(n.find((c) => c.args.kind === PAPER.answer)!.args.data.granted).toBe(false);
  expect(no.steps(b, 3 * DAY, "acc-shop-1", 1_000_000)).toEqual([]);
  const silent = new Respondent(rng, "shop-1", null, { params: { grant_bps: { underpaid: 0 }, answers_bps: 0 }, truth: () => ({ owed: 4_200 }) });
  expect(silent.steps(book([request("r1", { matter: "underpaid", amount: 4_200, account: "acc-c1" })]), 2 * DAY, "acc-shop-1", 1_000_000)).toEqual([]);
});

test("its books showing nothing owed, it says so and pays nothing however willing; what it cannot know it takes on the asker's word, if it will; what it cannot pay it does not grant", () => {
  const will = { params: { grant_bps: { other: 10_000 } } };
  const nothing = said(new Respondent(rng, "shop-1", null, { ...will, truth: () => ({ owed: 0 }) }).steps(book([request("r1", { matter: "underpaid", amount: 500, account: "acc-c1" })]), DAY, "acc-shop-1", 1_000_000));
  expect(nothing.some((c) => c.fn === "money")).toBe(false);
  expect(nothing[0]!.args.data).toEqual({ request: "r1", matter: "underpaid", granted: false, reason: "nothing owed on our records" });
  const word = said(new Respondent(rng, "shop-1", null, { ...will, truth: () => undefined }).steps(book([request("r2", { matter: "goods", amount: 700, account: "acc-c1" })]), DAY, "acc-shop-1", 1_000_000));
  expect(word.filter((c) => c.fn === "money").map((c) => c.args.amount)).toEqual(["$7.00"]);
  const broke = said(new Respondent(rng, "shop-1", null, { params: { grant_bps: { other: 10_000 }, answers_bps: 10_000 }, truth: () => undefined }).steps(book([request("r3", { matter: "goods", amount: 700, account: "acc-c1" })]), DAY, "acc-shop-1", 100));
  expect(broke.some((c) => c.fn === "money")).toBe(false);
});

test("told of a complaint it answers a venue from its books; ordered to pay, one that obeys pays the order and one that does not pays nothing", () => {
  const notice = statement("n1", DAY, PAPER.notice, { speaks_for: "ombudsman", addressed_to: ["c1", "shop-1"], visible_to: ["c1", "shop-1", "ombudsman"], basis: "a1", data: { application: "a1", matter: "underpaid", applicant: "c1", against: "shop-1", about: "J1", amount: 9_000 } });
  const r = new Respondent(rng, "shop-1", null, { params: { responds_bps: 10_000 }, truth: () => ({ owed: 4_200 }) });
  const a = said(r.steps(book([notice]), 2 * DAY, "acc-shop-1", 1_000_000));
  expect(a.map((c) => [c.args.kind, c.args.to, c.args.data])).toEqual([[PAPER.response, ["ombudsman"], { application: "a1", owed: 4_200, known: true }]]);
  const order = statement("d1", 20 * DAY, PAPER.decision, { speaks_for: "ombudsman", addressed_to: ["c1", "shop-1"], visible_to: ["c1", "shop-1", "ombudsman"], basis: "a1", data: { application: "a1", matter: "underpaid", applicant: "c1", against: "shop-1", finding: "pay", binding: true, amount: 4_200, to: "acc-c1", due: 48 * DAY } });
  const obeys = said(new Respondent(rng, "shop-1", null, { params: { comply_bps: 10_000 }, truth: () => undefined }).steps(book([order]), 21 * DAY, "acc-shop-1", 1_000_000));
  expect(obeys.filter((c) => c.fn === "money").map((c) => [c.args.to, c.args.amount, c.args.settles])).toEqual([["acc-c1", "$42.00", "d1"]]);
  expect(new Respondent(rng, "shop-1", null, { params: { comply_bps: 0 }, truth: () => undefined }).steps(book([order]), 21 * DAY, "acc-shop-1", 1_000_000)).toEqual([]);
});

// ---------------------------------------------------------------- a venue

const application = (id: string, at: number, data: object, from = "c1", to = "desk-1") => statement(id, at, PAPER.application, { author: `${from}-self`, speaks_for: from, addressed_to: [to], visible_to: [from, to], data });
const response = (id: string, at: number, about: string, data: object, from = "shop-1", to = "desk-1") => statement(id, at, PAPER.response, { author: `${from}-x`, speaks_for: from, addressed_to: [to], visible_to: [from, to], basis: about, data: { application: about, ...data } });
/** A venue's hearings over the days given, each day shown what has newly come; what it said, by day. */
function heard(p: object, days: [number, any[]][], until = 40) {
  const h = new Hearings("desk-1", rng, { ...HEARING_DEFAULTS, hears: [{ about: "underpaid", can: ["recommend"] }, { about: "goods", can: ["recommend"] }, { about: "disrepair", can: ["order"] }], ...p });
  const b = new Book();
  const out: { day: number; kind: string; data: any; to: string[] }[] = [];
  for (let d = 0; d <= until; d++) {
    b.absorb({ t: d * DAY, entity: "desk-1", participant: "x", channels: { mine: { kind: "records", records: days.filter(([at]) => at === d).flatMap(([, r]) => r) } }, inbox: [], outcomes: [], woke_for: "cadence" } as any);
    for (const c of said(h.steps(b, d * DAY))) out.push({ day: d, kind: c.args.kind, data: c.args.data, to: c.args.to });
  }
  return { out, h };
}

test("a venue tells the other side and gives it time; on its answer that money is owed, recommends or orders that sum; with no answer, the applicant's account stands", () => {
  const a = heard({}, [[1, [application("a1", DAY, { matter: "underpaid", against: "shop-1", about: "J1", amount: 9_000, account: "acc-c1" })]], [5, [response("p1", 5 * DAY, "a1", { owed: 4_200, known: true })]]]).out;
  expect(a.map((x) => [x.day, x.kind])).toEqual([[1, PAPER.notice], [15, PAPER.decision]]);
  expect(a[0]!.to).toEqual(["c1", "shop-1"]);
  expect(a[1]!.data).toMatchObject({ application: "a1", matter: "underpaid", applicant: "c1", against: "shop-1", finding: "pay", binding: false, amount: 4_200, to: "acc-c1" });
  const d = heard({}, [[1, [application("a1", DAY, { matter: "underpaid", against: "shop-1", amount: 9_000, account: "acc-c1" })]]]).out;
  expect(d[1]!.data).toMatchObject({ finding: "pay", amount: 9_000 });
  const done = heard({}, [[1, [application("a1", DAY, { matter: "disrepair", against: "landlord-1", structure: "house-1", seeks: "repair" })]], [3, [response("p1", 3 * DAY, "a1", { done: false, known: true }, "landlord-1")]]]).out;
  expect(done[1]!.data).toMatchObject({ finding: "do", binding: true, structure: "house-1" });
});

test("where the other side cannot say from its records, someone who can show a paper for it is believed; someone with only their word, as often as the venue's own figure says", () => {
  const cannot = [3, [response("p1", 3 * DAY, "a1", { known: false })]] as [number, any[]];
  const shown = heard({ uphold_bps: { other: 0 } }, [[1, [application("a1", DAY, { matter: "goods", against: "shop-1", amount: 700, account: "acc-c1", evidence: { order: "o1", delivered: 4, faulty: 1 } })]], cannot]).out;
  expect(shown[1]!.data).toMatchObject({ finding: "pay", amount: 700 });
  const bare = (bps: number) => heard({ uphold_bps: { other: bps } }, [[1, [application("a1", DAY, { matter: "goods", against: "shop-1", amount: 700, account: "acc-c1" })]], cannot]).out[1]!.data.finding;
  expect(bare(0)).toBe("dismissed");
  expect(bare(10_000)).toBe("pay");
});

test("a venue says so when it does not hear a matter, and decides every case whose time has run: how many a day is its members' hours, which the kernel keeps", () => {
  const not = heard({}, [[1, [application("a1", DAY, { matter: "noise", against: "c9" })]]]).out;
  expect(not.map((x) => [x.kind, x.data.finding])).toEqual([[PAPER.decision, "rejected"]]);
  const many = Array.from({ length: 6 }, (_, i) => application(`a${i}`, DAY, { matter: "underpaid", against: "shop-1", amount: 100 + i, account: "acc-c1" }, `c${i}`));
  const { out, h } = heard({}, [[1, many]]);
  // (Foundations F6: until then a number of cases a day, 2 here, spread these over three days. Now the module asks for all six on the day their time has
  // run, and each is an act that takes its member's time (a row of the world's table) and waits its turn on their timeline: a backlog is hours.)
  expect(out.filter((x) => x.kind === PAPER.decision).map((x) => x.day)).toEqual([15, 15, 15, 15, 15, 15]);
  expect(h.counts).toMatchObject({ applications: 6, pay: 6 });
  expect(h.waits).toEqual([14, 14, 14, 14, 14, 14]);
});

test("a desk says publicly what it hears, in an offer anyone may apply to", () => {
  const m = desk.create(context("desk-1-system", "desk-1", { title: "consumer desk", hears: [{ about: "goods", can: ["recommend"] }] }, { position: "desk-1-officer" }));
  const w = wake(m, 0, { mine: { kind: "records", records: [] } }, { entity: "desk-1", as: { participant: "desk-1-system" } });
  const notice = w.of("statement", "hearing")[0]!;
  expect(notice.args.visible).toBe("public");
  expect(notice.args.offer).toEqual(hearingOffer("desk-1", [{ about: "goods", can: ["recommend"] }]));
  expect(notice.args.offer.hears).toEqual([{ about: "goods", can: ["recommend"] }]);
});

// ---------------------------------------------------------------- a townsperson

const WAGE = 120_000, RENT = 100_000, HOME = "apts-1/dwelling.1";
const life = () => [...signed(lease("L1", 0, "landlord-1", "c1", HOME, RENT)), standingOrder("so-1", 0, "c1", "acc-landlord-1", RENT, { basis: "L1", first: 0 }), ...signed(employment("J1", 0, "factory-1", "c1", WAGE))];
const paid = (t: number, amount: number, order: string | null = "wo-1") => [{ t: t - DAY, from: "acc-factory-1", to: "acc-c1", amount: String(amount), currency: "AUD", by: "bank", memo: "wages", ...(order ? { per_instruction: order } : {}) }];
const READ = { L1: { of: "agreement", status: "in_force" }, J1: { of: "agreement", status: "in_force" } };
const hearing = (id: string, by: string, about: string) => statement(id, 0, "hearing", { speaks_for: by, visible_to: "public", offer: hearingOffer(by, [{ about, can: ["recommend"] }]) });
function watched(params: object, dial: number | undefined, seed = 1n) {
  const outcomes: any[] = [];
  const module = { create: (ctx: any) => {
    if (dial !== undefined) ctx.world = { ...ctx.world, dials: { ...(ctx.world?.dials ?? {}), friction_bps: dial } };
    const m = citizen.create(ctx);
    return { step: async (o: any, c: any) => {
      const a: any = await m.step(o, c);
      outcomes.push(...(a[OUTCOMES] ?? []));
      return a;
    } };
  } };
  return { p: person(module, params, { seed }), outcomes };
}
// Someone who would always sooner act than wait, whoever they are, and has nobody to tell.
const ACTS = { initiative: true, wants: { choice: { trust: 0, own: 100_000, agency: 0, fear: 0, others: 0, belief: 0 } } };

test("pay that comes short is known as short pay: it is not taken for no pay, the difference is owed, and with the dial off nothing of the kind is noticed", async () => {
  const { p, outcomes } = watched(ACTS, 10_000);
  await p.wake(DAY, { records: life(), readings: READ, balance: 5_000_000, transactions: paid(DAY, WAGE) });
  const s = await p.wake(15 * DAY, { transactions: paid(15 * DAY, WAGE - 6_000) });
  expect(outcomes.filter((o) => o.domain === "job" && o.kind === "short").map((o) => o.facts.short)).toEqual([6_000]);
  expect(outcomes.filter((o) => o.domain === "friction").map((o) => [o.option, o.kind, o.from, o.facts.amount])).toEqual([["underpaid", "arose", "factory-1", 6_000]]);
  // Nothing recorded as a debt (a firm pays any debt recorded against it): what is owed is asked for, on a letter.
  expect(s.some((c) => c.fn === "claim")).toBe(false);
  const later = await p.wake(36 * DAY, { transactions: paid(29 * DAY, WAGE - 6_000) });
  expect([...s, ...later].some((c) => c.fn === "agreement" && c.args.notice)).toBe(false); // (not resigning as if unpaid)
  const off = watched(ACTS, undefined);
  await off.p.wake(DAY, { records: life(), readings: READ, balance: 5_000_000, transactions: paid(DAY, WAGE) });
  await off.p.wake(15 * DAY, { transactions: paid(15 * DAY, WAGE - 6_000) });
  expect(off.outcomes.some((o) => o.domain === "friction" || o.kind === "short")).toBe(false);
  // A single payment from the employer that is less than a wage (a part pay at the return from a stoppage) is not
  // the standing wage come short.
  const part = watched(ACTS, 10_000);
  await part.p.wake(DAY, { records: life(), readings: READ, balance: 5_000_000, transactions: paid(DAY, WAGE) });
  await part.p.wake(15 * DAY, { transactions: paid(15 * DAY, WAGE - 40_000, null) });
  expect(part.outcomes.some((o) => o.domain === "friction" || o.kind === "short")).toBe(false);
});

test("someone underpaid who acts asks the employer; refused, takes it to a body that says it hears such things, found by what it says; paid under its decision, it is over and trust follows", async () => {
  // (Someone not looking for other work: leaving is not among what they weigh.)
  const { p, outcomes } = watched({ ...ACTS, in_labour_force: false }, 10_000);
  await p.wake(DAY, { records: life(), readings: READ, balance: 5_000_000, transactions: paid(DAY, WAGE) });
  const all: Said[] = [];
  all.push(...await p.wake(15 * DAY, { transactions: paid(15 * DAY, WAGE - 6_000) }));
  for (let d = 22; d <= 64 && !all.some((c) => c.args.kind === PAPER.request); d += 7) all.push(...await p.wake(d * DAY, {}));
  const ask = all.find((c) => c.args.kind === PAPER.request)!;
  expect(ask.args.to).toEqual(["factory-1"]);
  expect(ask.args.data).toMatchObject({ matter: "underpaid", against: "factory-1", about: "J1", amount: 6_000, account: "acc-c1" });
  // Refused: the next thing tried is the mind's; the only body that hears pay is the one found.
  const refusal = statement("ans-1", 70 * DAY, PAPER.answer, { speaks_for: "factory-1", addressed_to: ["c1"], visible_to: ["c1", "factory-1"], data: { request: "x", matter: "underpaid", granted: false } });
  // (They come to see what two bodies say they hear; one of them hears pay.)
  const after: Said[] = await p.wake(70 * DAY, { records: [refusal, hearing("h1", "ombudsman", "underpaid"), hearing("h2", "consumer-desk", "goods")] });
  for (let d = 77; d <= 400 && !after.some((c) => c.args.kind === PAPER.application); d += 7) after.push(...await p.wake(d * DAY, {}));
  const app = after.find((c) => c.args.kind === PAPER.application)!;
  expect(app.args.to).toEqual(["ombudsman"]);
  expect(app.args.basis).toBe("h1");
  expect(app.args.data).toMatchObject({ kind: "underpaid", matter: "underpaid", against: "factory-1", amount: 6_000, account: "acc-c1" });
  expect(app.args.data.evidence).toBeDefined(); // (the agreement, tendered)
  const t = app.t;
  const decision = statement("dec-1", t + 20 * DAY, PAPER.decision, { speaks_for: "ombudsman", addressed_to: ["c1", "factory-1"], visible_to: ["c1", "factory-1", "ombudsman"], data: { application: "x", matter: "underpaid", applicant: "c1", against: "factory-1", finding: "pay", binding: false, amount: 6_000, to: "acc-c1", due: t + 48 * DAY } });
  await p.wake(t + 21 * DAY, { records: [decision] });
  await p.wake(t + 28 * DAY, { transactions: [{ t: t + 27 * DAY, from: "acc-factory-1", to: "acc-c1", amount: "6000", currency: "AUD", by: "bank", settles: "dec-1" }] });
  const ended = outcomes.filter((o) => o.domain === "friction" && o.kind === "ended");
  expect(ended.map((o) => [o.option, o.facts.how, o.facts.put_right, o.facts.venues])).toEqual([["underpaid", "paid on a recommendation", true, 1]]);
});

test("a home whose disrepair has reached the level that needs repair is the landlord's to put right; repaired, it is over; with the dial off it is nobody's grievance", async () => {
  const site = (value: number) => [{ cell: "cell.1.1", structure: { structure: "apts-1", type: "apartments", at: "cell.1.1", w: 1, h: 1, complete: true, variables: { disrepair: { value, as_of_day: 0, per_day: 0, min: 0, max: 100_000 } }, spaces: [] } }];
  const F = { ...ACTS, frictions: { disrepair: { variable: "disrepair", at: 50_000 } } };
  const { p, outcomes } = watched(F, 10_000);
  await p.wake(DAY, { records: life(), readings: READ, balance: 5_000_000, transactions: paid(DAY, WAGE), street: site(10_000), in: HOME });
  expect(outcomes.some((o) => o.domain === "friction")).toBe(false);
  const all: Said[] = await p.wake(8 * DAY, { street: site(60_000), in: HOME, transactions: paid(8 * DAY, WAGE) });
  expect(outcomes.filter((o) => o.domain === "friction").map((o) => [o.option, o.kind, o.from, o.facts.structure])).toEqual([["disrepair", "arose", "landlord-1", "apts-1"]]);
  for (let d = 15; d <= 64 && !all.some((c) => c.args.kind === PAPER.request); d += 7) all.push(...await p.wake(d * DAY, { street: site(60_000), in: HOME, transactions: paid(d * DAY, WAGE) }));
  expect(all.find((c) => c.args.kind === PAPER.request)!.args.data).toMatchObject({ matter: "disrepair", against: "landlord-1", structure: "apts-1", seeks: "repair" });
  await p.wake(80 * DAY, { street: site(0), in: HOME, transactions: paid(80 * DAY, WAGE) });
  expect(outcomes.filter((o) => o.domain === "friction" && o.kind === "ended").map((o) => [o.option, o.facts.how, o.facts.put_right])).toEqual([["disrepair", "repaired", true]]);
  const off = watched(F, undefined);
  await off.p.wake(DAY, { records: life(), readings: READ, balance: 5_000_000, transactions: paid(DAY, WAGE), street: site(60_000), in: HOME });
  await off.p.wake(8 * DAY, { street: site(60_000), in: HOME });
  expect(off.outcomes.some((o) => o.domain === "friction")).toBe(false);
});

test("with someone in the office, its staff settle what the record settles and put the rest before the office-holder, who decides it", () => {
  const p = { ...HEARING_DEFAULTS, hears: [{ about: "goods", can: ["recommend" as const] }], uphold_bps: { other: 10_000 } };
  const staff = new Hearings("desk-1", rng, p), seat = new Hearings("desk-1", rng, p);
  const b = new Book();
  const day = (d: number, records: any[], h: Hearings, part: "staff" | "seat") => {
    b.absorb({ t: d * DAY, entity: "desk-1", participant: "x", channels: { mine: { kind: "records", records } }, inbox: [], outcomes: [], woke_for: "cadence" } as any);
    return said(h.steps(b, d * DAY, part));
  };
  // Two applications about goods: one with the delivery note to show, one with nothing. The shop cannot say.
  day(1, [application("a1", DAY, { matter: "goods", against: "shop-1", amount: 700, account: "acc-c1", evidence: { order: "o1" } }), application("a2", DAY, { matter: "goods", against: "shop-1", amount: 900, account: "acc-c2" }, "c2")], staff, "staff");
  expect(day(1, [], seat, "seat")).toEqual([]);
  day(3, [response("p1", 3 * DAY, "a1", { known: false }), response("p2", 3 * DAY, "a2", { known: false })], staff, "staff");
  const out = day(15, [], staff, "staff");
  expect(out.map((c) => [c.args.kind, c.args.data.application, c.args.data.finding])).toEqual([[PAPER.decision, "a1", "pay"], ["case_for_decision", "a2", undefined]]);
  expect(staff.counts).toMatchObject({ applications: 2, pay: 1, for_decision: 1 });
  // The note on the office's file is what the office-holder decides from.
  const note = statement("n1", 15 * DAY, "case_for_decision", { speaks_for: "desk-1", addressed_to: ["desk-1"], visible_to: ["desk-1"], basis: "a2", data: out[1]!.args.data });
  const decided = day(16, [note], seat, "seat");
  expect(decided.map((c) => [c.args.kind, c.args.to, c.args.data.application, c.args.data.finding, c.args.data.amount, c.args.data.binding])).toEqual([[PAPER.decision, ["c2", "shop-1"], "a2", "pay", 900, false]]);
  expect(day(17, [], seat, "seat")).toEqual([]);
});

// ---------------------------------------------------------------- the organisations that cause it

import { landlord } from "../src/behaviour/firms";
import { retailer } from "../src/behaviour/retailer";

/** A shop with one assistant, woken week by week with what the test shows it; its calls each week. */
function shop(params: object, dial: number | undefined) {
  const id = "shop-1";
  const ctx: any = context(`${id}-manager-system`, id, { premises: id, workplace: `${id}/workplace.1`, suppliers: [], demand: 200, wage: 200_000, ...params }, { position: `${id}-manager` });
  if (dial !== undefined) ctx.world = { ...ctx.world, dials: { friction_bps: dial } };
  const m = retailer.create(ctx);
  const ids = { n: 0 };
  const own: any[] = [];
  const as = { participant: `${id}-manager-system`, position: `${id}-manager` };
  return (t: number, records: any[] = [], transactions: any[] = []) => {
    const books = { kind: "accounts", accounts: [{ account: `acc-${id}`, holder: id, custodian: "bank", currency: "AUD", balance: "100000000" }], transactions };
    const w = wake(m, t, { books, mine: { kind: "records", records: [...own.splice(0), ...records] } }, { entity: id, as, ids, more: { readings: { J1: { of: "agreement", status: "in_force" } } } });
    own.push(...w.made);
    return w;
  };
}
const wageOrders = (w: { said: Said[] }) => w.said.filter((c) => c.fn === "money" && c.args.every && String(c.args.for).startsWith("Wages"));

test("an employer begins to pay someone short at the world's rate and never with the dial off; what it kept back is on its books, and asked, one that will pays it and sets the pay right", () => {
  const job = signed(employment("J1", 0, "shop-1", "c1", 200_000));
  // (The highest rate there is, every job every year, at ten times the dial: about one week in five.)
  const at = shop({ short_pay: { per_year_bps: 10_000, by_bps: 500 }, respond: { grant_bps: { underpaid: 10_000 } } }, 100_000);
  const first = at(DAY, job);
  const full = wageOrders(first);
  expect(full.map((c) => c.args.amount)).toEqual(["$2000.00"]);
  let short: Said[] = [];
  let day = 8;
  for (; day <= 400 && !short.length; day += 7) short = wageOrders(at(day * DAY)).filter((c) => c.args.amount !== "$2000.00");
  expect(short.map((c) => c.args.amount)).toEqual(["$1900.00"]);
  // Two short pays later, the worker asks: its books say $200 was kept back; it pays that and sets the wage right.
  // (Its bank shows two pays under the short order: the test's world numbers what the shop makes, so the order is one of these.)
  const pays = [day + 14, day + 28].flatMap((d) => Array.from({ length: 12 }, (_, i) => ({ t: d * DAY, from: "acc-shop-1", to: "acc-c1", amount: "190000", currency: "AUD", by: "bank", per_instruction: `made.${i + 1}` })));
  const asked = at((day + 30) * DAY, [statement("r1", (day + 29) * DAY, PAPER.request, { author: "c1-self", speaks_for: "c1", addressed_to: ["shop-1"], visible_to: ["c1", "shop-1"], basis: "J1", data: { matter: "underpaid", against: "shop-1", about: "J1", amount: 99_999, account: "acc-c1" } })], pays);
  expect(asked.of("statement", PAPER.answer)[0]!.args.data).toEqual({ request: "r1", matter: "underpaid", granted: true, amount: 20_000 });
  expect(asked.said.filter((c) => c.fn === "money" && c.args.settles === "r1").map((c) => c.args.amount)).toEqual(["$200.00"]);
  expect(wageOrders(asked).map((c) => c.args.amount)).toEqual(["$2000.00"]);
  // The dial off: the same shop never pays short.
  const off = shop({ short_pay: { per_year_bps: 10_000, by_bps: 500 } }, undefined);
  off(DAY, job);
  for (let d = 8; d <= 400; d += 7) expect(wageOrders(off(d * DAY))).toEqual([]);
});

test("a landlord asked to repair a home orders the repair from the builder and pays its price, if it will and can; ordered by a tribunal, the same; owed rent, it writes to ask for it", () => {
  const ME = "landlord-1", RENT = 150_000;
  const run = (params: object, records: any[], balance = "100000000") => {
    const m = landlord.create({ participant: "landlord-1-office-system", entity: ME, rng: (k: string) => new Randomness(1n).stream([k]), world: { tickSeconds: 3600, runEnd: 2000 * DAY, dials: { friction_bps: 10_000 } },
      params: { develop: false, renew: false, spend_share_bps: 0, upkeep_share_bps: 0, base_rent: { house: RENT }, repair: { builder: "builder", account: "acc-builder", units: 16, price: 5_000 }, ...params } } as any);
    const base = [
      { id: "lot-1", at: 0, author: "genesis", record: "statement", kind: "lot", speaks_for: "city", visible_to: "public", text: "Lot 1.", data: { cells: ["c1"] } },
      { id: "own-1", at: 0, author: "genesis", record: "claim", position: "right", holder: ME, about: { kind: "ownership", object: "lot-1" }, visible_to: "public" },
      ...signed(lease("L1", 0, ME, "ann", "s1/home", RENT)), ...records];
    const cells = [{ cell: "c1", structure: { structure: "s1", type: "house", complete: true, spaces: [{ space: "s1/home", kind: "dwelling", capacity: 6, count: 1, attrs: { bedrooms: 2 } }] } }];
    let o: any = { t: 7 * DAY, entity: ME, woke_for: "cadence", outcomes: [], readings: { L1: { of: "agreement", status: "in_force" } }, channels: { mine: { kind: "records", records: base }, sites: { kind: "sites", cells },
      bank: { kind: "accounts", accounts: [{ account: "acc-landlord-1", holder: ME, custodian: "bank", currency: "AUD", balance }], transactions: [{ t: DAY, from: "acc-ann", to: "acc-landlord-1", amount: String(RENT), currency: "AUD", by: "bank", memo: "rent" }] } } };
    const out: Said[] = [];
    for (let i = 0; i < 50; i++) {
      const a: any = m.step(o, undefined as any);
      if (a.type === "wait") break;
      out.push(...callsOf(a, o.t));
      o = { ...o, woke_for: "done", outcomes: [{ action: "call", t: o.t, status: "ok" }], channels: { ...o.channels, mine: { kind: "records", records: [] }, bank: { ...o.channels.bank, transactions: [] } } };
    }
    return out;
  };
  const ask = statement("r1", 6 * DAY, PAPER.request, { author: "ann-self", speaks_for: "ann", addressed_to: [ME], visible_to: ["ann", ME], data: { matter: "disrepair", against: ME, structure: "s1", seeks: "repair" } });
  const will = run({ respond: { grant_bps: { disrepair: 10_000 } } }, [ask]);
  expect(will.find((c) => c.args.kind === "repair_order")!.args).toMatchObject({ to: ["builder"], data: { structure: "s1", units: 16, account: "acc-landlord-1" } });
  expect(will.filter((c) => c.fn === "money" && c.args.to === "acc-builder").map((c) => c.args.amount)).toEqual(["$800.00"]);
  expect(will.find((c) => c.args.kind === PAPER.answer)!.args.data).toMatchObject({ request: "r1", granted: true });
  // One that will not: no order, no payment. One that would but has not the money: the same.
  expect(run({ respond: { grant_bps: { disrepair: 0 } } }, [ask]).some((c) => c.args.kind === "repair_order")).toBe(false);
  expect(run({ respond: { grant_bps: { disrepair: 10_000 } } }, [ask], "50000").some((c) => c.args.kind === "repair_order")).toBe(false);
  // Ordered by the tribunal to put it right, and obeying: the repair is ordered.
  const order = statement("o1", 6 * DAY, "tribunal_order", { speaks_for: "tribunal", addressed_to: ["ann", ME], visible_to: ["ann", ME, "tribunal"], data: { application: "a1", kind: "disrepair", matter: "disrepair", applicant: "ann", against: ME, finding: "do", binding: true, structure: "s1", due: 40 * DAY } });
  expect(run({ respond: { comply_bps: 10_000 } }, [order]).some((c) => c.args.kind === "repair_order")).toBe(true);
  expect(run({ respond: { comply_bps: 0 } }, [order]).some((c) => c.args.kind === "repair_order")).toBe(false);
});

test("a landlord owed rent under one lease writes once to ask for it, however many leases the tenant has with it", () => {
  const ME = "landlord-1", RENT = 150_000;
  const m = landlord.create({ participant: "landlord-1-office-system", entity: ME, rng: (k: string) => new Randomness(1n).stream([k]), world: { tickSeconds: 3600, runEnd: 2000 * DAY, dials: { initiative_bps: 10_000, friction_bps: 10_000 } },
    params: { develop: false, renew: false, spend_share_bps: 0, upkeep_share_bps: 0, base_rent: { house: RENT }, initiative: true, arrears_months_before_notice: 2,
      // (An owner who would sooner keep a tenant than be rid of one: it bears with arrears longer than its routine, and asks meanwhile.)
      owner_values: { self_direction: 5_000, stimulation: 2_000, hedonism: 5_000, achievement: 2_000, power: 1_000, security: 5_000, conformity: 9_000, tradition: 5_000, benevolence: 9_000, universalism: 8_000 }, org: { patience_months: 2 } } } as any);
  // Ann has two leases with it: an old one three months behind, and one signed lately and paid.
  const records = [
    { id: "lot-1", at: 0, author: "genesis", record: "statement", kind: "lot", speaks_for: "city", visible_to: "public", text: "Lot 1.", data: { cells: ["c1", "c2"] } },
    { id: "own-1", at: 0, author: "genesis", record: "claim", position: "right", holder: ME, about: { kind: "ownership", object: "lot-1" }, visible_to: "public" },
    ...signed(lease("L1", 0, ME, "ann", "s1/home", RENT)), ...signed(lease("L2", 94 * DAY, ME, "ann", "s2/home", RENT), 94 * DAY)];
  const cells = ["s1", "s2"].map((s, i) => ({ cell: `c${i + 1}`, structure: { structure: s, type: "house", complete: true, spaces: [{ space: `${s}/home`, kind: "dwelling", capacity: 6, count: 1, attrs: { bedrooms: 2 } }] } }));
  const asks: Said[] = [];
  let first = true;
  for (const day of [100, 108, 115, 122]) {
    let o: any = { t: day * DAY, entity: ME, woke_for: "cadence", outcomes: [], readings: { L1: { of: "agreement", status: "in_force" }, L2: { of: "agreement", status: "in_force" } }, channels: { mine: { kind: "records", records: first ? records : [] }, sites: { kind: "sites", cells },
      bank: { kind: "accounts", accounts: [{ account: "acc-landlord-1", holder: ME, custodian: "bank", currency: "AUD", balance: "100000000" }], transactions: first ? [{ t: 95 * DAY, from: "acc-ann", to: "acc-landlord-1", amount: String(RENT), currency: "AUD", by: "bank", memo: "rent" }] : [] } } };
    first = false;
    let steps = 0;
    for (; steps < 200; steps++) {
      const a: any = m.step(o, undefined as any);
      if (a.type === "wait") break;
      asks.push(...callsOf(a, o.t).filter((c) => c.args.kind === PAPER.request));
      o = { ...o, woke_for: "done", outcomes: [{ action: "call", t: o.t, status: "ok" }], channels: { ...o.channels, mine: { kind: "records", records: [] }, bank: { ...o.channels.bank, transactions: [] } } };
    }
    expect(steps).toBeLessThan(200); // (it comes to rest: no turn-about of a want born and met)
  }
  expect(asks.map((c) => [c.args.to, c.args.basis, c.args.data.matter])).toEqual([[["ann"], "L1", "arrears"]]);
});
