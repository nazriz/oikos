# Households (content: `participants/src/behaviour/household.ts`, `citizen.default` 0.39.1, `firm.landlord`, generator 0.32.0)

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
- **Adults' ages follow the census** (C6). The profile gives the population by five-year age band (`age_bands_bps`; the generated town's: ABS Census 2021, Rest of Vic., median age 43). Parents' ages follow from their children's (below). The ages of the other adults (living alone, as couples without children at home, or in groups) are drawn from the census's adults less those the family shares put in each band: parents, and grown children still at home (2026-10-08: until then only parents were taken off, so the bands under 25 were filled twice, and over twenty towns 79.6% of adults were of working age where the census has 75.2%; now 75.7%). The generator estimates that by drawing 20,000 households (`adultAgeBands`, a general formula over the profile's data; nothing is tuned to a target). At 1,000 people, 25% of adults are 67 or over, against about 10% with the old uniform 18–80. Retirees live on savings and support paid from outside (docs/behaviour/citizen.md).
- **Children at home are up to 24** (`child_max_age`): the census counts children of any age living with their parents, and the ABS family coding counts full-time students to 24 as dependent children. Older children at home are left out. The years between one child and the next (1 to 4, a placeholder) are drawn first, and the eldest is at least as old as they add up to (2026-10-08: drawn the other way round, a younger child's age stopped at nought, an eldest of one or two had siblings all born in one year, and 8.2% of the town was under five against the census's 5.4%; now 5.1%). People of 5 to 19 are still more of the town than the census's (21.1% against 17.8% over twenty towns), so adults are 766 in 1,000 where the census has 791 and adults of working age 580 where it has 594: the household-type shares are the whole country's, and regional Victoria has fewer families with children at home. That is the profile's data, not a rule.
- **Parents' ages** are the eldest child's age plus the mother's age at a first birth, drawn from 22–36 (a placeholder around ABS Births' median maternal age of about 31). A partner is within 5 years.
- **Adults living alone or in groups** are half female, half male (placeholder).
- **Group households** have 2–3 adults (placeholder).
- **Household types are the whole population's.** Renters differ: more lone persons and one-parent families. ABS *Housing Occupancy and Costs* has renter-specific shares, which a world can set.

## Extended households (2026-10-08; docs/design/profile-depth.md, item 2)

