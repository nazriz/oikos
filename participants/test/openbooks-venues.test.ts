// The books of the venues and the lender (participants/src/readers/openbooks-venues.ts): what stands open at the
// tribunal's member and registrar, a complaints desk, a union's organiser and a bank's lending office, read from papers
// on hand-built observations. For each: the state stands open and its item appears (id, since, amount); settled, it is
// gone; and nothing changed, its line is the same on the next day.

import { expect, test } from "bun:test";
import type { Observation } from "../src/contracts";
import type { OfficeBooks, OpenHeading } from "../src/module";
import { inCurrency } from "../src/money";
import { deskBooks, lendingBooks, tribunalMemberBooks, tribunalRegistrarBooks, unionBooks } from "../src/readers/openbooks-venues";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";

inCurrency(PROFILE.values.currency);

const DAY = 86_400, MONTH = 30 * DAY;
const ctx = (entity: string, params: object = {}): any => ({ participant: `${entity}-system`, entity, params, world: { tickSeconds: 3600, runEnd: 400 * DAY } });
const obs = (t: number, entity: string, records: any[], bank?: { accounts?: any[]; transactions?: any[] }): Observation => ({ t, entity, outcomes: [], woke_for: "cadence",
  channels: { mine: { kind: "records", records }, ...(bank ? { bank: { kind: "accounts", accounts: bank.accounts ?? [], transactions: bank.transactions ?? [] } } : {}) } }) as unknown as Observation;
const st = (id: string, at: number, kind: string, speaks_for: string, x: object = {}) => ({ id, at, author: `${speaks_for}-x`, record: "statement", speaks_for, visible_to: "public", kind, text: id, ...x });
const heading = (h: OpenHeading[], what: string) => h.find((x) => x.what === what);
const linesOf = (h: OpenHeading[]) => JSON.stringify(h.map((x) => [x.what, x.items.map((i) => [i.id, i.line])]));
/** Feed, then ask at `t`; and on the next day: the same lines when nothing has changed. */
const same = (b: OfficeBooks, t: number) => expect(linesOf(b.open(t + DAY))).toBe(linesOf(b.open(t)));

// ------------------------------------------------------------------ tribunal.member

const application = (id: string, at: number, data: object = {}) => st(id, at, "tribunal_application", "ann", { addressed_to: ["tribunal"], data: { kind: "debt", against: "bob", ...data } });
const hearingNotice = (id: string, at: number, app: string, data: object) => st(id, at, "hearing_notice", "tribunal", { addressed_to: ["ann", "bob"], basis: app, data: { application: app, kind: "debt", applicant: "ann", against: "bob", ...data } });

test("the tribunal: an application not yet listed, then listed and waiting, then its day come, then ordered", () => {
  const b = tribunalMemberBooks(ctx("tribunal"));
  const t0 = 100 * DAY, day = t0 + 21 * DAY;
  b.absorb(obs(t0, "tribunal", [application("rec.1", t0 - DAY)]));
  const first = heading(b.open(t0), "Applications to the tribunal, not yet listed for a hearing")!;
  expect(first.items).toHaveLength(1);
  expect(first.items[0]).toMatchObject({ id: "rec.1", since: t0 - DAY });
  same(b, t0);
  // Listed: out of the first heading, in the waiting one, with its day.
  b.absorb(obs(t0 + DAY, "tribunal", [hearingNotice("rec.2", t0 + DAY, "rec.1", { hearing_at: day })]));
  let h = b.open(t0 + DAY);
  expect(heading(h, "Applications to the tribunal, not yet listed for a hearing")).toBeUndefined();
  expect(heading(h, "Cases listed, waiting for their day")!.items[0]).toMatchObject({ id: "rec.2", since: t0 + DAY });
  expect(heading(h, "Cases listed, waiting for their day")!.items[0]!.line).toContain("bob has not answered");
  same(b, t0 + 2 * DAY);
  // The day comes: no order yet, and the other side has answered.
  b.absorb(obs(day, "tribunal", [st("rec.3", day - DAY, "tribunal_response", "bob", { basis: "rec.1", addressed_to: ["tribunal"], data: { application: "rec.1" } })]));
  h = b.open(day);
  const due = heading(h, "Cases listed whose hearing day has come, with no order made")!;
  expect(due.items[0]).toMatchObject({ id: "rec.2", since: day });
  expect(due.items[0]!.line).toContain("bob has answered");
  same(b, day);
  // Ordered: gone.
  b.absorb(obs(day + DAY, "tribunal", [st("rec.4", day, "tribunal_order", "tribunal", { basis: "rec.1", data: { application: "rec.1", finding: "pay" } })]));
  expect(b.open(day + DAY)).toEqual([]);
});

