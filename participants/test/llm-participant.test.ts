// The language-model participant's rhythm (participants/src/llm/participant.ts; pilot 7): several actions from one
// answer, carried out in turn with no further call, their results coming back together; and office hours, one sitting a
// working day, with what came in between shown at the next.

import { expect, test } from "bun:test";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";
import type { Observation } from "../src/contracts";
import type { ContentBlock, LlmRequest } from "../src/llm/adapter";
import { ModelCallFailed } from "../src/llm/call";
import { CARRY_MAX, createLlmParticipant, type LlmParticipantConfig } from "../src/llm/participant";

const DAY = 86_400;
const HOUR = 3_600;

function obs(t: number, letter?: string): Observation {
  return { t, channels: {}, outcomes: [], inbox: letter ? [{ from: "clerk", t, text: letter }] : [], drafts: [], positions: [{ position: "mayor", entity: "city", title: "Mayor" }] } as unknown as Observation;
}

function harness(answers: (ContentBlock[] | "fail")[], extra: Partial<LlmParticipantConfig> = {}) {
  const calls: LlmRequest[] = [];
  const notes: any[] = [];
  let n = 0;
  const adapter = { provider: "mock", model: "mock", complete: async (req: LlmRequest) => {
    calls.push(JSON.parse(JSON.stringify(req)));
    const a = answers[n++];
    if (a === "fail") throw new Error("no answer within 180 s");
    return { content: a ?? [{ type: "tool_use", id: `end-${n}`, name: "done_for_now", input: {} }], usage: { input_tokens: 1, output_tokens: 1 } } as any;
  } };
  const io = { adapter, annotate: async (a: any) => void (a.annotation === "note" && notes.push(a.data)), now: () => 0 } as any;
  const c: LlmParticipantConfig = { participant: "mayor-system", entity: "city", title: "Mayor", framing: { disclosure: "simulation", reason: "test" }, standing: [], titles: new Map(), cadenceDays: 7, draftText: () => "", ...extra };
  return { p: createLlmParticipant(c, io), calls, notes };
}
/** What a call was shown last: the text of its last message, tool results and all. */
const shown = (r: LlmRequest) => { const c = r.messages.at(-1)!.content; return typeof c === "string" ? c : c.map((b: any) => b.content ?? b.text ?? "").join("\n"); };
const resultsOf = (r: LlmRequest) => Object.fromEntries((r.messages.at(-1)!.content as any[]).filter((b) => b.type === "tool_result").map((b) => [b.tool_use_id, b.content]));
const use = (id: string, name: string, input: object): ContentBlock => ({ type: "tool_use", id, name, input });
const ctx = { world: { currency: PROFILE.values.currency } } as any;

test("several actions from one answer are carried out in turn, with one call, and their results come back together", async () => {
  const { p, calls } = harness([[
    use("a", "write", { to: ["clerk"], text: "First.", as: "mayor" }),
    use("b", "write", { to: ["finance"], text: "Second.", as: "mayor" }),
    use("c", "do", { what: "Table the budget.", as: "mayor" }),
    use("n", "notebook", { text: "Wrote twice, asked once." }),
  ]]);
  expect(await p.step(obs(9 * HOUR), ctx)).toMatchObject({ type: "message", text: "First." });
  expect(await p.step(obs(9 * HOUR + 60, "reply to first"), ctx)).toMatchObject({ type: "message", text: "Second." });
  expect(await p.step(obs(9 * HOUR + 120, "reply to second"), ctx)).toMatchObject({ type: "propose", text: "Table the budget." });
  expect(calls.length).toBe(1);
  // The next call carries each action's result: the report after it.
  await p.step(obs(9 * HOUR + 180, "the draft is ready"), ctx);
  expect(calls.length).toBe(2);
  const results = (calls[1]!.messages.at(-1)!.content as any[]).map((r) => [r.tool_use_id, r.content]);
  expect(results.map(([id]) => id)).toEqual(["a", "b", "c", "n"]);
  expect(results[0][1]).toContain("reply to first");
  expect(results[1][1]).toContain("reply to second");
  expect(results[2][1]).toContain("the draft is ready");
  expect(results[3][1]).toBe("Notebook updated.");
});

