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

import type { PaperRead, Standing } from "./behaviour/reading";
import type { Block, Observation, ParticipantAction } from "./contracts";
import type { WorldCalendar } from "./calendar";
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
 * What the composing model is shown for one piece (docs/design/ai-citizens.md 10e; docs/behaviour/founding.md): the
 * entity's own record as the kernel holds it, the want and what happened, the others who share it as the entity knows
 * them, the shape drawn and what it leaves open. Nothing of anyone else's record (docs/no-god-view.md). Whole numbers
 * and words of the world's own; the platform puts it into prose (participants/src/llm/compose.ts).
 */
export interface ComposeBrief {
  /** The idea's id: every statement of purpose has one (10h), whoever writes it. */
  idea: string;
  founder: string;
  /** The founder's own record's sections (contracts/entity-record.schema.json, PersonRecord), as last written. */
  record: { [section: string]: unknown };
  want: { about: string; whom?: string; /** It befell someone of their household, not themselves (they hold it with them). */ befell?: "household"; days: number; tried: number; way?: string; weight: number; how: "given_up" | "withdrew"; asked?: string; venues?: number; amount?: string };
  sharers: { who: string; how: string }[];
  shape: string;
  /** What the shape leaves open, as closed choices: dues a month (the world's money, in words and its smallest unit),
   * how often it gathers, how soon the first, how long; and where (the one place it can use). */
  open: { dues: { cents: number; words: string }[]; every_days: number[]; starts_in_days: number[]; lasts_minutes: number[]; place: string };
  /** Money, in the world's own writing: a month's income and what is saved. */
  means: { income: string; savings: string };
  /** Whether the piece asked for is a dark one, by the stated rule (docs/behaviour/founding.md), and why. */
  dark: string[];
  /** The plain statement code writes with no model: what stands if the piece is declined or cannot be had. */
  code: { purpose: string; name: string };
}
/** A piece as composed: the words, and the same choices as closed fields. `declined`: the model chose not to write it. */
export interface ComposePiece {
  declined: boolean;
  why?: string;
  purpose: string; name: string; asks: string; gathers: string;
  choice: { dues: number; every_days: number; starts_in_days: number; lasts_minutes: number };
  model: string;
}
/** The composer, where the world's dial has it on: undefined when no piece is to be had (the month's allowance is
 * spent, the answer could not be read, the model did not answer). */
export type Compose = (brief: ComposeBrief, subject: string) => Promise<ComposePiece | undefined>;

/**
 * Words a code participant sends through the translator (docs/behaviour/founding.md, "Words"): carried with a
 * `propose` action as a non-enumerable property under this symbol. Nobody reads a code participant's draft, so the
 * module says what the draft may be: `accept` is given the draft's blocks and returns the blocks to carry out (its own
 * plumbing added: nothing a model wrote), or why it is not done. `done` hears which. In process only, like DECISIONS.
 */
export const WORDS = Symbol.for("oikos.words");
export interface Words { what: string; idea?: string; accept(blocks: Block[]): Block[] | string; done(ok: boolean, why?: string): void }

/**
 * What a module may know about the run itself: the clock's grain and when the run ends. Nothing about the world:
 * a module knows the world only through what it perceives and its own parameters, like any participant (P14).
 */
export interface WorldInfo {
  tickSeconds: number;
  runEnd: number;
  /** How the world's money is written (its config's first currency): what amounts in words are read and written in. */
  currency: Currency;
  /** The world's calendar (its config's `calendar`): dates are written and read as the place does. Absent: "year N, day D". */
  calendar?: WorldCalendar;
  /** Dials of a living world (docs/design/ai-citizens.md 10j), as the world's config sets them. Absent: every dial is off. */
  dials?: { [name: string]: unknown };
  /** The world's table of slips (`orchestration.slip`: the rate at which a performer gets a kind of work wrong, with its
   * source), read only through `slip()` (participants/src/slip.ts). Absent: nothing slips. */
  slip?: import("./slip").SlipTable;
}

