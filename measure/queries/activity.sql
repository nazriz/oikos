-- Acts per run, by the kind of entity the seat acts for (language-model seats on their own), how they were made (direct, call or translator), and how many took effect.
select a.run_id, case when s.controller = 'llm' then a.seat else coalesce(s.entity_kind, a.seat) end as who, count(distinct a.seat) as seats,
  a.via, count(*) as acts, count(*) filter (where a.applied) as applied, count(*) filter (where not a.applied) as refused
from acts a left join seats s on s.run_id = a.run_id and s.seat = a.seat
group by all order by a.run_id, acts desc
