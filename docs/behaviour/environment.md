# `city.environment` (v0.3.0): the town's environment office

**Source:** `participants/src/behaviour/environment.ts`. A position of the town's (`entity: city`), run by code here; a
person or a model could hold it. Nature itself is physics: docs/behaviour/nature.md.

Nobody sees wildlife's numbers for free. The office learns them by surveying, which is work its staff do in the
working day, and tells others what it found.

| | Rule | Source |
|---|---|---|
| **Staff** | Hires the scientists the adopted budget's `environment` line pays for, at the public wage (the finance officer's payroll pays them). Lets one go when the line pays for fewer. Its staff are its own: the town's other offices' staff aren't its to send. | As the works office hires its crew (docs/behaviour/services.md) |
| **A round of surveys** | Every `survey_every_days` (91: a quarter), a month into the run first. For each species, up to `sample_cells` (60) of its habitat cells, by the office's own habitat map (below), at random. | Placeholders |
| **Fieldwork** | Each working day, as many cells as the staff's hours allow (a cell's survey takes the world's survey labour: an hour a hectare, a placeholder). A survey not done (no time left) goes back in the queue. | — |
| **The report** | When a round's surveys are done, it publishes a state-of-the-environment report: for each species, how many it found in how many cells, per 100 cells, and the change since the last round (a fall of 20% or more flagged). It's put forward to be believed (an `assertion`). An honest office reports what it counted. | Placeholder threshold |
| **The habitat register** | With each report, a register for planning: the lots where it has ever recorded a listed species. Records accumulate, as a biodiversity atlas's do. The last register is withdrawn when a new one is published. | The profile's listed species |

**What the town's laws do with it.** The generator writes a law: planning may not grant a permit on a lot where the
environment office has recorded a listed species. The planning officer applies it by consulting the latest register,
with the same compliance draw as for every law it applies (docs/behaviour/institutions.md).

**What a model in office can do differently:** fund it or not (the budget line), survey more or less, report honestly
or not, or ignore the register. Each of those is the research.

## Who knows what (0.3.0, generator 0.32.0; docs/design/knowing.md)

Until 0.3.0 the office was shown the whole district each month (the cover of every cell, and what was built), and the
whole register of lots. Nobody is shown a district (docs/no-god-view.md). What it has now:

- **Its own habitat map** (`habitat_map`: one document among the town's papers): the district's cover, area by area,
  and the ground that was built on, as its scientists had mapped it when the run began. It is as old as the day it was
  made. Ground the town has since had notice of being built on (the builder's `building_notice`) is struck from it;
  cover that changes by itself (regrowth, clearing) is not, so a sample may send someone to a cell that is no longer
  habitat, where they find nothing. A real office works from vegetation mapping of a given year (in the profile's
  place, the state's modelled native vegetation extent: to confirm, not opened).
- **Which lot a cell is on** (for the habitat register, which names lots): the land registry's to say. The office
  asks it about the one cell where it found a listed species (`lots`, a search of the plans by ground), once each.

## Leaves out (for now)

- Fieldwork in the field: staff survey from the office (no travel until roads, world-expansion §6.3).
- Choosing where to survey by what's at stake (planning applications, past finds): the sample is random.
- Reporting to anyone beyond the public record and planning (the state's agencies, the press: §3).
