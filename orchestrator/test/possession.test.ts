// Possession of a let home for arrears, end to end (docs/behaviour/justice.md, "Possession"): a tenant who cannot pay
// is given a notice to vacate, which ends nothing; the landlord applies to the tribunal; it orders possession on a
// date; the tenant stays; the landlord buys a warrant from the registrar; an officer of the police puts the
// household out. Nothing is done by a paper, and nothing by the landlord's own hand.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { exportLogs, query, runQuery } from "@oikos/measure";
import { recordChanges } from "../src/records";
import { runWorld } from "../src/run";
import { officeBy } from "./lib/offices";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const base = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

test("the generated town publishes its place's law on possession, and tells landlords, the tribunal, its registrar and people what they need of it", () => {
  const c = generate(base) as any;
  const law = c.world.records.find((r: any) => r.id === "law-possession");
  expect(law.data).toMatchObject({ tenancy: "possession", arrears_days: 14, notice_days: 14, enforced_by: "police" });
  expect(law.speaks_for).toBe("outside");
  expect(c.positions.find((p: any) => p.role_module?.code === "firm.landlord").role_module.params.possession.tribunal).toBe("tribunal");
  expect(officeBy(c, "tribunal.member").params.hears.some((h: any) => h.about === "possession")).toBe(true);
  expect(officeBy(c, "tribunal.registrar").params.enforcer).toBe("police");
  expect(c.participants.find((p: any) => p.controller?.impl === "citizen.default").controller.params.possession).toEqual({ stay_bps: 5000, obey_bps: 5900, answer_bps: 4300, notice_days: 14 });
});

