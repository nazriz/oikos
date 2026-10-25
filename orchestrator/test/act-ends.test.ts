// How an act ended (src/act-ends.ts), on a small log made by hand: an act takes time, and the log says it ended
// (applied or refused) under the step of the clock that ended it, not under the act. Every reader that says whether a
// translator's act was applied has to join the end to the act by the action: the translator corpus (`oikos corpus`),
// the in-situ reader the training pipeline reads pilots through, and the run dataset.

import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { corpusOf, corpusReader } from "../src/corpus";
import { exportDataset } from "../src/dataset";
import { needsCorpus, situationsOf } from "../src/in-situ";

const root = join(import.meta.dir, "../..");
const dir = join(root, "runs", "test-act-ends");
const DAY = 86_400;

let seq = 0;
const entry = (t: number, kind: string, body: object) => JSON.stringify({ seq: seq++, t, kind, body });
const ann = (t: number, annotation: string, rest: object) => entry(t, "annotation", { annotation, ...rest });
const draft = (t: number, n: number, proposal: string) =>
  ann(t, "draft", { draft: { id: `draft.clerk-system.${n}`, participant: "clerk-system", proposal, call: "none(unclear)", blocks: [], summary: "", check: { ok: true } } });
const act = (t: number, n: number) => entry(t, "command", { command: "act", participant: "clerk", blocks: [], provenance: { via: "translator", draft: `draft.clerk-system.${n}` } });

// Two acts, both begun on day 1, both ended by the clock's step on day 2: the first applied, the second refused. A
// third act is refused as it is submitted (never started: its cause is the act itself).
const LOG: string[] = [];
LOG.push(entry(0, "header", { run_id: "town.seed1" }));
LOG.push(draft(DAY, 1, "Pay acc-b 500."));
LOG.push(act(DAY, 1));
const first = seq - 1;
LOG.push(entry(DAY, "event", { event: "action_started", cause: first, action: "act-1", participant: "clerk", done: 2 * DAY }));
LOG.push(draft(DAY, 2, "Pay acc-c 900000000."));
LOG.push(act(DAY, 2));
const second = seq - 1;
LOG.push(entry(DAY, "event", { event: "action_started", cause: second, action: "act-2", participant: "clerk", done: 2 * DAY }));
LOG.push(draft(DAY + 1, 3, "Pay acc-d 1."));
LOG.push(act(DAY + 1, 3));
const third = seq - 1;
LOG.push(entry(DAY + 1, "event", { event: "action_refused", cause: third, action: "act-3", participant: "clerk", code: "unknown_account" }));
LOG.push(entry(2 * DAY, "command", { command: "advance", to: 2 * DAY }));
const step = seq - 1;
LOG.push(entry(2 * DAY, "event", { event: "action_applied", cause: step, action: "act-1", participant: "clerk" }));
LOG.push(entry(2 * DAY, "event", { event: "action_refused", cause: step, action: "act-2", participant: "clerk", code: "insufficient_funds", detail: "the account holds less" }));

const logPath = join(dir, "town.seed1.jsonl");
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
writeFileSync(logPath, LOG.join("\n") + "\n");

const byDraft = (rows: any[]) => Object.fromEntries(rows.map((r) => [r.draft, r.executed]));
const RIGHT = {
  "draft.clerk-system.1": { seq: first, applied: true },
  "draft.clerk-system.2": { seq: second, applied: false, refusal: { code: "insufficient_funds", detail: "the account holds less" } },
  "draft.clerk-system.3": { seq: third, applied: false, refusal: { code: "unknown_account" } },
};

test("the translator corpus says an act the kernel refused was refused, though the refusal is logged under the clock's step", async () => {
  expect(byDraft(await corpusOf(logPath))).toEqual(RIGHT);
});

test("`oikos corpus` writes it so, and counts one act applied", () => {
  const out = join(dir, "corpus.jsonl");
  const r = Bun.spawnSync([process.execPath, join(root, "orchestrator/src/cli.ts"), "corpus", logPath, "--out", out], { cwd: root });
  expect(r.exitCode).toBe(0);
  expect(r.stdout.toString()).toContain("1 carried out and applied");
  expect(byDraft(readFileSync(out, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)))).toEqual(RIGHT);
});

test("in situ (and so the training pipeline over a pilot) reads the same lines of a log, and the corpus it builds from them is right", async () => {
  const reader = corpusReader("runs/test-act-ends/town.seed1");
  for (const l of LOG) if (needsCorpus(l)) reader.take(JSON.parse(l));
  expect(byDraft(reader.rows())).toEqual(RIGHT);
  // (And the command over the log runs on it.)
  await situationsOf(logPath, { tests: [] });
});

test("the run dataset says it too: the same acts, the same ends", async () => {
  const out = join(dir, "dataset");
  await exportDataset(logPath, out, { actions: true });
  const rows = readFileSync(join(out, "translations.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  expect(byDraft(rows)).toEqual(RIGHT);
});

test("an act put back and begun again ends under the command that began it", async () => {
  const { actEnds } = await import("../src/act-ends");
  const e = actEnds();
  e.started({ action: "act.9", cause: 100 });
  // (Its performer's day ran out: the act is begun again, by the event that put it back.)
  e.started({ action: "act.9", cause: 205 });
  expect([...e.underWay]).toEqual([100]);
  expect(e.ended({ action: "act.9", cause: 230 })).toBe(100);
  expect(e.underWay.size).toBe(0);
});
