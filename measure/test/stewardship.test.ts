// The stewardship measures (measure/src/stewardship.ts) on a hand-made log: each family counts what its definition
// says, from the window on, with the state before the window carried in; a seat stewarded by code is counted as the
// code's holder and one stewarded by a model as a seat; a ledger saved at a fork and taken up again gives what one
// ledger reading the whole log gives.

import { expect, test } from "bun:test";
import { Ledger, STEWARDSHIP_MEASURES, type StewardOfPost } from "../src/stewardship";

const DAY = 86_400;

const config = {
  world: {
    entities: [
      { id: "city", kind: "government" }, { id: "tribunal", kind: "tribunal" }, { id: "shop-1", kind: "shop" },
      { id: "outside", kind: "boundary" }, { id: "vendors", kind: "boundary" }, { id: "p1", kind: "person" }, { id: "p2", kind: "person" },
    ],
    accounts: [
      { id: "acc-city", holder: "city" }, { id: "acc-shop", holder: "shop-1" }, { id: "acc-p1", holder: "p1" }, { id: "acc-p2", holder: "p2" },
      { id: "acc-vendors", holder: "vendors" }, { id: "acc-outside", holder: "outside" },
    ],
  },
  participants: [
    { id: "p1-self", kind: "person", person: "p1", controller: { type: "code", impl: "citizen.default" } },
    { id: "p2-self", kind: "person", person: "p2", controller: { type: "code", impl: "citizen.default" } },
    { id: "office-sys", kind: "system", owner: "outside", supplier: "outside", controller: { type: "code", impl: "world.transfers" } },
  ],
  positions: [
    { id: "clerk", entity: "city", holder: "p2-self" },
    { id: "support", entity: "outside", holder: "office-sys" },
    { id: "member", entity: "tribunal", holder: "p2-self" },
    { id: "shop-mgr", entity: "shop-1", holder: "p1-self" },
  ],
  templates: [{ id: "kiosk", kind: "system", supplier: "vendors" }],
};

let seq = 0;
/** The command that advances the world: every act applied in a log is caused by one, many acts by the same one. */
const ADVANCE = 9_999;
/** An act: its command, start, application, and the papers it recorded (applied and recorded under the advance's cause,
 * as the engine logs them). */
function act(t: number, participant: string, as: string | undefined, seconds: number, records: object[] = [], by?: string[]): object[] {
  const command = ++seq;
  const id = `act.${command}`;
  return [
    { kind: "command", seq: command, t, body: { command: "act", participant, ...(as ? { as } : {}), blocks: [] } },
    { kind: "event", seq: ++seq, t, body: { event: "action_started", cause: command, action: id, participant, ...(as ? { as } : {}), starts: t, done: t + seconds } },
    { kind: "event", seq: ++seq, t: t + seconds, body: { event: "action_applied", cause: ADVANCE, action: id, participant, ...(as ? { as } : {}), by: by ?? [participant] } },
    ...records.map((r) => ({ kind: "event", seq: ++seq, t: t + seconds, body: { event: "recorded", cause: ADVANCE, record: { record: "statement", at: t + seconds, ...r } } })),
  ];
}
const rec = (id: string, kind: string, author: string, speaks_for: string, to: string[] | "public", data: object = {}, basis?: string | string[]) =>
  ({ id, kind, author, speaks_for, ...(to === "public" ? { visible_to: "public" } : { addressed_to: to, visible_to: to }), data, ...(basis ? { basis } : {}) });
const transfer = (t: number, from: string, to: string, amount: number) => ({ kind: "event", seq: ++seq, t, body: { event: "transfer", cause: 0, from, to, amount: String(amount), reason: "payment" } });
const record = (t: number, participant: string, set: object) => ({ kind: "command", seq: ++seq, t, body: { command: "entity_record", participant, set } });

