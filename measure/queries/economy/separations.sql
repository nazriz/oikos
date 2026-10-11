-- Jobs ended, per run, over the last 12 months, by who ended them and why, as the notice on the employment agreement says (docs/behaviour/firms.md, "Adjusting labour"): by the employer for redundancy (there isn't the trade or the work, it makes more than it sells, it cannot cover the wage bill, it is closing), by the worker (moving to another job, leaving town, retiring, unpaid, no work by the day, other), and because the worker died; each as a count, and redundancies and resignations as shares of the people in a job at the end (to set against a place's retrenchment and quit rates: docs/calibration.md). A count of notices: someone given notice who then left town is one redundancy. Nothing is scored.
with r as (select run_id, world, seed, end_t, greatest(0, end_t - 365::BIGINT * 86400) as from_t from runs),
emp as (select a.run_id, a.id, json_extract_string(a.body, '$.terms.parties[0]') as employer, json_extract_string(a.body, '$.terms.parties[1]') as worker,
    coalesce((select min(s.t) from records s where s.run_id = a.run_id and s.record = 'signature' and json_extract_string(s.body, '$.agreement') = a.id and s.speaks_for = json_extract_string(a.body, '$.terms.parties[1]')), 0) as signed_t,
    (select min(n.t) from records n where n.run_id = a.run_id and n.record = 'notice' and json_extract_string(n.body, '$.agreement') = a.id) as notice_t
  from records a where a.record = 'agreement' and a.template = 'employment'),
now as (select e.run_id, count(distinct e.worker) as n from emp e join r on r.run_id = e.run_id where e.signed_t <= r.end_t and (e.notice_t is null or e.notice_t > r.end_t) group by all),
n1 as (select n.run_id, e.employer, e.worker, n.speaks_for as giver, coalesce(json_extract_string(n.body, '$.text'), '') as said, row_number() over (partition by n.run_id, e.id order by n.t, n.id) as k
  from records n join emp e on e.run_id = n.run_id and e.id = json_extract_string(n.body, '$.agreement') join r on r.run_id = n.run_id
  where n.record = 'notice' and n.t > r.from_t and n.t <= r.end_t),
n as (select * from n1 where k = 1),
c as (select run_id,
    count(*) filter (where giver = employer and said like 'Redundancy%') as redundancies,
    count(*) filter (where giver = employer and said like 'Redundancy: there isn''t the%') as no_trade_or_work,
    count(*) filter (where giver = employer and said like 'Redundancy: we''re making%') as over_stock,
    count(*) filter (where giver = employer and said like 'Redundancy: we can''t cover%') as cannot_pay,
    count(*) filter (where giver = employer and said like 'Redundancy%' and said not like 'Redundancy: there isn''t the%' and said not like 'Redundancy: we''re making%' and said not like 'Redundancy: we can''t cover%') as closing_or_other,
    count(*) filter (where giver = employer and said like '%has died%') as died,
    count(*) filter (where giver = worker) as resignations,
    count(*) filter (where giver = worker and said like '%another job%') as to_another_job,
    count(*) filter (where giver = worker and said like 'Leaving town%') as leaving_town,
    count(*) filter (where giver = worker and said like 'Retiring%') as retiring,
    count(*) filter (where giver = worker and said like '%haven''t been paid%') as unpaid,
    count(*) filter (where giver = worker and said not like '%another job%' and said not like 'Leaving town%' and said not like 'Retiring%' and said not like '%haven''t been paid%') as other_resignations
  from n group by all)
select r.run_id, r.seed, coalesce(now.n, 0) as in_a_job, coalesce(c.redundancies, 0) as redundancies, coalesce(c.no_trade_or_work, 0) as no_trade_or_work, coalesce(c.over_stock, 0) as over_stock, coalesce(c.cannot_pay, 0) as cannot_pay, coalesce(c.closing_or_other, 0) as closing_or_other,
  coalesce(c.resignations, 0) as resignations, coalesce(c.to_another_job, 0) as to_another_job, coalesce(c.leaving_town, 0) as leaving_town, coalesce(c.retiring, 0) as retiring, coalesce(c.unpaid, 0) as unpaid, coalesce(c.other_resignations, 0) as other_resignations, coalesce(c.died, 0) as died,
  round(100.0 * coalesce(c.redundancies, 0) / nullif(now.n, 0), 1) as redundancy_pct, round(100.0 * coalesce(c.to_another_job, 0) / nullif(now.n, 0), 1) as moved_job_pct
from r left join now on now.run_id = r.run_id left join c on c.run_id = r.run_id order by r.world, r.seed
