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
one-thread read.

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
  every `/api/*` request to the Rust service (the TS index is not built); or
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
