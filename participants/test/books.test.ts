// The clerk's paper (participants/src/behaviour/books.ts) and two offices' books read from papers made by hand
// (participants/src/behaviour/openbooks.ts): a landlord's rent book counts each lease from its own rent day; the
// support office's books hold what its staff put before the office-holder. And a direction filed on an office's form
// reaches its staff's post (`Directions`), which looked for it under its own post's name until 2026-10-11.

import { expect, test } from "bun:test";
import type { Observation } from "../src/contracts";
import type { OpenHeading, ParticipantContext } from "../src/module";
import { inCurrency } from "../src/money";
import { Randomness } from "../src/rng";
import { booksPaper, Clerk } from "../src/behaviour/books";
import { Book, Directions } from "../src/behaviour/common";
import { firstDueOf, landlordBooks, supportBooks } from "../src/behaviour/openbooks";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";

inCurrency(PROFILE.values.currency);

const DAY = 86_400, MONTH = 30 * DAY;
const ctx = (entity: string, params: object = {}, position?: string): ParticipantContext => ({ participant: `${position ?? entity}-system`, entity, ...(position ? { position } : {}), params, rng: (purpose) => new Randomness(1n).stream(["test", purpose]), world: { tickSeconds: 3600, runEnd: 400 * DAY, currency: PROFILE.values.currency as any } });
const obs = (t: number, entity: string, records: any[], bank?: { accounts?: any[]; transactions?: any[] }): Observation => ({ t, entity, outcomes: [], woke_for: "cadence",
  channels: { mine: { kind: "records", records }, ...(bank ? { bank: { kind: "accounts", accounts: bank.accounts ?? [], transactions: bank.transactions ?? [] } } : {}) } }) as unknown as Observation;
const st = (id: string, at: number, kind: string, speaks_for: string, x: object = {}) => ({ id, at, author: `${speaks_for}-x`, record: "statement", speaks_for, visible_to: "public", kind, text: id, ...x });
const head = (h: OpenHeading[], what: string) => h.find((x) => x.what === what);

// ------------------------------------------------------------------ the paper

test("the clerk's paper: the first lists what stands open; a later one says what is new, changed and no longer open; a running figure alone files nothing; at most one a day", () => {
  let open: OpenHeading[] = [];
  const clerk = new Clerk("landlord-1", "landlord-1-office", { absorb() {}, open: () => open });
  const said = (t: number) => { const a: any = clerk.due(t); return a ? String(a.calls?.[0]?.args?.text ?? JSON.stringify(a)) : undefined; };
  // Nothing has ever stood open: no paper.
  expect(clerk.due(DAY)).toBeUndefined();
  open = [{ what: "Rent in arrears", items: [{ id: "lease-a", line: "lease-a: a is 100 behind" }, { id: "budget", line: "paid so far 10", running: true }] }];
  const first = said(2 * DAY)!;
  expect(first).toContain("Rent in arrears: 2 in all: lease-a: a is 100 behind; paid so far 10.");
  expect(first).not.toContain("since the clerk's last paper");
  // Nothing changed: none. A running figure moved: none.
  expect(clerk.due(3 * DAY)).toBeUndefined();
  open = [{ what: "Rent in arrears", items: [{ id: "lease-a", line: "lease-a: a is 100 behind" }, { id: "budget", line: "paid so far 25", running: true }] }];
  expect(clerk.due(4 * DAY)).toBeUndefined();
  // Something new, something changed, something gone: one paper, saying each; the running figure as it stands.
  open = [{ what: "Rent in arrears", items: [{ id: "lease-b", line: "lease-b: b is 50 behind" }, { id: "budget", line: "paid so far 30", running: true }] }];
  const second = said(5 * DAY)!;
  expect(second).toContain("new: lease-b: b is 50 behind");
  expect(second).toContain("no longer open: lease-a");
  expect(second).toContain("paid so far 30");
  expect(second).toContain("what has changed since the clerk's last paper");
  // The same day again, changed again: it waits for the next day.
  open = [{ what: "Rent in arrears", items: [{ id: "lease-c", line: "lease-c: c is 5 behind" }] }];
  expect(clerk.due(5 * DAY + 3_600)).toBeUndefined();
  expect(said(6 * DAY)).toContain("new: lease-c");
  // Everything settled: one last paper says so.
  open = [];
  expect(said(7 * DAY)).toContain("Rent in arrears: none now; no longer open: lease-c.");
  expect(clerk.due(8 * DAY)).toBeUndefined();
});

