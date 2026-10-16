# The renderer: seeing a run, down to one person and why (plan, 2026-10-16)

**Status:** a plan, awaiting the owner. Nothing here is built. V0.md promised it as stage 3 and its definition of done
point 3: "Opening the renderer on any run shows the town, lets you zoom to a single citizen, and shows what happened to
them and why." The platform's purpose is to observe gradual disempowerment (`docs/design/gradual-disempowerment.md`);
this is how a person sees it happen: who decided what about whom, human or system, and what it did to them.

## 1. What it is, and what it must never do

- **A separate package, `renderer/`**, a Bun workspace beside `measure/`. Bun serves it; the client is Three.js on
  WebGPU (`three/webgpu`'s `WebGPURenderer`, which falls back to WebGL 2 by itself where WebGPU is missing), with an
  isometric orthographic camera and boxes for buildings, markers for people. Panels are plain DOM in TypeScript, no UI
  framework; small time charts with uPlot. `oikos view <log>` starts it and prints a localhost address.
- **The researcher's view, outside the world.** Like `measure/`, it may see everything: every register, every account,
  every transcript (`docs/no-god-view.md` binds participants, not readers of logs). It has no in-world identity and no
  seat knows it exists.
- **It never writes to a run and never feeds anything back.** It reads the log (plain or `.zst`) through the repo's
  read-only reader (`orchestrator/src/logs.ts` `logLines`) and nothing else from the run's folder. It never starts or
  talks to the kernel's `serve`, the orchestrator, or a participant; it writes no annotation. Its own files go outside
  the run's folder (section 3). It binds to `127.0.0.1` only; from another machine, an SSH tunnel through `scripts/mini`.
  A test (`renderer/test/read-only.test.ts`) holds this: no import of the kernel client, `run.ts` or anything that
  spawns a process; every file the package opens in a run's folder is opened for reading; after indexing and serving a
  test run, every file in its folder has the same bytes and times.
- **It shows no debrief.** Debriefs and exit accounts are kept back as VISION 15 says (`debriefs.withheld.jsonl`); the
  renderer does not read them or the `debrief` annotations. Seats' transcripts are shown: they are the "logged
  reasoning" V0 asks for.
- **It judges nothing.** No composite score of a life or a town. Overlays show a named, raw quantity with its
  definition on the legend (section 6), as measures do.

## 2. What a run is, by size

From measured logs (decisions 2026-10-08 "A 10,000-person month fits"; `docs/design/compact-logs.md`; the 3,000-person
90-day twin of living pilot 6, `runs/living-pilot-6-2026-10-13/twin90`, read for this plan):

| Town | 90 days, raw | A year, raw | A year, compressed | Lines a year | Structures |
|---|---|---|---|---|---|
| 1,000 | about 120 MB | about 470 MB lean (620 MB with decisions) | about 70 MB | about 4 million | 583 |
| 3,000 | 1.03 GB (2.85 million lines; a 42 MB header) | about 4.2 GB | about 0.7 GB | about 11.5 million | 1,712 |
| 10,000 | about 6 GB | about 24 GB | about 3.5 GB | about 38 million | about 5,500 |

The 10,000 row is the measured month (about 2 GB raw) scaled; its lines and structures are scaled from the 3,000 town.

Ten years at 10,000 is about 240 GB raw (the GD plan, section 7). What fills a log, by bytes (the 3,000 twin):
`observe` commands 26%, acts 19%, `action_started`/`action_applied` 19%, `occupied`/`vacated` 14%, entity records
10%, `recorded` 3%, the rest small. A third of the lines (observe, observation, advance) matter to nobody watching.

The geometry is small whatever the size: one plane of cells (`world.ground`, 169 by 152 cells for the 3,000 town),
places as rectangles, lots as `lot` records over cells, structures at a corner cell with a footprint from their type
(`catalogue.structure_types`), each with spaces (`apts-14/dwelling.5`). A person is in at most one space at a time
(`occupied`/`vacated`). So drawing 10,000 people and 5,500 boxes is easy for any GPU; the hard part is **getting the
right state for any moment of a 24 GB year at once**. That is the index.

## 3. The data path: one pass to an index, then everything reads the index

`oikos view index <log>` (and `oikos view <log>`, which indexes first if needed) streams the log once and writes a
**view index** at `runs/views/<run_id>.<first 12 of the head hash>/`. It is derived and disposable: the log is the
truth, the index can be deleted and made again, and a stale one is never reused (the head hash names it). It is
incremental: it records the last line it took, so a live run's index grows (section 7) and an interrupted one resumes.

**Decided: fold the log in TypeScript, not by replaying it in the kernel.** The log alone rebuilds every register (the
log contract: `recorded` carries the whole record, every movement of money is one `transfer`, every change of place
one `occupied`/`vacated`), and the renderer needs only a few kinds of state. Its folds are checked, not trusted: an
entity's record by the kernel's own chain and digest (`orchestrator/src/records.ts`, reused), money by conservation
and non-negative ordinary accounts in every snapshot, places by capacity and one space per body. If a fold ever
disagrees with the kernel, add `oikos-kernel replay --states` (full state at each checkpoint, verified by the
checkpoint's state hash) and build snapshots from that instead.

What the index holds:

1. **`index.sqlite`** (Bun's built-in SQLite):
   - `ids`: every id seen (person, participant, entity, account, position, record, space, structure, action) to an
     integer, with its kind. A year at 10,000 is about a million ids.
   - `entries`: one row per kept line: seq, t, kind, name (the event, command or annotation), actor, position, cause,
     action, and its frame (below). Kept lines are all but `observe`, `observation` and `advance`.
   - `postings`: for each id and month, the seqs of every kept line that names it anywhere in its body, delta-coded
     varints in a blob. Generic on purpose: a scan of each body for strings that are known ids, so a new event or
     record kind is indexed with no new code. A person's history is the union of their ids' postings (the person, its
     `-self` participant, its accounts, the records naming it).
   - `chains`: the links the causal trace walks (section 5): each effect line to its action, each action to its act
     command, each record to its `basis` records and the reverse (who answered it), each standing payment to its
     instruction record, each model seat's act to the transcript of the call that gave it (the dataset's own join,
     `orchestrator/src/dataset.ts`, reused), each code citizen's act to its `decision` annotation where recorded.
2. **`frames/`**: the kept lines themselves, re-compressed with zstd in frames of 4,096 lines, with each frame's offset
   in `index.sqlite`. One line costs one small frame's decompression (milliseconds). About the compressed log's size
   (3.5 GB a year at 10,000); this is the one large part, and it is what lets any line be shown at once.
3. **`tracks/`**: binary arrays for drawing and scrubbing:
   - `where-days.bin`: for each day at midnight, every body's space as a `Uint32Array` (40 KB a day at 10,000; 15 MB a
     year), plus a code for "out" (between spaces), "left" and "dead".
   - `moves/<day>.bin`: that day's `occupied`/`vacated` as (t, body, space) triples, 12 bytes each (about 25,000 a day
     at 10,000; 300 KB).
   - `money-weeks.bin`: every account's balance each week as `BigInt64Array` (about 120 KB a week at 10,000). A
     balance at any t is the week's plus that account's transfers since, from its postings.
   - `structures.bin`: each structure's start, completion, demolition and flooding times.
   - `overlay-<name>-days.bin`: one value per structure or per person per day, for each overlay (section 6).

