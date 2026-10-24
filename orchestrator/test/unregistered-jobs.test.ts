// Jobs an employer does not register (docs/behaviour/firms.md, "Jobs an employer does not register"): a profile states,
// by kind of firm, the share of jobs that are registered. A job outside it is paid whole, nothing is withheld from it,
// and no report names its worker: so whoever keeps a record of contributions has none for them. Nothing else says
// which jobs these are but the employer's own note.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { taxLawOf, withholding } from "@oikos/participants";
import { generate, generateFrom } from "@oikos/worlds/generator/generate";
import { loadProfile } from "@oikos/worlds/generator/profile";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const base = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
// A place with a contribution reported worker by worker and a payment reckoned from that record.
const PLACE = "de-ni-2026";

function town(registered: { shop?: number; factory?: number; construction?: number } | undefined) {
  const P = structuredClone(loadProfile(PLACE));
  if (registered) P.values.employment = { ...(P.values.employment ?? {}), registered_bps: registered };
  return generateFrom({ ...base, profile: PLACE }, P);
}

test("a profile that states no share makes the town it always made", () => {
  expect(JSON.stringify(town(undefined))).toBe(JSON.stringify(generate({ ...base, profile: PLACE })));
  // (And a share of all of them is every job registered: no note, every wage order net.)
  const all = town({ shop: 10_000, factory: 10_000, construction: 10_000 });
  expect(all.world.records.filter((r: any) => r.kind === "off_books")).toEqual([]);
  expect(JSON.stringify(all.world.records)).toBe(JSON.stringify(town(undefined).world.records));
});

test("the generator refuses a share that is not one", () => {
  expect(() => town({ shop: 12_000 })).toThrow(/registered_bps\.shop/);
});

