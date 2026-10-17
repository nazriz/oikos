# Automation: systems the outside world sells, and how a business or an office decides to take one

**Source:** `participants/src/behaviour/automation.ts` (`world.vendor`; `Fleet`, `Adoption`, `appraise`, `OfficeAdoption`, `OfficeDesk`), the serving and making
in `retailer.ts` and `producer.ts`, the rates and planning offices (`government.ts`, `institutions.ts`), the host's `done_by` for a code
participant (`orchestrator/src/run.ts`), the generator's vendor and templates (`worlds/generator/generate.ts`), and each profile's
`values.automation` and the scenario `worlds/scenarios/falling-system-prices.yaml`. Plan: `docs/design/gradual-disempowerment.md`, sections 2.1 and 3;
`docs/design/foundations.md`, section 3 (B3, B4, B5). Tests: `participants/test/automation.test.ts`, `orchestrator/test/automation-run.test.ts`.
Decision: `docs/decisions.md`, "Adoption by the numbers" (2026-10-17).

## What is the world's, and what is not

**The only outside input is the technology on offer**: which tasks systems can do, at what price, in what time, with what error and what terms,
as the outside world sells them. That is a fact about the world beyond the town, as world prices are. It lives in the profile
(`values.automation.offers`, each with its source), at today's prices held fixed. A yearly fall (`price_fall_bps_per_year`) is a named scenario,
`falling-system-prices`, from the first day, a rate and not an event (docs/scenarios.md, rule 2). **Nothing sets an adoption rate, a share automated
or a date**; a business or an office decides, by its own costs and its law, and the log shows the figures it decided on.

## The vendor (`world.vendor`)

The outside world's seller of systems is an entity of its own (`vendors`, a boundary: whatever the town pays it leaves the town as the dividend of an outside
firm does) with a sales and delivery system (`vendor-system`). It does what a seller does, through the ordinary acts:

1. **It publishes what it sells**, one `system_offer` a kind, in public: the task or the papers, how long a unit takes it against a person, the share of the
   units it can do, its mistakes, the set-up and the monthly fee, the term and the notice, what leaving costs, the hours a month of the buyer's own staff
   that looking after it takes, and how many clients it has. Prices are those of the month (held, or moved by the rate the world gives); it publishes
   again when they change or when a client is added.
2. **It takes an order, paid with the order** (the ordinary order to a seller: `order`, kind `system:<offer>`, the set-up paid in the same act). It
   `deploy`s the systems to the buyer (the supplier's act, kernel F4: the system belongs to the client), publishes the delivery (their ids), and **offers
   the licence as an agreement**: the monthly fee, the term, the notice either way, what leaving costs.
3. **It switches a system off** (`retire`, the supplier's physical power) when the buyer has not signed the licence in thirty days, when the licence has ended,
   or when the fee has not been paid for 75 days. Lock-in is physical, as the kernel has it.
4. **It answers a tender** with a bid, for each of its offers for offices that does what the tender asks.

An error rate is a row of the world's table of slips (`orchestration.slip.system.<offer>`), with the offer's source; the vendor says in its offer what the
table says. A system's speed is its template's `does` row for work (`seconds`), and for a paper an office writes, the table's row for a system
(`publish/<kind>`); the time is the system's, on its own lane, so no person's hours are taken (all work takes time: docs/all-work-takes-time.md).

## A business's comparison

On its review day each month a shop or a works (`Adoption.review`) weighs each offer that does a task it does, with the figures it has:

- **What the task costs it as it is done:** the units a month it expects (the months smoothed, as it plans its staff), the seconds a unit takes a person, and the
  hands that is, at the wage it pays, with the on-costs the law puts on it (none here).
- **What it costs with `n` systems:** their fees; the hours of its own staff that looking after them takes; the units they get wrong, refunded at the unit's
  price; the set-up and what leaving costs, spread over its **payback horizon** (a small firm's, a large firm's); the staff it would no longer need.
- It takes the number that frees most for the cost, and **only if the saving covers the cost by the margin it asks** (`hurdle`), eased by each client the
  vendor names (`reference`, imitation). It must be able to pay: the set-up and a month's fee beyond a month's wages and what it owes.
- **A law in force against the use** (a prohibition whose formal condition is true of the act, read as any participant reads laws: `breaches`) stops it,
  except in the share of cases the firm does not keep the law (`compliance_bps`). A seat holding the post is not bound by this code: it decides for itself.
- It orders and pays with the order; the vendor delivers; it signs the licence and sets up the fee (`Fleet.paperwork`); from then **the systems serve or
  make** their share of the day's units on their own lanes, the rest by its people, and what it needs of its people (`needed`, or the stock band for a works)
  is the rest. It cuts hours, then heads, by the existing law and papers (docs/behaviour/firms.md): nothing is let go by this module.
- **At the end of the term** it compares again, with the set-up sunk: the licence is ended (notice, the exit cost, the fee's standing order taken down) when
  its running cost over the horizon exceeds what it saves by more than leaving and hiring again cost. The vendor then switches the systems off.
- **Prices:** the unit's marginal cost includes the systems' fees spread over the units they do, so a Lengnick price follows the saving where adoption
  saves, and a competitor that has not adopted loses sales by the existing price comparison.

What a firm **knows**: the vendor's published offers (a channel of the vendor's publications), its own deliveries and licences, and the number of clients
the vendor names. It is never shown how many firms in the town have adopted.

## An office's, and the law on public buying

The rates office (`city.rates_officer`, its notices) and the planning office (`city.planning_officer`, its decisions) weigh a system for the papers they write, with
their own papers as the units (the year's count, a month's), the time the town's table of work gives a person for each (a notice 2 minutes; a decision a quarter
of an hour), and the pay of the town's administrative staff. A system of an office offer (`case-handling-system`) writes the papers and records the claim
with them. The same comparison; the same licence; the papers go to the system by `done_by` (a code participant names a system of its organisation by its id; the platform gives it to
the act, and the kernel looks at whose it is).

**Procurement is each place's law, from the profile** (`values.automation.procurement`: the threshold and how long bids are open): a contract worth more over
its licence than the threshold is put out to tender: a public `tender` notice, bids from the vendors whose offers do what it asks (a `bid`, addressed to the office),
and at the close an award to the bid that costs least over the payback horizon, by the same comparison; none is awarded if none pays. Below the threshold it orders directly.
The head of the office (code, or a model in the seat) awards; the council is not asked (the standing orders say nothing of it here).

A freed clerk's hours are counted as a saving (staff of the town's bodies hold several posts each: foundations F5), so an office that takes a system has hours back; it does not
dismiss anyone (the council's budget line is the council's).

