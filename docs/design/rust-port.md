# The world in Rust: porting the built-in actors

Written 2026-10-17. The owner's decision of the same day: "everything should be in Rust, and TypeScript should just be the
top layer for config", sharpened later that day: be aggressive, port in parallel, rewrite for Rust rather than
transliterate, accept a new world that is statistically the same rather than byte-identical, freeze TypeScript
behaviour while the port runs, and delete the TypeScript modules when the gate passes. Nothing has been deployed, so a
broken week is cheap; a world that is slow at 10,000 people for years is not.

Design only. No code was changed and no model was called to write it.

---

## 1. What there is today (measured from the tree, `ac99bbba`)

| Area | Lines (TS) | Goes to |
|---|---|---|
| `participants/src/behaviour/*` (50 modules) | 24,645 | Rust, except the seat-side readers below |
| of which the seat-side readers (`openbooks*`, `daybook`, `roster`, `tally`, `diary`) | about 1,700 | stays TS (what a seat is shown of its own office) |
| `participants/src/` runtime (`module`, `calls`, `forms`, `law`, `slip`, `view`, `rng`, `canon`, `money`, `contracts`) | about 2,400 | Rust; TS keeps type shims for seats |
| `participants/src/llm/*` (seats, prompts, debriefs, mock, consult, compose) | 5,880 | stays TS |
| `orchestrator/src/*` | 11,182 | the run loop for code actors to Rust (part of `run.ts`, 1,589); the rest stays TS |
| `translator/` (serving, prompts, preview, model, training) | 11,288 | stays TS; its resolver (`resolver.ts`, 885) is deleted, the engine's is the only one |
| `worlds/generator/` | 4,289 | stays TS (section 1.1) |
| Rust: `kernel/` and its 10 crates | 26,289 | stays, gains the actors |
| Tests: `participants/test` 101 files, `orchestrator/test` 132, `kernel/tests` 34 | 32,600 TS | scenario tests stay TS as the outside referee; module unit tests move to Rust with their module |

The engine already runs inside the Bun process (`kernel/crates/napi`), but every request and reply crosses as a line of
JSON. Where a 10,000-person month's time went (decisions log, 2026-10-07, sampled): the host's JavaScript 52% (modules,
books, reading replies), the kernel 46%. Inside the kernel, building what is seen about a third, encoding it 13%,
applying acts 15 to 16%, the log 7%, annotations 6%, contract checks 6%. On the host, `JSON.parse` of replies 12% and
putting records back by id 5% (the earlier profile). One JavaScript thread runs every citizen. Today a 1,000-person
year takes about 150 s and a 10,000-person month 125 to 200 s (6 GB resident), so a 10,000-person year is roughly half
an hour.

### 1.1 What stays in TypeScript, decided

- **Model seats** and everything around them: prompts, framing, debriefs, consult and compose (the model calls), the
  mock, the reading gate, the seat-side readers of an office's books.
- **The translator's serving** and its preview; the trained model's pipeline.
- **Orchestration of pilots**: the CLI, batches, waves, slots, cost, resume, datasets, corpus, watchdog.
- **Tools**: pilot-view, the explorer, reports, `measure`.
- **The generator.** It runs once per town, is where researchers change worlds, and is not on any hot path (the
  start of a 10,000 run is 19 s, most of it the kernel reading and hashing the config). The pure rules it shares with
  the modules today (household drawing, withholding, payments, decision law, forms) move to Rust and are called from the
  generator through the N-API module, so nothing is written twice. Revisit if generation passes 5% of a 10,000-person
  year.
- **All tests above the module level** (section 4).

---

## 2. The target architecture

```
  TypeScript (top layer)                         Rust (one process, one engine)
  ───────────────────────                        ─────────────────────────────────────────────────
  config, generator ──── world config ────────▶  engine   run loop, cohorts, rounds, key-order merge
  pilot orchestration                              │
  model seats ◀──── seat wakes (JSON) ──────────   ├─ actors     every built-in actor, all cores
     │      ──── seat actions (JSON) ──────────▶   ├─ perception what each one sees (typed, in memory)
  translator serving ── resolve (N-API) ───────▶   ├─ resolver   the only one
  tools, tests ◀──── logs, readings ────────────   ├─ kernel     the only writer; the log
                                                   └─ core, contracts, law, terms, time, nature
  outside researchers' seats (any language) ── participant API over a socket (JSON) ──▶ engine
```

