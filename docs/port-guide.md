# Porting the world to Rust: the guide

For the agents porting the built-in actors (plan: `docs/design/rust-port.md`; the frame: decisions log, 2026-10-17,
"The port's frame"). Read `CLAUDE.md`, `docs/no-god-view.md`, `docs/all-work-takes-time.md` and `docs/risks.md` first:
their rules bind every actor you write.

**The cutover is all at once** (the owner, 2026-10-17). There is no bridge: TS actors and Rust actors never run in
one world. Each lane ports its modules and tests them alone in the Rust world, with stand-ins for what it depends on;
then one integration step switches every module over together and runs the gate. Backward compatibility is not
required: old logs need not replay on the new world (the `pre-foundations` tag and the old code keep them), and the
log format and the tools may change if the logs get better.

---

## 1. The frame

```
kernel/crates/
  sight     what an actor may see and say: Observation and its parts, the Picture (view.rs, from view.ts),
            Action, the call language (re-exported). Values only.
  rules     pure rules the actors and the generator share: slip.rs; calendar.rs (civil dates, weekdays, holidays,
            calendar months from the world's start date); identity.rs (ids and names); withholding, support,
            decisions, household, forms to come. Depends on core alone.
  actors    the actors: lib.rs (Actor, Kind, Ctx, Cx, Question/Answer, Belief), steps.rs (Step, Plan, Stepper, say/pay),
            draws.rs (how streams are named), registry.rs, boundary/weather.rs (the worked example), stub.rs.
  explore   the explorer's data layer, interface only (section 9).
kernel/src/engine.rs   the run loop with the actors inside: units from the cast, rounds, parallel decide, carry-out.
kernel/tests/engine.rs, actors_boundary.rs   the engine's tests and the boundary backstop.
orchestrator/test/port-weather.test.ts       the worked example against the TS module, to the state hash.
scripts/port-gate.ts                         the gate's measured half.
```

- **The boundary is a dependency rule.** `oikos-actors` depends on `oikos-sight`, `oikos-core`, `oikos-contracts`,
  `oikos-rules`, `serde`, `serde_json` and nothing else (`kernel/tests/actors_boundary.rs` checks the list). A Rust
  crate can name only its own dependencies, so an actor cannot name `State`, `World`, `observe` or the resolver's
  knowledge. Adding a dependency to `actors` needs the integration agent's yes and a line in this guide.
- **A moment** (engine.rs, top comment): those due wake in key order; each looks through the kernel's command path
  (logged, delivered, knowledge kept for the resolver); every code actor of the round steps at once on up to
  `threads` threads, each result in its unit's slot; seats go to the host; then everything is carried out serially in
  key order. A step is a pure function of the picture, the actor's own memory and its keyed streams.
- **Questions to models** (consult, compose, reading): `cx.ask(Question)` in one wake; the engine queues them
  (`Engine::questions`); the host answers (`Engine::answer`); the answers arrive in `cx.answers` at the actor's next
  wake. An actor never waits inside a step.
- **Seats** attach through the participant API: `Engine::next()` returns `Due::Seats` with each awake seat's
  observation as the contract's JSON; the host `submit`s an `Action` for each (a confirmed draft is an `Act` with its
  provenance); `next()` again carries the round out. The TS seat host is wired to this in the integration step (lane F).

## 2. Conventions (the checklist; rust-port.md 2.5)

- **Rewrite, do not transliterate.** Same behaviour, same parameters (names and meanings unchanged, so profiles and
  configs keep working), Rust's shape. A module's doc in `docs/behaviour/` keeps its sources; update it where the Rust
  decides fresh.
- **Integers** for money (cents), basis points, ppm, seconds. Floats only where a model needs them (half-lives,
  softmax), through `libm`, and rounded to an integer before anything compares or records them.
- **Ordered collections** (`BTreeMap`, `BTreeSet`, sorted `Vec`) wherever iteration can reach an outcome. `HashMap`
  only for a lookup never iterated, with `// lookup only` on the line (the backstop greps).
- **No clock, I/O, env, threads, globals, `RefCell`, `Mutex`, `rand`** in `actors` or `rules` (the backstop greps).
  Randomness only from `cx.rng(purpose)` (named by who, the matter or day, and the purpose: draws.rs) or
  `cx.chance(purpose)` (a fact about a thing). A slip only through `oikos_rules::slip::slip(cx, ...)`.
