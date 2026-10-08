// Work by the day (docs/behaviour/firms.md, "Work by the day"): a profile states, by kind of firm, the share of jobs
// that are taken on and paid by the day. Such a job is an employment agreement whose pay is a day's: paid on each day
// worked by a payment of its own, never by a standing order, and ended by either side without notice.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { dayPayPeriod, taxLawOf, withholding } from "@oikos/participants";
import { generate, generateFrom } from "@oikos/worlds/generator/generate";
import { loadProfile } from "@oikos/worlds/generator/profile";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const base = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
const PLACE = "de-ni-2026";

function town(employment: object | undefined) {
  const P = structuredClone(loadProfile(PLACE));
  if (employment) P.values.employment = employment as any;
  return generateFrom({ ...base, profile: PLACE }, P);
}

test("a profile that states no work by the day makes the town it always made; a share needs a day's pay", () => {
  expect(JSON.stringify(town({ casual_bps: { factory: 0 } }).world.records)).toBe(JSON.stringify(generate({ ...base, profile: PLACE }).world.records));
  expect(() => town({ casual_bps: { factory: 3_000 } })).toThrow(/day_wage\.factory/);
});

test("a hand by the day is paid for each day worked, that day, with no standing order and no notice", async () => {
  const P = loadProfile(PLACE);
  // A day's pay: a tenth of the pay period's wage (the period's ten working days).
  const day = { factory: Math.round(P.values.wages_per_pay_period.factory / 10), construction: Math.round(P.values.wages_per_pay_period.construction / 10) };
  // Every job at the builder's is by the day, and half of those at the factories; shops' are on standing wages.
  const config = town({ casual_bps: { factory: 5_000, construction: 10_000 }, day_wage: day });
  const out = join(root, "runs", "test-day-work");
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config, runId: "day-work", outDir: out, until: 75 * DAY });
  const log = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  expect(log.filter((e) => e.kind === "annotation" && (e.body.data?.call_unresolved || e.body.data?.call_unreadable)).map((e) => e.body.data)).toEqual([]);
  const ev = log.filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
  const recs = ev.filter((e) => e.event === "recorded").map((e) => e.record);
  const all = [...config.world.records, ...recs];
  const lawRecord = config.world.records.find((r: any) => r.id === "law-income-tax");
  const law = taxLawOf(lawRecord.id, lawRecord.data, lawRecord.speaks_for)!;

  const jobs = all.filter((r: any) => r.record === "agreement" && r.terms.template === "employment");
  const paysOf = (a: any) => a.terms.commitments.find((c: any) => c.who === a.terms.parties[0]);
  const byDay = jobs.filter((a: any) => paysOf(a).every === DAY);
  const employers = new Set(byDay.map((a: any) => a.terms.parties[0] as string));
  // Whose: the builder's, all of them; about half the factories'; no shop's and no public body's.
  expect([...employers].every((e) => e === "builder" || e.startsWith("factory-"))).toBe(true);
  const atStart = (prefix: string) => jobs.filter((a: any) => a.at === 0 && a.terms.parties[0].startsWith(prefix));
  expect(atStart("builder").length).toBeGreaterThan(0);
  expect(atStart("builder").every((a: any) => paysOf(a).every === DAY)).toBe(true);
  const f = atStart("factory-");
  const share = f.filter((a: any) => paysOf(a).every === DAY).length / f.length;
  expect(share).toBeGreaterThan(0.3);
  expect(share).toBeLessThan(0.7);
  // Its terms: a day's pay, and notice of nothing from either side.
  for (const a of byDay) {
    expect(Number(paysOf(a).does.outcome.money.amount)).toBeGreaterThan(0);
    expect(a.terms.termination.map((x: any) => x.notice)).toEqual([1, 1]);
  }
  // No standing order pays a hand by the day.
  const dayIds = new Set(byDay.map((a: any) => a.id));
  expect(all.filter((r: any) => r.kind === "request" && r.data?.every && dayIds.has(r.basis))).toEqual([]);

  // Paid by the day: one payment a hand a day at most, on working days only, of the day's pay less what the law
  // withholds from a day's pay.
  const accountOf = new Map<string, string>(config.world.accounts.map((a: any) => [a.holder, a.id]));
  // (A payment is an instruction to the bank, which carries it out: the transfer names the instruction.)
  const asked = new Map<string, any>(recs.filter((r) => r.kind === "request" && /^A day's work: /.test(r.data?.outcome?.money?.for ?? "")).map((r) => [r.id, r]));
  const pays = ev.filter((e) => e.event === "transfer" && asked.has(e.per_instruction)).map((e) => ({ ...e, reason: asked.get(e.per_instruction).data.outcome.money.for }));
  expect(pays.length).toBeGreaterThan(200);
  const seen = new Set<string>();
  for (const x of pays) {
    const worker = /^A day's work: (\S+)\.$/.exec(x.reason ?? x.memo)![1]!;
    const a = byDay.find((j: any) => j.id === asked.get(x.per_instruction).basis && j.terms.parties[1] === worker && accountOf.get(j.terms.parties[0]) === x.from)!;
    expect(a).toBeDefined();
    // (The day's pay agreed, raised by any enterprise agreement at that employer since: docs/behaviour/unions.md.)
    let gross = Number(paysOf(a).does.outcome.money.amount);
    for (const ea of recs.filter((r) => r.kind === "enterprise_agreement" && r.data.employer === a.terms.parties[0] && r.at >= a.at && r.at <= asked.get(x.per_instruction).at)) gross = Math.floor((gross * (10_000 + ea.data.rise_bps)) / 10_000);
    expect(Number(x.amount)).toBe(gross - withholding(law, gross, dayPayPeriod(5)));
    const d = Math.floor(x.t / DAY);
    expect(d % 7).toBeLessThan(5);
    expect(seen.has(`${worker}|${d}`)).toBe(false);
    seen.add(`${worker}|${d}`);
  }
  // A factory hand who stayed was paid on most working days; nobody on more days than there were.
  const perHand = new Map<string, number>();
  for (const k of seen) perHand.set(k.split("|")[0]!, (perHand.get(k.split("|")[0]!) ?? 0) + 1);
  const workingDays = Array.from({ length: 75 }, (_, d) => d).filter((d) => d % 7 < 5).length;
  expect(Math.max(...perHand.values())).toBeLessThanOrEqual(workingDays);
  const factoryHands = byDay.filter((a: any) => a.at === 0 && a.terms.parties[0].startsWith("factory-")).map((a: any) => a.terms.parties[1]);
  const steady = factoryHands.filter((w: string) => (perHand.get(w) ?? 0) >= workingDays - 10);
  expect(steady.length).toBeGreaterThan(factoryHands.length / 2);
  // What was withheld from the days' pay is reported and paid over with the rest.
  expect(recs.some((r) => r.kind === "withholding_report" && r.speaks_for.startsWith("factory-") && r.data.paid > 0)).toBe(true);
  // Nobody claims wages for days not worked: no debt is recorded against an employer by a hand by the day.
  const hands = new Set(byDay.map((a: any) => a.terms.parties[1]));
  expect(recs.filter((r) => r.record === "claim" && r.about?.kind === "debt" && /Unpaid wages/.test(r.about?.for ?? "") && hands.has(r.holder) && dayIds.has(r.basis))).toEqual([]);
  // A notice on such a job ends it at once (within the hour: the kernel's tick).
  const notices = recs.filter((r) => r.record === "notice" && dayIds.has(r.agreement));
  for (const n of notices) expect(pays.some((x) => new RegExp(`: ${byDay.find((a: any) => a.id === n.agreement)!.terms.parties[1]}\\.$`).test(x.reason ?? x.memo) && x.t > n.at + DAY && accountOf.get(byDay.find((a: any) => a.id === n.agreement)!.terms.parties[0]) === x.from && !byDay.some((b: any) => b.id !== n.agreement && b.terms.parties[1] === byDay.find((a: any) => a.id === n.agreement)!.terms.parties[1] && b.at > n.at))).toBe(false);
  // Someone was taken on by the day during the run, from a posting that said so.
  const posts = recs.filter((r) => r.kind === "job_posting" && r.data?.by_the_day);
  console.log(`day-work: ${byDay.length} jobs by the day (${byDay.filter((a: any) => a.at > 0).length} taken on in the run), ${pays.length} days paid, ${notices.length} ended, ${posts.length} postings by the day`);
  if (posts.length) expect(posts.every((r) => r.data.period === DAY && r.offer.terms.termination.every((x: any) => x.notice === 1))).toBe(true);
}, 600_000);
