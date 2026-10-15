// A tenant's answer to an application for possession, and what the tribunal does with each kind (docs/behaviour/
// justice.md, "A tenant's answer"; the fifth living pilot: 56 applications, not one answered, 56 orders for possession
// from a model and from code alike). A town opens with six tenancies before its tribunal, each tenant in another case:
// one who does not answer; one out of work who says they can pay nothing; one in work who offers a sum a month; one
// in work who owes more than any plan would clear; one whose notice to vacate gave fewer days than the law asks; one
// who has the money and pays. Everything a tenant says is from their own record, typed. The code member decides each
// by its stated rule; a mock in the member's chair, with that code as its brain, decides the same on the office's
// forms; and the member's books show each answer as it was given.

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { planLawWords, possessionOrderFor, planLaw, modules } from "@oikos/participants";
import { runWorld } from "../src/run";
import { giveToAnother } from "./lib/offices";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const base = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
const CASES = ["silent", "nothing", "offers", "too_much", "short_notice", "pays"] as const;
type Case = (typeof CASES)[number];

/** The town, with six tenancies brought before the tribunal as the year begins (the papers a landlord and the
 * tribunal would have on file: the rent account, the notice to vacate, the application, the notice of hearing). */
function town(more: object = {}) {
  const config = generate({ ...base, ...more }) as any;
  const recs = config.world.records as any[];
  const law = recs.find((r) => r.id === "law-possession").data;
  const leases = recs.filter((r) => r.record === "agreement" && r.terms.template === "lease");
  const employed = (who: string) => recs.find((r) => r.record === "agreement" && r.terms.template === "employment" && r.terms.parties[1] === who);
  const rentOf = (l: any) => Number(recs.find((r) => r.id === `${l.id}-rent`)?.data?.outcome?.money?.amount ?? 0);
  // (Tenants in work as the year begins.)
  const used = new Set<string>();
  const pick = () => {
    const l = leases.find((x: any) => !used.has(x.id) && employed(x.terms.parties[1]) && rentOf(x) > 0)!;
    used.add(l.id);
    return l;
  };
  const chosen = new Map<Case, { lease: string; tenant: string; landlord: string; rent: number }>();
  for (const c of CASES) {
    const l = pick();
    expect(l).toBeDefined();
    const tenant = l.terms.parties[1] as string, landlord = l.terms.parties[0] as string, rent = rentOf(l);
    chosen.set(c, { lease: l.id, tenant, landlord, rent });
    const space = /rents home (\S+) from/.exec(l.terms.text)?.[1] ?? "", structure = space.split("/")[0]!;
    const rents = c === "too_much" ? 30 : 2, owed = rents * rent;
    const given = c === "short_notice" ? 5 : law.notice_days + 3, by = c === "short_notice" ? -1 * DAY : -2 * DAY; // (the short one gave 4 days)
    const both = [landlord, tenant];
    const paper = (id: string, kind: string, speaks: string, to: string[], visible: string[], basis: string, text: string, data: object) =>
      recs.push({ id, record: "statement", author: "genesis", at: 0, visible_to: visible, speaks_for: speaks, kind, addressed_to: to, basis, text, data: { ...data, brought_forward: true } });
    paper(`${l.id}-rent-book`, "rent_statement", landlord, [tenant], both, l.id, `Statement of the rent account under ${l.id} as the year began: ${rents} rents owed.`, { lease: l.id, owed, rents, rent, since: -rents * 30 * DAY, account: `acc-${landlord}` });
    paper(`${l.id}-vacate`, "notice_to_vacate", landlord, [tenant], both, l.id, `Notice to vacate: the rent under ${l.id} is in arrears.`, { lease: l.id, reason: "arrears", arrears: owed, by, given: -given * DAY, law: "law-possession" });
    paper(`${l.id}-possession`, "tribunal_application", landlord, ["tribunal"], [landlord, "tribunal", tenant], l.id, `Application for possession: ${tenant} is behind with the rent under ${l.id}.`,
      { kind: "possession", matter: "possession", against: tenant, about: l.id, amount: owed, rent, account: `acc-${landlord}`, space, structure, household: [tenant], notice: `${l.id}-vacate`, notice_given: -given * DAY, notice_by: by, evidence: { id: l.id, record: "agreement" } });
    const answerBy = 9 * DAY + 9 * 3600;
    paper(`${l.id}-hearing`, "hearing_notice", "tribunal", both, [...both, "tribunal"], `${l.id}-possession`, `${landlord} has applied to us about possession (application ${l.id}-possession). You may answer by day 9.`,
      { application: `${l.id}-possession`, kind: "possession", matter: "possession", applicant: landlord, against: tenant, hearing_at: answerBy, answer_by: answerBy, about: l.id, amount: owed, structure });
    // Who each tenant is, for the test: whether they answer is not left to the draw.
    const who = config.participants.find((p: any) => p.person === tenant);
    const params: any = { ...who.controller.params, leave_after_homeless_days: 9_999, possession: { stay_bps: 10_000, obey_bps: 0, answer_bps: c === "silent" ? 0 : 10_000, notice_days: law.notice_days } };
    const account = config.world.accounts.find((a: any) => a.id === `acc-${tenant}`);
    if (c === "nothing") {
      const job = employed(tenant);
      config.world.records = recs.filter((r) => r.id !== job.id && r.agreement !== job.id && r.basis !== job.id);
      recs.length = 0; recs.push(...config.world.records);
      params.in_labour_force = false;
      account.balance = "0";
    } else if (c === "pays") account.balance = String(owed + 20 * rent);
    else account.balance = "0";
    who.controller = { ...who.controller, params };
  }
  config.world.records = recs;
  return { config, chosen, law };
}

