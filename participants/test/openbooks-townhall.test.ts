// The town's offices' books (participants/src/behaviour/openbooks-townhall.ts): what stands open at the finance office,
// the mayor's, the works and environment offices, the planning office and the council clerk's, read from the office's own
// papers and account. Each: open shows the item (id, since, amount), settled drops it, and the line is the same
// on two days when nothing has changed.

import { expect, test } from "bun:test";
import { clerkBooks, environmentBooks, financeBooks, mayorBooks, planningBooks, worksBooks } from "../src/behaviour/openbooks-townhall";
import { inCurrency } from "../src/money";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";
const withdrawal = (id: string, at: number, what: string) => ({ id, at, record: "withdrawal", author: "x", withdraws: what, visible_to: "public" });
import { context, DAY, employment, signed, standingOrder, statement } from "./stepping";

inCurrency(PROFILE.values.currency);

const obs = (entity: string, t: number, records: any[], o: { transactions?: any[]; readings?: object } = {}): any => ({ t, entity, participant: "p", inbox: [], outcomes: [], readings: o.readings ?? {},
  channels: { papers: { kind: "records", records }, treasury: { kind: "accounts", transactions: o.transactions ?? [], accounts: [{ account: `acc-${entity}`, holder: entity, custodian: "bank", currency: "AUD", balance: "900000000" }] } } });
const feed = (b: { absorb(o: any): void }, entity: string, t: number, records: any[], o: { transactions?: any[]; readings?: object } = {}) => b.absorb(obs(entity, t, records, o));
const find = (hs: { what: string; items: any[] }[], what: string) => hs.find((h) => h.what === what)?.items ?? [];
const lines = (hs: { what: string; items: any[] }[]) => JSON.stringify(hs.map((h) => [h.what, h.items.map((i) => [i.id, i.line])]));

// ---------------------------------------------------------------- finance

const WAGE = 300_000;
const PERIOD = 14 * DAY;
const job = (id: string, at: number, worker: string) => ({ ...employment(id, at, "city", worker, WAGE), author: "works-system" });
const invoice = (id: string, at: number, amount: number) => statement(id, at, "invoice", { speaks_for: "builder", author: "builder-system", addressed_to: ["city"], visible_to: ["city", "builder"], data: { outcome: { money: { to: "acc-builder", amount: String(amount) } } } });

test("finance: an invoice addressed to the town is open until a payment of ours settles it, and says when it needs the mayor's approval", () => {
  // (Who approves a payment over what sum is the payments procedure's, on file: foundations F8, law 6.)
  const b = financeBooks(context("fin", "city", { procedure: "proc-payments" }, { position: "finance" }));
  feed(b, "city", 5 * DAY, [statement("proc-payments", 0, "procedure", { data: { approval: { by: "mayor", over: 5_000_000 } } }), invoice("inv-1", 4 * DAY, 800_000), invoice("inv-2", 4 * DAY, 9_000_000)]);
  const open = find(b.open(6 * DAY), "Invoices addressed to the town, not paid");
  expect(open.map((i) => i.id)).toEqual(["inv-1", "inv-2"]);
  expect(open[0]).toMatchObject({ since: 4 * DAY, amount: 800_000 });
  expect(open[1].line).toContain("the mayor's written approval is not on file");
  expect(open[0].line).not.toContain("approval");
  // The mayor approves inv-2 (made in the mayor's post); inv-1 is paid.
  feed(b, "city", 7 * DAY, [statement("ap-1", 6 * DAY, "approval", { in_position: "mayor", data: { invoice: "inv-2" } })], { transactions: [{ t: 6 * DAY, from: "acc-city", to: "acc-builder", amount: "800000", currency: "AUD", by: "fin", settles: "inv-1" }] });
  const after = find(b.open(8 * DAY), "Invoices addressed to the town, not paid");
  expect(after.map((i) => i.id)).toEqual(["inv-2"]);
  expect(after[0].line).toContain("the mayor's written approval is on file");
});

