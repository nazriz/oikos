// The town's government on a generated town with the code mayor (the all-code
// control): a budget goes through the council; a park goes through planning,
// the builder, an invoice, the mayor's approval and the finance officer; rates
// are levied and paid. Every step is people following (or not)
// procedures written as records; none of it is kernel mechanics.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { draftLaw } from "@oikos/participants";
import { MockAdapter, type LlmRequest } from "@oikos/participants/llm";
import { generate, rentIncreaseLaw } from "@oikos/worlds/generator/generate";
import { runWorld } from "../src/run";
import { officeAt, officesBy } from "./lib/offices";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

// A law made from figures, amended by the council (docs/behaviour/government.md; docs/design/ai-citizens.md 2e). A
// model mayor (the mock, scripted) asks for a longer notice of rent increases; its request becomes the law's amendment
// form; the clerk ballots it. Passed: the clerk publishes the law rewritten from the new figure in place of the old,
// and those who read the old read the new, with no change to them: a landlord gives the longer notice; one who keeps
// no book of laws gives what it always gave, is taken to the tribunal by its tenants, and loses, under the new law.
// Rejected: nothing changes.
async function amendment(name: string, leaning: number) {
  const config = generate({ ...spec, citizens: 80, mayor: "llm", years: 1 });
  // The law at the start: an increase a month after the last at the soonest, on 30 days' notice. Landlords review
  // monthly and give 30 days, as the law asks, and obey the law as they read it; the first reads the laws, the others
  // keep no book of them (so go on by their own practice, whatever the council does).
  const i = config.world.records.findIndex((r: any) => r.id === "law-rent-increases");
  config.world.records[i] = rentIncreaseLaw(1, 30);
  const challenging = (c: any) => c?.impl === "citizen.default" && c.params?.tribunal && (c.params = { ...c.params, tribunal: { ...c.params.tribunal, challenge_bps: 10_000 } });
  // (The offices are held by people, who run the post's module: its parameters are the position's.)
  for (const o of officesBy(config, "firm.landlord")) Object.assign(o.params, { rent_review_months: 1, rent_increase_notice_days: 30, compliance_bps: 10_000 });
  for (const o of officesBy(config, "city.councillor")) Object.assign(o.params, { leaning, noise_bps: 0 });
  for (const o of officesBy(config, "city.council_clerk")) Object.assign(o.params, { vote_days: 7 });
  for (const x of config.participants) challenging(x.controller);
  for (const t of config.templates) challenging(t.controller);
  for (const pos of config.positions) if (/^landlord-[2-9]-office$/.test(pos.id)) pos.channels = pos.channels.filter((c: any) => c.id !== "laws");
  let calls = 0, asked = false;
  const seen: string[] = [];
  const tool = (tool: string, input: object) => [{ type: "tool_use" as const, id: `t${++calls}`, name: tool, input }];
  const adapter = new MockAdapter("mock", {
    participant: (req: LlmRequest) => {
      const obs = req.context.observation;
      seen.push(JSON.stringify(req.messages.at(-1)!.content));
      if (calls === 0) return tool("do", { what: "Put to the council: tenants must have at least 75 days' notice of a rent increase." });
      const d = obs.drafts[0];
      if (d) return tool("confirm", { ref: d.id, decision: "confirm" });
      if (!asked && obs.t >= 10 * DAY) {
        asked = true;
        return tool("write", { to: ["council-clerk"], text: "What became of the amendment?", as: "mayor" });
      }
      return tool("done_for_now", { days: 7 });
    },
    // (What a translator makes of it: the law's amendment form, filled in. The resolver checks the fields' types.)
    translator: () => [{ type: "tool_use", id: "x", name: "call", input: { program: 'form(to=city, form=amend_rent_increases, notice="75 days", affects=tenants)' } }],
    debrief: () => [{ type: "text", text: "Thanks." }],
  });
  const out = join(root, "runs", `test-government-${name}`);
  rmSync(out, { recursive: true, force: true });
  // (100 days, was 70: 2026-10-16, the profile source check: the au-vic-2026 profile's tribunal now takes 56 days to a hearing (was 49), so an application made after the amendment is heard after day 70. What is checked is the same.)
  const s = await runWorld({ config, runId: name, outDir: out, until: 100 * DAY, adapter });
  expect(s.participantErrors).toBe(0);
  const recs = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.kind === "event" && e.body.event === "recorded").map((e) => e.body.record);
  return { recs, read: seen.join("\n"), kind: (k: string) => recs.filter((r) => r.kind === k) };
}

