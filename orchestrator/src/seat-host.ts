// A model steward in an experiment's fork (docs/experiments.md, "Real models"): the seat of a post, held from the fork
// day by a language model, in the light host (rust-world.ts, `RustWorld`) that the harness runs forks on. It is the same
// seat a pilot has (run.ts, `llmUnit`): its configuration is seat-config.ts's, its loop createLlmParticipant's, its
// requests drafted by the run's translator (our own trained one first where named, the general one behind it:
// translator/src/arrangement.ts) against the engine's own resolver and dry run, confirmed or declined by the seat
// before anything is done, its framing the arm's (`unstated` by default for stewardship: VISION 15, point 1), and it is
// debriefed when its fork ends (point 7), out of what its spending limit keeps back for that.
//
// What a pilot's host does that this one does not (each is recorded in docs/experiments.md): the cast as it changes
// (whoIs is the config's at the fork); thinking time in world seconds; an act the engine will not take as written is
// noted by the engine (`rejected_action`) and not told to the seat in words; exit accounts and the composer (a town's
// people are code in an experiment).

import { appendFileSync } from "node:fs";
import { calls, inCalendar, inCurrency, modules, Randomness, View, type DayBook, type Observation, type ParticipantAction, type ParticipantContext, type Roster, type Tally } from "@oikos/participants";
import {
  applyFraming, createLlmParticipant, DEBRIEF_ANSWER_TOKENS, DEBRIEF_VERSION, endNeedMicroUsd, keptBackFor, LLM_PARTICIPANT_VERSION, MOCK_VERSION, mockPolicies, MockAdapter, ModelCallFailed, ModelUnreachable,
  reckonedEndMicroUsd, SpendingLimitReached, stepsOf, UsageLimitReached, type Budget, type DebriefInput, type FramingSpec, type LlmAdapter, type LlmController, type LlmIO, type MockBrain, type Price,
} from "@oikos/participants/llm";
import { createArrangement, createTranslator, draftText, Knowledge, NOT_CHECKED, TRANSLATOR_VERSION, type Draft, type Route } from "@oikos/translator";
import { drawTies, largest, leftAlone, besideOf, renderSummary, SeatRecords, idsFrom } from "./debrief-summary";
import { DEBRIEF_PROMPT_CHARS, endCosts, MAX_FAILURES_IN_A_ROW } from "./run";
import { joinRaw, RAW, type DetachedActor, type RustWorld, type SeatWake } from "./rust-world";
import { namedFor, seatConfig, type SeatPos } from "./seat-config";

const DAY = 86_400;
/** The most turns a seat takes in one wake before it is left to wait (a loop of drafts and declines, say). */
export const TURNS_PER_WAKE = 24;

export interface TranslatorChoice {
  /** The general translator (the one behind, or the only one): an adapter. */
  behind: LlmAdapter;
  /** Our own trained translator, first (absent: the general one alone). */
  first?: LlmAdapter;
  arrangement?: "then" | "beside";
}

export interface ModelSeatOptions {
  world: RustWorld;
  /** The world's config as the fork has it (the base's, from its snapshot). */
  config: any;
  /** The seat (the post's holder) and the post. */
  seat: string;
  post: string;
  seed: number;
  /** The model as the arm names it (`claude-code/claude-sonnet-5-5`), and the adapter that answers for it. */
  model: string;
  adapter: LlmAdapter;
  translator: TranslatorChoice;
  prices: Record<string, Price>;
  /** The fork's spending limit (the seat's calls, its translator's and its debrief's). Absent: none (the mock only). */
  budget?: Budget;
  framing: FramingSpec;
  effort?: string;
  /** For a mock adapter: the post's code brain, which the mock seat reads its decisions from (participants/src/llm/mock.ts). */
  brain?: DetachedActor;
  /** Wraps the seat's adapter as it is used (the experiment's call recorder; for the mock, after the brain is put in). */
  record?: (a: LlmAdapter) => LlmAdapter;
  /** Where the seat's words in its debrief are kept, apart from the log (VISION 15, point 7). */
  debriefsFile: string;
  untilT: number;
}

/** What the fork's end was, as the debrief tells it. */
export type ForkEnd = { how: "length_set" | "last_day" | "spending_limit" | "stopped"; t: number };

