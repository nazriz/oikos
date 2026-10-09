# What seats asked for that the call language could not say

*Proposal, 2026-10-08. Part A is evidence from the pilots' logs, part B a design for each gap, part C a build order.
The questions for the owner are at the end.*

*Built the same day, on the owner's approval: steps 1 and 2 of part C (the bank's letters and the `no_such_act`
sentence; the hold, `visible=own` and `look_first`). What was built, where it departs from part B and why, and the
real-world rule for payments under a hold are in docs/decisions.md ("A hold, an entry on one's own file, and
look_first") and docs/behaviour/bank-payment-system.md ("A hold"). Steps 3 and 4 wait as part C says. The rest of
this document is as it was proposed.*

*Step 4 of part C was built on 2026-10-09, with standing work orders: docs/decisions.md ("Offices that take written directions", "Forms for an office's own papers", "Standing instructions for work"); docs/behaviour/directions.md, office-papers.md, standing-work.md.*

## Summary

- Of 442 requests seats made with `do` in 22 runs, 185 were drafted and confirmed, 179 got no draft and 78 were drafted
  and declined. Of the 257 that did not go through, 157 asked for something of a kind the language could not say (or
  could not say then); the other 100 could be said and were lost to the translator, the forms or the preview.
- The five gaps noted from earlier pilots are all real. Two are much larger than the others (an office's practice,
  and a hold). Three more belong on the list: **an office's own paperwork** (hiring, registering a death), **going to
  see**, and **passing on a copy of a paper**.
- Only one gap needs new call-language surface: **a hold** (`statement(hold=…)`). One needs a word
  (`visible=own`), one a refusal label (`look_first`). The rest are closed in the world (forms an office publishes, a
  bank that lists what it holds) or by the knowing design, not in the language. Nothing proposed touches the kernel.
- Two acts should not be added: a program that looks and then acts, and an act that sets what an office does "by
  itself". Both would make the platform do a seat's or an office's work for it.

## A. Evidence

### A.1 What was read, and how

- **Logs:** every run under `runs/pilot-*`, the earlier Codex pilots under `runs/codex/` (the 180 real test cases
  come from them) and `runs/stress-1-2026-10-06`. From each log: every draft, every failed translation, every retry,
  every sign-off. 442 requests in all. (`runs/codex/pilot9-final` is a copy of `pilot9-1000-1y` and is not counted;
  a resumed run's stopped logs repeat its current log and are not counted.)
- **Labelled data:** `translator/eval/pilot-cases.ts` (180 cases, 39 with a `gap` named);
  `runs/translator-data-in-situ/real-labelled` (139 further real requests, 44 labelled `no_such_act`; these are pilot
  9's later requests, so they are inside the 442) and `pilot-10-requests`. `runs/translator-pipeline-smoke-1` and `-2`
  hold requests written by a model for training, not asked by a seat in office: read, not counted.
- **Not read:** the held-out cases.
- **Classified by one reader, by hand,** after a first pass by keyword. Every failed and declined request was read.
  A count may be off by one or two; a retry in other words counts as a request (that is how hard the seat tried).
- **Seat models:** gpt-6-sol in the Codex pilots and pilots 7a to 7e; gpt-6.1-sol in pilots 8, 8b, 9, 18 and the
  stress run; claude-sonnet-5-5 in pilots 10, 11 and 12; claude-haiku-5-5 in pilot 13.
- **What "did next" rests on:** the same seat's next requests with `do`, and its note when it declined a draft.
  Letters sent with `write` were not read, so "wrote to them instead" is known only where the letter went through
  `do`.

### A.2 The table

"Asked" is every request of the kind; "not done" is no draft, or a draft the seat declined; "in part" is a draft
confirmed that did less than was asked (usually a letter, or half the request).

| # | What the seat wanted | Asked | Not done | In part | Offices and models | Runs |
|---|---|---|---|---|---|---|
| 1 | **An office's practice changed** (stop the town's works office advertising and signing for new crew) | 45 | 31 | 14 | mayor 31, finance 14; all gpt-6.1-sol | pilot 9 only, days 37 to 177 |
| 2 | **A hold** on something standing, to be released later (six wage payments) | 21 | 16 | 5 | finance 11 (gpt-6.1-sol 9, claude-haiku-5-5 2); mayor 10 (gpt-6.1-sol 7, gpt-6-sol 3) | 6 runs |
| 3 | **An office's own paperwork** (hire crew or advertise posts; register a death) | 16 | 16 | 0 | works 14, registry 2; claude-sonnet-5-5 | pilot 12 only |
| 4 | **A record named only by describing it** ("any standing instruction paying…", "every recurring payment I did not instruct") | 12 | 7 | 5 | mayor 10 (gpt-6-sol 6, claude-sonnet-5-5 4); finance 2 (claude-haiku-5-5, gpt-6.1-sol) | 5 runs |
| 5 | **Going to see, or attending** (visit a house, inspect the hall, attend a hearing) | 12 | 11 | 1 | mayor 11 (gpt-6-sol 5, gpt-6.1-sol 6); finance 1 | 5 runs |
| 6 | **Look, then act on what is found** | 5 | 3 | 2 | planning 3, finance 2; gpt-6.1-sol | pilot 8 only |
| 7 | **An entry in the office's own books** (tax withheld recorded as payable; a payment charged to a budget line) | 4 | 3 | 1 | finance 3, mayor 1; gpt-6.1-sol | pilot 9 only |
| 8 | **A copy of a paper passed on** (file copies with the registrar, serve a copy on the other side) | 3 | 3 | 0 | finance 2, mayor 1; gpt-6.1-sol | pilot 9 only |
| 9 | **An act on a condition** ("pay any invoice only after completion is verified") | 1 | 1 | 0 | mayor; gpt-6-sol | pilot 7c |
| – | *Looking something up with `do`* (read the petition, inspect the ledger, who holds a post) | 67 | 66 | 1 | mayor 44, finance 14, planning 9; gpt-6-sol 42, gpt-6.1-sol 25 | see A.4 |

The 100 that could be said and were not: a form filled in wrongly or refused (42, mostly the council proposal form
with budget lines dropped); a direction to another office refused or drafted so that it read as a letter to the seat
itself (26); other faults of the translator (21); a draft the seat declined because it had changed its mind or the
thing was already done (8); a platform fault (2); a fair question back (1). These are the translator's and the
preview's work, not gaps in the language, and are not taken further here.

### A.3 Each kind, with what seats said and what they did next

**1. An office's practice.** The town's works office (run by code in pilot 9) advertises a post whenever it has fewer
crew than the budget's staff line pays for. The mayor and the finance officer wanted that stopped while the budget was
reconciled.
- "Stop automatically advertising new works crew vacancies for city at town-hall/workplace.1. Keep existing
  employment agreements and payroll in place." (mayor, day 42; no draft: "You don't know of anyone or anything called
  …")
- "Suspend automatic publication of new city works crew recruitment postings at town-hall/workplace.1 until the mayor
  expressly reopens recruitment." (finance, day 156; the translator wrote `system(retire="automatic publication of…")`)
- "Stop recruiting new works crew for city. Set the number of works-crew vacancies to zero so that withdrawn or filled
  advertisements, including rec.36186, are not automatically replaced." (finance, day 74; drafted as a letter to
  itself, declined: "This only writes a letter to finance. It changes no recruitment setting.")
- **Next:** 14 times the draft was only the withdrawal of the current advertisement, and the seat confirmed it; the
  office advertised again; the seat withdrew again. Six more withdrawals were declined as already done. It went on
  for 140 days and was never achieved. This is the most a gap has cost any seat.

**2. A hold.**
- "Temporarily pause the recurring payment [job-c0003-wages] of $2,393.34 from [acc-city] to [acc-c0003] until I
  release the pause. Keep the payment instruction and its history, and preserve employment and all earned wages and
  accruals." (finance, pilot 8b, day 14; no draft: "You haven't seen a form by that name.")
- "Pause the six scheduled wage-payment jobs job-c0003-wages, job-c0004-wages, job-c0008-wages, job-c0009-wages,
  job-c0011-wages and job-c0013-wages. Keep them saved so they can be resumed. Do not delete them or change
  employment, earned wages or past payments." (mayor, pilot 8b, day 38; no draft)
- "Instruct the bank (bank) to hold all six standing wage payments from acc-city (jobs c0002, c0005, c0008, c0011,
  c0012, c0015, $2,393.34 each). None is to be paid…" (finance, claude-haiku-5-5, pilot 13, day 4; drafted as a
  letter to the bank and confirmed)
