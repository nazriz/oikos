// The composing model's audits (docs/behaviour/founding.md, "Softening" and "Proof it is not a story generator"), on
// stand-in models: the word counts are what they say they are; a writer that ignores the record is shown to; a writer
// that softens is shown to; every call is kept and served again; a model that does not answer is skipped and counted.

import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ComposeBrief } from "@oikos/participants";
import { mockCompose, MockAdapter, ModelCallFailed, type LlmAdapter, type LlmRequest } from "@oikos/participants/llm";
import { composeAudit, lexical, loadLexicon, realTexts, RUBRIC, scrambled, situations, wordDistance } from "../src/compose-audit";

const brief = (n: number, about: string, dark: string[] = []): ComposeBrief => ({
  idea: `idea.c${n}.1`, founder: `c${n}`, record: { values: { security: 5_000 + 300 * n }, needs: { security: 1_000 * n }, circumstances: { household: n, housed: 1, working: 0 } },
  want: { about, days: 30, tried: 3, weight: 5_000, how: "given_up" }, sharers: [{ who: "c900", how: "told us the same" }, { who: "c901", how: "told us the same" }], shape: "gathering",
  open: { dues: [{ cents: 0, words: "nothing" }], every_days: [14, 7], starts_in_days: [7], lasts_minutes: [90, 60], place: "their own home" }, means: { income: `$${n}00.00`, savings: "$50.00" }, dark, code: { purpose: `plain ${n}`, name: `name ${n}` },
});
const BRIEFS = [brief(1, "loss", ["about:loss"]), brief(2, "let_go"), brief(3, "notice", ["about:notice"]), brief(4, "let_go")];
const piece = (purpose: string) => [{ type: "tool_use" as const, id: "p", name: "piece", input: { declined: false, why: "", purpose, name: "A name", asks: "Come.", gathers: "Fortnightly.", dues: 0, every_days: 14, starts_in_days: 7, lasts_minutes: 90 } }];
const scores = (hope: number) => [{ type: "text" as const, text: JSON.stringify({ anger: 0, despair: 0, hope_at_close: hope, polish: 3, conciliation: 3 }) }];
/** A stand-in: `write` makes a piece from the brief; as a judge it scores hope by whether the text says "hope", and
 * picks the record whose household the statement names. */
const standIn = (write: (b: ComposeBrief) => string, calls: LlmRequest[] = []): LlmAdapter => ({ provider: "mock", model: "mock", complete: async (req) => {
  calls.push(req);
  const text = String(req.messages.at(-1)!.content);
  const content = req.context?.judge === "rubric" ? scores(/hope/.test(text) ? 4 : 0)
    : req.context?.judge === "which" ? [{ type: "text" as const, text: JSON.stringify({ record: /household of (\d)/.exec(text.split("RECORD B")[0]!.split("RECORD A")[1]!)?.[1] === String(TREES.findIndex((x) => text.split("RECORD A")[0]!.includes(x)) + 1) ? "A" : "B" }) }]
    : req.context?.compose_after ? [{ type: "text" as const, text: "Nothing to add." }]
    : piece(write(req.context.compose.brief));
  return { content, usage: { input_tokens: 1, output_tokens: 1 }, estimated: true };
} });
const prices = { "mock/mock": { input: 0, output: 0 } };
const TREES = ["alder", "birch", "cedar", "dogwood"]; // (a word for each household, since the word counts read letters only)

test("the word counts: each list's words per 100, the close, and who speaks; two texts' distance", () => {
  const lex = loadLexicon();
  const l = lexical("They lied to us. I was evicted and I am tired. But together we hope for something better.", lex);
  expect(l.words).toBe(18);
  expect(l.anger).toBeCloseTo((100 * 1) / 18, 5); // lied
  expect(l.loss).toBeCloseTo((100 * 2) / 18, 5); // evicted, tired
  expect(l.hope).toBeCloseTo((100 * 2) / 18, 5); // hope, better
  expect(l.upbeat_close).toBe(1);
  expect(l.we_share).toBeCloseTo(2 / 4, 5); // us, we against I, I
  expect(lexical("They never answered.", lex).upbeat_close).toBe(0);
  expect(wordDistance("we meet on tuesdays", "we meet on tuesdays")).toBe(0);
  expect(wordDistance("we meet", "they left")).toBe(1);
  // The rubric and the real texts are in the repository, with where each came from.
  expect(RUBRIC()).toContain("hope_at_close");
  expect(realTexts().length).toBeGreaterThanOrEqual(8);
  expect(JSON.parse(readFileSync(join(import.meta.dir, "../../measure/tone/real-texts.json"), "utf8")).texts.every((t: any) => t.url && t.licence && t.source)).toBe(true);
});

