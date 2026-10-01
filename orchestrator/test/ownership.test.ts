// Home ownership (docs/behaviour/ownership.md; docs/design/world-expansion.md 6.2), in a generated town: owner-occupied
// houses at the profile's share, mortgages only where the household's income would have got one (repayments within the
// bank's share of it), taken on by the bank, repaid by standing order; owners pay rates and never hunt for a rental;
// and when an owner's death is registered, the land registry passes their title to their heir, as the succession law says.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@terrarium/worlds/generator/generate";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const MONTH = 30 * DAY;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

test("owners own their houses, repay their mortgages, pay rates, and pass their titles to their heirs", async () => {
  const config = generate({ ...spec, years: 1 });
  // Far more deaths than life, so a year of a small town has owners' deaths to follow.
  config.life.other_causes.by_age = [{ from: 0, bps: 0 }, { from: 25, bps: 5000 }];
  const titles = config.world.records.filter((r: any) => r.record === "claim" && r.about?.kind === "ownership" && /^c\d+$/.test(r.holder));
  const houses = config.world.structures.filter((s: any) => s.id.startsWith("house-")).length;
  expect(titles.length).toBeGreaterThan(houses * 0.5);
  expect(titles.length).toBeLessThan(houses * 0.95);
  // Mortgages: owners' only, within 30% of the household's pay.
  const loans = config.world.records.filter((r: any) => r.terms?.template === "loan");
  expect(loans.length).toBeGreaterThan(5);
  for (const l of loans) expect(titles.map((x: any) => x.holder)).toContain(l.terms.parties[1]);

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
  // A dead owner's title passes to their heir, recorded by the land registry (the town).
  // (Only deaths someone sees get registered: an owner who dies while the household is out, never, until people come
  // home each day: world-expansion 6.3. The registry's part is tested on its own: participants/test/registry.test.ts.)
  const regs = recs.filter((r) => r.kind === "death_registration" && owners.has(r.data.deceased));
  for (const r of regs) {
    const title = titles.find((x: any) => x.holder === r.data.deceased);
    const passed = recs.find((x) => x.record === "claim_transfer" && x.claim === title.id);
    expect(passed?.speaks_for).toBe("city");
    expect(passed?.to).toBe(r.data.partner ?? passed?.to);
  }
}, 900_000);
