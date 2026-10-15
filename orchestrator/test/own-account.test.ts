// People who work for themselves (docs/behaviour/entry.md, "A person working for themself"): a profile states the share
// of people in work who work on their own account, and in what kinds. A town made from it starts with that share (of
// the kinds it can hold: those that trade) each in a business of one, which its owner runs alone from their home or
// from a pitch in the town's market, selling to households as a shop does.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generate, generateFrom } from "@oikos/worlds/generator/generate";
import { loadProfile } from "@oikos/worlds/generator/profile";
import { exportLogs, runQuery } from "@oikos/measure";
import { runWorld } from "../src/run";
import { workStarts } from "./lib/work-starts";

const root = join(import.meta.dir, "../..");
const DAY = 86_400, HOUR = 3_600;
const base = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
const PLACE = "au-vic-2026";
const KINDS = [
  { id: "market-trade", name: "Market trader", does: "trade", share_bps: 3_000, from: "pitch", stock_days: 7 },
  { id: "home-trade", name: "Trader at home", does: "trade", share_bps: 3_000, from: "home", stock_days: 7 },
  { id: "ride", name: "Driver", does: "service", share_bps: 4_000 },
];

function town(share: number | undefined, kinds: object[] = KINDS) {
  const P = structuredClone(loadProfile(PLACE));
  // (Beside what the profile says of employment otherwise: its law on ending a job, how its firms adjust.)
  if (share !== undefined) P.values.employment = { ...(P.values.employment ?? {}), own_account: { share_bps: share, kinds } } as any;
  return generateFrom({ ...base, profile: PLACE }, P);
}

async function run(name: string, config: any, until: number) {
  const out = join(root, "runs", `test-own-account-${name}`);
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config, runId: name, outDir: out, until });
  const log = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  expect(log.filter((e) => e.kind === "annotation" && (e.body.data?.call_unresolved || e.body.data?.call_unreadable)).map((e) => e.body.data)).toEqual([]);
  const ev = log.filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
  return { ev, recs: ev.filter((e) => e.event === "recorded").map((e) => e.record), log: s.logPath, out };
}

test("a profile that states none makes the town it always made; the kinds must add up", () => {
  expect(JSON.stringify(town(undefined))).toBe(JSON.stringify(generate({ ...base, profile: PLACE })));
  expect(() => town(5_000, [{ id: "x", name: "X", does: "trade", share_bps: 9_000 }])).toThrow(/adding to 10,000/);
  // A place whose own-account work is all of kinds the town cannot hold: the town as it always was.
  expect(JSON.stringify(town(5_000, [{ id: "ride", name: "Driver", does: "service", share_bps: 10_000 }]).world.records)).toBe(JSON.stringify(generate({ ...base, profile: PLACE }).world.records));
});

