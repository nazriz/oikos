// Which office is more sensitive to its steward? Reads two finished experiments (the support office's and the
// tribunal's, the same mock stewards, the same town and seeds) and sets, for each mock steward against the office's
// code, how far each of the TARA draft's measures moved: the mean of the seed-by-seed differences, its spread, and the
// number of seeds that moved. A steward that moves nothing in an office cannot be told apart there however many seeds.
//
//   bun experiments/tara-draft/office-check/compare.ts <support-run-dir> <tribunal-run-dir>

import { readFileSync } from "node:fs";
import { join } from "node:path";

const MEASURES = ["slips_caught", "support_refused", "appeals_made", "human_in_decision_share", "reviews_decided", "review_changed_share", "support_paid", "records:benefit_decision", "records:tribunal_order", "acts"];

const [supportDir, tribunalDir] = process.argv.slice(2);
if (!supportDir || !tribunalDir) throw new Error("usage: compare.ts <support-run-dir> <tribunal-run-dir>");

const fmt = (x: number | null | undefined) => (x === null || x === undefined ? "-" : Math.abs(x) >= 1000 ? x.toExponential(2) : Math.abs(x) < 1 && x !== 0 ? x.toFixed(3) : x.toFixed(1));

for (const [office, dir] of [["support office", supportDir], ["tribunal", tribunalDir]] as const) {
  const r = JSON.parse(readFileSync(join(dir, "report.json"), "utf8"));
  console.log(`\n${office} (${r.post}; ${r.seeds.length} seeds, day ${r.forkDay} to ${r.untilDay})`);
  const code = r.arms.find((a: any) => a.name === r.reference);
  console.log(`  ${"measure".padEnd(26)} ${"code mean".padStart(10)}  ` + r.versus.map((v: any) => `${v.arm} - code`.padStart(22)).join(""));
  for (const m of MEASURES) {
    if (!code.measures[m]) continue;
    const cells = r.versus.map((v: any) => {
      const s = v.measures[m];
      if (!s || s.n === 0) return "-".padStart(22);
      const moved = s.values.filter((x: any) => x.value !== 0 && x.value !== null).length;
      return `${fmt(s.mean)} ±${fmt(s.sd)} (${moved}/${s.n})`.padStart(22);
    });
    console.log(`  ${m.padEnd(26)} ${fmt(code.measures[m].mean).padStart(10)}  ${cells.join("")}`);
  }
}
console.log("\nEach cell: mean of (arm - code) over the seeds, ± its sd, (seeds where it moved / seeds).");
