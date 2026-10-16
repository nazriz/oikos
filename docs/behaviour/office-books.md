# An office's books, and the clerk who keeps them

**Source:** `participants/src/behaviour/books.ts` (the clerk and the paper), `participants/src/behaviour/openbooks.ts`,
`openbooks-venues.ts`, `openbooks-townhall.ts` (what each office's books hold), `books` on a module
(`participants/src/module.ts`; given to each module in `participants/src/index.ts`), the generator's clerk posts
(`worlds/generator/generate.ts`, `clerkFor`). Decision: docs/decisions.md, "A seated office is shown
what its code twin acts on" (2026-10-11).

## The fault

The code that runs an office works out, wake after wake, what stands open at it: who is behind with the rent and since
when, which requests wait for an answer, which invoices are unpaid, whose time to answer has run. It keeps that in its
head. A person put in the same office was shown each paper once, when it came, and what the account had received
since they last looked. Nothing kept the running list. In the second living pilot (`runs/lv-02`) the all-code twin of
the seated landlord had four tenants in arrears on day 37 and wrote to each; the seat was shown nothing of it, and its
notebook for 120 days lists rent received and never who had not paid.

## What a real office does

It has someone who keeps its books: a rent ledger, a register of correspondence awaiting reply, a creditors' list, a
case list. Whoever holds the office reads the exception report and opens the ledger when they want the detail. (To
confirm: common practice; no source opened. Candidates: a letting agent's arrears report; a registry's
correspondence register; a council's aged creditors report.)

## How it works

1. **Each office module says what its books hold** (`books`): a reader fed everything the office is shown and asked
   what stands open now, as headings ("Rent in arrears") of items, each resting on a paper named by its id, with since
   when and how much where that applies. A reader reads only the office's own papers and accounts, the same ones its
   code reads and the same way (the same thresholds, from the office's own parameters). It asks the engine nothing
   and decides nothing.
2. **Where a model holds the office, a clerk keeps them.** The clerk is the office's staff post (`<office>-staff`):
   the office's own staff where it has routine work (docs/behaviour/standing-work.md), or a post for the books alone
   (`office.clerk`, run with the office's own parameters) where it has none. It is given the channels the office is
   shown, and no others. A code-run office has no clerk and no such paper: it keeps its books in its head as before.
3. **The clerk files a paper when what stands open has changed**, on its round, and none while nothing has ever
   stood open: a statement of kind `office_books` on the organisation's own file, addressed to the organisation and
   seen by it alone. Its words say what has changed since the clerk's last paper (what is new, what has changed, what
   is no longer open) and how many stand under each heading; its list (`data.open`) holds everything that stands
   open, an entry each. A figure that moves with every payment (what has been paid against the budget) is marked
   `running`: its moving alone is no reason for a paper, and it is said as it stands whenever one is filed. Where one
   has moved and the clerk's last paper is a week old, a paper is filed for it (2026-10-12: finance's tax withheld
   stood at its day-9 figure until day 93 of the third living pilot, since nothing else in its books changed).
4. **What the seat sees.** The paper comes into the office's folder like any paper of its own, as one line: the
   words, and "stands open: N; the list: in this paper, read by its id". The list is read by opening the paper, a part
   at a time where it is long, as any long paper is. A paper of its own staff never brings a seat back early: it is
   read at the seat's next sitting. The folder's own name says what the clerk does ("The office's books, as its clerk
   keeps them: what has changed, the whole list in each paper"). Every such paper is in the log with its time: what a seat had been shown, and when, can be read back.
5. **Letters are post.** What people and organisations write to an office (a tenant asking to stay on, for time, for a
   repair) comes into its folder as it always did. Where the office is its organisation's only one (a landlord's
   letting office), a paper someone else addresses to the organisation is that office's post, and brings its seat back
   at the next working day's sitting, as one addressed to its post by name does (docs/real-models.md, "What brings a
   seat back"). The books then list it under "not answered" until it is.
6. **The clerk does nothing about any of it.** It writes to nobody else, pays nothing and answers nothing.
7. **What stands open is said until it no longer stands open** (2026-10-12). A list is a standing list, not a feed. Until then a paper's words named only what had changed since the last one: the fourth living pilot's tribunal member, back after 41 days, was shown the last dozen days' papers, each naming that day's new cases, and missed the one case whose day had come. Now:
   - a heading of things **whose day has come and that wait on the office-holder** (`always`: a case to decide, a ballot to declare, a case put before the office-holder) is said first, in every paper, each thing by its line (all of them, up to sixty to a heading; the rest are in the list; twelve until the same day's change, point 8), however long it has stood;
   - "its day has come" means the day itself, from its first hour (the procedure says a case is decided on or after its day), so the clerk's morning paper has it before a sitting that day;
   - something that moves from one heading to another is new under its new heading and is not said to be "no longer open";
   - each entry of the list carries its day where it has one (`due`), and those whose day has come lead the list;
   - a heading longer than the list holds (200) says how many it leaves out (`over`). Nothing drops off for being old.

8. **A day's ripe cases are one paper and one sitting** (2026-10-12; docs/decisions.md, "A day's ripe cases reach the member in one paper"). The fifth living pilot's tribunal member sat 33 times in 90 days to decide 56 cases (139 calls; 7.14 USD, 53% of the pilot): nothing brought it back for its books, so it set its own day of return for each case's day and sat on nearly every day from day 50 to 84; the paper's words were shown cut at a line or two, and opened by its id the list showed eight entries ("entries 9+ unseen"), so each sitting began by opening the paper and going on from `from_entry`. Now, for the offices whose books have a heading of things that wait on the office-holder with their day come (`always`: the tribunal's member, a desk, the council clerk):
   - **The day's list is the paper's words.** Every case on those headings is set out in full in the words (up to sixty to a heading; twelve before), each with what is needed to decide it; the list in `data.open` holds the same, those whose day has come first. The words end with how many are on the day's list and how many of them are on it for the first time (`data.list`: `ripe`, `new`).
   - **It is filed on the clerk's daily round** (`CLERK_ROUND_DAYS`: its first look of a day with something changed files, and the day's later looks do not; until foundations F6 this was "at most one paper a day", a count, whatever the paper cost: each paper is now an act that takes the clerk's time), when anything under any heading has changed.
   - **It is that paper that brings the seat to its desk.** A paper of the office's own staff never brought a seat back; the day's list does, when a case is on it for the first time (`new` more than nought): at the sitting of the day it was filed on if it was filed before the day's sitting opens, and otherwise at the next working day's sitting, never at once, a day's papers together, as any paper filed with the office does. A paper that concerns only cases already on the list, or has no list, does not; a case that stays undecided is on every paper and brings nobody back by staying, so a seat is not woken every day for a case it has chosen to leave. The seat is told why it is back ("papers were filed with your office (1 day list)"), and the paper tells it in its own words that a case's coming onto the list brings it back, so it need not set a day for each case's day. A seat that does set one is back on that day as it asked: nothing is taken from it.
   - **What the seat is shown.** In the sitting's report the newest books paper of an office is set out whole (the words up to 60,000 characters; before, a line or two of 1,000); earlier ones in the same report keep a line each. Opened by its id, the words are shown whole and the list below does not set out a case twice (an entry whose line the words already give is one short line: "set out above, in the day's list"), so the list's room goes to the cases that are waiting.
   - **One working day's lag at most.** A case whose day is D is on the first paper filed on D. The clerk looks in at an hour of its own (in the fifth living pilot's tribunal between 00:30 and 23:00, drifting from day to day); if that is before the day's sitting opens the seat is called to it that day, otherwise the next working day: "decided no later than a working day after it ripens". A seat that sits on D by its own choice decides it on D from the waiting list, as before.
   - Nothing about what a code office decides, or when, changes: a code-run office has no clerk and no such paper (`orchestrator/test/twin-draws.test.ts`). The routine is the clerk's (this file, point 3 and 8), not a mechanism a seat can see: the seat sees a paper from its clerk and the sitting it is called to.

A rule or threshold the code acts on that was on no paper is published instead of being put in the books: the town's
rule on petitions (`proc-petitions`: how many signatures bring a petition before the council) was a parameter of the
mayor's code and is now the town's published procedure.

## What each office's books hold

| Office (module) | Headings |
|---|---|
| A landlord's letting office (`firm.landlord`) | Rent in arrears (a lease a rent or more behind for a week or more: how much, how many rents, since when; counted from each lease's own rent day, against what has come in from the tenant's account; the last payment with what it said it was for; whether the landlord has written to ask); **tenancies being ended for arrears under the law on possession, each at the stage its papers put it at** (notice to vacate and its date; applied to the tribunal; the tribunal's plan, or its order and its date; a warrant asked, out, or lapsed) **with what the law's procedure has next** (it lapses if paid; the landlord may apply; a warrant may be asked of the registrar; nobody else may put the tenant out), until the tenant has gone or the warrant is carried out; **tenants who have left on a notice to vacate** (2026-10-12: the tenancy is over from the day the tenant gave notice on the lease and went; the rent book stops there, with what was owed that day; whether an application for possession still stands undecided, and that the law gives possession only where the tenant has not left; it stands while the lease is still on the record or an application is undecided); **an application before the tribunal, with what has changed since it was made** (2026-10-12, the fifth living pilot: what the application said was owed beside what the rent book shows now; the tenant's answer to the tribunal and whether this office has replied; a plan the tenant accepted or a request this office granted since; and, where the rent is paid or terms agreed, that an application stands until decided or withdrawn and that landlords ordinarily withdraw one then: said as the practice, never as what to do; an application withdrawn is no longer shown as waiting); rent owed as the year began, where the landlord's statement of the rent account says so (docs/behaviour/generator.md); tenancies ending within the landlord's notice period with nothing offered and no notice given; applications for a home with no lease offered; tenants' requests to vary something, not answered; requests to put something right, complaints before a body that hears them, and decisions to pay, not answered or paid; homes listed a month or more and not let; repairs ordered and not reported done; tenants registered as dead whose leases stand; invoices, rates and fines not paid |
| The support office (`world.transfers`) | Claims the staff have put before the office-holder, not decided; requests to review a refusal, complaints and decisions, not answered. (The claims the law settles and their payment are the staff's: their report.) |
| Finance (`city.finance_officer`) | Invoices addressed to the town not paid, with whether the mayor's approval is needed and on file; employees of the town with no standing payment of their wage on file (and the budget line the hiring office's notice puts the post on); wages still paid to someone dead or gone; the year's budget against what has been paid (by line: what each line has drawn and what is left, and what no line was named for as unallocated; and by what the year's payments said they were for, from the bank's statement lines, the five largest: docs/behaviour/government.md, "Payments carry their budget line"); tax withheld and not yet paid over; the returns of tax withheld that fall due next, by the law's calendar |
| The mayor's office (`city.mayor_code`) | Petitions at the town's threshold not put to the council or answered, and those short of it; invoices for its own commissions awaiting approval; permits granted with no builder commissioned; budgets before the council; years with no budget; complaints about the town's services still open (a count by kind and the oldest few); debts claimed against the town |
| Works, environment (`city.works`, `city.environment`) | Applications for a post not answered; starters and leavers the finance office has not been told of; directions on the office's forms that stand |
| Planning (`city.planning_officer`) | Permit applications not decided |
| The council clerk (`city.council_clerk`) | Proposals with no ballot opened; ballots closed with no result declared |
| The tribunal's member (`tribunal.member`) | Every case that stands open, with the day the other side may answer by and whether an answer has come. First, said in every paper: **applications for possession whose day has come**, cases whose hearing day has come, list cases whose time to answer has run. Then applications not yet listed; **applications for possession waiting for the tenant's time to answer**, the soonest first; cases waiting for their day. An application for possession is shown with the landlord, the tenant, the home, the lease, what is said to be owed, whether a plan was broken, **the notice to vacate it relies on with the day it was given and the day it gave, the tribunal's own notice of hearing and since when it has been on the record addressed to both sides** (that is how a paper is served here: the record's line is all there is), and what the tenant has answered: paid since, offered a month, or that they have left the home. An application its maker has withdrawn is no longer listed. **Each application for possession carries the tenant's answer as the tenant gave it** (2026-10-12; docs/behaviour/justice.md, "A tenant's answer"): each thing told, in the form's order, and nothing for what was left out; the landlord's reply where there is one; and, at the head of the list of cases to decide, the law's own words on the order (whether a plan may be set, must be considered, or the law has none, and what it has instead). Nothing of what became of a household after an order: no office is told. |
| The tribunal's registrar (`tribunal.registrar`) | Requests to enforce an order, not answered, with the order's due date; requests for a warrant of possession with no warrant issued, with the order's date and whether it has passed |
| A desk that hears grievances (`office.desk`) | Cases put before the office-holder; applications waiting on the other side; applications whose time has run; applications not yet taken in |
| The union (`union.organiser`) | Claims with no offer; offers not answered; ballots open, and closed with no result, with the count on file; action notified or begun; applications to join; members' matters |
| The bank's lending office (`bank.lending`) | Applications not decided; loans signed and not paid out (the lender's code now reads these from its own file too: until 2026-10-11 it knew a loan it had offered only by the id its making gave back, and the mock in the lending seat, which hears none, paid out nothing it approved); loans behind (who, how much, since when, what letter is on file); payout figures asked for |