test("finance: an employment agreement in force with no standing payment is listed, and is gone once a standing payment citing it is on file", () => {
  const b = financeBooks(context("fin", "city", {}, { position: "finance" }));
  const a = job("job-1", 2 * DAY, "c1");
  feed(b, "city", 10 * DAY, signed(a, 3 * DAY));
  const open = find(b.open(10 * DAY), "Employees of the town with no standing payment of their wage on file");
  expect(open.length).toBe(1);
  expect(open[0]).toMatchObject({ id: "job-1", since: 3 * DAY, amount: WAGE });
  expect(open[0].line).toContain("c1");
  expect(open[0].line).toContain("no payroll notice has come");
  // (Within the days the office waits for a notice it is not yet short.)
  const young = financeBooks(context("fin", "city", {}, { position: "finance" }));
  feed(young, "city", 4 * DAY, signed(job("job-2", 3 * DAY, "c2"), 3 * DAY));
  expect(find(young.open(4 * DAY), "Employees of the town with no standing payment of their wage on file")).toEqual([]);
  feed(b, "city", 11 * DAY, [standingOrder("ord-1", 10.5 * DAY, "city", "acc-c1", 270_000, { basis: "job-1", every: PERIOD })]);
  expect(find(b.open(11 * DAY), "Employees of the town with no standing payment of their wage on file")).toEqual([]);
});

test("finance: a wage order withdrawn leaves the worker listed again; wages still paid to someone registered dead are listed", () => {
  const b = financeBooks(context("fin", "city", {}, { position: "finance" }));
  const a = job("job-1", 2 * DAY, "c1");
  feed(b, "city", 10 * DAY, [...signed(a, 3 * DAY), standingOrder("ord-1", 4 * DAY, "city", "acc-c1", 270_000, { basis: "job-1", every: PERIOD })]);
  expect(b.open(10 * DAY).some((h) => h.what.startsWith("Wages still"))).toBe(false);
  feed(b, "city", 20 * DAY, [statement("dr-1", 19 * DAY, "death_registration", { data: { deceased: "c1" } })]);
  const stale = find(b.open(20 * DAY), "Wages still being paid to someone who has died or whose employment has ended");
  expect(stale.length).toBe(1);
  expect(stale[0]).toMatchObject({ id: "ord-1", since: 19 * DAY, amount: 270_000 });
  // The order is withdrawn: nothing stale.
  feed(b, "city", 21 * DAY, [withdrawal("w-1", 20.5 * DAY, "ord-1")]);
  expect(find(b.open(21 * DAY), "Wages still being paid to someone who has died or whose employment has ended")).toEqual([]);
});

test("finance: the budget for the year in total, against payments of invoices and wages; the line is the same on two days", () => {
  const b = financeBooks(context("fin", "city", {}, { position: "finance" }));
  const a = job("job-1", 2 * DAY, "c1");
  const budget = statement("bud-1", DAY, "budget", { data: { year: 1, lines: { parks: 8_000_000, staff: 2_000_000 } } });
  feed(b, "city", 40 * DAY, [budget, invoice("inv-1", 4 * DAY, 800_000), ...signed(a, 3 * DAY), standingOrder("ord-1", 4 * DAY, "city", "acc-c1", 270_000, { basis: "job-1", every: PERIOD })],
    { transactions: [{ t: 30 * DAY, from: "acc-city", to: "acc-builder", amount: "800000", currency: "AUD", by: "fin", settles: "inv-1", memo: "Paying an invoice" }, { t: 31 * DAY, from: "acc-city", to: "acc-c1", amount: "270000", currency: "AUD", by: "fin", per_instruction: "ord-1", memo: "wages" }] });
  const item = find(b.open(40 * DAY), "The budget for the year, against what has been paid")[0];
  expect(item.id).toBe("bud-1");
  // 10,000,000 adopted; 800,000 on invoices + 270,000 net + 30,000 withheld = 1,100,000 paid; 8,900,000 left.
  expect(item.amount).toBe(8_900_000);
  expect(item.line).toContain("$8,000.00");
  // (What the payments said they were for, as the bank's statement has them: the largest first.)
  // (Neither payment names a line: all of it is unallocated, and shown so; nothing is refused.)
  expect(item.line).toContain("By line: parks $0.00 drawn of $80,000.00, $80,000.00 left; staff $0.00 drawn of $20,000.00, $20,000.00 left; $11,000.00 unallocated (payments that name no line). By what the payments said they were for: \"Paying an invoice\" $8,000.00; \"wages\" $2,700.00");
  expect(lines(b.open(40 * DAY))).toBe(lines(b.open(41 * DAY)));
});

