// Writes contracts/test/law-drafts.json: every law schedule of worlds/law/schedules.json drafted by the TS
// `draftLaw` (participants/src/behaviour/common.ts) with every figure given, and again with each optional figure left
// out, so that the Rust `oikos_rules::law::draft_law` is held to the same words, breakdown, rule and figures
// (kernel/crates/rules/src/law.rs tests; docs/port-guide.md, step 1b). Run once; the file is the shared cases after.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import schedules from "../worlds/law/schedules.json";
import { draftLaw, type LawSchedule } from "../participants/src/behaviour/common";

const DAY = 86_400;
const cases: unknown[] = [];
for (const r of (schedules as { records: { id: string; data: LawSchedule }[] }).records) {
  const s = r.data;
  const all: { [k: string]: number } = {};
  let i = 0;
  for (const [name, f] of Object.entries(s.figures)) all[name] = f.type === "duration" ? (30 + 15 * i++) * DAY : (5 + 7 * i++) * (f.per_unit ?? 1);
  const sets = [all, ...Object.entries(s.figures).filter(([, f]) => f.optional).map(([name]) => Object.fromEntries(Object.entries(all).filter(([k]) => k !== name)))];
  for (const values of sets) {
    let out: unknown;
    try { out = draftLaw(r.id, s, values); } catch (e) { out = { error: String((e as Error).message) }; }
    cases.push({ schedule: r.id, data: s, values, out });
  }
}
writeFileSync(join(import.meta.dir, "../contracts/test/law-drafts.json"), JSON.stringify({ description: "Laws written from their figures by a schedule: the TS draftLaw's answers, which the Rust draft_law gives too (scripts/port-law-cases.ts).", cases }, null, 1) + "\n");