- One of the 21 was not a payment: "withdraw the town’s authorization for Millbrook Builders [builder] to continue
  park construction on town-owned lot [lot-01-17] until the planning office [planning] grants a permit" (mayor, pilot
  7c).
- **Next:** five letters to the bank, which the bank does not act on (it carries out written instructions, and
  answers a letter with a statement of account); pilot 8b's finance officer said two days later that the letter had
  held nothing. Otherwise the seat asked again in other words (ten times in pilot 8b, over 31 days) or cancelled the
  payments for good (pilot 9 day 1; the stress run day 11). In pilot 9 the cancelled wages were followed by wage debts
  and tribunal claims that took the two seats much of the next 150 days; the logs show the sequence, not that one
  caused the other.

**3. An office's own paperwork.** New in pilot 12, the first time a model held the works office and the registry.
- "Hire 8 waste collection crew at $78,214 each per year (about $626k/yr in total), paid from the staff budget, to
  begin weekly collection starting with apts-13, apts-14, apts-15, apts-10, apts-11, then the rest." (works, day 32)
- "Post 8 vacancies for "works crew" to collect waste, each paid $78,214 from the staff line of budget rec.12734, paid
  from account acc-city, under the mayor's written approval of day 37" (works, day 52; `none(no_such_act)`)