### 2.1 Crates

- **`actors`** (new): one Rust module per actor kind, grouped as `actors::citizen`, `actors::mind`, `actors::firms`,
  `actors::finance`, `actors::offices`, `actors::boundary`. Depends on `contracts` (the typed observation and action),
  `core` (amounts, keyed randomness, interned ids) and `rules`, **and not on `world` or `perception`**. An actor
  cannot reach world state because the crate cannot name it: the no-god-view rule becomes a dependency rule, checked by
  Cargo, on top of `no-god-view.test.ts`.
- **`rules`** (new): pure functions of the law and the profile that both actors and the generator need (withholding,
  support payments, decision deadlines, household drawing, forms and their writes, `slip()`).
- **`engine`**: today's `kernel/src/` session and `schedule.rs`, plus the loop for code actors that now lives in
  `orchestrator/src/run.ts` (rounds within a moment, carrying out in key order, truth audits, invariance perturbations,
  the stuck-run guard). It owns the actors' memory beside the world but apart from it: actor memory is participant
  state, never world state, and the kernel stays the only writer of the world.
- **`napi`**: the host's handle. Today one string in, one string out; after the port it serves the calls in 2.3.
- **`serve`**: the same participant API over a Unix or TCP socket, for seats in other processes and languages.

### 2.2 How a moment runs

1. The engine takes everyone waking at this moment (code actors and seats alike, as `schedule.rs` decides today).
2. **Look**, in parallel: perception builds each waker's observation as typed Rust values. A code actor's observation
   is never encoded; a seat's is encoded to the contract's JSON once, as today.
3. **Decide**, in parallel: each code actor steps on its observation, its own memory and its keyed random streams.
   Seats' wakes go to the host in one batch; the engine waits for their actions (the host may run the code actors'
   round while models think: they do not depend on each other within a round).
4. **Carry out**, serially: every action of the round is resolved and applied in unit-key order, the rule today's
   orchestrator follows. Nothing that runs in parallel writes anything shared.
5. Those whose wakes go on take another round at the same moment; then the clock moves.

Actions from code actors go through the same command path and are logged as they are today, so the log format, replay,
resume by re-running, and every log reader (measure, pilot-view, the explorer, the datasets) are unchanged. Old logs
still replay on the kernel; they will not re-run to the same world (section 3).

### 2.3 The host's interface (N-API)

- `engine.start(config, options)`; `engine.next()` returns the seat wakes due (with observations, as JSON), or the end;
  `engine.submit(seat, action)`; `engine.answer(questions)`.
- **Questions from code actors to models** (the sparse mind's `consult`, the composer, the reading desk's filings)
  work as they do now: asked during a wake, answered by the next. A step returns its action and any questions; the
  engine queues them; the host answers them between moments with the models it holds; answers arrive with the actor's
  next observation. No actor ever waits inside a step, so a step stays a pure function and runs on any core.
- **A detached actor** for twins: `engine.actorStep(kind, observation, context)` runs one Rust actor on a seat's
  observation. A mock seat that sits as its code twin (`mock.brain`, `mock.twin`) uses it, so the twin is the same
  code in both runs.
- **Manifests**: each actor kind exports its parameters, `keeps`, `issues`, `taken` forms and opening papers as JSON,
  so the generator, the seat prompts and the backstop tests read the Rust truth, not a TS copy.
- **Resolve**: the translator calls the engine's resolver (it already can, `op: "resolve"`); the TS fallback goes.

### 2.4 The participant API for outside researchers

Unchanged in shape: `contracts/participant-api.schema.json`, observations in, actions out, JSON. It is served by
`engine serve` over a socket, with the same wake, observation and action messages a TS seat gets. A Python seat (the
PettingZoo AEC shape) is a thin client of that socket. Any built-in actor can be replaced by an outside seat in config,
as a model can replace one today. Code actors get no shortcut the API does not offer: they read the same typed
observation the JSON is encoded from.

### 2.5 Writing actors for Rust

