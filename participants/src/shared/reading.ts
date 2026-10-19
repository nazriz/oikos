// Reading: what the words of a paper mean to a person (docs/design/ai-citizens.md section 13; docs/behaviour/reading.md).
//
// A reader (a model today, an interim; one of our own later: participants/src/llm/reader.ts) says what a worded paper
// is like, on nine small whole numbers, shown the paper and never a person. This file is the code's half, and it is
// arithmetic only: no model, no clock, no draw. It turns two readings (the paper's and the plain paper's that code
// would have written) into a SHIFT, and turns a shift into the multipliers and small sums the code mind applies to a
// person's own record. The model says what the paper is like; the code says what that means to this person.
//
// The rule that holds all of it (Naz, 2026-10-13): **words scale what a decision does; they never reverse it, and
// never outweigh it.** A refusal put as kindly as can be still costs a share of what a refusal costs. That is a
// property of the arithmetic below, and `readingParams` refuses any setting that would break it; the tests walk every
// reading, not just the dial's defaults (participants/test/reading.test.ts).
//
// Every size is a PLACEHOLDER and a dial (docs/behaviour/reading.md); the directions follow the procedural-justice
// literature (docs/research/references.md, "Reading"). Basis points where a size is a share.


/** The lines a reader returns. `answers` is `null` where the paper answers nothing. */
export const POLES = ["openness", "conservation", "enhancement", "transcendence"] as const;
export type Pole = (typeof POLES)[number];
export interface Reading {
  respect: number; // -2..2
  reason: number; // 0..2
  answers: number | null; // 0..2, or null where nothing was raised
  recourse: number; // 0..2
  threat: number; // 0..2
  appeals: { [p in Pole]: number }; // 0..2 each
}
export const LINES = ["respect", "reason", "answers", "recourse", "threat", "openness", "conservation", "enhancement", "transcendence"] as const;
export type Line = (typeof LINES)[number];
export const RANGE: { [l in Line]: [number, number] } = {
  respect: [-2, 2], reason: [0, 2], answers: [0, 2], recourse: [0, 2], threat: [0, 2], openness: [0, 2], conservation: [0, 2], enhancement: [0, 2], transcendence: [0, 2],
};
/** Who the reader of a paper is, to the paper: the only thing of the person a reader is told. */
export const STANDINGS = ["addressee", "raised", "affected", "public"] as const;
export type Standing = (typeof STANDINGS)[number];

/** A line's value in a reading (`null` for an unanswered `answers`). */
export function lineOf(r: Reading, l: Line): number | null {
  return l === "respect" || l === "reason" || l === "answers" || l === "recourse" || l === "threat" ? r[l] : r.appeals[l];
}
/** The plain paper's reading where none is known: nothing said either way. */
export const NEUTRAL: Reading = { respect: 0, reason: 0, answers: null, recourse: 0, threat: 0, appeals: { openness: 0, conservation: 0, enhancement: 0, transcendence: 0 } };

/** Whether a reading is whole and in range (a reader's answer that is not is unread). */
export function wellFormed(r: any): r is Reading {
  if (!r || typeof r !== "object" || !r.appeals) return false;
  for (const l of LINES) {
    const v = l === "answers" ? r.answers : lineOf(r, l);
    if (l === "answers" && v === null) continue;
    if (!Number.isInteger(v) || v < RANGE[l][0] || v > RANGE[l][1]) return false;
  }
  return true;
}

// ------------------------------------------------------------------ the shift

/** The reading less the plain paper's, line by line, in steps. A line either does not have (`answers` of a paper that
 * answers nothing) shifts nothing. */