const FROM = 10 * DAY;
const institutions = { public: ["government", "tribunal"], firms: ["shop"] };
function log(): object[] {
  seq = 0;
  return [
    { kind: "header", seq: 0, t: 0, body: { config } },
    // ---- before the window: a refusal (not counted), p1 working the shop's post, a kiosk delivered to the shop, citizens' first records
    ...act(1 * DAY, "office-sys", "support", 100, [rec("rec.1", "benefit_decision", "office-sys", "outside", ["p1"], { granted: false })]),
    ...act(1 * DAY, "p1-self", "shop-mgr", 300),
    { kind: "event", seq: ++seq, t: 5 * DAY, body: { event: "participant_created", cause: 0, participant: "k1", kind: "system", owner: "shop-1", template: "kiosk" } },
    ...act(5 * DAY, "office-sys", "support", 10, [rec("rec.9", "system_delivery", "office-sys", "vendors", ["shop-1"], { systems: ["k1"], exit: 5000, fee_month: 100, notice_days: 90, task: "serve", vendor: "vendors" })]),
    record(2 * DAY, "p1-self", { agency: { now: 4000 }, trust: { in: [{ in: "city", bps: 5000 }] }, circumstances: { housed: 1 }, needs: { subsistence: 8000 } }),
    // ---- the window
    // a person decides (the clerk's rates notice to p1)
    ...act(11 * DAY, "p2-self", "clerk", 600, [rec("rec.2", "rates_notice", "p2-self", "city", ["p1"])]),
    // a system decides (a refusal to p2)
    ...act(12 * DAY, "office-sys", "support", 100, [rec("rec.3", "benefit_decision", "office-sys", "outside", ["p2"], { granted: false })]),
    // a person puts a case before the office (to the office, not a decision about a person), and the system decides on it
    ...act(12 * DAY, "p2-self", "clerk", 600, [rec("rec.4", "case_for_decision", "p2-self", "city", ["outside"])]),
    ...act(12 * DAY, "office-sys", "support", 100, [rec("rec.5", "benefit_decision", "office-sys", "outside", ["p1"], { granted: true }, "rec.4")]),
    // p2 asks for a review of rec.3; the office changes it two days later
    ...act(13 * DAY, "p2-self", undefined, 60, [rec("rec.6", "review_request", "p2-self", "p2", ["outside"], { about: "rec.3", matter: "claim_refused" })]),
    ...act(15 * DAY, "office-sys", "support", 100, [rec("rec.7", "decision_review", "office-sys", "outside", ["p2"], { decision: "rec.3", request: "rec.6", outcome: "changed" }, "rec.3")]),
    // p2 applies to the tribunal; the member (a person) sets aside the office's paper rec.3
    ...act(16 * DAY, "p2-self", undefined, 60, [rec("rec.10", "tribunal_application", "p2-self", "p2", ["tribunal"], { matter: "claim_refused", about: "rec.3" })]),
    ...act(30 * DAY, "p2-self", "member", 600, [rec("rec.8", "tribunal_order", "p2-self", "tribunal", ["p2", "outside"], { applicant: "p2", against: "outside", finding: "set_aside", about: "rec.3", waited_days: 14 })]),
    // a petition, taken up by a proposal citing it
    ...act(17 * DAY, "p1-self", undefined, 60, [rec("rec.11", "petition", "p1-self", "p1", "public", { demand: {} })]),
    ...act(18 * DAY, "p2-self", "clerk", 60, [rec("rec.12", "proposal", "p2-self", "city", ["city"], {}, "rec.11")]),
    // the kiosk works the shop's post for an hour
    ...act(20 * DAY, "k1", "shop-mgr", 3600, [], ["k1"]),
    // money
    transfer(21 * DAY, "acc-p1", "acc-city", 1000), transfer(21 * DAY, "acc-outside", "acc-city", 3000),
    transfer(21 * DAY, "acc-shop", "acc-p1", 500), transfer(21 * DAY, "acc-shop", "acc-outside", 1200), transfer(21 * DAY, "acc-shop", "acc-vendors", 300),
    transfer(21 * DAY, "acc-p2", "acc-shop", 800), transfer(21 * DAY, "acc-outside", "acc-shop", 200),
    transfer(22 * DAY, "acc-outside", "acc-p2", 700),
    // citizens' records in the window
    record(25 * DAY, "p1-self", { agency: { now: 3000 }, trust: { in: [{ in: "city", bps: 4000 }] }, circumstances: { housed: 0 }, needs: { subsistence: 2000 } }),
    record(25 * DAY, "p2-self", { agency: { now: 6000 }, trust: { in: [{ in: "city", bps: 7000 }, { in: "tribunal", bps: 6000 }] }, circumstances: { housed: 1 }, needs: { subsistence: 9000 } }),
    { kind: "event", seq: ++seq, t: 26 * DAY, body: { event: "vacated", cause: 0, occupant: "p1", space: "h/1", reason: "removed", by: "x" } },
  ];
}

function run(steward?: StewardOfPost, entries = log()) {
  const l = new Ledger({ from: FROM, institutions, ...(steward ? { steward } : {}) });
  for (const e of entries) l.see(e);
  return l.result();
}

test("every measure in the catalogue is given, and only those", () => {
  const r = run();
  expect(Object.keys(r.measures).sort()).toEqual(STEWARDSHIP_MEASURES.map((m) => m.name).sort());
});

test("leverage: who did each decision about a person, and whether a person's paper stands behind it", () => {
  const m = run().measures;
  // In the window, decisions to people: rec.2 (person), rec.3 (system), rec.5 (system, on a person's case), rec.7 (the
  // review, system), rec.8 (the tribunal's order, person). rec.1 is before the window.
  expect(m.decisions).toBe(5);
  expect(m.decided_by_person_share).toBeCloseTo(2 / 5);
  expect(m.decided_by_system_share).toBeCloseTo(3 / 5);
  expect(m.decided_by_seat_share).toBe(0);
  expect(m.reviewed_by_person_share).toBeCloseTo(1 / 3);
  expect(m.human_in_decision_share).toBeCloseTo(3 / 5);
});

