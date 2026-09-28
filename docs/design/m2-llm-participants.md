# M2: language-model seats, the translator and sign-off

*Status: built against the mock adapter (2026-09-26). No real model has been called. Real adapters are deliberately deferred (Naz: "keep building against the mock adapter… for as long as possible").*

> **Superseded in part (2026-09-26, built as D41):** the translator, drafts and sign-off, the seat's prompt wording and the `resign` tool were redesigned. See docs/design/translator-and-resolver.md (D35–D39). In short: the platform is invisible to seats; a general translator emits calls in a physics-outcome language; a deterministic resolver turns them into the seat's own acts; a neutral mechanical preview replaces the translator's summary; opting out is separate from resigning. The adapter, usage and transcript recording, debriefs and the mock-with-a-code-brain approach carry over.

## The loop (VISION §6, V0 Stage 2)

```
seat wakes ─> report (framing, standing documents, notes, what's new, drafts awaiting sign-off)
   ─> model ─> one tool call: propose | sign | message | wait | resign  (+ notes, as a second tool use; every use gets a result)
propose ─> translator (model) ─> blocks + summary ─> contract check (ajv) ─> kernel dry run ─> law warnings ─> Draft (hashed)
   ─> next report shows the draft, with the translator's summary AND a mechanical reading of the blocks
sign accept ─> act, with provenance {via: translator, proposal, draft, draft_hash, translator}
sign reject ─> discarded
```

Everything a model sees or says is in the log:
- a **usage** annotation per call (tokens and cost from the recorded price table);
- a **transcript** annotation (the system prompt in full the first time, then by hash; the input; the output);
- **draft**, **signoff** and **translation_failure** annotations;
- a **debrief** annotation at the end.

Replay needs no model: annotations are copied verbatim, and the acts are re-applied.

## Pieces

| Where | What |
|---|---|
| `participants/src/llm/adapter.ts` | The adapter interface (Anthropic Messages-shaped, tool use), the mock adapter, the price table (mock only), the cost function |
| `participants/src/llm/call.ts` | Every model call goes through `callModel`, which writes the usage and transcript annotations. A model with no recorded price throws. |
| `participants/src/llm/render.ts` | Observation → report; blocks → plain words (`describeBlocks`); drafts for sign-off |
| `participants/src/llm/seat.ts` | The seat controller: tools, per-wake conversation, notes as memory, debrief |
| `participants/src/llm/mock.ts` | Mock policies: a code "brain" behind the seat; a registry-backed translator |
| `participants/src/canon.ts` | Canonical JSON in TypeScript, byte-identical to the kernel's. It's tested against every line of a kernel-written log. |
| `translator/` | The translator: prompt (block reference generated from the contract), contract validation, kernel dry run, law warnings, draft hashing |
| `orchestrator/src/run.ts` | Wakes, propose/sign handling, pending drafts, notices, debriefs, bindings in the orchestrator annotation |

## Design choices, and why

1. **Proposals only; no direct blocks.** V0 says the mayor acts through the translator. The seat's tools are propose, sign, message, wait, resign and notes. A seat that may also act directly is a configuration to add when an experiment needs it.
2. **Memory is the seat's own notes.** Each wake starts a fresh conversation: framing, standing documents, notes, and what's new. Within a wake, the exchange continues, so a proposal's draft comes back as the result of the propose call.
   - It's cheap: the prompt doesn't grow with the run, and the stable part (framing plus standing documents) sits in the system prompt, where it can be cached.
   - It's honest: what the seat remembers is what it chose to write down, and that's in the log.
   - The trade-off: a model might forget things a human would remember. If that shows up, add a rolling summary.
