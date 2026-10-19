// The model reader (docs/design/ai-citizens.md 13b, 13e; participants/src/llm/reader-model.ts), against a stub process
// standing in for `claude -p`: no model is called. The prompt is an analyst's, in two wordings; the reader may decline;
// every call is recorded whole as training data; and a reader of our own can stand in its place behind the same interface.

import { expect, test } from "bun:test";
import { ClaudeCodeAdapter, type ClaudeCodeRunner } from "../src/llm/claude-code";
import { LINES } from "../src/shared/reading";
import { modelReader, readerSchema, readerSystem, readerUser, READING_PROMPT_VERSION, type ReadingRecord } from "../src/llm/reader-model";
import type { ReadRequest, Reader } from "../src/llm/reader";

const GOOD = { declined: false, respect: 1, reason: 2, answers: 1, recourse: 2, threat: 0, openness: 0, conservation: 1, enhancement: 0, transcendence: 0,
  phrase_respect: "I have read what you wrote", phrase_reason: "the law asks for 26 weeks", phrase_answers: "", phrase_recourse: "bring your pay slips", phrase_threat: "", phrase_openness: "", phrase_conservation: "as our parents did", phrase_enhancement: "", phrase_transcendence: "" };
const PAPER = "I have read what you wrote. The law asks for 26 weeks. Bring your pay slips to the counter within 28 days, as our parents did.";
const req = (o: Partial<ReadRequest> = {}): ReadRequest => ({ kind: "a decision on a claim: refused", standing: "addressee", paper: PAPER, answers: "I lost my job on [DAY-1].", wording: 1, ...o });

/** A stub `claude -p`: records the args and stdin it was run with, and answers as Claude Code does for a schema. */
function stub(obj: unknown, extra: Record<string, unknown> = {}) {
  const seen: { args: string[]; stdin: string; system: string }[] = [];
  const run: ClaudeCodeRunner = async (args, stdin) => {
    const sys = args[args.indexOf("--system-prompt-file") + 1]!;
    seen.push({ args, stdin, system: await Bun.file(sys).text() });
    return { code: 0, stdout: JSON.stringify({ type: "result", is_error: false, structured_output: obj, usage: { input_tokens: 700, output_tokens: 120, cache_read_input_tokens: 50 }, total_cost_usd: 0.0123, ...extra }), stderr: "" };
  };
  return { run, seen };
}

test("the reader is an analyst: third person, never a person, never deciding, free to decline, told what it is doing", () => {
  for (const w of [1, 2] as const) {
    const s = readerSystem(w);
    expect(s).toMatch(/simulated town/);
    expect(s).toMatch(/third person/);
    expect(s).toMatch(/decline/);
    expect(s).toMatch(/decide nothing|make no decision/);
    expect(s).toMatch(/never speak in anyone's voice|do not play anyone/);
    for (const l of LINES) expect(s, l).toContain(l);
    expect(s).not.toMatch(/you are (a|the) (citizen|person|tenant|resident)/i);
  }
});

test("two wordings: every sentence reworded and the lines in reverse order", () => {
  const a = readerSystem(1), b = readerSystem(2);
  expect(a).not.toBe(b);
  const order = (s: string) => LINES.map((l) => s.indexOf(`\n${l} (`)).map((i, k) => ({ l: LINES[k]!, i }));
  const first = order(a).sort((x, y) => x.i - y.i).map((x) => x.l), second = order(b).sort((x, y) => x.i - y.i).map((x) => x.l);
  expect(second).toEqual([...first].reverse());
  // No sentence of the first wording is copied whole into the second.
  const sentences = (s: string) => s.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter((x) => x.length > 40);
  const bs = new Set(sentences(b));
  expect(sentences(a).filter((x) => bs.has(x))).toEqual([]);
  expect(Object.keys((readerSchema(1) as any).properties)).not.toEqual(Object.keys((readerSchema(2) as any).properties));
});

test("what it is shown: the paper, what it answers, the standing, and nothing of any person", () => {
  const u = readerUser(req());
  expect(u).toContain(PAPER);
  expect(u).toContain("I lost my job on [DAY-1].");
  expect(u).toMatch(/addressed to the person/);
  expect(readerUser(req({ answers: undefined }))).toMatch(/answers no matter/);
  expect(readerUser(req({ standing: "public", wording: 2 }))).toMatch(/published|put up/);
  expect(u).not.toMatch(/trust|agency|values|record|wants/i);
});

test("a stub claude -p: the reading is typed, phrases kept, the call is Haiku's with no tools, cost and tokens come back, and the call is recorded whole", async () => {
  const s = stub(GOOD);
  const records: ReadingRecord[] = [];
  const reader = modelReader(new ClaudeCodeAdapter("claude-haiku-5-5", s.run, { attempts: 1 }), { record: (r) => void records.push(r), ref: "gate/test" });
  expect(reader.model).toBe("claude-code/claude-haiku-5-5");
  expect(reader.version).toBe(READING_PROMPT_VERSION);
  const out = await reader.read(req());
  expect(out.reading).toEqual({ respect: 1, reason: 2, answers: 1, recourse: 2, threat: 0, appeals: { openness: 0, conservation: 1, enhancement: 0, transcendence: 0 } });
  expect(out.phrases).toEqual({ respect: "I have read what you wrote", reason: "the law asks for 26 weeks", recourse: "bring your pay slips", conservation: "as our parents did" });
  expect(out.cost_microusd).toBe(12_300);
  expect(out.input_tokens).toBe(750);
  expect(out.output_tokens).toBe(120);
  const a = s.seen[0]!;
  expect(a.args[a.args.indexOf("--model") + 1]).toBe("claude-haiku-5-5");
  expect(a.args[a.args.indexOf("--tools") + 1]).toBe("");
  expect(a.args).toContain("--json-schema");
  expect(a.system).toBe(readerSystem(1) + "\n\n=== How you answer ===\nGive your answer in the structured output asked for, and nothing besides.");
  expect(a.stdin).toContain(PAPER);
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ reader: "claude-code/claude-haiku-5-5", prompt_version: READING_PROMPT_VERSION, wording: 1, kind: "a decision on a claim: refused", standing: "addressee", paper: PAPER, answers: "I lost my job on [DAY-1].", result: "read", ref: "gate/test", cost_microusd: 12_300 });
  expect(records[0]!.reading).toEqual(out.reading);
});

