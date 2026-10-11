// A notebook nearly full is folded: its older, untouched entries become a summary in the seat's own words, in one
// counted call of their own (purpose "notebook"); nothing is dropped unless the answer was read and short enough.

import { expect, test } from "bun:test";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";
import type { Observation } from "../src/contracts";
import type { ContentBlock, LlmRequest } from "../src/llm/adapter";
import { callModel } from "../src/llm/call";
import { editNotebook, foldPlan, createLlmParticipant, notebookAges, NOTEBOOK_MAX, NOTEBOOK_NEARLY, type LlmParticipantConfig } from "../src/llm/participant";

const DAY = 86_400;
const ctx = { world: { currency: PROFILE.values.currency } } as any;
const obs = (t: number): Observation => ({ t, channels: {}, outcomes: [], inbox: [], drafts: [], positions: [{ position: "mayor", entity: "city", title: "Mayor" }] } as unknown as Observation);
const use = (id: string, name: string, input: object): ContentBlock => ({ type: "tool_use", id, name, input });
const shown = (r: LlmRequest) => { const c = r.messages.at(-1)!.content; return typeof c === "string" ? c : c.map((b: any) => b.content ?? b.text ?? "").join("\n"); };

/** A seat whose sittings are scripted by `sit(n)` (its answer's tool uses) and whose fold calls are answered by `fold`. */
function seat(sit: (n: number) => ContentBlock[], fold: (req: LlmRequest) => ContentBlock[] | "fail" = (r) => [{ type: "text", text: `(${String((r.context as any).older).split("\n").length} earlier notes)` }]) {
  const calls: LlmRequest[] = [];
  const notes: any[] = [];
  const annotations: any[] = [];
  let sittings = 0;
  const adapter = { provider: "mock", model: "mock", complete: async (req: LlmRequest) => {
    calls.push(JSON.parse(JSON.stringify({ ...req, context: undefined })));
    if (req.purpose === "notebook") {
      const a = fold(req);
      if (a === "fail") throw new Error("no answer within 180 s");
      return { content: a, usage: { input_tokens: 10, output_tokens: 5 } } as any;
    }
    return { content: [...sit(++sittings), use(`end${sittings}`, "done_for_now", { days: 1 })], usage: { input_tokens: 1, output_tokens: 1 } } as any;
  } };
  const io = { adapter, annotate: async (a: any) => { annotations.push(a); if (a.annotation === "note") notes.push(a.data); }, now: () => 0 } as any;
  const c: LlmParticipantConfig = { participant: "mayor-system", entity: "city", title: "Mayor", framing: { disclosure: "simulation", reason: "test" }, standing: [], titles: new Map(), cadenceDays: 1, draftText: () => "", ...({} as any) };
  const p = createLlmParticipant(c, io);
  return { p, calls, notes, annotations, sit: async (day: number) => { await p.step(obs(day * DAY + 9 * 3600), ctx); } };
}
const line = (day: number, n = 100) => `Day ${day}: ${"x".repeat(n - `Day ${day}: `.length)}`;

test("a passage is struck out, and several in one use, and the notebook is written afresh", () => {
  const was = "alpha one\nbeta two\ngamma three";
  expect(editNotebook(was, { change: [{ from: "beta two", to: "" }, { from: "alpha one", to: "" }] })).toMatchObject({ text: "gamma three", problems: [] });
  expect(editNotebook("a\nb", { change: [{ from: "b", to: "" }] }).text).toBe("a\n");
  expect(editNotebook(was, { text: "fresh" }).text).toBe("fresh");
});

test("a line the same before and after keeps its age; a changed or new line is as new as the change", () => {
  const ages = notebookAges("a\nb\nc", [1, 2, 3], "a\nb2\nc\nd", 9);
  expect(ages).toEqual([1, 9, 3, 9]);
  expect(notebookAges("a\nb\nc", [1, 2, 3], "c\na", 9)).toEqual([3, 1]);
});

test("the plan folds the oldest times, never the newest, and not when there is too little", () => {
  const lines = [line(1), line(2), line(3), line(4)];
  expect(foldPlan(lines, [1, 1, 1, 1])).toBeUndefined();
  expect(foldPlan(lines, [1, 2, 3, 4])).toBeUndefined(); // 400 characters is under the least worth asking for
  const big = [line(1, 400), line(2, 400), line(3, 400), line(4, 400)];
  expect(foldPlan(big, [1, 2, 3, 4])).toMatchObject({ fold: [0, 1], upTo: 2, limit: 200 + 100 > 0 ? 300 : 0 });
});

