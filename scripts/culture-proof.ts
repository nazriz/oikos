#!/usr/bin/env bun
// The proof run of culture (design 14, step 9): one run's measures in a small file, read from its log alone (nothing in a run computes this).
//   bun scripts/culture-proof.ts <log.jsonl[.zst]> <out.json>
// The culture measures of step 7 (orchestrator/src/culture-measures.ts), plus counts of what the shock produced in the world.
import { logLines } from "../orchestrator/src/logs";
import { cultureMeasures } from "../orchestrator/src/culture-measures";

const [log, out] = [process.argv[2]!, process.argv[3]!];
const m = await cultureMeasures(log, { days: [7, 30, 60, 90, 150, 210, 270, 330, 364], nearEvents: ["strike", "put_out"] });
const c = { action_ballot: 0, ballot_result: 0, stop_work: 0, warrant_executed: 0, redundancy_pay: 0 };
for await (const l of logLines(log)) {
  const pub = l.includes('"block":"publish"');
  if (pub && l.includes('"kind":"action_ballot"')) c.action_ballot++;
  else if (pub && l.includes('"kind":"ballot_result"')) c.ballot_result++;
  else if (pub && l.includes('"kind":"stop_work"')) c.stop_work++;
  else if (pub && l.includes('"kind":"warrant_executed"')) c.warrant_executed++;
  if (l.includes("Redundancy pay")) c.redundancy_pay++;
}
await Bun.write(out, JSON.stringify({ log, counts: c, m }));