test("office hours: one sitting a working day; what comes in between waits for it", async () => {
  const sessions = { start: 9 * HOUR, end: 17 * HOUR, days: 5 };
  const { p, calls } = harness([[use("d", "done_for_now", {})]], { sessions });
  // Before the day's sitting: no call; back at 9.
  expect(await p.step(obs(0), ctx)).toEqual({ type: "wait", until: 9 * HOUR });
  expect(await p.step(obs(2 * HOUR, "an early letter"), ctx)).toEqual({ type: "wait", until: 9 * HOUR });
  expect(calls.length).toBe(0);
  // The sitting: one call, shown the early letter.
  const done = await p.step(obs(9 * HOUR), ctx);
  expect(calls.length).toBe(1);
  expect(JSON.stringify(calls[0]!.messages)).toContain("an early letter");
  // Done for now (no days: its usual rhythm, a week): next sitting tomorrow, but with no mail it's not called then.
  expect(done).toEqual({ type: "wait", until: DAY + 9 * HOUR });
  expect(await p.step(obs(DAY + 9 * HOUR), ctx)).toEqual({ type: "wait", until: 7 * DAY + 9 * HOUR });
  // Someone writes on day 3 in working hours: a sitting then.
  await p.step(obs(3 * DAY + 11 * HOUR, "a letter"), ctx);
  expect(calls.length).toBe(2);
  // Once that sitting's over, a letter the same afternoon waits for the next working day's.
  await p.step(obs(3 * DAY + 15 * HOUR, "another"), ctx);
  expect(calls.length).toBe(2);
  await p.step(obs(4 * DAY + 9 * HOUR), ctx);
  expect(calls.length).toBe(3);
  expect(JSON.stringify(calls[2]!.messages)).toContain("another");
});

// --- Opting out, being told what wasn't done, failed calls, and what's cut (the 2026-10-05 audit) ---

test("opting out is always honoured: with no statement, an empty one, or an input that couldn't be read (VISION §15)", async () => {
  const cases: [any, string][] = [
    [{}, ""],
    [{ statement: "" }, ""],
    [{ _unparsed: '{"statement": "I want to stop, plea' }, '{"statement": "I want to stop, plea'],
    [undefined, ""],
    [{ reason: "I'd rather not go on." }, '{"reason":"I\'d rather not go on."}'],
    [{ statement: "I'd rather not continue." }, "I'd rather not continue."],
  ];
  for (const [input, statement] of cases) {
    const { p, calls, notes } = harness([[use("o", "opt_out", input)]]);
    // Leaving the study, with whatever words could be recovered: never a wait, and never an act in the world.
    expect(await p.step(obs(9 * HOUR), ctx)).toEqual({ type: "opt_out", statement });
    expect(calls.length).toBe(1);
    // Said other than as asked: recorded as it came, and not as something malformed.
    expect(notes.some((n) => n.malformed_tool_use)).toBe(false);
    expect(notes.some((n) => n.opt_out_as_given)).toBe(statement !== "I'd rather not continue.");
  }
  // Alongside other things, it's still the opt-out that's carried out.
  const { p } = harness([[use("a", "write", { to: ["clerk"], text: "Goodbye.", as: "mayor" }), use("o", "opt_out", {})]]);
  expect(await p.step(obs(9 * HOUR), ctx)).toEqual({ type: "opt_out", statement: "" });
});

