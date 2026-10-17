//! Where a firm enters: the founder's expected profit (docs/behaviour/entry.md, "Entry follows expected profit").
//!
//! Replaces the monthly chance `found_own_ppm` that came from the profile's business birth rate whatever the market
//! held (risks A-1, ME-1). A person starts a business when they expect it to leave them better off than their
//! alternative, judged from what they have seen: the going price and what the goods cost to bring in, how many
//! households they could serve, how many sellers already serve them, what the premises and the labour would cost, and
//! what they earn without it. Nothing here reads the world: the caller (a citizen) fills `Prospect` from its own book
//! and its own household's purchases (no god's view), and everything is integers.
//!
//! What a founder expects (Cournot-style free entry, as Mankiw & Whinston 1986 and Geroski 1995 describe empirically):
//! the market a seller can reach is shared among the sellers there are plus the entrant, so expected sales fall as
//! sellers are known to be there; a business of one serves only as many as one person's time allows; more custom than
//! that needs hired hands, and is worth serving only where the margin on it pays their wage. A business that
//! cannot beat the founder's alternative is not started. Entry responds to the *excess* return, not to a fixed rate
//! (Orr 1974; Siegfried & Evans 1994: net entry rises with profit). The profile's birth rate calibrates the scale of the
//! response, and no more.

use serde::{Deserialize, Serialize};

/// What a would-be founder has seen, per month, in cents and items. Every field is something a person can know by
/// living in a place and looking: none is a register read whole.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Prospect {
    /// The price the goods sell for (seen on the price lists they have read).
    pub price: i64,
    /// What the goods cost them to bring in (the supplier's published price).
    pub unit_cost: i64,
    /// What one household reached buys of this a month (their own household's purchases stand for it).
    pub units_per_household: i64,
    /// Households they could serve (their neighbours and workmates, those within reach).
    pub households_reached: i64,
    /// Sellers they know serve those households.
    pub sellers_known: i64,
    /// Items one person's working time serves in a month.
    pub units_per_worker: i64,
    /// A hired hand's pay a month, as posted jobs show it (0: they would not hire).
    pub wage: i64,
    /// Rent of premises, licence and the like, a month (0: trading from home).
    pub fixed: i64,
    /// What they earn a month otherwise: their pay, or what work like theirs pays.
    pub opportunity: i64,
}

/// What a founder expects of the business.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Expected {
    pub units: i64,
    pub hired: i64,
    /// Margin less fixed costs and hired labour: what is left for the owner, a month.
    pub profit: i64,
}

/// The business as the founder expects it: sales are an equal share among sellers known and themselves, limited by
/// what they can serve, with hands hired for each further `units_per_worker` while the margin on them pays the wage.
pub fn expected(p: &Prospect) -> Expected {
    let margin = (p.price - p.unit_cost).max(0);
    let demand = p.households_reached.max(0).saturating_mul(p.units_per_household.max(0)) / (p.sellers_known.max(0) + 1);
    let alone = p.units_per_worker.max(0);
    let mut units = demand.min(alone);
    let mut hired: i64 = 0;
    if p.wage > 0 && p.units_per_worker > 0 && demand > alone {
        // A hired hand serves their `units_per_worker`; the last one is taken on only if the items they would serve
        // earn more than their pay (the marginal worker pays for themselves).
        loop {
            let more = (demand - units).min(p.units_per_worker);
            if more <= 0 || more.saturating_mul(margin) < p.wage {
                break;
            }
            units += more;
            hired += 1;
        }
    }
    let profit = units.saturating_mul(margin) - p.fixed - hired.saturating_mul(p.wage);
    Expected { units, hired, profit }
}

