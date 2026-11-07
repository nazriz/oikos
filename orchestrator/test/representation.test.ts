// Results held byte-identical (docs/design/performance.md, "A plan for what is left": the representation steps): each
// town of scripts/fixtures/representation-results.json, run 30 days on the release kernel at 4 engine threads, ends at
// the state hash and writes the log (its sha-256) pinned there. A change of how the world's data is held changes
// neither; one that does changes a result, and fails here. A change meant to change results re-takes the pins
// (`bun scripts/same-results.ts --pin ...`), in its own commit, with the reason.
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { kernelBinary } from "../src/kernel";
import { runOn, writeConfigs } from "../../scripts/same-results";

const pinned = JSON.parse(readFileSync(join(import.meta.dir, "../../scripts/fixtures/representation-results.json"), "utf8")).towns;

test("three profiles' towns of 200 and 1,000 people end a month at the pinned state hash and log", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oikos-repr-"));
  try {
    const files = await writeConfigs(dir);
    const got = await Promise.all(files.map((f) => runOn(kernelBinary(), f, 30, 4)));
    const towns = Object.fromEntries(files.map((f, i) => [f.split("/").pop()!.replace(/\.json$/, ""), { state_hash: got[i]!.hash, log_sha256: got[i]!.log }]));
    expect(Object.keys(towns).length).toBe(6);
    expect(towns).toEqual(pinned);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 900_000);
