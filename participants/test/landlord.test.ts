// The letting office (docs/behaviour/firms.md), on what it's shown alone: arrears are judged lease by lease. A tenant on
// a renewed lease who stops paying gets notice after the months the landlord's rule says, however long they paid before.

import { expect, test } from "bun:test";
import type { Observation } from "../src/contracts";
import { landlord } from "../src/behaviour/firms";
import { inCurrency } from "../src/money";
import { Randomness } from "../src/rng";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";

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
