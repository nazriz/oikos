// The other offices' opening caseload (docs/behaviour/generator.md, "The other offices' caseload"): support claims in
// hand and refusals asked about, complaints before the town's desks, permit applications before planning, invoices
// unpaid at finance, loans behind at the bank. Off: the town is the town it was, to the state hash. On: each office's
// code acts on the papers on its first days, and its clerk's books list them.

import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
const town = (over: object = {}) => ({ ...spec, seed: 2, citizens: 300, profile: "au-vic-2026", living: { initiative_bps: 10_000, friction_bps: 10_000 }, ...over });
// (The world as it was before the payments carried a budget line: the line the town's opening wage orders now name is left out, as
// it was not there; docs/decisions.md, "Payments carry their budget line".)
const worldHash = (c: any) => createHash("sha256").update(JSON.stringify(c.world, (k, v) => (k === "line" ? undefined : v))).digest("hex");
const OTHERS = ["benefit_claim", "benefit_decision", "review_request", "application", "complaint_notice", "permit_application", "invoice", "loan_statement", "loan_arrears"];
const ofOthers = (c: any) => c.world.records.filter((r: any) => OTHERS.includes(r.kind) && r.data?.brought_forward);

test("off, a town is unchanged to the state hash (the world as origin/main generated it); the option alone adds only the new offices' papers", () => {
  // (Hashes of `config.world` for these specs, taken on origin/main (1f28843) before the change. Moved on purpose,
  // 2026-10-13, by generator 0.54.0: every town whose profile states one now publishes its law on cutting hours,
  // `law-cutting-hours`, and the modules' versions; docs/decisions.md, "Hours before heads". Nothing of the opening caseload in it.)
  // (Re-taken on 2026-10-16 at foundations F5: the town's offices are held by people, their staff hired, its systems delivered from templates that say what they do; 4e1e761a... until then.)
  // (Re-taken on 2026-10-16 at foundations F8: the support office asks for papers before it decides, looks at a refusal again when asked, and the tribunal hears an appeal at the law's fee; the profile's routes are published as `law-decisions`; 02ce106f..., 0236786b... until then.)
  // (Re-taken on 2026-10-17 at foundations F9 and F10: three public forms for what a person files with an office that decides, and a row of the table of work for `take`; c1bfd56e... and be56fcce... until then.)
  expect(worldHash(generate(town()))).toBe("2d57fb3ab9e6919197b673b29809e5b5f6b8fd8940a3a5de92f51850f0644606");
  // (Re-taken on 2026-10-16 at foundations F5: the town's offices are held by people, their staff hired, its systems delivered from templates that say what they do; f16bee9e... until then.)
  expect(worldHash(generate(town({ profile: "ke-nakuru-2026" })))).toBe("25c61c59e45327d6d7dd016aaa003baf5c0269814a9f76092388a94b2bf1ca02");
  // (On, the landlords' and the tribunal's papers are as they were; a scale of nothing adds no paper to the other offices.)
  const POSS = ["rent_statement", "notice_to_vacate", "tribunal_application", "hearing_notice", "tribunal_order"];
  const possession = (c: any) => createHash("sha256").update(JSON.stringify(c.world.records.filter((r: any) => POSS.includes(r.kind)))).digest("hex");
  expect(possession(generate(town({ opening_caseload: true })))).toBe("4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945");
  // (Re-taken on 2026-10-16 at foundations F5: the town's offices are held by people, their staff hired, its systems delivered from templates that say what they do; e07d6054... until then.)
  expect(possession(generate(town({ profile: "ke-nakuru-2026", opening_caseload: true })))).toBe("8694a655b15779eb25eda954f9bab1d454cf890650d118c1f34add057d53f3fc");
  const nothing = generate(town({ opening_caseload: true, opening_caseload_scale_bps: 0 })) as any;
  expect(ofOthers(nothing).filter((r: any) => !r.id.startsWith("claim-") && !r.id.startsWith("grant-"))).toEqual([]);
  // (A town is a twin of itself: the same description and seed give the same town.)
  const a = generate(town({ opening_caseload: true, opening_caseload_scale_bps: 300_000 })) as any, b = generate(town({ opening_caseload: true, opening_caseload_scale_bps: 300_000 })) as any;
  expect(worldHash(a)).toBe(worldHash(b));
});

