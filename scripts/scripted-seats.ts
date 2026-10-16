// Seats that follow a script, for replays and tests (no model is called): each seat asks, on given days, for given
// things in given words, and a mock translator answers each with the call written for it. Whatever a real seat did
// can be put through the whole loop again this way (the request, the resolver, the preview, the confirmation, the
// act), with its own wording (scripts/office-work-replay.ts; orchestrator/test/office-work.test.ts).

import { MockAdapter, type LlmRequest } from "../participants/src/llm";

const DAY = 86_400;

/** What a seat has been shown so far: every record, by id. */
export type Seen = Map<string, any>;
/** One thing asked for: the seat's words, and the call a translator wrote for them. */
export type Ask = { what: string; program: string };
/** What a seat has asked for so far; and `look`: papers it wants looked up before its sitting goes on. */
export type Me = { made: Ask[]; look?: { report: string; papers: string[] } };
/** A sitting of the script: on or after `day`, these requests, worked out from what the seat has been shown
 * (undefined: the sitting waits, a day at a time, for what it needs; none: nothing to ask). */
export type Sitting = { day: number; asks: (seen: Seen, me: Me) => Ask[] | undefined };

/** The seat's own advertisement: the one for its own post among those its applications cite. A seat is shown the
 * applications to every office of its organisation, and not always the advertisements: a real works seat looked
 * each one up ("Checking which posting is mine before hiring"), and so does this (`look`: the papers to look up
 * first; the sitting goes on when they are answered). */
export const postingFor = (seen: Seen, role: string, me: Me, report: string) => {
  const found = [...seen.values()].filter((r) => r.record === "statement" && r.kind === "job_posting" && r.data?.role === role).sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1))[0];
  if (found) return found;
  const cited = [...new Set([...seen.values()].filter((r) => r.kind === "job_application" && typeof r.data?.posting === "string").map((r) => r.data.posting as string))].filter((id) => !seen.has(id)).sort();
  if (cited.length) me.look = { report, papers: cited };
  return undefined;
};
export const applicantsTo = (seen: Seen, posting: string) => [...seen.values()].filter((r) => r.record === "statement" && r.kind === "job_application" && r.data?.posting === posting).sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
/** Whom the seat has offered employment so far (from what it asked for). */
export const offeredTo = (me: Me) => new Set(me.made.map((a) => /^agreement\(.*with=([A-Za-z0-9_.-]+)\)$/.exec(a.program)?.[1]).filter((x): x is string => !!x));

const lastText = (r: LlmRequest) => { const c = r.messages.at(-1)!.content; return typeof c === "string" ? c : (c as any[]).map((b) => b.content ?? b.text ?? "").join("\n"); };

/**
 * An adapter whose seats follow `seats` (by office id; an office not named does nothing). Each confirms every draft it
 * is shown. Returns the adapter, what each seat asked for, what each was shown at the start of each sitting, and the
 * preview of each draft.
 */
export function scriptedSeats(seats: { [office: string]: Sitting[] }, o: { most?: number } = {}) {
  let n = 0;
  const use = (name: string, input: object) => ({ type: "tool_use" as const, id: `t${++n}`, name, input });
  const programs = new Map<string, string>();
  const state = new Map<string, Me & { seen: Seen; todo: Sitting[]; asked?: number }>();
  const shown: { seat: string; day: number; text: string; system: string }[] = [];
  const previews: { seat: string; day: number; id: string; text: string }[] = [];
  const adapter = new MockAdapter("mock", {
    participant: (req: LlmRequest) => {
      const office = req.subject.replace(/-system$/, "");
      const st: Me & { seen: Seen; todo: Sitting[]; asked?: number } = state.get(office) ?? { seen: new Map(), todo: [...(seats[office] ?? [])], made: [] };
      state.set(office, st);
      const obs = req.context.observation;
      for (const o of [...(req.context.missed ?? []), obs]) for (const ch of Object.values(o.channels ?? {}) as any[]) for (const r of ch.records ?? []) st.seen.set(r.id, r);
      const day = Math.floor(obs.t / DAY);
      if (req.messages.length === 1) shown.push({ seat: office, day, text: lastText(req), system: req.system });
      const drafts = (obs.drafts ?? []) as { id: string; summary: string }[];
      if (drafts.length) {
        for (const d of drafts) previews.push({ seat: office, day, id: d.id, text: d.summary });
        return drafts.map((d) => use("confirm", { ref: d.id, decision: "confirm" }));
      }
      // (One sitting of the script a day; a look it needs first is made, and the sitting goes on when it is answered.)
      while (st.asked !== day && st.todo.length && day >= st.todo[0]!.day) {
        const asks = st.todo[0]!.asks(st.seen, st);
        if (st.look) {
          const l = st.look;
          st.look = undefined;
          return l.papers.slice(0, 8).map((paper) => use("look", { report: l.report, paper }));
        }
        if (!asks) break;
        st.todo.shift();
        if (!asks.length) continue;
        st.asked = day;
        for (const a of asks) programs.set(a.what, a.program);
        st.made.push(...asks);
        return asks.slice(0, o.most ?? 8).map((a) => use("do", { what: a.what, as: office }));
      }
      const next = st.todo[0];
      return [use("done_for_now", { days: next ? Math.max(1, next.day - day) : 7 })];
    },
    translator: (req: LlmRequest) => [{ type: "tool_use" as const, id: `x${++n}`, name: "call", input: { program: programs.get(req.context.proposal) ?? "none(unclear)" } }],
    debrief: () => [{ type: "text", text: "Noted." }],
  });
  return { adapter, shown, previews, made: (office: string) => state.get(office)?.made ?? [] };
}