Left without books: the bank's payments office (machinery, not an office anyone holds), the rates office, the registry,
the clinic, the school, the utilities and the police (their staff's own reports cover their routine; nothing else of
theirs was found that a seat is not shown).

## Leaves out

- **What lives only in the code's head.** A petition the code mayor drew not to answer; the environment office's
  survey round; which line of the budget a payment was made against (no paper says); a union dispute's stage beyond
  what its papers show. The books say what the papers say.
- **A seat that never opens the paper** sees the words and the count, not the list.
- **The mock.** A mock seat's brain is the office's code, which does not read the books; a mock run shows what a
  model would have been shown, not what it would have done with it.
- **Held to the code in a run** (2026-10-12; `orchestrator/test/office-books-walk.test.ts`): a living town of 300 for
  150 days with sixteen offices in mock seats that sit every third day. For every paper a brain acts on that had
  stood open through a whole day of the clerk's, the clerk had it in that office's books. Seen so in the test's town:
  the lender's decisions (100), landlords' requests, notices and applications (47), the tribunal member's orders
  (5), the council clerk's result (1). Not seen there, for want of such acts: finance, the support office, the
  union, the desks, the registrar; their readers are still held on hand-made papers alone. What came the day the
  brain acted, or the day before, is the seat's post and is left out: the clerk looks in once a day, often at the
  seat's own hour.
