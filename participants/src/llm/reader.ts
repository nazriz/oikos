// The reader (docs/design/ai-citizens.md 13b; docs/behaviour/reading.md): something that, shown a paper in the third
// person (never a person), says what the paper is like on nine small whole numbers. This is the one interface every
// reader sits behind. **The external reader is a stated interim** (Naz, 2026-10-13: the platform's models are to be
// internal): a model today, and later a small reader of our own trained on the readings gathered here. Nothing else in
// the platform knows which reader it has; replacing it changes this file's factory and nothing else.
//
// This file holds the interface and the deterministic mock readers the tests and the extreme-reader runs use. No
// reader in this build calls a model.

import { LINES, NEUTRAL, POLES, type Line, type Reading, type Standing } from "../shared/reading";

/** The prompt's version, said on every reading. Bumped when the prompt (step 5) or this interface's meaning changes. */
export const READING_VERSION = "0.1.0";

/** What a reader is asked. The paper is tagged (reading-tags.ts: names, ids, sums and dates leave the run as tags). */
export interface ReadRequest {
  /** The paper's kind in the world's words ("a decision on a claim for a payment: refused"). */
  kind: string;
  /** Who the reader of the paper is, to the paper: the only thing of any person a reader is told. */
  standing: Standing;
  paper: string;
  /** What the paper answers, if anything (the reader's own request, or the petition they signed), tagged the same way. */
  answers?: string;
  /** The prompt's two wordings: the second has every sentence reworded and the lines in reverse order. */
  wording: 1 | 2;
}

/** What a reader gives back: the nine numbers and, for each line not 0, a phrase of at most twelve words quoted from the paper; or a decline. */
export interface ReadAnswer {
  declined?: boolean;
  reading?: Reading;
  phrases?: { [l in Line]?: string };
  /** What the call cost, where it cost anything (as Claude Code reckons it): for the gate and the run's usage. */
  cost_microusd?: number;
  input_tokens?: number;
  output_tokens?: number;
}

export interface Reader {
  /** Who it is, as it is said on every reading: "provider/model" for a model, "mock/<name>" for a mock. */
  readonly model: string;
  /** The reader's own version (the prompt's, for a model). */
  readonly version: string;
  read(req: ReadRequest): Promise<ReadAnswer>;
}

/** Up to twelve words of the paper from `at`, exactly as written (so that code can check the phrase is in the paper). */
export function quoteFrom(paper: string, at = 0): string {
  const m = /^\S+(?:\s+\S+){0,11}/.exec(paper.slice(Math.max(0, at)));
  return (m?.[0] ?? paper.slice(0, 60)).replace(/[.,;:]+$/, "");
}

/** Phrases for every line of a reading that is not 0: the paper's first words (a mock quotes without understanding). */
export function phrasesAt(reading: Reading, paper: string, at: (l: Line) => number = () => 0): { [l in Line]?: string } {
  const out: { [l in Line]?: string } = {};
  for (const l of LINES) {
    const v = l === "respect" || l === "reason" || l === "answers" || l === "recourse" || l === "threat" ? reading[l] : reading.appeals[l];
    if (v !== 0 && v !== null) out[l] = quoteFrom(paper, at(l));
  }
  return out;
}

const mock = (name: string, f: (req: ReadRequest) => Reading): Reader => ({
  model: `mock/${name}`,
  version: READING_VERSION,
  read: async (req) => {
    const reading = f(req);
    return { reading, phrases: phrasesAt(reading, req.paper) };
  },
});

/** A reader that reads every paper as one fixed reading (`answers` only where the paper answers something). */
export const fixedReader = (name: string, r: Omit<Reading, "answers"> & { answers: number }): Reader =>
  mock(name, (req) => ({ ...r, answers: req.answers === undefined ? null : r.answers, appeals: { ...r.appeals } }));

const NO_APPEALS = { openness: 0, conservation: 0, enhancement: 0, transcendence: 0 };
/** Every paper at its kindest: the extreme reader of 13f (respect shown, a reason, each thing met, a way on, no threat). */
export const kindestReader = (): Reader => fixedReader("kindest", { respect: 2, reason: 2, answers: 2, recourse: 2, threat: 0, appeals: NO_APPEALS });
/** Every paper at its curtest: contempt, no reason, nothing met, nowhere to go, menace. */
export const curtestReader = (): Reader => fixedReader("curtest", { respect: -2, reason: 0, answers: 0, recourse: 0, threat: 2, appeals: NO_APPEALS });
/** Every paper as the plain paper of its kind: the neutral reading (no shift anywhere). */
export const neutralReader = (): Reader => mock("neutral", (req) => ({ ...NEUTRAL, answers: req.answers === undefined ? null : 0, appeals: { ...NO_APPEALS } }));

export { LINES, POLES };