async function run(name: string, config: any, days: number) {
  const out = mkdtempSync(join(tmpdir(), `oikos-${name}-`));
  try {
    const s = await runWorld({ config: { ...config, log: { ...config.log, detail: "lean" } }, runId: name, outDir: out, until: days * DAY, recordObservations: "none" });
    expect(s.participantErrors).toBe(0);
    const ev = readFileSync(s.logPath, "utf8").trim().split("\n").filter((l) => l.includes('"event"')).map((l) => JSON.parse(l)).filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
    return ev.filter((e) => e.event === "recorded").map((e) => e.record) as any[];
  } finally { rmSync(out, { recursive: true, force: true }); }
}

/** What became of each case: the tenant's answer, the landlord's reply, the order, or the application withdrawn. */
function outcomes(recs: any[], chosen: Map<Case, { lease: string; tenant: string; landlord: string; rent: number }>) {
  const out = new Map<Case, { answer?: any; reply?: any; order?: any; withdrawn: boolean }>();
  for (const [c, x] of chosen) {
    const app = `${x.lease}-possession`;
    out.set(c, {
      answer: recs.filter((r) => r.kind === "tribunal_response" && r.data?.application === app && r.speaks_for === x.tenant).at(-1),
      reply: recs.filter((r) => r.kind === "tribunal_reply" && r.data?.application === app).at(-1),
      order: recs.find((r) => r.kind === "tribunal_order" && r.data?.application === app),
      withdrawn: recs.some((r) => r.record === "withdrawal" && r.withdraws === app),
    });
  }
  return out;
}

