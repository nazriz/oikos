# The rebuild: an architecture that finds its own moles

**Status:** draft for Naz's sign-off, 2026-09-30. Nothing is built until it's signed off; section 15 lists the decisions.
**Diagram:** [Terrarium Architecture](https://claude.ai/artifact/4EawWxSAjwTZbhGzh7u5qY) (the "Proposed" tab).

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
                         │  time      wakes, cohorts, same-moment rule, action budgets │
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
| `time` | Wake rules, cohorts, the same-moment rule, action budgets and carry-over, invariance perturbations | `contracts`, `core` | Knowing what seats do |
| `engine` | A run: loads config, drives the loop, orders annotations, replays and resumes, serves hosts | all of the above | |
| `engine-napi` | The engine inside the Bun process (N-API) | `engine` | |
| `core-wasm` | `core`, `terms`, `law` and log reading for the browser and TypeScript tools | `core`, `terms`, `law` | |
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
3. `engine.submit(unit, action, annotations)`. The engine resolves calls, applies acts, orders annotations by unit key (as the orchestrator's "holding" does today), and decides who goes on.
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

### 6.1 Why the scheduler moves into the engine

Who wakes when shapes outcomes. Wake timing decided how much people spent. Same-moment ordering decides who gets the last home. The action budget decides whose payments slip. These are the world's time semantics, and they're currently implemented in glue code, specified only by that code.

The `time` crate owns them. It isn't the kernel, which stays physics. It's the engine's clock, and it's specified in the contract (section 9).

### 6.2 The semantics (as today, now specified)

- **A unit wakes** at the time it asked for, or at its cadence if it didn't ask, or on **news**: a message to it, or a record naming or addressed to the entity it acts for.
- **The same-moment rule:** everyone due at a moment observes the same state; their acts are applied in unit-key order (foundation-for-scale §4.8).
- **The action budget:** at most `max_actions_per_wake` actions a wake. A unit with more to do carries on at the next tick. This is recorded as a health signal.
- **Runaway guard:** more than 1,000 rounds of wakes in one moment stops the run with a diagnosis.
- **Thinking time** (VISION §8): "free" is implemented; "costs world time" gets its hook here. A language-model seat's wall-clock thinking maps to world time by a configured rate.

### 6.3 Time-invariance by construction

Every observation carries `since`, the time since this unit's previous wake, and the engine offers `accrue(rate, since)`. The module rule, enforced by invariance tests (section 8.1): **any per-period quantity is computed from elapsed time, never per wake.** The 23-trip mole is then a test failure on day one.

### 6.4 Perturbations for tests

The `time` crate can perturb a run on purpose, in test mode only, never in a research run:
- random extra wakes;
- a smaller action budget;
- shuffled order within a cohort (under a documented seed);
- splitting a payment in two.

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
**Catches:** time-accounting moles, dropped steps, order dependence, budget dependence.

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
- actions carried over, and refusals by code;
- truth-audit divergences;
- the calibration targets from the profile.

Each measure has a threshold, and breaches are listed first.

**Before/after diff:** `terrarium diff <baseline> <change>` compares every measure on the same seeds and flags moves beyond seed noise. The trip fix took refunds from 0.2% to 30%, and this would have flagged it in a one-year run.

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
| **Scheduling semantics in the contract** (`orchestration`): wake rules, the same-moment rule, the action budget, carry-over, thinking time | Section 6 |
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
- The 1,000-person town: a year in under 15 seconds (about 22 today);
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
| **R2. The engine** | `time`, `perception`, `resolver` and the loop in Rust; the orchestrator becomes the host; invariance perturbations | All scenario tests ported and green; invariance tests green; parity: headline measures within seed noise of `v0-reference`, or each difference explained |
| **R3. Readings** | `terms` and `law`; readings on observations; the acting entity on messages; modules migrated off the `Book`'s derivations; truth audits | Truth audits clean on reference runs; parity as R2 |
| **R4. Declared and measured** | Module manifests and validation; the health report and diff; compact logs; checkpoints and resume from a checkpoint | Nightly calibration running; all parameters declared, with sources or marked as placeholders |
| **R5. Clean-up** | Delete the TypeScript duplicates and the stdio protocol; docs rewritten (VISION §4, reliability, measurement, the behaviour README) | Nothing duplicated; docs match the code |

**After the rebuild,** on the new platform:
1. The labour market (search frictions) and goods prices under shortage, calibrated with the health report watching every other measure.
2. The Stage 3 renderer.

**Language-model pilots during the rebuild:** paused after pilot 9, then resumed at R3, when readings change what seats see.

---

## 15. Decisions for Naz

1. **The architecture:** a Rust engine (kernel plus the semantics every consumer shares) in-process with a TypeScript participant host. **Recommend yes.**
2. **The rule for what goes where** (section 3). **Recommend yes.**
3. **The scheduler moves into the engine** as the `time` crate, with its semantics written into the contract. **Recommend yes.** It's the question I'm least certain of, and the one I'd most like to discuss.
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
- **Semantics made explicit may shift outcomes.** Parity is measured and every difference explained, not assumed away.
- **Scope creep.** New behaviour waits until after R5, except what a parity gate needs.
- **Time.** The rebuild pauses calibration and pilots for its duration.

**Out of scope:**
- New behaviour: the labour market, goods prices, the tribunal. These come after, on the new platform.
- Stage 3 and 4 features, and cohorts. They're designed for (section 12), not built.
- World-content gaps from pilots (docs/gaps.md: G1–G5, G7). Two are platform gaps the rebuild picks up: G6 (re-reading something already seen, a `look` with filters) and G8 (results within a wake repeat the whole report, so send only what changed).
