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
Today's generated towns sell only `goods`, so the rule takes effect when a world offers a second kind: a seller whose
price list names it. Every other kind has its own shop choice, carried money and use, and the world must define a
task `consume-<kind>` for it.

## What it does not do yet

- It adds no kinds of its own. New products are a separate missing law, in the backlog.
- Energy and water are billed by the utilities at a fixed use, not bought by price list, so they are not yet among the
  kinds a household weighs. The survey's energy share is there for when they are.
- The survey figures and elasticities are marked "(to confirm)" in each profile's sources.
  Risk register: ME-18.
