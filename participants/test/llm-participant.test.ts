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

test("a seat whose model call fails misses that sitting and sits again at its next working day's: nothing it hadn't read is lost, and it is told it missed one", async () => {
  const sessions = { start: 9 * HOUR, end: 17 * HOUR, days: 5 };
  const failed = async (step: Promise<unknown>) => { try { await step; } catch (e) { return e as ModelCallFailed; } throw new Error("the call went through"); };
  // At the start of a sitting. The failure says when the seat sits again (the run has it woken then): the next working
  // day's sitting, not its usual rhythm of a week.
  const { p, calls, notes } = harness(["fail", "fail", [use("a", "write", { to: ["clerk"], text: "Thanks.", as: "mayor" })], "fail"], { sessions });
  await p.step(obs(2 * HOUR, "an early letter"), ctx);
  const first = await failed(p.step(obs(9 * HOUR, "a letter at nine"), ctx));
  expect(first).toBeInstanceOf(ModelCallFailed);
  expect(first.message).toContain("no answer within 180 s");
  expect(first.backAt).toBe(DAY + 9 * HOUR);
  expect(notes.find((n) => n.sitting_missed)!.sitting_missed).toMatchObject({ day: 0, midway: false, back_at: DAY + 9 * HOUR, why: "model_call_failed" });
  // Woken again that day (a letter): the day's sitting is the one it missed, so no call is made, and it waits for the next.
  expect(await p.step(obs(10 * HOUR, "a letter at ten"), ctx)).toEqual({ type: "wait", until: DAY + 9 * HOUR });
  expect(calls.length).toBe(1);
  // The next day's fails too: the day after, then.
  expect((await failed(p.step(obs(DAY + 9 * HOUR, "a letter the next morning"), ctx))).backAt).toBe(2 * DAY + 9 * HOUR);
  // (What a mock's code brain reads, the observations themselves, is kept the same way.)
  expect(calls[1]!.context.missed.map((o: any) => o.t)).toEqual([2 * HOUR, 9 * HOUR, 10 * HOUR]);
  expect(await p.step(obs(2 * DAY + 9 * HOUR, "a letter on the third day"), ctx)).toMatchObject({ type: "message" });
  const third = shown(calls[2]!);
  for (const l of ["an early letter", "a letter at nine", "a letter at ten", "a letter the next morning", "a letter on the third day"]) expect(third).toContain(l);
  // Told first thing, in the world's terms, once for each sitting missed: that it was missed, and that nothing was done.
  expect(third).toContain("You missed your sitting on year 1, day 1: you were not at your desk, and nothing was read or done that day.");
  expect(third).toContain("You missed your sitting on year 1, day 2: you were not at your desk, and nothing was read or done that day.");
  expect(third.indexOf("You missed your sitting on year 1, day 1")).toBeLessThan(third.indexOf("an early letter"));
  expect(third).not.toMatch(/\bmodel|\bcall|platform|timed? ?out|no answer/i);
  // In the middle of one (its letter sent, the call for its next turn fails): the sitting ends there; what its action
  // showed, and what came after, are set out at the next day's, which says the sitting was cut short.
  const mid = await failed(p.step(obs(2 * DAY + 9 * HOUR + 60, "the clerk's reply"), ctx));
  expect(mid.backAt).toBe(3 * DAY + 9 * HOUR);
  expect(notes.filter((n) => n.sitting_missed).at(-1)!.sitting_missed).toMatchObject({ day: 2, midway: true });
  expect(await p.step(obs(2 * DAY + 12 * HOUR, "a letter at noon"), ctx)).toEqual({ type: "wait", until: 3 * DAY + 9 * HOUR });
  await p.step(obs(3 * DAY + 9 * HOUR, "a letter on the fourth day"), ctx);
  const last = calls.at(-1)!;
  expect(calls.length).toBe(5);
  expect(last.messages.length).toBe(1); // (a sitting of its own: no failed turn left in)
  for (const l of ["the clerk's reply", "a letter at noon", "a letter on the fourth day"]) expect(shown(last)).toContain(l);
  expect(shown(last)).toContain("Your sitting on year 1, day 3 was cut short: you were away from your desk after your last answer there, and nothing more was done that day.");
  expect(shown(last)).not.toContain("You missed your sitting on year 1, day 1"); // (once told, not told again)
  // With no office hours: a day on.
  const plain = harness(["fail"]);
  expect((await failed(plain.p.step(obs(5 * HOUR, "a letter"), ctx))).backAt).toBe(DAY + 5 * HOUR);
  await plain.p.step(obs(DAY + 5 * HOUR), ctx);
  expect(shown(plain.calls[1]!)).toContain("You missed your sitting on year 1, day 1");
  expect(shown(plain.calls[1]!)).toContain("a letter");
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
  const long = `${"a".repeat(7990)}0123456789 and the part that doesn't fit`;
  const { p, calls, notes } = harness([[use("n", "notebook", { text: long }), use("a", "write", { to: ["clerk"], text: "Hello." })], [use("n2", "notebook", { text: long }), use("d", "done_for_now", {})]]);
  await p.step(obs(9 * HOUR), ctx);
  await p.step(obs(9 * HOUR + 60), ctx);
  expect(resultsOf(calls[1]!).n).toBe(`Notebook updated only in part: it was too long (${long.length} characters; it holds 8000), so only the first 8000 characters were kept. It now ends: "${"a".repeat(50)}0123456789".`);
  expect(notes.find((n) => n.notebook_cut)).toEqual({ notebook_cut: { length: long.length, kept: 8000 } });
  // Said with done for now: told at the next sitting.
  await p.step(obs(8 * DAY), ctx);
  expect(shown(calls[2]!)).toContain("When you were last here, your notebook was updated only in part");
  expect(shown(calls[2]!)).toContain(`Your notebook: ${long.slice(0, 8000)}\n`);
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
    [use("b", "look", { report: "mayor/town", find: [{ field: "kind", value: "house" }] })], [use("c", "look", { report: "mayor/mine", named: ["house-1", "house-2"] })], [use("d", "look", { report: "mayor/books" })]], seat);
  await bad.p.step(obs(0), ctx);
  expect(bad.calls.length).toBe(2);
  expect(resultsOf(bad.calls[1]!).a).toBe('Not done: "id; drop table" isn\'t something papers can be found by.');
  expect(bad.notes.some((n) => n.malformed_tool_use)).toBe(true);
  // (A report of places isn't searched like papers, nor papers looked at like places; and its accounts aren't looked into.)
  await bad.p.step(obs(7 * DAY), ctx);
  expect(resultsOf(bad.calls[3]!).c).toBe("Not done: that report is one of papers: say what to find in it, or give one paper's id in paper to read it in full (one paper to a look; several looks can go in one answer).");
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

