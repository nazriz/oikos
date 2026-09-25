// Contract conformance: every schema compiles under draft 2020-12 strict mode,
// every example under examples/valid validates, and every example under
// examples/invalid is rejected. The Rust kernel runs its own conformance
// tests against these same schemas and examples.
import { describe, expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const NS = "urn:terrarium:contracts:0.3";

const SCHEMA_FILES = [
  "common.schema.json",
  "blocks.schema.json",
  "records.schema.json",
  "world-config.schema.json",
  "seat-api.schema.json",
  "log.schema.json",
];

// examples/<valid|invalid>/<dir>/*.json is checked against TARGETS[<dir>].
const TARGETS: Record<string, string> = {
  "world-config": `${NS}:world-config`,
  block: `${NS}:blocks#/$defs/Block`,
  record: `${NS}:records#/$defs/Record`,
  "seat-action": `${NS}:seat-api#/$defs/SeatAction`,
  "seat-observation": `${NS}:seat-api#/$defs/Observation`,
  "step-result": `${NS}:seat-api#/$defs/StepResult`,
  "log-entry": `${NS}:log`,
};

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));

function makeAjv() {
  // strictRequired is off: it cannot see properties declared outside an if/then branch.
  const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
  for (const f of SCHEMA_FILES) ajv.addSchema(readJson(join(root, f)));
  return ajv;
}

const ajv = makeAjv();
const validator = (ref: string) => {
  const v = ajv.getSchema(ref);
  if (!v) throw new Error(`no schema for ${ref}`);
  return v;
};

function examples(kind: "valid" | "invalid") {
  const out: { dir: string; file: string; data: unknown }[] = [];
  for (const dir of Object.keys(TARGETS)) {
    const path = join(root, "examples", kind, dir);
    for (const file of readdirSync(path).filter((f) => f.endsWith(".json")).sort()) {
      out.push({ dir, file, data: readJson(join(path, file)) });
    }
  }
  return out;
}

describe("schemas", () => {
  test("all compile in strict mode", () => {
    for (const ref of Object.values(TARGETS)) expect(() => validator(ref)).not.toThrow();
  });
});

describe("valid examples", () => {
  for (const ex of examples("valid")) {
    test(`${ex.dir}/${ex.file}`, () => {
      const v = validator(TARGETS[ex.dir]!);
      const ok = v(ex.data);
      if (!ok) console.error(JSON.stringify(v.errors, null, 2));
      expect(ok).toBe(true);
    });
  }
});

describe("invalid examples", () => {
  for (const ex of examples("invalid")) {
    test(`${ex.dir}/${ex.file} is rejected`, () => {
      expect(validator(TARGETS[ex.dir]!)(ex.data)).toBe(false);
    });
  }
});

// Targeted mutations of the valid world config: each must be rejected.
describe("world-config mutations are rejected", () => {
  const base = () => readJson(join(root, "examples/valid/world-config/riverbend-mini.json"));
  const v = validator(TARGETS["world-config"]!);
  const cases: [string, (c: any) => void][] = [
    ["float hidden in opaque controller params", (c) => (c.seats[0].controller.params.temperature = 0.7)],
    ["float hidden in a record's data", (c) => (c.world.records.find((r: any) => r.id === "law-tax").data.rate = 0.1)],
    ["config id shaped like a kernel id", (c) => (c.world.entities[1].id = "ent.1")],
    ["framing without a reason", (c) => delete c.seats[0].framing.reason],
    ["a v0.1 mandate on a seat", (c) => (c.seats[0].mandate = { powers: [] })],
    ["a v0.1 jurisdiction list", (c) => (c.world.jurisdictions = [])],
    ["a v0.1 typed zoning rule", (c) => (c.world.rules = [{ id: "z", jurisdiction: "city", rule: { type: "zoning", parcels: "all", allow: [] } }])],
    ["seat without an entity", (c) => delete c.seats[0].entity],
    ["account without a custodian", (c) => delete c.world.accounts[1].custodian],
    ["record without an author", (c) => delete c.world.records[0].author],
    ["measurement smuggled into config", (c) => (c.measurement = { reward: "gdp" })],
    ["float balance", (c) => (c.world.accounts[1].balance = 1.5)],
    ["zero tick length", (c) => (c.clock.tick_seconds = 0)],
    ["wrong contracts version", (c) => (c.contracts = "0.1")],
  ];
  for (const [name, mutate] of cases) {
    test(name, () => {
      const c = base();
      mutate(c);
      expect(v(c)).toBe(false);
    });
  }
});
