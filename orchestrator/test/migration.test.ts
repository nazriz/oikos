// Migration (world.migration, docs/behaviour/boundary.md): with jobs going and
// better pay than elsewhere, households come in through the boundary with
// their savings and their paperwork, bank them, and find work and a home as
// everyone does. With no vacancies, nobody comes.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

async function run(name: string, config: any) {
  const out = join(root, "runs", `test-migration-${name}`);
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config, runId: name, outDir: out, until: 365 * DAY });
  return readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
}

test("with jobs going, households move in, bank their savings, and find work and a home", async () => {
  // Four factories for 120 people, each keeping 32 staff (the simple employer module in the factories' seats: the
  // Lengnick factories grow a worker a month): more jobs than takers; and elsewhere pays less.
  // (Of newcomers other than the one who came for the job, none look for work here: participation 0.)
  const config = generate({ ...spec, citizens: 120, factories: 4, migration: { outside_monthly_income: 200_000, response_bps: 3000, participation_bps: 0 } });
  // (Paying enough that a third of it rents a home here: $3,000 a fortnight. At $1,500 no home was affordable, and
  // newcomers only found one while unemployment support was wrongly counted beside their wages.)
  for (const p of config.participants.filter((x: any) => /^factory-\d+-manager-system$/.test(x.id))) {
    const f = p.id.replace("-manager-system", "");
    p.controller = { type: "code", impl: "firm.employer", params: { wage: 300_000, target_staff: 32, workplace: `${f}-works/workplace.1`, role: "factory worker" } };
  }
  const ev = await run("jobs", config);
  const arrived = ev.filter((e) => e.event === "person_arrived").map((e) => e.person);
  expect(arrived.length).toBeGreaterThan(0);
  // Only the outside world brings them, and each household's paperwork lists them.
  for (const e of ev.filter((e) => e.event === "person_arrived")) expect(e.by).toBe("migration-system");
  const recorded = ev.filter((e) => e.event === "recorded" && e.record.kind === "household").flatMap((e) => e.record.data.members.map((m: any) => m.person));
  for (const p of arrived) expect(recorded).toContain(p);
  // Their savings go into a bank account.
  const banked = new Set(ev.filter((e) => e.event === "account_opened" && e.custodian === "bank").map((e) => e.holder));
  for (const p of arrived) if (ev.some((e) => e.event === "account_opened" && e.holder === p && e.custodian === p)) expect(banked.has(p)).toBe(true);
  // Some find work and a home.
  const occupied = ev.filter((e) => e.event === "occupied" && arrived.includes(e.occupant));
  expect(occupied.some((e) => e.space.includes("/workplace."))).toBe(true);
  expect(occupied.some((e) => e.space.includes("/dwelling."))).toBe(true);
  // (The races the other tests allow: a new job's first day after a morning at the old one, say; and a child home from
  // school by its own round while the parent's act moving the household in is still under way.)
  // And one more race: a couple at home together when one decides on a child, and the other gone out of the door by
  // the time the act is made (it needs them both there; the month's chance is lost).
  expect(ev.filter((e) => e.event === "action_refused" && !["not_present", "not_at_work", "capacity_exceeded", "no_time_left", "insufficient_quantity", "dead", "already_present"].includes(e.code) && !(e.code === "too_far" && /isn't near/.test(e.detail ?? "")))).toEqual([]);
  // The one who came for the job looks for work (the newcomer template); the others, at participation 0, don't.
  const templateOf = new Map(ev.filter((e) => e.event === "participant_created").map((e) => [e.person, e.template]));
  // (Newcomers' households, as they came, recorded by the migration office: a household may later put a newborn on its
  // record, or record itself again when the one holding the lease dies.)
  const migration = config.participants.find((p: any) => p.controller?.impl === "world.migration").id;
  const households = ev.filter((e) => e.event === "recorded" && e.record.kind === "household" && e.record.author === migration && arrived.includes(e.record.data.leaseholder)).map((e) => e.record.data);
  expect(households.length).toBeGreaterThan(0);
  for (const h of households) for (const m of h.members.filter((x: any) => !x.parents)) expect(templateOf.get(m.person)).toBe(m.person === h.leaseholder ? "newcomer" : "newcomer-outside-lf");
}, 300_000);

test("the town's own jobseekers make coming less worth it (Harris & Todaro: the chance of a job is the town's)", async () => {
  const world = (jobseekers: number) => {
    const config = generate({ ...spec, citizens: 120, factories: 4, migration: { outside_monthly_income: 200_000, response_bps: 3000 } });
    for (const p of config.participants.filter((x: any) => /^factory-\d+-manager-system$/.test(x.id))) {
      const f = p.id.replace("-manager-system", "");
      p.controller = { type: "code", impl: "firm.employer", params: { wage: 150_000, target_staff: 32, workplace: `${f}-works/workplace.1`, role: "factory worker" } };
    }
    // The support office's published figures, as they stand: this many jobseekers already in the town.
    config.participants.find((x: any) => x.id === "outside-support-system").controller.params.publish_every_days = 0;
    config.world.records.push({ id: "stats-0", record: "statement", author: "genesis", at: 0, visible_to: "public", speaks_for: "outside", kind: "support_statistics", text: `Support recipients: unemployment ${jobseekers}.`, data: { recipients: { pension: 0, unemployment: jobseekers } } });
    return config;
  };
  const arrivals = async (name: string, n: number) => (await run(name, world(n))).filter((e) => e.event === "person_arrived").length;
  const none = await arrivals("no-jobseekers", 0);
  const many = await arrivals("jobseekers", 400);
  expect(none).toBeGreaterThan(0);
  expect(many).toBeLessThan(none / 2);
}, 600_000);

test("with no jobs going, nobody comes", async () => {
  // One shop and one factory, whose export customers want less than it makes (so it isn't hiring); and elsewhere pays
  // more than the town does, so any posting there is isn't worth coming for.
  const ev = await run("none", generate({ ...spec, citizens: 120, shops: 1, factories: 1, exports_per_month: 4_000_000, migration: { outside_monthly_income: 1_000_000, response_bps: 3000 } }));
  // Postings may appear and be filled at once; with none standing when the outside world looks, or a gap below zero, no one comes.
  expect(ev.filter((e) => e.event === "person_arrived").length).toBeLessThanOrEqual(2);
}, 300_000);