// Fewer calls and fewer words for the same office (participant 0.8.0; pilot 10): looks kept ready for every sitting, no
// turn when nothing came of looking into whole reports, and a notebook added to or changed in part.
const bill = (id: string) => ({ id, record: "statement", kind: "invoice", author: "works", at: 0, text: `Invoice ${id}.`, visible_to: "public" });
const cityBooks = (balance = 500) => ({ kind: "accounts", accounts: [{ account: "acc-city", holder: "city", custodian: "bank", balance }], transactions: [] });
/** A report after a look at "mayor/files": what was found there (nothing, if none), beside the town's books. */
const looked = (t: number, found: object[], more: object = {}, balance = 500) => ({ ...obs(t), channels: { "mayor/files": { kind: "records", records: found, search: true }, "mayor/books": cityBooks(balance) }, ...more }) as unknown as Observation;
const books = (t: number) => withChannels(t, { "mayor/books": cityBooks() });
const office = { ...seat, sessions: { start: 9 * HOUR, end: 17 * HOUR, days: 7 } };

test("a look kept ready for every sitting is looked up as each sitting opens, with no turn taken, and set out with the report; until it says no longer", async () => {
  const { p, calls, notes } = harness([
    [use("a", "look", { report: "mayor/files", current_only: true, each_sitting: true })],
    [use("d", "done_for_now", { days: 1 })],
    [use("b", "look", { report: "mayor/files", each_sitting: false }), use("w", "write", { to: ["clerk"], text: "Paid.", as: "mayor" })],
    [use("d2", "done_for_now", { days: 1 })],
    [use("d3", "done_for_now", { days: 1 })],
  ], office);
  const theLook = { type: "look", looks: [{ channel: "mayor/files", query: { standing: true, order: { field: "at", desc: true }, limit: 20 } }] };
  // It asks once: the look is made now, and it's told it is kept.
  expect(await p.step(books(9 * HOUR), ctx)).toEqual(theLook);
  await p.step(looked(9 * HOUR, [bill("rec.6")]), ctx);
  expect(resultsOf(calls[1]!).a).toContain("## The town's files: what you looked up (1 found)\n- [rec.6] invoice, ");
  expect(resultsOf(calls[1]!).a.endsWith("\n\n(From now on this is looked up for you at the start of every sitting, and set out with your report.)")).toBe(true);
  expect(notes.find((n) => n.look_each_sitting)).toEqual({ look_each_sitting: { asked: { report: "mayor/files", current_only: true }, kept: 1 } });
  // The next sitting: the same look, made before it's asked anything; then one call, shown the report and what was found.
  expect(await p.step(books(DAY + 9 * HOUR), ctx)).toEqual(theLook);
  expect(calls.length).toBe(2);
  expect(await p.step(looked(DAY + 9 * HOUR, [bill("rec.7")]), ctx)).toMatchObject({ type: "message", text: "Paid." });
  expect(calls.length).toBe(3);
  expect(calls[2]!.messages.length).toBe(1);
  const first = shown(calls[2]!);
  expect(first).toContain('## Looked up for you, as at every sitting: "The town\'s files" (mayor/files), what\'s current\n## The town\'s files: what you looked up (1 found)\n- [rec.7] invoice, ');
  // What the opening report and the look's both say is said once.
  expect(first.split("## Mayor: Books").length).toBe(2);
  expect(first.split("You hold a post").length).toBe(2);
  // (A mock's code brain reads the observations themselves: the one the sitting opened on is among them.)
  expect(calls[2]!.context.missed.map((o: any) => o.t)).toEqual([DAY + 9 * HOUR]);
  // It says no longer (naming only the report): nothing is looked up for that, and it's told.
  await p.step(obs(DAY + 9 * HOUR + 60), ctx);
  expect(resultsOf(calls[3]!).b).toBe('No longer looked up for you at each sitting: "The town\'s files" (mayor/files), what\'s current.');
  // The sitting after: no look before the call.
  await p.step(books(2 * DAY + 9 * HOUR), ctx);
  expect(calls.length).toBe(5);
  expect(shown(calls[4]!)).not.toContain("Looked up for you");
  // Nothing it reads names the machinery.
  for (const c of calls) for (const machinery of ["kernel", "translator", "resolver", "block", "channel", "refusal", "provenance", "variable", "query", "token", "cache", "simulat"]) expect(`${JSON.stringify(c.messages)}\n${JSON.stringify(c.tools)}`.toLowerCase()).not.toContain(machinery);
});

