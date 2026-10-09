// Run datasets (docs/design/run-datasets.md): a run's data as training examples, every row valid against
// contracts/dataset.schema.json; the same log always gives the same dataset; observations recorded when asked.

import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { exportDataset } from "../src/dataset";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const NS = "urn:oikos:contracts:0.8";
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
  // (A town whose council has adopted no budget, so the first weeks hold the mayor's proposal and the council's vote on it:
  // a generated town opens with its first year's budget on file otherwise.)
  const config = generate({ ...spec, citizens: 80, mayor: "llm", opening_budget: false });
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
  const kinds: Record<string, string> = { "systems.jsonl": "SystemPrompt", "translations.jsonl": "Translation", "decisions.jsonl": "Decision", "actions.jsonl": "Action", "observations.jsonl": "ObservationRow", "citizen_decisions.jsonl": "CitizenDecision", "citizen_outcomes.jsonl": "CitizenOutcome" };
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
  // What came of a seat's acts can be followed by reference: each act says what it made, and a later call says what
  // the seat had been shown that names it (here, the council's ballot on the mayor's proposal).
  const commandOf = new Map<number, any>(decisions.flatMap((d) => d.commands.map((c: any) => [c.seq, c] as [number, any])));
  expect([...commandOf.values()].some((c) => c.created?.length)).toBe(true);
  const back = decisions.flatMap((d) => (d.came_back ?? []).map((x: any) => ({ ...x, t: d.t })));
  expect(back.length).toBeGreaterThan(0);
  for (const x of back) {
    expect(commandOf.get(x.seq)?.created).toContain(x.of);
    expect(x.in).not.toBe(x.of);
  }
  const shown = new Set(JSON.stringify(rows(join(dir, "observations.jsonl")).filter((o) => o.participant === "mayor-system")).match(/"id":"[^"]+"/g));
  for (const x of back) expect(shown.has(`"id":"${x.in}"`)).toBe(true);
  // Actions: code participants only, each with whether it was applied.
  const actions = rows(join(dir, "actions.jsonl"));
  expect(actions.some((a) => a.participant.endsWith("-self") && a.reasoning && a.call)).toBe(true);
  expect(actions.some((a) => a.participant === "mayor-system")).toBe(false);
  // An act refused is written as refused, with why: every refusal in the log is on its act's row (an act takes time,
  // and its refusal is logged when it ends, under the step that ended it).
  const refusedInLog = readFileSync(s.logPath, "utf8").split("\n").filter((l) => l.includes('"event":"action_refused"')).length;
  expect(refusedInLog).toBeGreaterThan(0);
  const refusedRows = [...actions, ...commandOf.values()].filter((a) => a.applied === false);
  expect(refusedRows.length).toBe(refusedInLog);
  expect(refusedRows.every((a) => typeof a.refusal?.code === "string")).toBe(true);
  expect(actions.some((a) => a.created?.length)).toBe(true);
  // Citizens' decisions: where each stands in the log (what followed is that citizen's acts after it), and what the
  // citizen had before it.
  const minds = rows(join(dir, "citizen_decisions.jsonl"));
  expect(minds.every((d, i) => Number.isInteger(d.seq) && (i === 0 || d.seq > minds[i - 1]!.seq))).toBe(true);
  expect(minds.some((d) => d.circumstances && d.options.some((o: any) => o.facts))).toBe(true);
  expect(minds.some((d) => d.person)).toBe(true);
  expect(minds.some((d) => actions.some((a) => a.participant === d.participant && a.seq > d.seq && a.t === d.t))).toBe(true);
  // And what the citizen came to know of how each turned out: under the decision (none: an empty list, which is
  // "not known", not a payoff of nought), and as rows of their own that name the decision.
  expect(minds.every((d) => Number.isInteger(d.n) && Array.isArray(d.outcomes))).toBe(true);
  expect(minds.some((d) => d.outcomes.length === 0)).toBe(true);
  const learned = rows(join(dir, "citizen_outcomes.jsonl"));
  expect(minds.reduce((n, d) => n + d.outcomes.length, 0)).toBe(learned.filter((o) => o.decision_seq !== undefined).length);
  const served = minds.find((d) => d.domain === "shop" && d.outcomes.some((o: any) => o.kind === "served"))!;
  expect(served.outcomes.find((o: any) => o.kind === "served")).toMatchObject({ option: served.choice, way: "mine", facts: { ordered: expect.any(Number), delivered: expect.any(Number) }, learned: { payoff: expect.any(Number), before: expect.any(Number), after: expect.any(Number) } });
  expect(m.citizens).toMatchObject({ decisions: minds.length, outcomes: learned.length });
  expect(m.citizens.by_domain.shop.with_outcome).toBe(minds.filter((d) => d.domain === "shop" && d.outcomes.length).length);
  // Observations: just the two asked for.
  const seen = new Set(rows(join(dir, "observations.jsonl")).map((x) => x.participant));
  expect([...seen].sort()).toEqual([citizen, "mayor-system"].sort());
  // The same log, the same dataset, byte for byte.
  const again = join(out, "again.dataset");
  await exportDataset(s.logPath, again, { actions: true });
  for (const f of ["manifest.json", ...Object.keys(kinds)]) expect(readFileSync(join(again, f), "utf8")).toBe(readFileSync(join(dir, f), "utf8"));
}, 600_000);