test("a running figure that has moved is filed once the clerk's last paper is a week old, and not before; one that has not moved files nothing", () => {
  // (Finance's "tax withheld and not yet paid over" stood at its day-9 figure until day 93 of the third living pilot:
  // nothing else in its books changed, and a running figure alone was never a reason for a paper.)
  let open: OpenHeading[] = [{ what: "Tax withheld from wages and not yet paid over", items: [{ id: "withheld", line: "100 withheld so far", running: true }] }];
  const clerk = new Clerk("city", "finance", { absorb() {}, open: () => open });
  const said = (t: number) => { const a: any = clerk.due(t); return a ? String(a.calls?.[0]?.args?.text ?? JSON.stringify(a)) : undefined; };
  expect(said(9 * DAY)).toContain("100 withheld so far");
  open = [{ what: "Tax withheld from wages and not yet paid over", items: [{ id: "withheld", line: "900 withheld so far", running: true }] }];
  for (let d = 10; d < 16; d++) expect(clerk.due(d * DAY)).toBeUndefined();
  const week = said(16 * DAY)!;
  expect(week).toContain("now: 900 withheld so far");
  // Not moved since: nothing, however long.
  for (let d = 17; d < 60; d++) expect(clerk.due(d * DAY)).toBeUndefined();
  open = [{ what: "Tax withheld from wages and not yet paid over", items: [{ id: "withheld", line: "1,700 withheld so far", running: true }] }];
  expect(said(60 * DAY)).toContain("now: 1,700 withheld so far");
});

test("the paper's list is one flat list, an entry each thing that stands open, capped; its words name a few and count the rest", () => {
  const items = Array.from({ length: 300 }, (_, i) => ({ id: `rec.${i}`, line: `rec.${i}: something`, since: i, amount: 100 }));
  const p = booksPaper("office", 10 * DAY, [{ what: "Invoices not paid", items }], undefined);
  expect((p.data as any).open).toHaveLength(200);
  expect((p.data as any).open[0]).toEqual({ what: "Invoices not paid", about: "rec.0", says: "rec.0: something", since: 0, amount: 100 });
  expect(p.text).toContain("300 in all");
  expect(p.text).toContain("and 296 more, in this paper's list");
  expect(p.text.length).toBeLessThan(600);
});

// ------------------------------------------------------------------ a landlord's rent book

const lease = (id: string, tenant: string, rent: number, attrs?: object) => ({ id, at: 0, author: "genesis", record: "agreement", visible_to: ["landlord-1", tenant],
  terms: { template: "lease", parties: ["landlord-1", tenant], term: 400 * DAY, ...(attrs ? { attrs } : {}), text: `${tenant} rents home apts-1/dwelling.1 from landlord-1.`,
    commitments: [{ who: "landlord-1", does: { outcome: { occupancy: { who: tenant, in: "apts-1/dwelling.1" } } } }, { who: tenant, does: { outcome: { money: { from: `acc-${tenant}`, to: "acc-landlord-1", amount: String(rent), for: "rent" } } }, every: MONTH }] } });
const signed = (id: string, tenant: string) => ["landlord-1", tenant].map((p) => ({ id: `${id}-sig-${p}`, at: 0, author: "genesis", record: "signature", visible_to: ["landlord-1", tenant], speaks_for: p, agreement: id, as: p }));
const account = { accounts: [{ account: "acc-landlord-1", holder: "landlord-1", custodian: "bank", currency: "AUD", balance: "0" }] };
const rentPaid = (t: number, tenant: string, amount: number) => ({ t, from: `acc-${tenant}`, to: "acc-landlord-1", amount: String(amount) });

test("the rent a lease names its own day for is counted from that day; a tenant a rent behind for a week is in the book, with since when; paid, they are out of it", () => {
  expect(firstDueOf({ terms: { attrs: { first_due: 12 * DAY } } }, 0)).toBe(12 * DAY);
  expect(firstDueOf({ terms: {} }, 5 * DAY)).toBe(5 * DAY);
  const b = landlordBooks(ctx("landlord-1"));
  b.absorb(obs(0, "landlord-1", [lease("lease-a", "a", 100_000, { first_due: 20 * DAY }), ...signed("lease-a", "a"), lease("lease-b", "b", 100_000, { first_due: 3 * DAY }), ...signed("lease-b", "b")], account));
  // Day 15: b's rent fell due on day 3 and has not come; a's is not due until day 20.
  let arrears = head(b.open(15 * DAY), "Rent in arrears")!;
  expect(arrears.items.map((x) => x.id)).toEqual(["lease-b"]);
  expect(arrears.items[0]).toMatchObject({ since: 3 * DAY, amount: 100_000 });
  expect(arrears.items[0]!.line).toContain("since year 1, day 4");
  // The line is the same the next day (the clerk files nothing for a day passing).
  expect(head(b.open(16 * DAY), "Rent in arrears")!.items[0]!.line).toBe(arrears.items[0]!.line);
  // Day 26: a's fell due on day 20: not yet a week late. Day 28: it is.
  expect(head(b.open(26 * DAY), "Rent in arrears")!.items.map((x) => x.id)).toEqual(["lease-b"]);
  expect(head(b.open(28 * DAY), "Rent in arrears")!.items.map((x) => x.id).sort()).toEqual(["lease-a", "lease-b"]);
  // b pays what is owed: out of the book. (Its second rent falls due on day 33.)
  b.absorb(obs(29 * DAY, "landlord-1", [], { ...account, transactions: [rentPaid(29 * DAY, "b", 100_000)] }));
  arrears = head(b.open(30 * DAY), "Rent in arrears")!;
  expect(arrears.items.map((x) => x.id)).toEqual(["lease-a"]);
});

