# Firms that start: entry (citizen.default 0.13.0, firm.retailer 0.2.0)

**Source:** `participants/src/behaviour/citizen.ts` (starting a business), `participants/src/behaviour/retailer.ts` (setting up), `participants/src/behaviour/firms.ts` (`WindingUp.sell`). Founding a business is something a person does, through the same calls as anything else. Nothing in the kernel knows about entry.

## How a business starts

1. **Premises come up for sale.** A closed firm offers its premises (the lot's title, and the building on it) with a public `property_for_sale` statement, at a share of what building them new costs (`premises_sale_bps`, 50%, a placeholder). If they're unsold after `reprice_days` (30), the asking price comes down by `reprice_bps` (10%), and again after as long, until someone buys (placeholders; the way an unsold property's price comes down).
2. **Someone founds a business to buy them.** Once a month, a working-age citizen in the labour force looks at the premises for sale of a kind the world has a *venture* for. The generated town has one venture: a shop. They found a business if all of these hold:
   - they have the savings for the price, plus the venture's capital (derived from the town's own figures: a month's stock at the wholesale price and three months' wages for a shop's opening staff, until customers find it: about $91,000 in the generated town), plus a buffer of three months' housing and essentials;
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

## A person working for themself (2026-10-09; profile-depth item 1, part c: the opening state)

**In the real world.** An own-account worker has no employer and no employees: a stall, a kiosk at the door, a round of goods bought in the morning and sold by night. The enterprise is not separate in law from its owner (a household unincorporated enterprise, in the national accounts' words); what it clears is the owner's income. Every place has it; where formal jobs are few it is most of the work there is (docs/research/references.md: ILO; La Porta and Shleifer 2014 on such firms staying small).

**What it is here: the business mechanism that exists, run by its owner.** No new kind of trader. It is an organisation with one position (Owner), held by the person's own participant, running a shop's rules (`firm.retailer`, [retailer.md](retailer.md)) with `operator` set:

| | A shop | A business of one |
|---|---|---|
| **Who serves** | its staff, at its premises' workplace | its owner, alone, where they work from; a working day's hours, as anyone's |
| **Staff** | hired to what its sales need | none: it posts no job and takes nobody on |
| **Where** | premises it owns | a room of the owner's home, or a pitch in a market the town keeps (it owns neither) |
| **The task** | `serve`, set in a workplace | `sell`: the same time an item, set in no kind of space |
| **Stock** | Lengnick's band of a month's sales, looked at weekly | the same band of `stock_days` of sales (seven, unless the profile says), looked at daily: it buys when it runs low; never less than a supplier's least order when it buys |
| **Suppliers** | the world market and the factories it finds advertising to the trade | the same, on the same terms: a wholesaler's least order binds it |
| **Price** | Lengnick's rule, monthly | the same (its owner's hour valued at a shop hand's wage, for the bounds) |
| **What it clears** | to its shareholders at the month's end, out of the month's earnings | to its owner every pay period: whatever it holds beyond the money for its stock (the top of its band or a supplier's least order, at today's price and a tenth over) |
| **When its owner moves home** | | worked from home, it goes with them: the owner tells it (`trading_from`), it takes its stock there and puts its prices up there. With no home, its prices come down and orders are refunded until there is one |
| **When its owner leaves town** | | it finds it cannot be worked (the world says its owner is not there), refunds what it had not served, pays what it holds to its owner's account and says it has closed |
| **Tax** | withholds from its staff | none: nobody is on its payroll, and nothing in the town taxes a trader's takings |

Its customers find it as they find a shop: its prices are put up where it trades (the cell of the home or of the market), seen by those who live and work near, and found by anyone who looks through what sellers advertise. They order, pay with the order, and are served and delivered to as by a shop ([retailer.md](retailer.md), [citizen.md](citizen.md)). Earnings are not a figure anywhere: a trader clears the margin on what households buy from them, and more traders share the same custom.

**Verified before building** (the design had read both from the contract and tried neither; `kernel/tests/cast.rs`, `a_person_works_alone_in_their_own_business_at_home_or_at_a_pitch`): a person performs a task of a business in which they hold the only position, with their own hours; a task that names no kind of space is done in a dwelling; a task set `in` a kind of space the world's catalogue names (a pitch) is done there and refused at home; a task set in a workplace is refused in a dwelling. So the shop's task `serve` could not be used as it stands (it is set in a workplace): the town's catalogue gains the task `sell`, which is world content. No kernel change, no contract change.

**The opening state.** A profile states the share of people in work who work for themselves alone (`employment.own_account.share_bps`) and the kinds, as its survey divides them (`kinds`, shares adding to 10,000), each saying what it does and where from:

- `does: "trade"`: buys goods and sells them to households. **The town holds these.**
- `does: "make"` (home production, a workshop) and `does: "service"` (a ride, a repair, building work sold by the job): **not held yet.** Households here buy goods only, so a ride has no customer, and a business that makes what it sells needs the factory's rules run by one person, which is not built. People of those kinds are drawn as they always were, in jobs with the town's employers: the same misstatement as before, for that part only, and said in the town's description. They are not left without work.
- `from: "home"` (the person's own dwelling) or `"pitch"` (a pitch in the town's market, one each; the market is a building of the town's on a lot of its own, and each holder has the town's leave on record, an agreement of template `pitch`). Someone who was to trade from a home they do not have trades from a pitch.

The generator then: draws that share of people in work into businesses of one; gives each its expected custom (every seller, shop or trader, the same at the start, a trader no more than one person serves; the shops are staffed and funded for the rest); a few days' stock where it trades and the money for one more buying of it (derived; no profile states it); makes its owner its only shareholder; and opens the factories with the staff the smaller employed workforce leaves them, spread evenly.

**The owner** ([citizen.md](citizen.md)): is not out of work (looks at no posting, claims nothing for being out of work); counts as income what the business has paid them (before it has a record, what it was expected to); pays their share of the rent from it; and goes to their pitch in working hours.

**Not here, by decision: who takes this up and when.** The standard accounts (people queue for scarce formal jobs: Harris and Todaro 1970; those who cannot wait work in an easy-entry sector and search less well from it: Fields 1975; much of it is chosen: Maloney 2004) are used for nothing but the opening allocation, which is the survey's share. Starting such a business when out of work, giving it up for a job, closing it when custom fails, a household deciding who does what: all of it is the citizen redesign's (docs/design/ai-citizens.md, Open). So in a run the number of these businesses only falls (an owner dies or leaves town), and nobody new starts one.

**Three faults of the first version, found in the Kenyan towns and fixed** (2026-10-09; none is a figure): a trader at home stayed at the home they started in when their household moved (thousands of refusals, and no sales); a trader looked at their stock once a week, as a shop does, with a week's stock (sold out for days); and one kept exactly a least order's money at the last price paid, so a rise in the world price left them one item short of ever buying again (half had stopped selling by the sixth month).

**Leaves out, besides that:** the kinds above that the town cannot hold; a plot (land worked for food, part eaten); a pitch fee (no place's was sourced; the agreement is where it would be written, and the town's account where it would be paid); buying from the town's shops in small lots; unpaid family help; the business of an owner who dies (their participant ends, and nothing runs the business after: its prices stay up, an order to it is never answered, and its money and stock stay in it; an estate's executor would wind it up, and there is none); the stock of a business whose owner has left town; a trader registering, or being taxed on turnover (docs/behaviour/public-finance.md, "Leaves out").

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
