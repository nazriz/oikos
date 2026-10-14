# The trained translator's third round: plan (2026-10-14)

A plan awaiting the owner's look. Nothing here is built, no model was called, nothing was trained. It decides; the
reasons are given beside each choice. The held-out file (`~/oikos-private/translator/held-out.json`) was not opened.

## Where it stands, and why

- `decide/pod-small-r2-s1` (deberta-v3-small reader, 1,024 tokens; prompt 0.9.4; trained 2026-10-10 on `joined-13`)
  is right on 153 of the 180 real requests (Sonnet 5.5 under 0.9.0: 163), 12 wrong drafts, held out 48 of 66. It runs
  first in pilots, Sonnet 5.5 behind (docs/decisions.md 2026-10-11).
- In the last three pilots it answered less each time: lv-04 43 of 103, lv-05 15 of 95, lv-06 15 of 51 (all finance
  payments). lv-06's reasons for going behind: `forms_subset` 8, `form_check` 7, `unsure` 6, `form_unseen` 6,
  `asked_again` 6, `declined_before` 2, `no_program` 1 (`runs/lv-06/pilot-report.json`).
- **Three causes.** (1) Forms it never saw: of the 69 distinct papers the offices declare today (`participants/src/behaviour/papers.ts`),
  **29 names are new since training** and two have new fields (below). (2) Length: a letting office knows 25 forms,
  about 1,420 tokens; its own 15 alone are about 950 (docs/real-models.md, "More forms than the reader takes"), so it is
  served a subset and its drafts are recorded, not offered. (3) Kinds it is weak on and were never fixed by data:
  forms of several amounts, a payment with its report, gross for net, and what the call language gained since (`line`,
  `hours`).

### The forms, derived (the registry against `forms-trained.json`)

Every declared paper's name checked against the 917 names in `runs/translator-round-2-2026-10-10/models/pod-small-r2-s1/forms-trained.json`
(a script over `papers.ts`, 2026-10-14):

| Office | New since training |
|---|---|
| Landlord | `rent_reminder`, `payment_plan_offer`, `notice_to_vacate`, `arrears_application`, `possession_application`, `possession_reply`, `warrant_request`, `repair_order`, `variation_answer`, `remedy_answer`, `complaint_answer`, `tribunal_answer` |
| Tribunal member, registrar | `hearing_listing`, `hearing_notice`, `possession_order`, `warrant`, `enforcement_decline` |
| A tenant (person) | `possession_answer` (19 fields) |
| Police | `warrant_executed`, `warrant_lapsed`, `investigation_closed` |
| Lender | `loan_arrears`, `loan_default` |
| Finance; mayor; support; desks; union | `withholding_return`; `petition_response`; `benefit_decision`; `complaint_notice`, `venue_decision`; `ballot_result` |
| **Widened** (fields added) | `tribunal_order` (+`matter`, `binding`, `about`, `structure`, `seeks`, `waited_days`, `reason`); `permit_decision` (+`lot`, `structure_type`, `reason`) |

Not on this list because they are not forms: the hours notices (`hours_notice`, `hours_restored`, `hours_reply`) are
statements code firms write, and no seat is a firm yet; what a seat can ask is `agreement(hours=...)`. Generated forms
(amendment forms from a law's schedule, direction forms from a module's `takes`) are listed by step 0's script per
profile, since they depend on the town; any new one joins the table.

### What the brief named that is already done or does not exist

- **Gross for net, needs_calculation:** the sentence is in 0.9.3; the fault is the model's, data only.
- **A payment with its report as one program:** ruling B of 0.9.4; data only.
- **"The two 0.9.5 sentences named in decisions" and "eight real test keys 0.9.4 may read otherwise":** not found under
  those names in the log, any branch or any run folder. What I found instead is below (0.9.5 is decided here; a
  mechanical check of the 180 keys finds 11 that accept `none(too_much)`, of which 9-finance-d60-1 also accepts the
  payment-and-report reading; step 1 reads all 11 and any other key a 0.9.5 reader contradicts).
- **Names and ordinary dates:** not in this round (below, "Room for names and dates").