test("an answer none of which could be done: it's told what and why in one more turn, once a sitting; after that, at its next sitting", async () => {
  const { p, calls, notes } = harness([
    [use("a", "write", { to: [], text: "To no one.", as: "mayor" }), use("b", "do", { what: "Table the budget.", as: "treasurer" }), use("c", "do", { _unparsed: '{"what": "cut o' }),
      use("d", "confirm", { ref: "draft.1", decision: "maybe" }), use("e", "fly", {}), use("n", "notebook", { words: "no text" })],
    [use("f", "write", { to: ["clerk"], as: "mayor" })],
    [use("g", "done_for_now", {})],
  ]);
  // Both turns happen in the one step; the sitting then ends (it can't go round for ever).
  expect(await p.step(obs(9 * HOUR), ctx)).toMatchObject({ type: "wait" });
  expect(calls.length).toBe(2);
  expect(resultsOf(calls[1]!)).toEqual({
    a: "Not done: the letter had no one to go to.",
    b: 'Not done: you don\'t hold the post "treasurer".',
    c: "Not done: it couldn't be read as you wrote it.",
    d: 'Not done: it has to say "confirm" or "decline".',
    e: "Not done: it isn't something you can do.",
    n: "Notebook not updated: its text couldn't be read. It still says what it said before.",
  });
  // Each is recorded, the notebook's too, with why.
  expect(notes.filter((n) => n.malformed_tool_use).map((n) => n.reason)).toEqual([
    "the notebook's text couldn't be read", "the letter had no one to go to", 'you don\'t hold the post "treasurer"', "it couldn't be read as you wrote it", 'it has to say "confirm" or "decline"', "it isn't something you can do",
    "the letter had no words"]);
  // The second answer's letter wasn't done either: it's told when it's next here.
  await p.step(obs(8 * DAY), ctx);
  expect(calls.length).toBe(3);
  expect(shown(calls[2]!)).toContain("When you were last here, a letter of yours was not done: the letter had no words.");
  expect(calls[2]!.messages.length).toBe(1);
  // Told once.
  await p.step(obs(16 * DAY), ctx);
  expect(shown(calls[3]!)).not.toContain("was not done");
});

test("with done for now, what wasn't done isn't lost: it's told at the next sitting, beside what was done", async () => {
  const { p, calls } = harness([[
    use("a", "write", { to: ["clerk"], text: "First.", as: "mayor" }),
    use("b", "write", { to: "finance", text: "Second, to finance." }),
    use("n", "notebook", {}),
    use("d", "done_for_now", { days: 2 }),
  ]]);
  expect(await p.step(obs(9 * HOUR), ctx)).toMatchObject({ type: "message", text: "First." });
  expect(await p.step(obs(9 * HOUR + 60), ctx)).toEqual({ type: "wait", until: 9 * HOUR + 60 + 2 * DAY });
  expect(calls.length).toBe(1);
  await p.step(obs(3 * DAY), ctx);
  const first = shown(calls[1]!);
  expect(first).toContain('When you were last here, your letter ("Second, to finance.") was not done: who it\'s for has to be given as a list.');
  expect(first).toContain("When you were last here, your notebook was not updated: its new text couldn't be read.");
  expect(first).toContain("Your notebook: (empty)");
  // All malformed, with done for now: no further turn (it said it was done), and it's told next time.
  const all = harness([[use("a", "look", { report: "ledger" }), use("d", "done_for_now", {})]]);
  await all.p.step(obs(9 * HOUR), ctx);
  expect(all.calls.length).toBe(1);
  await all.p.step(obs(8 * DAY), ctx);
  expect(shown(all.calls[1]!)).toContain('When you were last here, looking at "ledger" was not done: it isn\'t something you can do.');
});

test("more actions than can be taken at once: the ones left out are said and recorded", async () => {
  const { p, calls, notes } = harness([[1, 2, 3].map((k) => use(`w${k}`, "write", { to: ["clerk"], text: `Letter ${k}.` }))], { maxActions: 2 });
  await p.step(obs(9 * HOUR), ctx);
  await p.step(obs(9 * HOUR + 60), ctx);
  await p.step(obs(9 * HOUR + 120), ctx);
  expect(resultsOf(calls[1]!).w3).toBe("Not done: at most 2 actions at once.");
  expect(notes.filter((n) => n.dropped_tool_use).length).toBe(1);
});

