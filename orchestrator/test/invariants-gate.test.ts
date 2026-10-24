// The invariants in the merge gate (docs/testing.md; docs/dev-machine.md, "Tiers"): the same checker
// (orchestrator/src/invariants.ts) on short towns of the three main profiles, one seed each, with every seat's
// observations recorded, so that the gate sees a broken invariant within a minute. The year on several seeds, the two
// months of what seats are shown and the exact twins stay in orchestrator/test/invariants.test.ts, in the slow tier (CI,
// on every push to main): nothing of them is left out, this is in addition.

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { checkLog, type InvariantReport } from "../src/invariants";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const DAYS = 90;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
const PROFILES = ["au-vic-2026", "gb-eng-2026", "ke-nakuru-2026"];

test(`${DAYS} days in a town of each main profile, every observation recorded: every invariant holds`, async () => {
  const dir = mkdtempSync(join(tmpdir(), "oikos-invariants-gate-"));
  try {
    const reports: { name: string; report: InvariantReport }[] = [];
    for (const profile of PROFILES) {
      const s = await runWorld({ config: generate({ ...spec, citizens: 60, profile, seed: 11 }), runId: profile, outDir: join(dir, profile), until: DAYS * DAY, recordObservations: "all" });
      reports.push({ name: profile, report: await checkLog(s.logPath) });
      rmSync(join(dir, profile), { recursive: true, force: true });
    }
    const violations = reports.flatMap((r) => r.report.violations.slice(0, 20).map((v) => `${r.name}: ${v.invariant} at seq ${v.seq} (day ${Math.floor(v.t / DAY)}): ${v.what}`));
    expect(violations).toEqual([]);
    // (An invariant that saw nothing proves nothing: what a short town does in its first weeks. Deaths, and the rest that
    // take a year, are the slow tier's.)
    const total = (what: string) => reports.reduce((a, r) => a + (r.report.seen[what] ?? 0), 0);
    for (const what of ["transfers", "payments under instructions", "acts", "acts timed by the table", "person acts", "occupancies", "living persons at the end", "money fields", "observations", "records shown", "balances shown"])
      expect({ what, seen: total(what) > 0 }).toEqual({ what, seen: true });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 600_000);
