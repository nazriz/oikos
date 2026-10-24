# `firm.producer` (v0.1.0): a factory, after Lengnick (2013)

**Since 0.7.0 (2026-10-11)** the monthly rule for staff is not Lengnick's one-month rule as written below: a factory sets its staff from its trade smoothed over months, holds them through a dip, and lets the most recent hire go only when the surplus has lasted as long as ending the job and hiring again would cost. See [firms.md](firms.md), "Adjusting labour". Prices, wages offered, stock and dividends are as below.

**Seat:** a factory's manager. **Source:** `participants/src/behaviour/producer.ts`.

## What it does

A factory whose workers' hours turn inputs into goods, which it sells wholesale and exports. It wakes daily.

**Making.**
- **Each working day** (5 of every 7), its own employees at the works do the task `make`: as many units as their hours allow (each up to a working day) and its inputs allow.
- **The process** is the factory's own knowledge: `per_unit` inputs and `labour_per_unit` seconds. In the generated town, an item of goods takes 10 kg of inputs and 1.5 hours of work. Where the profile names its main manufacturing industries (`industry.manufacturing`, docs/behaviour/demand.md), some factories make another product (`output`, with its own task `make-<product>`) from an input of its own, which the outside world sells at a price that keeps the product's input share (the unit of inputs is as many as whole numbers carry).
- **When it stops.** When its stock is above the top of Lengnick's band (φ̄ × last month's demand), it makes nothing that day: more stock is no use. The workers are still paid; that's the employer's risk.

