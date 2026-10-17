// The invariants (docs/testing.md): what must hold in every run, whatever the town and its draws. Small towns of the
// three main profiles are run for a year on several seeds, and each log is read by orchestrator/src/invariants.ts,
// which knows nothing of how the world is computed: it reads the log (the contract), so it judges the Rust port of the
// built-in actors as it judges the TypeScript ones. A failure names the invariant, the entry and what was wrong.
//
// More seeds: OIKOS_INVARIANT_SEEDS=6 (each profile on seeds 1..6); a bigger town: OIKOS_INVARIANT_CITIZENS=200.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { checkLog, type InvariantReport } from "../src/invariants";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
const PROFILES = ["au-vic-2026", "gb-eng-2026", "ke-nakuru-2026"];
const SEEDS = Number(process.env.OIKOS_INVARIANT_SEEDS ?? 2);
const CITIZENS = Number(process.env.OIKOS_INVARIANT_CITIZENS ?? 60);
const AT_ONCE = 3;

async function town(profile: string, seed: number, days: number, name: string, recordObservations: "none" | "all" = "none") {
  const { generate } = await import("@oikos/worlds/generator/generate");
  const out = join(root, "runs", `test-invariants-${name}`);
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config: generate({ ...spec, citizens: CITIZENS, profile, seed }), runId: name, outDir: out, until: days * DAY, recordObservations });
  return { out, log: s.logPath, stateHash: s.stateHash };
}

/** Run each, check its log, and delete it: a year's log is a few hundred megabytes. */
async function checked(jobs: { profile: string; seed: number; days: number; name: string; observations?: boolean }[]) {
  const reports: { name: string; report: InvariantReport }[] = [];
  const queue = [...jobs];
  await Promise.all(Array.from({ length: AT_ONCE }, async () => {
    for (let j = queue.shift(); j; j = queue.shift()) {
      const r = await town(j.profile, j.seed, j.days, j.name, j.observations ? "all" : "none");
      try {
        reports.push({ name: j.name, report: await checkLog(r.log) });
      } finally {
        rmSync(r.out, { recursive: true, force: true });
      }
    }
  }));
  return reports;
}

const violations = (reports: { name: string; report: InvariantReport }[]) =>
  reports.flatMap((r) => r.report.violations.slice(0, 20).map((v) => `${r.name}: ${v.invariant} at seq ${v.seq} (day ${Math.floor(v.t / DAY)}): ${v.what}`));
const total = (reports: { report: InvariantReport }[], what: string) => reports.reduce((a, r) => a + (r.report.seen[what] ?? 0), 0);

test("a year in towns of three profiles, on several seeds: every invariant holds", async () => {
  const jobs = PROFILES.flatMap((profile) => Array.from({ length: SEEDS }, (_, i) => ({ profile, seed: i + 1, days: 365, name: `${profile}-${i + 1}` })));
  const reports = await checked(jobs);
  expect(violations(reports)).toEqual([]);
  // (An invariant that saw nothing proves nothing: the towns must have done each thing it is about.)
  for (const what of ["transfers", "payments under instructions", "payments under agreements", "acts", "acts timed by the table", "person acts", "occupancies", "deaths", "appointments", "living persons at the end", "money fields"])
    expect({ what, seen: total(reports, what) > 0 }).toEqual({ what, seen: true });
}, 3_600_000);

test("what each seat is shown, over two months in each profile: nothing it may not know, its balances as the ledger has them", async () => {
  const reports = await checked(PROFILES.map((profile) => ({ profile, seed: 7, days: 60, name: `${profile}-seen`, observations: true })));
  expect(violations(reports)).toEqual([]);
  for (const what of ["observations", "records shown", "balances shown"]) expect({ what, seen: total(reports, what) > 0 }).toEqual({ what, seen: true });
}, 1_800_000);

test("twins exact: the same town run twice is the same town, entry for entry", async () => {
  const runs = await Promise.all(["a", "b"].map(async (x) => {
    const r = await town("gb-eng-2026", 3, 90, `twin-${x}`);
    const text = readFileSync(r.log, "utf8");
    rmSync(r.out, { recursive: true, force: true });
    // (Every entry is chained to the one before it: the last entry's hash stands for the whole log. The run's id is in
    // the header, and differs.)
    const lines = text.trim().split("\n");
    return { stateHash: r.stateHash, entries: lines.length, tail: lines.slice(1).map((l) => JSON.parse(l)).map((e) => `${e.seq} ${e.t} ${e.kind} ${JSON.stringify(e.body)}`) };
  }));
  expect(runs[0]!.stateHash).toBe(runs[1]!.stateHash);
  expect(runs[0]!.entries).toBe(runs[1]!.entries);
  const differ = runs[0]!.tail.findIndex((l, i) => l !== runs[1]!.tail[i]);
  expect(differ < 0 ? "identical" : `first differs at entry ${differ + 1}: ${runs[0]!.tail[differ]!.slice(0, 300)} | ${runs[1]!.tail[differ]!.slice(0, 300)}`).toBe("identical");
}, 1_800_000);
