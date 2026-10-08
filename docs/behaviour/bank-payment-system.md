# `bank.payment_system` (v0.12.0)

**Seat:** a bank's automated payment system (acts as the bank). **Source:** `participants/src/behaviour/bank.ts`.

## What it does

Once a day it reads the **payment requests** addressed to its bank: statements of kind `request` whose data is a money outcome (the standard encoding in contracts/outcomes.schema.json), from the records it can see. The requests come from seats saying `money(...)`: the resolver turns that into a request to whoever keeps the account (D36). It carries them out by moving money it holds in custody, through its own `money(...)` calls, which the resolver turns into transfers because the bank keeps those accounts.
- **Bulk payments** (0.9.0): `data: { from, payments: [{ to, amount, for? }] }`. One instruction from one account to many, paid once, as a share registry pays a dividend or a payroll bureau pays wages. The same checks as any payment. Firms pay their dividends this way (docs/behaviour/producer.md).
- **What a busy moment doesn't get to** (0.9.0): a wake allows only so many actions. Payments left over are made first at the bank's next wake, which comes at the next tick (an hour) when a wake ran out of actions with more to do (orchestrator 0.8.0; before, the next day). Before, they were dropped: at the 1,000-person town's month ends the bank reached its ceiling (1,152 transfers in a moment) and the rest were never made.
- **One-off payments:** `data: { outcome: { money: { from, to, amount, for?, settles? } } }`. Paid once. `settles` is the payer's reference (the claim, invoice or order it pays), carried as given, as a bank carries a payment reference without knowing what it refers to (0.8.0: before, it was dropped unless the bank could see the record, so a town never learnt which rates a payment was for). A reference to no record at all gets the payment refused.
- **Standing orders and direct debits:** the same, plus `every` and optionally `first`. Due first at the request's time plus `first` (or `every`), then every `every` seconds. If the bank wakes late, it pays each missed due date once.
- **Withdrawn requests** (a withdrawal record the bank can see) are no longer carried out. A standing order's payment that fell due before the withdrawal is still made (the bank plans a day apart: an order replaced in the hours after its pay day, a wage at a new rate say, would otherwise lose that pay; 0.11.1, 2026-10-08).
- **A hold (0.12.0, 2026-10-08):** a customer may tell the bank to make no payment under a standing order for the time being, and later to resume (the section "A hold" below). The bank answers every hold once.
- **A registered death (v0.6.0):** the dead person's requests are no longer carried out, and their accounts pay out only to settle the estate. The estate passes as the town's `law-succession` says: to the partner, else equally to the adult children, else the town. It happens at once, on registration. Real probate takes months, and the law's order is simplified: in Victoria, children's shares include minors, held in trust.
- **Opening an account:** a request whose outcome is `account: { holder }`, from the holder themselves (someone turning 18 in a household, for instance). The bank opens it, with no other checks yet (real banks verify identity; that's content to add).

The bank's own procedure, applied before paying:
- **Only the account holder may instruct.** The instruction must speak for the holder of the paying account and, if `verify_author` is set, be written by one of the holder's own seats. A forged instruction is ignored.
- **Who wrote it** (0.12.0). Nobody is shown who's who (docs/design/knowing.md): until 0.12.0 the bank was shown every entity and every post in the town and read its customers' writers off that. Now, before it reads an instruction for the first time, it looks its writer up: the person a participant acts as, or the organisation of the post an instruction was written in; one look-up for each writer, ever, a look's worth (16) at a time. The answer comes at once, so nothing is paid later than before. A writer the look-up does not find is asked after once; their instruction is not their account holder's, and is ignored as a forged one is. A letter to the bank says of itself whom it was written for, and is answered from that. Real basis: a bank acts on its customer's mandate and checks the signature on an instruction against it; it does not hold a list of everyone in the town (the look-up stands for the bank's own identification of its customer, which here costs nothing and takes no time: see [knowing.md](knowing.md), "Leaves out").
- **Named signatories.** If the account holder has told the bank who may instruct payments from an account (a `signatories` statement addressed to the bank, `data: { account, seats }`; the latest one stands), an instruction from any other seat is declined, and the author is told why. Organisations use this: the town names only its finance officer.
- **Requests it can't carry out get a reply, once:** an account it doesn't keep, no valid amount or account to pay, or something other than a payment. So does a payment that physics refused, with the reason in plain words.
- **The money must be there.** If it isn't, the payment is not made and the holder is sent a message saying so. The obligation behind it, such as rent, simply stays unpaid; what follows is up to the creditor. The message's words are fixed ("Payment of … to … (request …) failed: insufficient funds."), and kept in one place with how a reader knows them (`PAYMENT_FAILED`, `participants/src/behaviour/common.ts`): a code tenant counts rent as missed on exactly this note, and on none of the bank's others. That due date isn't tried again: a standing order's next payment is its next due date's.

