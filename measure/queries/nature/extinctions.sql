-- Extinctions (nature), per run: which species, and the day. Permanent: nothing brings a species back.
select e.run_id, r.seed, e.body->>'species' as species, e.t // 86400 as day
from events e join runs r using (run_id)
where e.event = 'species_extinct'
order by e.run_id, day
