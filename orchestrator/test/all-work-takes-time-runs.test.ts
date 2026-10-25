// All work takes time, in a running town (docs/all-work-takes-time.md; law 10, foundations-2 P5): the static audits in
// all-work-takes-time.test.ts read the generated town; this one runs each profile's town for a month, code only, and fails
// on any act the kernel refused as `unpriced` (an act nobody priced for whoever would do it: since P2 there is no implicit
// second). In the slow tier: nine towns run for a month take 31 s alone and two to three times that under the suite's load, near the gate's 90 s a file.
// It plants a row taken away and sees the act named.

import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
const profiles = readdirSync(join(root, "worlds/profiles")).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
const DAY = 86_400;

/** Every act a log shows refused as unpriced: who, and the kernel's reason (what nobody priced, for whom). */
export function unpricedActs(logPath: string): string[] {
  return readFileSync(logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l))
    .filter((e) => e.kind === "event" && e.body.event === "action_refused" && e.body.code === "unpriced")
    .map((e) => `${e.body.participant}: ${e.body.detail ?? "unpriced"}`);
}

async function month(config: any, id: string, days = 30): Promise<string[]> {
  const dir = mkdtempSync(join(tmpdir(), `oikos-awtt-${id}-`));
  try {
    const s = await runWorld({ config, runId: id, outDir: dir, until: days * DAY });
    return unpricedActs(s.logPath);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("a month of every profile's town, code only, has no act nobody priced", async () => {
  for (const profile of profiles) {
    const config = generate({ ...spec, citizens: 300, profile, factories: 5, living: spec.living ?? {} });
    expect(await month(config, `awtt-${profile}`), `${profile}: acts refused unpriced`).toEqual([]);
  }
}, 1_800_000);

test("it fails, naming the act and whose it is, on a row the world's table lacks", async () => {
  const config = generate({ ...spec, citizens: 300, profile: "au-vic-2026", factories: 5, living: spec.living ?? {} });
  // The support office's case system pays support: with no row for a system's payment, and no default, nobody priced it.
  delete config.orchestration.act_time.system.transfer;
  const found = await month(config, "awtt-planted", 20);
  expect(found.length).toBeGreaterThan(0);
  expect(found.some((x) => /nobody priced transfer for [\w-]+-system/.test(x))).toBe(true);
}, 600_000);
