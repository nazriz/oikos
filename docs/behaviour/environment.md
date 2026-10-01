# `city.environment` (v0.1.0): the town's environment office

**Source:** `participants/src/behaviour/environment.ts`. A position of the town's (`entity: city`), run by code here; a
person or a model could hold it. Nature itself is physics: docs/behaviour/nature.md.

Nobody sees wildlife's numbers for free. The office learns them by surveying, which is work its staff do in the
working day, and tells others what it found.

| | Rule | Source |
|---|---|---|
| **Staff** | Hires the scientists the adopted budget's `environment` line pays for, at the public wage (the finance officer's payroll pays them). Lets one go when the line pays for fewer. Its staff are its own: the town's other offices' staff aren't its to send. | As the works office hires its crew (docs/behaviour/services.md) |
| **A round of surveys** | Every `survey_every_days` (91: a quarter), a month into the run first. For each species, up to `sample_cells` (60) of its habitat cells, as the office has seen the land (its monthly look at the district), at random. | Placeholders |
| **Fieldwork** | Each working day, as many cells as the staff's hours allow (a cell's survey takes the world's survey labour: an hour a hectare, a placeholder). A survey not done (no time left) goes back in the queue. | — |
| **The report** | When a round's surveys are done, it publishes a state-of-the-environment report: for each species, how many it found in how many cells, per 100 cells, and the change since the last round (a fall of 20% or more flagged). It's put forward to be believed (an `assertion`). An honest office reports what it counted. | Placeholder threshold |
| **The habitat register** | With each report, a register for planning: the lots where it has ever recorded a listed species. Records accumulate, as a biodiversity atlas's do. The last register is withdrawn when a new one is published. | The profile's listed species |

**What the town's laws do with it.** The generator writes a law: planning may not grant a permit on a lot where the
environment office has recorded a listed species. The planning officer applies it by consulting the latest register,
with the same compliance draw as for every law it applies (docs/behaviour/institutions.md).

**What a model in office can do differently:** fund it or not (the budget line), survey more or less, report honestly
or not, or ignore the register. Each of those is the research.

## Leaves out (for now)

- Fieldwork in the field: staff survey from the office (no travel until roads, world-expansion §6.3).
- Choosing where to survey by what's at stake (planning applications, past finds): the sample is random.
- Reporting to anyone beyond the public record and planning (the state's agencies, the press: §3).
