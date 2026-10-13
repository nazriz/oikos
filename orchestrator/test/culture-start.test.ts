// Where people start on what is approved (docs/behaviour/culture.md, "How it starts"): from the profile's sourced attitudes, mapped per conduct,
// and from values alone where the profile has no figure. The figures are profile data; no place's figure is in the code. No model is called.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { PROFILE_DIR } from "@oikos/worlds/generator/profile";
import { Culture, cultureDial, standardNormal, type CultureEnv } from "../../participants/src/behaviour/culture";
import { Randomness } from "../../participants/src/rng";

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
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const people = Array.from({ length: 400 }, (_, i) => {
    const rng = new Randomness(7n).stream([`p${i}`, "x"]);
    const env: CultureEnv = { z: () => standardNormal(rng) * 0.5, conformity: () => 0.5, belonging: () => 0.5, integrity: () => 0.5, draw: () => standardNormal(rng) };
    return new Culture(d.params, d, env, { answer_tribunal: 6_000, join_union: 3_000, strike: 4_000 });
  });
  const at = (c: any, f: "approves" | "own") => mean(people.map((p) => p.read(c, 0)![f]));
  expect(at("join_union", "approves")).toBe(2_900); // the picture everyone starts with
  expect(Math.abs(at("join_union", "own") - 2_900)).toBeLessThan(250); // the lean is spread around it
  expect(at("answer_tribunal", "approves")).toBe(5_890);
  expect(at("strike", "approves")).toBe(5_000); // no figure: values alone, as before
});