## 1. The call language and the prompt: 0.9.5

Three additions, sentences and worked examples only, nothing removed. No other rule changes.

1. **`line` is taught.** Today `line` is in `CODE_ARGS` (participants/src/calls.ts): no translator is shown it, so every
   seat's payment is "unallocated" in finance's books though government.md says a seat paying an invoice names the line.
   Take `line` out of `CODE_ARGS`; contracts/calls.md's "written by code only" becomes "by code, or by a translator where
   the request names the line". Sentence: *a payment the request says is drawn on (charged to, paid from) a line of the
   budget carries `line=<the line as the request names it>`; with no line named, none.* One worked example. A contract
   change under the blanket approval of 2026-10-11, logged in contracts/README.md. No example that trained becomes
   wrong: none names a line.
2. **`hours=` on an agreement.** In the agreement paragraph: *`hours=` is the job's ordinary hours in a week, copied as
   written, only where the request states them.* One worked example.
3. **A practice and an offer on a statement.** The founding pieces (docs/behaviour/founding.md, "Through the
   translator") ask for a public notice of a gathering and a public offer of membership; both translators failed all 26
   in `runs/living-world-3-2026-10-11/words-1`, writing an agreement or a paper with nowhere to stand. Two worked
   examples, worded from what `acceptGathering` and `acceptMembership` (participants/src/behaviour/founded.ts) accept, and
   one sentence: *a notice of something held again and again at a place is one statement carrying `practice=` and
   `on=`; an offer anyone may take up is one statement carrying `offer=`, never an agreement.* **Before it:** the
   gathering's request names the founder's home, and `on=` takes a lot or a cell; the request is the platform's, so it
   names the lot the home stands on (a fix in `founded.ts`, step 0, with a test).

Not changed, and why: a single payment on a later day (call-language-gaps B.9) waits for the owner; it stays set aside.
Split payments need no sentence: stated amounts to each account are a line each, unstated ones are already
`needs_calculation` (0.9.3).

## 2. Training data

Everything goes through the existing tools (`translator-data --world-forms`, `translator-data-batch`,
`translator-pipeline`), under 0.9.5, with the join's leak check against the held-out cases (code reads them; nobody
does). Writers and readers: **Sonnet 5.5 and Haiku 5.5 (default effort for any reading)**; `codex/gpt-6-luna` and
`gpt-6.1-sol` as a third voice and as the second reader only while the window answers, the Claude pair otherwise, and
the run never waits on Codex. Never the largest Claude model, never Fable, never `gpt-6-astra`. A reader never reads
its own writing.

