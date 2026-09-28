# Phase B: a production economy, all the way (design)

**Status:** 2026-09-28. Naz: "we are to go all the way, i.e. jobs would require real work, factories would need inputs and shops would need goods. no half measures please." This builds D58 decisions 4 and 5 (resources and state variables; work as a kernel act) and puts the town's whole economy on them. Everything here is built in stages (§6) with tests. Anything flagged ⚑ is a decision for Naz, and doesn't block the build.

## 1. What changes, in one paragraph

Today money moves, but nothing is made. Wages are paid for occupying a workplace; "spending" is a payment to a shop that gets nothing out of it; a factory's output is a researcher-set flow of money from outside; a building's materials are money paid to nowhere. After phase B:
- **things exist:** goods, inputs and building materials, held somewhere by someone;
- **things are made:** people's working hours turn inputs into outputs, and a person has only so many hours in a day;
- **things are bought, delivered and used up.**

Wages pay for work that was done. A factory can't produce without inputs and workers. A shop can't sell what it hasn't stocked, or serve more than its staff can. A household's spending brings home goods it then uses. A building needs its materials and its builders' hours.

## 2. The physics (kernel; contracts v0.5)

**2.1 Resources.** The world config declares **resource kinds** (`resources`: id, unit), e.g. `goods` (items), `inputs` (kg), `materials` (kg). Money isn't one of them: it stays in accounts, with custody at banks (D26).

**2.2 Stocks.** A quantity (a decimal-string integer, like money) of a kind, **held by an entity, at a place**:
- at a structure (a factory floor, a shop's stockroom, a builder's yard, a home);
- or, for an edge (a boundary), at itself: goods outside the world.

Conservation: a kind's total over the world and its edges changes only by work (§2.4). An edge's stock may go negative: goods entering from outside, as with money (D31). Genesis stocks are in the config (`world.stocks`).

**2.3 Moving goods: the `move_goods` block.** The holder moves a quantity from its stock at one place to someone's stock (its own or another's) at a place: a delivery, a handover, a shipment. The physics:
- only the holder can move its goods (custody, like money you keep yourself);
- an edge can deliver into the world, and anyone can ship to an edge;
- the quantity must be there (edges excepted).

**Liberty (D25, geography is low fidelity):** goods move between places instantly, with no transport.

**2.4 Work: the `work` block and task kinds.** The config declares **task kinds**:
- `labour`: seconds of performers' time per unit;
- `consumes` and `produces`: stock per unit;
- `changes`: state variables per unit (§2.5);
- `in`: optionally, the kind of space performers must be in (`workplace`).

`work { task, units, at, performers, on? }`: the acting entity performs `units` of a task at a structure it holds stock at, with named performers. The kernel checks physics:
- the performers are living, present, and in a space (of the task's kind) in `at`: at work;
- each performer has time left **today**: the world's `labour.max_per_day`, a physical limit on a person's working day. The units' labour is shared among the performers, and the kernel keeps each person's time used, day by day;
- the inputs are in the actor's stock at `at`.

It then consumes the inputs, adds the outputs to the actor's stock at `at`, and applies the changes. **Who works for whom is content** (employment agreements), never physics (D20). The kernel checks only that the performers are physically at work, and that their hours exist.

Tasks with no labour are also work: using things up. A household eating is `consume` at home.

**2.5 State variables.** The config declares **variables** on structures, with dynamics:
- `per_day`, and `per_occupant_per_day`;
- bounds `min` and `max`, and an `initial` value.

The kernel keeps them exactly: integers, settled at every change of occupancy, and when work changes them. It attaches **no meaning** to them. Phase B uses **wear** (it rises with age and use; maintenance work lowers it); waste and habitat quality come later. They're perceived through sites channels.

**2.6 Construction and demolition become work.**
- A structure type declares its `materials` (stock per building) and its `build_labour` (seconds), plus `demolition_labour`.
- `construct` takes the materials from the builder's stock at a structure it names (`materials_at`, a yard), and starts the building.
- It completes once `build_labour` seconds of work (the built-in task `build`, `on` the site) have been done, and not before the type's `build_time` has passed, since some processes take time whatever the crew.
- `demolish` starts demolition (its occupants leave, as now), and the structure comes down once `demolition_labour` is done.
- **Retired:** `materials_cost` and `demolition_cost` (money paid to nowhere, the liberty D58 retires). Crews work from their depot (`at`) on the site (`on`): the same no-travel liberty.

## 3. The town's economy (behaviour; docs/behaviour/, sourced)

**3.1 What's made.** Three kinds:
- `goods`: what households buy and use; one kind, as in Lengnick (2013);
- `inputs`: what factories turn into goods;
- `materials`: what buildings are made of.

**3.2 Firms follow Lengnick (2013)**, *Agent-based macroeconomics: a baseline model*, *JEBO* 86, 102–120. It's a minimal, well-cited model with individual trading relationships (no auctioneer), extended here with inputs and retail, both sourced below. Its rules, at its calibration (Table 1), with a month of 21 working days:
- **Wages:** raised by U(0, δ), δ = 0.019, after a month with a vacancy nobody took; lowered after γ = 24 months with every position filled.
- **Hiring and firing:** inventory below φ = 0.25 × last month's demand means hire at once; above φ̄ = 1 × demand means let one worker go, with a month's notice.
- **Prices:** raised if inventory is low and price is below φ̄ = 1.15 × marginal cost; lowered if inventory is high and price is above φ = 1.025 × marginal cost. Each change happens with probability θ = 0.75, by U(0, ϑ), ϑ = 0.02.
- **Liquidity buffer:** χ = 0.1 × the wage bill; the rest paid out.
- **Production:** λ = 3 units per worker-day in Lengnick. Here it's hours of work (§2.4), so output follows the hours actually worked.

**3.3 Factories** buy `inputs` so as to keep a reorder-point stock for the next month's planned production: fixed coefficients (Leontief), from the ABS input–output tables (manufacturing's intermediate-input share, to confirm). They sell goods **wholesale** to shops and export the rest to the outside.

