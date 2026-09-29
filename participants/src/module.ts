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
  /** A deterministic stream for this participant, this moment and this purpose. */
  rng(purpose: string): Rng;
  world: WorldInfo;
  params: { [k: string]: any };
}

export interface Controller {
  /** Called repeatedly while the participant is awake; return {type: "wait"} to sleep. Code modules answer synchronously; model-backed participants return a promise. */
  step(obs: Observation, ctx: ParticipantContext): ParticipantAction | Promise<ParticipantAction>;
}

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

export const wait = (until?: number): ParticipantAction => (until === undefined ? { type: "wait" } : { type: "wait", until });
export const act = (blocks: Block[], reasoning?: string): ParticipantAction => (reasoning ? { type: "act", blocks, reasoning } : { type: "act", blocks });

export const DAY = 86_400;

/** A module's parameters: its documented defaults, overridden by the world's (controller.params). */
export function params<D extends object>(defaults: D, given: { [k: string]: any }): D & { [k: string]: any } {
  return { ...defaults, ...given };
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