test("the tribunal's lists: an application taken in waits on the other side, then its time runs out undecided, then it is decided", () => {
  const b = tribunalMemberBooks(ctx("tribunal", { hears: [{ about: "wage_theft" }] }));
  const t0 = 50 * DAY, by = t0 + 21 * DAY;
  b.absorb(obs(t0, "tribunal", [application("rec.1", t0, { kind: undefined, matter: "wage_theft", amount: 25_000 }), hearingNotice("rec.2", t0, "rec.1", { matter: "wage_theft", kind: "wage_theft", answer_by: by, hearing_at: by, amount: 25_000 })]));
  let h = b.open(t0);
  const waiting = heading(h, "Cases listed, waiting for their day")!;
  expect(waiting.items[0]).toMatchObject({ id: "rec.2", since: t0, amount: 25_000 });
  expect(waiting.items[0]!.line).toContain(`until ${"year 1, day 72"}`);
  same(b, t0 + DAY);
  h = b.open(by + DAY);
  const ran = heading(h, "Applications on the tribunal's lists whose time to answer has run, not decided")!;
  expect(ran.items[0]).toMatchObject({ id: "rec.2", since: by, amount: 25_000 });
  same(b, by + DAY);
  b.absorb(obs(by + 2 * DAY, "tribunal", [st("rec.3", by + 2 * DAY, "tribunal_order", "tribunal", { basis: "rec.1", data: { application: "rec.1", finding: "dismissed" } })]));
  expect(b.open(by + 2 * DAY)).toEqual([]);
});

// ------------------------------------------------------------------ tribunal.registrar

test("the registrar: a request to enforce an order stands until a garnishee order or a refusal answers it", () => {
  const b = tribunalRegistrarBooks(ctx("registry"));
  const t0 = 200 * DAY, due = t0 + 10 * DAY;
  const order = st("ord.1", t0 - 20 * DAY, "tribunal_order", "tribunal", { data: { finding: "pay", applicant: "ann", against: "bob", to: "acc-ann", amount: 10_000, due } });
  const req = st("rec.1", t0, "enforcement_request", "ann", { addressed_to: ["registry"], data: { order: "ord.1", unpaid: 6_000 } });
  b.absorb(obs(t0, "registry", [order, req]));
  let it = heading(b.open(t0), "Requests to enforce an order, not answered")!.items[0]!;
  expect(it).toMatchObject({ id: "rec.1", since: t0, amount: 6_000 });
  expect(it.line).toContain("that date has not come");
  same(b, t0);
  it = heading(b.open(due + DAY), "Requests to enforce an order, not answered")!.items[0]!;
  expect(it.line).toContain("that date has passed");
  b.absorb(obs(due + DAY, "registry", [st("rec.2", due + DAY, "garnishee_order", "registry", { basis: "ord.1", data: { order: "ord.1", amount: 6_000 } })]));
  expect(b.open(due + DAY)).toEqual([]);
  // A refusal also answers.
  const c = tribunalRegistrarBooks(ctx("registry"));
  c.absorb(obs(t0, "registry", [order, req]));
  expect(c.open(t0)).toHaveLength(1);
  c.absorb(obs(t0 + DAY, "registry", [st("rec.3", t0 + DAY, "enforcement_decline", "registry", { basis: "rec.1" })]));
  expect(c.open(t0 + DAY)).toEqual([]);
});

