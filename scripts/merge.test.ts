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
});
test("flakeCandidate accepts exactly one known flaky file, nothing else", () => {
  expect(flakeCandidate({ files: ["scripts/slots.test.ts"], other: [] })).toBe("scripts/slots.test.ts");
  expect(flakeCandidate({ files: ["orchestrator/test/pilot-wave.test.ts"], other: [] })).toBe("orchestrator/test/pilot-wave.test.ts");
  expect(flakeCandidate({ files: ["scripts/slots.test.ts", "orchestrator/test/pilot-wave.test.ts"], other: [] })).toBeNull();
  expect(flakeCandidate({ files: ["x.test.ts"], other: [] })).toBeNull();
  expect(flakeCandidate({ files: ["scripts/slots.test.ts"], other: ["kernel"] })).toBeNull();
  expect(flakeCandidate({ files: [], other: [] })).toBeNull();
});
