# Standing work: a routine set once, and followed by the staff

**Source:** `StandingWork` in `participants/src/behaviour/common.ts`; `routines` and the `part` parameter on
`city.works`, `clinic.practice`, `school.principal`, `utility.water`, `utility.energy` and `city.rates_officer`; both
resolvers' `work` with `every`; the generator's staff posts. Contract: contracts/calls.md, "A standing work order".
Decision: docs/decisions.md, "Standing instructions for work" (2026-10-09).

## What it is for

Payments have `every`: a wage is set up once and the bank pays it each fortnight. Work had nothing like it. A code
office dispatches each task itself, each day: the works office every bin round, the clinic every consultation, the
school a lesson a classroom. A model in such a seat sits about once a working day and may make eight acts an answer:
the works office's round alone is dozens of acts a day. So those offices could not be seats
(docs/waves/wave-2/plan.md, gap 1).

In a real office the manager does not order each bin round each morning. There is a roster, a round, a timetable, a
standing work order, and the staff follow it until it is changed. The manager sets it and then manages by exception.

## How it works

1. **A standing work order** is `work` with `every`: `work(task=collect, at=town-hall, every="7 days")`. It says what
   task, where and how often, and may say on what (`on`, one thing or several), by whom (`by`), how much each time
   (`units`), how long until it starts (`first`) and for how long it goes on (`until`). It is a statement of kind
   `work_order` on the organisation's own file, addressed to the organisation, seen by it (and by anyone it names).
   Nothing is done when it is made, and the kernel does nothing with it.
2. **The staff follow it.** An office's routine work is its staff's. Each time an order in force falls due, they do
   the task, in their own working hours, as `work` acts that name who did it: the same acts, at the same cost in
   time, as before. With no order in force for a task they do not do it. Nothing carries itself out.
3. **It is changed like any standing instruction.** The latest order for a task is the one followed. Withdrawn
   (`statement(withdraw=…)`), it lapses. On hold (`statement(hold=…)`: the hold goes on the organisation's own file,
   where its staff read it), it is not followed until the hold is withdrawn; what was not done under a hold is not
   made up. Past its `until`, it is over.
4. **How much each time is the staff's craft** unless the order says: the crew judges the loads at each address from
   what it found there last time, the doctors the consultations a condition takes. That knowledge was the office's
   code and still is.

**Who the staff are.** Each office module can run as one of three parts (`part`):

| Part | Who | Does |
|---|---|---|
| "" (the whole office) | a code-run office, as before | everything, by its own practice, with no order. Nothing about a code-only town changes |
| "seat" | the office-holder alone | the office's decisions, its papers, taking staff on and standing them down; sets the standing orders once; none of the routine |
| "staff" | the office's staff | each routine while an order is in force for it; nothing else of the office's business: no hiring, no letters |

Where a model holds an office whose module declares routines (`routines` in its manifest), the generator gives the
office's staff a post of their own (`works-staff`, `clinic-manager-staff`, ...), run by the office's own code as the
staff part: the leading hand, the charge nurse, the billing clerks. The staff post has the office's premises, stock
and registers, and reads the organisation's papers; it is the organisation's, so its work uses the organisation's
people and goods as the office's did. The office's own procedure, a paper on its file (`proc-<office>-routines`),
tells whoever holds the office that its staff work by standing orders and only by them, and what the tasks are. That
paper and the previews are all a seat is told: the world's terms.

**What `by`, `units` and a clerical task mean today.** The routines built take whoever of the staff is at work and
judge the amount themselves; an order's `by` is recorded and shown to those named, and `units` is recorded, and
neither changes what the built routines do. A task may be office work as well as hand-work ("bill", "levy",
"enrol"): the clerks' time is not modelled, as a code office's paperwork never was, so those cost nothing in hours.

