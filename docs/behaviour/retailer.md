# `firm.retailer` (v0.1.0): a shop, after Lengnick (2013)

**Since 0.12.0 (2026-10-11)** the monthly rule for staff is not Lengnick's one-month rule as written below: a shop sets its staff from its trade smoothed over months, holds them through a dip, and lets the most recent hire go only when the surplus has lasted as long as ending the job and hiring again would cost. See [firms.md](firms.md), "Adjusting labour". Prices, wages offered, stock and dividends are as below.

**Seat:** a shop's manager. **Source:** `participants/src/behaviour/retailer.ts`. Shared rules: [trade.md](trade.md) (orders, payments, delivery notes), `lengnick.ts` (prices, wages, dividends; [producer.md](producer.md)).

## What it does

A shop buys goods wholesale and sells them to households. Selling takes its staff's time. It wakes daily.

**Buying.**
- Weekly, if its stock plus what's on order is below the middle of Lengnick's band of last month's demand (φ, φ̄ = 25%, 100%), it orders up to the top of the band.
- It buys from the cheapest of its suppliers: local factories at wholesale, or the world market's imports. A supplier that came up short in the last week goes to the back. Between suppliers at one price it has its own order of preference, drawn once for each from its own randomness (0.8.2, 2026-10-08: by name, every shop in a town ordered from the same factory, which could fill few of the orders).
- It orders at least a supplier's minimum, and only as much as it can pay for while keeping the next pay period's wages aside.

**Selling.**
- It publishes a price list: its price, and where it is (for collection).
- Every paid order joins a queue, oldest first. Each working day (6 of every 7: shops open on Saturdays), its staff at the shop serve the queue.
- Each item is a unit of the task `serve` (1.5 hours in the generated town), shared evenly among the staff there, each up to a working day. What's served goes to the customer: home, or kept at the shop for them.
- A large order can take several days. When the day's hours run out, the rest of the queue waits for tomorrow.
- **Out of stock:** what it couldn't serve is refunded at once, and the customer goes elsewhere.
- **Not served within the days the order is for** (a household's order is for until its next trip; 3 days if it doesn't say): the rest is refunded.
- **Can't be delivered** (the place or person is gone): the whole order is refunded.
- Every order ends with a delivery note: ordered, delivered, refunded.

**Monthly (Lengnick).**
- **Demand** is what customers ordered and paid for last month, served or not.
- **Price** moves within 1.025–1.15 × marginal cost when stock says so. Marginal cost is the wholesale price last paid plus an item's serving hours at the wage it offers. A shop whose staff can't serve last month's demand in a month is short as a firm short of stock is (0.3.0): it may raise its price, and never cuts it while it turns customers away. Lengnick's firms deliver what their labour makes; a shop delivers what its staff's hours serve.
- **The wage offered** follows Lengnick's vacancy rule.
- **Headcount** moves one worker a month toward the staff last month's demand needed to serve, planning to fill 80% of their hours (`utilisation_bps`, a placeholder; at least 1, at most the shop's room). Serving can't be stored and orders come in lumps: staff for exactly the average demand leave queues that never clear (Kingman 1961). At 100% (before C6), 17% of the goods ordered in the 200-person town weren't served within three days and were refunded; the unspent refunds showed up as households saving 9–11%, against the 6.5% their rule saves.
- **Restocking keeps back** the next pay period's wages for this month's headcount (the staff it has or is hiring to), so a new shop's first stock doesn't take the wages of its first hire. It also lets the most recent hire go if it can't cover the next pay period and has no loan to be had (and the next, until it can pay those it keeps), and doesn't hire again that month.
- **Dividends:** out of the month's earnings, what it holds beyond a buffer (a month's wages and stock, and χ of the wage bill) goes to its shareholders (in the generated town its owners, one household or a few, or a company elsewhere: [firm-ownership.md](firm-ownership.md)).

## What a shop knows (0.7.0, 0.8.0; docs/no-god-view.md)

Until 0.8.0 a shop was shown every price list and buying offer in town and was handed every factory as its suppliers.

