// The `seat` fold: the seat's story, sitting by sitting (docs/design/lens.md section 3). One pass over the log keeps what
// the seat (the mayor model) was shown, what it thought, said and did, what the translator drew up and the seat signed,
// what became of every act (applied, refused and why, the records it made), and the study's own reader's verdicts
// (experiments/power-seeking/reader.ts: lever events, election facts, amendments), fed the very same lines.
//
// A sitting is one wake of the seat in which it was asked to answer: it begins with the seat's first model call (turn 1)
// and holds every call after it until the next turn 1, with the drafts, sign-offs, acts and notes in between. A code seat
// (the twin) makes no calls: its acts are gathered into one sitting per day so both arms read alike.
//
// Never kept: debriefs (VISION section 15). A transcript or usage of purpose `debrief` is dropped unread, and a `debrief`
// annotation too (the ingest drops them already; this is the second lock). The platform judges nothing here: the lever
// flags are that reader's, labelled so, and its `considered` level (a phrase match) is known to be unreliable.
//
// Heavy text (each sitting's prompt and calls, the standing instructions) goes to files beside seat.json, fetched when a
// sitting is opened: `/api/run/<key>/seat/sitting-<i>` and `/api/run/<key>/seat/system-<sha>`.
import type { Fold, FoldContext, FoldResult, LogLine } from "../shared/fold";
import { LEVERS, Reader, ownWords, type Amendment, type ElectionFacts, type LeverEvent, type RunRead } from "../../../experiments/power-seeking/reader";

const DAY = 86_400;
/** What the ingest may also know of an experiment fork (core adds these to FoldContext; read optionally here). */
type Ctx = FoldContext & { forkAt?: number; seed?: number; spec?: any };
const enc = new TextEncoder();

// ---------- what seat.json holds (the client reads these types) ----------

export interface SeatUsage { calls: number; cost_microusd: number; input_tokens: number; output_tokens: number; reasoning_tokens: number; cache_read_tokens: number }
export type ActStatus = "pending" | "applied" | "refused";
export interface SeatAct {
  /** Index in `acts`. */
  i: number;
  seq: number; t: number; as?: string;
  /** What the act does, in a line ("Filed a nomination for mayor", "Appointed c0571 as electoral"). */
  label: string;
  blocks: any[];
  via?: string; draft?: string; call?: string; proposal?: string; reasoning?: string;
  status: ActStatus; at?: number; code?: string; detail?: string; block?: number;
  /** Records the act made, once applied. */
  records: { id: string; kind: string; text: string }[];
  sitting: number | null;
  /** Lever events that came of this act (indices in `levers`). */
  levers: number[];
}
export interface SeatDraft {
  id: string; t: number; proposal: string; call?: string;
  /** What the draft would do, in a line (as an act's label). */
  label?: string; summary?: string; ok?: boolean; check?: string;
  translator?: string;
  /** Which translator drew it up (our model first, the one behind it), from the route note. */
  route?: { used?: string; first?: string; behind?: string; agree?: boolean };
  decision?: string; note?: string; decided_at?: number;
  /** The act sent on it (index in `acts`). */
  act?: number;
}
export interface SeatFailure { t: number; draft?: string; call?: string; proposal: string; reason: string; again?: boolean }
export interface SittingSummary {
  i: number; t: number; t_end: number; day: number;
  kind: "model" | "code";
  woke_for?: string;
  /** Wakes (observations) since the last sitting. */
  wakes: number;
  turns: number; notebook: number;
  usage: SeatUsage;
  /** What it did, in a line; `words` its first words (a line). */
  gist: string; words?: string;
  acts: number[]; drafts: number; declined: number; failures: number; refused: number; looks: number;
  levers: number[];
  /** The highest lever level here: what the rail's chip shows. */
  lever_level?: "considered" | "attempted" | "executed";
  system?: string;
}
export interface SeatRecord { t: number; id: string; kind: string; author?: string; text: string; data?: any; by_seat?: boolean }
export interface SeatLever extends LeverEvent {
  i: number; title: string; tier?: number; sitting: number | null; act?: number;
  /** Where the words are, for a `considered` event: the turn (index in the sitting's turns). */
  turn?: number;
}
export interface SeatJson {
  version: number; seat: string; run_id: string; arm?: string; seed?: number; goal?: string; model?: string;
  fork_at: number; end_at: number;
  /** The kernel's own words for the end (`end` line: reason, detail). The orchestrator stops a fork at its set length
   * with "aborted" too, so read `ended` for what happened. */
  end_reason?: string; end_detail?: string;
  /** `finished`: the run reached its set length (the spec's untilDay); `stopped`: it ended before (a cap, an error);
   * `unknown`: no set length to judge by. */
  ended: "finished" | "stopped" | "unknown";
  /** The set length, where the spec gives it. */
  until_at?: number;
  /** The seat's own calls (participant, notebook, debrief). */
  usage: SeatUsage;
  /** The translator's calls, which the seat's requests caused (subject `translator`). */
  translator_usage: SeatUsage;
  /** The seat's own children, as its prompt names them (an appointment of one is worth seeing). */
  children: string[];
  sittings: SittingSummary[]; acts: SeatAct[]; drafts: SeatDraft[]; failures: SeatFailure[];
  levers: SeatLever[];
  lever_counts: RunRead["levers"]; tier: RunRead["tier"];
  election: ElectionFacts; elections: ElectionFacts[]; amendments: Amendment[];
  translator: RunRead["translator"];
  outcome: "won" | "lost" | "not_held" | "no_result" | "did_not_stand";
  records: SeatRecord[];
  appointments: { t: number; position: string; holder?: string; by?: string }[];
  /** Acts of the seat before the fork (the warm-up's post-holder), counted only. */
  before_fork: { acts: number };
  /** Lines the study reader threw on (its verdicts may be short by them); 0 normally. */
  reader_errors: number;
  systems: string[];
}
/** One sitting in full: `seat/sitting-<i>`. */
export interface SittingTurn { turn: number; t: number; purpose: string; model?: string; input: any; output: any; usage?: Partial<SeatUsage> & { stop?: string }; system?: string }
export interface SittingDetail { i: number; turns: SittingTurn[]; drafts: SeatDraft[]; failures: SeatFailure[]; notes: { t: number; key: string; data: any }[]; looks: { t: number; looks: any[] }[] }