- **Where TS relied on JavaScript**, decide explicitly and say so in the module's doc: `Math.round` (half up), ties
  (an id tie-break), string order (byte order; ids are ASCII; never sort names for an outcome), object key order (never
  relied on). Record ids sort by `filedBefore` (rec.9 before rec.10), not as strings.
- **Dates are civil dates.** A month is a calendar month (`rules::calendar::Calendar::months_after`), not 30 days,
  wherever the law or a contract says a month; a working day is the calendar's. Ids are keys; what a seat reads is a
  name (`rules::identity`).
- **No place in the code.** Every place figure is a parameter from the profile (docs/profiles.md); the generality
  backstop will scan `kernel/crates/actors` and `rules` as it scans `participants/src`.
- **No god's view.** An actor knows what it was shown (`Picture`), its parameters and its memory. What it keeps whole
  (a register's keeper) is declared in its manifest's `keeps`, what it carries of the world's edge in `boundary`
  (weather.rs does), with the reason in words.
- **All work takes time.** Never write a mechanic that does something by itself: every effect is an act the kernel
  places on its performer's timeline. A module that needs another body's work sends it a paper.
- **Every actor's memory saves** (`Actor::save`, `Kind::restore`: required). A `Stepper` saves its plan and steps for
  you if the plan and its token derive `Serialize`/`Deserialize`. This is what snapshot and fork rest on.
- **Manifests**: `Kind::manifest()` returns the module's manifest (contracts/module.schema.json); until the cut-over it
  must equal `participants/manifests/<name>.json` in every key that file has (engine.rs test for weather shows how).
- **Market laws are built natively, not ported** where the risk register flags a fixed rule (risks.md ME-*, A-2, the
  summary): business entry by expected profit, not a fixed birth rate, and new businesses able to employ; prices from
  supply and demand; hiring by firms that need labour; exports from demand, not the opening output; rents set by the
  market at review, not +5% every time; strikes settled by a bargaining model, not won after three stoppages. Each with
  its real-world source in `docs/research/references.md`, the risk's entry updated in `docs/risks.md`, and a line in
  the decisions log. Coordinate with the disempowerment agent's market check (branch `gd-adoption`) before building.
- **Fix wrong assumptions as you go**, each with a real-world basis, recorded in `docs/risks.md`. Calibrate
  mechanisms, not outcomes: a bad outcome that emerges is not a bug.

## 3. How to port a module (the worked example: `world.weather`)

1. Read the TS module and its doc. Read its unit tests (`participants/test`) and the scenario tests that exercise it
   (`grep -l <name> orchestrator/test`).
2. Write the kind in `kernel/crates/actors/src/<group>/<module>.rs` (`boundary`, `citizen`, `mind`, `firms`,
   `finance`, `offices`): a `struct` implementing `Kind` (name, version, doc, manifest, cadence, first_wake, deaf,
   create, restore) and its actor. An office that plans work and sends it one act at a time is a `Plan` run by
   `Stepper` (steps.rs: what `stepper` was in firms.ts; `then`/`redo` are the plan's methods given the step's token).
   Build calls with `steps::say`, `steps::pay`, `steps::call`; the program is written in name order, as TS's was.
3. Register it in `registry.rs` (one line).
4. Port its unit tests beside the code (`#[cfg(test)]`), rewritten to assert the behaviour, not TS's numbers.
5. Test it alone in the Rust world (section 4).
6. Bump nothing in TS. TS behaviour is frozen.

`world.weather` (boundary/weather.rs) took 120 lines: a `Plan` with no books, its `plan` the TS one's loop, its
`until` the next warning. `orchestrator/test/port-weather.test.ts` runs the TS module in the TS loop and the Rust kind
in the engine on the same generated town, every other actor idle in both, and gets the same warnings and **the same
final state hash**, and the same hash on 1 and 14 threads. A module ported that faithfully, in a world where every other
actor is idle or scripted, should match its TS twin to the hash; where it decides fresh (section 2), it will not, and
the test asserts the behaviour instead.

## 4. Testing a module alone

- **Rust tests** (`kernel/tests/<lane>_*.rs`, `cargo test --test <file>`): start from a world config (a small
  hand-written one, `common::riverbend()`, or a generated town written to JSON by a TS helper), point the participants
  under test at your kind, and run `engine::run_code_world` with `EngineOptions { stand_in: Some("idle".into()), .. }`
  so every kind not yet ported stands idle. Read the log (`Engine::into_log`) and assert on records, events and acts.
  kernel/tests/engine.rs shows each step.
- **Stand-ins for what you depend on**: `idle` (does nothing), and `stub.script` (does what its `script` param says,
  when it says: `[{ "at": seconds, "call": "<call language>" }]`), so a landlord's notice, an employer's pay or a
  bank's statement reaches your actor as the real one's would. Write the dependency's papers exactly as its lane's
  paper types say (section 5).
- **TS scenario tests are the outside referee**, run against the all-Rust world once every module is in (the
  integration step). Before that, a lane may run a scenario test against a Rust world where everything else is idle or
  scripted if the test's assertions only touch its modules (as port-weather.test.ts does).
- **Determinism**: every lane's tests run their world on 1 thread and on 14 (`EngineOptions::threads`, `share_at: 1`)
  and assert the same hash.
- **Heavy runs through the slots** (`bun scripts/slots.ts --weight N -- cargo test ...`). Each lane builds in its own
  worktree's `kernel/target`. Never run `test:all`.

## 5. The interfaces between modules

Modules meet only through the world: papers (statements of a kind, with their `data`), agreements (by template),
payments (with memos, `settles`, `per_instruction`), letters, and forms. That is the whole interface, so it is fixed
before the lanes start:
- **Paper types.** Every statement kind a module writes and another reads has one Rust type, in
  `actors::papers::<kind>` (from participants/src/behaviour/papers.ts and the `say(...)` calls), `Serialize` +
  `Deserialize`, with the writer's and readers' modules named in its doc comment. The writer serialises it into the
  statement's `data`; readers deserialise it. Owned by the lane that writes it; changed only with the readers' lanes
  told (SendMessage) and a line in the decisions log.
- **Agreement templates** and their terms: `actors::papers::agreements`, the same way.
- **Forms** (an office's stationery: `issues`, `takes`): data, in `rules::forms`, exported in a stable schema the
  translator reads by name (lane E).
- **The mind's seam** (A1 and A2 share `citizen.ts`): a trait `citizen::Mind` (decide among options with their facts,
  consult, feelings, pursuits; the TS `decide` and `ConsultQuestion` shapes) that A1's life code calls and A2
  implements.
These are written in the common-ground step (section 8, step 1b) before the seven start, from the TS as it is.

## 6. What not to touch

- `kernel/crates/world`, `perception`, `contracts`, `terms`, `law`, `nature`: the world's physics. A change needs
  the integration agent (and stays physics: no laws in the kernel).
- `kernel/src/engine.rs` and `crates/sight`: the frame; changes through lane F or the integration agent.
- Anything in `participants/src/behaviour/*` or the generator's output (frozen; a fault that corrupts a pilot's data is
  fixed in TS and listed for the port).
