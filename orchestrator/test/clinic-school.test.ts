// The clinic and the school (docs/design/world-expansion.md 4), in a generated town over a year: children of school age
// are at school, taught on school days, and their skill rises by about a 200th of a year's schooling a day; those who
// reach the end of school get a certificate; the ill and injured stay off work and most go to the clinic, where they're
// seen and their conditions shortened. (Illness five times the profile's, so a year has cases enough to follow.)

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const YEAR = 365 * DAY;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

test("children are taught, the ill stay home and are seen at the clinic", async () => {
  const config = generate({ ...spec, years: 1 });
  for (const s of config.life.illness.by_age) s.bps = Math.min(10_000, s.bps * 5);
  const out = join(root, "runs", "test-clinic-school");
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config, runId: "clinic-school", outDir: out, until: YEAR });
  expect(s.participantErrors).toBe(0);
  const log = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const ev = log.filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
  const recs = ev.filter((e) => e.event === "recorded").map((e) => e.record);
  const born = new Map<string, number>(config.world.entities.filter((e: any) => e.kind === "person").map((e: any) => [e.id, e.born_at]));
  const skill0 = new Map<string, number>(config.world.entities.filter((e: any) => e.variables).map((e: any) => [e.id, e.variables.skill]));

  // ---- school ----
  // Everyone of school age at the start is in a classroom; teaching happens on about the school days there are.
  // (At home at the start, each with a place: they go in school hours.)
  const pupils = config.world.records.filter((r: any) => r.kind === "school_place").map((r: any) => ({ occupant: r.addressed_to[0], space: r.data.classroom }));
  const ageAt0 = (p: string) => Math.floor(-born.get(p)! / YEAR);
  expect(pupils.length).toBe([...born.keys()].filter((p) => ageAt0(p) >= 5 && ageAt0(p) <= 17).length);
  // (Until 2026-10-08 this held every class to more than 170 lessons and every pupil to 170 lessons' schooling: true of
  // the one town it was written against, where both teachers lasted the year. In the town drawn since, a teacher dies
  // on about day 150, the school posts the job, and that class goes untaught for some forty school days until someone
  // is hired: the school's rule at work, not a fault. So what is held is the rule: the school teaches on about the
  // school days there are; a teacher teaches every one of them while they are with the school and well; a school that
  // loses a teacher posts the job; and a pupil's schooling is the lessons their own class was given.)
  const lessons = ev.filter((e) => e.event === "worked" && e.task === "teach");
  const dayOf = (e: any) => Math.floor(e.t / DAY);
  const schoolDays = [...new Set(lessons.map(dayOf))].sort((a, b) => a - b);
  expect(schoolDays.length).toBeGreaterThan(170);
  expect(schoolDays.length).toBeLessThanOrEqual(205); // (a 365-day year holds a day or so more than 200)
  // One lesson a class a day, and a teacher takes one class a day.
  expect(new Set(lessons.map((e) => `${e.on}|${dayOf(e)}`)).size).toBe(lessons.length);
  expect(new Set(lessons.map((e) => `${e.performers.join("+")}|${dayOf(e)}`)).size).toBe(lessons.length);
  // A teacher teaches on every school day from their first lesson to their last, but for days they were unwell.
  const unwell = (p: string, day: number) => ev.some((e) => e.event === "condition_began" && e.person === p && Math.floor(e.t / DAY) <= day && day <= Math.ceil(e.until / DAY));
  const teachers = [...new Set(lessons.flatMap((e) => e.performers as string[]))];
  for (const who of teachers) {
    const taught = new Set(lessons.filter((e) => e.performers.includes(who)).map(dayOf));
    const [first, lastDay] = [Math.min(...taught), Math.max(...taught)];
    const missed = schoolDays.filter((d) => d > first && d < lastDay && !taught.has(d) && !unwell(who, d));
    expect({ who, missed }).toEqual({ who, missed: [] });
  }
  // (So a class with no lesson on a school day is one the school had no teacher for.) When it has lost a teacher, it
  // posts the job.
  const lost = ev.filter((e) => e.event === "person_died" && teachers.includes(e.person)).length + recs.filter((r) => r.record === "notice" && teachers.some((w) => r.agreement === `job-${w}`) && r.speaks_for !== "school").length;
  if (lost) expect(recs.some((r) => r.kind === "job_posting" && r.speaks_for === "school")).toBe(true);
  // A pupil who stayed the year: the schooling of the lessons their own class was given (a lesson is 50), as the
  // engine keeps it: never more, and no more than thirty lessons short (the allowance this test has always had for
  // days a child misses, then against the year's 200).
  const given = new Map<string, number>();
  for (const e of lessons) given.set(e.on, (given.get(e.on) ?? 0) + 1);
  const roomOf = new Map<string, string>(pupils.map((o: any) => [o.occupant, o.space]));
  const last = new Map<string, number>();
  for (const e of ev.filter((e) => e.event === "body_changed" && e.variable === "skill")) last.set(e.person, e.value);
  const gone = new Set(ev.filter((e) => e.event === "person_left" || e.event === "person_died").map((e) => e.person));
  const stayed = pupils.map((o: any) => o.occupant).filter((p: string) => ageAt0(p) <= 15 && last.has(p) && !gone.has(p));
  expect(stayed.length).toBeGreaterThan(5);
  for (const p of stayed) {
    const gained = last.get(p)! - skill0.get(p)!;
    const theirs = given.get(roomOf.get(p)!) ?? 0;
    expect(gained).toBeGreaterThan((theirs - 30) * 50);
    expect(gained).toBeLessThanOrEqual(theirs * 50);
  }  // Those who reached the end of school: out of the classroom, with a certificate of their years.
  const certs = recs.filter((r) => r.kind === "school_certificate");
  const leavers = pupils.map((o: any) => o.occupant).filter((p: string) => ageAt0(p) === 17);
  for (const c of certs) expect(c.data.years).toBeGreaterThanOrEqual(12);
  if (leavers.length) expect(certs.length).toBeGreaterThan(0);

  // ---- care ----
  const began = ev.filter((e) => e.event === "condition_began");
  const requests = recs.filter((r) => r.kind === "care_request");
  const treated = ev.filter((e) => e.event === "condition_treated");
  expect(began.length).toBeGreaterThan(20);
  // Most who could go, went; most who went were seen.
  expect(requests.length * 10).toBeGreaterThan(began.length * 5);
  expect(treated.length * 10).toBeGreaterThanOrEqual(requests.length * 7);
  // Seen: the condition lasts a fifth less of what was left of it.
  for (const x of treated) {
    const b = began.find((e) => e.condition === x.condition)!;
    // (Or it ends a tick from being seen, the least the kernel leaves a treated condition: someone seen in the last
    // hour of an illness. First met on 2026-10-12, in the town as drawn with homes by income: 979 seconds over.)
    expect(x.until < b.until || x.until - x.t <= 3_600).toBe(true);
  }
  // Too ill to work: workers out of their workplace while it lasts, and back after.
  // (Each tells their employer; once better, they're back at work.)
  const sick = recs.filter((r) => r.kind === "sick_leave");
  expect(sick.length).toBeGreaterThan(0);
  const back = sick.filter((r) => ev.some((e) => e.event === "occupied" && e.occupant === r.speaks_for && e.space.includes("/workplace.") && e.t > r.at));
  expect(back.length).toBeGreaterThan(0);

  // Nothing refused but the usual races (and a patient who'd gone home before being seen; and a building under water,
  // in a spring flood: the weather's; and, as the households and deaths tests allow with the daily round, a partner
  // gone to work while a conception was under way, "isn't near": which couple and which morning is the town's draw).
  const partnerGone = (e: any) => e.code === "too_far" && / isn't near /.test(e.detail ?? "");
  expect(ev.filter((e) => e.event === "action_refused" && !["not_present", "not_at_work", "capacity_exceeded", "no_time_left", "insufficient_quantity", "dead", "participant_inactive", "flooded"].includes(e.code) && !partnerGone(e)).map((e) => e.code)).toEqual([]);
}, 2_400_000);