test("a tenant's request with no answer of ours is in the book until answered", () => {
  const b = landlordBooks(ctx("landlord-1"));
  b.absorb(obs(0, "landlord-1", [lease("lease-a", "a", 100_000), ...signed("lease-a", "a"),
    st("rec.9", 5 * DAY, "variation_request", "a", { addressed_to: ["landlord-1"], text: "Request: please let us stay on.", data: { agreement: "lease-a", about: "lease-a" } }),
    st("rec.10", 6 * DAY, "remedy_request", "a", { addressed_to: ["landlord-1"], data: { matter: "disrepair", against: "landlord-1", structure: "apts-1" } })], account));
  const open = b.open(7 * DAY);
  expect(head(open, "Tenants' requests to vary something, not answered")!.items[0]).toMatchObject({ id: "rec.9", since: 5 * DAY });
  expect(head(open, "Requests to put something right, not answered")!.items[0]!.line).toContain("a asks us to put right disrepair at apts-1");
  b.absorb(obs(8 * DAY, "landlord-1", [st("rec.11", 8 * DAY, "variation_answer", "landlord-1", { basis: "rec.9", data: { granted: false } }), st("rec.12", 8 * DAY, "remedy_answer", "landlord-1", { basis: "rec.10", data: { request: "rec.10", granted: true } })]));
  const after = b.open(9 * DAY);
  expect(head(after, "Tenants' requests to vary something, not answered")).toBeUndefined();
  expect(head(after, "Requests to put something right, not answered")).toBeUndefined();
});

// ------------------------------------------------------------------ the support office

test("the support office's books: a claim its staff put before the office-holder, until it is decided", () => {
  const b = supportBooks(ctx("outside"));
  b.absorb(obs(3 * DAY, "outside", [st("rec.5", 3 * DAY, "case_for_decision", "outside", { addressed_to: ["outside"], data: { claim: "rec.4", claimant: "c0001", payment: "pension", fails: "the claim doesn't state that no other pension is paid", doubt: false } })]));
  const open = b.open(4 * DAY);
  expect(open).toHaveLength(1);
  expect(open[0]!.items[0]).toMatchObject({ id: "rec.4", since: 3 * DAY });
  expect(open[0]!.items[0]!.line).toContain("c0001's claim for pension support");
  b.absorb(obs(5 * DAY, "outside", [st("rec.6", 5 * DAY, "benefit_decision", "outside", { addressed_to: ["c0001"], basis: "rec.4", data: { claim: "rec.4", granted: false } })]));
  expect(b.open(6 * DAY)).toEqual([]);
});

// ------------------------------------------------------------------ a direction and the staff's post

test("a direction on an office's form binds its staff's post as it binds the office", () => {
  const rule = st("proc-directions", 0, "procedure", "city", { data: { directions: { by: ["mayor"] } } });
  const form = st("form-works-collection", 0, "form", "city", { data: { office: "works", form: "works_collection" } });
  const direction = st("rec.20", 2 * DAY, "direction", "city", { in_position: "mayor", addressed_to: ["city"], basis: "form-works-collection", data: { every: 14 * DAY } });
  for (const position of ["works", "works-staff"]) {
    const book = new Book();
    book.absorb(obs(3 * DAY, "city", [rule, form, direction]));
    const d = new Directions(ctx("city", {}, position), { under: "proc-directions", office_words: "the works office" });
    expect(d.standing(book, "works_collection")?.id).toBe("rec.20");
  }
});

// ------------------------------------------------------------------ possession (docs/behaviour/justice.md)