A household of relatives beyond one couple and their children: grandparents with a child's family, a grown child's family in the parents' home, a brother or sister, another relative. A profile that has them states their share of **all** households (`households.extended_bps`), beside the five kinds above, as a census table does. A profile that states none draws none, and its towns are the towns they were: nothing is drawn for a kind the profile doesn't have, so every draw is the same in number and order (tested; and a town's month ends at the same state).

An extended household is a **family** (a couple, a couple with children, or one parent, drawn as any family is) **plus relatives**:

| Field (`households`) | What it says | Left out |
|---|---|---|
| `extended_bps` | the share of all households that are extended | none are |
| `extended_nucleus` | the family in the middle: shares of a couple, a couple with children, one parent | in proportion to the profile's own three kinds of family |
| `extensions` | who the relatives are: a list of `{ kind, share_bps, count }` (a household has one kind) | one other relative |

| Kind | Who lives with the family | Their ages | Who holds the lease |
|---|---|---|---|
| `parents` | a parent of the family's head, or both (a couple) | older than the head by the mother's age at a first birth (the figure that already sets a parent's age from an eldest child's), and never past the oldest an adult can be | the family's head |
| `child_family` | the same people | the same | the parent: the family is a grown child's, living in the parents' home |
| `sibling` | brothers or sisters of the head | 1 to 4 years from the head and from each other, older or younger (the placeholder that spaces children) | the head |
| `relative` | other adult relatives | any adult's, from the census, as for someone living alone | the head |

`count` is how many of them (a range; one if not given; of parents, two at most).

What follows:
- **Kin are recorded.** The head's parents are named in the household's record and in the world, as a child's are. So an owner's title passes to a child or a parent under the same succession law as before.
- **Ages still follow the census.** Everyone whose age follows someone else's (a parent, a grown child, a brother or sister) is taken off the census's adults before the others' ages are drawn (`adultAgeBands`). With extended households that estimate is made twice, because the parent of a couple with no children at home follows an age that is itself drawn from the answer. A couple with a parent at home is drawn no older than leaves a parent room to be alive.
- **Newcomers** are drawn from the same shares (`world.migration`), so extended households arrive too.

**Which profiles state them** (each from its own source note; nothing was added that the note does not give):

| Profile | Stated | From | Not in the note, so not stated |
|---|---|---|---|
| `jp-akita-2026` | 27.2% of households (`extended_bps` 2,719); the family is a couple with children; the relatives are parents | Census 2020, table 12-3, Ikawa: 412 "other relatives-only" households of 1,515. Its author had counted them with couples with children and called them three-generation households; that count is undone (`couple_children_bps` 4,977 to 2,257) and that description kept | how many parents (one is drawn); the split of the census row by family type, which is wider than three generations |
| `mx-jal-2026` | 21.5% of households (`extended_bps` 2,148) | IIEG Jalisco from INEGI, Censo 2020: 25.0% of the 85.9% of households that are family households. Its author had spread them over the three kinds of family by a placeholder split; they are taken out in the same proportions | the family in the middle (by the profile's own shares, which is what that spreading assumed) and who the relatives are (one other adult relative: the least that makes a household extended) |

The other seven state none. Two of their notes say extended households are common and give no share for them: `in-tn-2026` (the 2011 census publishes no table by household type; its `group_bps` is a placeholder standing for them) and `ke-nakuru-2026` (a national share of nuclear households, and no share of extended ones). The fields are there for their authors.

### How an extended household lives: what today's citizen does, and what was assumed

Nothing in the citizen was changed for extended households except the standard it judges a home by (below). An extended household is a household: its record lists its members, its couples (two, where both grandparents are there) and who holds the lease, and the rules under "What each member does" apply to the larger household exactly as they stand. That means:

- **One home.** The leaseholder hunts, applies and signs for everyone, asking for the bedrooms the standard gives all of them: a bedroom for each couple, one for each other adult, the children's by sex.
- **One rent, shared by those with income.** The leaseholder budgets a third of the household's income, which is their own and what each other adult says they have coming in (pay, a pension, a payment while out of work). The rent is split evenly among those with any income, each paying the leaseholder their share by standing order. Someone with nothing coming in pays nothing. (The standing orders a town begins with are for those in work only; shares are told again when anyone's income changes, and a pension then counts.)
- **Money is otherwise each adult's own.** Each keeps their own account, buys their own goods, pays for themself. Nothing is pooled, nobody supports anybody, and a grandparent's pension pays for a grandchild only through the share of the rent.
- **Children** are moved in and out by the leaseholder, whoever their parents are. A child whose own parents are both dead has the household's other adults (the existing rule asks whether the household has any adult left).
- **Everyone looks for work as they would alone.** A grandparent past the retirement age is retired; the others are in the labour force at the profile's rate, each by their own draw.
- **Leaving town is the leaseholder's decision** for everyone: long without a home, or nobody with pay and no money. Where the leaseholder is a retired parent (`child_family`) it is their patience and their purse that decide.
- **A death** is handled as in any household: the partner takes the lease, else the eldest adult.
- **A landlord** takes a household by its people and the home's bedrooms, as before: six people need three bedrooms at two to a bedroom.

**Assumed, with no source:** that the family's head keeps the lease when their parents live with them, and the parent holds it when the family lives with the parent (the two kinds are the same people; only this differs); that a brother or sister is spaced from the head as children are; that a relative of kind `relative` is an adult; that one household has one kind of relative; that a household's extra adults split the rent evenly with everyone else.

**Left to the citizen redesign** (docs/design/ai-citizens.md; each is a household deciding together, which today's citizen does not do):
- pooling income, and who pays for the children and the old;
- care: grandparents minding children so a parent can work, and the care of the old at home;
- who works at what: a household spreading its people over a wage, a stall and the home;
- forming and splitting: a grown child marrying and staying or going, a parent moving in when widowed, a household dividing when it outgrows its home. Today no household ever forms or splits, so over a long run the households that began extended stay so, and others become so only as children come of age and stay;
- who holds the lease, other than by the rule above and after a death;
- the relatives' own kin: a grandparent's other children, a relative's partner.

## Homes

A home is a **unit with bedrooms**:
- an apartment block has 3 one-bedroom, 7 two-bedroom and 2 three-bedroom units;
- 55% of houses have three bedrooms, 45% have four.

This is smaller than the census's all-dwellings mix (1 bedroom 5.3%, 2: 19.1%, 3: 39.0%, 4+: 34.8%), as renters' homes are. It's a placeholder, set per world (`apartment_units`, `house_types`), with a rent for each size.

**Physical capacity** is generous: two bodies for each bedroom and two besides (a 2-bedroom flat holds 6 at most). It stands for floor area, which differs by place, so a profile may state its own (`homes: { bodies_per_bedroom, bodies_besides }`); none does yet, and the generator's two and two apply. What's suitable is decided below, not by physics.

At the start, 95% of households have a home. The neediest households (by the standard below) get the most bedrooms, as far as the homes go.

## The occupancy standard

The rule's form is the same everywhere; its figures are a place's (`OccupancyStandard`, `household.ts`):
- no more than so many people per bedroom (`per_bedroom`);
- a couple shares a bedroom;
- a lone parent, and every other member of an age (`own_from_age`) or over, has their own;
- the younger, of the same sex, share;
- the youngest of different sexes share if that saves a bedroom, under an age (`mixed_under_age`);
- someone living alone may live in a studio;
- where the living room is slept in (`living_room_slept_in`), one bedroom fewer.

A profile may state its place's own (`households.occupancy`). Where it states none, which is every profile today, the figures are two to a bedroom, 18 and 5: the **Canadian National Occupancy Standard**, as the ABS applies it (Census 2021 dictionary, "Housing suitability (HOSD)"). That standard is one country's, and it is the first profile's own; no other profile's note gives its place's, so the others borrow it until their authors state theirs.

Households use the standard to decide how many bedrooms to look for; the generator deals the first homes by it; a landlord's ceiling of people to a bedroom is its `per_bedroom`. (One difference is kept on purpose: where no standard is stated, the generator's dealing of first homes leaves out the youngest of different sexes sharing, as it always has, so that existing towns begin as they did. A town with a stated standard is dealt by the whole rule.)

**Measurement counts crowding two ways** (`town/households`):
- `overcrowded`: by the town's own standard (the one its people were given, or the common one): a household needs more bedrooms than its home has;
- `over_three_a_room`: by one yardstick that is the same for every place, so that places compare: more than three people to a room, a home's rooms being its bedrooms and one more (UN-Habitat's measure of sufficient living area; to confirm, docs/research/references.md).

