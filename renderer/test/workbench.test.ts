// The workbench's server side (renderer/src/workbench.ts): the measures over time are measure/'s own (the last day's
// equal what measureLog gives for the whole log, so the workbench can never disagree with a report); an experiment's
// arms are grouped from where their logs sit; exports are CSV as RFC 4180 has it and Parquet that reads back.

import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parquetReadObjects } from "hyparquet";
import { measureLog } from "../../measure/src/stewardship";
import { pilotRuns } from "../src/paths";
import { groupOf, measureSeries, toCsv, toParquet } from "../src/workbench";
import { writeFixtureRun } from "./fixture";

const base = mkdtempSync(join(tmpdir(), "oikos-workbench-"));
afterAll(() => rmSync(base, { recursive: true, force: true }));

test("the measures over time end where measure/ ends for the whole log, and counts never fall", async () => {
  const log = writeFixtureRun(join(base, "runs", "fx"));
  const s = await measureSeries(log);
  const whole = await measureLog(log);
  for (const d of s.defs) expect(s.series[d.name]!.at(-1) ?? null, d.name).toEqual(whole.measures[d.name] ?? null);
  for (const d of s.defs.filter((x) => x.unit === "count")) {
    const v = s.series[d.name]!.map((x) => x ?? 0);
    expect(v.every((x, i) => i === 0 || x >= v[i - 1]!), d.name).toBe(true);
  }
  expect(s.series.decisions!.length).toBe(s.days + 1);
});

test("an experiment's arm is found from where its exported log sits, with its registration", () => {
  const exp = join(base, "exp");
  mkdirSync(join(exp, "seed-2"), { recursive: true });
  writeFileSync(join(exp, "spec.json"), JSON.stringify({ name: "demo", reference: "code", preregistration: "demo.prereg.yaml" }));
  writeFileSync(join(exp, "preregistration.yaml"), "preregistration: 1\nexperiment: demo\nregistered: \"2026-10-25\"\nquestion: q\npost: p\narms: [code, nobody]\nreference: code\nseeds: [2]\nforkDay: 1\nuntilDay: 3\nlevel: 0.95\ncorrection: none\nprimary:\n  - { measure: decisions, arm: nobody, vs: code }\n");
  writeFixtureRun(join(exp, "seed-2")); // (a log named as its fixture is; the arm's own name below)
  const g = groupOf({ key: "k", dir: join(exp, "seed-2"), name: "nobody", pilot: false, mtime: 0, log: join(exp, "seed-2", "nobody.jsonl") });
  expect(g).toMatchObject({ experiment: "demo", arm: "nobody", seed: 2, reference: "code" });
  expect(g!.registered!.primary[0]).toMatchObject({ measure: "decisions", arm: "nobody", vs: "code" });
  // exported elsewhere, with a manifest naming the experiment
  const other = join(base, "arms", "seed-2.code");
  mkdirSync(other, { recursive: true });
  writeFileSync(join(other, "experiment.json"), JSON.stringify({ experiment: "../../exp", arm: "code", seed: 2 }));
  const h = groupOf({ key: "k2", dir: other, name: "seed-2.code", pilot: false, mtime: 0, log: join(other, "code.jsonl") });
  expect(h).toMatchObject({ experiment: "demo", arm: "code", seed: 2 });
  // a plain run belongs to none
  expect(groupOf(pilotRuns("/nonexistent", [join(base, "runs", "fx")])[0]!)).toBeUndefined();
});

test("exports: CSV quoted where it must be, Parquet that reads back the same", async () => {
  const t = { columns: ["day", "who", "share", "text"], rows: [[0, "c1", 0.5, 'said "no", then left'], [1, null, null, "line\nbreak"]] };
  expect(toCsv(t)).toBe('day,who,share,text\r\n0,c1,0.5,"said ""no"", then left"\r\n1,,,"line\nbreak"\r\n');
  const bytes = toParquet(t);
  expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("PAR1");
  const back = await parquetReadObjects({ file: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer });
  expect(back.map((r: any) => [Number(r.day), r.who, r.share, r.text])).toEqual([[0, "c1", 0.5, 'said "no", then left'], [1, null, null, "line\nbreak"]]);
});