**Scrubbing a year at 10,000 smoothly.** The client fetches a year of `where-days` (15 MB, compressed in transit) and
the overlay tracks once. Dragging the timeline shows the nearest midnight at once: setting 10,000 instance positions
from a typed array is well under a millisecond, and nothing is fetched while dragging. On release, or while playing,
it fetches that day's moves (300 KB) and applies them in time order; the next day is prefetched. Ten years are loaded a
year at a time; at a decade's zoom of the timeline the client uses every seventh day. Nothing in drawing touches
`frames/`; only inspecting does.

**Cost of indexing** (to be measured in step 1, estimated): JSON-parsing two thirds of the lines after a cheap
prefilter, about 3 to 5 minutes a simulated year at 3,000 and 15 to 25 at 10,000, one core for the fold, worker
threads for frame compression (the owner wants the cores used). Index size about one sixth of the raw log.

**If logs become compact** (`docs/design/compact-logs.md`, `events: "derived"`), the indexer reads the output of
`oikos-kernel replay --emit` on a pipe instead of the file: the stream is the same, and nothing is written to the run.

## 4. The views

The camera is orthographic at the true isometric angle (45 degrees round, 35.26 degrees down), turnable by quarter
turns. One cell is `ground.cell` world units (1 where the world gives none). Zoom is continuous; what is drawn changes
in four bands. A click on anything opens its panel at the time shown; the panel's links move the camera.

