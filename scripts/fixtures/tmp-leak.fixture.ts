// Run by scripts/tmp-preload.test.ts under `bun test`: makes temporary folders the way the suite's tests do, and
// leaves them behind.
import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("makes temp folders and forgets them", () => {
  const d = mkdtempSync(join(tmpdir(), "oikos-leak-fixture-"));
  writeFileSync(join(d, "x"), "x");
  const child = Bun.spawnSync(["bun", "-e", `require("node:fs").mkdtempSync(require("node:path").join(require("node:os").tmpdir(), "oikos-leak-child-"))`]);
  expect(child.exitCode).toBe(0);
  expect(d.includes("oikos-test-")).toBe(true);
});
