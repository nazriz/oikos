# Viewing a pilot: `oikos pilot-view`

`oikos pilot-view <run-dir> [--out file.html] [--twin DIR | --no-twin]` reads a finished pilot's folder and writes **one
HTML file** (inline CSS, script and data; no network; kept under 10 MB by shortening excerpts) that opens in any browser,
phone included. Default output is `<pilot>.html` in the working folder; it refuses a path inside the run. The run is only
read (the log through `orchestrator/src/logs.ts`, `batch.json`, `PILOT.txt`, the debriefs file beside the log); a test
checks the folder's files are unchanged in size and time. No model is called. About 15 s for a 90-day 3,000-person pilot.

## What it shows
- **Overview:** town, profile, seed, days, framing, cost and calls, each seat with its model, the translator's share
  (ours or the fallback, drafts confirmed, declined, not answered, asked back, why requests went behind), alerts (an
  unfinished run, failed calls, missed sittings, "no turn" sendings-away, debriefs not given, the wave's alert log).
- **Seats:** per seat, a day-by-day list of sittings; each opens to what it read, its turns (what it said, what it looked
  up), what it asked for in its own words, the translator's draft, confirmed or declined, and the outcome: the act, what
  it put on record or paid, and later papers that cite it. Also its notebook and its debrief. Search and a filter.
  A sitting can be linked: `#seats/<seat id>/<day>`.
- **Seat vs twin:** the seat's acts set beside the code twin's (same town and seed, code in the seats), matched by
  parties and kind of matter; differing facts are marked. The twin is found from the pilot's `batch.json` (a `twin*`
  folder beside the world file's working folder holding the same run id) or given by `--twin`.
- **Actors:** offices, firms and people the seats dealt with, and the town's institutions: counts, a by-day bar chart,
  papers and payments, first and latest items, dealings with the seats. Searchable by id or name.
- **Town:** daily counts (acts, payments, money moved, papers, work sessions, refusals; papers of one kind), the twin
  dashed beside them, and the first week against the last. Plain counts; nothing is scored.

## Rules it keeps
- A debrief step the seat asked to keep back is shown as kept back, nothing else (the orchestrator's own `isKeptBack`).
  Debrief transcripts are not read; citizens' exit accounts are not shown.
- Seat transcripts are shown (the "logged reasoning"). The researcher's view may see everything in a log; no seat sees it.

## Not shown, and why
- Reading and look results are cut (the first 12,000 and 2,500 characters); the page says how long the original was.
- The twin's other work at a post (e.g. hearing notices) is counted, not listed. Twin comparison is by parties and
  matter, so a seat act with no twin counterpart is "seat only" even when the twin did something near it.
- Nothing from the translator's training eval, `claude-code.calls.jsonl` or `decide.calls.jsonl` (the log holds the
  same). Money per day is a sum of integer minor units, not a balance: no balances are folded from the log.
- Citizens' reasoning (`decision` annotations) and the map are not shown: that is the renderer.

## Path to the renderer (`docs/design/renderer.md`)
`pilot-view/src/ingest.ts` is one streaming fold of the log (as the renderer's indexer will be), `build.ts` produces a
plain JSON `ViewData`, and `render.ts` only embeds it in a page. The renderer can take the same fold and data for its
panels (seat transcripts, actors' timelines, causal chains); the page's code is plain DOM, like the renderer's panels.