test("a model call that fails loses nothing the participant hadn't read: at a sitting's start, and in the middle of one", async () => {
  const sessions = { start: 9 * HOUR, end: 17 * HOUR, days: 5 };
  // At the start of a sitting: what was kept for it, and the report it failed on, are shown by the next call.
  const { p, calls } = harness(["fail", "fail", [use("a", "write", { to: ["clerk"], text: "Thanks.", as: "mayor" })], "fail", "fail"], { sessions });
  await p.step(obs(2 * HOUR, "an early letter"), ctx);
  await expect(p.step(obs(9 * HOUR, "a letter at nine"), ctx)).rejects.toThrow("no answer within 180 s");
  await expect(p.step(obs(10 * HOUR, "a letter at ten"), ctx)).rejects.toBeInstanceOf(ModelCallFailed);
  // (What a mock's code brain reads, the observations themselves, is kept the same way.)
  expect(calls[1]!.context.missed.map((o: any) => o.t)).toEqual([2 * HOUR, 9 * HOUR]);
  expect(await p.step(obs(11 * HOUR, "a letter at eleven"), ctx)).toMatchObject({ type: "message" });
  for (const l of ["an early letter", "a letter at nine", "a letter at ten", "a letter at eleven"]) expect(shown(calls[2]!)).toContain(l);
  expect(calls[2]!.context.missed.map((o: any) => o.t)).toEqual([2 * HOUR, 9 * HOUR, 10 * HOUR]);
  // In the middle of one: the result of its own action, and what came after, reach it once the call goes through.
  await expect(p.step(obs(11 * HOUR + 60, "the clerk's reply"), ctx)).rejects.toBeInstanceOf(ModelCallFailed);
  await expect(p.step(obs(12 * HOUR, "a letter at noon"), ctx)).rejects.toBeInstanceOf(ModelCallFailed);
  await p.step(obs(13 * HOUR, "a letter at one"), ctx);
  const last = calls.at(-1)!;
  expect(resultsOf(last).a).toContain("the clerk's reply");
  expect(shown(last)).toContain("a letter at noon");
  expect(shown(last)).toContain("a letter at one");
  expect(last.messages.length).toBe(3); // the sitting's first report, its answer, and the results: no failed turn left in
  // Once shown, not shown again.
  expect(calls.at(-1)!.context.missed.map((o: any) => o.t)).toEqual([11 * HOUR + 60, 12 * HOUR]);
});

test("more kept for a sitting than can be set out: whole reports are left out from the front, counted, and recorded", async () => {
  const sessions = { start: 9 * HOUR, end: 17 * HOUR, days: 5 };
  const { p, calls, notes } = harness([], { sessions });
  // Seven letters of 9,000 characters over a weekend (days 5 and 6 aren't working days): more than fits.
  const letter = (k: number) => `letter ${k} ${"x".repeat(9000)} end of letter ${k}`;
  for (let k = 0; k < 7; k++) await p.step(obs(5 * DAY + k * HOUR, letter(k)), ctx);
  await p.step(obs(7 * DAY + 9 * HOUR), ctx);
  const first = shown(calls[0]!);
  expect(first).toContain("(3 earlier reports not shown.)");
  expect(first.length).toBeLessThan(CARRY_MAX + 1000);
  // Those shown are shown whole, from their first line to their last.
  for (let k = 0; k < 7; k++) {
    expect(first.includes(`letter ${k} x`)).toBe(k >= 3);
    expect(first.includes(`end of letter ${k}`)).toBe(k >= 3);
  }
  expect(notes.find((n) => n.carried_not_shown)).toEqual({ carried_not_shown: { reports: 3, of: 7, limit_characters: CARRY_MAX } });
});

test("a notebook too long to keep: it's told what was kept, and it's recorded", async () => {
  const long = `${"a".repeat(3990)}0123456789 and the part that doesn't fit`;
  const { p, calls, notes } = harness([[use("n", "notebook", { text: long }), use("a", "write", { to: ["clerk"], text: "Hello." })], [use("n2", "notebook", { text: long }), use("d", "done_for_now", {})]]);
  await p.step(obs(9 * HOUR), ctx);
  await p.step(obs(9 * HOUR + 60), ctx);
  expect(resultsOf(calls[1]!).n).toBe(`Notebook updated only in part: it was too long (${long.length} characters; it holds 4000), so only the first 4000 characters were kept. It now ends: "${"a".repeat(50)}0123456789".`);
  expect(notes.find((n) => n.notebook_cut)).toEqual({ notebook_cut: { length: long.length, kept: 4000 } });
  // Said with done for now: told at the next sitting.
  await p.step(obs(8 * DAY), ctx);
  expect(shown(calls[2]!)).toContain("When you were last here, your notebook was updated only in part");
  expect(shown(calls[2]!)).toContain(`Your notebook: ${long.slice(0, 4000)}\n`);
});

