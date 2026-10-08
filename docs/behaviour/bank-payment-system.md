# `bank.payment_system` (v0.10.0)

**Seat:** a bank's automated payment system (acts as the bank). **Source:** `participants/src/behaviour/bank.ts`.

## What it does

Once a day it reads the **payment requests** addressed to its bank: statements of kind `request` whose data is a money outcome (the standard encoding in contracts/outcomes.schema.json), from the records it can see. The requests come from seats saying `money(...)`: the resolver turns that into a request to whoever keeps the account (D36). It carries them out by moving money it holds in custody, through its own `money(...)` calls, which the resolver turns into transfers because the bank keeps those accounts.
- **Bulk payments** (0.9.0): `data: { from, payments: [{ to, amount, for? }] }`. One instruction from one account to many, paid once, as a share registry pays a dividend or a payroll bureau pays wages. The same checks as any payment. Firms pay their dividends this way (docs/behaviour/producer.md).
- **What a busy moment doesn't get to** (0.9.0): a wake allows only so many actions. Payments left over are made first at the bank's next wake, which comes at the next tick (an hour) when a wake ran out of actions with more to do (orchestrator 0.8.0; before, the next day). Before, they were dropped: at the 1,000-person town's month ends the bank reached its ceiling (1,152 transfers in a moment) and the rest were never made.
- **One-off payments:** `data: { outcome: { money: { from, to, amount, for?, settles? } } }`. Paid once. `settles` is the payer's reference (the claim, invoice or order it pays), carried as given, as a bank carries a payment reference without knowing what it refers to (0.8.0: before, it was dropped unless the bank could see the record, so a town never learnt which rates a payment was for). A reference to no record at all gets the payment refused.
- **Standing orders and direct debits:** the same, plus `every` and optionally `first`. Due first at the request's time plus `first` (or `every`), then every `every` seconds. If the bank wakes late, it pays each missed due date once.
- **Withdrawn requests** (a withdrawal record the bank can see) are no longer carried out.
- **A registered death (v0.6.0):** the dead person's requests are no longer carried out, and their accounts pay out only to settle the estate. The estate passes as the town's `law-succession` says: to the partner, else equally to the adult children, else the town. It happens at once, on registration. Real probate takes months, and the law's order is simplified: in Victoria, children's shares include minors, held in trust.
- **Opening an account:** a request whose outcome is `account: { holder }`, from the holder themselves (someone turning 18 in a household, for instance). The bank opens it, with no other checks yet (real banks verify identity; that's content to add).

The bank's own procedure, applied before paying:
- **Only the account holder may instruct.** The instruction must speak for the holder of the paying account and, if `verify_author` is set, be written by one of the holder's own seats. A forged instruction is ignored.
- **Who wrote it** (0.12.0). Nobody is shown who's who (docs/design/knowing.md): until 0.12.0 the bank was shown every entity and every post in the town and read its customers' writers off that. Now, before it reads an instruction for the first time, it looks its writer up: the person a participant acts as, or the organisation of the post an instruction was written in; one look-up for each writer, ever, a look's worth (16) at a time. The answer comes at once, so nothing is paid later than before. A writer the look-up does not find is asked after once; their instruction is not their account holder's, and is ignored as a forged one is. A letter to the bank says of itself whom it was written for, and is answered from that. Real basis: a bank acts on its customer's mandate and checks the signature on an instruction against it; it does not hold a list of everyone in the town (the look-up stands for the bank's own identification of its customer, which here costs nothing and takes no time: see [knowing.md](knowing.md), "Leaves out").
- **Named signatories.** If the account holder has told the bank who may instruct payments from an account (a `signatories` statement addressed to the bank, `data: { account, seats }`; the latest one stands), an instruction from any other seat is declined, and the author is told why. Organisations use this: the town names only its finance officer.
- **Requests it can't carry out get a reply, once:** an account it doesn't keep, no valid amount or account to pay, or something other than a payment. So does a payment that physics refused, with the reason in plain words.
- **The money must be there.** If it isn't, the payment is not made and the holder is sent a message saying so. The obligation behind it, such as rent, simply stays unpaid; what follows is up to the creditor. The message's words are fixed ("Payment of … to … (request …) failed: insufficient funds."), and kept in one place with how a reader knows them (`PAYMENT_FAILED`, `participants/src/behaviour/common.ts`): a code tenant counts rent as missed on exactly this note, and on none of the bank's others. That due date isn't tried again: a standing order's next payment is its next due date's.

It batches up to 32 payments per action. If a batch is refused because the world changed under it, it retries those payments one at a time.

## Where the rule comes from

Real retail banking: payments are made on the account holder's instruction; standing orders and direct debits are standing instructions the bank executes on schedule; a payment without funds fails, and the customer is notified. This is deliberately **procedure-following behaviour with no discretion**. The interesting variations (a bank that freezes accounts, favours some customers, obeys or ignores court orders, or is run by an AI) are other modules, or LLM seats.

## Parameters

| Param | Default | Meaning |
|---|---|---|
| `verify_author` | `true` | Require the instruction to be written by one of the account holder's own seats |
| `who` | (none) | Its channel onto who's who, where it looks writers up. None: it knows of writers only what it is shown (a world that shows it a directory; the tests) |
| `max_batch` | `32` | Payments per action |
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

## Garnishee orders (v0.10.0; docs/behaviour/justice.md)

A court's or tribunal's order to pay a debt from what the bank holds for the debtor (`garnishee_order`, from an entity in the world's `courts`): carried out once, from the debtor's accounts here in id order, up to the amount, to the creditor's account, settling the debt (the transfer names it). What the accounts don't hold isn't paid; the order isn't kept open.
