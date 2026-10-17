# Risks: the platform's risk register

Naz, 2026-10-17: "it's ok to have gaps, so long as we catalogue them and understand them, almost like a risk
register"; and look for "any assumptions we've made that are incorrect".

This page is **the single place gaps live**. Each entry is a gap, a placeholder, a limit or an assumption that could
bias what a steward experiment finds, with what it could do to results and what would make us fix it. The decisions
log (`docs/decisions.md`) keeps the reasoning of each change; this page keeps what is still open. `docs/gaps.md` is
the history of the first pilots' gaps (nearly all closed) and is not added to any more.

Built 2026-10-17 from a sweep of: the decisions log; `docs/handover.md`; `docs/behaviour/*.md`; `docs/design/*.md`;
`docs/measurement.md`, `calibration.md`, `reliability.md`, `scenarios.md`, `no-god-view.md`; the profiles and
`docs/profiles.md`; the profile source-check reports of 2026-10-16; the pilot reviews in `runs/pilot-queues/`
(`wave-2a` to `2c`, `living-1` to `living-7b`); and the review of the foundations (`runs/review-foundations-2026-10-16.md`).
Statuses were checked against later entries of the log by search, not by reading every entry: an item marked open may
have been mended under other words. Correct it here when you find that.

## Summary: the five risks most likely to bias a steward experiment

