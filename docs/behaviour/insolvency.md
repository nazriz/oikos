# Firms that fail: insolvency and winding up (`WindingUp`, in firm.producer 0.2.0 and firm.retailer 0.2.0)

**Source:** `participants/src/behaviour/firms.ts` (`WindingUp`), used by factories and shops. Insolvency is a legal idea and winding up is a process. Both are content, done by the firm's own module here, as a company's directors or a voluntary liquidation would. Nothing in the kernel knows a firm has failed.

## Debts

A debt is a claim recorded against a firm: the holder's right to be paid (`claim`, a right, `about.kind` debt or fine). Debts arise:
- **when a loan goes into default:** the bank records what's owing (docs/behaviour/credit.md);
- **when wages go unpaid:** a worker whose pay hasn't come for a pay period plus five days resigns and records the wages owed (citizen 0.12.0). Unpaid workers are creditors, as they are in law.

A trading firm pays the debts recorded against it, oldest first, while it can do so and keep the next pay period's wages. If it owes more than it has, it asks its bank for the difference.

## Insolvency

A firm is **insolvent** when it can't pay its debts as they fall due (after the test in Australia's Corporations Act 2001, s 95A; a general idea in company law). Here that means either:
- it's in default on a loan; or
- debts recorded against it have gone unpaid for `short_days` (60, a placeholder), it owes more than it has, and it has no credit to be had (refused, or it can't apply).

A firm with stock it can still sell isn't insolvent while that stock pays its debts.

## Winding up

Insolvent, the firm:
1. says so publicly (`insolvency`), withdraws its price lists, and lets everyone go with the notice their contracts give;
2. stops hiring, buying and making, and sells what it has (a shop serves its queue from stock; a factory fills orders and ships under its export share);
3. after `wind_up_days` (60, a placeholder), pays what it owes from what it has: debts recorded against it, oldest first; then what's left on its loans, which fall due at once. It stops its loan repayments, passes anything left to its shareholders by their shares, and publishes its `closure` (what went to creditors and to shareholders);
4. then does nothing more.

**Who loses:** creditors in the order it pays, and shareholders last. When a firm fails with little cash, its workers' unpaid wages are mostly lost. In Australia a government scheme (the Fair Entitlements Guarantee) pays some of them; a world could give that to the outside world's support payments.

**Leaves out:**
- an external administrator taking control (the firm winds itself up);
- selling its premises and equipment, which comes with entry (stage C3b: a new firm buys a closed firm's premises);
- priority rules beyond oldest first;
- a court.
