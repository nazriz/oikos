// Everything physical is somewhere, in a running town (law 9: docs/design/foundations-2.md section 3.2): the static audits in
// everything-is-somewhere.test.ts read the generated town; this one runs each profile's town for a month, code only, and reads
// its log for goods moved from one place to another with no carrier and work done on a building somewhere else than where its
// crew is, by module. Today's are in the inventory (`fixtures/space-inventory.json`), which only shrinks. In the slow tier:
// nine towns run for a month take about 32 s alone. Its planted half is the gate file's (farActs on a written log).

import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { runWorld } from "../src/run";
import { inventory, root } from "./lib/law8";
import { farActs, SPACE_INVENTORY } from "./lib/law9";

const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
const profiles = readdirSync(join(root, "worlds/profiles")).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));

test("a month of every profile's town, code only, moves nothing between places uncarried and works on no building from afar, beyond the inventory", async () => {
  const inv = inventory(SPACE_INVENTORY);
  const seen = { uncarriedMoves: new Set<string>(), workElsewhere: new Set<string>() };
  for (const profile of profiles) {
    const config = generate({ ...spec, citizens: 300, profile, factories: 5, living: spec.living ?? {} });
    const dir = mkdtempSync(join(tmpdir(), `oikos-somewhere-${profile}-`));
    try {
      const s = await runWorld({ config, runId: `somewhere-${profile}`, outDir: dir, until: 30 * 86_400 });
      const found = farActs(readFileSync(s.logPath, "utf8").trim().split("\n"), config);
      for (const k of ["uncarriedMoves", "workElsewhere"] as const) {
        for (const f of found[k]) seen[k].add(f);
        expect(found[k].filter((f) => !(inv.found[k] ?? []).includes(f)), `${profile}: ${k} not in the inventory`).toEqual([]);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  for (const k of ["uncarriedMoves", "workElsewhere"] as const) expect((inv.found[k] ?? []).filter((f) => !seen[k].has(f)), `${k}: listed in the inventory and no longer found (remove it)`).toEqual([]);
}, 1_800_000);
