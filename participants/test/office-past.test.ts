// How an office-holder learns how its office has acted before (culture step 6; the owner's ruling of 2026-10-13: a seat is
// not shown its office's past practice as ready counts; it goes and looks in the office's own files, which takes a turn of
// its sitting). Held here: the way is the ordinary one (a search of its own files by kind and by date, a bounded list), a
// sitting's prompt is byte for byte the same whether the world's culture dial is on or off, and the office's practice
// is read by no part of what a seat is shown.

import { expect, test } from "bun:test";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";
import type { Observation } from "../src/contracts";
import type { ContentBlock, LlmRequest } from "../src/llm/adapter";
import { createLlmParticipant, type LlmParticipantConfig } from "../src/llm/participant";

const DAY = 86_400, HOUR = 3_600;
const obs = (t: number, extra: object = {}): Observation => ({ t, channels: {}, outcomes: [], inbox: [], drafts: [], positions: [{ position: "landlord-1-office", entity: "landlord-1", title: "Letting office" }], ...extra }) as unknown as Observation;
const use = (id: string, name: string, input: object): ContentBlock => ({ type: "tool_use", id, name, input });
const config: Partial<LlmParticipantConfig> = {
  kinds: new Map([["landlord-1-office/mine", "records"]]), titles: new Map([["landlord-1-office/mine", "The office's files"]]), standing: [], onRequest: ["landlord-1-office/mine"] };

function harness(answers: ContentBlock[][]) {
  const calls: LlmRequest[] = [];
  let n = 0;
  const adapter = { provider: "mock", model: "mock", complete: async (req: LlmRequest) => {
    calls.push(JSON.parse(JSON.stringify(req)));
    return { content: answers[n++] ?? [{ type: "tool_use", id: `end-${n}`, name: "done_for_now", input: {} }], usage: { input_tokens: 1, output_tokens: 1 } } as any;
  } };
  const io = { adapter, annotate: async () => {}, now: () => 0 } as any;
  const c: LlmParticipantConfig = { participant: "landlord-1-office-system", entity: "landlord-1", title: "Letting office", framing: { disclosure: "simulation", reason: "test" }, standing: [], titles: new Map(), cadenceDays: 7, draftText: () => "", ...config };
  return { p: createLlmParticipant(c, io), calls };
}

test("a holder who wants to know how its office has acted looks through the office's own files for a kind of paper over a period: an ordinary search of its own, a bounded list", async () => {
  const { p } = harness([[use("a", "look", { report: "landlord-1-office/mine", find: [{ field: "kind", value: "tribunal_application" }, { field: "date", op: ">=", value: "year 1, day 10" }, { field: "date", op: "<", value: "year 1, day 200" }], limit: 500 })]]);
  const act: any = await p.step(obs(9 * HOUR), { world: { currency: PROFILE.values.currency } } as any);
  expect(act.type).toBe("look");
  expect(act.looks.length).toBe(1);
  // Its own files only (the channel is the seat's `mine`), the kind and the period as a search, newest first, and bounded.
  expect(act.looks[0].channel).toBe("landlord-1-office/mine");
  expect(act.looks[0].query.where).toEqual([{ field: "kind", op: "=", value: "tribunal_application" }, { field: "at", op: ">=", value: 9 * DAY }, { field: "at", op: "<", value: 199 * DAY }]);
  expect(act.looks[0].query.order).toEqual({ field: "at", desc: true });
  expect(act.looks[0].query.limit).toBeLessThanOrEqual(200);
});

test("a look is refused at any report the seat has not been given: another office's files are not a report it can name", async () => {
  const { p, calls } = harness([[use("a", "look", { report: "landlord-2-office/mine", find: [{ field: "kind", value: "tribunal_application" }] })]]);
  const act: any = await p.step(obs(9 * HOUR), { world: { currency: PROFILE.values.currency } } as any);
  expect(act.type).not.toBe("look");
  // (It is told at once, in a second turn of the same sitting.)
  expect(calls.length).toBe(2);
  expect(JSON.stringify(calls[1]!.messages)).toContain("that isn't one of the reports you can look at");
});

test("a sitting's prompt is byte for byte the same with the world's culture dial on and off, unless the seat asks", async () => {
  const run = async (dials: object) => {
    const { p, calls } = harness([[use("d", "done_for_now", {})]]);
    await p.step(obs(9 * HOUR, { channels: {}, inbox: [{ from: "tenant-3", t: 8 * HOUR, text: "May I have more time?" }] }), { world: { currency: PROFILE.values.currency, dials } } as any);
    return JSON.stringify(calls.map((c) => ({ system: c.system, messages: c.messages, tools: (c as any).tools })));
  };
  const off = await run({}), on = await run({ culture: {} });
  expect(on).toBe(off);
  expect(off.length).toBeGreaterThan(500);
});
