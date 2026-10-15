# The rebuild: an architecture that finds its own moles

**Status:** agreed, 2026-09-30. The time model (section 6) and contracts 0.7 (docs/design/contracts-0.7.md) are signed off by Naz; the other decisions in section 15 are engineering calls within his principles, recorded in docs/decisions.md, open to his overruling.
**Diagram:** [Oikos Architecture](https://claude.ai/artifact/4EawWxSAjwTZbhGzh7u5qY) (the "Proposed" tab).

## Contents

1. Why rebuild
2. What doesn't change
3. The target architecture
4. The Rust workspace
5. The TypeScript side
6. Time and scheduling
7. Readings: terms and laws
8. Mole-proofing, built in
9. Contracts 0.7
10. Logs, replay, resume and measurement
11. Performance and scale
12. What the architecture must carry next
13. Testing
14. The rebuild plan
15. Decisions for Naz
16. Risks, and what's out of scope

---

## 1. Why rebuild

### 1.1 The moles we hit

Calibration kept turning up a problem underneath each fix. Looking back at them, most were not about economics at all.

| Mole | Root cause | Class |
|---|---|---|
| The union struck a closed shop for three years | Its private register of members went stale; it never saw the closure | A module's private copy of the world |
| Payments dropped at busy moments (bank, factories) | Modules assumed their steps happened; the wake ran out of actions | A module's private copy of the world |
| Participant ids mistaken for person ids | Two identities for one actor, reconciled by hand in each module | A module's private copy of the world |
| A membership ended by notice still read as "in force" | `Book.inForce()` checks signatures only, and every module relies on it | Semantics derived by hand |
| 23 shopping trips a year, not 26 | A per-period amount spent per wake, and wakes jitter | Time accounting |
| The works department's defaults commented out, so NaN wages | Module parameters untyped and unchecked | Undeclared contracts |
| The union couldn't see closures at all | A module's perception needs aren't declared, so nothing checks the world gives them | Undeclared contracts |
| Randomness, canonical JSON, money and contract types written twice | Two languages, kept in step by tests | Duplication |
| Shops couldn't staff, so orders refunded, so saving | The labour market has no friction; goods prices don't respond to shortages | Modelling |
| Migration comes in bursts | A threshold response with no damping | Modelling |

The kernel's own guarantees held through all of it: money conserved, determinism, byte-identical replay, no laws in the kernel. None of the moles came from the kernel.

### 1.2 The five root causes

1. **Semantics scattered across modules.** What an agreement's terms add up to, who a message is from, whether an organisation still exists: each module works these out for itself, some wrongly.
2. **Simulation semantics living in glue code.** Who wakes when, in what order, on what news, and what happens when a wake runs out of actions are decided in the TypeScript orchestrator. These shape outcomes as much as physics does.
3. **Time accounting tied to wake timing.** Nothing stops a module computing a flow per wake instead of per unit of time.
4. **Undeclared contracts on the participant side.** A module's parameters and perception needs are conventions, not checked declarations.
5. **Slow detection.** A mole introduced today showed up in a 5-year, 3-seed run, 40 minutes later, as a number that looked slightly off.

The rebuild addresses each one structurally (sections 4 to 8). Modelling moles can't be prevented, because emergence is the point of an agent-based model. The aim for those is detection on the day they're introduced, with a named cause.

---

## 2. What doesn't change

These are the platform's commitments (VISION.md, principles 1 to 17), and the rebuild keeps every one:

- **The kernel is physics and records, and the only writer of world state.** It refuses only the physically impossible.
- **Laws have no power of their own.** The kernel never evaluates them.
- **Institutions are content:** people and procedures acting through records. Nothing happens automatically because a rule says so.
- **The platform is invisible to participants.** They see their world, in its own terms.
- **The same interface for every participant:** code, language model, human.
- **Determinism:** one seed, keyed streams, byte-identical replay, a hash-chained log.
- **Measurement lives outside the world** and reads logs.
- **The welfare of AI participants** (VISION §15): framing, opt-out, debrief.
- **No place in the code:** every place-specific figure lives in a profile, with its source.
- **Contracts first,** signed off before building.

The rebuild changes *where* things run and *what is declared*, not what the platform is.

---

## 3. The target architecture

```
                         ┌──────────────── TypeScript: content and glue ────────────────┐
  worlds (data)          │  SEATS           citizens + mind · firms · bank · union ·    │
  profiles · YAML  ──┐   │                  offices · registrar · language-model seats  │
  generator (TS)     │   │  PARTICIPANT HOST  runs seats · view · translator (prompting)│
                     │   │                  model adapters · consult · audits hooks     │
                     │   └──────────────▲─────────────────────────────┬─────────────────┘
                     │     observations │ + readings        actions   │ (calls, words)
                     │                  │                             ▼
                     │   ┌──────────────┴──────── Rust: the engine ────────────────────┐
                     └──▶│  engine    a run: config, the loop, log ordering, replay     │
                         │  time      the clock, simultaneity, acting and thinking time│
                         │  resolver  calls → a seat's own acts; the preview           │
                         │  perception channels, changes, attention; attaches readings │
                         │  terms     reads agreements by their terms (read-only)      │
                         │  law       reads formal conditions (read-only)              │
                         │  kernel    physics and records: the only writer; the log    │
                         │  core      canon · amounts · randomness · ids               │
                         │  contracts types generated from the JSON Schemas            │
                         └────────────────────────────┬────────────────────────────────┘
                                                      │ hash-chained log, checkpoints
                              ┌───────────────────────┼──────────────────────┐
                              ▼                       ▼                      ▼
                      measurement (SQL)     datasets · corpus     renderer (stage 3, WASM)
```

**The rule for what goes where:**

| Where | What | Test |
|---|---|---|
| Rust: `kernel` | Physics and records | Does it change the world? |
| Rust: the rest of the engine | Semantics every consumer must share: time, perception, readings, the resolver, encoding, randomness | Must every consumer get exactly the same answer, or does it shape outcomes? |
| TypeScript | Content and glue: seats' behaviour, prompting and model adapters, tooling, the world generator | Would a researcher change it to run an experiment? |
| Data | Contracts, world config, profiles with sources | Is it a fact about a place or a format? |
| SQL | Measurement | Does it only read what happened? |

---

## 4. The Rust workspace

One Cargo workspace. Crates depend downwards only, and the boundaries enforce the separation of interests.

| Crate | Does | May depend on | Never |
|---|---|---|---|
| `contracts` | Types generated from `contracts/*.schema.json`; schema validation | none | Hand-written wire types |
| `core` | Canonical JSON and hashing, amounts (decimal-string integers with units), keyed randomness, ids, time units | `contracts` | Anything world-specific |
| `kernel` | Blocks, state, records, events; the hash-chained log; checkpoints. **The only crate that mutates the world.** | `contracts`, `core` | Evaluating laws; interpreting terms; scheduling |
| `terms` | Reads agreements by their own terms (section 7) | `contracts`, `core`, the kernel's read-only view | Changing state |
| `law` | Evaluates formal conditions (the CEL subset) against an act and the records | `contracts`, `core`, the read-only view | Being called on the kernel's write path |
| `perception` | Channels, changes, attention, position; attaches readings | `kernel` (read-only view), `terms` | Changing state |
| `resolver` | A call to the seat's own acts; the preview in world terms | `contracts`, `core`, the read-only view, `law` (warnings only) | Choosing how; acting for anyone else |
| `time` | The clock, simultaneity, wakes, acting time and thinking time, invariance perturbations | `contracts`, `core` | Knowing what seats do |
| `engine` | A run: loads config, drives the loop, orders annotations, replays and resumes, serves hosts | all of the above | |
| `engine-napi` | The engine inside the Bun process (N-API) | `engine` | |
| `core-wasm` | `core`, `terms`, `law` and log reading for the browser and TypeScript tools (`law` builds to WebAssembly itself for now: kernel/crates/law) | `core`, `terms`, `law` | |
| later: `engine-py` | Python seats (the Gymnasium/PettingZoo shape) | `engine` | |

**Read-only is a type, not a promise.** The kernel exposes a `WorldView` (immutable borrows of state and records). Only `kernel` holds `&mut World`. `terms`, `law`, `perception` and `resolver` receive a `WorldView`, so they can't write even by mistake.

**Laws stay unevaluated by the kernel.** `law` is used by the resolver's preview (the platform's warning that a plan looks unlawful), by institutions' seats through the host, and by measurement. The `kernel` crate doesn't depend on it.

