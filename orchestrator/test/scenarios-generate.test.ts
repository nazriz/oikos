// Scenarios (docs/scenarios.md), generated, not run: the establishments a scenario shifts at 1,000 people, and every
// scenario from every profile one by one. (Split out of orchestrator/test/scenarios.test.ts at the test pruning,
// 2026-10-24, so that the sixty-day runs there are not followed by these in the same file; what each scenario changes
// of the town, quickly: worlds/test/scenario.test.ts.)

import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { generate, type TownSpec } from "@oikos/worlds/generator/generate";
import { loadProfile, PROFILE_DIR, type Profile } from "@oikos/worlds/generator/profile";
import { scenarioIds } from "@oikos/worlds/generator/scenario";
import { officeAt } from "./lib/offices";

const root = join(import.meta.dir, "../..");
const WORLD = "worlds/town-1000.yaml";

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
