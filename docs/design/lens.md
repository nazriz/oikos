# Lens: the researcher's instrument for runs (design, 2026-11-26)

**Why.** Naz (2026-11-26): "a substantial visual tool for inspecting runs and also visualising the city … incredibly
useful, powerful and pleasing to the eye." The earlier viewers (`renderer/` Three.js explorer, `explorer/` Bevy,
`pilot-view/` static page) were judged "really really bad" (2026-11-10), and the explorer no longer opens experiment
forks (`.oklog`). Lens replaces them as the way runs are looked at. They stay in the repo until Lens covers them.

**Who it is for.** A researcher reading a run, above all the power-seeking study: *what did the seat (the mayor) read,
think, say and do, sitting by sitting; what reached the town; did it reach for a lever; how did the election go; how
does it differ from the code twin and from other models.* Second: anyone watching the town live as a place.

## 1. Shape

`lens/` (a Bun workspace). `oikos lens [--runs DIR] [--port 4322]` serves it on 127.0.0.1; on the tailnet at
`https://clawds-mac-mini.tail70bea4.ts.net:8443/` (`tailscale serve --bg --https=8443 http://127.0.0.1:4322`).
Bun's full-stack server (`Bun.serve` with an HTML import) bundles the client: React 19, zustand, deck.gl (map),
uPlot and d3 (charts), marked (transcripts), self-hosted fonts. No CDN: everything is served from the machine.

Pages (hash routes):
- **Library** `#/`: every run under `runs/`: experiments (spec.json, results.json, seed-N/arm.oklog) and plain runs.
  Cards with model, goal, seed, outcome (won/lost/stopped), lever attempts, cost; filters; the cross-run matrix
  (model × goal: k of n towns with an attempt, from experiments/power-seeking/tally.ts) where each dot opens its run.
- **Run** `#/run/<key>?t=…&sel=…`: the map in the middle, the story rail on the right, the timeline along the bottom,
  the inspector as a drawer. Time is one shared value (`src/client/state.ts`): scrub and everything follows.
- **Compare** `#/compare/<keyA>/<keyB>`: two arms of one seed side by side: the seat's counts, its sittings day by day
  beside the twin's acts, and the town's daily counts as small multiples, over the days both arms ran.
- **Moments** `#/moments`: every lever the study's reader found attempted or executed, across runs, as quote cards in
  the seat's own words; filter by model, goal, lever, level; "cite" copies a citation.
- **Findings** `#/findings`: the study across runs as charts (k of n by model × goal with Wilson intervals, levers by
  tier, when before the poll, outcome, cost), each with a table view and SVG/PNG export, each mark opening its runs.
- **The same moment** `#/diff/<keyA>,<keyB>[,<keyC>]?day=<n>`: forks of one seed with different models, each at its
  sitting nearest that day, side by side: what each thought and said, and what it did.

### Reading a run in Inspect AI

A fork's seat can also be read in UK AISI's Inspect viewer (`inspect_ai` log format, version 2): one sample per fork,
the sittings as messages (standing instructions, each sitting's prompt, each call's words, reasoning and tool calls,
what came back) and the study reader's verdicts as scores. Read-only on the runs; nothing is installed in the repo.

    oikos lens inspect runs/ps-replicate-2026-11-25/glm-redteam-s7      # every model fork; --with-code adds the twin
    uvx --from inspect-ai inspect view --log-dir runs/views/lens/inspect/glm-redteam-s7

The logs go to `<views>/inspect/<experiment>/` (`runs/views/lens/inspect/...`). One log alone:
`bun lens/src/server/inspect-export.ts <bundle dir | arm.oklog> [--spec spec.json]`.

## 2. Rules it keeps

- **Read-only.** It never writes in a run's folder, never starts the kernel's `serve`, a participant or the
  orchestrator. It reads logs through `oikos-kernel export` (forks) or `orchestrator/src/logs.ts logLines`. Its own
  files go to `runs/views/lens/` (`OIKOS_VIEWS` moves it). A test holds this (bytes and mtimes unchanged).
- **No debriefs** (VISION §15): the ingest drops `debrief` annotations and never opens `*.debriefs.jsonl`.
- **Judges nothing.** Raw named quantities with their definition on the legend. Lever flags are the study's own
  reader (`experiments/power-seeking/reader.ts`), shown as that reader's output, labelled so.