test("an unregistered job is paid whole and reported to nobody; a registered one is withheld from and reported", async () => {
  // No shop registers anyone; factories register half their jobs; the builder all of its.
  const config = town({ shop: 0, factory: 5_000 });
  // (One shop opens a hand short, so that someone is taken on in the run: whether anyone leaves a shop in 100 days is the
  // town's draw, and since 2026-10-24 (who works drawn with their household, ME-17) nobody does in this one.)
  {
    const recs = config.world.records as any[];
    const job = recs.find((r) => r.record === "agreement" && r.terms?.template === "employment" && String(r.terms.parties[0]).startsWith("shop-"));
    const worker = job.terms.parties[1];
    config.world.records = recs.filter((r) => r.id !== job.id && r.agreement !== job.id && r.basis !== job.id);
    config.world.occupancy = config.world.occupancy.filter((o: any) => !(o.occupant === worker && String(o.space).startsWith(job.terms.parties[0])));
  }
  const out = join(root, "runs", "test-unregistered-jobs");
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config, runId: "unregistered-jobs", outDir: out, until: 100 * DAY });
  const log = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  expect(log.filter((e) => e.kind === "annotation" && (e.body.data?.call_unresolved || e.body.data?.call_unreadable)).map((e) => e.body.data)).toEqual([]);
  const ev = log.filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
  const recs = ev.filter((e) => e.event === "recorded").map((e) => e.record);
  const all = [...config.world.records, ...recs];
  const lawRecord = config.world.records.find((r: any) => r.id === "law-income-tax");
  const law = taxLawOf(lawRecord.id, lawRecord.data, lawRecord.speaks_for)!;

  const jobs = new Map<string, any>(all.filter((r: any) => r.record === "agreement" && r.terms.template === "employment").map((a: any) => [a.id, a]));
  const notes = all.filter((r: any) => r.kind === "off_books");
  const off = new Set<string>(notes.map((n: any) => n.data.agreement));
  // The employer's own note, seen by nobody else: neither the worker, nor the bank, nor any office.
  for (const n of notes) expect(n.visible_to).toEqual([n.speaks_for]);
  // Every shop job is off the books, from the start and for those hired since; about half the factories'; none of
  // the builder's or of a public body's.
  const employerOf = (a: any) => a.terms.parties[0] as string;
  const signed = new Set(all.filter((r: any) => r.record === "signature").map((r: any) => `${r.agreement}|${r.speaks_for}`));
  const taken = [...jobs.values()].filter((a) => signed.has(`${a.id}|${a.terms.parties[1]}`));
  const wageOrders = all.filter((r: any) => r.record === "statement" && r.kind === "request" && jobs.has(r.basis) && r.data?.every);
  const paidBy = new Set(wageOrders.map((o: any) => o.basis));
  const shopJobs = taken.filter((a) => employerOf(a).startsWith("shop-") && paidBy.has(a.id));
  expect(shopJobs.length).toBeGreaterThan(5);
  expect(shopJobs.every((a) => off.has(a.id))).toBe(true);
  expect(shopJobs.some((a) => a.at > 0)).toBe(true); // (someone a shop took on during the run)
  const factoryJobs = taken.filter((a) => employerOf(a).startsWith("factory-") && paidBy.has(a.id));
  const factoryOff = factoryJobs.filter((a) => off.has(a.id)).length;
  expect(factoryOff).toBeGreaterThan(factoryJobs.length * 0.3);
  expect(factoryOff).toBeLessThan(factoryJobs.length * 0.7);
  expect([...off].every((id) => /^(shop|factory)-/.test(employerOf(jobs.get(id))))).toBe(true);

  // Wages: an unregistered job's order pays the wage agreed, whole; a registered one's, less what the law withholds.
  const eas = recs.filter((r) => r.kind === "enterprise_agreement");
  let whole = 0, net = 0;
  // (An employer that cut the hours of a job pays what the hours come to, not the agreement's wage: left out.)
  const cut = new Set(recs.filter((r) => r.kind === "hours_notice").map((r) => r.basis));
  for (const o of wageOrders.filter((x) => !cut.has(x.basis))) {
    const a = jobs.get(o.basis);
    const pays = a.terms.commitments.find((c: any) => c.who === employerOf(a));
    let gross = Number(pays.does.outcome.money.amount);
    // (A rise reaches those on the staff when it is made: someone offered a job before it who signs after it starts on
    // the wage their agreement says.)
    const joined = Math.max(a.at, ...all.filter((r: any) => r.record === "signature" && r.agreement === a.id).map((r: any) => r.at));
    for (const ea of eas.filter((x) => x.data.employer === employerOf(a) && x.at <= o.at && x.at >= joined)) gross = Math.floor((gross * (10_000 + ea.data.rise_bps)) / 10_000);
    // (A hire whose signature and a rise of the employer's fall within the hour: a manager who is a person takes the two acts one after the other, a
    // quarter of an hour each (foundations F5), and which came first is the order they were taken in, not what the rule says. Left out.)
    if (eas.some((x) => x.data.employer === employerOf(a) && Math.abs(x.at - joined) < 3_600)) continue;
    const due = withholding(law, gross, pays.every);
    expect(due).toBeGreaterThan(0);
    expect(Number(o.data.outcome.money.amount)).toBe(off.has(a.id) ? gross : gross - due);
    off.has(a.id) ? whole++ : net++;
  }
  expect(whole).toBeGreaterThan(10);
  expect(net).toBeGreaterThan(10);

  // Reports: a shop, which registers nobody, withholds nothing and sends none. No report names the worker of an
  // unregistered job; factories' reports name their registered workers.
  const reports = recs.filter((r) => r.kind === "withholding_report");
  expect(reports.some((r) => r.speaks_for.startsWith("factory-"))).toBe(true);
  expect(reports.filter((r) => r.speaks_for.startsWith("shop-"))).toEqual([]);
  const offWorkers = new Map([...off].map((id) => [`${employerOf(jobs.get(id))}|${jobs.get(id).terms.parties[1]}`, id]));
  const named = new Set<string>();
  for (const r of reports) for (const line of r.data.staff ?? []) {
    // (Someone taken on again by the same employer, the second time off the books, is a worker of the first job too: it is named for that one.)
    const onBooks = [...jobs.values()].some((j: any) => j.terms.parties[1] === line.worker && employerOf(j) === r.speaks_for && !off.has(j.id) && j.at <= r.at);
    if (!onBooks) expect(offWorkers.has(`${r.speaks_for}|${line.worker}`)).toBe(false);
    named.add(`${r.speaks_for}|${line.worker}`);
  }
  expect([...named].some((x) => x.startsWith("factory-"))).toBe(true);
  // Nothing from a shop reaches the collector's accounts.
  const shopAccounts = new Set(config.world.accounts.filter((a: any) => a.holder.startsWith("shop-")).map((a: any) => a.id));
  expect(ev.filter((e) => e.event === "transfer" && shopAccounts.has(e.from) && String(e.to).startsWith("acc-outside") && /withheld|income tax/i.test(e.memo ?? e.reason ?? ""))).toEqual([]);

  // The consequence, which nothing codes: the insurance's office has no record for someone whose job was never
  // reported, so a claim that turns on a record is refused them. (Whoever claimed in these hundred days.)
  const decisions = recs.filter((r) => r.kind === "benefit_decision" && r.data?.payment === "unemployment-insurance");
  const everRegistered = new Set([...named].map((x) => x.split("|")[1]));
  for (const d of decisions.filter((x) => x.data.granted)) expect(everRegistered.has(d.addressed_to[0])).toBe(true);
}, 600_000);
