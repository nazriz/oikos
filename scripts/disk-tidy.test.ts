// scripts/disk-tidy.ts on a small fixture runs folder: model evidence wins over everything, and only code-only runs
// older than the limit lose anything.
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyRun, classifyTmp } from "./disk-tidy";

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
