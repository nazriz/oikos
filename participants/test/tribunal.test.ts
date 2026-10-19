// The tribunal (docs/behaviour/justice.md), on records alone: an application is listed and both sides told; on the
// hearing day a notice of rent increase is tested against the law in force when it was given (invalid, or valid); a debt
// is ordered paid, less what the respondent says it has paid; and an unpaid order, once due, is enforced by an order to
// the debtor's bank.

import { expect, test } from "bun:test";
import type { Observation } from "../src/contracts";

import { inCurrency } from "../src/money";
import { Randomness } from "../src/rng";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";
import { engine } from "./engine";
const member = engine("tribunal.member");
const registrar = engine("tribunal.registrar");

// The world these tests are in writes its money as the profile says (the platform has no money of its own).
inCurrency(PROFILE.values.currency);

const DAY = 86_400;
const ctx = (participant: string, params: object): any => ({ participant, entity: "tribunal", rng: (k: string) => new Randomness(1n).stream([k]), world: { tickSeconds: 3600, runEnd: 400 * DAY }, params });
const obs = (t: number, records: any[]): Observation => ({ t, entity: "tribunal", channels: { mine: { kind: "records", records } }, outcomes: [], woke_for: "news" }) as unknown as Observation;
const rec = (id: string, at: number, x: object) => ({ id, at, author: "x", visible_to: ["tribunal"], ...x });
/** The data of each statement of a kind in what a module did. */
const said = (text: string, kind: string) => text.split("\n").filter((l) => l.includes(`kind=${kind}`)).map((l) => JSON.parse(/data=(\{.*?\}), kind=/.exec(l)![1]!));
/** What a module does now: its calls' text (or "wait"). */
const run = (m: ReturnType<typeof member.create>, o: Observation) => {
  const out: string[] = [];
  for (let i = 0; i < 20; i++) {
    const a: any = m.step(o, undefined as any);
    if (a.type === "wait") break;
    out.push(a.call);
  }
  return out.join("\n");
};

// The law: at least 60 days' notice, and no more than one increase in 12 months.
const law = rec("law-rent", 0, { record: "statement", speaks_for: "outside", kind: "law", visible_to: "public", text: "Rent increases: 60 days' notice, once a year.", adico: { attribute: "landlords", deontic: "must_not", aim: "increase a rent", condition: "with less notice, or more often" },
  formal: { language: "cel", condition: `block.block == 'publish' && block.kind == 'rent_increase' && (block.data.from - now < ${60 * DAY} || block.data.from - block.data.last_from < ${360 * DAY})` } });
const notice = (id: string, at: number, from: number, last_from: number) =>
  ({ id, at, author: "landlord-1-office-system", record: "statement", speaks_for: "landlord-1", kind: "rent_increase", addressed_to: ["c0001"], visible_to: ["landlord-1", "c0001"], text: "Notice.", data: { lease: "lease-1", rent: "200000", from, was: "180000", last_from } });
const apply = (id: string, at: number, data: object) => rec(id, at, { record: "statement", speaks_for: "c0001", kind: "tribunal_application", addressed_to: ["tribunal"], text: "Application.", data });

test("a notice of rent increase that breaks the law is found invalid; one that doesn't, valid", () => {
  const m = member.create(ctx("tribunal-member-system", { hearing_after_days: 21 }));
  const t0 = 400 * DAY;
  const bad = notice("rec.1", t0 - 10 * DAY, t0 + 20 * DAY, t0 - 200 * DAY); // 30 days' notice, the last change 220 days before
  const good = notice("rec.2", t0 - 10 * DAY, t0 + 60 * DAY, t0 - 400 * DAY);
  const a1 = apply("rec.3", t0, { kind: "rent_increase", against: "landlord-1", notice: "rec.1", evidence: bad });
  const a2 = apply("rec.4", t0, { kind: "rent_increase", against: "landlord-1", notice: "rec.2", evidence: good });
  const listed = run(m, obs(t0, [law, a1, a2]));
  expect(listed.match(/kind=hearing_notice/g)?.length).toBe(2);
  expect(listed).toContain(`"hearing_at":${t0 + 21 * DAY}`);
  expect(run(m, obs(t0 + 10 * DAY, []))).toBe(""); // (not yet)
  const heard = run(m, obs(t0 + 21 * DAY, []));
  const orders = said(heard, "tribunal_order");
  expect(orders.find((o) => o.application === "rec.3")).toMatchObject({ applicant: "c0001", finding: "invalid", laws: ["law-rent"] });
  expect(orders.find((o) => o.application === "rec.4")).toMatchObject({ applicant: "c0001", finding: "valid" });
});