/**
 * What a module knows about where it's running: which participant, acting for which entity, in which position (absent:
 * as itself). For a role module (a job's procedures), `params` are the position's role parameters with the
 * participant's own traits on top: the same job, done by different people, differently.
 */
export interface ParticipantContext {
  participant: string;
  /** Whether the participant is a person or a system (absent: a person). The kind of performer decides which row of the table of slips is theirs. */
  kind?: "person" | "system";
  entity: string;
  position?: string;
  /** The sparse mind (docs/design/ai-citizens.md 4): asking a model how much each option would matter to someone like
   * this. Present only when the run turns it on; a module decides without it otherwise. */
  consult?: Consult;
  /** The composing model (docs/design/ai-citizens.md 10e): words for something an entity founds. Present only where
   * the world's dial has the composer on; a module writes its own plain words otherwise. */
  compose?: Compose;
  /** What a paper addressed to this participant was read to be (docs/design/ai-citizens.md 13; docs/behaviour/reading.md):
   * the shift from the plain paper of its kind, filed when the paper was written. Present only where the world's dial
   * has reading on. Absent, or answering nothing (a paper with no words of its own, or one not read), a module acts as
   * it always did. It never carries a person: the reader was shown the paper alone. */
  read?(paper: string, standing: Standing): PaperRead | undefined;
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
  /** The act it just returned reached the world as this action: its outcome, when it comes, names it. */
  sent?(action: string): void;
  /** An observation it is shown and takes no step at (a twin seat's brain between asking for a paper and confirming it):
   * a controller that keeps its own view of what is new takes it in with its next step. */
  seen?(obs: Observation): void;
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

/** A paper an office has on file when a new holder arrives (docs/behaviour/office-papers.md, "On file at the start"):
 * a standing notice of the institution's own, which the office's code publishes at its first look (what a body that
 * hears grievances says it hears, with what applying costs). Where a model holds the office the world opens with it
 * published, as it opens with the office's standing work orders in force: nobody can bring a matter to a body that
 * has not said it hears it. */
export interface Opening { kind: string; text: string; data?: unknown; offer?: unknown }

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
  /** What issuing the paper does, in a sentence, for whoever holds the office: said on the form with its name. */
  does?: string;
  fields: { [name: string]: FormField };
  /** (`sends`: whom the form itself sends every paper to, whatever its fields say, and why, in the form's own words:
   * each of the office's own named in `to` ("@feeds") that no field puts there. Said on the form and in a draft's preview.) */
  writes: { kind: string; text: string; data?: unknown; to?: unknown[]; visible?: "public" | unknown[]; basis?: string; offer?: unknown; assertion?: unknown; sends?: { to: string[]; why: string }[]; claim?: { when?: { [field: string]: string }; position: "right" | "liberty" | "power" | "immunity"; holder: string; about: unknown; basis?: string } };
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
  /** The routine's own rhythm, where the office's practice has one: days, or the parameter that gives them with what
   * it is where none is given. Said in the office's procedure; a standing order that does not say how often follows it. */
  every?: number | [param: string, otherwise: number];
  /** Where when the routine is done is set by a published paper (a rating law's instalments), not by a rhythm: the
   * parameter that names the paper, with the paper where none is given. A standing order may name it in place of
   * how often, or say nothing. */
  follows?: [param: string, otherwise: string];
  /** For the task `answer` (the office's counter): the kinds of incoming paper its counter staff sort and answer under
   * the office's procedure, and how, in plain words. Offered only where the town's description has `living` (and not
   * `counter: false`); the office-holder is not brought back for these, and sees a count and a sample. Anything
   * addressed to the office-holder's own post, or resting on a paper of theirs, reaches them whatever its kind. */
  papers?: { kind: string; how: string }[];
}

/**
 * How a code-run office answers a letter (docs/behaviour/letters.md). It cannot read one: so it says, in fixed words,
 * that the letter is received and that it does not act on a letter's words, and then what it does act on and how
 * (`acts`: a sentence or two in the world's terms, naming its forms where it has any). `forms`: where a letter
 * plainly concerns something the office has a form or a set way for (it has one of the words in `about`), what to
 * say of that (`say`). Nothing here may tell a writer what they could not otherwise know: the words are the same for
 * everyone.
 */
