# All work takes time

Naz, 2026-10-15: "every single piece of work should cost time, and that should be enforced at the kernel level or the
platform level ... it should just be at the foundational level how the world operates"; and, of the patches that had been
made one case at a time (a daily case limit, a processing delay, an error rate that doubles under backlog, a clerk who
files one paper a day), "stop fixing one case at a time".

The plan and its reasons are in [design/foundations.md](design/foundations.md); each step is in the decisions log
("Foundations F1" to "F11"). This page is the rule, how it is enforced, and how to work with it, as
[no-god-view.md](no-god-view.md) is for information.

## The laws

**Every act takes time, and the time is read from what the act makes.** A person has one timeline, shared by every post
they hold and by their own life; a system has as many lanes as its template says. An act is placed on its performers'
timelines after what they have in hand, and takes effect when they have spent the time. A backlog is what follows: work
arrives faster than the hours of whoever does it. Nothing sets a throughput, a delay or a haste; none is a parameter.

**Every doer has a capacity, systems included** (law 10, [design/foundations-2.md](design/foundations-2.md) section 4).
A system's act takes what its template says (a `does` row's own `seconds`), else the world's row for systems; a
system's lanes work inside its template's `hours` (a machine's are the whole day, a desk of people's their working
day), and work that does not fit the day goes on the next: a queue, never a refusal. An act nobody priced is not done
(`unpriced`): there is no implicit second. A desk of the outside world's officers (the support office's casework) is a
system supplied for what they do, with an officer's minutes for each paper, their hours, and as many lanes as the town's
share of them.

**Only actors work: a person, or a system someone supplied.** There are no free holders. Every post is held by a person
of the town, or by a system an organisation delivered from a template that says what it can do, at what speed and how
many at once; an organisation buys the system, and its supplier can switch it off. A model's seat is a person's body
with a post of its own, and works at that person's speed.

**Who does the work is on record, and is charged.** An act may name performers (`by`): the actor, a system its
organisation owns, a person in its posts, or a person employed by it. Each is charged their own kind's time for it, and
the record says who did it. A performer not there, or past the day's work, is refused.

**An error has a cause.** A procedure that differs from the law, data that is stale or missing, hours that run out, or a
slip at a rate a source gives, drawn in one place (`slip()`, `participants/src/slip.ts`). Never a per-case dial.

**What waits for what is law, as data.** A decision waits for what the law says it needs, is looked at again where the
law says, and is appealed where the law says; the routes are a profile's, with their sources.

## What the kernel enforces, and what it refuses

The kernel places each act on its performers' timelines by the world's table of work (`orchestration.act_time`:
a row for the block, and a narrower one for what it makes, `publish/<kind of record>`; for a system, its template's own
rows first), within a system's hours, applies it when it is done, and refuses, with a reason in the log:

| Refused | Why |
|---|---|
| A performer who is not at work, or has no room left in the day (`not_at_work`, `no_time_left`) | Work is done by someone, somewhere, in their hours |
| `by` naming someone the actor may not direct (`not_theirs`) | Time is charged to its owner |
| A system's act its template does not list; a `deploy` by anyone but the template's supplier; a system working for an organisation that does not own it (`not_theirs`) | Only supplied actors work, and only for whom they were supplied to |
| An act by a dead person's participant (`dead`); a seat ends with its person | A body is one account of time |
| A question to a register's keeper with nobody on duty to answer it: it is held, in the order asked | Answering is work |
| A world whose post is held by a system no template made | There are no free holders |
| An act with no row for whoever would do it (their template's, the world's for their kind) and no `default` the world states (`unpriced`, foundations-2 P2) | Nobody said what it takes, so it is not done; it takes nobody's time |
| A template's `hours` outside the day, or on a person's template (the world does not load) | A person's day is their own; a system's window is a day's |

