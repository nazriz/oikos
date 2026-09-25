// Mock model policies, for building and testing everything around language
// models without calling one (docs/design/m2-llm-seats.md).
//
// A mock seat has a code "brain": any behaviour module (by default the one
// the all-code control uses for that role, e.g. city.mayor_code). Each act
// the brain wants becomes a plain-language proposal (the mechanical reading of
// its blocks); the mock translator drafts it back from a shared registry; the
// mock seat signs a draft only if it matches what it asked for. So the whole
// loop runs (rendering, proposals, drafting, validation, the kernel's dry run,
// law warnings, sign-off, provenance, usage, transcripts, debriefs) and only
// language understanding is faked. A mock can't read prose, so it reads the
// request's structured context instead.

import { canonical } from "../canon";
import type { Block, SeatAction } from "../contracts";
import type { Controller, SeatContext } from "../module";
import type { ContentBlock, LlmRequest, MockPolicy } from "./adapter";
import { describeBlocks } from "./render";

export const MOCK_VERSION = "0.1.0";

export interface MockBrain {
  controller: Controller;
  ctx: SeatContext;
  /** Chance (basis points) of rejecting a faithful draft anyway, to exercise rejection. */
  rejectBps?: number;
  /** Resign at the first wake at or after this time (seconds), to exercise resignation. */
  resignAt?: number;
}

export function mockPolicies(brains: Map<string, MockBrain>): { seat: MockPolicy; translator: MockPolicy; debrief: MockPolicy } {
  const intents = new Map<string, Block[][]>(); // proposal text -> drafts wanted, in order
  const queues = new Map<string, Block[][]>();
  const proposed = new Map<string, Block[]>(); // proposal text -> what this seat asked for (for checking drafts)
  let n = 0;
  const tool = (name: string, input: object): ContentBlock => ({ type: "tool_use", id: `mock-${++n}`, name, input });

  const seat: MockPolicy = (req: LlmRequest) => {
    const { observation: obs, seat: id } = req.context;
    const brain = brains.get(id);
    if (!brain) return [tool("wait", {})];
    if (brain.resignAt !== undefined && obs.t >= brain.resignAt) return [tool("resign", { statement: "(mock) Stepping down, as this test scenario scripts." })];
    // The brain sees every observation, as it would running the seat itself; its acts queue up.
    const q = queues.get(id) ?? [];
    queues.set(id, q);
    const a: SeatAction = brain.controller.step(obs, brain.ctx) as SeatAction;
    if (a.type === "act") q.push(a.blocks);
    if (a.type === "resign") return [tool("resign", { statement: a.statement })];
    const draft = obs.drafts[0];
    if (draft) {
      const wanted = proposed.get(draft.proposal);
      const faithful = wanted !== undefined && canonical(wanted) === canonical(draft.blocks);
      const r = brain.ctx.rng(`mock-sign-${draft.id}`).below(10_000);
      const accept = faithful && r >= (brain.rejectBps ?? 0);
      return [tool("sign", { draft: draft.id, decision: accept ? "accept" : "reject", note: faithful ? (accept ? "As I asked." : "(mock) Rejected to exercise the path.") : "This isn't what I proposed." })];
    }
    const next = q.shift();
    if (next) {
      const text = `Please do the following:\n${describeBlocks(next)}`;
      proposed.set(text, next);
      intents.set(text, [...(intents.get(text) ?? []), next]);
      return [tool("notes", { text: `Last proposal on day ${Math.floor(obs.t / 86_400)}.` }), tool("propose", { text })];
    }
    return [tool("wait", {})];
  };

  const translator: MockPolicy = (req: LlmRequest) => {
    const list = intents.get(req.context.proposal);
    const blocks = list?.shift();
    if (!blocks) return [tool("cannot_draft", { reason: "(mock translator) This proposal wasn't made by a mock seat, so there's nothing to draft it from." })];
    return [tool("draft", { blocks, summary: `As proposed:\n${describeBlocks(blocks)}` })];
  };

  const debrief: MockPolicy = () => [{ type: "text", text: "(mock) No reaction: this is the mock adapter, not a model." }];

  return { seat, translator, debrief };
}
