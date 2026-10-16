// Payroll notices (docs/behaviour/firms.md, "Payroll notices"): where one office of an organisation takes staff on and
// another pays them, the hiring office tells the payroll office of each new starter (who, the post, the pay, the pay
// period, the first pay day, the account, the agreement) and of each leaver (the last day), and the payroll acts on
// the notice. Until 2026-10-09 the code payroll noticed a signed agreement by itself and nothing was ever sent, so a
// seat in the payroll office was never told, and a new hire was never paid (the live check of that day, finding 9).

import { expect, test } from "bun:test";
import { Book, callAction, type Step } from "../src/behaviour/common";
import { Staffing } from "../src/behaviour/firms";
import { financeOfficer } from "../src/behaviour/government";
import { inCurrency } from "../src/money";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";
import { callsOf, context, DAY, signed, statement, wake } from "./stepping";

inCurrency(PROFILE.values.currency);

const PERIOD = 14 * DAY, WAGE = 300_000;
const said = (steps: Step[], t = 0) => steps.flatMap((s) => callsOf(callAction(s), t));
const obsOf = (t: number, records: any[], readings: object = {}): any => ({ t, entity: "city", participant: "x", inbox: [], outcomes: [], readings,
  channels: { papers: { kind: "records", records }, treasury: { kind: "accounts", transactions: [], accounts: [{ account: "acc-city", holder: "city", custodian: "bank", currency: "AUD", balance: "900000000" }] } } });
/** An employment agreement the town's environment office made in the run, as its offer words it. */
const job = (id: string, at: number, worker: string, author = "environment-system") => ({ id, at, author, record: "agreement", visible_to: ["city", worker],
  terms: { template: "employment", parties: ["city", worker], text: `${worker} works for city as environmental scientist for 300000 cents every 14 days. First pay 14 days after both have signed.`,
    commitments: [{ who: "city", does: { outcome: { money: { to: `acc-${worker}`, amount: String(WAGE), for: "wages" } } }, every: PERIOD }] } });
const hiring = () => new Staffing(context("environment-system", "city", {}, { position: "environment" }), "city", { period: PERIOD, notice_days: 14, role: "environmental scientist", does: { hire: true, pay: false }, own: "role", payroll: "finance" });
const paying = (wait?: number) => new Staffing(context("finance-system", "city", {}, { position: "finance" }), "city", { period: PERIOD, notice_days: 14, role: "staff", does: { hire: false, pay: true }, ...(wait === undefined ? {} : { notice_wait: wait }) });
const WANT = { target: 1, wage: WAGE, canPost: false };
const step = (s: Staffing, book: Book, t: number, records: any[], readings: object = {}) => {
  const o = obsOf(t, records, readings);
  book.absorb(o);
  s.absorb(o);
  return said(s.routine(o, book, "acc-city", WANT), t);
};

test("the hiring office sends the payroll office a notice of a new starter once both have signed: who, the post, the pay, the first pay day, the account and the agreement; once", () => {
  const office = hiring(), book = new Book();
  // Offered on day 3, not yet signed by the worker: nothing to tell the payroll.
  const a = job("job-9", 2 * DAY, "c9");
  expect(step(office, book, 3 * DAY, [a, signed(a, 2 * DAY)[1]]).filter((c) => c.args.kind === "payroll_notice")).toEqual([]);
  // Signed on day 4.
  const notices = step(office, book, 4 * DAY + 3600, [signed(a, 4 * DAY)[2]]).filter((c) => c.args.kind === "payroll_notice");
  expect(notices.length).toBe(1);
  expect(notices[0]!.args).toMatchObject({ kind: "payroll_notice", to: ["city"], visible: ["city"], basis: "job-9",
    data: { notice: "starter", office: "finance", employee: "c9", post: "environmental scientist", agreement: "job-9", wage: "300000", period: PERIOD, first_pay: 18 * DAY, account: "acc-c9" } });
  expect(notices[0]!.args.text).toBe("Payroll notice, new starter: c9, environmental scientist, under employment agreement job-9. Pay: $3,000.00 every 14 days before tax, into acc-c9; first pay day year 1, day 19, then every 14 days. For the finance office: the wage payment is to be set up from that day.");
  expect(notices[0]!.why).toContain("sending the finance office a payroll notice");
  // The notice is put in front of the finance office too: a letter to its post, with what it needs to act.
  const sent = step(hiring(), new Book(), 4 * DAY + 3600, signed(a, 4 * DAY)).filter((c) => c.fn === "message");
  expect(sent.map((c) => [c.args.to, c.args.re])).toEqual([[["finance"], "job-9"]]);
  expect(sent[0]!.args.text).toBe("Payroll notice from the hiring office, new starter: c9, environmental scientist, under employment agreement job-9. Pay: $3,000.00 every 14 days before tax, into acc-c9; first pay day year 1, day 19, then every 14 days. The notice is on the organisation's file. " +
    "The wage payment is to be set up from that day: a payment from the organisation's account to acc-c9 every 14 days, first on year 1, day 19, citing job-9, of the pay less what the tax law says to withhold.");
  // Not again the next day; and not by whoever next holds the office, which reads the notice on its file.
  expect(step(office, book, 5 * DAY, []).filter((c) => c.args.kind === "payroll_notice")).toEqual([]);
  const next = hiring(), theirs = new Book();
  const onFile = statement("rec.50", 4 * DAY + 3600, "payroll_notice", { author: "environment-system", in_position: "environment", addressed_to: ["city"], visible_to: ["city"], basis: "job-9", data: notices[0]!.args.data });
  expect(step(next, theirs, 6 * DAY, [a, ...signed(a, 4 * DAY).slice(1), onFile]).filter((c) => c.args.kind === "payroll_notice")).toEqual([]);
  // Staff the town started with were on its payroll before the year began: no notice.
  const old = { ...job("job-1", 0, "c1", "genesis") };
  expect(step(hiring(), new Book(), DAY, signed(old, 0)).filter((c) => c.args.kind === "payroll_notice")).toEqual([]);
});