test("finance: room left by line from the lines the payments name; a payment with no line is unallocated; a line the budget does not have is said", () => {
  const b = financeBooks(context("fin", "city", {}, { position: "finance" }));
  const a = job("job-1", 2 * DAY, "c1");
  const budget = statement("bud-1", DAY, "budget", { data: { year: 1, lines: { parks: 8_000_000, staff: 2_000_000 } } });
  const tx = (t: number, amount: string, o: object) => ({ t, from: "acc-city", to: "acc-x", amount, currency: "AUD", by: "fin", ...o });
  feed(b, "city", 40 * DAY, [budget, invoice("inv-1", 4 * DAY, 800_000), invoice("inv-2", 4 * DAY, 300_000), invoice("inv-3", 4 * DAY, 100_000), ...signed(a, 3 * DAY), standingOrder("ord-1", 4 * DAY, "city", "acc-c1", 270_000, { basis: "job-1", every: PERIOD })],
    { transactions: [tx(30 * DAY, "800000", { settles: "inv-1", line: "parks" }), tx(30 * DAY, "300000", { settles: "inv-2" }), tx(30 * DAY, "100000", { settles: "inv-3", line: "fountains" }), tx(31 * DAY, "270000", { per_instruction: "ord-1", line: "staff" })] });
  const item = find(b.open(40 * DAY), "The budget for the year, against what has been paid")[0];
  // 10,000,000 adopted; 1,200,000 on invoices + 270,000 net + 30,000 withheld = 1,500,000 paid.
  expect(item.amount).toBe(8_500_000);
  expect(item.line).toContain("By line: fountains (not a line of the budget) $1,000.00 drawn; parks $8,000.00 drawn of $80,000.00, $72,000.00 left; staff $3,000.00 drawn of $20,000.00, $17,000.00 left; $3,000.00 unallocated (payments that name no line)");
  // (None unallocated once every payment names its line.)
  const c = financeBooks(context("fin", "city", {}, { position: "finance" }));
  feed(c, "city", 40 * DAY, [budget, invoice("inv-1", 4 * DAY, 800_000)], { transactions: [tx(30 * DAY, "800000", { settles: "inv-1", line: "parks" })] });
  expect(find(c.open(40 * DAY), "The budget for the year, against what has been paid")[0]!.line).toContain("nothing unallocated");
});

test("finance: tax withheld since the last report is listed, and a shortfall the last report owed", () => {
  const b = financeBooks(context("fin", "city", {}, { position: "finance" }));
  const a = job("job-1", 2 * DAY, "c1");
  feed(b, "city", 40 * DAY, [...signed(a, 3 * DAY), standingOrder("ord-1", 4 * DAY, "city", "acc-c1", 270_000, { basis: "job-1", every: PERIOD }),
    statement("wr-1", 30 * DAY, "withholding_report", { addressed_to: ["tax-office"], data: { withheld: 100_000, paid: 40_000, period_end: 30 * DAY } })],
  { transactions: [{ t: 35 * DAY, from: "acc-city", to: "acc-c1", amount: "270000", currency: "AUD", by: "fin", per_instruction: "ord-1" }] });
  const tax = find(b.open(40 * DAY), "Tax withheld from wages and not yet paid over");
  expect(tax.map((i) => i.id).sort()).toEqual(["withheld-since-last-report", "wr-1"]);
  expect(tax.find((i) => i.id === "wr-1")).toMatchObject({ amount: 60_000, since: 30 * DAY });
  expect(tax.find((i) => i.id === "withheld-since-last-report")).toMatchObject({ amount: 30_000 });
});

