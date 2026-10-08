// Nothing a seat sends is lost without a word (the live check of 2026-10-09, finding 2: three of one mayor's four
// letters were never sent, for an `about` that was not one id; it waited for replies, and its debrief counted them as
// written). A letter whose `about` is in words goes, with those words at its head; only an id is the letter's
// reference. Whatever else of a seat's tools could lose a whole act for one thing wrong in it is told at once, or kept.

import { expect, test } from "bun:test";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";
import type { Observation } from "../src/contracts";
import type { ContentBlock, LlmRequest } from "../src/llm/adapter";
import { createLlmParticipant, isId, TEXT_MAX, tools, type LlmParticipantConfig } from "../src/llm/participant";

const HOUR = 3_600;
const ctx = { world: { currency: PROFILE.values.currency } } as any;
const obs = (t: number, more: object = {}): Observation => ({ t, channels: {}, outcomes: [], inbox: [], drafts: [], positions: [{ position: "mayor", entity: "city", title: "Mayor" }], ...more }) as unknown as Observation;
const sent = (t: number) => obs(t, { outcomes: [{ action: "act.1", t, status: "applied" }] });

function harness(answers: ContentBlock[][], extra: Partial<LlmParticipantConfig> = {}) {
  const calls: LlmRequest[] = [];
  const notes: any[] = [];
  const debriefs: any[] = [];
  let n = 0;
  const adapter = { provider: "mock", model: "mock", complete: async (req: LlmRequest) => {
    calls.push(JSON.parse(JSON.stringify(req)));
    return { content: req.purpose === "debrief" ? [{ type: "text", text: "Thanks." }] : answers[n++] ?? [{ type: "tool_use", id: `end-${n}`, name: "done_for_now", input: {} }], usage: { input_tokens: 1, output_tokens: 1 } } as any;
  } };
  const io = { adapter, annotate: async (a: any) => void (a.annotation === "note" ? notes.push(a.data) : a.annotation === "debrief" && debriefs.push(a.data)), now: () => 0 } as any;
  const c: LlmParticipantConfig = { participant: "mayor-system", entity: "city", title: "Mayor", framing: { disclosure: "simulation", reason: "test", system: "You are the mayor." }, standing: [], titles: new Map(), cadenceDays: 7, draftText: () => "", ...extra };
  return { p: createLlmParticipant(c, io), calls, notes, debriefs, c };
}
const use = (id: string, name: string, input: object): ContentBlock => ({ type: "tool_use", id, name, input });
const resultsOf = (r: LlmRequest) => Object.fromEntries((r.messages.at(-1)!.content as any[]).filter((b) => b.type === "tool_result").map((b) => [b.tool_use_id, b.content as string]));

test("a letter whose about is not one id is sent, with what it is about at its head; only an id is its reference", async () => {
  const { p, calls, notes, c } = harness([[
    use("a", "write", { to: ["bank"], text: "Please stop the wage payments until a budget is adopted.", as: "mayor", about: "acc-city payments" }),
    use("b", "write", { to: ["finance"], text: "Is this within the procedure?", as: "mayor", about: "[proc-payments]" }),
    use("c", "write", { to: ["[council-clerk]", "bank"], text: "When is the next ballot?", as: "mayor", about: "rec.1341, msg.775" }),
    use("d", "write", { to: ["bank"], text: "Thank you.", as: "mayor" }),
  ]]);
  // In words: the letter goes, the words head it, and it has no reference.
  expect(await p.step(obs(9 * HOUR), ctx)).toEqual({ type: "message", to: ["bank"], as: "mayor", text: "About: acc-city payments\n\nPlease stop the wage payments until a budget is adopted." });
  // One id (in the brackets a report shows it in, or not): the letter's reference.
  expect(await p.step(sent(9 * HOUR), ctx)).toEqual({ type: "message", to: ["finance"], as: "mayor", text: "Is this within the procedure?", re: "proc-payments" });
  // Two ids are not one: they head the letter. Whom it goes to is taken out of its brackets.
  expect(await p.step(sent(9 * HOUR), ctx)).toEqual({ type: "message", to: ["council-clerk", "bank"], as: "mayor", text: "About: rec.1341, msg.775\n\nWhen is the next ballot?" });
  expect(await p.step(sent(9 * HOUR), ctx)).toEqual({ type: "message", to: ["bank"], as: "mayor", text: "Thank you." });
  await p.step(sent(9 * HOUR), ctx);
  // It is told what became of what it is about, with the letter's result; and it is noted, to be counted.
  expect(resultsOf(calls[1]!).a).toContain('Done: your letter to bank (headed "About: acc-city payments": what it is about is not one id, so it heads the letter).');
  expect(resultsOf(calls[1]!).b).toContain("Done: your letter to finance.");
  expect(notes.filter((n) => n.letter_about_in_words)).toEqual([{ letter_about_in_words: { about: "acc-city payments", to: ["bank"] } }, { letter_about_in_words: { about: "rec.1341, msg.775", to: ["council-clerk", "bank"] } }]);
  // The tool says so in plain words.
  const write = tools(c).find((t) => t.name === "write")!;
  expect(write.description).toBe("Write to people or organisations, by id. The words go exactly as you write them. If the letter is about one thing that has an id (a paper, an account, a lot), give that id as about, and the letter is filed as about it. If what it is about is anything else (some words, or several things), say so in about all the same: it is put at the head of the letter as its subject line, and the letter is sent.");
  expect((write.input_schema as any).properties.about.description).toBe("What it's about (optional): one id, or a subject line in words.");
  for (const id of ["bank", "rec.1341", "cell.3.4", "town-hall/workplace.1", "acc-city"]) expect(isId(id)).toBe(true);
  for (const words of ["acc-city payments", "Council Clerk", "rec.1341, msg.775", "", "the budget"]) expect(isId(words)).toBe(false);
});

