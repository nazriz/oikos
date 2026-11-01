# Weighing the commute in job and home choices (risk WM-4)

2026-11-01, branch `commute-choice`. A design note written before the code, as market-realism.md was. **Status: the rule
is specified here; the code is not built on this branch** (WM-4), because what a person can know of a trip's time is not yet
something the world tells them on `main` (below, "What it needs"). docs/decisions.md, "Weighing the commute".

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

## What a person knows of a trip (no god's view)

Never a straight line, never the world's path-finder read for them. A trip's time is known in two of the four ways:

- **They made it** (their own trips): each trip a person makes, the time it took over the roads as they went (the
  kernel's `travel::seconds`, by the mode they went by), kept in a bounded memory of their own, by where they went.
  The commute of a job they hold is what their own trips to it take.
- **They went to look** (a visit, docs/design/knowing.md): someone weighing a posting or a home at a place they have
  never been to goes to see it, which takes the real trip there and back (`sites::visit_seconds`, over the roads), and
  learns its time by having made it. A visit costs their time, so it is made for the options that are worth it (the
  best-paid few, as the search shows them: `search_limit`), and a place not visited is weighed as unknown, with the
  mind's ordinary caution about what it has not seen.

## What it needs (why it is not built here; WM-4)

1. **A traveller's own trip time on their act's outcome** (contract addition, participant API `Outcome`: an optional
   `trip: {to, seconds}`, seen only by the one whose body went, as `investigated` and `surveyed` are). Today the kernel
   charges the trip in `begin` (`kernel.rs`) and tells nobody how long it took. This is a contract change, for Naz's
   sign-off; with foundations-2 S3 (bodies in transit, on `f2-s5`) a person may instead see their own departure and
   arrival, and the addition may be unnecessary. Settle which once `f2-s5` lands, so the two do not collide.
2. **A visit to a posting's place**: the posting must say where the work is (a structure), which a producer's posting
   does through its `workplace`; a shop's and an office's need checking.
3. The profile figures above (`commute_time_bps`, a vehicle's running cost a kilometre), each with its source, in
   `worlds/profiles/`, never as module defaults.

## Tests that will guard it (lean)

- A citizen choosing between two postings at equal pay, one a known long trip away, the other near: the near one is
  chosen more often (the mind's draw; a seeded test over a fixed set of draws), and with the time share at 0 the two are
  equal (the term is the only difference).
- A posting at a place never visited and never travelled to is weighed without a commute figure, never with a
  straight-line one (`no-god-view` backstop: the person's memory of trips is filled only from their own outcomes and
  visits).
