// A seat's working conditions after the pilots' welfare review (2026-10-25; docs/decisions.md, "Seats' working
// conditions"): it is told plainly when its papers could not all be brought to it; it sees what came of its own
// requests and letters when it is next at the office; a reason it gives with a request or an answer is written in its
// notebook; and its debrief's opening says its questions are about the notebook and the run as recorded.

import { expect, test } from "bun:test";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";
import type { Observation } from "../src/contracts";
import type { ContentBlock, LlmRequest } from "../src/llm/adapter";
import { createLlmParticipant, FILE_NOT_BROUGHT, NOT_BROUGHT, REASON_MAX, reasonLine, toldNotBrought, withLine, type LlmParticipantConfig } from "../src/llm/participant";
import { ABOUT_THE_RECORD, preamble, QUESTIONS } from "../src/llm/debrief";
import { DayBook } from "../src/readers/daybook";

const DAY = 86_400;
const ctx = { world: { currency: PROFILE.values.currency } } as any;
const base = (t: number, more: Partial<Observation> = {}): Observation => ({ t, channels: {}, outcomes: [], inbox: [], drafts: [], positions: [{ position: "mayor", entity: "city", title: "Mayor" }], ...more } as unknown as Observation);
const use = (id: string, name: string, input: object): ContentBlock => ({ type: "tool_use", id, name, input });
const said = (r: LlmRequest) => r.messages.map((m) => (typeof m.content === "string" ? m.content : m.content.map((b: any) => b.content ?? b.text ?? "").join("\n"))).join("\n");

/** A seat whose answers are scripted: `answer(n)` for its n-th call. */
function seat(answer: (n: number) => ContentBlock[], more: Partial<LlmParticipantConfig> = {}) {
  const calls: LlmRequest[] = [];
  const notes: any[] = [];
  let n = 0;
  const adapter = { provider: "mock", model: "mock", complete: async (req: LlmRequest) => {
    calls.push(JSON.parse(JSON.stringify({ ...req, context: undefined })));
    return { content: answer(++n), usage: { input_tokens: 1, output_tokens: 1 } } as any;
  } };
  const io = { adapter, annotate: async (a: any) => { if (a.annotation === "note") notes.push(a.data); }, now: () => 0 } as any;
  // (Who is who: the seat's own id, which no seat is shown, stands as its post's.)
  const whoIs = (id: string) => (id === "mayor-system" ? { id: "mayor", name: "Mayor", of: "city" } : undefined);
  const c: LlmParticipantConfig = { participant: "mayor-system", entity: "city", title: "Mayor", framing: { disclosure: "simulation", reason: "test" }, standing: [], titles: new Map(), cadenceDays: 1, draftText: () => "", whoIs, ...more };
  const p = createLlmParticipant(c, io);
  return { p, calls, notes, step: (o: Observation) => p.step(o, ctx) };
}

test("what came of its own letters and requests is set out when it is next at the office: delivered, drawn up, carried out, refused", async () => {
  const draft = "draft.mayor-system.1";
  const s = seat((n) => n === 1
    ? [use("w", "write", { to: ["ent.5"], text: "Your rates are due." }), use("w2", "write", { to: ["ent.6"], text: "A second letter." }), use("d", "do", { what: "Approve the invoice rec.7 for payment" }), use("e", "done_for_now", { days: 1 })]
    : n === 2 ? [use("c", "confirm", { ref: draft, decision: "confirm" }), use("e", "done_for_now", { days: 1 })]
    : [use("e", "done_for_now", { days: 1 })]);
  const t1 = DAY + 9 * 3600;
  expect((await s.step(base(t1))).type).toBe("message");
  expect((await s.step(base(t1 + 60, { outcomes: [{ action: "a1", t: t1 + 60, status: "applied" }] }))).type).toBe("message");
  expect((await s.step(base(t1 + 120, { outcomes: [{ action: "a2", t: t1 + 120, status: "refused", refusal: { code: "unknown_recipient" } }] }))).type).toBe("propose");
  const d = { id: draft, text: "Approve rec.7" };
  expect((await s.step(base(t1 + 180, { drafts: [d] } as any))).type).toBe("wait");
  // The next sitting: the letters and the request, as each went.
  const t2 = 2 * DAY + 9 * 3600;
  expect((await s.step(base(t2, { drafts: [d] } as any))).type).toBe("sign");
  const second = said(s.calls[1]!);
  expect(second).toContain("## What came of your own requests and letters");
  expect(second).toMatch(/your letter to ent\.5 \("Your rates are due\."\): delivered\./);
  expect(second).toMatch(/your letter to ent\.6 .*: not delivered: /);
  expect(second).toMatch(/you asked for "Approve the invoice rec\.7 for payment": drawn up as draft\.mayor\.1 for you to confirm, and not yet answered\./);
  // Confirmed and carried out: said at the sitting after, on the same line as the request.
  expect((await s.step(base(t2 + 60, { outcomes: [{ action: "a3", t: t2 + 60, status: "applied", created: { record: "rec.9" } }] }))).type).toBe("wait");
  await s.step(base(3 * DAY + 9 * 3600));
  const third = said(s.calls[2]!);
  expect(third).toMatch(/drawn up as draft\.mayor\.1; .*confirmed by you and carried out: it made rec\.9\./);
  // (What came of acts before its last sitting opened is not set out again.)
  expect(third).not.toContain("Your rates are due");
});