/// How entry responds, as the world's profile calibrates it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Response {
    /// The monthly chance (parts per million) of a person who could start a business doing so when the excess return
    /// is `reference_bps`: derived from the profile's entry rate (`business.entry_bps_per_year`) on the people who
    /// could start one, as `found_own_ppm` was.
    pub ppm_at_reference: i64,
    /// The excess return over the alternative (basis points) at which entry runs at the profile's rate (a placeholder
    /// to calibrate against how entry varies with margins: Siegfried & Evans 1994 survey).
    pub reference_bps: i64,
    /// The most the chance may be, as a multiple of the reference (basis points; 40,000 = four times).
    pub cap_bps: i64,
}

impl Default for Response {
    fn default() -> Self {
        Response { ppm_at_reference: 0, reference_bps: 5_000, cap_bps: 40_000 }
    }
}

/// The monthly chance (ppm) that this person starts it: nothing unless the business is expected to beat the
/// alternative, rising in proportion to the excess return, to a cap.
pub fn entry_ppm(e: &Expected, opportunity: i64, r: &Response) -> i64 {
    let alt = opportunity.max(1);
    let excess = e.profit - opportunity.max(0);
    if excess <= 0 || e.units <= 0 {
        return 0;
    }
    let excess_bps = (i128::from(excess) * 10_000 / i128::from(alt)).min(i128::from(i64::MAX)) as i64;
    let scaled = i128::from(r.ppm_at_reference) * i128::from(excess_bps.min(r.reference_bps.max(1).saturating_mul(r.cap_bps) / 10_000))
        / i128::from(r.reference_bps.max(1));
    scaled.min(i128::from(i64::MAX)) as i64
}

/// Whether the business takes on its first (or another) hand: the owner alone cannot meet the demand, and the last
/// hand's margin pays them. This is how a start-up comes to employ without any rule saying that it should.
pub fn employs(p: &Prospect) -> bool {
    expected(p).hired > 0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> Prospect {
        Prospect { price: 1_200, unit_cost: 800, units_per_household: 20, households_reached: 50, sellers_known: 4, units_per_worker: 300, wage: 250_000, fixed: 0, opportunity: 200_000 }
    }

    #[test]
    fn expected_sales_are_shared_among_sellers() {
        let few = expected(&Prospect { sellers_known: 1, ..base() });
        let many = expected(&Prospect { sellers_known: 9, ..base() });
        assert!(few.units > many.units);
        assert_eq!(few.units, 500.min(300));
    }

    #[test]
    fn no_profit_no_entry() {
        let p = Prospect { price: 800, ..base() };
        let e = expected(&p);
        assert_eq!(entry_ppm(&e, p.opportunity, &Response { ppm_at_reference: 1_000, ..Default::default() }), 0);
        let crowded = Prospect { sellers_known: 40, ..base() };
        assert_eq!(entry_ppm(&expected(&crowded), crowded.opportunity, &Response { ppm_at_reference: 1_000, ..Default::default() }), 0);
    }

    #[test]
    fn entry_rises_with_the_excess_return_to_a_cap() {
        let r = Response { ppm_at_reference: 1_000, ..Default::default() };
        let low = entry_ppm(&Expected { units: 10, hired: 0, profit: 220_000 }, 200_000, &r);
        let high = entry_ppm(&Expected { units: 10, hired: 0, profit: 260_000 }, 200_000, &r);
        let huge = entry_ppm(&Expected { units: 10, hired: 0, profit: 90_000_000 }, 200_000, &r);
        assert!(0 < low && low < high && high <= huge);
        assert_eq!(huge, 4_000);
    }

    #[test]
    fn a_start_up_employs_when_demand_outruns_one_person_and_the_margin_pays() {
        let strong = Prospect { price: 2_000, households_reached: 400, sellers_known: 1, ..base() };
        assert!(employs(&strong));
        let e = expected(&strong);
        assert!(e.hired >= 1 && e.units > 300);
        // A thin margin does not pay a wage: no hands, however much demand.
        let thin = Prospect { price: 801, ..strong };
        assert!(!employs(&thin));
        // Nobody to hire at no posted wage.
        assert!(!employs(&Prospect { wage: 0, ..strong }));
    }
}
