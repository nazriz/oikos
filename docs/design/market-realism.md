# Market realism: entry, joint draws, hiring (risks ME-1, ME-17, ME-2)

2026-10-24, branch `market-realism`. A short design note written before the code; what was built, and what moved in the
towns, is in docs/decisions.md ("Market realism"). The rule for all three: an outcome comes from a general law of how a
market works (prices, entry by expected profit, people moving between jobs, the cost of searching), never from a rate
that sets it; every figure is a profile's, with its source; every act takes its performer's time.

## ME-1 · Who starts a business, and when

**The stand-in.** A business of one started with a monthly chance (`found_own_ppm`) derived from the profile's business
birth rate on the town's businesses; a shop in bought premises with a flat 2% a month (`found_bps`). The births were the
profile's whatever the market held. `rules::entry` (expected profit, Cournot-style shares, a hand taken on when the margin
pays) had been written in the port and never called.

**The law.** A person in the labour force weighs, now and then (once a month, as they weigh looking for better work),
starting each venture the town offers against what they have. What they expect the business to leave them is
`rules::entry::expected`, filled only from what they know: the price of its kind on the price lists they have read (the
middle one), what it costs to bring in (a trade price list they hold, else the trade price the world publishes), what a
customer like them buys of it a month (their own orders), the homes in view around them (their neighbourhood, seen by
being there), the sellers they know, what one
person's working day serves, and the going wage (the best posting they have seen). The choice is the mind's, between
the business at that figure and life as it is (their pay, or nothing), as any choice of work is: nothing is started that is
not expected to beat what they have, and the mind's own leanings (the open and the achieving more) weigh in as what it
means to them beyond the money. A shop in bought premises is weighed the same way, staffed by the hands whose margin pays
their wage, up to its room; its founder keeps their job and manages it. **No rate of births anywhere**: the profile's
`business.entry_bps_per_year` becomes a target to compare with.

**What a founder must have**, unchanged: the capital and a month's housing and essentials (a business of one); the price
of the premises, the capital and three months' (a shop). The founder's time is the `entity` call's row in the table of
work. A founder misjudges as people do (they count only the sellers they know: Camerer and Lovallo 1999 on excess entry),
and a business of one that does not pay a living is given up, as before.

**Employing start-ups.** A shop founded in bought premises employs from its first day, and now follows profit. A business
of one taking on its first hand needs a place for the hand to work: a home is the household's, a pitch holds one. Real
small firms lease premises; commercial leasing (an owner who lets premises, at a rent with a source) is a new institution
and a modelling choice the owner should make (reported, not built here: ME-1).

## ME-17 · Who has which income, job and savings, together

**The stand-in.** Who is in the labour force and in work, and how much they have saved, were separate draws per person:
a household's members were in work independently, and savings had nothing to do with pay.

**The law: joint draws from sourced dependence.**
- *Work clusters in households.* Each household has a common factor; each adult of working age is in work, looking, or out
  of the labour force by where a draw that shares that factor falls (a Gaussian copula: each person's chances are exactly
  the profile's, as before). How much is shared is fitted, in the generator, to the profile's share of households with
  someone of working age in which nobody works (the labour force survey's workless-household table: a survey cross-tab).
- *Savings follow pay.* A person's savings are drawn from their age band's distribution, as before, at a rank that leans
  on their pay's rank among the town's adults by the profile's residual rank correlation of income and wealth once age is
  accounted for (Jäntti, Sierminska and Smeeding 2008, Luxembourg Wealth Study: 0.27 to 0.36 in the surveys other than the
  US SCF).
- Left for later, said in the register: one wage per kind of work (who gets the better-paid jobs), and households pooling
  money.

## ME-2 · Hiring that takes time, and matching by trade

**The stand-in.** An employer offered each posting to one applicant drawn at random at its next wake, whatever their
trade; one posting at a time. A 21-day wait was tried and reverted (2026-09-30): with one posting at a time, and a posting
re-published at a new wage starting its wait again, firms could not replace leavers.

**The law.** A posting says how many hands it is for; it stays up until they are hired; re-publishing it at a new wage
keeps the applications already in. The hiring manager judges the applications with their own time: each applicant
considered is interviewed (a paper to them, priced in the table of work with its source), and the post is offered to the
one who fits best: someone who has worked in the posting's trade before anyone who has not, then who applied first. Nobody
is offered a post they were not interviewed for. The time it takes to fill a post is what follows: applicants finding the
posting at their own search's pace, the interviews in the manager's hours, and the notice a worker in a job must give.
No window, no rate of separations: quits are workers finding better-paid work, lay-offs a firm's want of trade.
