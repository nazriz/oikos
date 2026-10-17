// Households on the generated town (docs/behaviour/households.md): people live
// with their households, move together (the leaseholder brings the children;
// the other adults come when told), share the rent, and a child who turns 18
// opens an account of their own. None of it is kernel mechanics.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { runWorld } from "../src/run";
import { officesBy } from "./lib/offices";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

test("households live, move and pay together", async () => {
  const out = join(root, "runs", "test-households");
  rmSync(out, { recursive: true, force: true });
  const config = generate({ ...spec, years: 1 });
  // (Moves to watch: leases that end at their term, and landlords who don't renew. Where tenancies run on
  // periodically, as the world's law has them, few households move in a year.)
  for (const r of config.world.records) if (r.terms?.template === "lease") delete r.terms.then;
  for (const p of officesBy(config, "firm.landlord")) Object.assign(p.params, { renew: false, after_term: null });
  const s = await runWorld({ config, runId: "households", outDir: out, until: 365 * DAY });
  const ev = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
  const households = config.world.records.filter((r: any) => r.kind === "household").map((r: any) => r.data);
  const householdOf = new Map<string, any>(households.flatMap((h: any) => h.members.map((m: any) => [m.person, h])));
  const adult = (person: string, t: number) => t - householdOf.get(person).members.find((m: any) => m.person === person).born_at >= 18 * 365 * DAY;
  const known = (person: string) => householdOf.has(person); // people of the town's own households (not newcomers)

  // Where each person lives, replaying the occupancy (a dwelling at a time).
  const home = new Map<string, string>(config.world.occupancy.filter((o: any) => o.space.includes("/dwelling.")).map((o: any) => [o.occupant, o.space]));
  const left = new Set<string>();
  for (const e of ev) {
    if (e.event === "occupied" && e.space.includes("/dwelling.")) home.set(e.occupant, e.space);
    if (e.event === "vacated" && home.get(e.occupant) === e.space) home.delete(e.occupant);
    if (e.event === "person_left" || e.event === "person_died") left.add(e.person);
  }
  // At the end, each household still in town (the living) lives in one home (or none), bar one caught mid-move: one
  // whose leaseholder moved in the last fortnight is still bringing the household over (members follow at their next wake).
  const movedAt = new Map<string, number>();
  for (const e of ev) if (e.event === "occupied" && e.space.includes("/dwelling.")) movedAt.set(e.occupant, e.t);
  let split = 0;
  for (const h of households) {
    if ((movedAt.get(h.leaseholder) ?? -Infinity) > 365 * DAY - 14 * DAY) continue;
    const here = h.members.filter((m: any) => !left.has(m.person));
    const homes = new Set(here.map((m: any) => home.get(m.person) ?? "none"));
    if (homes.size > 1) split++;
  }
  expect(split).toBeLessThanOrEqual(1);

  // Children are brought into a new home by a parent (the leaseholder); after, they come home from school themselves.
  const childMoves = ev.filter((e) => e.event === "occupied" && e.space.includes("/dwelling.") && known(e.occupant) && !adult(e.occupant, e.t));
  expect(childMoves.length).toBeGreaterThan(0);
  const firstInto = new Map<string, any>();
  for (const e of childMoves) if (!firstInto.has(`${e.occupant}|${e.space}`)) firstInto.set(`${e.occupant}|${e.space}`, e);
  const brought = [...firstInto.values()].filter((e) => !config.world.occupancy.some((o: any) => o.occupant === e.occupant && o.space === e.space));
  for (const e of brought) expect([`${householdOf.get(e.occupant).leaseholder}-self`, `${e.occupant}-self`]).toContain(e.by);
  expect(brought.some((e) => e.by === `${householdOf.get(e.occupant).leaseholder}-self`)).toBe(true);
  // Other adults move themselves.
  const adultMoves = ev.filter((e) => e.event === "occupied" && e.space.includes("/dwelling.") && known(e.occupant) && adult(e.occupant, e.t) && householdOf.get(e.occupant).leaseholder !== e.occupant);
  expect(adultMoves.length).toBeGreaterThan(0);
  for (const e of adultMoves) expect(e.by).toBe(`${e.occupant}-self`);
  // Shares of the rent reach leaseholders.
  const requests = new Map<string, any>([...config.world.records, ...ev.filter((e) => e.event === "recorded").map((e) => e.record)].map((r: any) => [r.id, r]));
  const shares = ev.filter((e) => e.event === "transfer" && requests.get(e.per_instruction)?.data?.outcome?.money?.for === "Household share of the rent.");
  expect(shares.length).toBeGreaterThan(20);
  const holder = new Map<string, string>([...config.world.accounts.map((a: any) => [a.id, a.holder]), ...ev.filter((e) => e.event === "account_opened").map((e) => [e.account, e.holder])] as [string, string][]);
  for (const x of shares) if (known(holder.get(x.from)!)) expect(householdOf.get(holder.get(x.from)!)?.leaseholder).toBe(holder.get(x.to));
  // Nobody was refused anything, but for same-moment races (D58): someone who had just left or moved, named for work by
  // a firm acting on what it saw at the moment's start; and a household moving into a home its last tenants are still
  // leaving (refused, and tried again: docs/behaviour/citizen.md); and a child home from school by its own round while the
  // parent's act moving the household in is still under way.
  // (And, since 2026-10-12, someone going to a building that is under water that day: the flood's own refusal, met in
  // the town as drawn with homes by income, where it had not happened to fall on anyone's way before.)
  // (And a person who dies while their act is in the wait the world's time puts on it: refused as `dead` for an act naming them to do work, as
  // `participant_inactive` for their own, whose participant ended with them: the same race, seen in this town as drawn after the review of the foundations.)
  // (And, since 2026-10-12, a conception whose partner had left the room in the hour the act takes: a birth is decided
  // with the partner there and done an hour later. Rare: a draw named for the day came to fall on one such moment.)
  expect(ev.filter((e) => e.event === "action_refused" && !["not_present", "not_at_work", "capacity_exceeded", "no_time_left", "insufficient_quantity", "dead", "participant_inactive", "already_present", "flooded", "too_far", "not_in_position"].includes(e.code))).toEqual([]);
  expect(ev.filter((e) => e.event === "action_refused" && e.code === "too_far").length).toBeLessThanOrEqual(3);
}, 300_000);