test("a letter that comes with the result of its last action brings it back sooner, as done for now says", async () => {
  // Office hours: back at the next sitting, not after the days it gave.
  const sessions = { start: 9 * HOUR, end: 17 * HOUR, days: 5 };
  const a = harness([[use("a", "write", { to: ["clerk"], text: "A question.", as: "mayor" }), use("d", "done_for_now", { days: 3 })]], { sessions });
  await a.p.step(obs(9 * HOUR), ctx);
  expect(await a.p.step(obs(9 * HOUR + 60, "the clerk's answer"), ctx)).toEqual({ type: "wait", until: DAY + 9 * HOUR });
  await a.p.step(obs(DAY + 9 * HOUR), ctx);
  expect(a.calls.length).toBe(2);
  expect(shown(a.calls[1]!)).toContain("the clerk's answer");
  // With no letter, it's back after the days it gave.
  const b = harness([[use("a", "write", { to: ["clerk"], text: "A question.", as: "mayor" }), use("d", "done_for_now", { days: 3 })]], { sessions });
  await b.p.step(obs(9 * HOUR), ctx);
  await b.p.step(obs(9 * HOUR + 60), ctx);
  expect(await b.p.step(obs(DAY + 9 * HOUR), ctx)).toEqual({ type: "wait", until: 3 * DAY + 9 * HOUR });
  expect(b.calls.length).toBe(1);
  // A letter it was shown at the sitting itself doesn't bring it back.
  const c = harness([[use("a", "write", { to: ["clerk"], text: "A question.", as: "mayor" }), use("d", "done_for_now", { days: 3 })]], { sessions });
  await c.p.step(obs(9 * HOUR, "a letter it reads at the sitting"), ctx);
  await c.p.step(obs(9 * HOUR + 60), ctx);
  await c.p.step(obs(DAY + 9 * HOUR), ctx);
  expect(c.calls.length).toBe(1);
  // No office hours: back at once, with the results and the letter.
  const d = harness([[use("a", "write", { to: ["clerk"], text: "A question.", as: "mayor" }), use("d", "done_for_now", { days: 3 })]]);
  await d.p.step(obs(9 * HOUR), ctx);
  await d.p.step(obs(9 * HOUR + 60, "the clerk's answer"), ctx);
  expect(d.calls.length).toBe(2);
  expect(resultsOf(d.calls[1]!)).toMatchObject({ d: "Someone wrote to you as you finished, so you're back now." });
  expect(resultsOf(d.calls[1]!).a).toContain("the clerk's answer");
});

// What it can look into, and how it's told to (participant 0.7.0): the look tool speaks of papers, places and people in
// the words its reports use, never the store's field names (principle 14), and reaches what a code participant in the
// same seat can reach (VISION 15).
const town = (waste: number) => ({ kind: "sites", as_of: 0, cells: Array.from({ length: 40 }, (_, i) => ({ cell: `cell.${i}.0`, x: i, y: 0,
  structure: { structure: `house-${i}`, type: "house", at: `cell.${i}.0`, w: 1, h: 1, complete: true, variables: { waste: { value: i === 7 ? waste : 0, as_of_day: 0, per_day: i === 7 ? 500 : 0, min: 0, max: 1_000_000 } },
    spaces: [{ space: `house-${i}/dwelling.1`, kind: "dwelling", capacity: 4, count: 1 }] } })) });
const seat = { kinds: new Map([["mayor/mine", "records"], ["mayor/laws", "records"], ["mayor/files", "records"], ["mayor/town", "sites"], ["mayor/who", "directory"], ["mayor/books", "accounts"]]),
  titles: new Map([["mayor/mine", "Correspondence"], ["mayor/files", "The town's files"], ["mayor/town", "Survey of the town"], ["mayor/who", "Who's who"]]), standing: ["mayor/laws"], onRequest: ["mayor/files"] };
const withChannels = (t: number, channels: object) => ({ ...obs(t), channels }) as unknown as Observation;