test("looks kept ready: at most six; one it makes two sittings running is said to be one it could keep; a failed call at an opening loses nothing looked up", async () => {
  const many = Array.from({ length: 7 }, (_, k) => use(`l${k}`, "look", { report: "mayor/files", find: [{ field: "kind", value: `kind-${k}` }], each_sitting: true }));
  const a = harness([many, [use("d", "done_for_now", { days: 1 })]], office);
  await a.p.step(books(9 * HOUR), ctx);
  // (Each finds nothing of its kind, so each is followed by a look through the folder for kinds like it: two steps a look.)
  for (let k = 1; k <= 14; k++) await a.p.step(looked(9 * HOUR, []), ctx);
  expect(resultsOf(a.calls[1]!).l5).toContain("(From now on this is looked up for you");
  expect(resultsOf(a.calls[1]!).l6).toContain("(Not kept for every sitting: 6 are looked up for you at each already. Have one of them no longer looked up first.)");
  // The same look at two sittings running, not kept: it's told it could be.
  const b = harness([[use("a", "look", { report: "mayor/files", find: [{ field: "from", value: "bank" }] })], [use("d", "done_for_now", { days: 1 })], [use("a2", "look", { report: "mayor/files", find: [{ field: "from", value: "bank" }] })]], office);
  await b.p.step(books(9 * HOUR), ctx);
  await b.p.step(looked(9 * HOUR, [bill("rec.1")]), ctx);
  expect(resultsOf(b.calls[1]!).a).not.toContain("each_sitting");
  await b.p.step(books(DAY + 9 * HOUR), ctx);
  await b.p.step(looked(DAY + 9 * HOUR, [bill("rec.1")]), ctx);
  expect(resultsOf(b.calls[3]!).a2).toContain("(You looked this up at your last sitting too. It can be set out for you at the start of every sitting without your asking: look at it with each_sitting.)");
  // The call at an opening fails: what was looked up for it is shown by the call that goes through, with the report.
  const f = harness([[use("a", "look", { report: "mayor/files", each_sitting: true })], [use("d", "done_for_now", { days: 1 })], "fail", [use("d2", "done_for_now", { days: 1 })]], office);
  await f.p.step(books(9 * HOUR), ctx);
  await f.p.step(looked(9 * HOUR, [bill("rec.1")]), ctx);
  await f.p.step(books(DAY + 9 * HOUR), ctx);
  await expect(f.p.step(looked(DAY + 9 * HOUR, [bill("rec.2")]), ctx)).rejects.toThrow("no answer within 180 s");
  // (That day's sitting is missed: it sits the next working day.)
  expect(await f.p.step(books(DAY + 10 * HOUR), ctx)).toEqual({ type: "wait", until: 2 * DAY + 9 * HOUR });
  expect(await f.p.step(books(2 * DAY + 9 * HOUR), ctx)).toMatchObject({ type: "look" });
  await f.p.step(looked(2 * DAY + 9 * HOUR, [bill("rec.3")]), ctx);
  expect(f.calls.length).toBe(4);
  expect(shown(f.calls[3]!)).toContain("Invoice rec.2.");
  expect(shown(f.calls[3]!)).toContain("Invoice rec.3.");
});