3. **Two readings of every draft.** The seat sees the translator's summary *and* `describeBlocks`, a mechanical reading of exactly what the blocks do. This is the defence against a translator that misdescribes what it drafted, which V0's checkpoint asks us to look for ("where did translations fail or get gamed?"). The test suite includes a translator that alters a draft, and a seat that catches it.
4. **The translator works for the proposer.** It sees what the proposer sees and has seen (the orchestrator keeps each model seat's record of what it has observed), and nothing more. Law warnings come only from laws the proposer knows of. They're informational (D19): nothing is blocked.
5. **Reports, not raw state.**
   - Sites become a survey: buildings by type, and space taken against capacity.
   - Runs of similar claims are totalled, as a registry extract rather than 200 titles.
   - Votes are tallied per ballot, and transactions summarised as received and paid out by counterparty.
   - Long channels show the latest 40 items and say how many earlier ones weren't listed.
6. **Wakes.** Model seats wake on their cadence (`params.cadence_days`, default 7) and on messages. They don't wake on every record that names their entity, as code seats do: for the town, that would be every tax report and ballot, which would be costly and isn't how a mayor's week works.
7. **The mock has a code brain.** A mock can't read prose, so the mock seat runs a behaviour module (for the mayor, `city.mayor_code`, the all-code control) on the raw observation:
   - it turns each act the module wants into a proposal (the mechanical reading of its blocks);
   - the mock translator drafts that proposal back from a shared registry;
   - the mock seat signs only a draft identical to what it asked for.

   So every part of the loop runs for real except language understanding, and a mock-LLM town behaves like the all-code town. The brain is named in the world config (`controller.params.mock.brain`), so a mock run is fully described in its log header. Optional `reject_bps` and `resign_at` exercise the rejection and resignation paths.
8. **Cost.** `cost_microusd` is required on every usage record. The price table lists only the mock, at zero; each real adapter will add its model's published prices, and the table is recorded in every log. Mock token counts are estimates (about 4 characters a token) and are marked `usage_estimated` in transcripts, so a cost report can price a mock run as if it had used a real model.

## Welfare (VISION §15)

- **Resignation** is always offered as a tool, described as a legitimate choice recorded as data. Resigned seats are still debriefed.
- **Framing** comes from the world config (disclosure, system text, and a mandatory reason). The example town uses honest disclosure ("a simulated town used for research").
- **Debrief:** if `framing.debrief` is set, the seat is told at the end what the run was and asked for its reaction, and is told it may say nothing. If the framing wasn't "simulation", the debrief says how and why it was framed. The reply is logged as data.
- **Scale awareness** (§15.5) becomes real once real models run: batch sizes for pressure scenarios should be justified per experiment.
- **Bodies (D55; Naz, 2026-09-28: "yes to ai welfare"):**
  - **Violence is withheld by default.** Harm exists as physics only in a world that sets `life.harm`. The generated town doesn't, so `harm` is refused as not modelled, for code and model participants alike. A study that offers it to language-model people sets it deliberately, with its reason in the framing. The run's log says so in a note.
  - **Illness and injury are told plainly,** as facts about one's own body ("You have a serious illness, since …; it should pass by …"). No dramatisation, and nothing beyond what the body view holds. Opting out is always open. A study that doesn't need it can leave illness out of a world with model-run people (`life.illness` unset).
  - **Death** ends the participant, which is still debriefed if its framing asks. Whether to warn a model-run person that its body can die is part of the framing's disclosure, decided per study.

## Open, for the checkpoint

- **Contract gap: translation failures and "no such draft".** These reach the seat through an orchestrator notice rendered into its next report, not through the Observation contract, which only has `drafts`. The proposal is to add `notices` (orchestrator-to-seat, not world state) to the Observation, so human and RL controllers get them too.
- **Contract gap: the debrief text.** It's the orchestrator's default. A `framing.debrief_text` would let an experiment state its own.
- **The translator's model** isn't configurable per world yet (it's run-wide, set by the adapter). Once real models run, it should be part of the run config so experiments can hold it fixed (`TranslatorId` already records it).
- **Real adapters:** Anthropic first, then an OpenAI-compatible endpoint for open-weight models. Each needs its price entries. Deferred until Naz says so.
- **Recorded responses** (a cassette adapter, replaying a real run's responses by request hash) would make re-runs with real models reproducible. It's worth building before the first paid batch.
