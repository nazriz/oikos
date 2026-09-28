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

The choice that matters for results is that nobody gives credit. That keeps a firm's stock and cash physically honest: it can't sell what it doesn't hold, or buy what it can't pay for. Trade credit (invoices after delivery, with payment terms) is how most firm-to-firm trade works in practice, and belongs in a later module. Exports to the outside already work that way (see [boundary.md](boundary.md)).

## Parameters

- `OrderBook(me, unpaid_days = 7)`: how long an order waits for its payment.

## Leaves out

- **Transport.** Goods move at once (D25).
- **Quality, variety and brands.** Each kind is one good.
- **Haggling.** The buyer pays the listed price or doesn't buy.
- **Credit and payment terms**, and payments matched by a reference on the payment itself.