// ------------------------------------------------------------------ office.desk

const apply = (id: string, at: number, data: object = {}) => st(id, at, "application", "ann", { addressed_to: ["desk"], data: { matter: "rates_error", against: "council", ...data } });
const notice = (id: string, at: number, app: string, by: number) => st(id, at, "complaint_notice", "desk", { addressed_to: ["ann", "council"], basis: app, data: { application: app, matter: "rates_error", applicant: "ann", against: "council", answer_by: by, hearing_at: by } });

test("the desk: untaken, then taken in and waiting, then time run, then decided", () => {
  const b = deskBooks(ctx("desk"));
  const t0 = 80 * DAY, by = t0 + 14 * DAY;
  b.absorb(obs(t0, "desk", [apply("rec.1", t0, { amount: 9_000 })]));
  expect(heading(b.open(t0), "Applications addressed to us, not yet taken in")!.items[0]).toMatchObject({ id: "rec.1", since: t0, amount: 9_000 });
  same(b, t0);
  b.absorb(obs(t0 + DAY, "desk", [notice("rec.2", t0 + DAY, "rec.1", by)]));
  let h = b.open(t0 + DAY);
  expect(heading(h, "Applications addressed to us, not yet taken in")).toBeUndefined();
  expect(heading(h, "Applications taken in, waiting on the other side's answer")!.items[0]).toMatchObject({ id: "rec.2", since: t0 + DAY });
  same(b, t0 + 2 * DAY);
  h = b.open(by + DAY);
  expect(heading(h, "Applications whose time for the other side to answer has run, not decided")!.items[0]).toMatchObject({ id: "rec.2", since: by });
  same(b, by + DAY);
  b.absorb(obs(by + DAY, "desk", [st("rec.3", by + DAY, "venue_decision", "desk", { basis: "rec.1", data: { application: "rec.1", finding: "dismissed" } })]));
  expect(b.open(by + DAY)).toEqual([]);
});

test("the desk: a case put before the office-holder stands until the office-holder decides it", () => {
  const b = deskBooks(ctx("desk"));
  const t0 = 90 * DAY;
  const note = st("rec.5", t0, "case_for_decision", "desk", { visible_to: ["desk"], basis: "rec.1", data: { application: "rec.1", matter: "rates_error", applicant: "ann", against: "council", case: { data: { amount: 7_000 } } } });
  b.absorb(obs(t0, "desk", [apply("rec.1", t0 - 20 * DAY), notice("rec.2", t0 - 19 * DAY, "rec.1", t0 - 5 * DAY), note]));
  const h = b.open(t0);
  expect(heading(h, "Cases put before the office-holder for decision, not decided")!.items[0]).toMatchObject({ id: "rec.5", since: t0, amount: 7_000 });
  // (It is not also counted as a case whose time has run.)
  expect(heading(h, "Applications whose time for the other side to answer has run, not decided")).toBeUndefined();
  same(b, t0);
  b.absorb(obs(t0 + DAY, "desk", [st("rec.6", t0 + DAY, "venue_decision", "desk", { basis: "rec.1", data: { application: "rec.1", finding: "pay" } })]));
  expect(b.open(t0 + DAY)).toEqual([]);
});

// ------------------------------------------------------------------ union.organiser

