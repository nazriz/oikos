// People's own records (docs/design/ai-citizens.md 10d): one a person, held by the kernel, bounded, chained, rebuilt
// from the log and checked; never larger however long a run goes; the same for the same seed; set by a code mind's
// bookkeeping and by nothing a model returns; and exported beside the citizens' decisions, recorded and never scored.

import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RECORD } from "@oikos/participants";
import { loadWorld } from "../src/batch";
import { exportDataset } from "../src/dataset";
import { logLines } from "../src/logs";
import { digestOf, linkOf, rebuild, recordChanges, Records } from "../src/records";
import { recordChangeOf, runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const YEAR = 365 * DAY;
const NS = "urn:oikos:contracts:0.8";
const CAP = 8_192; // the kernel's, where a world says nothing (kernel/crates/world/src/state.rs)

const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
for (const f of readdirSync(join(root, "contracts")).filter((f) => f.endsWith(".schema.json"))) ajv.addSchema(JSON.parse(readFileSync(join(root, "contracts", f), "utf8")));
const check = (ref: string, row: unknown) => {
  const v = ajv.getSchema(`${NS}:${ref}`)!;
  if (!v(row)) throw new Error(`${ref}: ${JSON.stringify(v.errors).slice(0, 800)} in ${JSON.stringify(row).slice(0, 600)}`);
};
const rows = (path: string) => readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const lean = (config: any) => ({ ...config, log: { ...config.log, detail: "lean" } });
const town = async (sets: string[] = []) => (await loadWorld(join(root, "worlds/town.yaml"), sets)).config;

test("a record never grows: three years of the 120-person town, every record within the contract and the cap, with every section at its fullest still under the cap, filling no faster year on year; every chain holds", async () => {
  const out = mkdtempSync(join(tmpdir(), "oikos-records-"));
  try {
    const run = await runWorld({ config: lean(await town(["citizens=120", "years=3"])), runId: "long", outDir: out, until: 3 * YEAR });
    const records = new Records();
    const largest = [0, 0, 0];
    const sizes = new Map<string, number[]>(); // a person -> the most their record held in each year
    let changes = 0;
    const because = new Map<string, number>();
    const sectionMost = new Map<string, number>(); // a section -> the most bytes any record ever held in it
    for await (const c of recordChanges(run.logPath)) {
      changes++;
      const r = records.apply(c);
      const y = Math.min(2, Math.floor(c.t / YEAR));
      largest[y] = Math.max(largest[y]!, r.bytes);
      const mine = sizes.get(c.entity) ?? [0, 0, 0];
      mine[y] = Math.max(mine[y]!, r.bytes);
      sizes.set(c.entity, mine);
      for (const k of Object.keys(c.set)) sectionMost.set(k, Math.max(sectionMost.get(k) ?? 0, JSON.stringify(c.set[k]).length + k.length + 4));
      for (const b of (c.because ?? []) as any[]) because.set(b.what, (because.get(b.what) ?? 0) + 1);
      if (changes % 97 === 0) check("entity-record#/$defs/PersonRecord", r.sections);
    }
    expect(changes).toBeGreaterThan(10_000);
    expect(records.of.size).toBeGreaterThanOrEqual(120);
    for (const r of records.of.values()) {
      expect(r.faults).toEqual([]);
      check("entity-record#/$defs/PersonRecord", r.sections);
    }
    // Bounded, and far under the cap.
    expect(Math.max(...largest)).toBeLessThan(CAP / 2);
    // It does not grow without bound. A record fills as a life does (a tie, an institution dealt with, a defining
    // event more), each list up to the bound the contract gives it, and then stops: so what is held here is the
    // bounds, not that a third year adds nothing. (Until 2026-10-11 this asked that the largest record of the third
    // year be within 3%, then 5%, of the largest before: which person's record is largest differs from one run of a
    // town to another, and it failed whenever the town's three years changed. Measured that day, 120 people:
    // largest by year 2,741, 2,911, 3,080 bytes, one person's whose ties, memory and trust had all filled; the
    // mean, over the 116 people there all three years, of each one's largest in the year: 1,521, 1,644, 1,757.)
    // 1. Every list within its contract bound: each record is checked against the schema above, at the end and as
    //    the run goes.
    // 2. Were one record to hold every section at the largest any record ever held it, it would still be under the
    //    cap: nothing a life can fill a record with takes it past what the kernel allows.
    const fullest = [...sectionMost.values()].reduce((a, b) => a + b, 0);
    expect(fullest).toBeLessThan(CAP);
    // 3. Records on average fill slowly, and no faster as years pass: the mean of each person's largest in a year
    //    rises by no more than a sixth from one year to the next (8% and 7% when measured).
    const through = [...sizes.values()].filter((x) => x.every((v) => v > 0));
    const mean = (y: number) => through.reduce((a, x) => a + x[y]!, 0) / through.length;
    expect(mean(1)).toBeLessThanOrEqual(mean(0) * 7 / 6);
    expect(mean(2)).toBeLessThanOrEqual(mean(1) * 7 / 6);
    expect([...sizes.values()].filter((s) => s.every((x) => x > 0)).length).toBeGreaterThan(60);
    // Things happened to people, and were remembered (what, about whom): jobs lost at least, in three years.
    expect(because.get("hired") ?? 0).toBeGreaterThan(0);
    expect(because.get("job_lost") ?? 0).toBeGreaterThan(0);

    // One person's record, rebuilt and checked, as `oikos record` does; as of a moment, and by participant.
    const who = [...records.of.keys()].sort()[0]!;
    const whole = (await rebuild(run.logPath, who))!;
    expect(whole.faults).toEqual([]);
    expect(whole.sections).toEqual(records.of.get(who)!.sections);
    expect(whole.chain).toBe(records.of.get(who)!.chain);
    const early = (await rebuild(run.logPath, `${who}-self`, 30 * DAY))!;
    expect(early.n).toBeLessThan(whole.n);
    expect(early.faults).toEqual([]);
    expect(await rebuild(run.logPath, "nobody")).toBeUndefined();

    // A log whose record was altered does not verify: a number changed in one change's sections.
    const forged = join(out, "forged.jsonl");
    let done = false;
    const lines: string[] = [];
    for await (const line of logLines(run.logPath)) {
      if (!done && line.includes('"command":"entity_record"') && line.includes(`"participant":"${who}-self"`) && line.includes('"agency"')) {
        lines.push(line.replace(/"agency":\{"now":(\d+)/, (_, n) => `"agency":{"now":${Number(n) === 0 ? 1 : Number(n) - 1}`));
        done = true;
      } else lines.push(line);
    }
    expect(done).toBe(true);
    writeFileSync(forged, lines.join("\n"));
    const bad = (await rebuild(forged, who))!;
    expect(bad.faults.length).toBeGreaterThan(0);
    expect(bad.faults[0]).toMatch(/chain does not follow|not the record the kernel held/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}, 900_000);

test("the same town and seed twice: the same records, change for change; and the dataset has each change and each person's periods, to the contract", async () => {
  const out = mkdtempSync(join(tmpdir(), "oikos-records-"));
  try {
    const a = await runWorld({ config: await town(), runId: "a", outDir: out, until: 45 * DAY });
    const b = await runWorld({ config: await town(), runId: "b", outDir: out, until: 45 * DAY });
    expect(b.stateHash).toBe(a.stateHash);
    const changes = async (log: string) => { const xs: string[] = []; for await (const c of recordChanges(log)) xs.push(`${c.entity} ${c.n} ${c.chain}`); return xs; };
    const ca = await changes(a.logPath);
    expect(await changes(b.logPath)).toEqual(ca);
    expect(ca.length).toBeGreaterThan(500);
    // Recording decisions or not changes no record (they are state; decisions are notes).
    const quiet = await runWorld({ config: await town(), runId: "quiet", outDir: out, until: 45 * DAY, recordDecisions: "none" });
    expect(quiet.stateHash).toBe(a.stateHash);

    const m = await exportDataset(a.logPath, join(out, "a.dataset"));
    check("dataset#/$defs/Manifest", m);
    expect(m.records.chain_faults).toBe(0);
    expect(m.records.changes).toBe(ca.length);
    expect(m.records.largest_bytes).toBeLessThan(CAP / 2);
    const recs = rows(join(out, "a.dataset/citizen_records.jsonl"));
    expect(recs.length).toBe(ca.length);
    for (const r of recs.filter((_, i) => i % 23 === 0)) check("dataset#/$defs/CitizenRecord", r);
    const periods = rows(join(out, "a.dataset/citizen_periods.jsonl"));
    expect(periods.length).toBeGreaterThan(400);
    for (const p of periods.filter((_, i) => i % 11 === 0)) check("dataset#/$defs/CitizenPeriod", p);
    // What a log can show, recorded and never scored: agency, what is thought and said of each who holds power over
    // them, trust in each institution they deal with, where the hours went.
    const adults = periods.filter((p) => p.needs);
    expect(adults.length).toBeGreaterThan(200);
    expect(adults.every((p) => Number.isInteger(p.agency) && p.agency >= 0 && p.agency <= 10_000)).toBe(true);
    expect(adults.some((p) => p.views.length > 0 && Object.keys(p.trust).length > 0)).toBe(true);
    // (A week's hours add up to the week, within the wakes at its ends.)
    const weeks = adults.filter((p) => p.to - p.from >= 6 * DAY && p.to - p.from <= 8 * DAY && p.from > 0);
    expect(weeks.length).toBeGreaterThan(100);
    for (const p of weeks) expect(Math.abs(Object.values(p.hours as { [k: string]: number }).reduce((x, y) => x + y, 0) - (p.to - p.from))).toBeLessThanOrEqual(2 * DAY);
    expect(weeks.some((p) => (p.hours.work ?? 0) > 20 * 3_600)).toBe(true);
    // (Without the hashes: one that begins "bad" or "good" in hex is a number, not a word.)
    const text = (JSON.stringify(periods.slice(0, 200)) + JSON.stringify(recs.slice(0, 200))).replace(/"[0-9a-f]{32,}"/g, '""');
    for (const word of ["good", "bad", "score", "reward", "wellbeing"]) expect(text.replace(/"goods/g, "").includes(`"${word}`)).toBe(false); // (a quantity of goods is not a judgement of them)
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}, 600_000);

test("only a code mind's bookkeeping sets a record: nothing a model returns, and nothing done in an office", () => {
  const change = { set: { agency: { now: 10_000, own: 10_000 } } };
  const carrying = () => Object.defineProperty({ type: "wait" }, RECORD, { value: change, enumerable: false });
  expect(recordChangeOf({ capacity: "self" }, carrying())).toEqual(change);
  // A model seat, whatever is behind it (its own answer, a mock's code brain, a stand-in): nothing.
  expect(recordChangeOf({ llm: { controller: {} }, capacity: "self" }, carrying())).toBeUndefined();
  expect(recordChangeOf({ llm: {} }, carrying())).toBeUndefined();
  // Acting in a position: an office has no record of its holder's to write.
  expect(recordChangeOf({ capacity: "mayor" }, carrying())).toBeUndefined();
  // What a model can return is JSON: a field named for it sets nothing (the symbol cannot be written in JSON).
  expect(recordChangeOf({ capacity: "self" }, JSON.parse('{"type":"wait","record":{"set":{"agency":{"now":10000}}},"oikos.record":{"set":{}}}'))).toBeUndefined();
  expect(recordChangeOf({ capacity: "self" }, { type: "wait" })).toBeUndefined();
  // And the participant API has no act for it.
  const api = JSON.parse(readFileSync(join(root, "contracts/participant-api.schema.json"), "utf8"));
  const types = api.$defs.ParticipantAction.oneOf.map((x: any) => x.properties.type.const).sort();
  expect(types).toEqual(["act", "call", "look", "message", "opt_out", "propose", "sign", "wait"]);
});

test("an organisation's record is taken only from the module its keeping post names, held by the one who produced it", () => {
  const change = { set: { books: { open: 3 } } };
  const carrying = () => Object.defineProperty({ type: "wait" }, RECORD, { value: change, enumerable: false });
  const post = (o: object) => ({ id: "finance", entity: "city", channels: [], role_module: { code: "city.finance_officer" }, holder: "finance-system", keeps_record: true, ...o });
  const positions = (p: any) => new Map<string, any>([["finance", p]]);
  const unit = (o: object = {}) => ({ capacity: "finance", participant: "finance-system", module: { name: "city.finance_officer" }, ...o });
  // The keeping post's own module, held by its producer: the change goes to the organisation's record.
  expect(recordChangeOf(unit(), carrying(), positions(post({})))).toEqual({ ...change, entity: "city" });
  // A post that does not keep the record (or says nothing of it): dropped.
  expect(recordChangeOf(unit(), carrying(), positions(post({ keeps_record: false })))).toBeUndefined();
  expect(recordChangeOf(unit(), carrying(), positions(post({ keeps_record: undefined })))).toBeUndefined();
  expect(recordChangeOf(unit(), carrying())).toBeUndefined();
  // Another module than the one the post names; a producer that no longer holds the post: dropped.
  expect(recordChangeOf(unit({ module: { name: "city.inspector" } }), carrying(), positions(post({})))).toBeUndefined();
  expect(recordChangeOf(unit(), carrying(), positions(post({ holder: "planning-system" })))).toBeUndefined();
  // A model seat, whatever is behind it, sets nothing for an organisation either.
  expect(recordChangeOf(unit({ llm: {} }), carrying(), positions(post({})))).toBeUndefined();
  // A module acting as itself names no organisation, even if it asks to: its change is its own person's.
  expect(recordChangeOf({ capacity: "self" }, Object.defineProperty({ type: "wait" }, RECORD, { value: { ...change, entity: "city" }, enumerable: false }))).toEqual(change);
});

test("the participant API has no way to an entity_record command", () => {
  // No schema a participant or a model meets names it, and the only place the orchestrator sends it is the one that
  // takes a change from a keeper's own output.
  for (const f of ["participant-api.schema.json", "calls.schema.json", "common.schema.json"]) {
    const path = join(root, "contracts", f);
    if (!readdirSync(join(root, "contracts")).includes(f)) continue;
    const text = readFileSync(path, "utf8");
    for (const word of ["entity_record", "record_keeper", "keeps_record"]) expect(text.includes(word)).toBe(false);
  }
  const resolver = join(root, "kernel/crates/resolver/src");
  for (const f of readdirSync(resolver)) expect(readFileSync(join(resolver, f), "utf8").includes("entity_record")).toBe(false);
  const sends = readdirSync(join(root, "orchestrator/src")).filter((f) => f.endsWith(".ts") && readFileSync(join(root, "orchestrator/src", f), "utf8").includes('command: "entity_record"'));
  expect(sends).toEqual(["run.ts"]);
  expect((readFileSync(join(root, "orchestrator/src/run.ts"), "utf8").match(/command: "entity_record"/g) ?? []).length).toBe(1);
});

test("an organisation's record is rebuilt from a log and checked like a person's, by the organisation or by the participant that kept it", async () => {
  const out = mkdtempSync(join(tmpdir(), "oikos-org-record-"));
  try {
    const log = join(out, "run.jsonl");
    const lines: string[] = [];
    let seq = 0, chain = "";
    const sections: { [k: string]: unknown } = {};
    for (const [t, set] of [[0, { books: { open: 3 } }], [DAY, { books: { open: 4 }, stance: { n: 1 } }]] as [number, { [k: string]: unknown }][]) {
      lines.push(JSON.stringify({ seq: ++seq, t, kind: "command", body: { command: "entity_record", participant: "finance-system", entity: "city", set } }));
      chain = linkOf(chain, t, set, null);
      Object.assign(sections, set);
      lines.push(JSON.stringify({ seq: ++seq, t, kind: "event", body: { event: "entity_recorded", cause: seq - 1, entity: "city", n: seq / 2, chain, digest: digestOf(sections), keeper: "city.finance_officer" } }));
    }
    writeFileSync(log, lines.join("\n") + "\n");
    for (const who of ["city", "finance-system"]) {
      const r = await rebuild(log, who);
      expect(r?.faults).toEqual([]);
      expect([r?.entity, r?.n, r?.keeper, r?.sections]).toEqual(["city", 2, "city.finance_officer", { books: { open: 4 }, stance: { n: 1 } }]);
    }
    // A log written before the keeper was named rebuilds as well.
    writeFileSync(log, lines.map((l) => l.replace(',"keeper":"city.finance_officer"', "")).join("\n") + "\n");
    const old = await rebuild(log, "city");
    expect([old?.faults, old?.keeper]).toEqual([[], undefined]);
    // A change tampered with is a fault.
    writeFileSync(log, lines.join("\n").replace('"open":4', '"open":5') + "\n");
    expect((await rebuild(log, "city"))?.faults.length).toBeGreaterThan(0);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
