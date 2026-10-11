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
3. **The clerk files a paper when what stands open has changed**, at most one a day, and none while nothing has ever
   stood open: a statement of kind `office_books` on the organisation's own file, addressed to the organisation and
   seen by it alone. Its words say what has changed since the clerk's last paper (what is new, what has changed, what
   is no longer open) and how many stand under each heading; its list (`data.open`) holds everything that stands
   open, an entry each. A figure that moves with every payment (what has been paid against the budget) is marked
   `running`: its moving alone is no reason for a paper, and it is said as it stands whenever one is filed.
4. **What the seat sees.** The paper comes into the office's folder like any paper of its own, as one line: the
   words, and "stands open: N; the list: in this paper, read by its id". The list is read by opening the paper, a part
   at a time where it is long, as any long paper is. A paper of its own staff never brings a seat back early: it is
   read at the seat's next sitting. The folder's own name says what the clerk does ("The office's books, as its clerk
   keeps them: what has changed, the whole list in each paper"). Every such paper is in the log with its time: what a seat had been shown, and when, can be read back.
5. **The clerk does nothing about any of it.** It writes to nobody else, pays nothing and answers nothing.

A rule or threshold the code acts on that was on no paper is published instead of being put in the books: the town's
rule on petitions (`proc-petitions`: how many signatures bring a petition before the council) was a parameter of the
mayor's code and is now the town's published procedure.

## What each office's books hold

| Office (module) | Headings |
|---|---|
| A landlord's letting office (`firm.landlord`) | Rent in arrears (a lease a rent or more behind for a week or more: how much, how many rents, since when; counted from each lease's own rent day, against what has come in from the tenant's account); tenancies ending within the landlord's notice period with nothing offered and no notice given; applications for a home with no lease offered; tenants' requests to vary something, not answered; requests to put something right, complaints before a body that hears them, and decisions to pay, not answered or paid; homes listed a month or more and not let; repairs ordered and not reported done; tenants registered as dead whose leases stand; invoices, rates and fines not paid |
| The support office (`world.transfers`) | Claims the staff have put before the office-holder, not decided; requests to review a refusal, complaints and decisions, not answered. (The claims the law settles and their payment are the staff's: their report.) |
| Finance (`city.finance_officer`) | Invoices addressed to the town not paid, with whether the mayor's approval is needed and on file; employees of the town with no standing payment of their wage on file; wages still paid to someone dead or gone; the year's budget against what has been paid (in total: the office's papers do not mark a payment with a line); tax withheld and not yet paid over |
| The mayor's office (`city.mayor_code`) | Petitions at the town's threshold not put to the council or answered, and those short of it; invoices for its own commissions awaiting approval; permits granted with no builder commissioned; budgets before the council; years with no budget; complaints about the town's services still open (a count by kind and the oldest few); debts claimed against the town |
| Works, environment (`city.works`, `city.environment`) | Applications for a post not answered; starters and leavers the finance office has not been told of; directions on the office's forms that stand |
| Planning (`city.planning_officer`) | Permit applications not decided |
| The council clerk (`city.council_clerk`) | Proposals with no ballot opened; ballots closed with no result declared |
| The tribunal's member (`tribunal.member`) | Applications not yet listed; cases whose hearing day has come with no order, and whether the other side answered; cases waiting for their day; list cases whose time to answer has run |
| The tribunal's registrar (`tribunal.registrar`) | Requests to enforce an order, not answered, with the order's due date |
| A desk that hears grievances (`office.desk`) | Cases put before the office-holder; applications waiting on the other side; applications whose time has run; applications not yet taken in |
| The union (`union.organiser`) | Claims with no offer; offers not answered; ballots open, and closed with no result, with the count on file; action notified or begun; applications to join; members' matters |
| The bank's lending office (`bank.lending`) | Applications not decided; loans signed and not paid out; loans behind (who, how much, since when, what letter is on file); payout figures asked for |

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
- **Readers restate the code.** Each reader is a second reading of the same papers, not the module's own state: a
  change to what a module acts on must be made in its reader too. `orchestrator/test/office-books.test.ts` holds the
  landlord's and the support office's to their code twins in a run; the others are held by tests on papers made by
  hand (`participants/test/openbooks-*.test.ts`, `participants/test/books.test.ts`).