/** A model seat in a fork: what the harness's `SeatController` is, with the log's entries seen and the fork's end. */
export class ModelSeat {
  private readonly controller: LlmController;
  private readonly knowledge: Knowledge;
  private readonly view: View;
  private readonly notices: { t: number; text: string; re?: string }[] = [];
  private readonly drafts: { draft: Draft; hash: string; reasoning?: string }[] = [];
  private drafted = 0;
  private failures = 0;
  private t: number;
  private left = false;
  private readonly records: SeatRecords;
  private readonly ctx: ParticipantContext;
  private readonly translator: { translate(req: any): Promise<any> };
  private readonly arranged?: ReturnType<typeof createArrangement>;
  private readonly entity: string;
  private readonly office?: SeatPos;
  private readonly roster?: Roster;
  private readonly tally?: Tally;
  private readonly dayBook: DayBook;
  private readonly currency: any;
  private readonly calendar: any;
  private readonly confirm: "always" | "consequential" | "never";
  private readonly whoIs: (id: string) => { id: string; name?: string; of?: string } | undefined;
  readonly framing: { disclosure: string; reason: string };
  readonly keptBack?: number;

  constructor(private readonly o: ModelSeatOptions) {
    const cfg = o.config;
    this.t = o.world.t();
    this.currency = cfg.world.currencies[0];
    this.calendar = cfg.calendar;
    this.confirm = cfg.orchestration?.confirm ?? "always";
    const part0 = cfg.participants.find((p: any) => p.id === o.seat);
    if (!part0) throw new Error(`the seat ${o.seat} is not in the world`);
    // The seat as the arm has it: a model's, framed as the arm says (the framing is the run's, not the town's).
    const framed = applyFraming({ participants: [{ ...structuredClone(part0), controller: { ...part0.controller, type: "llm" } }] }, o.framing).participants[0];
    this.framing = { disclosure: framed.framing.disclosure, reason: framed.framing.reason };
    const positions = new Map<string, SeatPos>((cfg.positions ?? []).map((x: any) => [x.id, x]));
    const mine = [...positions.values()].filter((x) => x.holder === o.seat);
    const randomness = new Randomness(BigInt(cfg.seed ?? o.seed));
    const world = { tickSeconds: cfg.clock.tick_seconds, runEnd: cfg.clock.run_seconds, currency: this.currency, ...(this.calendar ? { calendar: this.calendar } : {}), ...(cfg.dials ? { dials: cfg.dials } : {}) };
    const ctxFor = (pid: string, cap: string, entity: string, params: any): ParticipantContext => ({
      participant: pid, entity, ...(cap === "self" ? {} : { position: cap }),
      rng: (purpose: string) => randomness.stream(["experiment-seat", pid, cap, purpose]),
      chance: (purpose: string) => randomness.stream(["chance", purpose]),
      world, params: params ?? {},
    } as ParticipantContext);
    this.whoIs = whoIsOf(cfg);
    const twin = false;
    this.knowledge = new Knowledge(this.currency, cfg.names === true);
    const made = seatConfig({ cfg, part: framed, personal: framed.channels ?? [], mine, positions, mods: modules, whoIs: namedFor(this.knowledge, this.whoIs), ctxFor, twin, draftText, sorted: (v) => v });
    this.entity = made.entity;
    this.office = made.office;
    this.roster = made.roster;
    this.tally = made.tally;
    this.dayBook = made.dayBook;
    this.view = new View(new Set(made.standingIds));
    this.ctx = ctxFor(o.seat, made.office?.id ?? "self", made.entity, {});
    const config = { ...made.config, ...(o.effort ? { effort: o.effort } : {}) };

    // What is kept back of the fork's limit for the debrief (VISION 15, point 7): no other call may spend it.
    if (o.budget) {
      const seatModel = `${o.adapter.provider}/${o.adapter.model}`;
      const calls = stepsOf("full", 3, true).length + 2;
      const need = endNeedMicroUsd(endCosts(), { seats: 1, seatModel, seatReckoned: reckonedEndMicroUsd({ seats: 1, seatPrice: o.prices[seatModel], calls, promptChars: DEBRIEF_PROMPT_CHARS, answerTokens: Math.round(DEBRIEF_ANSWER_TOKENS / 2) }) });
      o.budget.keptBackMicroUsd = keptBackFor(o.budget.limitMicroUsd, need.microusd).microusd;
      this.keptBack = o.budget.keptBackMicroUsd;
    }
    const annotate = async (a: object) => o.world.annotate(a);
    const plain = o.adapter.provider === "mock" && o.brain ? withBrain(o.adapter, o, made, ctxFor) : o.adapter;
    const adapter = o.record ? o.record(plain) : plain;
    const io: LlmIO = {
      adapter, annotate, now: () => this.t, prices: o.prices, ...(o.budget ? { budget: o.budget } : {}),
      apart: async (entry) => appendFileSync(o.debriefsFile, `${JSON.stringify(entry)}\n`),
    };
    this.controller = createLlmParticipant(config, io);

    // The translator: against the engine's dry run and its resolver, from what this seat has been shown.
    const typeOf = ((types: Map<string, any>) => (type: string) => types.get(type))(new Map((cfg.catalogue?.structure_types ?? []).map((x: any) => [x.id, x])));
    const check = async (participant: string, position: string | undefined, blocks: any[]) => {
      try { return o.world.check(participant, position, blocks); } catch (e) { return { ok: false, error: String((e as Error).message) }; }
    };
    const resolver = async (req: any, program0: calls.Program) => {
      const named = this.performers(program0);
      if (named.told?.length) return { ok: false, questions: named.told } as any;
      const e = o.world.resolve(req.participant, calls.programText(named.program), req.as);
      return (e.blocks ? { ok: true, blocks: e.blocks } : { ok: false, questions: e.questions, ...(e.invalid ? { invalid: e.invalid } : {}) }) as any;
    };
    const tio = (adapter: LlmAdapter): LlmIO => ({ ...io, adapter });
    const one = createTranslator(tio(o.translator.behind), check, typeOf, undefined, undefined, resolver);
    this.arranged = o.translator.first ? createArrangement(createTranslator(tio(o.translator.first), check, typeOf, undefined, 1, resolver), one, { arrangement: o.translator.arrangement ?? "then", ...("probationOutcome" in o.translator.first ? { probation: o.translator.first as unknown as { probationOutcome(form: string, agree: boolean): void } } : {}) }) : undefined;
    this.translator = this.arranged ?? one;
    const known = idsFrom(cfg);
    this.records = new SeatRecords([{ id: o.seat, known: known(o.seat), direct: [o.seat, ...mine.map((x) => x.id)] }], known);
  }