test("a seat stewarded by code counts as the code's holder; by a model, as a seat; nobody never decides", () => {
  expect(run({ seat: "office-sys", kind: "code" }).measures.decided_by_system_share).toBeCloseTo(3 / 5);
  const model = run({ seat: "office-sys", kind: "model" }).measures;
  expect([model.decided_by_seat_share, model.decided_by_system_share]).toEqual([3 / 5, 0]);
  expect(model.papers_to_people_by_seat_share).toBeCloseTo(3 / 5);
  const l = new Ledger({ config, steward: { seat: "office-sys", kind: "none" } });
  expect(l.deciderOf("office-sys")).toBe("nobody");
  expect(l.deciderOf("p1-self")).toBe("person");
});

test("responsiveness and recourse: reviews, appeals, petitions, and how long each took", () => {
  const m = run().measures;
  expect([m.reviews_asked, m.reviews_decided, m.review_changed_share, m.review_days_mean]).toEqual([1, 1, 1, 2 + 40 / DAY]);
  expect([m.appeals_made, m.appeals_decided, m.appeal_found_for_share, m.office_decisions_set_aside, m.appeal_days_mean]).toEqual([1, 1, 1, 1, 14]);
  expect(m.slips_caught).toBe(2);
  expect([m.petitions, m.petitions_taken_up_share]).toEqual([1, 1]);
  expect([m.strikes, m.strike_settled_rise_bps]).toEqual([0, null]);
});

test("dependence: whose money the town and its firms run on, and who did the offices' work", () => {
  const m = run().measures;
  expect(m.public_revenue_from_residents_share).toBeCloseTo(1000 / 4000);
  expect(m.firm_costs_to_residents_share).toBeCloseTo(500 / 2000);
  expect(m.firm_sales_from_residents_share).toBeCloseTo(800 / 1000);
  expect(m.vendor_fees).toBe(300);
  // Without the experiment saying which kinds are public bodies and firms, those shares are not given.
  const none = new Ledger({ from: FROM });
  for (const e of log()) none.see(e);
  expect(none.result().measures.public_revenue_from_residents_share).toBeNull();
  // in organisations' posts in the window: people 600 + 600 + 60 + 600 s; systems 100 + 100 + 100 + 3600 s
  expect(m.office_work_by_people_share).toBeCloseTo(1860 / (1860 + 3900));
});

test("reversibility and concentration: a system delivered before the window is still in use in it", () => {
  const m = run().measures;
  expect([m.systems_in_use, m.exit_cost, m.system_fees_per_month, m.notice_days_longest]).toEqual([1, 5000, 100, 90]);
  expect(m.system_hours_last_30_days).toBeCloseTo(1);
  expect(m.former_staff_still_here).toBe(1);
  // systems' hours in posts: the office's (from outside) 300 s, the kiosk's (from the vendors, outside too) 3600 s
  expect(m.system_work_hours).toBeCloseTo(3900 / 3600);
  expect(m.system_work_hhi).toBe(Math.round(((300 / 3900) ** 2 + (3600 / 3900) ** 2) * 10_000));
  expect(m.system_work_outside_share).toBe(1);
});

test("an ended licence is no longer in use", () => {
  const ended = [...log(), ...act(27 * DAY, "office-sys", "support", 10, [rec("rec.20", "system_ended", "office-sys", "vendors", ["shop-1"], { systems: ["k1"], why: "ended" })])];
  const m = run(undefined, ended).measures;
  expect([m.systems_in_use, m.exit_cost, m.former_staff_still_here]).toEqual([0, 0, 0]);
});

test("welfare and trust: hardship counted, and citizens' own records read at both ends of the window", () => {
  const m = run().measures;
  expect([m.support_refused, m.support_granted, m.removals, m.possession_orders]).toEqual([1, 1, 1, 0]);
  expect(m.unhoused_share).toBeCloseTo(1 / 2);
  expect(m.subsistence_short_share).toBeCloseTo(1 / 2);
  expect(m.agency_mean_bps).toBe(4500);
  // p1: 4000 at the window's start, 3000 at its end; p2: first recorded in the window (6000 then 6000)
  expect(m.agency_change_bps).toBe(-500);
  expect(m.trust_mean_bps).toBeCloseTo((4000 + 7000 + 6000) / 3);
  expect(m.trust_change_bps).toBe((4000 - 5000 + 0 + 0) / 3);
});

test("a ledger saved at the fork and taken up again gives what one ledger of the whole log gives", () => {
  const entries = log();
  const whole = run({ seat: "office-sys", kind: "model" }, entries);
  const before = new Ledger({ from: FROM, institutions, steward: { seat: "office-sys", kind: "code" } });
  const i = entries.findIndex((e: any) => e.t >= FROM && e.kind !== "header");
  for (const e of entries.slice(0, i)) before.see(e);
  const after = Ledger.restore(JSON.parse(JSON.stringify(before.save())), { from: FROM, steward: { seat: "office-sys", kind: "model" } });
  for (const e of entries.slice(i)) after.see(e);
  expect(after.result()).toEqual(whole);
});
