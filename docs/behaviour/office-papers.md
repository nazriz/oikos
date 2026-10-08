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

- It is read from the office's own papers and nothing else (`mine`, docs/no-god-view.md): the employment agreements
  its organisation is party to, in the office's role, in force; and, where the posts are what a budget line pays for,
  the adopted budget. The code that runs the office reads the same papers the same way (`Staffing`). Nothing is asked
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
| finance | | payments, the payroll's standing payments | `withholding_report`: nobody reads its content; a statement in words serves |
| planning | `permit_decision` | the liberty to build (`claim`) | |
| inspector | `valuation_request`, `demolition_order` | the fine (`claim`); going to the site (a look) | |
| registry | `death_registration`, `death_certificate`, `birth_registration`, `transmission_application` | | |
| child protection | | taking a child into care (`presence`) | |
| works | `job_advertisement`, `disposal_docket` | the offer of employment (`agreement`), notice, withdrawing an advertisement; one day's work (`work`) | the daily round, by hand, is dozens of acts: standing work orders (docs/behaviour/standing-work.md) |
| environment | `job_advertisement`, `habitat_register` | survey work (`work`) | `environment_report`: its figures are a table by species; published in words, the paper reads less into it |
| landlords | `rental_listing`, `rent_increase`, `tax_report`, `death_notification`; the permit form | leases (`agreement`), notice, payments, commissioning a builder | the dividend: one instruction listing every payment. A seat pays each holder (`money`) |
| tribunal member | `tribunal_order` | | `hearing_notice`: nobody reads its content |
| tribunal registrar | `garnishee_order` | | |
| bank lending | `loan_decision`, `loan_payout`, `funding_draw` | the loan agreement, the principal, interest | `loan_terms` (published once); `loan_default`, `loan_arrears` (rare; in words) |
| electoral | `election_notice` | appointing the winner (`position`) | **the roll, the ballot paper and the count**: a list of every elector, a list of candidates each with several particulars, and a count of hundreds of votes. Not forms of fields, and not eight acts a sitting. An election run by a seat needs its staff to do these (see standing work, "what it would take") |
| editor | `news_item` | | |
| police officer in charge | `job_advertisement`, `charge`, `death_notification` | investigating (`work`), going to a home (a look), employment | `investigation_closed`: nobody reads its content |
| union organiser | `wage_claim`, `offer_accepted`, `action_ballot`, `industrial_action`, `stop_work`, `return_to_work` | membership agreements | `membership_offer` (published once); its ballot's result (nobody reads its content) |
| shop and factory managers | `job_advertisement`, `order`, `delivery_note`, `wage_offer`, `export_invoice`, `crime_report` | serving and making (`work`), moving goods, payments, employment | **the price list** (a table of prices by kind, with an offer); the dividend (as landlords); `loan_application` (the lender's form: not made); setting up a new shop |

Not made, and why: a builder's invoice and price list, the utilities' bills, the rates notice, the fund's pension run
(offices the wave does not seat; the bills are the bulk gap, docs/behaviour/standing-work.md).

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
  set up the wage. The form is the first link; the others are existing acts. An offer's words are the seat's own, and
  the environment office tells its own staff from the town's others by those words (`roleOf`, firms.ts): a seat's
  offer worded otherwise is counted with the works crew.
- **Checking what a form is given.** A form checks its fields' types and nothing else: it will register the death of
  someone alive.
- **Forms for papers other offices send in** (a death notification to the registrar, a nomination to the electoral
  commission) are among the sender's stationery here, not the receiver's public forms. A person not in an office has
  none of them.
