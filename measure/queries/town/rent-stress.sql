-- Rent against household income at the end of each run (households with a lease and someone earning): the median share, and the share of households paying over 30% of gross income ("rental stress"); and the same share among lower-income renters, as surveys of housing costs report it: renters whose household income is in the lowest two quintiles (lowest 40%) of all the town's households with an income, renters or not. Income is wages under employment agreements still in force, by the pay period each agreement states (work by the day: the day's pay for five days of each seven), and, for someone with a business of their own, what it paid them over the run's last 90 days, by the month; rent is the leaseholder's latest lease. Calibration targets: docs/calibration.md.
with signed as (select distinct json_extract_string(body, '$.agreement') as agreement, run_id from records where record = 'signature'),
noticed as (select distinct json_extract_string(body, '$.agreement') as agreement, run_id from records where record = 'notice'),
agreements as (
  select r.run_id, r.id, r.t, r.template, json_extract_string(r.body, '$.terms.parties[0]') as first, json_extract_string(r.body, '$.terms.parties[1]') as second,
    from_json(json_extract(r.body, '$.terms.commitments'), '["JSON"]') as commitments
  from records r where r.record = 'agreement' and r.template in ('lease', 'employment')
    and (select count(*) from signed s where s.run_id = r.run_id and s.agreement = r.id) > 0),
leases as (
  select run_id, second as tenant, arg_max((json_extract_string(list_filter(commitments, c -> json_extract_string(c, '$.who') = second)[1], '$.does.outcome.money.amount'))::HUGEINT, t) as rent
  from agreements where template = 'lease' group by all),
jobs as (
  select a.run_id, a.second as worker,
    sum((json_extract_string(list_filter(a.commitments, c -> json_extract_string(c, '$.who') = a.first)[1], '$.does.outcome.money.amount'))::HUGEINT * 2592000
      / (json_extract_string(list_filter(a.commitments, c -> json_extract_string(c, '$.who') = a.first)[1], '$.every'))::BIGINT
      * (case when (json_extract_string(list_filter(a.commitments, c -> json_extract_string(c, '$.who') = a.first)[1], '$.every'))::BIGINT = 86400 then 5 else 7 end) / 7) as monthly
  from agreements a where a.template = 'employment' and not exists (select 1 from noticed n where n.run_id = a.run_id and n.agreement = a.id) group by all),
drawn as (
  select p.run_id, p.person as worker, sum(t.amount) / 3 as monthly
  from participants p join runs r on r.run_id = p.run_id join transfers t on t.run_id = p.run_id and t."from" = json_extract_string(p.params, '$.own_work.account') and t.t > r.end_t - 90 * 86400
    join accounts a on a.run_id = t.run_id and a.account = t."to" and a.holder = p.person
  where json_extract_string(p.params, '$.own_work.account') is not null group by all),
hh as (
  select r.run_id, json_extract_string(r.body, '$.data.leaseholder') as leaseholder, from_json(json_extract(r.body, '$.data.members'), '["JSON"]') as members
  from records r where r.kind = 'household' and not exists (select 1 from records w where w.run_id = r.run_id and w.withdraws = r.id)),
people as (select hh.run_id, hh.leaseholder, json_extract_string(m, '$.person') as person from hh, unnest(hh.members) as u(m)),
income as (
  select p.run_id, p.leaseholder, sum(coalesce(j.monthly, 0) + coalesce(d.monthly, 0)) as monthly
  from (select distinct run_id, leaseholder, person from people) p left join jobs j on j.run_id = p.run_id and j.worker = p.person
    left join drawn d on d.run_id = p.run_id and d.worker = p.person
  group by all),
shares as (
  select i.run_id, i.leaseholder, le.rent, i.monthly, 100.0 * le.rent / i.monthly as pct
  from income i join leases le on le.run_id = i.run_id and le.tenant = i.leaseholder where i.monthly > 0),
cut as (select run_id, quantile_cont(monthly, 0.4) as lower_cut from income where monthly > 0 group by all)
select r.run_id, r.seed, count(*) as households, round(median(s.pct), 1) as median_rent_pct, round(100.0 * count(*) filter (where s.pct > 30) / count(*), 1) as pct_over_30,
  count(*) filter (where s.monthly <= c.lower_cut) as lower_income_households,
  round(100.0 * count(*) filter (where s.monthly <= c.lower_cut and s.pct > 30) / nullif(count(*) filter (where s.monthly <= c.lower_cut), 0), 1) as lower_income_pct_over_30,
  round(median(s.pct) filter (where s.monthly <= c.lower_cut), 1) as lower_income_median_rent_pct
from runs r join shares s on s.run_id = r.run_id join cut c on c.run_id = s.run_id group by r.run_id, r.seed, r.world order by r.world, r.seed
