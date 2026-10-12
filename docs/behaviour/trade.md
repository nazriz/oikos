# Trade in goods: price lists, paid orders, delivery notes

**Source:** `participants/src/behaviour/trade.ts` (shared by every module that buys or sells goods). None of this is physics: the kernel only moves goods their holder moves, and money a keeper pays (D20). How these participants do business is content, and a module that trades differently can replace it.

## What it does

**Selling.** A seller publishes a **price list**: a public `price_list` statement whose `data.goods` gives a unit price in cents for each kind it sells, and whose `data.account` says where to pay. Optionally, `data.min_order` gives the least it sells in one order (a wholesaler's; households buy only from sellers without one), and `data.at` says where it is (a shop's premises, where goods are kept for collection). It republishes when its prices change, withdrawing the old list.

**Buying.** A buyer places an **order** and pays for it in the same act: cash with order, as at a till or in an online shop.
- The order is an `order` statement to the seller, seen only by the two of them. Its `data` says what (`kind`), how many (`quantity`), at what unit price (`unit_price`), delivered to whom (`deliver_to`) and where (`at`), and paid from which account (`account`).
- The payment is an ordinary `money(...)` call. If the buyer's bank refuses it or the whole act is refused, nothing is ordered.

**Filling orders.**
- **Matching payments.** The seller sets payments against orders by the account they came from, oldest order first, as a small firm's books reconcile receipts. It doesn't use a reference on the payment: a bank can't vouch for a record it can't see.
- **Paid in full.** Once an order is paid in full, the seller delivers what it can (`goods(...)`), refunds what it couldn't deliver at the price paid, and sends a **delivery note**. The note is a `delivery_note` statement to the buyer, citing the order, with `data: { order, kind, ordered, delivered, refund }`. A shop serves over days, as its staff's hours allow ([retailer.md](retailer.md)).
- **Can't be delivered.** If the delivery is refused because where it was to go, or whom to, is gone (a demolished home), the whole order is refunded.
- **Unpaid.** An order still unpaid after a week is declined, with a note saying so.
- **Money with no order.** Money from a customer (an account that has ordered before) that no order of theirs is waiting for is sent back. That covers a payment made twice, or one that arrived after the order was declined. Money from anyone else is left alone: it is theirs to ask about.

**Buyers** read the delivery notes addressed to them (`Deliveries`), to know what arrived and what is still on order.

## Where the rule comes from

- Cash with order is how retail and most small business-to-business trade settle.
- Reconciling receipts by payer is ordinary small-business bookkeeping.

Cash with order is still how a seller trades unless its world gives it terms (below): it keeps a firm's stock and cash physically honest. Where a world gives terms, a firm buys on them. Exports to the outside already work on invoice (see [boundary.md](boundary.md)).

## Trade credit (2026-10-12)

**The fault.** Every order was paid with the order, so a shop's stock and its wage bill came out of the same account in the same week: a shop spent all but one pay period's wages on stock and could not pay its staff the week after, and a factory's input order drained it to its wage bill. Firm-to-firm trade is not done that way: a supplier ordinarily lets a business pay after the goods are in (Petersen and Rajan 1997; Ng, Smith and Smith 1999: docs/research/references.md, "Trade credit").

**What happens, for a seller that has terms** (`terms_days` on a factory, `world.trade`; set from the profile's `business.trade_credit_days`, and 0 or absent: cash with order, as before):
- Its price list says so (`terms_days`), and its text: "or order on terms and pay within N days of delivery".
- A buyer that takes the terms orders as before but pays nothing with the order (`pay_in_days` on the order). The seller delivers against the promise and its delivery note is the invoice: what was delivered, `owed`, the days to pay, and the account (`pay_to`). A part-delivered order is invoiced for what came, and nothing is refunded (nothing was paid).
- The buyer pays the invoice when it falls due, from the account, **after the wage bill for the staff it keeps** (wages first: they come first in law as in practice), naming the order in the payment's memo (`Invoice <order>: ...`). The seller sets the payment against the order by that memo, never as money for an order waiting (it would be refunded).
- **A supplier unpaid stops supplying on terms.** A buyer more than `terms_stop_after_days` (7, a placeholder) past the day is declined its next order on terms (a delivery note saying `declined: overdue`); it can still buy for cash with the order. A buyer that is behind with a supplier does not ask it for terms either.
- **And may claim the debt.** `terms_claim_after_days` (30, a placeholder) past the day, the seller records the sum as a debt against the buyer (a claim, as a lender's on a default is): from then on it is a debt recorded against a firm in the sense of [insolvency.md](insolvency.md), paid oldest first while the firm keeps the next pay period's wages, grounds for the firm being insolvent if unpaid for `short_days` with no credit to be had, and a claim on what is left when it winds up. The buyer drops its invoice for it (it is paid as the debt, never twice), and the seller supplies it on terms again once the debt is paid.
- **How much a buyer takes on terms.** Nothing in the world limits it, so a buyer limits itself: what it already owes plus the order may not exceed what it expects to take in over the days it is given (a shop: last month's items sold at their cost; a factory: the trade it has, at what a unit fetches) and what it can pay for in cash beyond its wages. This is the buyer's own prudence, **ours, with no source**: sellers set limits, here a seller does not.

**Where it comes from.** Petersen and Rajan (1997) and Ng, Smith and Smith (1999): suppliers lend to the firms that buy from them on terms of a stated number of days, by trade not by price; Cuñat (2007): a supplier that is not paid stops supplying, and so is a creditor with its own means of collection; Wilner (2000): suppliers are lenient with buyers they need. A place's ordinary terms are in its profile with a source; the two profiles that state them (Victoria, Nakuru) give a **placeholder 30 days, to confirm**.

**Not here.** Early-payment discounts ("2/10 net 30"); interest on late invoices; a limit set by the seller; a supplier that sells only against letters of credit; a buyer's invoices to a seat that is not code; the invoices of the builder and landlords (materials remain cash with order).

## Payments that say what they are for (2026-10-12)

The world's order book (and a shop's and a factory's) treated every payment into the account that no invoice named as a payment for an order, and sent it back, as a mistaken payment, when the payer had ordered before and had no order waiting. The outside world's account is a market, a shareholder and the collector of the tax employers withhold; a dividend to it and the tax a factory withheld, each with a memo saying what it was, came back like a payment made in error. In a year of the 1,000-person Victorian town: about 200 such refunds a run, 11.4M of the currency's units, 6.1M of it tax withheld and the rest dividends. **Now** a payment whose memo says it is a dividend or a tax (`Dividend`, `Income tax`, `Tax`) is left alone: the money stays where it was sent. One that says something else or nothing is judged as before: a payment for goods nobody ordered is still returned. After: about 3 refunds a run, 0.4M (the factories' and the shops' own refunds to a buyer whose order they could not meet). A real receivables clerk matches a payment to an invoice by its reference and queries what it cannot match; money from a company to its shareholder is not unallocated cash. Not here: any other role for the world's account (a fee, a levy) named by its memo; the list is the two found.

## Parameters

- `OrderBook(me, unpaid_days = 7)`: how long an order waits for its payment.

## Leaves out

- **Transport.** Goods move at once (D25).
- **Quality, variety and brands.** Each kind is one good.
- **Haggling.** The buyer pays the listed price or doesn't buy.
- **Credit and payment terms** except as above (the builder's materials, households' shopping and everything between a seat and a shop are cash with order). Payments matched by a reference on the payment itself (an invoice is matched by the order named in its memo).