test("the payroll sets the wage up on the notice, from the first pay day it gives; with no notice it waits, then sets it up from the agreement on file and says so", () => {
  const a = job("job-9", 2 * DAY, "c9");
  const notice = statement("rec.50", 4 * DAY + 3600, "payroll_notice", { author: "environment-system", in_position: "environment", addressed_to: ["city"], visible_to: ["city"], basis: "job-9",
    data: { notice: "starter", office: "finance", employee: "c9", post: "environmental scientist", agreement: "job-9", wage: "300000", period: PERIOD, first_pay: 18 * DAY, account: "acc-c9" } });
  // With the notice on file at its wake on day 6: one standing payment, first on the notice's first pay day.
  const withNotice = paying(3 * DAY), book = new Book();
  const made = step(withNotice, book, 6 * DAY, [...signed(a, 4 * DAY), notice]).filter((c) => c.fn === "money");
  expect(made.length).toBe(1);
  expect(made[0]!.args).toMatchObject({ to: "acc-c9", from: "acc-city", every: "14 days", first: "12 days", basis: "job-9" });
  expect(made[0]!.why).toStartWith("Payroll notice rec.50: a new starter, first pay day year 1, day 19: starting their wages by standing order");
  // With none: nothing on day 6 (two days after the signing), and on day 9 the wage is set up from the agreement,
  // first pay a pay period after both signed.
  const without = paying(3 * DAY), theirs = new Book();
  expect(step(without, theirs, 6 * DAY, signed(a, 4 * DAY)).filter((c) => c.fn === "money")).toEqual([]);
  const late = step(without, theirs, 9 * DAY, []).filter((c) => c.fn === "money");
  expect(late.length).toBe(1);
  expect(late[0]!.args).toMatchObject({ to: "acc-c9", every: "14 days", first: "9 days", basis: "job-9" });
  expect(late[0]!.why).toStartWith("A new starter's agreement (job-9) is on file and no payroll notice has come for it: setting the wage up from the agreement, first pay day year 1, day 19");
  // An employer that hires and pays itself is as it was: at once, first pay a pay period on.
  const firm = new Staffing(context("shop-system", "city", {}), "city", { period: PERIOD, notice_days: 14, role: "staff" });
  const own = step(firm, new Book(), 5 * DAY, signed(a, 4 * DAY)).filter((c) => c.fn === "money");
  expect(own[0]!.args).toMatchObject({ first: "14 days" });
  expect(own[0]!.why).toStartWith("A new hire has signed: starting their wages by standing order");
});

test("the hiring office sends a notice of a leaver once the employment has an end, and of a death in service, each once", () => {
  const office = hiring(), book = new Book();
  const a = job("job-9", 2 * DAY, "c9");
  step(office, book, 5 * DAY, signed(a, 4 * DAY));
  // The worker gave notice: the agreement reads as ending on day 40.
  const leaving = step(office, book, 26 * DAY, [], { "job-9": { status: "ending", ends_at: 40 * DAY } }).filter((c) => c.args.kind === "payroll_notice");
  expect(leaving.length).toBe(1);
  expect(leaving[0]!.args).toMatchObject({ to: ["city"], visible: ["city"], basis: "job-9", data: { notice: "leaver", office: "finance", employee: "c9", post: "environmental scientist", agreement: "job-9", last_day: 40 * DAY, reason: "notice" } });
  expect(leaving[0]!.args.text).toBe("Payroll notice, leaver: c9, environmental scientist, employment agreement job-9 ends on year 1, day 41 (notice). For the finance office: pay is due to that day, and the wage payment under the agreement is to end then.");
  expect(step(office, book, 27 * DAY, [], { "job-9": { status: "ending", ends_at: 40 * DAY } }).filter((c) => c.args.kind === "payroll_notice")).toEqual([]);
  // A death in service: the office that employed them ends the employment on record and tells the payroll.
  const other = hiring(), theirs = new Book();
  const b = job("job-8", 2 * DAY, "c8");
  step(other, theirs, 5 * DAY, signed(b, 4 * DAY));
  const died = step(other, theirs, 30 * DAY, [statement("death-1", 30 * DAY, "death_registration", { data: { deceased: "c8" } })]);
  expect(died.filter((c) => c.fn === "agreement" && c.args.notice === "job-8").length).toBe(1);
  expect(died.find((c) => c.args.kind === "payroll_notice")!.args.data).toMatchObject({ notice: "leaver", employee: "c8", agreement: "job-8", last_day: 30 * DAY, reason: "died" });
});

