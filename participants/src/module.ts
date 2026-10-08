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
import type { Currency } from "./money";
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
  /** How the world's money is written (its config's first currency): what amounts in words are read and written in. */
  currency: Currency;
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
  /** A deterministic stream for a purpose alone: the same for whoever draws it. For what is a fact about a thing in the
   * world and not about who meets it (how long a silent house goes unremarked, whoever remarks on it). Absent where a
   * context is made by hand: a module then draws its own. */
  chance?(purpose: string): Rng;
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

/**
 * A whole collection a kind of participant holds, said where the kind is defined, with the reason in words
 * (docs/no-god-view.md). `what`: a statement kind ("enrolment"), a record type ("records:claim"), "directory", "map",
 * every entity of a kind ("every:factory"), or "future". Nobody is shown a whole register, population or map, or the
 * run's future, unless its module says so here; orchestrator/test/no-god-view.test.ts lists every one.
 */
export interface Kept {
  what: string;
  why: string;
}

/** A field of a form (contracts/outcomes.schema.json, FormData): what whoever fills it in is asked for. */
export interface FormField {
  /** amount, duration, date, count, text, choice (one of `options`), list (several ids), or what an id names (lot,
   * cell, space, structure_type, account, entity, structure, record). */
  type: string;
  required?: boolean;
  options?: string[];
  description: string;
}

/**
 * A written direction an office takes (docs/behaviour/directions.md): the form it publishes for it, and what following
 * one means. Whoever the office's organisation says may direct it files the direction on the form; the office reads
 * the direction that stands and follows it at its next plan, until it is replaced or withdrawn. Declared beside the
 * code that follows it, as `keeps` is beside the code that holds a register.
 */
export interface Taken {
  /** The form's name (a label), as the call language's `form` names it. */
  form: string;
  /** What the form is, in a few words ("Staffing direction to the works office"). */
  title: string;
  fields: { [name: string]: FormField };
  /** What following it means, in words: what the office does while it stands. */
  follows: string;
}

/**
 * A paper an office issues, as a form of its own stationery (docs/behaviour/office-papers.md): the form's fields, and
 * how they are written into the statement the rest of the world reads (`writes`: forms.ts). Where a model holds the
 * office, the world publishes the form for it, and filling it in makes the same paper the module itself makes. In
 * `writes`, a string "@name" stands for something of the office's own that the world fills in when it publishes the
 * form (`issuesWith`: its account, its premises, whom it sends every entry to); one that the office does not have
 * leaves its key, or its place in a list, out.
 */
export interface Issued {
  form: string;
  title: string;
  fields: { [name: string]: FormField };
  writes: { kind: string; text: string; data?: unknown; to?: unknown[]; visible?: "public" | unknown[]; basis?: string; offer?: unknown; assertion?: unknown };
}

/**
 * A routine task an office's staff do by standing work order (docs/behaviour/standing-work.md): the task's name as an
 * order names it, what doing it is, in words, and which of the module's parameters says where it is done. Where a
 * model holds the office, the staff are a post of their own that follows the office's standing orders; the office-
 * holder sets them.
 */
export interface Routine {
  task: string;
  what: string;
  /** The parameter that holds the place the work is done at (the depot, the clinic). */
  at: string;
}

