# Performance: where a run's time and memory go, what was fixed, and the ideas ranked

Two passes. The first (below, "Before the port") measured the TypeScript world on 2026-10-17. The second, here, measures the
Rust world after the cut-over (branch `perf-2`, 2026-10-23), fixes what it found, and ranks what is left.

## Bytes per person: the budget, and what each person costs (2026-10-25, from branch `mem-budget` on)

**The budget.** A town's memory is a fixed overhead and so much for each person; the goal (Naz, 2026-10-25) is about
50 KB a person at the peak, so 50,000 people in some 2.5 GB and 100,000 in 5 GB beside the overhead.
`scripts/memory-budget.json` holds the target, the fixed overhead (110 MB, measured), and the ceiling held now;
`orchestrator/test/memory-budget.test.ts` (slow tier) runs `worlds/town-1000.yaml` for 30 days on the release kernel
at 4 engine threads and fails if `(peak resident - overhead) / people` passes the ceiling. The kernel's `world` command
says its peak (`getrusage`'s maximum resident set: the same measure on macOS and Linux). The ceiling starts at what
main costs (590 KB, from 546 KB measured and a margin for run to run), and each cut that lands lowers it towards the
target in the same commit; raising it is a decision with its entry in docs/decisions.md. The target is not met until
the ceiling is 50 KB.

**How it is measured.** Peak resident memory of `oikos-kernel world`, all code, the log piped away and not kept;
`OIKOS_ENGINE_THREADS` given with every number. By component: the sampling heap profiler (`--features heapprof`) at
its high-water mark, each live allocation put with a component by its call stack (`scripts/heapprof.ts <dump> <dwarf>
--components PEOPLE`): the state hash's and the log's by any frame of theirs on the stack, the rest by the innermost
of the kernel's own frames. Sampled live bytes at the peak, so a little under the resident peak (the allocator's own
and the binary's are not in it).

**Main at the start (`3b87959e`), 30 days, 14 threads.** Resident peak; per person after the 110 MB overhead.

| town | peak resident | per person | wall |
|---|---|---|---|
| 203 people | 0.25 GB | | 3 s |
| 1,000 (au-vic / gb-eng / us-oh) | 0.69 / 0.67 / 0.57 GB | 583 / 560 / 455 KB | 15 / 10 / 9 s |
| 10,000 | 5.25 GB | 514 KB | 121 s |
| 50,000 | 34.2 GB (40.8 GB footprint) | 682 KB | 1,004 s |

By component at the peak (KB a person, live, sampled):

| component | 1,000 | 10,000 | 50,000 |
|---|---|---|---|
| what's been seen (buildings seen, views, knowledge) | 59 | 52 | **408** |
| the state hash's encoded copies (the whole state's canonical bytes, at a checkpoint) | (not at the peak) | 82 | (not at the peak) |
| the engine (units, the records delivered and what they add) | 82 | 58 | 61 |
| citizens' minds | 33 | 47 | 69 |
| citizens (person, params) | 44 | 48 | 59 |
| world state (records made, accounts, bodies) | 48 | 40 | 36 |
| the config (typed, controllers) | 30 | 30 | 32 |
| offices, firms and other actors | 18 | 9 | 9 |
| other (the compiled schemas, the log's buffer, unattributed) | 112 | 25 | 16 |
| all, live | 435 | 391 | 697 |

What grows faster than the town is what's been seen: a building's view lists who is in each of its spaces to anyone
known there, a workplace's hundreds of people are each shown all the others, and every person kept their own copy of
each building as they last saw it, so it grows as people times the people they share a building with. At 10,000 the
peak fell on the month's checkpoint, when the state hash wrote the whole state's canonical bytes out of a copy it
held whole. Minds and memories are `mem-minds`'s (compact formats).

**The cuts, each landed alone, each byte-identical (the same state hash and log digest on 203 people, three profiles'
1,000 and 10,000, 30 days).** Peak resident at 14 threads; the budget's ceiling after it; instructions against main.

| cut | 1,000 au-vic | 10,000 | 50,000 | ceiling | instructions |
|---|---|---|---|---|---|
| main (`3b87959e`) | 693 MB | 5.25 GB | 34.2 GB | 590 KB | |
| the state hash streamed, no cache (`mem-state-hash`) | 592 MB | 4.34 GB | | 480 KB | +0.4% at 10,000, +0.1 to 2.6% at 1,000 |
| what's been seen held once (`mem-seen`) | 521 MB | 3.12 GB | 17.2 GB (956 s, against 1,004) | 410 KB | at or under main: -0.5 to 0% at 1,000, -10.6% at 10,000, -21% at 50,000 |
| records delivered without bytes for code actors; channel lists shared (`mem-delivered`) | 512 MB | 2.98 GB | 17.0 GB (857 s) | 390 KB | paired with main at 4 threads, three times on each profile: wall -1 to -5%, user CPU -5 to -8% |

*Records as delivered.* The kernel kept, for every record anyone was shown, its canonical bytes and what it adds to a
seat's knowledge, for the whole run. A code actor's look needs only what it adds: its bytes are now made only for an
observation that is written (a seat's, or one whose hash the log keeps), and kept as before. A town's people's
channel lists (one or two among them) are read once at the start and shared.

*What's known of a building.* A code actor's knowledge keeps, for each building it is shown, its type, place and
spaces (`StructureFact`); it was made again whenever the building's view changed (someone came or went), and each
person's knowledge kept its own. It is made of the building, not of who is in it, so it is now one for everyone while
it says the same.

*Large towns, all of it with the minds' and memories' cut (`mem-minds`) beside (local build, 2026-10-26).* 50,000
people for a month: 14.7 GB resident, 604 s (main: 34.2 GB, 1,004 s), the same state hash. **100,000 for a week:**
31.0 GB resident, 320 s wall, state `6fea086aa5d0f8c1`. Its peak is the first moment (the footprint is 39 GB about
two minutes in, then 22 to 27 GB): every unit decides at once, and with seats awake in that round each one's decisions
are held, as values and as their canonical bytes, until the round is carried out (16 GB of bytes at 100,000). Holding
the bytes compressed was tried and dropped: no smaller (the values stay) and slower (40.4 GB, 551 s). The next cut is
there: a round's decisions held once, as bytes, when seats are in it, or the first moment decided in windows.

*Biggest holders left* (10,000 people, the 10,000 month's peak, with mem-minds; 195 KB a person live): the engine
(units, rounds, records delivered) 49, world state (records made, accounts) 39, minds 29, citizens' person and params
25, the typed config 24, other 14, offices and firms 9, the compiled schemas 4, the log's buffer 2, what's been seen
1, memories 1. At 1,000 people at the budget's settings: 322 KB a person (main 546). The target is 50.

*How the cost was told.* Instructions retired move by 1 to 2% between runs of the same build as the machine's load
varies (the thread pool's idle threads spin), so a cost of that size is told by running main and the cut in turn on
the same towns, three times each, at a quiet hour: `pair.sh`, its numbers above.
| what's known of a building, one per building (`mem-facts`) | 499 MB | 2.97 GB | 16.9 GB (595 s) | 380 KB | |
| the first moment decided a window at a time (`mem-first`) | 508 MB | 2.99 GB | | 380 KB | the 100,000 week: footprint 33 GB against 43, the same instructions, wall 414 s against 433 (paired) |

*What's been seen.* A building as someone sees it (its spaces, who is in each where that can be told, its wear) was
made at every look and kept by everyone who saw it, each their own copy: at 50,000 people, 408 KB a person. Now it is
made once for everyone who sees it the same (per building, and whether the looker can be told who is there) and made
again only when what it is made from has changed (the building, its occupancy, its spaces' departures and arrivals:
compared by where they are in memory, since the state never changes them in place, and field for field); held while
anyone holds it. Debug builds check each one kept against one made afresh. A view kept the cells it had seen as a map
and copied them into the list it handed its actor besides; it keeps the one list. A first version held the buildings
behind one lock per shard and made the 50,000 month 58% slower in wall time (the people of one building look at once,
on many threads, and queued for its shard); read under a shared lock, the comparison outside it, it is faster than
main.

### A plan for what is left: the world's data held compactly (the owner's target 90 to 120 KB a person; begins after foundations-2 phase 2 lands)

What is left is no longer copies. It is the world's own data and the actors' state, held as general-purpose values:
every id a `String` of its own wherever it appears (`blocks::Id = String`: in records, ledgers, maps' keys, knowledge),
records' free parts and entity records' sections as `serde_json::Value` (a small map of a few members costs some
600 bytes as a `BTreeMap` node), a transaction a row of five or six strings. Read through the profile's inlined frames,
the "engine" holder at 10,000 people (49 KB a person) is mostly this: records made, money moved, entity records merged.
So the remaining cut is a change of representation, landed in steps, each byte-identical (the same state hash and
log digest on three profiles' towns at 1,000, and 10,000 and 50,000), each without loss of speed (paired against main),
each lowering the budget's ceiling.

| step | what | crates | estimate | expected (KB a person, live, of 195 at 10,000) |
|---|---|---|---|---|
| R1 | **Ids interned**: `Id` an interned shared string (one copy of each id for the process, ordered and serialised as the string it is, so every map's order, every hash and the log are unchanged) | every crate (`Id` is used in 28 files across contracts, world, perception, resolver, sight, nature, actors and the kernel: mostly mechanical, `String` operations on ids become the handle's) | 4 to 6 agent-days | -30 to -50: ids are the most repeated thing held |
| R2 | **A compact frozen value** for what is opaque JSON in the state: records' `about`/`data`, entity records' sections, the typed config's controllers (`oikos_core::Frozen`: immutable, maps as sorted arrays with interned keys, shared subtrees), with the read API the code uses of `Value` and the same serialisation | core, contracts, world, perception, resolver, sight, actors (readers) | 4 to 6 agent-days | -25 to -40 |
| R3 | **Compact ledgers**: a transaction a fixed row (interned ids, integers), accounts' histories in persistent vectors of them | world, perception (accounts channel), sight, actors (statements, books) | 2 agent-days | -5 to -10 |
| R4 | **The actors' remaining state** in typed forms (offices' and firms' books, held as `Value` maps now), after `mem-minds`'s minds and memories | actors | 2 to 4 agent-days | -10 to -20 |

In all 12 to 18 agent-days, to perhaps 90 to 120 KB a person live at 10,000 (from 195): the owner's target for it
(Naz, 2026-10-26), about 150 resident at the
budget's 1,000 (from 322 with `mem-minds`). **That is not the 50 KB target.** Past it, what is left is what people
hold (minds, memories, what they have seen, their knowledge of records) as the world gives it to them; holding less
of that is a bound on what a person remembers, which is a law, the owner's to decide (docs/design/knowing.md), not a
representation change.

**Interleaving with foundations-2 phases 2 and 3,** which add stocks and flows (conservation: water, energy,
materials, waste, metered homes) and space (networks with capacity, people in transit, carriers) to the world's state,
through contracts, world, rules, perception and actors: the same crates.
- R1 changes a type every crate uses: it goes in a short window between phases (after phase 2 lands, before phase 3
  begins), as one merge, with the two phases' owners told; begun mid-phase, every open branch would conflict.
- R3 (ledgers) goes after phase 2, so that its new flows are held compactly from the start, or with it, designed with
  its owner.
- R2 and R4 touch representations the phases read but do not reshape, and can go beside either phase, each a branch
  of a few days, merged often.
- Each step's measures and its ceiling go in this table and docs/decisions.md as the earlier cuts' did.

**A later step: tiered storage (R5, after R1 to R4).** What is active stays in memory; what is cold (closed matters,
ledgers of past months, papers no longer standing) goes to disk, compressed, and is read back on demand, exactly as
it was, so every result is byte-identical. Engineering, not a law: nothing anyone knows or can find changes, only
where the world keeps it (a law of what people remember, short-term detail fading into long-term gist, is a separate
design, its sources and the owner's approval first: not this).
- *What goes cold, and when:* a record whose matter has closed and that no channel stands to show (a paper withdrawn,
  an agreement ended a while ago), a ledger's entries before the month that's open, an entity record's history. The
  state keeps for each its id, where it sits in order, and its canonical bytes' hash, so the state hash is the same
  (taken from the hashes kept, by the same streamed writer: `World::write_state`).
- *Read back:* whatever reads it (a look, a register's keeper, a snapshot, a replay) asks the store; a block read
  back is cached while it is used. Snapshots carry the store or point to it.
- *Where:* world (the state's maps of records, ledgers, entity records), core (the store: zstd blocks of canonical
  bytes, by id), kernel (snapshots, replay), perception and resolver (reads go through the state's accessors).
- *Risks:* reads of something cold on a hot path (a register's whole file, a long statement) are slow; the store's
  file is per run and must go with its log. Measured before and after on the 50,000 month and the 100,000 week, and a
  year at 10,000, where history is what grows.
- *Estimate:* 6 to 10 agent-days, after R1 to R4. *Expected:* history's share of memory held at what is active, so a
  long run's memory stops growing with its age.

## What held memory, and the config read participant by participant (branch `scale-next`, 2026-10-25)

au-vic-2026 from `worlds/town-1000.yaml` with `citizens=10000` (and `50000`), `living.initiative_bps=10000`, seed 1,
all code, `log.observations: seats`, `oikos-kernel world` with 14 engine threads (`OIKOS_ENGINE_THREADS=14`, set for
every number here), the log piped to a digest and not kept. Each run alone in a slot; the machine's load was 20 to 40
from others' work, so wall times are rough and instructions retired are the steadier measure. Notes, dumps and scripts:
the session's scratch folder (not in git).

**A heap profile of the 10,000-person month** (a sampling profiler in the binary, `--features heapprof`,
`kernel/src/heapprof.rs`; `scripts/heapprof.ts` names the stacks). Main's build at its high-water mark: 8.8 GB live of a
10.2 GB peak footprint.

| what | live at the peak | why |
|---|---|---|
| the typed config's participants: each person's controller as JSON values | 2.5 GB | 23 KB of JSON a person, nearly all of it the same for everyone (the ventures on offer are 17.6 KB), each a quarter of a megabyte as `serde_json` values |
| each citizen's own reading of its params (`citizen::params::Params`), the ventures list above all | 2.1 GB | read from those values once per person, into values again |
| entity records' canonical bytes, kept for the state hash (`EntityRecord` serialised) | 0.54 GB | by design: the hash is not re-encoded each checkpoint |
| the engine's own (units, knowledge, rounds) | 0.86 GB | |
| what people have seen of buildings (`sites::site_structure`) and of work done (`exec_action_seen`) | 0.86 GB | their knowledge, kept as they learnt it |
| the citizen's person and mind (`Person::step`, `plan`, `make`) | 0.75 GB | its memory; bounded since fix-memory-appeal |
| the state's other canonical bytes (`State` serialised) | 0.28 GB | the hash's cache |
| the log's buffer on its way out | 0.29 GB | |
| the start (the whole config as JSON, its text, three copies of its canonical bytes) | not live at the peak | but most of the start's peak: 6.2 GB live within 30 s, and 44 GB at 50,000 people |

**What was done (each result-identical).**

| change | where | 10,000 x 30 d |
|---|---|---|
| the config read participant by participant (`config::load_from`): each checked against the schema's `Participant` (the whole config's schema checks the rest, its list of participants empty, and the list's own limit), its canonical bytes written on, compressed, and read into its type; never the whole as JSON, nor its text whole | contracts, CLI, native module (`config_file`), `RustWorld.start` (a file written participant by participant past 10,000 people: one string could not hold 100,000's) | the start's footprint 6.3 GB at 30 s to 3.4 GB |
| the config's canonical bytes kept compressed, in three pieces (before the participants, the participants, after); the header written from them; a snapshot's taken from them (`config::Canonical`) | contracts, run, snapshot | 270 MB to a few MB; at 50,000, 1.39 GB held three times to tens of MB |
| a citizen's ventures read once for everyone given the same list (`controller::read_once`) | actors (citizen params) | peak 10.2 to 7.6 GB with the two above |
| a controller's long params members (128 bytes or more of JSON) held once for all who have them alike (`controller::Controller`); actors' `Params` read their own members and the shared ones as one map, in order | contracts, world state, engine, actors | peak 7.6 to 5.2 GB |

Before (main, `eac4ab51`) and after, the same release build settings, 14 threads:

| run | before | after |
|---|---|---|
| 10,000 people, 30 days | 184 s wall, 1,052 G instructions, **10.21 GB peak** footprint (10.59 GB resident) | 123 s wall, 1,068 G instructions, **5.19 GB** (5.22 GB resident) |
| 1,000 people, 30 days, au-vic / gb-eng / us-oh | 0.99 / 0.96 / 0.65 GB | 0.84 / 0.83 / 0.61 GB |
| 50,000 people, a month | stopped by the 40 GB guard at the start (44 GB in 104 s) | **completes**: 22.3 min wall, 28 to 33 GB through the month, 30.1 GB peak resident, 41.0 GB peak footprint (a spike at the end), 15,033 G instructions; state `ea006720ed53d36c` |

Identical: the same final state hash and the same log after the header's `kernel`, entries' hash and prev stripped,
on all of them: 10,000 x 30 d `d2c58d35f85e747f`, digest `1d4162c3b258f44f` (2,449,923 lines, before, after the
first two changes, and after all four); 1,000 x 30 d au-vic `b1dd5f2faefe82cf` / `4c36bd108b515e5f`, gb-eng
`a40249ca0ab5c312` / `60dd70a707fea7b6`, us-oh `d15119f05ad34eb4` / `e711b89323570a43`. The profiled build ended at
the same hash. Tests: `kernel/tests/config_stream.rs` (three profiles' towns: the streamed read is the whole read, in
canonical bytes, hash and typed config; a run from it is the same log byte for byte; it refuses what the whole read
refuses, and says where), `orchestrator/test/config-file.test.ts` (the file is `JSON.stringify`'s text; a run from it
is the same log), the controller's own tests.

After all four, the same profile: 4.0 GB live at the peak, of which the config's controllers are 0.18 GB and the
citizens' params 0.1 GB. What is left is the run's own: the hash's caches of canonical bytes (0.8 GB), what people
have seen (0.9 GB), the engine (0.5 GB), the citizens' minds (0.7 GB). None of it is a copy; making it smaller is a
change of what is kept (the hash's caches compressed, or knowledge kept as integers), for another pass.

**The largest town now.** 50,000 people for a month fits (above); its 41 GB footprint at the end is a spike between
the guard's looks, so it runs at the edge of the 40 GB guard and is the largest town to run as things stand.
100,000: the config is generated in 141 s (5.4 GB, 3.12 GB of JSON, written in pieces) and the start is bounded (8.7 GB
at two minutes), but the first moment (everyone's first look, 4.8 GB of log at t=0) passed the 40 GB guard 50 s
later (44.6 GB footprint, 22 GB resident). A profile of 20,000's start and first moment (4.8 GB peak) has the state
hash's caches of canonical bytes largest (entity records 1.1 GB, the rest of the state 0.5 GB, of 4.3 live); what
grows faster than the town at 100,000's first moment is not yet profiled. That is the next item: a heap profile of
50,000's first moment and its end, then the hash's caches kept compressed or the first moment's looks taken in windows.

## The Rust world (branch `perf-2`, 2026-10-23)

au-vic-2026 from `worlds/town-1000.yaml` (1,000 people; `citizens=10000` and `50000` for the larger towns),
`living.initiative_bps=10000`, seed 1, all code, full log, `log.observations: seats` (run-one's default). Run with
`oikos-kernel world <config> --until S` (the engine alone, its configs written by run-one or by the generator; a run-one
of the same config ends at the same state hash, its log one line longer). The machine had a load of 12 to 28 on its 14
cores throughout, so wall times move by a third between identical runs: beside them are instructions retired (`/usr/bin/time -l`)
and, for the new builds, the run's own thread's CPU time (`main thread cpu`, printed by `oikos-kernel world`), which is the
critical path. "Identical" means the same final state hash and the same log after its header line, each entry's hash and
prev stripped (the header records the kernel's build id), for both `log.observations` settings (`seats`, and `all` at
1,000 people). Raw notes and profiles: `.claude/perf2-runs/` on the run server (not in git).

### Where the time went (the cut-over's build, 10,000 people, a month, main thread, macOS `sample`)

| part | share | what it was |
|---|---|---|
| keeping a step's results (`Engine::keep`) | 46% | |
| of which: decisions annotated | 18% | each checked against the Annotation schema (`jsonschema`, 7%), its integers walked again, copied whole by `json!` (8%) and dropped |
| of which: entity records written | 15% | `World::record_target` searched the config's every participant and position for each write (9%: quadratic) |
| looking (`start_round`'s observes) | 17% | building, and for a code actor under `seats`, encoding its observation's JSON only to read what it adds to its knowledge (5.5%) |
| the log's writes (8 KB buffer, system calls) | 6% | |
| threads started per round, and waiting on them | 2% + 7% | |
| actors deciding on the main thread (rounds under 16) | 8% at 10,000, 32% at 1,000 | the behaviour code |

At 1,000 people few actors wake per moment: a third of the run's own thread is actors deciding one at a time, a sixth is
building observations, a seventh is advancing the world (physics), and the rest is carrying acts out and logging them. At
10,000 one actor was the long pole of every parallel round: the support office (12% of the main thread waiting on it),
searching its whole file of withholding reports and evidence for each claim's employer, and parsing the laws again.

### What was fixed (each result-identical)

| change | where | measured |
|---|---|---|
| the config's participants and record-keeping posts looked up by an index (`Statics::participant_at`, `record_keeping_at`) | world | 10,000 x 30 d: -9% instructions with the next two |
| annotations: a subject and its data plainly of the contract (`plain_annotation`: kind, subject length, data `Opaque`) are passed without the schema (which decides everything else, with its messages; debug builds assert the schema agrees), their integers not walked twice, and not copied by `json!` | contracts, run, engine | |
| a code actor's observation under `log.observations: seats` is not written as JSON: only what its records and cells add to its knowledge is made (`Kernel::shown`; debug builds compare with the encoder's) | kernel, run, engine | 1,000 x 30 d: -13% instructions |
| the log is written on its own thread, a megabyte at a time (`spool.rs`; `flush` waits) | host, CLI | |
| a thread pool kept for the process (rayon), in place of threads started per round | `pool.rs` | 10,000: main thread -10% with the one before |
| the support office reads its file's employers on from where it left off (`Waits::employer_for`, checked against the full search in debug builds), and parses laws in place | actors (boundary) | 10,000: main thread -19% |
| a decision's and outcome's annotation is written (canonical bytes, contract check) on the thread the actor decided on, and its value let go there when no seat is in the round | engine | 10,000: annotating 18% to 5% of the main thread; 50,000's first moment 28 to 17 GB |
| the engine's participants share their controllers with the kernel's config, and an actor's params are a view of them (`oikos_actors::Params`), not a copy | engine, actors | 10,000 start 5.0 to 3.2 GB; a copy of the params is 2.4 GB at 10,000 people (a 10 KB JSON map is about 240 KB as `serde_json` values) |
| `sync_units` finds a participant's units by key range, not by going through every unit | engine | 50,000 start: 192 to 69 s of main thread |
| `oikos-kernel world` prints its main thread's CPU time; `OIKOS_SHARE_AT` sets how many actors a round shares out at least (for measuring) | CLI, engine | |

Before (the cut-over's build, `34ee888c`) against after (this branch), the same LTO release build settings, one after the other:

| run | before | after | |
|---|---|---|---|
| 1,000 people, 30 days | 20.1 s wall, 102.4 G instructions, 0.81 GB | 16.6 s, 91.3 G, 0.68 GB; main thread 13.3 s | -17% wall, -11% instructions |
| 1,000 people, a year | 341 s wall (load 14), 1,238 G, 1.38 GB | 372 s wall (load 23 to 28), 1,054 G, 1.29 GB; main thread 220 s | -15% instructions; wall not comparable |
| 10,000 people, 30 days | 214 s wall, 1,119 G, 6.83 GB | 135 s, 885 G, 5.30 GB; main thread 87 s | -37% wall, -21% instructions, -22% memory |
| 50,000 people, the first minute (start and the first moment) | 243 s wall, 1,638 G, 25.9 GB | 110 s, 744 G, 17 GB footprint | -55% wall |

Same state hashes before and after: 1,000 x 30 d `96eae33e5baa4155`, x 365 d `d406b85860a95327`; 10,000 x 30 d
`2c3d4dc1ba6e9f24`; 50,000 to t=60 `64f58cbf6833de21`; and the same log bodies (digests `3cd10f04d10b056b`,
`b207220820e7a92e`, `2bd598817b183fec`, `789ae32c789f998b`; `log.observations: all` at 1,000: `2368748c1cd1f1fb`).

### A 10,000-person year

One run, this branch's LTO build, at a machine load of 20 to 28: **28.7 minutes** wall (1,724 s; its own thread 937 s, all
threads 1,513 s user), **7.8 GB peak resident** (8.2 GB footprint), **9.06 GB of log** (14.1 million lines; 1.0 GB as zstd -3),
5,233 G instructions, 4.36 million steps; final state `dae9f7fe7fc66eeb`. On an idle machine the wall time would be nearer
its own thread's 16 minutes plus the waits on the slowest actor of each round.

### 50,000 and 100,000 people

Configs made by the generator (`citizens=50000`: 50,024 participants, 660 MB of JSON; `citizens=100000`: 100,022, 1.56 GB).

**50,000 people.** The start and the first moment (everyone's first look: 1.25 million log lines, 2.7 GB of log in the
first simulated minute) take 110 s (69 s of the run's own thread; 192 s before the start was made linear) and peak at 17 GB.
Then the town runs at about a simulated day per wall minute (load 25), writing 1.9 GB of log a day. Its memory grows by about
2.8 GB a simulated day: 22 GB at day 3, 36 at day 9, 38 at day 14, 45 at day 16, where the run's memory guard (40 GB, so as not to
starve the machine's other work) stopped it: 16.4 days in 16.5 minutes, 10,346 G instructions, 31 GB of log. **A month at
50,000 does not fit on this machine as the town is now**: at that rate it would pass 60 GB by day 30, and the log would be
about 60 GB (7 GB compressed).

**100,000 people: not run.** Loading the config alone holds it as `serde_json` values (about 14 GB) before it is checked and
read; units and the first moment would take the start past 35 GB, and the daily growth below would take it past the machine
within days. Not feasible without the first two items below.

**Why it does not scale linearly.** At 10,000 people memory grows about 70 MB a simulated day after the first month (5.3 GB
at day 30, 8.2 GB at day 365) and the log 25 to 68 MB a day; at 50,000, 2.8 GB and 1.9 GB a day: some 30 to 40 times for
five times the people, so about the square. CPU shows the same: the citizen's mind (`CitizenMind::gatherings`) is 12% of all
CPU at 50,000 and `decide_rec` 8%; hashing and copying the decision annotations is 19% of the run's own thread at 50,000 against
2% at 10,000. The likely cause (to confirm, SC-1: a heap profile, with a build on the system allocator and `malloc_history`): each
citizen keeps every published record it reads (gathering notices, the town's boards) and weighs, and writes into each decision,
every gathering on offer: both grow as people times the town's records. That is the mind's and the books' design (what a
person keeps and forgets), not the engine's; bounding it (people forget old notices; a decision lists the options it weighed,
not all of them) is behaviour, for its owners, and it is what stands between this machine and a 50,000 to 100,000-person month.

### What is left, ranked (measured shares of the run's own thread, this branch)

| # | idea | measured now | gain (est.) | effort | identical? |
|---|---|---|---|---|---|
| 1 | **Bound what a citizen keeps and weighs** (old notices forgotten, a decision's options the ones it weighed): behaviour, the mind's owners | quadratic memory and log at 50,000 (above); `gatherings` 12% of CPU | makes 50,000 for a month fit; 100,000 then likely (to confirm: SC-1) | a design talk first | **No**: behaviour |
| 2 | ~~**Read the config participant by participant**~~ **Done** 2026-10-25 (branch `scale-next`, above), with people's params held once: 10,000's month 10.2 to 5.2 GB, 50,000's month now runs | | | | Yes (checked) |
| 3 | **The log's hash chain on its own thread** (the writer hashes and frames; the run hands over bodies) | hashing + framing the log: 2% of the main thread at 10,000, 19% at 50,000 | 2% / 15% | 1 to 2 agent-days: the anchors writer must be `Send`, and `head()`, `log_ref()` and snapshots must wait for it | Yes |
| 4 | **Ids as integers inside the kernel** | `memcmp` 10% self at 10,000, 15% at 1,000 (string ids compared in every map) | 10 to 15% | 8 to 12 agent-days, every crate | Yes |
| 5 | **The long pole of a parallel round**: the main thread waits 25% at 10,000 (decide threads 14%, observations made ready 11%) on a loaded machine | | 5 to 10%: build the next window of observations while the current is delivered; start the slowest actors first | 2 to 3 agent-days | Yes |
| 6 | **Share small rounds too** (`OIKOS_SHARE_AT=4`) | at 1,000 a third of the main thread is actors deciding one at a time | main thread -10 to -15% at 1,000, but +22 to +40% instructions (the pool's spinning) and no wall time on this loaded machine | none: a setting | Yes |
| 7 | **The world's advance** (physics: acts taking effect, leaving spaces, money moved, nature's day) | 14% of the main thread at 1,000 | 5% | 2 to 4 agent-days of profiling the world crate | Yes |
| 8 | **Perception's build** (sites cells made per look; scopes as rectangles) | 10% of the main thread at 1,000 | 4 to 6% | 2 to 4 agent-days | Yes |
| 9 | **A view's channel lists kept, not rebuilt** (a bank's accounts collected into a new list whenever one changes) | `View::apply` 5% at 10,000 | 3 to 5% | 2 agent-days; the actors' `Picture` changes | Yes |
| 10 | **Profile-guided optimisation** (`llvm-tools` not installed here) | | 8 to 15% typical | 1 agent-day plus a training run | Yes |

Done in this pass and so off the list: the observation builder's JSON for code actors (idea 3 of the earlier list, in the form
that mattered: not writing it), a kept thread pool, sharing per-person settings (the controllers and params), the log's writes
off the run's thread, annotations' checks and copies. Ideas 6 and 7 of the earlier list (do not wake people with nothing to
do; a cheaper observation record) are decisions for the owner, as before.

## Before the port: the TypeScript world (2026-10-17, branch `perf`)

Written 2026-10-17 (branch `perf`). Measurements are of au-vic-2026 and gb-eng-2026 towns generated from
`worlds/town-1000.yaml`'s shape (1,000 people: grid 40x30; 10,000: grid 128x95, ten times the buildings), with
`living.initiative_bps=10000`, `living.friction_bps=10000`, `living.founding=true`, `opening_caseload=true`, seed 1, all-code
(no model calls), full log. Raw numbers: `runs/perf-2026-10-17/STATUS`.

### How it was measured (and why wall time is not used)

The machine had a one-minute load of 15 to 43 throughout (cores: 14), so wall time and even user+sys vary by 30% between
identical runs (the same 30-day, 1,000-person run: 28.9, 34.6, 40.1, 42.9, 45.1 s of CPU). The measure that does not move
is **the instructions the run's process retires** (`/usr/bin/time -l` around `run-one`, inside one slot; all threads
counted). CPU seconds are given beside it for orientation only. "Identical" means: same final state hash, and a byte
compare of the year's log with the hash chain stripped (the header records the build id, which changes every hash after it).

### Where the time goes

**One year, 1,000 people** (wall 544 s under load; 504 CPU s; the kernel runs inside the host's process, as a native module):

| part | share of the run | notes |
|---|---|---|
| kernel (`request`, native) | 45% (243 s) | observe 143 s of the 279 s the host saw the kernel take (51%); applying acts and advancing 70 s; logging, contract checks, protocol the rest |
| participant code (modules) | 28% (151 s) | one JavaScript thread; many small functions, nothing above 1% self (bank.ts `plan`, `absorb`, `standingOf`...) |
| the boundary: `JSON.parse` of replies + `JSON.stringify` of requests | 10% (57 s: decode 50, encode 6.5) | 4.1 million requests a year; 1.37 million observations, each 30 us to parse |
| platform / host bookkeeping | 7% (38 s) | |

Requests per simulated year at 1,000 people: observe 1.37M, finished 1.37M, act 0.47M, resolve 0.47M, next (advance) 0.39M,
annotate 0.24M, look 0.1M, entity_record 85k. A wake is: observe, (resolve, act), finished, annotate. 1.37 million wakes
(3.7 per person per day): 769k "asked", 469k "done", 118k "news", 12k "cadence". Only 469k of them lead to an act.

**30 days, 10,000 people** (before the fixes): 4,615 thousand million instructions, 1,071 CPU s, 7.4 GB resident. **Two thirds
of the kernel's time was one thing**: `advance` (`next`) took 544 s of the 835 s the host saw the kernel take, at 3.3 ms a
call (0.15 ms at 1,000 people: it was quadratic). Sampled, it was `State::clone` copying the plain list of held questions
to a keeper's register on every act (the state is otherwise persistent maps, so that copy is meant to be cheap), and
`check_at_work` going through every building in the town for every post holder of every held question. After both fixes
the kernel's biggest cost at 10,000 is the observation builder (below).

**What the "hash a whole record at every write" worry turned out to be.** The *state* hash is taken at checkpoints only
(0.9% of the main thread). What is hashed at a write is an entity's record (`entity_record`: canonicalised for its size
check, again for its digest, and the change for its chain): 85k calls a year at 1,000 people, 12.5 s (4% of the kernel's
time), 72k calls and 20.7 s per 30 days at 10,000. A Merkle state hash would gain nothing. Caching per-section canonical
bytes in the record would take about 1.5% off the whole run.

**Observations are never repeats.** 1,465,221 observations in the year's log; 24 are identical to that participant's
previous one (time is in every observation). So "do not rebuild an unchanged observation" cannot be made byte-identical.

### What was fixed (each result-identical)

| commit | change | measured |
|---|---|---|
| `77df2929` | fat LTO, one codegen unit for the release build | 2.5% fewer instructions (184.6 to 179.9 G, 30 days, 1,000) |
| `a09aea94` | observations made ready on one thread by default (`OIKOS_KERNEL_THREADS=N` for more) | 1.4% fewer instructions, and less CPU time under load (42.8, 45.1 s against 40.1, 43.0 s); the eight threads spun and gave no wall time back on a loaded machine. Not measured on a quiet machine |
| `c26cdb1f` | held questions behind a shared pointer (no copy per act) | 10,000 people, 30 days: 4,615 to 3,994 G (-13.5%) |
| `6d1480a4` | "is at work" looks through the buildings the body is in (`whereabouts`), not every building | 3,994 to 3,225 G (-19%); with the one before, -30% |

Altogether, base build against final build, instructions retired (CPU seconds user+sys beside, noisy at load 15 to 43):

| run | before | after | |
|---|---|---|---|
| 1,000 people, 30 days | 184.6 G (40.1 s) | 180.7 G (40.7 s) | -2% |
| 1,000 people, 365 days | 1,935 G (491 s) | 1,845 G (335 s) | -4.7% instructions, CPU time -32% (the threads' spinning is in the seconds, not the instructions) |
| 10,000 people au-vic, 30 days | 4,615 G (1,071 s) | 3,225 G (613 s) | -30%, CPU time -43% |
| 10,000 people gb-eng, 30 days | 4,577 G (982 s) | 2,841 G (492 s) | -38%, CPU time -50% |

The fixes are quadratic ones: they are worth little at 1,000 people and a great deal at 10,000. Final states: gb-eng
10,000 `cd33f30b39662479`, the same before and after.

Proof for each: the 30-day states end at the same hash (1,000 people `768e6ce7ac4e4c27`; 10,000 people `8c024d84a2bf0261`); the
final build's year at 1,000 people ends at `06469cf3549a412e...`, as the original build's, and its 5,865,277 log lines
after the header match the original's body for body (`cmplogs`: hash and prev stripped). The kernel's 47 test binaries pass
(debug builds check `whereabouts` against the full scan on every call).

### Memory and log size

| | 1,000 people | 10,000 people |
|---|---|---|
| peak resident, 30 days | 1.2 GB | 7.2 to 7.6 GB |
| peak resident, 365 days | 1.85 to 2.17 GB | not run; about 12 GB by the same growth (x1.6) |
| full log, per simulated day | 6.1 MB (2.22 GB a year; 5.87M lines) | 110 MB (gb-eng, 3.29 GB for 30 days; au-vic similar, not kept): 18 times 1,000's, not 10 |
| of which | observations 23%, other lines (annotations, decisions) 47%, action started/applied 14%, occupied/vacated 9%, records 2.5% | |

Compressed (`.zst`, the default after a run) a log is about a seventh of that. The replay holds the whole log in memory
(5.9 GB for a 3,000-person month, per the 2026-10-08 entry). Resident memory is not yet broken down between host and kernel
(they share a process); the likely growth is the kernel's `Delivered` caches (records and buildings encoded once, never
evicted) and the host's per-person books. That is a hypothesis, not a measurement.

### Is a 3-year, 10,000-person run feasible on this machine (14 cores, 64 GB, 223 GB free)?

Yes, with a lean or compressed log, and one core.

* **Time.** The cost per simulated day is close to linear in time (1,000 people: 30 days x 12.2 predicted 490 CPU s, the
  year took 504). 30 days at 10,000 is 2,800 to 3,200 G instructions after the fixes, 490 to 610 CPU s (au-vic, gb-eng); so
  a year is about 1.7 to 2.1 hours of CPU, and three years about **5 to 6.5 hours** on one core (about 10 to 11 hours
  before). Wall time on this shared machine is two to three times that, because a run gets a slot, not a core to itself.
* **Memory.** About 12 GB a year and 15 to 20 GB at three years by extrapolation (unmeasured past 30 days). Fits, if
  few other runs hold 10 GB each.
* **Disk.** Full log, uncompressed: about 110 MB a simulated day (gb-eng), 40 GB a year, 120 GB for three years: over the
  40 GB stop. `--log lean` (no observation hashes, no written reasoning) or compress as it goes (idea 8). Compressed
  after the run, about a seventh: 17 GB. Not run for three years; this is 30 days measured and multiplied.

### The ambitious ideas, ranked

Estimates are of the whole run's CPU time, from the measurements above; "identical" says whether the log can stay
byte for byte.

| # | idea | speed-up (est.) | effort | risk to determinism | identical? |
|---|---|---|---|---|---|
| 1 | **Citizens, firms and code office-holders in Rust** (the decided port): no JSON between citizen and kernel, no `JSON.parse` of observations, no napi string crossing, state read in place, participants' data in struct-of-arrays | 35 to 50% at 1,000; 40 to 55% at 10,000 (modules 28%, boundary 10%, plus the kernel's protocol cost 5%, plus what a native loop does to the 10x slower JS) | 30 to 60 agent-days | Low in kind (one seeded PRNG, fixed order), high in effort to match every draw | Yes, if every draw and order is reproduced; checkable by running the TS and Rust citizens against the same log |
| 2 | **Parallel cohorts**: citizens woken at one moment read the same state and decide on all cores; their acts apply in key order (the shape of `Kernel::plan`, extended to decisions) | wall time 2 to 4x on idle cores (nothing in CPU time); needs 1 first | 8 agent-days after 1 | Low (read, then ordered apply; already proven for observations) | Yes |
| 3 | **Observation builder**: structure views cached by a per-structure change stamp, scopes as rectangles and cells as numbers, ids not formatted per cell | 8 to 12% at 10,000 (the observation build is 13.6% of the main thread, half the kernel; `site_cell` 4.9%, `site_structure` 4.7%, the scope's `filter_map` 5.6%, `format!` 1.4%) | 2 to 4 agent-days | Low (checked against the plain build in debug) | Yes |
| 4 | **Ids as integers inside the kernel**, strings at the edge | 10 to 15% (`memcmp` 4.5 to 6% self, `String` clone/alloc/format about 8%) | 8 to 12 agent-days; every crate | Low | Yes |
| 5 | **Profile-guided optimisation** of the kernel (needs `llvm-profdata`: `rustup component add llvm-tools`, not installed here) | 8 to 15% typical for branchy Rust | 1 agent-day plus a training run in CI | None | Yes |
| 6 | **Do not wake people with nothing to do** (event-driven sleep): 1.37M wakes a year, 0.47M lead to an act | up to 30 to 40% of observe, decode and the module work | 5 to 10 agent-days and a design decision | Changes what is logged | **No**: observation hashes and annotations are in the log; a behaviour-level decision for Naz, not an optimisation |
| 7 | **A cheaper observation record in the log**: log a structural digest, or the observation's delta, not the hash of its canonical JSON | 8 to 12% of the kernel (encode and sha256 of each observation) | 3 agent-days and a contract change | None | **No** (log bytes change); replayable under a new log version |
| 8 | **Stream-compress the log as written** (zstd frames) | 2% CPU; disk 7x smaller during the run, which matters for 3 years at 10,000 | 1 agent-day | None | Content yes (same lines and chain once decompressed); file bytes no |
| 9 | **Cache an entity record's canonical sections** (the "hash a whole record" cost) | 1.5% | 1 agent-day | None | Yes |
| 10 | **Batch `finished` with the next `observe`** and `annotate` with `act`: fewer crossings | 1 to 2% (1.37M `finished` requests a year, 4 us each) | 1 agent-day | None | Yes, if batch order is kept |
| 11 | **GPU compute** (Metal, unified memory) for per-person scoring, spatial neighbours, tie-network diffusion, integer arithmetic in fixed per-row order | none below about 30,000 people; see the measurement below | 10 to 20 agent-days after 1 (the data must be in arrays first) | None for integers with fixed-order reductions: shown identical here | Yes |
| 12 | **Memory-mapped state, snapshot + delta logs** | resume without replaying 5.9 GB; not a speed-up of a run | 15+ agent-days | Medium | Log format changes |

Order to do them in: 3, 5, 9 and 10 now (cheap, identical, about 25% together at 10,000), 1 as the port plan has it, then 2
(the one that buys wall time), then 4 inside the port's data layout. 6 and 7 are not optimisations; they are decisions.

### What the GPU prototype measured

`/private/tmp/perf/gpu/g.swift` and `d.swift` (Metal compute through a Swift script, kernels compiled at run time, buffers
shared with the CPU: no copy). Integer only, the same answer from the GPU and a single CPU core on every size (checked):

| | 1,000 | 10,000 | 100,000 |
|---|---|---|---|
| score 16 options by 16 integer weights, argmax (CPU one core / GPU, per batch) | 0.20 / 0.28 ms | 1.96 / 0.60 ms | 18.9 / 0.99 ms |
| one diffusion step over a 30-tie network (CPU / GPU) | 0.03 / 0.72 ms | 0.44 / 0.74 ms | 28.2 / 4.9 ms |

A GPU dispatch costs 250 to 700 us here (the machine was loaded), so it pays above about 3,000 people for dense scoring and
about 15,000 for a sparse step, and then by 3 to 19 times. But at 10,000 people the whole arithmetic of a simulated day
that these would replace is about 2 ms of a day that costs about 20 s of CPU: under 0.01%. The time is in building and
encoding what people see, in the JSON between host and kernel, and in the citizens' branchy JavaScript, none of which a
GPU takes. It becomes worth building when the citizens are arrays in Rust (idea 1) and the town is 100,000, where a day's
per-person arithmetic is a few percent of the run. So: a real option for the 100,000-person case, a distraction before.

### What the boundary costs today (for the port)

From the run's own request profile (year, 1,000 people, 4.1 million requests): `JSON.stringify` of requests 6.5 s,
`JSON.parse` of replies 50 s (observe replies 40.7 s: 30 us each), the engine's time seen from JS 279 s, of which the
kernel's own request parsing, reply serialisation and napi string copies are about 5% (`Session::reply`'s share outside
`Run`, `serde_json::Value` deserialisation 3%, `to_napi_value` 0.8%, drop of `Response` 0.8%). Together about **13 to 15% of
a year's CPU time is the crossing itself**, before any of the citizens' own work, which is another 28%. A port that keeps the
canonical observation hash (the log needs it) keeps the encode but not the parse.
