-- Gatherings (practices: docs/design/ai-citizens.md 2b), per run, over the last 12 months: the adults in town at the end, the share of them who went to one at least once (calibration target: taking part in a social group, docs/calibration.md), gatherings held (two or more at a hall together) and how many came on average, and the share who went in the last month.
with gone as (select run_id, person, min(t) as t from life where event in ('person_left', 'person_died') group by all),
adults as (select e.run_id, e.entity from entities e join runs r on r.run_id = e.run_id left join gone g on g.run_id = e.run_id and g.person = e.entity
  where e.kind = 'person' and g.t is null and e.born_at + 18::BIGINT * 365 * 86400 <= r.end_t),
went as (select o.run_id, o.occupant, o.t, o.space from occupancy o join runs r on r.run_id = o.run_id
  where o.event = 'occupied' and o.space_kind = 'hall' and o.t >= r.end_t - 365::BIGINT * 86400),
-- (A gathering: people at a hall together. Acts take time (and a person's acts wait for each other), so people get there seconds, minutes or hours apart, not at one instant: a clock hour would cut one gathering in two when its arrivals straddle it, and so would a fixed gap between arrivals, as the evening's main group gets to the hall at 19:00 and someone whose act waited behind others walks in at 20:15 while the group is still there. A gathering is a stretch in which the hall is never empty: it begins with the first to arrive and ends when the last leaves; arrivals during it are its people. Someone who walks into an empty hall and is alone there is a visit, not a gathering: a gathering has two or more people. Where the log does not say when someone left, they are taken to have stayed an hour (the rule before F6). F1, 2026-10-15: people are counted, not arrivals per clock hour; F6, 2026-10-16: presence, not the gap between arrivals.)
stays as (select run_id, space, occupant, t, event, lead(event) over w as next_event, lead(t) over w as next_t
  from (select o.run_id, o.occupant, o.t, o.space, o.event from occupancy o where o.space_kind = 'hall' and o.event in ('occupied', 'vacated')) o
  window w as (partition by run_id, space, occupant order by t, event desc)),
intervals as (select run_id, space, occupant, t, case when next_event = 'vacated' then next_t else t + 3600 end as t_out from stays where event = 'occupied'),
marked as (select w.*, i.t_out, case when w.t <= max(i.t_out) over (partition by w.run_id, w.space order by w.t, w.occupant rows between unbounded preceding and 1 preceding) then 0 else 1 end as fresh
  from went w join intervals i on i.run_id = w.run_id and i.space = w.space and i.occupant = w.occupant and i.t = w.t),
clustered as (select *, sum(fresh) over (partition by run_id, space order by t, occupant rows unbounded preceding) as g from marked),
held as (select run_id, space, g, count(distinct occupant) as n from clustered group by all having count(distinct occupant) >= 2),
counts as (select a.run_id, count(*) as adults,
    count(*) filter (where exists (select 1 from went w where w.run_id = a.run_id and w.occupant = a.entity)) as took_part,
    count(*) filter (where exists (select 1 from went w join runs r on r.run_id = w.run_id where w.run_id = a.run_id and w.occupant = a.entity and w.t >= r.end_t - 30 * 86400)) as last_month
  from adults a group by all)
select r.run_id, r.seed, c.adults, round(100.0 * c.took_part / nullif(c.adults, 0), 1) as took_part_pct,
  round(100.0 * c.last_month / nullif(c.adults, 0), 1) as last_month_pct,
  (select count(*) from held h where h.run_id = r.run_id) as gatherings, (select round(avg(n), 1) from held h where h.run_id = r.run_id) as per_gathering
from runs r left join counts c on c.run_id = r.run_id order by r.world, r.seed
