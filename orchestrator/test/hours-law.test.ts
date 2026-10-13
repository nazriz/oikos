// The law on cutting hours, from every profile (docs/behaviour/firms.md, "Hours before heads"): published in the town
// as the profile states it, the same way for every place; a place whose profile states none has none, and its firms
// do not cut hours. Checked on the worlds as generated.

import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { generate, generateFrom } from "@oikos/worlds/generator/generate";
import { loadProfile, PROFILE_DIR } from "@oikos/worlds/generator/profile";

const root = join(import.meta.dir, "../..");
const spec = { ...(Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any), citizens: 100 };
const ids = readdirSync(PROFILE_DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort();

test("every profile states its law on cutting hours with a source, and the town publishes exactly that", () => {
  for (const id of ids) {
    const P = loadProfile(id) as any;
    const H = P.values.employment?.hours;
    expect({ id, stated: !!H }).toEqual({ id, stated: true });
    expect({ id, may: ["notice", "consent", "no"].includes(H.may_cut) }).toEqual({ id, may: true });
    expect({ id, source: typeof P.sources["employment.hours"] === "string" && P.sources["employment.hours"].length > 100 }).toEqual({ id, source: true });
    const laws = generate({ ...spec, profile: id }).world.records.filter((r: any) => r.kind === "law" && r.data?.employment === "hours");
    expect(laws.map((r: any) => r.id)).toEqual(["law-cutting-hours"]);
    expect(laws[0].data).toMatchObject({ may_cut: H.may_cut, ordinary_week_hours: H.ordinary_week_hours, floor_bps: H.floor_bps ?? 0, max_days: H.max_days ?? 0, pay_bps: H.pay_bps ?? 0 });
    // Every figure is a whole number (the contract takes no other).
    for (const [k, v] of Object.entries(laws[0].data)) if (typeof v === "number") expect({ id, k, whole: Number.isInteger(v) }).toEqual({ id, k, whole: true });
  }
}, 240_000);

test("a profile that states no law on hours has none in its town", () => {
  const P = structuredClone(loadProfile(ids[0]!)) as any;
  delete P.values.employment.hours;
  const c = generateFrom({ ...spec, profile: ids[0]! }, P);
  expect(c.world.records.some((r: any) => r.data?.employment === "hours")).toBe(false);
}, 120_000);
