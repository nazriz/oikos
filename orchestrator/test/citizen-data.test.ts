// The capture of citizens' decisions (docs/citizen-data.md; contracts/citizen-data.schema.json): turning it on changes
// nothing (the same log, byte for byte, and the same state); every row is valid; a person's record folded from the
// capture is the record the kernel keeps; outcomes join their turns; and the exporter makes one valid example a turn.

import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import zlib from "node:zlib";
import { generate } from "@oikos/worlds/generator/generate";
import { exportCitizenData } from "../src/citizen-data";
import { citizensBeside, isLog } from "../src/logs";
import { recordChanges } from "../src/records";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const NS = "urn:oikos:contracts:0.8";
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
for (const f of readdirSync(join(root, "contracts")).filter((f) => f.endsWith(".schema.json"))) ajv.addSchema(JSON.parse(readFileSync(join(root, "contracts", f), "utf8")));
const valid = (def: string, row: unknown) => {
  const v = ajv.getSchema(`${NS}:citizen-data#/$defs/${def}`)!;
  const ok = v(row);
  if (!ok) console.error(def, JSON.stringify(v.errors).slice(0, 1000));
  return ok;
};
const lines = (text: string) => text.split("\n").filter(Boolean).map((l) => JSON.parse(l));

test("capturing citizens' decisions changes nothing, and gives every turn with its draws, record and outcomes", async () => {
  const base = join(root, "runs", "test-citizen-data");
  rmSync(base, { recursive: true, force: true });
  const config = generate({ ...spec, citizens: 80 });
  const off = await runWorld({ config, runId: "capture", outDir: join(base, "off"), until: 45 * DAY });
  const on = await runWorld({ config, runId: "capture", outDir: join(base, "on"), until: 45 * DAY, captureCitizens: true });
  // The same run: the log byte for byte, the state hash, and no capture where it was not asked for (a code run).
  expect(on.stateHash).toBe(off.stateHash);
  expect(readFileSync(on.logPath).equals(readFileSync(off.logPath))).toBe(true);
  expect(existsSync(citizensBeside(off.logPath))).toBe(false);
  const path = citizensBeside(on.logPath);
  expect(isLog(path.split("/").at(-1)!)).toBe(false);
  const rows = lines(Buffer.from(zlib.zstdDecompressSync(readFileSync(path))).toString("utf8"));
  // Every row valid; a segment first.
  expect(rows[0]).toMatchObject({ row: "segment", schema: "citizen-data/1", run: "capture", from_t: 0 });
  for (const r of rows) expect(valid("Row", r)).toBe(true);
  const turns = rows.filter((r) => r.row === "turn");
  expect(turns.length).toBeGreaterThan(500);
  // Each turn is a decision the log keeps, in the same order, the same data (only citizens' minds record decisions;
  // people born or come in the run are `par.N`).
  const logged = lines(readFileSync(on.logPath, "utf8")).filter((e) => e.kind === "annotation" && e.body?.annotation === "decision");
  expect(turns.map((x) => [x.p, x.decision])).toEqual(logged.map((e) => [e.body.subject, e.body.data]));
  // Each person's turns numbered 1, 2, 3...; the draws a decision was made with, as the stream's own values.
  const last = new Map<string, number>();
  for (const x of turns) {
    expect(x.n).toBe((last.get(x.p) ?? 0) + 1);
    last.set(x.p, x.n);
  }
  expect(turns.every((x) => x.draws.length > 0)).toBe(true);
  const exact = turns.filter((x) => x.draws.at(-1).drawn);
  expect(exact.length).toBeGreaterThan(100);
  expect(new Set(exact.map((x) => x.decision.domain)).size).toBeGreaterThan(2);
  // The record folded from the capture is the record the kernel took, change by change.
  const captured = rows.filter((r) => r.row === "record").map((r) => [r.p, r.t, r.set]);
  const kept: any[][] = [];
  for await (const c of recordChanges(on.logPath)) if (c.keeper === "citizen.default") kept.push([c.participant, c.t, c.set]);
  expect(captured.length).toBeGreaterThan(80);
  expect(captured).toEqual(kept);
  // The exporter: one valid example a turn, the record as it stood, the outcomes that name the turn.
  const out = join(base, "examples.jsonl");
  const s = await exportCitizenData(path, out, { run: "test-citizen-data", tests: [{ run: "test-citizen-data", seat: "mayor", day: 3, draft: "x", request: "x" }] });
  const examples = lines(readFileSync(out, "utf8"));
  expect(examples.length).toBe(turns.length);
  expect(s.examples).toBe(turns.length);
  for (const e of examples) expect(valid("Example", e)).toBe(true);
  expect(s.outcomes_joined).toBeGreaterThan(0);
  expect(examples.some((e) => e.outcomes.length && e.outcomes.every((o: any) => o.of === e.n))).toBe(true);
  // (The test day's turns are kept out of training, and no other's.)
  expect(examples.filter((e) => e.exclude_from_training).every((e) => Math.floor(e.t / DAY) === 3)).toBe(true);
  expect(s.excluded).toBe(examples.filter((e) => Math.floor(e.t / DAY) === 3).length);
  // A turn after the person's first record change carries that record as it stood: the fold of their changes before it.
  const later = examples.find((e) => e.record_at !== undefined && e.t > e.record_at + 7 * DAY)!;
  expect(later).toBeDefined();
  const fold: any = {};
  for (const r of rows) if (r.row === "record" && r.p === later.participant && r.t <= later.record_at) Object.assign(fold, r.set);
  expect(later.record).toEqual(fold);
  rmSync(base, { recursive: true, force: true });
}, 300_000);
