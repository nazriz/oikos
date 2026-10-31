# The pilot explorer: `oikos explore`

The first real version of the renderer (`renderer/`, plan in `docs/design/renderer.md`): a run's town as a living
isometric scene, with every seat's acts on the map and on a timeline, and any person, office, firm or building opened to
its life in the log and the causal trace of each change. Three.js on WebGPU (WebGL 2 where WebGPU is missing), served by
Bun on 127.0.0.1. The researcher's view: it may see everything in a log; it never writes to a run or feeds anything back.

## Commands
- `oikos explore <run-dir> [--port 4321] [--prefix /explore]`: index the run once, serve it, print the address.
- `oikos explore --all [--runs DIR] [more run dirs...]`: every run with a pilot (`PILOT.txt`), opening on the newest;
  "all runs" lists the rest. A run is indexed the first time it is opened.
- `oikos explore index <run-dir> [--rebuild]`: the index only.

The index goes to `runs/views/<run id>.<12 of the head hash>/` (`OIKOS_VIEWS` to move it), never inside a run's folder.
It is made again only if the log changes. About 15 s for 1,000 people over 90 days, 70 to 130 s for a 3,000-person
pilot with its twin (the pilot viewer's fold and the twin's log are read too); about 180 MB for the latter.

**Behind the owner's proxy** (as `/pilots/` is): `nohup bun orchestrator/src/cli.ts explore --all --port 4321 --prefix
/explore > ~/oikos-explorer.log 2>&1 &` from the repo, then proxy `/explore/` to `http://127.0.0.1:4321`.

## What it shows
- **The town**: ground and terrain, lots, roads, parks, trees, every building (height by its spaces, colour by its
  category), lit windows and pools of light at night, a sky that follows the hour. Each person is a light on the roof
  of the building they are in (gold at home, blue at work, violet elsewhere), hopping when the log says they moved (the
  hop is drawn; the log has no routes). The way out of town (a column at the edge) is where the outside world's offices
  act from.
- **Seats' acts**: an arc from the office to every person and organisation the act reached, a note at the top as it
  happens, a mark on its seat's rail in the timeline. Click one: the seat's own words, the translator's draft (ours or
  the fallback, and why), confirmed or declined, what it did, where it landed, later papers that cite it, the code
  twin's decision beside it, what it rested on, and the sitting (turns and what it read).
- **Changes reaching people**: rings on the buildings where they live, coloured by who decided (a person, an
  organisation's system, a model seat, the world); red where it landed hard (a refusal, a removal, a debt, a failed
  payment, an illness). The timeline's lower band is the same by day.
- **Inspect**: a person (home, work, household, money and sense of agency by day, who decided what reached them, every
  change in their life with its causal trace, their own record at the moment); an organisation (posts and who holds them,
  person, system or model seat, staff present, acts by week by who decided, backlog, decisions); a building (who is in it,
  who lives there, what reached them in 30 days). Search by name or id.
- **Overlays**: *who decided* (per building, the last 30 days, all deciders or one class: "model seat" lights exactly the
  homes seats' decisions reached); *hardship* (sense of agency from people's own records, or money held as a rank).

Keys: space play/pause, arrows step an hour (shift: a day), `[` `]` speed, `q` `e` turn the view, `f` follow the person,
`/` search, Esc close. The address keeps run, time and selection (`#run=lv-07b&t=4266000&sel=act:564631`).

## Not shown, and why
- No debriefs, exit accounts or debrief annotations: the index drops them (VISION 15).
- Classes are by role in the world, not by what runs it: every person is simulated.
- A person with no building at a moment is not drawn; one with no home on record is shown where last seen.

## The data layer (Rust)

The explorer's index, causal trace, who-decided classification and panels, ported to Rust (`kernel/crates/explore`,
docs/port-guide.md section 9), so a Rust viewer (the Bevy engine) and the Three.js client read the same thing, and a
live run can be shown while it goes. Ported from `renderer/src/indexer.ts`, `store.ts`, `trace.ts`, `world.ts`,
`panels.ts` and `server.ts`; the TS index stays the default until the cut-over (`bun run test:all` holds both to the same
bodies: `renderer/test/rust-service.test.ts`).

