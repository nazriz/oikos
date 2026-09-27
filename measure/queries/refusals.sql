-- Refused acts, by run, the kind of entity acted for (as in activity; language-model participants on their own), and the kernel's refusal code.
with who as (
  select a.*, case when p.controller = 'llm' then a.participant when a."as" is null then 'person' else coalesce(e.kind, a."as") end as who
  from acts a left join participants p on p.run_id = a.run_id and p.participant = a.participant
  left join positions x on x.run_id = a.run_id and x.position = a."as" left join entities e on e.run_id = a.run_id and e.entity = x.entity)
select run_id, who, refusal, count(*) as refused, min(t) as first_t
from who where not applied group by all order by run_id, refused desc
