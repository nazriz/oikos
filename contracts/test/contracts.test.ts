// Contract conformance: every schema compiles under draft 2020-12 strict mode,
// every example under examples/valid validates, and every example under
// examples/invalid is rejected. The Rust kernel runs its own conformance
// tests against these same schemas and examples.
import { describe, expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const NS = "urn:oikos:contracts:0.8";

const SCHEMA_FILES = [
  "common.schema.json",
  "blocks.schema.json",
  "records.schema.json",
  "world-config.schema.json",
  "participant-api.schema.json",
  "log.schema.json",
  "calls.schema.json",
  "outcomes.schema.json",
  "entity-record.schema.json",
  "dataset.schema.json",
  "module.schema.json",
  "citizen-data.schema.json",
];

// examples/<valid|invalid>/<dir>/*.json is checked against TARGETS[<dir>].
const TARGETS: Record<string, string> = {
  "world-config": `${NS}:world-config`,
  block: `${NS}:blocks#/$defs/Block`,
  record: `${NS}:records#/$defs/Record`,
  "participant-action": `${NS}:participant-api#/$defs/ParticipantAction`,
  "participant-observation": `${NS}:participant-api#/$defs/Observation`,
  "step-result": `${NS}:participant-api#/$defs/StepResult`,
  "log-entry": `${NS}:log`,
  call: `${NS}:calls`,
  request: `${NS}:outcomes#/$defs/RequestData`,
  form: `${NS}:outcomes#/$defs/FormData`,
  "dataset-manifest": `${NS}:dataset#/$defs/Manifest`,
  "dataset-decision": `${NS}:dataset#/$defs/Decision`,
  "dataset-citizen-decision": `${NS}:dataset#/$defs/CitizenDecision`,
  "dataset-citizen-outcome": `${NS}:dataset#/$defs/CitizenOutcome`,
  "dataset-citizen-record": `${NS}:dataset#/$defs/CitizenRecord`,
  "dataset-citizen-period": `${NS}:dataset#/$defs/CitizenPeriod`,
  "entity-record": `${NS}:entity-record#/$defs/PersonRecord`,
  "entity-record-organisation": `${NS}:entity-record#/$defs/OrganisationRecord`,
  "dataset-want": `${NS}:dataset#/$defs/Want`,
  "citizen-data-row": `${NS}:citizen-data#/$defs/Row`,
  "citizen-data-example": `${NS}:citizen-data#/$defs/Example`,
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

// Worlds a schema cannot rule out, and the kernel refuses to load (docs/design/knowing.md: a register for a seat that
// does not keep it, a kind nobody published, premises claimed twice). Each is well formed; kernel/tests/knowing.rs
// loads every one and expects it refused, with the reason its description gives.
describe("examples the kernel refuses to load are well formed", () => {
  const dir = join(root, "examples/refused/world-config");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    test(`world-config/${file}`, () => {
      const v = validator(TARGETS["world-config"]!);
      const ok = v(readJson(join(dir, file)));
      if (!ok) console.error(JSON.stringify(v.errors, null, 2));
      expect(ok).toBe(true);
    });
  }
});

// Targeted mutations of the valid world config: each must be rejected.
describe("world-config mutations are rejected", () => {
  const base = () => readJson(join(root, "examples/valid/world-config/riverbend-mini.json"));
  const v = validator(TARGETS["world-config"]!);
  const cases: [string, (c: any) => void][] = [
    ["float hidden in opaque controller params", (c) => (c.participants[0].controller.params = { temperature: 0.7 })],
    ["float hidden in a record's data", (c) => (c.world.records.find((r: any) => r.id === "law-tax").data.rate = 0.1)],
    ["config id shaped like a kernel id", (c) => (c.world.entities[1].id = "ent.1")],
    ["framing without a reason", (c) => delete c.participants[0].framing.reason],
    ["a v0.1 mandate on a participant", (c) => (c.participants[0].mandate = { powers: [] })],
    ["a v0.3 seat list", (c) => (c.seats = [])],
    ["a v0.3 parcel list", (c) => (c.world.parcels = [])],
    ["a v0.3 slot capacity on a structure type", (c) => (c.catalogue.structure_types[0].capacity = { dwelling: 1 })],
    ["a participant of an unknown kind", (c) => (c.participants[0].kind = "robot")],
    ["a position without an organisation", (c) => delete c.positions[0].entity],
    ["a structure on a parcel", (c) => (c.world.structures[0].parcel = "p12")],
    ["occupancy by slot", (c) => (c.world.occupancy[0] = { occupant: "alice", structure: "s-house", slot: "dwelling", count: 1 })],
    ["a life with no year", (c) => (c.life = { other_causes: { by_age: [{ from: 0, bps: 10 }] } })],
    ["severity shares as a float", (c) => (c.life = { year: 31536000, injury: { bps: 10, severity: [{ label: "minor", share_bps: 0.5, days: [1, 2], fatal_bps: 0 }] } })],
    ["a v0.1 jurisdiction list", (c) => (c.world.jurisdictions = [])],
    ["a v0.1 typed zoning rule", (c) => (c.world.rules = [{ id: "z", jurisdiction: "city", rule: { type: "zoning", parcels: "all", allow: [] } }])],
    ["a participant without a kind", (c) => delete c.participants[0].kind],
    ["account without a custodian", (c) => delete c.world.accounts[1].custodian],
    ["record without an author", (c) => delete c.world.records[0].author],
    ["measurement smuggled into config", (c) => (c.measurement = { reward: "gdp" })],
    ["float balance", (c) => (c.world.accounts[1].balance = 1.5)],
    ["a currency's sign that could be read as digits", (c) => (c.world.currencies[0].symbol = "1$")],
    ["a currency's word with a space in it", (c) => (c.world.currencies[0].unit_words = ["new dollars"])],
    ["a currency with an unknown field", (c) => (c.world.currencies[0].name = "Dollar")],
    ["a decimal mark that is neither a point nor a comma", (c) => (c.world.currencies[0].decimal_mark = ";")],
    ["a group mark that is a letter", (c) => (c.world.currencies[0].group_mark = "x")],
    ["a comma for both marks", (c) => Object.assign(c.world.currencies[0], { decimal_mark: ",", group_mark: "," })],
    ["a point for both marks", (c) => Object.assign(c.world.currencies[0], { decimal_mark: ".", group_mark: "." })],
    ["a grouping in twos only", (c) => (c.world.currencies[0].grouping = [2])],
    ["a sign-after flag that is not a boolean", (c) => (c.world.currencies[0].symbol_after = "yes")],
    ["a number word worth less than ten", (c) => (c.world.currencies[0].number_words = { few: 5 })],
    ["a number word with a space in it", (c) => (c.world.currencies[0].number_words = { "ten thousand": 10000 })],
    ["zero tick length", (c) => (c.clock.tick_seconds = 0)],
    ["wrong contracts version", (c) => (c.contracts = "0.1")],
    ["a negative distance", (c) => c.positions[0].channels.push({ id: "street", kind: "sites", area: { near: -1 } })],
    ["an unknown way of showing occupants", (c) => c.positions[0].channels.push({ id: "street", kind: "sites", area: { near: 1 }, occupants: "faces" })],
    ["an area on a directory", (c) => c.positions[0].channels.push({ id: "who2", kind: "directory", area: "all" })],
    ["an area naming a parcel, not a cell", (c) => c.positions[0].channels.push({ id: "lots", kind: "sites", area: ["p12"] })],
  ];
  for (const [name, mutate] of cases) {
    test(name, () => {
      const c = base();
      mutate(c);
      expect(v(c)).toBe(false);
    });
  }
});

test("a currency may say how its place writes money, with every field at once", () => {
  const c = readJson(join(root, "examples/valid/world-config/riverbend-mini.json"));
  Object.assign(c.world.currencies[0], {
    decimal_mark: ",", group_mark: " ", grouping: [3, 2], symbol_after: true, symbol_spaced: true, number_words: { lakh: 100000, crore: 10000000 },
  });
  expect(validator(TARGETS["world-config"]!)(c)).toBe(true);
});

// The behaviour modules' manifests (participants/manifests, written from the modules) are what the contract says.
test("every behaviour module's manifest is a valid manifest", () => {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  for (const f of SCHEMA_FILES) ajv.addSchema(JSON.parse(readFileSync(join(root, f), "utf8")));
  const validate = ajv.getSchema(`${NS}:module`)!;
  const dir = join(root, "../participants/manifests");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  expect(files.length).toBeGreaterThan(20);
  for (const f of files) {
    const ok = validate(JSON.parse(readFileSync(join(dir, f), "utf8")));
    expect({ file: f, errors: ok ? [] : validate.errors }).toEqual({ file: f, errors: [] });
  }
});
