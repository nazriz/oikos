// Floods and crime (docs/behaviour/floods.md, crime.md; docs/design/world-expansion.md 7), in a generated town.
// Floods: heavy rain swells the river over its banks; buildings beside it go under water, their people moved out to the
// relief centre, and back home once it's gone down. Crime (here far likelier than the profile's, to have some to
// follow): people in need take from their employer's stock; shops find it short at their stocktake and report it;
// the police investigate, find some takers, and charge them; the tribunal orders them to make it good, and they pay.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = { ...(Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any), shop_mix: false /* the single-goods town: this test holds a mechanism of it (docs/risks.md ME-19) */ };

async function run(name: string, config: any, days: number) {
  const out = join(root, "runs", `test-hazards-${name}`);
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config, runId: name, outDir: out, until: days * DAY });
  expect(s.participantErrors).toBe(0);
  const ev = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
  return { ev, recs: ev.filter((e) => e.event === "recorded").map((e) => e.record) };
}

test("heavy rain floods the buildings beside the river; their people go to the relief centre, and home once it's down", async () => {
  // Four times the usual rain from day 20 to day 60.
  const config = generate({ ...spec, years: 1, weather: [{ from_day: 20, bps: 40_000 }, { from_day: 60, bps: 10_000 }] });
  const { ev } = await run("flood", config, 120);
  const flooded = ev.filter((e) => e.event === "flooded");
  expect(flooded.length).toBeGreaterThan(1);
  for (const f of flooded) expect(f.t).toBeGreaterThan(20 * DAY);
  // Beside the river (the town's last two rows), where it spills.
  const rowOf = (sid: string) => Number(config.world.structures.find((x: any) => x.id === sid)?.at.split(".")[2] ?? -1);
  for (const f of flooded) if (rowOf(f.structure) >= 0) expect(rowOf(f.structure)).toBeGreaterThanOrEqual(spec.grid.h - 2);
  // Its people out, and to the relief centre; back once it's receded.
  const out = ev.filter((e) => e.event === "vacated" && e.reason === "flooded");
  expect(out.length).toBeGreaterThan(0);
  expect(ev.some((e) => e.event === "occupied" && e.space === "town-hall/hall.1" && out.some((o) => o.occupant === e.occupant))).toBe(true);
  const receded = ev.filter((e) => e.event === "flood_receded");
  expect(receded.length).toBeGreaterThan(0);
  const home = (r: any) => out.find((o) => o.space.startsWith(`${r.structure}/dwelling`));
  const back = receded.filter((r) => home(r)).some((r) => ev.some((e) => e.event === "occupied" && e.occupant === home(r).occupant && e.space === home(r).space && e.t > r.t));
  if (receded.some((r) => home(r))) expect(back).toBe(true);
  // No rain: no floods.
  const dry = await run("dry", generate({ ...spec, years: 1 }), 60);
  expect(dry.ev.filter((e) => e.event === "flooded" && !String(e.structure).startsWith("str."))).toEqual([]);
}, 2_400_000);

test("taking from work, found at a stocktake, investigated, charged, ordered and paid", async () => {
  const config = generate({ ...spec, years: 1 });
  // (Far likelier than the profile's, and more in need: to have some to follow in a run.)
  const hot = (c: any) => c?.params?.crime && (c.params = { ...c.params, crime: { ...c.params.crime, take_bps: 10_000 }, essentials: 400_000 });
  for (const x of config.participants) hot(x.controller);
  for (const t of config.templates) hot(t.controller);
  const { ev, recs } = await run("crime", config, 200);
  const taken = ev.filter((e) => e.event === "taken");
  expect(taken.length).toBeGreaterThan(5);
  // Each from the taker's own employer, at work.
  for (const e of taken) expect(recs.concat(config.world.records).some((r: any) => r.record === "agreement" && r.terms?.template === "employment" && r.terms.parties[0] === e.from && r.terms.parties[1] === e.by)).toBe(true);
  // Shops report what their stocktake finds short; each report is investigated.
  const reports = recs.filter((r) => r.kind === "crime_report");
  expect(reports.length).toBeGreaterThan(0);
  const charges = recs.filter((r) => r.kind === "tribunal_application" && r.data.kind === "charge");
  const unsolved = recs.filter((r) => r.kind === "investigation_closed");
  // (Each report made a fortnight before the end, by then: officers take them in turn, as their hours allow.)
  const dealt = new Set([...charges, ...unsolved].map((r) => r.data.report));
  expect(reports.filter((r) => r.at < 186 * DAY && !dealt.has(r.id)).map((r) => r.id)).toEqual([]);
  // A charge names someone who did take from that shop; the tribunal orders them to pay; paid.
  for (const c of charges) expect(taken.some((e) => e.by === c.data.against && e.from === c.data.victim)).toBe(true);
  const orders = recs.filter((r) => r.kind === "tribunal_order" && r.data.kind === "charge");
  expect(orders.length).toBe(charges.filter((c) => recs.some((o) => o.kind === "tribunal_order" && o.basis === c.id)).length);
  // Paid by those who can: someone ordered to pay does once they have the sum beside a month's essentials (the
  // citizen's rule; they plan at least weekly), from their own account to the one the order names, the sum ordered.
  // An order left unpaid is one whose debtor never had that much for a week after it.
  // (Until 2026-10-08 this asked only that some order had been paid. Every household was then paid dividends by every
  // firm, so those in need, who are the ones who take, soon had the sum. Firms now pay their owners
  // (docs/behaviour/firm-ownership.md), someone in need may not have it before the run ends, and every order is
  // checked against what its debtor had. Paying under an order in a run is also followed in justice.test.ts.)
  const ESSENTIALS = 400_000; // (as the citizens here were given, above)
  const transfers = ev.filter((e) => e.event === "transfer");
  const end = ev.at(-1)!.t;
  for (const o of orders) {
    const account = `acc-${o.data.against}`;
    const payment = transfers.find((e) => e.settles === o.id);
    if (payment) {
      expect([payment.from, payment.to, Number(payment.amount)]).toEqual([account, o.data.to, o.data.amount]);
      continue;
    }
    let balance = Number(config.world.accounts.find((a: any) => a.id === account)?.balance ?? 0);
    let since: number | null = null;
    let longest = 0;
    const until = (t: number) => {
      if (since !== null) longest = Math.max(longest, t - since);
      since = null;
    };
    const own = transfers.filter((x) => x.from === account || x.to === account);
    const change = (e: any) => (e.to === account ? Number(e.amount) : -Number(e.amount));
    for (const e of own.filter((x) => x.t < o.at)) balance += change(e);
    if (balance >= o.data.amount + ESSENTIALS) since = o.at;
    for (const e of own.filter((x) => x.t >= o.at)) {
      balance += change(e);
      if (balance >= o.data.amount + ESSENTIALS) since ??= e.t;
      else until(e.t);
    }
    until(end);
    expect(longest).toBeLessThan(7 * DAY);
  }
}, 2_400_000);