test("finance: the returns the law lists, which falls due next and when, under which law, for what period, and what has been withheld since the last", () => {
  const b = financeBooks(context("fin", "city", {}, { position: "finance" }));
  const a = job("job-1", 2 * DAY, "c1");
  const law = statement("law-income-tax", 0, "law", { speaks_for: "outside", visible_to: "public", data: { tax: "income",
    charges: [{ id: "income-tax", name: "Income tax", schedule: [{ from: 0, rate_bps: 1000 }], collector: "outside", account: "acc-outside" }, { id: "nssf", name: "NSSF contribution", schedule: [{ from: 0, rate_bps: 600 }], collector: "nssf", account: "acc-outside-nssf" }],
    returns: [{ id: "paye", name: "PAYE return", charges: ["income-tax"], day: 9 }, { id: "nssf", name: "NSSF contribution", charges: ["nssf"], day: 12 }] } });
  feed(b, "city", 40 * DAY, [law, ...signed(a, 3 * DAY), standingOrder("ord-1", 4 * DAY, "city", "acc-c1", 270_000, { basis: "job-1", every: PERIOD }),
    statement("wr-1", 38 * DAY, "withholding_report", { addressed_to: ["outside"], speaks_for: "city", data: { withheld: 10_000, paid: 10_000, period_end: 38 * DAY, return: "paye" } })],
  { transactions: [{ t: 35 * DAY, from: "acc-city", to: "acc-c1", amount: "270000", currency: "AUD", by: "fin", per_instruction: "ord-1" }, { t: 39 * DAY, from: "acc-city", to: "acc-c1", amount: "270000", currency: "AUD", by: "fin", per_instruction: "ord-1" }] });
  const due = find(b.open(40 * DAY), "Returns of tax withheld from wages falling due, and the day each is due by");
  expect(due.map((i) => i.id)).toEqual([`nssf-${41 * DAY}`, `paye-${68 * DAY}`]);
  const paye = due.find((i) => i.id.startsWith("paye"))!;
  expect(paye.line).toContain("PAYE return (Income tax), under law-income-tax: the next falls due on year 1, day 69 (in 28 days), for pay from year 1, day 31 to year 1, day 60; the last was made on year 1, day 39");
  expect(paye.amount).toBeGreaterThan(0); // (the pay of day 39 only, after the return of day 38)
  const nssf = due.find((i) => i.id.startsWith("nssf"))!;
  expect(nssf.line).toContain("the next falls due on year 1, day 42 (tomorrow), for pay from year 1, day 1 to year 1, day 30; the last was none yet");
  // The day itself it is "today"; the day after, the next month's.
  expect(find(b.open(41 * DAY + 100), "Returns of tax withheld from wages falling due, and the day each is due by").find((i) => i.id.startsWith("nssf"))!.line).toContain("(today)");
});

// ---------------------------------------------------------------- mayor

const petition = (id: string, at: number) => statement(id, at, "petition", { speaks_for: "org", author: "org-x", addressed_to: ["city"], data: { demand: { text: "Fix the rent rules" } } });
const count = (id: string, at: number, petitionId: string, n: number) => statement(id, at, "petition_count", { speaks_for: "org", author: "org-x", data: { petition: petitionId, signatures: n } });
const mayorCtx = () => context("mayor-p", "city", { petition_threshold_bps: 1500, population: 200 }, { position: "mayor" });

