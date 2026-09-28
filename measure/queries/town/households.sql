-- Households at the end of each run (as their standing records list them, those still in town): living together or apart, unhoused, and overcrowded by the occupancy standard (CNOS, as statistics offices apply it: bedrooms needed > bedrooms), with the people in overcrowded homes.
with hh as (
  select r.run_id, r.id, json_extract_string(r.body, '$.data.leaseholder') as leaseholder,
    from_json(json_extract(r.body, '$.data.members'), '["JSON"]') as members, from_json(json_extract(r.body, '$.data.couples'), '[["VARCHAR"]]') as couples
  from records r where r.kind = 'household' and not exists (select 1 from records w where w.run_id = r.run_id and w.withdraws = r.id)),
mem as (
  select hh.run_id, hh.id, hh.leaseholder, hh.couples, json_extract_string(m, '$.person') as person, (json_extract_string(m, '$.born_at'))::BIGINT as born_at, json_extract_string(m, '$.sex') as sex
  from hh, unnest(hh.members) as u(m)),
gone as (
  select run_id, person from (select run_id, person, arg_max(event, seq) as ev from life where event in ('person_arrived', 'person_left', 'person_died') group by all)
  where ev in ('person_left', 'person_died')),
lives as (
  select run_id, occupant as person, any_value(space) as space from (
    select run_id, occupant, space, arg_max(event, seq) as ev from occupancy where space_kind = 'dwelling' group by all) where ev = 'occupied' group by all),
here as (
  select m.*, l.space, (r.end_t - m.born_at) // 31536000 as age
  from mem m join runs r on r.run_id = m.run_id left join lives l on l.run_id = m.run_id and l.person = m.person
  where not exists (select 1 from gone g where g.run_id = m.run_id and g.person = m.person)),
agg as (
  select run_id, id, count(*) as people, list(person) as present, any_value(couples) as couples,
    count(distinct space) as homes, count(*) filter (where space is null) as unhoused,
    coalesce(any_value(space) filter (where person = leaseholder), any_value(space)) as home,
    list(person) filter (where age >= 18) as adults,
    count(*) filter (where age < 18 and sex = 'male') as boys, count(*) filter (where age < 18 and sex = 'female') as girls,
    min(age) filter (where age < 18 and sex = 'male') as youngest_boy, min(age) filter (where age < 18 and sex = 'female') as youngest_girl
  from here group by all),
need as (
  select a.*,
    len(list_filter(couples, c -> list_contains(present, c[1]) and list_contains(present, c[2]))) as couples_here,
    s.bedrooms
  from agg a left join spaces s on s.run_id = a.run_id and s.space = a.home),
cnos as (
  select *, case when people = 1 then 0 else
    couples_here + len(list_filter(adults, p -> not list_contains(flatten(list_filter(couples, c -> list_contains(present, c[1]) and list_contains(present, c[2]))), p)))
    + ceil(boys / 2) + ceil(girls / 2)
    - (boys % 2 = 1 and girls % 2 = 1 and youngest_boy < 5 and youngest_girl < 5)::INTEGER end as bedrooms_needed
  from need)
select r.run_id, r.seed,
  count(*) as households, sum(c.people) as people,
  count(*) filter (where c.homes = 1 and c.unhoused = 0) as together,
  count(*) filter (where c.homes > 1) as apart,
  count(*) filter (where c.homes = 0) as unhoused,
  count(*) filter (where c.homes = 1 and c.unhoused > 0) as partly_housed,
  count(*) filter (where c.bedrooms is not null and c.bedrooms_needed > c.bedrooms) as overcrowded,
  sum(c.people) filter (where c.bedrooms is not null and c.bedrooms_needed > c.bedrooms) as people_overcrowded,
  count(*) filter (where c.bedrooms is not null and c.bedrooms - c.bedrooms_needed >= 2) as two_or_more_spare
from runs r join cnos c on c.run_id = r.run_id group by r.run_id, r.seed, r.world order by r.world, r.seed