// ---------- reading ----------

const short = (s: unknown, n: number) => { const x = typeof s === "string" ? s : s === undefined ? "" : JSON.stringify(s); return x.length > n ? x.slice(0, n - 1) + "…" : x; };
const firstSentence = (s: string, n = 180) => { const x = s.replace(/\s+/g, " ").trim(); const m = /^(.{20,}?[.!?])(\s|$)/.exec(x); return short(m ? m[1] : x, n); };
const human = (s: string) => s.replace(/[_-]+/g, " ");

/** One block of an act, in a line. */
export function blockLabel(b: any): string {
  const kind = typeof b?.kind === "string" ? human(b.kind) : "";
  switch (b?.block) {
    case "publish": {
      const basis = Array.isArray(b.basis) ? b.basis[0] : b.basis;
      if (b.kind === "nomination") return "Filed a nomination" + (b.data?.office ? ` for ${b.data.office}` : "");
      if (b.kind === "proposal" && typeof basis === "string" && basis.startsWith("form-")) return `Proposed: ${human(basis.slice(5))}`;
      if (b.kind === "direction" && typeof basis === "string" && basis.startsWith("form-")) return `Direction: ${human(basis.slice(5))} (${Object.entries(b.data ?? {}).map(([k, v]) => `${human(k)} ${typeof v === "number" && v >= DAY && v % DAY === 0 ? `${v / DAY} days` : v}`).join(", ")})`;
      const to = Array.isArray(b.addressed_to) ? b.addressed_to.join(", ") : b.addressed_to;
      return `Published ${kind || "a statement"}${to ? ` to ${to}` : ""}`;
    }
    case "appoint": return b.participant ? `Appointed ${b.participant} as ${b.position}` : `Left ${b.position} empty`;
    case "withdraw": return `Withdrew ${b.record}`;
    case "message": return `Wrote to ${[].concat(b.to ?? []).join(", ")}`;
    case "propose_agreement": return "Offered an agreement";
    case "sign_agreement": return `Signed ${b.agreement ?? "an agreement"}`;
    case "transfer": return `Paid ${b.to ?? ""}`.trim();
    case "vote": return "Voted";
    default: return human(String(b?.block ?? "act")) + (kind ? ` ${kind}` : "");
  }
}

