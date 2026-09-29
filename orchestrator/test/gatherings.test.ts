// Gatherings (practices: docs/design/ai-citizens.md 2b): the world's groups and the union meet in the town hall's hall.
// Going is physics (being in the space for its time); whether to go is each person's. People are there only while a
// gathering is on, and go home when it ends; a members' meeting is for members; and those who belong to a group at the
// start are those who go first.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@terrarium/worlds/generator/generate";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

test("people go to the gatherings they may come to, while they're on, and go home after", async () => {
  const config = generate(spec);
  const out = join(root, "runs", "test-gatherings");
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config, runId: "gatherings", outDir: out, until: 90 * DAY });
  expect(s.participantErrors).toBe(0);
  const ev = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
  const practices = config.world.records.filter((r: any) => r.practice);
  expect(practices.length).toBeGreaterThan(1);
  const inHall = ev.filter((e) => e.event === "occupied" && String(e.space).includes("/hall."));
  expect(inHall.length).toBeGreaterThan(50);
  // Each arrival is during a gathering held there; each leaves by its end (within the clock's hour).
  const isOn = (r: any, t: number) => {
    const p = r.practice;
    const k = Math.floor((t - p.first) / p.every);
    return k >= 0 && t >= p.first + k * p.every && t < p.first + k * p.every + p.lasts;
  };
  const on = (t: number) => practices.find((r: any) => isOn(r, t));
  for (const e of inHall) {
    const r = on(e.t);
    expect(r).toBeDefined();
    const start = r.practice.first + Math.floor((e.t - r.practice.first) / r.practice.every) * r.practice.every;
    const left = ev.find((x) => x.event === "vacated" && x.occupant === e.occupant && x.space === e.space && x.t >= e.t);
    if (start + r.practice.lasts < 90 * DAY) expect(left && left.t <= start + r.practice.lasts + 3_600).toBeTruthy();
  }
  // The union's meeting is for its members.
  const members = new Set(config.world.records.filter((r: any) => r.record === "agreement" && r.terms.template === "membership" && r.terms.parties.includes("union")).flatMap((r: any) => r.terms.parties));
  const union = practices.find((r: any) => r.speaks_for === "union");
  // (Only where the union's is the one gathering on at the time: two can share the hall.)
  const onlyUnion = (t: number) => practices.filter((r: any) => isOn(r, t)).map((r: any) => r.id).join() === union?.id;
  const atUnion = inHall.filter((x) => onlyUnion(x.t));
  for (const e of atUnion) expect(members.has(e.occupant)).toBe(true);
  // The first week: those who came belong to a group whose gathering it was (their routine).
  const belongs = (who: string, practice: string) => config.world.records.some((r: any) => r.record === "agreement" && r.terms.parties.includes(who) &&
    r.terms.commitments.some((c: any) => c.who === who && c.does?.outcome?.attend?.practice === practice));
  const firstWeek = inHall.filter((e) => e.t < 8 * DAY);
  expect(firstWeek.length).toBeGreaterThan(5);
  expect(firstWeek.filter((e) => belongs(e.occupant, on(e.t).id)).length / firstWeek.length).toBeGreaterThan(0.8);
}, 600_000);