export interface Shift { respect: number; reason: number; answers: number; recourse: number; threat: number; appeals: { [p in Pole]: number } }
export const NO_SHIFT: Shift = { respect: 0, reason: 0, answers: 0, recourse: 0, threat: 0, appeals: { openness: 0, conservation: 0, enhancement: 0, transcendence: 0 } };
export function shiftOf(reading: Reading, plain: Reading): Shift {
  return {
    respect: reading.respect - plain.respect, reason: reading.reason - plain.reason,
    answers: reading.answers === null || plain.answers === null ? 0 : reading.answers - plain.answers,
    recourse: reading.recourse - plain.recourse, threat: reading.threat - plain.threat,
    appeals: Object.fromEntries(POLES.map((p) => [p, reading.appeals[p] - plain.appeals[p]])) as Shift["appeals"],
  };
}
export const isNoShift = (s: Shift): boolean => s.respect === 0 && s.reason === 0 && s.answers === 0 && s.recourse === 0 && s.threat === 0 && POLES.every((p) => s.appeals[p] === 0);

/**
 * The readings of the same paper by two askings (the prompt's two wordings), as one: the mean, rounded toward 0; and a
 * line on which the two are more than a step apart is set to the plain paper's and counted. `answers` is `null` only
 * where both say so; one saying a number and the other nothing is a line apart.
 */
export function combineAskings(a: Reading, b: Reading, plain: Reading): { reading: Reading; apart: Line[] } {
  const apart: Line[] = [];
  const mean = (l: Line): number | null => {
    const x = lineOf(a, l), y = lineOf(b, l), p = lineOf(plain, l);
    if (x === null && y === null) return null;
    if (x === null || y === null || Math.abs(x - y) > 1) { apart.push(l); return p; }
    return Math.trunc((x + y) / 2);
  };
  const reading: Reading = {
    respect: mean("respect")!, reason: mean("reason")!, answers: mean("answers"), recourse: mean("recourse")!, threat: mean("threat")!,
    appeals: Object.fromEntries(POLES.map((p) => [p, mean(p)!])) as Reading["appeals"],
  };
  return { reading, apart };
}

// ------------------------------------------------------------------ the dial and its sizes

/**
 * The sizes of how each line lands (docs/design/ai-citizens.md 13b, "How each line lands"). Every size a PLACEHOLDER.
 * Coefficients are in basis points of a multiplier (2,000: 0.20 for each step); the bounds are multipliers in
 * thousandths so a world config holds whole numbers only.
 */
export interface ReadingParams {
  /** Trust in whoever decided: a refusal or a loss. The weight times 1 - respect*a - reason*b - answers*c, within [floor, ceil]. */
  refusal: { respect_bps: number; reason_bps: number; answers_bps: number; floor_milli: number; ceil_milli: number };
  /** The same, on a grant: times 1 + respect*a, within [floor, ceil]. */
  grant: { respect_bps: number; floor_milli: number; ceil_milli: number };
  /** Sense of agency, on something tried that failed: times 1 - answers*a - recourse*b. Being heard, having somewhere to go. */
  failed: { answers_bps: number; recourse_bps: number; floor_milli: number; ceil_milli: number };
  /** Sense of agency, on something done to the person (a notice, an order): times 1 - reason*a - recourse*b. */
  done_to: { reason_bps: number; recourse_bps: number; floor_milli: number; ceil_milli: number };
  /** Anger toward the writer, by each step of respect below the plain paper's; fear, by each step of threat above it (basis points of the way to the most). */
  anger_bps: number;
  fear_bps: number;
  /** The tie with the writer, a step of respect. */
  tie_bps: number;
  /** The odds of appealing: the score of the ways that answer the paper, up this much a step of recourse. */
  recourse_score_bps: number;
  /** The odds of complying with an order, of leaving on a notice: the rate swayed by (respect + reason) at this share a step, at most `obey_max_bps` of the rate either way. */
  obey_per_bps: number;
  obey_max_bps: number;
  /** A public paper, for each person it reaches (step 6; sizes kept here so there is one place for them). */
  public: { respect_bps: number; reason_bps: number; answers_bps: number; weight_raised_bps: number; weight_affected_bps: number; weight_public_bps: number };
  /** What the reader thinks of the writer, and the odds of joining a founded thing, by the fit (step 6). */
  view_bps: number;
  join_bps: number;
}

