import { exportLogs, open, queries, runQuery, table } from "./src/index";
const out = "/private/tmp/claude-501/-Users-nazimrizvic-oikos/679c3995-36b2-4920-a724-f0021ea7837b/scratchpad/measure-probe";
const t0 = performance.now();
console.log(await exportLogs(["runs/test-llm-mayor/mayor.jsonl", "/private/tmp/claude-501/-Users-nazimrizvic-oikos/679c3995-36b2-4920-a724-f0021ea7837b/scratchpad/runs/scale.jsonl"], out), Math.round(performance.now() - t0), "ms");
const c = await open(out);
for (const q of queries()) { console.log("\n##", q.name, "-", q.description); const t1 = performance.now(); console.log(table(await runQuery(out, q.name, c))); console.log(Math.round(performance.now()-t1), "ms"); }
