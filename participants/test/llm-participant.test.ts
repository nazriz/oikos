// The language-model participant's rhythm (participants/src/llm/participant.ts; pilot 7): several actions from one
// answer, carried out in turn with no further call, their results coming back together; and office hours, one sitting a
// working day, with what came in between shown at the next.

import { expect, test } from "bun:test";
import type { Observation } from "../src/contracts";
import type { ContentBlock, LlmRequest } from "../src/llm/adapter";
import { createLlmParticipant, type LlmParticipantConfig } from "../src/llm/participant";

const DAY = 86_400;
const HOUR = 3_600;

function obs(t: number, letter?: string): Observation {
  return { t, channels: {}, outcomes: [], inbox: letter ? [{ from: "clerk", t, text: letter }] : [], drafts: [], positions: [{ position: "mayor", entity: "city", title: "Mayor" }] } as unknown as Observation;
}

function harness(answers: ContentBlock[][], extra: Partial<LlmParticipantConfig> = {}) {
  const calls: LlmRequest[] = [];
  let n = 0;
  const adapter = { provider: "mock", model: "mock", complete: async (req: LlmRequest) => {
    calls.push(JSON.parse(JSON.stringify(req)));
    return { content: answers[n++] ?? [{ type: "tool_use", id: `end-${n}`, name: "done_for_now", input: {} }], usage: { input_tokens: 1, output_tokens: 1 } } as any;
  } };
  const io = { adapter, annotate: async () => {}, now: () => 0 } as any;
  const c: LlmParticipantConfig = { participant: "mayor-system", entity: "city", title: "Mayor", framing: { disclosure: "simulation", reason: "test" }, standing: [], titles: new Map(), cadenceDays: 7, draftText: () => "", ...extra };
  return { p: createLlmParticipant(c, io), calls };
}
const use = (id: string, name: string, input: object): ContentBlock => ({ type: "tool_use", id, name, input });
const ctx = {} as any;

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
