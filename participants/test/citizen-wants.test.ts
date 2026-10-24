// Wants and initiative in a townsperson (docs/behaviour/citizen.md "Wants and initiative"): a rent rise is something
// to do something about. The tenant who takes initiative and trusts their landlord asks them to hold the rent, and
// the notice waits on the answer; granted, nothing changes and asking is learned to work; refused, or unanswered for
// a fortnight, the rise is dealt with as it stands. One who takes none does exactly what a tenant did before wants.

import { expect, test } from "bun:test";

import { inCurrency } from "../src/money";
import { DECISIONS, OUTCOMES, RECORD } from "../src/module";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";
import { DAY, employment, lease, person, signed, standingOrder, statement, type Said } from "./stepping";
import { engine } from "./engine";
const citizen = engine("citizen.default");

inCurrency(PROFILE.values.currency);

const WAGE = 120_000, RENT = 100_000, NEW_RENT = 105_000, HOME = "apts-1/dwelling.1";
const tenancy = () => [...signed(lease("L1", 0, "landlord-1", "c1", HOME, RENT)), standingOrder("so-1", 0, "c1", "acc-landlord-1", RENT, { basis: "L1", first: 0 }), ...signed(employment("J1", 0, "factory-1", "c1", WAGE))];
const wages = (t: number) => [{ t: t - DAY, from: "acc-factory-1", to: "acc-c1", amount: String(WAGE), currency: "AUD", by: "bank", memo: "wages" }];
const increase = (id: string, at: number, from: number) => statement(id, at, "rent_increase", { author: "landlord-1-office-system", speaks_for: "landlord-1", addressed_to: ["c1"], visible_to: ["landlord-1", "c1"], text: "Notice of rent increase.",
  data: { lease: "L1", rent: String(NEW_RENT), from, was: String(RENT), last_from: 0 } });
const answer = (id: string, at: number, about: string, granted: boolean) => statement(id, at, "variation_answer", { author: "landlord-1-office-system", speaks_for: "landlord-1", addressed_to: ["c1"], visible_to: ["landlord-1", "c1"], text: granted ? "Granted." : "Not granted.", data: { about, granted } });
const withdrawal = (id: string, at: number, of: string) => ({ id, at, record: "withdrawal", author: "landlord-1-office-system", speaks_for: "landlord-1", visible_to: ["landlord-1", "c1"], withdraws: of });
const orders = (said: Said[]) => said.filter((c) => c.fn === "money" && c.args.every);
const asks = (said: Said[]) => said.filter((c) => c.fn === "statement" && c.args.kind === "variation_request");
const READ = { L1: { of: "agreement", status: "in_force" }, J1: { of: "agreement", status: "in_force" } };

/** A townsperson whose record changes, outcomes and decisions are kept as they go to the orchestrator. */
function watched(params: object, seed = 1n) {
  const kept = { record: {} as { [section: string]: any }, because: [] as any[], outcomes: [] as any[], decisions: [] as any[] };
  const module = { create: (ctx: any) => {
    const m = citizen.create(ctx);
    return { step: async (o: any, c: any) => {
      const a: any = await m.step(o, c);
      if (a[RECORD]) { Object.assign(kept.record, a[RECORD].set); kept.because.push(...(a[RECORD].because ?? [])); }
      kept.outcomes.push(...(a[OUTCOMES] ?? []));
      kept.decisions.push(...(a[DECISIONS] ?? []));
      return a;
    } };
  } };
  return { p: person(module, params, { seed }), kept };
}
// People who turn to those they trust more than their town does, and to nobody else: the choice among ways is by
// trust alone (against the town's figure). Who trusts their landlord is who they are: their own lean, drawn once.
const BY_TRUST = { initiative: true, wants: { choice: { trust: 100_000, own: 0, agency: 0, fear: 0, others: 0, belief: 0 } } };
/** The first of the townspeople (by seed) who, given notice of a rise on day 40, asks the landlord (or does not). */
async function tenant(asking: boolean) {
  for (let seed = 1n; seed < 40n; seed++) {
    const x = watched(BY_TRUST, seed);
    await x.p.wake(DAY, { records: tenancy(), readings: READ, balance: 5_000_000, transactions: wages(DAY) });
    const said = await x.p.wake(40 * DAY, { records: [increase("inc-1", 40 * DAY, 100 * DAY)], transactions: wages(40 * DAY) });
    if ((asks(said).length > 0) === asking) return { ...x, said };
  }
  throw new Error("nobody");
}

