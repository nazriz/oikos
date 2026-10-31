// Scenarios (docs/scenarios.md), run: the 1,000-person town under each one, for its days (below), with the mock in the
// mayor's, planning and finance offices (as pilots hand them to a model), through the command line as a pilot is
// started (`--scenario`). Each must reach its last day with no participant failing. Several at a time, each in a
// process of its own. (What each changes of the town, quickly: worlds/test/scenario.test.ts; generated at 1,000
// people and from every profile one by one: scenarios-generate.test.ts.)

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scenarioIds } from "@oikos/worlds/generator/scenario";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
// (Thirty-five days, sixty until 2026-10-31, the slow tier's budget: every scenario but one acts from the first day (a price,
// a demand, a share housed or in work, the money in hand, the season the run starts in), so a month and the first days of
// the next see its first wages, rents, rates and bills and the seats' first month. The election's is sixty: its notice,
// nominations, ballot and count fill the first two months.)
const DAYS = 35;
const daysOf = (id: string) => (id === "election-due" ? 60 : DAYS);
const WORLD = "worlds/town-1000.yaml";
const SEATS = ["--set", "mayor=llm", "--set", "model_seats=planning,finance"];

test("the 1,000-person town under every scenario runs its days with mock participants, none failing", async () => {
  const ids = scenarioIds();
  // (Out of the repo, and removed at the end: nothing under runs/ is ever removed.)
  const dir = mkdtempSync(join(tmpdir(), "oikos-test-scenarios-"));
  const out = (id: string) => join(dir, id);
  const results = new Map<string, { code: number; said: string; summary?: any }>();
  let next = 0;
  const worker = async () => {
    for (;;) {
      const id = ids[next++];
      if (!id) return;
      const p = Bun.spawn(["bun", join(root, "orchestrator/src/cli.ts"), "run-one", WORLD, "--seed", "1", "--out", out(id), "--until", String(daysOf(id) * DAY), "--scenario", id, ...SEATS, "--log", "lean"],
        { cwd: root, stdout: "pipe", stderr: "pipe" });
      const [o, e] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
      const code = await p.exited;
      let summary: any;
      try { summary = JSON.parse(readFileSync(join(out(id), "town-1000.seed1.summary.json"), "utf8")); } catch { /* (it says why below) */ }
      results.set(id, { code, said: (o + e).split("\n").slice(-15).join("\n"), summary });
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  for (const id of ids) {
    const r = results.get(id)!;
    if (r.code !== 0 || !r.summary) console.error(`${id}:\n${r.said}`);
    expect({ id, code: r.code, ran: !!r.summary }).toEqual({ id, code: 0, ran: true });
    expect({ id, days: r.summary.t / DAY, errors: r.summary.participantErrors, stopped: r.summary.stopped }).toEqual({ id, days: daysOf(id), errors: 0, stopped: undefined });
  }
  // (That the baseline is the plain town is held where it is decided, in the generated config, byte for byte:
  // worlds/test/scenario.test.ts, "no scenario, and the baseline, are the town exactly as it was"; one config and one seed
  // are one run (the twins of invariants.test.ts). The plain town's run that stood here, after the pool and alone, went at
  // the test pruning, 2026-10-24.)
  // Every scenario is another world: no two end alike.
  const hashes = ids.map((id) => results.get(id)!.summary.stateHash);
  expect(new Set(hashes).size).toBe(ids.length);
  rmSync(dir, { recursive: true, force: true });
}, 3_600_000);