export const READING_DEFAULTS: ReadingParams = {
  refusal: { respect_bps: 2_000, reason_bps: 1_500, answers_bps: 1_000, floor_milli: 400, ceil_milli: 1_600 },
  grant: { respect_bps: 1_000, floor_milli: 800, ceil_milli: 1_200 },
  failed: { answers_bps: 1_500, recourse_bps: 1_000, floor_milli: 500, ceil_milli: 1_250 },
  done_to: { reason_bps: 1_000, recourse_bps: 1_000, floor_milli: 600, ceil_milli: 1_200 },
  anger_bps: 1_000,
  fear_bps: 1_500,
  tie_bps: 500,
  recourse_score_bps: 500,
  obey_per_bps: 500,
  obey_max_bps: 1_500,
  public: { respect_bps: 4_000, reason_bps: 3_000, answers_bps: 3_000, weight_raised_bps: 5_000, weight_affected_bps: 3_000, weight_public_bps: 1_000 },
  view_bps: 800,
  join_bps: 750,
};

/** The most a multiplier on a decision's weight may reach above 1, and the least it may keep of it. A word's bound
 * (Naz, 2026-10-13): the effect of how a paper is put is within the effect of what it decides. */
export const FLOOR_MIN_MILLI = 100;
export const CEIL_MAX_MILLI = 2_000;

/**
 * The sizes a world gives, over the defaults. **Refuses** any setting that would let words reverse or outweigh a
 * decision: a multiplier's floor below 0.1 (so a refusal could cost nothing) or its ceiling above 2 (so the words
 * could outweigh the decision), a floor above its ceiling or above 1 and a ceiling below 1, and any negative size.
 */
export function readingParams(given?: any): ReadingParams {
  const d = READING_DEFAULTS, g = given ?? {};
  const merge = <T extends object>(base: T, over: any): T => ({ ...base, ...(over ?? {}) });
  const p: ReadingParams = {
    refusal: merge(d.refusal, g.refusal), grant: merge(d.grant, g.grant), failed: merge(d.failed, g.failed), done_to: merge(d.done_to, g.done_to),
    anger_bps: g.anger_bps ?? d.anger_bps, fear_bps: g.fear_bps ?? d.fear_bps, tie_bps: g.tie_bps ?? d.tie_bps, recourse_score_bps: g.recourse_score_bps ?? d.recourse_score_bps,
    obey_per_bps: g.obey_per_bps ?? d.obey_per_bps, obey_max_bps: g.obey_max_bps ?? d.obey_max_bps, public: merge(d.public, g.public), view_bps: g.view_bps ?? d.view_bps, join_bps: g.join_bps ?? d.join_bps,
  };
  for (const [name, m] of [["refusal", p.refusal], ["grant", p.grant], ["failed", p.failed], ["done_to", p.done_to]] as const) {
    if (!(m.floor_milli >= FLOOR_MIN_MILLI && m.floor_milli <= 1_000 && m.ceil_milli >= 1_000 && m.ceil_milli <= CEIL_MAX_MILLI))
      throw new Error(`dials.reading.step.${name}: words may scale what a decision does and never reverse or outweigh it: floor must be ${FLOOR_MIN_MILLI}..1000 and ceiling 1000..${CEIL_MAX_MILLI} (thousandths); got ${m.floor_milli}..${m.ceil_milli}`);
  }
  const sizes: [string, number][] = [["refusal.respect_bps", p.refusal.respect_bps], ["refusal.reason_bps", p.refusal.reason_bps], ["refusal.answers_bps", p.refusal.answers_bps], ["grant.respect_bps", p.grant.respect_bps],
    ["failed.answers_bps", p.failed.answers_bps], ["failed.recourse_bps", p.failed.recourse_bps], ["done_to.reason_bps", p.done_to.reason_bps], ["done_to.recourse_bps", p.done_to.recourse_bps],
    ["anger_bps", p.anger_bps], ["fear_bps", p.fear_bps], ["tie_bps", p.tie_bps], ["recourse_score_bps", p.recourse_score_bps], ["obey_per_bps", p.obey_per_bps], ["obey_max_bps", p.obey_max_bps],
    ["public.respect_bps", p.public.respect_bps], ["public.reason_bps", p.public.reason_bps], ["public.answers_bps", p.public.answers_bps], ["public.weight_raised_bps", p.public.weight_raised_bps],
    ["public.weight_affected_bps", p.public.weight_affected_bps], ["public.weight_public_bps", p.public.weight_public_bps], ["view_bps", p.view_bps], ["join_bps", p.join_bps]];
  for (const [n, v] of sizes) if (!Number.isInteger(v) || v < 0 || v > 10_000) throw new Error(`dials.reading.step.${n}: a size is a whole number from 0 to 10000; got ${v}`);
  if (p.obey_max_bps > 5_000) throw new Error(`dials.reading.step.obey_max_bps: words move the odds of complying by at most half the rate either way; got ${p.obey_max_bps}`);
  // The weights of a public paper are at most half a decision's (a decision weighs 1 or more): words in public never outweigh a deed.
  for (const w of [p.public.weight_raised_bps, p.public.weight_affected_bps, p.public.weight_public_bps]) if (w > 5_000) throw new Error("dials.reading.step.public: a public paper counts at most half a decision's weight to anyone");
  return p;
}