test("the union: a claim with no offer, then an offer unanswered, then accepted", () => {
  const b = unionBooks(ctx("union"));
  const t0 = 120 * DAY;
  b.absorb(obs(t0, "union", [st("rec.1", t0, "wage_claim", "union", { addressed_to: ["firm"], data: { employer: "firm", rise_bps: 450, members: 8 } })]));
  expect(heading(b.open(t0), "Wage claims of ours with no offer from the employer")!.items[0]).toMatchObject({ id: "rec.1", since: t0 });
  same(b, t0);
  b.absorb(obs(t0 + 5 * DAY, "union", [st("rec.2", t0 + 5 * DAY, "wage_offer", "firm", { addressed_to: ["union"], data: { employer: "firm", claim: "rec.1", rise_bps: 200 } })]));
  const h = b.open(t0 + 5 * DAY);
  expect(heading(h, "Wage claims of ours with no offer from the employer")).toBeUndefined();
  expect(heading(h, "Offers on our claims, not answered")!.items[0]).toMatchObject({ id: "rec.2", since: t0 + 5 * DAY });
  same(b, t0 + 6 * DAY);
  b.absorb(obs(t0 + 6 * DAY, "union", [st("rec.3", t0 + 6 * DAY, "offer_accepted", "union", { basis: "rec.2", data: { claim: "rec.1" } })]));
  expect(b.open(t0 + 6 * DAY)).toEqual([]);
});

test("the union: a ballot open with the votes on file, closed with no result, then declared; action notified and begun", () => {
  const b = unionBooks(ctx("union"));
  const t0 = 130 * DAY, closes = t0 + 10 * DAY;
  const ballot = st("rec.1", t0, "action_ballot", "union", { addressed_to: ["m1", "m2", "m3"], data: { employer: "firm", claim: "rec.0", closes } });
  const vote = (id: string, who: string, at: number, choice: string) => ({ id, at, author: who, record: "vote", ballot: "rec.1", choice, visible_to: ["union"] });
  b.absorb(obs(t0, "union", [ballot, vote("v1", "m1", t0 + DAY, "yes"), vote("v2", "m2", t0 + DAY, "no"), vote("v3", "m2", t0 + 2 * DAY, "yes"), vote("v4", "stranger", t0 + DAY, "yes")]));
  let it = heading(b.open(t0 + 3 * DAY), "Ballots of ours open")!.items[0]!;
  expect(it).toMatchObject({ id: "rec.1", since: t0 });
  expect(it.line).toContain("2 of 3 voted, 2 yes, 0 no"); // (m2's latest vote counts; a stranger's does not)
  same(b, t0 + 3 * DAY);
  it = heading(b.open(closes + DAY), "Ballots of ours closed, no result declared")!.items[0]!;
  expect(it).toMatchObject({ id: "rec.1", since: closes });
  same(b, closes + DAY);
  // Action notified.
  const from = closes + 5 * DAY, until = from + 2 * DAY;
  b.absorb(obs(closes + 2 * DAY, "union", [st("rec.2", closes + 2 * DAY, "ballot_result", "union", { basis: "rec.1", data: { ballot: "rec.1", passed: true } }),
    st("rec.3", closes + 2 * DAY, "industrial_action", "union", { data: { employer: "firm", from, until } })]));
  let h = b.open(closes + 3 * DAY);
  expect(heading(h, "Ballots of ours closed, no result declared")).toBeUndefined();
  expect(heading(h, "Action notified, not yet begun")!.items[0]).toMatchObject({ id: "rec.3", since: closes + 2 * DAY });
  same(b, closes + 3 * DAY);
  h = b.open(from + DAY);
  expect(heading(h, "Action begun, not yet ended")!.items[0]).toMatchObject({ id: "rec.3", since: from });
  b.absorb(obs(until, "union", [st("rec.4", until, "return_to_work", "union", { data: { employer: "firm" } })]));
  expect(b.open(until)).toEqual([]);
});

