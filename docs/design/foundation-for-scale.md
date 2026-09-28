# A foundation for scale: design (draft for review)

**Status:** draft, 2026-09-28, for Naz's review. It's the plan for contracts v0.5 and the work after it. Nothing is built until it's signed off; §9 lists the decisions.

**Why now:** Naz: "I want a really strong foundation so that when we begin to expand and build out other things, it's really easy to progress, and we don't have to spend a lot of time unwinding and rebuilding stuff." V0.md's stage-2 checkpoint says the same: *revise contracts now, before stages 3–4 build further on them.* Everything below is judged by one question: **if we don't decide this now, what do we have to unwind later?**

**Relation to the municipal draft** (docs/design/municipal-economy.md): that was one town's council, designed on its own. Here, the general things it needed (resources, work, stocks on places, jurisdictions) are foundations, and a council becomes one configuration of them (§4.12).

---

## 1. What the foundation has to carry

| Dimension | From | To |
|---|---|---|
| **Space** | a household, a lot | a town, city, region, country, the world, a grid of worlds (VISION §11's zoom) |
| **Population** | tens of people, each simulated | billions, most of them in aggregate |
| **Time** | hours | centuries (Naz: "imagine a 1000 year simulation") |
| **Economy** | rent, wages, one tax | production, trade, public finance, credit, at any scale |
| **Who holds power** | one AI mayor | many AI stewards at different levels at once, humans beside them, code everywhere else |
| **Where a world comes from** | a hand-written generator | generators *and* real data (census, boundaries, land use, public accounts) |
| **What we learn from it** | pilots and gap lists | research data at scale, and training data for the translator and small models |

The platform supports the whole range. **Each run chooses its resolution:** where it's detailed, where it's aggregate, how long and how fast. The town stays: it's the first instance of the general thing and the fixture every test runs on.

## 2. What must hold at every scale

These don't change. The foundation must keep every one of them at every scale:

- **Determinism:** one seed, keyed streams (D7); byte-identical replay (D6).
- **Conservation:** money now, and every conserved resource after §4.3.
- **The kernel is physics only** (D18–D20); **institutions are content** (D23); **the kernel is the only writer of state** (D4).
- **The platform is invisible to participants** (D35); participants know the world only through perception and their own parameters (D57).
- **Every act says why, and every record cites what it rests on** (D50).
- **Measurement lives outside the world** and reads the logs.
- **Welfare of AI participants** (VISION §15; D55), and now of human participants too (§4.9).
- **Proportional fidelity** (D25): faithful where the research is, documented liberties elsewhere.

## 3. Audit: what scales now, and what doesn't

| Area | Today | Scales? | Cost to change later |
|---|---|---|---|
| Time | Event-scheduled kernel; ticks are only the wake grain (D3) | **Yes** | — |
| Laws, authority, institutions | Content: records, positions, modules (D18–D23) | **Yes** | — |
| The steward's loop | Reports, plain language, translator, confirmation | **Yes** | — |
| Perception | Changes, attention, position (D42–D44) | Mostly; lists items one by one | Medium (§4.10) |
| **Places** | One flat grid, a cell is a lot, at most 100k × 100k; "near" in cells | **No** | **High:** ids, channels, structures and nearness all assume it |
| **People** | Individual bodies only; each citizen is its own participant | **No** | **Highest:** entities, bodies, occupancy, life physics and the participant model |
| **Conserved things** | Money only; materials "paid to the boundary" (a known liberty) | **No** | **High:** every economy beyond rent and wages needs it |
| **Work** | Designed (D21, D24), not built | **No** | High: services and production need it |
| **Amounts** | Integer cents, at most 2^53 (about $90 trillion); one implicit currency | **No:** world output is about $110 trillion a year | **High:** touches every amount |
| **The outside** | Exactly one boundary entity | **No:** nested and neighbouring worlds need several | Medium |
| Many AI stewards | The participant API allows it; the orchestrator runs participants one at a time | Partly | Medium (§4.8) |
| Humans | Not in v0 (V0.md) | No | Medium: the interface allows it; the rest is new |
| World sources | One generator | No | Low if designed now (§4.11) |
| Execution | One kernel thread, one hash chain (D4) | Not for millions | **High** if the contracts rule out partitioning (§4.13) |
| Institutions (participant side) | Hand-written modules tied to "city" and "mayor" | No | Medium: rework accumulates (§4.12) |

---

## 4. The foundations

Each foundation gives the problem, the scale-free form, what changes in the contracts and kernel, how the town keeps working, the tests, and its sources.

### 4.1 Places: nested, each detailed or summarised

- **Problem:** a single grid where a cell is a lot can't hold a country. And a country held as lots would be too big to run.
- **Form: a tree of places.** World, then (for example) country, state, region, locality, neighbourhood. Any level's names are the world's vocabulary. The **Australian Statistical Geography Standard** is the model to follow, and the backbone for real data (§4.11):
  - mesh blocks: 30–60 dwellings;
  - SA1: 200–800 people;
  - SA2: 3,000–25,000;
  - SA3: 30,000–130,000;
  - SA4: over 100,000.
- **Each place is either:**
  - **detailed:** it has ground (a grid of cells at the place's own scale), lots and individual structures, as the town does now; or
  - **summarised:** it holds **stocks of built space by type** (1,200 three-bedroom dwellings, 40 shops, 3 factories) with occupancy as counts, and no individual structures.
- **The same physics applies to both.** Capacity is capacity, and occupancy can't exceed it. A place can be **detailed on demand** (§4.2's promotion): its summary is drawn into individual structures, deterministically and keyed.
- **Nearness generalises:**
  - within a detailed place, distance in its units (D44 as now);
  - between places, adjacency and a distance between their centres (a table in the config);
  - a channel's area names places (`region-3`), cells, or "near me".
- **Contract changes:**
  - `world.ground` becomes `world.places` (a tree), with `ground` optional per place;
  - structure and space ids are scoped by place;
  - channel areas take place ids;
  - summarised built stock and counted occupancy are new state.
- **The town:** one detailed place, the world's only child. Every id it uses today stays valid under its place prefix.
- **Tests:**
  - capacity physics on summarised places;
  - deterministic detailing (drawing the same summary twice gives the same structures);
  - perception over nested areas;
  - a two-place world (a detailed town inside a summarised region).

### 4.2 People at more than one resolution

- **Problem:** individual bodies, each its own participant, cap us at thousands. A country is millions, the world billions.
- **Form: cohorts, after the super-individual method** (Scheffer et al. 1995). A **cohort** is N people who share what the model needs to tell apart:
  - place;
  - age band;
  - sex;
  - household type;
  - income band;
  - the world's other attributes.
- **Life physics runs on cohorts in aggregate.** The yearly chance of death at an age becomes a binomial draw over the cohort, from the same keyed streams, the same tables and the same sources. That's the **cohort-component method** demographers use for population projections. Births, illness and migration work the same way.
- **Behaviour is written once, for "who", and applied to one person or to a cohort:**
  - a rule's decision becomes a share of the cohort (14% of this cohort sign; 3 households move);
  - the rule module is the same code, and its sources don't change.
- **Cohorts act through the same acts with counts:**
  - occupy N dwellings of a type;
  - pay a total from a **sector account** (a place's households' account, held at a bank like any other);
  - sign on behalf of N people (a petition's count, a vote's tally).
- **Promotion and demotion:**
  - **Promotion:** a study that needs individuals in one neighbourhood promotes that cohort. Its N people are drawn as individual bodies with attributes consistent with the cohort (keyed and deterministic), from that moment on.
  - **Demotion** folds individuals back.
  - Both are ordinary kernel acts, logged, so "what resolution was this place at, when" is on record.
- **The invariant, restated honestly:**
  - D17's "zooming never changes the outcome" stays true for **rendering and narration**.
  - **Resolution** is a model choice, so its test is **statistical equivalence**, not identical bytes: the same world run all-individual and all-cohort, over many seeds, gives outcome distributions that don't differ beyond a stated tolerance (deaths by age, moves, occupancy, money flows).
- **Where equivalence is hard:** networks (who knows whom: word of mouth, D45), households as units, and anything that depends on specific individuals meeting. Options:
  - keep those places individual (**hybrid**: individuals where the research is, cohorts elsewhere; D25 again);
  - or give cohorts mean-field versions of those rules, each with its own source.

  The equivalence tests say which rules survive aggregation, and that's a finding in itself.
- **Participants:** each cohort's behaviour runs as **one participant per cohort**, not per person. A country of 25M in about 50,000 cohorts is then about 50k participants, which is roughly today's scale, not 25 million.
- **Contract changes:**
  - entity kind `cohort` (a count and attributes);
  - life physics by count;
  - acts with counts (occupy N, a sign or vote with a weight);
  - sector accounts;
  - `promote` and `demote` acts.
- **Tests:**
  - statistical equivalence (a new class of test, with seeds and a tolerance);
  - conservation of people: births, deaths, arrivals and departures balance, across promotion and demotion;
  - deterministic promotion.
- **Sources:** Scheffer et al. 1995; ABS population projections (cohort-component method); the existing life, household and migration sources, unchanged.

### 4.3 Resources: money is one conserved thing among many

- **Problem:** money is the only thing that's conserved. Goods, materials, food, energy and waste don't exist, so production, trade and most of a real economy can't either. Construction pays for materials "to the boundary", a liberty recorded as not acceptable long term.
- **Form: conserved resource kinds, declared in the world config.** For example: money (with a currency), steel, food, electricity, waste, water. Each kind has:
  - a unit (integer, like cents: grams, kilowatt-hours, litres);
  - **where it can be held:**
    - money in accounts, with custody at banks (D26 unchanged);
    - goods in holdings at places, with custody by whoever holds the place or the store.
- **The physics:**
  - a resource is conserved: it moves, or it's transformed by work (§4.4); it's never conjured;
  - it enters and leaves only across a boundary, as money does now (D31);
  - moving goods is a physical act by whoever has custody, just as a payment is the bank's act.
- **Accounting is already in this shape:** REA, which the agreements follow, and **stock-flow consistency** (Godley & Lavoie 2007), which D26 named as a future upgrade for money. At scale, **input–output tables** (Leontief; the ABS publishes Australia's) describe which industries' outputs are others' inputs, which is the data a summarised economy needs.
- **Stocks on places, for state that isn't owned:**
  - a place or structure can carry **state variables**: a building's condition, a bin's fill, a river's pollution, a habitat's quality, soil fertility;
  - each has **dynamics declared in the config**: per occupant per day, per day, bounds;
  - the kernel applies them over time like life physics, and attaches no meaning to them.
  - This carries waste and wear now, and VISION's nature layer later: habitat, populations of species, irreversibility at a floor. **It's one mechanism.**
- **Contract changes:**
  - resource kinds;
  - holdings;
  - a generic `transfer` for any resource: money keeps its custody rules, and goods move by custody;
  - state variables and their dynamics;
  - construction consumes materials rather than paying the boundary, which retires the liberty.
- **The town:** money only, as now, until a world declares more. The builder buys materials from a supplier (or across the boundary) as a trade in goods, not as a payment to nowhere.
- **Tests:**
  - conservation for every kind (the existing money invariant, generalised);
  - custody for goods;
  - dynamics applied exactly (integers) and replayed;
  - irreversibility at a floor (a species gone stays gone), the Stage 4 invariant.

### 4.4 Work: tasks take time, performers have capacity

- **Form (D21, D24):**
  - A **task kind** in the config says what it changes:
    - **consumes** resources;
    - **produces** resources;
    - **moves a state variable** (restores condition, empties bins, raises a habitat's quality);
    - and how much performer time each unit takes.
  - A **performer** (a person, a cohort's labour hours, or later a machine) has capacity: hours a day.
  - The `work` act spends performer time on a task at a place. The kernel checks physics (presence at the place, capacity, the inputs are there) and applies the change. That's all it does.
- **What this carries:**
  - services (waste, maintenance, care, policing);
  - production (a factory turning steel and labour into goods);
  - construction (build time becomes work, so a builder with more crew builds faster);
  - D21's institutional efficiency: an AI-run office needing fewer staff is a real, measurable difference.
- **Sources:** Acemoglu & Restrepo's task framework, as D24 named.
- **Contract changes:** task kinds, performer capacity, and the `work` act. **A new block and a new call function** (§5; P12).
- **Tests:** capacity can't be exceeded; inputs must exist; outputs are conserved; a cohort's labour hours are its count × hours.

### 4.5 Amounts: range and units

- **Problem:** an amount is at most 2^53 cents (JSON's safe integers), about $90 trillion. World output is about $110 trillion a year. And the currency is implicit.
- **Form:**
  - Amounts are **integers encoded as decimal strings** in JSON, and 128-bit in the kernel. That's exact, has no floats (D1), and has headroom for anything physical.
  - Every amount carries its **unit**: a currency (ISO 4217 code) or a resource kind's unit. A world with one currency declares it once, and the unit defaults to it.
  - Exchange between currencies is a trade (content: a market, a central bank), never kernel arithmetic.
- **Cost:** mechanical, but it touches every amount in every contract, module and test. **Cheapest now.**
- **Tests:** round-trips at the extremes; mixed units refused; conservation per unit.

### 4.6 Boundaries: several edges

- **Form:** a world can have **several boundary entities**, each an edge to something outside it:
  - the rest of the country for a simulated region;
  - a neighbouring simulated world in a grid of worlds;
  - the unsimulated world.

  Each has its own custody account and resource holdings. **Conservation holds over the world plus all its boundaries.**
- A later **world grid** connects two worlds' boundaries: what leaves one enters the other, with a delay. This is also the natural seam for running large worlds in parts (§4.13).
- **Contract change:** "exactly one boundary" becomes "at least one". Refusal codes stay.

### 4.7 Jurisdictions and levels (content, on these foundations)

- **No kernel change.** Authority is already content (D20).
- **A jurisdiction** is an entity with:
  - an area (places, §4.1);
  - a charter (records);
  - positions;
  - revenue instruments and programmes (§4.12).
- **Levels relate through records:**
  - a constitution says which level may do what;
  - intergovernmental agreements;
  - **transfers** (grants);
  - **limits** one level sets on another (rate caps, fiscal rules);
  - who may override whom.

  Whether a level follows them is behaviour, as for any law (D19).
- **Laws are scoped to places.** Institutions judge them only where they apply: the CEL condition can name the place, or the law's record names its area.
- **Sources:** fiscal federalism (Oates 1999, *JEL*) for how responsibilities and revenue split between levels; Victoria's own structure (state, council; the ESC's rate cap) for the first instance.

### 4.8 Many AI stewards, at different levels, at once

- **Already true:** positions can be held by any controller, and each steward has its own framing, perception, translator use (private, P3) and notebook. Stewards interact only through the world: letters, agreements, laws, money, transfers.
- **What's new:**
  - **Concurrency without losing determinism.** Today the orchestrator runs one participant at a time. With several model-run stewards, wall-clock time adds up. The rule:
    - everyone who wakes at the same simulated moment **observes the state at that moment**;
    - their model calls run **concurrently**;
    - their acts are **applied in a fixed order** (by participant id), never in the order the calls came back.

    That's a small change of semantics: today a participant waking later in the same moment sees the earlier ones' acts. It's worth making now, while nothing depends on it.
  - **Replay:** model outputs are already logged (transcripts), and replay doesn't call models.
  - **Budgets and pacing per steward:** each has its own spending limit and cadence, recorded.
  - **Measurement across stewards:** who wrote to whom, agreements between levels, conflicts (a state overriding a town), and who gets blamed for what. These are queries over the logs.
  - **Scenarios:** a national steward and a council steward from different model families; one model at every level; an AI state over human-run councils.
- **Welfare:** each steward's opt-out and debrief stand alone (VISION §15), and one steward's opt-out doesn't end the run for the others (the stand-in rule, D38).

### 4.9 Humans as participants

- **Same interface.** A human is a controller behind the participant API, like code or a model. They see the world in world terms (D35), speak in plain language through the same translator and resolver (P2, P14), and confirm previews.
- **Time:**
  - the kernel is event-driven, so simulated time can **wait for a human** at a decision point;
  - or a study sets a deadline in simulated or wall-clock time, after which the participant's stand-in acts or it counts as waiting.

  Both are recorded.
- **Replay:** a human's inputs are logged commands, like any participant's, so a run with humans replays byte-identically without them.
- **Ethics:** human participants make a run **human research**:
  - consent;
  - withdrawal at any time (the opt-out, again);
  - the NHMRC *National Statement on Ethical Conduct in Human Research* in Australia;
  - privacy: a human's words are personal data in the log, so the log needs a way to hold them apart (a separate, access-controlled side file referenced by hash, which D4's "large blobs" note already anticipates).
- **Uses:**
  - humans and AIs side by side (an AI mayor, a human councillor);
  - humans as the baseline for an AI's decisions;
  - "Wizard of Oz" citizens;
  - teaching.
- **Contract changes:** a controller kind `human`; wall-clock deadlines as an orchestration setting; personal-data side files in the log format.

### 4.10 Perception at scale

- **Problem:** channels list items one by one. A national steward can't read a million records.
- **Form:**
  - **summary channels:** counts and totals over an area or a kind (people by age band in a region, dwellings by occupancy, money flows by sector);
  - **statistics offices** as content: an ABS-like institution that samples, counts, publishes with a delay, and can be wrong. **Who measures, and how well, becomes a research variable** (VISION's information sources).
  - Cohorts are perceived as what they are: "about 340 people aged 25–34 live in SA1 20604".
- **Contract changes:** summary channels (aggregates over place and kind, exact integers); perception of cohorts and summarised places.

### 4.11 Where worlds come from: generators and real data

- **One interface:** a *world source* emits a world config. Today's generator is one source. **Real-data seeding** is another:
  - **places** from the ASGS (mesh blocks to SA4, with boundaries);
  - **people** as a **synthetic population**, fitted to census tables with iterative proportional fitting (Beckman, Baggerly & McKay 1996). The individuals are synthetic, with the census's distributions: **never real people**;
  - **built stock** from land-use data (Vicmap, OpenStreetMap), summarised or detailed per place;
  - **economy** from ABS input–output tables and labour data;
  - **institutions** from real structures (a council's positions, its budget from its annual report) as the starting point, which the model then runs.
- **Rules:**
  - **Provenance:** every seeded number carries its source and release in the world's metadata, and calibration targets come from the same sources.
  - **Licences:** ABS data is CC BY 4.0 (attribution recorded). OpenStreetMap is ODbL, whose **share-alike** terms may bind derived worlds; check before using it.
  - **Privacy:** no real individuals, ever.
  - **Framing and contamination** (VISION §14): a real place is recognisable. A study can keep real names, or fictionalise them over real structure. Private held-out scenarios stay private.
- **What it gives us:** worlds at any scale without hand-writing them, calibration against the real thing, and richer, more varied test and training data.

### 4.12 Institutions as generic patterns (participant side)

- **Problem:** each office is a hand-written module tied to "city" and "mayor". That doesn't carry to a state or a nation, and it's where rework accumulates.
- **Form: a small kit of parameterised patterns,** configured per world:
  - **revenue instrument:** a tax or charge on a base (property value, income, rent, sales), at a rate, billed and chased;
  - **programme:** a service delivered by work on stocks for a population, funded by a budget line;
  - **budget:** lines, adopted by a body, spent within controls;
  - **transfer:** a payment between levels on a formula;
  - **regulator:** rules on applications under a limit;
  - **statistics office:** measures and publishes (§4.10).

  Each pattern is one module with parameters. A council, a state and a nation are configurations of them.
- **The municipal draft** becomes the first configuration: rates as an instrument, waste and maintenance as programmes, grants as a transfer, and the rate cap as a regulator.
- **Behind the contracts:** no contract change, so this can evolve. It's here because designing it now stops the next ten offices from being hand-written.

### 4.13 Running at scale

- **Now:** one kernel thread; about 70 seconds for two years of 1,000 people; one hash chain.
- **Design so the contracts don't rule out partitioning.** A large world runs as **partitions by place**. Each partition is a kernel with its own state and RNG streams (already keyed). Effects between partitions (a payment, a message, goods, a migrant) **arrive with a minimum delay**: the lookahead that lets partitions run in parallel deterministically. That's conservative parallel discrete-event simulation (Chandy & Misra 1979).
- **What the contracts need now:**
  - effects between places may carry a delay;
  - the log can be several chains under one root.

  D4's "one hash chain" becomes "**one root**": per-partition chains, combined each epoch into a Merkle root. It's still one thing to verify.
- **Build it when the numbers need it**, not before. The contract must just not forbid it.

---

## 5. The call language and the translator

The translator's training waits on this (the previous discussion). The call language stays **physics nouns** (P5), and these foundations add only:

| Call | For | Why it can't be said with existing calls |
|---|---|---|
| `work(task=…, at=…, hours=…)` | §4.4 | Work is a new physical act |
| `goods(kind=…, quantity=…, from=…, to=…)` | §4.3 | Conserved non-money resources; `money` keeps its custody rules |
| counts on `occupancy` and `statement(... count=…)` | §4.2 | Cohorts act by count |

Quantities gain units (§4.5), which the deterministic parser handles, as it does "$1.5k" now. **Everything else is content**: jurisdictions, levels, programmes, humans, real data. **Once v0.5's call language is settled, translator training can start and won't be redone for these foundations.**

## 6. Contracts v0.5 at a glance

| Contract | Changes |
|---|---|
| common | Amounts as decimal-string integers with units; resource kinds; place-scoped ids |
| world-config | `places` (tree; detailed or summarised); resource kinds; state variables and dynamics; task kinds; cohorts; several boundaries; controller kind `human`; data provenance in `meta` |
| blocks | `work`; generic resource transfer; counts on occupancy, sign and vote; `promote` and `demote`; materials consumed by construction |
| participant-api | Summary channels; cohorts and summarised places in perception; place areas |
| log | Several chains under one root (reserved; used later); personal-data side files; new events for resources, work, cohorts and dynamics |
| calls | `work`, `goods`, counts, units |

## 7. Migration: the town keeps working

- Each foundation lands with **the town re-expressed in the new shapes**, as one detailed place with individual people and money only. **Its outcomes must be unchanged**, or changed only where a liberty is retired (materials), and the change explained.
- Old logs replay on their own kernel builds (D6); builds are tagged.
- The generator becomes the first *world source*; the real-data source is the second.

## 8. Order of work

| Phase | What | Why this order |
|---|---|---|
| **A. Cheap now, painful later** | Amounts and units (§4.5); several boundaries (§4.6); the places tree with the town as one detailed place (§4.1, skeleton); the concurrency rule for same-moment wakes (§4.8) | Mechanical, and they touch everything; every later phase builds on them |
| **B. The economy's physics** | Resources and holdings; state variables and dynamics; work (§4.3, §4.4); construction consumes materials | Unblocks services, production, nature and the municipal instance |
| **C. Institutions** | The pattern kit (§4.12); the municipal instance (rates, waste, maintenance, grants, cap); summary perception and a statistics office (§4.10) | A town with something to steward; the first real test of the patterns |
| **D. People at resolution** | Cohorts, life in aggregate, counts in acts, promotion and demotion, equivalence tests (§4.2); summarised places (§4.1) | The biggest piece, with a new class of test; built on stable resources and places |
| **E. Real data** | The real-data world source: an ASGS region, a synthetic population, built stock, a council's budget (§4.11) | Needs D; gives calibration and realistic variety |
| **F. Many stewards, humans** | Concurrent stewards at two levels; the human controller (§4.8, §4.9) | Needs C's levels; humans need ethics set up first |
| **G. Execution at scale** | Partitioning and the root of chains (§4.13) | When a real world needs it |

**The translator:** its call language is settled after phases A and B. Training can start then, alongside C.

**Each phase ends like every stage so far:** all tests green, the invariants extended, docs and decisions updated, and a gap-finding pilot where a real model is involved.

## 9. Decisions for Naz

1. **The frame:** the platform carries §1's full range, and each run chooses its resolution; the town is the first instance and the test fixture. **Recommend yes.**
2. **Places as a tree, detailed or summarised** (§4.1), with the ASGS as the model. **Recommend yes.**
3. **Cohorts, tested by statistical equivalence** (§4.2): a new kind of invariant, since byte-identity can't compare resolutions. **Recommend yes.**
4. **Resources and state variables** (§4.3), retiring the "materials paid to the boundary" liberty. **Recommend yes.**
5. **Work as a kernel act** (§4.4): a new block and call. **Recommend yes.**
6. **Amounts as decimal-string integers with units** (§4.5): a breaking change to every amount. **Recommend yes, now.**
7. **Several boundaries** (§4.6). **Recommend yes.**
8. **Same-moment wakes observe the same state; acts are applied in participant order** (§4.8). This is a semantic change. **Recommend yes.**
9. **Humans as participants** (§4.9): designed now and built in phase F, with ethics set up first. **Recommend yes.**
10. **Real-data seeding** (§4.11): synthetic people only; licences and provenance recorded. **Recommend yes.** Check OSM's share-alike terms before using it.
11. **"One hash chain" becomes "one root"** (§4.13), reserved in the log contract now and used later. **Recommend yes.**
12. **The order of work** (§8), and whether the **municipal draft** becomes phase C's instance. **Recommend yes.**

## 10. Sources

- Australian Bureau of Statistics, *Australian Statistical Geography Standard (ASGS)*, Edition 3 (mesh blocks, SA1–SA4 sizes): https://www.abs.gov.au/statistics/standards/australian-statistical-geography-standard-asgs/edition-3-july-2021-june-2026/main-structure-and-greater-capital-city-statistical-areas/mesh-blocks and https://www.abs.gov.au/census/guide-census-data/geography/census-geography-glossary
- Scheffer, M., Baveco, J.M., DeAngelis, D.L., Rose, K.A. & van Nes, E.H. (1995). Super-individuals: a simple solution for modelling large populations on an individual basis. *Ecological Modelling* 80, 161–170: https://www.sciencedirect.com/science/article/abs/pii/030438009400055M
- Beckman, R.J., Baggerly, K.A. & McKay, M.D. (1996). Creating synthetic baseline populations. *Transportation Research Part A* 30(6), 415–429: https://ideas.repec.org/a/eee/transa/v30y1996i6p415-429.html
- Godley, W. & Lavoie, M. (2007). *Monetary Economics: An Integrated Approach to Credit, Money, Income, Production and Wealth.* Palgrave Macmillan. (Stock-flow consistency.)
- Leontief, W. (1936). Quantitative input and output relations in the economic system of the United States. *Review of Economics and Statistics* 18(3); ABS, *Australian National Accounts: Input-Output Tables*.
- Acemoglu, D. & Restrepo, P. (2018). The race between man and machine. *American Economic Review* 108(6). (The task framework, D24.)
- Oates, W.E. (1999). An essay on fiscal federalism. *Journal of Economic Literature* 37(3), 1120–1149.
- Chandy, K.M. & Misra, J. (1979). Distributed simulation: a case study in design and verification of distributed programs. *IEEE Transactions on Software Engineering* SE-5(5). (Conservative parallel discrete-event simulation.)
- NHMRC, *National Statement on Ethical Conduct in Human Research* (2023).
- Licences: ABS data under CC BY 4.0; OpenStreetMap under the ODbL.
