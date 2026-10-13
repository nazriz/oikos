# Reading: what the words of a paper mean to a person

Design: `docs/design/ai-citizens.md` section 13. Code: `participants/src/behaviour/reading.ts` (arithmetic only), `participants/src/llm/reader.ts` (the reader's interface and the mock readers), `orchestrator/src/reading.ts` (the desk that reads a paper once and files the reading), `inner.ts` (`experience`, `tried`, `doneTo` take a multiplier and say what the figure would have been), `citizen.ts` (the sites where a paper already lands). Gate: `participants/src/llm/reading-gate.ts`, `scripts/reading-gate.ts`, the hand-made pairs in `participants/eval/reading-pairs.json`.

## What it does

A seat's paper that carries its own words (an answer, a decision with a reason) is read once by a **reader**, which says what the paper is like to whoever receives it, on nine small whole numbers: `respect` (-2..2), `reason`, `answers`, `recourse`, `threat` (0..2 each; `answers` absent where nothing was raised) and four `appeals` (0..2: openness, conservation, enhancement, transcendence, the four poles of Schwartz's ten values). The reader is shown the paper (names, ids, sums and dates replaced by tags), what it answers, and the reader's *standing* (`addressee`, `raised`, `affected`, `public`). It is never shown a person. The reading is filed in the log as an event; every person the paper reaches is then moved **by code, from their own record**, by the *shift*: the reading less the reading of the plain paper code would have written for the same decision. The model says what the paper is like; the code says what that means to this person.

## The rule that holds it together

**Words scale what a decision does; they never reverse it, and never outweigh it** (Naz, 2026-10-13). A refusal put as kindly as can be still costs at least 0.4 of what a refusal costs; a grant put grudgingly still counts for 0.8; a public paper counts at most half a decision's weight. This is a property of the arithmetic and of the dial's validation (`readingParams` refuses a floor below 0.1 or a ceiling above 2, and a public weight above one half), and `participants/test/reading.test.ts` walks every reading against every plain paper at the defaults and at the extremes the dial allows.

## Parameters (`dials.reading.step`; every size a PLACEHOLDER, ours, to be replaced only by a source)

| Where it lands | Today | With the shift (`d` is the shift in steps) |
|---|---|---|
| Trust in the writer, on a refusal or loss | weight | times 1 - 0.20 d(respect) - 0.15 d(reason) - 0.10 d(answers), within 0.4 and 1.6 |
| Trust, on a grant | weight | times 1 + 0.10 d(respect), within 0.8 and 1.2 |
| Sense of agency, on something tried that failed | weight | times 1 - 0.15 d(answers) - 0.10 d(recourse), within 0.5 and 1.25 |
| Sense of agency, on something done to the person | weight | times 1 - 0.10 d(reason) - 0.10 d(recourse), within 0.6 and 1.2 |
| Anger at the writer | none | 1,000 a step of respect below the plain paper's |
| Fear of the writer | none | 1,500 a step of threat above the plain paper's |
| The tie with the writer | the decision's | 500 a step of respect |
| The odds of appealing | the code mind's | the score of the ways that answer the paper up 500 a step of recourse |
| The odds of complying with an order | `obey_bps` | the rate swayed by (d(respect) + d(reason)) at 5% a step, at most 15% of the rate either way; the same draw, another threshold |
| A public paper (built later) | nothing | one experience of the writer, good or bad by the sign of 0.4 d(respect) + 0.3 d(reason) + 0.3 d(answers), weight that sum (at most 1) times 0.5 (raised it), 0.3 (named), 0.1 (anyone) |
| What the reader thinks of the writer; the odds of joining (built later) | | 800 and 750 times the fit of the paper's appeals to the person's values |

**Sources** (docs/research/references.md, "Reading"; all to confirm): the directions are the procedural-justice literature's (Tyler 1990, 2006; Lind and Tyler 1988; Bies and Shapiro 1988; Folger 1977); the appeals' four poles are Schwartz's. The sizes are not sourced.

## The reader is interim

