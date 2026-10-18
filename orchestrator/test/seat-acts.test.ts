// A seat can take every act its office's code takes (docs/behaviour/office-papers.md, "Act by act"; the third living
// pilot, fault 1: a seated tribunal member decided none of 54 applications for want of a form to decide them on, and
// a seated landlord wrote letters where its code twin gives notices). Here the mock holds the offices of the
// possession procedure, each with its office's own code as its brain, and says every paper the code makes as a seat
// says it: on the office's own form. So each act is taken through the call language, and the test holds that the
// world changes as it does when code runs the offices (orchestrator/test/possession.test.ts is the same tenancy with
// no seat): the notice to vacate, the application, the hearing notice the tenant answers to, the order with its
// date, the warrant, its carrying out. And that no seat made a typed paper off its forms.

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const base = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

/** Typed papers a mock seat may still make off a form, and why (docs/behaviour/office-papers.md, "Still in words"). */
const OFF_FORM = new Set([
  "request", // a dividend's one instruction listing every payment: a seat pays each holder
  "entry", // a note on the office's own file
  "withholding_report", // with a line for each charge (a table): a seat's return, in totals, is on its form
  "loan_terms", "membership_offer", // published once, with an offer whose terms are a structure
  "environment_report", // a table by species
  "proposal", "budget", // a budget carried as data, a law drafted from its schedule: the council's forms serve a seat
  "price_list", "job_posting", "closure", "closing", "insolvency", "property_for_sale", "property_sold", "off_books", "enterprise_agreement", "capital_call", "shareholders", "property_purchase",
]);

/** The town of the possession test: one renting household of one adult with no job and no money, who stays past every paper. */
function town(more: object, seats: (landlord: string) => string[]) {
  const prepare = (config: any) => {
    const leases = config.world.records.filter((r: any) => r.record === "agreement" && r.terms.template === "lease");
    const age = (id: string) => -config.world.entities.find((e: any) => e.id === id).born_at / (365 * DAY);
    const alone = leases.find((l: any) => !/with their household/.test(l.terms.text) && age(l.terms.parties[1]) >= 25 && age(l.terms.parties[1]) < 55)!;
    const tenant = alone.terms.parties[1] as string, landlord = alone.terms.parties[0] as string;
    const job = config.world.records.find((r: any) => r.record === "agreement" && r.terms.template === "employment" && r.terms.parties[1] === tenant);
    if (job) config.world.records = config.world.records.filter((r: any) => r.id !== job.id && r.agreement !== job.id && r.basis !== job.id);
    config.world.accounts.find((a: any) => a.id === `acc-${tenant}`).balance = "0";
    const who = config.participants.find((p: any) => p.person === tenant);
    who.controller = { ...who.controller, params: { ...who.controller.params, in_labour_force: false, possession: { stay_bps: 10_000, obey_bps: 0 }, leave_after_homeless_days: 9_999 } };
    return { config, alone, tenant, landlord };
  };
  const first = prepare(generate({ ...base, ...more }) as any);
  return prepare(generate({ ...base, ...more, model_seats: seats(first.landlord) }) as any);
}

async function run(name: string, config: any, days: number) {
  const out = mkdtempSync(join(tmpdir(), `oikos-${name}-`));
  try {
    const s = await runWorld({ config: { ...config, log: { ...config.log, detail: "lean" } }, runId: name, outDir: out, until: days * DAY, recordObservations: "none" });
    expect(s.participantErrors).toBe(0);
    const lines = readFileSync(s.logPath, "utf8").trim().split("\n");
    const ev = lines.filter((l) => l.includes('"event"')).map((l) => JSON.parse(l)).filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
    const acts = lines.filter((l) => l.includes('"command":"act"')).map((l) => JSON.parse(l).body).map((b) => ({ who: b.participant as string, call: String(b.provenance?.call ?? "") }));
    return { ev, recs: ev.filter((e) => e.event === "recorded").map((e) => e.record), acts };
  } finally { rmSync(out, { recursive: true, force: true }); }
}

