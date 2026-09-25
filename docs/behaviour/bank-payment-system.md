# `bank.payment_system` (v0.1.0)

**Seat:** a bank's automated payment system (acts as the bank). **Source:** `seats/src/behaviour/bank.ts`.

## What it does

Once a day it reads the **instructions** addressed to its bank: statements of kind `instruction`, from the records it can see. It carries them out by moving money it holds in custody:
- **One-off payments:** `data: { pay, from, to }`. Paid once.
- **Standing orders and direct debits:** `data: { pay, from, to, every, first? }`. Due first at the instruction's time plus `first` (or `every`), then every `every` seconds. If the bank wakes late, it pays each missed due date once.
- **Withdrawn instructions** (a withdrawal record the bank can see) are no longer carried out.

The bank's own procedure, applied before paying:
- **Only the account holder may instruct.** The instruction must speak for the holder of the paying account and, if `verify_author` is set, be written by one of the holder's own seats (checked via the directory). A forged instruction is ignored.
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
