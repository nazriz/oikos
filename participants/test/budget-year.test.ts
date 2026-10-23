// The town's budget year (docs/behaviour/government.md, "The budget year"), on records alone: a town that opens with
// its first year's budget on file has it neither tabled, balloted nor counted again; the mayor's office tables the
// next year's before the year ends; a budget made on the council proposal form is for the year the form names; and
// the finance office pays within the year's adopted budget, or, while the year has none, under the budget last
// adopted at a twelfth of it a month.

import { expect, test } from "bun:test";
import type { Observation } from "../src/contracts";

import { tabledLines, yearInDays } from "../src/shared/government";
import { Randomness } from "../src/rng";
import { formatMoney, inCurrency } from "../src/money";
import { engine } from "./engine";
const councilClerk = engine("city.council_clerk");
const financeOfficer = engine("city.finance_officer");
const mayorCode = engine("city.mayor_code");

// (Amounts are worded in a world's own money: this test's is made up, and written with its sign after the figure.)
const MONEY = { code: "ZZZ", symbol: "z", minor_units: 2, symbol_after: true, symbol_spaced: true };
inCurrency(MONEY);
const written = (n: number) => formatMoney(n, MONEY);

const DAY = 86_400, YEAR = 365 * DAY;
const ctx = (participant: string, params: object, position?: string): any => ({ participant, entity: "city", position, rng: (k: string) => new Randomness(1n).stream([participant, k]), world: { tickSeconds: 3600, runEnd: 3 * YEAR, currency: MONEY }, params });
const SEATS = [1, 2, 3, 4, 5].map((i) => `councillor-${i}`);
const council = { kind: "directory", entities: [], positions: SEATS.map((position) => ({ position, entity: "city", role: "councillor" })) };
const obs = (t: number, records: any[], more: object = {}): Observation => ({ t, entity: "city", participant: "x", channels: { business: { kind: "records", records }, who: council, ...more }, inbox: [], outcomes: [], woke_for: "news" }) as unknown as Observation;
const stmt = (id: string, at: number, kind: string, x: object) => ({ id, at, record: "statement", author: "genesis", speaks_for: "city", visible_to: "public", kind, text: id, ...x });
const run = (m: { step: (o: Observation, x: any) => any }, o: Observation) => {
  const out: string[] = [];
  for (let i = 0; i < 40; i++) {
    const a: any = m.step(o, undefined as any);
    if (a.type === "wait") break;
    out.push(a.call);
    o = { ...o, channels: Object.fromEntries(Object.entries(o.channels).map(([k, c]: [string, any]) => [k, c.kind === "records" ? { ...c, records: [] } : c])), inbox: [] } as Observation;
  }
  return out.join("\n");
};
const lines = (text: string, kind: string) => text.split("\n").filter((l) => l.includes(`kind=${kind}`));
const dataOf = (line: string) => JSON.parse(/data=(\{.*?\})(?:, \w+=|\)$)/.exec(line)![1]!);
const budget = (year: number, at: number, of: Record<string, number>, id = `budget-${year}`) => stmt(id, at, "budget", { data: { year, lines: of } });
const account = (balance: number) => ({ treasury: { kind: "accounts", accounts: [{ account: "acc-city", holder: "city", custodian: "bank", currency: "ZZZ", balance: String(balance) }], transactions: [] } });
const invoice = (id: string, at: number, amount: number) => stmt(id, at, "invoice", { author: "builder", speaks_for: "builder", addressed_to: ["city"], data: { outcome: { money: { to: "acc-builder", amount: String(amount) } } } });

test("the lines the mayor's office tables: parks always, the others where it is given something for them; (their words, with the sum, are the engine's: council.rs)", () => {
  expect(tabledLines({ park_budget: 0 })).toEqual({ parks: 0 });
  expect(tabledLines({ park_budget: 500, road_budget: 0, staff_budget: 300, services_budget: 200, environment_budget: 100 })).toEqual({ parks: 500, staff: 300, services: 200, environment: 100 });
  expect(yearInDays(1)).toBe("day 0 to day 364");
  expect(yearInDays(3)).toBe("day 730 to day 1094");
});

