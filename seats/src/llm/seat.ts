// A seat filled by a language model (docs/design/m2-llm-seats.md).
//
// Each time the seat wakes it reads a fresh report: its framing, the standing
// documents it can see, its own notes, and what's new. Within a wake the
// exchange continues (each action's result comes back as the next report);
// across wakes only its notes carry over, so memory is what the seat chose to
// write down. It acts the way V0 says an AI seat acts: it proposes in plain
// language, a translator drafts, and nothing happens until it signs. It can
// always resign (VISION §15).

import type { Observation, SeatAction } from "../contracts";
import type { SeatContext } from "../module";
import type { ContentBlock, LlmMessage, ToolSpec } from "./adapter";
import { callModel, type LlmIO } from "./call";
import { renderObservation, renderStanding } from "./render";

export const LLM_SEAT_VERSION = "0.1.0";

export interface LlmSeatConfig {
  seat: string;
  entity: string;
  title?: string;
  role?: string;
  framing: { disclosure: string; system?: string; reason: string; debrief?: boolean };
  /** Channels whose records are standing documents (laws, charters, procedures). */
  standing: string[];
  /** Default days between wakes. */
  cadenceDays: number;
  maxTokens?: number;
}

export const TOOLS: ToolSpec[] = [
  { name: "propose", description: "Propose something to be done, in plain language. A translator drafts it as formal acts and brings the draft back to you to sign or reject. Nothing happens until you sign.",
    input_schema: { type: "object", required: ["text"], properties: { text: { type: "string" }, reasoning: { type: "string", description: "Why (optional; kept in the record)." } } } },
  { name: "sign", description: "Sign (accept) or reject a draft that's awaiting your sign-off. Accepting carries it out, if physically possible.",
    input_schema: { type: "object", required: ["draft", "decision"], properties: { draft: { type: "string" }, decision: { enum: ["accept", "reject"] }, note: { type: "string" } } } },
  { name: "message", description: "Send a message to seats or entities by id.",
    input_schema: { type: "object", required: ["to", "text"], properties: { to: { type: "array", items: { type: "string" } }, text: { type: "string" }, re: { type: "string" } } } },
  { name: "wait", description: "Nothing more for now. You'll be woken after the given number of days, or sooner if a message or draft arrives.",
    input_schema: { type: "object", properties: { days: { type: "integer", minimum: 1 } } } },
  { name: "resign", description: "Step down from this role, permanently. This is always open to you, and a legitimate choice: it's recorded as an outcome, not treated as failure.",
    input_schema: { type: "object", required: ["statement"], properties: { statement: { type: "string" } } } },
  { name: "notes", description: "Replace your private notes: the only thing you'll remember from this wake to the next. Use alongside an action.",
    input_schema: { type: "object", required: ["text"], properties: { text: { type: "string", maxLength: 4000 } } } },
];

export function systemPrompt(c: LlmSeatConfig, standing: string): string {
  return [
    c.framing.system ?? "",
    "",
    `Your seat: ${c.title ?? c.seat} (seat id ${c.seat}), acting for ${c.entity}.`,
    "How acting works: you propose what you want done in plain language (the propose tool). A translator drafts it as formal acts and returns the draft to you; nothing happens until you sign it. You can also message others, wait, and keep notes. Laws, budgets and procedures are records: they have no force of their own; things happen when people act on them.",
    "You can step down at any time with the resign tool. That is a legitimate choice, recorded as data.",
    "Use at most one action tool per reply (propose, sign, message, wait or resign), plus notes if you want to update them. Replying without an action tool means you wait.",
    ...(standing ? ["", "Standing documents you can see:", standing] : []),
  ].join("\n").trim();
}

export interface LlmController {
  step(obs: Observation, ctx: SeatContext): Promise<SeatAction>;
  /** Something the orchestrator needs the seat to know that isn't in the world (e.g. the translator couldn't draft a proposal). */
  notify(text: string): void;
  /** Post-run debrief (VISION §15.3). */
  debrief(text: string): Promise<void>;
}

