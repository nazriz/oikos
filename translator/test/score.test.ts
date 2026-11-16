// The scored set (translator/eval/score.ts; docs/decisions.md, 2026-11-15, "A scored set from every real request"):
// a rule lands only if it misses nothing the set's baseline hits (score-baseline.json, the requests this checkout's
// rules draw to target) and its score is no lower. Raising the score: rewrite the baseline with
// `bun translator/eval/score.ts current --baseline translator/test/score-baseline.json`, in the commit that raises it.
//
// The set and the extract it scores on hold run content, so they stay on the run server under runs/regress, out of
// git; where they are absent (a hosted runner) this says so and checks nothing.

import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { calls } from "@oikos/participants";
import { EXTRACT, SET, loadArms, loadKeyed, loadSet, rulesOf, score } from "../eval/score";

const there = existsSync(EXTRACT) && existsSync(SET);

test.skipIf(!there)("this checkout's rules draw to target every request the baseline hits, and score no lower", async () => {
  const baseline: string[] = JSON.parse(readFileSync(join(import.meta.dir, "score-baseline.json"), "utf8"));
  const { rules } = await rulesOf("current");
  const s = score(rules, loadSet(), loadArms());
  expect(baseline.filter((k) => !s.hit.has(k))).toEqual([]);
  expect(s.hits).toBeGreaterThanOrEqual(baseline.length);
});

// (A request keyed by hand stands in the set in place of what the seat confirmed: its target must be one program the
// call language reads, and it must say why and point at its decisions entry.)
test("every request keyed by hand has a readable target, a reason and its decision", () => {
  const keyed = loadKeyed();
  expect(keyed.length).toBeGreaterThan(0);
  for (const k of keyed) {
    expect("lines" in calls.parseProgram(k.target)).toBe(true);
    expect([k.run, k.arm, k.ref, k.request_has, k.why, k.decision].every((x) => typeof x === "string" && x.length > 0)).toBe(true);
  }
});

if (!there) console.log(`(score.test.ts: no scored set at ${SET}: the scored set did not run.)`);
