// What household members tell each other is said once to each person until it changes (docs/behaviour/citizen.md,
// "What is told to the household is said once"): a member's pay to the leaseholder, the leaseholder's share of the rent
// to each member. A living pilot's 1,754 "My pay is now" and 1,003 "Your share of the rent" were counted as repeats; read
// by sender and recipient they were first tellings and real changes (raises, jobs lost and found, rent changes), none
// unchanged. This holds that over a run of a living town; no model is called.

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadWorld } from "../src/batch";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;

test("no member says the same pay, or the same share of the rent, to the same person twice running", async () => {
  const out = mkdtempSync(join(tmpdir(), "oikos-saying-"));
  try {
    const config = (await loadWorld(join(root, "worlds/town-300.yaml"), ["profile=ke-nakuru-2026", "living.initiative_bps=10000", "living.friction_bps=10000"])).config;
    const r = await runWorld({ config: { ...config, seed: 402, log: { ...config.log, detail: "lean" } }, runId: "saying", outDir: out, until: 100 * DAY, recordObservations: "none" });
    const last = new Map<string, string>();
    const said = { pay: 0, share: 0 };
    const repeats: string[] = [];
    for (const line of readFileSync(r.logPath, "utf8").split("\n")) {
      if (!line.includes("My pay is now") && !line.includes("Your share of the rent")) continue;
      const row = JSON.parse(line);
      if (row.kind !== "command") continue;
      for (const b of row.body.blocks ?? []) {
        if (b.block !== "message") continue;
        const kind = b.text.startsWith("My pay is now") ? "pay" : b.text.startsWith("Your share of the rent") ? "share" : null;
        if (!kind) continue;
        for (const to of b.to as string[]) {
          said[kind]++;
          const key = `${kind} ${row.body.participant} -> ${to}`;
          if (last.get(key) === b.text) repeats.push(`${key} at ${row.t}: ${b.text}`);
          last.set(key, b.text);
        }
      }
    }
    // (Something was said, or this checks nothing.)
    expect(said.pay).toBeGreaterThan(20);
    expect(repeats).toEqual([]);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}, 600_000);