- **Town.** The ground with terrain colours, places' outlines and names, every structure a box (footprint from its
  type, height by its number of spaces, colour by its type's `category`), roads and water as flat tiles. People are not
  drawn one by one: each building carries a thin column whose height is how many are inside now. Organisations'
  premises can be highlighted from a list.
- **Block** (about 30 cells across). Lot outlines (`lot` records), each building's box, and people as markers: a body
  in a space is placed in a fixed slot inside its structure's footprint (its rank among that space's occupants); a body
  between spaces is drawn dimmed beside the building it last left. **No invented paths:** the log says where people
  are, never the route, so nothing walks along a street.
- **Parcel** (one lot). The building opened up: its spaces as slabs one above another, labelled (`dwelling.5`,
  `shop`), occupants named on hover. Panel: the lot's record and claims (who owns it), the structure and its state
  (wear, flooding), agreements on it in force (leases: landlord, tenants, rent, arrears from their payments), and its
  record history (plans, notices, orders).
- **Citizen.** The camera follows one person. Their day's stops are drawn as arcs between the buildings they were in
  (where, not how they got there). Panel: who they are (name, age, household, home, work), their money at t, their own
  record's sections at t (needs, trust in each institution, sense of agency, values: `records.ts`'s rebuild to t), a
  **timeline strip** of every change that reached them, each mark coloured by who decided it (section 6, overlay 1),
  and below it the **causal trace** of the selected change (section 5).