export interface Answers { office: string; acts: string; forms?: { about: string[]; say: string }[];
  /** The office has a standing report of its own, which it sends in answer to a letter, with these words after it. */
  report?: true }

/**
 * One thing that stands open on an office's books (docs/behaviour/office-books.md): what it is by its paper's id (the
 * lease, the application, the invoice), a line in the world's words, and, where they apply, since when and how much.
 */
export interface OpenItem { id: string; line: string; since?: number; amount?: number;
  /** When its day comes or came, where it has one (the day the other side may answer by, a hearing day). */
  due?: number;
  /** A running figure (what has been paid against the budget so far): its line moves with every payment, and that
   * alone is no reason for the clerk to file a paper; it is said as it stands whenever one is filed. */
  running?: true }
/** A heading of the books: what kind of thing stands open ("Rent in arrears"), each one, the most pressing first. */
export interface OpenHeading { what: string; items: OpenItem[];
  /** Things whose day has come and that wait on the office-holder (a case to decide, a result to declare): the
   * clerk's paper names them every time it is filed, first, however long they have stood, and not only on the day
   * they changed (docs/behaviour/office-books.md, "What stands open is said until it no longer stands open"). */
  always?: true }
/** An office's books as a clerk keeps them: fed what the office is shown, and asked what stands open now. */
export interface OfficeBooks { absorb(obs: Observation): void; open(t: number): OpenHeading[] }

