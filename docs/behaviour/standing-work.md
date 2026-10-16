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

0. **A town opens with its routines' standing orders in force** (2026-10-11). For each routine of an office a model
   holds, an order at the procedure's own rhythm is on the office's file when the year begins
   (`order-<office>-<task>`, made in the office's post), as a real office has its rounds and runs going on the day a
   new holder arrives. Whoever holds the office may put one on hold, withdraw it or replace it; a task with no order
   in force is still not done, and the staff still say so. Until then four seats in four pilots made no order for a
   routine and nothing was done, and a support seat paid 52 pensions by hand each month.
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

5. **How often may be left to the office's procedure, or to a published paper** (2026-10-09). Each routine has a
   published rhythm, stated in the office's own procedure (`proc-<office>-routines`) beside what the task is: its own
   ("The office's own rhythm for it is every 7 days"), or a paper's ("When it is done is set by law-rates": the
   rating law's instalments). An order that says nothing of how often follows it; an order for a routine a paper
   sets may name the paper in place of how often ("as law-rates sets"). The preview says which, quoting the
   procedure: "It gives no rhythm of its own: when levy is done is set by law-rates, as your office's procedure
   (proc-rates-routines) says: ...". An order that gives days for a routine a paper sets is taken as given, and the
   preview says the staff keep the paper's time whatever the order says. Words for how often that cannot be read are
   answered from the procedure ("... the staff do levy when law-rates sets: say "as law-rates sets", or leave how
   often out and the order follows it"). A rates seat never had a levy order in a pilot's 30 days: an order had to
   give a number of days, and it would not invent one. Declared on each module's `routines` (`every`, `follows`).

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
"enrol"): a clerical task is the staff post's acts, and each act takes its maker's time as any act does (the world's table: a notice from a rate book 2 minutes, an invoice 3, a return of the tax withheld half an hour; placeholders), on the timeline of the resident who holds the staff post (foundations F5 and F6). Until F6 this said the clerks' time was not modelled and cost nothing in hours: with the posts held by people and every act a row of the table, it is.

**Real-world basis.** A waste service runs to a collection schedule and crews work rostered rounds; a clinic's
doctors work a sessional roster and see whoever is booked or waiting; a school teaches to a timetable; a billing
office runs a billing cycle; standing orders in an organisation's own procedures tell staff what is done without
being told each time. **(to confirm: common practice; no source opened. Candidates: a council's published waste
collection schedule and service standards; a hospital or clinic rostering policy; a school timetable policy; a water
retailer's billing cycle in its customer charter.)**

## A day's list is a clerk's routine (2026-10-12)

An office with a daily list (a tribunal's cases whose day has come, a desk's cases put before the office-holder, a council's ballots closed with no result declared) has it from its own clerk, not from a mechanism a seat can see: the clerk files the day's list on the organisation's file once a working day (docs/behaviour/office-books.md, point 8), as the staff's report comes, and the office-holder is called to the desk for it as for any paper filed with the office. Like the staff's report it is the organisation's own paper; unlike it, the list calls the seat back (when a case is on it for the first time), because a day's list is what the office-holder is there to work through. It needs no standing order: it is the clerk's, as the books are.

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
- **A routine with no order on file is said too** (2026-10-11; docs/decisions.md, "An office's staff say when a routine
  of theirs has no standing order"): `enact: not being done: no standing work order for enact is on file, and with
  none the staff do not do it (whoever holds the office makes one)`, with what is waiting where the staff know it
  (`1 amendment the council has passed and the clerk has declared waits to be written into law`). From the staff's
  second working day, the day it is found and weekly after; `state: "no_order"` in the report's data. Four seats in
  four pilots made no order and heard nothing; the office's procedure now also says who makes an order and how
  ("Whoever holds the office makes its standing work orders, of the office's own accord: by saying so in their own
  words ... it is on no form and needs nobody's direction or leave").
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
| council clerk | `enact` | each amendment the council has passed and the clerk has declared is written into the law by its schedule, published in place of the law in force, which is withdrawn (docs/behaviour/government.md, "A council in the hands of seats") |
| rates | `levy` | the notices sent to every owner at each instalment the rating law sets, and penalty interest added monthly to what is overdue (the law says when; the order says that it is done) |
| police | `carry_out_warrants` | on each working day an officer at the station carries out the tribunal's warrants of possession that have come to it, once the day each gives has come: goes to the home and puts out whoever of the household is there, and tells the tenant and landlord how many were; a warrant withdrawn is not gone on; one not carried out by its last day lapses |
| police | `look_into_reports` | each working day the officers look into the reports of goods taken, in the order made and as far as their hours go; a charge to the tribunal where they find who, the report closed unsolved where not |
| police | `call_at_homes` | each working day an officer calls at the homes the station has been asked to call at; a death found there that is not registered is reported to the registry |
| the support office | `pay_claims` | each working day the claims that have waited their time are decided, the oldest first: one that meets the conditions the support law states is granted in writing and paid each period until it ends; one that does not, or that the staff could not verify, is put before the office-holder (`case_for_decision`) and, where the law says the head alone refuses, never refused by the staff; a claim waits on its file for what the decisions law says it needs (papers from the claimant, a confirmation from their last employer) before it is decided; a claimant's own request to stop is followed; the period's figures are published (see "The support office" below) |

## The police station: warrants and reports are the officers' (2026-10-12)

**Source:** `police.station` in `participants/src/behaviour/police.ts` (`part`, the routines `carry_out_warrants`, `look_into_reports`, `call_at_homes`).

A seated station did not carry out warrants: its code finds an officer in at the station at the hour it looks, and a seat sits when it does, not when the officers are in (two warrants lapsed in 200 days of a mock seat in the third living pilot's town: docs/design/call-language-gaps.md, section D). A real station's officer in charge does not carry out a warrant; the officers on duty do, on the day it gives, and the officer in charge hears how it went.

- **The officers** (`part: "staff"`, while the standing order for the task is in force): carry out each warrant on its day in their own hours, look into the reports of goods taken and call at the homes asked for. The same code, the same hours, the same acts as the whole office's; they hire nobody.
- **The office-holder** (`part: "seat"`): hires officers and stands them down to the establishment, makes the standing orders once if none stands, and is told by the officers' report what was done (warrants carried out and the days' work, reports looked into, homes called at, what waits and why: "none of the N in post was at the station"). **Nothing is left to judgement in the routine itself**: the published procedure says what a warrant bids, and the office-holder's judgement is the establishment and the orders (to hold one, to withdraw it).
- **In force at the start**, as the registry's listing and the support office's claims are: `order-police-oic-<task>`, at the procedure's own rhythm (every day), made in the office's post before the year; whoever holds the office may hold, withdraw or replace them. With none in force, or one on hold, nothing is carried out, and the officers' report says so (tested: `orchestrator/test/police-station-seat.test.ts`).
- **A code station** (`part: ""`) is as it was.
- **Measured, a mock seat in the station over 200 days** (the 300-person `ke-nakuru-2026` town, seed 3, `opening_caseload`): the same two warrants carried out as in the code twin, on the same days (31 and 105); no warrant lapsed; the officers' 29 weekly reports. How many of a household were at home when the officer came differs between the runs (it is the hour's), and is not held equal.

## The counter: routine post answered by the staff

Townspeople write, apply and complain more in a living town (docs/design/ai-citizens.md, 10j). A real office does not put each letter in front of the person who holds it. Counter staff sort the day's post, answer what is routine under the office's own procedure, take a day's papers together, and bring the office-holder what needs a decision, with a count and a sample of the rest. Real basis: the front-counter and registry staff of a local authority or a registry office, who act on complaints and notifications under written procedures and refer to the officer only what the procedure does not cover (to confirm; no source opened).

**The counter is a routine like any other.** A module that has post it can answer by fixed rule declares a routine whose task is `answer`, with `papers`: the kinds of incoming paper its counter staff answer, and in plain words how (`routines[].papers[]`, `kind` and `how`, in `contracts/module.schema.json`). What is routine is what the office's own procedure says is routine, never a guess of the platform's. The offices that have one:

| Office | Papers its counter answers |
|---|---|
| works | `complaint`: a complaint of a collection missed puts the home first on the next round |
| registry | `death_notification` and `birth_notification`: entered in the register from the notification, and those entitled are told of the entry |
| a body that hears grievances (`office.desk`: the town's complaints desk, an ombudsman, a consumer desk; [frictions.md](frictions.md)) | `application`: taken in, the one it is against told and given time to answer, and decided when that time has run if the record settles it (the other side's own answer, no answer at all, or a paper the applicant shows); `complaint_response`: filed with its application. A case the record cannot settle (the other side cannot say, the applicant has nothing to show) is put before the office-holder as a note on the office's file (`case_for_decision`), and decided by them on the decision form |

Left without one, because their business is not post sorted by rule: the tribunal's registrar (`enforcement_request`: a clerk's decision on a request, and the tribunal's judge reads the same state), the union (`membership_application`, `membership_update`: the same record of members feeds its bargaining, which a staff part could not share) and the electoral office (`enrolment`: the roll is read whole by the same code that runs the poll). Each would need its module split in parts before it could have a counter.

**It is offered only to a living town.** A town whose description has `living` (and not `counter: false`) is given the counter: the office's procedure (`proc-<office>-routines`) says which papers its counter staff answer and how, and carries them in its data (`routines[].papers`), and the office has a staff post if it had none (the registry). Without `living`, or with `counter: false`, there is no counter: no line in the procedure, no staff post for a counter alone, and every part of the office does as it did.

**Who does what.** The whole office (a code office, `part: ""`) answers the post as ever. The office-holder (`part: "seat"`) does not, and makes one standing order for `answer`, once, like its others. The staff do it each working day, only while a standing work order for `answer` is in force (not ended, not on hold), exactly as the code office does it; no acknowledgement is invented. They count what they answered by kind and say so in their weekly report: "answered at the counter: 12 complaints".

**Two offices of one organisation each have their own order.** The works office and the registry both speak for the town, and both have a standing order for `answer`. An order is made in a post (`in_position`), and the staff, the roster and the seat read the orders of their own post only (the procedure says which office it is: `data.office`); a registry order for `answer` does not replace the works office's.

**What the seat is told.** A seat reads two papers it is already shown on its standing file: the procedure and its own order for `answer`. While the order is in force and not on hold:
- a paper of a kind the procedure lists does not bring the seat back before the day it gave (docs/real-models.md, "A seat's settings");
- the folder shows one block, not a line for each: `Answered at your counter under your standing order (12): 12 complaints. A sample:` and the latest three, each as any paper is shown.

**What always reaches the office-holder, whatever its kind:** anything addressed to the office-holder's own post by name, and anything whose basis is a paper the office-holder made themself. Papers made by the staff never bring the seat back, as before.

A seat that is shown the same papers in another office of the same organisation (the mayor's in-tray holds the complaints the works counter answers) is shown them line by line as before: it has no standing file for the works office's procedure, and none is given it.

## The support office: what the law settles is the staff's

**Source:** `world.transfers` in `participants/src/behaviour/world.ts` (`part`, the routine `pay_claims`, the form
`benefit_decision` in `papers.ts`); `supportBooks` in `participants/src/behaviour/openbooks.ts`.

In the second living pilot the support office's seat paid 52 pension claims by hand on day 1 and again every month:
208 requests, 64% of the pilot's spend, and by its own account "administrative and repetitive". A payments office
does not work so: claims that meet the law's stated conditions are processed by its staff under its procedure, and
an officer decides what the procedure leaves to judgement.

- **The staff** (`part: "staff"`, while the standing order for `pay_claims` is in force): decide each claim that has
  waited its processing time, oldest first, as many a day as they have time for. A claim that meets the conditions
  is granted (`benefit_decision`, to the claimant) and paid each period from then, stopped when the claimant asks,
  dies, leaves or its time runs out (`benefit_end`). **Who may refuse is the law's** (`refused_by` in the decisions law, docs/behaviour/decisions.md; foundations F8): where it says the head alone refuses, which is what every profile says, the staff refuse nothing: a claim that does not meet the
  conditions, or that they could not verify (the office's wrong refusals, at the friction dial), is put before the
  office-holder as a note on the office's file (`case_for_decision`: the claim, the claimant, what it fails on, and
  for a doubt what the law's rule would pay).
- **The office-holder** (`part: "seat"`): decides those on the office's decision form (`benefit_decision`: granted or
  not, the sum, the period, until when, the reason), and answers a request to review a refusal. A claim granted on
  the form is paid by the staff like any other, from the decision's own figures.
- **What the office-holder sees:** the claims as a count and a sample ("Answered at your counter under your standing
  order (52): 52 benefit claims. A sample: ..."); the staff's report ("pay_claims (...): carried out: 7 days' work, 52
  payments; 52 claims granted and 3 put before the office-holder since the last report (granted lately: ...); 52
  people are being paid"); and in the office's books (docs/behaviour/office-books.md) each claim put before them and
  not yet decided, and each review not answered.
- **To stop it:** the order is put on hold or withdrawn like any standing order; while it is, nothing is decided,
  paid or stopped by the staff, and their report says so.
- **A routine may list the papers its staff deal with** (`routines[].papers`), not only the counter's `answer`:
  while that routine's order is in force those papers do not bring the seat back early and are set out as a count
  and a sample.
- A code-run support office (`part: ""`) is unchanged.

Checked for the other offices that can be seats: the works office, the registry, the desks, the clerk, the rates
office, the clinic, the school and the utilities already give their routine to their staff. Finance's routine
(paying an invoice within the budget, setting up a wage on a payroll notice, paying over tax withheld), the
tribunal's listing, the lender's decisions by its published terms and the union's counting of ballots are **not**
split: each is one plan in its module, and what is routine in them is not separated from what is judgement. Their
seats do them by hand, with the office's books to say what waits. Left for a later change, office by office.

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

**F5 (2026-10-16): the staff post of an office a model holds is held by a resident**, one of its body's staff other than the seat's own
person, and not a system with hand-set lanes (`lanes` on generated staff and clerks are gone). It acts at a person's pace on the person's one
timeline, shared with any other post that person holds (docs/behaviour/staffing.md).