- **Letters.** A letter to the bank is answered with the writer's own accounts and balances, their latest payments, and (0.12.0) **their own standing instructions, each by its reference**: its amount, the account it pays from and the account it pays, how often, its next due day, and whether it is on hold and under which hold. Nobody else's are listed. A real bank sends this list on request; here it is how a customer who has no reference for an instruction comes to have one, so that it can be withdrawn or held by name. At most `letter_lists` are listed, in order of reference, and the letter says how many more there are.

It batches up to 32 payments per action. If a batch is refused because the world changed under it, it retries those payments one at a time.

## Where the rule comes from

Real retail banking: payments are made on the account holder's instruction; standing orders and direct debits are standing instructions the bank executes on schedule; a payment without funds fails, and the customer is notified. This is deliberately **procedure-following behaviour with no discretion**. The interesting variations (a bank that freezes accounts, favours some customers, obeys or ignores court orders, or is run by an AI) are other modules, or LLM seats.

## A hold (0.12.0)

**What it is.** A statement of kind `hold`, addressed to the bank, whose data names the standing orders it holds (`{ holds: [ids] }`): what `statement(hold=…)` resolves to (contracts/calls.md). It is an instruction like any other. The kernel does nothing with it and blocks nothing: the bank reads it at its next plan and acts on it, as its own conduct. A bank run by another module, or by a model, may do otherwise.