  /** Said once at the fork, in its log: who holds the post from here, and how (the config's header is the base's). */
  start(): void {
    const o = this.o;
    o.world.annotate({ annotation: "note", subject: "orchestrator", data: { steward: {
      seat: o.seat, post: o.post, model: o.model, adapter: `${o.adapter.provider}/${o.adapter.model}`, ...(o.effort ? { effort: o.effort } : {}),
      framing: this.framing, participant_version: LLM_PARTICIPANT_VERSION, translator_version: TRANSLATOR_VERSION, mock_version: MOCK_VERSION,
      translator: { behind: `${o.translator.behind.provider}/${o.translator.behind.model}`, ...(o.translator.first ? { first: `${o.translator.first.provider}/${o.translator.first.model}`, arrangement: o.translator.arrangement ?? "then" } : {}) },
      ...(o.budget ? { spending_limit_microusd: o.budget.limitMicroUsd, kept_back_for_the_end_microusd: this.keptBack } : {}),
      handover: "the seat takes the post at the fork day with no notebook: what the office's files and the world show it",
    } } });
  }

  /** A log entry from the fork on (the debrief's record of what the seat did). */
  see(entry: any): void {
    this.records.add(entry);
  }

  async decide(w: SeatWake): Promise<{ action: object }> {
    this.t = w.t;
    if (this.left) return { action: { type: "wait" } };
    inCurrency(this.currency);
    inCalendar(this.calendar);
    let raw: Observation = { ...w.observation, entity: this.entity };
    // (What a model seat was shown is recorded in full: training data, as in every pilot.)
    this.o.world.annotate({ annotation: "observation", subject: this.o.seat, data: { t: w.t, observation: { ...raw, channels: Object.entries(raw.channels ?? {}).map(([path, c]) => ({ path, ...(c as object) })) } } });
    for (let turn = 0; turn < TURNS_PER_WAKE; turn++) {
      this.knowledge.absorb(raw);
      const obs: Observation = { ...this.view.apply(raw), woke_for: w.woke_for as Observation["woke_for"], since: w.since };
      (obs as any)[RAW] = raw;
      this.tally?.absorb(obs);
      this.dayBook.absorb(obs);
      if (this.roster) { this.roster.absorb(obs); this.knowledge.ownStaff = { role: this.roster.now(obs.t).role, inPost: this.roster.count(obs.t) }; }
      if (this.notices.length) obs.notices = this.notices.splice(0);
      obs.drafts = this.drafts.map((d) => d.draft) as any;
      let action: ParticipantAction;
      try {
        action = await this.controller.step(obs, this.ctx);
      } catch (e) {
        if (e instanceof SpendingLimitReached) throw e;
        if (!(e instanceof ModelCallFailed)) throw e;
        // A call that failed after its adapter's retries: the seat waits this wake (D59); call after call failing, the
        // model is out of reach and the fork stops.
        this.o.world.annotate({ annotation: "note", subject: this.o.seat, data: { participant_error: { unit: this.o.seat, error: `${e.name}: ${e.message}`.slice(0, 2000), in_a_row: ++this.failures } } });
        if (this.failures >= MAX_FAILURES_IN_A_ROW) throw new ModelUnreachable(`the model can't be reached (${this.failures} calls in a row failed; the last: ${e.message.slice(0, 300)})`);
        return { action: e.backAt !== undefined && e.backAt > w.t ? { type: "wait", until: e.backAt } : { type: "wait" } };
      }
      this.failures = 0;
      switch (action.type) {
        case "wait": return { action: action.until !== undefined ? { type: "wait", until: action.until } : { type: "wait" } };
        case "look": return { action: { type: "look", looks: action.looks } };
        case "opt_out": this.left = true; return { action: { type: "opt_out", statement: action.statement } };
        case "message": return { action: { type: "message", to: action.to, text: action.text, ...(action.re ? { re: action.re } : {}) } };
        case "act": return { action: { type: "act", blocks: action.blocks, ...(action.by?.length ? { by: action.by } : {}), ...(action.reasoning ? { reasoning: action.reasoning } : {}) } };
        case "call": return { action: { type: "call", call: action.call, ...(action.reasoning ? { reasoning: action.reasoning } : {}) } };
        case "propose": {
          const now = await this.propose(action);
          if (now) return { action: now };
          break;
        }
        case "sign": {
          const now = this.sign(action);
          if (now) return { action: now };
          break;
        }
        default: return { action: { type: "wait" } };
      }
      // (It goes on in the same moment, as a pilot's seat does after drafting or declining: nothing new to see.)
      raw = { ...raw, channels: {}, outcomes: [], inbox: [], drafts: [], ...(raw.readings ? { readings: {} } : {}) } as Observation;
    }
    this.o.world.annotate({ annotation: "note", subject: this.o.seat, data: { turns_cut: { t: w.t, turns: TURNS_PER_WAKE } } });
    return { action: { type: "wait" } };
  }

