// scripts/disk-tidy.ts on a small fixture runs folder: model evidence wins over everything, and only code-only runs
// older than the limit lose anything.
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyRun, classifyTmp, judgeTarget } from "./disk-tidy";
import type { Tree } from "./worktree-clean";

const NOW = Date.UTC(2026, 9, 17), DAY = 86400000;
const mk = () => mkdtempSync(join(tmpdir(), "oikos-tidy-"));
const put = (root: string, rel: string, body: string | number, daysOld: number) => {
  const p = join(root, rel); mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, typeof body === "number" ? Buffer.alloc(body) : body);
  const t = (NOW - daysOld * DAY) / 1000; utimesSync(p, t, t);
};
const mockCost = JSON.stringify({ rows: [{ used: "mock/mock", calls: 3 }], recorded_microusd: 0 });
const realCost = JSON.stringify({ rows: [{ used: "claude-code/claude-sonnet-5-5", calls: 3 }], recorded_microusd: 5 });
const BIG = 51 * 1024 * 1024;

test("classification and the planned action", () => {
  const runs = mk();
  put(runs, "test-scratch/a.jsonl", 10, 9);
  put(runs, "test-fresh/a.jsonl", 10, 0);
  put(runs, "code-old/town.seed1.jsonl", BIG, 9); put(runs, "code-old/cost.json", mockCost, 9);
  put(runs, "code-ref/STATUS", "done", 9); put(runs, "code-ref/town.seed1.jsonl.zst", BIG, 9); put(runs, "code-ref/town.seed1.anchors.jsonl", BIG, 9); put(runs, "code-ref/measure/m.parquet", 10, 9);
  put(runs, "code-ds/x.dataset/citizen_decisions.jsonl", BIG, 9); put(runs, "code-ds/town.jsonl", BIG, 9);
  put(runs, "model-cost/cost.json", realCost, 9); put(runs, "model-cost/town.jsonl", BIG, 9);
  put(runs, "model-calls/claude-code.calls.jsonl", 10, 9); put(runs, "model-calls/town.jsonl", BIG, 9);
  put(runs, "model-batch/batch.json", '{"sets":["mayor=llm"]}', 9); put(runs, "model-batch/town.jsonl", BIG, 9);
  put(runs, "pilot-99/town.jsonl", BIG, 9);
  put(runs, "mock-batch/batch.json", '{"sets":["mayor=llm"]}', 9); put(runs, "mock-batch/cost.json", mockCost, 9); put(runs, "mock-batch/t.jsonl", BIG, 9);
  const v = (n: string, o = {}) => classifyRun(runs, n, { now: NOW, ...o });
  expect([v("test-scratch").kind, v("test-scratch").action]).toEqual(["code-only", "remove-all"]);
  expect(v("test-fresh").action).toBe("keep");
  expect(v("code-old").action).toBe("remove-all");
  expect(v("code-old", { docsText: "see code-old for the finding" }).action).toBe("remove-logs");
  const ref = v("code-ref");
  expect([ref.action, ref.logs]).toEqual(["remove-logs", ["town.seed1.jsonl.zst"]]); // anchors and measure stay
  expect(v("code-ds").logs).toEqual(["town.jsonl"]); // the dataset's own file stays
  for (const n of ["model-cost", "model-calls", "model-batch", "pilot-99"]) expect([n, v(n).kind, v(n).action]).toEqual([n, "model", "keep"]);
  expect(v("mock-batch").kind).toBe("code-only");
  rmSync(runs, { recursive: true, force: true });
});

test("temp folders: only the named prefixes, older than a day, whose run is gone", () => {
  const tmp = mk();
  put(tmp, "oikos-old/x", 10, 3); put(tmp, "oikos-new/x", 10, 0); put(tmp, "forms-trained-1/x", 10, 3); put(tmp, "sz-1/x", 10, 3); put(tmp, "other-old/x", 10, 3);
  put(tmp, `oikos-test-${process.pid}-abc/x`, 10, 3);
  const by = Object.fromEntries(classifyTmp(tmp, { now: NOW }).map((t) => [t.name, t.action]));
  expect(by).toEqual({ "oikos-old": "remove", "oikos-new": "keep", "forms-trained-1": "remove", "sz-1": "remove", [`oikos-test-${process.pid}-abc`]: "keep" });
  rmSync(tmp, { recursive: true, force: true });
});

test("build folders: a .claude/target-* goes when nothing was built in it for a day and no running process uses it", async () => {
  const { classifyTargets } = await import("./disk-tidy");
  const claude = mk();
  put(claude, "target-old/release/deps/x.rlib", 10, 3);
  put(claude, "target-new/release/deps/x.rlib", 10, 3); put(claude, "target-new/release/oikos-kernel", 10, 0); // built today
  put(claude, "target-used/release/deps/x.rlib", 10, 3);
  put(claude, "worktrees/x/file", 10, 3); put(claude, "other-old/x", 10, 3);
  for (const d of ["target-old", "target-old/release", "target-old/release/deps", "target-used", "target-used/release", "target-used/release/deps", "target-new", "target-new/release/deps"]) { const t = (NOW - 3 * DAY) / 1000; utimesSync(join(claude, d), t, t); }
  const by = Object.fromEntries(classifyTargets(claude, (p) => p.endsWith("target-used"), { now: NOW }).map((t) => [t.name, t.action]));
  expect(by).toEqual({ "target-old": "remove", "target-new": "keep", "target-used": "keep" });
  rmSync(claude, { recursive: true, force: true });
});

test("a merged worktree with nothing running in it loses its kernel/target at once, whatever its age or lock", () => {
  const tree = (o: Partial<Tree>): Tree => ({ holdsRuns: false, path: "/w/agent-x", name: "agent-x", head: "abc", branch: "x", locked: true, self: false, kb: 9, targetKb: 5, merged: true, branchMerged: true, dirty: false, inUse: undefined, wave: false, ageDays: 0, verdict: "keep", ...o });
  expect(judgeTarget(tree({}), false).action).toBe("remove"); // locked by the session that started it, made today
  expect(judgeTarget(tree({ dirty: true, holdsRuns: true }), false).action).toBe("remove"); // the tree stays; its build goes
  expect(judgeTarget(tree({}), true).action).toBe("keep"); // a process uses a file in it
  expect(judgeTarget(tree({ inUse: "a process is working in it" }), false).action).toBe("keep");
  expect(judgeTarget(tree({ branchMerged: false }), false).action).toBe("keep");
  expect(judgeTarget(tree({ merged: false }), false).action).toBe("keep");
  expect(judgeTarget(tree({ self: true }), false).action).toBe("keep");
  expect(judgeTarget(tree({ name: "merge-main" }), false).action).toBe("keep");
  expect(judgeTarget(tree({ name: "wave-1", wave: true }), false).action).toBe("keep");
  expect(judgeTarget(tree({ targetKb: 0 }), false).action).toBe("keep");
});