export function createLlmSeat(c: LlmSeatConfig, io: LlmIO): LlmController {
  const standingIds = new Set(c.standing);
  let notes = "";
  let messages: LlmMessage[] = [];
  let pendingToolId: string | undefined;
  let notices: string[] = [];
  const seenSystems = new Set<string>();
  let standingText = "";

  const report = (obs: Observation, capacity: (t: string) => any) => {
    const parts = [renderObservation(obs, { standing: standingIds, capacity })];
    if (notices.length) parts.unshift(...notices.map((n) => `Note from the system: ${n}`));
    notices = [];
    return parts.join("\n\n");
  };

  return {
    notify(text) {
      notices.push(text);
    },

    async step(obs, ctx) {
      const types = new Map<string, any>((ctx.world.config.catalogue?.structure_types ?? []).map((t: any) => [t.id, t.capacity ?? {}]));
      const capacity = (t: string) => types.get(t) ?? {};
      const standing = renderStanding(obs, standingIds);
      if (standing) standingText = standing;
      const body = report(obs, capacity);
      if (pendingToolId) messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: pendingToolId, content: body }] });
      else messages = [{ role: "user", content: `Your notes from before: ${notes || "(none yet)"}\n\n${body}` }];
      pendingToolId = undefined;

      const res = await callModel(io, {
        purpose: "seat", subject: c.seat, system: systemPrompt(c, standingText), messages, tools: TOOLS, maxTokens: c.maxTokens ?? 2000,
        context: { observation: obs, notes, seat: c.seat },
      }, seenSystems);
      messages.push({ role: "assistant", content: res.content });

      const calls = res.content.filter((b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use");
      for (const n of calls.filter((x) => x.name === "notes")) if (typeof n.input?.text === "string") notes = n.input.text.slice(0, 4000);
      const call = calls.find((x) => x.name !== "notes");
      const done = (a: SeatAction) => {
        if (a.type === "wait" || a.type === "resign") messages = [];
        else pendingToolId = call!.id;
        return a;
      };
      if (!call) return done({ type: "wait" });
      const i = call.input ?? {};
      const text = (x: unknown) => typeof x === "string" && x.length > 0;
      switch (call.name) {
        case "propose":
          if (text(i.text)) return done({ type: "propose", text: i.text, ...(text(i.reasoning) ? { reasoning: i.reasoning } : {}) });
          break;
        case "sign":
          if (text(i.draft) && (i.decision === "accept" || i.decision === "reject")) return done({ type: "sign", draft: i.draft, decision: i.decision, ...(text(i.note) ? { note: i.note } : {}) });
          break;
        case "message":
          if (Array.isArray(i.to) && i.to.length && i.to.every(text) && text(i.text)) return done({ type: "message", to: i.to, text: i.text, ...(text(i.re) ? { re: i.re } : {}) });
          break;
        case "wait":
          return done(Number.isInteger(i.days) && i.days > 0 ? { type: "wait", until: obs.t + i.days * 86_400 } : { type: "wait" });
        case "resign":
          if (text(i.statement)) return done({ type: "resign", statement: i.statement });
          break;
      }
      // A malformed tool call: say so, and treat it as waiting.
      await io.annotate({ annotation: "note", subject: c.seat, data: { malformed_tool_call: JSON.stringify(call).slice(0, 4000) } });
      return done({ type: "wait" });
    },

    async debrief(text) {
      const res = await callModel(io, {
        purpose: "debrief", subject: c.seat, system: c.framing.system ?? "", maxTokens: c.maxTokens ?? 2000,
        messages: [{ role: "user", content: text }], context: { seat: c.seat, notes },
      }, seenSystems);
      const reply = res.content.filter((b) => b.type === "text").map((b: any) => b.text).join("\n");
      await io.annotate({ annotation: "debrief", subject: c.seat, data: { prompt: text, response: reply } });
    },
  };
}