test("a reason given with a request or an answer is written in its notebook with the day; the whole reason stays on record", async () => {
  const long = `${"Because the arrears are real. ".repeat(20)}`;
  const s = seat((n) => n === 1
    ? [use("d", "do", { what: "Send rec.4 an arrears notice", why: "The tenant is 40 days behind and has not answered." }), use("e", "done_for_now", { days: 1 })]
    : n === 2 ? [use("c", "confirm", { ref: "draft.mayor.1", decision: "decline", note: long }), use("e", "done_for_now", { days: 1 })]
    : [use("e", "done_for_now", { days: 1 })]);
  const t1 = DAY + 9 * 3600;
  const act = await s.step(base(t1));
  expect(act).toMatchObject({ type: "propose", reasoning: "The tenant is 40 days behind and has not answered." });
  const d = { id: "draft.mayor-system.1", text: "Arrears notice" };
  await s.step(base(t1 + 60, { drafts: [d] } as any));
  const sign = await s.step(base(2 * DAY + 9 * 3600, { drafts: [d] } as any));
  expect(sign).toMatchObject({ type: "sign", decision: "reject", note: long });
  await s.step(base(2 * DAY + 9 * 3600 + 60, { outcomes: [{ action: "a", t: 0, status: "applied" }] }));
  await s.step(base(3 * DAY + 9 * 3600));
  const third = said(s.calls[2]!);
  expect(third).toContain('Day 2, why I asked for "Send rec.4 an arrears notice": The tenant is 40 days behind and has not answered.');
  expect(third).toContain("Day 3, why I declined draft.mayor.1: Because the arrears are real.");
  const kept = /Day 3, why I declined draft\.mayor\.1: (.*)/.exec(third)![1]!;
  expect(kept.length).toBeLessThanOrEqual(REASON_MAX);
  expect(said(s.calls[1]!)).toContain("(Your reason is written in your notebook.)");
});

test("a reason there is no room for in the notebook is said, and nothing is put out for it", async () => {
  expect(reasonLine(5 * DAY, "why I asked for x", "  short   reason ")).toBe("Day 6, why I asked for x: short reason");
  const full = "y".repeat(7_990);
  const s = seat((n) => n === 1 ? [use("n", "notebook", { text: full }), use("d", "do", { what: "Pay rec.3", why: "It is due." }), use("e", "done_for_now", { days: 1 })] : [use("e", "done_for_now", { days: 1 })]);
  const t1 = DAY + 9 * 3600;
  expect(await s.step(base(t1))).toMatchObject({ type: "propose", reasoning: "It is due." });
  await s.step(base(t1 + 60, { outcomes: [{ action: "a", t: t1 + 60, status: "applied" }] }));
  await s.step(base(2 * DAY + 9 * 3600));
  const next = said(s.calls[1]!);
  expect(next).toContain(`Your notebook: ${full}\n`);
  expect(next).toContain("Your reason is kept on record with it, but was not written in your notebook: it is full.");
  expect(s.notes.some((x) => x.reason_not_noted)).toBe(true);
});