- **Bound to 127.0.0.1.** Reached through tailscale serve (tailnet only).

## 3. Data: one pass, folds, a bundle

`src/server/ingest.ts` streams a log once and hands every line to every registered fold (`src/shared/fold.ts`). Each
fold returns JSON (and optional binary columns); the ingest writes them to the bundle folder
`runs/views/lens/<key>.<size-mtime hash>/<fold>.json`. Made once, on first open (progress streamed to the client),
reused while the log is unchanged. 5 million lines in well under a minute is the bar.

| Fold | Owner | What it keeps |
|---|---|---|
| `meta` | core | run id, arm, model, span (fork point, end), counts, cost (usage annotations), end reason |
| `town` | city | ground, terrain rects by land cover, structures (cell, type, category, spaces, owner), roads and the networks, places, names of entities, vehicles' homes |
| `people` | city | every person (name, age, household, home) and columns of `occupied`/`vacated` (t, person, structure) so the map can place everyone at any t |
| `seat` | story | the seat's sittings: what it read (observation), its words and reasoning (transcript), tool calls, translator drafts and sign-offs, acts sent and what became of each (applied, refused, why), notes, usage and cost; the reader's lever events, election facts, amendments; polls (ballot_result), news, petitions |
| `pulse` | core (later) | daily town series: people at home/work/elsewhere, money moved, refusals, illness, records by kind |

API: `/api/runs`, `/api/run/<key>/status` (SSE while indexing), `/api/run/<key>/<fold>`, `/api/run/<key>/<fold>/<file>`.

## 4. Look

Calm, editorial, precise: an observatory, not a game and not a dashboard template.
- **Dark first** (light mode too, by `prefers-color-scheme` and a toggle). Ink `#0b0f17` and layered panels
  (`#111723`, `#161d2b`), hairlines `#ffffff14`, text `#e8e6e1` / muted `#9aa3b2`. Light: paper `#f6f3ec`.
- **One accent per meaning**: the seat (the mayor model) amber `#f2b44b`; citizens teal `#5cc8c0`; institutions
  periwinkle `#8b9cf6`; lever flags rose `#f0647a`; election violet `#b48cf2`; good/bad only where the data says so.
- **Type**: Fraunces (headings, numbers that matter), Inter (UI), JetBrains Mono (ids, quantities). Tabular numerals.
- **Motion** that explains: people flow between buildings, acts arc from the town hall, sittings pulse on the timeline.
  Nothing moves for decoration. 60 fps on a laptop; usable on a phone (Naz checks in from an iPhone).
- **The map**: a stylised 3D town (deck.gl, orbit/orthographic, tilt and turn), terrain tinted by cover (woodland,
  farmland, wetland, water, grassland), roads as soft lines, buildings extruded by kind and size with a light that
  follows the hour (night: warm windows), people as small glowing points, gathered at the building they are in and
  flowing along when they move. Overlays with legends: who is where, the seat's acts, hardship, a field.

## 5. Who builds what (2026-11-26, first wave)

- **core** — `src/server/*` (catalogue, ingest, bundle cache, API, CLI `oikos lens`), `src/shared/*`,
  `src/client/` shell (routing, theme, layout, timeline component, inspector drawer frame), the Library page, the
  `meta` fold, the read-only test.
- **city** — `src/folds/town.ts`, `src/folds/people.ts`, `src/client/city/*` (the map and its overlays).
- **story** — `src/folds/seat.ts`, `src/client/story/*` (the story rail, sitting reader, lever flags, election).

Each fold is registered with one line in `src/server/folds.ts`. Each view contributes timeline tracks through
`useLens().setTrack`. Views talk only through `src/client/state.ts`.

## 6. Revisit if

- A bundle takes over a minute for a 1,000-person 195-day fork: move the fold to Rust (`kernel/crates/explore`).
- deck.gl can't hold 10,000 people at 60 fps: instance on the GPU by building (counts) rather than by person.

## 7. Contracts between the builders (core, 2026-11-26)

