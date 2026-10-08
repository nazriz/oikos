// A paper filed with an office brings its seat back (participants/src/llm/participant.ts; docs/real-models.md, "What
// brings a seat back"). Only a letter did: a proposal put to the clerk, an application, a complaint waited for the day
// the seat had chosen, and seats chose a week, so a ballot took three weeks and a works seat read complaints seven days
// late (the live checks of 2026-10-09). A real office opens its in-tray every working day.

import { expect, test } from "bun:test";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";
import type { Observation } from "../src/contracts";
import type { ContentBlock, LlmRequest } from "../src/llm/adapter";
import { createLlmParticipant, tools, type LlmParticipantConfig } from "../src/llm/participant";

const DAY = 86_400;
const HOUR = 3_600;
const ctx = { world: { currency: PROFILE.values.currency } } as any;
const use = (id: string, name: string, input: object): ContentBlock => ({ type: "tool_use", id, name, input });
const paper = (id: string, kind: string, at: number, more: object = {}) => ({ id, record: "statement", kind, author: "mayor-system", speaks_for: "city", at, text: `${kind} ${id}.`, visible_to: ["city"], addressed_to: ["city"], ...more });
/** What the clerk is shown at a time: what has come into its in-tray (proposals) and into the town's files. */
const at = (t: number, tray: object[] = [], files: object[] = []): Observation => ({ t, channels: { "council-clerk/proposals": { kind: "records", records: tray }, "council-clerk/business": { kind: "records", records: files } }, outcomes: [], inbox: [], drafts: [],
  positions: [{ position: "council-clerk", entity: "city", title: "Council clerk" }] }) as unknown as Observation;
const seat: Partial<LlmParticipantConfig> = { sessions: { start: 9 * HOUR, end: 17 * HOUR, days: 5 }, trays: { kinds: new Map([["council-clerk/proposals", true as const]]), all: new Set(["council-clerk/business"]) }, ownAuthors: ["council-clerk-staff-system"] };

function harness(answers: ContentBlock[][], extra: Partial<LlmParticipantConfig> = {}) {
  const calls: LlmRequest[] = [];
  const notes: any[] = [];
  let n = 0;
  const adapter = { provider: "mock", model: "mock", complete: async (req: LlmRequest) => {
    calls.push(JSON.parse(JSON.stringify(req)));
    return { content: answers[n++] ?? [use(`end-${n}`, "done_for_now", { days: 7 })], usage: { input_tokens: 1, output_tokens: 1 } } as any;
  } };
  const io = { adapter, annotate: async (a: any) => void (a.annotation === "note" && notes.push(a.data)), now: () => 0 } as any;
  const c: LlmParticipantConfig = { participant: "council-clerk-system", entity: "city", title: "Council clerk", framing: { disclosure: "simulation", reason: "test" }, standing: [], titles: new Map(), cadenceDays: 7, draftText: () => "", ...seat, ...extra };
  return { p: createLlmParticipant(c, io), calls, notes, c };
}
const shown = (r: LlmRequest) => String(r.messages.at(-1)!.content);

test("a clerk sent a proposal on day 2 sits on day 3: at the next working day's sitting, never at once, and told why it is back", async () => {
  const { p, calls, notes } = harness([[use("d", "done_for_now", { days: 7 })]]);
  // Its first sitting; it says it is back in a week.
  await p.step(at(9 * HOUR), ctx);
  expect(calls.length).toBe(1);
  // It looks in at the next day's sitting to see what has come (no call): nothing has.
  expect(await p.step(at(DAY + 9 * HOUR), ctx)).toEqual({ type: "wait", until: 2 * DAY + 9 * HOUR });
  // A proposal is filed that afternoon (the second day). Not at once: the next working day's sitting.
  expect(await p.step(at(DAY + 14 * HOUR, [paper("rec.7", "proposal", DAY + 14 * HOUR)]), ctx)).toEqual({ type: "wait", until: 2 * DAY + 9 * HOUR });
  expect(calls.length).toBe(1);
  // The third day: it sits, four days before the day it gave, and is told why.
  await p.step(at(2 * DAY + 9 * HOUR), ctx);
  expect(calls.length).toBe(2);
  expect(shown(calls[1]!)).toContain("You are back before the day you gave: papers were filed with your office (1 proposal). They are set out below.");
  expect(shown(calls[1]!)).toContain("proposal rec.7.");
  expect(notes.find((n) => n.back_for_papers).back_for_papers).toEqual({ papers: [{ kind: "proposal", n: 1 }], days_early: 5 });
});