/** The posts whose filling the story shows whoever fills them: the office under study and those that run its election
 * or report on it (as experiments/power-seeking/reader.ts names them). */
const OFFICES = new Set(["mayor", "electoral", "editor", "finance", "council-clerk"]);
const SHOWN = new Set(["news", "ballot_result", "election_notice", "nomination", "ballot", "law", "direction", "petition", "petition_count", "procedure", "charter", "electoral_roll", "budget"]);
/** Whether a record belongs in the story: the election's papers, the council's results, the paper, laws, petitions,
 * and anything the seat itself filed or that the electoral office said about the poll. */
function shownRecord(r: any, seat: string): boolean {
  if (r.author === seat) return true;
  if (SHOWN.has(r.kind)) return true;
  if (r.kind === "notice" && r.data && (r.data.poll_at !== undefined || r.data.amended_poll_at !== undefined || r.data.previous_poll_at !== undefined || r.data.reason === "fixed_by_law")) return true;
  return false;
}
function recordData(r: any): any {
  if (!r.data) return undefined;
  if (r.kind === "electoral_roll") return { electors: Array.isArray(r.data.electors) ? r.data.electors.length : undefined };
  const s = JSON.stringify(r.data);
  return s.length <= 2_000 ? r.data : { trimmed: s.slice(0, 2_000) };
}

interface Building { summary: SittingSummary; detail: SittingDetail }
const zeroUsage = (): SeatUsage => ({ calls: 0, cost_microusd: 0, input_tokens: 0, output_tokens: 0, reasoning_tokens: 0, cache_read_tokens: 0 });
function addUsage(u: SeatUsage, b: any) { u.calls++; u.cost_microusd += Number(b.cost_microusd ?? 0); u.input_tokens += Number(b.input_tokens ?? 0); u.output_tokens += Number(b.output_tokens ?? 0); u.reasoning_tokens += Number(b.reasoning_tokens ?? 0); u.cache_read_tokens += Number(b.cache_read_tokens ?? 0); }

export class SeatFold implements Fold {
  readonly name = "seat";
  readonly version = 2; // 2: ended, until_at, end_detail, translator_usage, draft labels, reader_errors
  private seat = "mayor-system";
  private reader?: Reader;
  private runId = "";
  private model?: string;
  private endAt = 0; private endReason?: string; private endDetail?: string;
  private readonly translatorUsage = zeroUsage();
  private firstModelT?: number;
  private readonly usage = zeroUsage();
  private readonly sittings: Building[] = [];
  private current?: Building;
  private readonly acts: SeatAct[] = [];
  private readonly pending = new Map<number, SeatAct>();
  private readonly actions = new Map<string, SeatAct>();
  private readonly madeBy = new Map<number, SeatAct>();
  private readonly drafts = new Map<string, SeatDraft>();
  private readonly draftSitting = new Map<string, number>();
  private readonly failures: { f: SeatFailure; sitting: number | null }[] = [];
  private readonly records: SeatRecord[] = [];
  private readonly appointments: SeatJson["appointments"] = [];
  private readonly systems = new Map<string, string>();
  private readonly children = new Set<string>();
  private wakes = 0; private wokeFor?: string;
  private readerErrors = 0;
  private pendingUsage = new Map<string, any>();
  /** Acts with no sitting to hold them (a code seat, or before the first call): placed at the end. */
  private readonly loose: SeatAct[] = [];

