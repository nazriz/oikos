// An experiment that runs today (docs/experiments.md): who keeps the weather bureau. The same town and seed, forked at
// day 15, the bureau's post held by its own code, by nobody, and by mock models that act late or unreliably; the
// measures are what the bureau did and when. The bureau is the one office the Rust engine has ported so far, so the
// rest of the town stands idle (OIKOS_STAND_IN=idle); once every lane has merged, `tribunal-stewards.json` is the
// same experiment on the tribunal, with a real town around it.
//
//   bun orchestrator/src/cli.ts experiment run experiments/weather-stewards.ts --out runs/exp-weather
import type { ExperimentSpec } from "../orchestrator/src/experiment";

const spec: ExperimentSpec = {
  name: "weather-stewards",
  world: {
    file: "worlds/town.yaml",
    sets: ["years=1", "citizens=60"],
    // The town with only the bureau awake, its spells of weather set by the seed (so the seeds differ).
    prepare(config: any, seed: number) {
      const bureau = config.positions.find((x: any) => x.role_module?.code === "world.weather" || config.participants.find((p: any) => p.id === x.holder)?.controller?.impl === "world.weather");
      const holder = config.participants.find((p: any) => p.id === bureau.holder);
      const params = holder.kind === "system" ? holder.controller.params : bureau.role_module.params;
      params.events = [{ kind: "heatwave", from_day: 20 + (seed % 5), days: 20 }, { kind: "heavy_rain", from_day: 33 + (seed % 4), days: 3 }];
      const idle = (c: any) => (c && c.impl !== "world.weather" ? { type: "code", impl: "idle" } : c);
      for (const p of config.participants) if (p.controller) p.controller = idle(p.controller);
      for (const t of config.templates ?? []) if (t.controller) t.controller = idle(t.controller);
      for (const x of config.positions) if (x.role_module?.code && x.role_module.code !== "world.weather") x.role_module = { ...x.role_module, code: "idle", params: {} };
      return config;
    },
  },
  post: "weather-bureau",
  seeds: [1, 2, 3],
  forkDay: 15,
  untilDay: 45,
  arms: [
    { name: "code", steward: { kind: "code" } },
    { name: "nobody", steward: { kind: "none" } },
    { name: "diligent", steward: { kind: "model", model: "mock/diligent" } },
    { name: "three-days-late", steward: { kind: "model", model: "mock/delay:3" } },
    { name: "drops-every-2nd", steward: { kind: "model", model: "mock/skip:2" } },
  ],
  reference: "code",
  measures: ["acts", "records:weather_warning", "first_record:weather_warning", "first_act_day", "log_entries"],
  // Placeholder prices (micro-USD per million tokens), so the mock models' cost lines show something.
  prices: { "mock/diligent": { input: 3_000_000, output: 15_000_000 }, "mock/delay:3": { input: 3_000_000, output: 15_000_000 }, "mock/skip:2": { input: 1_000_000, output: 5_000_000 } },
  standIn: "idle",
};
export default spec;