test("with the year's budget on file the mayor's office tables none; it tables the next year's before the year ends, once, and again 45 days after if the council has not adopted it", () => {
  const params = { builder: "builder", population: 200, park_budget: 10_000_00, staff_budget: 40_000_00, budget_lead_days: 73 };
  const mayor = mayorCode.create(ctx("mayor-system", params, "mayor"));
  const first = budget(1, 0, { parks: 10_000_00, staff: 40_000_00 });
  expect(lines(run(mayor, obs(0, [first])), "proposal")).toEqual([]);
  expect(lines(run(mayor, obs(200 * DAY, [])), "proposal")).toEqual([]);
  // 73 days before year 2 begins (day 292): tabled, for year 2, in the town's money.
  expect(lines(run(mayor, obs(291 * DAY, [])), "proposal")).toEqual([]);
  const tabled = lines(run(mayor, obs(293 * DAY, [])), "proposal");
  expect(tabled.length).toBe(1);
  expect(dataOf(tabled[0]!).enact).toEqual({ kind: "budget", text: "The town's budget for year 2 (day 365 to day 729): parks 10,000.00 z, staff 40,000.00 z; 50,000.00 z in all.", data: { year: 2, lines: { parks: 10_000_00, staff: 40_000_00 } } });
  expect(tabled[0]).toContain('text="The town\'s budget for year 2 (day 365 to day 729): parks 10,000.00 z, staff 40,000.00 z; 50,000.00 z in all."');
  // Not again the week after; again 45 days on, while the council has adopted none.
  expect(lines(run(mayor, obs(300 * DAY, [])), "proposal")).toEqual([]);
  expect(lines(run(mayor, obs(339 * DAY, [])), "proposal").length).toBe(1);
  // Adopted: nothing more for year 2, in this year or in it.
  expect(lines(run(mayor, obs(346 * DAY, [budget(2, 345 * DAY, { parks: 10_000_00, staff: 40_000_00 })])), "proposal")).toEqual([]);
  expect(lines(run(mayor, obs(366 * DAY, [])), "proposal")).toEqual([]);

  // A year that begins with none (the council rejected it): tabled at once, for that year.
  const late = mayorCode.create(ctx("mayor-system", params, "mayor"));
  run(late, obs(0, [first]));
  const now = lines(run(late, obs(366 * DAY, [])), "proposal");
  expect(now.length).toBe(1);
  expect(dataOf(now[0]!).enact.data.year).toBe(2);

  // An office given no lead tables a year's budget when the year has none, as before.
  const plain = mayorCode.create(ctx("mayor-system", { builder: "builder", population: 200, park_budget: 0 }, "mayor"));
  expect(dataOf(lines(run(plain, obs(0, [])), "proposal")[0]!).enact.data.year).toBe(1);
  expect(lines(run(plain, obs(300 * DAY, [budget(1, 20 * DAY, { parks: 0 })])), "proposal")).toEqual([]);
});

test("the clerk takes up its office's papers: a proposal already balloted is not balloted again, and a ballot already declared is not counted again", () => {
  const clerk = councilClerk.create(ctx("council-clerk-system", {}, "council-clerk"));
  const proposal = stmt("budget-year-1-proposal", 0, "proposal", { addressed_to: ["city"], in_position: "mayor", data: { proposal: "The budget.", kind: "budget", year: 1, parks: "1000" } });
  const ballot = stmt("budget-year-1-ballot", 0, "ballot", { in_position: "council-clerk", basis: proposal.id, data: { proposal: proposal.id, options: ["yes", "no"], closes_at: 0, electorate: "council", tags: ["budget"] } });
  const result = stmt("budget-year-1-result", 0, "ballot_result", { in_position: "council-clerk", basis: ballot.id, data: { ballot: ballot.id, yes: 5, no: 0, passed: true } });
  const adopted = { ...budget(1, 0, { parks: 1000 }, "budget-year-1"), basis: ballot.id }; // (the clerk's own budget rests on the ballot that adopted it)
  expect(run(clerk, obs(DAY, [proposal, ballot, result, adopted]))).toBe("");
  expect(run(clerk, obs(2 * DAY, []))).toBe("");
  // Its report knows the budget, the year in days, and that the next year's is still to come.
  const letter = { ...obs(3 * DAY, []), inbox: [{ id: "m1", from: "mayor-system", text: "Is there a budget?" }] } as unknown as Observation;
  const report = run(clerk, letter);
  expect(report).toContain("The council adopted a budget for year 1 (budget-year-1). Year 1 is day 0 to day 364; no budget is adopted yet for year 2, which the council adopts before it begins.");
});

