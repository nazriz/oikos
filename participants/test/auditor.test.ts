// The audit office (docs/behaviour/auditor.md) as a module: what it asks, of whom, when; what a new holder of its post does with the office's papers; and what an
// audited body answers, and to whom. Laws of no place.
import { expect, test } from "bun:test";
// (The papers the office runs on, as the deleted TypeScript module named them.)
const KIND = { request: "audit_request", answer: "audit_answer", finding: "audit_finding", report: "audit_report" } as const;
import { inCurrency } from "../src/money";
import { context, DAY, statement, wake } from "./stepping";
import { engine } from "./engine";
const auditor = engine("office.auditor");

inCurrency({ code: "XTS", minor_units: 2 });
const law = statement("law-audit", 0, "law", { speaks_for: "outside", data: { audit: { auditor: "auditor", office: "the audit office", answer_within_days: 28, report_within_days: 120,
  bodies: [{ body: "support", entity: "outside", every_days: 90, checks: ["decisions"], kind: "benefit_decision", sample: { share_bps: 1_500, least: 6, most: 25 } }] } } });
const fresh = () => auditor.create(context("auditor-officer-system", "auditor", {}));
const as = { participant: "auditor-officer-system", position: "auditor-officer" };
const at = (m: any, t: number, records: object[]) => wake(m, t, { book: { kind: "records", records } }, { entity: "auditor", as });
const own = (id: string, at: number, kind: string, data: object, visible: "public" | string[] = "public") => statement(id, at, kind, { speaks_for: "auditor", visible_to: visible, data });
const answer = (id: string, at: number, data: object) => statement(id, at, KIND.answer, { speaks_for: "outside", addressed_to: ["auditor"], visible_to: ["auditor", "outside"], data });
const KEY = "support|decisions|1";

test("after a period it asks the body for the count of its decisions, in public and of no organisation's posts, and nothing before the period ends", () => {
  expect(at(fresh(), 89 * DAY, [law]).of("statement")).toEqual([]);
  const w = at(fresh(), 91 * DAY, [law]);
  const asked = w.of("statement", KIND.request);
  expect(asked.length).toBe(1);
  expect(asked[0]!.args.visible).toBe("public");
  expect(asked[0]!.args.to).toBeUndefined();
  expect(asked[0]!.args.data).toMatchObject({ audit: KEY, ask: "count", kind: "benefit_decision", from: 0, to: 90 * DAY, answer_by: 91 * DAY + 28 * DAY });
});

test("given the count it draws the numbers once, each different, and asks for each decision by its number; asked twice, on the same papers, it asks the same", () => {
  const records = [law, own("r1", 91 * DAY, KIND.request, { audit: KEY, ask: "count", kind: "benefit_decision", from: 0, to: 90 * DAY, answer_by: 119 * DAY }), answer("a1", 91.1 * DAY, { request: "r1", audit: KEY, ask: "count", count: 51 })];
  const asks = (m: any) => at(m, 92 * DAY, records).of("statement", KIND.request).map((c) => c.args.data.nth);
  const a = asks(fresh()), b = asks(fresh());
  expect(a.length).toBe(8); // (15% of 51, rounded up)
  expect(new Set(a).size).toBe(8);
  expect(a.every((n: number) => n >= 1 && n <= 51)).toBe(true);
  expect(b).toEqual(a);
});

test("a new holder of the post, shown the office's papers, does not begin an audit again that was reported, nor ask again for what it asked", () => {
  const begun = [law, own("r1", 91 * DAY, KIND.request, { audit: KEY, ask: "count", kind: "benefit_decision", from: 0, to: 90 * DAY, answer_by: 119 * DAY })];
  // asked for the count and no answer yet: nothing new is asked
  expect(at(fresh(), 95 * DAY, begun).of("statement", KIND.request)).toEqual([]);
  // reported: nothing is begun again, whenever the new holder comes
  const reported = [...begun, own("rep", 93 * DAY, KIND.report, { audit: KEY, body: "outside", check: "decisions", period: 1 })];
  expect(at(fresh(), 300 * DAY, reported).of("statement", KIND.request).map((c) => c.args.data.audit)).not.toContain(KEY);
  // the second period begins, once
  expect(at(fresh(), 300 * DAY, reported).of("statement", KIND.request).map((c) => c.args.data.audit)).toContain("support|decisions|2");
});

test("it reports only when every number asked has been answered or its days have run out, and reports what was not answered", () => {
  const asked = [1, 2, 3].map((n) => own(`n${n}`, 91.2 * DAY, KIND.request, { audit: KEY, ask: "nth", nth: n, kind: "benefit_decision", from: 0, to: 90 * DAY, answer_by: 119 * DAY }));
  const base = [law, own("r1", 91 * DAY, KIND.request, { audit: KEY, ask: "count", from: 0, to: 90 * DAY, answer_by: 119 * DAY }), answer("a1", 91.1 * DAY, { request: "r1", audit: KEY, ask: "count", count: 3 }), ...asked];
  // nothing answered, days not run out: no report
  expect(at(fresh(), 100 * DAY, base).of("statement", KIND.report)).toEqual([]);
  // days run out with nothing answered: a report that says so
  const late = at(fresh(), 125 * DAY, base).of("statement", KIND.report);
  expect(late.length).toBe(1);
  expect(late[0]!.args.data).toMatchObject({ audit: KEY, population: 3, sample: 3, not_answered: 3, agreed: 0, not_agreed: 0 });
  expect(late[0]!.args.visible).toBe("public");
});

// (The case "a body answers the auditor the law names, once, for the thing asked, and nobody else" exercised the deleted TypeScript
// `Audited` class as a library; the engine's own test of it is `an_audited_body_answers_what_is_asked_once_from_its_own_books_and_nothing_else`
// in kernel/crates/actors/src/offices/auditor.rs.)