test("each office's count follows the town's own flow: the dial scales it, nothing else does", () => {
  const n = (scale: number, kind: string) => ofOthers(generate(town({ seed: 5, opening_caseload: true, opening_caseload_scale_bps: scale })) as any).filter((r: any) => r.kind === kind).length;
  // (Complaints: the profile's share of adults a year, less what asking settles, over the days the desk allows to answer.)
  expect(n(10_000, "application")).toBeLessThan(n(100_000, "application"));
  expect(n(100_000, "application")).toBeLessThan(n(1_000_000, "application"));
  expect(n(1_000_000, "application")).toBe(n(1_000_000, "complaint_notice"));
  // (Every complaint's notice gives its other side a day to answer within the desk's `answer_days`, spread, not all on one day.)
  const c = generate(town({ opening_caseload: true, opening_caseload_scale_bps: 1_000_000 })) as any;
  const days = new Set<number>(c.world.records.filter((r: any) => r.kind === "complaint_notice").map((r: any) => Math.floor(r.data.answer_by / DAY)));
  expect(days.size).toBeGreaterThan(8);
  expect(Math.max(...days)).toBeLessThanOrEqual(14);
  // (A profile with no landfill charge has no landfill invoice; one with it has some.)
  expect(ofOthers(generate(town({ profile: "ke-nakuru-2026", opening_caseload: true, opening_caseload_scale_bps: 1_000_000 }))).filter((r: any) => r.kind === "invoice")).toEqual([]);
  expect(ofOthers(c).filter((r: any) => r.kind === "invoice").length).toBeGreaterThan(0);
});

type Recs = { recs: any[]; events: any[]; config: any };
async function run(config: any, days: number): Promise<Recs> {
  const out = mkdtempSync(join(tmpdir(), "oikos-caseload-"));
  const recs: any[] = [], events: any[] = [];
  try {
    const s = await runWorld({ config: { ...config, log: { ...config.log, detail: "lean" } }, runId: "caseload", outDir: out, until: days * DAY, recordObservations: "none" });
    expect(s.participantErrors).toBe(0);
    for (const l of readFileSync(s.logPath, "utf8").split("\n")) {
      if (l.includes('"event":"recorded"')) { const r = JSON.parse(l).body.record; if (r?.record === "statement") recs.push(r); } else if (l.includes('"event":"transfer"')) { const e = JSON.parse(l); events.push({ t: e.t, ...e.body }); }
    }
  } finally { rmSync(out, { recursive: true, force: true }); }
  return { recs, events, config };
}

