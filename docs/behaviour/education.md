# Education: the school and skill (`school.principal` v0.1.0)

**Source:** `participants/src/behaviour/school.ts`; the citizen's side in `citizen.ts` (docs/behaviour/citizen.md).
Design: docs/design/world-expansion.md §4. Figures: the profile's `education`, with sources.

## The physics (kernel, contract 4.2)

- **Skill is a body variable**, kept exactly by the kernel with no meaning attached. In the generated town it's
  schooling: a year of it is 10,000, from 0 to `max_years` (20).
- **Teaching is work done to the bodies in a room** (`work` with `on` a classroom). Each lesson adds a 200th of a
  year (50) to everyone in it but the teacher.
- **Skill speeds work** (`labour_by` on `make` and `serve`). The time a unit takes falls linearly with the performers'
  mean skill, so six years more schooling around the mean adult's makes work the profile's return per year of schooling
  quicker, compounded.
  - Tasks' base labour is scaled so a crew of the mean adult's schooling takes what the profile's figures say. So
    production is calibrated as before on average, and a less-schooled crew is slower.
  - Source: human capital, after Mincer (1974). The return per year is about 10% (Leigh 2008, for Australia, to
    confirm). The linear form approximates the log-linear one.

## The school

A state school in the au-vic profile: its own organisation, paid for by a grant from outside (the state's) that covers
its teachers' wages. The land is exempt from rates. Who runs schools is the profile's (docs/design/world-expansion.md
§4.1).

| | Rule | Source |
|---|---|---|
| **Teachers** | Keeps its establishment: one per `students_per_teacher` (13.5) of the pupils at the start, rounded up. Hires and pays them like any employer (Staffing). | ABS, *Schools* 2024 (to confirm) |
| **Classrooms** | One per teacher, 30 places each. | Placeholder |
| **Enrolment** | A child of school age (5 to 17) who asks gets a place in the least full classroom. Pupils at the start are enrolled and seated. | *Education and Training Reform Act 2006* (Vic) (to confirm) |
| **A school day** | Weekdays in term: the first 70 days of each 91, so about 200 a year. Each classroom with pupils is taught by a teacher at work there (6 hours of their day). | Victoria's four terms of about ten weeks |
| **Leaving** | At 18 the pupil leaves the classroom. The school gives them a certificate of their years (those before plus those here). | — |

## Citizens

- **A child of school age** who isn't at school asks for a place (once a month) and goes when offered. At 18 they
  leave.
- **Adults' schooling at the start**, and newcomers' when they arrive: drawn from the profile's attainment (ABS,
  *Education and Work*, May 2024, as years of schooling). Children: the years since they started.

## Found by running it

- **Shops and factories planned with the average time per unit.** With skill, a less-schooled crew takes longer, so
  the world refused the plan for lack of time, and the manager tried the same plan again and again (a run of 120 days
  took 383 seconds, not 9). Managers now learn how long work takes, worker by worker (`Pace`, docs/behaviour/retailer.md):
  slower from the world's refusal, quicker by asking a little more each week. Learning only "slower" left quick crews
  doing less than they could: the factories made too little to pay dividends.
- **The teachers and the doctor come out of the town's workforce.** In the small town that's five fewer factory
  workers, and 7-8% fewer goods made in the first 120 days (two seeds; with crews' schooling below or above the mean).
  That's the trade-off a town has, not a bug.

## Leaves out (for now)

- Teachers' own qualifications (anyone may be hired), and the quality of teaching.
- Absence and truancy; children ill at home; the school's own work beyond lessons (marking, reports).
- Tertiary education and training (no one adds to their schooling as an adult).
- Employers seeing certificates when hiring, or paying more for them. Skill already makes a worker quicker, but
  employers can't see it; screening on credentials (Spence 1973) is the next step.
- Kindergartens and childcare (in Victoria, partly the council's).

## In the Rust port (2026-10-17, lane E)

`school.principal` is ported to `offices/school.rs` (the manifest keeps version 0.3.1). The school's roll is read from its own file each wake rather than kept in memory, so a new principal carries on: a pupil is on the roll while a place of the school's is on file for them, and off it when a certificate of the school's names them or their death is registered; an enrolment is answered when a place or a decline of the school's cites it. The certificate is not given twice, nor to someone who has died. What remains in memory: the day the lessons were set (no paper says a lesson was taught; a successor in the same morning could set them twice, and the world refuses a teacher more hours than the day has). A pupil with no birth on their enrolment stays on the roll (the TS dropped such a pupil from the leaving check the same way). `years_of_schooling` and `SchoolingSpec` are ported as they were.
