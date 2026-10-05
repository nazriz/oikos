# Nature: the physics (kernel, `oikos-nature`)

**Source:** `kernel/crates/nature/src/lib.rs`, stepped a day at a time by the world (`kernel/crates/world/src/exec.rs`,
`nature_day`). Contract: docs/design/world-expansion.md §2.4. The world gives every figure: covers, fields and species
come from its catalogue (the generator writes them from a profile's `nature`, in real units with sources).

Nature is physics, so the kernel steps it and keeps it exactly, and attaches no meaning to it. Nobody in the world sees
it for free: people see covers and conspicuous species as they pass (`sites` views), and know numbers only from surveys
(work, with sampling error), reports, and word of mouth.

## Covers

| Rule | Source |
|---|---|
| A cell's cover is its building's (the type's `cover`, else `built`), or, unbuilt, its terrain (else the world's default) | — |
| An unbuilt cover succeeds to another after its days (cleared land to grassland in a year; scrub to woodland in about 40), so mature habitat is slow to come back | Placeholders in the profile |
| A building's cells become the world's `cleared_cover` when it comes down | — |

## Fields

Integer quantities on cells (pollution). Each day:
1. sources, by cover and per building of a type (at its corner cell);
2. decay toward the baseline;
3. diffusion of what's above it to the four neighbours;
4. flow of what's above it downstream along the flow layer (the river).

Bounded, exact. Figures: placeholders.

## Populations

Each species is an integer count per cell. Each day, in cell order, with the kernel's keyed randomness (stochastic
rounding of every expectation, so small populations can fail by chance):

| Rule | Why | Source |
|---|---|---|
| **Background deaths** at the species' rate | — | Placeholder rates |
| **Deaths where a field passes what it tolerates** (pollution, for the frog) | Sensitivity to water quality | The frog's guidelines (profile) |
| **Births** replace background deaths, plus logistic growth toward capacity: per capita *m + r(1 − O/K)*. *O* is the **others** in the home range; *K* is the home range's capacity (its cells' covers, per 1,000 cells). Crowding past capacity kills at the same rate. | Verhulst's logistic. Crowding is felt over where an animal finds food and mates, so a sparse animal can have a fraction of one per cell. Counting itself, an animal whose range holds about two would settle at half its capacity. | Verhulst (1838) |
| **No births** where fewer than `min_viable` are in the home range | Mate-finding (an Allee effect). Gliders and fairy-wrens are 1: family groups sharing a range aren't modelled | Allee (1931) |
| **The young leave** (a species with a home range): each newborn disperses from its parents' cell. So does a share of the rest each year | Natal dispersal. Young born in place stack families on one spot, and the population settles far below its capacity (found: about half, for fairy-wrens on uniform scrub) | Greenwood (1980) (to confirm) |
| **Dispersal is a correlated walk:** a heading kept, with a one-in-four chance of turning each step | Dispersers head off. A random walk covers only the square root of its steps, so young gliders never left their parents' range (found: 35% of capacity) | Kareiva and Shigesada (1983) (to confirm) |
| **Choosing where to settle:** out of the range it left, on ground it can live on, with a chance as good as the ground is next to its best. At the walk's end (its `dispersal_range`, and at least twice the home range), anywhere it can live, or it dies there | Dispersers choose habitat. Settling on the first poor cell made grassland a sink that drained the fairy-wrens | — |
| **Barriers kill a disperser** (built land for frogs and gliders; farmland for gliders). **The world's edge turns it back.** | Fragmentation: a gap wider than the range cuts a patch off. Beyond the edge is more of the same, as many coming in as going out | Levins (1969); Hanski (1998) |
| **None live in a cell whose cover gives no capacity** | Habitat loss | — |
| **Extinction is for good:** a species with none left anywhere is recorded once, and nothing adds it back | Irreversibility (VISION; V0 stage 4) | — |

**Spin-up.** Before the run, nature is stepped alone for the world's `nature_spin_up_days` (the profile: 10 years) over
the land as it starts, so nature begins in its own balance, not the generator's guess at it. The generator places
species at their nominal densities. Without a spin-up, the first years would be nature settling, not anything anyone
did (the calibration lesson of 2026-09-30, again).

**What it settles at** (the 200-person town's district, 120 × 112 cells of 25 m, three seeds, five years after a
20-year spin-up (now 10: the slowest species, gliders, settle well within it, and loading takes a
second or two, not ten)):

| Species | Range over the seeds and years |
|---|---|
| growling grass frog | 3,300–4,600 |
| squirrel glider | 45–63 |
| superb fairy-wren | 480–570 |

No extinctions. On uniform habitat each species settles near its nominal capacity: gliders 65–80 of 86, fairy-wrens
370–400 of 382.

## Surveys

`work` with a task that `surveys`, with `survey: {of, cells}`, a unit per cell, charged to the performers' day.

| Rule | Source |
|---|---|
| For a species: each one there found with the species' `detection_bps` | Imperfect detection (frog 50%, glider 30%, fairy-wren 80%: placeholders) |
| For a field: the value, off by up to 10% | Placeholder |
| The estimates go to the actor only (the outcome's `surveyed`). What it then publishes, honestly or not, is its own | — |

## Leaves out (for now)

- Food webs (predators, prey, competition): each species lives on covers and tolerates fields, alone.
- Seasons and weather: rates are daily averages of yearly ones.
- Age and sex structure: the young disperse, but there are no juveniles as such.
- Water: the river carries pollution, but has no level or flow volume until §6.1.
- Habitat quality within a cover (old trees, hollows): a cover is uniform.
