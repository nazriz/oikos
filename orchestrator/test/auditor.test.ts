// The auditor (docs/behaviour/auditor.md; docs/design/foundations.md, B9): an office of the town that examines other bodies' accounts and decisions as the
// place's law says, on a sample, with staff and time like any office, and publishes a report. These tests hold: the sampling and the examination as
// functions; the town it makes (a body, its staff, its grant, its law, from the profile); a scenario in which the support office's procedure differs from
// the law and the auditor finds it; that an auditor short of hours reports late; that it knows what it examines only the four ways; and that nothing
// follows from a finding by itself.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { loadProfile } from "@oikos/worlds/generator/profile";
import { Book } from "../../participants/src/behaviour/common";
import { drawSample, examineDecision, reconcile, sampleSize, type DecisionFile } from "../../participants/src/behaviour/auditor";
import type { PaymentRule } from "../../participants/src/behaviour/payments";
import { Rng } from "../../participants/src/rng";
import { inCurrency } from "../../participants/src/money";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const base = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

// ---- the functions

test("a sample is the law's share of the period's decisions, no fewer than the least, no more than the most, never more than there are", () => {
  const s = { share_bps: 1_500, least: 6, most: 25 };
  expect(sampleSize(0, s)).toBe(0);
  expect(sampleSize(4, s)).toBe(4);
  expect(sampleSize(20, s)).toBe(6);
  expect(sampleSize(100, s)).toBe(15);
  expect(sampleSize(1_000, s)).toBe(25);
});

test("the numbers drawn are distinct, in range, and the same whenever they are drawn", () => {
  const stream = (key: string) => {
    // (A stream is named, as the kernel's are: the same name gives the same numbers.)
    const r = new Rng([BigInt(key.length) + 1n, 2n, 3n, 5n]);
    return { below: (n: number) => r.below(n) };
  };
  for (const [n, k] of [[51, 8], [10, 10], [200, 25], [3, 1], [1, 1]] as const) {
    const a = drawSample(stream("a"), n, k), b = drawSample(stream("a"), n, k);
    expect(a).toEqual(b);
    expect(a.length).toBe(k);
    expect(new Set(a).size).toBe(k);
    expect(a.every((x) => Number.isInteger(x) && x >= 1 && x <= n)).toBe(true);
    expect([...a].sort((x, y) => x - y)).toEqual(a);
  }
});

const rule: PaymentRule = { id: "pension", payer: "outside", account: "acc-outside", every_days: 14, who: { from_age: 67 }, amount: { flat: 50_000 } };
const file = (o: { born_years_ago: number; granted: boolean; amount?: number; lapsed?: boolean }): DecisionFile => {
  const on = 400 * DAY, year = 365 * DAY;
  return {
    decision: { id: "rec.1", at: on + 60, on, granted: o.granted, ...(o.amount !== undefined ? { amount: o.amount, every: 14 * DAY } : {}), ...(o.granted ? {} : { reason: "the claim could not be verified" }), ...(o.lapsed ? { lapsed: true } : {}) },
    claim: { id: "rec.0", by: "c0001", payment: "pension", born_at: on - o.born_years_ago * year, account: "acc-c0001", declares: {} }, reported: [], pays_other: false,
  };
};

test("a decision is decided again from the file under the law's rule: it agrees or it does not, and nothing is called good or bad", () => {
  inCurrency((generate({ ...base, citizens: 50, profile: "au-vic-2026" }) as any).world.currencies[0]);
  const book = new Book();
  const year = 365 * DAY;
  expect(examineDecision(file({ born_years_ago: 70, granted: true, amount: 50_000 }), rule, book, year)).toMatchObject({ agrees: true });
  expect(examineDecision(file({ born_years_ago: 40, granted: false }), rule, book, year)).toMatchObject({ agrees: true });
  // refused though the claim meets the law's conditions (the wrong refusal a slip makes)
  const wrongRefusal = examineDecision(file({ born_years_ago: 70, granted: false }), rule, book, year);
  expect(wrongRefusal.agrees).toBe(false);
  expect(wrongRefusal.says).toContain("meets the conditions the law states");
  // granted though it does not
  expect(examineDecision(file({ born_years_ago: 40, granted: true, amount: 50_000 }), rule, book, year)).toMatchObject({ agrees: false });
  // granted at another sum than the rule gives
  expect(examineDecision(file({ born_years_ago: 70, granted: true, amount: 40_000 }), rule, book, year).says).toContain("the law's rule for the payment gives");
  // a refusal for papers that did not come is the procedure's wait, not the payment's conditions: not re-decided; no law on file: not re-decided
  expect(examineDecision(file({ born_years_ago: 70, granted: false, lapsed: true }), rule, book, year).agrees).toBeNull();
  expect(examineDecision(file({ born_years_ago: 70, granted: true, amount: 50_000 }), undefined, book, year).agrees).toBeNull();
  for (const f of [wrongRefusal]) expect(f.says).not.toMatch(/\b(good|bad|fault|wrong)\b/);
});

