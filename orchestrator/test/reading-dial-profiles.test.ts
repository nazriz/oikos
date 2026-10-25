// Reading's dial at the run, its setting and the towns whose papers are all code-written (the head of reading-dial.test.ts says
// what is held): the dial on is the dial off, to the state hash, on three profiles. (Split out of reading-dial.test.ts at the test
// pruning, 2026-10-24, so that its towns run beside that file's.)

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