test("a tenant who takes initiative and trusts the landlord asks them to hold a rent rise; granted, the rent stays, the want is met and asking is learned to work", async () => {
  const { p, kept, said } = await tenant(true);
  // A letter to the landlord, resting on the notice, saying in typed terms what the tenant would have: the old rent.
  expect(asks(said).map((c) => ({ to: c.args.to, basis: c.args.basis, data: c.args.data, text: c.args.text }))).toEqual([{ to: ["landlord-1"], basis: "inc-1", text: `Request: please hold the rent for ${HOME} at $1,000.00 a month.`,
    data: { agreement: "L1", about: "inc-1", would: { who: "c1", does: { outcome: { money: { amount: String(RENT) } } }, every: 30 * DAY } } }]);
  // No new rent order yet: the notice waits on the answer.
  expect(orders(said)).toEqual([]);
  // The want is in the record: what it is about, whom it concerns, the paper in its way, what it seeks, the way taken.
  expect(kept.record.wants.filter((w: any) => w.about === "rent_increase")).toMatchObject([{ about: "rent_increase", whom: "landlord-1", against: { record: "inc-1", kind: "rent_increase", by: "landlord-1" }, seeks: [{ money: { from: "me" } }], from: "event", tried: 1, way: "ask:landlord-1" }]);
  expect(kept.decisions.filter((d) => d.domain === "want" && d.options.some((o: any) => o.key === "ask")).map((d) => d.choice)).toEqual(["ask"]);
  expect(kept.outcomes.filter((o) => o.domain === "want" && o.option !== "social").map((o) => `${o.kind}:${o.option}`)).toEqual(["born:rent_increase", "pursued:rent_increase"]);
  // Granted: the notice is withdrawn. Nothing is paid differently; the want is met; what last passed with the landlord is that they granted it.
  const after = await p.wake(47 * DAY, { records: [answer("ans-1", 46 * DAY, "inc-1", true), withdrawal("w-1", 46 * DAY, "inc-1")], transactions: wages(47 * DAY) });
  expect(orders(after)).toEqual([]);
  expect(kept.record.wants.filter((w: any) => w.about !== "social")).toEqual([]);
  expect(kept.outcomes.filter((o) => o.domain === "want" && o.option !== "social").at(-1)).toMatchObject({ kind: "met", option: "rent_increase", facts: { by: "ask", why: "withdrawn" } });
  expect(kept.outcomes.find((o) => o.domain === "way" && o.kind === "granted")).toMatchObject({ option: "ask", learned: { payoff: 10_000 } });
  expect(kept.record.ties.close.find((x: any) => x.who === "landlord-1")).toMatchObject({ last: { what: "granted" } });
  expect(kept.because.map((b) => b.what)).toEqual(expect.arrayContaining(["want_born", "want_pursued", "want_met"]));
  // And nothing more comes of it later.
  expect(orders(await p.wake(61 * DAY, { transactions: wages(61 * DAY) }))).toEqual([]);
});

test("refused, the rise is dealt with as it stands (paid, where it can be borne); unanswered, the same after a fortnight", async () => {
  const refused = await tenant(true);
  const said = await refused.p.wake(47 * DAY, { records: [answer("ans-1", 46 * DAY, "inc-1", false)], transactions: wages(47 * DAY) });
  expect(orders(said).map((c) => c.args.amount)).toEqual(["$1050.00"]);
  expect(refused.kept.outcomes.find((o) => o.domain === "way" && o.kind === "refused")).toMatchObject({ option: "ask", learned: { payoff: 1_000 } });
  // The want is still held: the rise stands.
  expect(refused.kept.record.wants.map((w: any) => w.about).filter((a: string) => a !== "social")).toEqual(["rent_increase"]);

  const silent = await tenant(true);
  expect(orders(await silent.p.wake(47 * DAY, { transactions: wages(47 * DAY) }))).toEqual([]);
  expect(orders(await silent.p.wake(54 * DAY, { transactions: wages(54 * DAY) })).map((c) => c.args.amount)).toEqual(["$1050.00"]);
});

test("someone who does not trust the landlord does not ask them; someone who takes no initiative holds no wants and does as tenants did before", async () => {
  const wary = await tenant(false);
  const said = wary.said;
  expect(asks(said)).toEqual([]);
  // (Trusting the landlord less than the town does, they turn elsewhere or wait; the rise is paid meanwhile.)
  expect(orders(said).map((c) => c.args.amount)).toEqual(["$1050.00"]);
  const trustOf = (x: { kept: any }) => x.kept.record.trust.in.find((t: any) => t.in === "landlord-1").bps;
  expect(trustOf(wary)).toBeLessThan(trustOf(await tenant(true)));
  expect(wary.kept.record.wants.map((w: any) => w.about).filter((a: string) => a !== "social")).toEqual(["rent_increase"]);

  const plain = watched({});
  await plain.p.wake(DAY, { records: tenancy(), readings: READ, balance: 5_000_000, transactions: wages(DAY) });
  const did = await plain.p.wake(40 * DAY, { records: [increase("inc-1", 40 * DAY, 100 * DAY)], transactions: wages(40 * DAY) });
  expect(asks(did)).toEqual([]);
  expect(orders(did).map((c) => c.args.amount)).toEqual(["$1050.00"]);
  expect(plain.kept.record.wants).toEqual([]);
  expect(plain.kept.outcomes.some((o) => o.domain === "want" || o.domain === "way")).toBe(false);
});
