-- The economy against its calibration targets (docs/calibration.md), per run: at the end, adults, those of working age (below the retirement age its citizens were given) and in the labour force, and people in jobs; employment and participation as shares of adults, and the unemployment rate; over the last 12 months, households' saving (what came into people's accounts less what went out, over what came in).
with r as (select run_id, world, seed, end_t, greatest(0, end_t - 12 * 2592000) as from_t from runs),
ret as (select distinct run_id, (json_extract_string(params, '$.retirement_age'))::INTEGER as age from participants where impl = 'citizen.default' and json_extract_string(params, '$.retirement_age') is not null),
gone as (select run_id, person, min(t) as t from life where event in ('person_left', 'person_died') group by all),
outside_lf as (select run_id, person from participants where impl = 'citizen.default' and json_extract_string(params, '$.in_labour_force') = 'false'),
people as (select e.run_id, e.entity, e.born_at, e.created_t, g.t as gone_t, o.person is not null as outside_lf from entities e left join gone g on g.run_id = e.run_id and g.person = e.entity
  left join outside_lf o on o.run_id = e.run_id and o.person = e.entity where e.kind = 'person'),
at_end as (select r.run_id,
    count(*) filter (where p.born_at + 18 * 365 * 86400 <= r.end_t) as adults,
    count(*) filter (where p.born_at + 18 * 365 * 86400 <= r.end_t and (ret.age is null or p.born_at + ret.age * 365 * 86400 > r.end_t)) as working_age,
    count(*) filter (where p.born_at + 18 * 365 * 86400 <= r.end_t and (ret.age is null or p.born_at + ret.age * 365 * 86400 > r.end_t) and not p.outside_lf) as labour_force
  from r join people p on p.run_id = r.run_id and p.created_t <= r.end_t and (p.gone_t is null or p.gone_t > r.end_t) left join ret on ret.run_id = r.run_id group by all),
jobs as (select o.run_id, sum(case when o.event = 'occupied' then 1 else -1 end) as employed from occupancy o join r on r.run_id = o.run_id where o.t <= r.end_t and o.space_kind = 'workplace' group by all),
person_accounts as (select distinct t.run_id, t."to" as account from transfers t where t."to" like 'acc-c%' union select distinct t.run_id, t."from" from transfers t where t."from" like 'acc-c%'),
flows as (select t.run_id,
    sum(t.amount) filter (where t."to" in (select account from person_accounts pa where pa.run_id = t.run_id) and t."from" not in (select account from person_accounts pa where pa.run_id = t.run_id)) as came_in,
    sum(t.amount) filter (where t."from" in (select account from person_accounts pa where pa.run_id = t.run_id) and t."to" not in (select account from person_accounts pa where pa.run_id = t.run_id)) as went_out
  from transfers t join r on r.run_id = t.run_id where t.t >= r.from_t group by all)
select r.run_id, r.seed, e.adults, e.working_age, e.labour_force, j.employed,
  round(100.0 * j.employed / nullif(e.adults, 0), 1) as employment_to_population_pct,
  round(100.0 * e.labour_force / nullif(e.adults, 0), 1) as participation_pct,
  round(100.0 * greatest(e.labour_force - j.employed, 0) / nullif(e.labour_force, 0), 1) as unemployment_pct,
  round(100.0 * (f.came_in - f.went_out) / nullif(f.came_in, 0), 1) as people_saving_pct
from r left join at_end e using (run_id) left join jobs j using (run_id) left join flows f using (run_id)
order by r.world, r.seed
