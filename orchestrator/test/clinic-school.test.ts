// The clinic and the school (docs/design/world-expansion.md 4), in a generated town over a year: children of school age
// are at school, taught on school days, and their skill rises by about a 200th of a year's schooling a day; those who
// reach the end of school get a certificate; the ill and injured stay off work and most go to the clinic, where they're
// seen and their conditions shortened. (Illness five times the profile's, so a year has cases enough to follow.)

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@terrarium/worlds/generator/generate";
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
  const pupils = config.world.occupancy.filter((o: any) => o.space.includes("/classroom."));
  const ageAt0 = (p: string) => Math.floor(-born.get(p)! / YEAR);
  expect(pupils.length).toBe([...born.keys()].filter((p) => ageAt0(p) >= 5 && ageAt0(p) <= 17).length);
  const lessons = ev.filter((e) => e.event === "worked" && e.task === "teach");
  const classrooms = new Set(lessons.map((e) => e.on)).size;
  expect(lessons.length / classrooms).toBeGreaterThan(170);
  expect(lessons.length / classrooms).toBeLessThanOrEqual(205); // (a 365-day year holds a day or so more than 200)
  // A pupil who stayed the year: about a year's schooling more (a lesson is 50), as the engine keeps it.
  const last = new Map<string, number>();
  for (const e of ev.filter((e) => e.event === "body_changed" && e.variable === "skill")) last.set(e.person, e.value);
  const gone = new Set(ev.filter((e) => e.event === "person_left" || e.event === "person_died").map((e) => e.person));
  const stayed = pupils.map((o: any) => o.occupant).filter((p: string) => ageAt0(p) <= 15 && last.has(p) && !gone.has(p));
  expect(stayed.length).toBeGreaterThan(5);
  for (const p of stayed) {
    const gained = last.get(p)! - skill0.get(p)!;
    expect(gained).toBeGreaterThan(170 * 50);
    expect(gained).toBeLessThanOrEqual(205 * 50);
  }
  // Those who reached the end of school: out of the classroom, with a certificate of their years.
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
    expect(x.until).toBeLessThan(b.until);
  }
  // Too ill to work: workers out of their workplace while it lasts, and back after.
  const offSick = log.filter((e) => e.kind === "command" && /Too ill to work/.test(JSON.stringify(e.body))).length;
  const back = log.filter((e) => e.kind === "command" && /Better: back to work/.test(JSON.stringify(e.body))).length;
  expect(offSick).toBeGreaterThan(0);
  expect(back).toBeGreaterThan(0);

  // Nothing refused but the usual races (and a patient who'd gone home before being seen).
  expect(ev.filter((e) => e.event === "action_refused" && !["not_present", "not_at_work", "capacity_exceeded", "no_time_left"].includes(e.code)).map((e) => e.code)).toEqual([]);
}, 900_000);

test("a town without them: no skill, no clinic, no school", () => {
  const config = generate({ ...spec, years: 1, services: false });
  expect(config.catalogue.body_variables).toBeUndefined();
  expect(config.catalogue.tasks.some((t: any) => t.labour_by || t.on_body)).toBe(false);
  expect(config.world.entities.some((e: any) => e.id === "clinic" || e.id === "school" || e.variables)).toBe(false);
});
