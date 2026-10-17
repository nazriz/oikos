// Reading's dial at the run (docs/behaviour/reading.md; design 13c, 13d): with the dial off, or on in a town whose papers
// are all code-written, the world is byte-identical to the world without it, to the state hash; with it on and a seat's
// (here, a code office's, read as a seat's by a test seam) worded decision, the reading is filed once, as an event, and
// moves the people it reached. No model is called anywhere here: the readers are the mocks.

import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { curtestReader, kindestReader, lexiconReader, neutralReader, type ReadingTable } from "@oikos/participants/llm";
import { reading as R } from "@oikos/participants";
import { exportDataset } from "../src/dataset";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const base = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
const lean = (config: any) => ({ ...config, seed: 1, log: { ...config.log, detail: "lean" } });
const withDial = (config: any, reading: object = { reader: "mock" }) => ({ ...config, dials: { ...(config.dials ?? {}), reading } });
const out = () => mkdtempSync(join(tmpdir(), "oikos-reading-"));
const notes = (path: string) => readFileSync(path, "utf8").trim().split("\n").filter((l) => l.includes('"annotation":"note"')).map((l) => JSON.parse(l).body);

// (Until 2026-10-18 this also checked the dial-off state against living-dial.test.ts's pinned STEP_1; the test audit replaced that pin with the property it stood for, so the check here is the property itself: dial on equals dial off.)

test("the dial in the world config is a schema-valid setting, and a setting that would let words outweigh a decision is refused when the run starts", async () => {
  const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
  for (const f of readdirSync(join(root, "contracts")).filter((f) => f.endsWith(".schema.json"))) ajv.addSchema(JSON.parse(readFileSync(join(root, "contracts", f), "utf8")));
  const v = ajv.getSchema("urn:oikos:contracts:0.8:world-config#/$defs/Dials") ?? ajv.getSchema("urn:oikos:contracts:0.8:world-config")!;
  const config = withDial(generate(base) as any, { reader: "mock", papers: ["decision"], calls_per_run: 100, step: { tie_bps: 200 } });
  expect(v(config), JSON.stringify(v.errors)?.slice(0, 600)).toBe(true);
  expect(v(withDial(generate(base) as any, { papers: ["decision"] }))).toBe(false); // (a reader is required)
  expect(v(withDial(generate(base) as any, { reader: "mock", papers: ["verdict"] }))).toBe(false);
  const d = out();
  try {
    await expect(runWorld({ config: lean(withDial(generate(base) as any, { reader: "mock", step: { refusal: { floor_milli: 0 } } })), runId: "bad", outDir: d, until: DAY, recordObservations: "none" })).rejects.toThrow(/never reverse or outweigh/);
    await expect(runWorld({ config: lean(withDial(generate(base) as any, { reader: "claude-code/claude-opus-5-5" })), runId: "opus", outDir: d, until: DAY, recordObservations: "none" })).rejects.toThrow(/never a reader/);
    await expect(runWorld({ config: lean(withDial(generate(base) as any, { reader: "claude-code/claude-haiku-5-5" })), runId: "model", outDir: d, until: DAY, recordObservations: "none" })).rejects.toThrow(/calls no model/);
  } finally { rmSync(d, { recursive: true, force: true }); }
}, 120_000);

test("dial on, in any town whose papers are all code-written: the same world, to the state hash, on three profiles; dial on equals dial off", async () => {
  const d = out();
  try {
    for (const [profile, days] of [["au-vic-2026", 60], ["gb-eng-2026", 30], ["ke-nakuru-2026", 30]] as const) {
      const config = generate({ ...base, profile }) as any;
      const off = await runWorld({ config: lean(config), runId: `off-${profile}`, outDir: d, until: days * DAY, recordObservations: "none" });
      const on = await runWorld({ config: lean(withDial(config)), runId: `on-${profile}`, outDir: d, until: days * DAY, recordObservations: "none" });
      expect(on.stateHash, profile).toBe(off.stateHash);
      // Nothing was asked of any reader: no paper in the town is a seat's.
      expect(on.reading, profile).toMatchObject({ asked: 0, calls: 0 });
      expect(notes(on.logPath).some((n) => n.data?.reading?.reader === "mock/lexicon")).toBe(true);
    }
  } finally { rmSync(d, { recursive: true, force: true }); }
}, 600_000);

// A code office's papers read as a seat's (a test seam), in a town where people ask: the desk reads each worded decision
// once, files the reading, and the people it reached are moved from their own records.
const PLAIN: R.Reading = { respect: 0, reason: 0, answers: null, recourse: 0, threat: 0, appeals: { openness: 0, conservation: 0, enhancement: 0, transcendence: 0 } };
const TABLE: ReadingTable = { version: "test", reader: "test", rows: Object.fromEntries(["remedy_answer", "variation_answer", "venue_decision", "tribunal_order", "fund_decision", "loan_decision", "benefit_decision"].flatMap((k) => ["granted", "refused", "decided", "approved"].map((o) => [`${k}:${o}`, PLAIN]))) };
const seam = { bySeat: () => true, words: (s: { text: string }) => s.text };
async function town(reader: any, days = 200, dial = true) {
  const d = out();
  const config = dial ? withDial(generate({ ...base, living: { initiative_bps: 10_000 } }) as any) : (generate({ ...base, living: { initiative_bps: 10_000 } }) as any);
  const run = await runWorld({ config: { ...config, seed: 1, log: { ...config.log, detail: "full" } }, runId: "r", outDir: d, until: days * DAY, recordObservations: "none", reader, readingTable: TABLE, readingSeam: seam });
  return { run, d };
}

