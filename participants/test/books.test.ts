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

test("the clerk's paper: the first lists what stands open; a later one says what is new, changed and no longer open; a running figure alone files nothing; it keeps the books on its round, a day", () => {
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
  expect(clerk.due(5 * DAY + 3_600)).toBeUndefined(); // (the same day again: the round is a day)
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

test("an application before the tribunal: the landlord's books say what has changed since it was made, and what is ordinarily done where the rent is paid; never what to do", () => {
  // (The fifth living pilot: a seated landlord kept an application before the tribunal after the tenant paid in full,
  // and another after granting a stay. Nothing in its books set the application beside either.)
  const b = landlordBooks(ctx("landlord-1"));
  const law = st("law-possession", 0, "law", "state", { data: { tenancy: "possession", arrears_days: 14, notice_days: 14, possession_days: 14 } });
  b.absorb(obs(0, "landlord-1", [law, lease("lease-a", "a", 100_000), ...signed("lease-a", "a")], { ...account, transactions: [{ ...rentPaid(0, "a", 100_000), memo: "rent" }] }));
  const ending = (t: number) => head(b.open(t), "Tenancies being ended for arrears under the law on possession, and where each has got to")?.items[0];
  b.absorb(obs(87 * DAY, "landlord-1", [st("rec.20", 70 * DAY, "notice_to_vacate", "landlord-1", { addressed_to: ["a"], basis: "lease-a", data: { lease: "lease-a", reason: "arrears", by: 85 * DAY } }),
    st("rec.21", 87 * DAY, "tribunal_application", "landlord-1", { addressed_to: ["tribunal"], basis: "lease-a", data: { kind: "possession", matter: "possession", against: "a", about: "lease-a", amount: 200_000 } })]));
  expect(ending(88 * DAY)!.line).toContain("it has not decided");
  expect(ending(88 * DAY)!.line).not.toContain("ordinarily withdraw");
  // The tenant answers the tribunal: shown, with whether this office has replied.
  b.absorb(obs(90 * DAY, "landlord-1", [st("rec.30", 90 * DAY, "tribunal_response", "a", { addressed_to: ["tribunal"], basis: "rec.21", data: { application: "rec.21", owes: 200_000, offer: 30_000 } })]));
  expect(ending(91 * DAY)!.line).toContain("a answered the tribunal year 1, day 91 (rec.30), offering $300.00 a month toward what is owed; we have not replied (reply to a tenant's answer form)");
  b.absorb(obs(92 * DAY, "landlord-1", [st("rec.31", 92 * DAY, "tribunal_reply", "landlord-1", { addressed_to: ["tribunal", "a"], basis: "rec.21", data: { application: "rec.21", owed: 300_000 } })]));
  expect(ending(93 * DAY)!.line).toContain("we have replied");
  // The tenant pays everything owed: the books set that beside the application, and say what is ordinarily done.
  b.absorb(obs(95 * DAY, "landlord-1", [], { ...account, transactions: [{ ...rentPaid(95 * DAY, "a", 300_000), memo: "rent owed" }] }));
  const line = ending(96 * DAY)!.line;
  expect(line).toContain("Since the application: the application said $2,000.00 was owed; the rent book shows less than a rent owed now");
  expect(line).toContain("An application stands until it is decided or withdrawn; where the rent owed has been paid or terms agreed, landlords ordinarily withdraw it");
  expect(line).not.toMatch(/\b(should|ought|must withdraw|withdraw it now)\b/i);
  // Withdrawn: no longer shown as waiting on the tribunal.
  b.absorb(obs(97 * DAY, "landlord-1", [{ id: "rec.40", at: 97 * DAY, record: "withdrawal", author: "landlord-1-office-system", speaks_for: "landlord-1", withdraws: "rec.21", visible_to: ["landlord-1", "tribunal", "a"] }]));
  expect(ending(98 * DAY)?.line ?? "").not.toContain("we applied to the tribunal");
});

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

test("what waits on the office-holder with its day come is named first in every paper, however long it has stood; a thing that moves heading is not said to be closed; a list too long says what it leaves out", () => {
  const waiting = (n: number): OpenHeading => ({ what: "Cases listed, waiting for their day", items: Array.from({ length: n }, (_, i) => ({ id: `rec.${100 + i}`, line: `rec.${100 + i}: waiting`, due: (50 + i) * DAY })) });
  const ripe = (ids: number[]): OpenHeading => ({ what: "Cases whose day has come, not decided", always: true, items: ids.map((i) => ({ id: `rec.${i}`, line: `rec.${i}: its day has come`, due: 40 * DAY })) });
  const was = (hs: OpenHeading[]) => new Map(hs.map((h) => [h.what, new Map(h.items.map((x) => [x.id, x.line]))]));
  // Day 1: rec.100 waits among thirty. Day 2: its day has come.
  const first = [waiting(30)];
  const second = [{ ...waiting(30), items: waiting(30).items.slice(1) }, ripe([100])];
  const p2 = booksPaper("tribunal-member", 41 * DAY, second, was(first));
  expect(p2.text).toContain("Cases whose day has come, not decided: 1 in all (1 since the last paper): rec.100: its day has come.");
  expect(p2.text.indexOf("Cases whose day has come")).toBeLessThan(p2.text.indexOf("Cases listed, waiting"));
  expect(p2.text).not.toContain("no longer open");
  expect((p2.data as any).open[0]).toMatchObject({ what: "Cases whose day has come, not decided", about: "rec.100", due: 40 * DAY });
  // Forty days on, nothing about it changed and something else did: it is still named, first.
  const third = [{ ...waiting(31), items: waiting(31).items.slice(1) }, ripe([100])];
  const p3 = booksPaper("tribunal-member", 81 * DAY, third, was(second));
  expect(p3.text).toContain("Cases whose day has come, not decided: 1 in all: rec.100: its day has come.");
  expect(p3.key).not.toBe(p2.key);
  // Decided: now it is no longer open, and said so.
  const p4 = booksPaper("tribunal-member", 82 * DAY, [third[0]!], was(third));
  expect(p4.text).toContain("Cases whose day has come, not decided: none now; no longer open: rec.100.");
  // More than the list holds: the list says how many it leaves out.
  const long = booksPaper("tribunal-member", 82 * DAY, [waiting(230)], undefined);
  expect((long.data as any).open.length).toBe(200);
  expect((long.data as any).over).toEqual([{ what: "Cases listed, waiting for their day", not_listed: 30 }]);
});

test("a tenant who goes on the notice to vacate: the tenancy is over in the landlord's books, the rent stops counting from that day, and an application still undecided is said to stand", () => {
  const b = landlordBooks(ctx("landlord-1"));
  const law = st("law-possession", 0, "law", "state", { data: { tenancy: "possession", arrears_days: 14, notice_days: 14, possession_days: 14 } });
  b.absorb(obs(0, "landlord-1", [law, lease("lease-a", "a", 100_000), ...signed("lease-a", "a")], { ...account, transactions: [rentPaid(0, "a", 100_000)] }));
  b.absorb(obs(70 * DAY, "landlord-1", [st("rec.20", 70 * DAY, "notice_to_vacate", "landlord-1", { addressed_to: ["a"], basis: "lease-a", data: { lease: "lease-a", reason: "arrears", by: 85 * DAY } })]));
  // Day 85: the landlord applies; minutes later the tenant gives notice on the lease and goes.
  b.absorb(obs(85 * DAY, "landlord-1", [st("rec.21", 85 * DAY, "tribunal_application", "landlord-1", { addressed_to: ["tribunal"], basis: "lease-a", data: { kind: "possession", matter: "possession", against: "a", about: "lease-a" } }),
    { id: "rec.22", at: 85 * DAY + 600, record: "notice", agreement: "lease-a", as: "a", author: "a-self", visible_to: ["landlord-1", "a"], text: "Leaving: told to vacate for arrears." }]));
  const GONE = "Tenants who have left on our notice to vacate: tenancies over";
  const at = (t: number) => b.open(t);
  const item = head(at(86 * DAY), GONE)!.items[0]!;
  expect(item).toMatchObject({ id: "lease-a", since: 85 * DAY + 600, amount: 200_000 });
  expect(item.line).toContain("a gave notice on the lease year 1, day 86, after our notice to vacate, and has given up");
  expect(item.line).toContain("$2,000.00 of rent was owed under it when they left, and is still owed");
  expect(item.line).toContain("our application for possession rec.21 (year 1, day 86) still stands at the tribunal, undecided: law-possession gives possession only where the tenant has not left");
  // It is no longer rent in arrears, nor a tenancy being ended; and a month on, no further rent has been counted.
  expect(head(at(86 * DAY), "Rent in arrears")).toBeUndefined();
  expect(head(at(86 * DAY), "Tenancies being ended for arrears under the law on possession, and where each has got to")).toBeUndefined();
  expect(head(at(125 * DAY), GONE)!.items[0]).toMatchObject({ amount: 200_000 });
  // The application withdrawn: the line no longer says it stands.
  b.absorb(obs(126 * DAY, "landlord-1", [{ id: "rec.30", at: 126 * DAY, record: "withdrawal", withdraws: "rec.21", author: "landlord-1-office-system", visible_to: ["landlord-1", "tribunal"] }]));
  expect(head(at(127 * DAY), GONE)!.items[0]!.line).not.toContain("still stands at the tribunal");
});
