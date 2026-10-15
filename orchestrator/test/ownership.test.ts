// Home ownership (docs/behaviour/ownership.md; docs/design/world-expansion.md 6.2), in a generated town: owner-occupied
// houses at the profile's share, mortgages only where the household's income would have got one (repayments within the
// bank's share of it), taken on by the bank, repaid by standing order; owners pay rates and never hunt for a rental;
// and when an owner's death is registered, the land registry passes their title to their heir, as the succession law says.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { runWorld } from "../src/run";
import { systemAt } from "./lib/offices";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const MONTH = 30 * DAY;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
const profile = JSON.parse(readFileSync(join(root, `worlds/profiles/${spec.profile}.json`), "utf8")).values;
const OW = profile.ownership, CR = profile.credit;

/** Who owns what in a town as generated: people's titles; for each, the lot, the lot its holder lives on, whether the
 * holder heads their household, and the household's members; and how many houses have a household living in them. */
function ownership(config: any) {
  const recs = config.world.records as any[];
  const titles = recs.filter((r) => r.record === "claim" && r.about?.kind === "ownership" && /^c\d+$/.test(r.holder));
  const lotOf = new Map<string, string>(recs.filter((r) => r.kind === "lot").flatMap((r) => (r.data.cells as string[]).map((c) => [c, r.id] as [string, string])));
  const houses = (config.world.structures as any[]).filter((s) => s.id.startsWith("house-"));
  const at = new Map<string, string>(houses.map((s) => [s.id, s.at]));
  const home = new Map<string, string>((config.world.occupancy as any[]).filter((o) => o.space.includes("/dwelling.")).map((o) => [o.occupant, o.space.split("/")[0]]));
  const households = recs.filter((r) => r.kind === "household");
  const owned = titles.map((t) => {
    const h = households.find((x) => x.data.members.some((m: any) => m.person === t.holder));
    return { holder: t.holder as string, lot: t.about.object as string, livesOn: lotOf.get(at.get(home.get(t.holder) ?? "") ?? ""), heads: h?.data.leaseholder === t.holder, members: (h?.data.members ?? []).map((m: any) => m.person as string) };
  });
  const lived = houses.filter((s) => [...home.values()].includes(s.id)).length;
  return { titles, owned, lived };
}

/** Each person's pay a month at the start, from the jobs the town begins with (the wage their employer commits to). */
function monthlyPay(config: any) {
  const pay = new Map<string, number>();
  for (const r of config.world.records as any[]) {
    if (r.terms?.template !== "employment") continue;
    const [employer, worker] = r.terms.parties;
    const c = r.terms.commitments.find((x: any) => x.who === employer && x.does?.outcome?.money);
    if (c) pay.set(worker, (pay.get(worker) ?? 0) + Math.floor((Number(c.does.outcome.money.amount) * MONTH) / Number(c.every)));
  }
  return pay;
}

test("houses are owner-occupied at the profile's share, over many towns", () => {
  // One town's count is a draw (38 houses); the share is the profile's over twenty towns' houses, within five points.
  let owned = 0, lived = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const o = ownership(generate({ ...spec, seed }));
    owned += o.titles.length;
    lived += o.lived;
  }
  expect(lived).toBeGreaterThan(0);
  expect(Math.abs((10_000 * owned) / lived - OW.house_owner_bps)).toBeLessThan(500);
}, 300_000);