export interface BehaviourModule {
  /** The routine tasks its office's staff do by standing work order (docs/behaviour/standing-work.md). */
  routines?: Routine[];
  /** The papers it issues, each as a form of the office's own stationery (docs/behaviour/office-papers.md). */
  issues?: Issued[];
  /** What of the office's own the forms it issues carry, from its parameters: the values of each "@name" in `issues`. */
  issuesWith?(params: { [k: string]: any }): { [name: string]: unknown };
  /** The written directions it takes, each on a form its office publishes (docs/behaviour/directions.md). An office
   * follows only what is filed on its form by someone its organisation says may direct it. */
  takes?: Taken[];
  /** Its own registers, held whole because this is the office that keeps them (the land registry its register, a bank
   * its customers' instructions): never a way to know what someone else keeps, which is asked for (`ask` in
   * behaviour/common.ts). */
  keeps?: Kept[];
  /** What it carries of the world's edge: a module that stands for the simulation's own boundary conditions (the
   * weather to come, the outside market's prices) is handed them, and says so here so that it is seen. */
  boundary?: Kept[];
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
export const DECISIONS = Symbol.for("oikos.decisions");
/** `state`: the mind's state behind it (contracts-0.7 A2): needs, satisfaction and certainty, and the strongest feeling,
 * beliefs held and goal pursued when there are any. What it had before it, where the mind decided: each option's `facts`
 * (a month's money in or out, a home and its bedrooms, hours, goods, company), how many `others` it knows took it, its
 * `meaning` to them and what they have `learned` of it (basis points; absent: not known); `current`: their routine;
 * `circumstances`; `satisfied_here` and `doubt` as the decision was given them; `person` (values, temperament, need
 * weights), with a citizen's first recorded decision only. Whole numbers throughout. */
export interface DecisionRecord {
  /** The citizen's own count of its recorded decisions, from 1: what an outcome names as the decision it follows (`of`). */
  n?: number;
  /** A decision that follows up an earlier one of the citizen's (its `n`): trying elsewhere for what a shop could not serve. */
  follows?: number;
  t: number; domain: string; strategy: string; choice?: string;
  options: { key: string; score: number; facts?: { money_per_month: number; home?: { bedrooms?: number }; work_hours_per_month?: number; goods_per_month?: number; company?: number; time_hours_per_month?: number }; others?: number; meaning?: number; learned?: number }[];
  current?: string;
  circumstances?: { monthly_income: number; savings: number; homeless: boolean; bedrooms_needed?: number; essentials?: number };
  satisfied_here?: number; doubt?: number;
  person?: { values: { [value: string]: number }; temperament: { [facet: string]: number }; weights: { [need: string]: number } };
  state?: { mind: string; needs: { [need: string]: number }; satisfaction: number; certainty: number; emotion?: { kind: string; about: string; bps: number }; beliefs?: { [assertion: string]: number }; goal?: { goal: string; method: string } };
}

/**
 * What a code participant came to know of how its choices turned out, since its last action (docs/design/ai-citizens.md
 * 7), carried with the action as decisions are. The orchestrator records them as one `outcome` annotation, for full
 * logs, wherever it records decisions.
 */
export const OUTCOMES = Symbol.for("oikos.outcomes");
/**
 * One thing a citizen learned of how something went, when and as it came to know it: never more than it knew. Facts,
 * and the mind's own figures; nothing here says whether it was good. Whole numbers throughout.
 * - `t`: when the citizen came to know it. `domain`, `option`: the area of life and what it is about, as decisions name
 *   them (the shop, the employer, the home, the gathering).
 * - `of`: the decision it follows from (that decision's `n`), the citizen's latest that chose this option. Absent: no
 *   recorded decision began it (held from the start; another's experience told to us; what was expected before trying).
 * - `kind`: what happened, in a word (served, paid, unpaid, hired, ended, attended, told ...).
 * - `way`: how the citizen came to know (docs/design/knowing.md): `mine` (its own money, papers and letters, and what
 *   its own acts came to), `here` (it was there), `published`, `ask`.
 * - `from`: who told it (`told`). `facts`: what happened, as the citizen has it.
 * - `learned`: the mind's update of what it has learned of the option (experience-weighted attraction, basis points):
 *   the payoff the mind computed, the attraction before (`first`: never tried nor heard of, so what was expected of
 *   it) and after; `heard`: another's payoff, weighed as such.
 * - `need`: the need the mind read the payoff from, where it did. `felt`: feelings the mind appraised from it (the
 *   strength of the cause, and the feeling's level before and after). `belief`: how strongly it holds what `host`
 *   teaches, before and after.
 */
export interface OutcomeRecord {
  t: number; domain: string; option: string; of?: number; kind: string; way: "mine" | "here" | "published" | "ask"; from?: string;
  facts?: { [fact: string]: number | string | boolean };
  learned?: { payoff: number; before: number; first?: true; after: number; heard?: true };
  need?: string;
  felt?: { emotion: string; about: string; bps: number; before: number; after: number }[];
  belief?: { host: string; before: number; after: number };
}

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
