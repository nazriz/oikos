# `firm.retailer` (v0.1.0): a shop, after Lengnick (2013)

**Seat:** a shop's manager. **Source:** `participants/src/behaviour/retailer.ts`. Shared rules: [trade.md](trade.md) (orders, payments, delivery notes), `lengnick.ts` (prices, wages, dividends; [producer.md](producer.md)).

## What it does

A shop buys goods wholesale and sells them to households. Selling takes its staff's time. It wakes daily.

**Buying.**
- Weekly, if its stock plus what's on order is below the middle of Lengnick's band of last month's demand (φ, φ̄ = 25%, 100%), it orders up to the top of the band.
- It buys from the cheapest of its suppliers: local factories at wholesale, or the world market's imports. A supplier that came up short in the last week goes to the back.
- It orders at least a supplier's minimum, and only as much as it can pay for while keeping the next pay period's wages aside.

**Selling.**
- It publishes a price list: its price, and where it is (for collection).
- Every paid order joins a queue, oldest first. Each working day (6 of every 7: shops open on Saturdays), its staff at the shop serve the queue.
- Each item is a unit of the task `serve` (1.5 hours in the generated town), shared evenly among the staff there, each up to a working day. What's served goes to the customer: home, or kept at the shop for them.
- A large order can take several days. When the day's hours run out, the rest of the queue waits for tomorrow.
- **Out of stock:** what it couldn't serve is refunded at once, and the customer goes elsewhere.
- **Not served within 3 days:** the rest is refunded.
- **Can't be delivered** (the place or person is gone): the whole order is refunded.
- Every order ends with a delivery note: ordered, delivered, refunded.

**Monthly (Lengnick).**
- **Demand** is what customers ordered and paid for last month, served or not.
- **Price** moves within 1.025–1.15 × marginal cost when stock says so. Marginal cost is the wholesale price last paid plus an item's serving hours at the wage it offers.
- **The wage offered** follows Lengnick's vacancy rule.
- **Headcount** moves one worker a month toward the staff last month's demand needed to serve, planning to fill 80% of their hours (`utilisation_bps`, a placeholder; at least 1, at most the shop's room). Serving can't be stored and orders come in lumps: staff for exactly the average demand leave queues that never clear (Kingman 1961). At 100% (before C6), 17% of the goods ordered in the 200-person town weren't served within three days and were refunded; the unspent refunds showed up as households saving 9–11%, against the 6.5% their rule saves.
- **Restocking keeps back** the next pay period's wages for this month's headcount (the staff it has or is hiring to), so a new shop's first stock doesn't take the wages of its first hire. It also lets someone go if it can't cover the next pay period, and doesn't hire again that month.
- **Dividends:** out of the month's earnings, what it holds beyond a buffer (a month's wages and stock, and χ of the wage bill) goes to its shareholders.

## Where the rules come from

Lengnick (2013) is the model: its firms sell to households who visit them, and its inventory band, price and wage rules are used as in [producer.md](producer.md). What's added, and why:
- **Serving takes staff time.** Selling is work: a shop with no staff sells nothing, and one with few sells slowly. That's phase B's point ("shops would need goods"). The one kind of goods is Lengnick's single consumption good, standing for households' consumption of goods and services apart from housing. So "serving" is the labour of local consumer businesses (retail, food, personal services), not only a till.
- **Headcount follows serving need, not stock.** A shop's staff are there to serve, so staff follow the hours sales need. Stock follows Lengnick's band.
- **Buying from the cheapest supplier** is Lengnick's household rule applied to shops as buyers (they compare prices and switch).

## Parameters

- `premises`, `workplace`, `max_staff` and `min_staff`.
- `serve_task` and `serve_labour`.
- `suppliers`.
- `wage` and `period`; `working_day` and `work_days` (6).
- `price` (its opening price) and `demand` (what it expects to sell in its first month).
- `unpaid_days` (7) and `serve_within_days` (3).
- Credit and closing: `lender`; `short_days` and `wind_up_days` (60 each), `idle_days` (90), `builder`, `premises_sale_bps` (5000), `reprice_days` (30) and `reprice_bps` (1000), as in [insolvency.md](insolvency.md).
- A shop just founded: `founder`, `capital`, `listing` and `bank` ([entry.md](entry.md)).
- Lengnick's parameters, as in [producer.md](producer.md).

## Placeholders (to calibrate in phase B, stage B5)

In the generated town (generator 0.12.0):
- **Serving** takes 1.5 hours an item.
- **Staff:** a shop starts with 3 staff and has room for 6.
- **Prices:** it opens at 1.1 × marginal cost ($86.63).
- **Demand and stock:** it expects 200 items a month and holds 100.

With these, a 200-person town's shops need about 30 staff at full demand. Retail and consumer services are about 30% of jobs in the town, against roughly 35–45% in Australia's workforce (retail, accommodation and food, and other services, with health and education in phase C's services). That's a check, not a target.

## Leaves out

- Opening hours within a day.
- Queues of people at the shop.
- Several goods, or shelf space.
- Credit to customers.
- Choosing among suppliers by anything but price and reliability.
- Shops opening or closing: the number of shops is fixed.
