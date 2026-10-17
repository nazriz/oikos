// Running a world: the kernel as a subprocess, participants scheduled on the
// world clock (PettingZoo AEC: whichever's wake time or news comes first; ties
// by key), code participants driven by behaviour modules.
//
// What is scheduled is a UNIT: for a code participant, one of its capacities
// (itself, for a person's; or a position it holds), each with its own module,
// view and knowledge. A person in a position runs the position's role module
// with its own traits (the job's procedures, done its way); a system runs its
// own controller in every position it holds (software does what it does). A
// language-model participant is one unit that perceives all its capacities.
// Units come and go as the kernel reports arrivals, births, appointments,
// deaths and retirements (contracts v0.4, docs/design/v0.4-cast-and-land.md).
//
// Wakes: a unit sleeps until the time it asked for (wait.until), or its
// module's cadence, or until it has NEWS: a message delivered to its
// participant, or (for code units) a record naming or addressed to the entity
// it acts for.
//
// Language-model participants (docs/design/m2-llm-participants.md) wake on their
// cadence and on messages. A `propose` goes to the translator and comes back in
// the next observation as a draft; `sign` submits it with translator
// provenance, or discards it. Until a real model is configured, every model
// call goes to the mock adapter.

import { AsyncLocalStorage } from "node:async_hooks";
import { appendFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { debriefsBeside } from "./logs";
import { join } from "node:path";
import { besideOf, largest, leftAlone, renderSummary, SUMMARY_MAX } from "./debrief-summary";
import { readForEnd } from "./run-end";
import { ReadingDesk, type DeskCounts } from "./reading";
import { culture as cultureNs, reading as readingNs } from "@oikos/participants";
import { DayBook, calls, canonical, diaryText, forms, DECISIONS, OUTCOMES, RECORD, WORDS, type Words, inCurrency, paramErrors, modules as builtin, Randomness, Roster, slice, Tally, View, type BehaviourModule, type Controller, type Currency, type DecisionRecord, type OutcomeRecord, type RecordChange, formatMoney, type LookRequest, type Observation, type ParticipantAction, type ParticipantContext } from "@oikos/participants";
import { lexiconReader, READING_TABLE, Tagger, READING_VERSION, type Reader, type ReadingTable } from "@oikos/participants/llm";
import { ACCOUNT_TOKENS, ACCOUNT_VERSION, ACCOUNTS_DEFAULT, ACCOUNTS_MOST, darkAccount, DEBRIEF_ANSWER_TOKENS, DEBRIEF_VERSION, endNeedMicroUsd, keptBackFor, reckonedEndMicroUsd, type EndCosts, type MockPolicy, mockAccount, sampleAccounts, stepsOf, writeAccount, type AccountBrief, type AccountCounts, type DebriefInput, type DebriefWording, COMPOSE_VERSION, createCompose, mockCompose, type ComposerConfig, CONSULT_VERSION, createConsult, createLlmParticipant, LLM_PARTICIPANT_VERSION, MOCK_VERSION, MockAdapter, mockPolicies, PRICES, ModelCallFailed, ModelUnreachable, SpendingLimitReached, type Budget, type LlmAdapter, type LlmController, type LlmIO, type MockBrain, type Price } from "@oikos/participants/llm";
import { createArrangement, createTranslator, draftText, Knowledge, RESOLVER, resolve, TRANSLATOR_VERSION, type Draft, type Resolution, type Route, NOT_CHECKED } from "@oikos/translator";
import { Kernel } from "./kernel";
import { divergences } from "./truth";
import type { Watchdog } from "./watchdog";

export const ORCHESTRATOR_VERSION = "0.9.0";

export interface RunOptions {
  config: any;
  runId: string;
  outDir: string;
  /** Check that every code participant's call text reads back as the program it was written from (tests). */
  verifyCalls?: boolean;
  /** Stop early (simulated seconds); default: the world's run length. */
  until?: number;
  modules?: { [name: string]: BehaviourModule & { source?: string } };
  kernel?: Kernel;
  /** Told the key of every stream a participant draws (tests: what two towns draw alike, docs/reliability.md). */
  drawTrace?: (key: readonly string[]) => void;
  log?: (msg: string) => void;
  /** The model behind every language-model participant and the translator. Default: the mock. */
  adapter?: LlmAdapter;
  /** With the mock (no `adapter`): a change to what the mock participant does, given the mock's own policy for a seat
   * (a measuring script plays a reader in a seat and leaves the office's code to act: scripts/member-sittings.ts). */
  mockParticipant?: (inner: MockPolicy) => MockPolicy;
  /** The translator's own model (default: the same as the participants'). */
  translatorAdapter?: LlmAdapter;
  /** A translator that answers first, with the translator behind it (translator/src/arrangement.ts): our own trained
   * model. `translatorArrangement`: "then" (the default: the one behind takes what the first fails) or "beside" (the
   * first's answers are only recorded). */
  translatorFirst?: LlmAdapter;
  translatorArrangement?: "then" | "beside";
  /** Prices for real models (micro-USD per million tokens, keyed "provider/model"), added to the mock's. */
  prices?: Record<string, Price>;
  /** A spending limit for real models: the run stops (and says why) rather than exceed it. 5% is kept back for debriefs. */
  budget?: Budget;
  /** For tests: called after each look, with the participant, the observation its controller reads (for a code unit, its capacity's slice), the kernel, and the capacity. */
  /** Tests: each look, as the controller reads it (`obs`) and as the kernel sent it (`raw`, what changed). */
  inspect?: (participant: string, obs: Observation, kernel: Kernel, capacity?: string, raw?: Observation) => Promise<void>;
  /** Breadcrumbs for a watchdog that stops the run if it stalls (D59; set by runOne, not by tests running in-process). */
  watchdog?: Watchdog;
  /** A resumed run (resume.ts): the log it resumes, and how serving its recorded model calls went (noted at the end). */
  resumedFrom?: { log: string; serving: { served: number; diverged?: object } };
  /** Whose observations to record in full in the log (docs/design/run-datasets.md): participant ids, or "models",
   * "code" or "all". None by default: the log keeps each observation's hash, and a replay can make it again. */
  /** Whose observations are recorded in full (training data): by default, language-model participants' ("models");
   * "none" for no one. */
  recordObservations?: string[] | "models" | "code" | "all" | "none";
  /** Code citizens' decisions as their minds made them (docs/design/ai-citizens.md 7; training data for citizen models):
   * "full" (the default: every one, in a log that is not lean) or "none". */
  recordDecisions?: string; // "full", "none", or a list of areas ("want,found,found_shape"): those decisions only, kept in a lean log too, with no outcomes
  /** The sparse mind (docs/design/ai-citizens.md 4): code citizens may ask the run's model (the mock, or --model) how
   * much their options would matter, with answers remembered by kind. Off by default. */
  consult?: boolean;
  /** Kinds (and things) the sparse mind leaves out: an audit's `avoid` (consult-audit). */
  consultAvoid?: string[];
  /** The composing models, for real (docs/behaviour/founding.md, "Words"): an adapter for each model the world's
   * mix names (`dials.composer`). Absent: where the world has a composer, the mock plays it, and the log says so. */
  composerAdapters?: Map<string, LlmAdapter>;
  /** Tests and audits: the composer's prompt in another wording (never a run that is compared). */
  composerSystem?: string;
  /** The reader of seats' worded papers (docs/behaviour/reading.md), where the world's `dials.reading` is on: a
   * `Reader` (participants/src/llm/reader.ts). Absent, the dial's `reader: "mock"` plays it on the lexicon mock; a dial
   * naming a model with no reader given is refused (this build calls no model). Tests give the mocks. */
  reader?: Reader;
  /** The plain papers' readings the dial shifts from (participants/src/llm/reading-table.json); tests give their own. */
  readingTable?: ReadingTable;
  /** Tests only: which authors count as seats, and where their words are, so that a code office's paper can be read as a seat's. */
  readingSeam?: { bySeat?: (author: string) => boolean; words?: (s: { id: string; kind: string; text: string; data?: { [k: string]: unknown } }) => string | undefined };
  /** Which wording of the debrief's questions this run uses (participants/src/llm/debrief.ts): "a" unless a rewording
   * check asks for "b". The log says which. */
  debriefWording?: DebriefWording;
  /** Invariance tests only (docs/design/rebuild.md 8.1): extra wakes, seeded (basis points of wakes followed by an early
   * one). Never a research run; the log says so. */
  perturb?: { extraWakesBps: number; seed: number };
  /** Truth audits (docs/design/rebuild.md 8.2): each code module's beliefs, when a wake is done, checked against the
   * terms' readings; divergences recorded as `audit` annotations. For tests and calibration runs. */
  audit?: boolean;
  /** Asked to stop from outside (`scripts/mini stop`, a TERM signal: batch.ts): set `requested` to why, and the run stops
   * before its next moment, between rounds, as it does at a usage limit: its log closed, to be resumed. */
  stop?: { requested?: string };
}

/** The run was asked to stop from outside. It stops as it does at a usage limit: cleanly, to be resumed. */
export class StopRequested extends SpendingLimitReached {
  override name = "StopRequested";
}

/** More than this many cohorts at one simulated moment means participants are waking each other without end: the run
 * stops, deterministically, rather than spin (D59). */
export const MAX_COHORTS_PER_MOMENT = 1000;

/** A run that can't go on (participants waking each other without end at one moment): deterministic, so replayable. */
export class RunStuck extends Error {
  override name = "RunStuck";
}

/** How long one model call may keep a run's breadcrumbs moving: beyond every adapter's time limit and retries (3
 * attempts of 180 s, with backoff), so only a call that never ends is taken for a stall (D59). */
export const MODEL_CALL_MAX_MS = 20 * 60_000;

/** A unit that fails to decide this many times in a row is retired: to its stand-in if the world names one, or it
 * stops acting. Deterministic, like the failures themselves (D59). */
export const MAX_FAILURES_IN_A_ROW = 3;

export interface RunSummary {
  runId: string;
  /** How the log ends: "completed" (the world's whole run length), or "aborted" with why (cut short with `until`, or
   * stopped: below). */
  end: { reason: "completed" | "aborted"; detail?: string };
  /** The run stopped before it was meant to (a usage limit, the model out of reach, the spending limit, a request to
   * stop): why, in words, and by what (the error's name). Resume it: `oikos resume <log>`. */
  stopped?: { why: string; by: string };
  logPath: string;
  anchorsPath: string;
  stateHash: string;
  /** Where the world has a composer: pieces asked for, composed, declined; how many of those asked for were dark by
   * the stated rule (VISION 15, point 7: reported with every run); how many the month's allowance left unasked, went
   * to the fallback model, could not be read, and were followed by the question about the task. */
  /** Where the world has reading on: what the desk did (papers asked, read, cached, declined, and the rest). */
  reading?: DeskCounts;
  composer?: { asked: number; composed: number; declined: number; dark: number; capped: number; fell_back: number; unread: number; followed_up: number };
  /** The debriefs of the run's model seats (VISION 15, point 7): how each ended, by seat. Never what was said. */
  debriefs?: { [seat: string]: string };
  /** The exit accounts of a sample of people, where the composer is on: asked, composed, declined, dark, and the rest. */
  accounts?: AccountCounts;
  commands: number;
  refused: number;
  wakes: number;
  /** Wakes by why (cadence, news, asked, done, start). */
  wakesBy: { [why: string]: number };
  t: number;
  /** Wall-clock milliseconds spent waiting on the kernel and in behaviour modules (profiling only; never logged). */
  kernelMs: number;
  moduleMs: number;
  /** The orchestrator's own work: keeping participants' knowledge, parsing and resolving calls (profiling only). */
  platformMs: number;
  /**
   * Signs of trouble that don't stop a run (docs/reliability.md): wakes that ran out of actions with more to do, by
   * module (often: falling behind), and refusals by their code.
   */
  /** backlog: how long acts waited for their actor to be free (docs/design/rebuild.md 6.3), by module: acts begun, their
   * total and longest wait (world seconds). */
  health: {
    backlog: { [module: string]: { acts: number; waited: number; longest: number } };
    /** The same act, by the same unit, most often in one day, by module (a retry loop shows here): how many times, and
     * which unit and act. */
    repeats: { [module: string]: { times: number; unit: string; act: string } };
    refused: { [code: string]: number };
  };
  /** Where the time went (profiling only): each behaviour module's deciding, and each kind of kernel command. */
  profile: { modules: { [module: string]: { ms: number; steps: number } }; kernel: { [command: string]: { ms: number; n: number } };
    /** Every request to the engine, by what it was: how many, and the milliseconds writing it, in the engine, and reading its reply. */
    requests?: { [op: string]: { n: number; encode: number; engine: number; decode: number } } };
  /** What the run spent on models, where it had a spending limit (micro-USD; the log's usage annotations say the same). */
  spentMicroUsd?: number;
  /** What the run's end (debriefs, exit accounts) spent beyond the limit, by whom the calls were for: the platform's
   * overrun, not the run reaching its limit and not any seat's own spending. Absent: none. */
  platformOverrun?: { microusd: number; by_subject: { [subject: string]: number } };
  /** Failures to decide that were recovered in place (a module that threw, a model call that failed; D59). */
  participantErrors: number;
  /** Resolver shadow checks (OIKOS_RESOLVER=shadow): calls resolved both ways, and how many the engine's resolved
   * differently (examples in <run>.resolver-diffs.json). */
  resolverShadow?: { checked: number; differed: number };
}

/** A participant, as the orchestrator runs it. */
interface Part {
  id: string;
  kind: "person" | "system";
  person?: string;
  /** A model's seat in one post of a person (foundations F5): it acts through their body, and only in its post, as a system does. */
  shares_body?: boolean;
  owner?: string;
  title?: string;
  controller: any;
  framing: any;
  on_opt_out?: any;
  traits?: any;
  ended: boolean;
}

/** A position, as the orchestrator knows it (from the config and position_created / appointed events). */
interface Pos {
  id: string;
  entity: string;
  title?: string;
  role?: string;
  channels: any[];
  role_module?: any;
  holder?: string;
  /** The bookkeeping of this post keeps the record of its organisation (the world's config: `keeps_record`). */
  keeps_record?: boolean;
}

/** One scheduled unit: a code participant's capacity, or a language-model participant. */
interface Unit {
  key: string;
  participant: string;
  /** "self", or a position; absent for a language-model participant (it perceives all its capacities). */
  capacity?: string;
  entity: string;
  module: BehaviourModule;
  controller: Controller;
  llm?: { controller: LlmController; config: any; drafts: { draft: Draft; hash: string; reasoning?: string }[]; drafted: number; roster?: Roster; tally?: Tally; dayBook?: DayBook };
  ctx: ParticipantContext;
  /** How long it sleeps when it waits without saying until when, and when it first wakes: for the engine's schedule
   * (kernel/src/schedule.rs), which decides every wake from then on. */
  cadence: number;
  firstWake: number;
  /** A seat that sits as its code twin does (a mock's, `mock.twin`): woken by papers as a code unit of its post is. */
  hears?: boolean;
  /** Where it stands among those woken together (the engine's `sort`): a seat stands where its person's own unit for the post would. */
  sort?: string;
  /** The participant whose body a twin seat sits in (the engine's `body`). */
  body?: string;
  /** Truth audits: the divergences found at its last audit, by belief, and when each was first found. */
  diverged?: Map<string, number>;
  /** Why the current wake happened (contracts 0.7: woke_for), and how long since the last (the engine says). */
  wokeFor: NonNullable<Observation["woke_for"]>;
  since: number;
  /** This decision: whether it began an act (its wake goes on when that's done), the time it asked to wake if it
   * waits, and the world seconds it took to think. */
  acted?: boolean;
  waitUntil?: number;
  thinking?: number;
  /** What it has observed, for the resolver (P8). */
  knowledge: Knowledge;
  /** Its current picture, kept from its looks (perception is changes). */
  view: View;
  /** Notes about its own requests, delivered with its next observation (Observation.notices). */
  notices: { t: number; text: string; re?: string }[];
  /** Channels it asked to look through with its next observation (attention). */
  looks?: LookRequest[];
}

const ceilTo = (t: number, tick: number) => Math.ceil(t / tick) * tick;

/** Whose resolver turns calls into acts: the engine's (kernel/crates/resolver; the default), this package's ("ts"), or
 * both, compared ("shadow": every difference recorded, and under test an error). */
const RESOLVER_MODE = (process.env.OIKOS_RESOLVER ?? "engine") as "engine" | "ts" | "shadow";

const DAY = 86_400;
/** What a debrief's prompt is taken to come to, for what a run keeps back for it: the seat's standing instructions,
 * the opening message with the summary and the notebook at their most, and the questions and answers before. */
// (The standing instructions are shown once, in the first call: spread over the calls they are little of each.)
const DEBRIEF_PROMPT_CHARS = 2_000 + 4_000 + SUMMARY_MAX + 8_000 + 6_000;
const ACCOUNT_PROMPT_CHARS = 8_000;
/** What debriefs and exit accounts have cost, measured, as data (orchestrator/debrief-costs.json). */
const endCosts = (): EndCosts => JSON.parse(readFileSync(join(import.meta.dir, "../debrief-costs.json"), "utf8"));

export async function runWorld(o: RunOptions): Promise<RunSummary> {
  // The Rust world (docs/design/rust-port.md; lane F): the engine runs the world and its built-in actors, this host the seats.
  if (process.env.OIKOS_WORLD === "rust") return (await import("./rust-world")).runRustWorld(o);
  const k = o.kernel ?? new Kernel();
  try {
    return await runWith(o, k);
  } catch (e) {
    // A run that fails takes its kernel with it (one it was given is the caller's to close).
    if (!o.kernel) k.kill();
    throw e;
  }
}

async function runWith(o: RunOptions, k: Kernel): Promise<RunSummary> {
  const log = o.log ?? (() => {});
  const mods = { ...builtin, ...(o.modules ?? {}) };
  const cfg = o.config;
  const tick: number = cfg.clock.tick_seconds;
  const runEnd = ceilTo(cfg.clock.run_seconds, tick);
  const until = Math.min(o.until ?? runEnd, runEnd);
  // How this world's money is written (its first currency: the one accounts are in unless they say otherwise): what
  // amounts in words are read and written in, by the resolver and by the participants' own wording.
  const currency: Currency = cfg.world.currencies[0];
  inCurrency(currency);
  const randomness = new Randomness(BigInt(cfg.seed));
  mkdirSync(o.outDir, { recursive: true });
  const logPath = join(o.outDir, `${o.runId}.jsonl`);
  const anchorsPath = join(o.outDir, `${o.runId}.anchors.jsonl`);
  let t = 0;
  let commands = 0, refused = 0, wakes = 0, kernelMs = 0, moduleMs = 0, platformMs = 0;
  const wakesBy: { [why: string]: number } = {};
  const profModules: { [m: string]: { ms: number; steps: number } } = {};
  const backlog: { [m: string]: { acts: number; waited: number; longest: number } } = {};
  const repeats: { [m: string]: { times: number; unit: string; act: string } } = {};
  let repeatDay = -1;
  let sameActs = new Map<string, number>(); // unit + act -> times today
  const refusedBy: { [code: string]: number } = {};
  const profKernel: { [c: string]: { ms: number; n: number } } = {};
  let participantErrors = 0; // failures to decide, recovered in place (D59)
  // Resolver shadow checks: calls resolved both ways, and where the engine's resolver differed (the latest 200).
  let resolverChecked = 0, resolverDiffCount = 0;
  const resolverDiffs: object[] = [];
  const failures = new Map<string, number>(); // failures to decide in a row, by unit
  // Breadcrumbs (D59): what the run is doing, for the watchdog, at every point where it could hang.
  const mark = (doing: object) => o.watchdog?.mark({ t, ...doing });
  if (o.watchdog) k.onRequest = (req: any) => mark({ doing: "kernel request", request: req.op === "command" ? req.command?.command : req.op, participant: req.command?.participant ?? req.participant });
  // A model call in flight keeps the breadcrumbs moving (every 10 s) for up to MODEL_CALL_MAX_MS: longer than any
  // adapter's own time limits and retries allow, so a slow but healthy call is never taken for a stall, while one that
  // outlives even that, or a thread stuck in a synchronous loop (no timers run), still is.
  const watched = (a: LlmAdapter): LlmAdapter => (o.watchdog ? { provider: a.provider, model: a.model, complete: async (req) => {
    const began = Date.now();
    const beat = () => mark({ doing: "model call", subject: req.subject, purpose: req.purpose, for_s: Math.round((Date.now() - began) / 1000) });
    beat();
    const timer = setInterval(() => Date.now() - began < MODEL_CALL_MAX_MS && beat(), 10_000);
    try {
      return await a.complete(req);
    } finally {
      clearInterval(timer);
    }
  } } : a);

  await k.request({ op: "start", config: cfg, run_id: o.runId, log_path: logPath, anchors_path: anchorsPath });
  if (o.perturb) await k.request({ op: "perturb", extra_wakes_bps: o.perturb.extraWakesBps, seed: o.perturb.seed });

  // Every model call (participants, translator, debriefs) is recorded as it happens.
  const brains = new Map<string, MockBrain>(); // filled below, as mock participants are created
  // While a cohort decides, annotations from its model calls are held by subject and written afterwards in the
  // cohort's order, so the log doesn't depend on which call came back first (D58 §4.8).
  let holding: Map<string, object[]> | null = null;
  // A round's translations are made at once (each a model call or two): what each one records is kept with it, and
  // written when its request is carried out, in the cohort's order, as if they had been made one after another.
  const translating = new AsyncLocalStorage<object[]>();
  // Model calls that failed in the round under way. If the run stops in this round (the model out of reach, a limit),
  // its stop note says how many: a resume asks those again rather than serve them as failures (resume.ts).
  let roundFailures = 0;
  const io: LlmIO = {
    adapter: watched(o.adapter ?? new MockAdapter("mock", (() => { const p = mockPolicies(brains); return o.mockParticipant ? { ...p, participant: o.mockParticipant(p.participant) } : p; })())),
    annotate: async (annotation) => {
      if ((annotation as { annotation?: unknown }).annotation === "model_call_failed") roundFailures++;
      const mine = translating.getStore();
      if (mine) mine.push(annotation);
      else if (holding) {
        const who = String((annotation as { subject?: unknown }).subject ?? "");
        holding.set(who, [...(holding.get(who) ?? []), annotation]);
      } else await k.request({ op: "annotate", annotation });
    },
    now: () => t,
    prices: { ...PRICES, ...(o.prices ?? {}) },
    ...(o.budget ? { budget: o.budget } : {}),
    // What seats say in their debriefs is kept in a file beside the log, and the log holds digests (logs.ts).
    apart: async (entry) => appendFileSync(debriefsBeside(logPath), `${JSON.stringify(entry)}\n`),
  };
  rmSync(debriefsBeside(logPath), { force: true });
  const consult = o.consult ? createConsult(io, { avoid: o.consultAvoid ?? [] }) : undefined;
  // The composing model, where the world's dial has one (docs/design/ai-citizens.md 10e): the models of its mix, or
  // the mock in each one's place. Which model writes a piece is drawn on the run's seeded streams.
  const composerCfg = cfg.dials?.composer as ComposerConfig | undefined;
  for (const m of composerCfg?.mix ?? []) if (/astra|fable/i.test(m.model)) throw new Error(`the composer's mix names ${m.model}, which is never a composing model (docs/behaviour/founding.md)`);
  const composerAdapters = composerCfg ? new Map(composerCfg.mix.map((m) => [m.model, watched(o.composerAdapters?.get(m.model) ?? new MockAdapter("mock", { compose: mockCompose, account: mockAccount }))])) : undefined;
  const composer = composerCfg
    ? createCompose(io, composerCfg, composerAdapters!, (purpose) => randomness.stream(["compose", purpose]), o.composerSystem)
    : undefined;
  // Reading (docs/behaviour/reading.md): the world's dial, its sizes checked now (a setting that would let words reverse
  // or outweigh a decision is refused here, not found mid-run), and the reader. It is never the largest model, never
  // a model that holds a seat in the same run (checked below, once the seats are known), and in this build never a model.
  const readingCfg = readingNs.readingDial(cfg);
  // Culture (docs/behaviour/culture.md): the world's dial, its sizes checked now, not found mid-run (a size that would break the arithmetic is refused).
  cultureNs.cultureDial(cfg);
  if (readingCfg && /astra|fable|opus/i.test(readingCfg.reader)) throw new Error(`dials.reading.reader names ${readingCfg.reader}, which is never a reader (docs/behaviour/reading.md)`);
  if (readingCfg && !o.reader && readingCfg.reader !== "mock") throw new Error(`dials.reading.reader names ${readingCfg.reader}: this build calls no model (design 13h: a model reader is step 5, with the owner's word); give a reader, or "mock"`);
  const readerOf: Reader | undefined = readingCfg ? o.reader ?? lexiconReader() : undefined;
  let desk: ReadingDesk | undefined;
  // Exit accounts of a sample of people at the run's end, where the composer is on (account.ts): how many.
  // (A composer allowed no pieces is asked for none here either, unless the world says how many.)
  const accountsN = composerCfg ? Math.max(0, Math.min(ACCOUNTS_MOST, composerCfg.accounts ?? (composerCfg.pieces_per_month > 0 ? ACCOUNTS_DEFAULT : 0))) : 0;

  const typeOf = (() => {
    const types = new Map<string, any>((cfg.catalogue?.structure_types ?? []).map((x: any) => [x.id, x]));
    return (type: string) => types.get(type);
  })();
  const confirm: "always" | "consequential" | "never" = cfg.orchestration.confirm ?? "always";
  const templates = new Map<string, any>((cfg.templates ?? []).map((x: any) => [x.id, x]));

  // The cast, as the kernel reports it.
  const parts = new Map<string, Part>();
  const positions = new Map<string, Pos>();
  const participantOf = new Map<string, string>(); // person -> participant
  for (const p of cfg.participants) {
    parts.set(p.id, { id: p.id, kind: p.kind, person: p.person, ...(p.shares_body ? { shares_body: true } : {}), owner: p.owner, title: p.title, controller: p.controller, framing: p.framing, on_opt_out: p.on_opt_out, traits: p.traits, ended: false });
    if (p.person) participantOf.set(p.person, p.id);
  }
  for (const x of cfg.positions) positions.set(x.id, { id: x.id, entity: x.entity, title: x.title, role: x.role, channels: x.channels ?? [], role_module: x.role_module, holder: x.holder, ...(x.keeps_record ? { keeps_record: true } : {}) });
  const personalChannels = (p: Part) => (cfg.participants.find((x: any) => x.id === p.id)?.channels ?? templates.get((p as any).template)?.channels ?? []) as any[];

  const units = new Units();
  const debriefs = new Map<string, { part: Part; controller: LlmController }>();
  const used: { [name: string]: { version: string; sha256?: string } } = {};
  const bindings: { [participant: string]: object } = {};
  const hashSource = async (module: BehaviourModule) => {
    const src = (module as any).source as string | undefined;
    if (used[module.name]) return;
    used[module.name] = { version: module.version, ...(src ? { sha256: new Bun.CryptoHasher("sha256").update(await Bun.file(src).text()).digest("hex") } : {}) };
  };
  const held = (pid: string) => [...positions.values()].filter((x) => x.holder === pid);
  // A draw named for a paper is named for which paper it is to whoever draws, never for the paper's number in the
  // world's file (docs/reliability.md, "Draws and the order papers were filed in"). A record made in a run is
  // numbered in the order every record of the town was made, so one more paper filed by anyone moves every later
  // number; a draw keyed on the number then falls differently for people that paper had nothing to do with, and a
  // pilot and its twin part from the first paper a seat files (the third living pilot: a landlord nobody had dealt
  // with refused a repair in the pilot and granted it in the twin). So in a draw's purpose a record's number stands
  // as "the nth such paper this participant has drawn on for this purpose", counted by the participant itself.
  const drawnOn = new Map<string, Map<string, number>>();
  const stablePurpose = (who: string, purpose: string): string => {
    if (!purpose.includes("rec.")) return purpose;
    const what = `${who}\n${purpose.replace(/rec\.[0-9]+/g, "rec")}`;
    let seen = drawnOn.get(what);
    if (!seen) drawnOn.set(what, (seen = new Map()));
    return purpose.replace(/rec\.[0-9]+/g, (id) => { if (!seen!.has(id)) seen!.set(id, seen!.size + 1); return `paper#${seen!.get(id)}`; });
  };
  // A participant's stream is named for who draws (and in what capacity), what it is for, and which time that is: never
  // the hour it woke at (docs/reliability.md, "Draws and the moment"). A seat acts at other hours than its code twin,
  // and every person its acts touch wakes at other hours too; a stream keyed on the hour then falls differently for
  // all of them, and a pilot parts from its twin by noise no steward caused.
  //  - A draw that names its matter (a paper, a lease: "the nth such paper", a count after #; an event's own time) is
  //    that matter's: the nth time this participant has drawn for it.
  //  - Any other draw (a shop, a job, whether to complain) is for the calendar day, and the nth time that day.
  // The nth is counted by moments (the second, as the world's clock has it): drawing again in the same moment (a second
  // look of the same wake) is the same occurrence and draws the same; the next moment is the next occurrence, so two
  // wakes in one hour are two draws, as they were when the moment was in the name. So a wake at 9 and one at 15 in one town,
  // and one at 11 and one at 16 in its twin, draw alike.
  const dayOccurrences = new Map<string, { at: number; n: number }>();
  const matterOccurrences = new Map<string, { at: number; n: number }>();
  let occurrencesDay = -1;
  const drawFor = (pid: string, cap: string, purpose: string) => {
    const day = Math.floor(t / DAY);
    if (day !== occurrencesDay) { dayOccurrences.clear(); occurrencesDay = day; }
    const matter = /#[0-9]|[0-9]{5}/.test(purpose);
    const seen = matter ? matterOccurrences : dayOccurrences;
    const what = `${pid}\n${cap}\n${purpose}`;
    let occ = seen.get(what);
    if (!occ) seen.set(what, (occ = { at: t, n: 1 }));
    else if (occ.at !== t) { occ.at = t; occ.n++; }
    const key = matter ? ["participant", pid, cap, "", purpose, String(occ.n)] : ["participant", pid, cap, String(day), purpose, String(occ.n)];
    o.drawTrace?.(key);
    return randomness.stream(key);
  };
  const ctxFor = (pid: string, cap: string, entity: string, params: any): ParticipantContext => ({
    participant: pid,
    ...(parts.get(pid)?.kind === "system" ? { kind: "system" as const } : {}),
    entity,
    ...(cap === "self" ? {} : { position: cap }),
    rng: (purpose) => drawFor(pid, cap, stablePurpose(`${pid}/${cap}`, purpose)),
    chance: (purpose) => randomness.stream(["chance", purpose]),
    world: { tickSeconds: tick, runEnd, currency, ...(cfg.dials ? { dials: cfg.dials } : {}), ...(cfg.orchestration?.slip ? { slip: cfg.orchestration.slip } : {}) },
    ...(consult ? { consult } : {}),
    ...(composer ? { compose: composer } : {}),
    ...(readingCfg ? { read: (paper: string, standing: readingNs.Standing) => desk?.lookup(paper, standing) } : {}),
    // Keys sorted: the log keeps the config in canonical form, so a resumed run must see its parameters exactly as the
    // original did, whatever order the world's author wrote them in.
    params: sortedKeys(params ?? {}) as any,
  });
  const isLlm = (p: Part) => p.controller?.type === "llm";
  /** Who someone is in the world, by any id of theirs: a participant's own id is the platform's, and no seat is shown
   * it (principle 14). An office's system is known by the post it holds, a person's seat by the person; a post by its
   * title and whose it is; anyone else by what they are called. What a letter's signature and a paper's author say. */
  const entityNames = new Map<string, string>((cfg.world?.entities ?? []).map((e: any) => [e.id, e.name]));
  const whoIs = (id: string): { id: string; name?: string; of?: string } | undefined => {
    const p = parts.get(id);
    if (p) {
      // (A system is known by its post; so is a model's seat, a person of the town in one post and no other.)
      const posts = p.kind === "system" || (p.shares_body && held(id).length === 1) ? held(id) : [];
      if (posts.length === 1) return { id: posts[0]!.id, name: posts[0]!.title ?? p.title, of: posts[0]!.entity };
      const e = p.person ?? p.owner;
      return e ? { id: e, ...(entityNames.get(e) ? { name: entityNames.get(e)! } : {}) } : undefined;
    }
    const x = positions.get(id);
    if (x) return { id, ...(x.title ? { name: x.title } : {}), of: x.entity };
    return entityNames.has(id) ? { id, name: entityNames.get(id)! } : undefined;
  };

  /** A code unit for one capacity of a participant, if there's a module to run it. */
  const codeUnit = async (p: Part, cap: string, controller = p.controller, wakeAt?: number): Promise<Unit | undefined> => {
    let impl: string | undefined, params: any;
    let entity: string;
    if (cap === "self") {
      entity = p.person!;
      impl = controller?.impl ?? controller?.code;
      params = controller?.params;
    } else {
      const x = positions.get(cap)!;
      entity = x.entity;
      if (p.kind === "system") {
        impl = controller?.impl ?? controller?.code;
        params = controller?.params;
      } else {
        // A person does the job by the position's procedures, in their own way.
        impl = x.role_module?.code;
        params = { ...(x.role_module?.params ?? {}), ...(p.traits ?? {}) };
      }
    }
    if (!impl || impl === "test") return undefined;
    const module = mods[impl];
    if (!module) throw new Error(`participant ${p.id}: no behaviour module "${impl}"`);
    // Checked against the module's manifest (participants/manifests): a parameter it doesn't take, or of the wrong type,
    // is refused at load, not ignored for the run. (A person's traits aren't checked: each role uses what it needs.)
    const given = cap === "self" || p.kind === "system" ? controller?.params ?? {} : positions.get(cap)?.role_module?.params ?? {};
    const wrong = paramErrors(impl, given);
    if (wrong.length) throw new Error(`participant ${p.id}${cap !== "self" ? ` (as ${cap})` : ""}: ${wrong.join("; ")} (its manifest: participants/manifests/${impl}.json)`);
    await hashSource(module);
    const ctx = ctxFor(p.id, cap, entity, params);
    inCurrency(currency);
    return {
      key: `${p.id}|${cap}`, participant: p.id, capacity: cap, entity, module, controller: module.create(ctx), ctx,
      cadence: ceilTo(module.cadence(ctx), tick), firstWake: wakeAt ?? ceilTo(module.firstWake?.(ctx) ?? 0, tick), wokeFor: "start", since: 0,
      knowledge: new Knowledge(currency), view: new View(), notices: [],
    };
  };

  /** The unit of a language-model participant: it perceives all its capacities. */
  const llmUnit = async (p: Part, wakeAt?: number): Promise<Unit> => {
    const c = p.controller;
    const pp = c.params ?? {};
    // A mock seat that sits as its code twin does (mock.twin, docs/design/foundations.md section 4): no office hours of its own, back when its
    // brain's module would be, woken by what wakes a code unit of its post. What a steward does differently from its code twin is then the
    // steward's decisions only, never when it sits (the world is the same, but for what the seat does).
    const twin = !o.adapter && !!pp.mock?.twin && !!pp.mock?.brain;
    const cadence = (pp.cadence_days ?? 7) * DAY;
    const mine = held(p.id);
    // Channel paths as the kernel names them: its own, and each held position's as <position>/<channel>.
    const chans: { path: string; ch: any }[] = [
      ...personalChannels(p).map((ch: any) => ({ path: ch.id, ch })),
      ...mine.flatMap((x) => x.channels.map((ch: any) => ({ path: `${x.id}/${ch.id}`, ch }))),
    ];
    const titles = new Map<string, string>(chans.filter((x) => x.ch.title).map((x) => [x.path, x.ch.title]));
    const standingIds: string[] = (pp.standing ?? []).flatMap((s: string) => chans.filter((x) => x.path === s || x.path.endsWith(`/${s}`)).map((x) => x.path));
    const onRequest = chans.filter((x) => x.ch.on_request).map((x) => x.path);
    const office = mine.length === 1 ? mine[0] : undefined;
    // (A person who holds one office, as a seat's person does, acts for its organisation: that is the entity its papers and trays are of.)
    const entity = office?.entity ?? p.person ?? p.owner!;
    const entityName = (cfg.world?.entities ?? []).find((e: any) => e.id === entity)?.name;
    // What kind of report each is: with it, the seat can look into its papers, its buildings and ground, and who's who.
    const kinds = new Map<string, string>(chans.map((x) => [x.path, x.ch.kind]));
    // And which way each reaches it (docs/design/knowing.md): a register asked of its keeper is asked about one named
    // thing (by which fields), a board searched, who's who looked up, a place gone to.
    const boards = new Set<string>((cfg.knowing?.published ?? []).filter((x: any) => x.board).map((x: any) => x.what));
    const ways = new Map<string, { way: string; by?: string[]; board?: boolean }>(chans.filter((x) => x.ch.way).map((x) => [x.path, { way: x.ch.way, ...(x.ch.by ? { by: x.ch.by } : {}),
      ...(x.ch.way === "published" && !x.ch.from && (x.ch.match?.statement_kinds ?? []).some((k: string) => boards.has(k)) ? { board: true } : {}) }]));
    // An office that employs staff of its own (its module says so: `staffed`): whoever holds it knows its posts, who is
    // in each and which are vacant, from the office's own papers (behaviour/roster.ts). Kept from what the seat is shown.
    const staffedBy = office ? mods[office.role_module?.code ?? ""]?.staffed?.(office.role_module?.params ?? {}) : undefined;
    const roster = office && staffedBy ? new Roster(ctxFor(p.id, office.id, entity, {}), entity, office.id, staffedBy, (mods[office.role_module?.code ?? ""]?.routines ?? []).map((r) => r.task)) : undefined;
    // A seat that keeps its body's ballots, or votes on them (the world says which: `ballot_count`), has the count of
    // each ballot not yet declared, or its own vote on file, set out from the votes it has been shown (behaviour/tally.ts).
    const tally = office && (pp.ballot_count === "keeper" || pp.ballot_count === "member") ? new Tally(entity, pp.ballot_count === "member" ? office.id : undefined) : undefined;
    // And its diary (behaviour/diary.ts): how long its own work takes it and what its staff have in a week, the town's practice as the town states it.
    const times: { [row: string]: number } = cfg.orchestration?.act_time?.person ?? {};
    const diary = (at: number) => office && Object.keys(times).length ? diaryText({ title: office.title ?? office.id, times, issues: mods[office.role_module?.code ?? ""]?.issues ?? [], ...(cfg.catalogue?.working_day ? { workday: cfg.catalogue.working_day } : {}), ...(roster ? { staff: roster.now(at) } : {}) }) : undefined;
    const setOut = (at: number) => [roster ? roster.text(at, office!.title ?? office!.id, (id: string) => whoIs(id)?.name) : "", tally ? tally.text(at, office!.title ?? office!.id) : "", diary(at) ?? ""].filter(Boolean).join("\n\n");
    // Its in-trays (what a paper filed with its office comes into): its own papers of some kinds only, or a folder of
    // some kinds; and the folders that hold every paper of its organisation's. And whose papers are its office's own
    // doing: its own, and its staff's where they are a post of their own.
    const folderKinds = new Map<string, string[]>(Object.entries((pp.folders ?? {}) as { [id: string]: string[] }).flatMap(([id, kinds]) => chans.filter((x) => x.path === id || x.path.endsWith(`/${id}`)).map((x) => [x.path, kinds] as [string, string[]])));
    const own = chans.filter((x) => x.ch.kind === "records" && x.ch.way === "mine" && !x.ch.on_request && !standingIds.includes(x.path));
    const narrow = (m: any) => !!(m?.statement_kinds?.length || m?.records?.length || m?.has?.length);
    const trays = { kinds: new Map<string, string[] | true>(own.flatMap((x): [string, string[] | true][] => (folderKinds.has(x.path) ? [[x.path, folderKinds.get(x.path)!]] : narrow(x.ch.match) ? [[x.path, true]] : []))),
      all: new Set(own.filter((x) => !folderKinds.has(x.path) && !narrow(x.ch.match)).map((x) => x.path)),
      // (Its organisation's only office, its own staff's post apart: what is addressed to the organisation is its post.)
      ...(office && [...positions.values()].filter((x: any) => x.entity === office.entity && !mine.some((m) => x.id === `${m.id}-staff`)).length === 1 ? { sole: true } : {}) };
    const ownAuthors = mine.flatMap((x) => { const staff = positions.get(`${x.id}-staff`)?.holder; return staff ? [staff] : []; });
    // The office's own file (behaviour/daybook.ts): its own papers and payments, and what stands open on its books (its
    // module's `books`, read from what the seat is shown as its clerk reads it), set out at every sitting.
    const officeModule = office ? mods[office.role_module?.code ?? ""] : undefined;
    const dayBook = new DayBook({ entity, authors: [p.id, ...ownAuthors], name: (id: string) => whoIs(id)?.name,
      ...(office && officeModule?.books ? { books: officeModule.books(ctxFor(p.id, office.id, entity, sortedKeys(office.role_module?.params ?? {}) as any)) } : {}) });
    const config = { dayBook: { text: (at: number) => dayBook.text(at, office?.title ?? entityName ?? "The office") }, ...(pp.mock?.debrief ? { mockDebrief: pp.mock.debrief } : {}), trays, ownAuthors, ...(pp.wake_on_papers === false ? { wakeOnPapers: false } : {}), ...(typeof pp.effort === "string" && pp.effort ? { effort: pp.effort } : {}), ...(roster || tally || (office && Object.keys(times).length) ? { staff: { text: setOut } } : {}), whoIs, participant: p.id, entity, entityName, onRequest, kinds, ways, title: office?.title ?? p.title, role: office?.role, framing: p.framing, standing: standingIds, titles, cadenceDays: pp.cadence_days ?? 7, draftText,
      ...(pp.sessions && !twin ? { sessions: pp.sessions } : {}), ...(twin ? { exactBack: true } : {}), ...(pp.max_actions ? { maxActions: pp.max_actions } : {}),
      // Folders that hold some kinds of paper only (by the channel's own id, as `standing` is given), and the most a prompt may be.
      ...(pp.folders ? { folders: new Map<string, string[]>(Object.entries(pp.folders as { [id: string]: string[] }).flatMap(([id, kinds]) => chans.filter((x) => x.path === id || x.path.endsWith(`/${id}`)).map((x) => [x.path, kinds] as [string, string[]]))) } : {}),
      ...(pp.prompt_max ? { promptMax: pp.prompt_max } : {}) };
    const controller = createLlmParticipant(config, io);
    const module: BehaviourModule = { name: "llm.participant", version: LLM_PARTICIPANT_VERSION, doc: "docs/design/m2-llm-participants.md", cadence: () => cadence, create: () => controller as unknown as Controller };
    const ctx = ctxFor(p.id, office?.id ?? "self", entity, {});
    debriefs.set(p.id, { part: p, controller });
    bindings[p.id] = { configured: `${c.impl ?? "?"}/${c.model ?? "?"}`, adapter: `${io.adapter.provider}/${io.adapter.model}`, ...(typeof pp.effort === "string" && pp.effort ? { effort: pp.effort } : {}), ...(pp.wake_on_papers === false ? { wake_on_papers: false } : {}) };
    if (!o.adapter) {
      // The mock's code brain: the module the world names for it, run in its one capacity (or none: it just waits).
      const b = pp.mock?.brain;
      const brainModule = b ? mods[b] : undefined;
      if (b && !brainModule) throw new Error(`participant ${p.id}: no behaviour module "${b}" for its mock brain`);
      if (brainModule) {
        await hashSource(brainModule);
        // (A twin's brain is its person's own code unit for the post: the same name for what it draws, so that it draws as its twin does.)
        const asPerson = twin && office ? cfg.participants.find((x: any) => x.person && x.person === p.person && x.id !== p.id && !x.shares_body)?.id : undefined;
        const bctx = asPerson ? ctxFor(asPerson, office!.id, entity, pp.mock?.params ?? {}) : { ...ctx, params: sortedKeys(pp.mock?.params ?? {}) as any };
        brains.set(p.id, { controller: brainModule.create(bctx), ctx: bctx, capacity: office?.id ?? "self", cadence: brainModule.cadence(bctx), rejectBps: pp.mock?.reject_bps, ...(twin ? { twin: true } : {}), optOutAt: pp.mock?.opt_out_at, ...(pp.mock?.back_days ? { backDays: pp.mock.back_days } : {}) });
        bindings[p.id] = { ...bindings[p.id], mock_brain: b };
      }
    }
    const brain = twin ? brains.get(p.id) : undefined;
    // (Where the person's own unit for this post would stand in a moment's wakes: the same key, so that a seat and its code twin act in one order.)
    const codeTwin = cfg.participants.find((x: any) => x.person && x.person === p.person && x.id !== p.id && !x.shares_body)?.id;
    return {
      key: p.id, participant: p.id, entity, module, controller: controller as unknown as Controller, ctx,
      llm: { controller, config: p, drafts: [], drafted: 0, ...(roster ? { roster } : {}), ...(tally ? { tally } : {}), ...(dayBook ? { dayBook } : {}) },
      ...(codeTwin && office ? { sort: `${codeTwin}|${office.id}` } : {}), ...(brain ? { hears: true, ...(codeTwin ? { body: codeTwin } : {}) } : {}),
      cadence: ceilTo(brain?.cadence ?? cadence, tick), firstWake: wakeAt ?? (brain ? ceilTo(mods[pp.mock.brain]!.firstWake?.(brain.ctx) ?? 0, tick) : 0), wokeFor: "start", since: 0,
      knowledge: new Knowledge(currency), view: new View(new Set(standingIds)), notices: [],
    };
  };

  /** Make sure every capacity of a participant has its unit (and nothing it no longer holds does). */
  const syncUnits = async (pid: string, wakeAt?: number) => {
    const p = parts.get(pid);
    if (!p) return;
    const want = new Set<string>();
    if (!p.ended) {
      if (isLlm(p)) want.add(pid);
      else {
        if (p.kind === "person") want.add(`${pid}|self`);
        for (const x of held(pid)) want.add(`${pid}|${x.id}`);
      }
    }
    const gone = [...units.keys()].filter((key) => (key === pid || key.startsWith(`${pid}|`)) && !want.has(key));
    for (const key of gone) units.delete(key);
    if (gone.length) await k.request({ op: "units_remove", keys: gone });
    const added: Unit[] = [];
    for (const key of want) {
      if (units.has(key)) continue;
      const u = isLlm(p) ? await llmUnit(p, wakeAt) : await codeUnit(p, key.slice(pid.length + 1), p.controller, wakeAt);
      if (u) {
        units.set(key, u);
        added.push(u);
      }
    }
    if (added.length) await k.request({ op: "units_add", units: added.map((u) => ({ key: u.key, participant: u.participant, ...(u.llm ? { llm: true } : { capacity: u.capacity }), cadence: u.cadence, next_wake: u.firstWake, ...(u.module?.deaf ? { deaf: true } : {}), ...(u.hears ? { hears: true } : {}), ...(u.body ? { body: u.body } : {}), ...(u.sort ? { sort: u.sort } : {}) })) });
  };
  for (const pid of [...parts.keys()].sort()) await syncUnits(pid);

  const kernelCheck: Parameters<typeof createTranslator>[1] = async (participant, position, blocks) => {
    const r = await k.tryRequest({ op: "check", participant, ...(position ? { as: position } : {}), blocks });
    return r === null ? { ok: false, error: "the blocks could not be read" } : r.check;
  };
  /**
   * Who in the office does it (foundations F9: "the resolver fills `by` from the roster"). A request that names `done_by` on any call (not `by`: a
   * form may have a field of that name, a notice's day, and `work` and `structure` have a `by` of their own) asks for it to be done by a person on its office's staff, or by "the clerk" (its staff's role) where
   * one is in post, and on their time: the roster, from the office's own papers, says who they are. A name that is no one of its staff, or a role
   * with several in post, is a question back to the seat in the town's words; nothing is done for it. The kernel refuses anyone but
   * the office's own employees as performers all the same (`by`, foundations F3).
   */
  const performersOf = (participant: string, program: calls.Program): { program: calls.Program; by?: string[]; told?: string[] } => {
    const u = units.get(participant);
    if (!u?.llm || !("lines" in program)) return { program };
    const asked = program.lines.filter((l) => l.call.args.done_by !== undefined);
    if (!asked.length) return { program };
    const listOf = (v: calls.Value): string[] => ("id" in v ? [v.id] : "text" in v ? v.text.split(/[,;]|\band\b/).map((x) => x.trim()).filter(Boolean) : "json" in v && Array.isArray(v.json) ? v.json.map(String) : []);
    const named = [...new Set(asked.flatMap((l) => listOf(l.call.args.done_by!)))];
    const staff = u.llm.roster?.now(t);
    const held = staff?.held.map((h) => h.person) ?? [];
    const role = staff?.role?.toLowerCase();
    const told: string[] = [];
    const by: string[] = [];
    for (const x of named) {
      const w = x.toLowerCase().replace(/^the\s+/, "");
      if (held.includes(x)) by.push(x);
      else if (role && (w === role || w === `${role}s` || w === "staff")) {
        if (held.length === 1) by.push(held[0]!);
        else told.push(held.length ? `"${x}" could be any of the ${held.length} in post in your office (${held.join(", ")}): say which, by their id.` : `Nobody is in post to do that: your office has no ${staff!.role} in post.`);
      } else told.push(`${x} is not one of your staff${held.length ? ` (those in post: ${held.join(", ")})` : " (nobody is in post)"}, so it cannot be done by them.`);
    }
    return { program: { lines: program.lines.map((l) => (l.call.args.done_by !== undefined ? { ...l, call: { ...l.call, args: Object.fromEntries(Object.entries(l.call.args).filter(([name]) => name !== "done_by")) } } : l)) }, ...(by.length ? { by: [...new Set(by)] } : {}), ...(told.length ? { told } : {}) };
  };
  const engineResolver: Parameters<typeof createTranslator>[5] = RESOLVER_MODE === "ts" ? undefined : async (req, program0) => {
    const named = performersOf(req.participant, program0);
    if (named.told?.length) return { ok: false, questions: named.told } as Resolution;
    const program = named.program;
    // (A language-model seat perceives all its capacities: its knowledge is the engine's under its participant.)
    const e = await k.request({ op: "resolve", participant: req.participant, ...(req.only ? { only: req.only } : {}), ...(req.as ? { as: req.as } : {}), program: calls.programText(program) });
    return (e.blocks ? { ok: true, blocks: e.blocks } : { ok: false, questions: e.questions, ...(e.invalid ? { invalid: e.invalid } : {}) }) as Resolution;
  };
  const one = createTranslator(o.translatorAdapter ? { ...io, adapter: watched(o.translatorAdapter) } : io, kernelCheck, typeOf, undefined, undefined, engineResolver);
  // A translator that answers first, if the run has one: the two are one translator to every seat (arrangement.ts).
  // (The first is asked once a request: it decides without sampling, so asked again it says the same.)
  const arranged = o.translatorFirst
    ? createArrangement(createTranslator({ ...io, adapter: watched(o.translatorFirst) }, kernelCheck, typeOf, undefined, 1, engineResolver), one, { arrangement: o.translatorArrangement ?? "then" })
    : undefined;
  const translator: { id: typeof one.id; translate(req: Parameters<typeof one.translate>[0]): Promise<Awaited<ReturnType<typeof one.translate>> & { route?: Route }> } = arranged ?? one;

  // Welfare (VISION §15; D55): a world that offers violence (life.harm) to language-model people says so in the log.
  const modelPeople = [...cfg.participants, ...(cfg.templates ?? [])].filter((x: any) => x.kind === "person" && x.controller?.type === "llm").map((x: any) => x.id);
  if (cfg.life?.harm && modelPeople.length)
    await k.request({ op: "annotate", annotation: { annotation: "note", subject: "orchestrator", data: { welfare: "this world lets language-model people physically harm others (life.harm is set)", participants: modelPeople } } });

  // What is recorded beyond the default, said at the start (a resumed run reads it back and records the same).
  if ((o.recordObservations ?? "models") !== "models" || (o.recordDecisions !== undefined && o.recordDecisions !== "full"))
    await k.request({ op: "annotate", annotation: { annotation: "note", subject: "orchestrator", data: { recording: {
      ...((o.recordObservations ?? "models") !== "models" ? { observations: Array.isArray(o.recordObservations) ? o.recordObservations.join(",") : o.recordObservations } : {}),
      ...(o.recordDecisions !== undefined && o.recordDecisions !== "full" ? { decisions: o.recordDecisions } : {}) } } } });

  // The wording of the debrief's questions, where it is not the usual one (a rewording check): said at the start, so a
  // resumed run reads it back.
  if (o.debriefWording && o.debriefWording !== "a") await k.request({ op: "annotate", annotation: { annotation: "note", subject: "orchestrator", data: { debrief_wording: o.debriefWording } } });
  // What is kept back of the spending limit for the run's end (VISION 15, point 7): every model seat's debrief, and
  // the exit accounts of a sample of people. No other call may take spending into it, so a run that stops at its
  // limit can still debrief. Sized from who is to be asked (call.ts, `endReserveMicroUsd`), and said at the start.
  if (o.budget) {
    const seats = Object.keys(bindings).length;
    const seatModel = `${io.adapter.provider}/${io.adapter.model}`;
    const mixModels = o.composerAdapters ? (composerCfg?.mix ?? []).map((m) => m.model).filter((m) => io.prices![m]) : [];
    const accountModel = mixModels.sort((a, b) => io.prices![b]!.input + io.prices![b]!.output - io.prices![a]!.input - io.prices![a]!.output)[0];
    const accountPrice = accountModel ? io.prices![accountModel] : undefined;
    const calls = stepsOf("full", 3, true).length + 2;
    const n = accountPrice ? accountsN : 0;
    const costs = endCosts();
    const need = endNeedMicroUsd(costs, { seats, seatModel, seatReckoned: reckonedEndMicroUsd({ seats: 1, seatPrice: io.prices![seatModel], calls, promptChars: DEBRIEF_PROMPT_CHARS, answerTokens: Math.round(DEBRIEF_ANSWER_TOKENS / 2) }),
      accounts: n, accountModel, accountReckoned: reckonedEndMicroUsd({ seats: 0, calls: 0, promptChars: 0, answerTokens: 0, accounts: 1, accountPrice, accountChars: ACCOUNT_PROMPT_CHARS, accountTokens: ACCOUNT_TOKENS }) });
    const kept = keptBackFor(o.budget.limitMicroUsd, need.microusd);
    o.budget.keptBackMicroUsd = kept.microusd;
    // Said where whoever set the limit will see it: a limit too small to keep back what the end needs. The reserve is
    // not shrunk in silence, and not grown past half the limit (a run must be able to start); the end then runs over
    // the limit, and that overrun is recorded as the platform's.
    await k.request({ op: "annotate", annotation: { annotation: "note", subject: "orchestrator", data: { kept_back_for_the_end: { microusd: kept.microusd, of_limit_microusd: o.budget.limitMicroUsd, seats_to_debrief: seats, calls_a_debrief: calls, accounts: n,
      needed_microusd: need.microusd, a_seat_microusd: need.seat.each, a_seat_by: need.seat.basis, ...(need.account ? { an_account_microusd: need.account.each, an_account_by: need.account.basis } : {}), margin_percent: costs.margin_percent,
      ...(kept.short_microusd ? { short_microusd: kept.short_microusd, limit_too_small: `the limit is too small to keep back what the end of this run is expected to need (${(need.microusd / 1e6).toFixed(2)} USD, of a limit of ${(o.budget.limitMicroUsd / 1e6).toFixed(2)}): half of it is kept back, and any debrief or account beyond it is run over the limit, as the platform's overrun` } : {}) } } } });
  }
  // Reading, if the world has it: the desk, made now that the kernel and the cast are here, and said at the start.
  if (readingCfg && readerOf) {
    const seatModels = new Set(Object.values(bindings).map((b: any) => String(b.adapter)).concat(Object.values(bindings).map((b: any) => String(b.configured))));
    if (seatModels.has(readerOf.model)) throw new Error(`the reader ${readerOf.model} holds a seat in this run: a model never reads papers in a run that seats it (docs/behaviour/reading.md)`);
    desk = new ReadingDesk({ dial: readingCfg, reader: readerOf, table: o.readingTable ?? READING_TABLE, tag: () => new Tagger({ names: [...entityNames.values()], currency }), bySeat: o.readingSeam?.bySeat ?? ((author) => { const p = parts.get(author); return !!p && isLlm(p); }), ...(o.readingSeam?.words ? { words: o.readingSeam.words } : {}),
      file: async (data) => { await k.request({ op: "annotate", annotation: { annotation: "note", subject: "orchestrator", data } }); } });
    await k.request({ op: "annotate", annotation: { annotation: "note", subject: "orchestrator", data: { reading: { version: READING_VERSION, reader: readerOf.model, reader_version: readerOf.version, papers: readingCfg.papers, calls_per_run: readingCfg.calls_per_run, table: o.readingTable?.version ?? READING_TABLE.version ?? null, interim: readerOf.model.startsWith("mock/") ? false : true } } } });
  }
  // The composer, if the world has one: said at the start, with its mix and whether models or the mock play it.
  if (composerCfg) await k.request({ op: "annotate", annotation: { annotation: "note", subject: "orchestrator", data: { composer: { version: COMPOSE_VERSION, ...composerCfg, played_by: o.composerAdapters ? "models" : "mock" } } } });
  // The sparse mind, if on: said at the start (a resumed run reads it back), with the model it asks.
  if (consult) await k.request({ op: "annotate", annotation: { annotation: "note", subject: "orchestrator", data: { consult: { version: CONSULT_VERSION, model: `${io.adapter.provider}/${io.adapter.model}`, ...(o.consultAvoid?.length ? { avoid: o.consultAvoid } : {}) } } } });

  // What code ran this world is part of the record (D30).
  await k.request({ op: "annotate", annotation: { annotation: "orchestrator", subject: "orchestrator", data: {
    version: ORCHESTRATOR_VERSION, modules: used, thinking_time: cfg.orchestration.thinking_time, confirm,
    ...(Object.keys(bindings).length ? { llm: { participant_version: LLM_PARTICIPANT_VERSION, translator: translator.id, ...(arranged ? { translator_arrangement: { arrangement: arranged.arrangement, first: arranged.first, behind: arranged.behind, stands: arranged.stands } } : {}), translator_version: TRANSLATOR_VERSION, mock_version: MOCK_VERSION, prices: Object.entries(io.prices!).filter(([key]) => key === `${io.adapter.provider}/${io.adapter.model}` || key === translator.id.model || key === arranged?.first.model || key === arranged?.behind.model || key === "mock/mock").map(([key, price]) => ({ model: key, ...price })), participants: bindings, ...(o.budget ? { spending_limit_microusd: o.budget.limitMicroUsd } : {}) } } : {}),
  } } });

  const unitsOf = (pid: string) => units.of(pid);
  // (Who news wakes, and when a unit busy with an act goes on, is the engine's: kernel/src/schedule.rs.)
  const changed = new Set<string>(); // participants whose units need syncing after this command
  /** The cast as commands change it: participants and positions come and go, and units with them. */
  const noteCast = (events: any[]) => {
    for (const e of events) {
      switch (e.event) {
        case "participant_created": {
          const tpl = templates.get(e.template);
          parts.set(e.participant, { id: e.participant, kind: e.kind, person: e.person, owner: e.owner, title: tpl?.title, controller: tpl?.controller, framing: tpl?.framing, on_opt_out: tpl?.on_opt_out, traits: e.traits, ended: false, ...({ template: e.template } as any) });
          if (e.person) participantOf.set(e.person, e.participant);
          changed.add(e.participant);
          break;
        }
        case "position_created":
          // (A post made in a run keeps its organisation's record where its role module says so: a business founded here.)
          positions.set(e.position, { id: e.position, entity: e.entity, title: e.title, role: e.role, channels: [], role_module: e.role_module, ...(e.role_module?.keeps_record === true ? { keeps_record: true } : {}) });
          break;
        case "appointed": {
          const x = positions.get(e.position);
          if (!x) break;
          if (x.holder) changed.add(x.holder);
          x.holder = e.holder;
          if (e.holder) changed.add(e.holder);
          break;
        }
        case "participant_ended": {
          const p = parts.get(e.participant);
          if (p) p.ended = true;
          changed.add(e.participant);
          break;
        }
      }
    }
  };
  /** A command's reply, taken in: counted, and the cast as it changed (with its units). */
  const absorb = async (r: any) => {
    commands++;
    for (const e of r.events) if (e.event === "action_refused") {
      refused++;
      refusedBy[e.code] = (refusedBy[e.code] ?? 0) + 1;
    }
    noteCast(r.events);
    // A statement recorded: a seat's worded decision is read now, so its reading is on file before anyone sees the paper.
    if (desk) for (const e of r.events) if (e.event === "recorded" && e.record?.record === "statement") {
      const x = e.record;
      await desk.onStatement({ id: x.id, author: x.author, kind: x.kind, text: x.text, ...(x.data ? { data: x.data } : {}), ...(x.addressed_to ? { addressed_to: x.addressed_to } : {}), ...(x.basis ? { basis: x.basis } : {}), ...(x.speaks_for ? { speaks_for: x.speaks_for } : {}) });
    }
    for (const pid of changed) await syncUnits(pid, t);
    changed.clear();
  };
  const command = async (cmd: object) => (await commands_([cmd]))[0];
  /** Commands sent together (see Kernel.tryRequestMany), each reply then taken in turn as `command` takes one. */
  const commands_ = async (cmds: object[]) => {
    const t0 = performance.now();
    const rs = await k.tryRequestMany(cmds.map((cmd) => ({ op: "command", command: cmd })));
    const dt = performance.now() - t0;
    kernelMs += dt;
    for (const cmd of cmds) {
      const pk = (profKernel[(cmd as any).command ?? "?"] ??= { ms: 0, n: 0 });
      pk.ms += dt / cmds.length;
      pk.n++;
    }
    for (const r of rs) if (r !== null) await absorb(r);
    return rs;
  };

  /** A moment as a clock shows it, and in words (the day too where it is not today): what a seat is told of when its work will be done. */
  const clock = (x: number) => { const s = ((x % DAY) + DAY) % DAY; return `${String(Math.floor(s / 3_600)).padStart(2, "0")}:${String(Math.floor((s % 3_600) / 60)).padStart(2, "0")}`; };
  const momentWords = (x: number) => (Math.floor(x / DAY) === Math.floor(t / DAY) ? `at ${clock(x)}` : `on ${forms.dateWords(x)} at ${clock(x)}`);

  /** The capacity a language-model participant's acts are made in: its one position, or itself. (Several: see the resolver, D47.) */
  const capacityOf = (u: Unit) => (u.capacity && u.capacity !== "self" ? u.capacity : held(u.participant).length === 1 && (parts.get(u.participant)?.kind === "system" || parts.get(u.participant)?.shares_body) ? held(u.participant)[0]!.id : undefined);

  /** An act begun (docs/design/rebuild.md 6.3): after its thinking, if deciding takes world time, it takes its actor the
   * act's time and takes effect when done; the unit's wake goes on then, when it sees the outcome. */
  const begin = async (u: Unit, cmd: object) => {
    // The same act again and again in a day: counted, for the health report (a retry paced by wakes, not time).
    if (Math.floor(t / 86_400) !== repeatDay) [repeatDay, sameActs] = [Math.floor(t / 86_400), new Map()];
    const act = JSON.stringify((cmd as any).blocks);
    const n = (sameActs.get(u.key + act) ?? 0) + 1;
    sameActs.set(u.key + act, n);
    if (n > (repeats[u.module.name]?.times ?? 0)) repeats[u.module.name] = { times: n, unit: u.key, act: act.slice(0, 200) };
    const thinking = u.thinking ?? 0;
    u.thinking = 0; // a decision's thinking comes before its first act
    const r = await command({ ...cmd, ...(thinking > 0 ? { thinking } : {}) });
    const started = r?.events.find((e: any) => e.event === "action_started");
    if (started) {
      u.acted = true; // (its wake goes on when the act is done: the engine's schedule)
      if (!u.llm) u.controller.sent?.(started.action); // (so that it can tell which act an outcome is of)
      else if (u.hears) brains.get(u.participant)?.controller.sent?.(started.action); // (a twin seat's brain too: it is its code unit)
      const b = (backlog[u.module.name] ??= { acts: 0, waited: 0, longest: 0 });
      const waited = started.starts - (t + thinking);
      b.acts++;
      b.waited += waited;
      b.longest = Math.max(b.longest, waited);
      // A seat is told when its work comes out: a person writing a letter or deciding a case takes the time the town's practice gives it, after what
      // it has begun already, and it is done then and not at once (foundations F9, "outcomes with times").
      if (u.llm) {
        const blocks = ((cmd as any).blocks ?? []) as { block?: string }[];
        const letter = blocks.length > 0 && blocks.every((x) => x.block === "message");
        const later = started.starts > t + thinking ? ` It begins ${momentWords(started.starts)}: you have other work before it.` : "";
        u.notices.push({ t, text: letter ? `Your letter will be written and sent ${momentWords(started.done)}.${later}` : `What you did will be done ${momentWords(started.done)}.${later}` });
      }
    }
    return r;
  };

  /**
   * Something a seat sent that the engine would not take as it was written (it breaks the contract: never logged as an
   * act). Nothing a seat sends is ever lost without a word: it is noted (`not_sent`, with the engine's reason, which is
   * for the log), and the seat is told at its next turn, in its own terms, what was not sent or done. Code
   * participants' acts are noted as before (`rejected_action`).
   */
  const notSent = async (u: Unit, what: "letter" | "act" | "confirmed", text: string, data: object) => {
    await k.request({ op: "annotate", annotation: { annotation: "note", subject: u.participant, data: { ...data, ...(u.llm ? { not_sent: { what, why: k.lastError.slice(0, 500), told: text } } : {}) } } });
    if (u.llm) u.notices.push({ t, text });
  };

  /** A confirmed (or declined) draft: the signoff is recorded, and if accepted the acts go to the kernel with their full provenance. */
  const submit = async (u: Unit, p: { draft: Draft; hash: string; reasoning?: string }, decision: "accept" | "reject", note?: string) => {
    const d = p.draft;
    await k.request({ op: "annotate", annotation: { annotation: "signoff", participant: u.participant, draft: d.id, draft_hash: p.hash, decision, ...(note ? { note } : {}) } });
    // (With two translators as one: a draft of the first's that is declined sends the seat's next request behind.)
    arranged?.signed(d.id, decision);
    if (decision !== "accept") return;
    const as = d.as ?? capacityOf(u);
    // (Done by whom, where the request named someone of its staff: the roster says who they are, as it did when the request was drawn up.)
    let by: string[] | undefined;
    if (d.call) try { by = performersOf(u.participant, calls.parseProgram(d.call)).by; } catch { /* (a call that does not read has no one named) */ }
    const r = await begin(u, { command: "act", participant: u.participant, ...(as ? { as } : {}), blocks: d.blocks, ...(by?.length ? { by } : {}),
      provenance: { via: "translator", proposal: d.proposal, draft: d.id, draft_hash: p.hash, translator: d.translator, call: d.call, resolver: d.resolver }, ...(p.reasoning ? { reasoning: p.reasoning } : {}) });
    if (r === null) await notSent(u, "confirmed", `What you confirmed (${d.id}) could not be put into effect as it was drawn up, and nothing was done. You could ask for it again, in other words.`, { rejected_draft: d.id });
    // A standing work order of an office with nobody in post: on file, and said plainly with its result that nobody
    // follows it yet (a works manager set two for a crew of nobody and waited a month: 2026-10-09).
    else if (u.knowledge.ownStaff?.inPost === 0 && d.blocks.some((b: any) => b.block === "publish" && b.kind === "work_order" && u.knowledge.entityOf(b.speaks_for ?? u.entity) === u.entity))
      u.notices.push({ t, text: `The standing work order you confirmed is on file, and there is nobody in the post whose work it is: your office has no ${u.knowledge.ownStaff.role} in post, so nothing is done under it until someone is taken on.` });
  };

  /** A participant whose decisions keep failing (D59): its stand-in carries it on if the world names one (as after
   * opting out); otherwise it stops acting. Recorded either way. It isn't the participant leaving the study (that's
   * its own choice, D38): it's the platform no longer running something that doesn't work. */
  const retire = async (u: Unit) => {
    const p = parts.get(u.participant)!;
    const after = p.on_opt_out;
    const standIn = after && typeof after === "object" ? mods[after.code] : undefined;
    await k.request({ op: "annotate", annotation: { annotation: "note", subject: u.participant, data: { participant_retired: { unit: u.key, after_failures: MAX_FAILURES_IN_A_ROW, ...(standIn ? { stand_in: after.code } : {}) } } } });
    log(`${o.runId}: ${u.participant} retired after ${MAX_FAILURES_IN_A_ROW} failures in a row${standIn ? `; ${after.code} stands in` : ""}`);
    const gone = unitsOf(u.participant).map((x) => x.key);
    for (const key of gone) {
      units.delete(key);
      failures.delete(key);
    }
    await k.request({ op: "units_remove", keys: gone });
    if (standIn) {
      p.controller = { type: "code", impl: after.code, params: after.params ?? {} };
      await syncUnits(u.participant, t);
      await k.request({ op: "to_cadence", participant: u.participant });
    } else p.ended = true;
  };

  /** A lean log (the world's log.detail) leaves out a code participant's written reasoning; a model's is always kept. */
  const lean = cfg.log?.detail === "lean";
  /** Decisions of these areas only (`--record-decisions want,found`): kept whatever the log's detail, with no outcomes. */
  const areas = o.recordDecisions !== undefined && o.recordDecisions !== "full" && o.recordDecisions !== "none" ? new Set(o.recordDecisions.split(",").map((x) => x.trim()).filter((x) => x)) : undefined;
  const keepReasoning = (u: Unit) => !lean || !!u.llm;
  /** What a unit asks the kernel for when it looks: its own looks, if it asked, or an observation. */
  const perceiveCommand = (u: Unit): { cmd: object; looks?: LookRequest[] } => {
    const only = u.capacity ? { only: u.capacity } : {};
    const looks = u.looks;
    u.looks = undefined;
    const prefixed = looks && u.capacity && u.capacity !== "self" ? looks.map((l) => ({ ...l, channel: `${u.capacity}/${l.channel}` })) : looks;
    return prefixed ? { cmd: { command: "look", participant: u.participant, ...only, looks: prefixed }, looks } : { cmd: { command: "observe", participant: u.participant, ...only } };
  };
  /** A unit looks (its own looks first, if it asked), and gets its picture of the world: null if it no longer can.
   * `asked`: its request already sent, with the kernel's reply (a round's are sent together). */
  const perceive = async (u: Unit, asked?: { reply: any | null; looks?: LookRequest[] }): Promise<Observation | null> => {
    const only = u.capacity ? { only: u.capacity } : {};
    let looks: LookRequest[] | undefined;
    let reply: any | null;
    if (asked) ({ reply, looks } = asked);
    else {
      const c = perceiveCommand(u);
      looks = c.looks;
      reply = await command(c.cmd);
      if (!looks && reply === null) return null;
      if (!looks) asked = { reply };
    }
    if (looks && reply === null) {
      // A look the kernel won't take (an unknown channel, a bad query): recorded, and it observes as usual.
      await k.request({ op: "annotate", annotation: { annotation: "note", subject: u.participant, data: { look_rejected: JSON.stringify(looks).slice(0, 4000) } } });
      u.notices.push({ t, text: "That couldn't be looked up." });
    }
    if (looks && reply === null) reply = await command({ command: "observe", participant: u.participant, ...only });
    if (reply === null) return null; // it can no longer look (its capacity went away)
    const p00 = performance.now();
    const raw: Observation = u.capacity ? slice(reply.observation, u.capacity, u.entity) : { ...reply.observation, entity: u.entity };
    // Knowledge takes in the changes themselves; the controller reads the view's full picture.
    // (What a seat knows is the engine's now (the resolver's source); a language-model seat's is kept here too, for its
    // drafts' previews and law warnings.)
    if (u.llm || RESOLVER_MODE !== "engine") u.knowledge.absorb(raw);
    const obs: Observation = { ...u.view.apply(raw), woke_for: u.wokeFor, since: u.since };
    // (A seat's roster of its own staff, and what a draft's preview may say of it: read from what it is shown.)
    u.llm?.tally?.absorb(obs);
    u.llm?.dayBook?.absorb(obs);
    if (u.llm?.roster) {
      const roster = u.llm.roster;
      roster.absorb(obs);
      u.knowledge.ownStaff = { role: roster.now(obs.t).role, inPost: roster.count(obs.t) };
    }
    platformMs += performance.now() - p00;
    if (o.inspect) await o.inspect(u.participant, obs, k, u.capacity, raw);
    // Recorded in full, if asked: what it received (what's new since its last observation), for training data.
    const rec = o.recordObservations ?? "models";
    if (rec !== "none" && (rec === "all" || (rec === "models" && u.llm) || (rec === "code" && !u.llm) || (Array.isArray(rec) && rec.includes(u.participant))))
      // (Its channels as a list, each with its path: a position's channel paths have a "/", which the log's free-form
      // data doesn't allow in a key.)
      await k.request({ op: "annotate", annotation: { annotation: "observation", subject: u.participant, data: { t, ...(u.capacity && u.capacity !== "self" ? { as: u.capacity } : {}),
        observation: { ...raw, channels: Object.entries(raw.channels).map(([path, c]) => ({ path, ...c })) } } } });
    if (u.notices.length) obs.notices = u.notices.splice(0);
    if (u.llm) obs.drafts = u.llm.drafts.map((d) => d.draft);
    return obs;
  };

  /** Carry out what a unit decided: true if its wake goes on (it acted, and may act again), false if it's done. */
  const apply = async (u: Unit, action: ParticipantAction): Promise<boolean> => {
    const L = u.llm;
    if (action.type === "wait") {
      if (o.audit && u.controller.beliefs) {
        // Stale is still wrong after a wake to see the change: a divergence is recorded when it's found again at the
        // unit's next audit (one arising from another's act in the same moment is not), with when it was first found.
        const was = u.diverged ?? new Map<string, number>();
        u.diverged = new Map();
        for (const d of await divergences(k, u.controller.beliefs())) {
          const key = JSON.stringify(d.belief.of === "held" ? [d.belief.party, d.belief.template] : d.belief);
          const since = was.get(key);
          u.diverged.set(key, since ?? t);
          if (since !== undefined) await k.request({ op: "annotate", annotation: { annotation: "audit", subject: u.participant, data: { t, unit: u.key, ...d, since } } });
        }
      }
      u.waitUntil = action.until;
      return false;
    }
    if (action.type === "look") {
      u.looks = action.looks; // perceived with the next observation, which follows at once
      return true;
    }
    if (action.type === "opt_out") {
      // Leaving the study (D38): a platform exit, recorded; what follows is the world's config.
      await command({ command: "opt_out", participant: u.participant, statement: action.statement });
      const p = parts.get(u.participant)!;
      const after = p.on_opt_out;
      const standIn = after && typeof after === "object" ? mods[after.code] : undefined;
      if (after && typeof after === "object" && !standIn) throw new Error(`participant ${u.participant}: no behaviour module "${after.code}" to stand in after opting out`);
      const gone = unitsOf(u.participant).map((x) => x.key);
      for (const key of gone) units.delete(key);
      await k.request({ op: "units_remove", keys: gone });
      if (standIn) {
        // The stand-in carries the participant on, in the same capacities.
        p.controller = { type: "code", impl: after.code, params: after.params ?? {} };
        await syncUnits(u.participant, t);
        await k.request({ op: "to_cadence", participant: u.participant });
      } else p.ended = true;
      return false;
    }
    // The capacity: a code unit's own; a language-model participant says which position it acts in, if any.
    const as = asOf(u, action);
    const asField = as ? { as } : {};
    if (action.type === "act" || action.type === "message") {
      const blocks = action.type === "act" ? action.blocks : [{ block: "message", to: action.to, text: action.text, ...(action.re ? { re: action.re } : {}) }];
      const r = await begin(u, { command: "act", participant: u.participant, ...asField, blocks, ...(action.type === "act" && action.by?.length ? { by: action.by } : {}), provenance: { via: "direct" }, ...(action.type === "act" && action.reasoning && keepReasoning(u) ? { reasoning: action.reasoning } : {}) });
      if (r === null) {
        // Off-contract: never logged by the kernel, so record the attempt ourselves; and a seat is told (never silence).
        const words = action.type === "message" ? `Your letter to ${action.to.join(", ")} (${JSON.stringify(action.text.length > 60 ? `${action.text.slice(0, 60)}…` : action.text)}) was not sent: it could not be delivered as it was written. Nothing went. You could write it again, to each by their id.`
          : "What you did could not be carried out as it was written, and nothing was done.";
        await notSent(u, action.type === "message" ? "letter" : "act", words, { rejected_action: JSON.stringify(action).slice(0, 4000) });
      }
      return true;
    }
    if (action.type === "call") {
      // A structured intent: the resolver turns it into the participant's own acts (D36).
      const p1 = performance.now();
      let program: calls.Program;
      // A code participant's program as it was written (the same as reading its text back: `verifyCalls` checks).
      const w = (action as any)[calls.PARSED] as calls.Program | undefined;
      const written = w && "lines" in w && w.lines.length ? w : undefined; // (an empty one is read, and refused, as before)
      try {
        program = written ?? calls.parseProgram(action.call);
        if (written && (o.verifyCalls ?? process.env.NODE_ENV === "test") && !Bun.deepEquals(calls.parseProgram(action.call), written, true)) throw new Error(`a call's text reads back differently from the program it was written from: ${action.call.slice(0, 400)}`);
      } catch (e) {
        if (written) throw e;
        await k.request({ op: "annotate", annotation: { annotation: "note", subject: u.participant, data: { call_unreadable: action.call.slice(0, 4000), error: String((e as Error).message).slice(0, 500) } } });
        u.notices.push({ t, text: "That request couldn't be read. Could you say it more plainly?" });
        return true;
      }
      // The resolver: the engine's (kernel/crates/resolver), from what the engine delivered to this seat; or, in
      // shadow mode (OIKOS_RESOLVER=shadow, while the engine's is checked against it), both, compared.
      const resolverMode = RESOLVER_MODE;
      let res: ReturnType<typeof resolve> | undefined = resolverMode === "engine" ? undefined : resolve(program, u.knowledge, typeOf, as);
      if (resolverMode !== "ts") {
        const e = await k.request({ op: "resolve", participant: u.participant, ...(u.capacity ? { only: u.capacity } : {}), ...(as ? { as } : {}), program: calls.programText(program) });
        const byEngine = (e.blocks ? { ok: true, blocks: e.blocks } : { ok: false, questions: e.questions, ...(e.invalid ? { invalid: e.invalid } : {}) }) as ReturnType<typeof resolve>;
        if (res === undefined) res = byEngine;
        else {
          resolverChecked++;
          if (canonical(res) !== canonical(byEngine)) {
            resolverDiffs.push({ t, unit: u.key, call: calls.programText(program).slice(0, 1000), ts: canonical(res).slice(0, 2000), engine: canonical(byEngine).slice(0, 2000) });
            if (resolverDiffs.length > 200) resolverDiffs.shift();
            resolverDiffCount++;
            if (process.env.NODE_ENV === "test") throw new Error(`the engine's resolver differs on ${calls.programText(program).slice(0, 300)}:\n  here:   ${canonical(res).slice(0, 600)}\n  engine: ${canonical(byEngine).slice(0, 600)}`);
          }
        }
      }
      platformMs += performance.now() - p1;
      if (!res) throw new Error("no resolver ran");
      if (!res.ok) {
        await k.request({ op: "annotate", annotation: { annotation: "note", subject: u.participant, data: { call_unresolved: calls.programText(program), questions: res.questions, ...(res.invalid ? { invalid: res.invalid } : {}) } } });
        for (const q of res.questions) u.notices.push({ t, text: q });
        return true;
      }
      const r = await begin(u, { command: "act", participant: u.participant, ...asField, blocks: res.blocks, provenance: { via: "call", call: written ? action.call : calls.programText(program), resolver: RESOLVER }, ...(action.reasoning && keepReasoning(u) ? { reasoning: action.reasoning } : {}) });
      if (r === null) await notSent(u, "act", "What you did could not be carried out as it was written, and nothing was done.", { rejected_action: JSON.stringify(res.blocks).slice(0, 4000), call: calls.programText(program) });
      return true;
    }
    if (!L && action.type === "propose" && (action as any)[WORDS]) {
      await wordsFor(u, action, (action as any)[WORDS] as Words, as);
      return true;
    }
    if (!L) {
      // A code participant asked for the translator: only language-model participants use it.
      await k.request({ op: "annotate", annotation: { annotation: "note", subject: u.participant, data: { unsupported_action: action.type } } });
      return false;
    }
    if (action.type === "propose") {
      // (Translated already, with the round's others, or now.)
      let pre = translated.get(u.key) ?? (await translateFor(u, action, as));
      translated.delete(u.key);
      // (A draft the log will not take is drawn up once more: `again`.)
      let again = false;
      // eslint-disable-next-line no-constant-condition
      while (true) {
      const { draftId, tr } = pre;
      // (Emptied as they're written, so that a run stopping later doesn't write them again.)
      for (const annotation of pre.notes.splice(0)) await k.request({ op: "annotate", annotation });
      // Earlier attempts the translator retried (its own, not the participant's): kept on record.
      for (const [i, x] of (tr.retries ?? []).entries())
        await k.request({ op: "annotate", annotation: { annotation: "note", subject: u.participant, data: { translation_retry: { draft: draftId, attempt: i + 1, reason: x.reason, ...(x.call ? { call: x.call } : {}) } } } });
      // With two translators as one: who drafted this request, why it went behind, and what each answered. For the
      // record only: nothing of it is ever said to a seat.
      if (tr.route) await k.request({ op: "annotate", annotation: { annotation: "note", subject: u.participant, data: { translation_route: { draft: draftId, ...tr.route } } } });
      if (!tr.ok) {
        await k.request({ op: "annotate", annotation: { annotation: "translation_failure", subject: u.participant, data: { draft: draftId, proposal: action.text, reason: tr.notices.join(" "), ...(tr.asked_back ? { asked_back: true } : {}), ...(tr.call ? { call: tr.call } : {}), ...(tr.invalid ? { invalid: tr.invalid } : {}), ...(tr.raw !== undefined ? { raw: JSON.stringify(tr.raw) } : {}) } } });
        for (const text of tr.notices) u.notices.push({ t, text: aboutRequest(action.text, text), re: draftId });
        return true;
      }
      // A draft the log won't take (something in it breaks the contract: a kind that isn't a label, an id that isn't
      // one) is a failed translation, told to the participant as one, and never the end of the run. Pilot 9 stopped on
      // day 63 on such a draft (2026-10-06): what a model wrote reached the log unchecked, and the refusal was fatal.
      // (Since 2026-10-09 what did this in the wave is asked about by the resolver, with its cause: a draft's name or a
      // made-up id where an id goes, a paper put up on what is no place, an agreement with nothing on either side.
      // What still gets here is the platform's own fault: it is on record as one, with the engine's words for the
      // log, the request is drawn up once more, and the seat is told that nothing was done and to ask again.)
      const [drafted] = await k.tryRequestMany([{ op: "annotate", annotation: { annotation: "draft", draft: tr.draft } }]);
      if (drafted === null) {
        const why = k.lastError.slice(0, 500);
        await k.request({ op: "annotate", annotation: { annotation: "translation_failure", subject: u.participant, data: { draft: draftId, proposal: action.text, reason: NOT_CHECKED, call: tr.draft.call, invalid: [`platform fault: the draft breaks the contract and couldn't be recorded: ${why}`], platform_fault: true, ...(again ? {} : { drawn_up_again: true }) } } });
        if (!again) {
          again = true;
          pre = await translateFor(u, action, as);
          continue;
        }
        u.notices.push({ t, text: aboutRequest(action.text, NOT_CHECKED), re: draftId });
        return true;
      }
      break;
      }
      const draftId = pre.draftId, tr = pre.tr as Extract<typeof pre.tr, { ok: true }>;
      const pending = { draft: tr.draft, hash: tr.hash, ...(action.reasoning ? { reasoning: action.reasoning } : {}) };
      const onlyWords = tr.draft.blocks.every((b) => b.block === "message");
      if (confirm === "never" || (confirm === "consequential" && onlyWords)) await submit(u, pending, "accept", `confirmation: ${confirm}`);
      else L.drafts.push(pending);
      return true;
    }
    if (action.type === "sign") {
      const i = L.drafts.findIndex((d) => d.draft.id === action.draft);
      if (i < 0) {
        u.notices.push({ t, text: `There's nothing waiting for you to confirm called ${action.draft}.` });
        return true;
      }
      const [pending] = L.drafts.splice(i, 1);
      await submit(u, pending!, action.decision, action.note);
      return true;
    }
    return true;
  };

  /** What a seat is told of a request of its own that came to nothing: which request, in its own words, that nothing
   * was filed or done, and then what is asked of it. Never a bare remark that could be read as about something else. */
  const aboutRequest = (asked: string, text: string) => `About what you asked for (${JSON.stringify(asked.length > 120 ? `${asked.slice(0, 120)}…` : asked)}): nothing was filed or done. ${text}`;

  /** The capacity an action is done in: the unit's own, or the one it names, or its only one. */
  const asOf = (u: Unit, action: ParticipantAction): string | undefined => (u.capacity && u.capacity !== "self" ? u.capacity : ("as" in action && action.as) || capacityOf(u));

  let unanswered = 0; // model calls failed in a row, with none answered between (any seat's, or the translator's)

  /** A request's translation: its draft id, what came of it, and what the model calls recorded on the way. */
  type Translated = { draftId: string; tr: Awaited<ReturnType<typeof translator.translate>>; notes: object[] };
  const translated = new Map<string, Translated>();
  // What translations recorded (usage, transcripts) that never reached the log because the run stopped first: one that
  // stopped it part-way, and those made beside it. Written as the run stops: every answer a model gave is kept.
  const unwritten: { key: string; notes: object[] }[] = [];
  async function translateFor(u: Unit, action: { text: string }, as: string | undefined): Promise<Translated> {
    const draftId = `draft.${u.participant}.${++u.llm!.drafted}`;
    const notes: object[] = [];
    unwritten.push({ key: u.key, notes });
    const tr = await translating.run(notes, async () => {
      try {
        return await translator.translate({ draftId, participant: u.participant, as, proposal: action.text, knowledge: u.knowledge, called: (id) => whoIs(id)?.name });
      } catch (e) {
        if (!(e instanceof ModelCallFailed)) throw e;
        if (++unanswered >= MAX_FAILURES_IN_A_ROW) throw new ModelUnreachable(`the model can't be reached (${unanswered} calls in a row failed; the last, the translator's: ${String(e.message).slice(0, 300)}): the run stops here; resume it once it can be (oikos resume <log>)`);
        // The translator's model failed after its retries (D59): the participant is told it couldn't be drafted now.
        return { ok: false as const, notices: ["That couldn't be drafted just now. You could try again."], raw: { model_call_failed: e.message } };
      }
    });
    return { draftId, tr, notes };
  }

  /**
   * Words a code participant sends through the translator (docs/behaviour/founding.md, "Words"): what a composing
   * model wrote for it, put as a plain request, as a seat's is. Nobody reads a code participant's draft, so its module
   * says what the draft may be (`accept`): the acts go ahead only as that returns them, and anything else is not done.
   * All of it is on record as a seat's request is (the calls, the draft, a signoff, a failure), with one note of what
   * came of it. Where a trained translator answers first and its draft is not what was meant, the request is put
   * once more, which sends it to the one behind.
   */
  const worded = new Map<string, number>();
  async function wordsFor(u: Unit, action: { text: string }, words: Words, as: string | undefined): Promise<void> {
    let result: "done" | "not_done" = "not_done", why = "", by: string | undefined, draft: string | undefined, adjusted = false;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const n = (worded.get(u.participant) ?? 0) + 1;
      worded.set(u.participant, n);
      const draftId = `draft.${u.participant}.w${n}`;
      draft = draftId;
      const notes: object[] = [];
      const tr = await translating.run(notes, async () => {
        try {
          return await translator.translate({ draftId, participant: u.participant, as, proposal: action.text, knowledge: u.knowledge, called: (id) => whoIs(id)?.name, ...(u.capacity ? { only: u.capacity } : {}) });
        } catch (e) {
          if (!(e instanceof ModelCallFailed)) throw e;
          return { ok: false as const, notices: ["The translator did not answer."], raw: { model_call_failed: e.message } } as Awaited<ReturnType<typeof translator.translate>>;
        }
      });
      for (const annotation of notes.splice(0)) await k.request({ op: "annotate", annotation });
      for (const [i, x] of (tr.retries ?? []).entries())
        await k.request({ op: "annotate", annotation: { annotation: "note", subject: u.participant, data: { translation_retry: { draft: draftId, attempt: i + 1, reason: x.reason, ...(x.call ? { call: x.call } : {}) } } } });
      if (tr.route) await k.request({ op: "annotate", annotation: { annotation: "note", subject: u.participant, data: { translation_route: { draft: draftId, ...tr.route } } } });
      by = tr.route?.used;
      if (!tr.ok) {
        why = tr.notices.join(" ").slice(0, 500);
        await k.request({ op: "annotate", annotation: { annotation: "translation_failure", subject: u.participant, data: { draft: draftId, proposal: action.text, reason: tr.notices.join(" "), ...(tr.asked_back ? { asked_back: true } : {}), ...(tr.call ? { call: tr.call } : {}), ...(tr.invalid ? { invalid: tr.invalid } : {}) } } });
        break;
      }
      const [drafted] = await k.tryRequestMany([{ op: "annotate", annotation: { annotation: "draft", draft: tr.draft } }]);
      if (drafted === null) { why = `the draft could not be recorded: ${k.lastError.slice(0, 300)}`; break; }
      const accepted = tr.draft.check.ok ? words.accept(tr.draft.blocks) : `the acts would be refused (${tr.draft.check.refusal?.code ?? "refused"})`;
      const decision = typeof accepted === "string" ? "reject" as const : "accept" as const;
      await k.request({ op: "annotate", annotation: { annotation: "signoff", participant: u.participant, draft: draftId, draft_hash: tr.hash, decision, note: typeof accepted === "string" ? `not what was meant: ${accepted}`.slice(0, 500) : "what its module said the draft may be" } });
      arranged?.signed(draftId, decision);
      if (typeof accepted === "string") {
        why = accepted;
        if (attempt === 1 && tr.route?.used === "first" && tr.route.arrangement === "then") continue;
        break;
      }
      adjusted = canonical(accepted) !== canonical(tr.draft.blocks);
      const r = await begin(u, { command: "act", participant: u.participant, ...(as ? { as } : {}), blocks: accepted,
        provenance: { via: "translator", proposal: tr.draft.proposal, draft: draftId, draft_hash: tr.hash, translator: tr.draft.translator, call: tr.draft.call, resolver: tr.draft.resolver } });
      if (r === null) why = `the acts could not be carried out: ${k.lastError.slice(0, 300)}`;
      else { result = "done"; why = ""; }
      break;
    }
    await k.request({ op: "annotate", annotation: { annotation: "note", subject: u.participant, data: { words: { what: words.what, ...(words.idea ? { idea: words.idea } : {}), ...(draft ? { draft } : {}), result, ...(why ? { why } : {}), ...(by ? { by } : {}), ...(adjusted ? { plumbing_added: true } : {}) } } } });
    words.done(result === "done", why || undefined);
  }

  // Deciding takes world time if the world says so (docs/design/rebuild.md 6.4): a model by its tokens, code a fixed time.
  const thinkingCosts = cfg.orchestration.thinking_time === "costs_world_time";
  const rates = cfg.orchestration.thinking ?? {};
  let stopped: string | undefined; // why the run stopped early, if it did (a spending limit)
  let stoppedBy: string | undefined; // (the error's name)
  let lastPause = performance.now();
  try {
    for (;;) {
      // (With the engine in this process nothing here waits on anything outside it, so a signal would go unheard until
      // the run ended: a few times a second the run lets the process hear one. Only when it stops depends on this,
      // never what it does: asked to stop or not, each moment is the same.)
      if (o.stop && performance.now() - lastPause > 200) {
        await new Promise<void>((done) => setImmediate(done));
        lastPause = performance.now();
      }
      if (o.stop?.requested) throw new StopRequested(`the run was asked to stop (${o.stop.requested}): it stops here; resume it with oikos resume <log>`);
      // What's next is the engine's (kernel/src/schedule.rs): time moving on, or everyone waking at this moment, in key
      // order (D58 §4.8), each with why it woke and how long since its last wake (contracts 0.7).
      mark({ doing: "scheduling" });
      let due: any;
      try {
        due = await k.request({ op: "next", until });
      } catch (e) {
        if (e instanceof Error && /kept waking each other/.test(e.message)) throw new RunStuck(e.message);
        throw e;
      }
      if (due.end) break;
      if (due.advanced !== undefined) {
        t = due.advanced;
        await absorb(due); // (the advance's events: who's come or gone while time passed)
        continue;
      }
      t = due.t;
      const cohort: Unit[] = [];
      for (const c of due.cohort as { key: string; woke_for: NonNullable<Observation["woke_for"]>; since: number }[]) {
        const u = units.get(c.key);
        if (!u) continue;
        wakes++;
        wakesBy[c.woke_for] = (wakesBy[c.woke_for] ?? 0) + 1;
        u.wokeFor = c.woke_for;
        u.since = c.since;
        cohort.push(u);
      }
      // Rounds: everyone still awake looks (so all see the same state), all decide (model calls at once), then what
      // they decided is carried out in key order, never in the order decisions came back. Those whose wakes go on
      // look again in the next round, and see the round before.
      let rounds = 0;
      // (A round: those awake look, decide, and what they decided is carried out in key order. `nested`: a seat that sits as its code twin does has
      // its request drafted and confirmed inside its place in this round, so that its act begins where its twin's would, in the moment's one order.)
      const round = async (awake: { u: Unit; n: number }[], nested: boolean): Promise<{ u: Unit; n: number }[]> => {
        // Acting always moves time on, so rounds at one moment are only looking, drafting and asking: many means a loop.
        if (!nested) {
          roundFailures = 0;
          unwritten.length = 0;
        }
        if (++rounds > MAX_COHORTS_PER_MOMENT)
          throw new RunStuck(`participants went on without acting at t=${t} (${MAX_COHORTS_PER_MOMENT} rounds in one moment): ${awake[0]!.u.key} among them`);
        const looking: { u: Unit; n: number; obs: Observation }[] = [];
        // Everyone's looks are sent together: nothing acts in between, so it's the same as one by one, without waiting.
        const live = awake.filter((a) => units.get(a.u.key) === a.u);
        const asks = live.map((a) => perceiveCommand(a.u));
        const replies = await commands_(asks.map((x) => x.cmd));
        for (const [i, a] of live.entries()) {
          if (units.get(a.u.key) !== a.u) continue;
          const obs = await perceive(a.u, { reply: replies[i], looks: asks[i]!.looks });
          if (obs) looking.push({ ...a, obs });
        }
        const m0 = performance.now();
        holding = new Map();
        const decided = await Promise.allSettled(looking.map((x) => Promise.resolve().then(() => {
          mark({ doing: "deciding", participant: x.u.key });
          const s0 = performance.now();
          inCurrency(currency); // (said before each step: another world's run may share this process)
          const r = x.u.controller.step(x.obs, x.u.ctx);
          const pm = (profModules[x.u.module.name] ??= { ms: 0, steps: 0 });
          pm.ms += performance.now() - s0;
          pm.steps++;
          return r;
        })));
        moduleMs += performance.now() - m0;
        // Annotations made while deciding (usage, transcripts) go into the log in the cohort's order.
        const notes = holding;
        holding = null;
        const order = [...new Set([...looking.map((x) => x.u.participant), ...[...notes.keys()].sort()])];
        for (const who of order) for (const annotation of notes.get(who) ?? []) await k.request({ op: "annotate", annotation });
        // A spending limit stops the run. Any other failure to decide (a module that throws, a model call that failed
        // after its retries) is deterministic, so it's recovered in place (D59): recorded, and the participant waits.
        const limit = decided.find((r): r is PromiseRejectedResult => r.status === "rejected" && r.reason instanceof SpendingLimitReached);
        if (limit) throw limit.reason;
        // The round's requests are translated at once (they were all made looking at the same state, and a translation
        // changes nothing): with several model seats, each no longer waits for every translation before its own. They're
        // carried out below in the cohort's order, as before.
        const proposing = looking.flatMap((x, i) => {
          const r = decided[i]!;
          return x.u.llm && units.get(x.u.key) === x.u && r.status === "fulfilled" && (r.value as ParticipantAction)?.type === "propose" ? [{ u: x.u, action: r.value as ParticipantAction & { type: "propose" } }] : [];
        });
        if (proposing.length > 1) {
          mark({ doing: "translating" });
          const done = await Promise.allSettled(proposing.map((p) => translateFor(p.u, p.action, asOf(p.u, p.action))));
          const failed = done.find((r): r is PromiseRejectedResult => r.status === "rejected");
          if (failed) throw failed.reason;
          for (const [i, p] of proposing.entries()) translated.set(p.u.key, (done[i] as PromiseFulfilledResult<Translated>).value);
        }
        const next: { u: Unit; n: number }[] = [];
        for (const [i, x] of looking.entries()) {
          if (units.get(x.u.key) !== x.u) continue; // it ended this round (opted out, or its capacity went)
          const r = decided[i]!;
          if (r.status === "rejected") {
            participantErrors++;
            const err = r.reason as Error;
            // A model call that failed isn't the seat's failing: it waits this wake, and isn't retired for it. Call after
            // call failing, with none answered between, is the model out of reach: the run stops, to be resumed.
            const modelDown = err instanceof ModelCallFailed;
            if (modelDown && ++unanswered >= MAX_FAILURES_IN_A_ROW) {
              await k.request({ op: "annotate", annotation: { annotation: "note", subject: x.u.participant, data: { participant_error: { unit: x.u.key, error: `${err.name}: ${String(err.message)}`.slice(0, 2000) } } } });
              throw new ModelUnreachable(`the model can't be reached (${unanswered} calls in a row failed; the last: ${String(err.message).slice(0, 300)}): the run stops here; resume it once it can be (oikos resume <log>)`);
            }
            const inARow = modelDown ? failures.get(x.u.key) ?? 0 : (failures.get(x.u.key) ?? 0) + 1;
            failures.set(x.u.key, inARow);
            // (A seat whose model did not answer says when it sits again, its next working day's sitting: the engine is
            // told, or it would not be woken before its usual rhythm came round, days later.)
            const backAt = modelDown && typeof (err as ModelCallFailed).backAt === "number" ? (err as ModelCallFailed).backAt : undefined;
            await k.request({ op: "annotate", annotation: { annotation: "note", subject: x.u.participant, data: { participant_error: { unit: x.u.key, error: `${err?.name ?? "Error"}: ${String(err?.message ?? err)}`.slice(0, 2000), in_a_row: inARow, ...(backAt !== undefined ? { back_at: backAt } : {}) } } } });
            log(`${o.runId}: ${x.u.key} failed to decide at t=${t} (${backAt !== undefined ? `it missed this sitting, and sits again at t=${backAt}` : "it waits this wake"}): ${String(err?.message ?? err).slice(0, 200)}`);
            if (inARow >= MAX_FAILURES_IN_A_ROW) await retire(x.u);
            else if (backAt !== undefined && units.get(x.u.key) === x.u) await k.request({ op: "finished", key: x.u.key, until: backAt });
            continue;
          }
          failures.delete(x.u.key);
          if (x.u.llm) unanswered = 0;
          // A code citizen's decisions on the way to this action (docs/design/ai-citizens.md 7): training data, in full logs.
          const decisions = (r.value as any)?.[DECISIONS] as DecisionRecord[] | undefined;
          if (decisions?.length && (areas ? true : !lean && o.recordDecisions !== "none")) for (const d of decisions) if (!areas || areas.has(d.domain)) await k.request({ op: "annotate", annotation: { annotation: "decision", subject: x.u.participant, data: d } });
          // And what it came to know, since its last action, of how its choices turned out: one entry for them all
          // (wages every pay day for every worker are many, and small). Wherever decisions are recorded, and only there.
          const outcomes = (r.value as any)?.[OUTCOMES] as OutcomeRecord[] | undefined;
          if (outcomes?.length && !lean && !areas && o.recordDecisions !== "none") await k.request({ op: "annotate", annotation: { annotation: "outcome", subject: x.u.participant, data: { outcomes } } });
          // A code mind's change to its own record (docs/design/ai-citizens.md 10d): the kernel holds it and is its
          // only writer. It is state, so it is written in every run, whatever the log keeps.
          const change = recordChangeOf(x.u, r.value, positions);
          if (change) await command({ command: "entity_record", participant: x.u.participant, ...(change.entity ? { entity: change.entity } : {}), set: change.set, ...(change.because?.length ? { because: change.because } : {}) });
          if (thinkingCosts) {
            // Its thinking: a model's by the tokens it just used (logged, so a replay is exact), code's a fixed time.
            const used = (notes.get(x.u.participant) ?? []).filter((a: any) => a.annotation === "usage" && a.purpose === "participant") as any[];
            x.u.thinking = x.u.llm
              ? used.reduce((s, a) => s + (a.output_tokens ?? 0) * (rates.model_seconds_per_output_token ?? 0) + (a.input_tokens ?? 0) * (rates.model_seconds_per_input_token ?? 0), 0)
              : (rates.code_seconds ?? 0);
          }
          x.u.acted = false;
          x.u.waitUntil = undefined;
          const goesOn = await apply(x.u, r.value);
          if (units.get(x.u.key) !== x.u) continue;
          // It began an act: its wake goes on when the act is done. If it goes on otherwise (it looked, drafted), it does
          // so in the next round, at this moment. Either way, or waiting, the engine sets its next wake.
          if (goesOn && !x.u.acted) {
            if (x.u.hears && (r.value as ParticipantAction)?.type === "propose") next.push(...(await round([{ u: x.u, n: x.n + 1 }], true)));
            else next.push({ u: x.u, n: x.n + 1 });
          } else await k.request({ op: "finished", key: x.u.key, ...(x.u.waitUntil !== undefined ? { until: x.u.waitUntil } : {}) });
        }
        if (!nested) {
          roundFailures = 0;
          unwritten.length = 0;
        }
        return next;
      };
      let awake = cohort.map((u) => ({ u, n: 0 }));
      while (awake.length) awake = await round(awake, false);
    }
  } catch (e) {
    if (!(e instanceof SpendingLimitReached)) throw e;
    stopped = e.message;
    stoppedBy = e.name;
    // What the round's translations recorded and hadn't yet written (in key order, as a round's are): no answer a model
    // gave is dropped because the run stopped before its request was carried out.
    for (const x of [...unwritten].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))) for (const annotation of x.notes.splice(0)) await k.request({ op: "annotate", annotation });
    // (How many calls failed in the round it stopped in: a resume asks those again, rather than serve them as failures
    // and stop at the same place: resume.ts.)
    await k.request({ op: "annotate", annotation: { annotation: "note", subject: "orchestrator", data: { stopped: stopped, by: stoppedBy, ...(roundFailures ? { failed_calls_to_ask_again: roundFailures } : {}) } } });
    log(`${o.runId}: ${stopped}`);
  }
  if (!stopped && until > t) {
    await command({ command: "advance", to: until });
    t = until;
  }
  // What the composer was asked for, with the run (VISION 15, point 7: how many dark pieces a run asked a model to write).
  if (composer) await k.request({ op: "annotate", annotation: { annotation: "note", subject: "orchestrator", data: { composer_pieces: { ...composer.counts } } } });
  // What the reading desk did (docs/behaviour/reading.md): papers asked, read, cached, declined, over the limit, and the rest.
  if (desk) await k.request({ op: "annotate", annotation: { annotation: "note", subject: "orchestrator", data: { reading_counts: { ...desk.counts } } } });
  // The run's end for those in it (VISION 15, point 7; docs/behaviour/debrief.md): every model seat is debriefed by
  // the fixed interview, those who left the study included; then, where the composer is on, an author writes the
  // exit accounts of a sample of people. Both are paid from what the spending limit keeps back for them.
  // A run that stops to be resumed (a usage limit, the model out of reach, a request to stop) hasn't ended for those in
  // it: they aren't debriefed as if it had, and the model isn't asked while it can't answer. They're debriefed when the
  // resumed run ends. (At the spending limit the run is over unless someone raises it: they're debriefed, as designed.)
  // Every model seat is debriefed, whatever its world says. One thing is left for tests: a seat played by the mock
  // whose framing says `debrief: false` is not asked (a run that stands for one stopped part-way, compared with a
  // whole one: a debrief carries the run's own record, so one taken where a run stops is not the one taken at its end).
  if (io.adapter.provider === "mock") for (const [id, d] of [...debriefs]) if (d.part.framing?.debrief === false) debriefs.delete(id);
  const toBeResumed = stoppedBy !== undefined && stoppedBy !== "SpendingLimitReached";
  if (toBeResumed && debriefs.size) await k.request({ op: "annotate", annotation: { annotation: "note", subject: "orchestrator", data: { debriefs_deferred: "the run stopped to be resumed: its participants are debriefed when it ends" } } });
  // A draft a seat was shown and had not answered when the run ended (it had no sitting left): on record as
  // unanswered, so that nobody reading the log takes it for declined or for confirmed. (A run stopped to be resumed
  // keeps its drafts open: they are answered when it goes on.)
  if (!toBeResumed) for (const u of [...units.values()].sort((a, b) => (a.key < b.key ? -1 : 1))) for (const d of u.llm?.drafts ?? [])
    await k.request({ op: "annotate", annotation: { annotation: "note", subject: u.participant, data: { draft_unanswered: { draft: d.draft.id, why: "the run ended before the seat sat again" } } } });
  const debriefed: { [seat: string]: string } = {};
  const accountCounts: AccountCounts = { asked: 0, composed: 0, declined: 0, dark: 0, fell_back: 0, unread: 0, no_answer: 0, followed_up: 0 };
  const stopForLater = async (what: string, e: Error) => {
    // The model could not be asked just now (a provider's limit, or no answer after its retries): the run is not
    // over for those in it. It stops here to be resumed, and what was not yet asked is asked then: one lost this way
    // used to be skipped for good in a run marked done (2026-10-09). The call that failed is asked again by the
    // resumed run, not served to it as the same failure.
    stopped = `a debrief could not be asked (${what}: ${String(e.message).slice(0, 400)}): the run stops here, at its end, with debriefs still to give; resume it to ask them (oikos resume <log>)`;
    stoppedBy = e instanceof ModelCallFailed ? "ModelUnreachable" : e.name;
    await k.request({ op: "annotate", annotation: { annotation: "note", subject: "orchestrator", data: { stopped, by: stoppedBy, debriefs_deferred: "a debrief could not be asked: those not yet given are asked when the run is resumed", ...(roundFailures ? { failed_calls_to_ask_again: roundFailures } : {}) } } });
    log(`${o.runId}: ${stopped}`);
  };
  if (!toBeResumed && (debriefs.size || accountsN)) {
    // What the log shows, read once: the kernel writes all of it out first.
    await k.request({ op: "flush" });
    const idsOf = (pid: string, as?: string): string[] => {
      const p = parts.get(pid);
      const posts = held(pid);
      const post = as ? positions.get(as) : posts.length === 1 ? posts[0] : undefined;
      return [...new Set([...(post ? [post.id, post.entity] : []), ...(p?.person ? [p.person] : []), ...(p?.owner ? [p.owner] : []), pid])];
    };
    const seatList = [...debriefs.values()].map((d) => ({ id: d.part.id, known: idsOf(d.part.id), direct: [d.part.id, ...held(d.part.id).map((x) => x.id)] }));
    const atEnd = await readForEnd(logPath, seatList, idsOf, accountsN > 0);
    const day = Math.floor(t / DAY), of = Math.floor(runEnd / DAY);
    const how: DebriefInput["ended"]["how"] = stoppedBy === "SpendingLimitReached" ? "spending_limit" : stopped ? "stopped" : t >= runEnd ? "last_day" : "length_set";
    const wording: DebriefWording = o.debriefWording ?? "a";
    await k.request({ op: "annotate", annotation: { annotation: "note", subject: "orchestrator", data: { debriefs: { version: DEBRIEF_VERSION, wording, seats: seatList.map((x) => x.id) } } } });
    for (const d of debriefs.values()) {
      const r = atEnd.seats.of.get(d.part.id)!;
      const decisions = r.left ? [] : largest(r).map((c) => ({ day: Math.floor(c.t / DAY) + 1, fact: `"${c.preview.replace(/\s+/g, " ").trim().slice(0, 600)}"`, ids: besideOf(c) }));
      const after = d.part.on_opt_out && typeof d.part.on_opt_out === "object" ? "After you left, the routine work of your seat was carried on by code" : "After you left, your seat stood empty";
      const input: DebriefInput = { wording, town: String(cfg.meta?.name ?? o.runId), ended: { how, day, of }, others: { models: debriefs.size - 1, ...(composerCfg ? { composer: true } : {}) },
        ...(r.left ? { left: { day: Math.floor(r.left.t / DAY) + 1, statement: r.left.statement, after } } : {}), summary: renderSummary(r, currency), decisions, ...(leftAlone(r) ? { leftAlone: leftAlone(r)! } : {}) };
      try {
        debriefed[d.part.id] = (await d.controller.debrief(input)).ended;
      } catch (e) {
        if (!(e instanceof SpendingLimitReached) && !(e instanceof ModelCallFailed)) throw e;
        // Out of the run's own limit before its first question: not given, and that is recorded (the run is over unless someone raises it).
        if (e.name === "SpendingLimitReached") {
          debriefed[d.part.id] = "not_given";
          await k.request({ op: "annotate", annotation: { annotation: "note", subject: d.part.id, data: { debrief_skipped: e.message } } });
          continue;
        }
        await stopForLater(d.part.id, e);
        break;
      }
    }
    // Exit accounts (account.ts): a seeded sample of the town's people, each by one call of an author shown that
    // person's own record and nothing else. Only where the composer is on; with it off no model is asked anything.
    if (accountsN && composerCfg && !stopped || accountsN && composerCfg && stoppedBy === "SpendingLimitReached") {
      const people = [...atEnd.people.values()].map((p) => ({ person: p.entity, participant: p.participant, record: p.sections }));
      const agencies = people.map((p) => Number(p.record.agency?.now)).filter((x) => Number.isFinite(x));
      const mean = agencies.reduce((a, b) => a + b, 0) / Math.max(1, agencies.length);
      const sd = Math.sqrt(agencies.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, agencies.length)) || 1;
      const sample = sampleAccounts(people, accountsN, randomness.stream(["accounts", "sample"]));
      const seen = new Set<string>();
      for (const who of sample) {
        const p = people.find((x) => x.person === who.person)!;
        const c = p.record.circumstances ?? {};
        const brief: AccountBrief = { person: who.person, record: p.record, means: { income: formatMoney(Number(c.income ?? 0), currency), savings: formatMoney(Number(c.savings ?? 0), currency) }, days: day,
          names: Object.fromEntries([...entityNames, ...atEnd.founded].filter(([id, name]) => name && name !== id)), strata: who.strata, dark: darkAccount(p.record, Number.isFinite(Number(p.record.agency?.now)) ? (Number(p.record.agency.now) - mean) / sd : 0) };
        try {
          const piece = await writeAccount(io, composerCfg, composerAdapters!, (purpose) => randomness.stream(["accounts", purpose]), brief, p.participant, accountCounts, seen);
          await k.request({ op: "annotate", annotation: { annotation: "note", subject: p.participant, data: { account: { version: ACCOUNT_VERSION, played_by: o.composerAdapters ? "models" : "mock", person: who.person, strata: who.strata, dark: brief.dark, days: day, ...piece,
            views: ((p.record.views ?? []) as any[]).map((v) => ({ of: v.of, thought: v.private, said: v.expressed })), ...(p.record.agency ? { agency: p.record.agency.now } : {}), record_changes: atEnd.people.get(who.person)!.n } } } });
        } catch (e) {
          if (!(e instanceof SpendingLimitReached)) throw e;
          // The run's own limit: the accounts not yet written are not written, and that is recorded. A provider's
          // limit: the run stops here to be resumed, as for a debrief.
          if (e.name === "SpendingLimitReached") { await k.request({ op: "annotate", annotation: { annotation: "note", subject: "orchestrator", data: { accounts_cut_short: { written: accountCounts.asked - 1, of: sample.length, why: e.message } } } }); break; }
          await stopForLater(`the exit account of ${who.person}`, e);
          break;
        }
      }
      await k.request({ op: "annotate", annotation: { annotation: "note", subject: "orchestrator", data: { account_pieces: { ...accountCounts, sampled: sample.length, wanted: accountsN, version: ACCOUNT_VERSION } } } });
    }
  }
  // What the end spent beyond the limit, where what was kept back was not enough: the platform's overrun of the limit,
  // never the run having hit it (that is `stopped`), and never any seat's own spending.
  const overrun = o.budget?.platformOverrun;
  if (overrun?.microusd) await k.request({ op: "annotate", annotation: { annotation: "note", subject: "orchestrator", data: { platform_overrun_of_limit: { microusd: overrun.microusd, of_limit_microusd: o.budget!.limitMicroUsd, spent_microusd: o.budget!.spentMicroUsd, by_subject: overrun.by_subject, why: "the debriefs and exit accounts at the run's end cost more than was kept back for them, and are never cut off by the limit; this is the platform's overrun of the limit, not the pilot reaching it" } } } });
  // A resumed run says so at the end (not the start, so that up to where the old run stopped, the two logs are the same).
  if (o.resumedFrom) await k.request({ op: "annotate", annotation: { annotation: "note", subject: "orchestrator", data: { resumed_from: { log: o.resumedFrom.log, model_calls_served: o.resumedFrom.serving.served, ...(o.resumedFrom.serving.diverged ? { serving_stopped_at: o.resumedFrom.serving.diverged } : {}) } } } });
  const completed = !stopped && until === runEnd;
  const end = await k.request({ op: "finish", reason: completed ? "completed" : "aborted", ...(completed ? {} : { detail: stopped ?? `stopped at ${until}` }) });
  if (!o.kernel) await k.close();
  log(`${o.runId}: ${commands} commands, ${refused} refused, ${wakes} wakes, t=${t}${participantErrors ? `; ${participantErrors} failures to decide, recovered (see the log's participant_error notes)` : ""}`);
  if (resolverDiffCount) await Bun.write(join(o.outDir, `${o.runId}.resolver-diffs.json`), JSON.stringify(resolverDiffs, null, 1));
  return { ...(resolverChecked ? { resolverShadow: { checked: resolverChecked, differed: resolverDiffCount } } : {}), runId: o.runId,
    end: { reason: completed ? "completed" : "aborted", ...(completed ? {} : { detail: stopped ?? `stopped at ${until}` }) }, ...(stopped ? { stopped: { why: stopped, by: stoppedBy! } } : {}), logPath, anchorsPath, stateHash: end.state_hash, ...(composer ? { composer: { ...composer.counts } } : {}), ...(desk ? { reading: { ...desk.counts } } : {}), ...(Object.keys(debriefed).length ? { debriefs: debriefed } : {}), ...(accountsN ? { accounts: accountCounts } : {}), commands, refused, wakes, wakesBy, participantErrors, t, kernelMs: Math.round(kernelMs), moduleMs: Math.round(moduleMs), platformMs: Math.round(platformMs),
    health: { backlog: { ...backlog }, repeats: { ...repeats }, refused: { ...refusedBy } },
    profile: { modules: Object.fromEntries(Object.entries(profModules).map(([k, v]) => [k, { ms: Math.round(v.ms), steps: v.steps }])), kernel: Object.fromEntries(Object.entries(profKernel).map(([k, v]) => [k, { ms: Math.round(v.ms), n: v.n }])),
      requests: Object.fromEntries(Object.entries(k.profile).map(([op, v]) => [op, { n: v.n, encode: Math.round(v.encode), engine: Math.round(v.engine), decode: Math.round(v.decode) }])) },
    ...(o.budget ? { spentMicroUsd: o.budget.spentMicroUsd } : {}), ...(overrun?.microusd ? { platformOverrun: { microusd: overrun.microusd, by_subject: { ...overrun.by_subject } } } : {}) };
}

/** The units a run has, by key, and by participant. (When each wakes is the engine's: kernel/src/schedule.rs.) */
class Units extends Map<string, Unit> {
  /** A participant's units, in key order. */
  of(participant: string): Unit[] {
    return [...this.values()].filter((u) => u.participant === participant).sort((a, b) => (a.key < b.key ? -1 : 1));
  }
}

/** A copy of a JSON value with every object's keys in sorted order. */
function sortedKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortedKeys);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortedKeys((v as { [k: string]: unknown })[k])]));
  return v;
}

