# Life in the generated town (world content: `townLife()` in `worlds/generator/generate.ts`)

The kernel's life physics (contracts v0.4, `life`; design note §4) are parameters. This page says what the generated town sets them to, and where each figure comes from. Everything is drawn by the kernel's own keyed randomness, once a year on each person's birthday, so it replays exactly. `life: false` in a town spec turns it all off.

| What | Setting | Source |
|---|---|---|
| **Deaths** | The yearly chance of dying at each age 0–100 (`other_causes`, by single year of age): the mean of the male and female rates. The rounding to basis points adds up to 0.4 per 10,000 at ages 2–14. Life expectancy from the table as set: 82.9 years (ABS: 81.1 for males, 85.1 for females). | ABS, *Life Tables, States, Territories and Australia, 2021–2023*, Table 9 (Australia), qx |
| **Illness** | An illness serious enough for an overnight hospital stay. Yearly chance by age: 6% (0–4), 3.5% (5–14), 6% (15–44), 9% (45–64), 18% (65–84), 45% (85+). Lasts 3–14 days (80%) or 14–60 days (20%). Never fatal here. | **Placeholder**, shaped by AIHW's age gradient: hospitalisations per 1,000 people run from 99 at 5–14 to 1,511 at 85+, and there were 153 overnight hospitalisations per 1,000 in 2022–23 (AIHW, *Admitted patient care*). To replace with AIHW's age-specific overnight rates. |
| **Injury, anywhere** | 2.1% a year: 3–14 days (60%) or 14–90 days (40%). Never fatal here. | AIHW, *Injury in Australia*: 549,000 injury hospitalisations in 2022–23, 2,100 per 100,000 people. Flat by age (placeholder: falls make it much higher in old age). |
| **Injury at work** | Added for the people in a place: factories 1.6% a year, shops 1.2%. | Safe Work Australia, *Key WHS Statistics 2024* (2023–24): serious claims (a week or more off) per million hours worked, manufacturing 9.4 and all industries 6.8 (used for retail, a placeholder), at about 1,700 hours a year |
| **Harm (violence)** | Not set: `harm` is refused as not modelled. | No code citizen commits violence (that needs its own sourced behaviour). Adding the physics needs a sourced severity table (AIHW assault hospitalisations, for example). |
| **Birth** | Not set yet. | Waiting on a contract question: see D48 and D49 (sex as physics). |

**No death is counted twice.** The life table covers every cause of death, so illness and injury are set never to kill. A world that wants deaths by cause would set `fatal_bps` on its conditions and subtract those causes from `other_causes` (ABS *Causes of Death* has the split).

## What people do about it

For now, nothing. Conditions are recorded (`condition_began`, `condition_ended`), and a death ends the person's participant and takes them out of every space. Behaviour to add, each needing its own sources:
- being off work while ill or injured, and whether employers pay sick leave (the National Employment Standards: 10 days a year for full-time employees);
- households after a death: who takes over the lease, and what happens to the estate (law);
- care: hospitals and clinics as services that change durations and risks (design note §4.7).
