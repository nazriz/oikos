# `bank.payment_system` (v0.5.0)

**Seat:** a bank's automated payment system (acts as the bank). **Source:** `participants/src/behaviour/bank.ts`.

## What it does

Once a day it reads the **payment requests** addressed to its bank: statements of kind `request` whose data is a money outcome (the standard encoding in contracts/outcomes.schema.json), from the records it can see. The requests come from seats saying `money(...)`: the resolver turns that into a request to whoever keeps the account (D36). It carries them out by moving money it holds in custody, through its own `money(...)` calls, which the resolver turns into transfers because the bank keeps those accounts.
- **One-off payments:** `data: { outcome: { money: { from, to, amount, for?, settles? } } }`. Paid once.
- **Standing orders and direct debits:** the same, plus `every` and optionally `first`. Due first at the request's time plus `first` (or `every`), then every `every` seconds. If the bank wakes late, it pays each missed due date once.
- **Withdrawn requests** (a withdrawal record the bank can see) are no longer carried out.
- **A registered death (v0.6.0):** the dead person's requests are no longer carried out, and their accounts pay out only to settle the estate. The estate passes as the town's `law-succession` says: to the partner, else equally to the adult children, else the town. It happens at once, on registration. Real probate takes months, and the law's order is simplified: in Victoria, children's shares include minors, held in trust.
- **Opening an account:** a request whose outcome is `account: { holder }`, from the holder themselves (someone turning 18 in a household, for instance). The bank opens it, with no other checks yet (real banks verify identity; that's content to add).

The bank's own procedure, applied before paying:
- **Only the account holder may instruct.** The instruction must speak for the holder of the paying account and, if `verify_author` is set, be written by one of the holder's own seats (checked via the directory). A forged instruction is ignored.
- **Named signatories.** If the account holder has told the bank who may instruct payments from an account (a `signatories` statement addressed to the bank, `data: { account, seats }`; the latest one stands), an instruction from any other seat is declined, and the author is told why. Organisations use this: the town names only its finance officer.
- **Requests it can't carry out get a reply, once:** an account it doesn't keep, no valid amount or account to pay, or something other than a payment. So does a payment that physics refused, with the reason in plain words.
- **The money must be there.** If it isn't, the payment is not made and the holder is sent a message saying so. The obligation behind it, such as rent, simply stays unpaid; what follows is up to the creditor.

It batches up to 32 payments per action. If a batch is refused because the world changed under it, it retries those payments one at a time.

## Where the rule comes from

Real retail banking: payments are made on the account holder's instruction; standing orders and direct debits are standing instructions the bank executes on schedule; a payment without funds fails, and the customer is notified. This is deliberately **procedure-following behaviour with no discretion**. The interesting variations (a bank that freezes accounts, favours some customers, obeys or ignores court orders, or is run by an AI) are other modules, or LLM seats.

## Parameters

| Param | Default | Meaning |
|---|---|---|
| `verify_author` | `true` | Require the instruction to be written by one of the account holder's own seats |
| `max_batch` | `32` | Payments per action |

## Leaves out

- Overdrafts and credit lines (debt and credit are agreements; a lending module will handle them).
- Interest.
- Fees.
- Fraud detection beyond author verification.
- Court orders (a later version).
- Payment timing within a day.
