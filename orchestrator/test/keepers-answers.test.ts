// Foundations F11 (docs/design/foundations.md law 7; docs/design/knowing.md section 12): a question put to a register's
// keeper is answered in its performer's time. In a generated town the land registry's officers are people hired from the
// town, and each answer takes one of them ten minutes (a placeholder row of the work table); the asker has the answer when
// it is done, and not before.

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

test("in a generated town the registry's questions take its officers' time, one at a time each, and are answered when done", async () => {
  const config = generate({ ...spec, citizens: 300, living: { initiative_bps: 10_000 } }) as any;
  // The table has a row for an answer, for a person and for a system, and the registry's posts are held by people.
  expect(config.orchestration.act_time.person.answer).toBeGreaterThan(0);
  expect(config.orchestration.act_time.system.answer).toBeGreaterThan(0);
  const keeper = config.positions.filter((p: any) => p.entity === "land-registry");
  expect(keeper.length).toBeGreaterThan(0);
  const people = new Set(config.participants.filter((p: any) => p.kind === "person").map((p: any) => p.id));
  expect(keeper.every((p: any) => people.has(p.holder))).toBe(true);
  const dir = mkdtempSync(join(tmpdir(), "oikos-keepers-"));
  try {
    const s = await runWorld({ config, runId: "keepers", outDir: dir, until: 150 * DAY, logDetail: "lean", recordObservations: "none" } as any);
    expect(s.participantErrors).toBe(0);
    const started: any[] = [], answered: any[] = [];
    for (const l of readFileSync(s.logPath, "utf8").split("\n")) {
      if (l.includes('"event":"ask_started"')) started.push(JSON.parse(l));
      else if (l.includes('"event":"ask_answered"')) answered.push(JSON.parse(l));
    }
    expect(started.length).toBeGreaterThan(5);
    // Each is answered by an officer of the registry, for ten minutes of theirs, when it is done; none is answered twice.
    const officers = new Set(keeper.map((p: any) => p.holder));
    const byAsker = new Map<string, number[]>();
    for (const a of answered) byAsker.set(`${a.body.participant}|${a.body.as ?? ""}|${a.body.channel}`, [...(byAsker.get(`${a.body.participant}|${a.body.as ?? ""}|${a.body.channel}`) ?? []), a.t]);
    const perOfficer = new Map<string, { starts: number; done: number }[]>();
    for (const e of started) {
      expect(e.body.keeper).toBe("land-registry");
      expect(officers.has(e.body.by), `${e.body.by} answers for the registry`).toBe(true);
      expect(e.body.done - e.body.starts).toBe(config.orchestration.act_time.person.answer);
      perOfficer.set(e.body.by, [...(perOfficer.get(e.body.by) ?? []), { starts: e.body.starts, done: e.body.done }]);
    }
    expect(answered.length).toBeLessThanOrEqual(started.length);
    expect(answered.length).toBeGreaterThan(0);
    // An officer answers one at a time: their answers do not overlap, though they may be queued behind the officer's other work.
    for (const [who, rows] of perOfficer) {
      rows.sort((a, b) => a.starts - b.starts);
      for (let i = 1; i < rows.length; i++) expect(rows[i]!.starts, `${who}'s answers overlap`).toBeGreaterThanOrEqual(rows[i - 1]!.done);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 600_000);