## What each member does

| Member | What they do | Source |
|---|---|---|
| **The leaseholder** | Hunts for a home with the bedrooms the standard asks for, at no more than 33% of the **household's** income (their own, plus what the other adults say they earn). Still hunting after 60 days, they accept one bedroom fewer, and so on. They apply (saying how many people and how many bedrooms), sign, move in, and bring the children (a parent carries a child in), in one act. Then they tell the other adults to come, and what each one's share of the rent is: split evenly among those earning. When the tenancy ends, they take the children out and tell the others. They decide whether the household leaves town. | Rent share: BoE housing model (see citizen.md). Accepting fewer bedrooms: placeholder. Many low-income renter households do live in crowded homes; the ABS counts them. |
| **Other adults** | Move when the leaseholder says, pay their share by standing order to the leaseholder, tell the leaseholder when their pay changes, and leave town with the household. They look for work as everyone does, and don't hunt for homes of their own. The leaseholder's word is heeded at once if it finds them asleep (it wakes them, as news). **Known gap (2026-10-06, pinned by a test, not fixed):** with the daily round, a word that reaches them as an act of theirs is done (both home from work at the same moment) waits for their next weekly plan, so they can stay behind in the old home for up to a week (docs/gaps.md, phase A). A move the world refuses is tried again by the daily round (home is the new home); in a world without the round it isn't tried again. | An even split: placeholder (flatmates commonly split evenly; couples often pool). |
| **Children** | Nothing on their own. At 18 they ask the bank for an account, then look for work while living with the household. | |

**Phrasing:** members understand only their own phrasing (`SAYING` in `household.ts`), as code citizens do with asking around. A language-model citizen understands anything, and would be understood by a code citizen only if it used these words.

## Landlords

- A landlord turns down a household with more than two people per bedroom. This is the standard's own ceiling (`max_people_per_bedroom`; 0 for no limit; where a profile states its own standard, that standard's). Whether landlords apply such a rule is theirs to choose; the default is a placeholder.
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

How a death comes to be known, by those at home and for someone with nobody at home, is in [deaths.md](deaths.md) (revised 2026-10-08). In short: a person sees who left their home, and why (contracts v0.4: a space's recent departures), and looks for it every time they are awake at home. When a household member dies at home:
- Of the surviving adults at home, the first in the household's list reports it to the registry: who died, the partner, the children, and which of them are adults.
- They also write the household's new record, without them. If the dead person held the lease, the partner takes it over, or else the eldest adult. The new leaseholder starts looking for a home, because the lease was in the dead person's name and the landlord will give notice.
- Anyone paying their share of the rent to the dead leaseholder stops.
- A child at home with no adult of the household there tells the first of its surviving adults, who reports it from wherever they are.
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
