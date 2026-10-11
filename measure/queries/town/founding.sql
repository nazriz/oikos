-- Founding (docs/behaviour/founding.md), per run, over the whole run: the things people founded (each has a statement of purpose made in the run), by who wrote its words (code, or the composing model); how many people ever joined one, and how many memberships of them were in being at the end; the gatherings and hearings they put up; those that wound up; hall bookings; and a fund's draws asked, paid and refused. Counted; nothing is scored.
with r as (select run_id, world, seed, end_t from runs),
purposes as (select x.run_id, x.speaks_for as org, min(x.t) as t, min(coalesce(json_extract_string(x.body, '$.data.written_by'), 'code')) as written_by from records x where x.t > 0 and x.kind = 'purpose' group by all),
joined as (select a.run_id, json_extract_string(a.body, '$.terms.parties[0]') as org, json_extract_string(a.body, '$.terms.parties[1]') as member, a.id from records a where a.t > 0 and a.record = 'agreement' and a.template = 'membership'),
k as (select x.run_id, x.kind, x.speaks_for, json_extract_string(x.body, '$.data.granted') as granted, (json_extract(x.body, '$.practice') is not null) as gathers from records x where x.t > 0)
select r.run_id, r.seed,
  (select count(*) from purposes p where p.run_id = r.run_id) as founded,
  (select count(*) from purposes p where p.run_id = r.run_id and p.written_by = 'composer') as words_by_composer,
  (select count(distinct j.member) from joined j join purposes p on p.run_id = j.run_id and p.org = j.org where j.run_id = r.run_id) as people_joined,
  (select count(*) from joined j join purposes p on p.run_id = j.run_id and p.org = j.org where j.run_id = r.run_id) as memberships,
  (select count(*) from k join purposes p on p.run_id = k.run_id and p.org = k.speaks_for where k.run_id = r.run_id and k.gathers) as gathering_notices,
  (select count(*) from k join purposes p on p.run_id = k.run_id and p.org = k.speaks_for where k.run_id = r.run_id and k.kind = 'hearing') as hearings,
  (select count(*) from k where k.run_id = r.run_id and k.kind = 'wound_up') as wound_up,
  (select count(*) from k where k.run_id = r.run_id and k.kind = 'hall_booking') as hall_bookings,
  (select count(*) from k where k.run_id = r.run_id and k.kind = 'fund_claim') as draws_asked,
  (select count(*) from k where k.run_id = r.run_id and k.kind = 'fund_decision' and k.granted = 'true') as draws_paid
from r order by r.seed
