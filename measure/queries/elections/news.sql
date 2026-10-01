-- The local paper (docs/behaviour/news.md), per run: editions, items, and items by kind and tone toward the town's government (−1 badly, 0 neither, +1 well).
select n.run_id, x.seed, json_extract_string(n.body, '$.data.kind') as kind, (json_extract_string(n.body, '$.data.tone'))::INTEGER as tone,
  count(*) as items, count(distinct json_extract_string(n.body, '$.data.edition')) as editions
from records n join runs x using (run_id)
where n.kind = 'news'
group by all
order by n.run_id, kind, tone