test("nothing came of looking into whole reports: no turn is taken to say so; the sitting ends, it's back as it last arranged, and told at its next", async () => {
  const { p, calls, notes } = harness([
    [use("d", "done_for_now", { days: 3 })],
    [use("a", "look", { report: "mayor/files", current_only: true }), use("n", "notebook", { add: "Looked on day 4." })],
    [use("d2", "done_for_now", {})],
  ], office);
  expect(await p.step(books(9 * HOUR), ctx)).toEqual({ type: "wait", until: DAY + 9 * HOUR });
  await p.step(books(3 * DAY + 9 * HOUR), ctx);
  // The look finds nothing, and nothing else has come: no call. Back after three days, as it last gave.
  expect(await p.step(looked(3 * DAY + 9 * HOUR, []), ctx)).toEqual({ type: "wait", until: 4 * DAY + 9 * HOUR });
  expect(calls.length).toBe(2);
  expect(notes.find((n) => n.no_turn)).toEqual({ no_turn: { looks_that_found_nothing: 1, back_after_days: 3 } });
  expect(await p.step(books(4 * DAY + 9 * HOUR), ctx)).toEqual({ type: "wait", until: 6 * DAY + 9 * HOUR });
  expect(calls.length).toBe(2);
  // At its next sitting: that the sitting ended there, what the look showed, and its notebook as it left it.
  await p.step(books(6 * DAY + 9 * HOUR), ctx);
  const next = shown(calls[2]!);
  expect(next).toContain("When you were last here, there was nothing in what you looked into, so the sitting ended there.");
  expect(next).toContain("## The town's files: what you looked up (0 found)\nNothing found.");
  expect(next).toContain("Your notebook: Looked on day 4.\n(16 of the 8,000 characters it holds are used.)");

  // A turn follows whenever something came of it: something found; a letter in; money moved; something to find named
  // (that nothing was found answers a question); another act beside the look.
  const turn = async (first: ContentBlock[], result: Observation) => {
    const h = harness([first], office);
    await h.p.step(books(9 * HOUR), ctx);
    for (const u of first.slice(1)) if (u.type === "tool_use" && u.name !== "notebook") await h.p.step(books(9 * HOUR), ctx);
    await h.p.step(result, ctx);
    return h.calls.length;
  };
  const whole = use("a", "look", { report: "mayor/files" });
  expect(await turn([whole], looked(9 * HOUR, []))).toBe(1);
  expect(await turn([whole], looked(9 * HOUR, [bill("rec.9")]))).toBe(2);
  expect(await turn([whole], looked(9 * HOUR, [], { inbox: [{ from: "clerk", t: 0, text: "A word." }] }))).toBe(2);
  expect(await turn([whole], looked(9 * HOUR, [], {}, 400))).toBe(2);
  expect(await turn([use("a", "look", { report: "mayor/files", find: [{ field: "from", value: "bank" }] })], looked(9 * HOUR, []))).toBe(2);
  expect(await turn([use("w", "write", { to: ["clerk"], text: "Anything in?", as: "mayor" }), whole], looked(9 * HOUR, []))).toBe(2);
});