**The rule.**
- **Who may hold.** Whoever may instruct on the account the order pays from: the account's holder, written by one of its own seats (`verify_author`), and, where the holder has named signatories for the account, one of those. The same check as for any instruction.
- **What it stops.** Every payment under the order that falls due while the hold counts. A hold counts from when it was given plus the bank's notice (`hold_notice`, a day by default), until it is withdrawn. A payment that fell due before then is still made, whenever the bank gets to it (it plans once a day). The first due date a hold stops is in the bank's answer.
- **Nothing is made up.** A due date passed over under a hold is not paid then and not paid later. When the hold is withdrawn the order goes on from its next due date, at its ordinary amount.
- **What it does not touch.** The order stays on record, with its history. So does whatever the order was paying for. A hold is an instruction about a payment instruction: it ends no agreement and settles no debt. The wages, rent or instalment that a passed-over payment would have paid is still owed, and paying it is the payer's own to do, by a payment of its own (the bank's answer says so). What the one owed does about it is theirs, as the world already has it: a worker whose wages have not come for a pay period and five days resigns and records the wages as a debt against the employer (docs/behaviour/citizen.md), a landlord counts the rent as arrears and gives notice after two months of it (docs/behaviour/firms.md), a lender follows a loan into arrears and default (docs/behaviour/credit.md). None of that is new, and none of it is the bank's.
- **Lifting it.** The hold is withdrawn (`statement(withdraw=<the hold>)`), by anyone who can withdraw that statement. Payments due after the withdrawal are made.
- **The answer, once.** For orders it holds: "Hold H is in place. Not paid while it stands: X, from the payment due on day N. Anything due before then is still paid. A payment not made under a hold is not made up when the hold is lifted: what it was for is still owed, and is yours to settle with whoever it is owed to. To resume, withdraw H; payments then go on from the next due date." For anything else named (no such order, somebody else's, or the writer may not instruct on that account): "Hold H does not apply to X: we have no standing instruction of yours by that reference." One sentence for all three, so that an answer tells nobody whether another customer's instruction exists.
- **Not told:** the payee. A bank does not tell a payee that a payer has paused a standing order.

**Where the rule comes from** (citations in docs/research/references.md, "A hold on a standing payment"). In brief, from what was read:
- A standing order is the payer's instruction to its own bank, and the payer may suspend or revoke it up to a cut-off before the due date: the end of the business day before, in the United Kingdom's Payment Services Regulations 2017 (reg. 83); three business days before, for a preauthorised transfer under the United States' Regulation E (12 CFR 1005.10(c)). Hence `hold_notice`, a day by default.
- Banks that offer a suspension as such suspend a number of executions and resume with the next one after: Commerzbank's corporate banking ("The standing order will then be paused for the recorded time and will then be executed again", with the date of the next execution shown). Australia's PayTo lets the payer pause and resume an agreement; while it is paused "payments are not processed". No source read describes a bank paying, on resumption, the instalments that fell due during a suspension, and bank terms read for the nearest case (a standing order that fails for want of funds) say the bank does not pay later what it did not pay on the day beyond a few days' retry. So: passed over, not made up.
- Stopping the payment does not touch what is owed. The United Kingdom's Direct Debit scheme: cancelling "simply stops payments from going to the organisation you are paying. If you still owe money for something you've bought, or are still receiving a service, you'll need to organise another way of paying." PayTo: "pausing an agreement isn't the same as cancelling or pausing your contract or subscription", and the payee may charge for the missed payments. For wages in particular, an employer that pays less than is properly payable on a pay day has made a deduction from wages which the worker can recover (Employment Rights Act 1996 (UK), s. 13(3)).
- **Depends on the instrument, and what the world has.** Every standing payment in this world is the payer's own instruction to its bank (a standing order). A payment the payee collects (a direct debit) is another instrument: there the payee, told the debit was stopped or returned, may present it again or ask for payment another way. The world has no payment a payee collects, so nothing here is presented again. If one is added, its hold should follow that instrument's rules, not these.

**What the world keeps of the obligation, payment by payment.** A held payment vanishes silently only where nothing records what it was for. Checked against every standing payment the generator and the modules make:

| Standing payment | The record of what is owed | What the one owed does |
|---|---|---|
| Wages (an employer's, a town's) | The employment agreement it cites (`basis`), whose commitment is the wage every pay period | The worker resigns after a pay period and five days unpaid, and records the debt as a claim (citizen) |
| Rent | The lease it cites | The landlord counts arrears against the lease and gives notice (firms) |
| Loan repayments | The loan agreement it cites | The lender's notice of arrears, then default (credit) |
| Union dues | The membership agreement it cites | Nothing: the union does not follow dues that stop. **A gap** (the obligation is on record; nobody acts on it) |
| A household member's share of the rent, paid to the leaseholder | **None.** It is an arrangement inside a household, with no agreement behind it | The leaseholder still owes the landlord the whole rent, which is on record; between the two of them nothing is. **A gap**, left as it is: a debt between members of a household would be an invented mechanism |

Both gaps were there before holds (either payment can be withdrawn for good with the same effect), and are listed, not fixed.

## Parameters

| Param | Default | Meaning |
|---|---|---|
| `verify_author` | `true` | Require the instruction to be written by one of the account holder's own seats |
| `who` | (none) | Its channel onto who's who, where it looks writers up. None: it knows of writers only what it is shown (a world that shows it a directory; the tests) |
| `max_batch` | `32` | Payments per action |
| `hold_notice` | `86400` (a day) | How long before a due date a hold must have been given to stop that payment, in seconds. `0`: a hold stops whatever falls due from the moment it is given. From the cut-offs payment law gives for revoking a standing order (above) |
| `letter_lists` | `40` | How many of a customer's standing instructions a letter lists before saying how many more there are |
| `review_all` | `false` | Go through every standing order at every plan, due or not. The same payments and replies either way (`participants/test/bank.test.ts` holds the two side by side); it is there to check the shorter way against |

## What it goes through at a plan

A new request is gone through when it arrives. A standing order is gone through again when it is next due, and at every plan while it has no due date (it was refused, or isn't its account holder's). Going through an order that isn't due does nothing unless something the bank's checks read has changed: the accounts it keeps and whose they are, the signatories it has been told of (and, in a world that shows it a directory, the directory: where it looks writers up, a writer is known before their instruction is first read, so nothing is gone through again on that account). When one of those has changed since the last plan, every standing order is gone through, as they all were at every plan before (at 3,000 people, 3,000 orders at each of 2,800 plans a month, of which under 10,000 were due).

## Leaves out

- Overdrafts and credit lines (debt and credit are agreements; a lending module will handle them).
- Interest.
- Fees.
- Fraud detection beyond author verification.
- Court orders (a later version).
- Payment timing within a day.
- A hold that ends by itself on a date, or after a number of payments (a seat lifts its own hold); a hold on part of a payment; a hold on a one-off payment (it is paid when it arrives: there is nothing to hold); fees for a payment not made; any notice to the payee.
- Payments a payee collects (direct debits), and so a stopped payment being presented again.

## Garnishee orders (v0.10.0; docs/behaviour/justice.md)

A court's or tribunal's order to pay a debt from what the bank holds for the debtor (`garnishee_order`, from an entity in the world's `courts`): carried out once, from the debtor's accounts here in id order, up to the amount, to the creditor's account, settling the debt (the transfer names it). What the accounts don't hold isn't paid; the order isn't kept open.