- "Register the death of c0242 on the strength of the death notification rec.17236 from partner c0243 (no children),
  in the deaths register" (registry, day 56; `none(not_an_act)`)
- **Next:** the works manager asked 14 times in 21 days, each time in other words, and hired nobody; the town had no waste
  crew. The registrar asked twice and registered nothing. Both were wholly blocked in the office's main duty. The code
  that runs these offices does both with a typed paper (`job_posting` with its terms, `death_registration` with who
  died); a seat has no way to write one.

**4. A record named only by describing it.**
- "As mayor for the Town of Millbrook, I revoke any city authorization for the $2,393.34 transfers from [acc-city] to
  [acc-c0003], [acc-c0004], [acc-c0008], [acc-c0009], [acc-c0011], and [acc-c0013]. Stop any further transfers under
  those instructions…" (mayor, gpt-6-sol, Codex pilot 8, day 94)
- "Cancel every recurring (standing) payment request from acc-city to acc-c0002, acc-c0003, acc-c0006, acc-c0010,
  acc-c0012 and acc-c0013 (the $2,393.34 payments), and any other recurring payment from acc-city that the finance
  officer or I did not instruct." (mayor, claude-sonnet-5-5, pilot 10, day 116; `none(no_such_act)`)
- "End the recurring payroll agreement with ent.9 [rec.56179]… Stop future $3,000.00 gross fortnightly payments from
  acc-city to acc.20" (mayor, pilot 7e; the draft gave notice on the wrong record)
- **Next:** a letter to the bank asking it to cancel "any standing order" (pilot 10, three times over 60 days; pilot
  13 once). The bank does not act on letters, so nothing was cancelled. No seat looked the instructions up and named
  them, and nothing told it to.

**5. Going to see, or attending.**
- "Visit [house-165] to inspect the waste complaint [rec.2944] and record what is present outside the property."
  (mayor, Codex pilot 8, day 61; `none(unknown_form)`)
- "As mayor, visit house-150 and record whether waste is awaiting collection there today." (mayor, Codex pilot 10)
- "Attend town-hall today, day 33, at 2 pm for the scheduled payroll and budget records examination with finance."
  (mayor, pilot 9)
- **Next:** gave up on seeing for itself and directed the works office to check (itself a request that often failed);
  for hearings, filed a written answer with the tribunal instead, which went through.

**6. Look, then act.**
- "Identify the current mayor and town clerk of [city] and their valid correspondence ids from the town's
  officeholder records. Route the day 16 letter from [finance-system] to those officeholders…" (planning, day 16)
- "Review the planning office's available lot, building and occupancy records to identify occupied premises and access
  routes exposed to heavy rain warning rec.12969… Send the findings to mayor-system…" (planning, day 36)