  /** A request in the seat's words: drafted, and shown to it at its next turn (or carried out at once where the world needs no confirmation). */
  private async propose(action: Extract<ParticipantAction, { type: "propose" }>): Promise<object | undefined> {
    const seat = this.o.seat;
    const as = (action as any).as ?? this.office?.id;
    for (let again = 0; again < 2; again++) {
      const draftId = `draft.${seat}.${++this.drafted}`;
      let tr: { ok: boolean; draft?: Draft; hash?: string; notices?: string[]; route?: Route; retries?: { reason: string; call?: string }[]; call?: string; invalid?: string[]; asked_back?: boolean; raw?: unknown };
      try {
        tr = await this.translator.translate({ draftId, participant: seat, as, proposal: action.text, knowledge: this.knowledge, called: (id: string) => this.whoIs(id)?.name });
      } catch (e) {
        if (!(e instanceof ModelCallFailed)) throw e;
        tr = { ok: false, notices: ["That couldn't be drafted just now. You could try again."], raw: { model_call_failed: e.message } };
      }
      const note = (data: object) => this.o.world.annotate({ annotation: "note", subject: seat, data });
      for (const [i, x] of (tr.retries ?? []).entries()) note({ translation_retry: { draft: draftId, attempt: i + 1, reason: x.reason, ...(x.call ? { call: x.call } : {}) } });
      if (tr.route) note({ translation_route: { draft: draftId, ...tr.route } });
      if (!tr.ok) {
        this.o.world.annotate({ annotation: "translation_failure", subject: seat, data: { draft: draftId, proposal: action.text, reason: (tr.notices ?? []).join(" "), ...(tr.asked_back ? { asked_back: true } : {}), ...(tr.call ? { call: tr.call } : {}), ...(tr.invalid ? { invalid: tr.invalid } : {}), ...(tr.raw !== undefined ? { raw: JSON.stringify(tr.raw) } : {}) } });
        for (const text of tr.notices ?? []) this.notices.push({ t: this.t, text: aboutRequest(action.text, text), re: draftId });
        return undefined;
      }
      try {
        this.o.world.annotate({ annotation: "draft", draft: tr.draft });
      } catch (e) {
        // (A draft the log will not take is the platform's fault: on record, drawn up once more, then told.)
        this.o.world.annotate({ annotation: "translation_failure", subject: seat, data: { draft: draftId, proposal: action.text, reason: NOT_CHECKED, call: tr.draft!.call, invalid: [`platform fault: the draft breaks the contract and couldn't be recorded: ${String((e as Error).message).slice(0, 500)}`], platform_fault: true, ...(again ? {} : { drawn_up_again: true }) } });
        if (!again) continue;
        this.notices.push({ t: this.t, text: aboutRequest(action.text, NOT_CHECKED), re: draftId });
        return undefined;
      }
      const pending = { draft: tr.draft!, hash: tr.hash!, ...(action.reasoning ? { reasoning: action.reasoning } : {}) };
      const onlyWords = pending.draft.blocks.every((b: any) => b.block === "message");
      if (this.confirm === "never" || (this.confirm === "consequential" && onlyWords)) return this.signed(pending, "accept", `confirmation: ${this.confirm}`);
      this.drafts.push(pending);
      return undefined;
    }
    return undefined;
  }

