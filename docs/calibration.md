# Calibration targets for the generated town

What the generated town's outcomes should look like, where each target comes from, and what the town measures now. **Targets are outcomes to compare against, never settings.** The rules that produce them are in docs/behaviour/, and measurement lives outside the world (the queries named below). All figures are Australian unless said otherwise, to keep one source country.

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

## How to use this

- A gap is a finding before it's a problem. It says which rule or which data is missing.
- **Don't tune a rule by hand to hit a target.** Change a rule only when there's a better-sourced rule, and record the change in docs/decisions.md.
- **Add a target** with its source, the query that measures it, and what's comparable. The rental stress row above shows how a target can look like a match or a miss when it isn't comparable at all.
