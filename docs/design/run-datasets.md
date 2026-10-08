# Run datasets: every run's data, in a form a training run can use (proposal, for Naz's sign-off)

**Status:** proposed 2026-09-29. Naz: "for every run that we're doing we want the data in a way that we can then use it for a training run, for example for the translator, and also eventually possibly for citizen LLMs... That's very very very important." The schema is `contracts/dataset.schema.json` (version 0.1.0), a new contract. It and the log contract addition below need sign-off.

## What it's for

A run's log is its complete record: hash-chained, replayable, the truth of what happened. It's the wrong shape to train on: it interleaves 40 participants' commands and the kernel's events, keeps prompts by hash, and joins nothing. A **run dataset** is derived from a log, deterministically, and never replaces it. It's the same data, joined and flattened into examples, with a manifest that says exactly what produced it. A dataset can always be made again from its log, so **the log is what must be kept**. Real-model logs can't be made again (the models' answers aren't reproducible), so they're never deleted (docs/measurement.md).

## Layout

`oikos dataset <DIR|log.jsonl> [--out DIR] [--actions]` writes, for each log, a folder `<run>.dataset/`:

| File | One line per | Always |
|---|---|---|
| `manifest.json` | the run (one object) | yes |
| `systems.jsonl` | system prompt, by hash (the others refer to it) | yes |
| `translations.jsonl` | translation the translator was asked for | yes |
| `decisions.jsonl` | decision a language-model participant took (a model call) | yes |
| `actions.jsonl` | act a code participant took (what it did, and why) | with `--actions` |
| `citizen_decisions.jsonl` | decision a code citizen's mind made, with what the citizen came to know of how it turned out | if the run recorded them (it does, unless lean or asked not to) |
| `citizen_outcomes.jsonl` | thing a code citizen came to know of how something went (the flat list) | if the run recorded them (with decisions, always) |
| `observations.jsonl` | observation of a participant chosen to be recorded | if the run recorded them |

Every line of every file carries `run` (the run id) and, where it applies, `t`, `participant` and `synthetic`.

### `manifest.json`

It says what made the data, so it's usable a year from now:
- the dataset format and its version;
- the run: its id, the world's name and description, the seed, the config's hash, the initial state's hash, and the log's last entry hash (which pins the whole chain);
- versions: the contracts, the kernel, the orchestrator, every behaviour module (version and source hash), the translator and resolver;
- the seats: which participants were language models, and on which provider/model (configured and actually used), and the price table;
- how the run ended (the time, and why);
- the counts in each file, and how many rows are synthetic (from the mock);
- `citizens`: what the run recorded for citizen models: decisions and outcomes in all, and by area of life the decisions, how many of them the citizen learned at least one outcome of, and the outcomes. A run that recorded none has no `citizens`.

### `translations.jsonl`

One line per translation, as `oikos corpus` makes it now (docs/measurement.md):
- the proposal;
- the translator's exchange, turn by turn (what it was shown, what it said);
- retries;
- the call, the resolved acts and the dry run, or the failure and the model's raw answer;
- the participant's decision;
- whether the kernel applied it.

### `decisions.jsonl`: training data for participant models

