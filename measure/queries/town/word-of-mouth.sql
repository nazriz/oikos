-- Word of mouth (D45), per run: people asking around, tips naming a building, and the move-ins and hires that followed a tip naming that building.
with sent as (select run_id, t, seat, text, re, unnest("to") as recipient from messages),
asks as (select run_id, count(distinct (t, seat, text)) filter (where text like 'I''m looking for somewhere%') as home, count(distinct (t, seat, text)) filter (where text like 'I''m looking for work%') as work from sent group by run_id),
tips as (
  select s.run_id, s.t, s.re as structure, se.entity as told from sent s join seats se on se.run_id = s.run_id and se.seat = s.recipient
  where s.re is not null and regexp_matches(s.seat, '^c[0-9]+-seat$') and s.re not in (select id from records r where r.run_id = s.run_id)),
arrivals as (
  select o.run_id, o.slot, exists (select 1 from tips p where p.run_id = o.run_id and p.told = o.occupant and p.structure = o.structure and p.t <= o.t) as told
  from occupancy o where o.event = 'occupied' and o.t > 0)
select r.run_id, r.seed, a.home as asked_home, a.work as asked_work,
  (select count(*) from tips p where p.run_id = r.run_id) as tips,
  (select count(*) filter (where told) || ' of ' || count(*) from arrivals x where x.run_id = r.run_id and x.slot = 'dwelling') as move_ins_after_tip,
  (select count(*) filter (where told) || ' of ' || count(*) from arrivals x where x.run_id = r.run_id and x.slot = 'workplace') as hires_after_tip
from runs r left join asks a on a.run_id = r.run_id order by r.world, r.seed