test("accounts reconcile when each payment in the books is in the bank's record at the same sum", () => {
  const s = { books: [{ id: "i1", amount: 100, at: 10 * DAY }, { id: "i2", amount: 200, at: 20 * DAY }, { id: "i3", amount: 300, at: 30 * DAY }, { id: "i4", amount: 5, at: 89.5 * DAY }],
    bank: [{ id: "i1", amount: 100, t: 10 * DAY }, { id: "i2", amount: 250, t: 20 * DAY }, { id: "x9", amount: 70, t: 40 * DAY }] };
  const r = reconcile(s, 0, 90 * DAY, 2 * DAY);
  expect(r.matched).toBe(1);
  expect(r.differ).toEqual([{ id: "i2", books: 200, bank: 250 }]);
  expect(r.inBooksNotBank).toEqual([{ id: "i3", amount: 300 }]); // (i4 was paid within two days of the period's end: the bank's record may not show it yet)
  expect(r.inBankNotBooks).toEqual([{ id: "x9", amount: 70 }]);
});

// ---- the town it makes

test("every profile's town has an audit office: a body with staff hired from the town, a grant to pay them, an audit law with the profile's figures, and a post for the officer", () => {
  for (const id of ["au-vic-2026", "br-mg-2026", "de-ni-2026", "gb-eng-2026", "in-tn-2026", "jp-akita-2026", "ke-nakuru-2026", "mx-jal-2026", "us-oh-2026"]) {
    const P = loadProfile(id), A = P.values.audit!;
    expect(A, `${id} states an audit law`).toBeDefined();
    for (const k of ["audit.office", "audit.answer_within_days", "audit.report_within_days", "audit.bodies", "public_service.staff_per_1000.audit"]) expect(P.sources[k], `${id}: a source for ${k}`).toMatch(/PLACEHOLDER|MIXED|SOURCED|to confirm/i);
    const c = generate({ ...base, citizens: 1000, profile: id }) as any;
    const law = c.world.records.find((r: any) => r.id === "law-audit");
    expect(law, `${id}: the audit law is published`).toBeDefined();
    expect(law.visible_to).toBe("public");
    expect(law.data.audit).toMatchObject({ auditor: "auditor", answer_within_days: A.answer_within_days, report_within_days: A.report_within_days });
    expect(law.data.audit.bodies.map((b: any) => b.body).sort()).toEqual(A.bodies.map((b) => b.body).sort());
    expect(c.world.entities.some((e: any) => e.id === "auditor" && e.kind === "audit_office")).toBe(true);
    const staff = c.world.records.filter((r: any) => r.record === "agreement" && r.terms.template === "employment" && r.terms.parties[0] === "auditor");
    expect(staff.length, `${id}: staffed from the town`).toBeGreaterThanOrEqual(1);
    expect(c.positions.find((p: any) => p.id === "auditor-officer")?.role_module.code).toBe("office.auditor");
    expect(c.world.records.some((r: any) => r.id === "grant-auditor"), `${id}: paid by a grant`).toBe(true);
    // its rows in the table of work, each with a source
    for (const k of ["publish/audit_request", "publish/audit_finding", "publish/audit_report", "publish/audit_answer"]) {
      expect(c.orchestration.act_time.person[k], `${id}: ${k}`).toBeGreaterThan(0);
      expect(c.orchestration.act_time.sources[`person.${k}`], `${id}: a source for ${k}`).toContain("Placeholder");
    }
  }
}, 240_000);

// ---- a scenario

