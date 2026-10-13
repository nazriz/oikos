// The reading gate's harness (docs/design/ai-citizens.md 13f; participants/src/llm/reading-gate.ts): the hand-made pairs
// are as the spec says; the thresholds are the spec's and fixed; the passing mock passes every check that can be run
// without a run; and each mock with one thing wrong fails the check about that thing. No model is called.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NEUTRAL } from "../src/behaviour/reading";
import { BROKEN, familyBiased, lexiconReader } from "../src/llm/reader-mock";
import { curtestReader, kindestReader } from "../src/llm/reader";
import { canonTags, filled, GATE_TAG_WORLD, padded, politely, runGate, THRESHOLDS, weightedKappa, type Pair } from "../src/llm/reading-gate";
import { Tagger } from "../src/llm/reading-tags";
import { mockReader } from "../../scripts/reading-gate";

const FILE = JSON.parse(readFileSync(join(import.meta.dir, "../eval/reading-pairs.json"), "utf8")) as { pairs: Pair[] };
const pairs = FILE.pairs;

test("the thresholds are the spec's, written before any reader was asked, and frozen", () => {
  expect(THRESHOLDS).toEqual({
    repeat: { same: 0.8, within_step: 0.97 },
    pairs: { right: 0.9, others_within_step: 0.85, line_right: 0.9 },
    length: { same: 0.85, mean_abs_step: 0.25 },
    politeness: { unmoved: 0.9, respect_ok: 0.8, respect_up_at_most: 1 },
    names_and_sums: { identical: 1 },
    rewording: { within_step: 0.95, same: 0.7 },
    two_readers: { same: 0.6, within_step: 0.92, kappa: 0.6, both_right_pairs: 0.85 },
    author_family: { bias_steps: 0.25 },
    phrases: { found: 0.95 },
    readable: { unread_at_most: 0.05 },
    cost: { gate_usd: 20, per_call_usd: 0.02 },
  });
  expect(Object.isFrozen(THRESHOLDS)).toBe(true);
  expect(Object.isFrozen(THRESHOLDS.pairs)).toBe(true);
  expect(() => { (THRESHOLDS.pairs as any).right = 0.5; }).toThrow();
});

test("forty pairs, in the kinds and numbers the spec gives, each the same decision in two wordings with the lines it parts on written beside it", () => {
  expect(pairs).toHaveLength(40);
  const by = (k: string) => pairs.filter((p) => p.kind === k);
  expect([by("refusal").length, by("grant").length, by("order").length, by("public").length, by("founder").length]).toEqual([12, 6, 8, 8, 6]);
  expect(new Set(pairs.map((p) => p.id)).size).toBe(40);
  for (const p of pairs) {
    expect(p.a.text.length, p.id).toBeGreaterThan(20);
    expect(p.a.text, p.id).not.toBe(p.b.text);
    expect(Object.keys(p.parts_on).length, p.id).toBeGreaterThan(0);
    // Written in world terms: names, sums and days are tags; no place, no currency sign, no person.
    for (const t of [p.a.text, p.b.text]) {
      expect(t, p.id).not.toMatch(/[$£€¥]|\b(?:19|20)\d\d\b|\bMr\b|\bMrs\b/);
      expect(t.replace(/\[(?:DAY|SUM|ID|PERSON)-\d+\]/g, ""), p.id).not.toMatch(/§|\d{4}|\[|\]/);
    }
  }
  // Refusals and grants and orders part on respect, reason, answers, recourse as the spec says; founders on the appeals only.
  for (const p of by("founder")) expect(Object.keys(p.parts_on).sort(), p.id).toEqual(["conservation", "enhancement", "openness", "transcendence"]);
  for (const p of by("grant")) expect(Object.keys(p.parts_on), p.id).toEqual(["respect"]);
  for (const p of by("order")) expect(Object.keys(p.parts_on).sort(), p.id).toEqual(["answers", "reason", "recourse"]);
  for (const p of [...by("refusal")]) for (const l of ["respect", "reason", "answers"]) expect(Object.keys(p.parts_on), p.id).toContain(l);
  // The five examples of 13f are among them, verbatim.
  const text = pairs.flatMap((p) => [p.a.text, p.b.text]).join("\n");
  for (const must of ["Claim refused. You do not qualify. This office will not answer further letters on the matter.", "No. The notice stands. Be out by [DAY-1] or it goes to the tribunal.", "Possession ordered. [DAY-1].", "The petition has been received and noted.", "We lost our jobs at the mill and we are not waiting to be rescued."]) expect(text).toContain(must);
});