test("a worded decision is read once and filed as an event; kinder and curter readers move the people it reached, and the same run twice is the same run", async () => {
  const kind = await town(kindestReader()), curt = await town(curtestReader()), neutral = await town(neutralReader()), kind2 = await town(kindestReader());
  try {
    expect(kind.run.reading!.asked).toBeGreaterThan(0);
    expect(kind.run.reading!.read).toBeGreaterThan(0);
    expect(kind.run.reading!.calls).toBe(2 * kind.run.reading!.read);
    // Each reading is an event in the log (at least one per paper read), and says what it moved from.
    const filed = notes(kind.run.logPath).map((n) => n.data?.reading).filter((x) => x?.paper);
    expect(filed.length).toBe(kind.run.reading!.asked);
    expect(filed.find((x) => x.source === "model")).toMatchObject({ standing: "addressee", askings: 2, reader: { model: "mock/kindest" } });
    // Nothing of the run leaves with the paper: the reader was shown tags where there were ids, sums, days and names, and the
    // same words are one reading.
    for (const x of filed) expect(x.text.replace(/\[(?:DAY|SUM|ID|PERSON)-\d+\]/g, ""), x.paper).not.toMatch(/\b[a-z]+[.\-][a-z0-9]*\d|\bday \d|\bC\d|\$\d/i);
    expect(kind.run.reading!.cached).toBeGreaterThan(0);
    expect(filed.filter((x) => x.source === "cache").length).toBe(kind.run.reading!.cached);
    // The training data of a reader of our own: readings.jsonl in the dataset, each valid; the outcomes the words touched carry `read`.
    const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
    for (const f of readdirSync(join(root, "contracts")).filter((f) => f.endsWith(".schema.json"))) ajv.addSchema(JSON.parse(readFileSync(join(root, "contracts", f), "utf8")));
    const dir = join(kind.d, "r.dataset");
    const manifest = await exportDataset(kind.run.logPath, dir);
    const rows = (f: string) => readFileSync(join(dir, f), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const readings = rows("readings.jsonl");
    expect(readings.length).toBe(filed.length);
    const rv = ajv.getSchema("urn:oikos:contracts:0.8:dataset#/$defs/Reading")!;
    for (const r of readings) expect(rv(r), JSON.stringify(rv.errors)).toBe(true);
    expect(readings.find((r) => r.source === "model")).toMatchObject({ standing: "addressee", reader: { model: "mock/kindest" }, askings: 2 });
    expect(readings.find((r) => r.source === "model").text.length).toBeGreaterThan(0);
    expect((manifest as any).files["readings.jsonl"].rows).toBe(readings.length);
    const ov = ajv.getSchema("urn:oikos:contracts:0.8:dataset#/$defs/CitizenOutcome")!;
    const touched = rows("citizen_outcomes.jsonl").filter((o) => o.read);
    expect(touched.length).toBeGreaterThan(0);
    for (const o of touched) expect(ov(o), JSON.stringify(ov.errors)).toBe(true);
    expect(touched[0].read.moved.trust.after).toBeGreaterThanOrEqual(touched[0].read.moved.trust.plain);
    // Replay: the same town, the same reader, the same world, to the state hash.
    expect(kind2.run.stateHash).toBe(kind.run.stateHash);
    // (The kindest and the curtest are two different worlds, neither the neutral one.)
    expect(kind.run.stateHash).not.toBe(neutral.run.stateHash);
    expect(curt.run.stateHash).not.toBe(neutral.run.stateHash);
    expect(curt.run.stateHash).not.toBe(kind.run.stateHash);
    // The reader that reads every paper as the plain one shifts nothing: the world with the dial off, to the state hash.
    const off = await town(neutralReader(), 200, false);
    try { expect(neutral.run.stateHash).toBe(off.run.stateHash); } finally { rmSync(off.d, { recursive: true, force: true }); }
  } finally { for (const x of [kind, curt, neutral, kind2]) rmSync(x.d, { recursive: true, force: true }); }
}, 900_000);

test("a reader that declines, fails or is over its calls: the paper is read as the plain one, and it is counted", async () => {
  const declining = { model: "mock/declining", version: "t", read: async () => ({ declined: true }) };
  const failing = { model: "mock/failing", version: "t", read: async () => { throw new Error("no answer"); } };
  const garbled = { model: "mock/garbled", version: "t", read: async () => ({ reading: { ...PLAIN, respect: 9 } }) };
  const plainWorld = await town(neutralReader());
  try {
    for (const [name, r] of [["declined", declining], ["no_answer", failing], ["unread", garbled]] as const) {
      const x = await town(r);
      try {
        expect(x.run.reading![name], name).toBeGreaterThan(0);
        expect(x.run.reading!.read).toBe(0);
        // Nobody is moved: it is the world a neutral reader gives (every shift nothing).
        expect(x.run.stateHash, name).toBe(plainWorld.run.stateHash);
      } finally { rmSync(x.d, { recursive: true, force: true }); }
    }
  } finally { rmSync(plainWorld.d, { recursive: true, force: true }); }
}, 900_000);