test("code offices act on the opening papers as on papers made in a run: complaints heard, permits decided, invoices paid, a review answered", async () => {
  const config = generate(town({ opening_caseload: true, opening_caseload_scale_bps: 1_000_000 })) as any;
  const born = ofOthers(config);
  const { recs, events } = await run(config, 30);
  // Support: no claim is in hand when the year begins (the office decides what it has the day it sees it: foundations F6, which took out the
  // processing time that kept claims waiting); what is on its desk is the reviews asked for of refusals, below.
  expect(born.filter((r: any) => r.kind === "benefit_claim" && !born.some((d: any) => d.kind === "benefit_decision" && d.data.claim === r.id)).length).toBe(0);
  // Support: a refusal asked about is answered; a refusal already decided is not decided again, unless it is looked at again on the request (foundations F8:
  // the office puts a refusal it finds wrong right itself, by a new decision on the same claim that says it is on review, and a record of the review).
  const refused = born.filter((r: any) => r.kind === "benefit_decision" && r.data.granted === false);
  expect(refused.length).toBeGreaterThan(3);
  for (const d of refused) {
    const again = recs.filter((r) => r.kind === "benefit_decision" && r.data?.claim === d.data.claim);
    for (const a of again) expect(a.data.on_review, `${d.id}: decided again only on a review`).toBeDefined();
    expect(again.length, d.id).toBeLessThanOrEqual(1);
    // (Put right on a review, which is on record; or on a venue's setting the refusal aside, which is its decision.)
    if (again.length) expect(recs.some((r) => (r.kind === "decision_review" && r.data?.decision === d.id && r.data?.outcome === "changed") || ((r.kind === "venue_decision" || r.kind === "tribunal_order") && r.data?.about === d.id && r.data?.finding === "set_aside")), `${d.id}: the review or the order that set it aside is on record`).toBe(true);
  }
  expect(recs.filter((r) => r.kind === "decision_review").length, "reviews were asked for and answered").toBeGreaterThan(0);
  // The desks: every application is decided once, after the time its notice gave the other side; nobody applies a second time.
  const apps = born.filter((r: any) => r.kind === "application");
  expect(apps.length).toBeGreaterThan(20);
  const decisions = recs.filter((r) => r.kind === "venue_decision");
  for (const a of apps) {
    const ds = decisions.filter((r) => r.data?.application === a.id);
    expect(ds.length, a.id).toBe(1);
    const notice = born.find((r: any) => r.kind === "complaint_notice" && r.data.application === a.id);
    expect(ds[0].at, a.id).toBeGreaterThanOrEqual(notice.data.answer_by - DAY);
    expect(recs.filter((r) => r.kind === "application" && r.speaks_for === a.speaks_for && r.data?.matter === a.data.matter).length, `${a.speaks_for} applies again`).toBe(0);
  }
  // Planning decides its application on its next sitting.
  for (const p of born.filter((r: any) => r.kind === "permit_application")) {
    const d = recs.filter((r) => r.kind === "permit_decision" && r.data?.application === p.id);
    expect(d.length, p.id).toBe(1);
    expect(d[0].at).toBeLessThanOrEqual(7 * DAY);
  }
  // Finance pays each invoice (within the budget) within its sitting's three days.
  const invoices = born.filter((r: any) => r.kind === "invoice");
  expect(invoices.length).toBeGreaterThan(0);
  for (const i of invoices) {
    const paid = events.filter((e) => e.settles === i.id);
    expect(paid.length, i.id).toBe(1);
    expect(paid[0].t).toBeLessThanOrEqual(3 * DAY + 3600);
  }
}, 120_000);

test("each seat's clerk lists the opening papers in the office's books by the first days, as the code acts on them", async () => {
  const base = generate(town({ opening_caseload: true, opening_caseload_scale_bps: 1_000_000 })) as any;
  const born = ofOthers(base);
  const seats = ["outside-support", "complaints", "ombudsman-officer", "consumer-officer", "planning", "finance"];
  const config = generate(town({ opening_caseload: true, opening_caseload_scale_bps: 1_000_000, mayor: "llm", model_seats: seats })) as any;
  for (const p of config.participants) if (p.controller?.type === "llm") p.controller.params.mock = { ...p.controller.params.mock, back_days: 3 };
  const { recs } = await run(config, 4);
  const firstBooks = (office: string) => recs.filter((r) => r.kind === "office_books" && r.data.office === office).sort((a, b) => a.at - b.at)[0];
  const words = (office: string) => { const b = firstBooks(office); return b ? `${b.text} ${JSON.stringify(b.data.open)}` : ""; };
  const names = (w: string, id: string) => new RegExp(`(^|[^A-Za-z0-9.-])${id.replace(/[.]/g, "\\.")}($|[^A-Za-z0-9-])`).test(w);
  // The desks: every notice on file is on the desk's books with the day the other side may answer by.
  for (const [office, matters] of [["complaints", ["disrepair"]], ["ombudsman-officer", ["bill", "claim_refused"]], ["consumer-officer", ["goods"]]] as const) {
    const ours = born.filter((r: any) => r.kind === "complaint_notice" && (matters as readonly string[]).includes(r.data.matter));
    expect(ours.length, office).toBeGreaterThan(0);
    for (const n of ours) expect(names(words(office), n.id), `${office} lists ${n.id}`).toBe(true);
    expect(words(office)).toContain("year 1, day");
  }
  // The other side of a claim refused sees the complaint against it, naming the day it has to answer.
  expect(born.some((r: any) => r.kind === "complaint_notice" && r.data.matter === "claim_refused")).toBe(true);
  expect(words("outside-support")).toContain("Complaints against us before a body that hears them");
  for (const n of born.filter((r: any) => r.kind === "complaint_notice" && r.data.matter === "claim_refused")) expect(names(words("outside-support"), n.id), `support lists ${n.id}`).toBe(true);
  // Planning and finance: the application, and each invoice, dated before the year, as they are.
  for (const p of born.filter((r: any) => r.kind === "permit_application")) expect(names(words("planning"), p.id)).toBe(true);
  expect(words("planning")).toContain("before the year began");
  for (const i of born.filter((r: any) => r.kind === "invoice")) expect(names(words("finance"), i.id), i.id).toBe(true);
  expect(words("finance")).toContain("before the year began");
}, 120_000);