test("a law repealed is no longer applied: a notice given after the repeal is valid, one given while it stood still isn't", () => {
  const m = member.create(ctx("tribunal-member-system", { hearing_after_days: 21 }));
  const t0 = 400 * DAY;
  // Both give 30 days' notice (the law asked 60). The town repeals the law between them, with nothing in its place.
  const before = notice("rec.1", t0 - 10 * DAY, t0 + 20 * DAY, t0 - 400 * DAY);
  const repeal = rec("rec.2", t0 - 5 * DAY, { record: "withdrawal", withdraws: "law-rent", speaks_for: "outside", visible_to: "public", text: "Repealed." });
  const after = notice("rec.3", t0 - 2 * DAY, t0 + 28 * DAY, t0 - 400 * DAY);
  const a1 = apply("rec.4", t0, { kind: "rent_increase", against: "landlord-1", notice: "rec.1", evidence: before });
  const a2 = apply("rec.5", t0, { kind: "rent_increase", against: "landlord-1", notice: "rec.3", evidence: after });
  run(m, obs(t0 - 20 * DAY, [law]));
  run(m, obs(t0, [repeal, a1, a2]));
  const orders = said(run(m, obs(t0 + 21 * DAY, [])), "tribunal_order");
  expect(orders.find((o) => o.application === "rec.4")).toMatchObject({ finding: "invalid", laws: ["law-rent"] });
  expect(orders.find((o) => o.application === "rec.5")).toMatchObject({ finding: "valid" });
});