test("the union: an application to join stands until a membership is offered; members' matters only where it hears them", () => {
  const apps = [st("rec.1", 10 * DAY, "membership_application", "ann", { addressed_to: ["union"], data: { employer: "firm" } }), { ...apply("rec.2", 11 * DAY), addressed_to: ["union"] }];
  const b = unionBooks(ctx("union"));
  b.absorb(obs(12 * DAY, "union", apps));
  let h = b.open(12 * DAY);
  expect(heading(h, "Applications to join, no membership offered")!.items[0]).toMatchObject({ id: "rec.1", since: 10 * DAY });
  expect(heading(h, "Members' matters addressed to us, not yet taken in")).toBeUndefined(); // (no list of matters it hears)
  same(b, 12 * DAY);
  const c = unionBooks(ctx("union", { hears: [{ about: "rates_error" }] }));
  c.absorb(obs(12 * DAY, "union", apps));
  h = c.open(12 * DAY);
  expect(heading(h, "Members' matters addressed to us, not yet taken in")!.items[0]).toMatchObject({ id: "rec.2", since: 11 * DAY });
  // A membership offered on it (an agreement citing the application) answers it.
  const membership = { id: "agr.1", at: 13 * DAY, author: "union-x", record: "agreement", visible_to: ["union", "ann"], basis: "rec.1", terms: { template: "membership", parties: ["union", "ann"], commitments: [] } };
  b.absorb(obs(13 * DAY, "union", [membership]));
  expect(heading(b.open(13 * DAY), "Applications to join, no membership offered")).toBeUndefined();
});

// ------------------------------------------------------------------ bank.lending

const accounts = [{ account: "acc-bank", holder: "bank", custodian: "bank", currency: "AUD", balance: "100000000" }];
const loanAgreement = (id: string, at: number, attrs?: object) => ({ id, at, author: "bank-x", record: "agreement", visible_to: ["bank", "ann"], terms: { template: "loan", parties: ["bank", "ann"], term: 12 * MONTH, ...(attrs ? { attrs } : {}),
  commitments: [{ who: "bank", does: { outcome: { money: { from: "acc-bank", to: "acc-ann", amount: "120000", for: "principal" } } } },
    { who: "ann", does: { outcome: { money: { from: "acc-ann", to: "acc-bank", amount: "10000", for: "repayment" } } }, every: MONTH }] } });
const sig = (agr: string, who: string, at: number) => ({ id: `sig-${agr}-${who}`, at, author: `${who}-x`, record: "signature", agreement: agr, as: who, visible_to: ["bank", "ann"] });
const tx = (t: number, from: string, to: string, amount: string, settles?: string) => ({ id: `tx.${t}.${from}`, t, from, to, amount, ...(settles ? { settles } : {}) });

test("lending: an application not decided, then decided", () => {
  const b = lendingBooks(ctx("bank"));
  const t0 = 60 * DAY;
  b.absorb(obs(t0, "bank", [st("rec.1", t0, "loan_application", "ann", { addressed_to: ["bank"], data: { amount: 500_000, months: 24, account: "acc-ann", purpose: "a car" } })], { accounts }));
  expect(heading(b.open(t0), "Loan applications, not decided")!.items[0]).toMatchObject({ id: "rec.1", since: t0, amount: 500_000 });
  same(b, t0);
  b.absorb(obs(t0 + DAY, "bank", [st("rec.2", t0 + DAY, "loan_decision", "bank", { basis: "rec.1", data: { application: "rec.1", approved: false } })], { accounts }));
  expect(b.open(t0 + DAY)).toEqual([]);
});

test("lending: a loan the borrower signed and the principal not paid out, until it is paid out", () => {
  const b = lendingBooks(ctx("bank"));
  const t0 = 40 * DAY;
  b.absorb(obs(t0, "bank", [], { accounts }));
  b.absorb(obs(t0 + DAY, "bank", [loanAgreement("agr.1", t0 + DAY), sig("agr.1", "bank", t0 + DAY), sig("agr.1", "ann", t0 + 2 * DAY)], { accounts }));
  const it = heading(b.open(t0 + 3 * DAY), "Loans signed by the borrower, the principal not paid out")!.items[0]!;
  expect(it).toMatchObject({ id: "agr.1", since: t0 + 2 * DAY, amount: 120_000 });
  same(b, t0 + 3 * DAY);
  b.absorb(obs(t0 + 4 * DAY, "bank", [], { accounts, transactions: [tx(t0 + 4 * DAY, "acc-bank", "acc-ann", "120000", "agr.1")] }));
  expect(heading(b.open(t0 + 4 * DAY), "Loans signed by the borrower, the principal not paid out")).toBeUndefined();
});