test("a tenant who cannot pay and will not go is put out by the police on the tribunal's warrant, and by nothing before it", async () => {
  const config = generate(base) as any;
  // One renting household of one adult, of working age: no job, out of the labour force, no money. It stays past
  // every paper (for the test: stay 100%, obey 0%).
  const leases = config.world.records.filter((r: any) => r.record === "agreement" && r.terms.template === "lease");
  const age = (id: string) => -config.world.entities.find((e: any) => e.id === id).born_at / (365 * DAY);
  const alone = leases.find((l: any) => !/with their household/.test(l.terms.text) && age(l.terms.parties[1]) >= 25 && age(l.terms.parties[1]) < 55 && !config.positions.some((p: any) => p.holder === `${l.terms.parties[1]}-self`))!; // (a tenant who holds no post: since foundations F5 the town's staff hold them, and have days of their own)
  expect(alone).toBeDefined();
  const tenant = alone.terms.parties[1] as string, landlord = alone.terms.parties[0] as string;
  const job = config.world.records.find((r: any) => r.record === "agreement" && r.terms.template === "employment" && r.terms.parties[1] === tenant);
  if (job) config.world.records = config.world.records.filter((r: any) => r.id !== job.id && r.agreement !== job.id && r.basis !== job.id);
  config.world.accounts.find((a: any) => a.id === `acc-${tenant}`).balance = "0";
  const who = config.participants.find((p: any) => p.person === tenant);
  who.controller = { ...who.controller, params: { ...who.controller.params, in_labour_force: false, possession: { stay_bps: 10_000, obey_bps: 0 }, leave_after_homeless_days: 9_999 } };
  const out = join(root, "runs", "test-possession");
  rmSync(out, { recursive: true, force: true });
  // (Seed 4 on the Rust world, 2026-10-18: a tenant out of work with nothing in the bank leaves town after the months the person's patience allows, which is a draw of the run's, and in seeds 3 and 5 of the Rust world's draws this tenant left on day 188, three days before the warrant's day, as in the TS world's seed 2 below. Seeds 1, 2, 4 and 6 carry the warrant out; 4 is one of the seeds the note below names.)
  // (Seed 3 since 2026-10-17: the tenant put out on the warrant is recorded as put out ("evicted", and their notice on the lease) where the warrant's paper is read, and not only at the leaving step, which a home cleared by the next turn never reaches. In this seed the warrant's paper is read and the leaving step never comes; in seeds 1 and 4 both come, and the record is made once. Seed 2, the seed this test had, now has the tenant leave town the morning the officer comes: a different course, not this one.)
  // (The run's seed is pinned: in the generated seed's run, with draws named for the day (2026-10-12), the station's officers did not
  // get to the warrant in the six days it ran and it lapsed, which the office does and says; this test is of one carried out.)
  const s = await runWorld({ config: { ...config, seed: 4, log: { ...config.log, detail: "lean" } }, runId: "possession", outDir: out, until: 200 * DAY, recordObservations: "none" });
  const ev = readFileSync(s.logPath, "utf8").trim().split("\n").filter((l) => l.includes('"event"')).map((l) => JSON.parse(l)).filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
  const recs = ev.filter((e) => e.event === "recorded").map((e) => e.record);
  const mine = (kind: string) => recs.filter((r) => r.kind === kind && JSON.stringify(r).includes(alone.id));
  // The notice to vacate, under the law; the lease is not ended by it.
  const ntv = mine("notice_to_vacate")[0];
  expect(ntv).toBeDefined();
  expect(ntv.speaks_for).toBe(landlord);
  expect(ntv.data.by - ntv.at).toBeGreaterThanOrEqual(14 * DAY);
  expect(ntv.data.by - ntv.at).toBeLessThan(15 * DAY);
  expect(recs.some((r) => r.record === "notice" && r.agreement === alone.id && r.at < ntv.data.by)).toBe(false);
  // The application, once its date has passed; the tribunal tells the tenant and, after its time, orders possession.
  const app = recs.find((r) => r.kind === "tribunal_application" && r.data?.kind === "possession" && r.data.about === alone.id);
  expect(app.at).toBeGreaterThanOrEqual(ntv.data.by);
  expect(recs.some((r) => r.kind === "hearing_notice" && r.data?.application === app.id && r.addressed_to.includes(tenant))).toBe(true);
  const order = recs.find((r) => r.kind === "tribunal_order" && r.data?.application === app.id);
  expect(order.data).toMatchObject({ finding: "possession", against: tenant, applicant: landlord, about: alone.id });
  expect(Math.round((order.data.due - order.at) / DAY)).toBe(14);
  // The tenant is still in the home at the tribunal's date: nobody has put them out.
  const outOf = ev.filter((e) => e.event === "vacated" && e.occupant === tenant && e.t > ntv.at);
  expect(outOf.filter((e) => e.t <= order.data.due && e.by !== undefined && e.by !== `${tenant}-self`)).toEqual([]);
  // The warrant: asked of the registrar after the date, issued to the police, carried out by them.
  const request = recs.find((r) => r.kind === "warrant_request" && r.data?.order === order.id);
  expect(request.at).toBeGreaterThan(order.data.due);
  const warrant = recs.find((r) => r.kind === "warrant" && r.data?.order === order.id);
  expect(warrant.addressed_to).toEqual(["police"]);
  const done = recs.find((r) => r.kind === "warrant_executed" && r.data?.warrant === warrant.id);
  expect(done.speaks_for).toBe("police");
  // (No sooner than the notice of the day the law gives the tenant: a week here. And within the warrant's days.)
  expect(warrant.data.not_before - warrant.at).toBeGreaterThanOrEqual(7 * DAY);
  expect(done.at).toBeGreaterThanOrEqual(warrant.data.not_before);
  expect(done.at).toBeLessThanOrEqual(warrant.data.until + DAY);
  // From then the tenancy is over for the tenant: they pay no more rent and hold no home; the landlord never removed anyone.
  expect(ev.some((e) => e.event === "transfer" && e.from === `acc-${tenant}` && e.to === `acc-${landlord}` && e.t > done.at + 3 * DAY)).toBe(false);
  expect(recs.some((r) => r.record === "notice" && r.agreement === alone.id && r.as === tenant && r.at >= done.at)).toBe(true);
  // On their record they were put out (and are "evicted", as a notice's leaving is): never "left on the order", which is
  // for those who went on it with no warrant carried out.
  const memories: string[] = [];
  for await (const c of recordChanges(s.logPath)) if (c.entity === tenant) for (const b of (c.because ?? []) as any[]) memories.push(b.what);
  expect(memories).toContain("put_out");
  expect(memories.filter((m) => m === "evicted").length).toBe(1); // (once: at the warrant's paper, and not again at the leaving step where that comes too)
  expect(memories).not.toContain("left_on_order");
}, 900_000);

