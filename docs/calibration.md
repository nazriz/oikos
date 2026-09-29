# Calibration targets for the generated town

What the generated town's outcomes should look like, where each target comes from, and what the town measures now. **Targets are outcomes to compare against, never settings.** The rules that produce them are in docs/behaviour/, and measurement lives outside the world (the queries named below). The targets belong to a place: each profile (docs/profiles.md) carries its own `targets` with sources; the figures here are the first profile's (`au-vic-2026`).

## The economy (phase C, stage C0: a sourced baseline)

Every economic figure the town used to have as a placeholder now comes from its profile, with its source: award and median wages, regional rents, the household saving ratio and a wealth effect, the retirement age and support payments, wealth by quintile, industry shares. Measured on `worlds/town.yaml` (200 people), three seeds, two years (`economy/summary`, `town/rent-stress`):

| Outcome | Target | Measured | Notes |
|---|---|---|---|
| Unemployment rate | 4.6% (ABS Labour Force, Aug 2026) | 2–7% | The labour force: working-age adults drawn as in it (a placeholder 80%) |
| Employment to population (adults) | 63.9% (ABS, of people 15+) | 77–81% | Too high: too few retirees (the placeholder age range makes about 10% of adults 67+, not ~20%); nobody under 18 counts |
| Renters' housing costs, share of income | 20.2% mean (ABS, 2019–20) | 20–24% median | Close |
| Rental stress (over 30% of income) | 58% of lower-income renters | 23–33% of renter households | Not comparable yet (the target is for lower incomes) |
| Household saving ratio | 6.5% (ABS, June quarter 2026) | about 15% (people's money in less out, over what came in) | High: households build savings as the town's exports bring money in; partly a transition over the first two years. To look into (the measure isn't the national accounts' either) |

**Chosen, not sourced** (a boundary condition, set openly): the world market's demand for the town's goods, absent from the spec, is what the factories' opening staff make less the town's own purchases, so the town starts in balance with its markets.

## Earlier outcomes

Measured on `worlds/town-1000.yaml` (1,000 people, two years, several seeds), as of 2026-09-28.

| Outcome | Target | Source | Measured | Query | Gap |
|---|---|---|---|---|---|
| **Household sizes** at the start | 1 person 25.6%; mean 2.5 | ABS, Census 2021 QuickStats (Australia) | 25%, 35%, 16%, 17%, 7% (1–5 people); mean 2.5 | the generator | Matches (it's drawn from the census) |
| **Rent as a share of household income** | Private renters' housing costs average **20.2%** of gross income | ABS, *Housing Occupancy and Costs, 2019–20* | Median **27%** | `town/rent-stress` | Higher. The town's income is wages only (no benefits, investment or second jobs), and households take the dearest home they can afford. Median vs mean also differ. |
| **Rental stress** (over 30% of income) | **58%** of *lower-income* private renters | ABS, *Housing Occupancy and Costs, 2019–20* | **31–34%** of all renter households | `town/rent-stress` | Not comparable yet: the target is for the lower-income group only. Needs the town's income distribution split the same way (the lowest two quintiles). |
| **Spare bedrooms** | To source: ABS Census 2021 housing suitability (HOSD) for renters | ABS, Census 2021 | **About 45%** of households have two or more spare | `town/households` | Likely too high: households take the dearest home they can afford (the BoE rule: rent stands for quality), so couples rent four-bedroom houses |
| **Overcrowding** (needing an extra bedroom, CNOS) | To source: ABS Census 2021 HOSD, renters | ABS, Census 2021 | 2–10 households a run (1–3%) | `town/households` | Plausible order; needs the renter figure |
| **Petition signing** | **44%** had signed a written petition in the last five years (39% online) | Australian Election Study 2016 (as reported in secondary summaries; to confirm against the AES tables) | One tenants' petition reaches **21–38%** of adults over two years | `--sql` on `petition_count` | Plausible for a salient local issue. A petition still starts on day 0–1 in every run, because the genesis town has rent-stressed tenants; start timing isn't calibrated. |
| **Jobs found through friends or relatives** | About half; 30–60% across studies | Corcoran et al. 1980; Bewley 1999; both via Ioannides & Loury, *JEL* 2004 (US) | Almost none | `town/word-of-mouth` | Far below (D45). Employers don't favour referrals yet (Fernandez & Weinberg 1997) |
| **Homes found through ties** | No rate found; substantial for low-income renters | Schmidt, *ASR* 2025 (qualitative, US) | 7–9% of move-ins followed a tip | `town/word-of-mouth` | No target to compare |
| **Deaths** | The ABS life table, by age | ABS, *Life Tables 2021–2023* | Follows the table (kernel statistical tests); 1–3 deaths a run | `cast` | Matches, by construction |
| **Births** | Total fertility rate **1.481**; ages 15–49 | ABS, *Births, Australia 2024* | About 10 births a run over two years, the first after nine months | `cast` | To check against the expected count for the town's women by age (roughly 11 a year once under way) |
| **Migration** | To source: ABS regional internal migration rates | ABS, *Regional internal migration estimates* | Almost none on this town (vacancies fill within the month) | `cast` | The response and outside income are placeholders |
| **Taking part in a social group** | **50.0%** of adults in the last 12 months | ABS, *General Social Survey 2019* | **50.6–54.3%** of adults went to a gathering in the year; about 55 at each (the 1,000-person town, one year, two seeds) | `town/gatherings` | Close. Half of adults belong to a group at the start (the same survey), so the test is that it holds: how many join through friends and drift away. |
| **Religious belief, over five years** | Affiliation declining: 52.1% Christian in 2016 to 43.9% in 2021 (to confirm) | ABS, Census 2016 and 2021 | Stated firm belief **rises**, 12% to 22–27% of adults | `town/beliefs` | Wrong direction: displays and telling outpace fading (placeholders in `belief`). To calibrate against the trend, with a stated-affiliation measure. |
| **Religious belief** | **43.9%** reported a Christian affiliation | ABS, Census 2021 (to confirm) | Held at the start by that share (members strongly, others nominally). Stated when held firmly: **11–15%** of adults, steady or rising over a year while members keep going | `town/beliefs` | Not comparable: the census counts affiliation, and code citizens state only a firm belief. Needs a stated-affiliation measure, or a practising-share target (attendance), to calibrate. |

## How to use this

- A gap is a finding before it's a problem. It says which rule or which data is missing.
- **Don't tune a rule by hand to hit a target.** Change a rule only when there's a better-sourced rule, and record the change in docs/decisions.md.
- **Add a target** with its source, the query that measures it, and what's comparable. The rental stress row above shows how a target can look like a match or a miss when it isn't comparable at all.
