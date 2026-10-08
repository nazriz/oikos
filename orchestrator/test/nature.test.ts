// Nature (docs/design/world-expansion.md 2), in a generated town: the landscape's species hold steady with no one
// touching them; the environment office hires by its budget line, surveys each quarter and reports; and where the
// wetlands are drained, the frogs are far fewer, in the truth (the census, for measurement) and in what the office's
// surveys find.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

async function year(name: string, drain: boolean) {
  const config = generate({ ...spec, years: 1 });
  if (drain) for (const t of config.world.ground.terrain) if (t.label === "wetland") t.label = "farmland";
  const out = join(root, "runs", `test-nature-${name}`);
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config, runId: name, outDir: out, until: 365 * DAY });
  expect(s.participantErrors).toBe(0);
  const log = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const ev = log.filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
  const census = ev.filter((e) => e.event === "nature_census");
  const recs = ev.filter((e) => e.event === "recorded").map((e) => e.record);
  return { census, reports: recs.filter((r) => r.kind === "environment_report"), registers: recs.filter((r) => r.kind === "habitat_register"), extinct: ev.filter((e) => e.event === "species_extinct") };
}

test("the landscape's species hold, the office surveys and reports, and drained wetlands show in both", async () => {
  const kept = await year("kept", false);
  // A census each 30 days; no extinctions; the species hold within a third of where they were in the first month.
  expect(kept.census.length).toBe(12);
  expect(kept.extinct).toEqual([]);
  for (const sp of Object.keys(kept.census[0].species)) {
    const [first, last] = [kept.census[0].species[sp].count, kept.census.at(-1).species[sp].count];
    expect(Math.abs(last - first)).toBeLessThanOrEqual(Math.max(5, first / 3));
  }
  // The office: a report each quarter after its first round (it starts a month in), put forward to be believed, and a
  // habitat register for planning.
  expect(kept.reports.length).toBeGreaterThanOrEqual(3);
  expect(kept.reports.every((r: any) => r.assertion?.that === r.text)).toBe(true);
  expect(kept.registers.length).toBe(kept.reports.length);

  const drained = await year("drained", true);
  const frogs = (r: typeof kept) => r.census.at(-1).species["growling-grass-frog"]?.count ?? 0;
  expect(frogs(drained) * 3).toBeLessThan(frogs(kept));
  // What the office found of frogs, summed over its rounds: fewer too.
  const found = (r: typeof kept) => r.reports.reduce((a: number, x: any) => a + (x.data.species["growling-grass-frog"]?.found ?? 0), 0);
  expect(found(drained)).toBeLessThan(found(kept));
}, 2_400_000);