test("owners own their houses, repay their mortgages, pay rates, and pass their titles to their heirs", async () => {
  const config = generate({ ...spec, years: 1 });
  // Far more deaths than life, so a year of a small town has owners' deaths to follow.
  config.life.other_causes.by_age = [{ from: 0, bps: 0 }, { from: 25, bps: 5000 }];
  // (The land registry's registrar is a system here, as every office was until foundations F5: with deaths this many its person, who is a resident,
  // dies too, and the post stands vacant, since nothing yet appoints a successor (F6). The subject here is the transmission of titles, not the post.)
  systemAt(config, "land-registrar");
  const { titles, owned, lived } = ownership(config);
  // Owner-occupied: each owner lives in the house on the lot they hold, and is the head of the household there.
  for (const o of owned) expect({ holder: o.holder, livesOn: o.livesOn, heads: o.heads }).toEqual({ holder: o.holder, livesOn: o.lot, heads: true });
  // How many own is a draw for each house lived in, at the profile's share: this town's count is within four standard
  // deviations of it. (Until 2026-10-08 this was "between 50% and 95% of the houses", which one town of 38 houses in
  // forty misses by its draw alone; the share itself is held over many towns, in the test below.)
  const share = OW.house_owner_bps / 10_000;
  expect(Math.abs(titles.length - lived * share)).toBeLessThanOrEqual(4 * Math.sqrt(lived * share * (1 - share)));
  // Mortgages: owners' only, and only what the household's pay would have got: repayments within the bank's share of
  // it (the profile's), and no more than the profile's usual repayment. A household with no pay has none.
  const loans = config.world.records.filter((r: any) => r.terms?.template === "loan");
  expect(loans.length).toBeGreaterThan(0);
  const pay = monthlyPay(config);
  for (const l of loans) {
    const borrower = l.terms.parties[1];
    const o = owned.find((x) => x.holder === borrower);
    expect(o).toBeDefined();
    const repayment = Number(l.terms.commitments.find((c: any) => c.who === borrower).does.outcome.money.amount);
    const income = o!.members.reduce((a: number, m: string) => a + (pay.get(m) ?? 0), 0);
    expect(repayment).toBeGreaterThan(0);
    expect(repayment).toBeLessThanOrEqual(Math.floor((income * CR.max_repayment_share_bps.person) / 10_000));
    expect(repayment).toBeLessThanOrEqual(OW.mortgage_payment_per_month);
  }

  const out = join(root, "runs", "test-ownership");
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config, runId: "ownership", outDir: out, until: 300 * DAY });
  expect(s.participantErrors).toBe(0);
  const log = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const ev = log.filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
  const recs = ev.filter((e) => e.event === "recorded").map((e) => e.record);
  const dead = new Set(ev.filter((e) => e.event === "person_died").map((e) => e.person));
  // The bank collects the repayments, by standing order, monthly.
  const orders = new Map(config.world.records.filter((r: any) => r.kind === "request" && loans.some((l: any) => l.id === r.basis)).map((r: any) => [r.id, r.basis]));
  for (const l of loans) {
    if (dead.has(l.terms.parties[1])) continue;
    const paid = ev.filter((e) => e.event === "transfer" && orders.get(e.per_instruction) === l.id).length;
    expect(paid).toBeGreaterThanOrEqual(Math.floor((300 * DAY) / MONTH) - 1);
  }
  // Owners are levied rates, and pay them.
  const owners = new Set(titles.map((x: any) => x.holder));
  const rates = recs.filter((r) => r.record === "claim" && r.about?.kind === "rates" && owners.has(r.counterparty) && !dead.has(r.counterparty));
  expect(rates.length).toBeGreaterThan(owners.size / 2);
  const settled = new Set(ev.filter((e) => e.event === "transfer" && e.settles).map((e) => e.settles));
  expect(rates.filter((r) => settled.has(r.id)).length).toBeGreaterThan(rates.length * 0.7);
  // Owners never apply to rent.
  const applied = recs.filter((r) => r.kind === "rental_application" && owners.has(r.speaks_for) && !recs.some((x) => x.record === "claim_transfer" && x.claim && titles.find((t: any) => t.id === x.claim)?.holder === r.speaks_for));
  expect(applied).toEqual([]);
  // A dead owner's title passes to their heir, entered by the land registry (a body of its own, which keeps the
  // register: the registrar of deaths applies to it; until 2026-10-08 the town's registrar entered it itself).
  // (Only deaths someone sees get registered: an owner who dies while the household is out, never, until people come
  // home each day: world-expansion 6.3. The registry's part is tested on its own: participants/test/registry.test.ts.)
  const regs = recs.filter((r) => r.kind === "death_registration" && owners.has(r.data.deceased));
  for (const r of regs) {
    const title = titles.find((x: any) => x.holder === r.data.deceased);
    const passed = recs.find((x) => x.record === "claim_transfer" && x.claim === title.id);
    expect(passed?.speaks_for).toBe("land-registry");
    expect(passed?.to).toBe(r.data.partner ?? passed?.to);
  }
}, 2_400_000);