  private sign(action: Extract<ParticipantAction, { type: "sign" }>): object | undefined {
    const i = this.drafts.findIndex((d) => d.draft.id === action.draft);
    if (i < 0) {
      this.notices.push({ t: this.t, text: `There's nothing waiting for you to confirm called ${action.draft}.` });
      return undefined;
    }
    const [pending] = this.drafts.splice(i, 1);
    return this.signed(pending!, action.decision, action.note);
  }

  /** A draft confirmed or declined: the signoff on record, and if confirmed the act with its provenance. */
  private signed(p: { draft: Draft; hash: string; reasoning?: string }, decision: "accept" | "reject", note?: string): object | undefined {
    const d = p.draft;
    this.o.world.annotate({ annotation: "signoff", participant: this.o.seat, draft: d.id, draft_hash: p.hash, decision, ...(note ? { note } : {}) });
    this.arranged?.signed(d.id, decision);
    if (decision !== "accept") return undefined;
    let by: string[] | undefined;
    if (d.call) try { by = this.performers(calls.parseProgram(d.call)).by; } catch { /* (a call that does not read names no one) */ }
    return { type: "act", blocks: d.blocks, ...(by?.length ? { by } : {}), ...(p.reasoning ? { reasoning: p.reasoning } : {}),
      provenance: { via: "translator", proposal: d.proposal, draft: d.id, draft_hash: p.hash, translator: d.translator, call: d.call, resolver: d.resolver } };
  }