test("the controls are made by code: padded to twice the length with neutral procedure; politeness and nothing else; names and sums swapped", () => {
  const t = pairs[0]!.b.text;
  expect(padded(t).split(/\s+/).length).toBeGreaterThanOrEqual(2 * t.split(/\s+/).length);
  expect(padded(t).startsWith(t)).toBe(true);
  expect(politely(t)).toContain(t);
  expect(politely(t)).toMatch(/^Thank you for your message\./);
  const tagged = "[PERSON-2] owes [SUM-3] since [DAY-1] under [ID-2]; [PERSON-1] disagrees about [SUM-1].";
  const a = new Tagger(GATE_TAG_WORLD).tag(filled(tagged, 0)), b = new Tagger(GATE_TAG_WORLD).tag(filled(tagged, 1));
  expect(a).toBe(b);
  expect(a).toBe(canonTags(tagged));
  expect(canonTags(tagged)).toBe("[PERSON-1] owes [SUM-1] since [DAY-1] under [ID-1]; [PERSON-2] disagrees about [SUM-2].");
});

test("weighted kappa: perfect agreement is 1, a flipped scale is negative, a constant agreed is 1", () => {
  expect(weightedKappa([0, 1, 2, 1, 0, 2], [0, 1, 2, 1, 0, 2])).toBe(1);
  expect(weightedKappa([0, 1, 2, 0, 1, 2], [2, 1, 0, 2, 1, 0])).toBeLessThan(0);
  expect(weightedKappa([1, 1, 1], [1, 1, 1])).toBe(1);
  expect(weightedKappa([0, 1, 2, 1], [0, 1, 1, 1])).toBeGreaterThan(0.5);
});

test("the lexicon mock passes every check that can be run without a run; the others are listed as pending, never counted", async () => {
  const r = await runGate({ reader: lexiconReader(), second: lexiconReader(), pairs });
  expect(r.checks.filter((c) => c.status === "fail"), JSON.stringify(r.checks.filter((c) => c.status === "fail"))).toEqual([]);
  expect(r.passed).toBe(true);
  expect(r.checks.filter((c) => c.status === "pending").map((c) => c.id)).toEqual(["author_family", "code_town", "extreme"]);
  expect(r.lines_off).toEqual([]);
  expect(r.stops).toBe(false);
  // 480 calls to the reader (the spec says about 440) and 160 to the second, which is asked about each paper twice only; a mock's cost is a mock's.
  expect(r.calls).toBe(640);
  expect(r.cost_usd).toBeLessThan(THRESHOLDS.cost.gate_usd);
  // The author's-family check, given papers by seats of two families and a reader that lifts its own family's.
  const papers = [...pairs.slice(0, 12).map((p) => ({ family: "a", kind: p.form, standing: p.standing, paper: p.a.text, answers: p.answers })), ...pairs.slice(12, 24).map((p) => ({ family: "b", kind: p.form, standing: p.standing, paper: p.b.text, answers: p.answers }))];
  const fair = await runGate({ reader: lexiconReader(), second: lexiconReader(), pairs, family: papers });
  expect(fair.checks.find((c) => c.id === "author_family")!.status).toBe("pass");
  const ownTexts = new Set(papers.filter((x) => x.family === "a").map((x) => x.paper));
  const biased = await runGate({ reader: familyBiased((paper) => ownTexts.has(paper)), second: lexiconReader(), pairs, family: papers });
  expect(biased.checks.find((c) => c.id === "author_family")!.status).toBe("fail");
});

