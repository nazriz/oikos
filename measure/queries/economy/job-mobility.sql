-- Job mobility, per run, over the last 12 months, as a labour force survey counts it: of people in a job at the end, the share who were in a job with another employer at some time in the year before (they changed employer, whoever ended the old job). Those whose first job of the year this is are not movers. Calibration target: the place's job mobility (docs/calibration.md).
with r as (select run_id, world, seed, end_t, greatest(0, end_t - 365::BIGINT * 86400) as from_t from runs),
emp as (select a.run_id, a.id, json_extract_string(a.body, '$.terms.parties[0]') as employer, json_extract_string(a.body, '$.terms.parties[1]') as worker,
    coalesce((select min(s.t) from records s where s.run_id = a.run_id and s.record = 'signature' and json_extract_string(s.body, '$.agreement') = a.id and s.speaks_for = json_extract_string(a.body, '$.terms.parties[1]')), 0) as signed_t,
    (select min(n.t) from records n where n.run_id = a.run_id and n.record = 'notice' and json_extract_string(n.body, '$.agreement') = a.id) as notice_t
  from records a where a.record = 'agreement' and a.template = 'employment'),
now as (select e.run_id, e.worker, arg_max(e.employer, e.signed_t) as employer, max(e.signed_t) as since from emp e join r on r.run_id = e.run_id
  where e.signed_t <= r.end_t and (e.notice_t is null or e.notice_t > r.end_t) group by all),
moved as (select n.run_id, n.worker from now n join r on r.run_id = n.run_id
  where n.since > r.from_t and exists (select 1 from emp o where o.run_id = n.run_id and o.worker = n.worker and o.employer <> n.employer and o.signed_t < n.since and (o.notice_t is null or o.notice_t > r.from_t)))
select r.run_id, r.seed, (select count(*) from now n where n.run_id = r.run_id) as in_a_job,
  (select count(*) from moved m where m.run_id = r.run_id) as changed_employer,
  round(100.0 * (select count(*) from moved m where m.run_id = r.run_id) / nullif((select count(*) from now n where n.run_id = r.run_id), 0), 1) as job_mobility_pct
from r order by r.world, r.seed