test("lending: a loan falls behind a month after it started, with the letter of ours on file; a repayment settles it", () => {
  const b = lendingBooks(ctx("bank"));
  const t0 = 40 * DAY;
  // In force when the office first looked: followed from then.
  b.absorb(obs(t0, "bank", [loanAgreement("agr.1", t0 - 100 * DAY), sig("agr.1", "bank", t0 - 100 * DAY), sig("agr.1", "ann", t0 - 100 * DAY)], { accounts }));
  expect(b.open(t0 + MONTH + 3 * DAY)).toEqual([]); // (a payment under a week late is not yet listed)
  const t1 = t0 + MONTH + 10 * DAY;
  let it = heading(b.open(t1), "Loans behind")!.items[0]!;
  expect(it).toMatchObject({ id: "agr.1", since: t0 + MONTH, amount: 10_000 });
  expect(it.line).toContain("no letter of arrears or default notice is on file");
  same(b, t1);
  // The letter of arrears is filed: the line says so; two months on, the sum is 20000 from the same day.
  b.absorb(obs(t1, "bank", [st("rec.1", t1, "loan_arrears", "bank", { basis: "agr.1", data: { loan: "agr.1", behind: 10_000 } })], { accounts }));
  it = heading(b.open(t1), "Loans behind")!.items[0]!;
  expect(it.line).toContain("a letter of arrears is on file");
  same(b, t1);
  expect(heading(b.open(t0 + 2 * MONTH + 10 * DAY), "Loans behind")!.items[0]).toMatchObject({ since: t0 + MONTH, amount: 20_000 });
  // The borrower's payments of two months come in: nothing is behind.
  b.absorb(obs(t1 + DAY, "bank", [], { accounts, transactions: [tx(t1 + DAY, "acc-ann", "acc-bank", "10000"), tx(t1 + DAY, "acc-ann", "acc-bank", "10000")] }));
  expect(b.open(t0 + 2 * MONTH + 10 * DAY)).toEqual([]);
});

test("lending: a first repayment named by the agreement falls due when it says, not a month after", () => {
  const b = lendingBooks(ctx("bank"));
  const t0 = 40 * DAY, began = t0 - 5 * DAY;
  b.absorb(obs(t0, "bank", [loanAgreement("agr.1", began, { first_due: 10 * DAY }), sig("agr.1", "bank", began), sig("agr.1", "ann", began)], { accounts }));
  expect(b.open(began + 10 * DAY + 3 * DAY)).toEqual([]);
  const it = heading(b.open(began + 20 * DAY), "Loans behind")!.items[0]!;
  expect(it).toMatchObject({ id: "agr.1", since: began + 10 * DAY, amount: 10_000 });
  same(b, began + 20 * DAY);
});

test("lending: a payout figure asked for stands until it is given", () => {
  const b = lendingBooks(ctx("bank"));
  const t0 = 40 * DAY;
  b.absorb(obs(t0, "bank", [loanAgreement("agr.1", t0 - 100 * DAY), sig("agr.1", "bank", t0 - 100 * DAY), sig("agr.1", "ann", t0 - 100 * DAY),
    st("rec.1", t0, "loan_payout_request", "ann", { addressed_to: ["bank"], data: { loan: "agr.1" } })], { accounts }));
  expect(heading(b.open(t0), "Payout figures asked for, not given")!.items[0]).toMatchObject({ id: "rec.1", since: t0 });
  same(b, t0);
  b.absorb(obs(t0 + DAY, "bank", [st("rec.2", t0 + DAY, "loan_payout", "bank", { basis: "rec.1", data: { loan: "agr.1", amount: 90_000 } })], { accounts }));
  expect(b.open(t0 + DAY)).toEqual([]);
});

// ------------------------------------------------------------------ possession (docs/behaviour/justice.md)

