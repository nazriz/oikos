// Scenarios (docs/scenarios.md), run: the 1,000-person town under each one, for sixty days, with the mock in the
// mayor's, planning and finance offices (as pilots hand them to a model), through the command line as a pilot is
// started (`--scenario`). Each must reach its sixtieth day with no participant failing. Several at a time, each in a
// process of its own. (What each changes of the town, quickly: worlds/test/scenario.test.ts.)

import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate, type TownSpec } from "@oikos/worlds/generator/generate";
import { loadProfile, PROFILE_DIR, type Profile } from "@oikos/worlds/generator/profile";
import { scenarioIds } from "@oikos/worlds/generator/scenario";
import { officeAt } from "./lib/offices";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const DAYS = 60;
const WORLD = "worlds/town-1000.yaml";
const SEATS = ["--set", "mayor=llm", "--set", "model_seats=planning,finance"];

test("the 1,000-person town under every scenario runs sixty days with mock participants, none failing", async () => {
  const ids = scenarioIds();
  // (Out of the repo, and removed at the end: nothing under runs/ is ever removed.)
  const dir = mkdtempSync(join(tmpdir(), "oikos-test-scenarios-"));
  const out = (id: string) => join(dir, id);
  const results = new Map<string, { code: number; said: string; summary?: any }>();
  let next = 0;
  const worker = async () => {
    for (;;) {
      const id = ids[next++];
      if (!id) return;
      const p = Bun.spawn(["bun", join(root, "orchestrator/src/cli.ts"), "run-one", WORLD, "--seed", "1", "--out", out(id), "--until", String(DAYS * DAY), "--scenario", id, ...SEATS, "--log", "lean"],
        { cwd: root, stdout: "pipe", stderr: "pipe" });
      const [o, e] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
      const code = await p.exited;
      let summary: any;
      try { summary = JSON.parse(readFileSync(join(out(id), "town-1000.seed1.summary.json"), "utf8")); } catch { /* (it says why below) */ }
      results.set(id, { code, said: (o + e).split("\n").slice(-15).join("\n"), summary });
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  for (const id of ids) {
    const r = results.get(id)!;
    if (r.code !== 0 || !r.summary) console.error(`${id}:\n${r.said}`);
    expect({ id, code: r.code, ran: !!r.summary }).toEqual({ id, code: 0, ran: true });
    expect({ id, days: r.summary.t / DAY, errors: r.summary.participantErrors, stopped: r.summary.stopped }).toEqual({ id, days: DAYS, errors: 0, stopped: undefined });
  }
  // The baseline is the plain town's run: the same state at the end as with no scenario named.
  const p = Bun.spawnSync(["bun", join(root, "orchestrator/src/cli.ts"), "run-one", WORLD, "--seed", "1", "--out", out("none"), "--until", String(DAYS * DAY), ...SEATS, "--log", "lean"], { cwd: root, stdout: "pipe", stderr: "pipe" });
  expect(p.exitCode).toBe(0);
  const plain = JSON.parse(readFileSync(join(out("none"), "town-1000.seed1.summary.json"), "utf8"));
  expect(results.get("baseline")!.summary.stateHash).toBe(plain.stateHash);
  // And every other is another world: no two end alike.
  const hashes = ids.map((id) => results.get(id)!.summary.stateHash);
  expect(new Set(hashes).size).toBe(ids.length);
  rmSync(dir, { recursive: true, force: true });
}, 3_600_000);

test("at 1,000 people, the scenarios that shift an establishment change how many it has", () => {
  const spec = Bun.YAML.parse(readFileSync(join(root, WORLD), "utf8")) as TownSpec;
  const P = loadProfile(spec.profile!).values;
  const params = (c: any, id: string) => officeAt(c, id).params;
  const plain = generate(spec) as any, short = generate({ ...spec, scenario: "doctor-shortage+police-understrength" }) as any;
  const people = plain.world.entities.filter((e: any) => e.kind === "person").length;
  const establishment = (per1000: number) => Math.max(1, Math.ceil((per1000 * people) / 1000));
  expect(params(plain, "clinic-manager").doctors).toBe(establishment(P.health!.doctors_per_1000));
  expect(params(short, "clinic-manager").doctors).toBe(establishment(P.health!.doctors_per_1000 / 2));
  expect(params(short, "clinic-manager").doctors).toBeLessThan(params(plain, "clinic-manager").doctors);
  expect(params(plain, "police-oic").officers).toBe(establishment(P.crime!.police_per_1000));
  expect(params(short, "police-oic").officers).toBe(establishment(P.crime!.police_per_1000 * 0.86));
  expect(params(short, "police-oic").officers).toBeLessThan(params(plain, "police-oic").officers);
});

test("a town generates under every scenario from every profile, one by one, or is told what the profile doesn't describe", () => {
  const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as TownSpec;
  for (const f of readdirSync(PROFILE_DIR).filter((x) => x.endsWith(".json"))) {
    const profile = (JSON.parse(readFileSync(join(PROFILE_DIR, f), "utf8")) as Profile).id;
    for (const id of scenarioIds()) {
      try {
        expect((generate({ ...spec, profile, scenario: id }) as any).participants.length).toBeGreaterThan(0);
      } catch (e) {
        expect(String(e)).toMatch(new RegExp(`scenario ${id}: the profile ${profile} has no `));
      }
    }
  }
}, 1_800_000);