test("with care in the world, treatable deaths come through severe illness, and with care as usual each age dies at the life table's rate", () => {
  const withCare = generate({ ...spec, years: 1 }).life, without = generate({ ...spec, years: 1, services: false }).life;
  const severe = withCare.illness.severity.find((b: any) => b.label === "severe");
  expect(severe.fatal_by_age.length).toBeGreaterThan(70);
  expect(without.illness.severity.every((b: any) => !b.fatal_by_age)).toBe(true);
  const at = (steps: any[], age: number) => [...steps].reverse().find((x) => x.from <= age)?.bps ?? 0;
  for (const age of [30, 50, 65, 74]) {
    const table = at(without.other_causes.by_age, age);
    expect(at(withCare.other_causes.by_age, age)).toBeLessThan(table);
    // Expected deaths, with 90% treated and care halving a death: within a basis point of the table.
    const incidence = (at(withCare.illness.by_age, age) * severe.share_bps) / 10_000;
    const expected = at(withCare.other_causes.by_age, age) + (incidence * at(severe.fatal_by_age, age) * (0.9 * 0.5 + 0.1)) / 10_000;
    expect(Math.abs(expected - table)).toBeLessThan(1);
  }
  // From 75 the life table carries every death (treatable mortality is counted under 75).
  expect(at(withCare.other_causes.by_age, 80)).toBe(at(without.other_causes.by_age, 80));
});

test("a town without them: no skill, no clinic, no school", () => {
  const config = generate({ ...spec, years: 1, services: false });
  expect(config.catalogue.body_variables).toBeUndefined();
  expect(config.catalogue.tasks.some((t: any) => t.labour_by || t.on_body)).toBe(false);
  expect(config.world.entities.some((e: any) => e.id === "clinic" || e.id === "school" || e.variables)).toBe(false);
});