test("a notebook passing the threshold is asked once at its next sitting: older notes become the summary, newer ones stay, the call is counted and carries the notes", async () => {
  const s = seat((n) => (n <= 8 ? [use("n", "notebook", { add: line(n, 900) })] : []));
  for (let d = 1; d <= 8; d++) await s.sit(d); // 8 x 901 = 7,200 characters; folded at the sitting that finds 6,000+
  const folds = s.annotations.filter((a) => a.annotation === "usage" && a.purpose === "notebook");
  expect(folds.length).toBe(1);
  const t = s.annotations.find((a) => a.annotation === "transcript" && a.data.purpose === "notebook");
  expect(t.data.ref).toBe("notebook");
  expect(t.data.input).toContain(line(1, 900)); // what was replaced stays in the log
  const f = s.notes.find((n) => n.notebook_folded).notebook_folded;
  expect(f.replaced).toContain(line(1, 900));
  expect(f.summary_characters).toBeLessThan(f.replaced_characters);
  // The next sitting shows the notebook as folded: the summary first, the newest notes verbatim, and says so.
  await s.sit(9);
  const sittings = s.calls.filter((c) => c.purpose === "participant");
  const told = shown(sittings[7]!); // the sitting it was folded at: told then
  expect(told).toContain("so your notes up to day");
  expect(told).not.toContain(line(1, 900));
  const last = shown(sittings.at(-1)!);
  expect(last).toContain("Summary of my notes up to day ");
  expect(last).toContain(line(8, 900));
  expect(last).not.toContain(line(1, 900));
  expect(s.calls.filter((c) => c.purpose === "notebook").length).toBe(1);
});

for (const [name, answer] of [["empty", [{ type: "text", text: "  " }]], ["too long", [{ type: "text", text: "y".repeat(5000) }]], ["failed", "fail"]] as const) {
  test(`a fold answer that is ${name} drops nothing, and the seat is told`, async () => {
    const s = seat((n) => (n <= 8 ? [use("n", "notebook", { add: line(n, 900) })] : []), () => answer as any);
    for (let d = 1; d <= 8; d++) await s.sit(d);
    expect(s.notes.some((n) => n.notebook_folded)).toBe(false);
    expect(s.notes.find((n) => n.notebook_fold_failed)).toBeDefined();
    await s.sit(9);
    const last = shown(s.calls.filter((c) => c.purpose === "participant")[7]!);
    expect(last).toContain("older notes could not be folded into a summary this time: they are all still there.");
    for (let d = 1; d <= 7; d++) expect(last).toContain(line(d, 900));
    expect(s.calls.filter((c) => c.purpose === "notebook").length).toBe(1); // not asked again at once
  });
}

test("400 sittings of a seat that adds 35 to 250 characters and never prunes: under the limit, every fold recorded", async () => {
  const s = seat((n) => [use("n", "notebook", { add: line(n, 35 + ((n * 37) % 216)) })]);
  for (let d = 1; d <= 400; d++) await s.sit(d);
  const folds = s.notes.filter((n) => n.notebook_folded);
  const extra = s.annotations.filter((a) => a.annotation === "usage" && a.purpose === "notebook").length;
  expect(extra).toBe(folds.length + s.notes.filter((n) => n.notebook_fold_failed).length);
  expect(folds.length).toBeGreaterThan(0);
  // Never over the limit at any sitting's opening or after a write, and nothing refused for room.
  expect(s.notes.filter((n) => n.notebook_not_changed || n.notebook_cut).length).toBe(0);
  const opening = s.calls.filter((c) => c.purpose === "participant").map((c) => /Your notebook: ([\s\S]*)\n\(([\d,]+) of the/.exec(shown(c))?.[2]?.replace(",", ""));
  const used = opening.filter(Boolean).map(Number);
  expect(Math.max(...used)).toBeLessThanOrEqual(NOTEBOOK_MAX);
  console.log(`400 sittings: ${extra} extra notebook calls (${folds.length} folds), largest notebook at an opening ${Math.max(...used)}`);
});

test("an ordinary sitting's prompt does not grow: the fold is its own call", async () => {
  const s = seat((n) => (n <= 3 ? [use("n", "notebook", { add: line(n, 100) })] : []));
  for (let d = 1; d <= 4; d++) await s.sit(d);
  expect(s.calls.filter((c) => c.purpose === "notebook").length).toBe(0);
  expect(shown(s.calls.filter((c) => c.purpose === "participant").at(-1)!)).not.toContain("nearly full");
});

test("the fold call is costed like any other", async () => {
  const io = { adapter: { provider: "mock", model: "mock", complete: async () => ({ content: [{ type: "text", text: "s" }], usage: { input_tokens: 10, output_tokens: 5 } }) }, annotate: async (a: any) => void out.push(a), now: () => 0 } as any;
  const out: any[] = [];
  await callModel(io, { purpose: "notebook", subject: "x", ref: "notebook", system: "", messages: [{ role: "user", content: "hi" }], maxTokens: 10 }, new Set());
  expect(out.find((a) => a.annotation === "usage")).toMatchObject({ purpose: "notebook", input_tokens: 10, output_tokens: 5 });
  expect(NOTEBOOK_NEARLY).toBe(6000);
});