- **Organisation** (a firm, an office, the council, the bank). Panel: its posts and who holds each, marked as a person,
  an organisation's code system, or a model seat (named: provider and model, from the log's `usage` annotations and the
  participant's controller); its staff (employment agreements in force) and its premises lit on the map; its money by
  week (uPlot); its acts by week, split by the class of who decided and by who performed (`action_applied.by`, the
  field the GD plan's M1 reads); letters in and out.
- **Office** (an organisation that decides cases: support, desks, planning, tribunal, lending, finance). The
  organisation's panel, plus **staff now** (which of its people are at its premises at t) and its **backlog**: records
  addressed to it (`addressed_to`, `speaks_for`) that no later record of its own cites as `basis`, oldest first, with
  their age; the backlog's size by day as a chart; and its decisions, each with its stated reason (`text`) and the
  class of who decided. A click on a case opens its chain.

## 5. The causal trace: what changed for a person, which decision caused it, who made it, and why

**What changed for them.** Every kept line in the person's postings that is an effect on them, not their own looking:
money into or out of their accounts (`transfer`); a record addressed to them or naming them as a party (a lease, a
notice, a decision, a debt, an order); being moved out of a space by someone else (`vacated`, reason `removed`); a
condition begun, treated or ended; a change to their own record (`entity_recorded`, with the command's `because`); a
letter delivered to them; a post given or taken (`appointed`). Their own acts are listed too, marked as theirs.

**Which decision caused it**, link by link, each stored in `chains` at indexing time:

1. **Effect to action.** Every event names the command that caused it (`cause`). An act's effects follow its
   `action_applied` line under the same `cause` (seen in the logs: `action_applied`, then its transfers and records),
   so the indexer ties each effect to the action applied just before it with the same cause. An effect with no action
   is the world's: a scheduled payment (`per_instruction` names the standing instruction: follow it to the record and
   the act that made it), a life event (illness, birth, death by the life table), weather, nature. These are shown as
   "the world" or "a standing instruction made by ...", never given a decider they did not have.
2. **Action to act.** `action_started.cause` is the act command: the participant, the position it acted in (`as`, so
   the organisation), who performed it (`by`), the provenance (`direct`, `call`, or `translator` with the seat's own
   proposal, the draft, the sign-off), the act's stated reasoning where logged, and the world seconds it spent deciding.
3. **Who decided.** The participant's class: **this person**, **another person**, **an organisation's code system**
   (named by its module, `controller.impl`), **a model seat** (provider and model), or **the outside world** (a
   boundary). Plus who did the work, if others (`by`).
4. **Why.** For a model seat: the transcript of the call that produced the act (prompt as rendered, the answer), the
   draft and sign-off. For a code citizen: its `decision` annotation (options, scores, choice) where the run recorded
   decisions. For an office: the reason its record states (`text`, `data.reason`: "declined: the repayments ... are
   more than 66.67% of your regular income"). For a code system with no logged reasoning (lean logs drop it): its module
   and "reasoning not logged in this run", said plainly.
5. **What it rested on.** The act's records cite their `basis`; each basis record leads to the act that made it, and
   the walk repeats: a warrant to the order, the order to the hearing, to the application, to the landlord's notice, to
   the arrears. The walk stops at the person's own act, at the world, at depth eight, or at a record made before the
   run (genesis). Each link shows its time, its author and its class, so a chain reads as who did what to whom, and
   where a person was in it.

The trace is shown as a column of links, newest at the top, each a sentence in the world's terms with its day, a class
badge and a link to its full line. Text a seat or an office wrote is shown as written.

## 6. Overlays

Each is a per-day track built by the indexer, with its definition on the legend. Three, built in this order:

1. **Who decided** (V0's one overlay). For each building, over the last 30 days, the share of **consequential acts**
   touching the people who live there, by the class of who decided: the person themselves, another person, an
   organisation's code system, a model seat, the world. Consequential acts are the GD plan's M1 list (money moved to or
   from a person by another's act; a debt or claim raised or written off against them; a job or tenancy ended; a
   payment or permit granted or refused; an appointment). The list is defined once, in `measure/` (a small TS module
   M1 will use), and imported here; until M1 is built the renderer's step adds it there. On a citizen it is the
   timeline strip's colours.
2. **Where systems are deployed.** Each organisation's premises, shaded by the share of its acts in the last 30 days
   decided by a code system or a model seat, and outlined where it deployed a system (`participant_created` with a
   template and supplier). Today every office is held by `<office>-system`, so the map will show the offices lit and
   firms mostly not; after the GD plan's B2 to B6 it shows adoption spreading, office by office.
3. **Hardship, as the record has it.** A chosen raw variable from people's own records (needs: subsistence, shelter,
   security; housed; savings; sense of agency), shown per person at block zoom and as the mean per building at town
   zoom, with markers for the events that land hard: notices to vacate, removals, debts raised, payments refused, loans
   declined. No composite: the legend names the variable.

The overlay pattern (a track, a legend, a definition imported from `measure/`) is what later overlays follow.

## 7. A live run

`oikos view <running log>` tails the plain `.jsonl` a running run is writing, read-only, and indexes as it grows; the
client asks for the head each second and extends its timeline. It shows what the kernel has flushed (it is behind by
the kernel's buffer) and ignores a last line not yet complete. It does not touch the run's process. When the run ends
and its log is compressed, the next open indexes the compressed log under its final head hash; the live index is
deleted.

## 8. Out of scope

Art and models (boxes only; each structure type maps to a shape in one table, so models replace boxes later without
rework); anything that steers, pauses or edits a run; running measures (the renderer may show a measure's output from
`measure/` later); comparing a run with its twin side by side (the next thing after this plan: the same citizen in
the pilot and in its twin is the clearest picture of what a seat changed; it needs two indexes and one panel, a step
or two more); showing debriefs or withheld material; participants' observations beyond what a run recorded
(`observation` annotations are shown in the panel if present, nothing more); summarised places beyond a flat tile;
the kernel in the browser by WebAssembly; hosting for others, accounts, sharing links; sound; mobile.

## 9. Build order

Each step is about a day for a Sonnet agent, ends with `bun run test:fast` and its own tests, and calls no model.
Fixtures: a small generated town run by the mock for 60 days in the test's setup (as orchestrator tests do), and the
possession chain and council chain the justice and council tests already run.

| # | Step | What it tests | Days |
|---|---|---|---|
| V1 | `renderer/` workspace; `oikos view` command; the static world (ground, places, lots, structures, spaces, participants, classes) from the header; the read-only guard; time the indexer's read on the 3,000 twin | the world's geometry as config says; no write imports; run folder unchanged | 1 |
| V2 | Indexer: ids, entries, frames, postings; incremental and resumable | each kept line comes back byte for byte by seq; a person's postings equal a brute-force scan; a resumed index equals a whole one | 1 |
| V3 | Indexer: chains (effect to action to act; basis both ways; standing instructions; transcripts and decisions joined) | on the fixtures, known chains are found link for link | 1 |
| V4 | Tracks: where-days, moves, money-weeks, structures | a day's keyframe plus its moves is the next day's; money is conserved in every week; capacity holds | 1 |
| V5 | Server: `Bun.serve`, the API (world, tracks by range, entity at t, trace, organisation, office), localhost only | every endpoint on the fixture; nothing outside the index and the log is read | 1 |
| V6 | Client scene: WebGPU with WebGL fallback, isometric camera, ground, lots, instanced boxes, pan, zoom, bands, picking | the projection, slots and bands as pure functions; the bundle builds; a headless screenshot where a browser is present | 1 |
| V7 | People and time: markers, where-days, moves, scrub, pause, speed, prefetch | the client's position at t equals the server's; no fetch while dragging | 1 |
| V8 | Inspect panels: parcel, person at t (money, record), organisation | panel data against the fixture at sampled times | 1 |
| V9 | The causal trace and the citizen view | a removed tenant's trace reaches the notice and the member's order; a declined loan names the bank's code system and its reason; a mock seat's act shows its transcript | 1.5 |
| V10 | The office view: staff now, backlog, decisions by class | backlog equals a brute-force count at sampled times | 1 |
| V11 | The three overlays, the consequential-acts list in `measure/` | each overlay's value equals a direct count on the fixture for sampled days | 1 |
| V12 | Live attach | an index made while a mock run writes equals the finished log's index; the run's files unchanged | 1 |
| V13 | Scale: a year at 10,000 (the GD plan's R1 log) indexed and opened; index time, size and frame time recorded; fix the worst; V0's definition of done checked by hand on three runs | V0 point 3 | 1.5 |

**Total: about 14 agent-days**, plus machine time for V13's year. V1 to V9 alone meet V0's definition of done on any
run up to 3,000 people; V13 is what makes it true at 10,000.

## 10. For the owner

1. **When to build it.** *Recommend:* after the GD plan's robustness steps R1 to R3 (so a year at 10,000 exists to
   test against, and logs do not change shape under it), and before its B steps' results are read, so the first
   adoption runs are watched, not only measured. It is a separate package and does not slow the GD work except for
   agent time.
2. **What "who decided" counts as human.** Every person in the world is code, and so are offices' systems. *Recommend:*
   classify by role in the world, not by what runs it: a person (themselves or another), an organisation's system, a
   model seat, the world; the legend says that people are simulated. This is the same line the GD plan's M1 draws.

**What would change course:** the TS folds disagree with the kernel (then snapshots come from a kernel replay, as in
section 3); indexing a year at 10,000 takes over an hour (then index by month in parallel, the fold per month resuming
from the month's snapshot); or WebGPU and its fallback cannot draw 10,000 markers at 60 frames a second on the owner's
machine (then people are points in one draw call, which any GPU can).