test("mayor: a petition at the threshold and not answered is open; put to the council it is gone; the line is steady", () => {
  const b = mayorBooks(mayorCtx());
  feed(b, "city", 10 * DAY, [petition("pet-1", 2 * DAY), count("c-1", 3 * DAY, "pet-1", 12), petition("pet-2", 2 * DAY), count("c-2", 3 * DAY, "pet-2", 31)]);
  const over = find(b.open(10 * DAY), "Petitions at or over the town's threshold, not put to the council or answered");
  expect(over.map((i) => i.id)).toEqual(["pet-2"]);
  expect(over[0]).toMatchObject({ since: 2 * DAY });
  expect(over[0].line).toContain("the town's threshold of 30 signatures");
  expect(find(b.open(10 * DAY), "Petitions addressed to the mayor, short of the town's threshold").map((i) => i.id)).toEqual(["pet-1"]);
  expect(lines(b.open(10 * DAY))).toBe(lines(b.open(11 * DAY)));
  feed(b, "city", 12 * DAY, [statement("prop-1", 11 * DAY, "proposal", { in_position: "mayor", basis: "pet-2", data: { enact: { kind: "law", text: "x" } } })]);
  expect(find(b.open(12 * DAY), "Petitions at or over the town's threshold, not put to the council or answered")).toEqual([]);
});

test("mayor: an invoice for work it commissioned awaits approval until an approval of ours names it", () => {
  const b = mayorBooks(mayorCtx());
  const ag = { id: "ag-1", at: DAY, author: "mayor-p", in_position: "mayor", record: "agreement", visible_to: ["city", "builder"], terms: { template: "construction", parties: ["city", "builder"], commitments: [] } };
  feed(b, "city", 6 * DAY, [ag, { ...invoice("inv-1", 5 * DAY, 8_000_000), basis: "ag-1" }, invoice("inv-9", 5 * DAY, 100_000)]);
  const inv = find(b.open(6 * DAY), "Invoices for work the mayor's office commissioned, awaiting its written approval");
  expect(inv.map((i) => i.id)).toEqual(["inv-1"]);
  expect(inv[0]).toMatchObject({ since: 5 * DAY, amount: 8_000_000 });
  expect(lines(b.open(6 * DAY))).toBe(lines(b.open(7 * DAY)));
  feed(b, "city", 8 * DAY, [statement("ap-1", 7 * DAY, "approval", { in_position: "mayor", basis: "inv-1", data: { invoice: "inv-1" } })]);
  expect(find(b.open(8 * DAY), "Invoices for work the mayor's office commissioned, awaiting its written approval")).toEqual([]);
});

test("mayor: a permit granted on its application with no builder commissioned; budget tabled, no result; no budget adopted", () => {
  const b = mayorBooks(mayorCtx());
  const app = statement("app-1", DAY, "permit_application", { in_position: "mayor", data: { lot: "lot.4", structure_type: "park" } });
  const dec = statement("dec-1", 3 * DAY, "permit_decision", { addressed_to: ["city"], data: { application: "app-1", decision: "granted" } });
  const prop = statement("prop-b", 2 * DAY, "proposal", { in_position: "mayor", data: { enact: { kind: "budget", data: { year: 1 } } } });
  feed(b, "city", 5 * DAY, [app, dec, prop]);
  const out = b.open(5 * DAY);
  expect(find(out, "Permits granted on the office's applications, no builder commissioned").map((i) => i.id)).toEqual(["dec-1"]);
  expect(find(out, "Budgets put to the council with no result yet").map((i) => i.id)).toEqual(["prop-b"]);
  expect(find(out, "Years with no budget adopted").map((i) => i.id)).toEqual(["budget-year-1"]);
  expect(lines(b.open(5 * DAY))).toBe(lines(b.open(6 * DAY)));
  // Commissioned; the ballot is declared and the budget adopted.
  feed(b, "city", 9 * DAY, [statement("com-1", 6 * DAY, "commission", { in_position: "mayor", basis: "dec-1" }),
    statement("bal-1", 3 * DAY, "ballot", { data: { proposal: "prop-b", electorate: "council", closes_at: 5 * DAY } }),
    statement("res-1", 6 * DAY, "ballot_result", { data: { ballot: "bal-1", passed: true } }), statement("bud-1", 6 * DAY, "budget", { data: { year: 1, lines: { parks: 1 } } })]);
  const after = b.open(9 * DAY);
  expect(find(after, "Permits granted on the office's applications, no builder commissioned")).toEqual([]);
  expect(find(after, "Budgets put to the council with no result yet")).toEqual([]);
  expect(find(after, "Years with no budget adopted")).toEqual([]);
});