test("each kind of answer, through the code member: what a tenant tells is typed and their own, and the order follows the stated rule", async () => {
  const { config, chosen, law } = town();
  // The tribunal's answer form is published, for whoever is served.
  const form = config.world.records.find((r: any) => r.id === "form-tribunal-possession-answer");
  expect(form.visible_to).toBe("public");
  expect(Object.keys(form.data.fields)).toEqual(expect.arrayContaining(["application", "owes", "can_pay", "out_of_work_since", "claim", "people", "children", "lived_days", "go_to", "disputes_sum", "disputes_notice"]));
  const recs = await run("tenant-answers-code", config, 16);
  const o = outcomes(recs, chosen);
  // One who does not answer: nothing on file from them, and possession, as before.
  expect(o.get("silent")!.answer).toBeUndefined();
  expect(o.get("silent")!.order.data.finding).toBe("possession");
  // One out of work with nothing coming in: says so, and why; never a number of the mind's.
  const nothing = o.get("nothing")!.answer;
  expect(nothing.data.offer).toBe(0);
  expect(nothing.data.out_of_work_since).toBeDefined();
  expect(nothing.text).toContain("can pay nothing");
  for (const a of [...o.values()].map((x) => x.answer).filter(Boolean)) {
    for (const k of Object.keys(a.data)) expect(["application", "owes", "offer", "every_days", "disputes_sum", "disputes_notice", "out_of_work_since", "pay_short", "claim", "claim_on", "ill", "people", "children", "ages", "lived_days", "go_to", "left", "left_at"]).toContain(k);
    expect(JSON.stringify(a.data)).not.toMatch(/trust|agency|bps|affinity/);
    expect(a.visible_to).toEqual(expect.arrayContaining(["tribunal"]));
  }
  expect(o.get("nothing")!.order.data.finding).toBe("possession");
  // One in work who offers: the sum a plan answer gives; a plan where it clears what is owed within the law's longest.
  const offers = o.get("offers")!;
  expect(offers.answer.data.offer).toBeGreaterThan(0);
  const owed = Number(offers.reply?.data?.owed ?? offers.answer.data.owes);
  expect(offers.order.data.finding).toBe(owed <= 0 ? "dismissed" : owed <= offers.answer.data.offer * law.plan_months ? "plan" : "possession");
  expect(offers.order.data.finding).toBe("plan");
  expect(offers.order.data.instalment).toBe(offers.answer.data.offer);
  // Where the landlord replied in time (it does on its day for the rent book) the member took its rent book's sum.
  if (offers.reply && offers.reply.at < offers.order.at) expect(offers.reply.data.owed).toBe(offers.order.data.amount);
  // One who owes more than a plan clears: possession, with the reason said.
  const much = o.get("too_much")!;
  expect(much.answer.data.offer).toBeGreaterThan(0);
  expect(much.order.data.finding).toBe("possession");
  // A notice that gave fewer days than the law asks: the tenant says so, and the application is dismissed.
  const short = o.get("short_notice")!;
  expect(short.answer.data.disputes_notice).toBe(true);
  expect(short.order.data.finding).toBe("dismissed");
  expect(short.order.data.notice_short).toBe(true);
  // One who pays what is owed: the landlord withdraws, and nothing is ordered.
  const pays = o.get("pays")!;
  expect(pays.withdrawn || pays.order?.data.finding === "dismissed").toBe(true);
  expect(pays.order?.data.finding === "possession").toBe(false);
  console.log([...o].map(([c, x]) => `${c}: ${x.answer ? x.answer.text : "(no answer)"} => ${x.withdrawn ? "withdrawn" : x.order?.data.finding}`).join("\n"));
}, 900_000);

