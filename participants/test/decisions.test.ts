// What a decision waits for, and a decision looked at again (docs/behaviour/decisions.md; foundations F8): the law's routes as data, an office that
// asks for what a claim needs and decides when it has come (or its days have run), looks at its own refusal again when asked inside the law's days
// and says what it found, and puts right what was wrong; a venue that hears an appeal reads the days the law gives for it.
import { expect, test } from "bun:test";
import { inCurrency } from "../src/money";
import { transfers } from "../src/behaviour/world";
import { planningOfficer } from "../src/behaviour/institutions";
import { Hearings } from "../src/behaviour/desk";
import { Book } from "../src/behaviour/common";
import { decisionLaw, decisionsInWords, type DecisionLaw } from "../src/behaviour/decisions";
import type { PaymentRule } from "../src/behaviour/payments";
import { context, DAY, statement, wake } from "./stepping";

inCurrency({ code: "XTS", minor_units: 2 });
const YEAR = 365 * DAY;
const pension: PaymentRule = { id: "pension", payer: "outside", account: "acc-o", every_days: 14, who: { from_age: 67 }, amount: { flat: 50_000 } };
const jobseeker: PaymentRule = { id: "jobseeker", payer: "outside", account: "acc-o", every_days: 14, who: { from_age: 22, out_of_work: true }, amount: { flat: 30_000 } };
const supportLaw = statement("law-support", 0, "law", { speaks_for: "outside", data: { support: "payments", payments: [pension, jobseeker] } });
const decisionsLaw = (rules: DecisionLaw[]) => statement("law-decisions", 0, "law", { speaks_for: "outside", data: { decisions: rules } });
const PENSION_ROUTE: DecisionLaw = { kind: "benefit_decision", name: "a decision on a claim", payments: ["pension"], refused_by: "office-holder",
  needs: [{ id: "papers", from: "claimant", what: "proof of who you are", within_days: 14, else: "refuse" }],
  review: { within_days: 30, grounds: "any", required: true }, appeal: { matter: "claim_refused", within_days: 20, grounds: "any error" } };
const claim = (id: string, at: number, who: string, payment = "pension", born = at - 70 * YEAR) =>
  statement(id, at, "benefit_claim", { speaks_for: who, addressed_to: ["outside"], visible_to: [who, "outside"], data: { payment, account: `acc-${who}`, born_at: born } });
const office = (laws: any[], o: { slip?: number; part?: string } = {}) => {
  const c: any = context("outside-support-system", "outside", { account: "acc-o", ...(o.part ? { part: o.part } : {}) });
  if (o.slip !== undefined) c.world = { ...c.world, dials: { friction_bps: 10_000 }, slip: { person: { "publish/benefit_decision": { bps: o.slip, friction: true } } } };
  const m = transfers.create(c);
  const ids = { n: 0 };
  const records: any[] = [supportLaw, ...laws];
  const everything: any[] = [];
  return {
    at: (t: number, more: any[] = []) => {
      const w = wake(m, t, { book: { kind: "records", records: [...records.splice(0), ...more] } }, { entity: "outside", ids, as: { participant: "outside-support-system" } });
      records.push(...w.made);
      everything.push(...w.made);
      return w;
    },
    seen: everything,
  };
};
const kinds = (w: ReturnType<typeof wake>, k: string) => w.of("statement", k).map((c) => c.args.data);

test("the law is read from the published record: the rule for a payment before the rule for the kind, and none where none is stated", () => {
  const b = new Book();
  b.absorb({ t: 0, entity: "x", participant: "x", channels: { laws: { kind: "records", records: [decisionsLaw([PENSION_ROUTE, { kind: "benefit_decision", name: "other", review: { within_days: 7, grounds: "x" } }]) as any] } }, inbox: [], outcomes: [], woke_for: "cadence" } as any);
  expect(decisionLaw(b, "benefit_decision", "pension")?.review?.within_days).toBe(30);
  expect(decisionLaw(b, "benefit_decision", "jobseeker")?.review?.within_days).toBe(7);
  expect(decisionLaw(b, "permit_decision")).toBeUndefined();
  expect(decisionsInWords([PENSION_ROUTE], (n) => `${n}`)).toContain("within 20 days");
});

