-- Households at the end of each run (as their standing records list them, those still in town): living together or apart, unhoused, and overcrowded two ways, with the people in such homes. By the town's own occupancy standard (the one its people judge a home by: its citizens' `occupancy`, or where the world states none the standard statistics offices commonly apply: two to a bedroom, a room of one's own from 18, the youngest of different sexes sharing under 5): bedrooms needed > bedrooms. And by one yardstick that is the same for every place, so that places compare: more than three people to a room, a home's rooms being its bedrooms and one more.
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
-- (The standard the run's people were given; none given, the common one.)
std as (
  select r.run_id,
    coalesce(max((json_extract_string(p.params, '$.occupancy.per_bedroom'))::BIGINT), 2) as per,
    coalesce(max((json_extract_string(p.params, '$.occupancy.own_from_age'))::BIGINT), 18) as own_age,
    coalesce(max((json_extract_string(p.params, '$.occupancy.mixed_under_age'))::BIGINT), 5) as mixed_age,
    coalesce(bool_or(json_extract_string(p.params, '$.occupancy.living_room_slept_in') = 'true'), false) as living
  from runs r left join participants p on p.run_id = r.run_id and p.impl = 'citizen.default' group by all),
here as (
  select m.*, l.space, (r.end_t - m.born_at) // 31536000 as age, s.per, s.own_age, s.mixed_age, s.living
  from mem m join runs r on r.run_id = m.run_id join std s on s.run_id = m.run_id left join lives l on l.run_id = m.run_id and l.person = m.person
  where not exists (select 1 from gone g where g.run_id = m.run_id and g.person = m.person)),
agg as (
  select run_id, id, count(*) as people, list(person) as present, any_value(couples) as couples,
    count(distinct space) as homes, count(*) filter (where space is null) as unhoused,
    coalesce(any_value(space) filter (where person = leaseholder), any_value(space)) as home,
    list(person) filter (where age >= own_age) as adults,
    coalesce(list(age order by age) filter (where age < own_age and sex = 'male'), []) as boys,
    coalesce(list(age order by age) filter (where age < own_age and sex = 'female'), []) as girls,
    any_value(per) as per, any_value(mixed_age) as mixed_age, any_value(living) as living
  from here group by run_id, id),
need as (
  select a.*,
    len(list_filter(couples, c -> list_contains(present, c[1]) and list_contains(present, c[2]))) as couples_here,
    len(boys) % per as boys_over, len(girls) % per as girls_over,
    s.bedrooms
  from agg a left join spaces s on s.run_id = a.run_id and s.space = a.home),
-- (Those of the age for a room of their own who are not one of a couple here have one; the younger share by sex, the youngest of each left over sharing one room if they fit and are all under the age for it; one room fewer where the living room is slept in.)
standard as (
  select *, case when people = 1 then 0 else greatest(0,
    couples_here + len(list_filter(adults, p -> not list_contains(flatten(list_filter(couples, c -> list_contains(present, c[1]) and list_contains(present, c[2]))), p)))
    + ceil(len(boys) / per) + ceil(len(girls) / per)
    - (boys_over > 0 and girls_over > 0 and boys_over + girls_over <= per and boys[boys_over] < mixed_age and girls[girls_over] < mixed_age)::INTEGER
    - living::INTEGER) end as bedrooms_needed
  from need)
select r.run_id, r.seed,
  count(*) as households, sum(c.people) as people,
  count(*) filter (where c.homes = 1 and c.unhoused = 0) as together,
  count(*) filter (where c.homes > 1) as apart,
  count(*) filter (where c.homes = 0) as unhoused,
  count(*) filter (where c.homes = 1 and c.unhoused > 0) as partly_housed,
  count(*) filter (where c.bedrooms is not null and c.bedrooms_needed > c.bedrooms) as overcrowded,
  sum(c.people) filter (where c.bedrooms is not null and c.bedrooms_needed > c.bedrooms) as people_overcrowded,
  count(*) filter (where c.bedrooms is not null and c.bedrooms - c.bedrooms_needed >= 2) as two_or_more_spare,
  count(*) filter (where c.bedrooms is not null and c.people > 3 * (c.bedrooms + 1)) as over_three_a_room,
  sum(c.people) filter (where c.bedrooms is not null and c.people > 3 * (c.bedrooms + 1)) as people_over_three_a_room
from runs r join standard c on c.run_id = r.run_id group by r.run_id, r.seed, r.world order by r.world, r.seed