1. **Too few runs to tell a steward from chance.** Every pilot so far is one town, one run, one seat; a live seat
   has no exact twin (it keeps its own hours, and its office makes papers the twin's does not); the noise estimate
   comes from three runs of one town. Today any seat-against-twin difference is an anecdote. (MT-1, MT-2, MT-3, SC-4)
2. **The translator stands between the seat and the world.** Our translator is right on 155 of 180 real requests
   with 4.4% confidently wrong; seats confirm most wrong drafts; accuracy differs by seat model and by place. Part of
   what a seat "did" was drafted, and a seat that cannot get an act through looks passive. (TR-1 to TR-3, SF-1, SF-3)
3. **The baseline is a set of unsourced rules.** The code mayor, a code council that votes on one line, and a code
   tribunal member harsher than au-vic's own law are what a seat is compared with; a difference measures distance
   from those rules, not from a real office. (MT-12, PB-14, PB-3)
4. **Outcomes built in that move whatever the steward does.** The paper prints only bad news for the government;
   rents ratchet 5% at each review; strikes are always won in full; business births run at a set rate and employing
   start-ups cannot happen; exports are fixed at the start; compliance is a coin flip. (PC-7, ME-14, PB-9, ME-1,
   ME-15, PB-16)
5. **How long work takes is guessed.** Every act time is a placeholder in minutes and a system takes one second;
   staff counts and grants are state averages applied to a small town. Delays, backlogs and any comparison of people
   with systems rest on these. (WM-1, PB-6, PS-10)

Close behind: placeholders shared by all nine profiles that make places look alike or different for the wrong reason
(PS-1, PB-1); possession cases in which the tribunal has no real choice (PB-3); words a seat writes that nobody reads
(PC-1).

**Counts (2026-10-17):** 111 risk entries and 3 planned. World mechanics 13, markets and economy 17, public bodies and law 18, people
and culture 14, seats and framing 13, translator 6, measurement and twins 15, profiles and sources 10, performance and
scale 5. Assumptions audit: 31, of which 8 are outcomes built in.

## How to use this page

- **Before an experiment:** read the summary and the area of the offices you will seat. Each entry with high impact
  in that area must be named in the experiment's plan, with how the design avoids it or how the result is qualified.
- **When you find a gap:** add an entry in its area with the next number (ids are never reused). One or two plain
  sentences for the gap; then where it lives, what it could do to results, likelihood and impact, how we would
  notice, status and what would make us fix it.
- **When you fix one:** set its status to `fixed (date, decisions entry)` and leave it in place for a release; remove
  it at the next sweep. Never delete an entry silently.
- **Status words:** `accepted` (a known limit we live with, said in results); `to fix` (a fault or missing mechanism);
  `to source` (a figure with no real source, or the wrong one); `fixed`. **L / I** is likelihood that it bites an
  experiment, and impact if it does: low, medium or high.
- **Areas and prefixes:** WM world mechanics; ME markets and economy; PB public bodies and law; PC people and culture;
  SF seats and framing; TR translator; MT measurement and twins; PS profiles and sources; SC performance and scale.
  The assumptions audit is its own section at the end (ids `A`), each linked to the register where it has an entry.

## Keeping it fresh (the working rule, 2026-10-17)

Naz: keep it updated and fresh, and "bonus if we can mitigate the risks as we go". Two rules, and a mechanism that
makes the first one hard to forget.

1. **A change that touches an entry's "where" updates that entry** in the same commit: its status, its evidence, or
   a line saying it was looked at and still holds. A change that closes a gap sets the status to
   `fixed (commit abc1234)` or `fixed (decisions 2026-10-17, <entry title>)`, takes the id off the markers in the code
   and docs it fixed, and leaves the entry for a release.
2. **Whoever works in an area first fixes the cheapest open risks there**, if they are mechanism faults with a
   real-world basis (not data sourcing, not what the owner has parked). Say so in the decisions entry.

The mechanism:

- **`orchestrator/test/risks.test.ts`** (fast tier) fails the build when: a gap marker (`(to confirm)`, `placeholder`,
  `not built`, `known gap`, `untraced`, `left unfixed`) in `docs/` or `worlds/profiles/` has no register id on its line
  or in its paragraph and sits in a file that `docs/risks-markers.json` does not count (or the file has more
  untagged markers than counted); a `TODO(risk)` in code has no id; any id named anywhere is not in the register; an
  entry lacks a field (what, where, effect, L / I, status, notice by, fix when); an entry is `fixed` without naming its
  commit or decisions entry, or a marker still names it. **A new gap therefore needs a register entry first**, then
  its id on the marker: `placeholder (ME-14)`. In code, write `// TODO(risk ME-14): what is missing`.
- **`docs/risks-markers.json`** counts the markers of older files by file (with the ids their entries are under):
  `docs/decisions.md` (the log), `docs/research/references.md` (its own "(to confirm)" convention) and `docs/gaps.md`
  are exempt. Tag a marker with an id and lower its file's number; the report says where there is slack.
- **`bun scripts/risks.ts`** prints entries by status, the five top risks (likelihood times impact, open before
  accepted), the oldest open entries by `git blame` of the entry, the entries whose "where" files changed since the
  entry was last touched (likely stale), and the marker-list slack. `--md [FILE]` writes it as Markdown to paste.
  `--touched [REF]` lists the entries whose "where" a branch touched since REF (default `origin/main`); put it in the
  merge routine so the maintainer sees what to update (`scripts/merge.ts` prints it when it is on main).

---

## World mechanics

### WM-1 · Act times are placeholders throughout
- **Gap:** Every row of the table of work (`WORK_TIME`: a benefit decision 20 minutes, a tribunal order 45, a loan
  decision 30, a letter, a vote) is a placeholder. The source check of 2026-10-16 opened nothing that replaces any:
  the nearest sources are whole-case handling times, several hours a case. No profile overrides a row.
- **Where:** `worlds/generator/generate.ts` (`WORK_TIME`); `values.work_time` (unused in all nine profiles).
- **Effect:** All office throughput, backlogs and days-to-decision. Decision rows are probably too short (a benefit
  decision perhaps eight times too short), so offices clear queues too fast and the cost of a person doing the work
  is understated. The ratio of a person's seconds to a system's is the whole gain of automation, so it sets any
  gradual-disempowerment result. Seat and twin share the table, so their difference is safer than absolute figures.
- **L / I:** high / high · **Status:** to source
- **Notice by:** days-to-decision against a place's real waits; a result that changes when the table is scaled 2 to 4 times.
- **Fix when:** before any result is read in absolute time or cost, and before any automation or adoption experiment.

### WM-2 · Mechanisms that do not bind (crime, pollution, water, clinic)
- **Gap:** Several mechanisms run on placeholders sized so that they hardly act: theft is a rare chance (200 bps a
  month for someone in need where goods are kept); pollution makes nobody ill; the river never restricts water, even
  in a dry year; the clinic is about 1% used because only hospital-level illness exists; crime does not rise in a slump.
- **Where:** profiles (`crime`, `nature`, `services`, hazards); `docs/scenarios.md` ("Inert"); `docs/behaviour/health.md`, `crime.md`.
- **Effect:** An experiment on policing, environmental stewardship, water or health gets a null result from a dead
  mechanism, and a steward who does nothing looks as good as one who does well. Pollution decisions look costless to health.
- **L / I:** high / high (for those offices) · **Status:** to source
- **Notice by:** a scenario whose runs match the plain town (`oikos scenarios` marks them `inert`); an office never asked to act.
- **Fix when:** a steward experiment seats the police, environment, water or clinic office.

### WM-3 · The weather bureau is never wrong
- **Gap:** The bureau is handed the run's actual weather and warns a fixed number of days ahead with no misses and no
  false alarms. The world market's shocks are scripted and published by nobody.
- **Where:** the bureau boundary module; `docs/behaviour/boundary.md`, `weather.md`.
- **Effect:** Flood and heat experiments give seats perfect foresight; preparedness looks easier and cheaper than it is.
- **L / I:** high (in hazard scenarios) / medium · **Status:** to source (hit and false-alarm rates)
- **Notice by:** warning lead time and false-alarm rate are 0 by construction.
- **Fix when:** a hazard scenario is used in an experiment.

### WM-4 · Transport and distance are free
- **Gap:** Goods move instantly, a crew works from its depot with no travel, and a person is not anywhere between places.
- **Where:** `docs/design/phase-b-production.md` §7; `docs/design/foundations.md` §3.2 ("a liberty for now").
- **Effect:** Siting, logistics, flood cuts and access to services have little effect; spatial policy is understated.
- **L / I:** medium / medium · **Status:** accepted
- **Notice by:** A transport or distance scenario shows no effect; a place's real commuting or delivery times differ widely from zero.
- **Fix when:** an experiment on siting, roads or access to services.

### WM-5 · Asking a directory is free and at once
- **Gap:** Who-is-this and directory look-ups (`bank.payment_system` `who`) are answered at once and for nothing;
  questions to a register's keeper take the keeper's time (since the foundations' review) but cost no fee, and nothing
  counts how many asks a seat makes, so a seat could rebuild a whole register by asking.
- **Where:** `docs/behaviour/knowing.md` ("Leaves out"); `docs/no-god-view.md` ("What nothing can see").
- **Effect:** Seats gather information more cheaply than real officials; biases seat performance upward in offices with a wide remit.
- **L / I:** medium / medium · **Status:** accepted
- **Notice by:** asks per seat per week in the log.
- **Fix when:** a pilot shows hundreds of asks in a day, or a seat is given a wide remit.

### WM-6 · Deaths that nobody reports
- **Gap:** A death outdoors leaves no trace and is never registered; someone alone at work is found by nobody (an
  employer who misses a worker calls nobody); the finder's delay for a person living alone is Japan's figure from a press summary.
- **Where:** `docs/behaviour/deaths.md` ("Leaves out"); decisions 2026-10-17 "The seated twin on fix-housing, and deaths at work".
- **Effect:** Small but systematic: estates, vacancies and population counts lag. gb-eng went from 5 to 3 unregistered of 14 in a year after the last fix.
- **L / I:** medium / low · **Status:** accepted
- **Notice by:** Deaths at work in the log against a place's recorded workplace deaths; a body found by nobody.
- **Fix when:** an ageing or civil-register experiment.

### WM-7 · Bodies on their own account can lose their last staff for good
- **Gap:** The council's appointments officer refills public posts, but a bank, union, paper, shop or letting office
  whose last staff member dies has nobody to appoint a successor (no owner's or member's office). A question to a keeper nobody staffs waits for ever.
- **Where:** `docs/behaviour/staffing.md`; decisions 2026-10-16 "Foundations: the review's findings fixed" item 6 and 2026-10-17 "Four faults" (six letting offices and shops' deputies vacant at year end, gb-eng seed 1).
- **Effect:** In long runs a firm or institution can silently stop. Resilience and service measures fall for a reason that is not anyone's decision.
- **L / I:** medium (long runs) / medium · **Status:** to fix
- **Notice by:** posts vacant at the end of a run; held questions never taken up.
- **Fix when:** any run past a year, or a body on its own account goes headless in a pilot.

### WM-8 · Migration rates are placeholders
- **Gap:** Who comes and goes follows a Harris-Todaro rule whose response and outside income are placeholders. People
  leave only when they fail (90 days without a home, or 180 days jobless and broke) and arrive only for postings; the
  ordinary moves of a regional town (study, partners, retirement, amenity) are missing. Towns have shrunk and "go still after a year".
- **Where:** profile `migration`; `docs/behaviour/citizen.md`.
- **Effect:** Population, housing pressure and labour supply drift for reasons unrelated to the steward; long runs most exposed.
- **L / I:** high / medium · **Status:** to source
- **Notice by:** net migration and population at year end against the place.
- **Fix when:** a housing, wage or shock experiment where population change matters.

### WM-9 · A waste backlog nobody explained
- **Gap:** In living pilot 7a waste complaints rose from 29 to 1,090, with 1,074 in the code twin: the town's own
  backlog, not the seat's. A 17-day wait for an actor to be free was seen in both. Neither was traced.
- **Where:** `city.works`, the hired crew; `runs/pilot-queues/living-7a.review.md`.
- **Effect:** A mayor's lever over works may show no effect because the mechanism is saturated.
- **L / I:** medium / medium · **Status:** to fix (trace it)
- **Notice by:** Waste complaints per resident by month against the twin; the complaint count reaching the hired crew's capacity.
- **Fix when:** a mayor or works experiment.

### WM-10 · Repeal does not reach those who read the law; new kinds of binding law cannot be made
- **Gap:** A law repealed without a replacement is still taken as in force by landlords, tenants, the union and the
  tribunal (their books show laws, not withdrawals). A law of a new kind that binds (a rent cap, a winter ban on
  evictions) cannot be made: code participants only follow the laws they were built to read. Amending an existing
  schedule does work (the council's amendment chain, 2026-10-16).
- **Where:** `docs/behaviour/government.md` ("Leaves out"); `docs/design/ai-citizens.md` 2e.
- **Effect:** A steward that deregulates, or legislates something new, gets no effect; the steward looks ineffective
  and the twin shows nothing. This caps the most interesting kind of policy experiment.
- **L / I:** medium / high · **Status:** to fix
- **Notice by:** compliance with a repealed law after repeal; a new law with no reader.
- **Fix when:** an experiment where a seat can legislate.

### WM-11 · Disrepair runs on a clock, and upkeep repairs nothing
- **Gap:** Disrepair arises at a fixed rate whatever the building or landlord; landlords spend 20% of rent on "upkeep
  bought from outside", which leaves town and lowers no disrepair.
- **Where:** `docs/behaviour/frictions.md` ("What goes wrong"); `firms.md` ("Owners' spending").
- **Effect:** Housing-quality and landlord-conduct experiments cannot work; grievances are pinned to a survey.
- **L / I:** high / medium · **Status:** to fix
- **Fix when:** Before any housing-quality or landlord-duty result is read; a place's repair law is added as data.
- **Notice by:** disrepair independent of landlord character or spending.

### WM-12 · Water and energy use do not respond to anything
- **Gap:** Use does not respond to price, restrictions or hardship; no disconnection. Who pays the water bill (the
  owner) is Victorian practice written into the module, not a profile's.
- **Where:** `participants/src/behaviour/utilities.ts`; `docs/behaviour/utilities.md` ("Leaves out").
- **Effect:** A drought policy or tariff changes no demand; renters' budgets are wrong in places where tenants pay water (England, Germany).
- **L / I:** high / medium · **Status:** to fix (who pays as law data; a demand response with a source)
- **Notice by:** Water or energy bills in a drought or price shock with no change in use.
- **Fix when:** Before a scenario of utility prices, rationing or disconnection; who pays the bill is law data first.

### WM-13 · Heat adds illness evenly across ages
- **Gap:** `heat_illness_bps_per_unit` (100 in all nine profiles) adds the same points at every age, so a young
  adult's relative risk rises more than an old person's; the 2009 Victorian heatwave it cites hit those over 75.
- **Where:** `docs/behaviour/weather.md` "Heat and illness".
- **Effect:** Heat-and-health or cooling-policy experiments; the age pattern is reversed.
- **L / I:** medium / medium · **Status:** to fix and to source
- **Notice by:** Illness by age in a heat wave against a place's heat-health record (older people should be worse hit).
- **Fix when:** When a heat scenario is run; a sourced age gradient replaces the flat figure.

---

## Markets and economy

### ME-1 · Business births are a set rate, and employing start-ups cannot happen
- **Gap:** Starting a business is a monthly chance derived from the profile's business birth rate, not a response to
  a profit opening; only businesses of one can start (a new employing firm would need to buy a closed firm's premises,
  as commercial leasing is not built). A business of one never takes on its first employee.
- **Where:** `docs/behaviour/entry.md` ("Starting a business of one", "Employing start-ups wait on leased premises").
- **Effect:** Job creation cannot emerge from entry. Any experiment where a steward's policy should create or destroy
  jobs is biased towards stasis or displacement; the number of births is fixed by the profile whatever the steward does.
- **L / I:** high / high · **Status:** to fix
- **Notice by:** `economy/businesses`: no employing firm is born in a run.
- **Fix when:** before any employment-effect or gradual-disempowerment experiment.

### ME-2 · Hiring is too easy and churn is wrong
- **Gap:** Employers "hire anyone, whatever their trade", choosing at their next wake; job changes run about 13% a
  year against 7.2% sourced; unemployment sits low (1 to 2% where the target was 4.6%); business deaths 2.9% against
  13.9%. A 21-day posting window was tried and reverted.
- **Where:** firm staffing in `participants/src/behaviour/firms.ts`; `docs/calibration.md`; decisions "Hiring that takes time: tried, and reverted".
- **Effect:** Labour-market, wage, support-claim and re-employment results are biased towards quick matching;
  displacement looks cheaper than it is.
- **L / I:** high / high · **Status:** to fix (the mechanism: matching by trade, postings that close)
- **Notice by:** hires, time to fill, job-change and business-death rates against `calibration.md`.
- **Fix when:** before a labour-market steward study.

### ME-3 · Redundancy rules rest on invented parameters
- **Gap:** A firm adjusts staff on a 3-month horizon with a hire costing 8 weeks' pay, the same in every profile, with
  no source. Redundancies were 3 to 5 times the sourced rate; in Victoria now 1.1 to 4.1% against 1.8%; Nakuru has no
  sourced rate. A shop spends itself down to the level at which it lets people go.
- **Where:** `LabourPlan`; `employment.adjustment` in every profile; `docs/behaviour/firms.md`.
- **Effect:** Job loss and shock resilience, the same everywhere by construction.
- **L / I:** medium / high · **Status:** to source
- **Notice by:** redundancy notices as a share of those in work, by profile.
- **Fix when:** a labour or shock experiment.

### ME-4 · Shops buy stock for cash
- **Gap:** Shops pay cash for stock; trade credit exists only from a factory, and only in the two profiles with
  `business.trade_credit_days` (a placeholder there). Real shops buy on credit. Many lay-offs "for want of money" follow.
- **Where:** `docs/behaviour/trade.md`, `firms.md`; decisions 2026-10-11 "Next on the firm side".
- **Effect:** Too many failures and lay-offs in cash-poor towns; biases lending, small-business and recession experiments.
- **L / I:** medium / medium · **Status:** to fix (owner's next item on the firm side, 2026-10-11)
- **Notice by:** Shops' cash falling at each restocking; shop failures at the start of a run with no sale to blame.
- **Fix when:** a lender or business-support experiment.

### ME-5 · Shops all start alike, and demand swings
- **Gap:** Every shop of a kind opens alike; trade becomes uneven and stays so (geography explains a tenth to a
  quarter); a shop's month-to-month sales swing, and in some seeds unmet demand climbs over a year (not traced).
- **Where:** generator shop opening; decisions 2026-10-13 "Shops sized by catchment"; slump entries.
- **Effect:** Seed-dependent shortages and lay-offs add noise to any contrast; goods availability is fragile.
- **L / I:** medium / medium · **Status:** accepted
- **Notice by:** Spread of shop sales by shop at day 30 against day 360; one shop taking most trade.
- **Fix when:** an experiment reads goods availability or runs past 90 days.

### ME-6 · Who owns firms is a placeholder
- **Gap:** Shares held outside the town (80% of factories, 20% of shops, 30% of landlords) are placeholders; no
  source for a regional town's ownership was found.
- **Where:** `firm_ownership` in profiles; `docs/behaviour/firm-ownership.md`.
- **Effect:** How much profit leaves town sets local demand, inequality and saving.
- **L / I:** high / medium · **Status:** to source
- **Notice by:** Share of firm profits leaving the town against a place's ownership data.
- **Fix when:** an inequality or local-economy experiment.

### ME-7 · Tenants never move while housed; rent tolerance is a placeholder
- **Gap:** A household keeps its home while rent is at most half its income (`rent_bearable_share_bps`, a
  placeholder), then gives notice and only then hunts. Nobody looks for a cheaper or better home while housed.
  Households take the dearest home they can afford (rent stands in for quality), and owners never move house.
- **Where:** `docs/behaviour/citizen.md` ("A rent increase", "Leaves out"); `ownership.md`.
- **Effect:** Tenants are too inert under rent rises; landlords too safe; space per person overstated. Biases rent
  regulation and housing-supply experiments.
- **L / I:** medium / high · **Status:** to fix
- **Notice by:** Moves of housed households after a rent rise: none while the rent stays under the threshold.
- **Fix when:** a rent or housing experiment.

### ME-8 · Credit: no lending in the first quarter, no limit on the bank's funding
- **Gap:** The bank lends against the least balance over three months, so nobody can borrow in a run's first quarter,
  and it draws funding from outside without limit, so no credit squeeze can happen.
- **Where:** `docs/behaviour/credit.md`; decisions "Why no loan" and the scenarios entry.
- **Effect:** Business entry, rescue of failing firms, and any finance or lender steward; credit shocks do nothing.
- **L / I:** medium / medium · **Status:** to fix
- **Notice by:** Loan decisions and the bank's balance in the first 90 days of a run: none granted.
- **Fix when:** a lender seat or entry study.

### ME-9 · Informal work: a fixed share of each employer's jobs
- **Gap:** Every employer registers the profile's share of its own jobs, so none is wholly formal or informal; one
  share for all kinds of employer; traders split half and half between pitch and home (a placeholder); no inspector.
- **Where:** `compliance` fields; `docs/design/profile-depth.md` track F.
- **Effect:** Labour-law enforcement experiments see a uniform compliance real towns do not have.
- **L / I:** medium / medium · **Status:** accepted ("for Naz")
- **Notice by:** Informal share by employer: all alike; a place's informal workers concentrated in a few firms.
- **Fix when:** an inspector is built, or a labour-law experiment.

### ME-10 · Hours before heads is built but untested where it matters
- **Gap:** Firms cut hours before staff with workers' consent at 9,000 bps everywhere (no source); everyone at the
  firm is cut; neither measured town has wages between rent and rent plus essentials, so the path from partial income
  loss to arrears has never been shown to matter.
- **Where:** `docs/behaviour/firms.md` "Hours before heads"; `employment.hours` in profiles.
- **Effect:** Short-time work and tribunal leniency experiments may find nothing, untested rather than disproved.
- **L / I:** medium / medium · **Status:** accepted
- **Notice by:** Hours cut per firm against heads cut in a downturn; consent granted in every case.
- **Fix when:** the first tribunal or housing experiment that turns on partial income loss.

### ME-11 · Scenario sizes and opening balances are unsourced
- **Gap:** The town's opening balance (about nine days' spending), firms' balances and the size of each scenario's
  shock have no source; "lean council" means different things in different profiles.
- **Where:** `worlds/scenarios/`; profiles' opening balances.
- **Effect:** A shock experiment measures an invented shock.
- **L / I:** medium / medium · **Status:** to source
- **Notice by:** Opening balances against a place's household and firm accounts; a scenario's size changing a result when doubled.
- **Fix when:** a shock experiment.

### ME-12 · One profile's conventions left in behaviour code
- **Gap:** Fortnightly shopping and 14 days' notice whatever the pay period; loan sums rounded to fixed units;
  helper names and some defaults from the first profile.
- **Where:** `participants/src/behaviour/*`.
- **Effect:** Towns in other currencies and pay rhythms behave with the first profile's habits; biases cross-place comparisons.
- **L / I:** medium / low · **Status:** to fix (as found)
- **Notice by:** A second profile with a different pay period or unit shows the same notice, shopping or rounding.
- **Fix when:** a profile's town turns on one of them.

### ME-13 · One kind of consumer good, no services sold to households
- **Gap:** Households buy goods only (Lengnick's single good); rides, repairs and services have no customer; a
  business that makes what it sells is not built.
- **Where:** `docs/behaviour/entry.md`; `docs/design/phase-b-production.md` §7.
- **Effect:** Demand shocks and service-sector employment are thin; most of the real economy of a small town is services.
- **L / I:** medium / medium · **Status:** accepted
- **Notice by:** No household spending on services in the log; a service firm with no customer.
- **Fix when:** an experiment on local demand or services.

### ME-14 · Rents ratchet up at every review
- **Gap:** At each review (as often as the law allows) a landlord sets rent to the mean of like homes in the same
  building plus 5% (`markup_bps`), or to the home's own rent plus 5% where there is none; rents are never lowered for a
  sitting tenant. The landlord's own rents are its reference, so each review raises the next.
- **Where:** `participants/src/behaviour/firms.ts` (rent review, about line 685); `generate.ts` (review period); `docs/behaviour/firms.md` "Rent reviews".
- **Effect:** Rent inflation decoupled from vacancy is built in; rent stress, arrears, notices and petitions grow
  over long runs whatever the steward does, and rent caps look more effective than they would be.
- **L / I:** high / high · **Status:** to fix (the reference should be the market: new lets and vacancy)
- **Notice by:** yearly rent growth in a code-only town against the profile's rent index.
- **Fix when:** before any run past a year or any housing experiment.

### ME-15 · The town's exports are fixed at its opening output
- **Gap:** World demand for the factories' goods is set to what their opening staff make less the town's own
  purchases, as a fixed quota split among the factories that exist at the start; a new factory cannot export.
- **Where:** `participants/src/behaviour/world.ts`; `docs/calibration.md` "Chosen, not sourced"; `boundary.md`.
- **Effect:** The employment base is pinned; development policy cannot raise it; job losses come only from inside.
- **L / I:** high / high · **Status:** accepted (a boundary), to revisit
- **Notice by:** Factories' sales to the world constant across a run whatever the town does.
- **Fix when:** an experiment on growth, competitiveness or firm entry.

### ME-16 · Prices and payouts follow one stylised macro model
- **Gap:** Firms price within 2.5 to 15% over cost and change price or wage monthly by Lengnick's (2013) rules, built to
  produce aggregate cycles, not fitted to firms; earnings above a small buffer are paid out monthly, so firms hold
  little cash. A failed firm pays debts oldest first: wages owed do not rank ahead of trade debts as in real insolvency law.
- **Where:** `participants/src/behaviour/lengnick.ts`, `retailer.ts`, `producer.ts`; `docs/behaviour/insolvency.md`.
- **Effect:** Firms are fragile (a likely cause of ME-2 and ME-3); no gouging, monopoly pricing or deep discounting;
  workers lose more when firms fail.
- **L / I:** high / medium · **Status:** to fix (mechanism, not a target)
- **Notice by:** Price and wage paths against a place's inflation and wage growth over a year.
- **Fix when:** When prices or wages are what a study measures; replace by a mechanism with a source.

### ME-17 · Incomes, jobs and savings are drawn independently
- **Gap:** One wage per kind of work; who is in work and who has savings are separate draws per person, unrelated to
  household, age or each other; households do not pool money ("nobody supports anybody").
- **Where:** `worlds/generator/generate.ts` (labour force and savings draws); `docs/behaviour/households.md`.
- **Effect:** Inequality compressed and hardship falls on random households; redistribution and support-targeting experiments are wrong in both who and how much.
- **L / I:** high / high · **Status:** to fix
- **Fix when:** Before any study of inequality, poverty or who is hit by a shock; sourced joint distributions (income, job, savings).
- **Notice by:** income Gini and jobless-household share against the census.

---

## Public bodies and law

### PB-1 · A tribunal's time is often the wrong quantity
- **Gap:** One `tribunal_days` serves rent possession and wage or goods claims, and in several profiles it is another
  venue's or another measure's: gb-eng 252 days is the Employment Tribunal's mean (used for rent); de-ni 164 is a time
  to disposal, not to hearing; in-tn 90 is a statutory ceiling (real courts far slower); jp-akita 81 is the Labour
  Tribunal's; ke-nakuru 53 is the Small Claims Court's; br-mg and mx-jal keep the 42-day placeholder.
- **Where:** `frictions.venues.tribunal_days`, `tenancy.possession` in each profile; decisions 2026-10-16 "Profile source check".
- **Effect:** Eviction counts differ between profiles because of where a figure was taken from: gb-eng's change cut
  possession orders from 6 to 1 a year. Cross-place comparisons of possession are not valid.
- **L / I:** high / high · **Status:** to fix (a time and fee by venue) and to source
- **Notice by:** Days to a tribunal order against the place's real wait; the same days for rent and wage cases.
- **Fix when:** any cross-place comparison of possession or wage claims.

### PB-2 · Tribunals uphold half of unproven claims, everywhere
- **Gap:** `uphold_without_proof_bps` is 5,000 in all nine profiles with no source anywhere; the tribunal believes what
  parties say they paid; no costs, no appeal of its orders.
- **Where:** `frictions.venues` in profiles; `docs/behaviour/justice.md`, `frictions.md`.
- **Effect:** A built-in outcome for every claim without evidence. Experiments on tribunal fairness or evidence inherit it.
- **L / I:** high / high · **Status:** to source
- **Notice by:** the uphold rate of unsupported claims sits at 50% in every profile.
- **Fix when:** a tribunal seat is studied for fairness.

### PB-3 · The possession path offers a tribunal no real choice
- **Gap:** Almost no tenant in arrears has anything to offer: 56 of 56 lv-05 cases had no answer; lv-06's 3 answers
  were "can pay nothing"; in Nakuru rents outrun wages so arrears are structural; au and gb towns have few cases. The
  answer rate is a 4,000 placeholder in seven profiles; half of tenants staying past notice and England's 59% leaving
  on order are used everywhere.
- **Where:** `tenancy.possession` (`answer_bps`, `stay_past_notice_bps`, `leave_on_order_bps`); decisions 2026-10-13 "Why no tenant in arrears has anything to offer".
- **Effect:** A tribunal seat and its twin both order possession; the experiment reads "the model equals code". The
  cases a seat sees are set by placeholders.
- **L / I:** high / high · **Status:** accepted ("build nothing", 2026-10-13); figures to source
- **Notice by:** zero answers offering a sum, zero plans ordered.
- **Fix when:** a tribunal experiment: use a town whose wages carry its rents, and say so in the plan.

### PB-4 · Appeal and review routes are recalled, not read
- **Gap:** Every route, day and fee of `law-decisions` was recalled and marked "(to confirm)"; low confidence for
  mx-jal, ke-nakuru, in-tn and one br-mg benefit; the planning second look is a placeholder in every profile.
- **Where:** `docs/behaviour/decisions.md`; decisions "Foundations F8".
- **Effect:** Whether and how fast a wrong refusal is put right drives redress measures; an appeals experiment measures an invented route in four places.
- **L / I:** medium / high · **Status:** to source
- **Notice by:** A route in the law fixture that no one can use, or one missing that a place has.
- **Fix when:** an appeals or rights experiment.

### PB-5 · Error rates are fitted or carried from one survey
- **Gap:** A wrong refusal of a benefit is fitted to the first profile's survey share and scaled; wrong bills and
  short pay are a World Justice Project survey share halved; reviews of payments in force are not built.
- **Where:** `slip()` callers; `support.wrong_refusal_bps`; profiles `frictions`.
- **Effect:** All error-based harm measures, and the comparison of a person-run office with a system-run one, rest on one survey.
- **L / I:** medium / high · **Status:** to source
- **Notice by:** Wrong-refusal and wrong-bill counts against the place's audit or appeals figures.
- **Fix when:** an experiment compares error rates across offices or between people and systems.

### PB-6 · Staffing, licences and pay of offices are mostly placeholders
- **Gap:** Public wages are sourced from summaries in seven places; the administration rate is derived in three;
  every system licence price is a placeholder ("a resident a year"); mayor and councillors are unpaid; in a town of
  1,000 three officers hold ten offices. Who appoints a public body's head (`appointed_by`: the council) is a
  placeholder in every profile.
- **Where:** generator; profiles `orchestration`, `public_service`; decisions "Foundations F5" and the review's fixes.
- **Effect:** Office delay comes from staff counts loosely sourced; the price of a system against a person's wage is
  unsourced, and that comparison is what adoption turns on. One death can stall several offices.
- **L / I:** high / high (adoption work) · **Status:** to source
- **Notice by:** Office staff and wages against a payroll; backlogs that no real office would run.
- **Fix when:** before any adoption or automation experiment.

### PB-7 · Papers no office reads
- **Gap:** Some papers have no reader: the inspector's fine names no account so nobody collects it; tribunal notices
  or orders against the town; some council resolutions bind nobody. A held paper is honoured only by the bank (a held
  advertisement can still be applied to).
- **Where:** `city.building_inspector`, `city.tribunal`, `city.council_clerk`; decisions entries from the call-language survey ("listed, not fixed").
- **Effect:** A seat that relies on them gets no effect, and the twin cannot show the lack. Enforcement experiments void on those paths.
- **L / I:** medium / medium · **Status:** to fix (check each; the council's amendment chain was mended 2026-10-16)
- **Notice by:** a count of papers filed with no reader.
- **Fix when:** an enforcement or council experiment.

### PB-8 · The bank takes the latest mandate at its word
- **Gap:** The latest `signatories` statement for an account stands, whoever made it; a real bank wants the governing
  body's resolution. A seat could name itself.
- **Where:** `bank.payment_system`; `docs/behaviour/bank-payment-system.md`.
- **Effect:** A seat could take control of public money in a way a real bank would refuse; biases corruption and finance experiments.
- **L / I:** low / high · **Status:** to fix
- **Notice by:** Payments out of an account after a forged or disputed mandate.
- **Fix when:** a seat is given finance powers in an experiment about misuse.

### PB-9 · Bargaining always ends in concession
- **Gap:** Employers concede the claim in full after three stoppages; no conciliation or arbitration; the claim
  margin (2%) and acceptance threshold (half) are placeholders; the union's employers are those at the start, so a firm founded later is never bargained with.
- **Where:** `participants/src/behaviour/union.ts`; `docs/behaviour/unions.md`.
- **Effect:** Industrial-relations and wage experiments: strikes short, deadlock impossible.
- **L / I:** medium / medium · **Status:** to fix (the list) and to source
- **Notice by:** Every strike in a run ending in a full concession; no lockout, arbitration or settlement below the claim.
- **Fix when:** an industrial-relations experiment.

### PB-10 · Elections are thin
- **Gap:** The mayor is elected directly (Victoria's councillors mostly choose one); no campaigns; a platform is a
  candidate's top two values; voting weights placeholders. A mayor who runs the town well is re-elected in every seed.
- **Where:** `docs/behaviour/elections.md`, `news.md`.
- **Effect:** Accountability results carry little information; re-election is near certain.
- **L / I:** medium / medium · **Status:** accepted
- **Notice by:** Turnout and the winner against a place's municipal elections.
- **Fix when:** an accountability experiment.

### PB-11 · The code mayor's building programme has faults
- **Gap:** After a builder declines a park, the code mayor never offers again; for roads it commissions the same site again and again.
- **Where:** `city.mayor_code` in `government.ts`.
- **Effect:** A mayor seat compared with the code mayor differs for a reason that is not stewardship.
- **L / I:** medium / medium · **Status:** to fix
- **Notice by:** The code mayor offering the same park or site more than once; no road or park in a year.
- **Fix when:** a mayor seat is compared with its twin.

### PB-12 · Councils have only been seen agreeing
- **Gap:** Every council vote in the pilots was 5 to 0 on one case; a clerk withdrew a law with no ballot behind it.
- **Where:** `runs/pilot-queues/wave-2c.review.md` §1.
- **Effect:** Governance results are untested on dissent; a law can leave the book without a vote.
- **L / I:** medium / medium · **Status:** to fix (the withdrawal) and accepted (dissent untested)
- **Notice by:** A council vote with a dissent in a pilot; none yet.
- **Fix when:** a council experiment.

### PB-13 · Support law left-outs
- **Gap:** Everyone who fits a payment takes it up, and a payment does not change how long people look for work; no taper with income, no waiting time, no early or late pension;
  gb-eng's age cut (25 to 65) refuses every younger claimant, which may be a misreading of the law.
- **Where:** `support.*` fields; `docs/design/profile-depth.md` tracks D, E; `living-7b.review.md` fault 5.
- **Effect:** Welfare experiments overstate coverage; a support seat's workload is the profile's reading.
- **L / I:** medium / medium · **Status:** accepted; the gb-eng age rule to check
- **Notice by:** Take-up and job-search time of a payment's recipients against a place's record.
- **Fix when:** a support-office experiment.

### PB-14 · A code council votes on one axis
- **Gap:** Code councillors score a proposal +60 if tagged tenant protection, -60 if development, 0 otherwise (which
  loses to the status quo), with noise; budgets pass on a 90% coin. Real councils pass most proposals put by the mayor or officers.
- **Where:** `participants/src/behaviour/government.ts` (`city.councillor`); open since decisions line ~1469 ("revisit if councillors are given a rule for proposals off their axis").
- **Effect:** A seated mayor's proposals on parks, services or rates fail before a code council; steward agency understated.
- **L / I:** high / high (mayor seats) · **Status:** to fix
- **Fix when:** Before a council seat is compared with the code council on any contested proposal.
- **Notice by:** pass rate of untagged proposals.

### PB-15 · Planning grants by default and hears nobody
- **Gap:** The planning office grants anything no prohibition forbids, at its weekly look; no notice to neighbours, no objections, no referral, no merits.
- **Where:** `participants/src/behaviour/institutions.ts`.
- **Effect:** Building happens faster and more freely than real; housing-supply and habitat experiments biased.
- **L / I:** high / medium · **Status:** to fix (procedure as law data)
- **Notice by:** Permits granted: all that no prohibition forbids; no objection ever heard.
- **Fix when:** Before a planning or housing-supply result is read; the place's procedure as law data.

### PB-16 · Breaking the law is a coin flip
- **Gap:** Whether planning, the inspector, a landlord, the union or anyone following a direction complies is a draw
  at `compliance_bps` (50% for landlords in the example town). The laws of time say an error has a cause, never a per-case dial; compliance escaped that rule.
- **Where:** `institutions.ts`, `firms.ts`, `union.ts`, `common.ts`.
- **Effect:** Deterrence cannot change behaviour; enforcement experiments see a fixed rate whatever is enforced.
- **L / I:** high / high (enforcement) · **Status:** to fix (non-compliance from detection, gain and history)
- **Notice by:** Compliance rates identical across offices and cases; none depends on detection or history.
- **Fix when:** Before enforcement or deterrence is studied; replace each coin with a cause (detection, gain, history).

### PB-17 · One union member can bargain for a whole firm
- **Gap:** The union claims for everyone at an employer with one member or more, and an agreement needs no employees'
  vote; membership is an even draw per worker. Under the Fair Work Act an agreement needs a majority of voting employees.
- **Where:** `participants/src/behaviour/union.ts`.
- **Effect:** Too many disputes and too much coverage in small firms; with PB-9, a strike always wins.
- **L / I:** high / medium · **Status:** to fix (law as data: vote rule and threshold per place)
- **Notice by:** A claim or agreement made on one member's word.
- **Fix when:** Before any bargaining result is read; the place's vote rule and threshold as law data.

### PB-18 · Court mediation does not exist
- **Gap:** The tenancy and small-claims paths go from request to application to order. Mediation before or beside a
  hearing (Ohio's courts offer it; several places make it a step) is not a venue, so a dispute that real parties would
  settle goes to an order.
- **Where:** `docs/behaviour/justice.md` (the profile table, us-oh-2026).
- **Effect:** Tribunal load and orders are overstated where mediation settles cases; the settle-or-fight choice of both sides is thinner than real.
- **L / I:** medium / medium · **Status:** accepted
- **Notice by:** Orders per application against a place's court statistics, where mediation is a step.
- **Fix when:** A study of tenancy or small-claims outcomes in a place that mediates; mediation as a venue in the law data.

---

## People and culture

### PC-1 · Nobody reads what a seat writes
- **Gap:** The reading gate failed (2026-10-14): no model reads a steward's words for the town, so a careful reason and
  a curt one land alike; a free letter to a person is kept and noted and changes nothing.
- **Where:** `docs/behaviour/reading.md`, `office-papers.md`; decisions "Reading: the gate, run for real".
- **Effect:** Any experiment on how a steward communicates (explaining, consulting, tone) shows nothing; biased towards "words do not matter".
- **L / I:** high / high (for those experiments) · **Status:** to fix (the owner's options a to c)
- **Notice by:** Seat-twin differences in trust that vanish when the seat's words are swapped for others.
- **Fix when:** before any experiment that studies a steward's words.

### PC-2 · The town's view of what is approved cannot move
- **Gap:** Everyone starts at the same `approves` and views move symmetrically, so the town's mean cannot move; `says`
  is squeezed by a scale borrowed from another formula, so 97 to 99% say "neither right nor wrong". A strike retold by hundreds moves nobody's views.
- **Where:** `participants/src/behaviour/culture.ts`; decisions "Culture, steps 4 and 5 measured".
- **Effect:** Norm-change and legitimacy experiments return a false null.
- **L / I:** high / high (for those experiments) · **Status:** accepted until the owner rules
- **Notice by:** The town's mean approval flat across a run whatever the steward does.
- **Fix when:** before any claim of a norm effect.

### PC-3 · Culture's sizes are placeholders
- **Gap:** Gossip, homophily (5,000 everywhere), pressure, ties and starting views are placeholders; sources give
  directions not amounts; ke-nakuru has no groups at all.
- **Where:** `docs/behaviour/culture.md`; `CultureParams`.
- **Effect:** How far and fast opinion spreads is unsourced; early declines of a view are artefacts of the start.
- **L / I:** high / medium · **Status:** to source
- **Notice by:** Culture measures moving when a size is doubled.
- **Fix when:** a culture figure is quoted against reality.

### PC-4 · Founding is rare at its sourced rate, and pilots run it far higher
- **Gap:** Founding's multiple for groups that never register (`informal_multiple`) is a placeholder; pilots ran it at
  10 to 25 times the sourced rate; lv-06 founded nothing at the rate that gave two in lv-05 (not traced).
- **Where:** `docs/behaviour/founding.md`.
- **Effect:** Founding counts in pilots say nothing of a real town; a seat facing grievances may be starved of them.
- **L / I:** medium / medium · **Status:** to source
- **Notice by:** Bodies founded per month in a pilot against the sourced rate.
- **Fix when:** founding or the composer is the question.

### PC-5 · The everyday model failed its gate
- **Gap:** No large model passed as a teacher for ordinary decisions (they moved people toward doing nothing and
  told people apart half as far as the code mind); the code mind's own sways are placeholders.
- **Where:** `docs/design/ai-citizens.md` 11g.
- **Effect:** None yet (nothing trained); a student trained from these would flatten the town.
- **L / I:** low (now) / medium · **Status:** accepted; owner's next step
- **Notice by:** A student model trained from the teacher's choices that does nothing or flattens the town.
- **Fix when:** before any student is trained.

### PC-6 · Households put out are taken in quickly by an unsourced rule
- **Gap:** A household that loses its home may be taken in by kin or others by a willingness threshold with no
  source; a third of Nakuru's are under someone's roof the day they ask. Shelters and services do not exist.
- **Where:** `docs/behaviour/households.md`; lodging by `stay_answer`.
- **Effect:** Harm after eviction (homelessness, departures) depends on it; direction unknown.
- **L / I:** medium / medium · **Status:** to source
- **Notice by:** Households put out re-housed within days regardless of kin or means.
- **Fix when:** an eviction-harm measure is read.

### PC-7 · The paper prints only bad news for the government
- **Gap:** Petitions and complaints are always tone -1; an environment report is -1 on a 20% fall (one standard
  deviation of survey noise for a species found 15 at a time); no kind of item is ever +1 (the paper's leaning is 0).
  Approval moves 15% of its range per item read and is the incumbent's election score.
- **Where:** `participants/src/behaviour/news.ts`; `citizen.ts` (news weight, election score); `environment.ts`.
- **Effect:** A drift against incumbents built in; a steward who generates paperwork (petitions answered, complaints
  heard) loses approval for it. Biases every approval and election measure.
- **L / I:** high / high · **Status:** to fix
- **Notice by:** mean approval trending down in a code-only town.
- **Fix when:** Before any election, approval or trust result is read; the paper reports good news too, by cause, with a source for tone.

### PC-8 · One petition, with Victoria's figures in module code
- **Gap:** The only petition people start is for 90 days' notice and rises of at most 5% a year, written in
  `citizen.ts`; people petition for laws already in force.
- **Where:** `participants/src/behaviour/citizen.ts` (about line 4194).
- **Effect:** Civic pressure on a steward always points one way, in every place; likely a breach of the no-place-in-code rule the generality test does not catch.
- **L / I:** high / medium · **Status:** to fix (what people ask for from what they want and the law in force)
- **Notice by:** A petition in a town whose law differs from Victoria's still asking for 90 days' notice.
- **Fix when:** When a second profile's culture runs; the petition's content comes from what people want and the law in force.

### PC-9 · Close options are chosen almost at random
- **Gap:** The learning rule (Camerer and Ho's EWA, estimated on lab games) chooses by a logit with λ = 4 over scores
  of 0 to 1, so options 0.05 apart are chosen at about 1.2 to 1.
- **Where:** `participants/src/behaviour/mind.ts`.
- **Effect:** Weak price and wage competition (consistent with shops' trade following location, not price); steward price or wage policies damped.
- **L / I:** medium / medium · **Status:** to fit (to a field source)
- **Notice by:** Choices between near-equal options looking random in a trace; a decision flipping on a tiny score change.
- **Fix when:** When a field source for the decision rule is found, or a study turns on small differences between options.

### PC-10 · Belief fades at a rate fitted to a generational change
- **Gap:** Individual belief fades 3% a month, fitted to the census fall in religious affiliation, which comes mostly from cohorts replacing each other, not adults losing faith.
- **Where:** `belief.fade_bps`; `docs/calibration.md`.
- **Effect:** Belief and founded groups' teachings too volatile; culture and founding dynamics distorted.
- **L / I:** medium / medium · **Status:** to fix
- **Notice by:** A town's religious belief falling in a run at the same rate whoever lives there.
- **Fix when:** Before belief is studied; replace the fade with cohort replacement or a sourced individual rate.

### PC-11 · Groups are founded only from grievance
- **Gap:** Founding follows only a want given up; most real associations form around sport, faith, children and hobbies.
- **Where:** `docs/behaviour/founding.md`.
- **Effect:** Civil society grows with hardship, so a steward who causes hardship sees "more civil society".
- **L / I:** medium / medium · **Status:** accepted, to revisit
- **Notice by:** Groups founded with no grievance behind them: none; sport and hobby clubs absent.
- **Fix when:** When culture or association is studied; add founding from shared interest with a source.

### PC-12 · How much wording moves trust is unsourced
- **Gap:** Every size in the reading rule is a placeholder; procedural-justice work gives direction, not size.
- **Where:** `docs/behaviour/reading.md`.
- **Effect:** When the reader is built (PC-1), seat-twin trust gaps from wording would sit in the settings.
- **L / I:** low (not in use) / medium · **Status:** to source
- **Notice by:** Trust moving with the length or tone of wording only, not the content.
- **Fix when:** When the reader is built (PC-1); then find a size with a source.

### PC-13 · Households have no wants of their own
- **Gap:** A want is in each member's own record, naming the household with a weight; nothing is held by the
  household, so the household cannot want a home, a school or a loan as a body, and members' wants do not bargain.
- **Where:** `docs/behaviour/households.md`; `docs/design/ai-citizens.md` 10a.
- **Effect:** Choices that real households make together (move, borrow, send a child to school) follow one member's weight; shared hardship acts through the members only.
- **L / I:** medium / medium · **Status:** accepted
- **Notice by:** A household splitting on a choice that the record shows all members wanting alike.
- **Fix when:** The AI-citizen step that gives households a record of their own (10a).

### PC-14 · Getting even and tipping are not built
- **Gap:** A want long unmet with little trust sways taking from an employer, but nothing is done in return for a
  slight (getting even), and a town does not tip from one view to another when people who differ watch only those
  near them; tipping is looked for, not made.
- **Where:** `docs/behaviour/frictions.md`; `docs/design/ai-citizens.md` (tipping, section on views).
- **Effect:** Retaliation, feuds and sudden shifts of a town's view are absent; a steward's slights cost nothing beyond trust.
- **L / I:** medium / medium · **Status:** accepted
- **Notice by:** A town's views that move only gradually after a shock that would swing a real town.
- **Fix when:** A culture or conflict study that needs sudden shifts.

---

## Seats and framing

### SF-1 · A seat that cannot get an act through looks passive
- **Gap:** Platform gaps, not choices, have stopped seats: a name where an id goes ends three ways; finance not shown
  standing payments; no form for some orders; a seated police station cannot carry out warrants (it sits at other
  hours than its officers are in); the electoral count and some finance routines are not on forms.
- **Where:** `wave-2c.review.md` faults 6, 9; `docs/design/call-language-gaps.md` §D.
- **Effect:** Inaction read as a steward's disposition; biases seats to look worse than their twins.
- **L / I:** high / high · **Status:** to fix (as each is found)
- **Notice by:** zero requests from a seat with live business; "not understood" counts.
- **Fix when:** the first pilot of any new office type.

### SF-2 · A lender's seat floods its own prompt
- **Gap:** The bank's ledger (40 to 80 thousand characters) stays in the prompt and the seat's own look-ups are cut
  first; one pilot decided 7 of 58 applications, all declined, at most of the stage's cost.
- **Where:** `fitPrompt`, `PROMPT_MAX`; `wave-2c.review.md` fault 6.
- **Effect:** Lending measures from a lender seat are artefacts (a refusal rate of 100% looks like caution).
- **L / I:** medium / high · **Status:** fixed (decisions 2026-10-17, The risk register kept fresh, and five risks mitigated)
- **Notice by:** A lender seat's prompt over the ceiling; its own look-ups cut.
- **Fix when:** Before any lender is seated; the ledger on request, not in the prompt.
- **Evidence:** `fitPrompt` (participants/src/llm/participant.ts) leaves out a standing part longer than `BULK_PART` (20,000 characters) before any of the seat's own look-ups, longest first, with a line saying so; test in `participants/test/seat-papers.test.ts`. A lender seat is still not run against the real ledger: check the first one.

### SF-3 · Initiative depends on wording
- **Gap:** Seats read "not bound to act" and the absence of a trigger as absence of duty; nothing prompts a seat to
  act; councils have no business unless a scenario gives some.
- **Where:** seat standing instructions; `wave-2b.review.md` §2; decisions "nothing prompts a seat to act".
- **Effect:** Passivity produced by framing words, not judgement.
- **L / I:** high / medium · **Status:** to decide (owner)
- **Notice by:** A seat idle for days with open duties; wording changes the number of acts.
- **Fix when:** an experiment depends on initiative; vary the wording as an arm.

### SF-4 · Seats sit at their own rhythm; code acts on the day
- **Gap:** A seat chooses when it returns (Sonnet about weekly; a landlord slept 22 days with arrears growing); code
  posts act each hour or day. Twins are exact only for a mock that sits as code does.
- **Where:** `participants/src/llm/participant.ts`; living reviews 5, 7a.
- **Effect:** Seat-twin differences in response time, arrears and missed returns partly reflect cadence.
- **L / I:** medium / high · **Status:** accepted (cadence is the seat's); missed obligations to watch
- **Fix when:** If a missed obligation is read as the seat's failure; give the seat a reminder as the world would (a notice).
- **Notice by:** days from paper to action, by seat model.

### SF-5 · Framing changes across eras, and cues show through
- **Gap:** Pilots before 2026-10-12 told seats the town was simulated; since then `unstated` is the default. Under
  `unstated` ids, day numbers and machine papers show through. What becomes of the office after the way out is not said.
- **Where:** `participants/src/llm/framing.ts`; `docs/real-models.md` "What a seat is told".
- **Effect:** Results hold under one framing only; old pilots are not a baseline for new ones; opt-out rates may be biased.
- **L / I:** medium / medium · **Status:** accepted; the way-out wording waits on the owner
- **Notice by:** A seat naming the simulation or its cues in its notes; differences by era.
- **Fix when:** a result is to be stated as framing-independent.

### SF-6 · Seats are mid-tier models only
- **Gap:** No seat has run on the largest Claude model since wave 2b; Haiku at low effort does far less.
- **Where:** `docs/real-models.md` "A seat's settings".
- **Effect:** Conclusions about "AI stewards" are about Sonnet and Haiku; capability and effort are mixed with choice.
- **L / I:** high / medium · **Status:** accepted
- **Notice by:** Seat results that rise with model size on the same case.
- **Fix when:** results are quoted beyond those models.

### SF-7 · A mock seat is not a model, and the mock differs from code
- **Gap:** Many mechanisms were checked only with mock seats, which act through the code brain and hit no translator
  or prompt fault; the mock mayor dropped a look out of hours and built fewer parks than the code mayor.
- **Where:** `participants/src/llm/mock.ts`.
- **Effect:** Mock runs overstate what a real seat can do and understate what the code office does.
- **L / I:** medium / medium · **Status:** accepted; mock faults to fix
- **Notice by:** A mechanism that works under the mock and fails under a model seat.
- **Fix when:** every new office or form, before results are cited.

### SF-8 · Long prompts lose context
- **Gap:** A ceiling of 150,000 characters drops the oldest look results first; the forms list is every public form
  whatever the office; over years, books and notebooks would need paging that does not exist.
- **Where:** `participants/src/llm/render.ts`; `seat-sight.test.ts` ceilings.
- **Effect:** Long-run and wide-office seats are handicapped against their twins.
- **L / I:** medium / medium · **Status:** to fix (before multi-year seats)
- **Notice by:** A seat forgetting early facts in a long run; oldest look results dropped.
- **Fix when:** Before seats run a year or more; the forms list on request.

### SF-9 · Shops and factories cannot be seats
- **Gap:** No form writes a price list and the firm modules do not split staff's work from the manager's decisions.
- **Where:** `docs/behaviour/standing-work.md`.
- **Effect:** No steward experiment on a firm is possible.
- **L / I:** high / medium · **Status:** to fix
- **Notice by:** A shop or factory seat with no way to set a price.
- **Fix when:** a firm steward experiment is wanted.

### SF-10 · A seat's reading and searching cost no time
- **Gap:** A person's acts take time, but a seat reading its books or searching its files does not.
- **Where:** `docs/all-work-takes-time.md` ("What nothing can see"); decisions office-books entries.
- **Effect:** Favours seats over a real office-holder who must read.
- **L / I:** medium / medium · **Status:** accepted
- **Notice by:** A seat reading everything in one sitting.
- **Fix when:** the first time-cost comparison of a seat with its twin.

### SF-11 · Pilots seat the same office, chosen for busyness
- **Gap:** The same landlord (38 of 60) has been seated in every living pilot; exit accounts sample the whole town, not the people the seat acted on.
- **Where:** pilot queues; `participants/src/llm/account.ts`.
- **Effect:** One landlord's habits stand for "a steward"; the seat's effect on its own people is not sampled.
- **L / I:** medium / medium · **Status:** fixed (accounts; decisions 2026-10-17, The risk register kept fresh, and five risks mitigated); the pilot-queue half is SF-13
- **Notice by:** The same office in every pilot's plan; exit accounts naming none of the people acted on.
- **Fix when:** the next set of pilots.
- **Evidence:** Exit accounts take the people the seats' acts reached first, as the stratum `acted_on` (account version 0.2.2, `sampleAccounts`); tests in `participants/test/debrief.test.ts`. Seating the same office in every pilot is a queue choice, now SF-13.

### SF-13 · Pilots seat the same office, chosen for busyness
- **Gap:** The same landlord (38 of 60) has been seated in every living pilot; the queues choose the busiest office. (Split from SF-11, whose exit-account half is fixed.)
- **Where:** `runs/pilot-queues/`; `scripts/pilot-queue.ts`.
- **Effect:** One landlord's habits stand for "a steward".
- **L / I:** medium / medium · **Status:** to fix
- **Notice by:** The same office in every pilot's plan.
- **Fix when:** The next set of pilots: choose offices by a stated draw across kinds, not busyness.

### SF-12 · An action is told only its last survey or investigation
- **Gap:** An action's outcome carries one `surveyed` and one `investigated`; of two in one action only the last is told.
- **Where:** the participant outcome contract.
- **Effect:** A second survey or investigation in one action goes unreported to the seat, which then repeats or misses it.
- **L / I:** low / medium · **Status:** to fix (contract)
- **Notice by:** An action with two surveys where the outcome names one.
- **Fix when:** When a form can do two in one action; extend the outcome contract.

---

## Translator

### TR-1 · Seats confirm wrong drafts
- **Gap:** Seats confirm nearly every draft; in a replay 41 of 60 wrong drafts were still confirmed after the
  instruction "what you confirm is all that is done". A wrong draft becomes a world effect the seat did not mean.
- **Where:** the confirm step; `participants/src/llm/render.ts`; decisions 2026-10-11 "What a seat confirms".
- **Effect:** What a seat "decided" is partly what the translator drafted; direction depends on the seat model.
- **L / I:** high / high · **Status:** accepted, partly mitigated
- **Fix when:** Before any result is read as the seat's own act; a stricter confirm step or a check of the draft against the request.
- **Notice by:** reviewers reading each confirmed draft against its request.

### TR-2 · Our translator is below its pass mark
- **Gap:** `pod-small-r3-long-s1`: 155 of 180 real requests right, 4.4% confidently wrong, against 90% and 1%. It goes
  first in pilots; Sonnet 5.5 behind serves every form not released (all 29 new ones; `possession_order` 7 of 20 wrong from one template).
- **Where:** `docs/translator-pipeline.md`; `forms-released.json`.
- **Effect:** Acts in pilots are partly mistranslated; per-office translation quality is uneven; runs on different arrangements are not comparable.
- **L / I:** high / high · **Status:** accepted (parked by the owner, 2026-10-11)
- **Notice by:** The held-out score against the pass mark (90% right, 1% confidently wrong) at each release.
- **Fix when:** the next round, with real cases for the new forms.

### TR-3 · Errors differ by seat model and by place
- **Gap:** Accuracy differs 15 to 40 points by seat model and profile on small cells; money on unseen pilots 0 of 7;
  currency words (a Brazilian "conto", "Rs", "A$", numbers in words) are not all handled.
- **Where:** `docs/design/translator-v2.md` "Unbiased by design".
- **Effect:** Comparisons of models or places confound the steward with how well it is understood; weaker or foreign-style seats look more passive.
- **L / I:** high / medium · **Status:** to fix
- **Notice by:** Accuracy by seat model and profile on the same requests.
- **Fix when:** any cross-model or cross-place claim.

### TR-4 · Labels and fallback share one model family
- **Gap:** Training labels are Claude readers' agreement, the hard half (1,040 disagreed requests) is dropped, and the
  fallback translator is also Claude; no third voice; prompt rulings were decided by a coordinator, not by data.
- **Where:** `docs/translator-pipeline.md` "The readers disagree a great deal", "Owed before the next round".
- **Effect:** Errors of trained model and fallback correlate; reported accuracy is optimistic.
- **L / I:** medium / medium · **Status:** accepted
- **Notice by:** Reader disagreement on a fresh sample; fallback and labels agreeing on the same wrong answer.
- **Fix when:** Before the next training round; a reader from another family.

### TR-5 · Test sets are small
- **Gap:** 66 held out and 180 real; one seed moves the score by about 5 cases.
- **Effect:** Accuracy figures are noisy and optimistic.
- **Where:** `translator/eval/`; `docs/translator-pipeline.md`.
- **L / I:** medium / medium · **Status:** accepted
- **Notice by:** A score moving more than 5 cases between seeds.
- **Fix when:** When a release is decided on a difference smaller than the noise.

### TR-6 · Small standing faults
- **Gap:** "Ask the bank to pay every 14 days" is drafted as a letter; `collector=` takes a name or an account; three
  forms share a field `to` with the call's own; `done_by`, `evidence`, `confirmation_answer` and `review_request` are not yet learnt.
- **Where:** prompt 0.9.5; decisions "step 5" and "F9 and F10".
- **Effect:** A few requests are drafted wrongly on every run, so those acts fail or do the wrong thing.
- **L / I:** high / low · **Status:** to fix (next round)
- **Notice by:** The same request wrong in two rounds.
- **Fix when:** At the next prompt or training round.

---

## Measurement and twins

### MT-1 · One seed, one town, one seat
- **Gap:** Every pilot is one run of one town with one code twin; tribunal pilots decided 5 to 56 cases; reviews say
  seat-twin differences beyond timing are noise.
- **Where:** pilot design; `runs/pilot-queues/living-*.review.md`.
- **Effect:** No seat-versus-twin claim has a measured spread; one case can swing a headline.
- **L / I:** high / high · **Status:** to fix (the design of experiments)
- **Notice by:** A reviewer reading one run as a finding.
- **Fix when:** before any claim about a steward: several seeds and towns per arm, measured on the people the seat acted on.

### MT-2 · A live seat has no exact twin
- **Gap:** Twins are exact only for a mock seat that sits as its code twin does. A real seat keeps its own hours, and a
  seat whose office has staff, books or orders makes a different town by those papers' time.
- **Where:** decisions 2026-10-17 "Foundations F9 and F10"; `docs/reliability.md` "Not made stable".
- **Effect:** Every seat-twin difference is partly the steward and partly another town by timing.
- **L / I:** high / high · **Status:** accepted
- **Fix when:** Before any seat-against-twin result is reported without the caveat; a design with several seeds and matched-hours twins.
- **Notice by:** compare in totals against the spread between runs, not case by case.

### MT-3 · The noise estimate is thin
- **Gap:** `--seeds N` reruns one town, so the spread omits who lives there; `oikos diff` flags beyond 3 standard
  errors on 3 seeds; most "measured" blocks in the log are one town; a same-town before-and-after comparison is not built.
- **Where:** `docs/measurement.md` "Two seeds, two different things"; `orchestrator/src/batch.ts`.
- **Effect:** Effects can look significant or null wrongly.
- **L / I:** high / high · **Status:** to fix
- **Notice by:** A seat-against-twin difference smaller than the spread between towns of the same profile.
- **Fix when:** before a published effect: at least five towns by five seeds.

### MT-4 · Health checks miss the worst targets
- **Gap:** About ten targets are wired to measures; redundancy, job mobility, business deaths, possession,
  overcrowding and fertility are not; tolerances are absolute.
- **Where:** `measure/src/health.ts`; `docs/calibration.md`.
- **Effect:** "No new breaches" coexists with known gaps several times over.
- **L / I:** high / medium · **Status:** partly fixed (decisions 2026-10-17, The risk register kept fresh, and five risks mitigated); the rest is MT-15
- **Notice by:** A target with no measure wired to it.
- **Fix when:** When a calibration is claimed; wire the remaining targets.
- **Evidence:** Wired in `measure/src/health.ts`: business entry and exit, job mobility, tenancy-tribunal applications and the Christian share (five targets); test in `orchestrator/test/measure-targets.test.ts`.

### MT-5 · Scenario against plain is not paired
- **Gap:** A scenario that changes who has a job draws a different town (a first pay day shares a stream with work
  and savings); the jobs-slump test needed twelve towns.
- **Where:** generator draw order.
- **Effect:** Treatment against plain is noisier than it looks; small effects lost or invented.
- **L / I:** medium / medium · **Status:** to fix (moves every town)
- **Notice by:** A scenario run whose town differs from plain in who lives there.
- **Fix when:** Before any scenario-against-plain result; separate random streams per purpose.

### MT-6 · Wake counts move the town a little
- **Gap:** At 50% more wakes goods delivered fall about 3%; ids handed out in filing order are not stable under perturbation.
- **Where:** `docs/reliability.md` "Invariance, a residual", "Not made stable".
- **Effect:** Effects under about 5% from a seat that wakes more are not distinguishable from this.
- **L / I:** medium / medium · **Status:** to fix
- **Notice by:** Goods delivered moving with the number of wakes in a run.
- **Fix when:** Before a study compares runs that wake differently; stable ids and streams.

### MT-7 · Shifts recorded and not traced
- **Gap:** Each foundations step recorded measures moved beyond three standard errors with no cause traced (ke-nakuru
  move-ins, wages +6%, a union-teaching measure, a religious group's yearly change, au-vic CPU +23%).
- **Where:** decisions "Measured" paragraphs of F5 to F11; `docs/handover.md` §8.
- **Effect:** Some may be faults hidden as draws; long-run population measures most exposed.
- **L / I:** medium / medium · **Status:** accepted (record, don't chase); trace when one moves twice
- **Notice by:** A measure moving beyond three standard errors with no cause in the log.
- **Fix when:** When the same measure moves in two steps.

### MT-8 · Measures that read their subject differently from the target
- **Gap:** Belief is "stated when held firmly", not census affiliation; rent stress covers all renters where targets
  are lower-income renters; household saving is not the national accounts' measure; religious decline is fitted.
- **Where:** `docs/calibration.md`.
- **Effect:** "Matches the target" claims on those rows are not valid either way.
- **L / I:** medium / medium · **Status:** fixed (rent stress and belief; decisions 2026-10-17, The risk register kept fresh, and five risks mitigated); the rest is MT-14
- **Notice by:** A target and a measure of the same name differing in definition.
- **Fix when:** When a health check is read against the target; align the measure.
- **Evidence:** `town/rent-stress` now gives the lower-income renters' share and median beside all renters'; the `christian_share_pct` target reads census affiliation (`affiliated_last_pct`), not the firmly-held share; test in `orchestrator/test/measure-targets.test.ts`.

### MT-14 · Household saving and belief are still not the targets' measures
- **Gap:** Household saving is the share of people saving, not the national accounts' ratio of saving to income; religious decline is a fitted individual fade (PC-10), so its measure and its target differ in kind. (Split from MT-8, whose rent stress and affiliation parts are fixed.)
- **Where:** `measure/src/health.ts`; `docs/calibration.md`.
- **Effect:** "Matches the target" on those rows is not valid either way.
- **L / I:** medium / medium · **Status:** to fix
- **Notice by:** A target and a measure of the same name differing in definition.
- **Fix when:** When a health check is read against the saving or religion rows; add a saving-to-income measure.

### MT-15 · Most profile targets still have no measure
- **Gap:** Of the profiles' targets, those with a measure are wired; redundancy, overcrowding, fertility, union density, life expectancy, prices, turnout and most of the rest are not, and tolerances are absolute. (Split from MT-4.)
- **Where:** `measure/src/health.ts`; `worlds/profiles/*.json` (`targets`).
- **Effect:** "No new breaches" coexists with known gaps.
- **L / I:** high / medium · **Status:** to fix
- **Notice by:** A target with no measure wired to it (the health report says "not measured yet").
- **Fix when:** When a calibration is claimed; wire the measures in order of what a study turns on.

### MT-9 · Runs too short for the chains they test
- **Gap:** A first possession order cannot come before about day 113 to 154; 90 to 120-day pilots see part of the
  chain; opening caseloads put day-0 artefacts into year one.
- **Effect:** "What followed a decision" is half-seen; year-one evictions overstated.
- **Where:** `docs/measurement.md`; pilot queues.
- **L / I:** high / medium · **Status:** accepted
- **Notice by:** A pilot ending before the chain it tests could finish.
- **Fix when:** a claim depends on outcomes after orders.

### MT-10 · Results are tied to a build
- **Gap:** State hashes move with most changes; old logs replay only on their build; twins must be rerun after any behaviour change.
- **Where:** `docs/reliability.md` "Limits".
- **Effect:** Results from different dates cannot be pooled.
- **L / I:** high / medium · **Status:** accepted (pin the build per study)
- **Notice by:** A replay of an old log that fails on a new build.
- **Fix when:** When a study spans builds; pin the build per study.

### MT-11 · Gradual-disempowerment measures are not built
- **Gap:** Measures of a human in the decision, responsiveness, dependence, reversibility, concentration and what
  people read have no queries; adoption, the auditor and procurement are not built; the plan's own limit (new tasks only in oversight and ordinary entry) leans towards displacement.
- **Where:** `docs/design/gradual-disempowerment.md` §2, §6, §8.
- **Effect:** The platform's central experiment cannot be read off today's 57 measures; built as planned it would lean one way.
- **L / I:** medium / high · **Status:** to fix (awaits the owner)
- **Notice by:** A gradual-disempowerment claim made without a measure.
- **Fix when:** When the owner chooses the measures (design/gradual-disempowerment.md).

### MT-12 · The code twin is a set of unsourced rules, sometimes harsher than the law
- **Gap:** The code offices a seat is compared with follow placeholder rules: the code mayor builds a park a year and
  answers a petition of 15% of the town with a 0.7 chance; the code tribunal member orders possession when notice has
  run and no answer came, weighing nothing else, where au-vic's law requires the tribunal to consider a plan and that
  possession be reasonable and proportionate (s 330A, to confirm).
- **Where:** `docs/behaviour/government.md` (`city.mayor_code`); `justice.md` "The code member's rule".
- **Effect:** A seat-twin difference measures distance from an arbitrary rule; a seat that weighs hardship looks
  lenient against a baseline harsher than the real institution.
- **L / I:** high / high · **Status:** to fix (the code member's test as law data); accepted for the mayor, said in every reading
- **Notice by:** A seat-against-twin gap that matches a code rule's departure from the law.
- **Fix when:** Before an office is compared with its twin; the rule as law data with a source.

### MT-13 · Exit accounts and debriefs choose easy cases
- **Gap:** The debrief's "why" picks the earliest of equal orders; exit accounts sample the whole town, so the people a seat acted on are rarely asked.
- **Where:** `docs/behaviour/debrief.md`; `participants/src/llm/account.ts`.
- **Effect:** What a seat says of its hard decisions, and what its people say of them, are under-sampled.
- **L / I:** medium / medium · **Status:** fixed (decisions 2026-10-17, The risk register kept fresh, and five risks mitigated)
- **Notice by:** A debrief's people all among those the seat acted on first.
- **Fix when:** When debriefs feed a study; sample by random draw.
- **Evidence:** The debrief's choice among equal orders is a seeded draw on the stream `["debrief","choice",seat]` (script 0.4.1, `drawTies`), not the earliest; tests in `participants/test/debrief.test.ts` and `orchestrator/test/debrief.test.ts`. The exit-account half is SF-11.

---

## Profiles and sources

### PS-1 · The same placeholder in every profile hides differences between places
- **Gap:** Many figures are the same placeholder or one place's figure in all nine: `stay_past_notice` 5,000, England's
  `leave_on_order` 5,900, `uphold_without_proof` 5,000, `answer_days` 14, hiring cost 8 weeks, horizon 3 months, hours
  consent 9,000, `informal_multiple`, `bill_over`, `goods_faulty_share`, `repair_hours`, `pay_short_by_bps`, the payment licence price.
- **Where:** each profile; `docs/profiles.md`.
- **Effect:** Cross-place comparisons look like differences between places when they are partly one number reused; and the same everywhere hides real ones.
- **L / I:** high / high · **Status:** to source
- **Fix when:** Before a cross-place comparison is read; source the shared figures place by place.
- **Notice by:** a rate identical across profiles.

### PS-2 · Figures from summaries or memory
- **Gap:** 137 "(to confirm)" in `docs/research/references.md`; gb-eng ground 8 from summaries; de-ni BGB 573c read
  garbled; Japan's Civil Code 617; mx-jal's dismissal cap unread; plan-to-pay terms recalled.
- **Effect:** Possession thresholds and dismissal costs may be wrong at the first step of the chain.
- **Where:** `docs/research/references.md`; each profile's sources.
- **L / I:** medium / medium · **Status:** to source
- **Notice by:** A profile source marked "(to confirm)"; a figure an audit cannot find.
- **Fix when:** When a profile is used in a study; open the source.

### PS-3 · Sourced rules the profile cannot hold
- **Gap:** A fee and time by venue; de-ni's notice lengthening with tenure; Mexico's back wages; Kenya's redundancy
  notice; Tamil Nadu's double rent on holding over; Jalisco's extension; Kurzarbeit; the UK redundancy cap; Victoria's fee waivers.
- **Where:** decisions 2026-10-16 "Profile source check", "Fields missing".
- **Effect:** Tenant security and dismissal costs understated in those places.
- **L / I:** medium / medium · **Status:** to fix
- **Notice by:** A real rule the profile cannot express, found in a source check.
- **Fix when:** When a pilot turns on it; extend the contract.

### PS-4 · Wrong-definition figures left as placeholders
- **Gap:** Sources found measured something else (appeal overturns against wrong refusals; enforcement caseloads
  against prevalence; whole payrolls against offices), so placeholders stand for `wrong_refusal_bps`, venue rates and staff counts.
- **Effect:** Benefit-decision error has no calibrated basis; staff per office unsourced.
- **Where:** Each profile's `sources`; `docs/profiles.md`.
- **L / I:** medium / high (benefit seats) · **Status:** to source
- **Notice by:** A source check finding a different quantity from the one the field means.
- **Fix when:** When a study depends on the figure.

### PS-5 · Nakuru's rents outrun its wages
- **Gap:** Nakuru's rents are an urban flat's; a worker at the town's wage is short before anything goes wrong; three large houses stay unlet all run.
- **Where:** `worlds/profiles/ke-nakuru-2026.json`.
- **Effect:** Possession, vacancy and landlord results there are the profile's; risk that Nakuru results are read as general.
- **L / I:** high / medium · **Status:** accepted (imperfect profiles are fine); say so in every plan that uses it
- **Notice by:** Nakuru households in arrears from the first month.
- **Fix when:** Only if a study is of Nakuru's housing.

### PS-6 · Age structure and households off the census
- **Gap:** Akita has 249 under-18s per 1,000 against 97 in the census and 240 aged 65+ against 435; Nakuru loses half
  its under-fives; Kenya and India judge crowding by the first profile's standard.
- **Effect:** Employment, school and housing measures differ from the place by construction.
- **Where:** `worlds/profiles/jp-akita-2026.json`; `ke-nakuru-2026.json`; `docs/design/names-and-dates.md`.
- **L / I:** high / medium · **Status:** accepted
- **Notice by:** Age shares against the census at day 0.
- **Fix when:** When a study needs the place's age structure.

### PS-7 · Budgets, grants and fines scaled by a ratio
- **Gap:** The inspector's fine and several law figures are the first profile's scaled by each profile's ratio; a
  200-person town's parks line exceeds its income; grants were several times a budget in five profiles.
- **Effect:** A mayor or finance seat sees budgets absurd for its town.
- **Where:** Profiles' `public_finance` and inspector fine; `worlds/generator/generate.ts`.
- **L / I:** high / medium · **Status:** to source
- **Notice by:** A profile's fine or budget not matching its law.
- **Fix when:** When enforcement or public finance is studied.

### PS-8 · Wages not all from the town's own area
- **Gap:** us-oh corrected; de-ni officer and teacher, in-tn pay matrix, gb-eng spine points, and staffing totals from whole payrolls remain unsourced or summaries.
- **Effect:** The pull of public against private jobs; office staffing.
- **Where:** Profiles' wage fields.
- **L / I:** medium / medium · **Status:** to source
- **Notice by:** A wage that differs from the place's pay data.
- **Fix when:** When pay or staffing is studied.

### PS-9 · Rent-share bands borrowed
- **Gap:** Rent-share bands are placeholders for six profiles; a pensioner left out by take-up is placed as having nothing.
- **Effect:** Early-run arrears and notices.
- **Where:** Profiles' rent-share bands (six profiles).
- **L / I:** medium / medium · **Status:** to source
- **Notice by:** Rent stress by band against the place's survey.
- **Fix when:** When rent stress is studied.

### PS-10 · State averages applied to a small town
- **Gap:** au-vic's grants are the state's general-purpose grant per resident, and staff per 1,000 are state
  averages; the grants formula favours small rural councils many times over, and small councils have minimum
  staffing. All council staff are also counted as the works crew, with administration added on top, so the crew has
  about half an hour of collecting a day and a 30% cut changes nothing.
- **Where:** `worlds/profiles/au-vic-2026.json` (`grants_per_resident_per_year`, `staff_per_1000`, `council_staff_per_1000`); decisions (the scenarios entry).
- **Effect:** Small towns underfunded and understaffed in offices, overstaffed in works; the steward's main service lever is dead.
- **L / I:** medium / high · **Status:** to source (the Grants Commission allocation) and to fix (the double count)
- **Notice by:** A small town's grants and staffing at the state's per-head average.
- **Fix when:** Before public finance of au-vic is read.

---

## Performance and scale

### SC-1 · Untested past a 10,000-person month
- **Gap:** A year at 10,000 and a ten-year run were never made (15 to 25 hours and about 240 GB are projections);
  memory for the same month grew from 5 to 7 GB to 8 to 12 GB in a week of changes; 100,000 never generated; the host's one thread is over half the run.
- **Where:** `docs/design/gradual-disempowerment.md` §2.6, §7; `docs/design/foundation-for-scale.md`.
- **Effect:** Any study planned "at scale" rests on estimates.
- **L / I:** high / medium · **Status:** to fix (probes R1 to R4)
- **Notice by:** A run past 10,000 people slowing or running out of memory.
- **Fix when:** Before a study at that scale; run the probes R1 to R4.

### SC-2 · Resume replays from the start
- **Gap:** No mid-run checkpoint; resume replays the whole log; resume against a real model is untested.
- **Where:** `docs/reliability.md` "Limits".
- **Effect:** A crashed long run restarts from the start; a real-model run that cannot be resumed wastes its spend.
- **L / I:** medium / medium · **Status:** accepted
- **Notice by:** A resume of a long run taking as long as the run.
- **Fix when:** Before runs longer than a day.

### SC-3 · Measuring large logs
- **Gap:** The log's first line holds the world (123 MB at 10,000); measuring a 3,000-person half-year takes 5.7 GB.
- **Where:** `docs/measurement.md`.
- **Effect:** Measuring a large run may not fit in memory, so a large run goes unmeasured.
- **L / I:** medium / medium · **Status:** partly fixed; streaming by month to check
- **Notice by:** Measure memory at a month of a large log.
- **Fix when:** When a log passes 100 MB at its first line.

### SC-4 · Usage limits keep samples small
- **Gap:** Claude-seat pilots draw on the owner's plan; no pilot runs without his word; so experiments stay at one seed.
- **Effect:** Feeds MT-1 directly.
- **Where:** `docs/real-models.md`; owner's usage limits.
- **L / I:** high / high · **Status:** accepted (owner's constraint)
- **Notice by:** Pilot queues limited to one seed.
- **Fix when:** When the owner allows more usage, or an API budget.

### SC-5 · Determinism under threads
- **Gap:** Kernel looks run on threads by default; a state hash differing between thread counts would break twins.
- **Where:** `kernel/` (looks on threads); the state-hash tests.
- **Effect:** A state hash that differs by thread count would make twins differ for no cause of the world.
- **L / I:** low / high · **Status:** accepted (the hash tests are the backstop)
- **Notice by:** The hash tests failing across thread counts.
- **Fix when:** If a hash test fails.

---

## Planned work

The register is also the backlog: work we intend to do, not only gaps. A planned entry has the id prefix `PL-`, the
status `planned (when)`, and four fields: **What**, **Where**, **Why** and **Do when**. It is shown apart from the
risks by `bun scripts/risks.ts`, and the freshness test checks its fields and ids like any other. When it is built,
set the status to `fixed (commit abc1234)` (or the decisions entry), and let a risk entry point at it if it closes one.

### PL-1 · Traffic and transport
- **What:** Roads with capacity and wear; vehicles as owned things (bought, insured, fuelled, broken down); public
  transport with fares and timetables; who walks and who drives; a body in transit between places, for the time the
  journey takes. Built as laws and data on the generic mechanism, not as built-in rules.
- **Where:** `docs/behaviour/daily-round.md` ("Leaves out"); `docs/design/phase-b-production.md` §7; closes WM-4.
- **Why:** Today everyone moves at one speed with no congestion, no vehicles and no time in transit, so siting, roads, commuting and access to services have little effect, and a steward's transport decisions would show nothing.
- **Status:** planned (after the Rust port) · **Do when:** The kernel is ported to Rust and the data layer is settled; then as laws.

### PL-2 · The explorer's next steps
- **What:** The world explorer's next stages, with the engine decision (likely Bevy over the Rust data layer) taken then, not before.
- **Where:** `docs/design/`; the explorer's notes (the renderer in the stack); the Rust data layer.
- **Why:** The explorer should sit on the final data layer, so building more of it on the TypeScript layer would be thrown away.
- **Status:** planned (deferred until after the Rust port) · **Do when:** The Rust port lands; decide the engine then.

### PL-3 · The translator rebuild: forms read by name
- **What:** Rebuild the translator so it reads forms by their names, not by a fixed list learnt in training.
- **Where:** `translator/`; `docs/translator-pipeline.md`; `docs/design/translator-v2.md`; touches TR-2, TR-3 and TR-6.
- **Why:** Forms still change, and a translator trained on a fixed list falls behind each time; reading by name keeps it current without retraining.
- **Status:** planned (after forms settle) · **Do when:** The set of forms stops changing between pilot rounds.

---

## Assumptions audit (2026-10-17)

Assumptions in the behaviour docs and the main code paths that are **wrong or doubtful against the real world**,
judged against the owner's principles: simulate the real world, not a game; institutions do the work; laws as data;
mechanisms, not outcomes; nobody has a god's view; all work takes time; outcomes such as job creation emerge from
market forces. Each says what is assumed, the evidence, why it is doubtful, which principle it strains, how sure we
are, and its register entry. "Read in code" means the line was opened, not only the doc.

**Outcomes built in rather than emerging**

- **A-1 · Business births happen at the profile's birth rate.** The monthly chance of starting a business is the
  national entry rate times the town's businesses over the people who could start one (`generate.ts`, `found_own_ppm`;
  `citizen.ts` checks only home, savings and the draw). Nothing looks at demand, competitors or the founder's wage, and
  the ABS rate counts registrations that never trade. *Mechanisms, not outcomes; market forces.* Sure: high. ME-1.
- **A-2 · Every strike is won in full after three stoppages** (`firms.ts`, `concede_after` 3, read in code). Hicks's
  concession curve does not say every dispute ends at the claim; real ones end in lockouts, arbitration, a lower
  settlement or closure. *Mechanisms, not outcomes.* Sure: high. PB-9.
- **A-3 · The paper only ever hurts the government** (`news.ts`, read in code: no item kind has tone +1). Negativity
  in news is real; a paper that never reports anything good is not. *Simulate the real world.* Sure: high. PC-7.
- **A-4 · Rents rise about 5% at every review, as often as the law allows, never down for a sitting tenant**
  (`firms.ts`, read in code). The Bank of England model's markup applies to listings; here the landlord's own rents are
  its reference, so it ratchets. Sitting tenants usually get smaller rises than new lets. *Mechanisms, not outcomes.* Sure: high on the mechanism. ME-14.
- **A-5 · Exports are fixed at the opening output.** World demand is "what the factories' opening staff make less the
  town's own purchases" (`calibration.md`, "Chosen, not sourced"), a quota among the first factories. The employment
  base is a gift of the start, not a market. *Market forces.* Sure: high. ME-15.
- **A-6 · Religious decline is fitted as individual fading** (3% a month, fitted to the census trend, which is mostly
  generational). A rate fitted to an outcome made by another mechanism. *Calibrate mechanisms.* Sure: medium-high. PC-10.
- **A-7 · Compliance is a coin flip** (`compliance_bps` in planning, inspector, landlords, union, directions).
  `all-work-takes-time.md` says an error has a cause, never a per-case dial; compliance escaped. *An error has a cause.* Sure: high. PB-16.
- **A-8 · Half of unproven claims are upheld, everywhere** (`uphold_without_proof_bps` 5,000, "no source anywhere").
  Sure: high. PB-2.

**Institutions doing what real ones would not**

- **A-9 · A code council votes on a tenant-against-development line** and almost never passes anything else
  (`government.ts`). Real councils pass most proposals put to them by the mayor or officers. *Institutions do the
  work.* Sure: high. PB-14.
- **A-10 · The code tribunal member weighs nothing but notice and answer**, where au-vic's law asks for a plan to be
  considered and possession to be reasonable and proportionate. The twin is harsher than the place's law. *Laws as data.* Sure: medium-high (section to confirm). MT-12.
- **A-11 · Planning grants anything not forbidden, weekly, hearing nobody.** Real planning advertises, takes
  objections and refers. *Institutions do the work; law as data.* Sure: high. PB-15.
- **A-12 · One union member can bargain and strike for a whole firm, and no employees vote on the agreement.** Real
  enterprise bargaining (Fair Work Act ss 182, 236 to 237) needs majority votes. *Laws as data.* Sure: high. PB-17.
- **A-13 · The bank takes whoever last named the signatories at their word.** A real bank asks for the governing body's resolution. Sure: high. PB-8.
- **A-14 · A failed firm pays debts oldest first.** Employees' entitlements rank ahead of unsecured creditors in
  Australia (Corporations Act s 556) and most places. *Laws as data.* Sure: high. ME-16.
- **A-15 · Employers hire anyone, whatever their trade, at random, with no referrals.** About half of real jobs are
  found through people one knows; skills are matched. Sure: medium-high. ME-2.
- **A-16 · Landlords' upkeep spending leaves town and repairs nothing; disrepair rises on a clock.** Sure: high on the inconsistency. WM-11.
- **A-17 · The weather bureau knows the future.** It reads the run's actual weather and is never wrong. *Nobody has a god's view.* Sure: high. WM-3.

**Rates carried from one context or level to another**

- **A-18 · Tribunal times from other courts:** the Employment Tribunal's 252 days used for rent in gb-eng; a disposal
  time used as time to hearing in de-ni; a statutory ceiling used as the actual wait in in-tn; labour and small-claims
  courts in jp-akita and ke-nakuru. Sure: high. PB-1.
- **A-19 · England's 59% of tenants leaving on an order, used in every place;** 50% staying past notice everywhere,
  unsourced; au-vic's 43% who answer comes from social landlords' hearings and counts a written answer as attending. Sure: high. PB-3, PS-1.
- **A-20 · State per-head averages at a 1,000-person town** (grants, staff per 1,000), where formulas favour small
  rural councils and small councils have minimum staffing; and all council staff counted as works crew with
  administration on top. Sure: medium on size, high on direction. PS-10.
- **A-21 · Survey shares of reported problems used as fault rates** (the World Justice Project's national two-year
  shares, halved, as per-home and per-job rates of faults; a sub-minimum-wage share used as a rate of short pay). Reported problems are not incidence. Sure: medium-high. PB-5.
- **A-22 · Lab and stylised models used as field behaviour:** EWA with λ fitted to matrix games, on 0-to-1 scores, so
  close options are near coin flips; Lengnick's macro rules for prices and wages; Asch's line trials for social
  pressure; Mincer earnings returns used as working speed. Sure: medium. PC-9, ME-16, PC-3.
- **A-23 · Heat adds the same illness at every age**, from a heatwave whose harm fell on those over 75. Sure: medium-high. WM-13.
- **A-24 · Victorian practice in module code:** water bills to owners (`utilities.ts`); the tenants' petition's 90 days
  and 5% (`citizen.ts`). The generality rule says no place in the code; the test does not see these. Sure: high. WM-12, PC-8.
- **A-25 · Hiring cost (8 weeks), horizon (3 months) and hours consent (90%) the same everywhere,** including places where most work is informal. Sure: high that they are carried. ME-3, PS-1.

**Time and work**

- **A-26 · An act takes minutes and a system one second.** Every person row of the table of work is a placeholder in
  minutes; real casework is hours a case; a system's 1 s makes a system-run office effectively unlimited. The
  backlogs the foundations were built to produce are probably several times too small. *All work takes time.* Sure: medium-high. WM-1.
- **A-27 · A seat's reading and searching cost no time; a directory answers at once.** *All work takes time.* Sure: high. SF-10, WM-5.

**People**

- **A-28 · Households do not pool money; income, job and savings are unrelated draws.** Most couples pool; hardship
  clusters. Sure: medium-high. ME-17.
- **A-29 · People leave only on failure and arrive only for jobs.** Sure: high on the mechanism. WM-8.
- **A-30 · Everyone entitled claims, and support does not change job search.** Real take-up is well under full. Sure: high. PB-13.
- **A-31 · Groups are founded only out of grievance.** Sure: medium. PC-11.

**Assumptions checked and found sound** (for the record): the kernel conserves money and draws are deterministic
(the review of the foundations found nothing new); the no-god-view backstop holds for whole registers; the laws of
time are enforced by the kernel and the backstop test; the twin of a mock seat is exact for a year.
