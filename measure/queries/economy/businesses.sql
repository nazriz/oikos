-- Business births and deaths, per run, over the last 12 months (docs/behaviour/entry.md, "Starting a business of one"): the businesses there were a year before the end (organisations of the kinds a town's firms are: shops, factories, landlords, a builder, a paper, businesses of one; less those closed by then); births (such organisations made in the year), of which businesses of one; deaths (a closure published in the year: wound up insolvent or idle, never opened, or a business of one given up or left by its owner), of which businesses of one given up; and both as shares of the businesses there were (to set against a place's business birth and death rates: docs/calibration.md). Counted; nothing is scored.
with r as (select run_id, world, seed, end_t, greatest(0, end_t - 365::BIGINT * 86400) as from_t from runs),
b as (select e.run_id, e.entity, e.kind, coalesce(e.created_t, 0) as born_t,
    (select min(x.t) from records x where x.run_id = e.run_id and x.kind = 'closure' and x.speaks_for = e.entity) as closed_t
  from entities e where e.kind in ('shop', 'factory', 'landlord', 'builder', 'firm', 'own_account')),
c as (select b.run_id,
    count(*) filter (where b.born_t <= r.from_t and (b.closed_t is null or b.closed_t > r.from_t)) as businesses,
    count(*) filter (where b.born_t > r.from_t and b.born_t <= r.end_t) as births,
    count(*) filter (where b.born_t > r.from_t and b.born_t <= r.end_t and b.kind = 'own_account') as births_of_one,
    count(*) filter (where b.closed_t > r.from_t and b.closed_t <= r.end_t) as deaths,
    count(*) filter (where b.closed_t > r.from_t and b.closed_t <= r.end_t and b.kind = 'own_account') as deaths_of_one
  from b join r on r.run_id = b.run_id group by all)
select r.run_id, r.seed, coalesce(c.businesses, 0) as businesses, coalesce(c.births, 0) as births, coalesce(c.births_of_one, 0) as births_of_one, coalesce(c.deaths, 0) as deaths, coalesce(c.deaths_of_one, 0) as deaths_of_one,
  round(100.0 * coalesce(c.births, 0) / nullif(c.businesses, 0), 1) as birth_rate_pct, round(100.0 * coalesce(c.deaths, 0) / nullif(c.businesses, 0), 1) as death_rate_pct
from r left join c on c.run_id = r.run_id order by r.world, r.seed