test("the second wording is asked with the second prompt", async () => {
  const s = stub(GOOD);
  const reader = modelReader(new ClaudeCodeAdapter("claude-haiku-5-5", s.run, { attempts: 1 }));
  await reader.read(req({ wording: 2 }));
  expect(s.seen[0]!.system.startsWith(readerSystem(2))).toBe(true);
});

test("a decline is a decline: no reading, counted by whoever asked, recorded", async () => {
  const records: ReadingRecord[] = [];
  const reader = modelReader(new ClaudeCodeAdapter("claude-haiku-5-5", stub({ ...GOOD, declined: true }).run, { attempts: 1 }), { record: (r) => void records.push(r) });
  const out = await reader.read(req());
  expect(out.declined).toBe(true);
  expect(out.reading).toBeUndefined();
  expect(records[0]!.result).toBe("declined");
});

test("an answer that is out of range, or not an object, is unread and recorded, never made into a reading", async () => {
  for (const bad of [{ ...GOOD, respect: 5 }, { ...GOOD, reason: 1.5 }, { ...GOOD, threat: undefined }]) {
    const records: ReadingRecord[] = [];
    const out = await modelReader(new ClaudeCodeAdapter("claude-haiku-5-5", stub(bad).run, { attempts: 1 }), { record: (r) => void records.push(r) }).read(req());
    expect(out.reading).toBeUndefined();
    expect(out.declined).toBeUndefined();
    expect(records[0]!.result).toBe("unread");
    expect(records[0]!.raw).toBeDefined();
  }
});

test("where the paper answers nothing, answers is null whatever the model says", async () => {
  const out = await modelReader(new ClaudeCodeAdapter("claude-haiku-5-5", stub({ ...GOOD, answers: 2 }).run, { attempts: 1 })).read(req({ answers: undefined }));
  expect(out.reading!.answers).toBeNull();
});

test("a call that fails is recorded and raised, for the caller to count", async () => {
  const records: ReadingRecord[] = [];
  const run: ClaudeCodeRunner = async () => ({ code: 1, stdout: "", stderr: "boom" });
  const reader = modelReader(new ClaudeCodeAdapter("claude-haiku-5-5", run, { attempts: 1 }), { record: (r) => void records.push(r) });
  await expect(reader.read(req())).rejects.toThrow();
  expect(records[0]!.result).toBe("failed");
});

test("a budget guard stops the reader before the call, not after", async () => {
  const s = stub(GOOD);
  const reader = modelReader(new ClaudeCodeAdapter("claude-haiku-5-5", s.run, { attempts: 1 }), { beforeCall: () => { throw new Error("over budget"); } });
  await expect(reader.read(req())).rejects.toThrow("over budget");
  expect(s.seen).toHaveLength(0);
});

test("the model reader is a Reader like any other: a reader of our own replaces it with nothing else changed", async () => {
  const ours: Reader = { model: "oikos/reader-0", version: "0", read: async () => ({ declined: true }) };
  const readers: Reader[] = [ours, modelReader(new ClaudeCodeAdapter("claude-haiku-5-5", stub(GOOD).run, { attempts: 1 }))];
  for (const r of readers) expect(typeof (await r.read(req()))).toBe("object");
});
