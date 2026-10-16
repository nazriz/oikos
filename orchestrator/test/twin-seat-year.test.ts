// The real pilot shape, act for act, over a year in which residents die (review of foundations, findings 1 and 10).
// Since foundations F5 a model's seat in a post is a participant of its own (`<post>-system`, `shares_body`) beside the
// person who holds the post, and its mock is the office's own code as its brain. A town with such seats is the town
// without them but for those posts (docs/design/foundations.md section 4): here the two towns are run from one seed for a
// year with deaths well above life's, seats in the posts of two people who die early in it, and every act and every event of the world
// must be the same, but for the names of the seats. A seated resident who dies must take the seat with them (the seat
// ends and the post falls vacant at that moment, in both towns): finding 1 was a seat that outlived its body.
//
// (What this test holds, and what it cannot yet: the seats are those of two councillors, whose posts have no work in the
// year, and both of them die (day 68 and day 79), so that for most of the year the seats are gone and the towns are the same
// town to the second. A seat that stays alive and in a post with work does not give the twin to the second: a seat keeps
// the office's sittings (generate.ts, model_seats), so its acts are at other moments, and beyond that the engine hands news
// that comes while time moves on (a delivery, a letter) to a person at the first cohort it has after it, which a seat's
// units no longer give where the code's units did: in a run of this town a shop worker met their goods at 14906400 where the
// twin had them at 14906100, from one live councillor's seat alone (day 172). See the review of foundations, findings 10.)

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
const SEATS = ["councillor-4", "land-registrar"];

async function town(name: string, seats: string[]) {
  const dir = mkdtempSync(join(tmpdir(), `oikos-${name}-`));
  try {
    const config = generate({ ...spec, ...(seats.length ? { model_seats: seats } : {}) });
    // Far more deaths than life (25% a year from 25), so that some of those seated die within the year.
    config.life.other_causes.by_age = [{ from: 0, bps: 0 }, { from: 25, bps: 2500 }];
    const held = new Map<string, string>(config.positions.map((p: any) => [p.id, config.participants.find((q: any) => q.id === p.holder)?.person ?? p.holder]));
    const s = await runWorld({ config, runId: name, outDir: dir, until: 365 * DAY, logDetail: "lean", recordObservations: "none" } as any);
    expect(s.participantErrors).toBe(0);
    return { lines: readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l)), held };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("a year of the town with seats beside their people is the town without them, act for act, and a seated resident who dies takes the seat with them", async () => {
  const t0 = Date.now();
  const [twin, pilot] = await Promise.all([town("twin-seat-code", []), town("twin-seat-mock", SEATS)]);
  // A seat's name is the name of the person it sits beside, whose acts they are (the twin's participant for them).
  const names = new Map<string, string>(SEATS.map((id) => [`${id}-system`, `${twin.held.get(id)!}-self`]));
  const plain = (x: string) => { let y = x; for (const [a, b] of names) y = y.split(a).join(b); return y; };
  const rows = (lines: any[], kind: string) => lines.filter((l) => l.kind === kind);
  // (Every act in order: when, by whom, doing what. Not by the day: to the second.)
  const acts = (r: typeof twin) => rows(r.lines, "command").filter((l) => l.body.command === "act").map((l) => plain(`${l.t}|${l.body.participant}|${JSON.stringify(l.body.blocks)}`));
  // (Every event of the world but the seats' own coming and going.)
  const events = (r: typeof twin) => rows(r.lines, "event").filter((l) => !names.has(l.body.participant) && l.body.event !== "observation").map((l) => plain(`${l.t}|${JSON.stringify({ ...l.body, cause: undefined })}`)).sort();
  const a = acts(twin), b = acts(pilot);
  console.log(`twin seats: ${a.length} acts in the twin, ${b.length} beside the seats; ${events(twin).length} events; ${((Date.now() - t0) / 60_000).toFixed(1)} min`);
  expect(a.length).toBeGreaterThan(10_000);
  // The seated who died: the same people at the same moments in both towns.
  const died = (r: typeof twin) => rows(r.lines, "event").filter((l) => l.body.event === "person_died").map((l) => `${l.t}|${l.body.person}`);
  const seatedPeople = new Set(SEATS.map((id) => twin.held.get(id)!));
  const seatedDead = died(pilot).filter((x) => seatedPeople.has(x.split("|")[1]!));
  console.log(`twin seats: ${seatedDead.length} of the ${seatedPeople.size} seated died in the year`);
  expect(seatedDead.length).toBeGreaterThan(0);
  expect(died(pilot)).toEqual(died(twin));
  for (const d of seatedDead) {
    const t = Number(d.split("|")[0]), person = d.split("|")[1]!;
    for (const post of SEATS.filter((id) => twin.held.get(id) === person)) {
      const seat = `${post}-system`;
      // The seat ended with them, at that moment, and did nothing after.
      const ended = rows(pilot.lines, "event").filter((l) => l.body.event === "participant_ended" && l.body.participant === seat);
      expect(ended.map((l) => l.t)).toEqual([t]);
      expect(rows(pilot.lines, "command").filter((l) => l.body.participant === seat && l.t > t).length).toBe(0);
      // And the post fell vacant at that moment, in both towns.
      const vacated = (r: typeof twin) => rows(r.lines, "event").filter((l) => l.body.event === "appointed" && l.body.position === post && l.body.holder == null).map((l) => l.t);
      expect(vacated(pilot)[0]).toBe(t);
      expect(vacated(twin)[0]).toBe(t);
    }
  }
  expect(b.length).toBe(a.length);
  expect(b).toEqual(a);
  expect(events(pilot)).toEqual(events(twin));
}, 1_800_000);