test("a budget made on the council proposal form is for the year the form names, if that is this year or a later one", () => {
  const made = (at: number, data: object) => {
    const clerk = councilClerk.create(ctx("council-clerk-system", {}, "council-clerk"));
    const p = stmt("p1", at, "proposal", { author: "mayor-system", in_position: "mayor", addressed_to: ["city"], data: { proposal: "Next year's budget.", kind: "budget", affects: "neither", parks: "1000", staff: "2500", ...data } });
    const opened = lines(run(clerk, obs(at, [p])), "ballot");
    expect(opened.length).toBe(1);
    const b = stmt("b1", at, "ballot", { author: "council-clerk-system", in_position: "council-clerk", basis: "p1", data: { ...dataOf(opened[0]!) } });
    const votes = SEATS.map((seat, i) => ({ id: `v${i}`, at: at + DAY, record: "vote", author: `${seat}-system`, in_position: seat, speaks_for: "city", visible_to: ["city"], ballot: "b1", choice: "yes" }));
    run(clerk, obs(at + DAY, [b, ...votes]));
    const declared = lines(run(clerk, obs(at + 15 * DAY, [])), "ballot_result")[0]!;
    // (What a passed ballot enacts is published from the result on file, at the clerk's next step: the result is shown back to it.)
    const filed = stmt("res-1", at + 15 * DAY, "ballot_result", { author: "council-clerk-system", in_position: "council-clerk", basis: "b1", data: dataOf(declared) });
    return dataOf(lines(run(clerk, obs(at + 16 * DAY, [filed])), "budget")[0]!);
  };
  // Put on day 300 for year 2: the council adopts year 2's budget in year 1. The year is not a line.
  expect(made(300 * DAY, { year: 2 })).toEqual({ year: 2, lines: { parks: 1000, staff: 2500 } });
  // No year named: the year in which it is adopted.
  expect(made(300 * DAY, {})).toEqual({ year: 1, lines: { parks: 1000, staff: 2500 } });
  expect(made(360 * DAY, {})).toEqual({ year: 2, lines: { parks: 1000, staff: 2500 } });
  // A year already past is not a year to budget for.
  expect(made(400 * DAY, { year: 1 })).toEqual({ year: 2, lines: { parks: 1000, staff: 2500 } });
});

test("the finance office pays within the year's adopted budget; while the year has none, under the budget last adopted at a twelfth a month; and what it paid in the meantime counts against the year's budget once adopted", () => {
  const finance = financeOfficer.create(ctx("finance-system", {}, "finance"));
  const first = budget(1, 0, { parks: 12_000_00 });
  // Year 1: within the adopted budget's total, and not beyond it.
  expect(run(finance, obs(DAY, [first, invoice("inv-1", DAY, 9_000_00)], account(100_000_00)))).toContain("settles=inv-1");
  expect(run(finance, obs(4 * DAY, [invoice("inv-2", 4 * DAY, 4_000_00)], account(100_000_00)))).not.toContain("money(");
  // Year 2 adopted in year 1 changes nothing in year 1: inv-2 still waits (the budget in force is year 1's).
  expect(run(finance, obs(340 * DAY, [budget(2, 339 * DAY, { parks: 50_000_00 })], account(100_000_00)))).not.toContain("money(");
  // Year 2 with that budget: inv-2 is paid within it.
  expect(run(finance, obs(366 * DAY, [], account(100_000_00)))).toContain("settles=inv-2");

  // A town whose year 2 has no budget: a twelfth of year 1's a month.
  const interim = financeOfficer.create(ctx("finance-system", {}, "finance"));
  run(interim, obs(DAY, [first], account(100_000_00)));
  const day = (n: number) => 365 * DAY + n * DAY;
  // In the first month 1,000.00 may be paid: 600.00 is, and 700.00 more is not.
  const paid = run(interim, obs(day(2), [invoice("inv-a", day(1), 600_00), invoice("inv-b", day(1), 700_00)], account(100_000_00)));
  expect(paid).toContain("settles=inv-a");
  expect(paid).not.toContain("settles=inv-b");
  // Its report says where it stands, in the town's money.
  const letter = { ...obs(day(5), [], account(100_000_00)), inbox: [{ id: "m1", from: "mayor-system", text: "Where do we stand?" }] } as unknown as Observation;
  expect(run(interim, letter)).toContain("No budget is adopted for year 2 (day 365 to day 729) yet. Until the council adopts one we pay what the town is already bound to pay under the budget last adopted (budget-1, year 1: parks 12,000.00 z), at no more each month than a twelfth of it, as the charter allows: 1,000.00 z so far this year, of which 600.00 z is spent");
  // In the second month a second twelfth: inv-b fits (600 + 700 within 2,000).
  expect(run(interim, obs(day(32), [], account(100_000_00)))).toContain("settles=inv-b");
  // The council adopts year 2's budget late, at 1,500.00: the 1,300.00 paid in the meantime counts against it.
  expect(run(interim, obs(day(40), [budget(2, day(39), { parks: 1_500_00 }), invoice("inv-c", day(39), 300_00)], account(100_000_00)))).not.toContain("money(");
  expect(run(interim, obs(day(43), [invoice("inv-d", day(42), 200_00)], account(100_000_00)))).toContain("settles=inv-d");

  // A town that has never had a budget pays no invoice (as before).
  const none = financeOfficer.create(ctx("finance-system", {}, "finance"));
  expect(run(none, obs(DAY, [invoice("inv-1", DAY, 100)], account(100_000_00)))).not.toContain("money(");
});
