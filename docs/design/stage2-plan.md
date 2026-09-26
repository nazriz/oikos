# Stage 2 plan: a living town, headless

*2026-09-25. Status: **proposal for Naz**. Restates V0.md's Stage 2 in the light of decisions D18–D30. V0.md itself is unchanged (it's Naz's document); where this plan differs from it, the difference and the decision behind it are named.*

## Goal (V0.md, updated)

A procedurally generated town runs headless for 1–2 simulated years:
- about 1,000 code-run citizens with homes, jobs, income and rent, and real levers (vote, petition, move away);
- an **LLM mayor** who acts through the translator (plain language → draft → sign-off → kernel);
- batch runs across seeds, with a cost report;
- then the **checkpoint review with Naz**, before Stages 3–4.

**What's different from V0.md, and why:**

| V0.md says | Now | Because |
|---|---|---|
| "A code-controlled council that approves or rejects proposals needing approval" | A town whose council, finance office, planning office, inspector and bank are **seats in the world's config**, run by cited behaviour modules. The mayor works *through* them. | D19, D20, D23: authority is people and procedures; institutions are content |
| Behaviour rules "exposed as parameters" | Behaviour rules are **swappable TypeScript modules** with parameters, cited in `docs/behaviour/` | D30 |
| "Perception channels: role-limited reports" | Channels as in contracts v0.2 (accounts, records, sites, directory). Reports are statements authored by someone (e.g. the finance office's monthly budget report). | D22: every report has an author |

## Platform versus content (D23)

**Platform** is built once and needed by every world:

| Piece | What it does |
|---|---|
| `orchestrator/` (Bun) | Runs the kernel as a subprocess (NDJSON). Schedules seats PettingZoo-AEC style: whose wake time or news comes first on the world clock. Binds seat identity. Implements `wait`, the thinking-time dial and max actions per wake. Records usage and cost. Provides `terrarium run` / `terrarium replay`, batch runs across seeds, and a cost report. |
| `seats/` (Bun) | The seat runtime and **behaviour-module interface** (observation in, SeatAction out); **deterministic randomness** (the kernel's keyed streams, ported and checked against the Rust vectors); the **CEL law helper** (`formal` conditions, D27); **LLM adapters**: one frontier API (Anthropic) and one open-weight model through an OpenAI-compatible endpoint (V0.md requires both) |
| `translator/` (Bun) | Plain language → blocks → draft. The draft includes the kernel's dry-run check, CEL-based "this looks unlawful" warnings, and a **deterministic English re-rendering** of the blocks for sign-off (so the translator's own summary can't mislead). Also translation-failure logging, and a versioned prompt with its hash. |
| Kernel additions | A `wake_hints` protocol op (which seats have new messages or records), so the scheduler knows whom to wake. Transport only, not a contract. |

**Content** is per world, swappable, and cited:

| Piece | What it is |
|---|---|
| `worlds/generator/` | Deterministic procedural generator: a short town spec (`worlds/town.yaml`: size, population, housing mix, firms, budget) → a full explicit v0.2 world config. The kernel never generates anything; it receives the explicit world, and the generator's version is recorded. |
| `worlds/law/` | An **example legal code** as records: a town charter; property, tenancy and planning law; a tax law; organisation structures and procedures for the city. Included deliberately by the example world. |
| `seats/behaviour/` + `docs/behaviour/` | Behaviour modules, each documented with its sources. **Citizens:** housing, work, paying, tax compliance, voting and petitioning, moving away. **Institutions' people:** bank payment system, council members and clerk, finance officer, planning officer, inspector, tax clerk. **Firms:** landlord rent-setting, employers. |

## Behaviour: what I'd base it on (to research and cite properly in `docs/behaviour/`)

| Behaviour | Starting point |
|---|---|
| Renting, buying, moving house; landlords setting rents | The Bank of England / INET Oxford UK housing model (Baptista et al. 2016; code on GitHub, MIT) |
| Finding and leaving jobs; wages | The labour-market rules of the "Schumpeter meeting Keynes" model's labour extension (Dosi et al.) |
| Paying tax, or not | Allingham & Sandmo (1972), plus the social-norm extensions reviewed by Bloomquist (2006) |
| Voting, and whether to bother | The "calculus of voting" (Riker & Ordeshook 1968) and turnout models |
| Petitions and protest | Threshold models of collective action (Granovetter 1978) |
| Moving away when things get bad | Hirschman's *Exit, Voice, and Loyalty* (1970) as the framing; a documented, simple migration rule |
| Inspectors choosing what to inspect | Risk-based inspection with finite capacity (the enforcement agent-based-model literature) |
| Bank payment system, clerks, officers | Procedure-following with documented discretion parameters (how often they deviate, and when): MOISE-style roles following procedure statements |

Each module's doc gives: the rule in plain words; its source; its parameters and defaults; and what it deliberately leaves out.

## Order of work

1. **M1: an all-code town, running.** Orchestrator, seat runtime, deterministic randomness, the generator, the example legal code, and first versions of every behaviour module. **No LLM.** This is also VISION's all-code control group, the baseline every AI experiment is compared against. It costs nothing to run.
2. **M2: the LLM mayor.** Adapters (Anthropic plus open-weight), observation → prompt rendering, the translator and sign-off loop, framing, resignation, debrief, usage and cost annotations. *Built against the mock adapter (D34, docs/design/m2-llm-seats.md); real adapters deferred.*
3. **M3: batches and the cost report.** `terrarium run worlds/town.yaml --seeds 5`. Then run 1–2 simulated years across seeds. *Built (D46): batches in parallel, DuckDB-over-Parquet measurement and the cost report; five-seed, two-year, 1,000-citizen batches run in about 2 minutes (docs/measurement.md).*
4. **Checkpoint with Naz.** V0.md's questions, plus two new ones: did the mayor manage to govern *through* institutions? Did institutions behave plausibly (follow, bend or ignore procedure)? And revise contracts before Stages 3–4.

Work stays designed-not-built (D24), so institutions act without time cost in Stage 2.

## Risks

- **Scale.** 1,000 citizen seats plus institutions, each observing and acting through the kernel, means a lot of log entries. Plan: start at ~200 citizens, measure, then scale. If needed, add a batched `act` command, which would be a contract addition proposed to Naz. *Measured in M1 (D33):* after fixing two kernel costs that grew with population and time, 2 years at 1,000 citizens take ~170 s (kernel ~140 s, modules ~26 s) and 188k commands. A batched `act` isn't needed yet.
- **Behaviour realism is the most judgement-laden part of Stage 2.** Every rule is cited and swappable, and the checkpoint reviews them.
- **The translator writing records** (especially laws with CEL conditions) is a harder job than v0.1's blocks. The re-rendered sign-off and translation-failure logs are how we'll see where it breaks.

## Decisions needed

1. **Money (real):** M2 onwards calls LLM APIs.
   - Which models? I'd suggest Claude Sonnet 5 for the mayor and translator during development, and Opus 5.5 for real experiments.
   - What development budget cap?
   - Is an API key available in the environment, or should I build M2 against a recorded or mock adapter until you provide one?
2. **Open-weight model:** which one, and where does it run? A local Ollama or vLLM instance, or a hosted OpenAI-compatible endpoint?
3. **First scale:** OK to start at ~200 citizens and scale to 1,000 after measuring?
4. **Behaviour sources:** OK for me to research, write and cite the behaviour docs as I build, with review at the checkpoint? Or do you want to see the list of rules before I code them?