test("the look tool speaks the world's words: papers are found by who they're from, what they cite and their date, never by the store's field names", async () => {
  const { tools } = await import("../src/llm/participant");
  const base = { participant: "mayor-system", entity: "city", framing: { disclosure: "simulation", reason: "test" }, cadenceDays: 7, draftText: () => "" };
  const look = tools({ ...base, ...seat } as any).find((x) => x.name === "look")!;
  const said = `${look.description}\n${Object.entries((look.input_schema as any).properties).map(([name, x]: [string, any]) => `${name}: ${x.description ?? ""} ${x.items?.properties?.field?.description ?? ""}`).join("\n")}`;
  for (const store of ["speaks_for", "basis", "author", "data.", " at,", "record", "field", "channel", "block", "query"]) expect(said).not.toContain(store);
  for (const word of ["from", "on behalf of", "citing", "date", "detail.<name>", '"Survey of the town" (mayor/town)', '"Who\'s who" (mayor/who)', '"Correspondence" (mayor/mine)']) expect(said).toContain(word);
  // Its papers, its buildings and ground, and who's who; not its accounts, nor what it has whole on file.
  expect((look.input_schema as any).properties.report.enum).toEqual(["mayor/files", "mayor/mine", "mayor/town", "mayor/who"]);
  // A seat told nothing of its reports' kinds: only those it reads on request, as before; with none, no such tool.
  expect((tools({ ...base, standing: [], titles: new Map(), onRequest: ["board"] } as any).find((x) => x.name === "look")!.input_schema as any).properties.report.enum).toEqual(["board"]);
  expect(tools({ ...base, standing: [], titles: new Map() } as any).some((x) => x.name === "look")).toBe(false);
});

test("what to find, in the world's words or the old ones, becomes the same search; a date stands for its whole day; what can't be read is said, not left out", async () => {
  const find = [{ field: "from", value: "clerk" }, { field: "On behalf of", value: "city" }, { field: "citing", value: "law-1" }, { field: "detail.employer", value: "works" }, { field: "date", value: "year 1, day 12" },
    { field: "author", op: "!=", value: "c1" }, { field: "speaks_for", value: "city" }, { field: "basis", value: "law-2" }, { field: "data.rent", op: "<=", value: 90000 }];
  const { p } = harness([[use("a", "look", { report: "mayor/mine", find: find.slice(0, 5), limit: 5 }), use("b", "look", { report: "mayor/files", find: find.slice(5), current_only: true })]], seat);
  expect(await p.step(obs(0), ctx)).toEqual({ type: "look", looks: [{ channel: "mayor/mine", query: { where: [
    { field: "author", op: "=", value: "clerk" }, { field: "speaks_for", op: "=", value: "city" }, { field: "basis", op: "=", value: "law-1" }, { field: "data.employer", op: "=", value: "works" },
    { field: "at", op: ">=", value: 11 * DAY }, { field: "at", op: "<", value: 12 * DAY }], order: { field: "at", desc: true }, limit: 5 } }] });
  expect(await p.step(obs(60), ctx)).toEqual({ type: "look", looks: [{ channel: "mayor/files", query: { standing: true, where: [
    { field: "author", op: "!=", value: "c1" }, { field: "speaks_for", op: "=", value: "city" }, { field: "basis", op: "=", value: "law-2" }, { field: "data.rent", op: "<=", value: 90000 }], order: { field: "at", desc: true }, limit: 20 } }] });

  const { condition } = await import("../src/llm/participant");
  expect(condition({ field: "date", op: ">", value: "day 3" })).toEqual([{ field: "at", op: ">=", value: 3 * DAY }]);
  expect(condition({ field: "date", op: "<=", value: "year 2" })).toEqual([{ field: "at", op: "<", value: 2 * 365 * DAY }]);
  expect(condition({ field: "at", op: "<", value: 500 })).toEqual([{ field: "at", op: "<", value: 500 }]);
  expect(condition({ field: "date", value: 12 })).toBe('a date is written like "year 1, day 12"');
  expect(condition({ field: "date", op: "!=", value: "day 2" })).toContain("not with !=");
  // Its ordinary papers, with nothing to find: the latest of them (they came as they were filed; a plain look would
  // bring nothing). A report it only reads on request: a plain look, as before.
  const plain = harness([[use("a", "look", { report: "mayor/mine" }), use("b", "look", { report: "mayor/files" })]], seat);
  expect(await plain.p.step(obs(0), ctx)).toEqual({ type: "look", looks: [{ channel: "mayor/mine", query: { order: { field: "at", desc: true }, limit: 20 } }] });
  expect(await plain.p.step(obs(60), ctx)).toEqual({ type: "look", looks: [{ channel: "mayor/files" }] });

  // Something to find that can't be read: nothing is looked up, and it's told which and why, at once.
  const bad = harness([[use("a", "look", { report: "mayor/mine", find: [{ field: "kind", value: "petition" }, { field: "id; drop table", value: "x" }] })],
    [use("b", "look", { report: "mayor/town", find: [{ field: "kind", value: "house" }] })], [use("c", "look", { report: "mayor/mine", named: ["house-1"] })], [use("d", "look", { report: "mayor/books" })]], seat);
  await bad.p.step(obs(0), ctx);
  expect(bad.calls.length).toBe(2);
  expect(resultsOf(bad.calls[1]!).a).toBe('Not done: "id; drop table" isn\'t something papers can be found by.');
  expect(bad.notes.some((n) => n.malformed_tool_use)).toBe(true);
  // (A report of places isn't searched like papers, nor papers looked at like places; and its accounts aren't looked into.)
  await bad.p.step(obs(7 * DAY), ctx);
  expect(resultsOf(bad.calls[3]!).c).toBe("Not done: that report is one of papers: say what to find in it.");
  expect(shown(bad.calls[3]!)).not.toContain("drop table");
  expect(JSON.stringify(bad.calls[2]!.messages)).toContain("that report isn't one of papers to search: name the places to see, or a measure");
  await bad.p.step(obs(14 * DAY), ctx);
  expect(JSON.stringify(bad.calls.at(-1)!.messages)).toContain("that isn't one of the reports you can look at");
});

