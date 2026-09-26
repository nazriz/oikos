-- The town's economy, per run: leases and jobs agreed, move-ins and hires, departures, petitions, laws passed, and money paid to the town.
select r.run_id, r.seed,
  (select count(*) from records x where x.run_id = r.run_id and x.t > 0 and x.record = 'agreement' and x.template = 'lease') as leases,
  (select count(*) from records x where x.run_id = r.run_id and x.t > 0 and x.record = 'agreement' and x.template = 'employment') as jobs,
  (select count(*) from occupancy o where o.run_id = r.run_id and o.t > 0 and o.event = 'occupied' and o.slot = 'dwelling') as move_ins,
  (select count(*) from occupancy o where o.run_id = r.run_id and o.t > 0 and o.event = 'occupied' and o.slot = 'workplace') as hires,
  (select count(*) from records x where x.run_id = r.run_id and x.t > 0 and x.kind = 'departure') as departures,
  (select count(*) from records x where x.run_id = r.run_id and x.t > 0 and x.kind = 'petition') as petitions,
  (select count(*) from records x where x.run_id = r.run_id and x.t > 0 and x.kind = 'law') as laws,
  (select count(*) from records x where x.run_id = r.run_id and x.t > 0 and x.record = 'agreement' and x.template = 'construction') as construction,
  (select round(sum(amount) / 100.0) from transfers x where x.run_id = r.run_id and x."to" = 'acc-city') as paid_to_town_usd
from runs r order by r.world, r.seed