test("mayor: complaints as a count by kind and the oldest three only; a debt claimed against the town until settled", () => {
  const b = mayorBooks(mayorCtx());
  const complaints = Array.from({ length: 6 }, (_, i) => statement(`cmp-${i}`, (i + 1) * DAY, "complaint", { speaks_for: `c${i}`, author: `c${i}-x`, addressed_to: ["city"], data: { structure: `h${i}`, about: "waste", days: 14 } }));
  const claim = { id: "clm-1", at: 3 * DAY, record: "claim", position: "right", holder: "c1", counterparty: "city", author: "c1-x", visible_to: ["city"], about: { kind: "debt", amount: 600_000, for: "Unpaid wages (2 pay periods)." } };
  feed(b, "city", 10 * DAY, [...complaints, claim]);
  const out = b.open(10 * DAY);
  const kinds = find(out, "Complaints about the town's services, still open, by kind");
  expect(kinds.length).toBe(1);
  expect(kinds[0].line).toContain("6 open complaints about waste");
  expect(find(out, "The oldest of the open complaints").map((i) => i.id)).toEqual(["cmp-0", "cmp-1", "cmp-2"]);
  expect(find(out, "Debts claimed against the town, not settled")[0]).toMatchObject({ id: "clm-1", amount: 600_000, since: 3 * DAY });
  expect(lines(b.open(10 * DAY))).toBe(lines(b.open(11 * DAY)));
  feed(b, "city", 12 * DAY, [], { transactions: [{ t: 11 * DAY, from: "acc-city", to: "acc-c1", amount: "600000", currency: "AUD", by: "fin", settles: "clm-1" }] });
  expect(find(b.open(12 * DAY), "Debts claimed against the town, not settled")).toEqual([]);
});

// ---------------------------------------------------------------- works and environment

const worksCtx = (extra: object = {}) => context("works-p", "city", { depot: "d", workplace: "d/room", landfill: "lf", payroll_office: "finance", ...extra }, { position: "works" });
const posting = (id: string, at: number, role = "works crew") => statement(id, at, "job_posting", { speaks_for: "city", in_position: "works", data: { wage: WAGE, period: PERIOD, role } });
const application = (id: string, at: number, worker: string, postingId: string) => statement(id, at, "job_application", { speaks_for: worker, author: `${worker}-x`, addressed_to: ["city"], data: { posting: postingId, account: `acc-${worker}` } });
const offerOn = (id: string, at: number, worker: string, basis: string) => ({ ...job(id, at, worker), basis, terms: { ...job(id, at, worker).terms, text: `${worker} works for city as works crew for 300000 cents every 14 days. First pay 14 days after both have signed.` } });

