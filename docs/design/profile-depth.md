# Profile depth: what nine places need that the structure cannot yet say (proposal)

**Status:** a proposal (2026-10-08). **Section 1 (track F) is built as far as recommended** (2026-10-09; docs/decisions.md, "Informal work: unregistered jobs, work by the day, and people working for themselves"): parts a and b, and the opening state of c for the kinds that trade; who takes such work up and when is listed in docs/design/ai-citizens.md (Open, 5). Its two unverified points were tried and hold. **Sections 3, 4 and 5 (tracks D and E) are built** (2026-10-09; docs/decisions.md, "A payment and a tax are published laws their offices read"): what was built, what differs from the proposal below and what was left to the citizen redesign and to a yearly assessment are there and in docs/behaviour/public-finance.md, boundary.md and citizen.md. The rest awaits Naz's sign-off. No code, contract or profile figure was changed to write
it, and nothing was run: where it says what a town would do, that is read from the code and the profiles' figures, and
says so.

**What it is for.** Nine profiles now generate a town (docs/profiles.md; decisions log, "A town from any place"). What
remains is what the platform's *structure* cannot express, reported by the profiles' authors in their source notes. This
document takes each in turn: what it is, what stops it, the smallest general change, what it touches, its basis, its
size, and how to test it. Then an order, and what can be built side by side.

**How sources are marked.** *[opened]*: a page I opened while writing this. *(profile)*: taken from a profile's own
source note, which says whether its author opened it. *(to confirm)*: from a search summary or from memory, not
opened. Every reference is listed at the end, for `docs/research/references.md` when a piece is built.

## Summary