**What is different from the TS index.** It is in memory, not in a folder: nothing is written anywhere (the TS index
goes to `runs/views/`). A log is fed one line at a time (`Index::feed`), from a finished `.jsonl` or `.jsonl.zst` or from
a live run's lines, and every query works at any moment while it is fed. Kept lines are held zstd-compressed in frames of
4096 (the open frame plain, 24 decompressed frames cached), so memory stays bounded. Debriefs, debrief annotations and
observations are dropped before they are parsed (VISION 15). Each kept line is parsed once with serde_json (the TS read
them with regexes); parsing runs on several threads and lines are applied in order, so the index is the same as a
one-thread read. Measured on `runs/explorer-1000-2026-10-17` (1.43 million lines, 1,003 people, 90 days; 265 thousand
kept lines): about 5 s to index with a release build on a busy machine, 640 MB resident (the kept lines are 30 MB of it),
counts equal to the TS index's on lines, kept, people, days, actions, pulses, moves and holders; the tracks `where`,
`agency`, `pulses` and `moves` are byte for byte the TS files, and 20 traces and 30 panels are equal.

### The query interface (a library)

`oikos_explore::{Index, RunIndex}`. `Index` is `Send + Sync`; one thread feeds, any number query.
- Building: `Index::new()`, `feed(&str)`, `feed_bytes(&[u8])` (what `kernel::stream::Stream::take` returns), `feed_all(iter)`,
  `load_path(path)` (a finished log), `set_pilot(json)` (the pilot viewer's data, for the seat panels; optional).
- `RunIndex`: `meta()`, `line(ord)`, `line_text(ord)` (byte for byte as the log has it), `postings(id)` (the kept lines that
  name a person, place, organisation, record, account or participant), `day(d)` (the `[first, last)` of a day),
  `action_of(ord)` (the act behind an effect), `decider(participant, about)` (self, person, system, seat, world),
  `trace(ord, about, max_depth)` (the links, newest first), `panel(Panel, t)` (person, organisation, building, seat's act,
  town pulse, as the client's JSON).
- Also on `Index`: `world_json()`, `track_bytes(name, from, to)`, `trace_json`, `seat_json`, `memory_held()`.

### Running the service

```
cd kernel && cargo build --release -p oikos-explore
kernel/target/release/oikos-explore serve --port 4322 --run town=runs/town.seed1.jsonl.zst,pilot=runs/views/town.pilot.json
kernel/target/release/oikos-explore index runs/town.seed1.jsonl.zst     # prints the meta
```

`serve` listens on 127.0.0.1 only (any other address is refused, and a request whose `Host` is not loopback is refused:
no DNS rebinding), answers GET only (anything else is 405), and opens a run the first time a request wants it, in the
background (state none, indexing, ready, failed, as `server.ts`). `--single KEY` is the run the page opens on (the only
run, by default). `--port 0` picks a free port; `--watch-stdin` makes it exit when its parent closes stdin.

The existing Three.js client reads it unchanged, through the Bun server:
- `OIKOS_EXPLORE_API=http://127.0.0.1:4322 oikos explore <run-dir>`: `server.ts` answers the page and the client and passes
  every `/api/*` request to the Rust service (the TS index is not built; PL-2); or
- `oikos explore --rust <run-dir>` (or `--all --rust`): starts the built `oikos-explore` (`kernel/target/release`, else
  `debug`) with the runs' logs, makes each pilot's `pilot.json` with the existing `pilotDataOf` into the views folder
  (beside the runs, never inside one), and proxies. `renderer/src/rust.ts` is the one place the package starts a process.

### Attaching to a live run

A run is a `RunSpec`: `RunSpec::file(key, log, pilot_json)`, `RunSpec::live(key, interval, poll)`, or
`RunSpec::attached(key, Arc<Index>)`.

```rust
let stream = kernel::stream::Stream::new(100_000, vec![]);       // the kernel's tee of its log (lane F)
let svc = Service::new(vec![RunSpec::live("now", Duration::from_millis(200), move || {
    stream.take(10_000).0.into_iter().map(|b| String::from_utf8_lossy(&b).into_owned()).collect()
})]).single("now");
let server = svc.serve("127.0.0.1:4322")?;
```

The poller thread feeds the index under its lock; routes answer mid-run (`meta.state` is "live"; `lastT` and `days` grow;
a run with no header yet is not ready). A Bevy engine in the same process skips HTTP: it holds an `Arc<Index>`, feeds it
from the stream, and calls `RunIndex` (`RunSpec::attached` shows that same index to the browser too).

### Routes

| Route (GET, under `/api`) | Body |
|---|---|
| `/runs` | `{single, runs: [{key, name, note, pilot, mtime, state}]}` |
| `/r/<run>/status[?open=1]` | `{state, message, seconds}`; `open` starts reading a run |
| `/r/<run>/world` | `{meta, world, persons, pilot, seatActs, townPulse}` |
| `/r/<run>/bin/<moves\|where\|pulses\|money\|agency>[?from=&to=]` | raw little-endian: moves, pulses int32; where uint32; money float64; agency int16 |
| `/r/<run>/person/<id>?t=` | a person's panel at t (default: the last moment); `{missing: true}` if none |
| `/r/<run>/org/<id>?t=` | an organisation's panel |
| `/r/<run>/building/<n>?t=` | a building's panel |
| `/r/<run>/act/<ord>` | a seat's act with its sitting, request, twin and trace |
| `/r/<run>/trace/<ord>?about=` | `{row, links}` of a kept line |
| `/r/<run>/line/<ord>` | the kept line as the log has it |
| `/r/<run>/seat/<id>` | a seat's sittings and notebook |

Gzip is not used (the service is on the machine). Shapes are those of `server.ts` field for field. The differences:
`meta.state` is added to `/world` ("ready" for a finished log, "live" for a live run; `indexSeconds` stays); a person
who arrives mid-run (`person_created`) keeps their place in the persons-first rows of `money` and in every panel, where
the TS index put their money after the organisations' (so the client read the wrong row); and clipped sentences count
characters, where JS counted UTF-16 units (the same for any text outside emoji and rare scripts).

## The Bevy explorer (`--engine bevy`, 2026-10-25)

The next explorer: Bevy draws the town, an HTML/CSS interface sits round it. One Rust crate, `explorer/`, built for the
browser (WebAssembly; WebGPU, or WebGL 2 where it is missing) and as a desktop program. It reads the same data layer
(`kernel/crates/explore`) and never re-indexes in JS. The Three.js explorer stays the default until this one has
caught up and been reviewed; the decision and what would make us revisit it are in docs/decisions.md, 2026-10-25,
"The Bevy explorer". Screenshots: `docs/explorer-shots/`.

### Running it

```
bun explorer/build.ts                     # both WebAssembly packages into explorer/pkg/ (--quick while working on it)
cd kernel && cargo build --release -p oikos-explore && cd ..
bun orchestrator/src/cli.ts explore runs/<run> --engine bevy          # implies --rust; prints the address
bun orchestrator/src/cli.ts explore --all --runs DIR --engine bevy [more run dirs]   # several runs: the workbench compares them
explorer/target/release/oikos-explorer runs/<run>/<log>.jsonl.zst [--pilot pilot.json] [--at SECONDS]   # native
explorer/target/release/oikos-explorer --synthetic 50000              # a generated town, for measuring (below)
```

Setup it needs beyond the repo's: the Rust toolchain `explorer/rust-toolchain.toml` names (1.97.1, which Bevy 0.20
requires; the kernel keeps its own), the `wasm32-unknown-unknown` target, `wasm-bindgen-cli` at the version in
`explorer/Cargo.lock` (0.2.129: `cargo install wasm-bindgen-cli --version 0.2.129 --locked`), and `hyparquet-writer`
(renderer's package.json, for Parquet export). On Linux the native build needs the X11 libraries (`libxkbcommon-x11`);
Wayland is a feature (`--features native,wayland`). Without a GPU, Mesa's software Vulkan (`mesa-vulkan-drivers`)
runs it, slowly.

### How it is built

- **The crate** (`explorer/src`): `data.rs` (the data layer's `/world` body and tracks, parsed), `layout.rs` (where
  each thing is drawn; the road network and routes), `tracks.rs` (the window of days held; where everyone is at the
  moment), `overlays.rs` (who decided, hardship, as the Three.js explorer computes them), `bridge.rs` (commands in,
  events out), `source.rs` (asking the data layer), `scene.rs` (the Bevy scene), `people.wesl` (the people's shader),
  `web.rs` (the browser's exports), `native.rs` and `ui.rs` (the desktop window and its egui interface),
  `synthetic.rs` (a generated town for measuring). All but scene, web, native and ui are pure and unit-tested.
- **Bevy's ECS holds the scene.** Buildings are merged a 24-cell tile at a time (whole tiles are culled at once; an
  overlay recolours a tile in one write), trees likewise, the ground is one painted texture. People are one mesh of a
  quad each, drawn in a single call: where each stands and its colour are a data texture (two texels a person) the
  scene rewrites as they move, so 50,000 people cost one draw and one texture upload a frame.
- **Tracks are streamed by time window.** The scene asks for the `where` keyframes and the moves of four days at a
  time round the moment shown, and lets go of what is more than six days away (`Window`). The overlays' data is asked
  for one day at a time (`/decided`: counts by building and class over the 30 days to the day; one day's row of
  `agency` or `money`), so a year of a big town is never held.
- **People move along the roads.** The log says where people are (`vacated` and `occupied`), never how they got there.
  A trip is drawn from the time a person leaves one space to the time they enter the next, along the shortest way by
  road (A* on the road cells) between the two buildings' nearest road cells; with no time out logged, a hop is drawn
  after the fact for at least 0.6 s on screen. **A visual only**: nothing reads it, and no measure may.
- **The bridge** (`explorer/src/bridge.rs`; wasm-bindgen exports in `web.rs`): `send(json)` takes any command, and
  `select(id, fly)`, `set_time(t)`, `set_speed(x)`, `play(on)`, `set_overlay(name, focus)`, `load_run(id)`,
  `camera(json)` (turn, iso, frame, zoom, pan, tilt, follow) are shorthands; `take_events_json()` gives what happened
  since the last call: `ready`, `hovered`, `selected`, `time_changed`, `seat_act`, `labels` (screen positions of the
  offices' labels), `stats` (frame times, memory), `waiting`, `error`. The interface calls nothing else in the scene.
- **The interface** (`explorer/web`, plain TypeScript bundled by Bun) talks only through the bridge and the server's
  `/api` (panels, traces) and `/wb` (the workbench). Its panels are the Three.js explorer's own
  (`renderer/src/client/inspector.ts`), so the two explorers cannot disagree on what a panel says.
- **Native**: the same scene in a desktop window; the data layer in process (an `oikos_explore::Index` fed from the log
  on a thread); an egui interface (the clock, speeds, overlays and their focus, search, the timeline with the town's
  pulse and seats' acts, the inspector with traces, the same keys). Plainer than the browser's; the same scene and data.
- **Served** by the Bun server: `--engine bevy` serves `explorer/web` and `explorer/pkg/<webgl2|webgpu>/` (the page
  loads the WebGPU build where the browser has an adapter, else WebGL 2; `#gl=1` forces WebGL 2), with the Rust data
  layer behind `/api` (`--engine bevy` implies `--rust`). A run is shown as soon as its header is read: with
  `?partial=1` the data layer answers from what it has read so far, the scene asks again as more is read, and the
  page refreshes when the index is done. A run with no seats (no PILOT.txt, no post given to a model in its
  batch.json) is not read for pilot data first, so a big code-only town shows at once.
- **Look**: soft sky and ambient light, a directional sun on its arc with shadows (two cascades), a cool moon at night,
  fog for depth, tonemapping and a little bloom; lit windows (an emissive pane texture on the walls) and warm pools of
  light round occupied buildings after dark. Screen-space ambient occlusion is not on: Bevy's needs compute shaders,
  which WebGL 2 lacks; it can be turned on for the WebGPU and native builds (not done yet). No weather: the runs looked
  at have none in their logs to show.

### Measured (2026-10-25), and how

This machine has **no GPU** (a 4-core Linux container, 15 GB, shared with the test suite while measuring): Chromium
drew WebGL 2 in software (SwiftShader) and the native build ran on Mesa's software Vulkan (lavapipe). So the frame
rates below are of software rendering (and WebGPU on Chromium's software adapter, about 1 fps, was checked to draw,
not timed) and say nothing of a GPU's; what is meaningful is the scene's own CPU time
(measured apart), memory, and where time goes to first paint.

| What | Measured | How |
|---|---|---|
| The scene's own work per frame, 10,000 people | mean 0.08 ms, p95 0.28 ms, most 0.68 ms | `cargo test --release --lib --features native -- --ignored --nocapture scale`: a synthetic town's day of commuting played at 10 minutes a second at 60 frames a second (moves applied, trips begun and ended, routes found, every mover's place packed into the texture); 5,040 frames; at most 2,576 on the way at once |
| The same, 50,000 people | mean 0.70 ms, p95 3.17 ms, most 5.81 ms | the same; at most 12,685 on the way; tracks held 15 MB (3 MB at 10,000) |
| Native, whole frames, software Vulkan | 10,000 people: 5 fps (211 ms), 480 MB resident; 50,000: 3 fps (323 ms), 624 MB | `oikos-explorer --synthetic N` under Xvfb, the egui interface's frame statistics; the release build |
| Browser, whole frames, SwiftShader | town of 203: about 4 fps (250 ms); 10,000-person month: about 2 fps (450 to 600 ms); WebAssembly memory 50 to 90 MB | the page's `stats` events (headless Chromium, 1440 by 900, MSAA 4) |
| First paint, town of 203 | 3.4 to 7.5 s from opening the page (the scene's own start to first frame: 1.5 to 5 s) | `window.OIKOS_TIMES` marks; the spread is SwiftShader compiling shaders and the machine's load |
| First paint, 10,000-person month | 23 s from opening the page: the data layer read the 222 MB header in about 10 s (Bun reads it in 1 s; the rest is parsing it into the index), the scene's first frames in software took about 12 s; the whole index was done at about 64 s | the same marks, a cold server |
| The data layer's memory, 10,000-person month | **8.1 GB resident** | `ps` on `oikos-explore serve` once indexed: the index of the 222 MB header and the month's postings. This, not the scene, is what bounds the size of town on a machine |
| The WebAssembly packages | WebGL 2 24.8 MB, WebGPU 22.8 MB (whole-program optimised, no wasm-opt; served gzipped) | `bun explorer/build.ts` |
| Workbench | measures of six experiment arms (about 107,000 log lines each) in 2.3 s; an events page of 100 rows of 22,400 at once | the page, the arms of `explorer/test/fixtures/demo-stewards.json` |

**Against the targets.** 50,000 people at 60 fps in Chrome, and 10,000 at 120 fps natively: not measurable here. The
scene's CPU share fits (0.7 ms mean, 3.2 ms p95 of a 16.7 ms frame at 50,000; 0.08 ms of an 8.3 ms frame at 10,000),
the people are one draw, and buildings and trees a draw per tile, so the GPU work should be small; but no frame was
drawn by a GPU. First paint within 5 s of opening a 10,000-person run: **not met here** (23 s); the header's parsing
in the data layer (about 10 s on this busy machine) is the largest part and would be the first thing to make faster.
**50,000 people could not be run at all here**: the simulation of a 50,000-person town and the data layer's index of
it each need more memory than this machine has (the index alone held 8.1 GB at 10,000), so the 50,000 numbers are of
the scene on a synthetic town, never of a run.

**To measure on a real machine** (the owner's Apple-silicon Mac): `bun explorer/build.ts`, then open a 10,000-person
run with `--engine bevy` in Chrome and read the top bar (fps, mean and p95 frame time, the scene's own ms, people
drawn, memory) and `window.OIKOS_TIMES` (first paint and its parts); then `oikos-explorer --synthetic 50000` and
`--synthetic 10000` natively (the same figures in its top bar), and once more in Chrome with a 50,000-person run made
on the run server (`worlds/town-1000.yaml --set citizens=50000 --until 604800`), noting the data layer's resident
memory.

### Parity with the Three.js explorer

Every item of "What it shows" and the keys above, as built in the Bevy explorer (✓ built and checked in a browser;
◐ partly, with what is missing).

- [x] Ground and terrain, water, lots (outlined), roads, parks, trees
- [x] Every building, height by its spaces' levels, colour by category (the same palette)
- [x] Lit windows and pools of light at night; a sky (and light) that follows the hour
- [x] Each person a light where they are (gold at home, blue at work, violet elsewhere or on the way); moving when
  the log says they moved (along the roads: a visual only)
- [x] The way out of town (a column at the edge) where the outside world's offices act from, labelled
- [x] Seats' acts: an arc from the office to every person and organisation reached, a note at the top as it happens,
  a mark on its seat's rail in the timeline (filled applied, hollow refused or pending)
- [x] The act's panel: the seat's own words, the translator's draft (ours or the fallback, and why), confirmed or
  declined, what it did, where it landed, later papers that cite it, the code twin's decision, what it rested on, the
  sitting (turns and what it read) — the same panel code as the Three.js explorer
- [x] Changes reaching people: rings coloured by who decided, red where it landed hard; the timeline's lower band by day
- [x] Inspect a person, an organisation (posts and holders, staff, acts by week, backlog, decisions), a building; each
  change's causal trace in place; a seat
- [x] Search by name or id (people, offices, firms, posts, buildings, seats)
- [x] Overlays: who decided (all but their own, or one class), hardship (sense of agency, or money held as a rank),
  each with its legend and definition
- [x] Keys: space, arrows (shift: a day), `[` `]`, `q` `e`, `f`, `/`, Esc (and `i` isometric, `0` the whole town)
- [x] The address keeps run, time and selection (and the overlay and workspace); an address edited in place is followed
- [x] Labels over the offices that matter and the seats' offices; a hover note on people and buildings
- [x] The run picker (`--all`) and a splash while a run is indexed
- [◐] Phones: the layout narrows (the rail goes, the inspector becomes a sheet), not checked on a phone
- [x] WebGPU, with WebGL 2 where it is missing: two builds of the same crate; the page loads the WebGPU one where the
  browser gives an adapter (checked in headless Chromium on its software WebGPU adapter, `docs/explorer-shots/m1-webgpu.png`),
  else WebGL 2 (`#gl=1` forces it)

Beyond the Three.js explorer: tilt and free orbit, fly to a selection, follow a person, a zoomable timeline with day
and night bands, shadows and fog, people moving along roads, a run shown while it is still being indexed, a native
build, frame statistics, and the workbench.

### Not built yet, and known gaps (PL-2)

- Screen-space ambient occlusion (not on WebGL 2; to try on WebGPU and native); weather (none in the logs looked at).
- Rings and arcs are Bevy gizmos (thin lines), not glowing tubes; good enough to read, plainer than the Three.js ones.
- The native interface shows panels as facts and rows, plainer than the browser's; no workbench natively.
- The first paint of a 10,000-person run is about 23 s here (above); the data layer's header parse is the next work.
- `oikos-explore`'s memory (8.1 GB at 10,000 people for a month) bounds what can be shown; not changed here.

## The workbench

The interface's second workspace (the **Workbench** tab), for investigating and comparing runs; the same data layer
and measure/'s measures. Everything heavy is computed on the server: the events table, cohorts and per-building counts
in Rust (`kernel/crates/explore/src/bench.rs`, routes `/api/r/<run>/events`, `/cohort`, `/decided`), the measures of
stewardship by measure/'s own `Ledger` in the Bun server (`renderer/src/workbench.ts`, routes under `/wb/`). The
browser pages, filters and draws only what it is sent. Nothing is fed back into a run.

- **Runs**: those the server was started with (`oikos explore --all --runs DIR --engine bevy [run dirs]`), grouped by
  experiment, arm and seed. An experiment's arm is found from where its exported log sits: `<experiment>/seed-N/<arm>.jsonl`
  (`oikos-kernel export`), or a folder with `experiment.json` (`{"experiment": "<its output folder>", "arm", "seed"}`) for
  arms exported elsewhere. Tick runs to compare: a model seat and its code twin, an experiment's arms and seeds, a fork
  and its parent.
- **Measures**: any measure of `measure/src/stewardship.ts` (with what it counts, as `STEWARDSHIP_MEASURES` says it)
  over time, read from each run's log by a Ledger whose result is taken at each midnight (a count is to date; a share or
  mean is of what happened to date); for an experiment, counted from the fork day, with the spec's institutions. By arm
  across seeds: the mean, a band from the least to the most, a darker band for the 95% Student-t interval of the mean;
  a table view at the last day. Hover: the day's values.
- **Pre-registration**: where the runs belong to an experiment whose output keeps a registration
  (`preregistration.yaml`, `measure/src/prereg.ts`), its question and primary comparisons are shown, each measure is
  marked *registered · primary*, *registered · secondary* or *exploratory*, and the picker stars the registered ones.
- **Compare**: the run on the map against another (the same seed's other arm first): every measure at the end of
  each, and the difference, rows that differ highlighted; **on the map**, per building, the second run's consequential
  changes reaching those who live there minus the first's, to the moment shown (a diverging overlay), and the second
  run's daily pulse drawn over the timeline. Refused for two runs that are not the same town.
- **Events**: everything in a run's index as a table: by kind, class of who decided, office (lines by whoever holds
  one of its posts), outcome of the act behind it (applied, refused, pending, none), who, about whom, days, words in the
  line; newest or oldest first; 100 a page; counts by class. A row opens its causal trace; its time takes the map
  there. A word search reads at most 400,000 lines and says so when it stops.
- **Cohorts**: a group defined by a rule (reached by a change decided by a class, landing hard, whose record kind or
  sentence holds a word such as *refused*, *benefit* or *arrears*; sense of agency below a value on a day; money held
  at most a sum on a day), followed over the run against everyone else: mean sense of agency, mean money held, the
  share at home at midnight, hard changes per 100 people a day. A member counts in the group from the day they joined
  it. A comparison, not a cause.
- **Export**: every table and chart to CSV or Parquet (`/wb/export?what=measures|events|cohort&format=csv|parquet`).
- **Series colours**: six categorical colours (blue, orange, aqua, yellow, magenta, violet, stepped for the dark
  surface) checked for lightness, chroma, colour-blind and normal-vision separation and contrast against the
  interface's surface; assigned to runs or arms in a fixed order.
- **Debriefs are not shown** in this build (VISION 15): the index drops them, no route serves them, and
  `DEBRIEF_HOOK` in `renderer/src/workbench.ts` marks where a separate, deliberate view would plug in. Its design is the
  owner's to decide.