test("works: an application for an advertised post is open until an offer is made on it; the line is steady", () => {
  const b = worksBooks(worksCtx());
  feed(b, "city", 6 * DAY, [posting("post-1", DAY), application("app-1", 3 * DAY, "c1", "post-1")]);
  const open = find(b.open(6 * DAY), "Applications for an advertised post, not answered");
  expect(open.map((i) => i.id)).toEqual(["app-1"]);
  expect(open[0]).toMatchObject({ since: 3 * DAY });
  expect(lines(b.open(6 * DAY))).toBe(lines(b.open(7 * DAY)));
  feed(b, "city", 8 * DAY, [offerOn("job-1", 7 * DAY, "c1", "app-1")]);
  expect(find(b.open(8 * DAY), "Applications for an advertised post, not answered")).toEqual([]);
  // The advertisement withdrawn: an application on it is no longer open.
  const c = worksBooks(worksCtx());
  feed(c, "city", 6 * DAY, [posting("post-2", DAY), application("app-2", 3 * DAY, "c2", "post-2")]);
  expect(find(c.open(6 * DAY), "Applications for an advertised post, not answered").length).toBe(1);
  feed(c, "city", 7 * DAY, [withdrawal("wd", 6.5 * DAY, "post-2")]);
  expect(find(c.open(7 * DAY), "Applications for an advertised post, not answered")).toEqual([]);
});

test("works: a starter with no payroll notice, and a leaver with none, are open until the notices are on file", () => {
  const b = worksBooks(worksCtx());
  const a = offerOn("job-1", 2 * DAY, "c1", "app-1");
  const old = offerOn("job-2", DAY, "c2", "app-2");
  feed(b, "city", 10 * DAY, [...signed(a, 3 * DAY), ...signed(old, 2 * DAY)], { readings: { "job-2": { of: "agreement", status: "ending", ends_at: 20 * DAY, reader: "k" } } });
  const out = b.open(10 * DAY);
  expect(find(out, "New starters the finance office has not been told of").map((i) => i.id).sort()).toEqual(["job-1", "job-2"]);
  expect(find(out, "New starters the finance office has not been told of").find((i) => i.id === "job-1")).toMatchObject({ since: 3 * DAY, amount: WAGE });
  expect(find(out, "Staff who have left or died, the finance office not told")[0]).toMatchObject({ id: "job-2", since: 20 * DAY });
  expect(lines(b.open(10 * DAY))).toBe(lines(b.open(11 * DAY)));
  const notice = (id: string, kind: string, agreement: string) => statement(id, 11 * DAY, "payroll_notice", { speaks_for: "city", in_position: "works", data: { notice: kind, agreement } });
  feed(b, "city", 12 * DAY, [notice("pn-1", "starter", "job-1"), notice("pn-2", "starter", "job-2"), notice("pn-3", "leaver", "job-2")], { readings: { "job-2": { of: "agreement", status: "ending", ends_at: 20 * DAY, reader: "k" } } });
  const after = b.open(12 * DAY);
  expect(find(after, "New starters the finance office has not been told of")).toEqual([]);
  expect(find(after, "Staff who have left or died, the finance office not told")).toEqual([]);
});

test("works and environment: a staffing direction that stands is listed with who gave it; withdrawn, it is gone", () => {
  const rule = statement("rule-dir", 0, "rule", { data: { directions: { by: ["mayor"] } } });
  const form = statement("form-ws", 0, "form", { speaks_for: "city", data: { form: "works_staffing", office: "works" } });
  const dir = statement("dir-1", 5 * DAY, "direction", { in_position: "mayor", author: "mayor-p", addressed_to: ["city"], basis: "form-ws", data: { recruit: "no" } });
  const b = worksBooks(worksCtx({ directed_under: "rule-dir" }));
  feed(b, "city", 6 * DAY, [rule, form, dir]);
  const out = find(b.open(6 * DAY), "Directions on the office's forms that stand");
  expect(out.map((i) => i.id)).toEqual(["dir-1"]);
  expect(out[0]).toMatchObject({ since: 5 * DAY });
  expect(out[0].line).toContain("mayor");
  expect(out[0].line).toContain("recruit nobody");
  expect(lines(b.open(6 * DAY))).toBe(lines(b.open(7 * DAY)));
  feed(b, "city", 8 * DAY, [withdrawal("wd-1", 7 * DAY, "dir-1")]);
  expect(find(b.open(8 * DAY), "Directions on the office's forms that stand")).toEqual([]);
  const env = environmentBooks(context("env-p", "city", { depot: "d", workplace: "d/room", planning: "plan", directed_under: "rule-dir" }, { position: "environment" }));
  const eform = statement("form-es", 0, "form", { speaks_for: "city", data: { form: "environment_staffing", office: "environment" } });
  feed(env, "city", 6 * DAY, [rule, eform, statement("dir-2", 5 * DAY, "direction", { in_position: "mayor", author: "mayor-p", addressed_to: ["city"], basis: "form-es", data: { recruit: "yes", posts: 2 } })]);
  const e = find(env.open(6 * DAY), "Directions on the office's forms that stand");
  expect(e.map((i) => i.id)).toEqual(["dir-2"]);
  expect(e[0].line).toContain("up to 2 posts");
});