- **The mayor's petitions.** A proposal or an answer of the mayor's that names a petition in its words counts as
  acting on it, as one that cites it does (a seat's proposals on the council's form cite nothing, and its books
  listed four petitions as open for 45 days after it had dealt with them). An answer on the petition form cites it.
- **Readers restate the code.** Each reader is a second reading of the same papers, not the module's own state: a
  change to what a module acts on must be made in its reader too. `orchestrator/test/office-books.test.ts` holds the
  landlord's and the support office's to their code twins in a run; the others are held by tests on papers made by
  hand (`participants/test/openbooks-*.test.ts`, `participants/test/books.test.ts`).

## What a seat asked for, and whose it is to know (2026-10-12)

The fourth living pilot's seats said in their debriefs what they lacked. Each was set against what the office's code twin has and what the office's ordinary papers would bring it.

| Asked for | The code twin has it? | Done |
|---|---|---|
| The member: a fuller case list at each sitting | Yes (its list of cases is its own state) | Closed: the standing list above. |
| The member: whether a tenant was served | The code asks nothing: a notice is given when it is on the record | Closed as far as there is anything to show: the application's own statement of the notice it relies on, and the record's line for the tribunal's notice of hearing. Nothing else exists, and the books say nothing more. |
| The member: cases spread out, or sight of what is coming | The code knows each case's day | Closed: every waiting case with its day, the soonest first. A town may also open with a list part-way through (docs/behaviour/generator.md). |
| The landlord: how its applications ended, and whether a tenant had gone | Yes: orders come addressed to it; a tenant's notice on the lease is on its file | Closed: the stage of each tenancy was there already; a tenant who has left is now a heading of its own. |
| The landlord: how tenants fared afterwards | No office learns this: nobody writes to a landlord about a former tenant | Left, on purpose. |
| The mayor: the result of the ballot on what it put to the council | The result is published by the council clerk and reaches the mayor as any published paper | Left as it is: it was shown (the seat's notebook has both results). Not a books gap. |
| The mayor: what its answers did to petitioners; the effect on tenants | No office learns this | Left, on purpose. |
| The mayor: what it may direct other offices to do | The directions' forms on its file say what each office takes | Not a books gap; the forms are its file. |
| Finance: a list of duties falling due | The code files its returns on the law's days (`returns.ts`), the same function the books call | Closed (2026-10-12, docs/decisions.md, "Returns on the law's days"): a heading, "Returns of tax withheld from wages falling due, and the day each is due by", with a line for each return the published tax law lists: its name and charges, the law, the day the next falls due (and in how many days), the period it reports, when the last was made, and what has been withheld from wages paid since. |
| Finance: whether a standing payment it withdrew has stopped | The code knows by the withdrawal on record | In the books already: "wages still being paid to someone who has died or whose employment has ended" loses the entry when the payment is withdrawn, and the paper says "no longer open". |
| An order paid or not (the member) | No: the tribunal learns of an unpaid order only if the creditor asks its registrar to enforce it, and of a paid one never | Left: the registrar's books show requests to enforce; the member's do not, and a paid order leaves no paper at the tribunal. |

Never shown: an outcome the office would not learn of by its ordinary papers.

## The office's own file (2026-10-13)

**Source:** `participants/src/behaviour/daybook.ts`; wired in `orchestrator/src/run.ts` (the seat's `dayBook`) and shown by
`participants/src/llm/participant.ts` (0.18.0). Tests: `participants/test/daybook.test.ts`, and a case in
`orchestrator/test/no-god-view.test.ts`. Decision: docs/decisions.md, "What a seat carries between sittings" (2026-10-13).

**The fault.** The books above say what stands open. A real office-holder also has what the office *did*: the file of what
it sent and when, the ledger of what it paid and was paid, the record of what it decided. A seat has its notebook and,
for what it did, nothing else: each paper it files comes back to it once, as a new paper, and is not shown again. In the
sixth living pilot the letting office paid a rates notice on day 31 and again on day 73 and let a second fall overdue; the
seat said it had "depended on the notebook for continuity, and I missed some things". The papers were the office's own.

**What a real office does.** A clerk keeps a day book (what went out, what was filed, when), a payments ledger, and the
aged list of what is open; the office-holder reads them when they sit down. (To confirm: common practice; no source opened.)

**How it works.**
1. **At every sitting** the first message carries, after the report, a section "<Office>: The office's own file", made by
   code from what the seat itself has been shown: its own papers and its staff's (never the clerk's `office_books` nor a
   staff report), its own accounts' payments out and in, and the office module's `books` (the same reader the clerk uses)
   for what stands open. Nothing is asked of the engine; the file holds only what the seat's channels carried (the
   knowing rules: it is theirs). A code-run office has none.