Rewritten, not transliterated:
- **Interned ids** (`u32`) inside the engine, strings at the edge (perf list item 3, done as part of this).
- **Data by kind**: the citizens' hot state (needs, values, feelings, money, plans) in arrays indexed by citizen, cold
  state (memories, books) in per-actor structs. Firms and offices are few and stay as structs.
- **Fixed-point where the TS used floats for basis points**; floats only where a model needs them (half-lives,
  softmax), and then from the `libm` crate so the same run gives the same numbers on any machine.
- **Ordered collections** (`IndexMap`, sorted `Vec`) wherever iteration order can reach an outcome; `HashMap` only for
  lookups that are never iterated. A lint test greps the crate for iterated `HashMap`s.
- Every module keeps its doc in `docs/behaviour/`, its sources and its parameters; a parameter's name and meaning do
  not change, so profiles and configs keep working.

---

## 3. Keeping results right without byte identity

The Rust world is a new world. It is not required to reproduce the TypeScript world's state hashes; a different float
path, a different order of tied options or a rewritten loop is allowed to put a different person in a different job.
What it must reproduce is the behaviour. **The gate**, all of it on the Rust world, run by one integration agent:

1. **Every scenario test passes.** The orchestrator's 132 test files run the Rust world through the existing TS
   harness, unchanged in what they assert. State-hash pins (21 files) are re-taken once, at the cut-over, each with its
   comment. A test that fails is a port bug until shown otherwise; loosening an assertion needs the reason written in
   the test and in the decisions log, as today.
2. **Standing measures within seed noise.** A year of the 1,000-person living town in au-vic, gb-eng and ke-nakuru,
   five run seeds on each side (TS on the frozen commit, Rust on the candidate), `oikos diff` over the 57 measures:
   **none beyond three standard errors**, and each beyond two named with a likely cause. `oikos health` breaches the
   same in kind. (Five seeds, not three: the Rust side is cheap and the test gains power.)
3. **Twins are exact within the Rust world.** `twin-draws`, `twin-seat-year` and the seated twin tests: a mock seat
   sitting as its code twin through `actorStep` gives the code-only run's acts, draws and decisions exactly.
4. **Determinism**: the same seed gives the same state hash on 1, 4 and 14 threads, and twice in a row; replay of the
   log reaches the run's final hash.
5. **The backstops pass**: `no-god-view.test.ts`, `all-work-takes-time.test.ts`, `generality.test.ts`, extended to
   read the Rust manifests and to scan `kernel/crates/actors` where they scan `participants/src` today (no place's
   figure in Rust code; no error drawn outside `slip()`; no dial handed to an actor).
6. **Truth audits** on in every scenario test: zero divergences, as today.

Per module, while porting: each porting agent runs its module's scenario tests against a mixed world where possible
(section 4.2) and ports its module's unit tests from `participants/test` to Rust tests beside the code. A unit test that
pinned a TS-specific number is rewritten to assert the behaviour it stood for.

Where the TS relied on JavaScript semantics, the Rust decides fresh and says so in the module's doc: `Math.round`'s
half-up becomes an explicit rounding rule; comparators that never return 0 get an id tie-break; string order is byte
order (ids are ASCII; names are never sorted for an outcome); object key order is never relied on.

---

## 4. The schedule

### 4.1 Before it starts

- **Freeze.** When the disempowerment build in flight (`gd-adoption`, `gd-strikes` and whatever else of B1 to B13 is
  running on 2026-10-17) merges, TypeScript behaviour is frozen: no change to `participants/src/behaviour/*` or to the
  generator's output except a fault that corrupts a running pilot's data, and each such fix goes on a list the porting
  agents pick up. Disempowerment steps not yet started are built in Rust after the gate. The freeze commit is tagged
  `ts-world-final`; it is the referee for the measures and stays runnable.
- **Kept going in TS meanwhile**: model seats, the translator rebuild and its training, pilots on the TS world (all
  pilots up to the gate, including the 400-day one; their logs are training data and stay valid), pilot-view and the
  explorer, the reports. None of them touches behaviour code.
- The perf agent's kernel work continues; anything it changes in `perception` or `world` is merged into the port
  branch daily.

### 4.2 Phases (agents at once, which modules, how long)

Day counts are working days of wall time; "agent-days" is the sum across agents. Sonnet unless named.

