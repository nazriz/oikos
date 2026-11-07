// The memory budget (scripts/memory-budget.json; docs/design/performance.md, "Bytes per person"): a 1,000-person month
// on the release kernel peaks at no more than the fixed overhead and the budget's bytes for each person. A backstop,
// as the suite's time budgets are: a change that makes each person cost more fails here, and raising the budget is a
// decision with its entry in docs/decisions.md.
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadWorld } from "../src/batch";
import { kernelBinary } from "../src/kernel";
import { writeConfigFile } from "../src/rust-world";

const root = join(import.meta.dir, "../..");
const budget = JSON.parse(readFileSync(join(root, "scripts/memory-budget.json"), "utf8"));
const DAY = 86_400;

/** A town's month on the kernel, its log dropped: its people at the start and its peak resident bytes. */
export async function peakOf(spec: string, days: number, threads: number, sets: string[] = []): Promise<{ people: number; peak: number }> {
  const dir = mkdtempSync(join(tmpdir(), "oikos-membudget-"));
  try {
    const { config } = await loadWorld(join(root, spec), sets);
    const people = config.participants.filter((p: any) => p.kind === "person" && !p.shares_body).length;
    const file = join(dir, "config.json");
    writeConfigFile(config, file);
    const p = Bun.spawnSync([kernelBinary(), "world", file, "--out", dir, "--run-id", "r", "--until", String(days * DAY), "--threads", String(threads)], {
      stdout: "pipe", stderr: "pipe", env: { ...process.env, OIKOS_ENGINE_THREADS: String(threads) },
    });
    const err = p.stderr.toString();
    if (p.exitCode !== 0) throw new Error(`the kernel failed: ${err.slice(-2000)}`);
    const peak = Number(err.match(/peak resident (\d+) bytes/)?.[1]);
    if (!(peak > 0)) throw new Error(`the kernel did not say its peak: ${err.slice(-500)}`);
    return { people, peak };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The town's month, run once for both tests. */
let monthRun: Promise<{ people: number; peak: number }> | undefined;
const month = () => (monthRun ??= peakOf(budget.town, budget.days, budget.threads));

test("a 1,000-person month keeps to the memory budget for each person", async () => {
  const { people, peak } = await month();
  const per = Math.round((peak - budget.overhead_bytes) / people);
  console.log(`memory: ${people} people, peak ${(peak / 1e6).toFixed(0)} MB, ${(per / 1000).toFixed(1)} KB a person beside ${(budget.overhead_bytes / 1e6).toFixed(0)} MB (budget ${(budget.bytes_per_person / 1000).toFixed(1)} KB, target ${(budget.target_bytes_per_person / 1000).toFixed(1)} KB)`);
  expect(people).toBeGreaterThan(900);
  expect(budget.bytes_per_person).toBeGreaterThanOrEqual(budget.target_bytes_per_person);
  expect(per).toBeLessThanOrEqual(budget.bytes_per_person);
}, 600_000);

// What a run's length adds (risk SC-6; docs/design/tiered-storage.md): the same town for half a year, its peak past the
// month's, for each person and each day between, within the growth budget. A change that holds more of the history in
// memory (a reader that keeps what it no longer reads, a cache that grows with the run) fails here.
test("a 1,000-person half-year grows within the memory budget for each person and day", async () => {
  const first = await month();
  const half = await peakOf(budget.town, budget.growth_days, budget.threads);
  const perDay = Math.round((half.peak - first.peak) / half.people / (budget.growth_days - budget.days));
  console.log(`memory growth: day ${budget.days} ${(first.peak / 1e6).toFixed(0)} MB, day ${budget.growth_days} ${(half.peak / 1e6).toFixed(0)} MB, ${perDay} bytes a person a day (budget ${budget.growth_bytes_per_person_day})`);
  expect(perDay).toBeLessThanOrEqual(budget.growth_bytes_per_person_day);
}, 900_000);