**Real-world basis.** A waste service runs to a collection schedule and crews work rostered rounds; a clinic's
doctors work a sessional roster and see whoever is booked or waiting; a school teaches to a timetable; a billing
office runs a billing cycle; standing orders in an organisation's own procedures tell staff what is done without
being told each time. **(to confirm: common practice; no source opened. Candidates: a council's published waste
collection schedule and service standards; a hospital or clinic rostering policy; a school timetable policy; a water
retailer's billing cycle in its customer charter.)**

## The staff's report: what was done under each order, or why not

**Source:** `did`, `heldUp`, `note` and `report` on `StandingWork` (`participants/src/behaviour/common.ts`); each staff
part's own count; `Roster.orders` (`participants/src/behaviour/roster.ts`). Decision: docs/decisions.md, "An office
held by a seat gets its work done" (2026-10-09).

A manager who sets a round does not watch it; the depot tells them how it went. In the wave's first works pilot
nothing did: a crew of five was in post, nobody came to work, and in 180 days nothing the seat was shown said so
("crew 6/6, nothing more to do"). The water seat wrote of its billing order: "Silent success and silent failure look
identical."

- **The staff keep their own count** of what they did under each order (how many times, how much, who of them worked)
  and of why an order in force was not carried out when it fell due. Nothing is asked of the engine: it is what they
  did and what they found at their own premises.
- **They report it to the office**, as a paper on the organisation's own file (a statement of kind `staff_report`,
  addressed to the organisation and seen by it alone; `data.office` names the office, `data.orders` each order with
  how it stands, `data.staff` each person in post with when they last worked). **The day how an order stands
  changes** (it is being carried out; it is not, and why; it is on hold; it names a task the staff do not have), and
  **about weekly otherwise**. With nobody in post there is nobody to report: the office-holder's own roster says that.
- **How an order stands, as the staff say it:** `carried out: 430 calls at addresses, 1026 loads`, with what the
  hours left undone (`12 addresses due were left when the crew's hours ran out`); `in force; nothing fell due`;
  `not carried out: none of the 5 in post was at the depot (town-hall/workplace.1) when the day's work was set out`;
  `not carried out: the staff have no routine called "sweep" (their routines: collect, maintain)`; `on hold`;
  `begins year 1, day 37`; `replaced by rec.9`.