**Phase 0: the frame (1 Opus agent, 3 days; 3 agent-days). Starts now; does not need the freeze.**
The `actors` crate and its `Actor` trait (step, beliefs, sent, manifest), the typed context (keyed randomness,
`slip`, parameters, world info, questions out), interned ids, the `rules` crate's skeleton, the engine loop of 2.2
with parallel look and decide, the N-API calls of 2.3, the mixed mode (a code actor kind may still be run by the TS
host while others are Rust, so each phase-1 agent can test its kinds in a whole town before the others are done), and
the porting guide for the agents (2.5 as a checklist). It also ports `common.ts`'s `Book` and steps, `calls`, `forms`,
`law` and `slip` (about 3,000 lines), since every actor stands on them.

**Phase 1: the actors (7 agents at once, 6 to 8 days; about 45 agent-days).** Each in its own worktree and branch off
the frame; each ports its unit tests and runs its kinds' scenario tests in mixed mode.

| Agent | Model | Modules | TS lines |
|---|---|---|---|
| A1 citizen: life | Opus | `citizen.ts` (housing, work, money, lifecycle, deaths, recourse), `household`, `health` | about 3,500 |
| A2 citizen: mind | Opus | `citizen.ts`'s deciding half, `mind`, `inner`, `wants`, `culture`, `townmemory`, `reading`, `founding`, `founded` | about 4,500 |
| C1 firms | Sonnet | `firms`, `payroll`, `returns`, `tax`, `payments`, `orgwants`, `practice` | about 3,500 |
| C2 market | Sonnet | `retailer`, `producer`, `trade`, `lengnick`, `world`, `environment` | about 2,900 |
| D finance and bodies | Sonnet | `bank`, `credit`, `fund`, `union`, `news`, `frictions`, `decisions` | about 2,000 |
| E public offices | Sonnet | `government`, `institutions`, `police`, `tribunal`, `desk`, `school`, `elections`, `utilities`, `papers` | about 5,000 |
| F the edges | Sonnet | the generator's calls into `rules`, manifests to JSON, the backstop tests reading Rust, the detached actor for twins, the TS harness switch (`OIKOS_WORLD=rust`), the socket server | n/a |

A1 and A2 split one 5,000-line file, so phase 0 fixes the seam between them (the mind's interface: `decide`,
`consult`, feelings, pursuits) before they start. Seven agents fit the machine (M4 Pro, 10 performance cores, 64 GB):
each builds in its own target directory, test towns go through the slots, and no agent runs the full suite.

**Phase 2: integration and the gate (1 Opus and 2 Sonnet, 5 days; about 12 agent-days).** Merge the seven branches,
turn mixed mode off, run section 3's gate, trace every failure to its module and send it back to whoever ported it
(still in context, by SendMessage). The Opus agent judges what is a port bug and what is a legitimate new outcome;
anything of the second kind is written up, not tuned away. If it turns into whack-a-mole, checkpoint with the owner.

**Phase 3: speed (1 Opus, 1 Sonnet, 3 days; about 6 agent-days).** Measure on a quiet machine, then the largest costs:
the serial carry-out (shared leaves in `state.rs`, perf list item 4), contract checks by alternative (item 5), the
citizens' arrays laid out for the decide pass. Report a 1,000-person year and a 10,000-person year, wall time, CPU time
and peak memory, against `ts-world-final`.

**Phase 4: delete and tidy (1 Sonnet, 2 days; 2 agent-days).** Delete the TS behaviour modules, `rng.ts`, `canon.ts`,
`money.ts` and the TS resolver; keep type shims the seats need; update `CLAUDE.md`'s Stack line, the handover, the
behaviour docs' pointers and the decisions log. `bun run test:all` once, on the merge.

**Total: about 4 weeks of wall time and about 70 agent-days**, of which roughly a third is Opus (the frame, the
citizen, integration, speed). No model calls.

---

## 5. Concurrency and the GPU

- **All cores, deterministically.** Look and decide run on a Rayon pool over the cohort in fixed chunks; each result is
  written to its own slot in a vector ordered by unit key, so the merge order never depends on which thread finished
  first. Randomness is keyed by participant, moment and purpose (as today), never by order of drawing, so the number of
  threads cannot change a draw. Gate item 4 holds it.