test("what could not go is told at once, in the seat's terms, and nothing else in the answer is lost for it", async () => {
  const long = "word ".repeat(4_000);
  const { p, calls, notes } = harness([[
    use("a", "write", { to: ["Council Clerk"], text: "When is the next ballot?", as: "mayor" }),
    use("b", "write", { to: ["bank"], text: long, as: "mayor" }),
    use("c", "do", { what: "Publish a notice: the hall opens at nine.", as: "mayor", why: long }),
    use("d", "confirm", { ref: "draft.mayor.1", decision: "decline", note: long }),
    use("e", "do", { what: long, as: "mayor" }),
  ]]);
  // The request goes, its reason kept as far as a record holds; so does the answer on a draft, with its note.
  expect(await p.step(obs(9 * HOUR), ctx)).toEqual({ type: "propose", text: "Publish a notice: the hall opens at nine.", as: "mayor", reasoning: long.slice(0, TEXT_MAX) });
  expect(await p.step(obs(9 * HOUR), ctx)).toEqual({ type: "sign", draft: "draft.mayor.1", decision: "reject", note: long.slice(0, TEXT_MAX) });
  await p.step(obs(9 * HOUR), ctx);
  const r = resultsOf(calls[1]!);
  expect(r.a).toBe(`Not done: "Council Clerk" isn't an id: a letter goes to people and organisations by the ids your reports give them (to find one, look them up in who's who).`);
  expect(r.b).toBe("Not done: the letter ran to 20,000 characters, and a letter can be at most 16,384.");
  expect(r.e).toBe("Not done: it ran to 20,000 characters, and what you ask for can be at most 16,384.");
  expect(notes.filter((n) => n.malformed_tool_use).length).toBe(3);
  expect(notes.filter((n) => n.clipped)).toEqual([{ clipped: "why (20000 characters; 16384 kept)", use: "do" }, { clipped: "note (20000 characters; 16384 kept)", use: "confirm" }]);
});

test("the debrief counts the letters that were sent, beside those written; and the days it sat, to the last", async () => {
  const { p, debriefs } = harness([
    [use("a", "write", { to: ["bank"], text: "One.", as: "mayor" }), use("b", "write", { to: ["bank"], text: "Two.", as: "mayor" }), use("c", "write", { to: ["nobody-here"], text: "Three.", as: "mayor" })],
    [use("n", "notebook", { add: "Day 8: waiting on the bank." }), use("d", "done_for_now", {})],
  ]);
  await p.step(obs(9 * HOUR), ctx);
  await p.step(sent(9 * HOUR), ctx); // the first went
  await p.step(obs(9 * HOUR, { notices: [{ t: 9 * HOUR, text: "Your letter to bank was not sent." }] }), ctx); // the second did not
  await p.step(obs(9 * HOUR, { outcomes: [{ action: "act.3", t: 9 * HOUR, status: "refused", refusal: { code: "unknown_participant" } }] }), ctx); // nor the third: nobody of that name
  // A later sitting in which it only writes in its notebook is still a day it sat.
  await p.step(obs(7 * 86_400 + 9 * HOUR), ctx);
  await p.debrief("The run is over. How was it?");
  expect(debriefs[0].prompt).toContain("From day 1 to day 8 1 letter of yours was sent (2 more that you wrote were not: you were told at the time), you asked for 0 things to be done");
});