test("an amendment that passes binds: the clerk rewrites the law from the new figure, a landlord's next notice complies, and the tribunal judges by it", async () => {
  const { recs, read, kind } = await amendment("amendment-passed", 80);
  // The mayor's request, on the law's form, as the resolver read it; balloted as what it would change.
  const prop = kind("proposal").find((r) => r.basis === "form-amend-rent-increases");
  expect(prop).toMatchObject({ in_position: "mayor", data: { notice: 75 * DAY, affects: "tenants" } });
  const ballot = kind("ballot").find((r) => r.data.proposal === prop.id);
  expect(ballot.text).toBe("Council ballot: to amend the law on rent increases (law-rent-increases): notice of an increase 75 days (now 30 days).");
  expect(ballot.data.tags).toEqual(["tenant_protection"]);
  const result = kind("ballot_result").find((r) => r.data.ballot === ballot.id);
  expect(result.data).toMatchObject({ passed: true, yes: 5, no: 0 });
  expect(result.text).toContain("The law on rent increases is amended: notice of an increase 75 days (was 30 days). The amended law takes the place of law-rent-increases.");
  // The amended law: the clerk's, citing the ballot, by the same schedule (words, breakdown, rule), the figures recorded.
  const law = kind("law").find((r) => r.basis === ballot.id);
  const first = rentIncreaseLaw(1, 75);
  expect(law).toMatchObject({ in_position: "council-clerk", speaks_for: "city", visible_to: "public", adico: first.adico, formal: first.formal,
    data: { schedule: "schedule-rent-increases", replaces: "law-rent-increases", figures: { review: { value: 30 * DAY, unit: "seconds" }, notice: { value: 75 * DAY, unit: "seconds" } } } });
  expect(law.text).toBe(`${first.text} (As amended by the council on ballot ${ballot.id}; this replaces law-rent-increases.)`);
  expect(recs.some((r) => r.record === "withdrawal" && r.withdraws === "law-rent-increases" && r.in_position === "council-clerk" && r.at === law.at)).toBe(true);
  // The mayor is told, in the town's terms (the result, and the clerk's report with the figure as it now stands).
  expect(read).toContain("The law on rent increases is amended");
  expect(read).toContain(`the law on rent increases (${law.id}) on amend_rent_increases (notice: notice of an increase, now 75 days; review: least time between increases, now 1 month)`);

  // Landlords, unchanged: the one who reads the laws gives at least the new notice (its own practice is 30 days); the
  // others, who don't, give their 30 days (an increase starts with the next day).
  const notices = kind("rent_increase").filter((n) => n.at >= law.at);
  const obeying = notices.filter((n) => n.speaks_for === "landlord-1");
  const others = notices.filter((n) => n.speaks_for !== "landlord-1");
  expect(obeying.length).toBeGreaterThan(0);
  expect(others.length).toBeGreaterThan(0);
  for (const n of obeying) expect(n.data.from - n.at).toBeGreaterThanOrEqual(75 * DAY);
  // (An hour over the day: a notice is dated to allow for the time it takes to give, 2026-10-16, foundations F7: participants/src/behaviour/common.ts, `NOTICE_LAG`.)
  for (const n of others) expect(n.data.from - n.at).toBeLessThan(31 * DAY + 3_600);
  // Tenants, unchanged, take the short notices (lawful under the old law) to the tribunal, which finds them invalid
  // under the amended law; nobody applies against the landlord who complied.
  const applications = kind("tribunal_application");
  expect(applications.length).toBeGreaterThan(0);
  expect(applications.every((a) => others.some((n) => n.id === a.data.notice))).toBe(true);
  const orders = kind("tribunal_order");
  expect(orders.length).toBeGreaterThan(0);
  for (const o of orders) expect(o.data).toMatchObject({ finding: "invalid", laws: [law.id] });
}, 600_000);