test("the finance office asks the mayor, once, for the written approval an invoice over the procedure's figure needs", () => {
  const m = financeOfficer.create(context("finance-system", "city", { procedure: "proc-payments" }, { position: "finance" }));
  const treasury = { kind: "accounts", transactions: [], accounts: [{ account: "acc-city", holder: "city", custodian: "bank", currency: "AUD", balance: "900000000" }] };
  const budget = statement("budget-1", 0, "budget", { data: { year: 1, lines: { parks: 20_000_000 } } });
  const invoice = statement("inv-1", 5 * DAY, "invoice", { author: "builder-system", speaks_for: "builder", addressed_to: ["city"], data: { outcome: { money: { to: "acc-builder", amount: "12000000", for: "a park" } } } });
  const first = wake(m, 6 * DAY, { papers: { kind: "records", records: [budget, statement("proc-payments", 0, "procedure", { data: { approval: { by: "mayor", over: 5_000_000 } } }), invoice] }, treasury }, { entity: "city" }).said;
  expect(first.filter((c) => c.fn === "money")).toEqual([]);
  const asked = first.filter((c) => c.fn === "message");
  expect(asked.map((c) => [c.args.to, c.args.re])).toEqual([[["mayor"], "inv-1"]]);
  expect(asked[0]!.args.text).toBe("From the finance office: your written approval is needed for invoice inv-1 ($120,000.00, payable to acc-builder): it is within the budget and over $50,000.00, and the payments procedure asks for the mayor's approval of such a payment. It will be paid once an approval of it is on the town's file.");
  // Not asked again; paid once the approval is on file.
  expect(wake(m, 9 * DAY, { papers: { kind: "records", records: [] }, treasury }, { entity: "city" }).said).toEqual([]);
  const approval = statement("app-1", 10 * DAY, "approval", { author: "mayor-system", in_position: "mayor", addressed_to: ["city"], basis: "inv-1", data: { invoice: "inv-1" } });
  expect(wake(m, 12 * DAY, { papers: { kind: "records", records: [approval] }, treasury }, { entity: "city" }).said.filter((c) => c.fn === "money").map((c) => c.args.settles)).toEqual(["inv-1"]);
});

test("a hiring office whose posts are on a line of the budget names the line on its notice of a new starter, in the paper and in the letter (2026-10-11: a finance seat set an environment hire against the staff line)", () => {
  const office = new Staffing(context("environment-system", "city", {}, { position: "environment" }), "city", { period: PERIOD, notice_days: 14, role: "environmental scientist", does: { hire: true, pay: false }, own: "role", payroll: "finance", line: "environment" });
  const a = job("job-9", 2 * DAY, "c9");
  const out = step(office, new Book(), 4 * DAY + 3600, signed(a, 4 * DAY));
  const notice = out.find((c) => c.args.kind === "payroll_notice")!;
  expect(notice.args.data.line).toBe("environment");
  expect(notice.args.text).toContain("The post is one of those the environment line of the adopted budget pays for: the wage is on that line.");
  expect(out.find((c) => c.fn === "message")!.args.text).toContain("the environment line of the adopted budget pays for");
});

test("what a direction not to recruit does, in the office's words: no new offer; an offer already made and not yet signed is named, and stands if the worker signs", () => {
  const office = hiring(), book = new Book();
  expect(office.notRecruiting(book, 3 * DAY)).toBe("The office advertises no post, takes down the advertisements it has out and makes no new offer of employment. It has no offer out that is not yet signed.");
  const a = job("job-9", 2 * DAY, "c9");
  book.absorb(obsOf(3 * DAY, [a, signed(a, 2 * DAY)[1]]));
  expect(office.notRecruiting(book, 3 * DAY)).toBe("The office advertises no post, takes down the advertisements it has out and makes no new offer of employment. One offer it had already made is not yet signed by the worker (job-9, to c9): a direction ends no offer already made, and it stands if the worker signs it.");
  book.absorb(obsOf(4 * DAY, [signed(a, 4 * DAY)[2]]));
  expect(office.notRecruiting(book, 4 * DAY)).toContain("It has no offer out that is not yet signed.");
});