test("a tenant who cannot pay and goes on the notice gives the home up: they are not back in it, no rent is counted after, and nobody applies for possession of a home already left", async () => {
  const config = generate(base) as any;
  const leases = config.world.records.filter((r: any) => r.record === "agreement" && r.terms.template === "lease");
  const age = (id: string) => -config.world.entities.find((e: any) => e.id === id).born_at / (365 * DAY);
  const aloneAll = leases.filter((l: any) => !/with their household/.test(l.terms.text) && age(l.terms.parties[1]) >= 25 && age(l.terms.parties[1]) < 55 && !config.positions.some((p: any) => p.holder === `${l.terms.parties[1]}-self`)) ; // (a tenant who holds no post: since foundations F5 the town's staff hold them, and have days of their own)
  const alone = aloneAll[1] ?? aloneAll[0]!; // (the second such tenant: the first, with the town's draws of foundations F5, goes to a group's gathering and gives the notice there, away from the home it is giving up)
  const tenant = alone.terms.parties[1] as string, landlord = alone.terms.parties[0] as string;
  const job = config.world.records.find((r: any) => r.record === "agreement" && r.terms.template === "employment" && r.terms.parties[1] === tenant);
  if (job) config.world.records = config.world.records.filter((r: any) => r.id !== job.id && r.agreement !== job.id && r.basis !== job.id);
  config.world.accounts.find((a: any) => a.id === `acc-${tenant}`).balance = "0";
  const who = config.participants.find((p: any) => p.person === tenant);
  // (For the test: it goes at the notice's date, and does not leave town for want of a home.)
  who.controller = { ...who.controller, params: { ...who.controller.params, in_labour_force: false, possession: { stay_bps: 0, obey_bps: 10_000 }, leave_after_homeless_days: 9_999 } };
  const out = join(root, "runs", "test-possession-goes");
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config: { ...config, log: { ...config.log, detail: "lean" } }, runId: "possession-goes", outDir: out, until: 150 * DAY, recordObservations: "none" });
  const ev = readFileSync(s.logPath, "utf8").trim().split("\n").filter((l) => l.includes('"event"')).map((l) => JSON.parse(l)).filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
  const recs = ev.filter((e) => e.event === "recorded").map((e) => e.record);
  const ntv = recs.find((r) => r.kind === "notice_to_vacate" && r.data?.lease === alone.id);
  expect(ntv).toBeDefined();
  // At the notice's date the tenant gives notice on the lease and leaves.
  const went = recs.find((r) => r.record === "notice" && r.agreement === alone.id && r.as === tenant);
  expect(went.at).toBeGreaterThanOrEqual(ntv.data.by);
  expect(went.at).toBeLessThan(ntv.data.by + 8 * DAY); // (at their first look after the date: within the week)
  // (The home, not wherever else they were that hour: with homes dealt by income, 2026-10-12, the tenant this test
  // finds is one who goes to a group's gatherings, and the first place they left after the notice was the hall.)
  // (2026-10-24, the shop mix on: this tenant gave the notice from the hall, ten minutes after leaving the home, so the home they gave
  // up is the dwelling they were last in at the notice, not one they vacate after it. The check below is unchanged.)
  const space = ev.filter((e) => e.event === "occupied" && e.occupant === tenant && e.t <= went.at && String(e.space).includes("/dwelling.")).at(-1)?.space;
  expect(space).toBeDefined();
  // They are not back in the home they gave up: not that day, not later. (Until 2026-10-12 the daily round took a
  // person with no home back to the dwelling they had last been in.)
  expect(ev.filter((e) => e.event === "occupied" && e.occupant === tenant && e.space === space && e.t > went.at)).toEqual([]);
  // The landlord ends the tenancy on the record. It applies for nothing once the tenant has gone; an application it
  // made in the days between the notice's date and the tenant's going is withdrawn, or dismissed on the tenant's
  // answer that they have left: nobody orders possession of a home already given up.
  expect(recs.some((r) => r.record === "notice" && r.agreement === alone.id && r.as === landlord && r.at >= went.at)).toBe(true);
  const apps = recs.filter((r) => r.kind === "tribunal_application" && r.data?.kind === "possession" && r.data.about === alone.id);
  expect(apps.filter((a) => a.at > went.at + DAY)).toEqual([]);
  for (const a of apps) {
    const withdrawn = recs.some((r) => r.record === "withdrawal" && r.withdraws === a.id);
    const orders = recs.filter((r) => r.kind === "tribunal_order" && r.data?.application === a.id);
    expect(withdrawn || orders.some((o) => o.data.finding === "dismissed")).toBe(true);
    expect(orders.filter((o) => o.data.finding === "possession")).toEqual([]);
  }
  console.log(`a tenant who goes on the notice: notice's date day ${Math.floor(ntv.data.by / DAY)}, gone day ${Math.floor(went.at / DAY)}; applications for possession ${apps.length} (each withdrawn or dismissed)`);
  rmSync(out, { recursive: true, force: true });
}, 900_000);