The reader is an external model today (Haiku 5.5 through `claude -p` on the plan, no paid key; never the largest Claude model; never the model that holds a seat in the same run). **The platform's models are to be internal**, so this is stated as an interim and built to be replaced: the reader sits behind one interface (`Reader`, `participants/src/llm/reader.ts`) and nothing else knows which reader it is; every reading is logged with the tagged paper text (as a hash and, in the dataset, in full), the typed reading, and the reader's model and prompt version, in a form a later training run can use (`readings.jsonl`). The plan is a small reader of our own trained on those readings (design 13e); it replaces the external one without touching anything else.

## Where it lands in code (step 2: decisions addressed to a person)

- **`orchestrator/src/reading.ts`, the desk.** When a seat's decision with words of its own (`reason`, `statement`, `answer` or `why` on a variation answer, a remedy answer, a venue's decision, a tribunal's order, a fund's, a loan's or a support decision) is recorded, the desk reads it then, in that step, so the reading is on file before anyone sees the paper. Two askings (the prompt's two wordings), combined (the mean toward 0; a line more than a step apart is the plain paper's and counted). The shift is the reading less the plain paper's from the table (`participants/src/llm/reading-table.json`, empty until the gate has been run for real, so with the dial on and no table a paper is `no_table` and the world is as it was). A code office's paper is the plain paper and is never read.
- **`citizen.ts`, `landing`.** Where a paper already lands (`variation_answer`, `remedy_answer`, a venue's decision or tribunal order on our application, a fund's decision, an order for possession and a plan or dismissal) the person's trust, sense of agency, anger, fear and tie move by the multipliers of the table above, and the odds of obeying an order by `obeyRate` (the same draw, another threshold). The outcome the paper makes carries `read`: the paper, how it was read, the shift and each moved figure beside what it would have been without the words. **The odds of appealing** are carried by `recourseBump`: the score of the ways that answer the paper (asking again, a venue) is up by `recourseScore` for the matter; this replaces the design's new `choice.recourse` weight with the score itself, which has one fewer dial.
- **Tags, hash and cache (step 3).** What goes to the reader is the paper and what it answers with names, ids, sums and days replaced by tags (`[PERSON-1]`, `[ID-1]`, `[SUM-1]`, `[DAY-1]`), numbered by first appearance across the paper and then what it answers, the same value the same tag (`participants/src/llm/reading-tags.ts`; the names are the world's entities', the money marks are the world's currency's, the days are the world's "year N, day M"; counts and spans like "26 weeks" stay). A reading is cached within a run by the reader and its versions, the kind, the standing, and the hash of the tagged words (and of what they answer): forty refusals in the same words to forty people are one reading, two calls. No cache is carried between runs. Every paper has its own event in the log; the event holds the tagged words and their hash, so a run's log alone is a labelled example set for a reader of our own (`readings.jsonl` in the dataset). Every kind of decision a seat can put words on, by each outcome it can state, has a key in the table of plain papers (`plainKeys()`); the table (`participants/src/llm/reading-table.json`) is empty until the gate has been run for real and says so, and a test holds that once it has rows it has all of them.
- **The log.** Each reading is a `note` annotation (`data.reading`); the run's start note says the reader; the end says what the desk did (`reading_counts`). A reader reached through the model adapters is served from the log on a resume, so a replay never calls it; the mock calls nothing.
- **Not built yet:** public papers and founders' statements (step 6), the extreme-reader runs (step 7), a model reader (step 5).

## What it never does

- The reader is never shown a person's record, a name, or which model holds a seat; it keeps nothing. No decision comes from it, and there is no first-person voice.
- Nothing in the world labels a paper good or bad; the lines describe how a paper is taken, and no measure adds them into a score.
- A reader that declines or fails: the paper is read as the plain paper of its kind (from the table), and the decline is counted. A replay never calls a reader: it is served from the log.
- A seat is never shown a reading.
- Promises are not read; pleasantries alone must not move the reader (the gate's politeness control).

## Left out, deliberately

Public papers' effects, founders' statements, and the extreme-reader runs are later steps (design 13h, steps 6 and 7).
