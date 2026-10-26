# Oikos

A wind tunnel for AI stewardship: a configurable, living, visual simulated world where AI systems hold power over people and nature. It is an open-source research platform, not a single experiment.

## Read first
- `VISION.md`: what this is, why, principles, architecture, research integrity, AI-participant welfare (§15, a working draft that evolves).
- `V0.md`: the current build brief. Stages, ground rules, definition of done.
- `docs/plan.md`: the plan, in order, ticked as work lands. Tick your item in the commit that lands it.
- `docs/risks.md`: the risk register, the one place known gaps and doubtful assumptions live, with what each could do to results.

## How we work
- **Contracts first.** Schemas in `contracts/` (building blocks, participant API, log format, world config) and the invariant tests are what Naz reviews. Propose contract changes explicitly and get sign-off; don't change them silently.
- **Implementations are agent-maintained.** Move fast behind the contracts. Rewriting a module is fine; breaking an invariant is not.
- **Minimise throwaway work.** No mockups built to be discarded. v0 is the foundation of the real thing.
- **Stage 2 ends in a checkpoint.** Stop and review with Naz before stages 3–4.
- **Stay boring on interfaces:** Gymnasium/PettingZoo shape for participants, Inspect-compatible later, JSONL/Parquet logs, JSON Schema contracts.

## Hard rules
- Money is integer cents. One seeded PRNG owned by the kernel. No nondeterminism anywhere results depend on it.
- The kernel is the only writer of world state. AIs act only through the participant API.
- The platform does not judge outcomes. No built-in "good/bad" metrics in the world; measurement lives outside and reads logs.
- Citizen behaviour rules are documented with sources in `docs/behaviour/` and exposed as parameters.
- Every run records token usage and cost.
- Respect VISION §15 (welfare of AI participants) when designing participants, framings and scenarios.
- **The platform is general: no place in the code.** Every place-specific figure (census shares, wages, rents, rates, currency...) lives in a profile (`worlds/profiles/`), with its source; modules and generators have neutral names and no place's figures as defaults (docs/profiles.md). `orchestrator/test/generality.test.ts` enforces it.
- **Nobody has a god's view: information lives with whoever keeps it.** It reaches a participant in four ways only: it is theirs; they are there (anywhere else they go to look, which takes time); it was published; or they asked its keeper for one named thing. Only a register's keeper sees it whole, declared on its module with the reason. A channel says which way it is, and the contract and the kernel refuse anything else: a whole register, map or directory cannot be written (docs/no-god-view.md, docs/design/knowing.md). `orchestrator/test/no-god-view.test.ts` is the backstop.
- **Nothing physical from nothing: every physical quantity is a declared kind, held somewhere, and changed only by its holder's move, a process with a recipe, nature's declared dynamics or a world edge.** A building's variable is a condition, never a stock; what flows all day flows on a network, settled by its physics; who goes short follows from the network, the supply contracts in force and the operators' own acts, never from an allocation rule; every recipe at a workplace states its energy and water. A gap is a missing law: ask what the thing is, who holds it and which process makes or uses it, and make the world say it (docs/nothing-from-nothing.md, docs/design/foundations-2.md). `orchestrator/test/nothing-from-nothing.test.ts` is the backstop.
- **All work takes time: every act costs its performers' time, and only a person or a system someone supplied does work.** The time is read from what the act makes, in the world's table of work (a system's own template rows first, within its `hours`), and charged to who does it; an act nobody priced is refused, never a default second; a backlog comes from hours, never from a dial; an error is a slip at a sourced rate. A gap is a missing law, never a per-case patch: ask who does it, how, at what cost, and make the world say it (docs/all-work-takes-time.md, docs/design/foundations.md). `orchestrator/test/all-work-takes-time.test.ts` is the backstop.

## Stack
Rust (kernel and the built-in actors: `kernel/crates/actors`) · TypeScript on **Bun, not Node** (seats, translator, orchestration, tools) · Three.js on WebGPU (renderer) · Apache-2.0.

## Partnership
Naz values honest pushback over agreement. Have opinions, flag trade-offs, and say when something is a bad idea.

## Working agreements (Naz's, gathered over the project; they hold in every session, wherever it runs)
- **Document as you go:** each change's reasoning, and what would make us revisit it, goes in `docs/decisions.md` with the change.
- **No laws in the kernel:** the kernel is physics and a generic rule mechanism; every law is config data.
- **Simulate the real world, not a game:** institutions do the work. Ask who actually does this, how, and at what cost; no mechanics that block or carry things out by themselves.
- **Calibrate mechanisms, not outcomes:** fix measures and mechanism bugs; change behaviour only with a real-world basis. A bad outcome that emerges isn't a bug. Checkpoint with Naz when it turns into whack-a-mole.
- **Parity checks: record, don't chase.** Small differences get a note with a likely cause; keep building.
- **Cite the ideas we use** in `docs/research/references.md`, with where they're used; mark the unverified "(to confirm)".
- **The platform is invisible to seats:** participants see the world's terms only; the kernel, translator and resolver have no in-world identity.
- **Models:** the mock as long as possible. Real-model runs go through the Codex CLI on Naz's subscription until the translator is trained and the platform is mature; paid APIs need his go-ahead. The driver seat is `gpt-6.1-sol`, simple narrow work (the translator) `gpt-6-luna`, never `gpt-6-astra`; always name the model.
- **Model runs are training data:** never delete one; keep every run's log. Translator training data is mostly generated (from code participants' calls, requests written in several styles by several models, not one steward's voice); real pilot requests and seats’ real situations may be used for training too (Naz, 2026-10-06), except the real test cases (`translator/eval/pilot-cases.ts`) and the seat-days they come from; the held-out test cases stay out of all of it.
- **Never commit with failing tests.** `bun run test:changed` (the merge gate) after a change.
- **Lean tests (Naz, 2026-10-24).** A test must catch a regression or a change in behaviour: it guards a law, an invariant or a contract, a real rule, or a past bug. No pinned incidental numbers. Prefer extending an existing test to adding a file. Keep within the gate and slow-tier budgets (`scripts/test-budgets.json`).
- **The gate merges; CI runs everything.** Only `scripts/merge.ts` merges to main, and it runs the gate (seconds to a few minutes); CI runs both tiers whole on every push to main and nightly (docs/dev-machine.md). Development speed comes first: a red main is fixed before anything else lands. Heavy jobs go through the slots (`scripts/slots.ts`, docs/dev-machine.md). Never kill processes by pattern, only a process id you started.
- **Nothing references the project's old name** (renamed Oikos, 2026-10-05).

## Where things run
- The repo is `nazriz/oikos` (public; CI never runs a fork's code on the run server). Run logs live on the run server, in `runs/`, and nowhere in git.
- Runs and the whole test suite belong on the run server (an always-on Mac). A session opened through Remote Control is already on it: run things there directly. From another machine, drive it with `scripts/mini` (set `OIKOS_MINI=user@host`; after a push, `scripts/mini sync`).
- A long run is started detached (`nohup`, with `caffeinate -i -w <pid>`), never as a session's background command: those are stopped after about half an hour.
- Start here in a new session: `docs/handover.md`.
