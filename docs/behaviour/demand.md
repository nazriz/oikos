# Household demand across the goods and services on offer

A household does not spend its whole budget on one thing. Each trip, the citizen (`citizen.default`,
`kernel/crates/actors/src/citizen/money.rs`) divides what it means to spend among the kinds of thing its known sellers
offer, by their prices and by what it needs of each. The rule is `oikos_rules::demand`
(`kernel/crates/rules/src/demand.rs`).

## The rule: the linear expenditure system

Stone (1954) and Geary (1950); Deaton and Muellbauer, *Economics and Consumer Behavior* (1980), ch. 3. Spending on kind
`i`, with budget `B`, today's prices `p`, needs `g` and marginal shares `b` (summing to one):

    e_i = p_i g_i + b_i (B - sum_j p_j g_j)

- **Need first.** What a household needs of each kind is covered first, at today's prices. If the budget does not
  cover every need, each need is met in proportion.
- **Then the marginal shares.** What is left over is divided in fixed marginal shares.
- **What a price fall does.** When one kind gets cheaper, the money freed from its needed part is spread over every
  kind, so spending shifts towards the others. A necessity's share falls when it is cheaper, though more of it is
  bought.
- **What more income does.** A richer household spends its extra money by the marginal shares, not the average ones,
  so a luxury's share rises with income.

## Calibration

Following Frisch (1959) and Lluch, Powell and Williams (1977). The profile's `spending.demand` gives, for each kind, its
average share of household spending in the place's household expenditure survey (`share_bps`) and its income
elasticity (`income_elasticity_bps`). It also gives Frisch's money flexibility (`frisch_bps`, negative: about -2 in
rich countries, larger in poorer ones).

- The marginal shares are `b_i = eta_i w_i`, renormalised to sum to one.
- At the reference budget `B0` and the reference prices `p0`, the need is worth `B0 (w_i - b_i / -phi)`. So at the
  mean budget and the start's prices, spending is the survey's shares exactly.
- The generator writes `reference_budget`: a spender's mean month of spending in the town at the start, from the same
  reckoning that sizes the shops.
- The generator also writes `reference_prices`: the opening retail price of goods.

Shares are renormalised over the kinds on offer to this household. A town whose sellers sell one kind gives that kind
the whole budget, as before the rule; a test asserts this (`with_only_goods_on_offer_the_demand_system_changes_nothing`).
Generated towns sell only `goods` where the spec sets `shop_mix: false` or the profile has no table (below), so the rule takes effect when a world offers a
second kind: a seller whose price list names it. Every other kind has its own shop choice, carried money and use, and the world must define a
task `consume-<kind>` for it.

## A town's mix of shops

A real town does not have one kind of shop. With the generator's `shop_mix` on (a flag of the spec, on unless set false since 2026-10-23), and a profile that has the table, the town's shops
are divided among the kinds of the profile's `spending.demand`, and each sells its kind (`firm.retailer`'s `kind`).

- **The table.** Each kind in `spending.demand.kinds` has its survey `share_bps` and `income_elasticity_bps`, and a kind
  that shops sell has a `seller`: `wholesale_bps` (what the shop pays for a unit, as a share of its price; a service such
  as hairdressing buys little), `labour_bps` (what its staff cost for a unit as a share of the price) and, where counts
  by industry are sourced, `business_share_bps`. Energy has none: the utilities bill it. A profile without a kind besides
  `goods` that has a `seller` keeps the single `goods` town (docs/risks.md, ME-19).
- **How many shops of each kind.** The town's shops are divided by largest remainder: by the kinds' shares of
  businesses where every kind has one, otherwise by their shares of spending. `goods` always keeps one shop.
- **Who works in a shop of each kind, and what they earn.** A kind's `seller.occupation` is the job its shop advertises
  (`firm.retailer`'s `role`), and `seller.wage_vs_shop_bps` its pay as a share of the profile's shop wage
  (`wages_per_pay_period.shop`, the retail trade's), from the place's earnings survey by industry and occupation. Each kind's
  serving is a task of its own, `serve-<kind>` (`serve` for goods), in the world's work table.
- **What a unit is.** Every kind's unit is what the same staff time serves (the profile's `industry.retail_labour_share_bps`
  for goods), so a kind with a larger labour share has a smaller unit and a lower price: price = the cost of that time
  (at the kind's own wage) over the kind's `labour_bps`. A service's unit is a smaller piece of work. `goods` keeps the
  figures it has without a mix.
- **Who sells to the shops.** Each kind has wholesalers of its own in the outside world (`wholesale-<kind>`, a trader at the
  world's price for that kind, the price `wholesale_bps` of the kind's price); `goods` and the factories' inputs are the world
  market's. A shop sees its own kind's wholesaler and the factories' adverts.
- **Who makes what the shops sell.** Where the profile names its main manufacturing industries (`industry.manufacturing`:
  the product's kind, its share of the town's factories, its labour and input shares of its output and the input it uses), some
  factories make that kind (task `make-<kind>`, from the input) and sell it to the shops of the kind; the others make `goods`.
  The world buys each product's surplus, as it buys goods'.
- **Complaints by kind.** `frictions.complaints_by_kind_bps` divides the yearly rate at which what is bought is found
  faulty (`per_adult_bps_per_year.goods`) among the kinds; the opening caseload's complaints are against shops of the kinds
  in those shares. The matter is still `goods` for every kind (the consumer desk hears only that).
- **Sizing.** A shop expects its kind's share of what the town spends (the reckoning that sizes a shop of goods), at
  the kind's price, shared among the shops of the kind; it is staffed, stocked and given working capital from that, as a
  shop of goods is.
- **Using a kind up.** The world's work table has a task `consume-<kind>` for each kind, and a resource of the kind.
- **What stays one kind.** The factories that make no named product make `goods`, which stands for household goods and other
  goods; people trading on their own account sell `goods`. A shop founded in the run sells the kind of the premises it buys (ME-13, ME-19).
- **Who knows what.** A household sees the prices posted at shops near it and looks up others, as before; a kind none of
  its known shops sells gets no spending that trip, and the shares are renormalised over those it can buy.

Tests: `worlds/test/shop-mix.test.ts` and `kernel/tests/c2_shop_mix.rs` (a generated town run 60 days, households buying
five kinds, the same hash on one thread and on fourteen).

## What it does not do yet

- It adds no kinds of its own. New products are a separate missing law, in the backlog.
- Energy and water are billed by the utilities at a fixed use, not bought by price list, so they are not yet among the
  kinds a household weighs. The survey's energy share is there for when they are.
- The survey figures and elasticities are marked "(to confirm)" in each profile's sources.
  Risk register: ME-18, ME-19.
