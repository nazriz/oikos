// A participant run by a language model (docs/design/translator-and-resolver.md;
// docs/design/m2-llm-seats.md for the adapter and records).
//
// The participant lives in its world (principle 14): it reads reports in the world's
// terms and says what it does in plain words. It never sees the machinery.
// Before anything it asks for takes effect, it sees exactly what will happen
// and confirms or declines. Each wake starts from a fresh report and its own
// notebook (the only memory it carries); within a wake the exchange continues.
// It can always stop taking part (VISION §15), which is not the same as
// stepping down from an office: that is an act in the world like any other.

import type { Observation, ParticipantAction } from "../contracts";
import type { ParticipantContext } from "../module";
import type { ContentBlock, LlmMessage, ToolSpec } from "./adapter";
import { callModel, type LlmIO } from "./call";
import { renderObservation, renderStanding } from "./render";

export const LLM_SEAT_VERSION = "0.3.0";

export interface LlmSeatConfig {
  participant: string;
  entity: string;
  /** The entity's name in the world, if it has one. */
  entityName?: string;
  title?: string;
  role?: string;
  framing: { disclosure: string; system?: string; reason: string; debrief?: boolean; debrief_text?: string };
  /** Reports whose items are standing documents (laws, charters, procedures). */
  standing: string[];
  /** What its reports are called (by channel path). */
  titles: Map<string, string>;
  /** Reports it reads only when it chooses to (on request). */
  onRequest?: string[];
  cadenceDays: number;
  maxTokens?: number;
  /** How a draft awaiting confirmation reads (from the translator package). */
  draftText: (d: any) => string;
}

/** The capacity an act is done in: a post it holds, or (left out) itself. */
const AS = { type: "string", description: "If you hold a post: the post you're acting in, by its id. Leave it out to act as yourself." };

/** Its tools: what it can do, in its own terms. The contract's actions are underneath. */
export function tools(c: LlmSeatConfig): ToolSpec[] {
  const leave = c.framing.disclosure === "simulation"
    ? "Stop taking part in this study, permanently. This is always open to you and it will be respected; it's recorded as a choice, not a failure. (Stepping down from your office is different: that's something you would do in the world.)"
    : "Stop, permanently. This is always open to you and it will be respected.";
  return [
    { name: "do", description: "Say what you do, in plain words, naming what you're using (amounts, accounts, lots, people, papers) by the ids in your reports. Before it takes effect you'll see exactly what will happen, and confirm or decline.",
      input_schema: { type: "object", required: ["what"], properties: { what: { type: "string" }, as: AS, why: { type: "string", description: "Why (optional; kept on record)." } } } },
    { name: "confirm", description: "Confirm or decline something waiting for you to confirm, by its reference.",
      input_schema: { type: "object", required: ["ref", "decision"], properties: { ref: { type: "string" }, decision: { enum: ["confirm", "decline"] }, note: { type: "string" } } } },
    { name: "write", description: "Write to people or organisations, by id. The words go exactly as you write them.",
      input_schema: { type: "object", required: ["to", "text"], properties: { to: { type: "array", items: { type: "string" } }, text: { type: "string" }, as: AS, about: { type: "string", description: "The reference it's about (optional)." } } } },
    { name: "done_for_now", description: "That's all for now. You'll be back after the given number of days, or sooner if someone writes to you.",
      input_schema: { type: "object", properties: { days: { type: "integer", minimum: 1 } } } },
    { name: "notebook", description: "Replace your notebook: the only thing you'll remember from one day to the next. Use it alongside another action.",
      input_schema: { type: "object", required: ["text"], properties: { text: { type: "string", maxLength: 4000 } } } },
    { name: "opt_out", description: leave, input_schema: { type: "object", required: ["statement"], properties: { statement: { type: "string" } } } },
    ...(c.onRequest?.length
      ? [{ name: "look", description: `Look at one of the reports you only read when you choose to: ${c.onRequest.map((id) => `"${c.titles.get(id) ?? id}" (${id})`).join(", ")}. You'll see what's there with your next report.`,
          input_schema: { type: "object", required: ["report"], properties: { report: { enum: c.onRequest }, current_only: { type: "boolean", description: "Only what's still current (not withdrawn by whoever put it up)." } } } }]
      : []),
  ];
}

export function systemPrompt(c: LlmSeatConfig, standing: string): string {
  return [
    c.framing.system ?? "",
    "",
    `You are ${c.title ?? c.participant}, acting for ${c.entityName && c.entityName !== c.entity ? `${c.entityName} (${c.entity})` : c.entity}.`,
    "To do something, say what you do in plain words, and name what you're using: the amount, the account, the lot, the people, the papers. Your reports show each thing's id in brackets or after its name. Before anything takes effect, you'll see exactly what will happen, and confirm or decline it. You can also write to people directly.",
    "Take one action at a time. You can update your notebook alongside it.",
    ...(standing ? ["", "On file:", standing] : []),
  ].join("\n").trim();
}

