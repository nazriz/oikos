-- Refused acts, by run, the kind of entity the seat acts for (language-model seats on their own), and the kernel's refusal code.
select a.run_id, case when s.controller = 'llm' then a.seat else coalesce(s.entity_kind, a.seat) end as who, a.refusal, count(*) as refused, min(a.t) as first_t
from acts a left join seats s on s.run_id = a.run_id and s.seat = a.seat
where not a.applied group by all order by a.run_id, refused desc