test("a law whose condition can't be read against an act doesn't bind it, and the reader says so: counted, and once in its reasons", () => {
  // A cap written against a field no notice of rent increase has (`data.increase_bps`): its condition gives an error,
  // not an answer. The 60-day law beside it reads cleanly, and binds as it always did.
  const cap = rec("law-cap", 0, { record: "statement", speaks_for: "outside", kind: "law", visible_to: "public", text: "Rent increases: no more than 4%.", adico: { attribute: "landlords", deontic: "must_not", aim: "increase a rent by more than 4%" },
    formal: { language: "cel", condition: "block.block == 'publish' && block.kind == 'rent_increase' && block.data.increase_bps > 400" } });
  const t0 = 400 * DAY;
  const short = notice("rec.1", t0 - 10 * DAY, t0 + 20 * DAY, t0 - 400 * DAY); // breaks the 60-day law
  const fine = notice("rec.2", t0 - 10 * DAY, t0 + 60 * DAY, t0 - 400 * DAY); // breaks none that can be read
  // (The reader's half of this case, `breaches` and the book's count of what it could not read, was the deleted TypeScript library's:
  // the engine's is covered by `a_prohibition_binds_an_act_it_is_true_of_and_says_when_it_cannot_be_read`, in kernel/crates/actors/src/common/tests.rs.)

  // Through a module: the tribunal's orders are what they were (invalid under the law that reads; valid otherwise), and
  // the reasons of its first act after weighing the cap say that the cap couldn't be read. Nowhere else.
  const m = member.create(ctx("tribunal-member-system", { hearing_after_days: 21 }));
  const a1 = apply("rec.3", t0, { kind: "rent_increase", against: "landlord-1", notice: "rec.1", evidence: short });
  const a2 = apply("rec.4", t0, { kind: "rent_increase", against: "landlord-1", notice: "rec.2", evidence: fine });
  const acts = (o: Observation) => {
    const out: any[] = [];
    for (let i = 0; i < 20; i++) {
      const a: any = m.step(o, undefined as any);
      if (a.type === "wait") break;
      out.push(a);
    }
    return out;
  };
  const listed = acts(obs(t0, [law, cap, a1, a2]));
  expect(listed.some((a) => /couldn't be read/.test(a.reasoning ?? ""))).toBe(false); // (nothing weighed yet)
  const heard = acts(obs(t0 + 21 * DAY, []));
  const orders = said(heard.map((a) => a.call).join("\n"), "tribunal_order");
  expect(orders.find((o) => o.application === "rec.3")).toMatchObject({ finding: "invalid", laws: ["law-rent"] });
  expect(orders.find((o) => o.application === "rec.4")).toMatchObject({ finding: "valid" });
  const noting = heard.filter((a) => /couldn't be read/.test(a.reasoning ?? ""));
  expect(noting.length).toBe(1);
  expect(noting[0]).toBe(heard[0]);
  expect(noting[0].reasoning).toMatch(/^The notice .*\(A law that can't be read against an act doesn't bind it: law-cap couldn't be read against publish rent_increase \(.+\), so it wasn't applied\.\)$/);
});

test("a debt is ordered paid, less what the respondent says it paid; unpaid once due, the debtor's bank is ordered to pay", () => {
  const m = member.create(ctx("tribunal-member-system", { hearing_after_days: 21, pay_within_days: 28 }));
  const t0 = 100 * DAY;
  const claim = { id: "rec.10", at: t0 - 40 * DAY, author: "c0001-self", record: "claim", position: "right", holder: "c0001", counterparty: "factory-1", speaks_for: "c0001", about: { kind: "debt", amount: "100000", for: "Unpaid wages." } };
  const a = apply("rec.11", t0, { kind: "debt", against: "factory-1", claim: "rec.10", amount: 100000, account: "acc-c0001", evidence: claim });
  run(m, obs(t0, [a]));
  const answer = rec("rec.12", t0 + 5 * DAY, { record: "statement", speaks_for: "factory-1", kind: "tribunal_response", addressed_to: ["tribunal"], basis: "rec.11", text: "We paid $400.", data: { paid: 40000 } });
  const heard = run(m, obs(t0 + 21 * DAY, [answer]));
  const due = t0 + 21 * DAY + 28 * DAY;
  expect(said(heard, "tribunal_order")[0]).toMatchObject({ finding: "pay", amount: 60000, due, to: "acc-c0001" });

  // The registrar: asked to enforce it once it's due (not before), it orders the bank to pay what's unpaid.
  const r = registrar.create(ctx("tribunal-registrar-system", { banks: ["bank"] }));
  const order = rec("rec.13", t0 + 21 * DAY, { record: "statement", speaks_for: "tribunal", kind: "tribunal_order", addressed_to: ["c0001", "factory-1"], basis: "rec.11", text: "Order.",
    data: { application: "rec.11", kind: "debt", applicant: "c0001", against: "factory-1", finding: "pay", claim: "rec.10", amount: 60000, to: "acc-c0001", due } });
  const ask = rec("rec.14", due - DAY, { record: "statement", speaks_for: "c0001", kind: "enforcement_request", addressed_to: ["tribunal"], basis: "rec.13", text: "Enforce.", data: { order: "rec.13", unpaid: 60000 } });
  expect(run(r, obs(due - DAY, [order, ask]))).toBe(""); // (not due yet)
  const enforced = run(r, obs(due, []));
  expect(said(enforced, "garnishee_order")[0]).toMatchObject({ debtor: "factory-1", amount: 60000, to: "acc-c0001", claim: "rec.10" });
});

test("possession: a tenant who answers that they have left has the application dismissed; an application its maker withdraws is decided by nobody", () => {
  const m = member.create(ctx("tribunal-member-system", { hearing_after_days: 21, hears: [{ about: "possession", can: ["order"] }], possession: { days: 14, plan_months: 6 } }));
  const t0 = 100 * DAY;
  const app = (id: string, tenant: string) => rec(id, t0, { record: "statement", speaks_for: "landlord-1", kind: "tribunal_application", addressed_to: ["tribunal"], text: "Application for possession.", data: { kind: "possession", matter: "possession", against: tenant, about: `lease-${tenant}`, amount: 300_000, space: `apts-1/${tenant}` } });
  const listed = run(m, obs(t0, [app("rec.1", "c0001"), app("rec.2", "c0002")]));
  const notices = said(listed, "hearing_notice");
  expect(notices.map((n) => n.application)).toEqual(["rec.1", "rec.2"]);
  // c0001 answers that they have gone; landlord-1 withdraws the application against c0002.
  const answer = rec("rec.5", t0 + 2 * DAY, { record: "statement", speaks_for: "c0001", kind: "tribunal_response", addressed_to: ["tribunal"], basis: "rec.1", text: "We left.", data: { application: "rec.1", left: true, left_at: t0 - DAY } });
  const withdrawal = rec("rec.6", t0 + 3 * DAY, { record: "withdrawal", withdraws: "rec.2", author: "landlord-1-office-system" });
  run(m, obs(t0 + 3 * DAY, [answer, withdrawal]));
  const decided = run(m, obs(t0 + 22 * DAY, []));
  const orders = said(decided, "tribunal_order");
  expect(orders).toHaveLength(1);
  expect(orders[0]).toMatchObject({ application: "rec.1", finding: "dismissed", left: true });
  expect(decided).toContain("there is nothing left to order");
});
