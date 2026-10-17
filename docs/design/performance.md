# Performance: where a run's time and memory go, what was fixed, and the ambitious ideas ranked

Written 2026-10-17 (branch `perf`). Measurements are of au-vic-2026 and gb-eng-2026 towns generated from
`worlds/town-1000.yaml`'s shape (1,000 people: grid 40x30; 10,000: grid 128x95, ten times the buildings), with
`living.initiative_bps=10000`, `living.friction_bps=10000`, `living.founding=true`, `opening_caseload=true`, seed 1, all-code
(no model calls), full log. Raw numbers: `runs/perf-2026-10-17/STATUS`.

## How it was measured (and why wall time is not used)

The machine had a one-minute load of 15 to 43 throughout (cores: 14), so wall time and even user+sys vary by 30% between
identical runs (the same 30-day, 1,000-person run: 28.9, 34.6, 40.1, 42.9, 45.1 s of CPU). The measure that does not move
is **the instructions the run's process retires** (`/usr/bin/time -l` around `run-one`, inside one slot; all threads
counted). CPU seconds are given beside it for orientation only. "Identical" means: same final state hash, and a byte
compare of the year's log with the hash chain stripped (the header records the build id, which changes every hash after it).

## Where the time goes

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

## What was fixed (each result-identical)

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

## Memory and log size

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

## Is a 3-year, 10,000-person run feasible on this machine (14 cores, 64 GB, 223 GB free)?

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

## The ambitious ideas, ranked

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
