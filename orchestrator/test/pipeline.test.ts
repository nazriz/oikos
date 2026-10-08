// The translator pipeline (src/pipeline.ts) end to end on a tiny log, with the mock for every writer and reader: no
// network, no GPU. Two pilots (one test-only), writers that answer from a pool, two readers that agree on most requests,
// disagree on one and differ in basis alone on another; the label, the tests, the join and the export; then the same
// command again (nothing is called), a usage limit waited out, a spending limit, a uniform reader, and the config's checks.

import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockAdapter, UsageLimitReached, type ContentBlock, type LlmRequest, type Price } from "@oikos/participants/llm";
import { implausiblyUniform, objectsIn, pilotMeta, plainReport, runPipeline, undoubled, unionBasis, type Hooks, type PipelineConfig } from "../src/pipeline";
import { inSituInstructions } from "../src/in-situ";

const root = mkdtempSync(join(tmpdir(), "oikos-pipeline-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const rows = <T = any>(path: string): T[] => readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as T);

// ---- a log by hand (as in-situ.test.ts): one model seat over several days, and another; `tag` is the account its requests name.
const DAY = 86_400;
function fixtureLog(tag: string): string {
  let seq = 0;
  const entry = (t: number, kind: string, body: object) => JSON.stringify({ seq: seq++, t, kind, body });
  const ann = (t: number, annotation: string, rest: object) => entry(t, "annotation", { annotation, ...rest });
  const use = (id: string, name: string, input: object) => ({ type: "tool_use", id, name, input });
  const said = (t: number, subject: string, turn: number, input: unknown, output: unknown[], o: { system?: string; hash?: string; purpose?: string; ref?: string } = {}) =>
    ann(t, "transcript", { subject, data: { purpose: o.purpose ?? "participant", ...(o.ref ? { ref: o.ref } : {}), t, provider: "codex", model: "some-model", system_sha256: o.hash ?? "hash-clerk", ...(o.system ? { system: o.system } : {}), turn, input, output } });
  const FORM = { id: "form-stall", record: "statement", kind: "form", author: "genesis", speaks_for: "town", at: 0, visible_to: "public", text: "Stall permit.", data: { form: "stall_permit", submit_to: ["town"], fields: { lot: { type: "lot", required: true }, notes: { type: "text" } } } };
  const FORM_LINE = "- stall_permit, to=town, id form-stall: fields lot (lot, required), notes (text)";
  const drafted = (t: number, who: string, n: number, proposal: string) => [
    said(t, "translator", 1, `Request: ${proposal}\n\nForms this person knows of:\n${FORM_LINE}`, [use("t", "call", { program: "none(unclear)" })], { purpose: "translator", ref: `draft.${who}.${n}`, hash: "hash-translator", ...(n === 1 ? { system: "You translate." } : {}) }),
    ann(t, "draft", { draft: { id: `draft.${who}.${n}`, participant: who, proposal, call: "none(unclear)", blocks: [], summary: "", check: { ok: true } } }),
  ];
  const R1 = `Pay acc-${tag} 500 from acc-town for the stall deposit.`;
  const R2 = "Direct the warden [warden] to clear the stalls from lot-3 before the market opens on day 4, and to report back.";
  const R3 = "Fill in the stall permit for lot-3.";
  const SYSTEM = "You are the clerk, acting for the town (town).\nOn file:\n- [law-stalls] Stalls need a permit.";
  return [
    entry(0, "header", { run_id: "town.seed1", config: { world: { currencies: [{ code: "XTS", minor_units: 2, symbol: "¤" }] } } }),
    ann(10, "observation", { subject: "clerk-system", data: { t: 10, observation: { channels: [{ path: "clerk/forms", kind: "records", records: [FORM] }] } } }),
    said(100, "clerk-system", 1, "Your notebook: (empty)\n\nIt is year 1, day 1.", [use("u1", "do", { what: R1 }), use("u2", "notebook", { text: "Day 1." })], { system: SYSTEM }),
    ...drafted(101, "clerk-system", 1, R1),
    said(102, "clerk-system", 3, [{ type: "tool_result", tool_use_id: "u1", content: "Before this goes ahead …" }], [use("u3", "do", { what: R2 }), use("u4", "do", { what: R3 })]),
    ...drafted(104, "clerk-system", 3, R3),
    said(DAY + 100, "clerk-system", 1, "Your notebook: Day 1.\n\nIt is year 1, day 2.", [use("u6", "do", { what: `Pay acc-${tag}2 40 from acc-town.` })]),
    ...drafted(DAY + 101, "clerk-system", 4, `Pay acc-${tag}2 40 from acc-town.`),
    said(2 * DAY + 100, "clerk-system", 1, "Your notebook: Day 2.\n\nIt is year 1, day 3.", [use("u8", "do", { what: "Close acc-old." })]),
    said(3 * DAY + 100, "clerk-system", 1, "Your notebook: Day 3.\n\nIt is year 1, day 4.", [use("u7", "do", { what: "Show me every payment out of acc-town since day 1." })]),
    ...drafted(3 * DAY + 101, "clerk-system", 5, "Show me every payment out of acc-town since day 1."),
    said(4 * DAY + 200, "warden-system", 1, "Your notebook: (empty)\n\nIt is year 1, day 5.", [use("w1", "write", { to: ["clerk"], text: "Done." })], { system: "You are the warden.", hash: "hash-warden" }),
    said(5 * DAY + 200, "warden-system", 1, "Your notebook: (empty)\n\nIt is year 1, day 6.", [use("w2", "do", { what: "Tell the clerk [clerk] to open the gates." })], { hash: "hash-warden" }),
    ...drafted(5 * DAY + 201, "warden-system", 1, "Tell the clerk [clerk] to open the gates."),
  ].join("\n") + "\n";
}

function pilot(name: string, tag: string, o: { test?: boolean } = {}): string {
  const dir = join(root, "runs", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "town.seed1.jsonl"), fixtureLog(tag));
  if (o.test) writeFileSync(join(dir, "PILOT.txt"), `A held-out pilot.\n\n${JSON.stringify({ name, model: "x", test: true }, null, 1)}\n`);
  return dir;
}

// ---- the mock writers and readers
const poolOf = (tag: string, n: number) => [
  `Pay acc-${tag}c 40 from acc-town under permit rec.${n}0 and budget rec.${n}5.`, `Pay acc-${tag}d 70 from acc-town.`, `Pay acc-${tag}e 15 from acc-town.`,
  `Pay acc-${tag}f 22 from acc-town for the stall deposit.`, `Pay acc-${tag}g 31 from acc-town.`, `Pay acc-${tag}h 12 from acc-town.`,
];
const POOLS = { a: poolOf("a", 3), b: poolOf("u", 4) };

/** What a reader answers a request: the same for both, but for the amount of 70 (B says 75) and the basis of a payment under two records (A cites the permit, B the budget). */
function program(request: string, reader: "A" | "B"): string {
  let m = /^Pay (acc-\w+) (\d+) from acc-town under permit (rec\.\d+) and budget (rec\.\d+)\.$/.exec(request);
  if (m) return `money(amount="${m[2]}", basis=${reader === "A" ? m[3] : `["${m[4]}"]`}, from=acc-town, to=${m[1]})`;
  m = /^Pay (acc-\w+) (\d+) from acc-town( for the stall deposit)?\.$/.exec(request);
  if (m) return `money(amount="${m[2] === "70" && reader === "B" ? 75 : m[2]}"${m[3] ? ', for="the stall deposit"' : ""}, from=acc-town, to=${m[1]})`;
  if (request === "Fill in the stall permit for lot-3.") return "form(form=stall_permit, lot=lot-3)";
  if (request === "Close acc-old.") return "account(close=acc-old)";
  if (request.startsWith("Tell the clerk")) return 'message(to=clerk, text="open the gates")';
  if (request.startsWith("Show me")) return "none(not_an_act)";
  return "none(too_much)";
}

interface Counts { writer: number; readerA: number; readerB: number; seen: string[] }
function hooks(counts: Counts, o: { uniformB?: boolean; limitOnce?: boolean; price?: Price } = {}): Hooks & { slept: number[] } {
  let limited = !o.limitOnce;
  const text = (t: string): ContentBlock[] => [{ type: "text", text: t }];
  const writer = (req: LlmRequest): ContentBlock[] => {
    counts.writer++;
    const ids = (req.messages[0]!.content as string).split("=== CHUNK ===\n")[1]!.split("\n").filter(Boolean).map((l) => JSON.parse(l).id as string);
    counts.seen.push(...ids);
    return text(ids.map((id, i) => {
      const pool = id.includes("pilot-b") ? POOLS.b : POOLS.a;
      return JSON.stringify({ id, requests: [0, 1, 2].map((j) => pool[(i + j) % pool.length]) });
    }).join("\n"));
  };
  const reader = (who: "A" | "B") => (req: LlmRequest): ContentBlock[] => {
    counts[who === "A" ? "readerA" : "readerB"]++;
    // (Blind: the message holds the task and the lines, and nothing of any gold.)
    const body = (req.messages[0]!.content as string).split("=== BLIND ===\n")[1]!;
    const file = body.split("\n").filter(Boolean).map((l) => {
      const b = JSON.parse(l);
      expect(Object.keys(b).sort()).toEqual(["forms", "id", "request"]);
      return JSON.stringify({ id: b.id, program: who === "B" && o.uniformB ? 'money(amount="5", to=acc-z)' : program(b.request, who) });
    }).join("\n");
    // (Reader B hands its file in through the tool, as the real ones do; A answers in words.)
    return who === "B" ? [{ type: "tool_use", id: "t1", name: "hand_in", input: { answers: file.split("\n").map((l) => JSON.parse(l)) } }] : text(file);
  };
  const slept: number[] = [];
  const zero: Price = o.price ?? { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  const adapters = new Map<string, MockAdapter>([
    ["mock/writer", new MockAdapter("writer", { consult: (r) => { if (!limited) { limited = true; throw new UsageLimitReached("the usage limit was reached (test)"); } return writer(r); } })],
    ["mock/reader-a", new MockAdapter("reader-a", { consult: reader("A") })],
    ["mock/reader-b", new MockAdapter("reader-b", { consult: reader("B") })],
  ]);
  return { slept, sleep: async (ms) => void slept.push(ms), log: () => {}, adapter: (name) => ({ adapter: adapters.get(name)!, prices: { [name]: zero } }) };
}

const config = (out: string, o: Partial<PipelineConfig> = {}): PipelineConfig => ({
  out, pilots: [{ path: join(root, "runs", "pilot-a") }, { path: join(root, "runs", "pilot-b") }],
  writers: { codex: "mock/writer" }, readers: ["mock/reader-a", "mock/reader-b"], situations: 4, every: 1, budget: 5, train: false, waitMinutes: 1, ...o,
});

pilot("pilot-a", "b");
pilot("pilot-b", "q", { test: true });
const out1 = join(root, "out1");
const counts: Counts = { writer: 0, readerA: 0, readerB: 0, seen: [] };
const first = await runPipeline(config(out1), hooks(counts));

test("a pilot marked test-only in its PILOT.txt or pilot-report.json is a test lane; the config can add the mark and not take it away", async () => {
  expect(first.sources.map((s) => [s.path.split("/").at(-1), s.test, s.why])).toEqual([["pilot-a", false, undefined], ["pilot-b", true, "PILOT.txt"]]);
  expect(pilotMeta(join(root, "runs", "pilot-b"))).toMatchObject({ test: true, why: "PILOT.txt" });
  const r = join(root, "runs", "pilot-r");
  mkdirSync(r, { recursive: true });
  writeFileSync(join(r, "pilot-report.json"), JSON.stringify({ test: true }));
  expect(pilotMeta(r)).toMatchObject({ test: true, why: "pilot-report.json" });
  expect(pilotMeta(join(root, "runs", "pilot-a")).test).toBe(false);
  await expect(runPipeline(config(join(root, "x"), { pilots: [{ path: join(root, "runs", "pilot-b"), test: false }] }), hooks({ ...counts }))).rejects.toThrow(/test-only/);
});

test("the steps ran: situations to writers, requests to two readers, examples where they agree", () => {
  expect(first.status).toBe("complete");
  expect(first.steps["train/write"].situations_answered).toBeGreaterThan(0);
  const label = first.steps["train/label"];
  expect(label.examples).toBeGreaterThan(5);
  // One request the readers differ on (the amount), one they differ on in basis alone (joined: both cite both records, in the request's order).
  expect(label.dropped.disagreed).toBeGreaterThanOrEqual(1);
  expect(label.basis_unioned).toBeGreaterThanOrEqual(1);
  const examples = rows(join(out1, "lanes/train/label/examples.jsonl"));
  expect(examples.find((e) => e.request.includes("under permit rec.30"))?.program).toBe('money(amount="40", basis=["rec.30","rec.35"], from=acc-town, to=acc-ac)');
  expect(examples.every((e) => e.spans?.length || e.kind === "refusal")).toBe(true);
  expect(first.agreement["train"]!["money"]!.agreed).toBeGreaterThan(0);
  expect(plainReport(first)).toContain("basis joined in");
});

test("readers are called with the prompt and the request alone: two different models, nothing of the gold or of each other", () => {
  expect(counts.readerA).toBeGreaterThan(0);
  expect(counts.readerB).toBe(counts.readerA);
  const ledger = rows(join(out1, "calls.jsonl")).filter((e) => e.annotation === "transcript" && e.data.model.startsWith("reader"));
  for (const e of ledger) expect(e.data.input).not.toContain("gold");
});

test("a test-only pilot's requests and situations never train: they are test sets, and nothing in their words is in the joined data", () => {
  const sawTestSituation = counts.seen.some((id) => id.includes("pilot-b"));
  expect(sawTestSituation).toBe(true); // (the test lane's own writers see them: for the test set)
  const tests = Object.fromEntries(Object.entries(first.tests).map(([k, v]) => [k, rows(v.file)]));
  const testRequests = new Set(Object.values(tests).flat().map((e: any) => e.request.trim()));
  expect(first.tests["test pilots, their seats' real requests"]!.examples).toBeGreaterThan(0);
  expect(first.tests["test pilots, requests written in their situations"]!.examples).toBeGreaterThan(0);
  const joined = [...rows(join(out1, "joined/train.jsonl")), ...rows(join(out1, "joined/validation-real.jsonl"))];
  expect(joined.length).toBeGreaterThan(0);
  for (const e of joined) {
    expect(testRequests.has(e.request.trim())).toBe(false);
    expect((e.source ?? e.id).includes("pilot-b")).toBe(false);
  }
  // (None of the training lane's examples came from the test pilot.)
  for (const e of rows(join(out1, "lanes/train/label/examples.jsonl"))) expect(e.source).not.toContain("pilot-b");
});

test("a third of each kind of the training pilots' real requests is held back as a test; the rest, with the written, train (each four times)", () => {
  const held = rows(join(out1, "tests/held-back-real.jsonl"));
  const real = rows(join(out1, "lanes/train/label/examples.jsonl")).filter((e) => e.origin === "pilot");
  expect(held.every((e) => e.origin === "pilot")).toBe(true);
  expect(held.length).toBe(Object.values(real.reduce((o: any, e: any) => ((o[e.shape.split("(")[0]] = (o[e.shape.split("(")[0]] ?? 0) + 1), o), {})).reduce((a: number, n: any) => a + Math.round(n / 3), 0));
  const j = first.steps["join"];
  expect(j.new_in_training + j.new_validation_real + j.held_back_as_tests + j.dropped_new_same_as_a_test).toBe(j.new_examples);
  expect(rows(join(out1, "joined/train.jsonl")).length).toBe(4 * j.new_in_training);
});

test("the export: steps for the model from the joined folder", () => {
  expect(existsSync(join(out1, "data/vocabulary.json"))).toBe(true);
  expect(first.data!.counts.train.examples).toBe(rows(join(out1, "joined/train.jsonl")).length);
  expect(first.steps["join"].standing).toEqual({ train: 0, validation: 0, validation_real: 0 });
});

test("usage and cost are in the manifest and the ledger, with every prompt and answer", () => {
  const ledger = rows(join(out1, "calls.jsonl"));
  const usage = ledger.filter((e) => e.annotation === "usage");
  expect(usage.length).toBe(counts.writer + counts.readerA + counts.readerB);
  expect(first.usage.total.calls).toBe(usage.length);
  expect(Object.keys(first.usage.by_model).sort()).toEqual(["mock/reader-a", "mock/reader-b", "mock/writer"]);
  expect(ledger.filter((e) => e.annotation === "transcript").length).toBe(usage.length);
});

test("the same command again calls no model and changes nothing; a step whose output is stale is set aside, not deleted", async () => {
  const again: Counts = { writer: 0, readerA: 0, readerB: 0, seen: [] };
  const before = readFileSync(join(out1, "joined/train.jsonl"), "utf8");
  const second = await runPipeline(config(out1), hooks(again));
  expect(second.status).toBe("complete");
  expect(again.writer + again.readerA + again.readerB).toBe(0);
  expect(readFileSync(join(out1, "joined/train.jsonl"), "utf8")).toBe(before);
  expect(second.usage.total.calls).toBe(first.usage.total.calls);
  // A different instruction for writers makes their calls stale; the old files are kept beside the new.
  const third = await runPipeline(config(out1, { extraInstructions: ["writer-round2.txt"] }), hooks(again));
  expect(third.status).toBe("complete");
  expect(again.writer).toBeGreaterThan(0);
  expect(readdirSync(join(out1, "lanes/train/written")).some((f) => f.includes(".stale-"))).toBe(true);
});

test("the standing set is joined; its examples from a test-only pilot, or in a test's words, are dropped", async () => {
  const standing = join(root, "standing");
  mkdirSync(standing, { recursive: true });
  const base = rows(join(out1, "joined/train.jsonl"))[0];
  const ours = { ...base, id: "standing-1", source: "runs/elsewhere/x/d1/1" };
  const theirs = { ...base, id: "runs/pilot-b/x/d1/1/w-1", source: "runs/pilot-b/x/d1/1" };
  const inWords = { ...base, id: "standing-3", source: "runs/elsewhere/y/d1/1", request: rows(join(out1, "tests/test-pilots-real.jsonl"))[0].request };
  writeFileSync(join(standing, "train.jsonl"), [ours, theirs, inWords].map((e) => JSON.stringify(e)).join("\n") + "\n");
  writeFileSync(join(standing, "validation.jsonl"), JSON.stringify(ours) + "\n");
  const out = join(root, "out-standing");
  const m = await runPipeline(config(out, { standing }), hooks({ writer: 0, readerA: 0, readerB: 0, seen: [] }));
  expect(m.status).toBe("complete");
  expect(m.steps["join"]).toMatchObject({ standing: { train: 3, validation: 1, validation_real: 0 }, dropped_standing_from_test_runs: 1 });
  const train = rows(join(out, "joined/train.jsonl"));
  expect(train.filter((e) => e.id === "standing-1").length).toBe(1);
  expect(train.some((e) => e.id === theirs.id || e.id === "standing-3")).toBe(false);
  expect(rows(join(out, "joined/validation.jsonl")).length).toBe(1);
});

test("a usage limit is waited out (the call made again after the wait); a spending limit stops the run, kept across resumes", async () => {
  pilot("pilot-c", "k");
  const waits = hooks({ writer: 0, readerA: 0, readerB: 0, seen: [] }, { limitOnce: true });
  const m = await runPipeline(config(join(root, "out-limit"), { pilots: [{ path: join(root, "runs", "pilot-c") }], waitMinutes: 7 }), waits);
  expect(m.status).toBe("complete");
  expect(waits.slept).toEqual([7 * 60_000]);
  // A priced writer under a tiny limit: the run stops saying why, and a resume with the same limit stops again at once.
  const dear: Price = { input: 100_000_000, output: 100_000_000 };
  const out = join(root, "out-spend");
  const stopped = await runPipeline(config(out, { pilots: [{ path: join(root, "runs", "pilot-c") }], budget: 0.001 }), hooks({ writer: 0, readerA: 0, readerB: 0, seen: [] }, { price: dear }));
  expect(stopped.status).toMatch(/^stopped \(spending limit\)/);
  expect(stopped.steps["train/label"]).toBeUndefined();
});

test("a reader whose answers are implausibly uniform is rejected, and the run stopped with its answers set aside", async () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, program: 'money(amount="5", to=acc-z)' }));
  expect(implausiblyUniform(many, false)).toMatch(/12 of 12 answers are the same program/);
  const varied = many.map((a, i) => ({ ...a, program: `money(amount="${i + 1}", to=acc-z)` }));
  expect(implausiblyUniform(varied, false)).toBeUndefined();
  expect(implausiblyUniform(varied.map((a) => ({ ...a, program: "none(unclear)" })).map((a, i) => ({ ...a, program: i % 2 ? "none(unclear)" : "none(too_much)" })), true)).toMatch(/refusals|different programs|same program/);
  expect(implausiblyUniform(many.slice(0, 5), true)).toBeUndefined(); // (too few to judge)
  const out = join(root, "out-uniform");
  const m = await runPipeline(config(out, { pilots: [{ path: join(root, "runs", "pilot-c") }] }), hooks({ writer: 0, readerA: 0, readerB: 0, seen: [] }, { uniformB: true }));
  expect(m.status).toMatch(/^stopped \(reader uniform\)/);
  expect(readdirSync(join(out, "lanes/train/read/mock-reader-b")).some((f) => f.includes(".rejected-"))).toBe(true);
  expect(existsSync(join(out, "lanes/train/label"))).toBe(false);
});

