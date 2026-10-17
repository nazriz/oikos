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
