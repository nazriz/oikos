-- The economy against its calibration targets (docs/calibration.md), per run: at the end, adults, those of working age (below the retirement age its citizens were given) and in the labour force, and people in jobs; employment and participation as shares of adults, and the unemployment rate; over the last 12 months, households' saving (what came into people's accounts less what went out, over what came in; people's accounts are those people hold, and wealth moving with people leaving or arriving isn't counted).
with r as (select run_id, world, seed, end_t, greatest(0, end_t - 12 * 2592000) as from_t from runs),
ret as (select distinct run_id, (json_extract_string(params, '$.retirement_age'))::BIGINT as age from participants where impl = 'citizen.default' and json_extract_string(params, '$.retirement_age') is not null),
gone as (select run_id, person, min(t) as t from life where event in ('person_left', 'person_died') group by all),
outside_lf as (select run_id, person from participants where impl = 'citizen.default' and json_extract_string(params, '$.in_labour_force') = 'false'),
people as (select e.run_id, e.entity, e.born_at, e.created_t, g.t as gone_t, o.person is not null as outside_lf from entities e left join gone g on g.run_id = e.run_id and g.person = e.entity
  left join outside_lf o on o.run_id = e.run_id and o.person = e.entity where e.kind = 'person'),
at_end as (select r.run_id,
    count(*) filter (where p.born_at + 18::BIGINT * 365 * 86400 <= r.end_t) as adults,
    count(*) filter (where p.born_at + 18::BIGINT * 365 * 86400 <= r.end_t and (ret.age is null or p.born_at + ret.age * 365 * 86400 > r.end_t)) as working_age,
    count(*) filter (where p.born_at + 18::BIGINT * 365 * 86400 <= r.end_t and (ret.age is null or p.born_at + ret.age * 365 * 86400 > r.end_t) and not p.outside_lf) as labour_force
  from r join people p on p.run_id = r.run_id and p.created_t <= r.end_t and (p.gone_t is null or p.gone_t > r.end_t) left join ret on ret.run_id = r.run_id group by all),
-- (Jobs are employment agreements the worker signed, with no notice on them yet: being at work is only part of a day.)
emp as (select a.run_id, a.id, json_extract_string(a.body, '$.terms.parties[0]') as employer, json_extract_string(a.body, '$.terms.parties[1]') as worker,
    (select min(s.t) from records s where s.run_id = a.run_id and s.record = 'signature' and json_extract_string(s.body, '$.agreement') = a.id and s.speaks_for = json_extract_string(a.body, '$.terms.parties[1]')) as signed_t,
    (select min(n.t) from records n where n.run_id = a.run_id and n.record = 'notice' and json_extract_string(n.body, '$.agreement') = a.id) as notice_t
  from records a where a.record = 'agreement' and a.template = 'employment'),
jobs as (select e.run_id, count(distinct e.worker) as employed from emp e join r on r.run_id = e.run_id
    left join people p on p.run_id = e.run_id and p.entity = e.worker
  where e.signed_t <= r.end_t and (e.notice_t is null or e.notice_t > r.end_t) and (p.gone_t is null or p.gone_t > r.end_t) group by all),
person_accounts as (select distinct a.run_id, a.account, a.holder, l.t as left_t, ar.t as arrived_t from accounts a join entities e on e.run_id = a.run_id and e.entity = a.holder and e.kind = 'person'
  left join (select run_id, person, min(t) as t from life where event = 'person_left' group by all) l on l.run_id = a.run_id and l.person = a.holder
  left join (select run_id, person, max(t) as t from life where event = 'person_arrived' group by all) ar on ar.run_id = a.run_id and ar.person = a.holder),
-- (Not income or spending but wealth moving, as the national accounts treat it: what a leaver's account pays out once they've gone, and what comes in with a newcomer on the day they arrive.)
flows as (select t.run_id,
    sum(t.amount) filter (where ti.account is not null and fi.account is null and not (ti.arrived_t is not null and t.t between ti.arrived_t and ti.arrived_t + 86400)) as came_in,
    sum(t.amount) filter (where fi.account is not null and ti.account is null and not (fi.left_t is not null and t.t >= fi.left_t)) as went_out
  from transfers t join r on r.run_id = t.run_id left join person_accounts ti on ti.run_id = t.run_id and ti.account = t."to" left join person_accounts fi on fi.run_id = t.run_id and fi.account = t."from"
  where t.t >= r.from_t group by all)
select r.run_id, r.seed, e.adults, e.working_age, e.labour_force, j.employed,
  round(100.0 * j.employed / nullif(e.adults, 0), 1) as employment_to_population_pct,
  round(100.0 * e.labour_force / nullif(e.adults, 0), 1) as participation_pct,
  round(100.0 * greatest(e.labour_force - j.employed, 0) / nullif(e.labour_force, 0), 1) as unemployment_pct,
  round(100.0 * (f.came_in - f.went_out) / nullif(f.came_in, 0), 1) as people_saving_pct
from r left join at_end e using (run_id) left join jobs j using (run_id) left join flows f using (run_id)
order by r.world, r.seed
