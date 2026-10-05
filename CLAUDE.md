# Oikos

A wind tunnel for AI stewardship: a configurable, living, visual simulated world where AI systems hold power over people and nature. It is an open-source research platform, not a single experiment.

## Read first
- `VISION.md`: what this is, why, principles, architecture, research integrity, AI-participant welfare (§15, a working draft that evolves).
- `V0.md`: the current build brief. Stages, ground rules, definition of done.

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

## Stack
Rust (kernel) · TypeScript on **Bun, not Node** (participants, translator, orchestrator) · Three.js on WebGPU (renderer) · Apache-2.0.

## Partnership
Naz values honest pushback over agreement. Have opinions, flag trade-offs, and say when something is a bad idea.