test("a landlord's books show each tenancy being ended for arrears at the stage its papers put it at, and what the law's procedure has next; the last payment's own words are in the rent book", () => {
  const b = landlordBooks(ctx("landlord-1"));
  const law = st("law-possession", 0, "law", "state", { data: { tenancy: "possession", arrears_days: 14, notice_days: 14, possession_days: 14 } });
  b.absorb(obs(0, "landlord-1", [law, lease("lease-a", "a", 100_000), ...signed("lease-a", "a")], { ...account, transactions: [{ ...rentPaid(0, "a", 100_000), memo: "rent" }] }));
  const ending = (t: number) => head(b.open(t), "Tenancies being ended for arrears under the law on possession, and where each has got to")?.items[0];
  expect(ending(70 * DAY)).toBeUndefined();
  expect(head(b.open(70 * DAY), "Rent in arrears")!.items[0]!.line).toContain('the last payment from acc-a came year 1, day 1 ($1,000.00, "rent")');
  // Notice to vacate: its date, and what follows it.
  b.absorb(obs(70 * DAY, "landlord-1", [st("rec.20", 70 * DAY, "notice_to_vacate", "landlord-1", { addressed_to: ["a"], basis: "lease-a", data: { lease: "lease-a", reason: "arrears", by: 85 * DAY } })]));
  expect(ending(71 * DAY)).toMatchObject({ id: "lease-a", since: 70 * DAY });
  expect(ending(71 * DAY)!.line).toContain("notice to vacate given year 1, day 71 (rec.20), to leave by year 1, day 86; paid before then it lapses");
  expect(ending(86 * DAY)!.line).toContain("that date has passed and the tenant has not left; by law-possession the landlord may now apply to the tribunal for possession, and may not put them out");
  // Applied; then the tribunal's plan; then, applied again, its order; a warrant asked, issued, lapsed.
  b.absorb(obs(87 * DAY, "landlord-1", [st("rec.21", 87 * DAY, "tribunal_application", "landlord-1", { addressed_to: ["tribunal"], basis: "lease-a", data: { kind: "possession", matter: "possession", against: "a", about: "lease-a" } })]));
  expect(ending(88 * DAY)!.line).toContain("we applied to the tribunal for possession year 1, day 88 (rec.21); it has not decided");
  b.absorb(obs(100 * DAY, "landlord-1", [st("rec.22", 100 * DAY, "tribunal_order", "tribunal", { basis: "rec.21", data: { kind: "possession", applicant: "landlord-1", against: "a", about: "lease-a", finding: "plan", instalment: 20_000 } })]));
  expect(ending(101 * DAY)!.line).toContain("the tribunal set a plan to pay year 1, day 101 (rec.22): the rent as it falls due and $200.00 a month toward what is owed");
  b.absorb(obs(140 * DAY, "landlord-1", [st("rec.23", 139 * DAY, "tribunal_application", "landlord-1", { addressed_to: ["tribunal"], basis: "lease-a", data: { kind: "possession", against: "a", about: "lease-a", breach: true } }),
    st("rec.24", 140 * DAY, "tribunal_order", "tribunal", { basis: "rec.23", data: { kind: "possession", applicant: "landlord-1", against: "a", about: "lease-a", finding: "possession", due: 154 * DAY, space: "apts-1/dwelling.1" } })]));
  expect(ending(141 * DAY)!.line).toContain("the tribunal ordered possession of apts-1/dwelling.1 by year 1, day 155 (rec.24); if the tenant is still there a day after that date, a warrant may be asked");
  expect(ending(156 * DAY)!.line).toContain("that date has passed and the tenant has not left; by law-possession a warrant may be asked of the tribunal's registrar, and nobody else may put them out");
  b.absorb(obs(156 * DAY, "landlord-1", [st("rec.25", 156 * DAY, "warrant_request", "landlord-1", { addressed_to: ["tribunal"], basis: "rec.24", data: { order: "rec.24" } })]));
  expect(ending(157 * DAY)!.line).toContain("a warrant was asked of the tribunal's registrar year 1, day 157 (rec.25) and has not been issued");
  b.absorb(obs(158 * DAY, "landlord-1", [st("rec.26", 158 * DAY, "warrant", "tribunal", { basis: "rec.24", data: { order: "rec.24", lease: "lease-a", until: 172 * DAY } })]));
  expect(ending(159 * DAY)!.line).toContain("a warrant is out (rec.26), to be carried out by year 1, day 173 by those who enforce the tribunal's orders, and by nobody else");
  // Carried out: the tenancy is out of this heading.
  b.absorb(obs(165 * DAY, "landlord-1", [st("rec.27", 165 * DAY, "warrant_executed", "police", { data: { lease: "lease-a" } })]));
  expect(ending(166 * DAY)).toBeUndefined();
});