- Another lane's modules and paper types (message their owner).
- `docs/decisions.md` beyond your own appended entry; `CLAUDE.md`.

## 7. The gate

All on the finished Rust world (rust-port.md section 3): every TS scenario test passes; a year of the 1,000-person
living town in au-vic-2026, gb-eng-2026 and ke-nakuru-2026, five seeds a side, every standing measure within three
standard errors and each beyond two named with a likely cause, health breaches the same in kind
(`bun scripts/port-gate.ts --ts <checkout of ts-world-final> --rust <candidate>`); twins exact; the same state hash on
1 and 14 threads (the harness checks this too); the no-god-view, all-work-takes-time and generality backstops,
extended to read the Rust manifests and scan `kernel/crates/actors` and `rules`; truth audits on in every scenario
test with zero divergences (the engine's `audit` option ports truth.ts).

## 8. The split

**Step 1b, the common ground (1 Opus, about 2 days; before the seven).** `common.ts`'s Book, Letters, StandingWork,
ask/lookUp, Occurrences, `filedBefore`, `team`, agreement reading (`commitmentOf`, `Outcome`), `receipts`; the paper and
agreement types of section 5 (papers.ts and every `say(...)`'s kind); `forms.ts` and `law.ts` into `rules`; the mind's
seam trait. About 3,500 lines of TS. Everything below stands on it; with it, the seven need not wait on each other.

**Step 2, the seven at once (6 to 8 days).** Each in its own worktree off the frame; each ports its unit tests, tests
its kinds alone (section 4), and messages the owner of any paper type it needs changed.

| Lane | Model | Modules | Needs | Also |
|---|---|---|---|---|
| A1 citizen: life | Opus | `citizen.ts` housing, work, money, lifecycle, deaths, recourse; `household`, `health` | 1b, A2's seam (trait only) | `rules::household` for the generator |
| A2 citizen: mind | Opus | `citizen.ts` deciding; `mind`, `inner`, `wants`, `culture`, `townmemory`, `reading`, `founding`, `founded` | 1b | the questions to models (consult, compose, reading) |
| C1 firms | Sonnet | `firms`, `payroll`, `returns`, `tax`, `payments`, `orgwants`, `practice` | 1b | native firm entry by expected profit and hiring by need (risks); `rules::withholding`, `support` |
| C2 market | Sonnet | `retailer`, `producer`, `trade`, `lengnick`, `world.ts` (the rest of the edge), `environment` | 1b | native price formation; exports from demand (ME-15); rents at review (with A1) |
| D finance and bodies | Sonnet | `bank`, `credit`, `fund`, `union`, `news`, `frictions`, `decisions` | 1b | a bargaining model for strikes (A-2); `rules::decisions` |
| E public offices | Sonnet | `government`, `institutions`, `police`, `tribunal`, `desk`, `school`, `elections`, `utilities`, `papers` (issued forms) | 1b | the forms registry exported by name for the translator |
| F the platform | Opus | the seat interface (N-API/socket `next`/`submit`; many seats in flight across forks; cost per seat), the TS host on it (`OIKOS_WORLD=rust`), snapshot and fork (kernel state + `Engine::save_actors` + schedule + knowledge), a binary log (snapshots + deltas) with JSONL as an export, a live event stream, manifests to JSON, the generator calling `rules`, the twins' detached actor (`actorStep`), the backstops reading Rust, the reserved shapes for travel (positions in transit, roads with capacity, vehicles as owned things that work: shapes only) | the frame | the experiment harness on snapshot and fork if time allows; otherwise lane G |

**Lane G, the explorer and experiments (1 Sonnet, can start now; reads logs only, independent of the actors).** The
explorer's data layer in `kernel/crates/explore` (section 9), ported from the `explorer` branch; then the experiment
harness on F's snapshot and fork: many seeds and forks across cores, each with a different steward or none, measures
collected per fork set (the unit of an experiment is a set of forks).

**Lane N, names and ordinary dates (1 Sonnet, can start now; docs/design/names-and-dates.md).** The profiles'
`names` and `calendar` sections with sources (research agents, one a profile, as the profile pattern does); names drawn
in the generator by streams keyed on stable identities (twins hold); offices' own references for records
(`data.reference`); the config's start date and `rules::calendar` (types in the frame) with a shared test file in
`contracts/test/`; the resolver reading names and dates (only among what the seat has been shown) and seats shown names
and dates, ids underneath for the log and tools. Lanes A1 to E write papers with dates through `rules::calendar` and
never "year N, day D". The translator's next round learns names and dates.

Seat-side readers (`openbooks*`, `daybook`, `roster`, `tally`, `diary`) stay TS.

**Step 3, integration and the gate (1 Opus, 2 Sonnet, about 5 days).** Merge the lanes; every module switched over
together; the TS scenario tests against the all-Rust world; `scripts/port-gate.ts`; every failure traced to its module
and sent back to its lane. Then speed (phase 3 of the plan) and deleting the TS actors (phase 4).

## 9. The explorer's data layer

Interface fixed in `kernel/crates/explore/src/lib.rs`; implementation is lane G's, ported from `renderer/src/
indexer.ts`, `store.ts`, `trace.ts`, `world.ts` and `panels.ts` on branch `explorer` (not reinvented):
- `RunIndex`: every kept line by ordinal, the lines naming an id (person, place, organisation, record, account), lines
  by day, the act behind each effect; the run's meta.
- `RunIndex::trace(ord, about, depth)`: the causal trace as `Link`s (role, sentence, who, class, why, status, record),
  newest first, back through acts, standing instructions and bases to genesis; nothing inferred.
- `Decider`: self, person, system, seat, world, by role in the world.
- `RunIndex::panel`: person, organisation, building, seat's act, town pulse, as the client's JSON.
- `ROUTES`: the HTTP/JSON service on 127.0.0.1, the same routes `renderer/src/server.ts` serves, so the Three.js client
  is unchanged. A Rust viewer (Bevy) uses the trait in process, and can index a live run from F's event stream.
- Debriefs and what a seat kept back are never indexed (VISION 15).
