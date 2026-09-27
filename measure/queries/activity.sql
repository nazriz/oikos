-- Acts per run, by the kind of entity acted for (a person as themselves, or an organisation's kind through one of its positions; language-model participants on their own), how they were made (direct, call or translator), and how many took effect.
with who as (
  select a.*, case when p.controller = 'llm' then a.participant when a."as" is null then 'person' else coalesce(e.kind, a."as") end as who
  from acts a left join participants p on p.run_id = a.run_id and p.participant = a.participant
  left join positions x on x.run_id = a.run_id and x.position = a."as" left join entities e on e.run_id = a.run_id and e.entity = x.entity)
select run_id, who, count(distinct participant) as participants, via, count(*) as acts, count(*) filter (where applied) as applied, count(*) filter (where not applied) as refused
from who group by all order by run_id, acts desc