test("a claim waits for the papers the law asks of the claimant: they are asked for once, and the claim is decided at the round after they come", () => {
  const o = office([decisionsLaw([PENSION_ROUTE])]);
  const first = o.at(0, [claim("c1", 0, "a")]);
  expect(first.of("statement", "benefit_decision")).toEqual([]);
  expect(kinds(first, "evidence_request")).toMatchObject([{ claim: "c1", need: "papers", by: 14 * DAY }]);
  // Nothing more is asked, and nothing is decided, while the days run.
  const second = o.at(5 * DAY);
  expect(second.of("statement", "evidence_request")).toEqual([]);
  expect(second.of("statement", "benefit_decision")).toEqual([]);
  const req = o.seen.find((r) => r.kind === "evidence_request")!;
  const third = o.at(6 * DAY, [statement("e1", 6 * DAY, "evidence", { speaks_for: "a", addressed_to: ["outside"], visible_to: ["a", "outside"], data: { claim: "c1", need: "papers", request: req.id } })]);
  expect(kinds(third, "benefit_decision")).toMatchObject([{ claim: "c1", granted: true, amount: 50_000 }]);
});

test("papers that do not come within the law's days: the claim is refused and says why; where the law says decide, it is decided without", () => {
  const o = office([decisionsLaw([PENSION_ROUTE])]);
  o.at(0, [claim("c1", 0, "a")]);
  expect(o.at(13 * DAY).of("statement", "benefit_decision")).toEqual([]);
  expect(kinds(o.at(14 * DAY), "benefit_decision")).toMatchObject([{ claim: "c1", granted: false, reason: expect.stringContaining("papers asked for did not come within 14 days") }]);
  const lax: DecisionLaw = { ...PENSION_ROUTE, needs: [{ id: "papers", from: "claimant", what: "proof", within_days: 3, else: "decide" }] };
  const d = office([decisionsLaw([lax])]);
  d.at(0, [claim("c1", 0, "a")]);
  expect(kinds(d.at(3 * DAY), "benefit_decision")).toMatchObject([{ claim: "c1", granted: true }]);
});

test("a confirmation from the claimant's last employer is asked for from the pay reports on file, and waited for; no employer on file, nothing to wait for", () => {
  const rule: DecisionLaw = { kind: "benefit_decision", name: "x", payments: ["jobseeker"], needs: [{ id: "employer", from: "employer", what: "that the job has ended", within_days: 10, else: "decide" }] };
  const report = statement("w1", 0, "withholding_report", { speaks_for: "shop", addressed_to: ["outside"], visible_to: ["shop", "outside"], data: { staff: [{ worker: "a", gross: 100_000 }] } });
  const o = office([decisionsLaw([rule]), report]);
  const first = o.at(DAY, [claim("c1", DAY, "a", "jobseeker", -30 * YEAR)]);
  expect(first.of("statement", "benefit_decision")).toEqual([]);
  expect(first.of("statement", "confirmation_request").map((c) => ({ to: c.args.to, ...c.args.data }))).toMatchObject([{ to: ["shop"], claim: "c1", need: "employer", about: "a" }]);
  const req = o.seen.find((r) => r.kind === "confirmation_request")!;
  const answer = statement("k1", 2 * DAY, "confirmation_answer", { speaks_for: "shop", addressed_to: ["outside"], visible_to: ["shop", "outside"], data: { claim: "c1", need: "employer", request: req.id, subject: "a", employed: false, known: true } });
  expect(kinds(o.at(2 * DAY, [answer]), "benefit_decision")).toMatchObject([{ claim: "c1" }]);
  // Nobody reported pay for this claimant: there is no one to ask.
  const none = office([decisionsLaw([rule])]);
  const w = none.at(DAY, [claim("c2", DAY, "b", "jobseeker", -30 * YEAR)]);
  expect(w.of("statement", "confirmation_request")).toEqual([]);
  expect(kinds(w, "benefit_decision")).toMatchObject([{ claim: "c2" }]);
});