test("the same cases with a mock in the member's chair: the same orders, on the office's form; its books show each answer as given", async () => {
  const code = town();
  const a = outcomes(await run("tenant-answers-twin-code", code.config, 16), code.chosen);
  const seat = town({ model_seats: ["tribunal-member"] });
  // (The registry staff, who keep the member's books, are a person of their own, as in a tribunal of more than one: where the town's one person
  // holds the member's seat and the clerk's post too, the member sits before the clerk has filed the day's list, and decides without it: foundations F5.)
  giveToAnother(seat.config, "tribunal-member-staff");
  const recs = await run("tenant-answers-twin-seat", seat.config, 16);
  const b = outcomes(recs, seat.chosen);
  for (const c of CASES) {
    expect(b.get(c)!.order?.data.finding).toBe(a.get(c)!.order?.data.finding);
    if (b.get(c)!.order) expect(b.get(c)!.order.author).toBe("tribunal-member-system");
  }
  // The books the seat was shown: the case with the tenant's answer in full, and the law on the order at the head.
  const books = recs.filter((r) => r.speaks_for === "tribunal" && typeof r.text === "string" && r.text.includes("applies for possession")).map((r) => r.text as string).join("\n");
  const nothing = seat.chosen.get("nothing")!, silent = seat.chosen.get("silent")!;
  const line = (tenant: string) => { const m = [...books.matchAll(new RegExp(`[a-z0-9.-]+: \\S+ applies for possession of \\S+ from ${tenant} .*?not decided`, "g"))].filter((x) => x[0].includes("answered")).at(-1) ?? [...books.matchAll(new RegExp(`[a-z0-9.-]+: \\S+ applies for possession of \\S+ from ${tenant} .*?not decided`, "g"))].at(-1); return m?.[0] ?? ""; };
  expect(line(nothing.tenant)).toContain("can pay nothing toward what is owed beyond the rent");
  expect(line(nothing.tenant)).toContain("out of work since");
  expect(line(silent.tenant)).toContain("has not answered");
  expect(books).not.toMatch(/not stated|not told|unknown/i);
  // (The day's list, with the law at its head, is the clerk's paper of the day the cases ripen, filed at an hour of its own that drifts from day to
  // day (docs/behaviour/office-books.md, point 8). Where the member sat first, on the ripe day, and decided from the waiting list, as a seat may, there
  // is no list to hold the law and nothing to expect of it: foundations F5 made the clerk a person of the town, whose hour drifts with theirs.)
  const decidedAt = Math.min(...recs.filter((r) => r.kind === "tribunal_order").map((r) => r.at));
  const listedFirst = recs.some((r) => r.kind === "office_books" && r.at < decidedAt && r.data?.list && r.data.list.ripe > 0);
  if (listedFirst) {
    expect(books).toContain("The law on the order (possession order form):");
    expect(books).toContain("must consider whether the tenant could pay what is owed by a plan");
  }
  console.log(`A case as the member's books show it:\n${line(nothing.tenant)}\n${line(seat.chosen.get("offers")!.tenant)}`);
}, 900_000);

test("a place whose law has no plan: its order form offers none, and says what the law has in its stead", () => {
  for (const profile of ["de-ni-2026", "us-oh-2026", "br-mg-2026"]) {
    const c = generate({ ...base, profile, model_seats: ["tribunal-member"] }) as any;
    const law = c.world.records.find((r: any) => r.id === "law-possession");
    expect(law.data.plan_consider).toBe("none");
    expect(law.text).toContain("no plan to pay");
    const form = c.world.records.find((r: any) => r.id === "form-tribunal-member-possession-order");
    expect(form.data.fields.finding.options).toEqual(["dismissed", "possession"]);
    expect(form.data.fields.instalment).toBeUndefined();
    expect(form.text).not.toMatch(/a plan \(/);
    if (law.data.cure_days) { expect(form.text).toContain(`within ${law.data.cure_days} days`); expect(law.text).toContain(`within ${law.data.cure_days} days`); }
    const proc = c.world.records.find((r: any) => r.id === "proc-tribunal-member-possession");
    expect(proc.text).not.toMatch(/\b(should|ought|best|recommend)/i);
  }
  const vic = generate({ ...base, model_seats: ["tribunal-member"] }) as any;
  expect(vic.world.records.find((r: any) => r.id === "form-tribunal-member-possession-order").data.fields.finding.options).toEqual(["dismissed", "plan", "possession"]);
  expect(planLawWords({ plan_months: 6, plan_consider: "may", plan_barred_rent_months: 2 })).toContain("may not where 2 months' rent or more is owed");
  expect(possessionOrderFor(planLaw({ plan_months: 0 }), 0).fields.pay_into).toBeUndefined();
  expect(modules).toBeDefined();
});