test("a loan behind when the year begins: the bank's code and its clerk count it from its statement, and the letter on file is not sent again", async () => {
  const base = generate(town({ opening_caseload: true })) as any;
  const mortgages = base.world.records.filter((r: any) => r.record === "agreement" && r.terms?.template === "loan");
  expect(mortgages.length).toBeGreaterThan(3);
  // (No mortgage is behind in these towns on the first day: each was sized within the income its household has.
  // So that the readers are held to something, a household is made to fall behind by hand: the papers the generator
  // writes for a loan behind, for three of them, at each stage.)
  // (A loan is behind by k repayments when the earliest fell due 30k less its borrower's repayment day before the year.)
  const dayOf = (l: any) => l.terms.attrs.first_due / DAY;
  const early = mortgages.find((l: any) => dayOf(l) <= 20)!, others = mortgages.filter((l: any) => l !== early);
  const loans: any[] = [early, others[0], others[1]];
  const stage = [1, 2, 3].map((k, i) => { const ago = 30 * k - dayOf(loans[i]); return { k, ago, lettered: ago >= 30 }; });
  const config = JSON.parse(JSON.stringify(base));
  loans.forEach((l: any, i: number) => {
    const payment = Number(l.terms.commitments.find((c: any) => c.who !== "bank").does.outcome.money.amount), who = l.terms.parties[1], { k, ago, lettered } = stage[i]!;
    const p = { record: "statement", author: "genesis", at: 0, visible_to: ["bank", who], speaks_for: "bank", addressed_to: [who], basis: l.id };
    config.world.records.push({ ...p, id: `${l.id}-statement`, kind: "loan_statement", text: `Statement of the loan account under ${l.id}.`, data: { loan: l.id, payments: k, payment, behind: k * payment, since: -ago * DAY, brought_forward: true } });
    if (lettered) config.world.records.push({ ...p, id: `${l.id}-behind`, kind: "loan_arrears", text: `Loan ${l.id}: behind. Please pay.`, data: { loan: l.id, behind: k * payment, since: -(ago - 30) * DAY, brought_forward: true } });
    // (And the household cannot pay: its account holds nothing, so nothing is paid in the run.)
    const acc = config.world.accounts.find((a: any) => a.id === `acc-${who}`);
    if (acc) acc.balance = "0";
  });
  const { recs } = await run(config, 40);
  for (const [i, l] of loans.entries()) {
    const sent = recs.filter((r) => r.kind === "loan_arrears" && r.data?.loan === l.id);
    if (stage[i]!.lettered) expect(sent.length, `${l.id}: the letter on file is not sent again`).toBe(0);
    else expect(sent.length, `${l.id}: a loan first behind ${stage[i]!.ago} days is written to when the bank's days (30) are up`).toBeLessThanOrEqual(1);
  }
  const seatConfig = generate(town({ opening_caseload: true, mayor: "llm", model_seats: ["bank-lending"] })) as any;
  for (const x of ["records", "accounts"] as const) seatConfig.world[x] = config.world[x];
  for (const p of seatConfig.participants) if (p.controller?.type === "llm") p.controller.params.mock = { ...p.controller.params.mock, back_days: 3 };
  const seat = await run(seatConfig, 4);
  const b = seat.recs.filter((r) => r.kind === "office_books" && r.data.office === "bank-lending").sort((x, y) => x.at - y.at)[0];
  expect(b, "the bank's clerk filed its books").toBeTruthy();
  const rows = (b.data.open as any[]).filter((o) => o.what === "Loans behind");
  for (const [i, l] of loans.entries()) {
    const row = rows.find((o) => o.about === l.id);
    expect(row, `${l.id} is on the bank's books as behind`).toBeTruthy();
    expect(row.says).toContain(`${stage[i]!.lettered ? "a letter of arrears is on file" : "no letter of arrears or default notice is on file"}`);
    expect(row.amount).toBeGreaterThanOrEqual(stage[i]!.k * Number(l.terms.commitments.find((c: any) => c.who !== "bank").does.outcome.money.amount));
  }
}, 180_000);
