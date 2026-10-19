// Where people start on what is approved (docs/behaviour/culture.md, "How it starts"): from the profile's sourced attitudes, mapped per conduct,
// and from values alone where the profile has no figure. The figures are profile data; no place's figure is in the code. No model is called.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { PROFILE_DIR } from "@oikos/worlds/generator/profile";
import { cultureDial } from "../../participants/src/shared/culture";

const root = join(import.meta.dir, "../..");
const base = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
const profiles = readdirSync(PROFILE_DIR).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(PROFILE_DIR, f), "utf8")));

test("every profile starts four conducts from the confidence its own outlook records, with the mapping and its weakness stated beside it", () => {
  const MAP: { [c: string]: string } = { answer_tribunal: "courts", take_to_tribunal: "courts", complain: "civil_service", join_union: "unions" };
  for (const p of profiles) {
    const c = p.values.culture?.conducts;
    expect(c, p.id).toBeDefined();
    for (const [conduct, item] of Object.entries(MAP)) expect(c[conduct].approves_bps, `${p.id} ${conduct}`).toBe(p.values.outlook.trust[item]);
    expect(Object.keys(c).sort(), p.id).toEqual(Object.keys(MAP).sort()); // (no figure for a conduct nobody opened a source for)
    expect(c.answer_tribunal.does_bps).toBeUndefined(); // (what is done is the profile's own rate)
    expect(p.sources["culture.conducts"], p.id).toMatch(/Weak:/);
  }
});

test("a dial-on town carries the figures, a dial-off town does not, and people start their pictures and leans around them, not at 50", () => {
  const off = generate({ ...base, profile: "au-vic-2026", seed: 1 }) as any;
  expect(JSON.stringify(off)).not.toContain("approves_bps");
  const on = generate({ ...base, profile: "au-vic-2026", seed: 1, living: { initiative_bps: 10_000, culture: true } }) as any;
  const d = cultureDial(on)!;
  expect(d.figures.answer_tribunal!.approves_bps).toBe(5_890);
  expect(d.figures.join_union!.approves_bps).toBe(2_900);
  // (What a person starts with, the picture and the lean around it, is the engine's: kernel/crates/actors/src/mind/culture.rs, `a_person_starts_with_the_profiles_picture`.)
});
