# An office's own papers, as forms

**Source:** `participants/src/forms.ts` (how a form writes a paper), `participants/src/behaviour/papers.ts` (the
papers), `issues` and `issuesWith` on each module, the generator's `stationeryForm`, both resolvers' `form`, and
`onOwnForms` in `participants/src/llm/mock.ts`. Design: docs/design/call-language-gaps.md, B.6. Decision:
docs/decisions.md, "Forms for an office's own papers" (2026-10-09).

## What it is for

A registrar fills in a register entry; a manager places an advertisement with its terms. Each office has its own
stationery. The code that runs these offices writes each paper as a typed statement (`death_registration` with who
died, `job_posting` with its terms and its offer), and the rest of the town reads the type and the fields. A model in
the seat had no way to write one: in pilot 12 the works manager asked 14 times in 21 days to hire a crew and hired
nobody, and the registrar asked twice to register a death and registered none.

## How it works

1. **A module says which papers its office issues** (`issues` in its manifest): for each, a form's name and fields,
   and `writes`: how the fields are written into the statement (its kind, its words, its content, whom it is
   addressed to, who sees it, what it cites, what it offers). What is the office's own (its premises, whom it sends
   every entry to) is marked "@name" and filled in by the world (`issuesWith`).
2. **Where a model holds the office, the world publishes the forms for it**: one record a form, in the organisation's
   name, seen by the organisation alone, marked with the office (`data.office`). A code-run office has none: nothing
   about a code-only world changes. The seat is shown its own office's forms ("The office's own forms"); another
   office of the same organisation is not shown them and cannot fill them in ("You haven't seen a form by that name").
3. **The seat fills the form in** (`form(form=death_registration, deceased=c0242, notification=rec.17236,
   reported_by=c0243)`), and the resolver writes the paper as the form says. It is the same statement the module
   makes: same kind, content, addressees, visibility, basis and offer. Its words are the form's, or the seat's own if
   it gives them (`text=`). Nothing new in the call language; nothing in the kernel.
4. **A form of this kind does not cite itself.** A paper's basis is what the form says it is (the notification a
   registration is made on).

5. **A form says whom it sends every paper to, and why** (`sends` in `writes`, 2026-10-09). Some recipients are no
   field's: the registrar's entries go, as of right, to whoever keeps a roll of electors and whoever pays a pension
   or support (`feeds`); a docket goes to the landfill. Each form states them with the reason, in its own words, on
   the form itself ("Every paper made on it also goes to outside and electoral-commission: They are sent every
   entry in the register of deaths as of right, ...") and a draft's preview says of every recipient why it is there:
   the field that names them with what the form says of that field, or the form's own reason, marked "not for you
   to choose". A registrar declined seven right death registrations in a pilot because two bodies were on each and
   nothing said why. `orchestrator/test/office-form-preview.test.ts` holds every module's forms to it: none sends a
   paper to someone of the office's own without a reason. The same reading gives each detail of such a paper its
   kind, so a sum reads as money in the preview ("rent received: £3,813.75", where it read "381375").

A field may be a `list` (several ids) or a `date` ("year 1, day 12", as reports write one; or a moment in seconds as
a record has it); a count may be nought. In `writes`, "=name" is the field as read, "#name" an amount or count as a
whole number, "?name" a yes or no as true or false, "+name" a length of time counted from now, "=self" whoever the
paper is made for; a field not given leaves its key out.

**The mock.** A mock seat's brain is the office's code, which writes statements. The mock now says each as a seat
would: on the office's form, where the office has one that writes exactly that statement (checked by writing it
back). So a mock-seat run exercises every form its offices have, and what stays a plain statement is listed below.

**Real-world basis.** Registers are kept on prescribed entries and notices on prescribed forms: a registrar of
births, deaths and marriages enters a death from the notification and the particulars the law lists
(docs/behaviour/deaths.md has the sources for who reports and what is registered); an employer's advertisement
states the post, the pay and where the work is. **(to confirm: no source opened for the forms themselves.)**

## An office's own staff

**Source:** `participants/src/behaviour/roster.ts`; `staffed` on each module that employs (`city.works`,
`city.environment`, `clinic.practice`, `school.principal`, `police.station`); `orchestrator/src/run.ts` (the roster
kept for a seat); the standing work order's preview in `translator/src/preview.ts`.

