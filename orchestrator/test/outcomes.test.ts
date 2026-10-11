// What a citizen came to know of how its choices turned out (docs/design/ai-citizens.md 7): recorded beside its
// decisions, joined to them, and never part of the world. The 1,000-person town ends in the same state whether or not
// outcomes are recorded; each outcome names a decision the citizen had already made, in facts and the mind's own
// figures; a resumed run records what the run was started to record; and the dataset has each decision with its
// outcomes under it, and the flat list.

import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadWorld, runOne } from "../src/batch";
import { exportDataset } from "../src/dataset";
import { logLines } from "../src/logs";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const NS = "urn:oikos:contracts:0.8";

const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
for (const f of readdirSync(join(root, "contracts")).filter((f) => f.endsWith(".schema.json"))) ajv.addSchema(JSON.parse(readFileSync(join(root, "contracts", f), "utf8")));
const valid = (def: string, row: unknown) => {
  const v = ajv.getSchema(`${NS}:dataset#/$defs/${def}`)!;
  const ok = v(row);
  if (!ok) console.error(def, JSON.stringify(v.errors).slice(0, 1000), JSON.stringify(row).slice(0, 600));
  return ok;
};
const rows = (path: string) => readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

/** A log's citizen records, in the order written: decisions and outcome entries. */
async function recorded(log: string): Promise<{ decisions: any[]; entries: any[] }> {
  const decisions: any[] = [], entries: any[] = [];
  for await (const line of logLines(log)) {
    if (!line.includes('"kind":"annotation"')) continue;
    if (line.includes('"annotation":"decision"')) decisions.push(JSON.parse(line));
    else if (line.includes('"annotation":"outcome"')) entries.push(JSON.parse(line));
  }
  return { decisions, entries };
}

const FIELDS = new Set(["t", "domain", "option", "of", "kind", "way", "from", "facts", "learned", "need", "felt", "belief"]);
const WAYS = new Set(["mine", "here", "published", "ask"]);
/** Every key anywhere in a value. */
const keysIn = (v: unknown, into = new Set<string>()): Set<string> => {
  if (Array.isArray(v)) for (const x of v) keysIn(x, into);
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { into.add(k); keysIn(x, into); }
  return into;
};

