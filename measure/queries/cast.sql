-- The cast, per run: people at the start, births, arrivals and departures across the boundary, deaths by cause, illnesses and injuries begun, harm done, participants created, and appointments made during the run.
select r.run_id, r.seed,
  (select count(*) from entities e where e.run_id = r.run_id and e.kind = 'person' and e.created_t = 0) as people_at_start,
  (select count(*) from life l where l.run_id = r.run_id and l.event = 'person_created' and len(coalesce(l.parents, [])) > 0) as born,
  (select count(*) from life l where l.run_id = r.run_id and l.event = 'person_arrived') as arrived,
  (select count(*) from life l where l.run_id = r.run_id and l.event = 'person_left') as left_world,
  (select coalesce(string_agg(detail || ' ' || n, ', ' order by detail), '') from (select detail, count(*) as n from life l where l.run_id = r.run_id and l.event = 'person_died' group by detail)) as deaths,
  (select count(*) from life l where l.run_id = r.run_id and l.event = 'condition_began' and l.detail = 'illness') as illnesses,
  (select count(*) from life l where l.run_id = r.run_id and l.event = 'condition_began' and l.detail = 'injury') as injuries,
  (select count(*) from life l where l.run_id = r.run_id and l.event = 'harmed') as harmed,
  (select count(*) from participants p where p.run_id = r.run_id and p.created_t > 0) as participants_created,
  (select count(*) from appointments x where x.run_id = r.run_id and x.t > 0) as appointments
from runs r order by r.world, r.seed
