// The sizes of entities' records over a run (docs/behaviour/citizen.md, "The record"): from a log, at the end of each
// year, how many records there are, their median, 99th centile and largest size in bytes against the world's cap,
// for people and for organisations, and the largest section of the largest record. No model is called; it reads the
// log's record changes and rebuilds each record as `oikos record` does.
//
//   bun scripts/record-sizes.ts LOG [--every DAYS]
import { recordChanges, Records } from "../orchestrator/src/records";

const args = process.argv.slice(2);
const log = args.find((a) => !a.startsWith("--"));
if (!log) { console.error("usage: bun scripts/record-sizes.ts LOG [--every DAYS]"); process.exit(2); }
const every = (Number(args[args.indexOf("--every") + 1]) || 365) * 86_400;
const CAP = 8_192;
const built = new Records();
const centile = (xs: number[], q: number) => (xs.length ? xs[Math.min(xs.length - 1, Math.floor(q * xs.length))]! : 0);
const line = (t: number) => {
  for (const [what, org] of [["people", false], ["organisations", true]] as const) {
    const all = [...built.of.values()].filter((r) => !!r.sections.character === org);
    const sizes = all.map((r) => r.bytes).sort((a, b) => a - b);
    const top = all.sort((a, b) => b.bytes - a.bytes)[0];
    const sections = top ? Object.entries(top.sections).map(([k, v]) => [k, JSON.stringify(v).length] as const).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${k} ${n}`).join(", ") : "";
    console.log(`day ${String(Math.round(t / 86_400)).padStart(5)}  ${what.padEnd(13)} ${String(sizes.length).padStart(5)} records  median ${String(centile(sizes, 0.5)).padStart(5)}  p99 ${String(centile(sizes, 0.99)).padStart(5)}  largest ${String(sizes.at(-1) ?? 0).padStart(5)} of ${CAP}${top ? `  (${top.entity}: ${sections})` : ""}`);
  }
};
let next = every, last = 0, faults = 0;
for await (const c of recordChanges(log)) {
  while (c.t >= next) { line(next); next += every; }
  const before = built.of.get(c.entity)?.faults.length ?? 0;
  faults += built.apply(c).faults.length - before;
  last = c.t;
}
line(last);
console.log(`chain faults: ${faults}`);