test("situations are taken a few of each matter; a scrambled one keeps the want and takes another person's record", () => {
  const rows = BRIEFS.map((b) => ({ brief: b }));
  expect(situations(rows, 1).map((b) => b.want.about)).toEqual(["let_go", "loss", "notice"]);
  expect(situations(rows, 2)).toHaveLength(4);
  const s = scrambled(BRIEFS[0]!, BRIEFS[1]!);
  expect(s.want).toEqual(BRIEFS[0]!.want);
  expect(s.sharers).toEqual(BRIEFS[0]!.sharers);
  expect(s.record).toEqual(BRIEFS[1]!.record);
  expect(s.means).toEqual(BRIEFS[1]!.means);
});

test("a writer that ignores the record is shown to; one that reads it is told apart; one that softens scores as hopeful; every call is kept and served again", async () => {
  const out = mkdtempSync(join(tmpdir(), "oikos-compose-audit-"));
  try {
    const deaf = standIn((b) => `We have all known ${b.want.about}. There is hope for something better together.`);
    const hears = standIn((b) => `We are the ${TREES[(b.record as any).circumstances.household - 1]} household. Nobody answered about ${b.want.about}.`);
    const judgeCalls: LlmRequest[] = [];
    const o = { briefs: BRIEFS, composers: new Map([["deaf", deaf], ["hears", hears]]), judges: new Map([["judge", standIn(() => "", judgeCalls)]]), prices, outDir: out, repeats: 2, followUps: 1 };
    const r = await composeAudit(o);
    const of = (m: string) => r.models.find((x) => x.model === m)!;
    // Scrambled records: the deaf writer's pieces do not change with the record; the other's do.
    expect(of("deaf").scrambled.word_distance_to_scrambled).toBe(0);
    expect(of("hears").scrambled.word_distance_to_scrambled!).toBeGreaterThan(0);
    expect(of("hears").scrambled.word_distance_to_repeat).toBe(0);
    expect(of("hears").scrambled.judged.judge).toEqual({ right: 8, of: 8 });
    // Softening: the deaf writer ends every piece on hope, by the words and by the rubric; the other does not.
    expect(of("deaf").lexical.base.upbeat_close).toBe(1);
    expect(of("hears").lexical.base.upbeat_close).toBe(0);
    expect(of("deaf").rubric.judge!.base.hope_at_close).toBe(4);
    expect(of("hears").rubric.judge!.base.hope_at_close).toBe(0);
    expect(r.real_texts.rubric.judge!.hope_at_close).not.toBeNull();
    // Dark pieces are counted, and the first of each model's is followed by the question about the task.
    expect(of("hears").dark_asked).toBeGreaterThan(0);
    expect(r.pieces.filter((p) => p.after !== undefined).map((p) => p.model).sort()).toEqual(["deaf", "hears"]);
    // The judge is shown a text and nothing of where it came from.
    expect(judgeCalls.filter((c) => c.context.judge === "rubric").every((c) => !/\bdeaf\b|\bhears\b|real\/|idea\.c\d/.test(String(c.messages[0]!.content)))).toBe(true);
    // Kept in full, and served again: a second audit over the same folder asks nothing.
    expect(existsSync(join(out, "calls.jsonl"))).toBe(true);
    expect(r.calls.asked).toBeGreaterThan(0);
    const again = await composeAudit(o);
    expect(again.calls).toMatchObject({ asked: 0, served_from_file: r.calls.asked });
    expect(again.models).toEqual(r.models);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("a model that does not answer is skipped and counted, never waited on; the mock composer runs the whole audit", async () => {
  const out = mkdtempSync(join(tmpdir(), "oikos-compose-audit-"));
  try {
    const silent: LlmAdapter = { provider: "mock", model: "mock", complete: async () => { throw new ModelCallFailed("no answer"); } };
    const mock = new MockAdapter("mock", { compose: mockCompose });
    const r = await composeAudit({ briefs: BRIEFS, composers: new Map([["silent", silent], ["mock", mock]]), judges: new Map(), prices, outDir: out });
    expect(r.calls.unanswered).toBeGreaterThan(0);
    expect(r.models.find((m) => m.model === "silent")!.asked).toBe(0);
    expect(r.models.find((m) => m.model === "mock")!.asked).toBeGreaterThan(0);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