test("an amendment that fails changes nothing: the law stands, and landlords and the tribunal go on by it", async () => {
  const { recs, kind } = await amendment("amendment-rejected", -80);
  const prop = kind("proposal").find((r) => r.basis === "form-amend-rent-increases");
  const ballot = kind("ballot").find((r) => r.data.proposal === prop.id);
  const result = kind("ballot_result").find((r) => r.data.ballot === ballot.id);
  expect(result.data).toMatchObject({ passed: false, yes: 0, no: 5 });
  expect(result.text).toBe("Rejected: 0 for, 5 against. Voting for: none; against: councillor-1, councillor-2, councillor-3, councillor-4, councillor-5.");
  expect(kind("law")).toEqual([]);
  expect(recs.some((r) => r.record === "withdrawal" && r.withdraws === "law-rent-increases")).toBe(false);
  // Every landlord's notice is on 30 days (an increase starts with the next day), lawful as the law stands: nobody
  // goes to the tribunal over one.
  const notices = kind("rent_increase");
  expect(notices.length).toBeGreaterThan(0);
  for (const n of notices) {
    expect(n.data.from - n.at).toBeGreaterThanOrEqual(30 * DAY);
    expect(n.data.from - n.at).toBeLessThan(31 * DAY + 3_600); // (and an hour for the giving: NOTICE_LAG)
  }
  expect(kind("tribunal_application").filter((a) => a.data.kind === "rent_increase")).toEqual([]);
}, 600_000);

test("the generated town: every law made from figures reads as its schedule writes it, and has a form to amend it", () => {
  const config = generate({ ...spec, citizens: 80 });
  const records: any[] = config.world.records;
  const schedules = records.filter((r) => r.kind === "law_schedule");
  expect(schedules.map((s) => s.id).sort()).toEqual(["schedule-industrial-action", "schedule-rent-increases", "schedule-tenancy"]);
  for (const s of schedules) {
    const law = records.find((r) => r.kind === "law" && r.data?.schedule === s.id);
    expect(law.speaks_for).toBe("city");
    const drafted = draftLaw(s.id, s.data, Object.fromEntries(Object.entries(law.data.figures).map(([k, f]: [string, any]) => [k, f.value])));
    expect({ text: law.text, adico: law.adico, formal: law.formal, data: law.data }).toEqual({ text: drafted.text, adico: drafted.adico, formal: drafted.formal, data: drafted.data });
    // Its form: the figures as optional fields of the types forms already have, and whom it bears on.
    const form = records.find((r) => r.kind === "form" && r.data?.amends === s.id);
    expect(form.data).toMatchObject({ form: s.data.form, submit_as: "proposal", submit_to: ["city"] });
    expect(Object.keys(form.data.fields)).toEqual([...Object.keys(s.data.figures), "affects"]);
    for (const [k, f] of Object.entries(s.data.figures) as [string, any][]) expect(form.data.fields[k]).toMatchObject({ type: f.type });
    for (const f of Object.values(form.data.fields) as any[]) {
      expect(f.required).toBeUndefined();
      expect(["duration", "count", "choice"]).toContain(f.type);
    }
  }
  // The laws on rent increases and industrial action, as they read from the profile's figures.
  expect(records.find((r) => r.id === "law-rent-increases")).toMatchObject({ text: "A residential rent may be increased no more than once every 12 months. A residential rent may be increased only on written notice to the tenant of at least 60 days. Or else: the increase is invalid.",
    formal: { language: "cel", condition: `block.block == 'publish' && block.kind == 'rent_increase' && (block.data.from - now < ${60 * DAY} || block.data.from - block.data.last_from < ${360 * DAY})` } });
  expect(records.find((r) => r.id === "law-industrial-action")).toMatchObject({ text: "Industrial action is protected only where each of these holds. At least 50% of the members concerned have voted in a ballot on it. More than 50% of the votes in a ballot of the members concerned are for it. The employer has had written notice of it of at least 3 days.",
    formal: { language: "cel", condition: `block.block == 'publish' && block.kind == 'industrial_action' && (block.data.from - now < ${3 * DAY} || block.data.voted * 10000 < 5000 * block.data.eligible || block.data.yes * 10000 <= 5000 * block.data.voted)` } });
});

