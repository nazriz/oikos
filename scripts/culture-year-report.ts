#!/usr/bin/env bun
// Norm shares over time from a run's log (docs/behaviour/culture.md; design 14h): for each conduct, the mean and spread over people of
// what they take to be done (`does`), approved, think (`own`) and say, at checkpoints, overall and by origin group. Read from the
// log alone, outside the world: nothing in a run computes this. Usage: bun scripts/culture-year-report.ts <log.jsonl> <profile> [seed]
import { readFileSync } from "node:fs";
import { generate } from "../worlds/generator/generate";
import { recordChanges } from "../orchestrator/src/records";
import { normsRows } from "../participants/src/shared/culture";

const [log, profile, seed] = [process.argv[2]!, process.argv[3]!, Number(process.argv[4] ?? 1)];
const DAY = 86_400;
const base = Bun.YAML.parse(readFileSync("worlds/town-1000.yaml", "utf8")) as any;
const config = generate({ ...base, profile, seed, living: { initiative_bps: 10_000, culture: true } }) as any;
const originOf = new Map<string, string>(config.participants.filter((x: any) => x.kind === "person" && x.controller?.params?.origin).map((x: any) => [x.person, x.controller.params.origin]));
const CHECK = [0, 90, 180, 270, 364].map((d) => d * DAY);
const NAMES = ["does", "approves", "own", "says"];
const latest = new Map<string, { conduct: string; numbers: number[] }[]>();
const snaps: { day: number; people: number; rows: { [group: string]: { [conduct: string]: number[][] } } }[] = [];
const snap = (day: number) => {
  const rows: { [group: string]: { [conduct: string]: number[][] } } = {};
  for (const [who, norms] of latest) for (const g of ["all", ...(originOf.has(who) ? [originOf.get(who)!] : [])]) for (const n of norms) ((rows[g] ??= {})[n.conduct] ??= []).push(n.numbers);
  snaps.push({ day, people: latest.size, rows });
};
let next = 0;
for await (const c of recordChanges(log)) {
  while (next < CHECK.length && c.t >= CHECK[next]!) snap(CHECK[next++]! / DAY);
  if (c.set.norms) latest.set(c.entity, normsRows(c.set.norms as any));
}
while (next < CHECK.length) snap(CHECK[next++]! / DAY);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const out: any[] = [];
for (const s of snaps) for (const [g, byConduct] of Object.entries(s.rows)) for (const [conduct, rows] of Object.entries(byConduct)) {
  const o: any = { day: s.day, group: g, conduct, people: rows.length };
  NAMES.forEach((nm, i) => { const xs = rows.map((r) => r[i]!), m = mean(xs); o[nm] = Math.round(m * 10) / 10; if (nm === "does") o.does_sd = Math.round(Math.sqrt(mean(xs.map((x) => (x - m) ** 2))) * 10) / 10; });
  out.push(o);
}
console.log(JSON.stringify(out));
