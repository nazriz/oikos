-- Nature's truth (docs/design/world-expansion.md 2), per run and census (every 30 days): each species' count and the cells it's in, and the cells of each cover. The world's own census, which no participant sees: what surveys estimate is in the environment office's reports.
select e.run_id, r.seed, e.t // 86400 as day, s.key as species, (s.value->>'count')::BIGINT as count, (s.value->>'cells')::BIGINT as cells,
  (e.body->'covers'->>'woodland')::BIGINT as woodland_cells, (e.body->'covers'->>'wetland')::BIGINT as wetland_cells, (e.body->'covers'->>'built')::BIGINT as built_cells
from events e join runs r using (run_id), json_each(e.body->'species') s
where e.event = 'nature_census'
order by e.run_id, day, species