An office knows who works for it. Where a model holds an office that employs staff, it is shown, at its first sitting
and at any sitting where the list has changed:

```
## Works manager: Staff of your office
Posts (works crew): 6 (the staff line of the budget for year 1 (budget-year-1), ..., pays for that many at ... a year each).
In post: nobody.
Vacant: 6.
There is nobody in post, so the work that is the staff's is done by nobody. The office takes on its own staff,
beginning with an advertisement on its job advertisement form (form-works-job-advertisement).
```

Once staff are in post and have reported (docs/behaviour/standing-work.md, "The staff's report"), it says what each
last did and when, and how each standing work order stands:

```
In post (5): c0113, since year 1, day 4, under rec.1697, last at work year 1, day 11 (maintain); ...
Vacant: 1.
Your standing work orders, as your staff reported on year 1, day 11 (rec.3256):
- rec.1082, collect every 7 days: carried out: 430 calls at addresses, 1026 loads.
- rec.1083, maintain every 1 day: carried out: 77 upkeep jobs, 123 units of upkeep; 275 worn assets were left when the crew's hours ran out.
```

Someone who has never come in reads "has not come in to work: no place of work in the employment agreement or in an
advertisement it cites"; an order nobody carries out reads "carried out by nobody: there is nobody in post" or "not
carried out: none of the 5 in post was at the depot (...) when the day's work was set out".

- It is read from the office's own papers and nothing else (`mine`, docs/no-god-view.md): the employment agreements
  its organisation is party to, in the office's role, in force; its standing work orders and its staff's reports;
  and, where the posts are what a budget line pays for, the adopted budget. The code that runs the office reads the same papers the same way (`Staffing`). Nothing is asked
  of the engine, and no one else's staff are shown.
- Posts are the office's establishment (clinic, school, police: its funder's figure, a parameter) or what its budget
  line pays for at its rate of pay (works, environment). The code office also keeps within its room at the depot; the
  roster does not say that.
- A standing work order drafted while nobody is in post says so in its preview ("There is nobody in the post whose
  work this is: your office has no works crew in post, so nothing is done under it until someone is taken on.") and
  again with its result once confirmed.
- Each form of the office's own says in one line what issuing it does and whose it is to fill in ("Filled in by the
  works manager, of the office's own accord (nobody's direction or leave is needed)"): `does` on the module's
  `issues` (contracts/module.schema.json).
- Offices with no staff of their own (registry, inspector, planning, tribunal) are shown no roster. The rates office
  and the utilities have routine work and a staff post run by code, with no employees in the world: an order of theirs
  always has someone to follow it.

**Real-world basis.** An employer keeps a record of its employees and their terms, and a manager knows the
establishment of their unit. **(to confirm: no source opened.)**

## Office by office: what a seat does with what

From `papers.ts`, and from a 90-day mock run of a 300-person town with twenty offices as seats (what each office's
code did, said as a seat says it). "Existing act" is a call the language had already.

