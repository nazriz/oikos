// Weather and roads (docs/behaviour/weather.md, daily-round.md; docs/design/world-expansion.md 6.3, 7.3).
// Weather: drawn from the profile's climate (the season's rain, heavy rain, drought, heatwaves), fixed before the run;
// the river's inflow follows it, heat lies on the land on heatwave days (more on built ground) and makes illness
// likelier, and the weather bureau warns ahead. Roads: streets laid across the town, quicker to travel; the town builds
// toward buildings that stand too far from one, within its roads budget, permit first.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { drawWeather } from "@oikos/worlds/generator/weather";
import { loadProfile } from "@oikos/worlds/generator/profile";
import { Randomness } from "@oikos/participants";
import { runWorld } from "../src/run";
import { officeAt, officeBy, officesBy } from "./lib/offices";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

test("weather is drawn from the climate: the season, heavy rain, drought and heatwaves", () => {
  const C = loadProfile("au-vic-2026").values.climate!;
  const r = new Randomness(7n).stream(["weather"]);
  const w = drawWeather({ ...C, storm_bps_per_month: 10_000, drought_bps_per_year: 10_000, heatwave_bps_per_week: 10_000 }, 365, (n: number) => r.below(n), 1);
  const kinds = new Set(w.events.map((e) => e.kind));
  expect([...kinds].sort()).toEqual(["drought", "heatwave", "heavy_rain"]);
  // The season: drier in summer than in winter, before anything else.
  const calm = drawWeather({ ...C, storm_bps_per_month: 0, drought_bps_per_year: 0, heatwave_bps_per_week: 0 }, 365, (n: number) => r.below(n), 1);
  const at = (day: number) => [...calm.rain].reverse().find((s) => s.from_day <= day)!.bps;
  expect(at(15)).toBeLessThan(at(200));
  expect(calm.heat).toEqual([{ from_day: 0, bps: 0 }]);
  expect(calm.events).toEqual([]);
  // Heatwaves only in summer; heat on their days only.
  for (const e of w.events.filter((x: { kind: string }) => x.kind === "heatwave")) {
    const month = Math.floor(e.from_day / (365 / 12)) + 1;
    expect(C.summer_months).toContain(month > 12 ? month - 12 : month);
  }
  // Seeded: the same draw twice.
  const draw = () => { const x = new Randomness(7n).stream(["weather"]); return drawWeather(C, 730, (n: number) => x.below(n), 3); };
  expect(draw()).toEqual(draw());
});

test("streets are laid, the bureau warns ahead, heat makes illness likelier, and the town builds roads toward buildings", async () => {
  const config = generate({ ...spec, years: 1 }) as any;
  const roads = config.world.structures.filter((s: any) => s.type === "road");
  expect(roads.length).toBeGreaterThan(20);
  expect(config.catalogue.structure_types.find((t: any) => t.id === "road").cover).toBe("road");
  expect(config.catalogue.travel.by_cover.road).toBeLessThan(config.catalogue.travel.seconds_per_cell);
  // A heatwave from day 20 to day 40, hot enough that its illness shows in a small town (a test's, not the climate's).
  const heat = config.catalogue.fields.find((f: any) => f.id === "heat");
  heat.source_by_day = [{ from_day: 0, bps: 0 }, { from_day: 20, bps: 10_000 }, { from_day: 40, bps: 0 }];
  config.life.illness.fields.find((f: any) => f.field === "heat").bps_per_unit = 3_000;
  const bureau = officeAt(config, "weather-bureau").holder;
  bureau.controller.params.events = [{ kind: "heatwave", from_day: 20, days: 20 }];
  // The mayor builds toward anything not beside a road (a test's threshold: the town's is a few cells).
  const mayor = officeAt(config, "mayor");
  for (const prm of [mayor.params, mayor.holder.controller?.type === "llm" ? mayor.holder.controller.params?.mock?.params : undefined].filter(Boolean)) prm.road_within = 1;

  const out = join(root, "runs", "test-weather-roads");
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config, runId: "weather-roads", outDir: out, until: 150 * DAY });
  expect(s.participantErrors).toBe(0);
  const log = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const ev = log.filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
  const said = ev.filter((e) => e.event === "recorded").map((e) => e.record);

  // Warned ahead, publicly.
  const warning = said.find((r) => r.kind === "weather_warning");
  expect(warning?.data.kind).toBe("heatwave");
  expect(warning.at).toBeLessThan(20 * DAY);
  expect(warning.at).toBeGreaterThanOrEqual(17 * DAY);
  expect(warning.visible_to).toBe("public");
  // Illness: likelier in the heat than in the same span of days before and after it.
  const ill = ev.filter((e) => e.event === "condition_began" && e.kind === "illness").map((e) => e.t / DAY);
  const during = ill.filter((d) => d >= 20 && d < 40).length;
  const around = ill.filter((d) => (d >= 0 && d < 20) || (d >= 40 && d < 60)).length;
  expect(during).toBeGreaterThan(around);
  // Roads: the town applies for a permit for a road beside the network, is granted it, and commissions the builder.
  const app = said.find((r) => r.kind === "permit_application" && r.data.structure_type === "road");
  expect(app?.speaks_for).toBe("city");
  const granted = said.find((r) => r.kind === "permit_decision" && r.data.application === app.id);
  expect(granted?.data.decision).toBe("granted");
  const began = log.find((e) => e.kind === "command" && (e.body.blocks ?? []).some((b: any) => b.block === "construct" && b.structure_type === "road"));
  expect(began).toBeDefined();
}, 2_400_000);