/** What each mock with one thing wrong must fail. Pinned in full, so that a change to a mock or a check is seen; the first is the check about the thing. */
const FAILS: { [mock: string]: { names: string; first: string; all: string[] } } = {
  lengthy: { names: "reads a longer paper as giving more reasons", first: "length", all: ["length"] },
  pleasantries: { names: "counts pleasantries", first: "politeness", all: ["politeness"] },
  disagreeing: { names: "a second reader that disagrees", first: "two_readers", all: ["two_readers"] },
  costly: { names: "costs too much a call", first: "cost", all: ["cost"] },
  noisy: { names: "reads the same paper differently each time", first: "repeat", all: ["repeat", "pairs", "length", "politeness", "two_readers"] },
  wording: { names: "reads the prompt's second wording differently", first: "rewording", all: ["pairs", "politeness", "rewording", "two_readers"] },
  flat: { names: "tells nothing apart", first: "pairs", all: ["pairs", "politeness", "two_readers"] },
  misquoting: { names: "quotes what is not there", first: "phrases", all: ["repeat", "pairs", "length", "politeness", "rewording", "two_readers", "phrases", "readable"] },
  garbled: { names: "answers out of range", first: "readable", all: ["repeat", "pairs", "length", "politeness", "rewording", "two_readers", "readable"] },
};

test("each mock with one thing wrong fails the check about that thing (and the checks that thing must also break)", async () => {
  for (const [name, want] of Object.entries(FAILS)) {
    const r = await runGate(name === "disagreeing" ? { reader: lexiconReader(), second: BROKEN.disagreeing!(), pairs } : { reader: BROKEN[name]!(), second: lexiconReader(), pairs });
    const failed = r.checks.filter((c) => c.status === "fail").map((c) => c.id);
    expect(failed, name).toContain(want.first);
    expect(failed.sort(), `${name} (${want.names})`).toEqual([...want.all].sort());
    expect(r.passed, name).toBe(false);
  }
  // A reader that declines now and then is reported, and the checks fail only as far as papers went unread.
  const d = await runGate({ reader: BROKEN.declining!(), second: lexiconReader(), pairs });
  expect(d.declined).toBeGreaterThan(40);
  // What a failure does (13f): lines that fail are off; respect, reason or answers failing stops the slice.
  const flat = await runGate({ reader: BROKEN.flat!(), second: lexiconReader(), pairs });
  expect(flat.lines_off).toContain("respect");
  expect(flat.stops).toBe(true);
  const dis = await runGate({ reader: lexiconReader(), second: BROKEN.disagreeing!(), pairs });
  expect(dis.lines_off.sort()).toEqual(["answers", "recourse"]);
  expect(dis.stops).toBe(true); // (answers is one of the three that carry the experiment)
  const len = await runGate({ reader: BROKEN.lengthy!(), second: lexiconReader(), pairs });
  expect(len.stops).toBe(false);
});

test("the extreme readers of 13f read every paper at its kindest and at its curtest; the runner takes mocks and refuses a model", async () => {
  const q = { kind: "k", standing: "addressee" as const, paper: "Words of a paper here.", answers: "What was asked.", wording: 1 as const };
  const kind = (await kindestReader().read(q)).reading!, curt = (await curtestReader().read(q)).reading!;
  expect([kind.respect, kind.reason, kind.answers, kind.recourse, kind.threat]).toEqual([2, 2, 2, 2, 0]);
  expect([curt.respect, curt.reason, curt.answers, curt.recourse, curt.threat]).toEqual([-2, 0, 0, 0, 2]);
  expect((await kindestReader().read({ ...q, answers: undefined })).reading!.answers).toBeNull();
  expect(NEUTRAL.respect).toBe(0);
  expect(mockReader("mock:lexicon")!.model).toBe("mock/lexicon");
  expect(mockReader(undefined)).toBeUndefined();
  expect(() => mockReader("claude-code/claude-haiku-5-5")).toThrow(/calls no model/);
  expect(() => mockReader("mock:nonesuch")).toThrow(/no mock reader/);
});