**Inputs.**
- **The rule** is an (s, S) rule (Scarf 1960): when inputs held plus inputs on order fall below a month's production at its current staff, it orders up to a month and a half's.
- **Buying** is from its supplier (the world market) at its published price, paid with the order ([trade.md](trade.md)): as much as it can pay for with the next pay period's wages kept aside for the staff it has or is hiring to, as a shop does when it restocks ([retailer.md](retailer.md)); the rest when money comes in. (2026-10-08: until then the whole balance could go on an order, and a works holding a month's inputs spent its payroll on the next half month's.)
- **Money already promised.** An order is paid with a request to its bank, which pays in its own batch, hours later; until then the balance it reads has not fallen. It sets aside what its unpaid orders hold (`Committed`, in `trade.ts`) before it counts what it can spend, and releases it when it sees the payment leave its account (or after three days, if it never does). (2026-10-11: it woke again after each order, read the same balance, and ordered the same 203 inputs 40 times in one day of the 1,000-person town, seed 1, day 72, paying out $20,000 at the bank's next batch and giving two staff notice for want of wages. A works woken once a day would not have noticed.)

**Selling.**
- **Wholesale.** It publishes a wholesale price list (at least `min_order`, 50, to an order) and fills paid orders from stock, refunding what it can't deliver.
- **Exports**, weekly:
  - It keeps stock for its customers: the middle of Lengnick's band of what they ordered last month.
  - It ships the rest to the world market, under its share of the monthly buying offer, and invoices it at the world price.
  - Goods sent back (beyond the month's quantity) don't count as sold.

**Monthly, Lengnick's rules.** A month is 30 days, about 21 working days, as in Lengnick's calibration.
- **Demand** is what customers wanted last month, met or not, as in Lengnick: what they ordered, plus what its export customers would take (its share of the world market's buying offer). Before it has a month's history, a factory counts its share of the buying offer as its demand, so a factory with no staff yet sees demand and starts hiring.
- **Headcount.**
  - Stock below φ = 25% of last month's demand: this month's headcount is one more (up to the works' room), and it posts a job until it's filled.
  - Stock above φ̄ = 100% of demand: it lets the most recent hire go, with their contract's notice.
  - It replaces anyone who leaves, to keep the month's headcount.
- **The wage offered to new hires.**
  - A job posting that has stood unfilled for a month: +U(0, δ), δ = 1.9%.
  - γ = 24 months in a row with every position filled: −U(0, δ).
- **Price.** With probability θ = 75%, by U(0, ϑ), ϑ = 2%:
  - raised if stock is low and the price is under φ̄price = 1.15 × marginal cost;
  - cut if stock is high and the price is over φprice = 1.025 × marginal cost.

  Marginal cost is the inputs at its supplier's prices plus the hours at the hourly wage it offers.
- **Profits.** Out of the month's earnings (what it took in beyond what it paid out that month), what it holds beyond a buffer is paid to its shareholders, in proportion to their shares, from the `shareholders` register (a statement it keeps). The buffer is a month's wages for this month's headcount, plus a month's inputs, plus χ = 10% of the wage bill.

## Inputs bought to what can be sold (2026-10-12)

**The fault.** Inputs were bought for the month the staff *could* make (an (s, S) rule on capacity), not for what could be *sold*: production already stopped at the top of the band of demand, so a works with stock enough bought a month and a half of inputs for nobody. And when the world's input price rose and its goods price fell until a unit lost money before any wage was paid (the fifth pilot's factories: 52 a good before wages, then -9), the works went on buying inputs it sold at a loss, then ran out of cash and shed everyone.

**Now.**
- **A month's making is what the trade expects:** the demand smoothed over months (as for staff), plus what it takes to bring stock to the top of its band, never more than the staff can make. Inputs are bought to that (the (s, S) rule is unchanged, on this month's making).
- **A unit that loses money on its inputs is not made.** Each way a works sells is looked at on its own: orders at home (last month's, at its price) and what the world market would take at its standing offer's price, each against what a unit's inputs cost at the supplier's list now. A channel whose price is under that cost is left out of what the works makes for: it buys inputs only for the rest (the month's making is scaled to the share of its trade that covers its inputs), and with no channel that covers them it buys none, makes from what it holds, takes nobody on for want of stock, and says so once a month. It keeps its people as the labour rule says (they are not let go for a dip in margin any sooner than for a dip in trade). A unit that covers its inputs and not its wages is still made: the wage is owed whatever is made, so the short-run test is price against variable cost.
- Its purchases are on the supplier's terms where it states them ([trade.md](trade.md), "Trade credit"), and it pays the invoice before buying, wages first.

**Where it comes from.** Planning production on a smoothed forecast, not capacity: Holt, Modigliani, Muth and Simon (1960). Producing only while price covers variable cost, the short-run shutdown condition (the textbook theory of the firm; no source sought). **Ours:** that "what a unit fetches" is the weighted mean of what its customers pay at home and abroad on last month's trade.

## Where the rules come from

Lengnick, M. (2013), *Agent-based macroeconomics: a baseline model*, **Journal of Economic Behavior & Organization** 86, 102–120. It's a minimal, well-cited model with individual trading relationships and no auctioneer. The rules above are its firm rules, at its Table 1 calibration.

**Changed from Lengnick, and why:**
- **Inputs.** Lengnick's firms make goods from labour alone. Here goods take inputs too, bought by an (s, S) rule. Factories need inputs (phase B), and fixed coefficients (Leontief) are the input–output tables' own assumption.
- **Hours.** Output follows the hours worked (the kernel's working day), not a fixed λ per worker. So a factory can stop making when stock is above the band. Lengnick's firms produce at capacity whatever their stock.
- **Wages.** Existing contracts keep their wage; only new hires get the wage currently offered. Lengnick pays every worker the firm's current wage. Real employment contracts fix wages, and wages rarely fall mid-contract.
- **Exports.** A buyer outside the town takes goods at a world price, up to the factory's share of a monthly demand ([boundary.md](boundary.md)). Lengnick's economy is closed.
- **The buffer** includes a month's wages and inputs. Lengnick's firms pay wages at the month's end out of the month's sales; here wages go out every fortnight by standing order, and inputs are paid for with the order, both ahead of sales.
- **Dividends out of earnings only.** Lengnick pays out all liquidity above the buffer. Here, a factory with no staff yet (a buffer of nothing) would have paid out all its capital, so payouts are capped at the month's earnings, as dividend practice is.
- **Shareholders.** Lengnick distributes profits to all households in proportion to their wealth. In the generated town a factory is widely held: mostly from outside, and the town's part by the minority of households that hold shares directly (and by a retirement fund, where a town has one) ([firm-ownership.md](firm-ownership.md); until 2026-10-08 every household held a part of every factory). Shares aren't traded yet.
- **Letting go** picks the most recent hire (last in, first out, as redundancy practice usually does). Lengnick picks at random.

## Parameters

- `works`, `workplace` and `max_staff`: its works, the space its workers are in, and the room there.
- `per_unit`, `labour_per_unit`, `task` and `output`: what a unit takes, and what it makes. `labour_per_unit` is what it plans with at first; where workers differ in skill, it learns how long a unit takes this crew (`Pace`, as the shop does: docs/behaviour/retailer.md).
- `supplier` and `market`: whom it buys inputs from, and whose buying offer it exports under.
- `wage` and `period`: the wage offered, per pay period. `price`: its opening wholesale price.
- `working_day` and `work_days`.
- Trade credit and loans: `terms_days` (the days it gives a shop to pay; 0: cash with order), `terms_stop_after_days` (7) and `terms_claim_after_days` (30), `credit` (whether it takes a supplier's terms), `borrow_again_days` (30).
- Credit and closing: `lender`, `min_order`; `short_days` and `wind_up_days` (60 each), `idle_days` (90), `builder`, `premises_sale_bps` (5000), `reprice_days` (30) and `reprice_bps` (1000), as in [insolvency.md](insolvency.md).
- Lengnick's parameters, as basis points: `phi_low_bps`, `phi_high_bps`, `delta_bps`, `gamma_months`, `price_up_bound_bps`, `price_down_bound_bps`, `theta_bps`, `vartheta_bps`, `chi_bps`.

## Leaves out

- **Investment:** the works' room is fixed.
- **Credit** beyond working capital: a factory borrows before letting workers go, and pays debts ([credit.md](credit.md)), but doesn't borrow to invest.
- **Several products.**
- **Stock that deteriorates.**
- **Choosing between suppliers.** There is one supplier, the world market, until the town makes inputs.

## Hours before heads (0.9.0, 2026-10-13)

Over its stock band, a works whose world's law lets an employer cut hours cuts everyone's by one hand's worth before it lets anyone go, and makes in its staff's hours (firms.md, "Hours before heads"). Parameter: `adjust.hours_step_bps` (1,000).

## In the Rust world (integration, 2026-10-18)

The works is the market lane's factory over the firm body of lane C1 (`firms::firm_body`), which is what a works does as an employer, a borrower, a party to a union and a firm that can fail: the staff routine (postings, hires, wage orders, notice, the tax withheld), the employer's side of bargaining (`oikos_rules::bargaining`), loans (`credit::Borrowing`), the everyday-frictions respondent (`frictions::Respondent`, with `orgwants::Org` as its character), winding up. The factory decides what to make, buy and charge, and when its stock calls for another hand or fewer; the body carries out the month's staff decision (`review`: hours before heads, then letting the most recent hire go only once a surplus has lasted what ending the job costs). Systems it takes up for making (0.11.0, automation.md) make their share of the day's units first, within their own day; its people make the rest. What the Rust decides differently from the TS: the wake's steps from the union and the bank come before the systems' paperwork (the TS interleaved them), and the ceiling of the hands the trade needs is taken on the exact ratio of seconds in a month, not on a floor of it.