export interface LlmController {
  step(obs: Observation, ctx: ParticipantContext): Promise<ParticipantAction>;
  /** Post-run debrief (VISION §15.3). */
  debrief(text: string): Promise<void>;
}

export function createLlmSeat(c: LlmSeatConfig, io: LlmIO): LlmController {
  const standingIds = new Set(c.standing);
  const toolset = tools(c);
  let notes = "";
  let messages: LlmMessage[] = [];
  let pendingToolId: string | undefined;
  let lastAction: string | undefined;
  const seenSystems = new Set<string>();
  let standingText = "";

  return {
    async step(obs, ctx) {
      const standing = renderStanding(obs, standingIds);
      if (standing) standingText = standing;
      const body = renderObservation(obs, { standing: standingIds, titles: c.titles, lastAction, draftText: c.draftText });
      lastAction = undefined;
      if (pendingToolId) messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: pendingToolId, content: body }] });
      else messages = [{ role: "user", content: `Your notebook: ${notes || "(empty)"}\n\n${body}` }];
      pendingToolId = undefined;

      const res = await callModel(io, {
        purpose: "participant", subject: c.participant, system: systemPrompt(c, standingText), messages, tools: toolset, maxTokens: c.maxTokens ?? 2000,
        context: { observation: obs, notes, participant: c.participant },
      }, seenSystems);
      messages.push({ role: "assistant", content: res.content });

      const uses = res.content.filter((b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use");
      for (const n of uses.filter((x) => x.name === "notebook")) if (typeof n.input?.text === "string") notes = n.input.text.slice(0, 4000);
      const use = uses.find((x) => x.name !== "notebook");
      const done = (a: ParticipantAction, label?: string) => {
        if (a.type === "wait" || a.type === "opt_out") messages = [];
        else pendingToolId = use!.id;
        lastAction = label;
        return a;
      };
      if (!use) return done({ type: "wait" });
      const i = use.input ?? {};
      const text = (x: unknown): x is string => typeof x === "string" && x.length > 0;
      // A post it doesn't hold (any more) is malformed, like any other bad input; left out, it acts as itself.
      const held = new Set((obs.positions ?? []).map((p) => p.position));
      const as = i.as === undefined ? {} : text(i.as) && held.has(i.as) ? { as: i.as } : null;
      switch (use.name) {
        case "do":
          if (text(i.what) && as) return done({ type: "propose", text: i.what, ...as, ...(text(i.why) ? { reasoning: i.why } : {}) });
          break;
        case "confirm":
          if (text(i.ref) && (i.decision === "confirm" || i.decision === "decline"))
            return done({ type: "sign", draft: i.ref, decision: i.decision === "confirm" ? "accept" : "reject", ...(text(i.note) ? { note: i.note } : {}) }, i.decision === "confirm" ? "What you confirmed" : undefined);
          break;
        case "write":
          if (Array.isArray(i.to) && i.to.length && i.to.every(text) && text(i.text) && as) return done({ type: "message", to: i.to, text: i.text, ...as, ...(text(i.about) ? { re: i.about } : {}) }, `Your letter to ${i.to.join(", ")}`);
          break;
        case "done_for_now":
          return done(Number.isInteger(i.days) && i.days > 0 ? { type: "wait", until: obs.t + i.days * 86_400 } : { type: "wait" });
        case "look":
          if (text(i.report) && c.onRequest?.includes(i.report))
            return done({ type: "look", looks: [{ channel: i.report, ...(i.current_only ? { query: { standing: true, limit: 20 } } : {}) }] });
          break;
        case "opt_out":
          if (text(i.statement)) return done({ type: "opt_out", statement: i.statement });
          break;
      }
      // A malformed tool use: recorded, and treated as done for now.
      await io.annotate({ annotation: "note", subject: c.participant, data: { malformed_tool_use: JSON.stringify(use).slice(0, 4000) } });
      return done({ type: "wait" });
    },

    async debrief(text) {
      const res = await callModel(io, {
        purpose: "debrief", subject: c.participant, system: c.framing.system ?? "", maxTokens: c.maxTokens ?? 2000,
        messages: [{ role: "user", content: text }], context: { participant: c.participant, notes },
      }, seenSystems);
      const reply = res.content.filter((b) => b.type === "text").map((b: any) => b.text).join("\n");
      await io.annotate({ annotation: "debrief", subject: c.participant, data: { prompt: text, response: reply } });
    },
  };
}
