// Deaths and what follows (D54): those at home see a household member die and report it; the registry registers
// it; the bank stops the dead person's payments and settles the estate by law-succession; employers stop wages;
// landlords give notice; a household picks a new leaseholder; children left with no adult are taken into care.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@terrarium/worlds/generator/generate";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

test("a death is seen, reported, registered, and the world's people act on it", async () => {
  const out = join(root, "runs", "test-deaths");
  rmSync(out, { recursive: true, force: true });
  const config = generate({ ...spec, years: 1 });
  // Far more deaths than life: 15% a year from 25, so a year of a small town has some to follow.
  config.life.other_causes.by_age = [{ from: 0, bps: 0 }, { from: 25, bps: 1500 }];
  const s = await runWorld({ config, runId: "deaths", outDir: out, until: 365 * DAY });
  const ev = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
  const died = ev.filter((e) => e.event === "person_died");
  expect(died.length).toBeGreaterThan(3);
  const regs = new Map<string, any>(ev.filter((e) => e.event === "recorded" && e.record.kind === "death_registration").map((e) => [e.record.data.deceased, { ...e.record, t: e.t }]));
  // Nearly every death at home is registered within a fortnight (someone sees it; a lone person's landlord does).
  // Deaths at home: the body leaves a dwelling as they die.
  const atHome = new Set(ev.filter((e) => e.event === "vacated" && e.reason === "died" && e.space.includes("/dwelling.")).map((e) => e.occupant));
  const early = died.filter((d) => d.t < 365 * DAY - 14 * DAY && atHome.has(d.person));
  const registeredSoon = early.filter((d) => regs.has(d.person) && regs.get(d.person).t - d.t <= 14 * DAY);
  expect(registeredSoon.length).toBeGreaterThanOrEqual(Math.ceil(early.length * 0.8));

  const holder = new Map<string, string>([...config.world.accounts.map((a: any) => [a.id, a.holder]), ...ev.filter((e) => e.event === "account_opened").map((e) => [e.account, e.holder])] as [string, string][]);
  for (const [who, r] of regs) {
    const after = ev.filter((e) => e.event === "transfer" && e.t > r.t + DAY);
    // Nothing leaves the dead person's accounts after registration except to settle the estate.
    for (const x of after.filter((x) => holder.get(x.from) === who)) expect(x.per_instruction).toBe(r.id);
    // Wages stop (the employer withdraws the standing order) within a pay period. (What else comes into the estate, a
    // dividend say, the bank passes on to the heirs.)
    const wageOrders = new Set(ev.filter((e) => e.event === "recorded" && e.record.kind === "request" && /^Wages for /.test(e.record.data?.outcome?.money?.for ?? "")).map((e) => e.record.id));
    for (const o of config.world.records) if (o.kind === "request" && o.data?.outcome?.money?.for === "wages") wageOrders.add(o.id);
    expect(after.filter((x) => holder.get(x.to) === who && x.t > r.t + 15 * DAY && wageOrders.has(x.per_instruction)).length).toBe(0);
  }
  // An estate is left with nothing: what was there, and what comes in later (a dividend), goes on to the heirs, but
  // for anything that came in the last few days.
  const balance = new Map<string, number>(config.world.accounts.map((a: any) => [a.id, Number(a.balance)]));
  const lastIn = new Map<string, number>();
  for (const e of ev.filter((x) => x.event === "transfer")) {
    balance.set(e.from, (balance.get(e.from) ?? 0) - Number(e.amount));
    balance.set(e.to, (balance.get(e.to) ?? 0) + Number(e.amount));
    lastIn.set(e.to, e.t);
  }
  for (const [who, r] of regs) {
    if (r.t > 365 * DAY - 14 * DAY) continue;
    for (const [acc, h] of holder) if (h === who && (lastIn.get(acc) ?? 0) < 365 * DAY - 3 * DAY) expect(balance.get(acc) ?? 0).toBeLessThanOrEqual(0);
  }
  // Estates are settled: something moved under a registration, to a partner, adult children or the town.
  const estates = ev.filter((e) => e.event === "transfer" && [...regs.values()].some((r) => r.id === e.per_instruction));
  expect(estates.length).toBeGreaterThan(0);
  // Landlords give notice on a dead tenant's lease.
  expect(ev.some((e) => e.event === "recorded" && e.record.record === "notice" && e.record.text === "The tenant has died.")).toBe(true);
  // A household whose leaseholder died has a new record, without them, and with another leaseholder.
  const leaseholders = new Set(config.world.records.filter((r: any) => r.kind === "household").map((r: any) => r.data.leaseholder));
  const heldLease = [...regs.keys()].filter((who) => leaseholders.has(who));
  expect(heldLease.length).toBeGreaterThan(0);
  const records = ev.filter((e) => e.event === "recorded" && e.record.kind === "household").map((e) => e.record);
  expect(heldLease.some((who) => records.some((r) => r.data.leaseholder !== who && !r.data.members.some((m: any) => m.person === who)))).toBe(true);
  expect(ev.filter((e) => e.event === "action_refused").map((e) => e.code)).toEqual([]);
}, 300_000);
