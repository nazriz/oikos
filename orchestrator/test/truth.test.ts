// Truth audits (docs/design/rebuild.md 8.2): code modules' beliefs about agreements, checked against the terms'
// readings. A stale private copy of the world (a register that missed a change, an end worked out by hand) shows as a
// divergence that lasts.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runWorld } from "../src/run";
import { divergences } from "../src/truth";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;

test("truth audits: modules' beliefs match the terms' readings, and none stays wrong for more than a week", async () => {
  const { generate } = await import("@oikos/worlds/generator/generate");
  const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
  const out = join(import.meta.dir, "../../runs/test-truth");
  rmSync(out, { recursive: true, force: true });
  let planted: Awaited<ReturnType<typeof divergences>> | undefined;
  const s = await runWorld({
    config: generate({ ...spec, citizens: 300 }), runId: "truth", outDir: out, until: 180 * DAY, audit: true,
    // The checker itself, against the live engine: a belief known to be false is caught.
    inspect: async (_p, obs, kernel) => {
      if (planted || obs.t < 30 * DAY) return;
      const held = (await kernel.request({ op: "agreements", party: "builder" })).agreements.filter((a: any) => a.template === "employment" && a.reading.status === "in_force");
      if (!held.length) return;
      planted = await divergences(kernel, [
        { of: "agreement", agreement: held[0].id, in_force: false },
        { of: "held", party: "builder", template: "employment", agreements: held.slice(1).map((a: any) => a.id) },
        { of: "between", template: "employment", parties: ["builder", held[0].parties[1]], in_force: true },
      ]);
    },
  });
  expect(planted?.map((d) => d.belief.of)).toEqual(["agreement", "held"]);

  const audits = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l))
    .filter((e) => e.kind === "annotation" && e.body.annotation === "audit").map((e) => e.body.data);
  const stale = audits.filter((a) => a.t - a.since > 7 * DAY);
  expect(stale).toEqual([]);
}, 180_000);