test("budget, park and rates run through the town's own procedures", async () => {
  // (Landlords who pay what they owe: whether they do is a propensity, not what's tested here.)
  // (A town whose council has adopted no budget, so the first weeks hold the mayor's proposal and the council's vote on it:
  // a generated town opens with its first year's budget on file otherwise.)
  const config = generate({ ...spec, citizens: 80, mayor: "code", landlord_compliance_bps: 10_000, opening_budget: false });
  // A payment from the town's account instructed by the mayor, a post the town
  // has not named as a signatory: the bank should decline it.
  config.world.records.push({ id: "mayor-direct", record: "statement", author: officeAt(config, "mayor").holder.id, in_position: "mayor", speaks_for: "city", at: 0, visible_to: ["city", "bank"], kind: "request", addressed_to: ["bank"],
    text: "Please pay the builder $12.34 from the town's account.", data: { outcome: { money: { from: "acc-city", to: "acc-builder", amount: 1234 } } } });
  const out = join(root, "runs", "test-government");
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config, runId: "government", outDir: out, until: 75 * DAY });
  const ev = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
  const recs = ev.filter((e) => e.event === "recorded").map((e) => e.record);
  const byId = new Map(recs.map((r) => [r.id, r]));
  const lotCells = (lot: string): string[] => config.world.records.find((r: any) => r.id === lot)?.data?.cells ?? [];

  // The budget: proposed by the mayor, balloted by the clerk, voted by councillors, adopted with the ballot as basis.
  const budget = recs.find((r) => r.kind === "budget");
  expect(budget?.in_position).toBe("council-clerk");
  const ballot = byId.get(budget.basis);
  expect(ballot?.kind).toBe("ballot");
  expect(byId.get(ballot.data.proposal)?.in_position).toBe("mayor");
  const result = recs.find((r) => r.kind === "ballot_result" && r.data.ballot === ballot.id);
  expect(result.data.passed).toBe(true);
  const votes = recs.filter((r) => r.record === "vote" && r.ballot === ballot.id);
  expect(votes.every((v) => String(v.in_position).startsWith("councillor-"))).toBe(true);
  expect(result.data.yes).toBe(votes.filter((v) => v.choice === "yes").length);

  // The park: permit, commission, construction, invoice, approval, payment by the finance officer.
  const app = recs.find((r) => r.kind === "permit_application" && r.in_position === "mayor");
  expect(recs.find((r) => r.kind === "permit_decision" && r.data.application === app.id)?.data.decision).toBe("granted");
  expect(ev.some((e) => e.event === "structure_started" && lotCells(app.data.lot).includes(e.on))).toBe(true);
  const invoice = recs.find((r) => r.kind === "invoice" && r.speaks_for === "builder" && (r.addressed_to ?? []).includes("city"));
  expect(recs.some((r) => r.kind === "approval" && r.in_position === "mayor" && r.data.invoice === invoice.id)).toBe(true);
  const order = recs.find((r) => r.kind === "request" && r.data?.outcome?.money?.settles === invoice.id);
  expect(order?.in_position).toBe("finance");
  expect(ev.some((e) => e.event === "transfer" && e.from === "acc-city" && e.to === "acc-builder" && e.amount === invoice.data.outcome.money.amount)).toBe(true);
  // No park was fined: the town followed its own planning law.
  expect(recs.some((r) => r.record === "claim" && r.about?.kind === "fine" && r.counterparty === "city")).toBe(false);

  // The instruction from a post the town didn't name: declined, with a message back.
  expect(ev.some((e) => e.event === "transfer" && e.from === "acc-city" && e.amount === 1234)).toBe(false);
  expect(ev.some((e) => e.event === "message_delivered" && e.participant === "bank-payments-system" && e.to.includes(officeAt(config, "mayor").holder.id))).toBe(true);
  expect(readFileSync(s.logPath, "utf8").includes("Request mayor-direct not carried out: mayor is not an authorised signatory")).toBe(true);

  // Rates (the town's tax): landlords are sent notices on the valuer's valuations, and pay them into the town's account.
  const notices = recs.filter((r) => r.kind === "rates_notice" && r.addressed_to[0].startsWith("landlord"));
  expect(notices.length).toBeGreaterThan(0);
  const claims = recs.filter((r) => r.record === "claim" && r.about?.kind === "rates" && r.counterparty.startsWith("landlord"));
  expect(claims.length).toBe(notices.length);
  expect(ev.some((e) => e.event === "transfer" && e.from.startsWith("acc-landlord") && e.to === "acc-city" && claims.some((c) => c.id === e.settles))).toBe(true);
  // One bill is one payment, whichever of its two papers (the notice, the claim recorded with it) a payment names.
  for (const c of claims) {
    const notice = notices.find((n) => n.addressed_to.includes(c.counterparty) && n.data.due === c.about.due && n.data.amount === c.about.amount);
    expect(notice).toBeDefined();
    expect(ev.filter((e) => e.event === "transfer" && e.to === "acc-city" && (e.settles === c.id || e.settles === notice.id)).length).toBeLessThanOrEqual(1);
  }
}, 300_000);