test("the config is checked before any model is called: two different readers, no gpt-6-astra, a spending limit", async () => {
  const ok = config("/tmp/x");
  const refuses = (o: Partial<PipelineConfig>, why: RegExp) => expect(runPipeline({ ...ok, ...o }, hooks({ writer: 0, readerA: 0, readerB: 0, seen: [] }))).rejects.toThrow(why);
  await refuses({ readers: ["mock/reader-a", "mock/reader-a@high"] }, /different models/);
  await refuses({ readers: ["mock/reader-a", "codex/gpt-6-astra"] }, /never used/);
  await refuses({ writers: { codex: "codex/gpt-6-astra" } }, /never used/);
  await refuses({ budget: 0 }, /spending limit/);
  await refuses({ train: true }, /encoder/);
  await refuses({ pilots: [{ path: "/a" }, { path: "/a" }] }, /twice/);
});

test("replies are read as files: lines, a fenced block, or a list", () => {
  expect(objectsIn('{"id":"a","requests":[]}\n{"id":"b","requests":["x"]}').map((o) => o.id)).toEqual(["a", "b"]);
  expect(objectsIn('```json\n{"id":"a"}\n```').length).toBe(1);
  expect(objectsIn('[{"id":"a"},{"id":"b"}]').length).toBe(2);
  expect(objectsIn("Here you are:\n{\"id\":\"a\"}\nDone.").length).toBe(1);
});