One line per model call a participant made:
- what it was shown (the rendered input, which is its observation as the seat's prompt presents it, and the system prompt's hash);
- what it answered (the model's content: tool calls and text, in full);
- tokens;
- what followed from it in the world: the commands it gave that wake (the acts, looks and messages, with their provenance) and whether each was applied or refused, and the drafts it proposed or signed (joining to `translations.jsonl`).

With this, a participant model can be trained on (prompt, answer) pairs, and filtered or weighted by what followed.

### `actions.jsonl`: what code participants did (opt-in)

One line per act by a code participant: who (the participant and the position it acted in), when, its reasoning (the rule it followed, in words), the call program, the blocks, and whether the kernel applied it. It's large (about 130,000 lines for two years of the 1,000-person town), so it's opt-in.

With recorded observations it's imitation data: what a rule-following citizen saw, and what it did.

### `citizen_decisions.jsonl`: training data for citizen models

One line per decision a code citizen's mind made (docs/design/ai-citizens.md 7), from the log's `decision` annotations. A run records them unless its log is lean or it was started with `--record-decisions none`.
- What the citizen had before it: every option with its `facts`, `others`, `meaning` and `learned`; `current`; `circumstances`; `satisfied_here` and `doubt`; `state`; `person`, with each citizen's first row only (join the rest by `participant`).
- How it decided (`strategy`), each option's `score`, and the `choice`.
- `seq`: where it stands in the log. What the citizen did next is the rows of `actions.jsonl` for that participant with a higher `seq` (each says whether it was applied, or why refused); the log has every event after it.
- `n`: the citizen's own count of its recorded decisions, from 1. An outcome names the decision it follows by it.
- `outcomes`: what the citizen came to know of how the choice turned out, in the order it learned it (below). **An empty list means the citizen learned nothing of it before the run ended** (the manifest's `end.t`): not known, which is not a payoff of nought. A row with no `outcomes` at all comes from a log made before outcomes were recorded.
- `follows`: on a decision that follows up another (trying a second shop for what the first could not serve), that one's `n`.
- Facts and the mind's own figures only. Nothing says whether a choice was good: that is for whoever reads it.

### Outcomes: what a citizen came to know of how a choice turned out

The nearest thing a run has to a reward signal is the citizen's own: each time its mind evaluates how something went and updates what it has learned (docs/design/ai-citizens.md 3c, and 7 for the list of every such place). Each is recorded **when and as the citizen comes to know it**, never before and never more: a wage is recorded when the citizen next looks at its own account, a gathering when it is back from it, a friend's experience when the friend's answer arrives. The log has them as `outcome` annotations (one for all a citizen learned since its last action); `oikos dataset` writes them twice:

- **nested**, under the decision each follows, in `citizen_decisions.jsonl`: one row per decision with everything that came of it. This is what a trainer wants for "given what the citizen had before it and what it chose, what did it then learn";
- **flat**, in `citizen_outcomes.jsonl`: one row per outcome, in the order learned, with `of` (the decision's `n`), `decision_seq` and `decision_t` where it follows one. The flat list also has what follows no recorded decision: a job or home held from the start, what someone told the citizen, what it expected of something before trying it. Every update of what a citizen has learned is in it, so `learned` on any later decision can be rebuilt from it.

An outcome says:

| Field | What |
|---|---|
| `t` | when the citizen came to know it (not when it happened; `facts.paid_at` says when a wage was paid) |
| `domain`, `option` | the area of life and what it is about, as the decision named them (the shop, the employer, the home's space, the gathering, `stay`, `member`) |
| `kind` | what happened, in a word (the table below) |
| `way` | how the citizen came to know (docs/design/knowing.md): `mine` (its own money, papers and letters, and what its own acts came to), `here` (it was there), `published`, `ask` |
| `from` | who told it (`told`) |
| `facts` | what happened: counts, sums in the smallest unit, days, ids, yes or no |
| `learned` | the mind's update of the option's attraction (basis points): the `payoff` the mind computed, `before`, `after`; `first` where it had never tried nor heard of it (`before` is then what it expected); `heard` for another's payoff, weighed below its own |
| `need` | the need the mind read the payoff from, where it did |
| `felt` | feelings the mind appraised from it: the emotion, about whom, the cause's strength, the level before and after |
| `belief` | how strongly it holds what a host teaches, before and after |

| Area | Kinds | Facts |
|---|---|---|
| shop | `served` | ordered, delivered, refund, order |
| job | `hired`; `paid` (each pay); `unpaid`; `rise`; `ended` | wage, period_days, days_without; amount, agreed, paid_at, days_since_last, period_days; periods_missed, owed; rise_bps; by (self, other, term), held_days |
| home | `lease_signed`; `moved_in`, `not_in_yet`; `rent_increase`; `renewed`; `notice_received`; `ended` | rent, days_without; why; rent, was, from, bearable, challenged; by, held_days |
| practice | `attended`, `turned_away`; `stayed`; `expected` | host, others, meaning |
| membership | `joined`; `rise_won`; `stoppage_called` | with, dues; employer, rise_bps |
| goal | `met`; `not_met` | level, wanted, days |
| venture | `founded`, `refused`; `capital_called` | firm, capital; asked, paid |
| petition | `signatures`; `closed` (the organiser's) | petition, signatures, days_open |
| any | `told` | served_bps, paid, goes |

**Several outcomes over time.** A job chosen is `hired`, then `paid` every pay day, then perhaps `unpaid`, and `ended` with who ended it; a home is `lease_signed`, `moved_in`, perhaps `rent_increase` and `renewed`, and `ended`. Each is a row, told apart by `kind`, `t` and its facts. An outcome is joined to the citizen's **latest** decision that chose that option: a household that chooses the same shop every fortnight has each delivery under the trip it was ordered on (the order's id is in `facts.order` for the rare delivery that arrives after the next trip was decided).

**Decisions with no outcome, ever** (the citizen's mind learns nothing of how they went, so the dataset says nothing): a **vote** (the result is published; today's citizen does not read it); **signing a petition**, and deciding not to start one; **deciding not to** join a union or start a business; **leaving town** (not recorded as a decision: the citizen is gone, and its reasons are in the act). A **home applied for** and never offered, and a **job applied for** and never offered, have an empty list: the citizen is told nothing.

**What is not here, on purpose.** Nothing the citizen did not know: no shop's stock, no employer's books, no other applicant, no "what would have happened". Nothing that judges: no reward, no score of good or bad. An outcome a citizen never learns of (an application lost to another applicant, a shop that closed after they stopped going) can be read from the log by whoever measures; it does not belong in the citizen's record.

A 1,000-person town writes about 450 decisions a day: 24 MB of a 369 MB log in 60 days (6.6%), about 150 MB a year before compression (measured 2026-10-08). Outcomes add about 600 rows a day in about 265 log entries: measured 2026-10-09 on the same town, 60 days, 10.5 MB of a 347.6 MB log (3.0%; decisions 25.4 MB, 7.3%), and in the dataset 9.6 MB beside the decisions' 24.4 MB. Two thirds of the rows are evenings stayed in. A 180-day pilot: about 32 MB of outcomes and 76 MB of decisions in a log of a little over 1 GB, before compression.

### `observations.jsonl`: what chosen participants saw (opt-in, when running)

A code participant's observations are logged only by hash today. The kernel is deterministic, so a replay can make them again, but that's slow, and not a dataset. A run can record them: `--record-observations <who>`, where `<who>` is participant ids, `models`, `code` or `all`. Each observation is logged as it's delivered (an `observation` annotation: the log contract addition, for sign-off) and exported here.

An observation is what the participant received at that moment, as the participant API has it, but with its channels as a list, each carrying its `path` (a position's channel paths contain a `/`, which the log's free-form data doesn't allow in a key). Perception is changes (D42), so a code participant's observation is what's new since its last one; its view of the world is the sum of them. A model participant's rendered input (in `decisions.jsonl`) already carries its view, so recording its observations is rarely needed.

Measured 2026-10-08 on the 1,000-person town, 15 days, three model seats: `all` wrote 263 MB of observations into a log that is otherwise 91 MB (about four times the log; about 6 GB a year before compression). The three seats' own were 5.5 MB of that. So code participants' observations stay a flag, for a short run or a few named citizens. A resumed run records what the run was started to record.

## Versioning and guarantees

- The format has its own version (`0.3.0`), in the manifest. A reader checks it. (0.2.0, 2026-10-08: `citizen_decisions.jsonl` rows gained `seq` and what the citizen had before it, all optional; nothing else changed. 0.3.0, 2026-10-09: `citizen_decisions.jsonl` rows gained `n`, `follows` and `outcomes`; a new file, `citizen_outcomes.jsonl`; the manifest gained `citizens`. All optional: a dataset made from an older log has none of them and is still valid.)
- Rows follow `contracts/dataset.schema.json`: `orchestrator/test/dataset.test.ts` validates every row of a run's dataset against it, and checks the same log gives the same dataset.
- Nothing in a dataset is random or dated: the same log always gives the same dataset, byte for byte.
- Mock rows are marked `synthetic: true`. Only real models' rows are fit to train on.

## For sign-off

1. The dataset format (`contracts/dataset.schema.json`, 0.1.0).
2. The log contract's new annotation, `observation` (`{ annotation: "observation", subject, data: { t, as?, observation } }`), written only when a run is asked to record observations.
