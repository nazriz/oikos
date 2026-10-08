// The platform is invisible to seats (principle 14; the live check of 2026-10-09, finding 6): letters arrived as "From
// mayor-system" and "From bank-payments-system", seats then wrote to `mayor-system`, and what waited to be confirmed
// was called `draft.mayor-system.1`. A participant's own id is the platform's. A seat sees an office by its post and
// whose post it is, a person by themselves, and names what it confirms by a reference with no such word in it.

import { expect, test } from "bun:test";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";
import type { Observation } from "../src/contracts";
import type { ContentBlock, LlmRequest } from "../src/llm/adapter";
import { createLlmParticipant, type LlmParticipantConfig } from "../src/llm/participant";
import type { WhoIs } from "../src/llm/render";

const HOUR = 3_600;
const ctx = { world: { currency: PROFILE.values.currency } } as any;
/** As the run tells it: an office's system by the post it holds, a person's seat by the person, a post, an organisation. */
const whoIs: WhoIs = (id) => ({
  "council-clerk-system": { id: "council-clerk", name: "Council clerk", of: "city" }, "council-clerk": { id: "council-clerk", name: "Council clerk", of: "city" },
  "bank-payments-system": { id: "bank-payments", name: "Payments", of: "bank" }, "mayor-system": { id: "mayor", name: "Mayor of Millbrook", of: "city" }, "finance-system": { id: "finance", name: "Finance officer", of: "city" },
  "c0297-self": { id: "c0297", name: "c0297" }, city: { id: "city", name: "Town of Millbrook" }, bank: { id: "bank", name: "Millbrook Savings Bank" },
} as { [id: string]: ReturnType<WhoIs> })[id];

function harness(answers: ContentBlock[][]) {
  const calls: LlmRequest[] = [];
  let n = 0;
  const adapter = { provider: "mock", model: "mock", complete: async (req: LlmRequest) => (calls.push(JSON.parse(JSON.stringify(req))), { content: answers[n++] ?? [{ type: "tool_use", id: `end-${n}`, name: "done_for_now", input: {} }], usage: { input_tokens: 1, output_tokens: 1 } }) as any };
  const c: LlmParticipantConfig = { whoIs, participant: "mayor-system", entity: "city", entityName: "Town of Millbrook", title: "Mayor of Millbrook", framing: { disclosure: "simulation", reason: "test" }, standing: ["mayor/laws"], titles: new Map(), cadenceDays: 7,
    draftText: (d) => `Before this goes ahead (${d.id}), here is exactly what will happen:\n${d.summary}\nConfirm it, or decline it.` };
  return { p: createLlmParticipant(c, { adapter, annotate: async () => {}, now: () => 0 } as any), calls };
}
const use = (id: string, name: string, input: object): ContentBlock => ({ type: "tool_use", id, name, input });

test("a seat is shown offices by their posts and people by themselves, and nothing by an id of the platform's own", async () => {
  const { p, calls } = harness([[use("a", "confirm", { ref: "draft.mayor.1", decision: "confirm" }), use("b", "confirm", { ref: "[draft.mayor.2]", decision: "decline" })]]);
  const obs = { t: 9 * HOUR, entity: "city", outcomes: [], positions: [{ position: "mayor", entity: "city", title: "Mayor of Millbrook" }],
    inbox: [
      { id: "msg.1", t: 8 * HOUR, from: "council-clerk-system", as: "council-clerk", from_entity: "city", to: ["mayor-system"], text: "The ballot closes on day 15. Write to finance-system for the figures.", re: "rec.40" },
      { id: "msg.2", t: 8 * HOUR, from: "bank-payments-system", from_entity: "bank", to: ["mayor-system"], text: "Six payments are on hold." },
      { id: "msg.3", t: 8 * HOUR, from: "c0297-self", from_entity: "c0297", to: ["mayor-system"], text: "The bins were not emptied." },
    ],
    channels: {
      "mayor/laws": { kind: "records", records: [{ id: "proc-1", record: "statement", kind: "procedure", author: "council-clerk-system", at: 0, visible_to: "public", text: "Proposals go to the clerk." }] },
      "mayor/in-tray": { kind: "records", records: [{ id: "rec.50", record: "statement", kind: "complaint", author: "c0297-self", at: 8 * HOUR, visible_to: ["city"], addressed_to: ["city"], text: "Waste, again." },
        { id: "rec.51", record: "statement", kind: "report", author: "finance-system", at: 8 * HOUR, visible_to: ["city"], text: "The books, as asked by mayor-system." }] },
    },
    drafts: [{ id: "draft.mayor-system.1", summary: "You will write to Council clerk (council-clerk): \"Please.\"." }, { id: "draft.mayor-system.2", summary: "You will switch off finance-system for good." }],
  } as unknown as Observation;
  // What it confirms, it names as it was shown it; that goes back as the reference it is kept under.
  expect(await p.step(obs, ctx)).toEqual({ type: "sign", draft: "draft.mayor-system.1", decision: "accept" });
  expect(await p.step({ ...obs, inbox: [], drafts: [], channels: {} } as any, ctx)).toEqual({ type: "sign", draft: "draft.mayor-system.2", decision: "reject" });
  const shown = calls[0]!.messages[0]!.content as string;
  // A letter is signed by the post it was written in and whose post that is; or by the organisation, or the person.
  expect(shown).toContain('- From Council clerk (council-clerk), Town of Millbrook (city) (year 1, day 1), about rec.40: "The ballot closes on day 15. Write to finance for the figures."');
  expect(shown).toContain('- From Payments (bank-payments), Millbrook Savings Bank (bank) (year 1, day 1): "Six payments are on hold."');
  expect(shown).toContain('- From c0297 (year 1, day 1): "The bins were not emptied."');
  // A paper's writer, and anyone its words name by such an id.
  expect(shown).toContain("[rec.50] complaint from c0297, to city");
  expect(shown).toContain('[rec.51] report from finance (year 1, day 1): "The books, as asked by mayor."');
  // What waits to be confirmed.
  expect(shown).toContain("Before this goes ahead (draft.mayor.1), here is exactly what will happen:");
  expect(shown).toContain("You will switch off finance for good.");
  // Nowhere, in what it is shown or in its standing instructions, is there an id of the platform's own.
  const everything = `${calls[0]!.system}\n${shown}`;
  expect(calls[0]!.system).toContain("- [proc-1] procedure");
  expect(everything).not.toMatch(/-system|-self/);
});