export interface BehaviourModule {
  /** How its office answers a letter it cannot act on (docs/behaviour/letters.md). An office with a standing report
   * of its own (`Letters`) adds these words to it; any other acknowledges each letter with them (`answering`). */
  answers?: Answers;
  /** The routine tasks its office's staff do by standing work order (docs/behaviour/standing-work.md). */
  routines?: Routine[];
  /** The standing notices the office has on file when a new holder arrives, from its parameters (`Opening`). */
  opens?: (params: { [k: string]: any }, entity: string) => Opening[];
  /** The papers it issues, each as a form of the office's own stationery (docs/behaviour/office-papers.md). */
  issues?: Issued[];
  /** What of the office's own the forms it issues carry, from its parameters: the values of each "@name" in `issues`. */
  issuesWith?(params: { [k: string]: any }): { [name: string]: unknown };
  /** The office's own staff, where it employs any, from its parameters: what one of them is called (the role its
   * employment agreements name), which of its organisation's employees are this office's (`own`, as `Staffing` reads
   * it: several offices of one organisation may each employ), and how many posts it has: an establishment its funder
   * sets, or what a line of its organisation's adopted budget pays for at the office's rate of pay. Whoever holds the
   * office knows this of it, as its own papers (the roster: participants/src/behaviour/roster.ts). */
  staffed?(params: { [k: string]: any }): { role: string; own?: "role" | "role_or_unnamed"; posts: { establishment: number } | { budget_line: string; wage: number; period: number } };
  /** The written directions it takes, each on a form its office publishes (docs/behaviour/directions.md). An office
   * follows only what is filed on its form by someone its organisation says may direct it. */
  takes?: Taken[];
  /** The office's books (docs/behaviour/office-books.md): what stands open at the office, read from its own papers
   * and accounts exactly as its code reads them, and from nothing else. Where a model holds the office, its clerk (a
   * post of the office's staff) keeps them and files a paper on the organisation's own file when what stands open has
   * changed; a code-run office keeps them in its head, as before. */
  books?(ctx: ParticipantContext): OfficeBooks;
  /** Its own registers, held whole because this is the office that keeps them (the land registry its register, a bank
   * its customers' instructions): never a way to know what someone else keeps, which is asked for (`ask` in
   * behaviour/common.ts). */
  keeps?: Kept[];
  /** What it carries of the world's edge: a module that stands for the simulation's own boundary conditions (the
   * weather to come, the outside market's prices) is handed them, and says so here so that it is seen. */
  boundary?: Kept[];
  /** Woken by its cadence and by what it asks for, never by news (a record naming its organisation, a message): a payroll keeps its own round, and a paper that
   * wakes everyone who acts for an organisation would put its acts at other moments in a town with a seat than in one without (foundations F6). */
  deaf?: boolean;
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
/**
 * The situation a person's decision about a want was made in (docs/design/ai-citizens.md 11): the want; what stands
 * behind it; each opening as what it would bring, in the typed terms of 2c, with what the person knows of it; the
 * person's own record as the kernel holds it; the town's figures a person's standing is read against; and the odds
 * the code mind gave. Whom things are by is said as a role (landlord, employer, other_side, or a kind of institution),
 * never a name. Nothing of anyone else's record, and no text the person has not read.
 */
export interface Situation {
  v: 1;
  want: { about: string; from: string; weight: number; days: number; tried: number; grown: number; seeks: string[]; household?: boolean; whom?: string; against?: string; last_way?: string };
  matter?: { matter: string; days: number; asked_days?: number; answer?: string; venues: number; amount?: number; told?: boolean };
  home?: { rent: number; owned?: boolean; rent_to?: number; from_days?: number };
  means: { income: number; savings: number; essentials: number };
  openings: { kind: string; by?: string; brings: string[]; undoes?: boolean; bears?: boolean; trust?: { bps: number; town_bps: number }; fear?: number; belief?: number; others: number; cost?: number; learned?: number; adj: number }[];
  record: { [section: string]: unknown };
  outlook: { agency: { mean_bps: number; sd_bps: number }; place_bps?: number };
  code: { odds: { key: string; ppm: number }[] };
  occasion?: { how: string; sharers: number; beyond_household: number };
}

export interface DecisionRecord {
  /** The citizen's own count of its recorded decisions, from 1: what an outcome names as the decision it follows (`of`). */
  n?: number;
  /** A decision that follows up an earlier one of the citizen's (its `n`): trying elsewhere for what a shop could not serve. */
  follows?: number;
  t: number; domain: string; strategy: string; choice?: string;
  options: { key: string; score: number; facts?: { money_per_month: number; home?: { bedrooms?: number }; work_hours_per_month?: number; goods_per_month?: number; company?: number; time_hours_per_month?: number }; others?: number; meaning?: number; learned?: number }[];
  /** For a decision about a want (areas `want`, `found`): the situation it was made in, as the everyday model would
   * be given it (docs/design/ai-citizens.md 11; contracts/dataset.schema.json, CitizenSituation). */
  situation?: Situation;
  /** Culture (docs/behaviour/culture.md): the picture of the conduct this choice is, as the person held it, and the lean it gave (whole percent; lean in hundredths of a standard deviation). Only where the world's culture dial is on. */
  norm?: { conduct: string; does: number; approves: number; own: number; says: number; lean: number };
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
/**
 * A change to a person's own record (docs/design/ai-citizens.md 10d), carried with a code participant's action as a
 * non-enumerable property under this symbol: the bookkeeping of a code mind, never part of the action and never
 * anything a participant can ask for (the participant API has no such act). The orchestrator hands it to the kernel,
 * which holds the record and is its only writer, when it comes from the bookkeeping the world's config names as the
 * keeper of that entity's record (a person's: its own module; an organisation's: the module of its keeping post).
 */
export const RECORD = Symbol.for("oikos.record");
/** `set`: the sections that changed, each whole (contracts/entity-record.schema.json); `because`: what happened since
 * the last change, in the mind's own short terms. Whole numbers throughout. */
export interface RecordChange { set: { [section: string]: unknown }; because?: { t: number; what: string; about?: string; size: number; by?: string }[] }
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
  /** Where the words of a paper addressed to the citizen were read (docs/behaviour/reading.md): the paper, how the reading came about, the shift from the plain paper's, and each figure the words moved beside what it would have been. */
  read?: { paper: string; source: string; shift: object; moved: { [what: string]: { after: number; plain: number; before?: number } } };
  /** With a founding (domain `found`, kind `founded`): what a composing model would be shown for it, whether or not
   * one was asked (docs/behaviour/founding.md): the recorded situations the composer's audits are run on. */
  brief?: ComposeBrief;
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
