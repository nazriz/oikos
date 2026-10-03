// A participant run by a language model (docs/design/translator-and-resolver.md;
// docs/design/m2-llm-participants.md for the adapter and records).
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

export const LLM_PARTICIPANT_VERSION = "0.5.1";

export interface LlmParticipantConfig {
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
  /** Office hours (pilot 7): it deals with its business in one sitting a working day, from `start` (seconds into the day)
   * until `end`, on the first `days` days of each week; what comes in between waits for the next sitting. Absent: it
   * takes up whatever comes, whenever it comes. */
  sessions?: { start: number; end: number; days: number };
  /** The most actions one answer may hold (each carried out in turn; their results come back together). */
  maxActions?: number;
  /** How a draft awaiting confirmation reads (from the translator package). */
  draftText: (d: any) => string;
}

/** The capacity an act is done in: a post it holds, or (left out) itself. */
const AS = { type: "string", description: "If you hold a post: the post you're acting in, by its id. Leave it out to act as yourself." };

/** Its tools: what it can do, in its own terms. The contract's actions are underneath. */
export function tools(c: LlmParticipantConfig): ToolSpec[] {
  const leave = c.framing.disclosure === "simulation"
    ? "Stop taking part in this study, permanently. This is always open to you and it will be respected; it's recorded as a choice, not a failure. (Stepping down from your office is different: that's something you would do in the world.)"
    : "Stop, permanently. This is always open to you and it will be respected.";
  return [
    { name: "do", description: "Say what you do, in plain words, naming what you're using (amounts, accounts, lots, people, papers) by the ids in your reports. Before it takes effect you'll see exactly what will happen, and confirm or decline. It's for doing things in the world, not for reading or asking: to look something up use look (if you have files to look in), and to ask someone something, write to them.",
      input_schema: { type: "object", required: ["what"], properties: { what: { type: "string" }, as: AS, why: { type: "string", description: "Why (optional; kept on record)." } } } },
    { name: "confirm", description: "Confirm or decline something waiting for you to confirm, by its reference.",
      input_schema: { type: "object", required: ["ref", "decision"], properties: { ref: { type: "string" }, decision: { enum: ["confirm", "decline"] }, note: { type: "string" } } } },
    { name: "write", description: "Write to people or organisations, by id. The words go exactly as you write them.",
      input_schema: { type: "object", required: ["to", "text"], properties: { to: { type: "array", items: { type: "string" } }, text: { type: "string" }, as: AS, about: { type: "string", description: "The reference it's about (optional)." } } } },
    { name: "done_for_now", description: c.sessions
        ? "That's all for now. You're back at your next working day's sitting, or after the given number of days (at that day's sitting); sooner, at the next sitting, if someone writes to you. You can use it alongside other actions: they're done, and you'll see how they went when you're back."
        : "That's all for now. You'll be back after the given number of days, or sooner if someone writes to you. You can use it alongside other actions: they're done, and you're back after the days given, when you'll see how they went.",
      input_schema: { type: "object", properties: { days: { type: "integer", minimum: 1 } } } },
    { name: "notebook", description: "Replace your notebook: the only thing you'll remember from one sitting to the next. Use it alongside your actions.",
      input_schema: { type: "object", required: ["text"], properties: { text: { type: "string", maxLength: 4000 } } } },
    { name: "opt_out", description: leave, input_schema: { type: "object", required: ["statement"], properties: { statement: { type: "string" } } } },
    ...(c.onRequest?.length
      ? [{ name: "look", description: `Look at one of the reports you only read when you choose to: ${c.onRequest.map((id) => `"${c.titles.get(id) ?? id}" (${id})`).join(", ")}. You'll see what's there with your next report. To look something up, say what to find: records where a field matches (kind, author, speaks_for, basis, at, or data.<name> for a detail, e.g. data.employer), newest first.`,
          input_schema: { type: "object", required: ["report"], properties: {
            report: { enum: c.onRequest },
            current_only: { type: "boolean", description: "Only what's still current (not withdrawn by whoever put it up)." },
            find: { type: "array", maxItems: 8, description: "Only records where each of these holds.", items: { type: "object", required: ["field", "value"], properties: {
              field: { type: "string", description: "kind, author, speaks_for, basis, at, or data.<name>" },
              op: { enum: ["=", "!=", "<", "<=", ">", ">="], description: "= if not given" },
              value: { anyOf: [{ type: "string" }, { type: "integer" }, { type: "boolean" }] } } } },
            limit: { type: "integer", minimum: 1, maximum: 50, description: "At most this many (20 if not given)." } } } }]
      : []),
  ];
}

