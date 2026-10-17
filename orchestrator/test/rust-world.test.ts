// The Rust world's host (orchestrator/src/rust-world.ts, OIKOS_WORLD=rust): `runWorld` handed to the engine gives the
// TS world's run of a module ported faithfully (world.weather, everything else idle), to the state hash; forks of one
// moment run side by side, their seats out at once, and alike when given the same; a mock seat sitting as its code
// twin is decided by the Rust kind run detached and warns as the code does; the manifests and the shared rules are
// read from Rust.

import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { canonical, planLawWords } from "@oikos/participants";
import { runWorld } from "../src/run";
import { RustWorld, rustManifests, rustRule } from "../src/rust-world";
import { officeAt } from "./lib/offices";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

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

const warnings = (lines: any[]) => lines.filter((e) => e.kind === "event" && e.body.event === "recorded" && e.body.record.kind === "weather_warning").map((e) => ({ at: e.body.record.at, text: e.body.record.text }));
const read = (path: string) => readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l));

test("runWorld on the Rust world (OIKOS_WORLD=rust) is the TS world's run, to the state hash", async () => {
  const config = weatherOnly();
  const until = 40 * DAY;
  const out = join(root, "runs", "test-rust-world");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const ts = await runWorld({ config: structuredClone(config), runId: "ts", outDir: out, until });
  const was = process.env.OIKOS_WORLD;
  process.env.OIKOS_WORLD = "rust";
  try {
    const rust = await runWorld({ config: structuredClone(config), runId: "rust", outDir: out, until });
    expect(rust.stateHash).toBe(ts.stateHash);
    expect(warnings(read(rust.logPath))).toEqual(warnings(read(ts.logPath)));
    expect(rust.end.reason).toBe("aborted");
  } finally {
    if (was === undefined) delete process.env.OIKOS_WORLD;
    else process.env.OIKOS_WORLD = was;
  }
  rmSync(out, { recursive: true, force: true });
}, 120_000);

test("forks of one moment run side by side with their seats out at once, and a twin seat warns as the code does", async () => {
  const code = weatherOnly();
  const until = 40 * DAY;
  // The bureau's holder made a mock seat sitting as its code twin.
  const twin = structuredClone(code);
  const holder = officeAt(twin, "weather-bureau").holder;
  holder.controller = { type: "llm", impl: "mock", params: { mock: { twin: true, brain: "world.weather", params: holder.controller.params } } };
  const c = RustWorld.start(code, { until, stand_in: "idle" });
  for (let d = c.next(); d.due !== "end"; d = c.next()) for (const s of d.seats) c.submit(s.key, { type: "wait" });
  const codeEnd = c.finish();
  const codeWarnings = warnings(new TextDecoder().decode(c.logBytes()!).trim().split("\n").map((l) => JSON.parse(l)));
  expect(codeWarnings.length).toBe(2);
  // To day 15, then two forks; every seat of both is answered after a model's pause, all at once.
  const w = RustWorld.start(twin, { until, stand_in: "idle" });
  const { DetachedActor } = await import("../src/rust-world");
  const brainOf = () => new DetachedActor({ kind: "world.weather", participant: holder.id, capacity: officeAt(twin, "weather-bureau").id, entity: officeAt(twin, "weather-bureau").entity, system: holder.kind === "system", params: holder.controller.params.mock.params, config: twin });
  const brain = brainOf();
  for (let d = w.nextBy(15 * DAY); d.due === "seats"; d = w.nextBy(15 * DAY)) for (const s of d.seats) w.submit(s.key, brain.step(s.observation, s.woke_for, s.since).action);
  const forks = [w.fork({}), w.fork({ threads: 7 })];
  // (Each fork's brain is the parent's as it stood: the same memory, view and draws, so the same decisions.)
  const brains = forks.map(() => brain.fork());
  const ends = await Promise.all(forks.map(async (f, i) => {
    let pending = 0;
    for (let d = f.next(); d.due !== "end"; d = f.next()) {
      const acts = await Promise.all(d.seats.map(async (s) => {
        pending++;
        await Bun.sleep(1);
        return s.participant === holder.id ? brains[i]!.step(s.observation, s.woke_for, s.since).action : { type: "wait" };
      }));
      d.seats.forEach((s, j) => f.submit(s.key, acts[j]!));
    }
    expect(pending).toBeGreaterThan(0);
    const end = f.finish();
    return { end, warnings: warnings(new TextDecoder().decode(f.logBytes()!).trim().split("\n").map((l) => JSON.parse(l))) };
  }));
  expect(ends[0]!.end.state_hash).toBe(ends[1]!.end.state_hash);
  // The twin's warnings after the fork are the code's after day 15 (the spells from day 20 and day 33, warned ahead).
  expect(ends[0]!.warnings).toEqual(codeWarnings.filter((x) => x.at > 15 * DAY));
  expect(ends[0]!.warnings.length).toBeGreaterThan(0);
  // And the parent, carried on, is its forks' world.
  for (let d = w.next(); d.due !== "end"; d = w.next()) for (const s of d.seats) w.submit(s.key, s.participant === holder.id ? brain.step(s.observation, s.woke_for, s.since).action : { type: "wait" });
  expect(w.finish().state_hash).toBe(ends[0]!.end.state_hash);
  expect(codeEnd.state_hash).toHaveLength(64);
}, 120_000);

test("the manifests and the shared rules are read from Rust", () => {
  const m = rustManifests();
  const ts = JSON.parse(readFileSync(join(root, "participants/manifests/world.weather.json"), "utf8"));
  for (const k of Object.keys(ts)) expect(m["world.weather"][k]).toEqual(ts[k]);
  for (const figures of [{ plan_months: 6, plan_consider: "must", cure_days: 14 }, { plan_months: 0 }, { plan_months: 12, plan_barred_rent_months: 2 }])
    expect(rustRule<string>("forms.plan_law_words", figures)).toBe(planLawWords(figures as any));
});

// (Compared as canonical JSON, as the kernel reads a config: the order of an object's keys is never meant.)
test("the generator calling the Rust rules (OIKOS_WORLD=rust) makes the same towns, word for word", () => {
  for (const profile of ["au-vic-2026", "gb-eng-2026", "ke-nakuru-2026"]) {
    const s = { ...spec, profile, years: 1 };
    const was = process.env.OIKOS_WORLD;
    delete process.env.OIKOS_WORLD;
    const tsTown = canonical(generate(s));
    process.env.OIKOS_WORLD = "rust";
    try {
      expect(canonical(generate(s))).toBe(tsTown);
    } finally {
      if (was === undefined) delete process.env.OIKOS_WORLD;
      else process.env.OIKOS_WORLD = was;
    }
  }
}, 120_000);