test("outcomes are observation only: the 1,000-person town, seed 1, 30 days, ends in the same state recorded or not; each outcome follows a decision the citizen had made, as it came to know it", async () => {
  const out = mkdtempSync(join(tmpdir(), "oikos-outcomes-"));
  try {
    const world = async () => ({ ...(await loadWorld(join(root, "worlds/town-1000.yaml"))).config, seed: 1 });
    const on = await runWorld({ config: await world(), runId: "on", outDir: out, until: 30 * DAY });
    const off = await runWorld({ config: await world(), runId: "off", outDir: out, until: 30 * DAY, recordDecisions: "none" });
    // The same world. (Main's, measured before this was built: 5be63866badc311a..., docs/decisions.md.)
    expect(off.stateHash).toBe(on.stateHash);
    expect(off.commands).toBe(on.commands);
    const quiet = await recorded(off.logPath);
    expect(quiet.decisions.length + quiet.entries.length).toBe(0);

    const { decisions, entries } = await recorded(on.logPath);
    expect(decisions.length).toBeGreaterThan(1_000);
    expect(entries.length).toBeGreaterThan(1_000);
    // Each citizen numbers its own decisions, from 1, one after another.
    const made = new Map<string, Map<number, any>>();
    for (const e of decisions) {
      const mine = made.get(e.body.subject) ?? new Map<number, any>();
      made.set(e.body.subject, mine);
      expect(e.body.data.n).toBe(mine.size + 1);
      mine.set(e.body.data.n, e);
    }
    const kinds = new Map<string, number>();
    const followed = new Set<string>();
    let learned = 0, told = 0;
    for (const e of entries) {
      expect(e.body.data.outcomes.length).toBeGreaterThan(0);
      for (const o of e.body.data.outcomes) {
        kinds.set(`${o.domain}:${o.kind}`, (kinds.get(`${o.domain}:${o.kind}`) ?? 0) + 1);
        // What it says: facts and the mind's own figures, in whole numbers; how the citizen came to know; and no more.
        for (const k of Object.keys(o)) expect(FIELDS.has(k)).toBe(true);
        expect(WAYS.has(o.way)).toBe(true);
        expect(typeof o.domain === "string" && typeof o.option === "string" && typeof o.kind === "string").toBe(true);
        for (const v of Object.values(o.facts ?? {})) expect(v === null || typeof v === "string" || typeof v === "boolean" || Number.isSafeInteger(v)).toBe(true);
        if (o.learned) {
          learned++;
          expect(Number.isSafeInteger(o.learned.payoff) && Number.isSafeInteger(o.learned.before) && Number.isSafeInteger(o.learned.after)).toBe(true);
        }
        // Nothing judges it: no score, no reward, no good or bad.
        for (const k of keysIn(o)) expect(/reward|score|good|bad|utility|success|fail/i.test(k)).toBe(false);
        // Known no later than it was written down, and nothing dated after the citizen knew it.
        expect(o.t).toBeLessThanOrEqual(e.t);
        for (const k of ["paid_at", "made_at"]) if (o.facts?.[k] !== undefined) expect(o.facts[k]).toBeLessThanOrEqual(o.t);
        if (o.kind === "told") {
          // Another's experience, as they told it: whose, and following no decision of ours.
          told++;
          expect(typeof o.from).toBe("string");
          expect(o.of).toBeUndefined();
        }
        if (o.of === undefined) continue;
        // The decision it follows: this citizen's own, made before, in the same area of life, and one that chose.
        const d = made.get(e.body.subject)?.get(o.of);
        expect(d).toBeDefined();
        expect(d.seq).toBeLessThan(e.seq);
        expect(d.body.data.t).toBeLessThanOrEqual(o.t);
        expect(d.body.data.domain).toBe(o.domain);
        expect(d.body.data.choice).toBeDefined();
        if (["shop", "job", "practice"].includes(o.domain)) expect(d.body.data.choice).toBe(o.option);
        followed.add(`${e.body.subject}#${o.of}`);
      }
    }
    expect(learned).toBeGreaterThan(1_000);
    expect(told).toBeGreaterThan(0);
    for (const k of ["shop:served", "job:paid", "practice:attended", "practice:stayed"]) expect(kinds.get(k) ?? 0).toBeGreaterThan(0);

    // The dataset: every decision with its outcomes under it (none: an empty list), the flat list, and the counts.
    const dir = join(out, "on.dataset");
    const m = await exportDataset(on.logPath, dir);
    expect(m.version).toBe("0.9.1");
    expect(valid("Manifest", m)).toBe(true);
    const ds = rows(join(dir, "citizen_decisions.jsonl"));
    const flat = rows(join(dir, "citizen_outcomes.jsonl"));
    expect(ds.length).toBe(decisions.length);
    expect(flat.length).toBe(entries.reduce((n, e) => n + e.body.data.outcomes.length, 0));
    expect(m.citizens.decisions).toBe(ds.length);
    expect(m.citizens.outcomes).toBe(flat.length);
    expect(m.files["citizen_outcomes.jsonl"].rows).toBe(flat.length);
    for (const d of ds.filter((_, i) => i % 7 === 0)) expect(valid("CitizenDecision", d)).toBe(true);
    for (const o of flat.filter((_, i) => i % 7 === 0)) expect(valid("CitizenOutcome", o)).toBe(true);
    expect(ds.every((d) => Array.isArray(d.outcomes))).toBe(true);
    const under = ds.reduce((n, d) => n + d.outcomes.length, 0);
    expect(under).toBe(flat.filter((o) => o.decision_seq !== undefined).length);
    expect(ds.filter((d) => d.outcomes.length > 0).length).toBe(followed.size);
    expect(Object.values<any>(m.citizens.by_domain).reduce((n, x) => n + x.with_outcome, 0)).toBe(followed.size);
    // Under a decision: in the order learned, each after the decision, each of the option chosen.
    for (const d of ds) for (const [i, o] of d.outcomes.entries()) {
      expect(o.t).toBeGreaterThanOrEqual(d.t);
      expect(o.seq).toBeGreaterThan(d.seq);
      if (i > 0) expect(o.seq).toBeGreaterThanOrEqual(d.outcomes[i - 1].seq);
    }
    // A flat row says which decision, and how long the citizen waited to know.
    const bySeq = new Map(ds.map((d) => [d.seq, d]));
    for (const o of flat) if (o.of !== undefined) {
      const d = bySeq.get(o.decision_seq)!;
      expect(d.participant).toBe(o.participant);
      expect(d.n).toBe(o.of);
      expect(o.decision_t).toBe(d.t);
    }
    // The same log, the same dataset.
    const again = join(out, "again.dataset");
    await exportDataset(on.logPath, again);
    for (const f of ["manifest.json", "citizen_decisions.jsonl", "citizen_outcomes.jsonl"]) expect(readFileSync(join(again, f), "utf8")).toBe(readFileSync(join(dir, f), "utf8"));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}, 1_800_000);

test("a resumed run records outcomes as the run was started to: on by default, none where it was asked for none; and a log from before outcomes still exports", async () => {
  const out = mkdtempSync(join(tmpdir(), "oikos-outcomes-resume-"));
  try {
    const world = join(root, "worlds/town.yaml");
    const outcomesOf = async (log: string) => (await recorded(log)).entries.map((e) => JSON.stringify(e.body));
    // Straight through, and stopped at day 10 then resumed to day 20 (as the pilot queue resumes a pilot): the same.
    const whole = await runOne({ world, seed: 1, out: join(out, "whole"), until: 20 * DAY });
    const cut = join(out, "cut");
    await runOne({ world, seed: 1, out: cut, until: 10 * DAY });
    const resumed = await runOne({ resume: join(cut, "town.seed1.jsonl"), until: 20 * DAY });
    expect(resumed.stateHash).toBe(whole.stateHash);
    const a = await outcomesOf(join(out, "whole", "town.seed1.jsonl"));
    const b = await outcomesOf(join(cut, "town.seed1.jsonl"));
    expect(a.length).toBeGreaterThan(100);
    expect(b).toEqual(a);
    // Asked for none: none after the resume either.
    const none = join(out, "none");
    await runOne({ world, seed: 1, out: none, until: 10 * DAY, recordDecisions: "none" });
    const quiet = await runOne({ resume: join(none, "town.seed1.jsonl"), until: 20 * DAY });
    expect(quiet.stateHash).toBe(whole.stateHash);
    const q = await recorded(join(none, "town.seed1.jsonl"));
    expect(q.decisions.length + q.entries.length).toBe(0);

    // A log made before outcomes were recorded (its decisions unnumbered, no outcome entries): it exports as it did,
    // its rows saying nothing of outcomes.
    const old = join(out, "old.jsonl");
    const lines: string[] = [];
    for await (const line of logLines(join(out, "whole", "town.seed1.jsonl"))) {
      if (line.includes('"annotation":"outcome"')) continue;
      if (!line.includes('"annotation":"decision"')) { lines.push(line); continue; }
      const e = JSON.parse(line);
      delete e.body.data.n;
      delete e.body.data.follows;
      lines.push(JSON.stringify(e));
    }
    await Bun.write(old, `${lines.join("\n")}\n`);
    const m = await exportDataset(old, join(out, "old.dataset"));
    expect(valid("Manifest", m)).toBe(true);
    expect(m.files["citizen_outcomes.jsonl"]).toBeUndefined();
    expect(m.citizens.outcomes).toBe(0);
    const ds = rows(join(out, "old.dataset", "citizen_decisions.jsonl"));
    expect(ds.length).toBeGreaterThan(0);
    expect(ds.some((d) => "outcomes" in d || "n" in d)).toBe(false);
    for (const d of ds) expect(valid("CitizenDecision", d)).toBe(true);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}, 900_000);