function recordsOf(logPath: string) {
  const log = readFileSync(logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { log, recs: log.filter((e) => e.kind === "event" && e.body.event === "recorded").map((e) => e.body.record) };
}

test("the auditor samples the support office's decisions, finds those that differ from the law where the office's procedure is wrong, and publishes a report", async () => {
  const config = generate({ ...base, citizens: 300, profile: "au-vic-2026" }) as any;
  // A procedure that differs from the law: the support office wrongly refuses six in ten claims that qualify (a slip rate no source gives; the way other tests set up faults).
  config.orchestration.slip = { person: { "publish/benefit_decision": { bps: 6_000 } }, system: { "publish/benefit_decision": { bps: 6_000 } }, sources: { "system.publish/benefit_decision": "test: a deliberately wrong procedure" } };
  const out = join(root, "runs", "test-auditor-fault");
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config, runId: "auditor-fault", outDir: out, until: 125 * DAY });
  const { recs } = recordsOf(s.logPath);
  const kinds = (k: string) => recs.filter((r: any) => r.kind === k);
  const reports = kinds("audit_report").filter((r: any) => r.data.check === "decisions");
  expect(reports.length, "the first period's report").toBeGreaterThanOrEqual(1);
  const rep = reports.find((r: any) => r.data.period === 1)!;
  expect(rep.visible_to, "public").toBe("public");
  expect(rep.speaks_for).toBe("auditor");
  expect(rep.data.population).toBeGreaterThan(rep.data.sample);
  expect(rep.data.sample).toBeGreaterThanOrEqual(6);
  expect(rep.data.agreed + rep.data.not_agreed + rep.data.not_checked + rep.data.not_found).toBe(rep.data.sample);
  expect(rep.data.not_agreed, "the wrong procedure is found").toBeGreaterThanOrEqual(1);
  // the sample is the numbers asked for: one request, one answer and one finding each, all different
  const mine = (k: string) => kinds(k).filter((r: any) => r.data?.audit === "support|decisions|1");
  const asked = mine("audit_request").filter((r: any) => r.data.ask === "nth").map((r: any) => r.data.nth);
  expect(asked.length).toBe(rep.data.sample);
  expect(new Set(asked).size).toBe(asked.length);
  expect(mine("audit_answer").filter((r: any) => r.data.ask === "nth").length).toBe(asked.length);
  expect(mine("audit_finding").length).toBe(asked.length);
  // each disagreement is a decision of the office's, refused, and the particulars say it in the law's terms
  expect(rep.data.disagreements.length).toBe(rep.data.not_agreed);
  for (const d of rep.data.disagreements) {
    const decision = recs.find((r: any) => r.id === d.item);
    expect(decision.kind).toBe("benefit_decision");
    expect(decision.data.granted).toBe(false);
    expect(d.finding).toContain("meets the conditions the law states");
  }
  // what it asked, it asked in the days and the way the law gives, of the body, and the body answered it; it reached no register
  for (const r of kinds("audit_request")) { expect(r.speaks_for).toBe("auditor"); expect(r.data.answer_by - r.at).toBeLessThanOrEqual(28 * DAY + DAY); }
  // (Requests are public and addressed to no one: a paper addressed to an organisation wakes every post of it, and a seat's wakes are not its twin's, foundations F6. The body's
  // answer is addressed to the audit office, and carries the file; the audit office's working papers are its own.)
  for (const r of kinds("audit_request")) { expect(r.visible_to).toBe("public"); expect(r.addressed_to ?? []).toEqual([]); }
  for (const r of kinds("audit_answer")) { expect(r.addressed_to).toEqual(["auditor"]); expect(r.speaks_for).toBe("outside"); }
  for (const r of kinds("audit_finding")) { expect(r.visible_to).toEqual(["auditor"]); expect(r.addressed_to ?? []).toEqual([]); }
  // nothing follows from a finding by itself: no reversal, no fine, no payment to or from the audit office
  expect(recs.some((r: any) => r.kind === "decision_review" && r.data?.on_review && String(r.data.on_review).startsWith("rec.") && recs.find((x: any) => x.id === r.data.on_review)?.kind?.startsWith("audit_"))).toBe(false);
  expect(recs.filter((r: any) => r.speaks_for === "auditor" && !/^audit_/.test(r.kind ?? "") && !["employment", "request", "payroll_notice", "withholding_report", "off_books"].includes(r.kind ?? "")).map((r: any) => r.kind).filter(Boolean)).toEqual([]);
  rmSync(out, { recursive: true, force: true });
}, 600_000);

test("an auditor short of hours falls behind and reports late, and the report says when it was due", async () => {
  const config = generate({ ...base, citizens: 300, profile: "au-vic-2026" }) as any;
  // Eight hours to decide one decision again on its file, instead of half an hour: a sample of eight is three days' work and more.
  config.orchestration.act_time.person["publish/audit_finding"] = 8 * 3_600;
  const out = join(root, "runs", "test-auditor-late");
  rmSync(out, { recursive: true, force: true });
  const slow = await runWorld({ config, runId: "auditor-late", outDir: out, until: 112 * DAY });
  const fast = generate({ ...base, citizens: 300, profile: "au-vic-2026" }) as any;
  const a = recordsOf(slow.logPath).recs.filter((r: any) => r.kind === "audit_report" && r.data.check === "decisions");
  rmSync(out, { recursive: true, force: true });
  const out2 = join(root, "runs", "test-auditor-on-time");
  const quick = await runWorld({ config: fast, runId: "auditor-on-time", outDir: out2, until: 112 * DAY });
  const b = recordsOf(quick.logPath).recs.filter((r: any) => r.kind === "audit_report" && r.data.check === "decisions");
  rmSync(out2, { recursive: true, force: true });
  expect(b.length, "an auditor with its hours reports the first period").toBeGreaterThanOrEqual(1);
  const lateBy = (reports: any[]) => (reports[0] ? reports[0].at - reports[0].data.to : Infinity);
  expect(lateBy(b)).toBeLessThan(3 * DAY);
  // the slow one has not finished (no report yet), or finished well after: it fell behind by itself, nothing told it to
  expect(lateBy(a)).toBeGreaterThan(lateBy(b) + 2 * DAY);
}, 900_000);

