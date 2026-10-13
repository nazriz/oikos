#!/usr/bin/env bun
// Culture, read from logs alone (docs/behaviour/culture.md; design 14h): nothing in a run computes this.
//   bun scripts/culture-report.ts run <log.jsonl[.zst]> <profile> <seed> > run.json     one run: norms by conduct and group over time, the gap between
//        what is thought and said, what people remember of the town and how far it travelled, the verdicts and tellings in the log
//   bun scripts/culture-report.ts sum <run.json>...                                      many runs of one profile: per conduct, how far the picture moved
//        against how far runs differ from one another (the drop condition of 14l), and the town's memory
import { readFileSync } from "node:fs";
import { generate } from "../worlds/generator/generate";
import { logLines } from "../orchestrator/src/logs";
import { recordChanges } from "../orchestrator/src/records";
import { CONDUCTS, normsRows } from "../participants/src/behaviour/culture";
import { EVENT_KINDS } from "../participants/src/behaviour/townmemory";

const DAY = 86_400;
const CHECK = [7, 30, 90, 180, 270, 364]; // (day 7: everyone has written their record by then; the first record change is at the start)
const NAMES = ["does", "approves", "own", "says"] as const;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };
const r1 = (x: number) => Math.round(x * 10) / 10;

async function run(log: string, profile: string, seed: number) {
  const base = Bun.YAML.parse(readFileSync("worlds/town-1000.yaml", "utf8")) as any;
  const config = generate({ ...base, profile, seed, living: { initiative_bps: 10_000, culture: true } }) as any;
  const originOf = new Map<string, string>(config.participants.filter((x: any) => x.kind === "person" && x.controller?.params?.origin).map((x: any) => [x.person, x.controller.params.origin]));
  const norms = new Map<string, { conduct: string; numbers: number[] }[]>();
  const heard = new Map<string, any[]>();
  const norm: any[] = [], mem: any[] = [];
  let next = 0;
  const snap = (day: number) => {
    const rows: { [g: string]: { [c: string]: number[][] } } = {};
    for (const [who, ns] of norms) for (const g of ["all", ...(originOf.has(who) ? [originOf.get(who)!] : [])]) for (const n of ns) ((rows[g] ??= {})[n.conduct] ??= []).push(n.numbers);
    for (const [g, byC] of Object.entries(rows)) for (const [c, rs] of Object.entries(byC)) {
      const o: any = { day, group: g, conduct: c, people: rs.length };
      NAMES.forEach((nm, i) => { const xs = rs.map((r) => r[i]!); o[nm] = r1(mean(xs)); o[`${nm}_sd`] = r1(sd(xs)); });
      o.gap_own_says = r1(mean(rs.map((r) => Math.abs(r[2]! - r[3]!)))); // said against thought, per person
      o.gap_own_approves = r1(mean(rs.map((r) => r[2]! - r[1]!))); // what the people think against what they take the others to approve (a town wrong about itself)
      norm.push(o);
    }
    const slots = [...heard.values()].flat();
    const byKind: { [k: string]: number } = {}, byHow: { [k: string]: number } = {}, byHops: { [k: string]: number } = {};
    for (const s of slots) { byKind[EVENT_KINDS[s[0]] ?? s[0]] = (byKind[EVENT_KINDS[s[0]] ?? s[0]] ?? 0) + 1; byHow[["saw", "read", "told"][s[4]]!] = (byHow[["saw", "read", "told"][s[4]]!] ?? 0) + 1; byHops[s[5]] = (byHops[s[5]] ?? 0) + 1; }
    mem.push({ day, people: norms.size, holding: [...heard.values()].filter((h) => h.length).length, slots: slots.length, byKind, byHow, byHops });
  };
  for await (const c of recordChanges(log)) {
    while (next < CHECK.length && c.t >= CHECK[next]! * DAY) snap(CHECK[next++]!);
    if (c.set.norms) norms.set(c.entity, normsRows(c.set.norms as any));
    if (c.set.heard) heard.set(c.entity, c.set.heard as any[]);
  }
  while (next < CHECK.length) snap(CHECK[next++]!);
  // The log's own counts: what happened in the town (removals, stoppages), and what was said (verdicts, tellings of the town's talk).
  const n = { warrant_executed: 0, stop_work: 0, verdicts: 0, town_talk: 0, household_answers: 0 };
  for await (const line of logLines(log)) {
    if (line.includes('"kind":"warrant_executed"') && line.includes('"block":"publish"')) n.warrant_executed++;
    else if (line.includes('"kind":"stop_work"') && line.includes('"block":"publish"')) n.stop_work++;
    if (line.includes(": I say it is ") && line.includes("Of your ")) n.verdicts++;
    if (line.includes("Talk of the town:")) n.town_talk++;
    if (line.includes("As I see it, of ")) n.household_answers++;
  }
  return { profile, seed, norm, mem, counts: n };
}

function sum(files: string[]) {
  const runs = files.map((f) => JSON.parse(readFileSync(f, "utf8")));
  const last = CHECK[CHECK.length - 1]!;
  const rows: any[] = [];
  for (const c of CONDUCTS) for (const nm of NAMES) {
    const at = (r: any, day: number) => r.norm.find((x: any) => x.day === day && x.group === "all" && x.conduct === c)?.[nm] as number | undefined;
    const start = runs.map((r) => at(r, CHECK[0]!)).filter((x): x is number => x !== undefined), end = runs.map((r) => at(r, last)).filter((x): x is number => x !== undefined);
    if (!start.length || !end.length) continue;
    const moved = runs.map((r) => (at(r, last) ?? NaN) - (at(r, CHECK[0]!) ?? NaN)).filter((x) => !Number.isNaN(x));
    // The drop condition (14l): the picture moves less than the runs differ from one another. `spread` is the sd of the end value over runs
    // (the same town, run seeds apart); `shift` is the mean change over a year. Below one spread: not distinguishable from the seeds.
    const sdAt = (day: number) => r1(mean(runs.map((r) => r.norm.find((x: any) => x.day === day && x.group === "all" && x.conduct === c)?.[`${nm}_sd`] ?? 0)));
    rows.push({ conduct: c, number: nm, start: r1(mean(start)), end: r1(mean(end)), people_sd_start: sdAt(CHECK[0]!), people_sd_end: sdAt(last), shift: r1(mean(moved)), spread: r1(sd(end)), moves_more_than_seeds_differ: Math.abs(mean(moved)) > sd(end) });
  }
  const m = (f: (r: any) => number) => r1(mean(runs.map(f)));
  const final = (r: any) => r.mem[r.mem.length - 1];
  return { runs: runs.length, profile: runs[0].profile, norms: rows,
    memory: { holding_share_pct: m((r) => (100 * final(r).holding) / Math.max(1, final(r).people)), slots_per_person: m((r) => final(r).slots / Math.max(1, final(r).people)), byKind: runs.map((r) => final(r).byKind), byHow: runs.map((r) => final(r).byHow), byHops: runs.map((r) => final(r).byHops) },
    counts: { warrants_executed: m((r) => r.counts.warrant_executed), stoppages: m((r) => r.counts.stop_work), verdicts: m((r) => r.counts.verdicts), town_talk: m((r) => r.counts.town_talk), household_answers: m((r) => r.counts.household_answers) } };
}

const [mode, ...args] = process.argv.slice(2);
if (mode === "run") console.log(JSON.stringify(await run(args[0]!, args[1]!, Number(args[2] ?? 1))));
else if (mode === "sum") console.log(JSON.stringify(sum(args), null, 1));
else console.error("usage: culture-report.ts run <log> <profile> <seed> | sum <run.json>...");
