# Firms that start: entry (citizen.default 0.13.0, firm.retailer 0.2.0)

**Source:** `participants/src/behaviour/citizen.ts` (starting a business), `participants/src/behaviour/retailer.ts` (setting up), `participants/src/behaviour/firms.ts` (`WindingUp.sell`). Founding a business is something a person does, through the same calls as anything else. Nothing in the kernel knows about entry.

## How a business starts

1. **Premises come up for sale.** A closed firm offers its premises (the lot's title, and the building on it) with a public `property_for_sale` statement, at a share of what building them new costs (`premises_sale_bps`, 50%, a placeholder). If they're unsold after `reprice_days` (30), the asking price comes down by `reprice_bps` (10%), and again after as long, until someone buys (placeholders; the way an unsold property's price comes down).
2. **Someone founds a business to buy them.** Once a month, a working-age citizen in the labour force looks at the premises for sale of a kind the world has a *venture* for. The generated town has one venture: a shop. They found a business if all of these hold:
   - they have the savings for the price, plus the venture's capital (wages and stock until sales come in: $50,000, a placeholder), plus a buffer of three months' housing and essentials;
   - they pass the month's chance, `found_bps` (2%, a placeholder to calibrate against business entry rates).
3. **The business is founded.** Founding is the `entity` call: a new organisation, whose first position (Manager) the founder holds. That position has the channels and role module the venture's template gives it. The business's rules run in the position, as a manager follows the shop's routines.
4. **It sets itself up.** The new shop:
   - opens an account at the bank;
   - asks its founder for the capital (`capital_call`), which the founder pays;
   - records its shareholders (the founder, 100%);
   - publishes its purchase of the premises and pays for them.

   The seller transfers the title (its ownership claim) to the first buyer whose purchase is paid in full, and says so (`property_sold`). The proceeds go to what the closed firm still owes, then to its shareholders.

   If someone else buys the premises first, the new shop returns the capital and closes.
5. **It trades.** It then trades like any shop (docs/behaviour/retailer.md): it starts by hiring its minimum staff, stocks up and publishes its price.

## Firms that close without failing

A firm nobody has worked for in `idle_days` (90, a placeholder) is closed by its owners: a voluntary winding up, said publicly (`closing`). The trigger is a firm that can't staff itself, and so can't trade. It then winds up as an insolvent firm does (docs/behaviour/insolvency.md): it pays its debts, passes what's left to its shareholders, closes, and sells its premises.

Most businesses that close in the real world aren't insolvent: their owners stop. Without this rule, a shop that lets each new hire go before payday never runs up unpaid debts, never counts as insolvent, and sits for months with stock and no staff, turning customers away.

## Hiring away from other employers

A new business in a town at full employment can only hire people who already have jobs. Employed citizens look for better-paid work with a month's chance (Lengnick 2013's π, 10%), and move with notice (docs/behaviour/citizen.md). A firm whose posting goes unfilled raises the wage it offers (Lengnick's wage rule) and publishes the posting again at the new wage (docs/behaviour/firms.md). Without both, the first founded shop never hired anyone.

## What the generated town shows

**Almost nobody can found a business.** Working-age people in the generated town hold at most about $38,500 in savings (their household's cash, shared). A shop's premises ask about $365,000. Those with that much are retirees, who don't found businesses. The town's households hold their wealth as cash only: no home equity, no business loans, no commercial leases. So entry happens only where someone of working age has unusual savings. The entry test (`orchestrator/test/entry.test.ts`) gives one person that.

In the real world, most small businesses lease their premises, and founders borrow against their homes. Both need things the platform doesn't have yet:
- **commercial leasing:** a closed firm's premises bought by an investor who lets them;
- **home ownership and mortgages:** the housing sales market held for Naz (docs/decisions.md, C2).

**Revisit when** either arrives, or when calibrating entry rates against the world's business counts (for Australia, ABS 8165.0, *Counts of Australian Businesses*: entries and exits).

## Leaves out

- ventures other than shops (a factory's venture would be a template like the shop's);
- starting from scratch on an empty lot (building premises, which the builder can do, but no venture asks it yet);
- partners and outside investors (the founder is the only shareholder);
- the founder working in their own business (owner-operators): the founder keeps their job, and the shop hires staff.