test("the tribunal's books show an application for possession with the home, what is said to be owed, and whether the tenant has answered and with what; the registrar's show a warrant asked for and not issued", () => {
  const b = tribunalMemberBooks(ctx("tribunal", { hears: [{ about: "possession" }] }));
  const t0 = 90 * DAY, by = t0 + 21 * DAY;
  const app = st("rec.1", t0, "tribunal_application", "landlord-1", { addressed_to: ["tribunal"], data: { kind: "possession", matter: "possession", against: "ann", about: "lease-a", amount: 260_000, space: "apts-1/dwelling.1" } });
  const notice = st("rec.2", t0, "hearing_notice", "tribunal", { addressed_to: ["landlord-1", "ann"], basis: "rec.1", data: { application: "rec.1", kind: "possession", matter: "possession", applicant: "landlord-1", against: "ann", answer_by: by, hearing_at: by } });
  b.absorb(obs(t0, "tribunal", [app, notice]));
  const H = "Applications for possession of a let home, waiting for the tenant's time to answer", RIPE = "Applications for possession of a let home whose day has come, not decided";
  let item = heading(b.open(t0 + DAY), H)!.items[0]!;
  expect(item).toMatchObject({ id: "rec.1", since: t0, amount: 260_000 });
  expect(item.line).toContain("landlord-1 applies for possession of apts-1/dwelling.1 from ann (lease lease-a)");
  expect(item.line).toContain("ann has not answered");
  same(b, t0 + DAY);
  // (It is under that heading and no other.)
  expect(b.open(t0 + DAY).map((h) => h.what)).toEqual([H]);
  b.absorb(obs(t0 + 5 * DAY, "tribunal", [st("rec.3", t0 + 5 * DAY, "tribunal_response", "ann", { basis: "rec.1", addressed_to: ["tribunal"], data: { application: "rec.1", paid: 60_000, offer: 30_000 } })]));
  // The day the tenant may answer by: from its first hour the case is among those whose day has come, said in every
  // paper of the clerk's (`always`), and no longer among those waiting.
  expect(b.open(by - DAY).map((h) => h.what)).toEqual([H]);
  expect(heading(b.open(by - DAY), H)!.items[0]).toMatchObject({ due: by });
  const morning = Math.floor(by / DAY) * DAY + 3600;
  expect(b.open(morning).map((h) => [h.what, h.always])).toEqual([[RIPE, true]]);
  item = heading(b.open(by + DAY), RIPE)!.items[0]!;
  expect(item.line).toContain("ann answered");
  expect(item.line).toContain("has been paid since; could pay");
  expect(item.line).toContain("the tenant's time to answer ran out");
  const order = st("rec.4", by + DAY, "tribunal_order", "tribunal", { basis: "rec.1", data: { application: "rec.1", kind: "possession", applicant: "landlord-1", against: "ann", about: "lease-a", finding: "possession", due: by + 15 * DAY, space: "apts-1/dwelling.1" } });
  b.absorb(obs(by + DAY, "tribunal", [order]));
  expect(b.open(by + 2 * DAY)).toEqual([]);
  // The registrar: a warrant asked for on that order, until one is issued.
  const r = tribunalRegistrarBooks(ctx("tribunal"));
  r.absorb(obs(by + 16 * DAY, "tribunal", [order, st("rec.5", by + 16 * DAY, "warrant_request", "landlord-1", { addressed_to: ["tribunal"], basis: "rec.4", data: { order: "rec.4" } })]));
  const W = "Requests for a warrant of possession, not answered";
  expect(heading(r.open(by + 17 * DAY), W)!.items[0]!.line).toContain("for possession of apts-1/dwelling.1 from ann");
  expect(heading(r.open(by + 17 * DAY), W)!.items[0]!.line).toContain("which has passed; no warrant issued");
  r.absorb(obs(by + 18 * DAY, "tribunal", [st("rec.6", by + 18 * DAY, "warrant", "tribunal", { basis: "rec.4", data: { order: "rec.4", lease: "lease-a" } })]));
  expect(heading(r.open(by + 19 * DAY), W)).toBeUndefined();
});
