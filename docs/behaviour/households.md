# Households (content: `participants/src/behaviour/household.ts`, `citizen.default` 0.8.0, `firm.landlord` 0.5.0, generator 0.10.0)

People live in households, as the census counts them. **A household is a record, never physics.** It's a statement of kind `household` that lists:
- its members, with their birth dates and sexes, and how to reach them (their participant);
- its couples;
- who holds the lease.

The kernel knows nothing of it: bodies occupy spaces, and a home's capacity is how many bodies could physically fit. Everything below is what the households' people do.

## The starting town (the generator)

Households are drawn one at a time until the town has its people (`citizens` in the spec), from the shares in the town's **profile** (docs/profiles.md). The figures below are the first profile's (`au-vic-2026`); another place's profile has its own.

| What | Figure | Source |
|---|---|---|
| Household types | Lone person 25.6%; group 3.9%; family 70.5% | ABS, Census 2021 QuickStats (Australia) |
| Families | Couple without children 38.8%; couple with children 43.7%; one parent 15.9%; other 1.6% (counted here as a group household) | ABS, Census 2021 QuickStats |
| Children, couple families | 1: 35–36%; 2: 43–44%; 3 or more: 20–22% (taken as 3) | AIFS, *Families and family composition*, from the 2021 Census |
| Children, one-parent families | 1: 51–52%; 2: 32–34%; 3 or more: 15–16% (taken as 3) | AIFS, from the 2021 Census |
| Same-sex couples | 1.4% of couples living together | ABS, Census 2021 |
| Lone parents | One in five is a father | ABS, Census 2021 |
| Sex at birth | 105.8 boys per 100 girls | ABS, *Births, Australia 2024* |

The result, at 1,000 people: about 405 households of 1–5 people (25%, 35%, 16%, 17%, 7%; mean 2.5, matching the census's 2.5). About 315 of the people are children.

**Simplifications, all profile or spec parameters (`households`):**
- **Adults' ages follow the census** (C6). The profile gives the population by five-year age band (`age_bands_bps`; the generated town's: ABS Census 2021, Rest of Vic., median age 43). Parents' ages follow from their children's (below). The ages of the other adults (living alone, as couples without children at home, or in groups) are drawn from the census's adults less the parents the family shares put in each band. The generator estimates that by drawing 20,000 households (`adultAgeBands`, a general formula over the profile's data; nothing is tuned to a target). At 1,000 people, 25% of adults are 67 or over, against about 10% with the old uniform 18–80. Retirees live on savings and support paid from outside (docs/behaviour/citizen.md).
- **Children at home are up to 24** (`child_max_age`): the census counts children of any age living with their parents, and the ABS family coding counts full-time students to 24 as dependent children. Older children at home are left out. Under-15s are still more of the town than the census's (21% against 17.6% for Rest of Vic.): the household-type shares are the whole country's, and regional Victoria has fewer young families.
- **Parents' ages** are the eldest child's age plus the mother's age at a first birth, drawn from 22–36 (a placeholder around ABS Births' median maternal age of about 31). A partner is within 5 years.
- **Adults living alone or in groups** are half female, half male (placeholder).
- **Group households** have 2–3 adults (placeholder).
- **Household types are the whole population's.** Renters differ: more lone persons and one-parent families. ABS *Housing Occupancy and Costs* has renter-specific shares, which a world can set.

## Homes

A home is a **unit with bedrooms**:
- an apartment block has 3 one-bedroom, 7 two-bedroom and 2 three-bedroom units;
- 55% of houses have three bedrooms, 45% have four.

This is smaller than the census's all-dwellings mix (1 bedroom 5.3%, 2: 19.1%, 3: 39.0%, 4+: 34.8%), as renters' homes are. It's a placeholder, set per world (`apartment_units`, `house_types`), with a rent for each size.

**Physical capacity** is generous, 2 per bedroom plus 2 (a 2-bedroom flat holds 6 bodies at most). What's suitable is decided below, not by physics.

At the start, 95% of households have a home. The neediest households (by the standard below) get the most bedrooms, as far as the homes go.

## The occupancy standard

The **Canadian National Occupancy Standard**, as the ABS applies it (Census 2021 dictionary, "Housing suitability (HOSD)"):
- no more than two people per bedroom;
- a couple shares a bedroom;
- a lone parent, and every other member 18 or over, has their own;
- under-18s of the same sex share;
- under-5s of different sexes share if that saves a bedroom;
- someone living alone may live in a studio.

Households use it to decide how many bedrooms to look for. Measurement uses it to count overcrowding (`town/households`: a household is overcrowded when it needs more bedrooms than its home has).

## What each member does