test("a child born here is brought home by the parent who bore them and added to the household's record", async () => {
  const out = join(root, "runs", "test-births");
  rmSync(out, { recursive: true, force: true });
  const config = generate({ ...spec, years: 1 });
  // Far above real rates (80% a year), so a year of a small town has births to check.
  for (const p of config.participants) if (p.controller?.impl === "citizen.default") p.controller.params.fertility_per_10000 = [{ from: 15, rate: 8000 }, { from: 45, rate: 0 }];
  for (const t of config.templates) if (t.controller?.impl === "citizen.default") t.controller.params.fertility_per_10000 = [{ from: 15, rate: 8000 }, { from: 45, rate: 0 }];
  const s = await runWorld({ config, runId: "births", outDir: out, until: 365 * DAY });
  const ev = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
  const births = ev.filter((e) => e.event === "person_created" && e.parents?.length);
  expect(births.length).toBeGreaterThan(0);
  // (Women living here from the start, and those who came or were born since.)
  const female = new Set([...config.world.entities.filter((e: any) => e.sex === "female").map((e: any) => e.id), ...ev.filter((e) => e.event === "person_created" && e.sex === "female").map((e) => e.person)]);
  const records = ev.filter((e) => e.event === "recorded" && e.record.kind === "household").map((e) => e.record);
  for (const b of births) {
    expect(female.has(b.parents[0])).toBe(true); // borne by a woman
    expect(["female", "male"]).toContain(b.sex); // drawn by the kernel
    if (365 * DAY - b.t < 14 * DAY) continue; // born in the run's last fortnight
    if (ev.some((e) => e.event === "person_left" && e.person === b.parents[0] && e.t < b.t)) continue; // born away (the mother had left town)
    expect(records.some((r) => r.data.members.some((m: any) => m.person === b.person && m.sex === b.sex))).toBe(true);
    // (Their first move into a home: a newborn that is hurt may be at the clinic before it is brought home, as one was
    // in this town from 2026-10-08.)
    const home = ev.find((e) => e.event === "occupied" && e.occupant === b.person && !String(e.space).startsWith("clinic-"));
    if (home) expect(home.by).toBe(`${b.parents[0]}-self`);
  }
  // Nothing refused but same-moment races (D58; and a new employer naming, on their first day, someone who has
  // already worked a full day at the job they just left: acts take time, so starting the new job is a moment of its own) and moving into a home still being left, as above;
  // and, with the daily round, a partner gone to work while a conception was under way, or someone who died mid-trip;
  // and a house a landlord put up on the river, found under water (its lease then ended).
  // (And, when the run's course changed on 2026-10-08: someone moved into a home by one of the household who, while
  // that act was under way, got there themselves, or the other way about; whichever arrives second finds them already
  // there. A year of the larger town on main has one too. And a household that takes a new lease on the home it
  // already lives in: whoever signs it, out at the time, moves the children "in", and one is at home already.)
  const arrivedMeanwhile = (e: any) => { const m = e.code === "already_present" ? /^(\S+) is already in (\S+)$/.exec(e.detail ?? "") : null;
    return !!m && (`${m[1]}-self` !== e.participant || ev.some((x) => x.event === "occupied" && x.occupant === m[1] && x.space === m[2] && x.t <= e.t && x.t >= e.t - 3600)); };
  expect(ev.filter((e) => e.event === "action_refused" && !["not_present", "not_at_work", "capacity_exceeded", "no_time_left", "insufficient_quantity", "dead", "too_far", "participant_inactive", "flooded", "not_in_position"].includes(e.code) && !arrivedMeanwhile(e))).toEqual([]);
}, 300_000);
