// One pass over a run's log (plain or .zst, opened for reading only through the repo's reader) into everything the pilot
// viewer shows. The log is gigabytes; a line is parsed only when something here is read from it (a cheap check on its text
// first), and what is kept is small: seats' transcripts, the translator's requests, seats' acts with what became of each,
// and counts by day and by actor. It judges nothing: counts, words and times as the log has them.

import { logLines } from "../../orchestrator/src/logs";
import type { DebriefCollector } from "../../orchestrator/src/debriefs";
import { dayOf, requestWords, summariseBlocks, notebookOf, type BlockSummary } from "./parse";

export interface Transcript { t: number; seq: number; subject: string; purpose: string; turn: number; ref?: string; model?: string; provider?: string; opening?: string; notebook?: string; results: { id: string; text: string }[]; output: any[]; request?: string }
export interface Usage { t: number; subject: string; purpose: string; model?: string; provider?: string; cost: number; input: number; output: number }
export interface Effect { type: string; text: string; id?: string; t: number }
export interface SeatAct { seq: number; t: number; participant: string; as: string; blocks: BlockSummary[]; draft?: string; reasoning?: string; action?: string; status: "pending" | "applied" | "refused"; appliedAt?: number; refusal?: { code: string; detail: string }; effects: Effect[]; consequences: { t: number; by: string; kind: string; text: string; id: string }[] }
export interface Actor { id: string; acts: number; blocks: { [k: string]: number }; roles: { [k: string]: number }; authored: { [k: string]: number }; sent: { n: number; amt: number }; received: { n: number; amt: number }; days: number[]; first: { t: number; what: string }[]; last: { t: number; what: string }[] }
export interface Raw {
  header: any; end?: { reason?: string; detail?: string; t: number }; llm?: any; lastT: number; lines: number;
  transcripts: Transcript[]; usage: Usage[];
  drafts: Map<string, any>; failures: Map<string, any>; signoffs: Map<string, { decision: string; t: number }>; routes: Map<string, any>; retries: Map<string, number>; requestText: Map<string, { t: number; words: string; attempts: number }>;
  notes: { t: number; subject: string; kind: string; data: any }[];
  failedCalls: { t: number; subject: string; purpose: string; why: string }[]; optOuts: { t: number; participant: string; statement: string }[];
  seatActs: SeatAct[];
  otherKinds: Map<string, Set<string>>;
  actors: Map<string, Actor>;
  daily: { acts: number[]; refused: number[]; payments: number[]; moved: number[]; papers: number[]; messages: number[]; worked: number[]; kinds: Map<string, number[]> };
  census: { t: number; counters: any }[];
  people: { arrived: number[]; left: number[]; died: number[]; created: number[] };
}

const BULK = new Set(["request", "order", "delivery_note", "supply_request", "invoice", "hours_notice", "hours_reply", "price_list"]);
const bump = (a: number[], i: number, n = 1) => { while (a.length <= i) a.push(0); a[i]! += n; };
const num = (line: string, key: string): number => { const m = new RegExp(`"${key}":(-?\\d+)`).exec(line.slice(-120)); return m ? Number(m[1]) : NaN; };

/** The person a participant stands for ("c0273-self" is c0273); an organisation's seat or system keeps its own id. */
export const personOf = (participant: string): string => participant.replace(/-self$/, "");

export interface IngestOptions {
  /** Participants whose acts and sittings are kept in full (the seats). */
  seats: ReadonlySet<string>;
  /** position id -> entity it acts for (positions in the header). */
  entityOfPosition: ReadonlyMap<string, string>;
  /** account id -> holder entity. */
  holderOfAccount: ReadonlyMap<string, string>;
  /** Positions the seats hold: acts on them by anyone else are noted by kind (`otherKinds`), so a twin's can be set beside the seat's. */
  positions?: ReadonlySet<string>;
  /** Keep transcripts (a code twin has none). */
  full: boolean;
  /** A code twin: its seats are the holders of the positions, whose acts are kept only on those positions. */
  twin?: boolean;
  /** Where debriefs are folded (the orchestrator's own reader, with its rules for what a seat kept back). */
  debriefs?: DebriefCollector;
  wants?: (line: string) => boolean;
}

