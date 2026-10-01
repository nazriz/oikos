-- Word of mouth (D45), per run: people asking around, tips naming a building, and the move-ins and hires that followed a tip naming that building.
with sent as (select run_id, t, participant, text, re, unnest("to") as recipient from messages),
asks as (select run_id, count(distinct (t, participant, text)) filter (where text like 'I''m looking for somewhere%') as home, count(distinct (t, participant, text)) filter (where text like 'I''m looking for work%') as work from sent group by run_id),
tips as (
  -- Told: the person written to (a participant written to is its person).
  select s.run_id, s.t, s.re as structure, coalesce(p.person, s.recipient) as told from sent s left join participants p on p.run_id = s.run_id and p.participant = s.recipient
  where s.re is not null and regexp_matches(s.participant, '^c[0-9]+-self$') and s.re not in (select id from records r where r.run_id = s.run_id)),
-- (The first time each came into the building: not each day's coming home or going to work.)
firsts as (select o.run_id, o.occupant, o.structure, o.space_kind, min(o.t) as t from occupancy o where o.event = 'occupied'
  -- (Not the world's own workforce coming in on its first working day: their jobs were agreed before the start.)
  and not exists (select 1 from records a where a.run_id = o.run_id and a.record = 'agreement' and a.template = 'employment' and a.t = 0
    and json_extract_string(a.body, '$.terms.parties[1]') = o.occupant and regexp_extract(a.body::VARCHAR, '"in":"([^"]+)"', 1) = o.space)
  group by all),
arrivals as (
  select o.run_id, o.space_kind, exists (select 1 from tips p where p.run_id = o.run_id and p.told = o.occupant and p.structure = o.structure and p.t <= o.t) as told
  from firsts o where o.t > 0)
select r.run_id, r.seed, a.home as asked_home, a.work as asked_work,
  (select count(*) from tips p where p.run_id = r.run_id) as tips,
  (select count(*) filter (where told) || ' of ' || count(*) from arrivals x where x.run_id = r.run_id and x.space_kind = 'dwelling') as move_ins_after_tip,
  (select count(*) filter (where told) || ' of ' || count(*) from arrivals x where x.run_id = r.run_id and x.space_kind = 'workplace') as hires_after_tip
from runs r left join asks a on a.run_id = r.run_id order by r.world, r.seed