| # | Item | The general change, in one line | Touches | Kernel | Contracts | Existing towns change? | Size | Verdict |
|---|---|---|---|---|---|---|---|---|
| 1 | Informal and own-account work | (a) employers that do not register their staff: a compliance figure by kind of firm; (b) work by the day: an agreement's terms; (c) a person who works for themself: the existing venture, run by its owner, from a pitch or from home | generator (jobs), `firms.ts`, `retailer.ts`, `citizen.ts`, measures | none expected | none expected | no, unless a profile states it | large (a, b: medium; c: large) | build a, b and the opening state of c now; *who chooses it and when* belongs to the citizen redesign |
| 2 | Extended households | a household is a nucleus plus optional relatives (parents, a married child's family, others), as shares; the occupancy standard and a home's physical room become the profile's | `household.ts`, generator (people, homes), landlord, migration, `town/households` | none | none | no, unless stated | small to medium | build now |
| 3 | Pension age apart from stopping work | the pension's age is the payment's own (it already is); stopping work is a share in the labour force by age, from which each person's own age of stopping is drawn | generator, `citizen.ts`, transfers, fund, measures | none | none | no, until a profile gives the curve | medium | build with 4 |
| 4 | Unemployment support shapes | a payment is a rule in three parts: who qualifies, how much, for how long; published as a law of whoever pays, read by its office | `world.ts` (transfers), `citizen.ts` (claims), generator, migration | none | none expected (to verify: a law's data) | no (the flat payment is one shape) | medium | build with 3 |
| 5 | Tax shapes | a tax law is a list of charges, each with its base, its schedule, its reliefs and whom it is paid to | `tax.ts`, `firms.ts` (payroll), finance officer, generator (the law), measures | none | none expected | no (today's law is two charges) | medium | build; credits that need a yearly assessment wait |
| 6 | Seasonal storms and hazards | the storm chance by month; "heatwave" becomes one entry in a list of spells (cold is another); energy use by month | `weather.ts`, generator (fields), weather bureau, utilities | none | none | no, unless stated | small | build now; snow, frost on crops, wind damage: not yet |
| 7 | A river's own flow shape | the river's inflow is rainfall passed through a quick and a slow store, or a gauge's monthly flow stated outright; the bank is derived from the river's own floods unless stated | `weather.ts`, generator (water field) | none | maybe one limit (1,000 steps) | no, while the bank is still stated | small to medium | build first: every seasonal place needs it |
| 8 | How money is written | optional fields on a currency: decimal mark, group mark, grouping, sign after, a space by the sign, words for large numbers | contracts (currency), `money.ts`, the kernel resolver's twin, both parsers, generator | resolver only (no physics) | **yes**: `world.currencies` | no (absent means today's way) | small | build once signed |
| 9 | Smaller ones | see the table in section 9 | various | none | none, but for council elections | no | small each | six worth doing, three to leave |

**The short version of the order:** 7 and 6 first (small, and without 7 every town with a wet season is expected to
flood for weeks each year); then 2 and 8; then 3 with 4, and 5; then 1, which is the largest and leans on 4 and 5.
For the Kenyan and Indian towns to hold together it takes 1 (a, b and the opening state of c), 2, and one thing that
is not on the list at all: the profiles' own dwelling mix (section 1, "What this does not fix").

---

## 1. Informal and own-account work

**In the real world.** Two different things travel under one name, and they need different mechanisms.

- *Own-account work*: a person works for themself, with no employer: a stall, a plot, a motorcycle taxi, a trade.
  Their income is what they sell less what it cost. Every place has it; in rich places most of it is registered.
- *Informal employment*: an employee whose employer has not registered the job: no written agreement, nothing
  withheld, no contributions. And *casual* work: hired and paid by the day.

The international definition joins them: informal employment is own-account workers and employers in unregistered
household enterprises, contributing family workers, and employees without social protection (ILO, 17th ICLS, 2003; to
confirm). An informal enterprise is a *household unincorporated enterprise*: not separate in law from its owner (SNA
2008; to confirm).

| Place | What is known | Source |
|---|---|---|
| Kenya | 83.8% of jobs informal in 2025; over 80% of new jobs | KNBS, Economic Survey 2026, via the press (to confirm); the profile says about 84% (profile) |
| India | 58.4% of workers self-employed, 21.7% on regular wages, 19.8% casual labour (2023–24); in urban Tamil Nadu trade, 97% of hired workers are informal, paid ₹140,552 a year against ₹315,188 for formal ones | PLFS annual report 2023–24 (to confirm); ASUSE 2023–24 (profile, opened by its author) |
| Mexico | about half of employment informal | ILO 2018 country table: 52% (to confirm); ENOE for Jalisco (to source) |
| Brazil | about four in ten | ILO 2018: 37% (to confirm); PNAD Contínua (to source) |
| World | 61.2% of the employed are in informal employment | ILO (2018), *Women and Men in the Informal Economy*, 3rd ed. [opened: the publication's page] |
| Australia, England, Germany, Japan, Ohio | own-account work is 10–15% of employment and nearly all registered; farming households in Akita and Ohio are own-account | national labour force surveys (to source per profile) |

**What stops it today.**
- The generator's employers are a fixed list: shops, factories, the builder, the town, the clinic, the school, the
  police (`workplaces`, `worlds/generator/generate.ts`). Every job is an `employment` agreement with fourteen days'
  notice, paid by standing order through the bank, with tax withheld (the same file, the loop over adults).
- A person is in work only by `spec.employed_bps` of the labour force, up to the job slots those employers have.
- The citizen's only way to earn is to apply for a posting (`citizen.ts`, "Work"). Founding a business needs savings
  for premises and a shop's capital, the founder keeps their job, and the shop hires staff (docs/behaviour/entry.md:
  "Leaves out: the founder working in their own business").
- The measure counts a person as employed if they hold a signed employment agreement
  (`measure/queries/economy/summary.sql`).

The kernel does not stand in the way: "who works for whom is content (agreements), never physics"
(`contracts/blocks.schema.json`, `work`). It checks only that the people doing a task are in a space of the task's kind
and have hours left.

**The change, in three parts. Each is general; none names a kind of place.**

*(a) Employers that do not register their staff.* Informal employment is an employer not doing what the payroll law
says. The platform already has the pattern: a landlord complies with a law with a probability (`compliance_bps`), and
"a firm that can't pay it over just fails to; the collector doesn't chase (yet)" (docs/behaviour/public-finance.md).
- Profile: `employment.registered_bps` by kind of firm (the share of that kind's jobs that are registered), with source.
  Left out: all registered, as today.
- Rule: an employer that does not register a job pays the agreed wage whole, withholds nothing, reports nothing. The
  worker of an unregistered job builds no contribution record (this matters for section 4: no insurance payment
  later, which is true to life).
- Who would catch it: a labour or tax inspector, as an office. Not built here; without it, the share is a stated fact
  of the place and stays put. That is honest for a first step and should be said in the module's doc.

*(b) Work by the day.* A casual job is an agreement with other terms, which the agreement record can already say: pay
for each day worked, no notice. Profile: `employment.casual_bps` by kind of firm, and the daily wage in
`wages_per_pay_period` terms (a day's pay with `pay_period_days` 1 for that kind). Rule: a firm takes casual hands for
the days it has work (the builder for a job; a factory for an order), from those who turn up at its posting that day.
`Staffing` (`firms.ts`) holds hiring, paying and letting go for every employer, so it is one place to add it.

*(c) A person who works for themself.* This reuses what exists: a *venture* (docs/behaviour/entry.md) is already a
template for a business a person founds. Three things are added to a venture, all data:
- `operator: owner`: the founder does the work themself (they are the performer of its tasks) and hires nobody until
  the business can pay a wage;
- `premises`: `bought` (today's), `pitch` (a place in a market the town keeps, for a daily or monthly fee paid to the
  town: who actually does this is the municipality, which is how market traders are licensed and charged in all four
  places; to confirm per place), `home` (the founder's own dwelling), or `plot` (land the founder holds or rents);
- `capital`: small, derived as a shop's is (a few days' stock, not a month's, and no wages).

A profile lists the place's own-account trades as ventures (`work.own_account: [{ id, task, premises, stock_days,
share_bps }]`): a petty trader buys from the town's shops or factories by their trade lists and sells in small lots at
a markup; a smallholder makes goods on a plot and eats part of them. The business's rules are the retailer's and the
producer's that exist (restock, price, serve), run by its owner. The enterprise is an entity in the platform's
bookkeeping sense only; whether it is *registered* is (a)'s figure.

*What is deliberately not in (c) yet:* services sold to households (a ride, a repair). Households today buy goods
only, so a motorcycle taxi has no customer. That needs a household's demand for services, which belongs to the
citizen redesign (an offer a person takes up: docs/design/ai-citizens.md 2a).

**Who enters, and what they earn: the basis.**

The development literature has three standard accounts, and the evidence is that all three hold at once:

| Model | What it says | What a rule built on it needs |
|---|---|---|
| Harris and Todaro (1970), already used for migration (docs/behaviour/boundary.md) | People queue for scarce formal jobs; the expected formal wage is the wage times the chance of getting one | the formal wage, the chance of a formal job (postings over seekers) |
| Fields (1975): a free-entry urban sector beside the queue | Someone who cannot afford to wait works in an easy-entry sector and keeps looking, less effectively; open unemployment is far lower than Harris and Todaro predict (to confirm: read as a search summary of the abstract) | how much less often someone in own-account work looks at postings (his search-efficiency parameter); what the easy sector earns, which falls as it fills |
| Maloney (2004): a voluntary small-enterprise sector | Much self-employment is chosen, by older workers with savings and experience, for independence; it is "an unregulated microentrepreneurial sector and not ... a disadvantaged residual" (abstract, to confirm) | the chance someone in a job with enough saved leaves to work for themself |
| Günther and Launov (2012) | Both exist together: an upper tier by choice and a lower tier of last resort (Côte d'Ivoire; abstract, to confirm) | nothing new: it says build both |
| La Porta and Shleifer (2014) | Informal firms are small, unproductive, run by the less schooled, and rarely grow into formal ones: informality "arises out of poverty" [opened: abstract] | own-account ventures stay small; they are not small shops on the way up |

The proposed rule, for today's code citizen, in the fewest parameters:
1. **Last resort (Fields).** Out of work, in the labour force, and either no payment to the unemployed exists here or
   savings are under `own_account.when_savings_under_months` of essentials: take up the own-account trade they can
   afford the stock for. In a place with unemployment insurance the trigger rarely fires, with no special case. This
   is one more method under the existing goal "making ends meet" (`citizen.ts`, goals).
2. **Still looking.** In own-account work they keep reading the postings, as someone in a job does today (monthly),
   not weekly as the unemployed do. That ratio is Fields's parameter; the existing two cadences give it a value
   without a new figure.
3. **By choice (Maloney).** The existing monthly chance of founding a business (`found_bps`), now that a venture can
   need little capital and be run by its owner.
4. **Earnings are not a parameter.** A trader earns what households buy from them. More traders share the same
   custom, so earnings fall as the sector fills. The ratio of own-account to formal earnings is a *target* to measure
   against, never set (calibrate mechanisms, not outcomes).

*How households combine it with formal work.* The literature is on livelihood diversification (Ellis 1998; Barrett,
Reardon and Webb 2001; to confirm) and the farm household that both makes and eats its output (Singh, Squire and
Strauss 1986; to confirm). Today each adult decides alone and other adults pay a share of the rent, so a household
with one formal wage and one stall already happens with no new rule. What is missing is a household deciding
together who does what, and family members helping unpaid. **That needs the citizen redesign first:** it is a
household's joint decision, and today's citizen has no such thing.

**What it touches.** Generator: the job loop (shares by kind of work at the start; opening stock for own-account
traders; a market with pitches as a structure type the town owns). `firms.ts` (`Staffing`: unregistered and casual
terms), `retailer.ts` and `producer.ts` (an owner who is the staff), `citizen.ts` (one goal method; the venture's new
fields), `government.ts` (the pitch fee as town revenue). Measures: employed becomes "did work for pay or profit in the
week, or holds a job" (the labour force surveys' own definition: ILO, 19th ICLS, one hour in the reference week; to
confirm), read from the log's work and agreements; and new columns for own-account and unregistered shares.
Kernel: none expected. To verify before building: that a person may be the performer of a task in a business where
they hold the only position, and that a task may be set in a dwelling or a market pitch (task definitions are world
config). Contracts: none expected. **Existing towns: unchanged** while their profiles state none of it.

**Under the new knowing rules** (docs/no-god-view.md): a trader's prices are up at their pitch and seen by those who
pass, as a shop's are; the town knows its own pitch holders (it keeps that list: its fee book); nobody is shown all
traders. The statistics office would learn the informal share by a sample, as a labour force survey does, not by a
register.

**What this does not fix.** The Kenyan town's rent at 85% of wages is not only missing informal work. Its homes are
three one-bedroom, seven two-bedroom and two three-bedroom flats a block, the first profile's mix, at Nakuru's urban
rents (a two-bedroom at KSh 13,000 against a fortnight's shop wage of KSh 8,577). People on those wages rent a single
room. The dwelling mix and rents are the profile's figures and its author's to restate (a one-room unit is already
expressible); a second earner from own-account work helps, and does not close a gap that size. Said here so that
nobody expects item 1 to move that number by itself.

**Size, dependencies, risks.** Large. (a) and (b) medium, and can go first. (c) large: the retailer and producer
assume staff. Leans on 5 (what is withheld) and 4 (a contribution record); can be built without them, with (a) simply
meaning "nothing withheld". Risks: shops' expected sales at the start are reckoned from wages
(`generate.ts`, the block before the job loop) and must count own-account income; unmet demand may rise or fall in
ways not predicted; a town of a thousand people gains several hundred small sellers, each a participant with a price
list, so a month's run time has to be measured.

**Tests and targets.** Tests: a town whose profile states none of it is byte-identical; an unregistered job pays the
gross and reports nothing; a casual hand is paid for days worked only; an own-account trader with no custom stops and
looks for work; with twice the traders each sells about half. Targets a profile can give: the share of employment
that is own-account, casual and unregistered (KNBS, PLFS, ENOE, PNAD Contínua); own-account earnings against a
regular wage (PLFS publishes all three; urban India, April–June 2024: regular wage ₹24,434 a month, casual ₹516 a day;
to confirm); open unemployment (low where there is no payment to wait on).

---

## 2. Extended and joint-family households

**In the real world.** A household of relatives beyond one couple and their children: grandparents with a child's
family (three generations), married siblings together, a nephew or a widowed aunt.

| Place | Share | Source |
|---|---|---|
| Akita (Ikawa) | 412 of 1,515 households of known type are "other relatives" households: 27% | Census 2020, table 12-3 (profile, opened by its author) |
| Jalisco | 25.0% of family households are extended, 1.2% compound: 22.5% of all households | IIEG from INEGI Censo 2020 (profile, opened) |
| Tamil Nadu | no table by type; mean urban household 3.85 people, 4.7% live alone | Census 2011, HH-01 (profile, opened) |
| Kenya | 28.5% of households are nuclear; mean 3.8 (Nakuru 3.6); 29.6% have five or more people | KNBS 2019 census and 2023/24 Housing Survey (profile, opened) |
| Brazil, Ohio, England, Germany, Victoria | a few percent; in the first profile "other family" is 1.6%, counted as a group | each profile's census (profile) |

**What stops it today.**
- `HouseholdSpec` has five kinds and `drawHousehold` draws exactly those (`participants/src/behaviour/household.ts`).
  Authors put extended households in with groups (India: 31% "groups" of two or three unrelated adults) or with
  couples with children (Akita, Jalisco), so generated households are smaller than the census's.
- The occupancy standard is one country's (the Canadian National Occupancy Standard: `bedroomsNeeded`, and the
  landlord's refusal above two people a bedroom, `max_people_per_bedroom`). A home's physical room is `2 × bedrooms +
  2` for every place (`capacityFor`, `generate.ts`). In the Kenyan town 1,579 acts were refused because a home was
  full.

The household record itself is not in the way: it already lists members, *couples* (more than one) and who holds the
lease, and other adults already follow the leaseholder and pay a share.

**The change.**
- A household is a **nucleus** (today's five kinds, unchanged) **plus optional extensions**, as data:
  `households.extended_bps` (the share of family households that are extended) and `households.extensions`, a list of
  `{ kind: "parents" | "child_family" | "relative", share_bps, count: [lo, hi] }`: the head's parent or parents (ages
  following the head's, as parents' ages follow children's now); a grown child's own couple and children; one or more
  other relatives. Left out: nothing is drawn, and the draws a town makes are the same as today's.
- The **occupancy standard is the profile's**: `households.occupancy` (the most people a bedroom, from what age an
  adult has their own, whether a living room is slept in). The rule's form stays general; its figures become a
  place's. The landlord's ceiling comes from the same figures.
- A home's **physical room** is a profile figure too (`homes.bodies_per_bedroom`, `homes.bodies_besides`), since it
  stands for floor area, which differs by place.
- The profile's house sizes already are data (`house_types`): a place with large households states larger houses.

**What it touches.** `household.ts` (the spec and the draw), the generator (homes to households by need),
`firm.landlord` (one parameter), `world.migration` (it draws from the same spec), `town/households` (overcrowding by
the place's own standard; I would add a second column by one fixed yardstick, people per room, so places can be
compared: UN-Habitat's "more than three to a room", to confirm). Kernel and contracts: none. **Existing towns:
unchanged** unless a profile states extensions or its own standard.

**Basis.** For the draw, none is needed: it is a census share. For behaviour inside an extended household there is a
literature, and nearly all of it is about decisions today's citizen does not make: who pools income (the unitary
household against the collective one: Chiappori 1992; to confirm), grandparents' childcare raising mothers' work, and
care of the old at home. **Those belong to the citizen redesign.** What today's citizen already does is enough for a
first step: the leaseholder budgets on the household's income, adults split the rent among earners, a pension counts
as income. One thing to record honestly: today no household ever forms or splits (docs/behaviour/households.md, "not
here yet"), so the share of extended households in a long run drifts upward everywhere as children come of age and
stay. That is an existing gap, not made by this change, and it will show more in these places.

**Size, dependencies, risks.** Small to medium. No dependencies. Risk: authors must restate their household shares
once the kind exists (the Indian, Japanese, Mexican and Kenyan profiles each folded it into another kind), and the
adult age bands derived from the census (`adultAgeBands`) must count the extensions' adults, or the old are counted
twice.

**Tests and targets.** Tests: with no extensions, every draw as before; mean household size and the share with three
generations within a tolerance of the stated shares over 20,000 draws; a three-generation household is placed in a
home the place's standard allows. Targets: mean household size (3.85, 3.6, 3.0, and Jalisco's to source); the share
of people 65 and over living with a child (each census has it; to source).

---

## 3. Pension age apart from the age people stop work

**In the real world.**

| Place | Pension age | Early or late claiming | Stopping work | Source |
|---|---|---|---|---|
| Victoria | 67 | none (means-tested) | no retirement age | (profile) |
| Ohio | 67 for those born 1960 on | from 62 at a permanent reduction; later, more | none | SSA (profile, to confirm) |
| England | 66 | none early | none | (profile) |
| Germany | 67, phased by year of birth (66 for 1958 to 66 years 10 months for 1963) | earlier with 45 insured years, or at a deduction | at the pension, mostly | SGB VI §235 (profile, opened) |
| Japan | 65 | 60 to 75, less if early, more if late | 52.0% of 65–69s and 34.0% of 70–74s were in work in 2023 | Labour Force Survey, as reported by nippon.com [opened]; (profile) |
| Brazil | 65 for men, 62 for women, with a minimum of contributions | — | — | 2019 reform (to confirm) |
| India | 60, for the poor only | — | most work on; formal jobs end at 58–60 | NSAP (profile, opened) |
| Kenya | 70 (the cash transfer); public service retires at 60 | — | "most ... carry on until they can't" | (profile, placeholder) |
| Mexico | 65, universal | — | many work on | (profile, to confirm) |

**What stops it today.** One figure, `retirement_age`, does six jobs: the generator gives nobody over it a job and
gives them the retired's savings (`working()`); the citizen at that age gives notice, never works again, and claims
the retired's payment (`citizen.ts`, `retired`); the unemployment payment ends the year before it; a retirement fund
pays from it; the measures call everyone under it "of working age"; and it caps the weights in who owns what. The
pension's own `from_age` exists in the profile but every profile had to set it equal.

**The change.** Take the one figure apart.
- **The pension's age is the payment's** (section 4's rule holds it): by sex where a place has that, by year of birth
  where it is phased (a short table), with an early age and a reduction for each month early, a late age and an
  increase, and whether working stops it.
- **Stopping work is behaviour, from an observable curve.** Profile: `labour_force_participation_by_age` (a share by
  age band, by sex where the survey gives it), which every labour force survey publishes. Each person is given, once,
  the age at which they stop, drawn so that the shares in the labour force by age come out as the curve says (if 80%
  are in at 55–59 and 52% at 65–69, then of those in at 59, 35% have stopped by 69). This is how the average age of
  leaving the labour market is itself measured from participation rates by age (OECD's method for the "effective age
  of labour market exit"; to confirm). The single `labour_force_participation_bps` stays as the fallback.
- **Claiming** stays as simple as it is: a person claims the pension when they stop work if they are old enough to
  claim early, and otherwise at the pension's age; someone still working claims at the pension's age if the rule lets
  them work and draw.
- `retirement_age` alone keeps meaning what it means today: both things at once. A profile that gives the curve and
  the pension's own age is using the new form.

**What it touches.** `profile.ts`; the generator (`working()`, the shops' expected sales, the retired's savings, which
become "savings by age" all the way up); `citizen.ts` (`retired` splits into "stopped work" and "claiming"; a person
past the pension age may hold a job); `world.transfers`; `fund.retirement` (its access age is its own figure); the
measures (working age becomes a stated band, the same for every place, so employment rates compare). Kernel,
contracts: none. **Existing towns: unchanged** until their profile gives a curve; then they change by decision (in the
first profile's town some under 67 will have stopped and some over it will work).

**Basis.** The curve is data. That people's leaving bunches at the ages a pension can first be claimed is one of the
best-established findings there is (Gruber and Wise 1999; Stock and Wise 1990, the option value of working on; both
to confirm). A rule in which the pension's terms *move* the age of stopping (change the early-claiming reduction, and
people work longer) is the right richer rule and **belongs to the citizen redesign**: it is a weighing of an offer's
terms, which is what that design's mind does. Until then the curve is fixed for a run, and a steward who changes the
pension age changes who is paid, not who works. That limit must be written in the module's doc. Employers that end a
job at an age and rehire at lower pay (Japan's practice) are an employer's rule, later.

**Size, dependencies, risks.** Medium. Built with 4 (the same payment rule). Risk: the citizen's `retired` flag is
read in a dozen places; the pension counted as "income that keeps a household in town" must not also be earned income
twice for someone who works and draws.

**Tests and targets.** Tests: a profile with only `retirement_age` gives byte-identical towns; drawn stopping ages
reproduce the curve within tolerance; a person past the pension age in work is paid both where the rule allows.
Targets: employment by age band at 55–64, 65–69 and 70 and over (Japan: 52.0% and 34.0%); the share drawing a pension
at each age.

---

## 4. Unemployment support shapes

**In the real world.**

| Place | Shape | Source |
|---|---|---|
| Victoria | flat, means-tested, no time limit | (profile) |
| England | flat, means-tested (and a six-month contributory one) | (profile; to confirm) |
| Ohio | about half the previous weekly wage up to a maximum ($624 in 2026); at most 26 weeks; needs a work history | Ohio JFS, ORC 4141.30 (profile, to confirm) |
| Germany | insurance: 60% of previous net pay (67% with a child), 12 months for those under 50 with 24 insured months, after 12 insured months in the last 30; then a flat means-tested payment (€563) with housing costs paid on top | SGB III (search summary, to confirm); (profile) |
| Japan | 50–80% of the previous daily wage, more for the low-paid, capped by age; 90 to 360 days by age, insured time and why the job ended | Hello Work (profile, opened) |
| Brazil | insurance of three to five instalments linked to the wage; and a family transfer on household income a head (up to R$218; at least R$600 a family, R$150 more for each child under six) | Bolsa Família rules (search summary, to confirm); (profile) |
| India | none; a guarantee of paid work, and a state payment to women heads of household | (profile, to confirm) |
| Kenya, Mexico | none | (profile) |

**What stops it today.** `world.transfers` (`participants/src/behaviour/world.ts`) knows a payment as `{ amount,
every_days, from_age, to_age }`. It grants on the stated date of birth alone, pays the same sum to everyone, for ever,
one payment a person. It has no record of anyone's work or household. The citizen claims one of two kinds by name
(`support_kinds`: retired, unemployed).

**The change.** A payment is a rule in three parts, each from a short list. The list is general; a place's payment is
a choice from it with its figures.

- **Who qualifies** (all that are listed must hold): an age range (by sex or year of birth where needed: section 3);
  out of work; an insured record (so many days of registered work within so many days past); household income a head
  under a sum; a child in the household; sex; and, for a pension, years of contributions.
- **How much:** a flat sum; or a share of the previous wage (gross or after tax, with a floor and a cap, and another
  share with a child); or a sum for a household (a base, more for each child by age, or a top-up to a level).
- **For how long:** no limit; or so many days (by age or insured time, as a short table), then nothing or *another
  named payment* (Germany's insurance, then its flat payment); and a waiting time before the first.

Several payments may be drawn at once (a pension and a family transfer). "None" is already sayable (leave it out).

**The rule is a law, not a module's setting.** It is published by whoever pays (for a town, the outside world), as
the income tax law is, and the paying office reads it. That keeps "no laws in the kernel, every law is data", lets a
person read what they may claim, and lets a later world put a national government inside it and change the law.

**Who actually checks, and with what.** The office decides on evidence, as its real counterpart does, and it is shown
nothing whole that it does not keep:
- *An insured record:* employers already send a monthly `withholding_report` to the collector. With section 5 a
  contribution goes to the insurance fund's own office, which thereby keeps its own book of contributions, entry by
  entry addressed to it (a keeper, in docs/no-god-view.md's sense). An unregistered job (section 1) leaves no entry,
  so no insurance: true to life, with no special case.
- *The previous wage:* from the same book.
- *Household income and children:* the claimant states them, with the household's record; the office takes the
  statement as true, as it takes a date of birth as true now, and may check it against its own book. Lying is then
  possible and uncaught, as under-reporting rent was; an audit is a later module.

**Behaviour, and its basis.** The citizen reads the law and claims what it fits, as it claims now. One sourced
parameter is added: **take-up**, the share of the eligible who claim (well under all of them in most places; a
profile figure, to source per place). What is *not* changed: how hard or how choosily people look for work while paid.
The literature is clear that longer or richer insurance lengthens spells and that leaving bunches at exhaustion
(Meyer 1990; Schmieder, von Wachter and Bender 2012; Chetty 2008; all to confirm), but today's citizen applies for
one posting a week and takes what it is offered: it has no reservation wage for a benefit to raise. Giving it one is
a behaviour change that needs that basis worked into a rule, and it **belongs to the citizen redesign**. Until then
a time limit changes people's income and when they give up and leave town, and nothing else. Say so in the doc.

**What it touches.** `world.ts` (transfers: reading the rule, evidence, duration, the hand-on to the next payment),
`citizen.ts` (what to claim, from the law), the generator (the profile's `support` block becomes a list of payments;
the shops' expected sales), `world.migration` (it reads the published count of those paid for being out of work: that
count must be of every such payment). Kernel: none. Contracts: none expected (to verify that a law's `data` may hold
the rule; it holds the tax law's brackets today). **Existing towns: unchanged**: today's payment is the flat, age-only,
unlimited shape.

**Size, dependencies, risks.** Medium. Wage-linked and contribution-tested payments need the contribution book, which
comes cheaply with 5 and can be stood in for by the collector's existing reports. Risk: the published count of
recipients is a signal migrants act on; where there is no payment there is no count, and the migration rule has to
say what a would-be migrant then knows about a town's unemployment (today: nothing, and people come regardless).

**Tests and targets.** Tests: the flat shape is byte-identical; a claimant with ten insured months is refused where
twelve are asked; payment stops on the day the limit says and the next payment starts if one is named; a household
over the income line is refused. Targets: recipients as a share of the unemployed; the replacement rate at the
average wage (OECD publishes net replacement rates in unemployment for six of the nine; to confirm).

---

## 5. Tax shapes

**In the real world** (each from the profile's own note on what it could not say):

| Place | What could not be said |
|---|---|
| Ohio | a wage cap on the social-security contribution; credits; the municipal income tax of 1–3% of wages, "the main revenue of Ohio municipalities"; a school-district income tax |
| England | the personal allowance tapering away; two rates of National Insurance; the employer's contribution |
| Germany | a continuous tariff (the marginal rate rises in a straight line through two zones); contributions to four separate funds, each with a ceiling; a surcharge on the tax |
| Japan | a deduction for employment income (itself a schedule); a basic deduction; a flat local resident tax of 10%; a surtax of 2.1% of the tax |
| Brazil | a contribution with rising rates and a ceiling, paid to the pension institute, not to general revenue |
| India | a standard deduction; a rebate that makes income up to ₹12 lakh tax-free; a cess of 4% of the tax |
| Kenya | a personal relief of KSh 2,400 a month taken off the tax; three separate levies; a pension contribution in tiers |
| Mexico | an employment subsidy for low pay; the worker's social-security share |

**What stops it today.** A tax law is `{ brackets, levy_bps, levy_from, collector, account }` (`IncomeTaxLaw`,
`participants/src/behaviour/tax.ts`): marginal rates on gross pay, and one levy on the whole of an income from a
threshold, all paid into one account.

**The change.** A tax law is an ordered **list of charges**. Each charge is data in four parts:

- **Its base:** the pay; less deductions (a flat sum, or a share of pay within a least and a most); held between a
  floor and a ceiling (a contribution ceiling; a threshold below which nothing is due); or *the amount of another
  charge* (a cess or a surtax on the tax).
- **Its schedule:** bands, each with a marginal rate at its start and at its end. Equal rates are today's steps; a
  rate that rises through a band is Germany's tariff exactly, since its zones are straight lines in the marginal rate
  (EStG §32a, as quoted in the German profile). A whole-income rate from a threshold is today's levy.
- **Its reliefs:** sums taken off the tax (a flat credit; one that shrinks as income rises; one that wipes the tax
  out below an income), never below nought.
- **Whom it is paid to:** a collector and an account, for each charge. A local income tax is a charge paid to the
  town. A pension contribution is a charge paid to the fund.
- And **who bears it**: the worker (withheld) or the employer (on top of the wage).

Today's law is two charges of this form, and gives the same sums to the smallest unit.

**What it touches.** `tax.ts` (`annualTax` over charges); `Staffing` in `firms.ts` and the town's finance officer
(what is owed to each payee, a report to each); the generator (the law's record and its wording); the citizen (it
reads the same law to know its net pay: no new code beyond the function); firms' wage cost where an employer's
charge exists (the retailer's and producer's reckoning of what a worker costs). Measures: `paid_to_town` gains what
a local income tax brings. Kernel: none. Contracts: none expected (the law's `data`). **Existing towns: unchanged.**

**What should wait.**
- *Credits paid out as money* (a refundable credit; a credit for children): they are settled in a yearly
  assessment, which does not exist ("Leaves out: the yearly assessment, refunds and offsets",
  docs/behaviour/public-finance.md). Building the assessment is its own piece; not worth it for this.
- *Withholding on the year so far* rather than on each pay taken as a year's: only matters for people whose pay
  changes in the year. Leave.
- *A tax on a small trader's turnover* (the presumptive regimes of Brazil, Mexico, Kenya and India): it is a charge
  whose base is reported sales, collected by the retired tax clerk's method (a report, then an assessment). It comes
  after section 1(c), and uses modules that exist.

**Basis.** None is needed for the arithmetic: it is each place's law. One behaviour point: an employer's charge
raises what a worker costs, and firms' hiring reads that cost; that is existing behaviour seeing a true figure.

**Size, dependencies, risks.** Medium. No dependencies. Risks: rounding (withholding is rounded down at three
points; the two-charge case must be tested equal for all nine laws before anything else moves); a law written in
words by the generator must still be readable when it has six charges.

**Tests and targets.** Tests need no run: for each profile, the tax on a ladder of incomes against the worked
examples its tax office publishes; today's nine laws equal under the old and new functions. Target: the average tax
taken from a single worker on the average wage (OECD, *Taxing Wages*, publishes it for the six member countries; to
confirm), compared with the function's answer.

---

## 6. Seasonal storms and other seasonal hazards

**In the real world.** Tamil Nadu's storms come with the north-east monsoon, October to December; Jalisco's from
June to October; Akita has typhoons in late summer and deep snow all winter, with kerosene heating "a large part of
an Akita household's energy"; Nakuru has no heatwaves and cold nights near 4°C in January and July; Ohio and Lower
Saxony have a heating season (each from the profile's own `climate` and `utilities` notes).

**What stops it today.** `drawWeather` (`worlds/generator/weather.ts`) takes one `storm_bps_per_month` for every
month. Heatwaves are the only spell, though they are already seasonal (`summer_months`). There is one weather field,
`heat`. A household's energy use is one figure a day all year (`utilities.ts`).

**The change.** Three small ones, each data.
- **`storm_bps_by_month`**: twelve chances in place of one. The one figure means the same in every month, and the
  draws made are the same in number and order.
- **Spells as a list.** `climate.spells`: each `{ id, months, bps_per_week, days, units, built_units, illness_bps_per_unit }`.
  Heat is one entry; a cold spell is another. The kernel already has all it needs: a field whose sources are scaled
  by day, and illness by field. The weather bureau warns of each by its id.
- **Energy use by month**: `utilities.energy.use_by_month_bps`, twelve shares of the year's daily mean, read by the
  energy retailer. Heating and cooling seasons, with no second fuel.

**Not worth it yet, and why.**
- *A second fuel* (kerosene, charcoal, gas): the monthly shape and the price carry most of what a household's budget
  feels. A second supplier and bill is a module for little.
- *Snow* that slows travel and that the town's crew must clear: real, and Akita's budget shows it, but it is a field
  on roads plus a new duty of the works office: medium, for one place. Record Akita's snow-clearing spending as a
  target and build it if a Japanese pilot wants it.
- *Frost on crops*: there are no crops until section 1's plots.
- *Wind damage* to buildings: wear by a field other than water; wait for a place that needs it.

**Basis.** Cold kills more than heat in most climates studied, and the old most (Gasparrini et al. 2015, *The
Lancet*; to confirm): the cold spell's `illness_bps_per_unit` is a profile figure with that kind of source, as the
heat's is now (and the heat's own source is still marked to confirm).

**What it touches.** `weather.ts`, the generator's field list, `world.weather`, `utilities.ts`, `profile.ts`.
Kernel and contracts: none. **Existing towns: unchanged.**

**Size, dependencies, risks.** Small. Shares `weather.ts` with section 7: one piece of work, one author. Risk: none of
note.

**Tests and targets.** Tests: over many drawn years, storms fall in months in proportion to the chances; a profile
with the single figure draws the same weather as before; a cold spell raises illness as a heatwave does. Targets:
the months of a place's recorded floods and storms (each country's disaster register); winter's share of the year's
energy use; winter's excess of deaths.

---

## 7. A river's flow, apart from rainfall

**What happens today.** The profile's `rain_by_month_bps` is used directly as the river's inflow
(`source_by_day`, `generate.ts`, the `water` field). The river loses a tenth a day and passes half downstream, so its
level follows the month's inflow within days. The bank is a stated level, `hazards.river_bank_kl`, the same figure in
eight of the nine profiles: 12,000 against a usual level of about 9,000, a third above (the English one has 16,500).

So a month whose rain is well over a third above the year's mean puts the river over its bank for the whole month.
The Brazilian profile's January is 2.54 times the mean: the town floods from day 5 (4,576 refusals in 60 days;
decisions log). **Read from the figures, not run:** the same should happen to the Indian town from October to
December (2.28, 2.52, 1.56), the Mexican from July to October (2.07, 2.40, 2.47, 1.81), the Kenyan in April and
May (2.00, 1.45), and it does happen to the Ohio town (1.59 to 2.12 from January to April; 1,270 refusals). They
showed nothing in the sixty-day runs only because those runs were January and February.

**Two things are wrong, and they are separate.**

1. *Shape.* A river is not its rain. Part of a month's rain reaches it within days; part goes into the ground and
   comes out over months (baseflow), which is why rivers run in the dry season and why the monthly range of flow is
   narrower than that of rain.
2. *The bank.* A river's channel is cut by its own floods. Flow fills the channel to its banks about once in one to
   two years, across many rivers (Leopold, Wolman and Miller 1964; Williams 1978 found a wider spread; both through
   a secondary summary, to confirm). A bank at a third above the mean, the same for a monsoon river and a
   temperate one, is a placeholder that happens to suit the first profile.

**The change.**
- **The river's regime, stated one of two ways** (`river`, in the profile):
  - *from a gauge:* `flow_by_month_bps`, the river's own mean flow by month, where the author has one (the Ohio
    author already used the Sandusky gauge and had to call it rain). An observation, and the better choice; or
  - *from rain:* `baseflow_index_bps` (the share of the year's flow that is baseflow, a published descriptor of a
    catchment) and two recession times in days, quick and slow. The generator passes the drawn rain through two
    stores, each the textbook linear reservoir: tomorrow's outflow is today's times a decay, plus the inflow times
    one less that decay (de Zeeuw 1973; Kraijenhoff van de Leur 1973, as given in Wikipedia's "Runoff model
    (reservoir)" [opened]). The mean flow is kept: what goes in comes out.
- **Storms go through the same stores**, so a spell rises and then falls away over days, where today it is a square
  pulse.
- **The bank is derived unless stated.** With `river_bank_kl` left out, the generator draws a long stretch of the
  place's weather (a fixed number of years from a seed of its own, as it draws 20,000 households to find the adult
  age bands), routes it, and sets the bank at the level reached on average once in `bankfull_return_years`. That
  figure is the rule's parameter from the literature (about 1.5), which a profile may restate with a source. A
  profile that still states its bank keeps it, and is unchanged.

All of this is in the generator, before the run: the kernel still receives a list of inflow steps and knows nothing
new.

**What it touches.** `weather.ts`, the `water` field's block in `generate.ts`, `profile.ts`, docs/behaviour/weather.md
and floods.md. Kernel: none. Contracts: possibly one figure. A smooth series changes every day, and
`source_by_day` holds at most 1,000 steps (`contracts/world-config.schema.json`): rounding the series to whole
percents and joining equal days should fit several years; if a five-year run does not fit, the limit needs raising,
and that is a contract change to ask for. **Existing towns: unchanged** while they state a bank and give no `river`.
When the first profile's author removes its stated bank, its town changes, by decision.

**What it does not do.** How often a *building* floods still turns on where buildings stand and on the stated depth
that floods one. That is as it should be: a town built on the flood plain floods. Wetland lowering a flood's peak
is still not modelled (docs/behaviour/floods.md).

**Size, dependencies, risks.** Small to medium. Shares its file with section 6. Risk: the derived bank makes floods
rarer everywhere at once; the flood tests of the first profile's town use a scripted `weather` of four times the
usual rain and should be unaffected, to check.

**Tests and targets.** Tests on pure functions, no run: routed flow has the mean of its rain; a single wet day comes
out as a rise and a recession of the stated length; over 500 drawn years the river tops the derived bank about once
in the stated return period; the Brazilian profile's ordinary January does not flood. Targets: a gauge's monthly
flows where one exists (each country's hydrological service publishes them); the number of flood events a decade in
the place's disaster records.

---

## 8. How money is written

**In the real world.** Brazil writes `R$ 1.234,56`. Germany writes `1.234,56 €`, the sign after. India writes
`₹1,23,456`: three digits, then twos, with *lakh* (100,000) and *crore* (10 million) as words (Wikipedia, "Indian
numbering system" [opened]). Kenya writes `KSh 1,234.50`, a space after the sign. Japan has no decimals and its own
large-number words. The standard reference for each place's pattern is Unicode's CLDR (to cite per profile).

**What stops it today.** A currency in the world's config has a code, decimal places, a sign and words
(`contracts/world-config.schema.json`, `currencies`; `Currency` in `participants/src/money.ts`). `formatMoney` and
the resolver's twin always write the sign first, commas in threes and a point. The parsers read every form that can
only be one number and refuse what cannot be told ("1.234"); *lakh* and *crore* are in the parser's own word list
(`participants/src/calls.ts`), which is one place's words in platform code.

**The change.** The proposal on file (decisions log, "The translator reads any world's money") is `decimal_mark`,
`grouping`, `symbol_after`. I would sign it with three additions, all optional:
- `decimal_mark`: `"."` or `","`;
- `group_mark`: `","`, `"."`, a space or an apostrophe (it does not follow from the decimal mark: French and Swiss
  writing differ from German);
- `grouping`: `[3]` or `[3, 2]`;
- `symbol_after`: true where the sign follows;
- `symbol_spaced`: true where a space stands between sign and digits;
- `number_words`: the place's words for large numbers with their values, read by the parser *for that world*. The
  general ones (thousand, million) stay in code; lakh and crore move to the Indian profile.

Absent, each means what happens today. With the mark known, "1.234" is read where it is now refused.

**What it touches.** The currency's schema (**a contract change, for sign-off**); `money.ts`; the kernel resolver's
`format_money` and `parse_amount` (presentation only: no physics); `parseAmount`; the shared table
`contracts/test/amounts.json`; the generator (it passes the block through); each profile's `currency`, with CLDR as
the source. The translator's instructions do not change (it is told no currency, on purpose). **Existing towns:
unchanged.**

**Size, dependencies, risks.** Small. Risks: the translator's trained model has never seen a sign after the digits,
a decimal comma or lakh in a seat's own voice (docs/handover.md), so towns that *show* money this way will be read
worse until it has; measure before trusting. Another branch is working in these files now: this is one author's
piece, not a parallel one.

**Tests and targets.** Tests: both writers and both parsers against the one table, a row for each of the nine
places; what a world writes, its own parser reads back to the same number. No calibration target.

---

## 9. Smaller ones

| What | In the real world | The general change | Size | Verdict |
|---|---|---|---|---|
| **Town revenue from above** | The Brazilian town's grants are 376 times its rates; Akita's nine times (the profiles' own figures) | Already sayable: `grants_per_resident_per_year` is high. Missing are the *rules* of a grant: a share of a tax collected in the town (a German municipality's share of income tax), need less capacity (Japan), tied to a purpose. `world.grants` gets a rule from a short list, as payments do in section 4 | small | do, after 5 |
| **A local income tax** | Ohio municipalities; Japan's resident tax | A charge paid to the town (section 5) | none beyond 5 | comes with 5 |
| **A local tax on firms' profits** | Germany's trade tax | Firms pay no tax on profit at all today; a new charge and a new return | medium | leave until a German pilot asks |
| **Council tax in bands** | England: a charge by the band a dwelling falls in, owed by whoever lives there | The rating law's data gains `basis` (a rate on value, today's; or bands with a charge each), what is valued (land and buildings, land alone, a year's rent), and `liable` (owner or occupier). The rates officer reads them | small to medium | do |
| **Water and power tariffs** | A sewer charge on the water bill (Ohio: more than doubles it); a least charge; a free first block with the state paying (Tamil Nadu); a price below cost with the treasury paying the difference (Mexico) | One tariff shape for both utilities: a fixed charge, a least charge, blocks of use each at a price, add-ons charged on the same use, and a subsidy with a named payer whom the utility bills for it | small to medium | do |
| **A leader chosen by councillors** | England's leader-and-cabinet councils; Tamil Nadu's town chairpersons since 2022; Victoria itself (docs/behaviour/elections.md says electing the mayor directly is a liberty) (search summaries, to confirm) | `elections.leader_chosen_by: electors or council`. But councillors are not elected at all yet; they are five fixed seats | small, after a medium one | **needs council elections first**, which wait on an earlier decision of Naz's about councillors; record, don't build |
| **Six-day weeks, half-day schools** | India works six days; Brazilian and Mexican schools run a morning | Already sayable: `round.work_days` and the school's hours. Missing: hours by kind of workplace (shops open when others are off) | small | do the per-kind hours; rosters and school shifts: leave |
| **Rent-setting rules** | Germany: no more than the local comparative rent, and no more than 20% in three years; Japan and Germany: a tenancy ends only for a stated good reason | Two more law schedules, in the form that exists (`worlds/law/schedules.json`): a cap as a figure, checked against the old rent the notice already states; reasons for ending a tenancy as a list the notice must choose from, which the tribunal checks. The comparative rent needs someone to publish it: an office that samples rents as the statistician samples prices | small (cap), medium (reasons; the rent index) | do the cap and the reasons; the index after |
| **Enterprise unions** | Japan: a union for each firm, bargaining together each spring | The generator makes one union for each employer where the profile says so; the union module already bargains only where its members work | small to medium | leave until a Japanese pilot asks |
| **Lump-sum retirement funds** | India's and Kenya's provident funds, Mexico's individual accounts, Japan's retirement allowance | `fund.retirement` gains how it pays out (a pension, a lump sum, or part of each), and takes contributions as a charge (section 5) | small, after 5 | do, after 5 |

**Also in the authors' notes, not on the list:** a thirteenth month's pay or seasonal bonuses (Brazil, Mexico,
Germany, Japan: an agreement can already hold a yearly payment; small); health insurance in Ohio (large; out of
scope here); a means-tested pension (India: section 4's shapes cover it); a tipping fee where there is no landfill
levy (a name, not a mechanism).

---

## Recommended order

**What unlocks the most places soonest.**

| Wave | What | Why first |
|---|---|---|
| 1 | **7 and 6** (one piece of work) | Small, in the generator only. Without 7, five of nine towns are expected to flood for weeks each wet season, which drowns whatever else is being looked at |
| 1 | **2** | Small. Fixes household size in four places and the refusals for a full home in Kenya |
| 1 | **8** | Small, but waits on a contract signature and on the other branch in those files |
| 2 | **4 with 3** | One rule for payments. Makes "none", "insurance", "family transfer" and "pension at its own age" all sayable |
| 2 | **5** | Independent of 4 in code; gives 4 its contribution book and 9 its local tax and fund contributions |
| 3 | **1 (a) and (b)** | Medium. Needs `Staffing` quiet after 5 |
| 3 | **1 (c), opening state and last-resort entry** | Large. The piece that changes what a Kenyan or Indian town *is* |
| 4 | **9**: tariffs, rate bands, grant rules, rent schedules, fund payouts, hours by kind | Small pieces, each independent |

**For the Kenyan and Indian towns to hold together**, three changes and one piece of authors' work: section 2
(households of the right size, and the place's own standard of room); section 1 (a second and third earner, and most
people in the work they are actually in); section 7 (so the long rains and the monsoon do not flood the town every
year). And the profiles' dwelling mix and rents restated for people on those wages, which is no platform change.

**What waits for the citizen redesign,** and should be written into docs/design/ai-citizens.md as inputs to it
rather than bolted onto today's citizen:
- a household deciding together who works at what, and unpaid family help (1);
- services sold to households (1);
- pooling and care inside an extended household; households forming and splitting (2);
- the pension's terms moving the age people stop work (3);
- a benefit changing how choosily someone looks for work (4).

Each is a person weighing an offer's terms, which is what that design's mind is for.

## What can be built side by side

By the files each touches. Every piece also adds fields to `worlds/generator/profile.ts` and a few lines to a
different part of `worlds/generator/generate.ts`; those merge cleanly if each stays in its own part.

| Track | Items | Main files | Must not run beside |
|---|---|---|---|
| A | 6 and 7 | `worlds/generator/weather.ts`; the fields block of `generate.ts`; the weather bureau in `world.ts` | — |
| B | 2 | `participants/src/behaviour/household.ts`; the people and homes part of `generate.ts`; `town/households` | F (same part of the generator) |
| C | 8 | `participants/src/money.ts`, `calls.ts`, the kernel resolver, the currency schema | whichever branch holds the money files now |
| D | 3 and 4 | transfers in `world.ts`; the claims part of `citizen.ts` | F (`citizen.ts`) |
| E | 5 | `tax.ts`; `Staffing` in `firms.ts`; the finance officer | F (`Staffing`); 9's rent schedules touch the landlord in the same file, another part |
| F | 1 | `firms.ts`, `retailer.ts`, `producer.ts`, `citizen.ts`, the job loop of `generate.ts`, the economy measures | B, D, E |
| G | 9: tariffs | `utilities.ts` | — |
| H | 9: rate bands, grant rules | the rates officer in `government.ts`; grants in `world.ts` | — |
| I | 9: rent schedules | `worlds/law/schedules.json`; the landlord in `firms.ts`; the tribunal | E, if careless |

So: **A, B, C, D, E, G and H can all run at once**, seven agents, then F alone, then I. Two cautions. `world.ts`
holds the weather bureau, transfers and grants, so A, D and H each edit it, in different modules: workable, to be
merged by one person. And **nobody should fill in all nine profiles as part of a track**: a track adds its new fields
to the one or two profiles its tests need, with sources, and a profile's author (one agent a place) adds the rest
afterwards. Nine JSON files edited by seven tracks is where the merges would hurt.

Every track owes the same first test: all nine towns, generated and run for a month at 200 people before and after,
end at the same state when no profile uses the new fields.

## For Naz to decide

1. **Own-account work as the existing venture, run by its owner (1c)**, rather than a new kind of "person who trades"
   beside entities. *Recommend yes:* it reuses founding, the retailer's rules and the owners' register, and
   "registered or not" stays a separate fact.
2. **Informal employment as employers not complying with the payroll law (1a)**, a stated share by kind of firm, with
   no inspector yet. *Recommend yes,* written up as a stated fact of the place until an inspector exists.
3. **Measuring employment as work done or a job held**, as labour force surveys define it. Every town's employment
   figure is then read a new way (it should come to the same number for today's towns; to check). *Recommend yes.*
4. **The occupancy standard and a home's physical room as the profile's (2).** *Recommend yes,* with a second,
   fixed yardstick in the measure so places compare.
5. **Stopping work as a curve by age, replacing the single retirement age (3).** The first profile's town changes
   when its author gives the curve. *Recommend yes.*
6. **Payments and taxes as published laws that offices read (4, 5),** not as modules' settings. *Recommend yes;* it
   is how the income tax already works.
7. **The river's bank derived from its own floods unless stated (7),** and the stated placeholders then taken out of
   the profiles, which changes each town's floods by decision. *Recommend yes.* And, if needed, a higher limit on
   `source_by_day`'s steps.
8. **The currency's writing fields (8):** the three proposed plus `group_mark`, `symbol_spaced` and `number_words`,
   with lakh and crore moved out of the parser into the Indian profile. *Recommend the six.*
9. **Council elections** as the price of "a leader chosen by councillors" (9). *Recommend not now.*
10. **No cash.** Everyone keeps an account at the town's bank, which in Kenya stands for mobile money. *Recommend
    leaving it:* cash is a kernel-deep change for little that a run would show.
11. **When.** None of this needs a model; all of it is mock-and-code work. *Recommend* wave 1 now, since pilots in
    these towns are what the profiles were written for, and waves 2 to 4 as tracks free up.

## Not verified

- Nothing was run. The claim that the Indian, Mexican and Kenyan towns flood in their wet seasons is read from their
  monthly figures against the bank, and from the Brazilian and Ohio runs in the decisions log.
- That a person may perform a task in a business where they hold the only position, and that a task may be set in a
  dwelling or a pitch, was read from the contract's description of `work`, not tried.
- That a law's `data` may hold a payment rule or a list of charges without a contract change was inferred from the
  income tax law's own data, not checked against `contracts/records.schema.json`.
- Most real-world figures here come from the profiles' source notes (their authors') or from search summaries; only
  the five marked [opened] were opened for this document. The pension, benefit and tax rules by place should be
  re-read from each profile's sources when its piece is built.

## Revisit if

- section 1's own-account sellers make a month's run several times slower (then they need a lighter participant
  than a shop's);
- the derived bank leaves a place that floods often in fact (a flood-plain town) dry, or the reverse (then the
  return period is a profile figure there, with its source);
- a profile's author finds a payment or a tax that the short lists in 4 and 5 cannot say (add to the list, generally;
  if that happens three times, the lists were the wrong shape and a condition language is the answer);
- the citizen redesign lands first (then 1's entry rule, 3's stopping rule and 4's search rule are written once, in
  it, and today's citizen gets none of them).

## References to add to docs/research/references.md, as each piece is built

| Idea | Citation | Used in |
|---|---|---|
| Expected-wage migration and the queue for formal jobs | Harris, J. R. and Todaro, M. P. (1970), *AER* 60(1) (already listed) | 1 |
| A free-entry sector beside the queue; searching while working in it | Fields, G. S. (1975), "Rural-urban migration, urban unemployment and underemployment, and job-search activity in LDCs", *J. Development Economics* 2(2), 165–187 **(to confirm)** | 1 |
| Self-employment as a chosen small-enterprise sector | Maloney, W. F. (2004), "Informality Revisited", *World Development* 32(7), 1159–1178 **(to confirm)** | 1 |
| Both tiers exist together | Günther, I. and Launov, A. (2012), "Informal employment in developing countries: Opportunity or last resort?", *J. Development Economics* 97(1), 88–98 **(to confirm)** | 1 |
| Informal firms are small, unproductive and stay so | La Porta, R. and Shleifer, A. (2014), "Informality and Development", *J. Economic Perspectives* 28(3), 109–126 (abstract opened 2026-10-08) | 1 |
| The scale of informal employment; its definition | ILO (2018), *Women and Men in the Informal Economy: A Statistical Picture*, 3rd ed. (page opened 2026-10-08); 17th ICLS guidelines (2003) **(to confirm)** | 1 |
| Households spreading work across activities; the farm household | Ellis, F. (1998), *J. Development Studies* 35(1); Barrett, Reardon and Webb (2001), *Food Policy* 26(4); Singh, Squire and Strauss (1986), *Agricultural Household Models* **(all to confirm)** | 1 (redesign) |
| Household composition across countries | United Nations (2017), *Household Size and Composition Around the World 2017*, ST/ESA/SER.A/405 **(to confirm)** | 2 |
| The collective household | Chiappori, P.-A. (1992), "Collective Labor Supply and Welfare", *JPE* 100(3) **(to confirm)** | 2 (redesign) |
| Leaving work bunches at pension ages; the option value of working on | Gruber, J. and Wise, D. (eds., 1999), *Social Security and Retirement around the World*; Stock, J. and Wise, D. (1990), *Econometrica* 58(5) **(to confirm)** | 3 (redesign) |
| An age of leaving the labour market read from participation by age | OECD, *Pensions at a Glance*, the effective age of labour market exit **(to confirm)** | 3 |
| Insurance length and generosity lengthen spells; exits at exhaustion | Meyer, B. (1990), *Econometrica* 58(4); Schmieder, von Wachter and Bender (2012), *QJE* 127(2); Chetty, R. (2008), *JPE* 116(2) **(to confirm)** | 4 (redesign) |
| Cold and heat and deaths | Gasparrini, A. et al. (2015), *The Lancet* 386, 369–375 **(to confirm)** | 6 |
| A river as linear stores | de Zeeuw, J. W. (1973) and Kraijenhoff van de Leur, D. A. (1973), in *Drainage Principles and Applications*, ILRI (as given in Wikipedia, "Runoff model (reservoir)", opened 2026-10-08) | 7 |
| The baseflow index | Institute of Hydrology (1980), *Low Flow Studies*; Gustard, Bullock and Dixon (1992) **(to confirm)** | 7 |
| The bank is filled about once in one to two years | Leopold, L., Wolman, M. G. and Miller, J. (1964), *Fluvial Processes in Geomorphology*; Williams, G. P. (1978), "Bank-full discharge of rivers", *Water Resources Research* 14(6) **(to confirm)** | 7 |
| How each place writes numbers and money | Unicode CLDR, number and currency patterns **(to confirm, per profile)**; Wikipedia, "Indian numbering system" (opened 2026-10-08) | 8 |