| Member | What they do | Source |
|---|---|---|
| **The leaseholder** | Hunts for a home with the bedrooms the standard asks for, at no more than 33% of the **household's** income (their own, plus what the other adults say they earn). Still hunting after 60 days, they accept one bedroom fewer, and so on. They apply (saying how many people and how many bedrooms), sign, move in, and bring the children (a parent carries a child in), in one act. Then they tell the other adults to come, and what each one's share of the rent is: split evenly among those earning. When the tenancy ends, they take the children out and tell the others. They decide whether the household leaves town. | Rent share: BoE housing model (see citizen.md). Accepting fewer bedrooms: placeholder. Many low-income renter households do live in crowded homes; the ABS counts them. |
| **Other adults** | Move when the leaseholder says, pay their share by standing order to the leaseholder, tell the leaseholder when their pay changes, and leave town with the household. They look for work as everyone does, and don't hunt for homes of their own. The leaseholder's word is heeded at once if it finds them asleep (it wakes them, as news). **Known gap (2026-10-06, pinned by a test, not fixed):** with the daily round, a word that reaches them as an act of theirs is done (both home from work at the same moment) waits for their next weekly plan, so they can stay behind in the old home for up to a week (docs/gaps.md, phase A). A move the world refuses is tried again by the daily round (home is the new home); in a world without the round it isn't tried again. | An even split: placeholder (flatmates commonly split evenly; couples often pool). |
| **Children** | Nothing on their own. At 18 they ask the bank for an account, then look for work while living with the household. | |

**Phrasing:** members understand only their own phrasing (`SAYING` in `household.ts`), as code citizens do with asking around. A language-model citizen understands anything, and would be understood by a code citizen only if it used these words.

## Landlords

- A landlord turns down a household with more than two people per bedroom. This is the standard's own ceiling (`max_people_per_bedroom`; 0 for no limit). Whether landlords apply such a rule is theirs to choose; the default is a placeholder.
- Among the households it will take, it picks one at random.
- The lease names the leaseholder, and its terms name the household.
- Rents are set per building and per number of bedrooms: what similar units in the building let for, or the world's base rent for that size.

## Children being born (D51)

A person's sex is physical (a body's, contracts v0.4): only a woman can bear a child, and her partner, if named, is the father. The kernel draws the baby's sex at 105.8 boys per 100 girls.

| Rule | Detail | Source |
|---|---|---|
| **Having a child** | Once a month, a woman aged 15–49, present and not already expecting, conceives with a twelfth of the yearly rate for her age: births per 1,000 women of 6.0 (15–19), 30.6 (20–24), 71.3 (25–29), 106.0 (30–34), 66.6 (35–39), 15.5 (40–44) and 1.4 (45–49). With her partner, only in a month he's at home with her. Only in a world with births (`births`); after conceiving, not again until the pregnancy (`gestation`) and a month have passed. The calendar (`year`), `births` and `gestation` are the citizen's parameters, set from the world's life physics by the generator (D57). | ABS, *Births, Australia 2024* (age-specific fertility rates; total fertility rate 1.481) |
| **Afterwards** | The mother brings the baby home, and publishes the household's record with the baby in it. The household now needs the bedrooms the standard asks for, which it looks for when its tenancy ends. | |

**Simplifications:**
- The rates apply to every woman of those ages, partnered or not, although most births are to couples.
- Newcomers' children arrive without their parentage recorded in the world.
- A same-sex couple's children record one parent (the other's is by a donor from elsewhere).
- Twins aren't modelled.

**Observed** (1,000 people, two years): about 10 births a run, the first after nine months. Each baby is at home within days, if the mother has one.

## A death in the household (D54)

A person sees who left their home, and why (contracts v0.4: a space's recent departures). When a household member dies at home:
- The first surviving adult in the household's list reports it to the registry: who died, the partner, the children, and which of them are adults.
- They also write the household's new record, without them. If the dead person held the lease, the partner takes it over, or else the eldest adult. The new leaseholder starts looking for a home, because the lease was in the dead person's name and the landlord will give notice.
- Anyone paying their share of the rent to the dead leaseholder stops.
- A child whose household has no adult left asks child protection for help, and is taken into care.

## What's not here yet (recorded, not built)

- **New households forming and ending:**
  - partnering and separating (cited rates);
  - adult children leaving home;
  - a household changing who holds the lease, other than after a death;
  - taking over a dead leaseholder's tenancy (Victoria lets a household member apply to), rather than moving.
- **Moving to fit.** A household that has grown (a birth) or shrunk looks for a better-sized home only when its tenancy ends; it doesn't give notice early to move.
- **Other adults leaving on their own**, as flatmates do.
- **Renter-specific** household and dwelling shares (ABS *Housing Occupancy and Costs*).
- **Retirees,** with pension income.
