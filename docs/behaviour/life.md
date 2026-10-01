# Life in the generated town (world content: `townLife()` in `worlds/generator/generate.ts`)

The kernel's life physics (contracts v0.4, `life`; design note §4) are parameters. This page says what the generated town sets them to, and where each figure comes from. Everything is drawn by the kernel's own keyed randomness, once a year on each person's birthday, so it replays exactly. `life: false` in a town spec turns it all off.

| What | Setting | Source |
|---|---|---|
| **Deaths** | The yearly chance of dying at each age 0–100 (`other_causes`, by single year of age): the mean of the male and female rates. The rounding to basis points adds up to 0.4 per 10,000 at ages 2–14. Life expectancy from the table as set: 82.9 years (ABS: 81.1 for males, 85.1 for females). | ABS, *Life Tables, States, Territories and Australia, 2021–2023*, Table 9 (Australia), qx |
| **Illness** | An illness serious enough for an overnight hospital stay. Yearly chance by age: 6% (0–4), 3.5% (5–14), 6% (15–44), 9% (45–64), 18% (65–84), 45% (85+). Lasts 3–14 days (80%) or 14–60 days (20%). Never fatal here. | **Placeholder**, shaped by AIHW's age gradient: hospitalisations per 1,000 people run from 99 at 5–14 to 1,511 at 85+, and there were 153 overnight hospitalisations per 1,000 in 2022–23 (AIHW, *Admitted patient care*). To replace with AIHW's age-specific overnight rates. |
| **Injury, anywhere** | 2.1% a year: 3–14 days (60%) or 14–90 days (40%). Never fatal here. | AIHW, *Injury in Australia*: 549,000 injury hospitalisations in 2022–23, 2,100 per 100,000 people. Flat by age (placeholder: falls make it much higher in old age). |
| **Injury at work** | Added for the people in a place: factories 1.6% a year, shops 1.2%. | Safe Work Australia, *Key WHS Statistics 2024* (2023–24): serious claims (a week or more off) per million hours worked, manufacturing 9.4 and all industries 6.8 (used for retail, a placeholder), at about 1,700 hours a year |
| **Harm (violence)** | Not set: `harm` is refused as not modelled. | No code citizen commits violence (that needs its own sourced behaviour). Adding the physics needs a sourced severity table (AIHW assault hospitalisations, for example). |
| **Birth** | A body can bear a child at 15–49, 266 days (38 weeks) from conception to birth, the other parent in the same place; newborns 48.59% female. Where bodies have a sex (the town's do), only a female body bears a child and the other parent is male. Whether and when is behaviour: [households.md](households.md). | ABS, *Births, Australia 2024*: fertility rates cover ages 15–49; 105.8 boys per 100 girls |

**No death is counted twice.** The life table covers every cause of death, so illness and injury are set never to kill. A world that wants deaths by cause would set `fatal_bps` on its conditions and subtract those causes from `other_causes` (ABS *Causes of Death* has the split).

## What people do about it

Deaths are acted on (D54). Those who share the dead person's home see it and report it; the registry registers it; the bank settles the estate; employers stop wages; landlords give notice; children left alone are taken into care ([households.md](households.md), [institutions.md](institutions.md)). Conditions are acted on (docs/behaviour/health.md): the ill and injured stay off work while it's serious, and most go to the clinic, where care shortens the condition. Care saves no lives here, since conditions don't kill; for that, a band's fatality would need to vary by age (a contract addition, proposed).