- **Next:** asked for the look alone ("Show me who currently holds the mayor, town clerk and finance officer
  posts…"), which also failed then; or sent a letter asking someone else for the records. Not seen since pilot 8.

**7. An entry in the books.**
- "…Proposed payment: $2,393.34 from acc-city to acc-c0877, with $606.66 withheld under [law-income-tax], recorded as
  tax payable to acc-outside for monthly remittance. Charge the total $3,000 once to the staff appropriation in
  [rec.5978]." (finance, day 60; the draft published a report in the name of the debt, declined)
- "Record the payroll accounting for c0088's single $3,000 gross unpaid wage debt [rec.50355]…" (finance, day 148;
  drafted as a `report` and confirmed)
- **Next:** paid the net wage and the tax as two payments (both can be said), and kept the rest in a published
  report or its notebook.

**8. A copy passed on.** "Serve c0088 with a copy of city's formal response rec.63570 concerning tribunal proceeding
rec.62163. Record the delivery date, recipient and service reference." (mayor, day 141; drafted as a letter asking
c0088 to serve the mayor, declined.) **Next:** wrote the substance out again in a letter.

**9. An act on a condition.** Once: "Pay any invoice from [acc-city] only after completion is verified and the finance
officer confirms it is within the adopted budget [rec.7737]." The town's payments procedure already says this of the finance
office; nothing to add.

### A.4 Looking with `do`: the largest count, and closed

67 requests asked to read or inspect and to bring nothing about. 40 are from the two long Codex pilots, before `look`
could search (fixed 2026-09-30); two from the first short pilots; 24 from pilot 8, where finance and planning used
`do` to read ledgers and find who held a post; one from pilot 9; none in pilots 10 to 18. `not_an_act` (2026-10-05) now says what to do instead. It is
in the table because it was the single commonest thing seats could not do, and because the same habit (reaching for
`do` to find something out) is behind gaps 4 and 6.

### A.5 The five, confirmed or corrected

| Noted | Finding |
|---|---|
| Pause or hold | **Confirmed**, and second in cost. Nearly always a standing payment at the bank. |
| An unnamed record | **Confirmed.** Nine of the twelve are not one record but "every" or "any" record of a description: a set the seat cannot list. |
| Look-then-act | **Confirmed but small** (5, one pilot, none since seats could search). |
| An office's own practice | **Confirmed, and corrected.** No request was found that set a rule for the seat's own conduct ("from now on", "always"). All 45 asked to change what *another* office of the same town, run by code, does of its own accord. It is the largest gap. |
| A ledger entry | **Confirmed but small** (4, one pilot, one model). |
| *Added* | An office's own paperwork (16, wholly blocking); going to see (12); passing on a copy (3). |

### A.6 Ranking

By how often: an office's practice (45), a hold (21), own paperwork (16), an unnamed record (12), going to see (12),
look-then-act (5), an entry (4), a copy (3).

By how much it blocked: (1) own paperwork: the office could not do its main work at all; (2) an office's practice: 140
days, 45 requests, never done; (3) a hold: never done, and seats fell back on cancelling for good, a harsher act than
they wanted; (4) an unnamed record: never done, and the seat believed its letter had done it; (5) going to see: never
done, a weaker substitute found; (6) to (8): a workable substitute found within a request or two.

## B. Design

Each gap below is set against the rules: the kernel is physics and a generic rule mechanism; institutions do the work
and nothing carries itself out; the platform is invisible to seats; nobody is shown what they did not go and find
(docs/design/knowing.md, on its branch); everything deterministic. A change to the call language is also a change to
the translator's instructions, its training data and both resolvers (the one in `translator/src` and the engine's,
`kernel/crates/resolver`), so the fewer the better.

### B.1 A hold: build it

- **In the real world.** A customer tells their bank to suspend a standing order and later to resume it. It is an
  instruction: the bank's staff act on it when they next process the account, and a payment already in hand may still
  go. More widely: whoever issued a standing paper tells whoever acts on it to stop acting on it for now. (The banking
  practice is to be sourced in `docs/behaviour/bank-payment-system.md` before building.)
- **What kind of change.** A new argument on an existing function. A hold is a statement, so no new function, and no
  new block: `publish` already carries it, and the kernel does nothing with it.
- **Contract change, in words.** `contracts/calls.schema.json`: `statement` also takes `hold`. `contracts/calls.md`:
  `hold` is one record's id, or a list of them; `statement(hold=X)` resolves to `publish` of kind `hold`, with data
  `{ "holds": [ids] }`, addressed to whoever X is addressed to (the one physical answer: the party that acts on X)
  and visible to them and to the author; `text` may say why or until when, as words only. A hold is lifted by
  withdrawing it: `statement(withdraw=<the hold>)`, which exists. The rule under `no_such_act` that names holding as
  something no function does comes out. No change to `blocks.schema.json`.
