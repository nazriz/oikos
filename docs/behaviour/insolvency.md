# Firms that fail or close: insolvency and winding up (`WindingUp`, in firm.producer 0.2.0 and firm.retailer 0.2.0)

**Source:** `participants/src/behaviour/firms.ts` (`WindingUp`), used by factories and shops. Insolvency is a legal idea and winding up is a process. Both are content, done by the firm's own module here, as a company's directors or a voluntary liquidation would. Nothing in the kernel knows a firm has failed.

## Debts

A debt is a claim recorded against a firm: the holder's right to be paid (`claim`, a right, `about.kind` debt or fine). Debts arise:
- **when a loan goes into default:** the bank records what's owing (docs/behaviour/credit.md);
- **when wages go unpaid:** a worker whose pay hasn't come for a pay period plus five days resigns and records the wages owed (citizen 0.12.0). Unpaid workers are creditors, as they are in law.

- **when a supplier has delivered goods on its terms and not been paid** (docs/behaviour/trade.md, "Trade credit"): a month after the day it was to be paid, the supplier records the sum as a debt against the buyer;
- **in the firm's own books:** a pay its account could not cover on its day, and redundancy pay owed under the world's law, stand in its wage ledger and are paid late when it can (docs/behaviour/firms.md, "Wages owed"). They are not recorded debts: a worker who leaves and records the wages as a debt turns the ledger's line into one.

A trading firm pays the debts recorded against it, oldest first, while it can do so and keep the next pay period's wages. If it owes more than it has, it asks its bank for the difference. It pays no dividend while a debt recorded against it stands unpaid (2026-10-17).

## Insolvency

A firm is **insolvent** when it can't pay its debts as they fall due (after the test in Australia's Corporations Act 2001, s 95A; a general idea in company law). Here that means either:
- it's in default on a loan; or
- debts recorded against it have gone unpaid for `short_days` (60, a placeholder), it owes more than it has, and it has no credit to be had (refused, or it can't apply).

A firm with stock it can still sell isn't insolvent while that stock pays its debts.

## Closed by its owners

A firm nobody has worked for in `idle_days` (90, a placeholder) is closed by its owners: a voluntary winding up, said publicly (`closing`), then the same steps as below. A firm that lets each hire go before payday runs up no unpaid debts and never counts as insolvent. Without this rule it sat for months with stock and no staff (docs/behaviour/entry.md).

## Winding up

Insolvent, the firm:
1. says so publicly (`insolvency`, or `closing`), withdraws its price lists, and lets everyone go with the notice their contracts give;
2. stops hiring, buying and making, and sells what it has (a shop serves its queue from stock; a factory fills orders and ships under its export share);
3. after `wind_up_days` (60, a placeholder), pays what it owes from what it has, in this order (2026-10-17; no profile states an insolvency order, and this is the usual one: employees, then the tax collector, then other creditors, owners last): wages and redundancy pay owed in its books; the tax withheld from wages and not yet paid over; suppliers on terms; debts recorded against it, oldest first; then what's left on its loans, which fall due at once. It stops its loan repayments, passes anything left to its shareholders by their shares, and publishes its `closure` (what went to creditors and to shareholders);
4. offers its premises for sale (`property_for_sale`), at half what building them new costs (`premises_sale_bps`, a placeholder), coming down 10% a month while unsold (`reprice_days`, `reprice_bps`, placeholders). It sells to the first buyer whose purchase is paid in full, transfers the title, and pays the proceeds to what it still owes, then to its shareholders (docs/behaviour/entry.md);
5. then does nothing more.

**Who loses:** creditors in the order it pays, and shareholders last. When a firm fails with little cash, its workers' unpaid wages are mostly lost. In Australia a government scheme (the Fair Entitlements Guarantee) pays some of them; a world could give that to the outside world's support payments.

**Leaves out:**
- an external administrator taking control (the firm winds itself up);
- selling equipment (only premises are sold);
- priority rules beyond oldest first;
- a court.