**3.4 Shops** keep stock by Lengnick's inventory rule, applied to their sales, and buy wholesale from local factories or imports, whichever is cheaper. They sell at a **retail margin** (ABS retail trade data, to confirm). **Selling takes staff time:** each item sold is a unit of the `serve` task. A shop with no staff sells nothing, and one with few sells slowly.

**3.5 Households**:
- decide the month's spending with the existing citizen rule (the Bank of England housing model's spending above a buffer: citizen.md); Lengnick's consumption function is the documented alternative;
- buy goods from a few shops they know, Lengnick's "type A" connections (7 of them), switching to a cheaper one with probability ψ_price = 0.25 (if it's more than ξ = 1% cheaper), and away from one that couldn't serve them with probability ψ_quant = 0.25;
- pay through their bank, and the shop delivers home;
- use the goods up over the month (`consume`).

⚑ **Going without:** a household that can't buy enough is recorded, and that feeds its grievances (existing voice rules). Making it **physical** (hunger harming health) would be life physics; propose it separately.

**3.6 Employment is real:**
- a worker is at work by occupying a workplace space (as now);
- the employer's system directs the day's work with the hours of the workers present (§2.4);
- output, sales and service follow from those hours;
- wages are paid per agreement, whether or not the work was productive: that's the employer's risk;
- hiring and firing follow §3.2.

**3.7 The builder** keeps materials at its yard, buying them from the outside (imports) or a local maker. Its crew's hours build and demolish. Its published prices are materials plus labour at its wage plus its margin: they now follow from real costs.

**3.8 The outside world** (the edges) sells `inputs`, `materials` and `goods` at world prices (researcher-set parameters), delivering against payment. It buys exported goods at a world price, up to a researcher-set demand. It replaces `world.export_demand`'s flow of money.

**3.9 Wear:** buildings wear with age and use (a variable, §2.5). Landlords' and the town's maintenance comes in phase C; in phase B wear is recorded and perceived.

## 4. The call language

- `goods(kind=…, quantity=…, to=…, at=…, from_at=…)`: move goods.
- `work(task=…, units=…, at=…, performers=[…], on=…)`: perform work.
- `structure(...)` takes `materials_at` instead of paying for materials.

The resolver checks what it can from the participant's own knowledge (its stocks, its workers), and the preview says it plainly: "You will ship 40 items of goods from the factory to Shop 3", "Your workers c0012 and c0040 will spend 16 hours making 48 items of goods".

## 5. Measurement (outside the world)

New tables and queries: stocks over time, production, sales and prices by firm, wages, employment and vacancies, monthly value added (a town "GDP"), inflation, household consumption and going-without, and imports and exports.

Calibration targets: unemployment (ABS Labour Force), the retail margin, and manufacturing's input share (ABS input–output). Lengnick's stylised facts (unemployment of a few percent, very small unmet demand) are a behavioural check, not a target.

## 6. Stages

| Stage | What | Checks |
|---|---|---|
| B1 | Kernel: resources, stocks, `move_goods`; edges' goods; genesis stocks | Conservation of every kind (property test); custody; the physical-feasibility oracle extended |
| B2 | Kernel: task kinds, `work`, performers' daily time, state variables (wear), construction and demolition as work | Capacity never exceeded; inputs needed; variables exact; construction completes only with materials, labour and time |
| B3 | Contracts, the call language, resolver and preview; translator test cases | Contract examples; resolver tests |
| B4 | Behaviour: the outside world as a trader; factories, shops and employers (Lengnick); households buying and using goods; the builder with a yard and crew; docs with sources | Unit tests per module; the town runs |
| B5 | The generator: resource kinds, tasks, genesis stocks, yards and stockrooms, world prices; calibration | Two-year runs over several seeds; measured against the targets |
| B6 | Measurement queries; docs; a comparison with the phase-A town (explained, not identical: the economy is new) | Batch runs; a gap-finding pilot with a real model later |

## 7. Liberties taken (D25)

- Goods move instantly between places (no transport).
- Crews work from their depot on a distant site (no travel).
- A working day is a physical limit on hours; when in the day the work happens isn't modelled.
- One kind of consumer good (Lengnick's).
- Going without has behavioural consequences only (⚑ above).