test("a refusal asked about inside the law's days is looked at again: found wrong, it is put right by the office, with a record of the review and an answer; asked for after the days, no", () => {
  const route: DecisionLaw = { ...PENSION_ROUTE, needs: [] };
  const o = office([decisionsLaw([route])], { slip: 10_000 });
  const first = o.at(0, [claim("c1", 0, "a")]);
  expect(kinds(first, "benefit_decision")).toMatchObject([{ claim: "c1", granted: false, reason: "the claim could not be verified" }]);
  const dec = o.seen.find((r) => r.kind === "benefit_decision")!;
  const ask = (id: string, at: number) => statement(id, at, "review_request", { speaks_for: "a", addressed_to: ["outside"], visible_to: ["a", "outside"], data: { matter: "claim_refused", against: "outside", about: dec.id, seeks: "pension" } });
  const w = o.at(4 * DAY, [ask("q1", 4 * DAY)]);
  expect(kinds(w, "decision_review")).toMatchObject([{ decision: dec.id, outcome: "changed", asked_by: "a" }]);
  expect(kinds(w, "remedy_answer")).toMatchObject([{ granted: true, review: "changed", matter: "claim_refused" }]);
  expect(kinds(w, "benefit_decision")).toMatchObject([{ claim: "c1", granted: true, amount: 50_000, on_review: "q1", replaces: dec.id }]);
  // It pays from then.
  expect(o.at(4 * DAY + 14 * DAY).of("money").length).toBe(1);
  // A second request on the same decision is answered from the first.
  const again = o.at(6 * DAY, [ask("q2", 6 * DAY)]);
  expect(kinds(again, "decision_review")).toMatchObject([{ outcome: "changed", found: "it has been looked at already" }]);
  expect(kinds(again, "benefit_decision")).toEqual([]);
  // After the days the law gives, the answer is no, and says so; the decision is not looked at.
  const late = office([decisionsLaw([route])], { slip: 10_000 });
  late.at(0, [claim("c1", 0, "a")]);
  const dec2 = late.seen.find((r) => r.kind === "benefit_decision")!;
  const l = late.at(31 * DAY, [statement("q3", 31 * DAY, "review_request", { speaks_for: "a", addressed_to: ["outside"], visible_to: ["a", "outside"], data: { matter: "claim_refused", about: dec2.id } })]);
  expect(kinds(l, "decision_review")).toMatchObject([{ outcome: "out_of_time" }]);
  expect(kinds(l, "remedy_answer")).toMatchObject([{ granted: false }]);
  expect(kinds(l, "benefit_decision")).toEqual([]);
});

test("a refusal found right stands: the office says so, and puts nothing right", () => {
  const route: DecisionLaw = { ...PENSION_ROUTE, needs: [] };
  const o = office([decisionsLaw([route])]);
  const young = claim("c3", 0, "b", "pension", -30 * YEAR);
  o.at(0, [young]);
  const dec = o.seen.find((r) => r.kind === "benefit_decision")!;
  const w = o.at(DAY, [statement("q", DAY, "review_request", { speaks_for: "b", addressed_to: ["outside"], visible_to: ["b", "outside"], data: { matter: "claim_refused", about: dec.id } })]);
  expect(kinds(w, "decision_review")).toMatchObject([{ outcome: "upheld" }]);
  expect(kinds(w, "remedy_answer")).toMatchObject([{ granted: false, review: "upheld" }]);
  expect(kinds(w, "benefit_decision")).toEqual([]);
});

test("a request about a decision of a kind whose law has no review is not looked at again by the office", () => {
  const route: DecisionLaw = { ...PENSION_ROUTE, needs: [], review: undefined };
  const o = office([decisionsLaw([route])]);
  o.at(0, [claim("c3", 0, "b", "pension", -30 * YEAR)]);
  const dec = o.seen.find((r) => r.kind === "benefit_decision")!;
  const w = o.at(DAY, [statement("q", DAY, "review_request", { speaks_for: "b", addressed_to: ["outside"], visible_to: ["b", "outside"], data: { matter: "claim_refused", about: dec.id } })]);
  expect(w.of("statement", "decision_review")).toEqual([]);
  expect(w.of("statement", "remedy_answer")).toEqual([]);
});

