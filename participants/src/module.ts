// The behaviour-module interface: how code participants plug in (D30).
//
// A module is world CONTENT: a swappable, documented, cited rule set (see
// docs/behaviour/). It sees exactly what any other participant sees (an
// Observation) and answers with exactly what any other participant answers (a
// ParticipantAction), so an LLM or a human can take over any code participant
// without special cases (VISION
// principle 4).
//
// Determinism rules for modules (so re-runs are reproducible):
//   - randomness only from ctx.rng(...) (the kernel's keyed streams);
//   - no clocks, no Math.random, no I/O;
//   - memory is allowed (people remember), but must depend only on what the
//     participant has observed and drawn.

import type { Block, Observation, ParticipantAction } from "./contracts";
import type { Rng } from "./rng";

/** A question for the sparse mind: a thing, in words, its options, and the person asking (docs/design/ai-citizens.md 4). */
export interface ConsultQuestion {
  /** What it's about, in words: the thing itself, not a persona. */
  thing: string;
  /** A stable name for the kind of thing (remembered answers are kept by it and by the kind of person). */
  about: string;
  options: { key: string; words: string }[];
  /** The person: their values (basis points, the world's scale), how met their needs are, their means. */
  person: { values: { [value: string]: number }; needs: { [need: string]: number }; monthly_income: number; savings: number; household: number };
}
/** How much each option would matter (basis points): the average of the judgements and their spread; and whether a model
 * was asked this time (false: remembered, for this kind of person and thing). */
export interface ConsultAnswer { scores: { [key: string]: { mean: number; sd: number } }; asked: boolean; kind: string }
export type Consult = (q: ConsultQuestion, subject: string) => Promise<ConsultAnswer | undefined>;

/**
 * What a module may know about the run itself: the clock's grain and when the run ends. Nothing about the world:
 * a module knows the world only through what it perceives and its own parameters, like any participant (P14).
 */
export interface WorldInfo {
  tickSeconds: number;
  runEnd: number;
}

/**
 * What a module knows about where it's running: which participant, acting for which entity, in which position (absent:
 * as itself). For a role module (a job's procedures), `params` are the position's role parameters with the
 * participant's own traits on top: the same job, done by different people, differently.
 */
export interface ParticipantContext {
  participant: string;
  entity: string;
  position?: string;
  /** The sparse mind (docs/design/ai-citizens.md 4): asking a model how much each option would matter to someone like
   * this. Present only when the run turns it on; a module decides without it otherwise. */
  consult?: Consult;
  /** A deterministic stream for this participant, this moment and this purpose. */
  rng(purpose: string): Rng;
  world: WorldInfo;
  params: { [k: string]: any };
}

export interface Controller {
  /** Called repeatedly while the participant is awake; return {type: "wait"} to sleep. Code modules answer synchronously; model-backed participants return a promise. */
  step(obs: Observation, ctx: ParticipantContext): ParticipantAction | Promise<ParticipantAction>;
  /** What it believes about the world when a wake is done, typed, for truth audits (docs/design/rebuild.md 8.2): test
   * and calibration runs check each against the terms' readings. Never used to decide anything. */
  beliefs?(): Belief[];
}

/**
 * A belief a module holds about the world, in a form the platform can check (docs/design/rebuild.md 8.2):
 * - `agreement`: this agreement is (or isn't) in force;
 * - `between`: an agreement of this kind is (or isn't) in force between these two parties;
 * - `held`: these are all the agreements of this kind in force with this party.
 */
export type Belief =
  | { of: "agreement"; agreement: string; in_force: boolean }
  | { of: "between"; template: string; parties: [string, string]; in_force: boolean }
  | { of: "held"; party: string; template: string; agreements: string[] };

export interface BehaviourModule {
  /** The name worlds use in controller.impl, e.g. "bank.payment_system". */
  name: string;
  /** Bump whenever the rules change; recorded in every run's log. */
  version: string;
  /** Where the module's rules are documented, with their sources. */
  doc: string;
  /** How long it sleeps when it waits without saying until when (seconds). */
  cadence(ctx: ParticipantContext): number;
  /** When it first wakes (seconds from the start). */
  firstWake?(ctx: ParticipantContext): number;
  create(ctx: ParticipantContext): Controller;
}

/**
 * Decisions a code participant made on the way to an action (docs/design/ai-citizens.md 7), carried with the action in
 * process (a symbol: never part of the action, never serialised). The orchestrator records them as `decision`
 * annotations, for full logs.
 */
export const DECISIONS = Symbol.for("terrarium.decisions");
export interface DecisionRecord { t: number; domain: string; strategy: string; choice?: string; options: { key: string; score: number }[] }

export const wait = (until?: number): ParticipantAction => (until === undefined ? { type: "wait" } : { type: "wait", until });
export const act = (blocks: Block[], reasoning?: string): ParticipantAction => (reasoning ? { type: "act", blocks, reasoning } : { type: "act", blocks });

export const DAY = 86_400;

/** A module's parameters: its documented defaults, overridden by the world's (controller.params). */
export function params<D extends object>(defaults: D, given: { [k: string]: any }): D & { [k: string]: any } {
  paramsSeen?.(defaults);
  return { ...defaults, ...given };
}

/** Tooling only (the manifests: participants/manifests): see each module's parameter defaults as it's created. */
let paramsSeen: ((defaults: object) => void) | undefined;
export function onParams(f: ((defaults: object) => void) | undefined): void {
  paramsSeen = f;
}

/**
 * Parameters a world must give: who a module deals with (its supplier, the town, the account it pays from). A module's
 * defaults never name a world's entities (docs/profiles.md: the platform has no world built in), so a world that
 * doesn't say fails at once, saying what's missing, rather than dealing with someone who isn't there.
 */
export function need<P extends { [k: string]: any }>(p: P, keys: string[], module: string): P {
  const missing = keys.filter((k) => p[k] === undefined || p[k] === null || p[k] === "");
  if (missing.length) throw new Error(`${module}: the world must say ${missing.join(", ")} (whom it deals with; no module assumes a world's names)`);
  return p;
}
