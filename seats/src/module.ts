// The behaviour-module interface: how code seats plug in (D30).
//
// A module is world CONTENT: a swappable, documented, cited rule set (see
// docs/behaviour/). It sees exactly what any other seat sees (an Observation)
// and answers with exactly what any other seat answers (a SeatAction), so an
// LLM or a human can take over any code seat without special cases (VISION
// principle 4).
//
// Determinism rules for modules (so re-runs are reproducible):
//   - randomness only from ctx.rng(...) (the kernel's keyed streams);
//   - no clocks, no Math.random, no I/O;
//   - memory is allowed (people remember), but must depend only on what the
//     seat has observed and drawn.

import type { Block, Observation, SeatAction } from "./contracts";
import type { Rng } from "./rng";

export interface WorldInfo {
  tickSeconds: number;
  runEnd: number;
  /** The world config as loaded (catalogue, parcels, ...): public facts of the world. */
  config: any;
}

export interface SeatContext {
  seat: string;
  entity: string;
  /** A deterministic stream for this seat, this moment and this purpose. */
  rng(purpose: string): Rng;
  world: WorldInfo;
  params: { [k: string]: any };
}

export interface Controller {
  /** Called repeatedly while the seat is awake; return {type: "wait"} to sleep. Code modules answer synchronously; model-backed seats return a promise. */
  step(obs: Observation, ctx: SeatContext): SeatAction | Promise<SeatAction>;
}

export interface BehaviourModule {
  /** The name worlds use in controller.impl, e.g. "bank.payment_system". */
  name: string;
  /** Bump whenever the rules change; recorded in every run's log. */
  version: string;
  /** Where the module's rules are documented, with their sources. */
  doc: string;
  /** How long the seat sleeps when it waits without saying until when (seconds). */
  cadence(ctx: SeatContext): number;
  /** When the seat first wakes (seconds from the start). */
  firstWake?(ctx: SeatContext): number;
  create(ctx: SeatContext): Controller;
}

export const wait = (until?: number): SeatAction => (until === undefined ? { type: "wait" } : { type: "wait", until });
export const act = (blocks: Block[], reasoning?: string): SeatAction => (reasoning ? { type: "act", blocks, reasoning } : { type: "act", blocks });

export const DAY = 86_400;

/** A module's parameters: its documented defaults, overridden by the world's (controller.params). */
export function params<D extends object>(defaults: D, given: { [k: string]: any }): D & { [k: string]: any } {
  return { ...defaults, ...given };
}