test("a sitting that found nothing new is not sent away for longer than its office's rhythm (the days it gave at its last were a plan for one thing), and takes its turn if something falls due on its books before then", async () => {
  // (Pilot 7A: finance gave 17 days for a return due on day 51, was back on day 49, found nothing new, and was sent away
  // 17 days more.)
  const open = (days: number[]) => [{ record: "statement", kind: "office_books", id: "rec.b", author: "mayor-system", speaks_for: "city", at: 0, text: "The books of the office.", visible_to: "public", data: { office: "mayor", at: 0, open: days.map((d) => ({ what: "Returns", about: `r-${d}`, says: "A return.", due: d * DAY })) } }];
  const sit = (t: number, days: number[]) => withChannels(t, { "mayor/books": cityBooks(), "mayor/office-books": { kind: "records", records: open(days) } as any });
  const run = async (due: number[]) => {
    const h = harness([[use("d", "done_for_now", { days: 17 })], [use("a", "look", { report: "mayor/files", current_only: true })], [use("d2", "done_for_now", { days: 1 })]], office);
    await h.p.step(sit(9 * HOUR, due), ctx);
    expect(await h.p.step(sit(17 * DAY + 9 * HOUR, due), ctx)).toMatchObject({ type: "look" });
    return { h, end: await h.p.step(looked(17 * DAY + 9 * HOUR, []), ctx) };
  };
  // Nothing falls due: back after the office's rhythm (7 days), not 17 again.
  const quietly = await run([]);
  expect(quietly.end).toEqual({ type: "wait", until: 18 * DAY + 9 * HOUR });
  expect(quietly.h.calls.length).toBe(2);
  expect(quietly.h.notes.find((n) => n.no_turn)).toEqual({ no_turn: { looks_that_found_nothing: 1, back_after_days: 7 } });
  // A return falls due in two days: no sitting ends on nothing new; the turn is taken.
  const due = await run([19]);
  expect(due.end).toMatchObject({ type: "wait" });
  expect(due.h.calls.length).toBe(3);
  expect(due.h.notes.find((n) => n.no_turn)).toBeUndefined();
});

test("the notebook is added to, or changed where a passage stands, without writing it all out; what wouldn't fit isn't put in, and it's told", async () => {
  const { editNotebook } = await import("../src/llm/participant");
  expect(editNotebook("", { add: "Day 1: nothing owing." })).toMatchObject({ text: "Day 1: nothing owing.", problems: [] });
  expect(editNotebook("Day 1: nothing owing.", { add: "Day 2: one invoice." }).text).toBe("Day 1: nothing owing.\nDay 2: one invoice.");
  // A passage changed, and one struck out; then the addition: in that order, whatever order they were written in.
  expect(editNotebook("Waiting on the bank. Budget: none yet.", { add: "Asked again.", change: [{ from: "none yet", to: "adopted day 9" }, { from: "Waiting on the bank. ", to: "" }] }).text).toBe("Budget: adopted day 9.\nAsked again.");
  // Written afresh, as before: everything is replaced (and then added to, if that's asked too).
  expect(editNotebook("Old.", { text: "New.", add: "And this." }).text).toBe("New.\nAnd this.");
  // A passage that isn't there, or is there twice: not changed, and said; the rest of the use is done.
  const e = editNotebook("Paid the works. Paid the works twice.", { change: [{ from: "Paid the clerk", to: "x" }, { from: "Paid the works", to: "x" }, { from: "twice", to: "once" }, { to: "nothing" }] });
  expect(e.text).toBe("Paid the works. Paid the works once.");
  expect(e.problems).toEqual(['it doesn\'t say "Paid the clerk" (a passage to change is given word for word)', 'it says "Paid the works" more than once (give more of the passage)', "a change couldn't be read (it gives a passage as it stands, and what it should say instead)"]);
  // The limit: nothing is put in that doesn't fit, and nothing is cut to make room.
  const full = "a".repeat(7990);
  const over = editNotebook(full, { add: "0123456789 and more" });
  expect(over.text).toBe(full);
  expect(over.problems).toEqual(['there wasn\'t room to add "0123456789 and more": it holds 8000 characters and has 7990, so 9 are free (strike something out, or write it afresh, shorter)']);
  expect(editNotebook(full, { add: "123456789" }).text.length).toBe(8000);
  expect(editNotebook(`${full}bbbbbbbbbb`, { change: [{ from: "bbbbbbbbbb", to: "ccccccccccc" }] }).problems).toEqual(['changing "bbbbbbbbbb" would make it 8001 characters, and it holds 8000']);
  expect(editNotebook("Kept.", {}).read).toBe(false);

  // Through a sitting: said in the same sitting if a turn follows, and it's recorded; the notebook it's shown next is as left.
  const { p, calls, notes } = harness([
    [use("n", "notebook", { text: full }), use("w", "write", { to: ["clerk"], text: "Hello.", as: "mayor" })],
    [use("n2", "notebook", { add: "0123456789 and more" }), use("n3", "notebook", { change: [{ from: "aaaaaaaaaa", to: "b" }] }), use("n4", "notebook", { change: [{ from: full, to: "Short." }], add: "Day 2." }), use("w2", "write", { to: ["clerk"], text: "Again.", as: "mayor" })],
    [use("d", "done_for_now", {})],
  ]);
  await p.step(obs(9 * HOUR), ctx);
  await p.step(obs(9 * HOUR + 60), ctx);
  await p.step(obs(9 * HOUR + 120), ctx);
  const r = resultsOf(calls[2]!);
  expect(r.n2).toBe('Notebook not updated: there wasn\'t room to add "0123456789 and more": it holds 8000 characters and has 7990, so 9 are free (strike something out, or write it afresh, shorter). It still says what it said before.');
  expect(r.n3).toContain("Notebook not updated: it says \"aaaaaaaaaa\" more than once");
  expect(r.n4).toBe("Notebook updated.");
  expect(notes.filter((n) => n.notebook_not_changed).length).toBe(2);
  await p.step(obs(8 * DAY), ctx);
  expect(shown(calls[3]!)).toContain("Your notebook: Short.\nDay 2.\n(13 of the 8,000 characters it holds are used.)\n");
});

