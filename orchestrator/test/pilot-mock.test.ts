// scripts/pilot-mock.ts: a queue's pilots run on the mock into their own folder, and the ones that cannot run say why.

import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockPilot, mockWave } from "../../scripts/pilot-mock";

const base = realpathSync(mkdtempSync(join(tmpdir(), "oikos-pilot-mock-test-")));
afterAll(() => rmSync(base, { recursive: true, force: true }));
const good = { name: "pilot-ok", world: "worlds/town.yaml", sets: ["citizens=20", "mayor=llm"], model: "codex/gpt-6.1-sol", translator: "decide/pod-small-d16-s1", until: 100 * 86_400, budget: 25, env: { OIKOS_CLAUDE_BIN: "/nonexistent" } };

test("an entry that can run does, on the mock, in the mock folder and not the pilot's; entries that cannot say why", async () => {
  const out = join(base, "w.mock");
  const ok = await mockPilot(good, out, 1);
  expect(ok).toMatchObject({ generated: true, ranToEnd: true });
  expect(ok.line).toBe("pilot-ok: generated; ran to the end (to day 1 of 100)");
  expect(existsSync(join(out, "pilot-ok"))).toBe(true);

  expect((await mockPilot({ ...good, name: "no-world", world: "worlds/none.yaml" }, out, 1)).line).toBe("no-world: NOT generated; did not run (no such world file: worlds/none.yaml)");
  const badSet = await mockPilot({ ...good, name: "bad-set", sets: ["citizens"] }, out, 1);
  expect(badSet).toMatchObject({ generated: false, ranToEnd: false });
  expect(badSet.reason).toContain("--set expects path=value");
  expect((await mockPilot({ ...good, name: "no-until", until: undefined }, out, 1)).reason).toBe("the entry has no until");
}, 120_000);

test("a queue file is run entry by entry, results in queue order", async () => {
  const q = join(base, "q.json");
  writeFileSync(q, JSON.stringify([{ ...good, name: "a" }, { ...good, name: "b", world: "worlds/none.yaml" }]));
  const r = await mockWave([q], join(base, "w2.mock"), 1, 2);
  expect(r.map((x) => [x.pilot, x.generated, x.ranToEnd])).toEqual([["a", true, true], ["b", false, false]]);
}, 120_000);
