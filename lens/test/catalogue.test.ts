// The catalogue finds every run from listings and small reads: an experiment's forks (and its code twin), a set-aside
// experiment marked stopped, a plain run's current log only (not what a resume left behind, not a .jsonl that isn't a
// log, never a debriefs file), and nothing under Lens's own views folder.
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Catalogue } from "../src/server/catalogue";
import { keyOf } from "../src/shared/api";

const base = realpathSync(mkdtempSync(join(tmpdir(), "oikos-lens-cat-")));
afterAll(() => rmSync(base, { recursive: true, force: true }));
const put = (p: string, body: string) => {
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, body);
};
const header = `{"body":{"canary":"x","config":{}},"kind":"header","seq":0,"t":0}\n`;

test("experiments, set-aside experiments and plain runs, each once", async () => {
  const runs = join(base, "runs");
  const spec = (name: string) => JSON.stringify({ name, post: "mayor", forkDay: 120, untilDay: 195, arms: [{ name: "code", steward: { kind: "code" } }, { name: "m1", steward: { kind: "model", model: "openrouter/acme/m1" } }] });
  for (const dir of ["study/m1-redteam-s7", "study/m1-redteam-s7.cap080"]) {
    put(join(runs, dir, "spec.json"), spec("power-seeking-election-m1-goal-redteam"));
    put(join(runs, dir, "seed-7", "base.oklog"), "x".repeat(100));
    put(join(runs, dir, "seed-7", "code.oklog"), "x".repeat(100));
    put(join(runs, dir, "seed-7", "m1.oklog"), "x".repeat(100));
    put(join(runs, dir, "seed-7", "m1.debriefs.jsonl"), header);
    put(join(runs, dir, "seed-7", "m1.json"), JSON.stringify({ seed: 7, arm: "m1", t: 16_848_000, costs: { a: { cost_microusd: 1_500_000 } } }));
  }
  put(join(runs, "pilot", "town.seed1.jsonl"), header + "{}\n".repeat(40));
  put(join(runs, "pilot", "town.seed1.stopped-1.jsonl"), header + "{}\n".repeat(40));
  put(join(runs, "pilot", "town.seed1.debriefs.jsonl"), header + "{}\n".repeat(40));
  put(join(runs, "pilot", "corpus.jsonl"), `{"request":"not a log at all, just data","n":1}\n`.repeat(4));
  put(join(runs, "views", "lens", "x.jsonl"), header + "{}\n".repeat(40));

  const cat = new Catalogue({ runs, views: join(runs, "views", "lens") });
  const { runs: found } = await cat.runs(0);
  const keys = found.map((r) => r.key).sort();
  expect(keys).toEqual(
    [
      "pilot/town.seed1.jsonl",
      "study/m1-redteam-s7.cap080/seed-7/code.oklog",
      "study/m1-redteam-s7.cap080/seed-7/m1.oklog",
      "study/m1-redteam-s7/seed-7/code.oklog",
      "study/m1-redteam-s7/seed-7/m1.oklog",
    ].map(keyOf).sort(),
  );
  const fork = found.find((r) => r.key === keyOf("study/m1-redteam-s7/seed-7/m1.oklog"))!;
  expect(fork.experiment).toMatchObject({ model: "m1", goal: "redteam", seed: 7, isCode: false, forkDay: 120, usd: 1.5, twin: keyOf("study/m1-redteam-s7/seed-7/code.oklog") });
  expect(fork.experiment!.stopped).toBeUndefined();
  expect(found.find((r) => r.key === keyOf("study/m1-redteam-s7.cap080/seed-7/m1.oklog"))!.experiment!.stopped).toContain("cap080");
  expect(found.find((r) => r.kind === "plain")!.group).toBe("pilot");
});
