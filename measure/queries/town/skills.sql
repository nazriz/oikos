-- Who could still do each kind of work, and how well (foundations-2 M8; docs/behaviour/skills.md), month by month, where a run has skills by use: for each practised skill, how many living people stand in each tenth of its range (band 0 is from none to a tenth of mastery, band 9 the last tenth: `bands`, ten counts), and how many stand in the upper half. A count of people, not a judgement: what a study reads as "could still do it" is its own choice of band (an ordinary hand's level is the skill's `initial` in the run's config).
select e.run_id, (e.t // 86400) as day, k.key as skill, from_json(k.value, '["BIGINT"]') as bands,
  list_sum(from_json(k.value, '["BIGINT"]')) as people,
  list_sum(list_slice(from_json(k.value, '["BIGINT"]'), 6, 10)) as upper_half
from events e, json_each(json_extract(e.body, '$.skills')) k
where e.event = 'skill_census'
order by e.run_id, skill, e.t