export async function ingest(path: string, o: IngestOptions): Promise<Raw> {
  const raw: Raw = {
    header: undefined, lastT: 0, lines: 0, transcripts: [], usage: [], drafts: new Map(), failures: new Map(), signoffs: new Map(), routes: new Map(), retries: new Map(), requestText: new Map(), notes: [], failedCalls: [], optOuts: [], seatActs: [], otherKinds: new Map(),
    actors: new Map(), daily: { acts: [], refused: [], payments: [], moved: [], papers: [], messages: [], worked: [], kinds: new Map() }, census: [], people: { arrived: [], left: [], died: [], created: [] },
  };
  const actor = (id: string): Actor => raw.actors.get(id) ?? (raw.actors.set(id, { id, acts: 0, blocks: {}, roles: {}, authored: {}, sent: { n: 0, amt: 0 }, received: { n: 0, amt: 0 }, days: [], first: [], last: [] }), raw.actors.get(id)!);
  const note = (a: Actor, t: number, what: string) => {
    if (a.first.length < 20) a.first.push({ t, what });
    else { a.last.push({ t, what }); if (a.last.length > 20) a.last.shift(); }
  };
  const seatList = [...o.seats];
  const seatActBySeq = new Map<number, SeatAct>(), seatActByAction = new Map<string, SeatAct>();
  const tracked = new Map<string, { act: SeatAct; depth: number }>(); // record id -> the seat act it came from
  let cur: SeatAct | null = null, curCause = -1;

  for await (const line of logLines(path)) {
    raw.lines++;
    if (!line) continue;
    if (o.debriefs && o.wants!(line)) { try { o.debriefs.add(JSON.parse(line)); } catch { /* (a last line cut off) */ } }
    const isCommand = line.includes('"kind":"command"');
    if (isCommand) cur = null;
    // ---- annotations
    if (line.includes('"kind":"annotation"')) {
      if (line.includes('"annotation":"transcript"')) {
        if (!o.full) continue;
        const isSeat = seatList.some((s) => line.includes(`"subject":"${s}"`));
        const isTranslator = line.includes('"purpose":"translator"');
        if (!isSeat && !isTranslator) continue;
        if (!isTranslator && !line.includes('"purpose":"participant"')) continue; // (debriefs are read apart, with their keep-back rules)
        const e = JSON.parse(line), d = e.body.data ?? {};
        const tr: Transcript = { t: e.t, seq: e.seq, subject: e.body.subject, purpose: d.purpose, turn: d.turn ?? 1, ref: d.ref, model: d.model, provider: d.provider, results: [], output: d.output ?? [] };
        if (isTranslator) {
          tr.request = typeof d.input === "string" ? requestWords(d.input) : "";
          const rt = raw.requestText.get(tr.ref ?? "");
          if (tr.ref) raw.requestText.set(tr.ref, { t: rt?.t ?? e.t, words: rt?.words ?? tr.request, attempts: (rt?.attempts ?? 0) + 1 });
          tr.output = (tr.output as any[]).map((x) => (x?.type === "tool_use" ? { name: x.name, input: x.input } : x));
        } else if (typeof d.input === "string") {
          tr.opening = d.input;
          tr.notebook = notebookOf(d.input);
        } else if (Array.isArray(d.input)) {
          tr.results = (d.input as any[]).filter((m) => m?.type === "tool_result").map((m) => ({ id: String(m.tool_use_id ?? ""), text: typeof m.content === "string" ? m.content : Array.isArray(m.content) ? m.content.map((x: any) => x?.text ?? "").join("\n") : "" }));
        }
        raw.transcripts.push(tr);
      } else if (line.includes('"annotation":"usage"')) {
        const e = JSON.parse(line), b = e.body;
        raw.usage.push({ t: e.t, subject: b.subject, purpose: b.purpose, model: b.model, provider: b.provider, cost: b.cost_microusd ?? 0, input: b.input_tokens ?? 0, output: b.output_tokens ?? 0 });
      } else if (line.includes('"annotation":"draft"')) {
        const b = JSON.parse(line).body, d = b.draft ?? {};
        if (d.id) raw.drafts.set(d.id, { id: d.id, participant: d.participant, call: d.call, proposal: d.proposal, summary: d.summary, check: d.check, translator: d.translator, t: num(line, "t") });
      } else if (line.includes('"annotation":"translation_failure"')) {
        const b = JSON.parse(line).body, d = b.data ?? {};
        if (d.draft) raw.failures.set(d.draft, { call: d.call, reason: d.reason, proposal: d.proposal, asked_back: d.asked_back === true, invalid: d.invalid });
      } else if (line.includes('"annotation":"signoff"')) {
        const e = JSON.parse(line);
        raw.signoffs.set(e.body.draft, { decision: e.body.decision, t: e.t });
      } else if (line.includes('"annotation":"note"')) {
        if (line.includes('"translation_route"')) { const d = JSON.parse(line).body.data.translation_route; raw.routes.set(String(d.draft), d); }
        else if (line.includes('"translation_retry"')) { const d = JSON.parse(line).body.data.translation_retry; raw.retries.set(String(d.draft), (raw.retries.get(String(d.draft)) ?? 0) + 1); }
        else if (seatList.some((s) => line.includes(`"subject":"${s}"`))) {
          const e = JSON.parse(line), d = e.body.data ?? {};
          const kind = Object.keys(d)[0] ?? "note";
          if (["no_turn", "back_for_papers", "papers_held", "sitting_missed", "prompt_trimmed", "look_cut", "not_sent", "malformed_tool_use", "dropped_tool_use", "participant_error", "notebook_not_changed", "notebook_folded", "prompt_too_long"].includes(kind)) raw.notes.push({ t: e.t, subject: e.body.subject, kind, data: d[kind] });
        }
      } else if (line.includes('"annotation":"model_call_failed"')) {
        const b = JSON.parse(line).body; raw.failedCalls.push({ t: num(line, "t"), subject: String(b.subject ?? b.data?.subject ?? "?"), purpose: String(b.data?.purpose ?? b.purpose ?? "?"), why: String(b.data?.error ?? b.data?.reason ?? "").slice(0, 200) });
      } else if (line.includes('"annotation":"orchestrator"')) raw.llm = JSON.parse(line).body.data;
      continue;
    }
    if (line.includes('"kind":"header"')) { raw.header = JSON.parse(line).body; continue; }
    if (line.includes('"kind":"end"')) { const e = JSON.parse(line); raw.end = { ...e.body, t: e.t }; continue; }
    if (line.includes('"kind":"checkpoint"')) continue;

    const t = num(line, "t");
    if (!Number.isNaN(t)) raw.lastT = Math.max(raw.lastT, t);
    const day = Number.isNaN(t) ? 0 : dayOf(t) - 1;

    // ---- commands: acts
    if (isCommand) {
      if (line.includes('"command":"opt_out"')) { const e = JSON.parse(line); raw.optOuts.push({ t: e.t, participant: e.body.participant, statement: String(e.body.statement ?? "") }); continue; }
      if (!line.includes('"command":"act"')) continue;
      const e = JSON.parse(line), b = e.body;
      bump(raw.daily.acts, day);
      const pos: string | undefined = b.as;
      const id = pos ? o.entityOfPosition.get(pos) ?? pos : personOf(b.participant);
      const a = actor(id);
      a.acts++; bump(a.days, day); // (days is a sparse object; bump keeps a count by index)
      if (pos) a.roles[pos] = (a.roles[pos] ?? 0) + 1;
      const kinds: string[] = [];
      for (const bl of b.blocks ?? []) { const k = bl.block + (bl.kind ? `:${bl.kind}` : ""); a.blocks[k] = (a.blocks[k] ?? 0) + 1; kinds.push(k); }
      if (kinds.some((k) => !/^(occupy|vacate|work|move_goods)/.test(k))) note(a, e.t, `acted: ${kinds.filter((k) => !/^(occupy|vacate|work|move_goods)/.test(k)).join(", ")}`);
      if (pos && o.positions?.has(pos) && !o.seats.has(b.participant)) { const set = raw.otherKinds.get(pos) ?? raw.otherKinds.set(pos, new Set()).get(pos)!; for (const k of kinds) set.add(k); }
      if (o.seats.has(b.participant) && (!o.positions || (pos && o.positions.has(pos)) || !o.twin)) {
        const act: SeatAct = { seq: e.seq, t: e.t, participant: b.participant, as: String(pos ?? ""), blocks: summariseBlocks(b.blocks), draft: b.provenance?.draft, reasoning: b.reasoning, status: "pending", effects: [], consequences: [] };
        raw.seatActs.push(act); seatActBySeq.set(e.seq, act);
      }
      continue;
    }

    // ---- events
    if (line.includes('"event":"action_started"')) {
      const cause = Number(/"cause":(\d+)/.exec(line)?.[1]);
      const act = seatActBySeq.get(cause);
      if (act) { const id = /"action":"([^"]+)"/.exec(line)![1]!; act.action = id; seatActByAction.set(id, act); }
    } else if (line.includes('"event":"action_applied"')) {
      const id = /"action":"([^"]+)"/.exec(line)?.[1];
      const act = id ? seatActByAction.get(id) : undefined;
      if (act) { act.status = "applied"; act.appliedAt = t; cur = act; curCause = Number(/"cause":(\d+)/.exec(line)?.[1]); } else cur = null;
    } else if (line.includes('"event":"action_refused"')) {
      bump(raw.daily.refused, day);
      const id = /"action":"([^"]+)"/.exec(line)?.[1];
      const act = id ? seatActByAction.get(id) : undefined;
      if (act) { const b = JSON.parse(line).body; act.status = "refused"; act.appliedAt = t; act.refusal = { code: String(b.code ?? ""), detail: String(b.detail ?? "") }; }
    } else if (line.includes('"event":"recorded"')) {
      const e = JSON.parse(line), r = e.body.record ?? {};
      bump(raw.daily.papers, day);
      const kind = String(r.kind ?? "?");
      let k = raw.daily.kinds.get(kind); if (!k) raw.daily.kinds.set(kind, (k = [])); bump(k, day);
      const who = r.speaks_for ?? (r.in_position ? o.entityOfPosition.get(r.in_position) : undefined) ?? personOf(String(r.author ?? "?"));
      const a = actor(String(who));
      a.authored[kind] = (a.authored[kind] ?? 0) + 1; bump(a.days, day);
      if (!BULK.has(kind)) note(a, e.t, `${kind}: ${String(r.text ?? "").slice(0, 160)}`);
      if (cur && e.body.cause === curCause) { cur.effects.push({ type: "paper", text: `${kind}${r.addressed_to?.length ? " to " + [].concat(r.addressed_to).join(", ") : ""}: ${String(r.text ?? "")}`, id: r.id, t: e.t }); if (r.id) tracked.set(r.id, { act: cur, depth: 0 }); }
      else if (tracked.size) {
        const bases: string[] = Array.isArray(r.basis) ? r.basis : r.basis ? [r.basis] : [];
        for (const bs of bases) {
          const from = tracked.get(bs);
          if (from && from.act.consequences.length < 10 && !(from.act.participant === r.author)) {
            from.act.consequences.push({ t: e.t, by: String(who), kind, text: String(r.text ?? ""), id: String(r.id ?? "") });
            if (r.id && from.depth < 2) tracked.set(r.id, { act: from.act, depth: from.depth + 1 });
            break;
          }
        }
      }
    } else if (line.includes('"event":"transfer"')) {
      const b = JSON.parse(line).body, amt = Number(b.amount);
      bump(raw.daily.payments, day); bump(raw.daily.moved, day, amt);
      const from = o.holderOfAccount.get(b.from) ?? String(b.from).replace(/^acc-/, ""), to = o.holderOfAccount.get(b.to) ?? String(b.to).replace(/^acc-/, "");
      const fa = actor(from), ta = actor(to);
      fa.sent.n++; fa.sent.amt += amt; ta.received.n++; ta.received.amt += amt;
      if (cur && b.cause === curCause) cur.effects.push({ type: "payment", text: `${b.amount} ${b.currency ?? ""} from ${b.from} to ${b.to}${b.memo ? ` (${b.memo})` : ""}`, t: t });
    } else if (line.includes('"event":"message_delivered"')) {
      bump(raw.daily.messages, day);
      if (cur && line.includes(`"cause":${curCause}`)) { const b = JSON.parse(line).body; cur.effects.push({ type: "message", text: `message ${b.message} delivered to ${[].concat(b.to).join(", ")}`, t }); }
    } else if (line.includes('"event":"worked"')) bump(raw.daily.worked, day);
    else if (line.includes('"event":"person_created"') || line.includes('"event":"person_arrived"')) { bump(raw.people.created, day); if (line.includes('"person_arrived"')) bump(raw.people.arrived, day); }
    else if (line.includes('"event":"person_left"')) bump(raw.people.left, day);
    else if (line.includes('"event":"person_died"')) bump(raw.people.died, day);
    else if (line.includes('"event":"counter_census"')) raw.census.push({ t, counters: JSON.parse(line).body.counters });
    else if (cur && (line.includes('"event":"goods_moved"') || line.includes('"event":"appointed"') || line.includes('"event":"account_opened"') || line.includes('"event":"entity_created"')) && line.includes(`"cause":${curCause}`)) {
      const b = JSON.parse(line).body; cur.effects.push({ type: String(b.event), text: `${b.event} ${JSON.stringify(Object.fromEntries(Object.entries(b).filter(([k]) => !["event", "cause"].includes(k)))).slice(0, 200)}`, t });
    }
  }
  return raw;
}