test("a tenant who goes after the order, before anyone comes: no removal is recorded; a warrant already out is withdrawn, or carried out saying nobody was there", async () => {
  // (The fifth living pilot: 11 of 23 warrants "carried out" were at homes the household had left inside the warrant's
  // notice of the day; every call to put someone out was refused, and the station said "carried out" all the same.)
  const config = generate(base) as any;
  const leases = config.world.records.filter((r: any) => r.record === "agreement" && r.terms.template === "lease");
  const age = (id: string) => -config.world.entities.find((e: any) => e.id === id).born_at / (365 * DAY);
  const alone = leases.find((l: any) => !/with their household/.test(l.terms.text) && age(l.terms.parties[1]) >= 25 && age(l.terms.parties[1]) < 55 && !config.positions.some((p: any) => p.holder === `${l.terms.parties[1]}-self`))!; // (a tenant who holds no post: since foundations F5 the town's staff hold them, and have days of their own)
  const tenant = alone.terms.parties[1] as string, landlord = alone.terms.parties[0] as string;
  const job = config.world.records.find((r: any) => r.record === "agreement" && r.terms.template === "employment" && r.terms.parties[1] === tenant);
  if (job) config.world.records = config.world.records.filter((r: any) => r.id !== job.id && r.agreement !== job.id && r.basis !== job.id);
  config.world.accounts.find((a: any) => a.id === `acc-${tenant}`).balance = "0";
  const who = config.participants.find((p: any) => p.person === tenant);
  // (For the test: stays past the notice, does not answer, and goes once ordered out, at their first look after the order's day.)
  who.controller = { ...who.controller, params: { ...who.controller.params, in_labour_force: false, possession: { stay_bps: 10_000, obey_bps: 10_000, answer_bps: 0 }, leave_after_homeless_days: 9_999 } };
  const out = join(root, "runs", "test-possession-goes-on-order");
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config: { ...config, log: { ...config.log, detail: "lean" } }, runId: "possession-goes-on-order", outDir: out, until: 200 * DAY, recordObservations: "none" });
  const ev = readFileSync(s.logPath, "utf8").trim().split("\n").filter((l) => l.includes('"event"')).map((l) => JSON.parse(l)).filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
  const recs = ev.filter((e) => e.event === "recorded").map((e) => e.record);
  const order = recs.find((r) => r.kind === "tribunal_order" && r.data?.about === alone.id && r.data?.finding === "possession");
  expect(order).toBeDefined();
  const went = recs.find((r) => r.record === "notice" && r.agreement === alone.id && r.as === tenant);
  expect(went.at).toBeGreaterThanOrEqual(order.data.due);
  // Nobody was put out: the tenant went of their own accord, and no paper says otherwise.
  expect(ev.filter((e) => e.event === "vacated" && e.occupant === tenant && e.reason === "removed" && e.by !== `${tenant}-self`)).toEqual([]);
  expect(recs.filter((r) => r.kind === "warrant_executed" && r.data?.lease === alone.id && r.data?.removed !== 0)).toEqual([]);
  const warrant = recs.find((r) => r.kind === "warrant" && r.data?.order === order.id);
  if (warrant) {
    const withdrawn = recs.some((r) => r.record === "withdrawal" && r.withdraws === warrant.id);
    const empty = recs.find((r) => r.kind === "warrant_executed" && r.data?.warrant === warrant.id);
    expect(withdrawn || !!empty).toBe(true);
    if (empty) expect(empty.data.removed).toBe(0);
    console.log(`a tenant who goes after the order: order's day ${Math.floor(order.data.due / DAY)}, gone day ${Math.floor(went.at / DAY)}, warrant issued day ${Math.floor(warrant.at / DAY)}: ${withdrawn ? "withdrawn on the landlord's word" : "carried out, nobody there"}`);
  } else console.log(`a tenant who goes after the order: gone day ${Math.floor(went.at / DAY)} before any warrant was asked`);
  // The landlord ends the tenancy on the record either way.
  expect(recs.some((r) => r.record === "notice" && r.agreement === alone.id && r.as === landlord)).toBe(true);

  // On the tenant's own record: the order, and then leaving on it, a kind of its own. Not "evicted" at the leaving (that
  // is a warrant's removal, or a notice gone on), and the tenant's weights are the same as for being made to leave.
  const memories: { what: string; t: number }[] = [];
  for await (const c of recordChanges(s.logPath)) if (c.entity === tenant) for (const b of (c.because ?? []) as any[]) memories.push({ what: b.what, t: b.t ?? c.t });
  expect(memories.some((m) => m.what === "ordered_out")).toBe(true);
  expect(memories.some((m) => m.what === "left_on_order")).toBe(true);
  expect(memories.some((m) => m.what === "evicted" && m.t >= went.at)).toBe(false);
  expect(memories.some((m) => m.what === "put_out")).toBe(false);
  // And the measure tells it from a removal: left on an order, with no warrant carried out on that home.
  const m = join(out, "measure");
  await exportLogs([s.logPath], m);
  const row = (await runQuery(m, "town/possession"))[0] as any;
  expect(Number(row.left_on_order)).toBe(1); // (the town's other order was carried out on another household: that one is a removal)
  // (Until foundations F1, 2026-10-15, the town had a second order in these 200 days, carried out on another household, which the
  // measure told from this one; now it has only this one. What is held is that the one left on is counted, and counted once.)
  expect(Number(row.possession_orders)).toBeGreaterThanOrEqual(Number(row.left_on_order));
  rmSync(out, { recursive: true, force: true });
}, 900_000);