| Office | On its own form | Existing act | Still a plain statement, or not possible |
|---|---|---|---|
| mayor | `invoice_approval`, `nomination`; the council proposal, amendment and permit forms (already there) | commissioning a builder (`structure`) | the code mayor's budget carries the budget as data (`proposal` with `enact`); a seat uses the council proposal form |
| council clerk | `council_ballot`, `council_result`, `adopted_budget` (a line each, as the town has them) | appointing the winner of an election (`position`) | **a law amended from its figures**: the amended law's words and rule are drafted from the schedule (`draftLaw`), which no form of fields can do. A seat can publish the law in words; the rule is lost |
| councillors | | `vote` | |
| finance | | payments, the payroll's standing payments (set up on the hiring office's payroll notice) | `withholding_report`: nobody reads its content; a statement in words serves |
| planning | `permit_decision`, which records the liberty to build beside a decision to grant (`writes.claim`: the form's `lot` and `structure_type` say what is permitted, and a grant without them is asked about) | | until 2026-10-11 the form wrote the decision alone and the liberty was a call of its own: a seat's permit granted nothing, and the inspector fined the building (docs/decisions.md, "A permit granted on the planning office's form is a permit") |
| inspector | `valuation_request`, `demolition_order` | the fine (`claim`); going to the site (a look) | |
| registry | `death_registration`, `death_certificate`, `birth_registration`, `transmission_application` | | |
| child protection | | taking a child into care (`presence`) | |
| works | `job_advertisement`, `disposal_docket`, `payroll_starter`, `payroll_leaver` (to the finance office: firms.md, "Payroll notices") | the offer of employment (`agreement`), notice, withdrawing an advertisement; one day's work (`work`) | the daily round, by hand, is dozens of acts: standing work orders (docs/behaviour/standing-work.md) |
| environment | `job_advertisement`, `habitat_register`, `payroll_starter`, `payroll_leaver` | survey work (`work`) | `environment_report`: its figures are a table by species; published in words, the paper reads less into it |
| landlords | `rental_listing`, `rent_increase`, `tax_report`, `death_notification`; the permit form | leases (`agreement`), notice, payments, commissioning a builder | the dividend: one instruction listing every payment. A seat pays each holder (`money`) |
| tribunal member | `tribunal_order` | | `hearing_notice`: nobody reads its content |
| tribunal registrar | `garnishee_order` | | |
| bank lending | `loan_decision`, `loan_payout`, `funding_draw` | the loan agreement, the principal, interest | `loan_terms` (published once); `loan_default`, `loan_arrears` (rare; in words) |
| electoral | `election_notice` | appointing the winner (`position`) | **the roll, the ballot paper and the count**: a list of every elector, a list of candidates each with several particulars, and a count of hundreds of votes. Not forms of fields, and not eight acts a sitting. An election run by a seat needs its staff to do these (see standing work, "what it would take") |
| editor | `news_item` | | |
| police officer in charge | `job_advertisement`, `charge`, `death_notification` | investigating (`work`), going to a home (a look), employment | `investigation_closed`: nobody reads its content |
| union organiser | `wage_claim`, `offer_accepted`, `action_ballot`, `industrial_action`, `stop_work`, `return_to_work` | membership agreements | `membership_offer` (published once); its ballot's result (nobody reads its content) |
| shop and factory managers | `job_advertisement`, `order`, `delivery_note`, `wage_offer`, `export_invoice`, `crime_report` | serving and making (`work`), moving goods, payments, employment | **the price list** (a table of prices by kind, with an offer); the dividend (as landlords); `loan_application` (the lender's form: not made); setting up a new shop |

| energy operations | `order` (2026-10-09: an order to the grid; the form says the sum is paid with it, by a payment) | the payment; standing work orders | its bills are its staff's routine |
| builder's foreman | `job_advertisement`, `order` | | not a seat yet (docs/behaviour/standing-work.md) |

**Who buys from outside, and whether a seat there can** (2026-10-09). An order is one paper everywhere (`order`:
what, how many, the seller's listed price, who receives it and where, the account it is paid from), paid in full into
the account the seller's price list names; the seller delivers when it is paid, and sends back money that comes with
no order. The form says so, and so does the world market when written to.

| Office | Buys | A seat there |
|---|---|---|
| energy operations | energy from the grid (the outside's market) | **can**: its staff buy a month's under the supply order when stock is low and the account can pay; the seat orders on the office's own `order` form and pays (it had no form until 2026-10-09) |
| shop manager | goods from factories or the outside's market | has the `order` form; **not a seat yet** for other reasons |
| factory manager | inputs from the outside's market; sells to it on `export_invoice` | has both forms; **not a seat yet** |
| builder's foreman | materials from the outside's market | has the `order` form now; **not a seat yet** |
| works | nothing bought; its waste goes to the landfill with a `disposal_docket`, which the landfill invoices and the finance office pays | **can** (the crew takes the week's load under the `collect` order; the docket form is the seat's) |
| water operations | nothing: water is drawn from the river (`draw_water`) | nothing to order |
| clinic, school, police, the town's other offices | nothing | nothing to order |
| someone working for themself | goods from the outside's market | not an office |

Not made, and why: a builder's invoice and price list, the utilities' bills, the rates notice, the fund's pension run
(offices the wave does not seat; the bills are the bulk gap, docs/behaviour/standing-work.md).

## Act by act: what the code does, and how a seat does the same (2026-10-12)

**Source:** `participants/src/behaviour/papers.ts`; `opens` on a module; the generator's `proc-<office>-possession` and `practice-<organisation>-letters`; `orchestrator/test/seat-acts.test.ts`. Decision: docs/decisions.md, "What the third living pilot found".

The table above was written when the forms were. The third living pilot showed what it missed: its tribunal member decided none of 54 applications for want of a form to decide them on, and its landlord wrote letters where code gives notices. The audit behind this table: the pilot's own town for 120 days with 21 offices in mock seats, and each module read. A mock seat's brain is the office's code, and the mock says each typed paper on the office's form where one writes it to the letter; what stays off a form is what a model could not have done.

| Office | Act the code takes | A seat takes it by |
|---|---|---|
| Landlord | asks for rent owed | form `rent_reminder` (new) |
| | offers a plan to pay (no code landlord does) | form `payment_plan_offer` (new); the tenant answers with what the household could pay |
| | applies for an order to pay | form `arrears_application` (new), to a tribunal; the fee by a payment |
| | gives notice to vacate; withdraws it when paid | form `notice_to_vacate` (new); withdrawing a paper (existing call) |
| | applies for possession | form `possession_application` (new), naming the notice relied on; the fee by a payment |
| | asks for a warrant | form `warrant_request` (new) |
| | ends the tenancy on the record | notice on the lease (existing call) |
| | orders a repair | form `repair_order` (new); the price by a payment |
| | answers a request to put right, a body's notice, a request to vary | forms `remedy_answer`, `complaint_answer`, `tribunal_answer`, `variation_answer` (new) |
| | lists a home, raises a rent, reports rent, notifies a death, lets, pays | as before |
| Tribunal member | says what it hears | on file when the seat arrives (`notice-tribunal-member-hearing`) |
| | lists a case and tells both sides | its registry staff, under a standing order (a living town); or form `hearing_notice` (lists) or `hearing_listing` (a rent increase, a debt, a charge), both new |
| | puts a case off | a fresh `hearing_notice` with a later day |
| | orders a plan, possession on a day, or dismisses | form `possession_order` (new) |
| | orders on its other lists and its three older ones | form `tribunal_order` (widened: the matter, binding, the lease or building, to put right by a day, rejected) |
| Registrar | orders a bank to pay; issues a warrant; declines | forms `garnishee_order`, `warrant` (new), `enforcement_decline` (new) |
| Finance | pays, sets up wages | as before |
| | reports tax withheld | form `withholding_return` (new), in totals; its books count from the last return |
| Mayor | answers a petition | form `petition_response` (new); the rest as before |
| Support office | answers a request to review, a body's notice | forms `remedy_answer`, `complaint_answer`, `tribunal_answer` (new) |
| Desks | tell the other side; decide | forms `complaint_notice`, `venue_decision`, widened to carry the paper, the sum and the building the application names; `binding` is yes or no |
| | say what they hear | on file when the seat arrives |
| Union | declares a ballot's result | form `ballot_result` (new); what it takes up is on file when the seat arrives |
| Bank, lending | writes to a borrower behind; declares default | forms `loan_arrears`, `loan_default` (new) |
| Police | says a warrant is carried out, or lapsed; closes an investigation | forms `warrant_executed`, `warrant_lapsed`, `investigation_closed` (new). Putting someone out is an existing call |
| Works, planning, council clerk, registry, inspector, environment | | as in the table above: nothing found missing |

**On file at the start.** A body that hears grievances says what it hears in a public notice, with what applying costs: whoever has a matter finds it by that. The office's code publishes it at its first look. Where a model holds the office the world opens with it published (`opens` on the module), as it opens with the office's standing work orders in force.

**The procedure says what the law asks, never what to decide.** Where the place has a law on possession, a landlord's seat, the tribunal member's and the registrar's each have on their own file the steps the law has, the office's form for each, and what the law asks before each, from the profile's figures. It says a notice to vacate is given when it is on the record addressed to the tenant, and that the law asks no further proof. Each form's own line says what issuing it does and does not do.

**Still in words, or not possible** (a mock seat still makes these as plain statements; `OFF_FORM` in the test): a dividend's one instruction listing every payment (a seat pays each holder); a return of tax withheld with a line for each charge (the seat's form gives totals); a lender's terms and a union's offer of membership, published once; a survey report by species; a budget carried as data. And docs/design/call-language-gaps.md, D.

**What it costs a seat.** A landlord's office now has fifteen forms on file where it had four, each with a line of a few sentences: several thousand characters more in what stands in its prompt. Finance, which had no form, now has one and with it a folder of forms, which holds the town's public forms too: its largest prompt in the test town went from 40,505 characters to 49,371 (`orchestrator/test/seat-sight.test.ts`). If that cost shows in a pilot, the folder should hold the office's own forms only, which the world's channels cannot yet say.

## Pilot 12's sixteen requests, each as a program

The works manager's fourteen were one thing in fourteen wordings; the registrar's two were one thing each.

| Request (as asked) | Program |
|---|---|
| "Hire 8 waste collection crew at $78,214 each per year (about $626k/yr in total), paid from the staff budget, to begin weekly collection starting with apts-13, ..." | `form(form=job_advertisement, to=works, wage="$78,214", period="per year", posts="8")`. The collection is a second thing, asked for separately (a standing work order) |
| "Engage 8 waste-collection crew for the works at about $78,214 each per year ... from the staff line of adopted budget rec.12734, as approved in the mayor's letter of day 32" | the same; the records cited stay in the request's words (a form has no basis) |
| "Hire 8 crew at $78,214 each from the staff line of budget rec.12734, with the work kind ..."; "Hire 8 crew for waste collection as ..."; "Hire 8 people to do the work of ..."; "Hire 8 people to work as ..." | the same |
| "Hire 8 waste collectors (waste collection work) for the works at $78,214 each a year ..."; "Hire 8 waste collectors at $78,214 each per year ... ($625,712 per year for 8)"; "Hire 8 waste-collection crew at $78,214 each a year ..."; "Hire 8 waste-collection crew workers for the works (post: works) ..."; "Hire 8 works crew (the town's works crew ...) at $78,214 a year each ..." | the same |
| "Open a vacancy for 8 posts of ..."; "Post 8 vacancies for "works crew" to collect waste, each paid $78,214 from the staff line of budget rec.12734, paid from account acc-city, under the mayor's written approval of day 37" | the same, with `account=acc-city` where the account is named |
| "Hire one member of the town's works crew at $78,214 a year ..." | the same, `posts="1"` |
| "Register the death of c0242 on the strength of the death notification rec.17236 from partner c0243 (no children), in the deaths register" | `form(form=death_registration, deceased=c0242, notification=rec.17236, reported_by=c0243, partner=c0243)` |
| "Register the death of c0228, found dead at house-111/dwelling.1, on the strength of the police notification rec.26147, which corroborates the landlord-12 notice rec.14690" | `form(form=death_registration, deceased=c0228, notification=rec.26147, reported_by="the police")` |

Each resolves (`orchestrator/test/office-papers.test.ts`). **A caution the form cannot remove:** the works manager
asked in yearly pay because its own report gave the wage by the year. The form asks for the wage of a pay period and
the pay period; filled in with "$78,214" and "per year" it advertises a job paid once a year. The form's words say
what each field is; whether a seat reads them is for the first pilot to show.

## Leaves out

- **Hiring is still a chain**: advertise, read the applications, offer, and (for an office that pays its own staff)
  set up the wage. The form is the first link; the others are existing acts. An offer's words are the seat's own:
  one that names no post or place of work and was made on an advertisement is for the post and the place advertised
  (docs/behaviour/firms.md, "An offer made on an advertisement"), so the environment office's hire is no longer
  counted with the works crew. An offer that cites no advertisement and names no post still is.
- **Checking what a form is given.** A form checks its fields' types and nothing else: it will register the death of
  someone alive.
- **Forms for papers other offices send in** (a death notification to the registrar, a nomination to the electoral
  commission) are among the sender's stationery here, not the receiver's public forms. A person not in an office has
  none of them.