---

## 5. The TypeScript side

What remains is content and glue, about 9,000 of today's 14,000 lines, most of them behaviour modules.

| Package | Keeps | Loses to Rust |
|---|---|---|
| `participants` (behaviour) | Citizens and their mind, firms, bank, union, government offices, institutions | Derivations from the `Book` (in force, notice ends, what's owed, who a message is from) become readings |
| `participants` (runtime) | The module API, a thin view, the stepper's steps | `rng.ts`, `canon.ts`, `money.ts` and hand-written `contracts.ts` (replaced by `engine-napi` and generated types) |
| `participants/llm` | Model adapters, the language-model seat, the mock, consult | Nothing |
| `translator` | The translator (prompting a model to write calls) | The resolver and the preview (to Rust) |
| `orchestrator` | Becomes the **participant host** and the CLI: batches, datasets, corpus, cost, story, consult-audit, watchdog | The loop, scheduling, annotation ordering, resume logic (to `engine`) |
| `worlds` | The generator and profiles | Nothing |
| `measure` | SQL queries, the runner, the new health report and diff | Log export may move to Rust for speed (optional) |
| `renderer` (stage 3) | Three.js | Uses `core-wasm` for readings and log reading |

### 5.1 The host boundary

The engine runs in the Bun process through N-API. There's no subprocess and no line-delimited JSON over stdio; parsing the kernel's replies is today's largest orchestrator cost (15%).

The loop, seen from the host:

1. `engine.nextCohort()` returns everyone waking at this moment, each with its observation (changes plus readings) and the reason it woke.
2. The host runs each seat: code modules in-process; language-model seats through their adapters, concurrently.
3. `engine.submit(unit, action, annotations)`. The engine resolves calls, schedules each act to take effect when its actor has done it (section 6.3), orders annotations by unit key (as the orchestrator's "holding" does today), and wakes the unit again when it's free.
4. Repeat. The engine advances time when the cohort is done.

The same API is served over a socket (`engine serve`) for seats in other processes: a human's interface (foundation-for-scale §4.9), a Python seat, a renderer attached live.

### 5.2 Module manifests

Every behaviour module declares, in a manifest checked at world load:

- **Parameters:** a JSON Schema with types, units, ranges, defaults, and for each figure its source or "placeholder". A commented-out default, a NaN or a missing required figure fails at load, naming the module and parameter.
- **Perception needs:** the record kinds, structured fields and channels it relies on (for example, the union needs `closure` records or the registrar's register). The engine checks the seat's configured channels provide them. A world that doesn't is refused at load, not discovered years into a run.
- **Beliefs it keeps** (for truth audits, section 8.2).
- **Decisions it records** (domains).

This makes the participant side's contracts as checked as the kernel's.

---

## 6. Time and scheduling

*Decided (Naz, 2026-09-30): the clock and simultaneity are world semantics; acting costs time, now, replacing the action budget; thinking time in both modes, now.*

### 6.1 Four things, four homes

| What | Home |
|---|---|
| **The clock and simultaneity:** the order of acts, and what happens when two act at once | The engine's `time` crate, written into the contract |
| **When a seat wakes** (a time it asked for, or its cadence) | The seat's own choice; the engine honours it |
| **Waking on news** (a message, a record naming it) | Perception: what reaches a seat's attention |
| **How much a seat can do:** acting costs time (6.3) | World semantics, in the engine, parameterised in the world's config |

The kernel (the only writer) doesn't change: it applies acts when the engine hands them over. Time's semantics live in the engine, beside it, not in glue code.

### 6.2 The clock and simultaneity

- **Time is world seconds.** Events are scheduled at any second; the tick (`clock.tick_seconds`) is only the grain for cadence wakes.
- **An act takes effect when it's done:** at the time its actor finishes it (6.3), not when they start.
- **Simultaneity:** acts completing at the same second are applied in actor-key order. Everyone waking at the same second observes the same state (foundation-for-scale §4.8).
- **Runaway guard:** more than 1,000 rounds at one second stops the run with a diagnosis. Since every act now costs time, this can only be tripped by waking without acting.

### 6.3 Acting costs time (replaces the action budget)

The action budget (at most 12 actions a wake, the rest carried over to the next tick) isn't how the world works. Nobody is capped at 12 things. Doing things takes time, and a busy actor falls behind. So:

- **Every act takes its actor time,** by the act's kind and the actor's kind: writing a letter, signing, instructing a payment, publishing a notice, moving house. The table is world config (`act_time`), with each figure marked as sourced or a placeholder.
- **How long is read from what the act makes** (foundations F2, 2026-10-15). A row of `act_time` is by block (`publish`) or, narrower, by block and what it makes (`publish/benefit_decision`, `create_entity/<kind>`, `work/<task>`); the kernel takes the narrower row if the table has it. A decision on a claim is not a notice. A profile states its own rows in `values.work_time`, each with its source; the generator's are placeholders and say so.
- **Any act can name who does its work** (foundations F3, 2026-10-15): `by` on the action. The act's time is the named people's, shared, placed on their timelines; the actor is held a second unless it is among them. A named person must be alive, in the world and (if the world says where work is done, `orchestration.performers_in`) in such a space; for a `work`, at its place. **Presence is looked at when the work begins**, not when it ends: an act queued behind its performers' other time is checked at its start and refused then if one has gone. `action_applied` and the records an act makes carry who did it.
- **Systems come from a supplier and do what their template lists** (foundations F4, 2026-10-15). A template says `does` (the blocks, tasks and kinds of record a system from it can do, and for a `work` its seconds a unit) and `supplier` (the organisation that supplies it). `deploy` is the supplier's act, naming the client; the system belongs to the client; the owner or the supplier may switch it off (`retire`). A system acts, or is named to do another's work (`by`, or a `work`'s `performers`), only within its template and only for the organisation it belongs to (`not_capable`, `not_theirs`). Its time is on its own timeline (its `lanes` at once) and it has no working day. A world with a post held by a system nobody supplied does not load. What a licence costs, who may buy what, and what happens at its end are agreements and law as data, never the kernel's.
- **The actor is busy until the act is done;** the act takes effect then (6.2); its next act starts after.
- **One body, one timeline.** A person's time is shared across every capacity they act in. A mayor who is also a citizen can't do both at once. A system (software) has `lanes`: how many acts it carries out at once. A payment system with 50 lanes processes 50 payments together.
- **Work is time on the timelines of those who do it** (foundations F1, 2026-10-15). A `work` act puts each performer's share of its labour on that performer's own timeline, like any act's time: the act starts when its actor and every performer are free and takes effect when the last is done; the actor is free again after its own part (`action_started.free`), so a manager who sets a crew to work is not held until the work is done. A performer's working day (`working_day`) is counted on the same account, where the work is placed; hours of a work that is then refused are given back. A person cannot do work and their own affairs at the same time.
- **A program of several steps** (a call with several lines) takes the sum of its lines' times, and each line takes effect as it's done.
- **Physical durations stay separate.** Building (`build_time`), work tasks and future travel are physics with their own durations. Act time is the actor's effort to do the act.
- **What goes away:** `max_actions_per_wake`, the carry-over rule, and the "cut short" health signal. Falling behind becomes visible as time: a backlog, and how late things happen. The health report measures it (8.4).

The bank's month end then looks as it would: 1,152 payments take its payment system the time they take, the last ones land later, and anyone waiting on them sees that.

### 6.4 Thinking time (both modes)

`orchestration.thinking_time`, per seat or for all:
- **`free`:** decisions take no world time (today's only mode).
- **`costs_world_time`:** deciding takes world time, and the world moves on meanwhile:
  - **models:** world seconds per output token (and optionally per input token), so it's deterministic, and the tokens are logged;
  - **humans:** the wall clock, scaled by a configured rate, recorded in the log so replay is exact;
  - **code seats:** a configured fixed decision time, zero by default.

A slow mayor then falls behind a fast world. VISION §8 names this as a disempowerment dynamic worth studying.

### 6.5 Time-invariance by construction

Every observation carries `since`, the time since this unit's previous wake, and the engine offers `accrue(rate, since)`. The module rule, enforced by invariance tests (section 8.1): **any per-period quantity is computed from elapsed time, never per wake.** The 23-trip mole is then a test failure on day one.

### 6.6 Perturbations for tests

The `time` crate can perturb a run on purpose, in test mode only, never in a research run:
- random extra wakes;
- shuffled order among acts completing at the same second (under a documented seed);
- splitting a payment in two;
- act times scaled by ±10% (outcomes may move a little, and shouldn't jump).

---

## 7. Readings: terms and laws

### 7.1 The principle

The kernel records what happened. What it means is judged by participants and institutions. A **reading** is the platform's mechanical reading of a record by its own terms. It's attached beside the records, never in place of them, and it never changes anything by itself.

- **Allowed:** "this lease, read by its terms, ends on day 412, because notice was given on day 382 and the lease gives 30 days". An "ended" lease evicts nobody. Someone still has to act.
- **Not allowed:** anything needing judgement. Whether notice was valid, whether a debt is really owed, whether a company exists: those belong to institutions in the world (a tribunal, a registrar).
- A seat may act against a reading. A dispute stays representable. A language-model seat is shown the reading and may read the records differently.

### 7.2 What `terms` reads

For an agreement a seat may see:

| Reading | From |
|---|---|
| Status: offered, in force, ending (on a date), ended (by term, by notice, or by all parties) | Signatures, the term, notices and each termination clause's notice period |
| Obligations: each recurring commitment's due dates, what's been paid against it, arrears | Typed commitments (`every`, `first`), and transfers that reference the agreement (`basis`, `settles`) |
| Its parties, and who acted for each | Signatures (`as`), the directory |

A payment settles an obligation only if it references the agreement, as a bank matches payments. Modules that pay under agreements must say what they're paying (section 15, decision 6).

### 7.3 What `law` reads

A formal condition (CEL) against a proposed act and the records: "this act would breach law X". It's used by the resolver's preview, institutions' seats and measurement. It's never used by the kernel, and it never blocks anything (VISION principle 11).

### 7.4 Identity

Messages carry the **acting entity** (the person, or the organisation through a position), not only the participant id. That's a pure event fact the kernel already knows, and it removes the id-mapping every module does today.

### 7.5 Lifecycles that are institutional

An organisation closing is a registrar's act, not physics: a public record from a registry seat, as a real deregistration is. How seats recognise it without a kind-name convention is part of the `claim` and structured-statement proposal (section 9).

---

## 8. Mole-proofing, built in

### 8.1 Invariance tests

**What:** a run's aggregates must not move, beyond seed noise, under perturbations that shouldn't matter (section 6.4).
**Where:** a test mode of the engine; a suite that runs the 200-person town for 90 days under each perturbation and compares against the unperturbed run on the health report's measures (8.4), with a statistical tolerance.
**Catches:** time-accounting moles, dropped steps, order dependence, sensitivity to act times.

### 8.2 Truth audits

**What:** each module reports its beliefs at each wake, typed and declared in its manifest ("my job: agreement X"; "my members at employer Y: …"; "employer Y is trading"). In test and calibration runs, the engine compares them with readings and state, and records divergences as annotations.
**Catches:** stale private copies of the world, the union's register, identity mix-ups.
**Cost:** off in research runs; on in tests and calibration.

### 8.3 Readings instead of private derivations

This is section 7. It removes the class of bug instead of detecting it.

### 8.4 The health report and the before/after diff

**Health report**, automatically, for every batch:
- money balances by sector (households, firms, government, outside), which must sum to zero;
- unserved demand (refunds as a share of orders);
- vacancies, the job-finding rate, how long unemployment lasts;
- disputes and stoppages per employer;
- backlogs: how far behind each busy actor runs (acting time), and refusals by code;
- truth-audit divergences;
- the calibration targets from the profile.

Each measure has a threshold, and breaches are listed first.

**Before/after diff:** `oikos diff <baseline> <change>` compares every measure on the same seeds and flags moves beyond seed noise. The trip fix took refunds from 0.2% to 30%, and this would have flagged it in a one-year run.

**Where:** new SQL queries plus a small runner. Nightly on CI: 5 years, 3 seeds, diffed against the last accepted baseline.

### 8.5 The market design rule

Every market in a world (goods, labour, housing, credit) documents how each side adjusts, in price and in quantity, with sources. A market missing one is flagged in review, and its health measures are watched. The labour market and goods prices are the first to fix (section 16).

### 8.6 Declared contracts on the participant side

Module manifests (5.2), plus types generated from the contracts for Rust and TypeScript alike. No hand-written wire types, so no drift.

---

## 9. Contracts 0.7

Proposed together, for one sign-off:

| Change | Why |
|---|---|
| **Generated types** for Rust and TypeScript from the JSON Schemas | No drift between languages |
| **Readings on observations** (`readings`: per record id, the reading and its version), labelled as readings | Section 7 |
| **The acting entity on messages** | Section 7.4 |
| **`since` on observations** (time since the unit's last wake), and **wake reasons** | Section 6.3; legibility |
| **Time in the contract:** wake rules; acts take effect when done; simultaneity; `act_time` (by act and actor kind, with sources or placeholders) and systems' `lanes`, replacing `max_actions_per_wake`; `thinking_time` in both modes, with thinking durations logged | Section 6 |
| **Module manifests:** a participant-side schema (parameters with units, ranges and sources; perception needs; beliefs; decision domains) | Section 5.2 |
| **Payments reference what they settle** (`basis` or `settles` required on transfers made under an agreement) | Section 7.2 |
| **Compact logs** (docs/design/compact-logs.md) and a **checkpoint snapshot** format | Section 10 |
| **The three pending proposals:** a `consult` purpose in usage annotations; a structured `claim` on statements (things put forward to be believed, and registry acts); state in `CitizenDecision` (needs, the strongest emotion and its target, the relevant belief, the active goal) | From the AI-citizen work |
| **Older unsigned items:** `log.detail` (lean logs), the dataset format and the observation annotation, M2's `notices` and `framing.debrief_text` | Waiting since earlier stages |

---

## 10. Logs, replay, resume and measurement

- **Compact logs** as proposed: about a seventh the size of today's. A 5-year log is 2.3 GB today.
- **Checkpoints:** the engine writes a state snapshot (world, scheduler, and each code module's serialised state) every `checkpoint_every`. **Resume from the latest checkpoint,** not from the start. This makes long runs and centuries-long runs practical, and it needs modules to serialise their state: a manifest requirement.
- **Replay** stays byte-identical, from the log alone.
- **Old logs:** pre-0.7 logs replay with the pre-rebuild binary, kept as a tagged tool (`v0-reference`). Language-model runs from before the rebuild stay usable as training data (they're never deleted).
- **Measurement** reads logs through a Rust exporter (streaming, to Parquet), then DuckDB SQL, as now.
- **The watchdog** stays, sleep-aware (as fixed on 2026-09-29).

---

## 11. Performance and scale

**Targets:**
- The 1,000-person town: a year in under 30 seconds (about 130 today, measured 2026-09-30 with today's citizens; the earlier 22 seconds predates the AI citizen);
- five years across three seeds: under 10 minutes (about 40 today, in parallel);
- 50,000 participants (cohorts, foundation-for-scale phase D) at a practical pace.

**Gains in the design:**
- The engine in-process: no subprocess, no JSON over stdio per command.
- Observations built and delivered per cohort, in one call.
- Readings computed once in Rust instead of in every module.
- Compact logs.

**Room left for scale:** ids and the log's root are partition-ready (foundation-for-scale §4.13); the host can run seats' decisions in parallel, with results ordered by unit key, so determinism holds.

---

## 12. What the architecture must carry next

| Coming | What it needs from this design |
|---|---|
| **Stage 3: the renderer** | State at a time (checkpoints plus replay); causal traces from "why" chains (every act says why, records cite their basis, D50); `core-wasm` in the browser |
| **Stage 4: tension** | A second AI seat (a developer): the host already runs many; negotiation is messages and agreements. Nature: resources and state variables exist. Irreversibility: kernel physics |
| **Cohorts** (phase D) | Counts in acts, and statistical equivalence tests (a new test class, section 13) |
| **Real data** (phase E) | Generators outside the engine: worlds are data |
| **Many stewards, humans** (phase F) | `engine serve` for remote seats; the same interface for everyone |
| **Python seats and Inspect** | `engine-py`; the Gymnasium/PettingZoo shape |
| **The trained translator** | Unchanged: the translator is TypeScript prompting; the corpus comes from logs |
| **The sparse mind on a real model** | Unchanged: consult, its audit, and `--consult-avoid` |

---

## 13. Testing

| Tier | What | When |
|---|---|---|
| Rust unit and property tests | Today's 83 kernel tests, ported; the same for `terms`, `law`, `time`, `resolver`, `perception` | Every change |
| Kernel invariants | Money conservation, physical feasibility, statements have no power, hash chain, replay, determinism lint | Every change |
| Conformance | Every contract example validates; generated types round-trip | Every change |
| Invariance tests | Section 8.1, on the 200-person town, 90 days | Every change (under 2 minutes) |
| Time semantics | Acts take effect when done; one body, one timeline; lanes; thinking time in both modes replays exactly | Every change |
| Truth audits | On in every orchestrator-level test; zero divergences expected | Every change |
| Scenario tests | Today's 72 orchestrator tests, ported to the host (unions, closures, migration, gatherings, …) | Every change |
| Parity | The rebuild against `v0-reference` on reference worlds (section 14) | During the rebuild |
| Calibration regression | The health report and diff, 5 years, 3 seeds | Nightly |
| Statistical equivalence | Cohorts against individuals (phase D) | When cohorts land |

---

## 14. The rebuild plan

**Rebuild the architecture; don't rewrite what works.** The kernel's physics code moves into the new crates largely as it is. The work is the split, the engine, the move of semantics out of TypeScript, and the new checks. A from-scratch rewrite would throw away the part that's been reliable.

**The reference:** today's `main` is tagged `v0-reference`, with its reference runs and their measures stored: the 200- and 1,000-person towns, 3 seeds × 2 years.

| Phase | What | Gate before the next |
|---|---|---|
| **R0. Contracts 0.7** | The contract changes of section 9, signed off; generated types; the workspace skeleton; CI tiers | Sign-off; conformance green |
| **R1. Kernel split** | `contracts`, `core`, `kernel` (with `WorldView`), existing kernel code moved; `engine-napi` with today's command protocol | Every existing kernel test green; `v0-reference` logs replay byte-identically on the split kernel (before 0.7 changes take effect) |
| **R2. The engine** | `time` (acting and thinking time included), `perception`, `resolver` and the loop in Rust; the orchestrator becomes the host; invariance perturbations | All scenario tests ported and green; invariance tests green; parity in two steps: first with every act taking 1 second (close to today's semantics), within seed noise of `v0-reference`; then with the configured act times, each difference explained |
| **R3. Readings** | `terms` and `law`; readings on observations; the acting entity on messages; modules migrated off the `Book`'s derivations; truth audits | Truth audits clean on reference runs; parity as R2 |
| **R4. Declared and measured** | Module manifests and validation; the health report and diff; compact logs; checkpoints and resume from a checkpoint | Nightly calibration running; all parameters declared, with sources or marked as placeholders |
| **R5. Clean-up** | Delete the TypeScript duplicates and the stdio protocol; docs rewritten (VISION §4, reliability, measurement, the behaviour README) | Nothing duplicated; docs match the code |

**Order, as run:** R1 (the kernel split) before R0 (contracts 0.7). The split's gate (old logs replay byte-identically) is only meaningful before the contracts change, and doing them apart keeps one risk at a time.

**Progress:**
- **Reference** (2026-09-30): `v0-reference` tagged; reference runs in `runs/v0-reference/` (the 200- and 1,000-person towns, 3 seeds × 2 years) and `runs/c10-run5/` (1,000 people, 3 seeds × 5 years); work on the `rebuild` branch in a separate worktree.
- **R1, first step** (2026-09-30): the kernel is now a workspace with three crates:
  - `oikos-core`: canonical JSON, money, randomness;
  - `oikos-contracts`: blocks, config, events, the compiled schemas, and the vocabularies they shared with the state;
  - `oikos-kernel`: re-exports them, so its code is unchanged.

  Gate:
  - all 83 kernel tests pass;
  - 0.6 logs replay byte-identically on the new binary (a strike, gatherings, the sparse mind on);
  - all 72 orchestrator and 38 participant tests pass.

  A 0.5 log (pilot 8) needs the 0.5 binary, as it always did.
- **R1, second step** (2026-09-30): the engine in-process. The kernel's request handler is a `Session`, which both stdio and a native module (`oikos-napi`, N-API) use; the orchestrator's `Kernel` runs in-process when the module is built (`OIKOS_ENGINE=stdio` for the subprocess).
  - Gate: the same world's log and anchors are byte-identical either way (180 days, 1,000 people); all suites pass in-process (83 kernel, 72 orchestrator, 38 participant tests).
  - **Speed:** a year of the 1,000-person town takes 134 s over stdio and 123 s in-process, with the same final state. Only 8% faster: the engine's own work (about 82 s: validating every input against the schemas, canonical hashing, building observations, the log) is the cost, not the pipe. That's R2's to take on.

- **R0, contracts 0.7** (2026-09-30):
  - **In the schemas:**
    - `assertion` (A1, renamed from `claim`) and `registry` on statements, and `has` for both;
    - `state` on `CitizenDecision` (A2);
    - `readings`, `woke_for` and `since` on observations, and `from_entity` on messages;
    - `act_time`, `thinking` and participants' `lanes`;
    - the `consult` purpose (used by the sparse mind);
    - the `audit` annotation;
    - `contracts/module.schema.json`;
    - version 0.7 throughout.
  - **In the kernel:** it carries `assertion` and `registry`, and matches them in `has`.
  - **Transitional:** `max_actions_per_wake` stays, optional, until acting time is in the engine (R2).
  - **Not in R0:** checkpoints and compact logs (R4); acts taking effect when done (R2).
  - **Gate:** kernel 83, contracts 142 (with a new invalid example: a 0.6 world config), participants 38, orchestrator 72.

- **R3, started** (2026-09-30):
  - messages carry who acted (`from_entity`, stamped by the kernel; the citizen reads it instead of mapping ids by hand);
  - observations say why a seat woke and how long since its last wake (`woke_for`, `since`, from the orchestrator).
- **Merged from `main`** (2026-09-30): pilot 9's gaps fixed there. All suites pass on the rebuild branch: kernel 83, contracts 142, participants 39, orchestrator 73.
- **R3, readings** (2026-09-30):
  - the `terms` crate (`terms-0.1.0`) reads an agreement from its terms, signatures and notices: offered, in force, ending or ended, when it ends, and whether by its term or by notice. A notice counts only under its giver's own termination clause;
  - the kernel's state indexes each agreement's signatures and notices (derived, never serialised), and an observation carries the reading of every agreement its records refer to;
  - the `Book` keeps two meanings apart: `concluded` (signed by every party, a fact of the records) and `inForce` (by the reading, if one came). Merging them broke two things, the wages stopping at an employment's end and the builder's purchases, because code asked "in force" when it meant "concluded".
  - **A guard on the engine:** the binary and the native module carry a fingerprint of the sources they were built from (kernel/build.rs), and the host refuses a module that doesn't match the binary beside it. A `cargo test` rebuilds only the binary, and the stale module had written logs the binary couldn't replay.
  - **Gate:** kernel 88, participants 39, orchestrator 73.
  - **Modules read ends from readings:** the landlord's leases in force, `Staffing`'s contract ends, and the citizen's job and home. They no longer work ends out themselves. That arithmetic had hard-coded notice periods (30 and 14 days, and a month when a clause was missing), each a place where code could drift from the terms. A job the citizen walks out of (wages unpaid) is the one end that isn't the terms'. A 90-day town's events are identical before and after (437,836 lines).
- **R3, truth audits** (2026-09-30):
  - modules declare what they believe about agreements (`beliefs()` on a controller: an agreement in force, one between two parties, or all of a kind a party holds). The citizen's job and home, the union's register, every employer's staff and every landlord's leases are covered;
  - the engine answers `agreements` (read-only, never logged) from an index of each party's agreements, and the orchestrator compares them when a wake ends (`audit: true`, tests and calibration). A divergence is recorded only if it's still there at the unit's next audit: another's act in the same moment isn't staleness;
  - **the first run found a real mole:** a citizen leaving town gave notice on the job and the lease but not on the union membership, so the union kept a member who'd gone. Also, memberships gave members no right to resign at all, so no notice of theirs would have counted. Fixed: memberships state the member's notice (the profile's, with its source), and leaving town ends every agreement the citizen can end;
  - **the gate:** a 300-person town over 180 days has no belief wrong for more than a week (the rest are members telling the union of a job's end a few days late), and a planted false belief is caught.
- **R2, acting time** (2026-09-30):
  - the `time` crate (act times by block and actor kind; timelines, one per person and lanes per system); the kernel holds acts in progress and applies them when done, and `advance` goes to any second; `thinking` is logged with the act; `max_actions_per_wake` is gone, with a backlog and a repeated-act count in the health report in its place;
  - modules plan when a wake begins and carry on through its acts (`woke_for: "done"`); retries are paced by time;
  - **first parity step** (every act a second): a 30-day, 80-person town is within noise of `main`: 266 payments against 275, 345 work events against 344, citizens' acts 745 against 712, no refusals in either;
  - **Gate:** kernel 94 (3 new time tests), participants 39, orchestrator 281.
  - **Parity, a year of the 1,000-person town, 10 seeds each against `main`:** within noise on employment, participation, unemployment, saving, arrivals, departures, rent stress and belief change. **One known difference:** group attendance is about 4 points higher (59.7% against 55.8%, higher in 9 of 10 seeds). Likely cause: many decisions now fall a few seconds later (a message lands a second after it's sent), and a citizen's random draws are keyed by the exact second, so the draws differ; habit then amplifies. Not isolated further (Naz, 2026-09-30: record it and get on with the rebuild). The measure was already off its target (50%) on `main`; it's recalibrated on the new platform.
  - **Speed:** a year takes about 130 s, and building observations is 70% of the engine's time. Most of that was every citizen's gatherings channel (`has: practice`) scanning all new records at every look. The record index now covers `has`.
- **R2, the loop's schedule in the engine** (2026-09-30): when each unit wakes is now the engine's (`kernel/src/schedule.rs`), served to the host as protocol operations (`units_add`, `units_remove`, `next`, `finished`, `to_cadence`):
  - who's due and in what order;
  - `woke_for` and `since`;
  - news wakes (from every command's events, against the engine's own record of people and position holders);
  - the per-tick news guard, a unit busy with an act, and the runaway guard.
  The host runs the units and says when each wake is over. Any host (a Python seat, a human interface) gets the same schedule.
  - **Checked:** 60 days of the 1,000-person town ends in the identical state as under the old host (the same state hash, about 104,000 commands). The logs differ only in order within a moment: the old host ordered a cohort by (wake time, key), because it set news wakes at the time before an advance, and could split one moment into two cohorts. The engine wakes everyone due at a moment together, in key order, as D58 says.
  - **Gate:** kernel 97, TypeScript 281.
- **R2, the resolver in the engine** (2026-09-30): `kernel/crates/resolver`, which holds the call language, what each seat knows, and the resolver. It's a port of `translator/src/{resolver,knowledge}.ts` and `participants/src/calls.ts`. The engine keeps each seat's knowledge from the observations it delivers, and resolves calls itself (the protocol's `resolve`): every code module's act, and a model seat's drafts.
  - **Checked:** shadow mode (`OIKOS_RESOLVER=shadow`) resolves every call both ways. There were no differences in 26,920 calls over 60 days of the 1,000-person town, and none across the whole test suite, where a difference fails the test. The same final state.
  - **Still in TypeScript:** a model seat's draft preview and law warnings (they read the seat's knowledge there too). Their law warnings read with the Rust `law` reader now; what they read of the seat's knowledge is still TypeScript's.
- **R2, invariance** (2026-09-30): the engine's scheduler can perturb a run for tests (`perturb`: seeded extra wakes, recorded in the log; never a research run). `orchestrator/test/invariance.test.ts` runs a 200-person town for 120 days as it is, and again with about 12% more wakes. Goods bought, orders, payments, factory output, shop service and waste collected must each stay within 10%. They do. The builder's building work moved about 20% on one seed, through different hires, and is left out as too lumpy to judge on one seed.
  - Not done from 6.6: shuffling acts done at the same second, splitting payments, and scaling act times. The last needs no mode: a world's `act_time` table is the knob.
- **R2, parity step 2: configured act times** (2026-09-30). Generated worlds carry an `act_time` table (placeholders: minutes for people, a second for systems). A year of the 1,000-person town is within the rebuild's own spread on every town measure, with no warnings. Two module fixes came out of it: time-bound steps first, and planning again once a plan is done (docs/decisions.md).
- **R2, the crates** (2026-09-30):
  - `oikos-world` holds the state, physics and records: the only writer;
  - `oikos-perception` builds observations, read-only (no `&mut State`);
  - the root crate is the engine: the kernel interface, the log, the protocol and the schedule.
  Observing is now perception building, then the world delivering (marking what was seen, handing over outcomes and messages). Public paths are unchanged (`oikos_kernel::{state, observe, ...}`). The same final state over 60 days.
- **R4, the diff** (2026-09-30): `oikos diff <baseline> <change> [QUERY...]` compares every measure of two batches of the same world. With several seeds a side, a difference is judged against seed-to-seed spread and flagged beyond three standard errors; with one, the relative change is flagged beyond a tenth. On the parity batches (10 seeds each) it finds the known gatherings difference by itself (attendance z 4.7). It also finds first-quarter religious affiliation 1.4 points lower on the rebuild (z -4.2), part of the same difference.
- **R4, module manifests** (2026-09-30): every built-in module has a manifest (`participants/manifests/<name>.json`, valid against `contracts/module.schema.json`). They're written from the modules themselves by `participants/scripts/manifests.ts`:
  - the parameters and their defaults, as the module's `params` call has them, plus what it reads as it goes;
  - each figure's source, where the comment beside it cites one, or "placeholder";
  - what the world must give;
  - the decisions it records and the beliefs it keeps.
  A test fails if a module changes without its manifest being written again. **At load,** a world giving a module a parameter it doesn't take, or of the wrong type, is refused, naming the participant, the module and the parameter. The first run found one: `builder_account`, given to landlords and read by nothing.
  - **The count:** 294 parameters in 28 modules; 38 with a cited source, the rest placeholders. The key figures come from the profile (sourced) in generated worlds, over these defaults.
  - **Not yet:** `perceives` (what each module relies on perceiving) is empty, and `state` is "none" (no module saves its state yet: checkpoints).
- **R4, the health report** (2026-09-30): `oikos health <DIR>` sets a batch's measures against its profile's calibration targets, each within a stated tolerance. Breaches come first, then demand that went unmet. Targets not yet measured are listed as such. The rebuild's 10-seed batch breaches on unemployment (1.5% against 4.6%), saving (-10% against 6.5%), group participation (60% against 50%) and unmet demand (8%). These are the calibration work queued for after the rebuild (the labour market; goods under shortage).
- **R5** (2026-09-30): the docs match the platform (VISION §4 and §8, reliability, measurement, the behaviour modules' rules). What stays in TypeScript is kept for a stated reason (docs/decisions.md).
- **The `law` reader is Rust** (kernel/crates/law), built to WebAssembly for the TypeScript modules and checked against `@bufbuild/cel` in shadow (docs/decisions.md). It was deferred at first; Naz asked for it.
- **Deferred, with reasons and when to revisit** (docs/decisions.md): checkpoints (resume by replay stays); compact logs (B13) and generated types (B1), both to confirm with Naz; the rest of the loop in the engine (the rounds of look, decide, act).
- **Next:** merge `rebuild` into `main` (Naz's call), then calibration on the new platform: the labour market and goods under shortage, with `oikos health` and `diff` watching.

**After the rebuild,** on the new platform:
1. The labour market (search frictions) and goods prices under shortage, calibrated with the health report watching every other measure.
2. The Stage 3 renderer.

**Language-model pilots during the rebuild:** paused after pilot 9, then resumed at R3, when readings change what seats see.

---

## 15. Decisions for Naz

1. **The architecture:** a Rust engine (kernel plus the semantics every consumer shares) in-process with a TypeScript participant host. **Recommend yes.**
2. **The rule for what goes where** (section 3). **Recommend yes.**
3. **Time** (section 6). **Decided, 2026-09-30:** the clock and simultaneity are world semantics, in the engine and the contract; acting costs time now, replacing the action budget; thinking time in both modes now.
4. **The resolver moves to Rust.** **Recommend yes.**
5. **Readings** (section 7): the kernel records, `terms` and `law` read, and nothing reads *for* anyone or rules. **Recommend yes.**
6. **Payments must reference what they settle** for arrears to be read (7.2). **Recommend yes.**
7. **Organisations close by a registrar's act,** as world content (7.5). **Recommend yes.**
8. **Module manifests,** checked at world load (5.2). **Recommend yes.**
9. **The five mole-proofing mechanisms** (section 8), with invariance tests and the health report first. **Recommend yes.**
10. **Contracts 0.7 as one package** (section 9), including the three pending proposals and the older unsigned items. **Recommend yes, item by item.**
11. **Resume from checkpoints,** which requires modules to serialise their state. **Recommend yes.**
12. **Old logs replay with the tagged pre-rebuild binary,** not the new engine. **Recommend yes.**
13. **The rebuild plan** (section 14): architecture, not rewrite, with parity gates. **Recommend yes.**
14. **A "good enough" bar for calibration:** the profile's headline targets within stated tolerances over 5 years across 3 seeds, with the rest documented as known gaps. **Recommend yes**, with the tolerances agreed when the health report lands.

---

## 16. Risks, and what's out of scope

**Risks:**
- **Rust iteration is slower.** That's right for stable semantics, and wrong for behaviour, which stays in TypeScript.
- **N-API adds a build step** and native crashes take the process with them. The watchdog and resume already handle a dead run.
- **Semantics made explicit may shift outcomes,** and acting time will shift them deliberately. Parity is measured, and every difference is explained, not assumed away. Acting time is compared against `v0-reference` separately, so its effect is seen on its own.
- **More distinct moments.** Acts completing at their own seconds means more rounds than hourly wakes did. The engine runs rounds in Rust and calls the host once per cohort; the performance targets (section 11) include this.
- **Scope creep.** New behaviour waits until after R5, except what a parity gate needs.
- **Time.** The rebuild pauses calibration and pilots for its duration.

**Out of scope:**
- New behaviour: the labour market, goods prices, the tribunal. These come after, on the new platform.
- Stage 3 and 4 features, and cohorts. They're designed for (section 12), not built.
- World-content gaps from pilots (docs/gaps.md: G1–G5, G7). Two are platform gaps the rebuild picks up: G6 (re-reading something already seen, a `look` with filters) and G8 (results within a wake repeat the whole report, so send only what changed).