| | Rule | Source |
|---|---|---|
| **Its own prices** | Put up at its premises (`shopfront`): seen by those within reach, found by those who look (docs/behaviour/citizen.md, "Which shops a household knows"). | — |
| **Whom it is shown** | The price lists of the suppliers the world names for it (the world market) and of the builder (what its premises are worth), and its own. | — |
| **Producers** | At each week's restock it looks through what producers advertise to the trade (`trade_board`: one search, the first `search_limit` (20) lists with a minimum order above one, which is what wholesale is) and whoever it finds there joins its suppliers; it buys from the cheapest, as before. So a factory is found by advertising, a new one too, and a shop's first restock, before any producer has advertised, is from the world market. | Wholesalers send their trade lists to retailers and retailers look for suppliers in trade directories (to confirm: no source opened; the rule narrows what was shown to what the code reads) |
| **A shop just founded** | Looks up the standing listings of the premises it was founded to buy, and any notice of their sale (`sale_board`, `sold_board`, by the building), at each plan until it has bought them or they are gone (none standing at two looks a day apart, and not sold to it). | — |

## Where the rules come from

Lengnick (2013) is the model: its firms sell to households who visit them, and its inventory band, price and wage rules are used as in [producer.md](producer.md). What's added, and why:
- **Serving takes staff time.** Selling is work: a shop with no staff sells nothing, and one with few sells slowly. That's phase B's point ("shops would need goods"). The one kind of goods is Lengnick's single consumption good, standing for households' consumption of goods and services apart from housing. So "serving" is the labour of local consumer businesses (retail, food, personal services), not only a till.
- **Headcount follows serving need, not stock.** A shop's staff are there to serve, so staff follow the hours sales need. Stock follows Lengnick's band.
- **Buying from the cheapest supplier** is Lengnick's household rule applied to shops as buyers (they compare prices and switch).

## Stock on the supplier's terms (2026-10-12)

Weekly, the shop works out how much it can order as before, but where its supplier states terms ([trade.md](trade.md), "Trade credit") and it is not behind with that supplier, it orders **on them**: nothing is paid with the order, the factory's invoice falls due `terms_days` after delivery and is paid then, after the wages. What it may order is what it can pay for in cash beyond a pay period's wages, **plus what it expects to take in over the terms at cost** (last month's items sold, at what a supplier charges), less what it already owes. Stock no longer competes with the wage bill in the week it is bought. `credit: false` turns it off.

## Parameters

- `credit` (take a supplier's terms), `borrow_again_days` (30: another loan this long after the last, as the bank allows: [credit.md](credit.md)).

- `premises`, `workplace`, `max_staff` and `min_staff`.
- `police` and `stocktake_days`: the monthly stocktake. What's there against the books (last count, deliveries in, goods served out); short, a report to the police with its value (docs/behaviour/crime.md).
- `serve_task` and `serve_labour`: the time a sale takes, as the shop plans with it at first. Where workers differ in skill, it learns each worker's pace (`Pace`, common.ts), a crew's being its members' mean (what a unit takes is linear in a crew's mean skill). Refused for lack of time, each in that crew is as much slower as the world's figure says. After work done, each a little quicker (2%) once a week, until a plan doesn't fit. So a slow crew is learned at once and a quick one over weeks, at about one refusal a crew a week (2026-10-01: without it, a slower crew's plan was refused again and again, and a quicker one did less than it could).
- `suppliers`.
- `wage` and `period`; `working_day` and `work_days` (6).
- `price` (its opening price) and `demand` (what it expects to sell in its first month, and what its expectation of trade begins at: retailer 0.14.0; docs/behaviour/firms.md, "When a shop reviews its staff").
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

## Hours before heads (0.15.0, 2026-10-13)

At its month's end a shop with more staff than its smoothed trade needs cuts everyone's hours first, where the world's law lets an employer (firms.md, "Hours before heads"), and lets someone go only for what hours cannot absorb; it serves in its staff's hours (the day's time of a worker on cut hours is the share of the working day). Parameter: `adjust.hours_step_bps` (1,000).

## In the Rust world (integration, 2026-10-18)

The shop is the market lane's retailer over the firm body of lane C1 (`firms::firm_body`): its staff, its dealings with a union, its bank and its creditors, and its closing are the body's; what it buys, charges and serves is the shop's. The month's staff decision is the body's `review` (hours before heads; the most recent hire is let go only when a surplus of hands has lasted what ending the job costs); a shop whose premises were sold to someone else before it opened is told it is closed (`Body::close`) and does nothing more. A debt recorded against it stands in the way of a dividend, and a winding-up pays its staff and the tax withheld from their wages first (0.18.0). Systems it takes up for serving (0.17.0, automation.md) serve their share of each order first. What the Rust decides differently from the TS: the systems' licence paperwork follows the union, bank and staff dealings in a wake (the TS interleaved them); the hands the trade needs are counted on a floor of the seconds in a month.