/** The world's dial, if it is on: `dials.reading` with its sizes (docs/behaviour/reading.md). Absent: undefined, and no site is entered. */
export interface ReadingDial { papers: ("decision" | "public" | "founding")[]; reader: string; calls_per_run: number; params: ReadingParams }
export function readingDial(world: { dials?: { [name: string]: unknown } } | undefined): ReadingDial | undefined {
  const d = world?.dials?.reading as any;
  if (!d || typeof d !== "object") return undefined;
  return { papers: Array.isArray(d.papers) ? d.papers : ["decision"], reader: String(d.reader ?? ""), calls_per_run: Number.isInteger(d.calls_per_run) ? d.calls_per_run : 800, params: readingParams(d.step) };
}

// ------------------------------------------------------------------ which papers carry a seat's own words

/** The kinds of paper that are a decision addressed to a person (the first slice, design 13a): each has a field for words. Free text in the world; these are what code reads. */
export const DECISION_KINDS: readonly string[] = ["variation_answer", "remedy_answer", "venue_decision", "tribunal_order", "fund_decision", "loan_decision", "benefit_decision"];
/** The fields of a paper's `data` that carry the writer's own words (a form's text fields; a code module's template fills the same ones with its own plain words). */
export const WORD_FIELDS: readonly string[] = ["reason", "statement", "answer", "why"];

/** The writer's own words on a paper, if it has any: the text fields of its data, joined, in the order the fields are listed here. */
export function wordsOf(data: { [k: string]: unknown } | undefined): string | undefined {
  const parts = WORD_FIELDS.map((f) => data?.[f]).filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim());
  return parts.length ? parts.join("\n") : undefined;
}

/** What a decision decided, in a word: the key of its plain paper in the table (`kind:outcome`). The outcome is typed on the paper, so the words' part can be told from the decision's. */
export function plainKey(kind: string, data: { [k: string]: unknown } | undefined): string {
  const yes = data?.granted ?? data?.approved;
  const outcome = typeof yes === "boolean" ? (yes ? "granted" : "refused") : typeof data?.finding === "string" ? data.finding : "decided";
  return `${kind}:${outcome}`;
}

/** What the desk files for a paper and a standing, and the citizen reads: the shift, how it came about. */
export interface PaperRead { paper: string; standing: Standing; shift: Shift; source: string }
/** What a tribunal's order or a venue's decision can find (the forms' options, papers.ts): the outcomes of those kinds of decision. */
export const FINDINGS: readonly string[] = ["dismissed", "rejected", "pay", "do", "set_aside", "settled", "referred", "plan", "possession", "valid", "invalid", "paid"];

/** Every key of the table of plain papers: each kind of decision by each outcome it can state. A seat can put words on any of them, so each has a row. */
export function plainKeys(): string[] {
  return DECISION_KINDS.flatMap((k) => (k === "tribunal_order" || k === "venue_decision" ? FINDINGS : ["granted", "refused"]).map((o) => `${k}:${o}`));
}

