# Health: the clinic and care (`clinic.practice` v0.1.0)

**Source:** `participants/src/behaviour/health.ts`; the citizen's side in `citizen.ts` (docs/behaviour/citizen.md).
Design: docs/design/world-expansion.md §4. Figures: the profile's `health`, with sources. Illness and injury
themselves: docs/behaviour/life.md.

## The physics (kernel, contract 4.2)

- **Care is work done to a body** (`work` with `on` a person at the place). A task's `treats` says what it does to
  a condition of a kind and band, given at least so many units in one work act:
  - the condition's remaining days are cut to `days_kept_bps` of them;
  - a death due from it still happens only with the chance `fatal_kept_bps`.
  - It does this once: more care does nothing more.
- **Nobody is told whether a death was called off.** The log has it (`condition_treated`), for measurement. The patient
  sees only that the condition has been treated, and how long it will last.
- **Feeling ill is immediate:** a condition beginning, ending or being treated wakes that person (the engine's wake
  rule).
- **Pollution and illness:** illness can rise with a field where the body is (`illness.fields`). The physics is built
  and tested; the generated town doesn't use it yet, because its pollution units have no source to tie to illness.

## The clinic

It stands for the town's health system: general practice, and the hospital it refers to. That's a liberty: a town of
200 has neither. In the au-vic profile it's its own organisation, paid for by a grant from outside that covers its
doctors' wages. Australian general practice lives on routine visits, which the world doesn't model (only
hospital-level conditions exist), so a practice paid per consultation would have almost no income. The land is exempt
from rates.

| | Rule | Source |
|---|---|---|
| **Doctors** | Keeps its establishment: `doctors_per_1000` (1.2) of the town, rounded up (1 in the small town). | Department of Health and Aged Care, GP workforce statistics (to confirm) |
| **Its day** | It looks when it opens each working day (8am), and whenever a patient asks. (A daily wake would drift with the news that woke it, to hours it's closed: found.) | — |
| **Seeing patients** | A walk-in: patients who've asked and are in the waiting room, in the order they asked, weekdays 8 to 6, as many as its doctors' hours allow. A patient is seen for the consultations their condition takes (`consults`: 1 for a serious illness, 2 for a severe one). Then the clinic tells them they've been seen. | Placeholders |
| **A consultation** | Half an hour of a doctor's time (`consult_minutes`). | MBS long consultations run 20 to 40 minutes (placeholder) |
| **Care's effect** | A treated condition lasts a fifth less of what was left (`days_kept_bps` 8000). | Placeholder |
| **Who's dropped** | Someone who asked and isn't there after 3 days. | — |

## Citizens

- **Too ill to work:** with a serious or severe condition (a hospital stay), a worker stays out of the workplace until
  better, then goes back. Employers keep paying (personal leave; the National Employment Standards give 10 days a year,
  not enforced here).
- **Going to the clinic:** with a condition of a kind the clinic sees, not yet treated, 90% go (`seek_care_bps`). They
  wait in the waiting room, asking to be seen, and go home once seen (they feel it), better, or after 2 days.

## What it can't do yet: save lives

In the generated town every death comes from the life table, and conditions never kill, so no death is counted twice
(docs/behaviour/life.md). So care shortens illness (fewer days off work) but saves no one. For care to save lives, a
share of each age's deaths would come from conditions, with the treated rate matching the life table. Real case
fatality rises steeply with age, which one figure per band can't follow. That needs a small contract addition: a
band's fatality by age. **Proposed, awaiting sign-off.**

## Leaves out (for now)

- Routine care (check-ups, chronic illness, prescriptions): there are no minor conditions.
- Hospitals as places, waiting lists for surgery, ambulances.
- Paying for care (Medicare, gaps, private insurance).
- Children's care (their parents would take them; children's modules do little yet).
- Public health: vaccination, screening.
