-- How much of what happened says why, per run and kind of actor: acts with a reason (the rule that fired, or a model's stated reason), and records made during the run that cite what they rest on (a basis).
with who as (
  select a.*, case when p.controller = 'llm' then a.participant when a."as" is null then 'person' else coalesce(e.kind, a."as") end as who
  from acts a left join participants p on p.run_id = a.run_id and p.participant = a.participant
  left join positions x on x.run_id = a.run_id and x.position = a."as" left join entities e on e.run_id = a.run_id and e.entity = x.entity),
r as (select run_id, count(*) as records, count(*) filter (where basis is not null or record in ('signature', 'notice', 'withdrawal', 'claim_transfer', 'claim_release', 'vote')) as linked from records where t > 0 group by all)
select w.run_id, w.who, count(*) as acts, count(*) filter (where w.reasoning is not null) as with_reason,
  round(100.0 * count(*) filter (where w.reasoning is not null) / count(*), 1) as pct,
  any_value(r.linked) || ' of ' || any_value(r.records) as records_linked_all_actors
from who w left join r on r.run_id = w.run_id group by all order by w.run_id, acts desc