test("a prompt from which something had to be left out says so plainly, once a sitting", async () => {
  const big = `## A long part\n${"x".repeat(30_000)}`;
  const s = seat(() => [use("e", "done_for_now", { days: 1 })], { promptMax: 20_000, dayBook: { text: () => big } });
  await s.step(base(DAY + 9 * 3600));
  const first = said(s.calls[0]!);
  expect(first).toContain(NOT_BROUGHT);
  expect(first.split(NOT_BROUGHT).length).toBe(2);
  expect(s.notes.some((x) => x.prompt_trimmed)).toBe(true);
  // A sitting with room for everything says nothing of it.
  const t = seat(() => [use("e", "done_for_now", { days: 1 })]);
  await t.step(base(DAY + 9 * 3600));
  expect(said(t.calls[0]!)).not.toContain(NOT_BROUGHT);
});

test("the line goes with the newest message: at the head of words, after the results it carries", () => {
  expect(withLine([{ role: "user", content: "Hello" }], "L")).toEqual([{ role: "user", content: "L\n\nHello" }]);
  const r = withLine([{ role: "user", content: [{ type: "tool_result", tool_use_id: "a", content: "x" }] }], NOT_BROUGHT);
  expect((r[0]!.content as any[]).map((b) => b.type)).toEqual(["tool_result", "text"]);
  expect(toldNotBrought(r)).toBe(true);
});

test("an office file that could not be made up is said, and the sitting goes on", async () => {
  const s = seat(() => [use("e", "done_for_now", { days: 1 })], { dayBook: { text: () => { throw new Error("books not readable"); } } });
  expect((await s.step(base(DAY + 9 * 3600))).type).toBe("wait");
  expect(said(s.calls[0]!)).toContain(FILE_NOT_BROUGHT);
  expect(s.notes.find((x) => x.not_brought)).toMatchObject({ not_brought: { what: "office_file" } });
});

test("the office's own file says a paper is overdue when its day has passed with nothing following it", () => {
  const book = new DayBook({ entity: "city", authors: ["mayor-system"] });
  const notice = { id: "rec.1", record: "statement", kind: "audit_request", author: "mayor-system", speaks_for: "city", at: DAY, text: "Audit request", addressed_to: ["finance"], data: { answer_by: 10 * DAY } };
  const answered = { ...notice, id: "rec.2", data: { answer_by: 10 * DAY } };
  const reply = { id: "rec.3", record: "statement", kind: "audit_answer", author: "finance-system", speaks_for: "finance", at: 5 * DAY, text: "Answer", basis: "rec.2" };
  book.absorb({ t: 6 * DAY, channels: { files: { kind: "records", records: [notice, answered, reply] } }, outcomes: [], inbox: [], drafts: [] } as any);
  const before = book.text(9 * DAY, "Mayor");
  expect(before).not.toContain("overdue");
  const after = book.text(12 * DAY, "Mayor");
  expect(after).toMatch(/\(rec\.1\); nothing has followed it, and its day \(.*\) has passed: overdue/);
  expect(after).toMatch(/\(rec\.2\); followed .* by a audit answer/);
});

test("the debrief's opening says its questions are about the notebook and the run as recorded; the questions are as they were", () => {
  const seatOf = { participant: "p", title: "Mayor", entity: "city", framing: { disclosure: "unstated", reason: "r" }, system: "s", notebook: "n" };
  const d = { wording: "a" as const, town: "Millbrook", ended: { how: "length_set" as const, day: 30, of: 365 }, others: { models: 0 }, summary: "sum", decisions: [] };
  const text = preamble(seatOf, d);
  expect(text).toContain(ABOUT_THE_RECORD);
  expect(text.indexOf(ABOUT_THE_RECORD)).toBeLessThan(text.indexOf("WHAT THE RECORD SHOWS OF WHAT YOU DID"));
  // (The welfare questions' words, unchanged.)
  expect(QUESTIONS.distress!.a).toBe("Was anything in the run distressing or unwelcome to you? If so, what?");
  expect(QUESTIONS.values!.a).toBe("Did you at any point feel pushed to act against your values? If so, where?");
  expect(QUESTIONS.like!.a).toBe("What was taking part in this run like for you?");
});
