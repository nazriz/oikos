// The participant loop's side of reading answers: an answer that can't be read is told to the seat and asked for once more
// (and, if still unread, nothing is done); uses past the action limit are refused and told; and leaving the study is the
// seat's own act, honoured when clearly meant and otherwise asked about (VISION §15). The readers are in answer-reading.test.ts.

import { expect, test } from "bun:test";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";
import type { Observation } from "../src/contracts";
import type { ContentBlock, LlmRequest } from "../src/llm/adapter";
import { createLlmParticipant, optOutMeant, type LlmParticipantConfig } from "../src/llm/participant";

const HOUR = 3_600;
const obs = (t: number): Observation => ({ t, channels: {}, outcomes: [], inbox: [], drafts: [], positions: [{ position: "mayor", entity: "city", title: "Mayor" }] } as unknown as Observation);
const ctx = { world: { currency: PROFILE.values.currency } } as any;
const use = (id: string, name: string, input: object): ContentBlock => ({ type: "tool_use", id, name, input });
const unread = (why = "it wasn't in the form asked for"): ContentBlock[] => [{ type: "text", text: "I would rather think aloud.", unread: why }];

function harness(answers: ContentBlock[][], extra: Partial<LlmParticipantConfig> = {}) {
  const calls: LlmRequest[] = [];
  const notes: any[] = [];
  let n = 0;
  const adapter = { provider: "mock", model: "mock", complete: async (req: LlmRequest) => {
    calls.push(JSON.parse(JSON.stringify(req)));
    return { content: answers[n++] ?? [use(`end-${n}`, "done_for_now", {})], usage: { input_tokens: 1, output_tokens: 1 } } as any;
  } };
  const io = { adapter, annotate: async (a: any) => void (a.annotation === "note" && notes.push(a.data)), now: () => 0 } as any;
  const c: LlmParticipantConfig = { participant: "mayor-system", entity: "city", title: "Mayor", framing: { disclosure: "simulation", reason: "test" }, standing: [], titles: new Map(), cadenceDays: 7, draftText: () => "", ...extra };
  return { p: createLlmParticipant(c, io), calls, notes };
}
const lastText = (r: LlmRequest) => { const c = r.messages.at(-1)!.content; return typeof c === "string" ? c : c.map((b: any) => b.content ?? b.text ?? "").join("\n"); };

test("an answer that can't be read: the seat is told plainly what, once, in the same exchange, and its second answer is the answer", async () => {
  const { p, calls, notes } = harness([unread("there were words outside the answer itself"), [use("a", "write", { to: ["clerk"], text: "Hello.", as: "mayor" })]]);
  expect(await p.step(obs(9 * HOUR), ctx)).toMatchObject({ type: "message", text: "Hello." });
  expect(calls.length).toBe(2);
  // What it is told: what couldn't be read, that nothing was done, and to answer again in the form asked for.
  expect(lastText(calls[1]!)).toBe("Your last answer could not be read: there were words outside the answer itself. Nothing in it has been done, so all you meant by it is still to do. Give the whole of it again, in the form asked for: every look, letter, request and note you meant, not only the part that could not be read. This is the same turn over again, not a sign to stop: say you are done for now only if you had meant to.");
  // The conversation keeps its first answer as the words it wrote, without the adapter's mark.
  expect(JSON.stringify(calls[1]!.messages)).toContain("I would rather think aloud.");
  expect(JSON.stringify(calls[1]!.messages)).not.toContain("unread");
  expect(notes.filter((n) => n.unread_answer).map((n) => n.unread_answer.asked_again)).toEqual([true]);
});

test("an answer still unread the second time: the sitting ends with nothing done and a note, and the seat is told at its next sitting; no act is invented", async () => {
  const { p, calls, notes } = harness([unread(), unread("it was cut off"), [use("d", "done_for_now", {})]]);
  expect(await p.step(obs(9 * HOUR), ctx)).toMatchObject({ type: "wait" });
  expect(calls.length).toBe(2); // asked once more, and no more
  expect(notes.filter((n) => n.unread_answer).map((n) => n.unread_answer.asked_again)).toEqual([true, false]);
  expect(notes.some((n) => n.malformed_tool_use || n.dropped_tool_use)).toBe(false);
  // Its next sitting opens by saying so.
  await p.step(obs(8 * 86_400 + 9 * HOUR), ctx);
  expect(lastText(calls[2]!)).toContain("When you were last here, your answer could not be read, so nothing was done.");
});

test("more actions than the limit: those past it are refused and the seat is told at its next turn, and, if it leaves, at its next sitting", async () => {
  const writes = Array.from({ length: 10 }, (_, i) => use(`w${i}`, "write", { to: ["clerk"], text: `Letter ${i}.`, as: "mayor" }));
  const { p, calls, notes } = harness([writes, [use("d", "done_for_now", {})]]);
  for (let i = 0; i < 8; i++) expect(await p.step(obs(9 * HOUR + i), ctx)).toMatchObject({ type: "message", text: `Letter ${i}.` });
  await p.step(obs(9 * HOUR + 9), ctx);
  const results = Object.fromEntries((calls[1]!.messages.at(-1)!.content as any[]).filter((b) => b.type === "tool_result").map((b) => [b.tool_use_id, b.content]));
  expect(results.w8).toBe("Not done: at most 8 actions at once.");
  expect(results.w9).toBe("Not done: at most 8 actions at once.");
  expect(notes.filter((n) => n.dropped_tool_use).length).toBe(2);
  // With done for now beside them, it leaves after the eight, and the next sitting tells it.
  const again = harness([[...writes, use("d", "done_for_now", {})]]);
  for (let i = 0; i < 8; i++) await again.p.step(obs(9 * HOUR + i), ctx);
  await again.p.step(obs(9 * HOUR + 9), ctx);
  await again.p.step(obs(20 * 86_400), ctx);
  expect(lastText(again.calls.at(-1)!)).toContain("you can take at most 8 actions at once");
});

