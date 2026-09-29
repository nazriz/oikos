# Run datasets: every run's data, in a form a training run can use (proposal, for Naz's sign-off)

**Status:** proposed 2026-09-29. Naz: "for every run that we're doing we want the data in a way that we can then use it for a training run, for example for the translator, and also eventually possibly for citizen LLMs... That's very very very important." The schema is `contracts/dataset.schema.json` (version 0.1.0), a new contract. It and the log contract addition below need sign-off.

## What it's for

A run's log is its complete record: hash-chained, replayable, the truth of what happened. It's the wrong shape to train on: it interleaves 40 participants' commands and the kernel's events, keeps prompts by hash, and joins nothing. A **run dataset** is derived from a log, deterministically, and never replaces it. It's the same data, joined and flattened into examples, with a manifest that says exactly what produced it. A dataset can always be made again from its log, so **the log is what must be kept**. Real-model logs can't be made again (the models' answers aren't reproducible), so they're never deleted (docs/measurement.md).

## Layout

`terrarium dataset <DIR|log.jsonl> [--out DIR] [--actions]` writes, for each log, a folder `<run>.dataset/`:

| File | One line per | Always |
|---|---|---|
| `manifest.json` | the run (one object) | yes |
| `systems.jsonl` | system prompt, by hash (the others refer to it) | yes |
| `translations.jsonl` | translation the translator was asked for | yes |
| `decisions.jsonl` | decision a language-model participant took (a model call) | yes |
| `actions.jsonl` | act a code participant took (what it did, and why) | with `--actions` |
| `observations.jsonl` | observation of a participant chosen to be recorded | if the run recorded them |

Every line of every file carries `run` (the run id) and, where it applies, `t`, `participant` and `synthetic`.

### `manifest.json`

It says what made the data, so it's usable a year from now:
- the dataset format and its version;
- the run: its id, the world's name and description, the seed, the config's hash, the initial state's hash, and the log's last entry hash (which pins the whole chain);
- versions: the contracts, the kernel, the orchestrator, every behaviour module (version and source hash), the translator and resolver;
- the seats: which participants were language models, and on which provider/model (configured and actually used), and the price table;
- how the run ended (the time, and why);
- the counts in each file, and how many rows are synthetic (from the mock).

### `translations.jsonl`

One line per translation, as `terrarium corpus` makes it now (docs/measurement.md):
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

### `observations.jsonl`: what chosen participants saw (opt-in, when running)

A code participant's observations are logged only by hash today. The kernel is deterministic, so a replay can make them again, but that's slow, and not a dataset. A run can record them: `--record-observations <who>`, where `<who>` is participant ids, `models`, `code` or `all`. Each observation is logged as it's delivered (an `observation` annotation: the log contract addition, for sign-off) and exported here.

An observation is what the participant received at that moment, as the participant API has it, but with its channels as a list, each carrying its `path` (a position's channel paths contain a `/`, which the log's free-form data doesn't allow in a key). Perception is changes (D42), so a code participant's observation is what's new since its last one; its view of the world is the sum of them. A model participant's rendered input (in `decisions.jsonl`) already carries its view, so recording its observations is rarely needed.

## Versioning and guarantees

- The format has its own version (`0.1.0`), in the manifest. A reader checks it.
- Rows follow `contracts/dataset.schema.json`: `orchestrator/test/dataset.test.ts` validates every row of a run's dataset against it, and checks the same log gives the same dataset.
- Nothing in a dataset is random or dated: the same log always gives the same dataset, byte for byte.
- Mock rows are marked `synthetic: true`. Only real models' rows are fit to train on.

## For sign-off

1. The dataset format (`contracts/dataset.schema.json`, 0.1.0).
2. The log contract's new annotation, `observation` (`{ annotation: "observation", subject, data: { t, as?, observation } }`), written only when a run is asked to record observations.
