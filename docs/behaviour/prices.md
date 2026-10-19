# How a seller sets its price (`kernel/crates/actors/src/market/prices.rs`)

Written for the Rust world (lane C2, 2026-10-18). It replaces Lengnick's (2013) price rule in `firm.retailer` 0.16.0 and
`firm.producer` 0.10.0 (docs/risks.md ME-16). Lengnick's rule held a price between 1.025 and 1.15 times marginal cost and
moved it 2% on the state of the stock; it made gouging, deep discounting and monopoly pricing impossible by construction,
which a wind tunnel for stewardship cannot afford. Outcomes here emerge from the laws; none is set.

## The rule

Once a month, for a seller that has the chance to look at its price (`theta_bps`, 75% by Lengnick's table: prices are
sticky):

1. **Imbalance.** Demand is what customers ordered and paid for last month, served or not. *Scarcity* is read from the
   seller's own books: units it turned away (out of stock or out of hands), stock below the band (`phi_low_bps` of a
   month's demand), staff who could not serve a month's demand. *Glut* is stock above the band (`phi_high_bps`).
2. **Step.** The price moves with the imbalance, by `price_adjust_bps` (50%) of it, never more than `vartheta_bps` (2%)
   in a month; the size is drawn up to that bound (firms differ in boldness).
3. **Rivals.** A seller that has *seen* what rivals of its kind charge (price lists in its book: its board, what it
   searched, shops it passed; never a census) closes `rival_weight_bps` (25%) of the gap to their median. Scarcity lets it
   stay above rivals and glut lets it stay below: the pull never acts against the imbalance. A shop's rivals are other
   shops; a factory's are other wholesalers and the world market's import list.
4. **Bounds from the market.** No price below marginal cost, except to clear stock beyond `clearance_cover_bps` (three
   months' demand) down to `clearance_floor_bps` (80%) of cost; a price below cost is lifted a step at a time. No rise past
   the usual margin (`price_up_bound_bps`, 115% of cost) unless customers were turned away or rivals charge more: so
   scarcity with no rival to undercut lets a seller charge what the market bears (gouging emerges), and nothing else does.

Parameters keep the TS names (`phi_*`, `theta_bps`, `vartheta_bps`, `price_up_bound_bps`); `price_down_bound_bps` is no
longer used. New, all placeholders (ME-16): `price_adjust_bps`, `rival_weight_bps`, `clearance_cover_bps`, `clearance_floor_bps`,
`rival_days` (60), and for a shop `rivals_board` (what sellers advertise to households; searched monthly).

## Sources (docs/research/references.md)

Calvo (1983) and Blinder et al. (1998) for stickiness and for competitors' prices as a trigger; Lipsey (1960) for price
change proportional to excess demand; Hall and Hitch (1939) for the usual margin over cost; Lazear (1986) and Pashigian
(1988) for clearance sales; Lengnick (2013) for the stock band, the wage rule and the dividend.

## Exports (docs/risks.md ME-15)

The outside world is a price-taker's market. Its monthly offer states the most it will take (not split among sellers) and
the world price; a factory ships what it holds beyond its customers' needs while the world price covers its marginal
cost; the outside pays in arrival order up to its appetite and sends the rest back unpaid; a factory learns its room from
what comes back and probes upward by `export_probe_bps` (10%) when nothing does (`ExportRoom`). A factory the offer never
named exports like an old one. A world may give `demand_elasticity_bps` on a `buys` entry so the appetite falls as the
world price rises (Armington 1969). Boundary doc: boundary.md.

## Rents (docs/risks.md ME-14)

`world.rent_portal` publishes `rental_evidence` (homes let and standing by type and bedrooms) from the public rental
listings and when each came down. The landlord (lane C1) feeds it to `oikos_rules::rent`. `market::rents` reads the same
listings for a landlord that wants its own reading (days on market as the test of an asking rent).

## Evidence over the month, the least change, price points (the cut-over, 2026-10-19)

A seller judges its market on what has built up over the month, not on one count or one customer (ME-20, MT-17):
- **Stock is the month's mean**, a reading at its first wake each day (`StockMeter`), not what is on the shelf at the
  hour of the review, which turns on whether a delivery came just before it and which customers came first.
- **The least change** (`price_least_change_bps`, 1%): a move the evidence asks for that is smaller than this is not
  made; the evidence goes on building until one is worth making (menu costs: Levy et al. 1997; (S, s) pricing:
  Sheshinski and Weiss 1977). A price below cost is still lifted towards it whatever the size.
- **Price points:** a move is made in whole steps of the least change, at least one, never more than `vartheta_bps`
  (prices move between price points, not by the cent: Kashyap 1995; Levy et al. 2011). Two sellers whose evidence
  differs a little set the same price.
- **A clearance says so** on the factory's list (`clearance: { quantity, regular }`), and a rival's clearance is read at
  its regular price (docs/behaviour/sourcing.md).

Measured (au-vic, a year, three seeds): shops' price lists went from about 8 a year to 6 with the month's mean alone;
see the decisions log (2026-10-19, "The cut-over") for the rest.

## Staying with a supplier (integration, 2026-10-18; replaced at the cut-over)

**Replaced, 2026-10-19:** a shop now spreads its restocking across its suppliers (docs/behaviour/sourcing.md);
`supplier_switch_bps` is gone. What follows is the rule as it was.


A shop restocks from the supplier it bought from last unless another is cheaper by more than `supplier_switch_bps`
(default 100: 1% of the price) or its own came up short in the last week. Basis: households in Lengnick (2013,
Table 1) move to a firm only for a price at least 1% lower; buyers face switching costs (Klemperer 1995). The 1% for a
shop's wholesale buying is ME-16's to confirm. Without it, native prices a penny apart sent every shop's whole order
to a different factory each week; factories' trade swung between nothing and tens of thousands of units, they bought
inputs for demand that vanished, and laid people off for want of cash (a gb-eng town at about 10% unemployment).

Before an exporter has learned its room, it plans on the share the outside's offer names for it (the generator's
split, read as a prior), not the whole offer: opened whole to every factory, the first month sent each factory's whole
output abroad and left the shops empty.