- **The office-holder sees it twice**: the report as a paper when it comes ("Reports from the staff on the work under
  the standing work orders"), and its roster (docs/behaviour/office-papers.md, "An office's own staff"), which now
  says for each person in post when they last worked and at what, or that they have not come in and why, and under
  it each standing order as the staff last reported it. A report from its own staff does not bring a seat back early
  (its office's own papers never do): it is read at the seat's next sitting.
- **Why a person has nowhere to come to work** is the staff's to know from the papers: the employment agreement names
  no place of work, and cites no advertisement that does (docs/behaviour/firms.md, "An offer made on an
  advertisement").

**Real-world basis.** A depot keeps a daily worksheet and a supervisor returns it; a waste service reports missed
collections and their reasons against its schedule; a manager's exception report says what was not done and why.
**(to confirm: common practice; no source opened.)**

**Built for every staff part.** The works crew (calls and loads, upkeep jobs, what the hours left undone); the
doctors (patients seen) and the teachers (lessons, classrooms left without a teacher, enrolments answered), each
with who of them worked and "none of the N in post was at the clinic (...) when it opened" where nobody came; the
energy retailer's staff (days' supply, what is held, why nothing was bought when stock ran low, when the next bills
go out); the water corporation's staff (days' draw, "the river could not give what the town uses", when the meters
are read and the next bills go out); the rates clerks (notices sent, when the next go out, or that no property has
been valued yet).

**A round of bills is counted from its order** (2026-10-09). The water and energy staff send the first bills one
period after the standing order came into force (and a new order starts its own count); until then they kept the
office's own first date whatever the order said, so a seat that ordered water bills every 30 days had none in 43.
The rates notices keep the rating law's instalments: the order says that they are sent, the law says when.

## The routines that exist

| Office | Task | What the staff do while an order for it is in force |
|---|---|---|
| works | `collect` | the round: every address as often as the order says (or the addresses it names), complaints first, within the crew's hours; the week's waste to the landfill with a docket |
| works | `maintain` | with the hours the round leaves, upkeep of the town's most worn assets; an asset nobody has seen is inspected |
| clinic | `treat` | each working day, in opening hours, the doctors see those waiting, in the order they asked |
| school | `teach` | each school day, each classroom with pupils is taught by a teacher at work |
| school | `enrol` | enrolments answered with a place or a letter; leavers given their certificates |
| water | `draw_water` | each day, what the town uses is drawn from the river; restrictions announced when it cannot be |
| water | `bill` | the meters read on a round, then every owner billed; how often is the order's |
| energy | `supply_energy` | each day's supply to the customers; the grid bought from when stock is low; customers taken on and off |
| energy | `bill` | every customer billed; how often is the order's |
| rates | `levy` | the notices sent to every owner at each instalment the rating law sets, and penalty interest added monthly to what is overdue (the law says when; the order says that it is done) |

## Which offices can be seats now

Measured on a 100-day mock run of a 300-person town with six of them as seats (each seat's brain the office's own
code as the seat part; what the staff posts did is the count in the last column).

| Office the wave left out | Now | What the seat did in 100 days | What its staff did under the orders |
|---|---|---|---|
| works (was a probe) | **can be a seat** | 2 standing orders; advertisements and offers for crew as posts fell vacant | 3,225 collections, 116 upkeep jobs, 14 loads to the landfill |
| `clinic-manager` | **can be a seat** | 1 standing order; payroll papers | every consultation asked for (8) |
| `principal` | **can be a seat** | 2 standing orders; payroll papers | 218 lessons, 6 places, 1 certificate |
| `water-operations` | **can be a seat** | 2 standing orders | 99 daily draws, 215 bills |
| `energy-operations` | **can be a seat** | 2 standing orders | 99 daily supplies, 394 bills, 5 orders to the grid |
| `rates` | **can be a seat** | 1 standing order | 76 notices and their claims, 5 interest letters |
| `builder-foreman` | not yet | | Its site work is the same shape (a routine "build what is begun, each working day") and was not converted: taking a contract on, buying materials, beginning a building and invoicing are the foreman's acts, about five a job, and need a careful split of the module's one plan |
| `fund-trustee` | not yet (and off unless a town asks for a fund) | | Its pension run is one bulk instruction a month: the same pattern as `bill` (a routine "pay_pensions"), not converted |
| `bank-payments` | no | | It is the payment system: every payment in town is its routine. A seat there would set one order and could do nothing useful but stop it. Machinery, not an office |
| shops and factories | **cannot be seats yet** (2026-10-09) | In the first trade pilot a shop seat and a factory seat sat for 30 days and nothing was sold or made | See "Shops and factories" below |

**Shops and factories: not seats yet, and why (2026-10-09).** Their code does by hand, many times a day, what no
seat can: a shop takes each paid order, has those of its staff who are in at that moment serve it (`work`, naming
them), moves the goods to the customer's home, writes a delivery note and refunds what it could not serve within
three days; a factory, each working day, has those in at that moment make what the inputs and its stock band allow.
A seat sits about weekly, before its staff arrive (its premises read "0 people"), and makes eight acts an answer. Two
more things are missing for a shop: its prices are a price list with an offer and the account to pay, which no form
of fields writes, and nobody can order from a shop with no price list; and what customers wanted is counted by the
code as it serves, so a seat would not know its demand. Neither seat was told any of this: no paper on their files
says how the office's work gets done. What it takes: `serve`, `make` and the filling of wholesale orders as routines
of a staff post (the same plumbing as the works crew, with the module's one plan split in three: what the staff do,
what they report of demand and stock, what the manager decides from the report); a price list form; and the staff's
report. That is a redesign of two modules, not a patch, and it was not half-done: a shop or factory named in
`model_seats` still generates (the mock in the seat runs the whole office by hand, which is how the forms are
exercised), and a model put there will repeat the first trade pilot.

**The bulk act.** The wave's second gap was that an office that bills or notifies everyone makes hundreds of acts an
instalment. No bulk act was built. It fell out of this one: billing is the billing clerks' routine, set going by a
standing order, and the clerks send each bill as they always did. What a seat cannot do is send one particular set of
several hundred papers by its own hand in one sitting; nothing has asked for that. If something does, what it would
take is not a new act but a routine with the list as its `on`.

**Still by hand, and why that is right for now:** an election (the roll, the ballot paper, the count:
docs/behaviour/office-papers.md) and the clerk's enactment of an amended law are staff work of the same kind and were
not converted; both offices are in the wave as seats and will show the block.

## Leaves out

- **A code-run office issues no standing orders**: it keeps its routine in its own head, as before, so that code-only
  runs are unchanged. The two forms of one office (whole, or seat and staff) are held to the same behaviour only by
  sharing the code.
- **Rosters of named people and shifts.** `by` is recorded, not enforced; there are no shifts.
- **A staff post that does not follow.** The staff follow every order in force; there is no parameter for a crew that
  shirks, as there is for an office that ignores a direction.
- **The seat's sight of the routine** is the staff's report and no more: counts and reasons, about weekly. Which
  addresses were left is not in it; a seat learns that from complaints and from what it goes to see.
- **An order's `at` is not checked against the staff's premises.** The staff work from their own premises whatever
  place an order names; a wrong place is not reported.
- **A seat that sits before its staff arrive** still sees "0 people" at its premises in that sitting's look (the
  look is of that moment); the roster's "last at work" is what tells it the staff came.
- **Energy used while a supply order is on hold** is still owed by the network and supplied when the order is back;
  water not drawn on a day is not drawn later.