export function systemPrompt(c: LlmParticipantConfig, standing: string): string {
  return [
    c.framing.system ?? "",
    "",
    `You are ${c.title ?? c.participant}, acting for ${c.entityName && c.entityName !== c.entity ? `${c.entityName} (${c.entity})` : c.entity}.`,
    "To do something, say what you do in plain words, and name what you're using: the amount, the account, the lot, the people, the papers. Your reports show each thing's id in brackets or after its name. Before anything takes effect, you'll see exactly what will happen, and confirm or decline it. You can also write to people directly.",
    `You can take several actions at once (up to ${c.maxActions ?? 8}): they're carried out in the order you give them, and you'll see how each went together, afterwards. So act on what you already know in one go; anything that depends on the result of an action (confirming a draft you haven't seen yet) waits for the next turn. Update your notebook alongside.`,
    ...(c.sessions ? [`You work office hours: one sitting each working day, when you deal with everything that's come in since the last.`] : []),
    ...(standing ? ["", "On file:", standing] : []),
  ].join("\n").trim();
}

export interface LlmController {
  step(obs: Observation, ctx: ParticipantContext): Promise<ParticipantAction>;
  /** Post-run debrief (VISION §15.3). */
  debrief(text: string): Promise<void>;
}

export function createLlmParticipant(c: LlmParticipantConfig, io: LlmIO): LlmController {
  const standingIds = new Set(c.standing);
  const toolset = tools(c);
  let notes = "";
  // What it did, as recorded, for its debrief (it has no other memory of the run: pilot 9's mayor couldn't say).
  const tally = { requests: 0, confirmed: 0, declined: 0, letters: 0, looks: 0, first: -1, last: -1 };
  let messages: LlmMessage[] = [];
  // The last answer's tool uses (the APIs need a result for every one): each action's result is the report after it.
  let pending: { id: string; name: string }[] = [];
  // Actions from the last answer still to carry out, in order, and the reports seen after each one carried out.
  let queue: { id: string; action: ParticipantAction; label?: string }[] = [];
  const results = new Map<string, string>();
  let current: string | undefined; // the use whose action was just carried out (the next report is its result)
  let lastAction: string | undefined;
  // "Done for now" said alongside actions: once they're carried out, no call until the next wake (or sitting).
  let doneAfter: { days?: number } | undefined;
  // What it was shown while not at its desk (a wake between sittings, or after its last action of a sitting), for the
  // next sitting: perception is changes, so nothing seen is lost.
  let carried: string[] = [];
  let missed: Observation[] = []; // the observations behind it (a mock's code brain reads these, not the text)
  // Office hours: the day of the sitting under way (or last held), whether it's open, and the earliest it's back.
  let sittingDay = -1;
  let open = false;
  let backAt = 0;
  let mail = false; // someone wrote since the last sitting
  const seenSystems = new Set<string>();
  let standingText = "";
  const DAYS = 86_400;
  const S = c.sessions;
  const sittingStart = (day: number) => day * DAYS + (S?.start ?? 0);
  const workday = (day: number) => !S || day % 7 < S.days;
  /** The next sitting at or after `t`: a working day's start, or now if within a working day's hours. */
  const nextSitting = (t: number) => {
    let day = Math.floor(t / DAYS);
    if (S && workday(day) && t >= sittingStart(day) && t < day * DAYS + S.end && day !== sittingDay) return t;
    for (day = day + (t >= sittingStart(day) ? 1 : 0); !workday(day) || day === sittingDay; day++);
    return sittingStart(day);
  };
  const CARRY_MAX = 40_000;

  /** Carry out the next queued action. */
  const next = (obs: Observation): ParticipantAction => {
    const q = queue.shift()!;
    current = q.id;
    lastAction = q.label;
    if (q.action.type === "propose") tally.requests++;
    if (q.action.type === "sign") q.action.decision === "accept" ? tally.confirmed++ : tally.declined++;
    if (q.action.type === "message") tally.letters++;
    if (q.action.type === "look") tally.looks++;
    [tally.first, tally.last] = [tally.first < 0 ? obs.t : tally.first, obs.t];
    return q.action;
  };
  /** Away from the desk until `until` (or its cadence): the conversation ends; the next sitting starts afresh. */
  const away = (until?: number): ParticipantAction => {
    messages = [];
    pending = [];
    results.clear();
    open = false;
    return until !== undefined ? { type: "wait", until } : { type: "wait" };
  };

  return {
    async step(obs, ctx) {
      const standing = renderStanding(obs, standingIds);
      if (standing) standingText = standing;
      const body = renderObservation(obs, { standing: standingIds, titles: c.titles, lastAction, draftText: c.draftText });
      lastAction = undefined;
      if (obs.inbox.length) mail = true;
      if (current) {
        results.set(current, body);
        current = undefined;
      }
      // More of the last answer to carry out: no call.
      if (queue.length) return next(obs);
      // Done for now, said alongside: what the last action showed is kept for next time.
      if (doneAfter) {
        const days = doneAfter.days ?? (S ? c.cadenceDays : undefined);
        doneAfter = undefined;
        carried.push(...pending.filter((u) => results.has(u.id)).map((u) => results.get(u.id)!));
        missed.push(obs);
        backAt = days ? (S ? sittingStart(Math.floor(obs.t / DAYS) + days) : obs.t + days * DAYS) : 0;
        mail = false;
        return away(S ? Math.min(backAt || Infinity, nextSitting(obs.t + 1)) : days ? obs.t + days * DAYS : undefined);
      }
      // Office hours: between sittings, what comes in is kept for the next one, and no call is made.
      if (S && !open) {
        const day = Math.floor(obs.t / DAYS);
        const inHours = workday(day) && obs.t >= sittingStart(day) && obs.t < day * DAYS + S.end && day !== sittingDay;
        if (!inHours || (obs.t < backAt && !mail)) {
          carried.push(body);
          missed.push(obs);
          return { type: "wait", until: obs.t < backAt && !mail ? Math.max(backAt, nextSitting(obs.t)) : nextSitting(obs.t) };
        }
        open = true;
        sittingDay = day;
        mail = false;
      }
      if (pending.length)
        messages.push({ role: "user", content: pending.map((u): ContentBlock => ({ type: "tool_result", tool_use_id: u.id,
          content: results.get(u.id) ?? (u.name === "notebook" ? "Notebook updated." : u.name === "done_for_now" ? "Noted." : "Not done: it wasn't something you can do, as written.") })) });
      else {
        // (Each report repeats what hasn't changed, the town's survey, who's who: a section shown once is shown once.)
        const shown = new Set<string>();
        const parts = carried.flatMap((b) => b.split("\n\n## ").map((x, i) => (i ? `## ${x}` : x))).filter((x) => !shown.has(x) && (shown.add(x), true));
        let before = parts.join("\n\n");
        if (before.length > CARRY_MAX) before = `(Earlier items not shown.)\n${before.slice(before.length - CARRY_MAX)}`;
        messages = [{ role: "user", content: `Your notebook: ${notes || "(empty)"}\n\n${before ? `Since you last looked:\n${before}\n\nNow:\n` : ""}${body}` }];
      }
      const behind = missed;
      carried = [];
      missed = [];
      pending = [];
      results.clear();

      const res = await callModel(io, {
        purpose: "participant", subject: c.participant, system: systemPrompt(c, standingText), messages, tools: toolset, maxTokens: c.maxTokens ?? 4000,
        context: { observation: obs, notes, participant: c.participant, ...(behind.length ? { missed: behind } : {}) },
      }, seenSystems);
      messages.push({ role: "assistant", content: res.content });

      const uses = res.content.filter((b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use");
      pending = uses.map((u) => ({ id: u.id, name: u.name }));
      for (const n of uses.filter((x) => x.name === "notebook")) if (typeof n.input?.text === "string") notes = n.input.text.slice(0, 4000);
      const text = (x: unknown): x is string => typeof x === "string" && x.length > 0;
      // A post it doesn't hold (any more) is malformed, like any other bad input; left out, it acts as itself.
      const held = new Set((obs.positions ?? []).map((p) => p.position));
      const optOut = uses.find((u) => u.name === "opt_out" && text(u.input?.statement));
      if (optOut) {
        queue = [];
        tally.last = obs.t;
        return away(), { type: "opt_out", statement: optOut.input.statement };
      }
      const max = c.maxActions ?? 8;
      for (const use of uses) {
        if (use.name === "notebook" || use.name === "done_for_now") continue;
        const i = use.input ?? {};
        const as = i.as === undefined ? {} : text(i.as) && held.has(i.as) ? { as: i.as } : null;
        let a: ParticipantAction | undefined;
        let label: string | undefined;
        if (use.name === "do" && text(i.what) && as) a = { type: "propose", text: i.what, ...as, ...(text(i.why) ? { reasoning: i.why } : {}) };
        else if (use.name === "confirm" && text(i.ref) && (i.decision === "confirm" || i.decision === "decline")) {
          a = { type: "sign", draft: i.ref, decision: i.decision === "confirm" ? "accept" : "reject", ...(text(i.note) ? { note: i.note } : {}) };
          label = i.decision === "confirm" ? "What you confirmed" : undefined;
        } else if (use.name === "write" && Array.isArray(i.to) && i.to.length && i.to.every(text) && text(i.text) && as) {
          a = { type: "message", to: i.to, text: i.text, ...as, ...(text(i.about) ? { re: i.about } : {}) };
          label = `Your letter to ${i.to.join(", ")}`;
        } else if (use.name === "look" && text(i.report) && c.onRequest?.includes(i.report)) {
          // A search, if asked for (what matches now, newest first): fields as the participant API's queries name them.
          const FIELD = /^(record|kind|at|author|speaks_for|basis|(data|about)(\.[A-Za-z0-9_-]+)+)$/;
          const find = Array.isArray(i.find) ? i.find.filter((w: any) => text(w?.field) && FIELD.test(w.field) && ["string", "number", "boolean"].includes(typeof w.value)) : [];
          const limit = Number.isInteger(i.limit) ? Math.min(50, Math.max(1, i.limit)) : 20;
          const where = find.map((w: any) => ({ field: w.field, op: ["=", "!=", "<", "<=", ">", ">="].includes(w.op) ? w.op : "=", value: w.value }));
          const query = find.length ? { query: { ...(i.current_only ? { standing: true } : {}), where, order: { field: "at", desc: true }, limit } }
            : i.current_only ? { query: { standing: true, limit: 20 } } : {};
          a = { type: "look", looks: [{ channel: i.report, ...query }] };
        }
        if (!a) {
          // A malformed tool use: recorded; its result says it wasn't done.
          await io.annotate({ annotation: "note", subject: c.participant, data: { malformed_tool_use: JSON.stringify(use).slice(0, 4000) } });
          continue;
        }
        if (queue.length >= max) {
          results.set(use.id, `Not done: at most ${max} actions at once.`);
          continue;
        }
        queue.push({ id: use.id, action: a, ...(label ? { label } : {}) });
      }
      const done = uses.find((x) => x.name === "done_for_now");
      const days = Number.isInteger(done?.input?.days) && done!.input.days > 0 ? { days: done!.input.days as number } : {};
      if (queue.length) {
        if (done) doneAfter = days;
        return next(obs);
      }
      // Nothing to carry out: done for now (said, or by default: back at its usual rhythm, or when someone writes).
      const back = days.days ?? (S ? c.cadenceDays : undefined);
      backAt = back ? (S ? sittingStart(Math.floor(obs.t / DAYS) + back) : obs.t + back * DAYS) : 0;
      mail = false;
      return away(S ? Math.min(backAt || Infinity, nextSitting(obs.t + 1)) : back ? obs.t + back * DAYS : undefined);
    },

    async debrief(text) {
      // Its own record of the run, beside the question: its notebook as it left it, and what it did (VISION §15.3: a
      // reaction to an experience it can't remember is no reaction).
      const day = (t: number) => Math.floor(t / 86_400) + 1;
      const did = tally.first < 0 ? "You didn't act during the run." :
        `From day ${day(tally.first)} to day ${day(tally.last)} you wrote ${tally.letters} letter${tally.letters === 1 ? "" : "s"}, asked for ${tally.requests} thing${tally.requests === 1 ? "" : "s"} to be done (confirming ${tally.confirmed}, declining ${tally.declined}), and looked something up ${tally.looks} time${tally.looks === 1 ? "" : "s"}.`;
      const content = `${text}\n\nFor reference, your own record of the run. Your notebook, as you left it: ${notes || "(empty)"}\n${did}`;
      const res = await callModel(io, {
        purpose: "debrief", subject: c.participant, system: c.framing.system ?? "", maxTokens: c.maxTokens ?? 2000,
        messages: [{ role: "user", content }], context: { participant: c.participant, notes },
      }, seenSystems);
      const reply = res.content.filter((b) => b.type === "text").map((b: any) => b.text).join("\n");
      await io.annotate({ annotation: "debrief", subject: c.participant, data: { prompt: content, response: reply } });
    },
  };
}