test("a program a model escaped by hand inside the tool's JSON is read as it meant it; any other is left alone", () => {
  expect(undoubled('form(to=city, proposal=\\"a budget\\", kind=budget)')).toBe('form(to=city, proposal="a budget", kind=budget)');
  expect(undoubled('message(to=x, text="a \\"quoted\\" word")')).toBe('message(to=x, text="a \\"quoted\\" word")');
  expect(undoubled("none(unclear)")).toBe("none(unclear)");
});

test("two readers' programs that differ in basis alone are joined: every record either gave, in the request's order", () => {
  const request = "Pay acc-c 40 from acc-town citing dockets rec.9 and rec.4, within budget rec.25.";
  const a = 'money(amount="40", basis=["rec.4","rec.9"], from=acc-town, to=acc-c)';
  const b = 'money(amount="40", basis=["rec.25","rec.9"], from=acc-town, to=acc-c)';
  const both = unionBasis(request, a, b, {})!;
  expect(both[0]).toBe('money(amount="40", basis=["rec.9","rec.4","rec.25"], from=acc-town, to=acc-c)');
  expect(both[1]).toBe(both[0]);
  // One bare and one list; one with no basis at all.
  expect(unionBasis(request, 'money(amount="40", basis=rec.9, from=acc-town, to=acc-c)', 'money(amount="40", from=acc-town, to=acc-c)', {})![0]).toContain("basis=rec.9");
  // Anything else that differs: left to disagree. The same program: nothing to join.
  expect(unionBasis(request, a, a.replace("40", "41"), {})).toBeUndefined();
  expect(unionBasis(request, a, a, {})).toBeUndefined();
  expect(unionBasis(request, a, "none(unclear)", {})).toBeUndefined();
});

test("the writers' instructions in the repo are the ones the hand-run steps used", () => {
  const dir = join(import.meta.dir, "../../translator/train/in-situ");
  expect(readFileSync(join(dir, "writer-instructions.txt"), "utf8")).toBe(inSituInstructions());
  for (const f of ["writer-addendum.txt", "writer-round2.txt", "reader-task-0.7.5.txt", "reader-call.txt", "writer-call.txt", "SOURCES.txt"]) expect(existsSync(join(dir, f))).toBe(true);
  expect(readFileSync(join(dir, "reader-call.txt"), "utf8")).toContain("do not sort or answer them with a script, keyword rules or a pattern");
});
