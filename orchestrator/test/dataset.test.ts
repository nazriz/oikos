// Run datasets (docs/design/run-datasets.md): a run's data as training examples, every row valid against
// contracts/dataset.schema.json; the same log always gives the same dataset; observations recorded when asked.

import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@terrarium/worlds/generator/generate";
import { exportDataset } from "../src/dataset";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const NS = "urn:terrarium:contracts:0.6";
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
for (const f of readdirSync(join(root, "contracts")).filter((f) => f.endsWith(".schema.json"))) ajv.addSchema(JSON.parse(readFileSync(join(root, "contracts", f), "utf8")));
const valid = (def: string, row: unknown) => {
  const v = ajv.getSchema(`${NS}:dataset#/$defs/${def}`)!;
  const ok = v(row);
  if (!ok) console.error(def, JSON.stringify(v.errors).slice(0, 1000));
  return ok;
};
const rows = (path: string) => readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

test("a run's dataset: a manifest, and every translation, decision, act and recorded observation, each valid", async () => {
  const out = join(root, "runs", "test-dataset");
  rmSync(out, { recursive: true, force: true });
  const config = generate({ ...spec, citizens: 80, mayor: "llm" });
  const citizen = config.participants.find((p: any) => p.controller?.impl === "citizen.default").id;
  const s = await runWorld({ config, runId: "dataset", outDir: out, until: 40 * DAY, recordObservations: ["mayor-system", citizen] });
  const dir = join(out, "dataset.dataset");
  const m = await exportDataset(s.logPath, dir, { actions: true });
  // The manifest says what made it.
  expect(valid("Manifest", m)).toBe(true);
  expect(JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"))).toEqual(m);
  expect(m.seats.models["mayor-system"].adapter).toBe("mock/mock");
  expect(Object.keys(m.versions.modules)).toContain("citizen.default");
  // Every row of every file is valid, and the manifest's counts are right.
  const kinds: Record<string, string> = { "systems.jsonl": "SystemPrompt", "translations.jsonl": "Translation", "decisions.jsonl": "Decision", "actions.jsonl": "Action", "observations.jsonl": "ObservationRow" };
  for (const [file, def] of Object.entries(kinds)) {
    const rs = rows(join(dir, file));
    expect(rs.length).toBe(m.files[file].rows);
    expect(rs.length).toBeGreaterThan(0);
    for (const r of rs) expect(valid(def, r)).toBe(true);
  }
  // Decisions: the mayor's model calls, what it was shown and answered, and what followed.
  const decisions = rows(join(dir, "decisions.jsonl"));
  expect(decisions.every((d) => d.participant === "mayor-system" && d.synthetic && d.input && d.output)).toBe(true);
  expect(decisions.some((d) => d.drafts.length > 0)).toBe(true);
  const systems = new Set(rows(join(dir, "systems.jsonl")).map((x) => x.sha256));
  for (const d of decisions) expect(systems.has(d.system_sha256)).toBe(true);
  // Every draft a decision names is a translation.
  const drafts = new Set(rows(join(dir, "translations.jsonl")).map((x) => x.draft));
  for (const d of decisions) for (const id of d.drafts) expect(drafts.has(id)).toBe(true);
  // Actions: code participants only, each with whether it was applied.
  const actions = rows(join(dir, "actions.jsonl"));
  expect(actions.some((a) => a.participant.endsWith("-self") && a.reasoning && a.call)).toBe(true);
  expect(actions.some((a) => a.participant === "mayor-system")).toBe(false);
  // Observations: just the two asked for.
  const seen = new Set(rows(join(dir, "observations.jsonl")).map((x) => x.participant));
  expect([...seen].sort()).toEqual([citizen, "mayor-system"].sort());
  // The same log, the same dataset, byte for byte.
  const again = join(out, "again.dataset");
  await exportDataset(s.logPath, again, { actions: true });
  for (const f of ["manifest.json", ...Object.keys(kinds)]) expect(readFileSync(join(again, f), "utf8")).toBe(readFileSync(join(dir, f), "utf8"));
}, 600_000);