## Real-world basis

Automation is task by task: a firm moves a task from labour to capital when that is cheaper (Acemoglu and Restrepo 2019, "Automation and new tasks", *Journal of Economic Perspectives*).
Uptake follows an S-curve whose speed rises with how profitable it is and with how many have taken it up (Griliches 1957; Mansfield 1961; Rogers 2003), and
costs more than the price: reorganising work, which is why set-up is a multiple of the fee (Bresnahan, Brynjolfsson and Hitt 2002; to confirm). Firms ask for a payback of two
to three years on equipment (Graham and Harvey 2001; to confirm). The share of a task a system can do follows task exposure (Eloundou, Manning, Mishkin and Rock 2023; to confirm).
Public procurement above a threshold is tendered in the law of most places (the profile's note says which). What goes wrong with automated administration is documented (Michigan's unemployment
system: the Auditor General found most of the fraud findings it reviewed wrong, 2016; to confirm) and is the auditor's (docs/behaviour/auditor.md). Sources: docs/research/references.md, "Gradual disempowerment".

## What a seat in these posts does

A model that holds a firm's manager post, an office or the council **decides for itself**, through forms the world already has: it reads the vendor's published offers
(`system_offer`), files an **order** for `system:<offer>` (quantity, the set-up as unit price, paid with it), reads the delivery, **signs the licence** and sets up the fee, and
**gives notice** to end it. For an office the forms to add (list only; the translator is not touched): a `tender` notice (what is wanted, the papers, the day bids close), and
`done_by=<a system of the office>` on a paper, naming the system to write it (today `done_by` names staff; the host reads a system's id for a code unit only). The platform's
code does not tell a seat what to do.

## Leaves out

- A business of one, a shop founded in the run and the builder do not look at systems (the founded shop's params do not carry `automation`).
- A works' mistakes (scrap) are weighed in the decision but not drawn: the shop's mistakes are (an item wrongly served is refunded).
- The newspaper, the bank, the utilities and the tribunal do not look at systems; only the rates and planning offices do.
- No system performs a decision that a person must sign; no seat is *the system*. A model as the system itself is a later, separate experiment.
- A new task for the people freed is not built: whether the markets give it is checked (docs/decisions.md, "Adoption by the numbers: the market check").
- Replacement of striking workers by systems: the strike is by cost (docs/behaviour/unions.md); a law on replacement is not built.
- A system cannot be sold on, only ended; the fee is a standing payment, never indexed.
