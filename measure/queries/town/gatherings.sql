-- Gatherings (practices: docs/design/ai-citizens.md 2b), per run, over the last 12 months: the adults in town at the end, the share of them who went to one at least once (calibration target: taking part in a social group, docs/calibration.md), gatherings held (with anyone there) and how many came on average, and the share who went in the last month.
with gone as (select run_id, person, min(t) as t from life where event in ('person_left', 'person_died') group by all),
adults as (select e.run_id, e.entity from entities e join runs r on r.run_id = e.run_id left join gone g on g.run_id = e.run_id and g.person = e.entity
  where e.kind = 'person' and g.t is null and e.born_at + 18::BIGINT * 365 * 86400 <= r.end_t),
went as (select o.run_id, o.occupant, o.t, o.space from occupancy o join runs r on r.run_id = o.run_id
  where o.event = 'occupied' and o.space_kind = 'hall' and o.t >= r.end_t - 365::BIGINT * 86400),
-- (A gathering: the arrivals at a hall, each within an hour of the one before. Acts take time, so people get there seconds or minutes apart, not at one instant, and a clock hour would cut one gathering in two when its arrivals straddle it. F1, 2026-10-15: people are counted, not arrivals per clock hour.)
marked as (select *, case when t - lag(t) over (partition by run_id, space order by t) <= 3600 then 0 else 1 end as fresh from went),
clustered as (select *, sum(fresh) over (partition by run_id, space order by t rows unbounded preceding) as g from marked),
held as (select run_id, space, g, count(distinct occupant) as n from clustered group by all),
counts as (select a.run_id, count(*) as adults,
    count(*) filter (where exists (select 1 from went w where w.run_id = a.run_id and w.occupant = a.entity)) as took_part,
    count(*) filter (where exists (select 1 from went w join runs r on r.run_id = w.run_id where w.run_id = a.run_id and w.occupant = a.entity and w.t >= r.end_t - 30 * 86400)) as last_month
  from adults a group by all)
select r.run_id, r.seed, c.adults, round(100.0 * c.took_part / nullif(c.adults, 0), 1) as took_part_pct,
  round(100.0 * c.last_month / nullif(c.adults, 0), 1) as last_month_pct,
  (select count(*) from held h where h.run_id = r.run_id) as gatherings, (select round(avg(n), 1) from held h where h.run_id = r.run_id) as per_gathering
from runs r left join counts c on c.run_id = r.run_id order by r.world, r.seed