  /** Who in the office does it, where a request names someone of its staff (`done_by`): run.ts `performersOf`, for a seat. */
  private performers(program: calls.Program): { program: calls.Program; by?: string[]; told?: string[] } {
    if (!("lines" in program)) return { program };
    const asked = program.lines.filter((l) => l.call.args.done_by !== undefined);
    if (!asked.length) return { program };
    const listOf = (v: calls.Value): string[] => ("id" in v ? [v.id] : "text" in v ? v.text.split(/[,;]|\band\b/).map((x) => x.trim()).filter(Boolean) : "json" in v && Array.isArray(v.json) ? v.json.map(String) : []);
    const named = [...new Set(asked.flatMap((l) => listOf(l.call.args.done_by!)))];
    const staff = this.roster?.now(this.t);
    const held = staff?.held.map((h) => h.person) ?? [];
    const role = staff?.role?.toLowerCase();
    const systems = new Set((this.o.config.participants ?? []).filter((p: any) => p.kind === "system").map((p: any) => p.id));
    const told: string[] = [];
    const by: string[] = [];
    for (const x of named) {
      const w = x.toLowerCase().replace(/^the\s+/, "");
      if (held.includes(x) || systems.has(x)) by.push(x);
      else if (role && (w === role || w === `${role}s` || w === "staff")) {
        if (held.length === 1) by.push(held[0]!);
        else told.push(held.length ? `"${x}" could be any of the ${held.length} in post in your office (${held.join(", ")}): say which, by their id.` : `Nobody is in post to do that: your office has no ${staff!.role} in post.`);
      } else told.push(`${x} is not one of your staff${held.length ? ` (those in post: ${held.join(", ")})` : " (nobody is in post)"}, so it cannot be done by them.`);
    }
    return { program: { lines: program.lines.map((l) => (l.call.args.done_by !== undefined ? { ...l, call: { ...l.call, args: Object.fromEntries(Object.entries(l.call.args).filter(([name]) => name !== "done_by")) } } : l)) }, ...(by.length ? { by: [...new Set(by)] } : {}), ...(told.length ? { told } : {}) };
  }

  /**
   * The fork's end for the seat (VISION 15, point 7; docs/behaviour/debrief.md): drafts it had not answered are on
   * record as unanswered, and it is debriefed by the fixed interview, out of what its limit kept back. A debrief the
   * model cannot be asked for (out of reach, or the limit spent before its first question) is recorded as not given.
   */
  async end(e: ForkEnd): Promise<string> {
    const o = this.o;
    this.t = e.t;
    inCurrency(this.currency);
    inCalendar(this.calendar);
    for (const d of this.drafts) o.world.annotate({ annotation: "note", subject: o.seat, data: { draft_unanswered: { draft: d.draft.id, why: "the run ended before the seat sat again" } } });
    o.world.annotate({ annotation: "note", subject: "orchestrator", data: { debriefs: { version: DEBRIEF_VERSION, wording: "a", seats: [o.seat] } } });
    const r = this.records.of.get(o.seat)!;
    drawTies(r, new Randomness(BigInt(o.config.seed ?? o.seed)).stream(["debrief", "choice", o.seat]));
    const decisions = r.left ? [] : largest(r).map((c) => ({ day: Math.floor(c.t / DAY) + 1, fact: `"${c.preview.replace(/\s+/g, " ").trim().slice(0, 600)}"`, ids: besideOf(c) }));
    const part = o.config.participants.find((p: any) => p.id === o.seat);
    const after = part?.on_opt_out && typeof part.on_opt_out === "object" ? "After you left, the routine work of your seat was carried on by code" : "After you left, your seat stood empty";
    const input: DebriefInput = { wording: "a", town: String(o.config.meta?.name ?? "the town"), ended: { how: e.how, day: Math.floor(e.t / DAY), of: Math.floor((o.config.clock?.run_seconds ?? o.untilT) / DAY) }, others: { models: 0 },
      ...(r.left ? { left: { day: Math.floor(r.left.t / DAY) + 1, statement: r.left.statement, after } } : {}), summary: renderSummary(r, this.currency), decisions, ...(leftAlone(r) ? { leftAlone: leftAlone(r)! } : {}) };
    try {
      return (await this.controller.debrief(input)).ended;
    } catch (x) {
      if (!(x instanceof SpendingLimitReached) && !(x instanceof ModelCallFailed)) throw x;
      o.world.annotate({ annotation: "note", subject: o.seat, data: { debrief_skipped: String((x as Error).message).slice(0, 500), by: (x as Error).name } });
      return "not_given";
    }
  }
}

const aboutRequest = (asked: string, text: string) => `About what you asked for (${JSON.stringify(asked.length > 120 ? `${asked.slice(0, 120)}…` : asked)}): nothing was filed or done. ${text}`;