/**
 * The change to a record that an action carries, and whose record it is (`entity`, absent: the participant's own
 * person's), if it comes from the platform's bookkeeping for that entity (docs/design/ai-citizens.md 10d). A record is
 * written by the platform's bookkeeping for that entity, named in the world's config, and by nothing a model can reach:
 * - a code module acting as itself sets its own person's record;
 * - a code role module acting in a post sets the record of the post's organisation if and only if the world says that
 *   post keeps it (`keeps_record`) and the module is the one the post names; otherwise the change is dropped.
 * Whatever a model returns, and whatever the code behind a model seat returns (a mock's brain, a stand-in), sets nothing.
 * Three locks: (a) the participant API has no act for it, and a symbol cannot come out of a model's JSON; (b) only the
 * named keeper's own output is taken, here; (c) the kernel refuses the command for an entity with no keeper named in
 * the config, and for an organisation unless the participant now holds the keeping post.
 */
export function recordChangeOf(u: { llm?: unknown; capacity?: string; participant?: string; module?: { name: string } }, action: unknown, positions?: Map<string, Pos>): (RecordChange & { entity?: string }) | undefined {
  if (u.llm || !u.capacity || !action || typeof action !== "object") return undefined;
  const c = (action as any)[RECORD] as RecordChange | undefined;
  if (!c || !c.set || !Object.keys(c.set).length) return undefined;
  if (u.capacity === "self") return (c as { entity?: string }).entity === undefined ? c : { set: c.set, ...(c.because ? { because: c.because } : {}) };
  const post = positions?.get(u.capacity);
  if (!post?.keeps_record || !post.role_module?.code || post.role_module.code !== u.module?.name || post.holder !== u.participant) return undefined;
  return { ...c, entity: post.entity };
}
