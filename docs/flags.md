# Flags for a clearly broken world

Law 12 of [design/foundations-2.md](design/foundations-2.md) (section 6), cut down on the owner's word (2026-10-25: "who
cares? I don't care what the real figure is"): no real-world ranges, no held-out set, no comparison with any place's
figures. What is left is a light aid outside the world that flags states no world should be in, whatever its place.
Built at foundations-2 phase 5 (decisions, "Foundations-2 phase 5: law 12's flags"). This page is the rule, as
[no-god-view.md](no-god-view.md), [nothing-from-nothing.md](nothing-from-nothing.md),
[everything-is-somewhere.md](everything-is-somewhere.md) and [all-work-takes-time.md](all-work-takes-time.md) are for
theirs.

## The rule

**A flag is a finding, never a target and never a gate.** Nothing in the world reads a flag: no generator, engine,
module or host. A flag goes to the risk register worded "a likely missing law"; it is never a failing test and never a
reason to tune a figure (calibrate mechanisms, not outcomes).

## What is flagged

`oikos flags <batch>` (`measure/src/flags.ts`) reads a run's measurement tables, as every measure does, and every batch
writes `flags.txt` and `flags.json` beside its runs. Each flag has the run, the moment, what it is, and what it rests on
(`rests_on`: the modules whose acts made it, the law, form, office, agreement or account it is about).

| Kind | Flagged when | Judged on |
|---|---|---|
| `stampede` | at least half the people in the town left it in one month; at least half signed a new agreement of one kind (a job, a lease, a membership) in one month | months, where ten or more could |
| `freeze` | a kind of agreement the town opened with that nobody made again | a run of a year or more |
| `dead_law` | a law no paper of the run cites; a form never filled in; an office that did nothing | a run of a year or more |
| `physics` | an account outside the edges below nought; an organisation's balance, or the town's money outside the edges, that grew month after month without levelling (it rose in four months of five, its last third grew at least as fast as its first, and it ended at least twice where it began) | each transfer; months, on a run of six months or more |

The thresholds are the run's own (shares of its own people, its own course), stated once in `flags.ts` with their
reasons. They are conventions, not any place's figures.

## The backstop

`orchestrator/test/flags-only-flag.test.ts` (fast tier) fails if any world-running source reads the flags or what they
write, and plants a log of each broken state (a month in which most of the town leaves, an account taken below nought
and paid more each month, a kind of agreement nobody makes again, a law nobody cites, a form nobody fills in, an office
that never acts): each must be flagged, with what it rests on. `everything-is-somewhere-runs.test.ts` (slow tier) flags
a month of every profile's plain town: none may be raised.

## What it cannot see

Holdings of goods, water and energy: what flows on a network is state, not an act, so the log does not carry it, and a
holding below nought outside an edge is refused by the kernel itself (law 8). Routes nobody uses (link flows are kept a
day, for whoever looks, not logged). A law's condition: a law is flagged as dead when no paper cites it, which is what
the log can show; a law that is obeyed without anyone citing it looks the same.