test("where the law says the staff may refuse, they refuse; where the head alone does, they put it before the head (the office's procedure says who, not the code)", () => {
  const young = claim("c3", 0, "b", "pension", -30 * YEAR);
  const order = statement("wo1", 0, "work_order", { speaks_for: "outside", in_position: "support", data: { work: { task: "pay_claims", at: "support" }, every: DAY } });
  const head = office([decisionsLaw([{ ...PENSION_ROUTE, needs: [] }]), order], { part: "staff" });
  const h = head.at(0, [young]);
  expect(h.of("statement", "case_for_decision").length).toBe(1);
  expect(h.of("statement", "benefit_decision")).toEqual([]);
  const staff = office([decisionsLaw([{ ...PENSION_ROUTE, needs: [], refused_by: "staff" }]), order], { part: "staff" });
  const s = staff.at(0, [young]);
  expect(s.of("statement", "case_for_decision")).toEqual([]);
  expect(kinds(s, "benefit_decision")).toMatchObject([{ claim: "c3", granted: false }]);
});

test("the planning office looks at a refusal again when asked inside the law's days; a permit it would now grant is granted, with the liberty to build", () => {
  const c: any = context("planning-system", "city", {});
  const m = planningOfficer.create(c);
  const ids = { n: 0 };
  const law = decisionsLaw([{ kind: "permit_decision", name: "a planning permit", review: { within_days: 30, grounds: "any" } }]);
  const app = statement("app1", 0, "permit_application", { speaks_for: "builder", addressed_to: ["city"], visible_to: ["builder", "city"], data: { lot: "lot.1", structure_type: "park" } });
  const records: any[] = [law, app];
  const made: any[] = [];
  const at = (t: number, more: any[] = []) => { const w = wake(m, t, { book: { kind: "records", records: [...records.splice(0), ...more] } }, { entity: "city", ids, as: { participant: "planning-system" } }); records.push(...w.made); made.push(...w.made); return w; };
  const first = at(0);
  expect(kinds(first, "permit_decision")).toMatchObject([{ application: "app1", decision: "granted" }]);
  // A refusal on file (made earlier, for a law since repealed): asked about, it is granted on the second look.
  const refusal = statement("ref1", 0, "permit_decision", { speaks_for: "city", addressed_to: ["builder"], visible_to: ["builder", "city"], data: { application: "app1", decision: "refused", law: "law-gone" } });
  const w = at(DAY, [refusal, statement("rq", DAY, "review_request", { speaks_for: "builder", addressed_to: ["city"], visible_to: ["builder", "city"], data: { matter: "permit_refused", about: "ref1" } })]);
  expect(kinds(w, "decision_review")).toMatchObject([{ decision: "ref1", outcome: "changed" }]);
  expect(kinds(w, "permit_decision")).toMatchObject([{ decision: "granted", on_review: "rq", replaces: "ref1" }]);
  expect(w.of("claim").length).toBe(1);
});

test("a venue that hears an appeal reads the days the law gives for it: out of time is rejected, with the days; a review required first must have been answered", () => {
  const venue = "tribunal";
  const hears = [{ about: "claim_refused", can: ["order"] as ("order")[], undoes: true }];
  const mk = () => {
    const book = new Book();
    const h = new Hearings(venue, { rng: () => ({ below: () => 0 }) as any, world: {} } as any, { hears, answer_days: 14, within_days: 28, refer_to: {} });
    return { book, h };
  };
  const law = decisionsLaw([PENSION_ROUTE]);
  const app = (id: string, at: number, data: object) => statement(id, at, "application", { speaks_for: "a", addressed_to: [venue], visible_to: ["a", venue], data: { kind: "claim_refused", matter: "claim_refused", against: "outside", about: "rec.1", ...data } });
  const run = (records: any[], t: number) => {
    const { book, h } = mk();
    book.absorb({ t, entity: venue, participant: "t", channels: { b: { kind: "records", records: [law, ...records] } }, inbox: [], outcomes: [], woke_for: "cadence" } as any);
    return h.steps(book, t).map((s: any) => s);
  };
  const said = (steps: any[]) => JSON.stringify(steps);
  // The review required first: an appeal without an answer to it is turned away.
  expect(said(run([app("p1", 40 * DAY, { decided_on: 0 })], 40 * DAY))).toContain("looked at again by the office");
  // With the answer, inside the 20 days: heard (a notice to the other side goes).
  expect(said(run([app("p2", 40 * DAY, { decided_on: 0, reviewed_on: 30 * DAY })], 40 * DAY))).toContain("complaint_notice");
  // After them: out of time.
  const late = said(run([app("p3", 60 * DAY, { decided_on: 0, reviewed_on: 30 * DAY })], 60 * DAY));
  expect(late).toContain("within 20 days");
  expect(late).not.toContain("complaint_notice");
});
