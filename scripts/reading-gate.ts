// The reading gate's runner (docs/design/ai-citizens.md 13f, 13h step 4/5): asks a reader about the hand-made pairs
// (participants/eval/reading-pairs.json) and the controls made from them, and prints which checks hold.
//
//   bun scripts/reading-gate.ts --reader mock:lexicon [--second mock:lexicon] [--json]
//
// THIS BUILD RUNS MOCKS ONLY. A model reader is step 5 of the build order and needs the owner's word; asking for one
// here is refused, so nothing in this file can make a model call. Thresholds are in participants/src/llm/reading-gate.ts
// (THRESHOLDS) and are not options.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BROKEN, lexiconReader } from "../participants/src/llm/reader-mock";
import { curtestReader, kindestReader, neutralReader, type Reader } from "../participants/src/llm/reader";
import { runGate, type Pair } from "../participants/src/llm/reading-gate";

const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };

export function mockReader(spec: string | undefined): Reader | undefined {
  if (spec === undefined) return undefined;
  const m = /^mock:(.+)$/.exec(spec);
  if (!m) throw new Error(`the reader ${spec} is not a mock: this build calls no model (design 13h, step 5 needs the owner's word)`);
  const name = m[1]!;
  if (name === "lexicon") return lexiconReader();
  if (name === "kindest") return kindestReader();
  if (name === "curtest") return curtestReader();
  if (name === "neutral") return neutralReader();
  const broken = BROKEN[name];
  if (!broken) throw new Error(`no mock reader called ${name}: lexicon, kindest, curtest, neutral, ${Object.keys(BROKEN).join(", ")}`);
  return broken();
}

if (import.meta.main) {
  const reader = mockReader(flag("reader") ?? "mock:lexicon")!;
  const second = mockReader(flag("second"));
  const pairs = (JSON.parse(readFileSync(join(import.meta.dir, "../participants/eval/reading-pairs.json"), "utf8")) as { pairs: Pair[] }).pairs;
  const report = await runGate({ reader, ...(second ? { second } : {}), pairs });
  if (args.includes("--json")) console.log(JSON.stringify(report, null, 1));
  else {
    console.log(`reading gate: ${report.reader} (v${report.version}); ${report.calls} calls, ${report.cost_usd.toFixed(2)} USD (mock), ${report.declined} declined`);
    for (const c of report.checks) console.log(`  ${c.status.toUpperCase().padEnd(7)} ${c.name}${c.value !== undefined ? `: ${c.value}` : ""}${c.status === "fail" && c.threshold ? `   [needs ${c.threshold}]` : ""}${c.status === "pending" && c.detail ? `   (${c.detail})` : ""}`);
    console.log(report.passed ? "every check that can be run here holds" : "THE GATE FAILS");
    if (report.lines_off.length) console.log(`lines switched off: ${report.lines_off.join(", ")}${report.stops ? "; the slice does not go ahead (respect, reason or answers failed)" : ""}`);
  }
  process.exit(report.passed ? 0 : 1);
}
