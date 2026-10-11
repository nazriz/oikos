-- The town's economy, per run: leases and jobs agreed, move-ins and hires, departures, petitions, laws passed, and money paid to the town (in the world's currency, in whole units).
select r.run_id, r.seed,
  (select count(*) from records x where x.run_id = r.run_id and x.t > 0 and x.record = 'agreement' and x.template = 'lease') as leases,
  (select count(*) from records x where x.run_id = r.run_id and x.t > 0 and x.record = 'agreement' and x.template = 'employment') as jobs,
  -- (The first time someone came into a home, or a workplace: not each day's coming home and going to work.)
  -- (Nor someone coming to a gathering held at a home, where people found groups that meet there: docs/behaviour/founding.md.
  -- A home that a gathering is held at counts no first comers after the gathering was put up; whoever lived there came before.)
  (select count(*) from (select occupant, space, min(t) as first from occupancy o where o.run_id = r.run_id and o.event = 'occupied' and o.space_kind = 'dwelling' group by all) x
    where first > 0 and not exists (select 1 from records p where p.run_id = r.run_id and p.t > 0 and p.t <= x.first and json_extract_string(p.body, '$.practice.at') = x.space)) as move_ins,
  -- (Not the world's own workforce coming in on its first working day: their jobs were agreed before the start.)
  (select count(*) from (select occupant, space, min(t) as first from occupancy o where o.run_id = r.run_id and o.event = 'occupied' and o.space_kind = 'workplace' group by all) x
    where first > 0 and not exists (select 1 from (select json_extract_string(a.body, '$.terms.parties[1]') as worker, regexp_extract(a.body::VARCHAR, '"in":"([^"]+)"', 1) as space from records a where a.run_id = r.run_id and a.record = 'agreement' and a.template = 'employment' and a.t = 0) g where g.worker = x.occupant and g.space = x.space)) as hires,
  (select count(*) from records x where x.run_id = r.run_id and x.t > 0 and x.kind = 'departure') as departures,
  (select count(*) from records x where x.run_id = r.run_id and x.t > 0 and x.kind = 'petition') as petitions,
  (select count(*) from records x where x.run_id = r.run_id and x.t > 0 and x.kind = 'law') as laws,
  (select count(*) from records x where x.run_id = r.run_id and x.t > 0 and x.record = 'agreement' and x.template = 'construction') as construction,
  (select round(sum(amount)::DOUBLE / power(10, r.minor_units)) from transfers x where x.run_id = r.run_id and x."to" = 'acc-city') as paid_to_town
from runs r order by r.world, r.seed
