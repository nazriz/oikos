# Building: what it takes (the generated town's figures)

**Source:** `worlds/generator/generate.ts`. These are world content: the catalogue's physics (what each kind of building is made of, and how many hours of work it takes to build and to bring down) and the builder's business knowledge (the same figures, in its parameters). **All are placeholders, to calibrate in phase B stage B5.**

## The working day

`catalogue.working_day` is **8 hours**. It is a physical limit on a person's work in a day, which the kernel keeps (a person's time is used, day by day). How many days a firm works is its own rule; the builder works 5 of every 7. That makes a 40-hour week, near Australia's standard of 38 ordinary hours (Fair Work Act 2009, s 62, National Employment Standards).

## Materials and hours, by kind of building

Materials are one kind, `materials` (kg), bought from the world market at **$1.25 a kg** (`MATERIALS_PRICE`).

| Kind | Materials | Building work | Demolition | Least time |
|---|---|---|---|---|
| house (3 bedrooms) | 120 t | 4,000 h | 300 h | 90 days |
| large house (4 bedrooms) | 140 t | 4,600 h | 300 h | 90 days |
| apartments (12 homes) | 1,000 t | 36,000 h | 2,000 h | 180 days |
| shop | 250 t | 8,000 h | 500 h | 90 days |
| factory | 1,600 t | 50,000 h | 3,000 h | 240 days |
| yard | 30 t | 1,000 h | 100 h | 30 days |
| civic | 330 t | 10,000 h | 800 h | 120 days |
| park | 20 t | 1,500 h | 100 h | 30 days |

A building is finished when its hours are done **and** its least time has passed (drying, curing and inspections take time whatever the crew). A full crew of 12 (the yard's room; the builder starts with 4 and hires to its work) working 5 days a week puts in 480 hours a week. A house therefore takes about 8 weeks of the whole crew, and its least time (13 weeks) decides when it's finished, unless the crew is shared between several jobs. Apartments take about 75 weeks of the whole crew: labour decides.

## What it costs

At the crew's wage ($1,500 a fortnight, about $18.75 an hour), a house's materials ($150,000) plus its hours ($75,000), plus the builder's 20% margin, come to about $270,000. Before phase B the builder charged $360,000, all of it "materials".

**To check (B5):**
- the average value of a new house (ABS, *Building Activity, Australia*) and building costs per square metre (Rawlinsons, *Australian Construction Handbook*);
- the share of materials in a house's cost;
- a house's mass;
- hours per dwelling from construction-industry productivity figures.

The town's wages are lower than Australia's (the generator's pay scale is a placeholder too), so prices are scaled with them.

## Leaves out

- **One kind of material**, instead of concrete, timber, steel and fittings.
- **One crew of general hands**, instead of trades working in sequence.
- **Crews work from the yard on a distant site** (D25: no travel).