/** What a seat did, by kind: each form it filled in, each typed paper it made off a form, each other call. */
function did(acts: { who: string; call: string }[], seat: string) {
  const forms = new Map<string, number>(), plain = new Map<string, number>();
  for (const a of acts) {
    if (a.who !== `${seat}-system`) continue;
    for (const line of a.call.split("\n")) {
      const form = /^(?:\w+ = )?form\(.*?\bform=([a-z_]+)/.exec(line)?.[1];
      if (form) forms.set(form, (forms.get(form) ?? 0) + 1);
      const kind = /^(?:\w+ = )?statement\(/.test(line) && !/\b(withdraw|hold)=/.test(line) ? /\bkind=([a-z_]+)/.exec(line)?.[1] : undefined;
      if (kind) plain.set(kind, (plain.get(kind) ?? 0) + 1);
    }
  }
  return { forms, plain };
}
const offForm = (acts: { who: string; call: string }[], seats: string[]) => seats.flatMap((s) => [...did(acts, s).plain.keys()].filter((k) => !OFF_FORM.has(k)).map((k) => `${s}: ${k}`));

test("a landlord, the tribunal's member and its registrar in seats take a tenancy from arrears to removal, each act on its office's form", async () => {
  // (No registry staff here: the town is not a living one, so the member lists its cases itself, on the notice form.)
  let seats: string[] = [];
  const { config, alone, tenant, landlord } = town({}, (l) => (seats = [`${l}-office`, "tribunal-member", "tribunal-registrar"]));
  // (The police are run by code here: a seated station carries a warrant out only if its officers are in at the hour the
  // seat sits, which is not yet its staff's routine: docs/design/call-language-gaps.md, D.)
  // Each seat has its forms, its procedure under the law on possession, and the tribunal's notice of what it hears is on file.
  const formsOf = (office: string) => config.world.records.filter((r: any) => r.kind === "form" && r.data?.office === office).map((r: any) => r.data.form);
  for (const f of ["rent_reminder", "payment_plan_offer", "notice_to_vacate", "possession_application", "warrant_request", "repair_order", "remedy_answer"]) expect(formsOf(seats[0]!)).toContain(f);
  for (const f of ["hearing_notice", "hearing_listing", "possession_order", "tribunal_order"]) expect(formsOf("tribunal-member")).toContain(f);
  for (const f of ["warrant", "garnishee_order", "enforcement_decline"]) expect(formsOf("tribunal-registrar")).toContain(f);
  for (const office of seats.slice(0, 3)) {
    const proc = config.world.records.find((r: any) => r.id === `proc-${office}-possession`);
    expect(proc.kind).toBe("procedure");
    expect(proc.text).toContain("law-possession");
    expect(proc.text).not.toMatch(/\b(should|ought|best|recommend)/i); // it says what the law asks, never what to decide
    expect(config.positions.find((p: any) => p.id === office).channels.some((c: any) => c.id === "standing")).toBe(true);
  }
  expect(config.world.records.find((r: any) => r.id === "proc-tribunal-member-possession").text).toMatch(/given when it is on the record.*asks no further proof/);
  // (Seed 1 again, 2026-10-16: it was moved to 2 at F6 because the station's one officer left town on day 113 and nobody was in to carry the warrant out, which the review of foundations found was a fault, not a draw: a body whose only staff left stood headless. The council now seconds one of its staff after 14 days (foundations review, finding 6), and the test passes at seed 1.)
  const { ev, recs, acts } = await run("seat-acts-possession", { ...config, seed: 1 }, 200);
  const mine = (kind: string) => recs.filter((r) => r.kind === kind && JSON.stringify(r).includes(alone.id));
  // The same chain as with code in every office, paper for paper.
  const ntv = mine("notice_to_vacate")[0];
  expect(ntv.speaks_for).toBe(landlord);
  expect(ntv.author).toBe(`${seats[0]}-system`);
  expect(recs.some((r) => r.record === "notice" && r.agreement === alone.id && r.at < ntv.data.by)).toBe(false);
  const app = recs.find((r) => r.kind === "tribunal_application" && r.data?.kind === "possession" && r.data.about === alone.id);
  expect(app.at).toBeGreaterThanOrEqual(ntv.data.by);
  // (The application says which notice it relies on, the day it was given and the day it gave.)
  expect(app.data).toMatchObject({ notice: ntv.id, notice_given: ntv.at, notice_by: ntv.data.by });
  const listed = recs.find((r) => r.kind === "hearing_notice" && r.data?.application === app.id);
  expect(listed.author).toBe("tribunal-member-system");
  expect(listed.addressed_to).toContain(tenant);
  const order = recs.find((r) => r.kind === "tribunal_order" && r.data?.application === app.id);
  expect(order.author).toBe("tribunal-member-system");
  expect(order.data).toMatchObject({ finding: "possession", against: tenant, applicant: landlord, about: alone.id });
  // (Fourteen days from the hearing, where the member decides. The seat files the order at its next sitting: the same
  // moment where the hearing falls in its office hours, as in the TS world's draws; on the Rust world's (2026-10-18) it
  // fell on a day the seat was not at its desk, and the order dated at the hearing was filed two days later, giving 12
  // days from its filing. What the law asks of the order is the fourteen days from the hearing.)
  expect(order.data.due - listed.data.hearing_at).toBe(14 * DAY);
  expect(order.at).toBeGreaterThanOrEqual(listed.data.hearing_at);
  expect(order.at - listed.data.hearing_at).toBeLessThan(7 * DAY);
  const request = recs.find((r) => r.kind === "warrant_request" && r.data?.order === order.id);
  expect(request.at).toBeGreaterThan(order.data.due);
  const warrant = recs.find((r) => r.kind === "warrant" && r.data?.order === order.id);
  expect(warrant.author).toBe("tribunal-registrar-system");
  expect(warrant.addressed_to).toEqual(["police"]);
  const done = recs.find((r) => r.kind === "warrant_executed" && r.data?.warrant === warrant.id);
  expect(done.speaks_for).toBe("police");
  expect(done.at).toBeGreaterThanOrEqual(warrant.data.not_before);
  // The tenant is out, by the police and nobody else.
  const outOf = ev.filter((e) => e.event === "vacated" && e.occupant === tenant && e.t > ntv.at);
  expect(outOf.length).toBeGreaterThan(0);
  // Every one of those papers was made on its office's form, and no seat made a typed paper off its forms.
  expect([...did(acts, seats[0]!).forms.keys()]).toEqual(expect.arrayContaining(["notice_to_vacate", "possession_application", "warrant_request"]));
  expect([...did(acts, "tribunal-member").forms.keys()]).toEqual(expect.arrayContaining(["hearing_notice", "possession_order"]));
  expect([...did(acts, "tribunal-registrar").forms.keys()]).toContain("warrant");
  expect(offForm(acts, seats)).toEqual([]);
}, 900_000);

test("in a living town the tribunal's registry staff list the cases and the member decides them; what a landlord does reaches the tenant's record", async () => {
  let seats: string[] = [];
  const { config, alone, tenant, landlord } = town({ living: { initiative_bps: 10_000, friction_bps: 10_000 } }, (l) => (seats = [`${l}-office`, "tribunal-member", "tribunal-registrar"]));
  // The registry: a staff post run by the tribunal's own code, with a standing order in force when the year begins;
  // and the tribunal's notice of what it hears is on file, so that whoever has a matter can bring it.
  expect(config.positions.find((p: any) => p.id === "tribunal-member-staff").role_module).toMatchObject({ code: "tribunal.member", params: { part: "staff" } });
  expect(config.world.records.find((r: any) => r.id === "order-tribunal-member-answer")?.kind).toBe("work_order");
  // (One notice for each fee it charges, foundations F8: a refused claim's appeal is the law's, at the law's fee, beside its other lists.)
  const notices = config.world.records.filter((r: any) => /^notice-tribunal-member-hearing(-\d+)?$/.test(r.id));
  expect(notices.length).toBeGreaterThan(0);
  for (const hears of notices) expect(hears.visible_to).toBe("public");
  expect(notices.flatMap((n: any) => n.offer.hears.map((h: any) => h.about))).toEqual(expect.arrayContaining(["possession", "arrears", "disrepair", "claim_refused"]));
  const { recs, acts } = await run("seat-acts-registry", config, 200);
  expect(recs.filter((r) => r.kind === "hearing" && r.speaks_for === "tribunal").length).toBe(0); // on file from the start, and not said again
  const app = recs.find((r) => r.kind === "tribunal_application" && r.data?.kind === "possession" && r.data.about === alone.id);
  expect(app).toBeDefined();
  // Listed by the staff, on the day it came or the next; decided by the member, on its form, on or after the day to answer by.
  const listed = recs.find((r) => r.kind === "hearing_notice" && r.data?.application === app.id);
  expect(listed.in_position).toBe("tribunal-member-staff"); // (the registry staff are residents: the paper names the post it was made in)
  expect(listed.at - app.at).toBeLessThan(2 * DAY);
  const order = recs.find((r) => r.kind === "tribunal_order" && r.data?.application === app.id);
  expect(order.author).toBe("tribunal-member-system");
  // (On or after its day: a member who sits in the morning decides what that day's list has, 2026-10-12.)
  expect(Math.floor(order.at / DAY)).toBeGreaterThanOrEqual(Math.floor(listed.data.answer_by / DAY));
  expect(order.data.finding).toBe("possession");
  const member = did(acts, "tribunal-member");
  expect(member.forms.has("hearing_notice")).toBe(false);
  expect(member.forms.get("possession_order")).toBeGreaterThan(0);
  expect(recs.some((r) => r.kind === "staff_report" && r.in_position === "tribunal-member-staff" && /answered at the counter: \d+ tribunal application/.test(r.text))).toBe(true);
  // The landlord's seat asked for the rent on its form before it gave notice (a living town's landlord does).
  const asked = recs.find((r) => r.kind === "review_request" && r.data?.matter === "arrears" && r.data.about === alone.id);
  expect(asked.author).toBe(`${seats[0]}-system`);
  expect(did(acts, seats[0]!).forms.get("rent_reminder")).toBeGreaterThan(0);
  expect(offForm(acts, seats)).toEqual([]);
  expect(landlord).toBe(asked.speaks_for);
  expect(tenant).toBe(order.data.against);
}, 900_000);

/** What the log keeps of one person's record: each reason given for a change to it, and the record as last set. */
async function recordOf(name: string, config: any, person: string, days: number) {
  const out = mkdtempSync(join(tmpdir(), `oikos-${name}-`));
  try {
    const s = await runWorld({ config: { ...config, log: { ...config.log, detail: "lean" } }, runId: name, outDir: out, until: days * DAY, recordObservations: "none" });
    const because: any[] = [];
    let last: any, first: any;
    const who = config.participants.find((p: any) => p.person === person).id;
    for (const l of readFileSync(s.logPath, "utf8").split("\n")) {
      if (!l.includes('"command":"entity_record"') || !l.includes(`"${who}"`)) continue;
      const b = JSON.parse(l).body;
      if (b.participant !== who) continue;
      because.push(...(b.because ?? []));
      last = { ...last, ...b.set };
      if (b.set?.trust) first ??= b.set.trust;
    }
    return { because, last, first };
  } finally { rmSync(out, { recursive: true, force: true }); }
}

test("what a landlord does to a tenant reaches the tenant's record the same whether a seat or code holds the letting office", async () => {
  // (The third living pilot: six of eight tenants in arrears showed no change in their record after a seated landlord's
  // reminders, notices and applications; and the "notice" want, 320 in the pilot before, was born for nobody.)
  const living = { living: { initiative_bps: 10_000, friction_bps: 10_000 } };
  const code = town(living, () => []);
  const seat = town(living, (l) => [`${l}-office`]);
  expect(seat.tenant).toBe(code.tenant);
  const [a, b] = await Promise.all([recordOf("seat-acts-record-code", code.config, code.tenant, 120), recordOf("seat-acts-record-seat", seat.config, seat.tenant, 120)]);
  for (const r of [a, b]) {
    // Given notice to vacate: the want about it is born, once; and trust in the landlord has fallen from where it began.
    expect(r.because.filter((x) => x.what === "want_born" && x.about === "notice").length).toBe(1);
  }
  // Trust in the landlord has fallen from where the record first had it, in both towns.
  const inLandlord = (t: any) => Number((t?.in ?? []).find((x: any) => x.in === code.landlord)?.bps);
  for (const r of [a, b]) expect(inLandlord(r.last.trust)).toBeLessThan(inLandlord(r.first));
  const kinds = (r: any) => [...new Set(r.because.map((x: any) => `${x.what}:${x.about}`).filter((k: string) => /notice|arrears|shelter/.test(k)))].sort();
  expect(kinds(b)).toEqual(kinds(a));
}, 900_000);