test("the town starts with the stated share in businesses of one, each run by its owner from a home or a pitch", () => {
  const config = town(5_000);
  const firms = config.world.entities.filter((e: any) => e.kind === "own_account");
  const jobs = config.world.records.filter((r: any) => r.record === "agreement" && r.terms.template === "employment");
  // Half of those in work are on their own account, six tenths of them in kinds the town holds: three in ten.
  const share = firms.length / (firms.length + jobs.length);
  // (A small town: about ninety in work, so the share drawn is rough.)
  expect(share).toBeGreaterThan(0.15);
  expect(share).toBeLessThan(0.45);
  const market = config.world.structures.find((x: any) => x.type === "market");
  expect(market).toBeDefined();
  expect(config.world.records.some((r: any) => r.record === "claim" && r.holder === "city" && r.about.object && config.world.records.find((l: any) => l.id === r.about.object)?.data?.cells?.includes(market.at))).toBe(true);
  let atHome = 0, atPitch = 0;
  for (const f of firms) {
    const person = f.id.replace("own-", "");
    // Nobody employs them; they hold their business's only position, and their own participant runs it.
    expect(jobs.some((a: any) => a.terms.parties[1] === person)).toBe(false);
    const pos = config.positions.filter((x: any) => x.entity === f.id);
    expect(pos.map((x: any) => [x.title, x.holder, x.role_module.code, x.role_module.params.operator])).toEqual([["Owner", `${person}-self`, "firm.retailer", person]]);
    expect(config.world.records.find((r: any) => r.id === `shareholders-${f.id}`).data.holders.map((h: any) => h.holder)).toEqual([person]);
    // Where from: their own dwelling, or a pitch of their own in the market.
    const space: string = pos[0].role_module.params.workplace;
    const me = config.participants.find((x: any) => x.id === `${person}-self`).controller.params.own_work;
    expect(me.firm).toBe(f.id);
    if (space.startsWith(`${market.id}/pitch.`)) {
      atPitch++;
      expect(me.at).toBe(space);
    } else {
      atHome++;
      expect(config.world.occupancy.some((o: any) => o.occupant === person && o.space === space)).toBe(true);
      expect(/\/dwelling\.\d+$/.test(space)).toBe(true);
      expect(me.at).toBeUndefined();
      expect(me.home).toBe(space);
    }
    // A few days' stock where it trades, and money for one more buying of it.
    expect(Number(config.world.holdings.find((h: any) => h.holder === f.id).quantity)).toBeGreaterThan(0);
    expect(Number(config.world.accounts.find((a: any) => a.holder === f.id).balance)).toBeGreaterThan(0);
  }
  expect(atHome).toBeGreaterThan(3);
  expect(atPitch).toBeGreaterThan(3);
  // (A pitch each; two of one household may each trade from the home they share.)
  const pitches = firms.map((f: any) => config.positions.find((x: any) => x.entity === f.id).role_module.params.workplace).filter((x: string) => x.startsWith(`${market.id}/`));
  expect(new Set(pitches).size).toBe(pitches.length);
  // Fewer hold jobs, and the factories share those who do: none stands empty.
  for (const f of config.world.entities.filter((e: any) => e.kind === "factory")) expect(jobs.some((a: any) => a.terms.parties[0] === f.id)).toBe(true);
});

