-- Belief, as people state it (docs/design/ai-citizens.md 5), per run and teacher: of the adults who answered anyone asking how they are in a quarter, the share who said they hold to what it teaches, or lean towards it ("affiliated", as a census asks), and the share who hold to it firmly; in the first quarter of the run and the last, and the change in affiliation a year between them (calibration targets: the world's profile, `targets`).
with answers as (select m.run_id, m.t, m.participant, m.text from messages m
  where m.text like 'I shop at%' or m.text like 'I work for%' or m.text like 'I go to%' or m.text like 'I hold to%' or m.text like 'I lean towards%' or m.text = 'Much the same.' or m.text like 'I''m%union.%'),
said as (
  select run_id, t, participant, unnest(regexp_extract_all(text, 'I hold to what ([^ ]+) teaches\.', 1)) as teacher, true as firm from answers
  union all
  select run_id, t, participant, unnest(regexp_extract_all(text, 'I lean towards what ([^ ]+) teaches\.', 1)) as teacher, false as firm from answers),
quarter as (select a.run_id, a.t, a.participant, case when a.t < 91 * 86400 then 'first' when a.t >= r.end_t - 91 * 86400 then 'last' end as q, r.end_t
  from answers a join runs r on r.run_id = a.run_id),
asked as (select run_id, q, count(distinct participant) as n from quarter where q is not null group by all),
held as (select s.run_id, s.teacher, q.q, count(distinct s.participant) as affiliated, count(distinct s.participant) filter (where s.firm) as firm
  from said s join quarter q on q.run_id = s.run_id and q.participant = s.participant and q.t = s.t where q.q is not null group by all),
t as (select distinct run_id, teacher from said)
select r.run_id, r.seed, t.teacher,
  round(100.0 * max(h.affiliated) filter (where h.q = 'first') / max(a.n) filter (where a.q = 'first'), 1) as affiliated_first_pct,
  round(100.0 * max(h.affiliated) filter (where h.q = 'last') / max(a.n) filter (where a.q = 'last'), 1) as affiliated_last_pct,
  round((100.0 * max(h.affiliated) filter (where h.q = 'last') / max(a.n) filter (where a.q = 'last') - 100.0 * max(h.affiliated) filter (where h.q = 'first') / max(a.n) filter (where a.q = 'first'))
    / greatest((max(r.end_t) - 91 * 86400) / 31536000.0, 0.25), 2) as affiliated_change_per_year,
  round(100.0 * max(h.firm) filter (where h.q = 'first') / max(a.n) filter (where a.q = 'first'), 1) as firm_first_pct,
  round(100.0 * max(h.firm) filter (where h.q = 'last') / max(a.n) filter (where a.q = 'last'), 1) as firm_last_pct
from runs r join t on t.run_id = r.run_id left join held h on h.run_id = r.run_id and h.teacher = t.teacher left join asked a on a.run_id = r.run_id and a.q = h.q
group by all order by r.run_id, t.teacher