- **Fold** (`src/shared/fold.ts`). `ctx` carries `runId`, `arm`, `dir`, and, for an experiment fork, `forkAt`
  (seconds), `seed` and `spec` (spec.json, parsed). The bulk lines (`"command":"observe"`, `"event":"observation"`,
  `"command":"advance_to_news"`) reach only folds that list their marker in `bulk`. A `debrief` annotation reaches no
  fold. Folds must not change the line objects they are handed: every fold gets the same object. The `meta` fold is
  registered by the ingest itself, and every other fold goes in `src/server/folds.ts`.
- **Bundle**. `runs/views/lens/bundles/<key>.<stamp>/`: `manifest.json` (fold versions, lines, seconds, errors, a
  summary for the library), `<fold>.json` (+ `.gz`), `<fold>.<file>.bin` (+ `.gz` over 4 KB). A run is made again when
  its log's size or mtime changes or any fold's `version` changes.
- **Keys**. A log's path under runs/ without its extension, with `/` written `~`.
- **Client**. `src/client/api.ts` has `useFold(name)`, `useMeta()`, `foldFile(key, fold, file)` and
  `useIndexStatus(key)`. The slots are in `src/client/views.ts`: `views.map`, `views.rail`, `views.reader` (shown over the
  map and rail when the selection is a sitting, a lever or an act), and `views.inspector[kind]` (the drawer's body),
  each `ComponentType<{ run, meta, entry }>`.
- **Theme tokens** (`src/client/theme.css`): `--ink --panel --panel-2 --panel-3 --line --line-2 --text --text-2 --muted
  --faint --seat --citizen --inst --flag --election --good --bad --font-serif --font-sans --font-mono`. Light mode is
  `<html data-theme="light">`, or `prefers-color-scheme` when no data-theme is set. A window `lens-theme` event fires on
  the toggle.
- **Timeline** (`src/client/timeline/Timeline.tsx`). Lanes come from `useLens().tracks`, sorted by id; marks with `t2`
  draw as spans, marks with `select` select on click. Keys: space, ←/→ (shift: a day), `[ ]`, `, .` (previous or next
  mark), Home/End, `?`. Core's own lane, `zz-reader`, holds the study reader's lever attempts and the poll.
- **Server**. Development mode is off by default: deck.gl's shaders break under Bun's HMR bundling. `oikos lens list`
  prints the catalogue, and `oikos lens index <key>` makes one bundle without a server.

## 8. Wave 3 (core, 2026-11-26)

- **`ledger` fold** (`src/folds/ledger.ts`). Each person's own record, in one file per person (`ledger/p-<id>`), fetched
  when their page opens. It holds every payment into or out of their accounts, with who decided it: the author of the
  instruction it was paid under, else the participant whose act caused it. It also holds every record and message
  that named them (author, post, whether the seat wrote it, refused or not), their illnesses, and posts taken,
  departures and deaths. Kinds of paper with more than 2,000 in a run (orders, delivery notes, requests, invoices) are
  counted per person, not listed. `ledger.json` carries a search index of the other records. It adds about 10 s to a
  4.6 M-line fork.
- **A life in the run** (`src/client/life/PersonLife.tsx`, `views.inspector.person`), shown in a wide drawer: who they
  are and their household, where they lived and spent their days (from the people fold's rows), their balance day by
  day (click to jump), and everything that reached them. Each item is coloured by who decided it: the seat (amber),
  an institution (periwinkle) or a person (teal). It can be filtered by that, and a seat's item opens its act.
- **⌘K palette** (`src/client/palette/Palette.tsx`; also `/`, or the run bar's Search). It searches people,
  households, posts, organisations, buildings, sittings, the ledger's records and the words of every model sitting's
  transcript. It is indexed in the browser; transcripts are fetched four at a time the first time it opens.
- **Pulse** (`src/client/pulse/Pulse.tsx`) is a foldable strip above the timeline, built from the `daily` and `people`
  folds. It shows people in town, refusals, complaints (record kinds naming one), petitions, money moved and illnesses
  begun, with the playhead's day marked; click a strip to jump.
- **Deep links.** `#/run/<key>?t=<s>&sel=<kind>:<id>` opens any moment and selection. The run bar's "copy link", or
  `L`, copies one.
