# Weighing the commute in job and home choices (risk WM-4)

2026-11-01, branch `commute-choice`. A design note written before the code, as market-realism.md was. **Status (2026-11-02): built**, as
docs/behaviour/commuting.md describes (one departure: the hours go into money only, docs/decisions.md 2026-11-02) (WM-4); how a person knows a trip's time is settled (below),
and it is built on foundations-2 S3 (`f2-s5`). docs/decisions.md, "Weighing the commute".

## The fault

With several towns and real roads (foundations-2 phase 3, branch `f2-s5`), 52 of 84 hires crossed towns. Job postings and
homes to let are seen everywhere, and the choice between them (`citizen/work.rs` `look_for_work`, the mind's `job`
decision; `citizen/housing.rs`, its `home` decision) weighs pay, hours and rent, never the trip between home and work.
A person takes a job an hour's drive away for a few dollars more a fortnight, which people do not.

## The law (behaviour, with sources)

Each option in a job or home choice carries the trip it implies between the home and the place of work, as a cost in
the person's own terms, and the mind weighs it as it weighs anything else (no rule refuses a far job or home):

1. **Time.** The commute's hours a month (the round trip times the working days a month the job asks) go into the
   option's `time_hours_per_month`, the mind's existing term for hours out of one's own time, unpaid. Its money worth to
   the person is a share of their own wage: about half the wage for commuting in the appraisal literature and practice
   (Small 2012, the review; the US DOT's guidance and the UK's TAG A1.3 value commuting time at about half of income per
   hour: all to confirm). That share (`commute_time_bps`) is a profile figure with its source, since appraisal values are
   national; no default in the module.
2. **Money.** What the trip costs: by a vehicle the household has, its running cost a kilometre (fuel and wear: a
   profile figure; once foundations-2 S5 gives vehicles their energy from holdings, what the trip actually uses); on
   foot, nothing. It goes into the option's `money_per_month`, negative.
3. **Why this and not a distance rule.** People trade pay against commuting: they accept longer commutes only for more
   pay or cheaper housing, and the compensation found is less than full (Stutzer and Frey 2008, "the commuting paradox";
   Manning 2003 on commuting costs as a source of employers' wage-setting power; van Ommeren, Rietveld and Nijkamp 1997
   on job and residential moves as joint search over commuting: all to confirm). The mind's weighing of time against
   money gives that trade; nothing here sets how far anyone goes.

## What a person knows of a trip (no god's view; settled 2026-11-01 by the coordinating session)

Never a straight line, never the network's whole timetable, and **no participant-API addition**. On `f2-s5`
(foundations-2 S3 to S6, landing on main) a person on the way sees it in their own body: `BodyView.on_way {to, arrives}`
(`kernel/crates/perception/src/observe.rs`), and the citizen already waits on it (`person.rs`, `lifecycle.rs`). So:

- **Their own trips.** When a person sets out (the act that moves them, from the structure they are in), they note
  where from and when; when they see themselves on the way they read `to` and `arrives`, and keep the trip's seconds
  (`arrives` less when they set out) in a bounded memory of their own, by the pair of structures, either way round, the
  latest time kept. The commute of a job they hold, or of a home and work they have travelled between, is that.
- **What they are told or can see published:** a posted timetable, where the world publishes one (a public service's
  timetable is published, as any statement is); none exists yet, so this is the hook, not a source today.
- **Otherwise they do not know it**, and the option carries no commute term (never a guess). A first hire across towns
  can therefore still happen; the commute then counts from the first trips, in the monthly job search (a job nearer, at
  pay net of the commute) and in the home search (a home nearer the work).

## Figures, per place (to source in the profiles, each with its source; WM-4)

| Profile | Value of commuting time | Vehicle cost a kilometre |
|---|---|---|
| au-vic (WM-4) | ATAP (Australian Transport Assessment and Planning) guidelines, PV2 (to confirm) | ATAP PV2 vehicle operating costs (to confirm) |
| gb-eng (WM-4) | DfT TAG data book, table A1.3.1 (to confirm) | DfT TAG data book, A1.3.13-14 (to confirm) |
| us-oh (WM-4) | USDOT, revised value of travel time guidance (2016) (to confirm) | AAA, "Your Driving Costs" (to confirm) |
| others (WM-4) | PLACEHOLDER, labelled | PLACEHOLDER, labelled |

## What is left to build (WM-4)

1. On `f2-s5` or main once it lands: the citizen's trip memory, filled from its own departures and `on_way`, bounded,
   in the person's saved state.
2. The commute term in `look_for_work` (each employer's posting by its place of work: a producer's `workplace`; a
   shop's and an office's to check) and in the home choice (`housing.rs`, the `home` decision), as `time_hours_per_month`
   and a negative `money_per_month`.
3. The two figures as profile fields, through the generator to the citizen's params (with the manifest), no module
   default.
4. Behaviour doc (citizen.md or a new `docs/behaviour/commuting.md`), references, decision entry; state hashes re-taken
   with the reason if they move.

## Tests that will guard it (lean)

- A citizen choosing between two postings at equal pay, one a known long trip away, the other near: the near one is
  chosen more often (the mind's draw; a seeded test over a fixed set of draws), and with the time share at 0 the two are
  equal (the term is the only difference).
- A posting at a place never visited and never travelled to is weighed without a commute figure, never with a
  straight-line one (`no-god-view` backstop: the person's memory of trips is filled only from their own outcomes and
  visits).