test("they sell to households by their own hours, draw what the business clears, and look for no job", async () => {
  const config = town(5_000);
  // (About the businesses the town opens with: nobody starts another in these 90 days. Starting one is orchestrator/test/own-venture.test.ts.)
  for (const p of config.participants) if (p.controller?.impl === "citizen.default") p.controller = { ...p.controller, params: { ...p.controller.params, found_own_ppm: 0 } };
  const { ev, recs, log, out } = await run("town", config, 90 * DAY);
  const firms = new Map<string, string>(config.world.entities.filter((e: any) => e.kind === "own_account").map((e: any) => [e.id, e.id.replace("own-", "")]));
  const placeOf = new Map<string, string>(config.positions.filter((x: any) => firms.has(x.entity)).map((x: any) => [x.entity, x.role_module.params.premises]));
  const market = config.world.structures.find((x: any) => x.type === "market").id;
  // Nothing refused but same-moment races and a day's hours running out (as for any shop).
  const odd = ev.filter((e) => e.event === "action_refused" && !["not_present", "not_at_work", "capacity_exceeded", "no_time_left", "insufficient_quantity", "dead"].includes(e.code));
  expect(odd.map((e) => [e.code, e.detail])).toEqual([]);
  // Selling: at the place the business is worked from, by its owner alone, a working day at most.
  const sold = ev.filter((e) => e.event === "worked" && e.task === "sell");
  expect(sold.length).toBeGreaterThan(100);
  const owners = new Set(firms.values());
  const places = new Set(placeOf.values());
  const perDay = new Map<string, number>();
  // (A day's hours are counted on the day the work starts: it takes the owner's hours, so it takes effect hours later; F1.)
  const startOf = workStarts(ev);
  for (const w of sold) {
    expect(w.performers.length).toBe(1);
    expect(owners.has(w.performers[0])).toBe(true);
    expect(places.has(w.at) || recs.some((r) => r.kind === "trading_from" && r.speaks_for === w.performers[0] && r.data?.structure === w.at)).toBe(true);
    const k = `${w.performers[0]}|${Math.floor(startOf.get(w)! / DAY)}`;
    perDay.set(k, (perDay.get(k) ?? 0) + w.labour);
  }
  expect(Math.max(...perDay.values())).toBeLessThanOrEqual(config.catalogue.working_day);
  expect(sold.some((w) => w.at === market)).toBe(true);
  expect(sold.some((w) => w.at !== market)).toBe(true);
  // At a pitch in working hours only (the round); at home whenever its owner is.
  // (Not every one since foundations F5 (2026-10-16): a person's acts queue on one timeline, so a round decided in the hours can begin
  // an hour or two late behind work still in hand; one in this town begins at 19:14. At most one in a hundred, none long after.)
  const pitchSold = sold.filter((x) => x.at === market);
  let late = 0;
  for (const w of pitchSold) {
    const at = startOf.get(w)!; // (when it was begun: a pitch is worked in the round's hours)
    const hour = Math.floor((at % DAY) / HOUR);
    if (!(hour >= 8 && hour < 18 && Math.floor(at / DAY) % 7 < 5)) { late++; expect(hour >= 8 && hour < 21).toBe(true); }
  }
  expect(late).toBeLessThanOrEqual(Math.ceil(pitchSold.length / 100));
  // Most of them sold something; households' orders reached them as they reach shops.
  const sellers = new Set(sold.map((w) => w.performers[0]));
  expect(sellers.size).toBeGreaterThan(firms.size * 0.7);
  // Their income: what the business holds beyond its stock money, paid to its owner (and to nobody else).
  const accountOf = new Map<string, string>(config.world.accounts.map((a: any) => [a.id, a.holder]));
  const draws = ev.filter((e) => e.event === "transfer" && firms.has(accountOf.get(e.from) ?? "") && accountOf.get(e.to) === firms.get(accountOf.get(e.from)!));
  expect(new Set(draws.map((e) => e.to)).size).toBeGreaterThan(firms.size * 0.6);
  // They take on nobody, apply for no job, and claim nothing for being out of work.
  expect(recs.filter((r) => r.kind === "job_posting" && firms.has(r.speaks_for))).toEqual([]);
  expect(recs.filter((r) => r.kind === "job_application" && owners.has(r.speaks_for))).toEqual([]);
  expect(recs.filter((r) => r.kind === "benefit_claim" && owners.has(r.speaks_for) && r.data?.payment === "unemployment")).toEqual([]);
  // Nothing reaches the tax office from them: no report, nothing paid over.
  expect(recs.filter((r) => r.kind === "withholding_report" && firms.has(r.speaks_for))).toEqual([]);
  // Measured as a labour force survey counts (docs/measurement.md, "Employment"): they are employed, by the work they
  // did and the business they have, though no employment agreement names them; the old series does not see them.
  const m = join(out, "measure");
  await exportLogs([log], m);
  const [sum] = await runQuery(m, "economy/summary");
  const [work] = await runQuery(m, "economy/work");
  const n = (x: unknown) => Number(x);
  expect(n(work!.own_account)).toBeGreaterThan(firms.size - 4);
  expect(n(work!.own_account)).toBeLessThanOrEqual(firms.size);
  expect(n(sum!.employed)).toBe(n(work!.employed));
  expect(n(sum!.employed)).toBeGreaterThanOrEqual(n(sum!.employed_by_agreement) + n(work!.own_account));
  expect(n(sum!.employed_by_agreement)).toBe(n(work!.employees));
  expect(n(work!.informal_employment_pct)).toBeCloseTo((100 * n(work!.own_account)) / n(work!.employed), 0);
  expect(n(sum!.unemployment_pct)).toBeLessThan(n(sum!.unemployment_by_agreement_pct) - 20);
  // An owner who moved home took the business along: told, it sells from the new home after.
  const moved = recs.filter((r) => r.kind === "trading_from" && r.data?.structure);
  for (const r of moved) {
    expect(owners.has(r.speaks_for)).toBe(true);
    const later = sold.filter((w) => w.performers[0] === r.speaks_for && w.t > r.at + DAY && !moved.some((x) => x.speaks_for === r.speaks_for && x.at > r.at && x.at < w.t));
    for (const w of later) expect(w.at).toBe(r.data.structure);
  }
  const perSeller = sold.reduce((x, w) => x + w.units, 0) / firms.size;
  console.log(`own-account: ${firms.size} businesses, ${moved.length} moves of home, ${sellers.size} sold, ${sold.reduce((x, w) => x + w.units, 0)} items in 90 days (${perSeller.toFixed(0)} each), ${draws.length} drawings; shops served ${ev.filter((e) => e.event === "worked" && e.task === "serve").reduce((x, w) => x + w.units, 0)}`);
}, 900_000);
