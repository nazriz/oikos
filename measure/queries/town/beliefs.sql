-- Belief, as people state it (docs/design/ai-citizens.md 5): what someone says they hold when asked how things are ("I hold to what X teaches."), per run and teacher. Of the adults who answered anyone in a quarter, the share who said so, in the first quarter of the run and the last. (Stated belief, as a survey would measure it: code citizens say it once they hold it firmly.)
with answers as (select m.run_id, m.t, m.participant, m.text from messages m where m.text like 'I shop at%' or m.text like 'I work for%' or m.text like 'I go to%' or m.text like 'I hold to%' or m.text = 'Much the same.' or m.text like 'I''m%union.%'),
said as (select run_id, t, participant, unnest(regexp_extract_all(text, 'I hold to what ([^ ]+) teaches\.', 1)) as teacher from answers),
q as (select r.run_id, r.seed, a.participant, case when a.t < 91 * 86400 then 'first' when a.t >= r.end_t - 91 * 86400 then 'last' end as quarter from answers a join runs r on r.run_id = a.run_id),
asked as (select run_id, quarter, count(distinct participant) as n from q where quarter is not null group by all),
held as (select s.run_id, s.teacher, case when s.t < 91 * 86400 then 'first' when s.t >= r.end_t - 91 * 86400 then 'last' end as quarter, count(distinct s.participant) as n
  from said s join runs r on r.run_id = s.run_id group by all)
select r.run_id, r.seed, t.teacher,
  round(100.0 * max(h.n) filter (where h.quarter = 'first') / max(a.n) filter (where a.quarter = 'first'), 1) as first_quarter_pct,
  round(100.0 * max(h.n) filter (where h.quarter = 'last') / max(a.n) filter (where a.quarter = 'last'), 1) as last_quarter_pct
from runs r join (select distinct run_id, teacher from said) t on t.run_id = r.run_id
  left join held h on h.run_id = r.run_id and h.teacher = t.teacher left join asked a on a.run_id = r.run_id and a.quarter = h.quarter
group by all order by r.run_id, t.teacher
