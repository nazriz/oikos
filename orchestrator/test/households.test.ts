// Households on the generated town (docs/behaviour/households.md): people live
// with their households, move together (the leaseholder brings the children;
// the other adults come when told), share the rent, and a child who turns 18
// opens an account of their own. None of it is kernel mechanics.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@terrarium/worlds/generator/generate";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

test("households live, move and pay together", async () => {
  const out = join(root, "runs", "test-households");
  rmSync(out, { recursive: true, force: true });
  const config = generate({ ...spec, years: 1 });
  const s = await runWorld({ config, runId: "households", outDir: out, until: 365 * DAY });
  const ev = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
  const households = config.world.records.filter((r: any) => r.kind === "household").map((r: any) => r.data);
  const householdOf = new Map<string, any>(households.flatMap((h: any) => h.members.map((m: any) => [m.person, h])));
  const adult = (person: string, t: number) => t - householdOf.get(person).members.find((m: any) => m.person === person).born_at >= 18 * 365 * DAY;

  // Where each person lives, replaying the occupancy (a dwelling at a time).
  const home = new Map<string, string>(config.world.occupancy.filter((o: any) => o.space.includes("/dwelling.")).map((o: any) => [o.occupant, o.space]));
  const left = new Set<string>();
  for (const e of ev) {
    if (e.event === "occupied" && e.space.includes("/dwelling.")) home.set(e.occupant, e.space);
    if (e.event === "vacated" && home.get(e.occupant) === e.space) home.delete(e.occupant);
    if (e.event === "person_left") left.add(e.person);
  }
  // At the end, each household still in town lives in one home (or none), bar one caught mid-move.
  let split = 0;
  for (const h of households) {
    const here = h.members.filter((m: any) => !left.has(m.person));
    const homes = new Set(here.map((m: any) => home.get(m.person) ?? "none"));
    if (homes.size > 1) split++;
  }
  expect(split).toBeLessThanOrEqual(1);

  // Children are brought by a parent (the leaseholder), never move themselves.
  const childMoves = ev.filter((e) => e.event === "occupied" && e.space.includes("/dwelling.") && !adult(e.occupant, e.t));
  expect(childMoves.length).toBeGreaterThan(0);
  for (const e of childMoves) expect(e.by).toBe(`${householdOf.get(e.occupant).leaseholder}-self`);
  // Other adults move themselves.
  const adultMoves = ev.filter((e) => e.event === "occupied" && e.space.includes("/dwelling.") && adult(e.occupant, e.t) && householdOf.get(e.occupant).leaseholder !== e.occupant);
  expect(adultMoves.length).toBeGreaterThan(0);
  for (const e of adultMoves) expect(e.by).toBe(`${e.occupant}-self`);
  // Shares of the rent reach leaseholders.
  const requests = new Map<string, any>([...config.world.records, ...ev.filter((e) => e.event === "recorded").map((e) => e.record)].map((r: any) => [r.id, r]));
  const shares = ev.filter((e) => e.event === "transfer" && requests.get(e.per_instruction)?.data?.outcome?.money?.for === "Household share of the rent.");
  expect(shares.length).toBeGreaterThan(20);
  const holder = new Map<string, string>([...config.world.accounts.map((a: any) => [a.id, a.holder]), ...ev.filter((e) => e.event === "account_opened").map((e) => [e.account, e.holder])] as [string, string][]);
  for (const x of shares) expect(householdOf.get(holder.get(x.from)!)?.leaseholder).toBe(holder.get(x.to));
  // Nobody was refused anything.
  expect(ev.filter((e) => e.event === "action_refused")).toEqual([]);
}, 300_000);