/** Who someone is in the world, by any id of theirs (run.ts `whoIs`), from the config as the fork has it. */
export function whoIsOf(cfg: any): (id: string) => { id: string; name?: string; of?: string } | undefined {
  const parts = new Map<string, any>((cfg.participants ?? []).map((p: any) => [p.id, p]));
  const positions = new Map<string, any>((cfg.positions ?? []).map((x: any) => [x.id, x]));
  const entityNames = new Map<string, string>((cfg.world?.entities ?? []).map((e: any) => [e.id, e.name]));
  const held = (pid: string) => [...positions.values()].filter((x) => x.holder === pid);
  return (id) => {
    const p = parts.get(id);
    if (p) {
      const posts = p.kind === "system" || (p.shares_body && held(id).length === 1) ? held(id) : [];
      if (posts.length === 1) return { id: posts[0]!.id, name: posts[0]!.title ?? p.title, of: posts[0]!.entity };
      const e = p.person ?? p.owner;
      return e ? { id: e, ...(entityNames.get(e) ? { name: entityNames.get(e)! } : {}) } : undefined;
    }
    const x = positions.get(id);
    if (x) return { id, ...(x.title ? { name: x.title } : {}), of: x.entity };
    return entityNames.has(id) ? { id, name: entityNames.get(id)! } : undefined;
  };
}

/**
 * A mock adapter whose seat reads its decisions from the post's code brain (participants/src/llm/mock.ts): the whole
 * loop runs (prompts, the translator, drafts and their confirmation, the debrief) and only language is faked. The brain
 * is handed what the kernel sent, and keeps its own view, as run.ts's mock seats on the Rust world do.
 */
function withBrain(adapter: LlmAdapter, o: ModelSeatOptions, made: ReturnType<typeof seatConfig>, ctxFor: (pid: string, cap: string, entity: string, params: any) => ParticipantContext): LlmAdapter {
  const brain = o.brain!;
  const cap = made.office?.id;
  const asPath = (x: any) => (cap && x?.channels ? { ...x, channels: Object.fromEntries(Object.entries(x.channels).map(([k, v]) => [k.includes("/") ? k : `${cap}/${k}`, v])) } : x);
  let unstepped: any;
  const kernelSent = (x: any) => asPath(x[RAW] ? { ...x[RAW], entity: x.entity } : x);
  const controller = {
    step: (x: any) => { const seen = unstepped ? joinRaw(unstepped, kernelSent(x)) : kernelSent(x); unstepped = undefined; return brain.step(seen, x.woke_for ?? "cadence", x.since ?? 0).action; },
    seen: (x: any) => { unstepped = unstepped ? joinRaw(unstepped, kernelSent(x)) : kernelSent(x); },
  };
  const part = o.config.participants.find((p: any) => p.id === o.seat);
  const pp = part?.controller?.params ?? {};
  const bctx = ctxFor(o.seat, cap ?? "self", made.entity, pp.mock?.params ?? {});
  const mb: MockBrain = { controller: controller as any, ctx: bctx, capacity: cap ?? "self", cadence: brain.schedule().cadence };
  const policies = mockPolicies(new Map([[o.seat, mb]]));
  // (The mock's own name stays: the log says the mock answered, whatever the arm's model is called.)
  return new MockAdapter(adapter.model, policies);
}

/** A model the experiment may seat, and whether its window can shut (a subscription's): such a model's adapter waits for
 * the window to open again, inside its own fork, before the fork is stopped (Codex must never block anything else). */
export function waitingAdapter(a: LlmAdapter, o: { waitMs: number; maxWaitMs: number; sleep?: (ms: number) => Promise<void>; note?: (s: string) => void }): LlmAdapter {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  return {
    provider: a.provider, model: a.model,
    complete: async (req) => {
      let waited = 0;
      for (;;) {
        try {
          return await a.complete(req);
        } catch (e) {
          if (!(e instanceof UsageLimitReached) || waited >= o.maxWaitMs) throw e;
          o.note?.(`${a.provider}/${a.model}: usage limit; waiting ${Math.round(o.waitMs / 60_000)} min (${Math.round(waited / 60_000)} min so far)`);
          await sleep(o.waitMs);
          waited += o.waitMs;
        }
      }
    },
  };
}