Until foundations-2 P2 (2026-10-25) a missing row was a second; now it is a refusal. A hand-written test world states
`act_time.default` with a note that it is a placeholder for a test world (WM-1); the generated town states none (the backstop
fails if it does). What giving an order to others takes (an act whose work is all others', `by`) is a second by
convention (`ORDER_SECONDS`), and the one who ordered it goes on at once: a known limit (WM-14), not read from the table.

## The backstop

`orchestrator/test/all-work-takes-time.test.ts`, in the fast tier, generates the town of every profile (as code seats,
and with every office handed to a model) and the sources of the modules, and fails, naming the post, the row, the form or
the line, on:

| Found | Fails when |
|---|---|
| `freeHolders` | a post is held by neither a person nor a system a supplier delivered from a template that says what it does |
| `unpricedWork` | a block the contract has has no positive row for a person; a block a system's template does has none for a system, nor seconds of its own; a row is zero; a row has no source (a template's own: `template.<id>.<row>` in `act_time.sources`); the table has a default |
| `decisionsAtTheSystemsSecond` | a system template's row for a decision (a `publish/<kind>` the published decision law names, or `decision_review`) has no seconds of its own: it would decide at a computer's second (WM-14) |
| `systemsWithoutHours` | a system template states no `hours` |
| `unpricedPapers` | a form writes a paper that takes no time (no row for it and none for the block) |
| `dialsHanded` | a module is handed `cases_per_day`, `capacity_per_day`, `processing_days`, any `<cases or capacity or claims or decisions or reviews>_per_day`, or a rate of error (`error_bps`, `uphold_bps`, a short pay's, a billing error's) |
| `errorsDrawnOutsideSlip` | a module draws a decision wrong by chance (`rng`/`chance` named for an error) |
| `specialCasesLeft` | a special case the foundations delete still stands (the inventory, `orchestrator/test/fixtures/foundations-inventory.json`; a `history` entry is a decision and is never edited) |

`orchestrator/test/all-work-takes-time-runs.test.ts`, in the slow tier (nine towns run for a month: 31 s alone, two to three times that under load, near
the gate's budget for one file), runs every profile's town for a month, code only, and fails on any act refused
`unpriced` (`unpricedActs`, naming the participant and what nobody priced); it plants a world with a system's payment
unpriced and sees it named.

The same file plants a free holder, an act with no row and each of the special cases above, and checks that each is
named. It should never fire: a failure means a way round the laws was found, which is a finding to report.

What nothing can see: whether the seconds in a row are right (each is a placeholder or a figure with a source, and a
profile may replace it: `values.work_time`); whether a module does what a procedure says (that is its test); work done
by people in their own lives (a citizen's private time is the town's own, not an office's).

## Working with it

**When a place has a case that is slow, or free, or too fast: that is a missing law, never a case to patch.** Ask who
actually does it, how, and at what cost in time; give them the time as a row of the table (and a template, if a system
does it); name who does it (`by`); and let the backlog come. Do not add a parameter that sets how many a day, how long
it takes, or how often it goes wrong, and do not hold a special case in a module. A gap is a missing law: find which
of the laws above it falls under, and make the world say it (the table, a template, a procedure, a law as data), so
that the next place that has the same gap has it mended too.

**To price an act.** Add its row to the table (`WORK_TIME` in `worlds/generator/generate.ts`, or a profile's
`values.work_time`) with its source, or its placeholder note ("to be sourced"). A kind of paper that takes longer than a
plain `publish` has its own row, `publish/<kind>`.

**To give an office a system.** A template (`kind: system`, `does`: the blocks, with `seconds` where its source says
what one takes it; `hours`: when it works, the whole day for a machine), an organisation that supplies it, and a
delivery (`lanes`: how many at once). A row's source goes in `act_time.sources` as `template.<id>.<row>`. A decision a
system makes has its own seconds: what a desk of people does is their minutes, never the world's second.

**To give an office staff.** An employment agreement with the office's organisation, in the role its module names
(`staffed`); the staff do the office's routines by standing work order, in their hours, and the office-holder sees the
hours they have and what their own acts take (`participants/src/behaviour/diary.ts`).

**To compare a seat with its code twin.** Both are the same town; the world around a post does not depend on whether a
seat or code holds it, except through the acts its holder takes: where the holder sits is its own, and what happens
when it is done is the world's. A mock seat that sits as its code twin does (`mock.twin`) is exactly its twin for a year
(`orchestrator/test/twin-seat-year.test.ts`); where a seat does otherwise, it is a steward's decision.
