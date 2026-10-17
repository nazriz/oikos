// The port's worked example (docs/port-guide.md): world.weather in Rust, run by the engine, against the TS module run
// by the TS loop, in the same generated town with every other actor standing idle (in both worlds: the TS world's
// `idle` and the engine's are the same rule). A faithful port of a module and of the loop gives the same world, to the
// state hash; and the Rust world is the same on 1 thread and on 14.

import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { runWorld } from "../src/run";
import { kernelBinary } from "../src/kernel";
import { officeAt } from "./lib/offices";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

/** The town with every actor but the weather bureau standing idle: participants, templates (those born or arriving
 * later) and the posts people hold by a role's procedures. */
function weatherOnly(): any {
  const config = generate({ ...spec, years: 1 }) as any;
  const bureau = officeAt(config, "weather-bureau").holder;
  bureau.controller.params.events = [{ kind: "heatwave", from_day: 20, days: 20 }, { kind: "heavy_rain", from_day: 33, days: 3 }];
  const idle = (c: any) => (c && c.impl !== "world.weather" ? { type: "code", impl: "idle" } : c);
  for (const p of config.participants) if (p.controller) p.controller = idle(p.controller);
  for (const t of config.templates ?? []) if (t.controller) t.controller = idle(t.controller);
  for (const x of config.positions) if (x.role_module?.code && x.role_module.code !== "world.weather") x.role_module = { ...x.role_module, code: "idle", params: {} };
  return config;
}

function rust(config: any, dir: string, threads: number, until: number): { state_hash: string; wall_ms: number; decide_ms: number; steps: number } {
  const path = join(dir, "config.json");
  writeFileSync(path, JSON.stringify(config));
  const r = Bun.spawnSync([kernelBinary(), "world", path, "--out", dir, "--run-id", `rust-${threads}`, "--until", String(until), "--threads", String(threads)], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(r.stderr.toString());
  return JSON.parse(r.stdout.toString().trim());
}

test("the weather bureau in Rust warns as the TS module did, to the state hash, and on any number of threads", async () => {
  const config = weatherOnly();
  const until = 40 * DAY;
  const out = join(root, "runs", "test-port-weather");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const ts = await runWorld({ config: structuredClone(config), runId: "ts", outDir: out, until });
  const one = rust(config, out, 1, until);
  const many = rust(config, out, 14, until);
  expect(many.state_hash).toBe(one.state_hash);
  const warnings = (file: string) => readFileSync(join(out, file), "utf8").trim().split("\n").map((l) => JSON.parse(l))
    .filter((e) => e.kind === "event" && e.body.event === "recorded" && e.body.record.kind === "weather_warning").map((e) => ({ at: e.body.record.at, text: e.body.record.text, data: e.body.record.data, visible: e.body.record.visible_to }));
  expect(warnings("rust-1.jsonl")).toEqual(warnings("ts.jsonl"));
  expect(warnings("ts.jsonl").length).toBe(2);
  expect(one.state_hash).toBe(ts.stateHash);
  rmSync(out, { recursive: true, force: true });
}, 120_000);
