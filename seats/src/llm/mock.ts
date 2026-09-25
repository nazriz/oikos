// Mock model policies, for building and testing everything around language
// models without calling one (D34; docs/design/translator-and-resolver.md).
//
// A mock seat has a code "brain": any behaviour module (by default the one the
// all-code control uses for that role, e.g. city.mayor_code). Code modules act
// through calls; the mock seat says each call it wants as its request, the
// mock translator hands back that same call, and the mock seat confirms a
// draft only if its call is exactly what it asked for. So the whole loop runs
// (rendering, requests, translation, the resolver, the preview, the kernel's
// dry run, law warnings, confirmation, provenance, usage, transcripts,
// debriefs) and only language understanding is faked. A mock can't read
// prose, so it reads the request's structured context instead.

import { parseProgram, programText } from "../calls";
import type { SeatAction } from "../contracts";
import type { Controller, SeatContext } from "../module";
import type { ContentBlock, LlmRequest, MockPolicy } from "./adapter";

export const MOCK_VERSION = "0.2.0";

export interface MockBrain {
  controller: Controller;
  ctx: SeatContext;
  /** Chance (basis points) of declining a faithful draft anyway, to exercise declining. */
  rejectBps?: number;
  /** Opt out at the first wake at or after this time (seconds), to exercise opting out. */
  optOutAt?: number;
}

const PREFIX = "(mock) ";

export function mockPolicies(brains: Map<string, MockBrain>): { seat: MockPolicy; translator: MockPolicy; debrief: MockPolicy } {
  const queues = new Map<string, (SeatAction & { type: "call" | "message" })[]>();
  let n = 0;
  const tool = (name: string, input: object): ContentBlock => ({ type: "tool_use", id: `mock-${++n}`, name, input });

  const seat: MockPolicy = async (req: LlmRequest) => {
    const { observation: obs, seat: id } = req.context;
    const brain = brains.get(id);
    if (!brain) return [tool("done_for_now", {})];
    if (brain.optOutAt !== undefined && obs.t >= brain.optOutAt) return [tool("opt_out", { statement: "(mock) Stopping, as this test scenario scripts." })];
    // The brain sees every observation, as it would running the seat itself; what it wants done queues up.
    const q = queues.get(id) ?? [];
    queues.set(id, q);
    const a = (await brain.controller.step(obs, brain.ctx)) as SeatAction;
    if (a.type === "call" || a.type === "message") q.push(a);
    if (a.type === "opt_out") return [tool("opt_out", { statement: a.statement })];
    const draft = obs.drafts[0];
    if (draft) {
      const asked = draft.proposal.startsWith(PREFIX) ? programText(parseProgram(draft.proposal.slice(PREFIX.length))) : undefined;
      const faithful = asked !== undefined && asked === draft.call;
      const accept = faithful && brain.ctx.rng(`mock-sign-${draft.id}`).below(10_000) >= (brain.rejectBps ?? 0);
      return [tool("confirm", { ref: draft.id, decision: accept ? "confirm" : "decline", note: faithful ? (accept ? "As I asked." : "(mock) Declined to exercise the path.") : "That isn't what I asked for." })];
    }
    const next = q.shift();
    if (next?.type === "message") return [tool("write", { to: next.to, text: next.text, ...(next.re ? { about: next.re } : {}) })];
    if (next) return [tool("notebook", { text: `Last request on day ${Math.floor(obs.t / 86_400)}.` }), tool("do", { what: PREFIX + next.call })];
    return [tool("done_for_now", {})];
  };

  // The mock translator hands back the call a mock seat said, and can't translate anything else.
  const translator: MockPolicy = (req: LlmRequest) => {
    const text: string = req.context.proposal;
    if (!text.startsWith(PREFIX)) return [tool("call", { program: "none(unclear)" })];
    return [tool("call", { program: text.slice(PREFIX.length) })];
  };

  const debrief: MockPolicy = () => [{ type: "text", text: "(mock) No reaction: this is the mock adapter, not a model." }];

  return { seat, translator, debrief };
}
