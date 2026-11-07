# The translator, version 3: reading forms by name (plan, 2026-10-23)

A plan awaiting the owner. Nothing is built, no model was called, nothing was trained. It decides; the reason stands
beside each choice. The held-out file (`~/oikos-private/translator/held-out.json`) was not opened.

## 0. What the owner asked, and what the evidence says first

The owner: the translator memorises a closed list of about 950 forms, so every platform change leaves it behind and
needs a retrain. Rebuild it to read the forms a seat actually has, by name and schema, and fill one; new forms need no
retraining. Handle names, real dates (lane N) and references. Our own model; external models only as teachers or
fallback. Fast.

**A correction to the premise, because the plan depends on it.** The model in use (`pod-small-r3-long-s1`) already
reads the forms in its input: it is shown each form as a line (`- name, to=office, id ...: fields a (type), b (one of
x | y)`) and points at the form's name and the office where they stand (`translator/model/encode.ts`, `shownAt`). The
list of 917 is not in its weights; it is in the *release rule* (`forms-trained.json`, `forms-released.json`: a form
outside the list is `form_unseen`, recorded, never offered). That rule exists because the model reads unseen forms
badly, not because it cannot see them:

- lv-04: on forms it had never seen, 2 of 9 drafts were right (adapter.ts, the coordinator's measurement, 2026-10-12).
- Round 3: after training on all 29 new forms, wrong drafts on the new real set were 12 to 15% for every run, most on
  one form (`possession_order`, 5 to 7 of 20) (decisions 2026-10-15, step 4).
- 854 form names have training examples; the median name has 10, and 202 have fewer than 5. 7 of the Rust catalogue's
  76 forms have none (`audit_request`, `audit_finding`, `audit_report`, `audit_answer`, `evidence`,
  `confirmation_answer`, `review_request`): today they could only go behind.

So the job is not to make the model see forms (it does) but to make it **read** them well enough that an unseen form is
safe to serve, and to replace a release rule that needs eight real cases per form with one that needs evidence per kind
of field. "No retraining for new forms" is a hypothesis this plan tests (section 4, the unseen-forms set) and stops on
(section 9) if false.

## 1. Architecture: one small encoder, read twice (choose, then fill); no free generation

**Decided:** keep the decide-and-copy family (deberta-v3-small, fine-tuned, a small writer with pointer heads), and
split each answer into two passes of the same encoder:

1. **Choose.** Input: the request, then one short **card header** per candidate: every form the seat knows of (`name —
   title — to=office`, from the Rust catalogue) and every function of the call language (`payment`, `agreement`,
   `statement`, `letter`, `work`, ... as built-in cards from `contracts/calls.schema.json`). Output: refusal (a label of
   the closed set, as now) or program; the number of lines (closed, as `slots` does now); for each line, **a pointer
   to a card header** and whether its result is named for a later line. The form is chosen by pointing at it, never by a
   label: no form name is ever a class of the model.
2. **Fill**, once per line. Input: the request, the chosen card in full (name, title, `does`, every field with its type,
   required mark, options and description), and the earlier lines' card names (for bound results). Output, field by
   field in the card's order (the `slots` decoding): left out; a span of the request (`id`, `text`, `word`); a pointer to
   one of the card's options; an earlier line's result; or one of a handful of language constants (`self`, `today`, the
   seat's own account). Lists and data keep their closing decision.

**Field-type masks, in code.** What a slot may take is narrowed by the field's type before the model scores it: a
`date` slot only spans the resolver reads as a date (`forms::parse_date_in`, `calls::parse_when_in`), an `amount` only
spans it reads as money, a `choice` only the card's options, an `entity`/`account`/`record` only id-like or name-like
spans. A wrong-typed value cannot be written; that is a whole class of confident wrong closed by construction.

**Computing.** The model never computes. A value the request does not state but implies by arithmetic (net from gross,
a split, a date "14 days after the hearing") stays `none(needs_calculation)` or a copied span the resolver reads ("14
days"), as 0.9.3 and step 0 of round 3 settled. Computing in a 140M-parameter model is where it would be confidently
wrong.

**Sureness.** The answer's sureness is the choose probability times the fill probabilities, temperature-calibrated on
validation-real (one scalar per pass); the cut-off is set on validation-real so that wrong drafts above it are under
1%. The two passes give two named ways to be unsure (`which form`, `which value`), which the seat's question back
already has words for (`Unsure`: `act`, `form_field`, `form_option`).

**Why this and not a small seq2seq** (t5-small or a 0.5B decoder):

- **What failed in rounds 1 to 3 was structure and length, not the copy-or-choose shape.** The closed-set decoder closed
  forms and programs early (`)` at 0.996; `eos` at 0.93; decisions 2026-10-10); the slot decoding removed those
  decisions. The base-size reader bought nothing (150 against 153 right, 14 against 12 wrong; larger-reader run): capacity
  is not short. Length was: a letting office's 26 forms did not fit 1,024 tokens, and of subset serving's drafts 10 of 22 differed from what
  the seat confirmed. Two passes fix length for good: a header is about 14 tokens (median, Rust catalogue; longest 25), so 40 cards
  and a request fit 1,024; a full card is about 190 tokens at the median and 700 at the longest, so fill also fits 1,024.
  Both passes run at half round 3's length.
- **The pass mark is about confident wrongness.** A generator can write an id, an amount or a form it was not shown;
  making it safe needs a grammar-constrained decoder with copy masks, which is this design rebuilt inside a slower model.
- **CPU.** A seq2seq writes 60 to 120 tokens one at a time; this writes about 9 decisions an example (mean 8.8, round 2).
- **The weakness this design adds** (round 3 named it): a second decision before the first, so the right fields on the
  wrong form. It is answered by the choose pass having its own calibrated sureness, by distractor training (section 2),
  and by the choose pass being scored apart (section 4).

**Revisit if** the unseen-forms fill score plateaus under 80% with augmentation (then reading needs a pretrained
model that reads instructions, a seq2seq with constrained decoding, as a round of its own), the owner wants text out
(translator v2), or a seat's cards exceed about 60 (add a retrieval shortlist before choose).

## 2. Training data

**The base: the archive's 59,249 examples** (`runs/archive-2026-10-17/translator/examples.jsonl.zst`), less the 7
flagged `exclude_from_training`, less every row whose split is `real_test`, `test` or `held_back`, less anything the
join's leak check finds against the 180 real, the held-out cases (by code only) and the new real set (section 3).
Composition: 42,788 positive, 14,462 refusals; 13,666 programs fill a form, 2,163 have more than one line; 36,177
synthetic, 6,361 in situ, 3,104 from code participants' logs, 1,694 from pilots.

**Converting closed-set labels to by-name** (a script, `translator/model/convert-v3.ts`, with a round-trip test as
`check_slots.py` is for slots):

- Each program line's function becomes a card choice. `form=<name>` becomes a pointer to that form's header. The card
  comes from the Rust catalogue where the name is there (69 of its 76 names have examples, 4,486 fills), else from the
  line the example was shown (name, fields, types, options), its title the name in words and `does` empty.
- A `const:` value that is one of a choice field's options becomes a pointer to the option in the card; `to=` implied
  becomes the card's office. What remains a constant is only the language's own (`self`, `today`, refusal labels).
- Spans already stored (`spans`) map to the request as they do now.
- Every row that does not convert is set aside with its reason and counted; the target is 97% converted.

**Augmentation, the main lever for reading by name** (code, no model):

- **Renaming.** Each form example gets two twins in which the form's name, its field names and its option words are
  replaced consistently (a table of 5 alternative names per catalogue form and field, written once by Haiku 5.5 and
  read by Sonnet 5.5, plus invented names for synthetic forms), the fields shuffled, and the title, `does` and field
  descriptions each dropped at 30%. Where the request names the form or a field in words, the request is rewritten by
  the same table; otherwise it stands. The model can then only score well by reading.
- **Distractors.** The choose pass is shown the seat's own list plus 3 to 10 forms drawn from the catalogue and the
  synthetic names, half of them near neighbours (same office, overlapping fields: `possession_application`,
  `possession_order`, `possession_answer`).
- **Whole forms left out.** 15% of the catalogue's forms and 15% of synthetic names are kept out of training entirely
  (seeded, by name and renamed twin): they are the unseen-forms validation and test sets.

**Names, dates and references (lane N), generated by code**, one twin for 40% of rows, the rest kept with ids (seats
under `simulation` still see them; names-and-dates.md section 9, point 4):

- **Dates.** Every `year N, day D` span re-rendered in one of the nine profiles' `DateStyle` (`rules::calendar`; with and
  without weekday, "12th", short month, year missing), the program's span moved to it. The resolver reads it; the
  model only copies. `contracts/test/dates.json` is the check.
- **Names.** Ids of people, firms and bodies in the request replaced by names drawn as the generator draws them
  (`worlds/generator/names.ts`, per profile: family-name-first, two family names, patronymics, diacritics); the program
  carries the name as a `text` span for the resolver to resolve among those the seat has been shown. Twins in which
  two shown people share a name are made only once the `ambiguous` label exists (question 2).
- **References.** A record cited by its office's reference (`L/2026/0042`, `rules::identity::reference`) in place of its
  id, copied as an `id` span; served only once the resolver reads references.
- The same program with an id and with a name are two rows of one group (`names: ids|names`), scored apart.

**New and thin forms.** `translator-data --world-forms 40 --only world_form` on the Rust catalogue for the 7 forms with
no example and the forms under 20 examples (about 600 briefs; Sonnet 5.5 and Haiku 5.5 write and read, Codex
`gpt-6-luna`/`gpt-6.1-sol` as a third voice while its window answers; never the run waiting on Codex).

**Kept out of all of it:** the 180 real cases and their seat-days, the held-out cases (five words running, by code),
the new real set and its seat-days, the unseen-forms split, and every test file. The archive's restrictions hold:
nothing of `debriefs/`, `exit_accounts/` or a debrief transcript.

Expected: about 57,000 converted rows, about 27,000 renamed twins, about 20,000 names-and-dates twins, about 500
generated, the training pilots' real requests at four times: **about 105,000 training rows.**

## 3. Pilots first: real requests on the Rust world's forms

(Written before the pilots. Since then the six pilots below have run on the Rust world, 2026-10-24, `runs/pilots-six-2026-10-24/`.)
At the time no pilot had run on the Rust world (the cut-over was 2026-10-19). The 180 real requests are on the TypeScript world's
forms; a model for the Rust world must be judged on its requests.

- **Six pilots, 120 days each, town-3000** (lv-08 to lv-13), in two profiles each pair (gb-eng and au-vic, then us-oh and
  de-ni, then mx-jal and jp-akita). **Seats:** the letting office, the tribunal's member and registrar, finance, the
  mayor, the lender, the audit office (its four forms have no example), and one tenant (`possession_answer`, 19 fields).
  Seat models: Sonnet 5.5 for four of the six, Codex `gpt-6.1-sol` for two while its window answers (other voices than
  Claude's); a pilot never waits on Codex.
- **Names and calendar on (`names: true`, `calendar: true`) in three of the six**, off in three, so the name and id rows
  of section 2 have real twins.
- **The translator in them is today's arrangement** (`pod-small-r3-long-s1` first, Sonnet 5.5 under 0.9.5 behind), so
  the pilots are ordinary pilots and lose nothing if v3 fails.
- **lv-07a and lv-07b** (109 requests, already run, never keyed) are keyed now.
- **Split:** lv-07a, lv-07b, lv-08, lv-10, lv-12 are **test-only** (the new real set, "RR"); lv-09, lv-11, lv-13 train.
  Expected at the rate of lv-04 to lv-07 (46 to 103 requests a pilot): about 350 test cases, about 240 to train.
- **Keying RR:** the pipeline's two readers under 0.9.5, then each case read by a Sonnet 5.5 agent who has seen no
  model's answer, disagreements settled by a written rule (round 3's rule N1).

## 4. Evaluation and the pass mark

**Sets.** R180 (the old real, unchanged keys); RR (section 3); held out (66, scored by code, reported by id and outcome
only); **UF, unseen forms** (the left-out forms, 5 to 10 generated cases each, at least 40 forms); seen; parity; and
the names-and-dates twins of UF and parity. Choose and fill are each scored apart as well as together.

**The pass mark (unchanged, the owner's):** on real requests (R180 and RR together) at least 90% right and at most 1%
wrong drafts offered. That replaces `pod-small-r3-long-s1` as the model that works alone.

**Before the pass mark, the bar to go first in pilots:** at least 155 right and at most 8 wrong drafts on R180 (today's
first), better on RR than today's first, and held out not lower by more than 2. No choice among runs is made on held out.

**Release by kind of field, not by form.** The model's folder carries `types-released.json`: the field types (and
the built-in functions) on which it passes on UF, each with at least 30 cases, 90% right and no more than 1% wrong
drafts. A form is served by ours if every field it has is of a released type and the choose pass passes on UF. This is
what lets a new form be served with no retraining. `forms-trained.json` and `forms-released.json` are retired for v3
models (the adapter still reads them for older ones).

**Probation for each new form, in the arrangement.** The first time a form appears in a pilot, our draft is recorded
and Sonnet drafts for the world (as `form_unseen` does now) until five seat-confirmed requests on it agree in meaning
with ours and none disagrees; then ours is offered. A disagreement sends the form back to probation and onto a list for
the next data round. The ledger is `runs/translator-model/<model>/probation.jsonl`, read once at a run's start and
recorded in its log, so a run is reproducible. Cost: about five Sonnet calls per new form.

## 5. Serving

- **On the run server's CPU**, as now (`predict.py` sidecar). Choose once, fill once per line, both at 1,024 tokens.
  Today's median is 0.24 s at 2,048; the target is a **median of 0.3 s and a 95th percentile under 1 s** for programs of
  up to three lines. ONNX export with int8 weights is step 6, kept only if it moves no answer on R180 and RR.
- **Arrangement unchanged in shape** (`then`; Sonnet 5.5, prompt 0.9.5, behind; `STANDS` as now). New reasons to go
  behind: `type_unreleased` (a field of a type not released), `probation`. `form_check` stays.
- **Sonnet stays behind** until v3 passes the pass mark on real requests; then the owner decides whether it goes.

## 6. Cost

| What | Plan usage (USD, as Claude Code reckons) | GPU (USD) |
|---|---|---|
| Six pilots (lv-06 was about 7; with seven seats about 12 each) | ~75 | 0 |
| Keying RR (lv-07a/b and three pilots, ~350 cases) | ~20 | 0 |
| Renaming tables, the generated part for new and thin forms | ~35 | 0 |
| Probation calls in later pilots | ~2 | 0 |
| Training: batch 1, three runs; batch 2, one | 0 | ~6 (limit 12) |
| **Total** | **~130 (limit 170)** | **~6** |

A run: about 105,000 rows, two passes, at 1,024 tokens: about 1.8 times round 3's 1,024 control (12.4 min an epoch on
an RTX 5090), about 2.2 hours for six epochs, about 1.5 USD at 0.69 an hour. Plan usage competes with the owner's own
sessions (memory: `claude -p` uses plan usage); pilots are queued, not run together.

## 7. Build order (agent-days; one agent a step unless marked)

| Step | Who | Days |
|---|---|---|
| 0. Cards from the Rust catalogue (`forms::card(name)` exported to JSON, a TS reader; built-in function cards from the contract); the type masks from the resolver's readers; `convert-v3.ts` with its round-trip test and its report; the unseen-forms split | Sonnet 5.5 | 1.5 |
| 1. Queue lv-08 to lv-13 (in parallel with everything after; server time about six days); key lv-07a/b at once, the test pilots as they finish | Sonnet 5.5 | 1.5 |
| 2. Renaming tables, distractors, names-and-dates twins; the generated part | Sonnet 5.5, Haiku 5.5 | 1.5 |
| 3. The two-pass model: choose and fill heads in `model.py`/`slots.py`, export, `predict.py`, the adapter, calibration | Opus 5.5 (cross-cutting) | 2 |
| 4. Batch 1 on RunPod: `v3-s1`, `v3-s2`, and `v3-norename-s1` (the control: is reading by name the augmentation's or the split's) | Sonnet 5.5 | 0.5 |
| 5. Score on every set; `types-released.json`; R180 and RR replayed; timing | Sonnet 5.5 | 1 |
| 6. Probation and the new reasons in `arrangement.ts`; ONNX int8 if it moves nothing; docs | Sonnet 5.5 | 1 |
| 7. Only if step 5 names a data fault: mend, one seed | Sonnet 5.5 | 1 |

**About 9 agent-days (10 with step 7), about two calendar weeks with the pilots' server time.** Each step writes its
STATUS in `runs/translator-v3-<date>/` and an entry in docs/decisions.md; nothing in `runs/` is overwritten or deleted.

## 8. What changes elsewhere

- `contracts/calls.md`: a form chosen by its card; `to=` read from the card. A contract change under the blanket
  approval, logged in `contracts/README.md`. No form in the Rust catalogue has a field named `to`, so round 3's open
  fault of the three forms is gone with the catalogue.
- `translator/src/index.ts`: the prompt-driven translator is shown the same cards (title and `does` added to its form
  lines), so both translators read one thing; prompt 0.9.6, sentences only.
- The resolver: dates already read (lane N); names among those shown and references wait for question 2.

## 9. When we stop

- **UF fill right under 75%, or UF choose right under 90%, on both v3 seeds:** reading by name does not work at this
  size. Stop; `pod-small-r3-long-s1` stays first; report with the evidence for a seq2seq round.
- `v3-norename-s1` within 2 points of the v3 seeds on UF: the augmentation is not what reads; report before batch 2.
- No run meets the bar to go first (155 / 8 on R180, better on RR): today's model stays first; no type is released.
- Wrong drafts on RR above 2% for a run: nothing is released from it.
- The converter sets aside over 5% of rows, or RR's readers disagree on more than a third of its cases: stop and bring
  the rule in question to the owner before training.
- CPU 95th percentile over 1.5 s: release nothing; profile first.
- Plan usage 170 or GPU 12: stop where it stands and report.
- After four runs, whatever the scores, the round ends. No tuning to held out, ever.

## Progress (2026-10-25)

Built and landed on branch `translator-v3`: read twice (section 1, without the field-type masks), the data of section 2
by code (no Haiku table: one synonym table; the generated part templated, not read blind), release by kind and the
trial per new form (section 4, as the owner ruled), the `ambiguous` answer and person-by-name lookup (branch
`tr3-names`; whose names count as shown is open), offline scoring of the test pilots (`translator/eval/rr.ts`). Batch 1
ran (two seeds; the control stopped at epoch 3). Section 9 fired: no run meets the bar to go first and RR's wrong drafts
are above 2%, so nothing is released and `pod-small-r3-long-s1` stays first. Numbers and the question for the owner:
docs/decisions.md, 2026-10-25 "Translator v3".