// ---------------------------------------------------------------- planning and the clerk

test("planning: a permit application with no decision of ours is open, with applicant, lot, kind and date; decided, it is gone", () => {
  const b = planningBooks(context("plan-p", "city", {}, { position: "planning" }));
  const app = statement("app-1", 2 * DAY, "permit_application", { speaks_for: "c1", author: "c1-x", addressed_to: ["city"], data: { lot: "lot.4", structure_type: "house" } });
  feed(b, "city", 5 * DAY, [app]);
  const open = find(b.open(5 * DAY), "Permit applications, not decided");
  expect(open.length).toBe(1);
  expect(open[0]).toMatchObject({ id: "app-1", since: 2 * DAY });
  for (const w of ["c1", "lot.4", "house", dateWordsOf(2 * DAY)]) expect(open[0].line).toContain(w);
  expect(lines(b.open(5 * DAY))).toBe(lines(b.open(6 * DAY)));
  feed(b, "city", 7 * DAY, [statement("dec-1", 6 * DAY, "permit_decision", { data: { application: "app-1", decision: "granted" } })]);
  expect(b.open(7 * DAY)).toEqual([]);
});

function dateWordsOf(t: number): string {
  return `year 1, day ${Math.floor(t / DAY) + 1}`;
}

test("clerk: a proposal with no ballot, and a closed ballot with no result, are open until a ballot is opened and a result declared", () => {
  const b = clerkBooks(context("clerk-p", "council", { part: "seat" }, { position: "council-clerk" }));
  const prop = statement("prop-1", 2 * DAY, "proposal", { speaks_for: "c1", author: "c1-x", addressed_to: ["council"], text: "Plant trees" });
  feed(b, "council", 4 * DAY, [prop]);
  const open = find(b.open(4 * DAY), "Proposals to the council with no ballot opened");
  expect(open.map((i) => i.id)).toEqual(["prop-1"]);
  expect(open[0]).toMatchObject({ since: 2 * DAY });
  expect(lines(b.open(4 * DAY))).toBe(lines(b.open(5 * DAY)));
  const ballot = statement("bal-1", 5 * DAY, "ballot", { speaks_for: "council", data: { proposal: "prop-1", electorate: "council", closes_at: 19 * DAY } });
  feed(b, "council", 6 * DAY, [ballot]);
  expect(b.open(6 * DAY)).toEqual([]);
  const closed = find(b.open(20 * DAY), "Ballots closed with no result declared");
  expect(closed.map((i) => i.id)).toEqual(["bal-1"]);
  expect(closed[0]).toMatchObject({ since: 19 * DAY });
  feed(b, "council", 21 * DAY, [statement("res-1", 20.5 * DAY, "ballot_result", { speaks_for: "council", data: { ballot: "bal-1", passed: true } })]);
  expect(b.open(21 * DAY)).toEqual([]);
});