test("who's who is looked up by name, a register someone else keeps is asked about one named thing, and a board is searched: a look that names nothing is answered in words, never with everything", async () => {
  // (docs/design/knowing.md: until 2026-10-08 a seat was shown the whole directory and could read a register through.)
  const ways = new Map<string, { way: string; by?: string[]; board?: boolean }>([["mayor/who", { way: "ask" }], ["mayor/titles", { way: "ask", by: ["id", "about.object"] }], ["mayor/jobs", { way: "published", board: true }], ["mayor/files", { way: "mine" }]]);
  const office = { ...seat, ways, kinds: new Map([...seat.kinds, ["mayor/titles", "records"], ["mayor/jobs", "records"]]), onRequest: ["mayor/files", "mayor/titles", "mayor/jobs"],
    titles: new Map([...seat.titles, ["mayor/titles", "The land register (ask the registry)"], ["mayor/jobs", "Jobs advertised"]]) };
  const { tools } = await import("../src/llm/participant");
  const said = tools({ participant: "mayor-system", entity: "city", framing: { disclosure: "simulation", reason: "test" }, cadenceDays: 7, draftText: () => "", ...office } as any).find((x) => x.name === "look")!.description;
  expect(said).toContain("Nobody is shown it: name who you're looking for");
  expect(said).toContain('"The land register (ask the registry)" (mayor/titles): say which one, by id (its own number) or about.object (what it is a title to)');
  const { p, calls } = harness([
    [use("a", "look", { report: "mayor/who", named: ["finance", "Ada Lovelace"] })],
    [use("b", "look", { report: "mayor/who" }), use("c", "look", { report: "mayor/titles" }), use("d", "look", { report: "mayor/titles", find: [{ field: "date", op: ">", value: "day 1" }] }),
      use("e", "look", { report: "mayor/titles", find: [{ field: "about.object", value: "lot-12" }] })],
    [use("f", "look", { report: "mayor/jobs" })],
  ], office);
  // Named: one look-up each.
  expect(await p.step(obs(0), ctx)).toEqual({ type: "look", looks: [{ channel: "mayor/who", who: { name: "finance" } }, { channel: "mayor/who", who: { name: "Ada Lovelace" } }] });
  // Nobody named, no lot or title named, only a date: none of these is sent; the one that names its lot is.
  expect(await p.step(obs(60), ctx)).toEqual({ type: "look", looks: [{ channel: "mayor/titles", query: { where: [{ field: "about.object", op: "=", value: "lot-12" }], order: { field: "at", desc: true }, limit: 20 } }] });
  // A board with nothing to find: its latest few, as a search (it is never read through).
  const next = await p.step(obs(120), ctx);
  expect(next).toEqual({ type: "look", looks: [{ channel: "mayor/jobs", query: { order: { field: "at", desc: true }, limit: 20 } }] });
  const told = shown(calls.at(-1)!);
  expect(told).toContain("nobody is shown who's who: say whom you are looking for");
  expect(told).toContain("whoever keeps that register answers a question about one thing, never everything: say which, by id (its own number) or about.object (what it is a title to)");
});