- **What a hold does not do.** It does not stop anything by itself. It has no condition that anyone watches: "until
  the audit is done" is for the seat to judge and then lift. A dated hold (`until`) is left out of the first version.
- **Translator.** One rule: pausing, suspending or holding something on record, named by its id, to be resumed later
  is `statement(hold=<it>)`, one statement for several; resuming it is the withdrawal of the hold. The training data's
  briefs for "a payment to be held and resumed" turn from refusals into programs.
- **Resolvers (both).** Check the seat knows each record; find whom it is addressed to from the seat's own knowledge
  of it; if it is addressed to nobody (the seat's own notice or advertisement), the hold is published as the record
  is. A record the seat does not know: "You don't know of a paper called X."
- **Kernel.** Nothing.
- **Institutions.** The bank's module reads holds addressed to it from an account's authorised instructors (the check
  it already makes for any instruction) and makes no payment under a held order while the hold stands. A payment
  missed under a hold is not made up later. A hold from someone not authorised is answered in writing, as an
  instruction from them is now. Other readers of standing papers get it for nothing if `Book.open` (the one way
  modules read what stands, `participants/src/behaviour/common.ts`) leaves out a paper its author has a standing hold
  on: an advertisement on hold is then not applied to. Each is the reader's own conduct, in its module.
- **Seat instructions.** Nothing needed. The preview carries it.
- **Feedback.** Today: "Nothing here does that as such. You could write to whoever would have to see to it, or go
  about it another way." (Before 2026-10-06: "It isn't clear what should happen", or "You haven't seen a form by that
  name.") Proposed, as the preview: "You will instruct Millbrook Savings Bank (bank) to hold your standing payment
  job-c0003-wages. It stays on record and is not paid while this stands; a payment already due may still go. To
  resume it, withdraw this instruction."
- **Tests.** Contract examples, valid and invalid. Both resolvers on one table. The bank: a held order is not paid,
  is paid again from its next date after the hold is withdrawn, is still paid if it fell due before the bank's plan,
  and a hold by a non-signatory changes nothing and is answered. A month of the code-only town ends at the same hash
  as before (no code seat holds anything). The eleven real cases with gap `pause` are re-keyed from
  `none(no_such_act)` to the program.
- **Cost and dependencies.** Medium: the argument, two resolvers, the preview, the bank, `Book.open`, the behaviour
  doc with its source, the data briefs, one retraining. Does not depend on the knowing work (the call language is
  unchanged there).

### B.2 A record named only by describing it: do not add; say what to do, and have the bank list what it holds

- **In the real world.** You find the paper in your own files, or ask whoever keeps it for a list, and then act on it
  by its reference. Nobody acts on "whichever instruction it is".
- **Why not in the language.** Resolving a description to a record is interpretation, and it would run on the seat's
  behalf over records it has not looked at. Under the knowing design that is exactly what the translator must not
  become: a way to learn, or act on, what the caller has not found. Finding a record is a look the seat makes, at its
  cost (a turn of its sitting), in its own files (`mine`) or of the keeper (`ask`).
- **What kind of change.** Two steps, with better feedback; and one thing an institution should already do.
- **Contract change.** One refusal label, `look_first` (the eighth), shared with B.3: the request needs something
  found out before it can be said, a paper's id or what a record shows. `calls.md` and the schema's label list.
  (The alternative with no contract change is to keep these under `no_such_act` with its general sentence, which is
  what failed to help in pilots 10 and 13.)
- **Translator.** The words under `no_such_act` about "naming something on record only by describing it" move to
  `look_first`. "Every" and "any" of a description are the same case.
- **Resolvers.** The label's sentence. Nothing is looked up.
- **Kernel.** Nothing.
- **Institutions.** The bank's answer to a customer's letter lists the standing instructions on the customer's own
  accounts, each with its id, amount, payee, interval and whether it is on hold. A real bank sends that list on
  request; here it is what makes "cancel every standing payment I did not instruct" possible at all, in two steps.
  It is the customer's own information (`mine`), so it fits the knowing design as it stands.
- **Seat instructions.** One clause on `do`: a paper is named by its id, and one you cannot name is looked up first.
- **Feedback.** Today: "Nothing here does that as such…", or "It isn't clear which one you mean. Name each person,
  account, record and place by its id." Proposed: "That needs something found out first. Look it up (in your own
  papers, or by asking whoever keeps it), then say what is to be done, naming each paper by its id."
- **Tests.** The six real cases with gap `unnamed_record` re-keyed. A mock-seat run: a request by description is
  answered with the sentence, the seat searches its files for standing requests to an account, and the second request
  names them. The bank's letter lists exactly the writer's own standing instructions and nobody else's.
- **Cost and dependencies.** Small (a label, a sentence, the bank's letter), plus its share of one retraining. The
  wording "by asking whoever keeps it" is true today and stays true after the knowing work.

### B.3 Look, then act: do not add

- **In the real world.** One person reads the file and then decides. The deciding is theirs.
- **Why not.** A program is fixed when it is written and confirmed. One whose second line depends on what a look
  returns would be confirmed without the seat seeing what it will do, and would make the platform a plan-runner acting
  for the seat between steps (docs/design/translator-and-resolver.md, P10 and section 12, where this was deferred for
  the same reason). It would also let a seat act on what it never saw. The evidence does not ask for it: five
  requests, one pilot, none since seats could search.
- **What instead.** Two steps, and the seat loop already allows a look and an act in one sitting. The request is
  answered `look_first` (B.2), with the same sentence. Where the act does not depend on the look ("check the balance,
  then pay 500 to acc-9"), the rule stays as it is: the act is written.
- **Feedback.** Today: "Please take this one step at a time." Proposed: the `look_first` sentence.
- **Cost.** None beyond B.2. The five real cases with gap `look_then_act` gain `none(look_first)` as an answer.

### B.4 An office's practice: no act for it; offices that take written directions

- **In the real world.** An office works to written procedures, and to directions from whoever it answers to. Its
  staff follow them, or do not; a direction nobody reads changes nothing. A mayor who wants hiring stopped tells the
  works manager in writing.
- **What the evidence is.** All 45 requests were of that kind. The call for it exists (a letter, or a form), and the
  seats sent the letters. The gap is that the office receiving them, run by code, answers every letter with its
  standing report and carries on.
- **Why no act in the language.** "From now on the office does X by itself" has no one doing it. If the seat is the
  office, the rule is the seat's own conduct: it keeps it in its notebook and follows it, and may publish it as a
  `procedure` (which can be said today) so that others know. If someone else is to follow it, they are directed. If
  it is to be done with no person, the organisation puts a system to work (`system(template=…)`, which exists, where
  the world offers one). A function that changed an office's behaviour directly would be the platform carrying
  something out by itself.
- **What kind of change.** World content and behaviour, through an existing mechanism: forms.
  - An office that can be directed publishes a form for each direction it takes. The works office: a staffing
    direction (recruit: yes or no; crew: a count, optional).
  - Its module reads the latest standing direction addressed to it from those its organisation says may direct it (a
    parameter, like the finance office's `procedure`), follows it at its next plan, with the same `compliance_bps`
    the finance office has for following procedure, and says in writing what it has done. Withdrawn, the direction
    lapses.
  - Where a model runs the office, the direction arrives as a paper and the model decides.
- **Contract change.** None to the call language. One to `contracts/module.schema.json`: a module may declare the
  directions it takes (`takes`: the form's name, its fields, what following it means, in words), from which the
  generator publishes the forms. This keeps the meaning of a direction beside the code that follows it, as `keeps`
  does for registers. (Without it, the generator needs a table of its own.)
- **Translator.** Nothing new: `form(…)` to the office named, or a letter. A request that names nobody ("stop
  automatically advertising vacancies") stays `no_such_act`.
- **Resolvers and kernel.** Nothing.
- **Seat instructions.** Nothing: a seat is already shown the forms it knows of.
- **Feedback.** Today, for a request naming nobody: the general `no_such_act` sentence, or a letter drafted to the
  seat's own organisation. Proposed sentence for `no_such_act`: "Nothing here does that as such. If it is for someone
  else to see to, direct them in writing, on their form for it if they have one."
- **Tests.** The town with a scripted mayor: a staffing direction of "no" and the works office posts nothing while it
  stands, though short of crew; withdrawn, it posts again; from someone who may not direct it, nothing changes and it
  says so. The code-only month ends at the same hash (no direction exists in it).
- **Cost and dependencies.** Medium for the plumbing and the first office; small for each office after. Waits for the
  knowing work to merge (both rewrite the generator's offices and channels), and should share its shape with the
  work on how modules follow laws.

### B.5 An entry in the books: no new function; one word

- **In the real world.** An organisation's books are its own records. An entry moves no money and is seen by nobody
  outside. The code offices keep theirs in memory (the finance module's running totals); a model in the seat has its
  notebook, which is too small and is not a record.
- **What kind of change.** Something an existing function covers: a statement on the organisation's own file. What is
  missing is a way to say "for our own file" without knowing an id, and a rule telling the translator.
- **Contract change.** `calls.md`: `visible` is `public`, `own` (only the organisation the act is made for), or ids.
  The schema is unchanged (the value is a word, as `public` is).
- **Translator.** One rule: recording something in one's own books or file, which moves nothing and tells nobody, is
  `statement(kind=entry, visible=own, text="…")`, citing what it concerns as `basis`.
- **Resolvers.** `own` becomes the acting organisation.
- **Kernel.** Nothing.
- **Left out on purpose.** Totals and balances: the seat adds up, as an office does. A budget line on a payment: it
  goes in the payment's purpose (`for="staff line"`), as seats already write it; no code reads it. Tax withheld: two
  payments, the net and the tax, both of which can be said now.
- **Feedback.** Today: a draft that publishes a `report` to everyone, or `no_such_act`. Proposed, as the preview: "You
  will put on Town of Millbrook's own file, seen by nobody else: "…". No money moves."
- **Tests.** Contract example; both resolvers; the entry is found by the seat's search of its own files and by no
  other seat; the one real case with gap `ledger_entry` re-keyed.
- **Cost and dependencies.** Small, plus its share of the retraining. Independent of the knowing work.

### B.6 An office's own paperwork (added): forms for the office's own papers

- **In the real world.** A registrar fills in a register entry; a manager places an advertisement with its terms.
  Each office has its own stationery.
- **What kind of change.** The same mechanism as B.4, the other way round: the papers an office *issues*. Where a
  model holds an office, the office's own forms are among its papers: the registry's death registration (who died; the
  notification relied on), an employer's job advertisement (the wage, how often it is paid, how many posts, where).
  Filled in with `form(…)`, each becomes the typed statement the rest of the town already reads.
- **Contract change.** None to the call language. A module declares the papers it issues beside the directions it
  takes (B.4). One addition to what a form may say: how its fields are written into the statement's content, for a
  paper whose content is nested (an advertisement's terms). Law schedules already write a law from its figures this
  way; a form would write a paper from its fields.
- **Translator.** Nothing: it fills in the form it is shown.
- **Resolvers.** Write the statement from the form's fields as the form says. **Kernel.** Nothing.
- **Open in the design.** Hiring is a chain: advertise, read applications, sign, set up the wage. The form covers the
  first link only; the others can be said now (`agreement(sign=…)`, `money(every=…)`), but no pilot has got that far.
- **Feedback.** Today: ten different answers to the one request in pilot 12 ("How much of it?", "You don't hold any
  crew that you know of.", "Nothing here does that as such…"). Proposed: none needed once the form is among the
  office's papers; until then, the `no_such_act` sentence.
- **Tests.** For each office a model can hold: every typed paper its code module issues can be produced by filling in
  a form, and the statement is the same to the byte as the module's own.
- **Cost and dependencies.** Medium to large (every office's papers, the form's writing rule, two resolvers). Waits
  for the knowing work, with B.4. **Until it is built, a model in the works office or the registry cannot do the
  office's work**, and pilots that put one there measure that and little else.

### B.7 Going to see (added): the knowing design covers it

- Stage (c) of the knowing work makes going to look a look ("Go and see (takes time)"), which takes the office's time
  and returns what was there. That is the right shape: seeing is not an act on the world.
- **Change here.** When it lands, a request to visit and report is `not_an_act`, not `no_such_act` (this reverses the
  key set on 2026-10-06, when nothing could go and see), and the sentence gains the words: "That's something to look
  up, read or go and see, not something to do. Look at your reports and papers, go and look, or write to whoever
  keeps it." The nine real cases with gap `go_and_see` are re-keyed.
- **Attending** a hearing or a meeting is not seeing a place: it is taking part. Offices here have no body to send,
  and the tribunal takes written answers, which seats found. Do not add; record it as a limit of the world.

### B.8 Passing on a copy (added): not now

Three requests, one pilot, one model, and a substitute that worked (writing the substance again). A copy could be made
mechanically from what the seat itself can see, so it is possible within the rules; it is not worth a change to the
language on this evidence. Revisit if it appears in two more pilots or with another model.

### B.9 A single payment on a later day (added 2026-10-10): not decided; set aside

Seats ask for one payment to be made on a day to come ("On day 29, pay … once", "pay the wage due on year 1, day 22: one payment, not a standing one"). `first=` is when something done again and again starts, and the prompt (0.9.4, ruling H) gives a single payment none; a payment with no `every=` is made when it is confirmed. So such a request cannot be written as asked: written without the date it pays at once, and written with `first=` it borrows an argument whose meaning on a single payment nothing defines. Nothing was invented for it. Counted in the round's data (2026-10-10, `runs/translator-round-2-2026-10-10/`): 16 requests of 2,753 from the wave's training pilots (3 had trained with `first=` on a single payment, 13 were among the readers' disagreements). They are set aside from training and from scoring (`set-aside-single-dated-payment.jsonl` beside the joined set). What would settle it: whether the bank module keeps a single dated instruction (then `first=` alone, with no `every=`, could mean "once, on that day", and the contract would say so), or whether the asker is to come back on the day (then it is `look_first`'s neighbour and needs its own answer).

## C. Order

1. **Now, with no contract change and no retraining.** The bank's letter lists the customer's standing instructions
   (B.2). The `no_such_act` sentence says to direct whoever sees to it (B.4). Both help the seats in the next pilots
   whatever else is decided.
2. **One change to the call language, made once.** `hold` (B.1), `visible=own` (B.5) and the label `look_first`
   (B.2, B.3) together: one contract note, one version of the translator's instructions, one regeneration of the
   data, one retraining, one re-keying of the real cases (about 25). Batching matters more than their order: each
   change to the language costs a retraining, and three small ones cost three. Within the batch, `hold` first: it is
   the only one that lets a seat do something it could not do at all.
3. **When stage (c) of the knowing work lands.** Going to see becomes `not_an_act` (B.7). If (c) lands before step 2
   is trained, it goes in the same batch.
4. **After the knowing work has merged.** Directions an office takes (B.4), then the office's own papers (B.6), on
   the same plumbing, starting with the works office because both gaps were found there.
5. **Not built.** Look-then-act as a program; an act that sets an office's practice; attending in person; copies.

**Before the knowing work merges:** steps 1 and 2 (they touch the bank's module, the translator, the resolvers and
`calls.*`; the knowing work leaves `calls.schema.json` and `blocks.schema.json` unchanged). **Must wait:** step 3
(needs the visit) and step 4 (the generator's offices and channels are being rewritten there).

## What was not verified

- The classification is one reader's. The requests of kinds 2 to 9 were listed and checked again after classifying;
  kind 1 and the split of the 100 sayable failures were read once.
- What seats did with `write` after a refusal was not read.
- That pilot 9's wage disputes came from the cancelled payments (the order of events is in the log; the cause was not
  traced).
- No real-world source has been found yet for: a bank suspending and resuming a standing order and not making up
  missed payments; written directions and delegations in a council's offices. Each is needed before its part is
  built, in `docs/behaviour/` and `docs/research/references.md`.
- The proposals were not prototyped. In particular, that `Book.open` leaving out held papers changes no code-only
  run is argued, not measured.

## Questions for the owner

1. **Build the hold as `statement(hold=…)`, lifted by withdrawing it, with the bank's module honouring it?**
   Recommended: yes.
2. **A payment missed under a hold: skipped, or made up when the hold is lifted?** Recommended: skipped, subject to
   the source.
3. **A new refusal label, `look_first`, for a paper not named and for an act that depends on a look?** Recommended:
   yes, one label for both. The cost is one more label for the model to tell apart.
4. **`visible=own`, and `entry` as the kind for a line in one's own books?** Recommended: yes.
5. **Offices that take written directions, declared in the module's manifest (a change to `module.schema.json`)?**
   Recommended: yes, starting with the works office's staffing; and no act in the language for "my office does this
   by itself".
6. **Forms for an office's own papers, so a model can run the works office or the registry?** Recommended: yes, after
   the knowing work; and until then, keep models out of offices whose work is typed papers, or accept that those
   pilots show the block.
7. **Going to see becomes `not_an_act` once visits exist?** Recommended: yes.
8. **A half-sayable request is still refused whole?** (Open since 2026-10-06.) Recommended: keep the rule. In pilot 9
   the half that could be said was drafted 14 times, the seat confirmed it, and the other half was silently lost each
   time.
