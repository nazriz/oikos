// The pure parts of scripts/merge.ts: keeping both sides of a conflict, and which failures are accepted as flakes.
import { expect, test } from "bun:test";
import { flakeCandidate, hasMarkers, keepBoth, readFailures } from "./merge";

const conflict = "a\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> branch\nb\n<<<<<<< HEAD\n1\n||||||| base\n0\n=======\n2\n>>>>>>> x\nz";

test("keepBoth keeps ours then theirs, drops markers and any diff3 base", () => {
  const r = keepBoth(conflict);
  expect(r).toBe("a\nours\ntheirs\nb\n1\n2\nz");
  expect(hasMarkers(r)).toBe(false);
  expect(hasMarkers(conflict)).toBe(true);
});
test("keepBoth leaves text without conflicts alone and refuses an unterminated block", () => {
  expect(keepBoth("x\n=== not a marker\ny")).toBe("x\n=== not a marker\ny");
  expect(() => keepBoth("<<<<<<< HEAD\nours\n=======\ntheirs")).toThrow();
});
test("readFailures separates test files from other failures", () => {
  const log = "ok   a.test.ts 3s\nFAIL scripts/slots.test.ts 9s\nFAIL kernel (cargo test) 40s\nFAIL scripts/slots.test.ts 9s (failed again on rerun)";
  expect(readFailures(log)).toEqual({ files: ["scripts/slots.test.ts"], other: ["kernel"] });
  // A gate over its time budget is a failure of its own, never a flake to rerun.
  const over = readFailures("FAIL scripts/slots.test.ts 9s\nBUDGET: the gate took 200s, over its 180s (docs/testing.md)");
  expect(over.other).toEqual(["the time budget (scripts/test-budgets.json)"]);
  expect(flakeCandidate(over)).toBeNull();
});
test("flakeCandidate accepts exactly one known flaky file, nothing else", () => {
  expect(flakeCandidate({ files: ["scripts/slots.test.ts"], other: [] })).toBe("scripts/slots.test.ts");
  expect(flakeCandidate({ files: ["orchestrator/test/pilot-wave.test.ts"], other: [] })).toBe("orchestrator/test/pilot-wave.test.ts");
  expect(flakeCandidate({ files: ["scripts/slots.test.ts", "orchestrator/test/pilot-wave.test.ts"], other: [] })).toBeNull();
  expect(flakeCandidate({ files: ["x.test.ts"], other: [] })).toBeNull();
  expect(flakeCandidate({ files: ["scripts/slots.test.ts"], other: ["kernel"] })).toBeNull();
  expect(flakeCandidate({ files: [], other: [] })).toBeNull();
});

import { kernelStale, settle } from "./merge";
import { blocker, fromRuns, readStatus, record } from "./main-status";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A set fails if it holds any of the bad branches (or, for an interaction, all of `together`). */
const failing = (bad: string[]) => async (set: string[]) => !set.some((b) => bad.includes(b));
test("settle: all good goes in one run", async () => {
  expect(await settle(["a", "b", "c"], failing([]))).toEqual({ accepted: ["a", "b", "c"], rejected: [], runs: 1 });
});
test("settle: finds the branch at fault and keeps the others, in order", async () => {
  for (const bad of ["a", "b", "c", "d", "e"]) {
    const r = await settle(["a", "b", "c", "d", "e"], failing([bad]));
    expect(r.rejected).toEqual([bad]);
    expect(r.accepted).toEqual(["a", "b", "c", "d", "e"].filter((x) => x !== bad));
    expect(r.runs).toBeLessThanOrEqual(8);
  }
});
test("settle: two at fault, and all at fault", async () => {
  expect((await settle(["a", "b", "c", "d"], failing(["b", "d"])))).toMatchObject({ accepted: ["a", "c"], rejected: ["b", "d"] });
  expect((await settle(["a", "b"], failing(["a", "b"])))).toMatchObject({ accepted: [], rejected: ["a", "b"] });
  expect((await settle([], failing([])))).toMatchObject({ accepted: [], rejected: [] });
});
test("settle: a branch that fails only after another (an interaction) is the later one", async () => {
  const together = async (set: string[]) => !(set.includes("a") && set.includes("c"));
  expect(await settle(["a", "b", "c"], together)).toMatchObject({ accepted: ["a", "b"], rejected: ["c"] });
});
test("kernelStale: only when the tree differs or a binary is missing", () => {
  expect(kernelStale("t1", "t1", true)).toBe(false);
  expect(kernelStale("t1", "t2", true)).toBe(true);
  expect(kernelStale(undefined, "t1", true)).toBe(true);
  expect(kernelStale("t1", "t1", false)).toBe(true);
});
test("main status: a failure in main blocks, a later success or a cancelled run does not", () => {
  const dir = mkdtempSync(join(tmpdir(), "oikos-ci-")), path = join(dir, "s.json");
  try {
    expect(readStatus(path)).toBeUndefined();
    expect(record("abc", "cancelled", path)).toBe(false);
    record("abc", "failure", path);
    expect(blocker(readStatus(path), () => true)).toContain("abc");
    expect(blocker(readStatus(path), () => false)).toBeUndefined(); // the failed commit is not in main (rewound)
    record("def", "success", path);
    expect(blocker(readStatus(path), () => true)).toBeUndefined();
    expect(blocker(undefined, () => true)).toBeUndefined();
  } finally { rmSync(dir, { recursive: true, force: true }); }
  expect(fromRuns([{ conclusion: "", headSha: "x" }, { conclusion: "failure", headSha: "y" }, { conclusion: "success", headSha: "z" }])).toMatchObject({ sha: "y", status: "failure" });
});
