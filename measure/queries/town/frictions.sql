-- Everyday frictions and the venues that hear them (docs/behaviour/frictions.md), per run, over the last 12 months: the papers grievances travelled on, by paper and matter, each as a count and for every 1,000 adults in town at the end. `paper`: request (to the other side), answer (and whether granted), application (to a venue, and which), decision (and the finding), enforcement. Counted; nothing is scored.
with r as (select run_id, world, seed, end_t, greatest(0, end_t - 365::BIGINT * 86400) as from_t from runs),
gone as (select run_id, person, min(t) as t from life where event in ('person_left', 'person_died') group by all),
adults as (select e.run_id, count(*) as n from entities e join r on r.run_id = e.run_id left join gone g on g.run_id = e.run_id and g.person = e.entity
  where e.kind = 'person' and g.t is null and e.born_at + 18::BIGINT * 365 * 86400 <= r.end_t group by all),
p as (select x.run_id, x.kind, x.speaks_for, coalesce(json_extract_string(x.body, '$.data.matter'), json_extract_string(x.body, '$.data.kind')) as matter,
    json_extract_string(x.body, '$.data.finding') as finding, json_extract_string(x.body, '$.data.granted') as granted, json_extract_string(x.body, '$.addressed_to[0]') as first_to
  from records x join r on r.run_id = x.run_id where x.t >= r.from_t and x.t <= r.end_t
    and x.kind in ('review_request', 'remedy_answer', 'application', 'tribunal_application', 'venue_decision', 'tribunal_order', 'enforcement_request', 'repair_order', 'repair_done', 'complaint', 'benefit_decision')),
rows as (select run_id,
    case when kind = 'review_request' then 'request' when kind = 'remedy_answer' then 'answer: ' || (case when granted = 'true' then 'yes' else 'no' end)
      when kind in ('application', 'tribunal_application') then 'application to ' || coalesce(first_to, '?')
      when kind in ('venue_decision', 'tribunal_order') then 'decision by ' || coalesce(speaks_for, '?') || ': ' || coalesce(finding, '?')
      when kind = 'enforcement_request' then 'enforcement asked' when kind = 'benefit_decision' then 'support claim ' || (case when granted = 'true' then 'granted' else 'refused' end) else kind end as paper,
    case when kind in ('enforcement_request', 'repair_order', 'repair_done', 'complaint', 'benefit_decision') then '' else coalesce(matter, '') end as matter
  from p)
select r.run_id, r.seed, w.paper, w.matter, count(*) as n, round(1000.0 * count(*) / nullif(max(a.n), 0), 1) as per_1000_adults
from rows w join r on r.run_id = w.run_id left join adults a on a.run_id = r.run_id group by all order by r.seed, w.paper, w.matter