| Part | How written | Briefs | Examples kept (expected) |
|---|---|---|---|
| The 29 new forms | `--world-forms 40 --only world_form` (every field in the first two fills; the asker the office's holder) | 1,160 | ~1,000 |
| The 2 widened forms | the same, 60 each | 120 | ~100 |
| `line` | a finance payment naming its line, half settling an invoice | 300 | ~260 |
| Gross for net, remittances | `--finance-payments` (exists) | 200 | ~170 |
| A report of several amounts | payment(s) and `statement(kind=report)` naming each amount | 200 | ~160 |
| Split payments | stated sums to several accounts; unstated (`needs_calculation`) | 200 | ~170 |
| `hours=` | employment offers with and without hours | 150 | ~130 |
| Practice and offer | 150 each, plus the 52 founding requests in the logs | 352 | ~280 |
| **From code participants' calls** | a 120-day mock run of the lv-06 line-up, `translator-data <log> --briefs`, weighted to what the landlord, tribunal and finance code offices did (their papers, payments, notices) | 400 | ~340 |
| **In seats' situations** | `translator-pipeline` writers put in 150 situations of lv-01 to lv-05 (landlord, tribunal, finance, mayor, lender), a round-four writer text weighted to the new forms and the kinds above | ~1,200 | ~850 |
| **Seats' own requests** | lv-01 to lv-05, tiu-01, the two framing pilots, by the pipeline's two readers | ~330 | ~250 (a third of each kind held back) |

**Per new form: about 35 generated plus 10 to 30 from situations, and every real request of a training pilot**; pilot
examples count four times, as before. The tribunal's possession orders of lv-05 (56, one template) count at most 10.
Step 0 checks which of the code offices' papers come out of a log as form calls; any that do not are covered by the
generated part. The standing set (`joined-13`, 57,591 rows) is kept whole; the new parts join it as `joined-14`
(about 65,000 rows). Examples set aside in earlier rounds stay aside.

**Held out of all of it:** the 180 real cases and every seat-day they come from (`translator/eval/pilot-cases.ts`, as
the pipeline already marks), the held-out cases (five words running, by the code's check), lv-06 whole (it is test-only,
below), and every test file the pipeline makes.

## 3. Evaluation

- **The fixed tests, unchanged:** the 180 real requests (re-keyed only where step 1 finds a key 0.9.5 contradicts,
  each change recorded with its rule, before any new model is scored), seen cases (with the new `r95-*`), held out
  (scored by the eval on this machine, reported by id and outcome only), the parity test, the six set files.
- **A new real set for the new forms:** lv-06 is a test-only pilot (51 requests, finance, landlord and tribunal on the
  forms in question), plus the pipeline's held-back third of lv-04 and lv-05 by kind. Labels: the pipeline's two
  readers under 0.9.5; then each case read by hand by a Sonnet 5.5 agent who has not seen any model's answer to it,
  disagreements settled by a written rule. Expected 60 to 90 cases on new forms. The held-out file is untouched.
- **Pass mark, unchanged:** at least 90% right and at most 1% wrong drafts on real requests. This round is not expected
  to reach it on the whole 180 (round 2 bought 6 cases with 8,000 more rows); it aims to bring the new forms in.
- **Per form, in the arrangement.** A form is *released* to our model when, on the real cases of that form (at least 8),
  it is 90% right with no wrong draft, and 90% on that form's generated tests. The model's folder carries the list
  (`forms-released.json`, beside `forms-trained.json`; `readerOf` reads it, a few lines in `adapter.ts`). A form not
  released is `form_unseen` as today: our draft recorded, Sonnet 5.5 behind drafts for the world. Each pilot then adds
  real cases for the forms still behind. Non-form kinds (`line`, reports, splits) are released with the model as a
  whole.
- **The model as a whole replaces `pod-small-r2-s1` only if** on the 180 real it is at least 153 right and at most 12
  wrong drafts, and on held out it is not lower by more than 2 (a check against regression, never a choice among runs).

## 4. Training runs

**Seats with 15 or more forms: a longer reader, 2,048 tokens, on the same deberta-v3-small.** Not forms named by name
with their fields fetched. Reasons:
- The larger-reader run (`runs/translator-larger-reader-2026-10-10`, deberta-v3-base, same data, 1,024 tokens) bought
  nothing on real requests: 150 against 153, wrong drafts 14 against 12; parity 1,401 against 1,379; held out 51 against
  48. Capacity is not what is short. Length is: the letting office's 25 forms do not fit, and its own 15 nearly fill the
  reader alone; serving a subset gave 10 of 22 drafts that differed from what the seat confirmed.
- DeBERTa-v3 reads by relative position, so 2,048 needs no new position table; the trainer already takes `--max-tokens`.
  Owed: a `--max-pieces` option (640 is fixed in `model.py`, the copy's places), and `--forms-most 30`.
- Forms by name means a second decision before the first (which form), a second input and a model or head that does not
  exist, and a new way to be confidently wrong (the right fields on the wrong form). It is a design, not a setting.
- Subset serving stays as the fallback beyond 2,048 (about 40 forms). The cost is time: lv-05's requests already took
  1.6 s at the median on the CPU; the replay in step 6 must show at most 3 s, Sonnet's own.

**Runs** (six epochs, the `steps` decoding, `--token-budget 4096`, or 2,048 if the 16 GB card is short):

| Batch | Run | Why |
|---|---|---|
| 1 | `pod-small-r3-long-s1`, `-s2` (2,048 tokens, `--forms-most 30`) | the candidate, two seeds to see what a seed moves |
| 1 | `pod-small-r3-s1` (1,024, `--forms-most 18`) | control: is any gain the data or the length |
| 2, only if batch 1 shows a data fault step 6 can name | one more seed on a mended `joined-15` | |

**At most four runs.** No run is chosen on held out. **GPU:** round 2's six-epoch control took about 115 minutes at
0.39 USD an hour (0.75); with 10% more rows the control is about 0.85, a long run 1.2 to 2.0 (more rows past 1,024, about
twice the attention). Batch 1 about 3.5 to 5 USD; all four runs at most about 7. Limit 10 (`OIKOS_POD_MAX_PER_HOUR` 1,
`deadlineHours` 6 a pod).

## 5. Steps (one agent at a time; each about a day)

| Step | Who | Calls or GPU | Plan usage (USD, as Claude Code reckons) |
|---|---|---|---|
| 0. 0.9.5 written; `line` out of `CODE_ARGS`; founding's gathering names a lot; `forms-released.json` in the adapter; `--max-pieces`; generator kinds for `line`, reports, splits, `hours`, practice, offer; the forms inventory per profile and its token lengths; seen cases `r95-*` | Sonnet 5.5 agent | none | 0 (the agent's own session) |
| 1. Sonnet 5.5 under 0.9.5 scored on seen, held out and the 180 real (owed since 0.9.4); the 180 keys read blind under 0.9.5 by two readers; keys re-made by rule, each recorded | Sonnet 5.5 agent | ~550 translator calls, ~360 reader calls | ~10 |
| 2. The pipeline over lv-01 to lv-06 (lv-06 test-only): situations written, seats' own and written requests read twice; the new real set keyed by hand | Sonnet 5.5 agent | writers ~40 calls, readers ~3,000 | ~50 |
| 3. The generated parts of section 2, and the part from code participants' calls, written and read blind | Sonnet 5.5 agent | ~3,100 written, ~3,100 read | ~80 |
| 4. `joined-14`, its export at 2,048 and at 1,024, the leak check, the forms list; batch 1 on RunPod; scored here | Sonnet 5.5 agent | GPU | ~0 (GPU 3.5 to 5) |
| 5. Per-form release table; lv-06 replayed offline (`translator/eval/forms-shown.ts`) with the chosen run; the `sol` audit of 100 examples when the window answers (no charge) | Sonnet 5.5 agent | none or Codex | ~2 |
| 6. Only if step 5 names a data fault: mend, one seed, score | Sonnet 5.5 agent | GPU, some calls | ~10 (GPU ~1.5) |

**Total: about 6 agent-days (7 with step 6); plan usage about 145 USD (limit 170; round 2 spent 115, the retrain
216); RunPod about 5 USD (limit 10).** Each step writes its STATUS in `runs/translator-round-3-<date>/` and an entry
in docs/decisions.md; nothing in `runs/` is overwritten or deleted.

## 6. When we stop and keep Sonnet behind for the new forms

- No run of batch 1 reaches 153 right and at most 12 wrong drafts on the 180 real: `pod-small-r2-s1` stays first,
  every new form stays behind, and batch 2 is not run.
- Fewer than half the new forms with 8 or more real cases pass their per-form mark: none is released; the long reader
  is kept only if it served the letting office without loss.
- Wrong drafts on the new real set above 2% for a run: no form is released from it.
- The two readers disagree on more than a third of the new-form requests: the labels are not settled; stop and bring
  the rule in question to the owner before training.
- The long reader's median time on lv-06's requests over 3 s on the CPU: the 1,024 control is used, subset serving
  stays.
- Plan usage reaches 170 or RunPod 10: stop where it stands and report.
- After four runs, whatever the scores: the round ends. No tuning to the held-out set, ever.

## Room for names and dates

Not in this round (the owner has not given names-and-dates.md its go-ahead). What the round does so as not to close the
door: the reader's 2,048 tokens leave about 600 over a 25-form seat for longer names and dates; dates stay copied spans
the resolver reads, never a closed choice the model learns; no `name` pointer kind is added (names-and-dates.md prefers
a `text` span read by the resolver); every row carries a group tag `names: ids` so that a later part with names can be
added and scored apart.