test("a day's papers are one sitting; a kind the seat holds waits for the sitting it set; its own papers and its staff's bring nobody back; a weekend is not worked", async () => {
  const { p, calls } = harness([[use("d", "done_for_now", { days: 7 })], [use("d", "done_for_now", { days: 7, hold: ["Proposals"] })]]);
  await p.step(at(9 * HOUR), ctx);
  // Twenty in a day, at three moments: one sitting, the next morning, with the count.
  await p.step(at(DAY + 9 * HOUR, Array.from({ length: 8 }, (_, i) => paper(`rec.${i}`, "proposal", DAY + 2 * HOUR))), ctx);
  await p.step(at(DAY + 11 * HOUR, Array.from({ length: 12 }, (_, i) => paper(`rec.${20 + i}`, "proposal", DAY + 11 * HOUR))), ctx);
  await p.step(at(DAY + 15 * HOUR, [paper("rec.40", "proposal", DAY + 15 * HOUR, { author: "council-clerk-system" }), paper("rec.41", "proposal", DAY + 15 * HOUR, { author: "council-clerk-staff-system" })]), ctx);
  expect(calls.length).toBe(1);
  await p.step(at(2 * DAY + 9 * HOUR), ctx);
  expect(calls.length).toBe(2);
  expect(shown(calls[1]!)).toContain("papers were filed with your office (20 proposals)");
  // It said proposals may wait: the next one does. Something else in its in-tray still brings it back.
  await p.step(at(2 * DAY + 13 * HOUR, [paper("rec.50", "proposal", 2 * DAY + 13 * HOUR)]), ctx);
  expect(await p.step(at(3 * DAY + 9 * HOUR), ctx)).toEqual({ type: "wait", until: 4 * DAY + 9 * HOUR });
  // A paper in the organisation's files at large is not this office's to open; one addressed to its post is.
  await p.step(at(3 * DAY + 10 * HOUR, [], [paper("rec.60", "complaint", 3 * DAY + 10 * HOUR)]), ctx);
  expect(await p.step(at(4 * DAY + 9 * HOUR), ctx)).toMatchObject({ type: "wait" });
  expect(calls.length).toBe(2);
  // (Day 5 of the week, a Friday: what comes then is opened on the Monday.)
  expect(await p.step(at(4 * DAY + 10 * HOUR, [], [paper("rec.61", "notice", 4 * DAY + 10 * HOUR, { addressed_to: ["council-clerk"] })]), ctx)).toEqual({ type: "wait", until: 7 * DAY + 9 * HOUR });
  await p.step(at(7 * DAY + 9 * HOUR), ctx);
  expect(calls.length).toBe(3);
  expect(shown(calls[2]!)).toContain("papers were filed with your office (1 notice)");
  expect(shown(calls[2]!)).toContain("proposal rec.50."); // (what waited is set out at the sitting it comes to)
});

test("a seat set not to be brought back by papers waits for the day it gave, and its tool says only a letter brings it sooner", async () => {
  const off = harness([[use("d", "done_for_now", { days: 7 })]], { wakeOnPapers: false });
  await off.p.step(at(9 * HOUR), ctx);
  await off.p.step(at(DAY + 9 * HOUR), ctx);
  expect(await off.p.step(at(DAY + 14 * HOUR, [paper("rec.7", "proposal", DAY + 14 * HOUR)]), ctx)).toEqual({ type: "wait", until: 7 * DAY + 9 * HOUR });
  expect(off.calls.length).toBe(1);
  const said = (c: LlmParticipantConfig) => tools(c).find((t) => t.name === "done_for_now")!;
  expect(said(off.c).description).toContain("a paper filed with your office, a vote or a notice does not bring you back sooner");
  expect((said(off.c).input_schema as any).properties.hold).toBeUndefined();
  const on = harness([]);
  expect(said(on.c).description).toContain("if a paper is filed with your office (an application, a proposal, a complaint, a notice: whatever comes into its in-tray), which brings you back at the next working day's sitting after it comes, a day's papers together");
  expect(said(on.c).description).toContain("If a kind of paper can wait for the sitting you've set, name it in hold");
  expect((said(on.c).input_schema as any).properties.hold.type).toBe("array");
});