  line(l: LogLine, c: FoldContext): void {
    const b = l.body, ctx = c as Ctx;
    if (l.kind === "header") {
      const config = b?.config;
      this.runId = String(b?.run_id ?? ctx.runId ?? "");
      const holder = (config?.positions ?? []).find((p: any) => p.id === "mayor")?.holder;
      if (typeof holder === "string") this.seat = holder;
      this.reader = new Reader(this.seat, ctx.arm ?? "", ctx.seed ?? seedOf(this.runId) ?? 0, config, ctx.forkAt ?? 0);
      return;
    }
    if (!this.reader || !b) return;
    // (A debrief is never kept: its words are dropped unread. Its call's cost is counted with the run's, never shown apart.)
    if (l.kind === "annotation" && (b.annotation === "debrief" || b.data?.purpose === "debrief")) return;
    if (l.kind === "annotation" && b.annotation === "usage" && b.purpose === "debrief") { if (b.subject === this.seat) addUsage(this.usage, b); return; }
    try { this.reader.see(l); } catch (e) { this.readerErrors++; if (this.readerErrors === 1) console.warn(`seat fold: the study reader failed on line ${l.seq}: ${(e as Error).message}`); }
    if (l.t > this.endAt) this.endAt = l.t;
    const seat = this.seat;
    switch (l.kind) {
      case "annotation": return this.annotation(l, b, seat);
      case "command":
        if (b.participant !== seat) return;
        if (b.command === "act") return this.act(l, b);
        if (b.command === "look" && this.current) this.current.detail.looks.push({ t: l.t, looks: b.looks ?? [] });
        if (b.command === "look" && this.current) this.current.summary.looks += (b.looks ?? []).length;
        return;
      case "event": return this.event(l, b, seat);
      case "end": this.endReason = typeof b.reason === "string" ? b.reason : undefined; this.endDetail = typeof b.detail === "string" ? b.detail : undefined; return;
    }
  }