- **What stays serial**: carrying out (the kernel is the only writer, and order is part of the world's physics) and the
  log. They are about 15% of today's run at 10,000 and are phase 3's target.
- **The GPU: not in this port.** The actors are branchy, string- and record-heavy decisions, the wrong shape for a GPU,
  and a float on a GPU is not reproducible. Unified memory on Apple Silicon makes it cheap to hand arrays over, so the
  later candidates are integer kernels over grids and arrays: nature's fields (water, soil, species by cell), travel
  and site cells, and at 100,000 people the citizens' scoring pass (option scores in basis points, fixed-point
  softmax). Revisit when a profile after phase 3 shows one of those over 15% of a run.

---

## 6. The expected speed-up, and what it rests on

- **The boundary goes**: encoding observations (about 6% of today's 10,000-person run), parsing them on the host (12%)
  and restoring records by id (5%) leave the code actors' path entirely; seats keep it, and they are few.
- **The actors in Rust**: the host's 52% is single-threaded JavaScript over maps of strings. Rust with interned ids and
  arrays should run the same decisions 3 to 5 times faster on one core, then across 10 performance cores.
- **What bounds it**: the serial carry-out and log. If they stay as they are, the whole run gains about 4 to 6 times at
  10,000 people (a 10,000-person year from about 30 minutes to 5 to 8); with phase 3's work on the serial path, about 8
  to 10 times. Memory should fall by 2 to 3 times (no JSON values for actors' observations or memory).
- These are estimates from the sampled profile, not measurements. Phase 0 measures them early: the frame with one
  ported kind (the outside world's buyer, trivial) and the citizen still in TS shows the boundary's cost directly, and
  A1/A2's first mixed-mode towns show the citizen's.

---

## 7. Risks

- **The citizen.** One 5,000-line module that most outcomes run through, split between two agents. Mitigation: the
  seam is fixed in phase 0; both are Opus; the citizen's scenario tests (deaths, housing, recourse, culture, founding)
  are its gate before integration.
- **A new world means new pins and new baselines.** Every calibration note, health breach and measured "before" in the
  decisions log refers to the TS world. Gate item 2 is what carries them over; the first Rust baseline is written up
  as such.
- **Mixed mode is temporary code.** It exists for phases 1 and 2 only and goes with the TS modules in phase 4.
- **Fixes during the freeze** are applied twice (TS for a running pilot, Rust on the list). Keep the list short by
  keeping the freeze strict.
- **Researchers' modules.** VISION wants behaviour to be swappable world content. A researcher can still swap any actor
  for an outside seat through the participant API, in any language; writing a new built-in actor now means Rust. That
  is the owner's trade, recorded.
- **Seven agents on one machine** beside pilots. Builds go through the slots; if the machine is the bottleneck, run five
  (merge C1 and C2, and D into E).

---

## 8. For the owner

1. **The gate: measures within three standard errors, five seeds a side, three profiles; scenario tests, twins and
   backstops exact.** Recommended as written. A looser gate would let a mis-ported mechanism through as "noise".
2. **The freeze starts when the disempowerment steps now running merge; disempowerment steps not yet started are built
   in Rust afterwards.** Recommended: it is the only way not to port a moving target, and it costs about four weeks of
   no new TS behaviour.
3. **The generator stays in TypeScript, calling Rust for the shared rules.** Recommended: it is configuration, runs
   once, and is where researchers work. Revisit if it ever shows in a profile.

**Stop or change course if:**
- after phase 0 the frame shows the boundary's cost is under a fifth of what section 6 assumes (then the gain rests on
  Rust actors and cores alone; re-profile before phase 1);
- at the end of phase 1 fewer than five of the seven agents have their scenario tests passing in mixed mode;
- in phase 2 measures drift beyond noise for reasons that keep tracing to faithful ports rather than bugs (the TS
  world had an accidental mechanism the Rust one does not; checkpoint with the owner, do not tune);
- a pilot needs a behaviour change that cannot wait for the gate for more than a week;
- a single-threaded Rust 1,000-person year is under twice as fast as the TS one (the port's case was wrong somewhere).

Rationale and revisit lines are in `docs/decisions.md`, 2026-10-17, "The world goes to Rust".