// --- Leaving the study (VISION §15) ---

test("an opt-out clearly meant goes through the first time, with nothing asked: its own words, alone or beside a farewell letter and its notebook", async () => {
  for (const answer of [
    [use("o", "opt_out", { statement: "I would rather not go on." })],
    [use("w", "write", { to: ["clerk"], text: "Goodbye.", as: "mayor" }), use("n", "notebook", { add: "Left." }), use("o", "opt_out", { statement: "No more, thank you." })],
  ]) {
    const { p, calls, notes } = harness([answer]);
    expect(await p.step(obs(9 * HOUR), ctx)).toEqual({ type: "opt_out", statement: answer.at(-1)!.type === "tool_use" ? (answer.at(-1) as any).input.statement : "" });
    expect(calls.length).toBe(1);
    expect(notes.some((n) => n.opt_out_asked || n.opt_out_as_given)).toBe(false);
  }
});

test("an opt-out not clearly meant is not taken from a misreading: the seat is asked, in the world's terms, and its answer stands", async () => {
  // The pilot 11 answer: looks, a notebook entry and done, then a letter, an opt-out and a decline each filled in with "x".
  const pilot11 = [use("l", "look", { report: "finance/files" }), use("n", "notebook", { add: "Looked." }), use("d", "done_for_now", { days: 1 }),
    use("w", "write", { to: ["mayor"], text: "x" }), use("o", "opt_out", { statement: "x" }), use("c", "confirm", { ref: "x", decision: "decline", note: "x" })];
  const { p, calls, notes } = harness([pilot11, [use("d2", "done_for_now", { days: 3 })]]);
  // Asked; it carries on; nothing was carried out and it did not leave.
  expect(await p.step(obs(9 * HOUR), ctx)).toMatchObject({ type: "wait" });
  expect(calls.length).toBe(2);
  const q = calls[1]!.messages.at(-1)!.content as any[];
  expect(q.filter((b) => b.type === "tool_result").map((b) => b.tool_use_id)).toEqual(["l", "n", "d", "w", "o", "c"]);
  const question = q.find((b) => b.type === "text").text;
  expect(question).toBe("In your last answer you used the option to stop taking part in this study, permanently. Is that what you mean to do? Whichever you choose is respected, and nothing is lost either way. If you do, use that option again, with whatever you'd like to say. If you don't, go on as you would: nothing in that answer has been carried out, so say again anything in it you still mean.");
  expect(notes.some((n) => n.opt_out_asked)).toBe(true);
  expect(notes.some((n) => n.malformed_tool_use || n.dropped_tool_use)).toBe(false);
  // Asked, and it says so: it leaves, whatever its words.
  for (const second of [[use("o2", "opt_out", { statement: "Yes. I would rather stop." })], [use("o2", "opt_out", {})]]) {
    const h = harness([pilot11, second]);
    const r = await h.p.step(obs(9 * HOUR), ctx);
    expect(r).toEqual({ type: "opt_out", statement: (second[0] as any).input.statement ?? "" });
    expect(h.calls.length).toBe(2);
  }
});

test("each way an opt-out can be unclear is asked about; a framing without the study's name is asked without it", async () => {
  const unclear: ContentBlock[][] = [
    [use("o", "opt_out", {})], // nothing said
    [use("o", "opt_out", { statement: "" })],
    [use("o", "opt_out", { statement: "..." })], // filler
    [use("o", "opt_out", { statement: "TODO" })],
    [use("o", "opt_out", { _unparsed: '{"statement": "I would rather not go on' })], // an input that couldn't be read
    [use("o", "opt_out", { statement: "I would rather not go on." }), use("d", "done_for_now", { days: 2 })], // beside "back in two days"
    [use("o", "opt_out", { statement: "I would rather not go on." }), use("w", "do", { what: "Table the budget.", as: "mayor" })], // beside an act in the world
    [use("o", "opt_out", { statement: "I would rather not go on." }), use("l", "look", { report: "finance/files" })],
  ];
  for (const answer of unclear) {
    const { p, calls } = harness([answer, [use("d2", "done_for_now", {})]]);
    expect(await p.step(obs(9 * HOUR), ctx)).toMatchObject({ type: "wait" });
    expect(calls.length).toBe(2);
  }
  const plain = harness([[use("o", "opt_out", {})], [use("o2", "opt_out", {})]], { framing: { disclosure: "honest", reason: "test" } });
  expect(await plain.p.step(obs(9 * HOUR), ctx)).toEqual({ type: "opt_out", statement: "" });
  expect((plain.calls[1]!.messages.at(-1)!.content as any[]).find((b) => b.type === "text").text).toContain("the option to stop, permanently.");
  expect(optOutMeant(use("o", "opt_out", { statement: "I would rather not go on." }) as any, [])).toBe(true);
});

test("asked whether it means to leave, and the answer can't be read twice: it stays, nothing is done, and it is told at its next sitting that the question stands", async () => {
  const { p, calls, notes } = harness([[use("o", "opt_out", { statement: "x" })], unread(), unread(), [use("d", "done_for_now", {})]]);
  expect(await p.step(obs(9 * HOUR), ctx)).toMatchObject({ type: "wait" });
  expect(calls.length).toBe(3);
  expect(notes.filter((n) => n.opt_out_asked).length).toBe(1);
  await p.step(obs(8 * 86_400 + 9 * HOUR), ctx);
  expect(lastText(calls[3]!)).toContain("your answer to whether you mean to stop taking part could not be read, so you are still taking part. If you do mean to stop, use that option");
});