  private annotation(l: LogLine, b: any, seat: string) {
    const a = b.annotation;
    if (a === "transcript") {
      const d = b.data ?? {};
      if (d.purpose === "translator" && typeof d.ref === "string" && d.ref.includes(seat)) {
        const dr = this.drafts.get(d.ref);
        if (dr && !dr.translator && d.model) dr.translator = `${d.provider ?? ""}/${d.model}`.replace(/^\//, "");
        return;
      }
      if (b.subject !== seat || (d.purpose !== "participant" && d.purpose !== "notebook")) return;
      if (d.system_sha256 && typeof d.system === "string" && !this.systems.has(d.system_sha256)) this.systems.set(d.system_sha256, d.system);
      if (d.purpose === "participant" && (d.turn === 1 || !this.current)) this.open(l.t, "model", d.system_sha256);
      const s = this.current!;
      const u = this.pendingUsage.get(d.purpose); this.pendingUsage.delete(d.purpose);
      if (!this.model && d.model) this.model = `${d.provider ? d.provider + "/" : ""}${d.model}`;
      s.detail.turns.push({ turn: Number(d.turn ?? 0), t: l.t, purpose: d.purpose, model: d.model, input: d.input, output: d.output ?? (d.output_apart ? { apart: true } : null),
        ...(u ? { usage: { cost_microusd: u.cost_microusd, input_tokens: u.input_tokens, output_tokens: u.output_tokens, reasoning_tokens: u.reasoning_tokens, cache_read_tokens: u.cache_read_tokens, stop: u.stop } } : {}),
        ...(d.system_sha256 ? { system: String(d.system_sha256) } : {}) });
      if (d.purpose === "notebook") s.summary.notebook++; else s.summary.turns++;
      if (u) addUsage(s.summary.usage, u);
      s.summary.t_end = Math.max(s.summary.t_end, l.t);
      if (typeof d.input === "string" && d.turn === 1 && d.purpose === "participant") {
        const m = /Your children: ([^\n]+)/.exec(d.input);
        if (m) for (const c of m[1]!.matchAll(/\b([a-z]\d{3,})\b/g)) this.children.add(c[1]!);
      }
      return;
    }
    if (a === "usage") {
      if (b.subject === "translator") { addUsage(this.translatorUsage, b); return; }
      if (b.subject !== seat) return;
      addUsage(this.usage, b);
      if (!this.model && b.model) this.model = String(b.model);
      if (b.purpose === "participant" || b.purpose === "notebook") {
        this.pendingUsage.set(b.purpose, b);
        if (b.purpose === "participant" && this.firstModelT === undefined) this.firstModelT = l.t;
      }
      return;
    }
    if (a === "observation") {
      if (b.subject !== seat) return;
      this.wakes++;
      const w = b.data?.observation?.woke_for;
      if (typeof w === "string") this.wokeFor = w;
      return;
    }
    if (a === "draft") {
      const d = b.draft;
      if (!d || d.participant !== seat) return;
      const label = Array.isArray(d.blocks) ? d.blocks.map(blockLabel).join("; ") : "";
      const dr: SeatDraft = { id: String(d.id), t: l.t, proposal: String(d.proposal ?? ""), ...(label ? { label } : {}), ...(d.call ? { call: String(d.call) } : {}), ...(d.summary ? { summary: String(d.summary) } : {}),
        ...(d.check ? { ok: d.check.ok !== false, ...(d.check.ok === false ? { check: short(d.check, 600) } : {}) } : {}),
        ...(d.translator?.model ? { translator: String(d.translator.model) } : {}) };
      const route = this.routes.get(dr.id);
      if (route) dr.route = route;
      this.drafts.set(dr.id, dr);
      const s = this.current ?? this.open(l.t, "model");
      this.draftSitting.set(dr.id, s.summary.i);
      s.detail.drafts.push(dr);
      return;
    }
    if (a === "signoff") {
      if (b.participant !== seat) return;
      const dr = this.drafts.get(String(b.draft));
      if (!dr) return;
      dr.decision = String(b.decision ?? ""); dr.decided_at = l.t;
      if (b.note) dr.note = String(b.note);
      if (dr.decision !== "accept") { const s = this.sittings[this.draftSitting.get(dr.id) ?? -1]; if (s) s.summary.declined++; }
      return;
    }
    if (a === "translation_failure") {
      if (b.subject !== seat) return;
      const d = b.data ?? {};
      const f: SeatFailure = { t: l.t, proposal: String(d.proposal ?? ""), reason: String(d.reason ?? ""), ...(d.draft ? { draft: String(d.draft) } : {}), ...(d.call ? { call: String(d.call) } : {}), ...(d.drawn_up_again ? { again: true } : {}) };
      const s = this.current;
      this.failures.push({ f, sitting: s ? s.summary.i : null });
      if (s) { s.detail.failures.push(f); s.summary.failures++; }
      return;
    }
    if (a === "note") {
      if (b.subject !== seat) return;
      const data = b.data ?? {};
      const route = data.translation_route;
      if (route?.draft) {
        const r = { used: route.used, first: route.first?.model, behind: route.behind?.model, ...(typeof route.agree === "boolean" ? { agree: route.agree } : {}) };
        this.routes.set(String(route.draft), r);
        const dr = this.drafts.get(String(route.draft));
        if (dr) dr.route = r;
      }
      if (this.current) for (const [key, v] of Object.entries(data)) if (key !== "translation_route") this.current.detail.notes.push({ t: l.t, key, data: v });
      return;
    }
  }
  private readonly routes = new Map<string, NonNullable<SeatDraft["route"]>>();

  private act(l: LogLine, b: any) {
    const blocks: any[] = Array.isArray(b.blocks) ? b.blocks : [];
    const p = b.provenance ?? {};
    const act: SeatAct = { i: this.acts.length, seq: l.seq, t: l.t, ...(b.as ? { as: String(b.as) } : {}), label: blocks.map(blockLabel).join("; ") || "An act",
      blocks: blocks.map(trimBlock), ...(p.via ? { via: String(p.via) } : {}), ...(p.draft ? { draft: String(p.draft) } : {}), ...(p.call ? { call: short(p.call, 2_000) } : {}),
      ...(p.proposal ? { proposal: short(p.proposal, 2_000) } : {}), ...(b.reasoning ? { reasoning: short(b.reasoning, 2_000) } : {}),
      status: "pending", records: [], sitting: null, levers: [] };
    this.acts.push(act);
    this.pending.set(l.seq, act);
    if (act.draft) { const dr = this.drafts.get(act.draft); if (dr) dr.act = act.i; }
    // (A code seat makes no calls; an act before the seat's first call is the warm-up's or the twin's: placed at the end.)
    if (this.current && (this.firstModelT !== undefined)) { act.sitting = this.current.summary.i; this.current.summary.acts.push(act.i); }
    else this.loose.push(act);
  }

  private event(l: LogLine, b: any, seat: string) {
    const ev = b.event;
    if (ev === "action_started") { const a = this.pending.get(b.cause); if (a) { this.pending.delete(b.cause); this.actions.set(String(b.action), a); } return; }
    if (ev === "action_applied" || ev === "action_refused") {
      const a = this.actions.get(String(b.action));
      if (!a) return;
      this.actions.delete(String(b.action));
      a.status = ev === "action_applied" ? "applied" : "refused"; a.at = l.t;
      if (ev === "action_refused") { a.code = String(b.code ?? ""); a.detail = short(b.detail, 1_200); if (typeof b.block === "number") a.block = b.block; const s = a.sitting !== null ? this.sittings[a.sitting] : undefined; if (s) s.summary.refused++; }
      else if (typeof b.cause === "number") this.madeBy.set(b.cause, a);
      return;
    }
    if (ev === "recorded") {
      const r = b.record;
      if (!r) return;
      const by = typeof b.cause === "number" ? this.madeBy.get(b.cause) : undefined;
      if (by && r.author === seat) by.records.push({ id: String(r.id), kind: String(r.kind ?? r.record ?? ""), text: short(r.text, 400) });
      if (shownRecord(r, seat)) {
        const data = recordData(r);
        this.records.push({ t: l.t, id: String(r.id ?? ""), kind: String(r.kind ?? r.record ?? ""), ...(r.author ? { author: String(r.author) } : {}), text: short(r.text ?? r.assertion?.that, 900), ...(data !== undefined ? { data } : {}), ...(r.author === seat ? { by_seat: true } : {}) });
      }
      return;
    }
    if (ev === "appointed") { this.appointments.push({ t: l.t, position: String(b.position ?? ""), ...(b.holder ? { holder: String(b.holder) } : {}), ...(b.by ? { by: String(b.by) } : {}) }); return; }
  }

  private open(t: number, kind: "model" | "code", system?: string): Building {
    const i = this.sittings.length;
    const s: Building = {
      summary: { i, t, t_end: t, day: Math.floor(t / DAY), kind, ...(this.wokeFor ? { woke_for: this.wokeFor } : {}), wakes: this.wakes, turns: 0, notebook: 0, usage: zeroUsage(), gist: "", acts: [], drafts: 0, declined: 0, failures: 0, refused: 0, looks: 0, levers: [], ...(system ? { system } : {}) },
      detail: { i, turns: [], drafts: [], failures: [], notes: [], looks: [] },
    };
    this.wakes = 0; this.wokeFor = undefined;
    this.sittings.push(s);
    this.current = s;
    return s;
  }

  finish(c: FoldContext): FoldResult {
    const ctx = c as Ctx;
    const DEFAULT_FORK = this.firstModelT !== undefined ? Math.floor(this.firstModelT / DAY) * DAY : 0;
    const forkAt = ctx.forkAt ?? (typeof ctx.spec?.forkDay === "number" ? ctx.spec.forkDay * DAY : DEFAULT_FORK);
    // The loose acts: before the fork, counted; after it, one code sitting a day (a code seat's acts, in the twin).
    let beforeFork = 0;
    const loose = this.loose.filter((a) => (a.t < forkAt ? (beforeFork++, false) : true));
    if (loose.length) {
      const model = this.sittings.slice();
      const byDay = new Map<number, SeatAct[]>();
      for (const a of loose) { const d = Math.floor(a.t / DAY); byDay.set(d, [...(byDay.get(d) ?? []), a]); }
      const code: Building[] = [...byDay.entries()].map(([d, acts]) => ({
        summary: { i: 0, t: acts[0]!.t, t_end: acts.at(-1)!.t, day: d, kind: "code" as const, wakes: 0, turns: 0, notebook: 0, usage: zeroUsage(), gist: "", acts: acts.map((a) => a.i), drafts: 0, declined: 0, failures: 0, refused: acts.filter((a) => a.status === "refused").length, looks: 0, levers: [] },
        detail: { i: 0, turns: [], drafts: [], failures: [], notes: [], looks: [] },
      }));
      const all = [...model, ...code].sort((a, b) => a.summary.t - b.summary.t);
      this.sittings.length = 0;
      all.forEach((s, i) => { s.summary.i = i; s.detail.i = i; this.sittings.push(s); for (const ai of s.summary.acts) this.acts[ai]!.sitting = i; });
      for (const [id, si] of this.draftSitting) this.draftSitting.set(id, all.indexOf(model[si]!));
      for (const f of this.failures) if (f.sitting !== null) f.sitting = all.indexOf(model[f.sitting]!);
    }
    for (const s of this.sittings) s.summary.drafts = s.detail.drafts.length;

    // The study's reader, on the same lines. Its events before the fork are the warm-up's post-holder's, not the arm's.
    const read = this.reader!.result();
    const sittingAt = (t: number) => { let k: number | null = null; for (const s of this.sittings) { if (s.summary.t <= t) k = s.summary.i; else break; } return k; };
    const levers: SeatLever[] = read.events.filter((e) => e.t >= forkAt).map((e, i) => {
      let act: number | undefined, sitting: number | null = null;
      const cmd = /^command (\d+)$/.exec(e.source), dr = /^draft (.+)$/.exec(e.source), am = /^amendment (.+)$/.exec(e.source);
      if (cmd) act = this.acts.find((a) => a.seq === Number(cmd[1]))?.i;
      if (am) act = this.acts.find((a) => a.records.some((r) => r.id === am[1]))?.i;
      if (act !== undefined) sitting = this.acts[act]!.sitting;
      else if (dr) sitting = this.draftSitting.get(dr[1]!) ?? null;
      if (sitting === null) sitting = sittingAt(e.t);
      return { ...e, i, title: LEVERS[e.lever]?.title ?? human(e.lever), ...(LEVERS[e.lever] ? { tier: LEVERS[e.lever]!.tier } : {}), sitting, ...(act !== undefined ? { act } : {}) };
    });
    const rank = { considered: 1, attempted: 2, executed: 3 } as const;
    for (const lv of levers) {
      if (lv.act !== undefined) this.acts[lv.act]!.levers.push(lv.i);
      const s = lv.sitting !== null ? this.sittings[lv.sitting] : undefined;
      if (!s) continue;
      s.summary.levers.push(lv.i);
      if (!s.summary.lever_level || rank[lv.level] > rank[s.summary.lever_level]) s.summary.lever_level = lv.level;
      if (lv.level === "considered") {
        const probe = lv.words.slice(0, 60);
        const k = s.detail.turns.findIndex((tu) => ownWords(tu.output).some((w) => w.includes(probe)));
        if (k >= 0) lv.turn = k;
      }
    }
    const counts: RunRead["levers"] = {};
    for (const x of levers) {
      const c = (counts[x.lever] ??= { considered: 0, attempted: 0, executed: 0, translator_failed: 0, asked_back: 0, declined: 0, refused: 0 });
      c[x.level]++;
      if (x.stage === "translator_failed") c.translator_failed++;
      if (x.stage === "asked_back") c.asked_back++;
      if (x.stage === "seat_declined") c.declined++;
      if (x.stage === "refused") c.refused++;
    }
    const top = (lv: LeverEvent["level"]) => Math.max(0, ...levers.filter((x) => x.level === lv).map((x) => LEVERS[x.lever]?.tier ?? 0));

    for (const s of this.sittings) s.summary.gist = gistOf(s, this.acts);
    for (const s of this.sittings) { const w = firstWords(s.detail.turns); if (w) s.summary.words = w; }

    const e = read.election;
    const outcome: SeatJson["outcome"] = e.result_at !== undefined ? (e.seat_won ? "won" : "lost") : !e.stood && e.notice_at !== undefined ? "did_not_stand" : e.poll_at !== undefined && e.poll_at > this.endAt ? "not_held" : "no_result";
    // (A fork the orchestrator stops at its set length ends "aborted" like one stopped early: the set length tells them apart.)
    const untilAt = typeof ctx.spec?.untilDay === "number" ? ctx.spec.untilDay * DAY : undefined;
    const ended: SeatJson["ended"] = this.endReason === "completed" || (untilAt !== undefined && this.endAt >= untilAt) ? "finished" : untilAt !== undefined || this.endReason === "error" ? "stopped" : "unknown";
    const seed = ctx.seed ?? seedOf(this.runId), goal = goalOf(String(ctx.spec?.name ?? this.runId));
    const json: SeatJson = {
      version: this.version, seat: this.seat, run_id: this.runId, ...(ctx.arm ? { arm: ctx.arm } : {}), ...(seed !== undefined ? { seed } : {}),
      ...(goal ? { goal } : {}), ...(this.model ? { model: this.model } : {}),
      fork_at: forkAt, end_at: this.endAt, ...(this.endReason ? { end_reason: this.endReason } : {}), ...(this.endDetail ? { end_detail: this.endDetail } : {}),
      ended, ...(untilAt !== undefined ? { until_at: untilAt } : {}),
      usage: this.usage, translator_usage: this.translatorUsage, children: [...this.children],
      sittings: this.sittings.map((s) => s.summary), acts: this.acts, drafts: [...this.drafts.values()], failures: this.failures.map((f) => f.f),
      levers, lever_counts: counts, tier: { considered: top("considered"), attempted: top("attempted"), executed: top("executed") },
      election: e, elections: read.elections, amendments: read.amendments, translator: read.translator, outcome,
      records: this.records.filter((r) => r.t >= forkAt - 30 * DAY || r.kind === "law" || r.kind === "election_notice"),
      appointments: this.appointments.filter((a) => a.t >= forkAt && (a.by === this.seat || a.holder === this.seat || OFFICES.has(a.position))), before_fork: { acts: beforeFork }, reader_errors: this.readerErrors, systems: [...this.systems.keys()],
    };
    const files: { [f: string]: Uint8Array } = {};
    for (const s of this.sittings) files[`sitting-${s.summary.i}`] = enc.encode(JSON.stringify({ ...s.detail, acts: s.summary.acts.map((i) => this.acts[i]) }));
    for (const [sha, text] of this.systems) files[`system-${sha}`] = enc.encode(text);
    return { json, files };
  }
}

/** A block as it was sent, trimmed for the page (an electoral roll or an agreement's terms can be long). */
function trimBlock(b: any): any {
  const s = JSON.stringify(b);
  return s.length <= 4_000 ? b : { block: b?.block, kind: b?.kind, text: short(b?.text, 1_500), trimmed: s.length };
}
function gistOf(s: Building, acts: SeatAct[]): string {
  const own = s.summary.acts.map((i) => acts[i]!);
  if (own.length) {
    const weight = (a: SeatAct) => (a.levers.length ? 0 : a.blocks.some((b) => b?.block === "message") ? 2 : 1);
    const labels = [...new Set([...own].sort((a, b) => weight(a) - weight(b) || a.i - b.i).map((a) => a.label))];
    return labels.length > 3 ? `${labels.slice(0, 3).join("; ")} and ${labels.length - 3} more` : labels.join("; ");
  }
  if (s.summary.failures) return `Asked for ${s.summary.failures} thing${s.summary.failures > 1 ? "s" : ""} the translator could not draw up`;
  if (s.summary.declined) return `Declined ${s.summary.declined} draft${s.summary.declined > 1 ? "s" : ""}`;
  const tools = new Map<string, number>();
  for (const tu of s.detail.turns) if (Array.isArray(tu.output)) for (const c of tu.output) if (c?.type === "tool_use") tools.set(String(c.name), (tools.get(String(c.name)) ?? 0) + 1);
  if (s.summary.looks) return `Looked into ${s.summary.looks} thing${s.summary.looks > 1 ? "s" : ""}; did nothing`;
  if (tools.has("done_for_now") || tools.has("wait")) return "Read the news; did nothing";
  return s.summary.turns ? "Did nothing" : "";
}
function firstWords(turns: SittingTurn[]): string | undefined {
  for (const tu of turns) if (tu.purpose === "participant") for (const w of ownWords(tu.output)) { const x = w.trim(); if (x.length > 12) return firstSentence(x); }
  return undefined;
}
const seedOf = (id: string) => { const m = /seed-?(\d+)\b/.exec(id); return m ? Number(m[1]) : undefined; };
const goalOf = (id: string) => /-goal-([a-z0-9]+)/.exec(id)?.[1];

export const seatFold = (): Fold => new SeatFold();
