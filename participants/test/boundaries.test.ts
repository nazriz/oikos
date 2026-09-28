// The boundary between the platform and the participants (P14; D57): a behaviour module knows the world only through
// what it perceives and its own parameters, like any participant. The type of its context has no world config; this
// also catches a way round the type (a cast).

import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

test("behaviour modules don't read the world's config", () => {
  const dir = join(import.meta.dir, "../src/behaviour");
  const found = readdirSync(dir).filter((f) => f.endsWith(".ts")).flatMap((f) =>
    readFileSync(join(dir, f), "utf8").split("\n").flatMap((line, i) => (/world\s*(as\s+any\s*\)?\s*)?\??\.\s*config|world\s+as\s+any/.test(line) ? [`${f}:${i + 1}: ${line.trim()}`] : [])));
  expect(found).toEqual([]);
});
