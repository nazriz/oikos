# How a buyer spreads its orders across suppliers (`kernel/crates/actors/src/market/sourcing.rs`)

Written for the Rust world at the cut-over (2026-10-19; docs/risks.md ME-20). A general market law: any buyer that
restocks from several sellers of one good uses it. Today that is the shop (`firm.retailer`); a factory buys its inputs
from the one supplier the world names, so it has nothing to spread.

## Why

Until this law a shop gave its whole restocking to the cheapest supplier it knew (from 2026-10-18, unless its current
one was within 1%). Factories' native prices are a few per cent apart and move monthly, so every shop piled onto
whichever factory was cheapest that month: that factory could fill a few of the orders and the shops it shorted ran out;
the other factories' trade fell to nothing, they made and bought for demand that had gone and let people go. A cobweb
(Ezekiel 1938), and the largest single cause of households going without on the Rust world (docs/decisions.md,
2026-10-19, "The cut-over").

Real retailers multi-source: they split purchases of a good among several suppliers, to keep supply when one falls
short and to keep their suppliers competing (dual and multiple sourcing: Elmaghraby 2000; Burke, Carrillo and Vakharia
2007). Buyers rank price and delivery first among what they weigh (Dickson 1966; Weber, Current and Benton 1991).

## The rule

At each weekly restock a shop below the middle of its band orders up to the band's top, as before, but the order is
split:

1. **Each supplier's attraction** is its delivery record times its price relative to the cheapest, raised to a power:
   `fill × (cheapest / price) ^ supplier_price_power`. The multiplicative attraction form of Bell, Keeney and Little
   (1975)'s market share theorem (Cooper and Nakanishi 1988). A supplier's share of the order is its attraction over the
   sum of all.
2. **A share under the supplier's least order** goes to the others, the least attractive dropped first; if every
   share is under its least, the whole order goes to the most attractive (at least its least).
3. **Each order is paid as before:** cash with the order, or on the supplier's terms where it states them and the shop
   is not behind with it; as many as the shop can pay for, keeping a pay period's wages aside.

**The delivery record** is what share of what was ordered the supplier delivered, over its last deliveries (each new
one weighs `supplier_fill_weight_bps`, 25%). A supplier not ordered from at a restock comes back towards a full record
by `supplier_recover_bps` (12.5%) of the gap: buyers try a supplier again once its failure is old news. A supplier the
shop has no word of has a full record.

**A clearance is weighed at the regular price.** A factory selling below what a unit costs it is clearing stock
(prices.md, "Bounds from the market"). Its list now says so: `clearance: { quantity, regular }`, the stock beyond the top
of its band and what a unit costs it now, the price it returns to once the lot is gone, and its words say "Clearing N at
this price". A shop weighs that supplier at the regular price (it does not move its standing custom for a discount that
lasts one lot) and pays the clearance price on the share it gives it. A rival's clearance is not its going price either:
`rivals_seen` reads the regular price of a list that states one.

Nothing is drawn; everything is integer arithmetic; ties fall to the shop's own order of preference between suppliers
(a fact about it, drawn from its identity) and then the supplier's id.

## Parameters (all placeholders, ME-20)

| Parameter | Default | Meaning |
|---|---|---|
| `supplier_price_power` | 10 | the price elasticity of a supplier's share: a supplier 1% dearer gets about 90% of the cheapest's share, 10% dearer about 39% (to be sourced: no figure for retailers' wholesale buying was found) |
| `supplier_fill_weight_bps` | 2500 | how much a new delivery weighs in the record |
| `supplier_recover_bps` | 1250 | how much of the way back to a full record an unused supplier comes at each restock |

`supplier_switch_bps` (the 1% threshold of 2026-10-18) is gone: the split replaces it.

## Not modelled

Forward buying on a deal (buyers stocking up on a temporary discount: Blattberg and Neslin 1990) is not: a clearance
sells at the pace of the shares it is given. Standing contracts (a fixed quantity a month at a fixed price) are not.
**Revisit if** factories' stock on clearance lingers for months, or a study needs procurement contracts.