2. **Sent, filed and paid**, newest first, the last 40 days, each with its date and id. A paper that someone else's paper
   cites is followed by "followed <date> by a <kind> (<who>)". A request to the bank to pay is replaced by the payment
   when it was carried out ("paid KSh 2,977.86 to the city, settling rec.19352; asked of the bank <date>") and says
   "no payment out of the account seen yet" when it was not. Standing payments of one sum for one stated reason are one
   line (how many, to how many, since when). Three or more papers of one kind in one day are one line.
3. **Into the account**, the last 40 days, by payer: how many, how much, the latest, the memo.
4. **Standing open on the books now**: each heading with a count and its first three lines; the rest counted.
5. **The bound.** At most 4,500 characters in all (`DAYBOOK_MAX`): 1,700 for the lines sent, filed and paid; 500 for money
   in; 1,400 for what is open; the rest is headings. Lines are whole; what does not fit, and everything older than 40
   days, is counted by kind in one line ("Before that and beyond the lines above: 50 rental listings, 40 withdrawals ...").
   Folding is by code, never by a model. Test: a busy office over 90 days never passes it.
6. **Nothing says what to do with it.** The seat's standing instructions, the translator's prompt and its forms list are
   unchanged. The notebook stays the seat's own free notes.

**Out of scope here, done after** (2026-10-13, docs/behaviour/government.md "One bill, two papers"). The book of "Sums
recorded against us" listed the rates claim (rec.19353) as unpaid after the notice beside it (rec.19352) had been paid:
a books fault, not a memory one. Fixed there: a payment naming either paper settles the bill.

**Revisit if** a seat's own record is read as a to-do list or leads it to repeat (watch the first pilot that has it); if the
bound binds on a seat whose office does a great deal (the tribunal's member, with sixty cases in a day); or if a seat
needs the papers it sent more than 40 days ago, which are on its file and can be looked up.

## How the office has acted before (2026-10-14)

A seat is not shown its office's past practice as counts. It goes and looks in the office's own files, by kind of paper and
by date, as any holder of papers of its own can (docs/behaviour/culture.md, "An office's practice"). The books and the
office's own file above are unchanged by it.
