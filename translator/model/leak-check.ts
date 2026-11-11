// Before a retrain: no training row is a real test case or comes from a test case's seat-day. By code only: the
// in-repo real cases (translator/eval/pilot-cases.ts) by their words and by the seat-day each came from, and the
// held-out cases (outside the repo) by five words running, through eval/held-out.ts, never read here.
//   bun translator/model/leak-check.ts <train.jsonl>...   (exit 1 on any)
import { readFileSync } from "node:fs";
import { loadHeldOut, sharesWording } from "../eval/held-out";
import { PILOT_CASES } from "../eval/pilot-cases";

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const words = new Set(PILOT_CASES.map((c) => norm(c.request)));
// (A case's seat-day: its run, its seat and its day, as the data's ids and sources name them: run/…/seat/dN/.)
const days = PILOT_CASES.map((c) => ({ run: c.from.run.split("/").pop()!, seat: c.from.seat, day: `d${c.from.day}` }));
const held = loadHeldOut();
const shares = held ? sharesWording(held) : () => false;
let bad = 0;
const report: { [file: string]: { rows: number; test_words: number; test_seat_days: number; held_out_wording: number } } = {};
for (const f of process.argv.slice(2)) {
  const r = { rows: 0, test_words: 0, test_seat_days: 0, held_out_wording: 0 };
  for (const l of readFileSync(f, "utf8").split("\n")) {
    if (!l.trim()) continue;
    const x = JSON.parse(l);
    r.rows++;
    if (words.has(norm(x.request))) r.test_words++;
    const where = `${x.id ?? ""} ${x.source ?? ""}`;
    if (days.some((d) => where.includes(d.run) && where.includes(`${d.seat}/${d.day}/`))) r.test_seat_days++;
    if (shares(x.request)) r.held_out_wording++;
  }
  bad += r.test_words + r.test_seat_days + r.held_out_wording;
  report[f] = r;
}
console.log(JSON.stringify({ held_out_available: !!held, ...report }, null, 1));
process.exit(bad ? 1 : 0);