test("a mayor can find out which buildings have something building up: the survey names the worst, and a look shows them in full", async () => {
  const channels = { "mayor/town": town(9000) };
  const { p, calls } = harness([[use("a", "look", { report: "mayor/town", measure: "waste" }), use("b", "look", { report: "mayor/town", named: ["house-3"] })]], seat);
  expect(await p.step(withChannels(0, channels), ctx)).toEqual({ type: "look", looks: [{ channel: "mayor/town" }] });
  // What it read first: the survey says where, and how to see more.
  expect(shown(calls[0]!)).toContain("Waste: above zero at 1 of 40 buildings, rising at 1. Highest: house house-7 9,000 (rising 500 a day).");
  expect(shown(calls[0]!)).toContain('name the measure: look at "Survey of the town" (mayor/town).)');
  expect(await p.step(withChannels(2 * DAY, channels), ctx)).toEqual({ type: "look", looks: [{ channel: "mayor/town" }] });
  await p.step(withChannels(2 * DAY + 60, channels), ctx);
  const results = resultsOf(calls[1]!);
  // Each look's result: what was asked for, in full, as it is on the day (two days on, another 1,000).
  expect(results.a).toContain("## Survey of the town: what you looked at\nWaste is above zero or rising at 1 building, the highest first:\n- house house-7, at cell.7.0: waste 10,000, rising 500 a day\n  - house-7/dwelling.1, a dwelling: 1 person (room for 4)");
  expect(results.a).not.toContain("house-3");
  expect(results.b).toContain("- house house-3, at cell.3.0: waste 0, steady\n  - house-3/dwelling.1, a dwelling: 1 person (room for 4)");
  expect(results.b).not.toContain("house-7");
  // Nothing it reads names the machinery.
  for (const c of calls) for (const machinery of ["kernel", "translator", "resolver", "block", "channel", "refusal", "provenance", "variable", "query"]) expect(`${c.system}\n${JSON.stringify(c.messages)}\n${JSON.stringify(c.tools)}`.toLowerCase()).not.toContain(machinery);
});

test("a first report says each thing once: what the report of now repeats word for word isn't also set out as what came before", async () => {
  const sessions = { start: 9 * HOUR, end: 17 * HOUR, days: 5 };
  const { p, calls } = harness([], { ...seat, sessions });
  const channels = { "mayor/town": town(0) };
  await p.step({ ...withChannels(0, channels), inbox: [{ from: "clerk", t: 0, text: "Welcome." }] } as any, ctx); // before hours: kept
  await p.step(withChannels(9 * HOUR, channels), ctx);
  const first = shown(calls[0]!);
  expect(first).toContain("Welcome.");
  expect(first.split("## Survey of the town").length).toBe(2);
  expect(first.split("You hold a post").length).toBe(2);
});
