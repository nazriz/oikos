-- Where a household went when it lost its home for arrears (docs/behaviour/justice.md, "Afterwards"; docs/behaviour/households.md, "Taken in during the year"), per run: every tenant who gave a home up on a notice to vacate, on the tribunal's order, or was put out on its warrant (the tenant's own notice on the lease as they go: "Leaving: told to vacate for arrears."), and where the household was at the run's end, by its leaseholder: in a home of its own again (a lease signed after), gone from town, staying in someone's home as their guests (a yes to their asking, and no home of its own or leaving since), or with no dwelling. With how many asked someone to take them in, how many people they asked, and the days from the loss to a roof (someone's, or their own) for those who found one. The last three columns are of everyone in the run who asked to stay, whatever left them without a home (a household without one as the year began asks too): how many asked, how many homes said yes, how many noes. Counted from papers and life events alone; nothing is judged.
with r as (select run_id, seed, end_t from runs),
lost as (select n.run_id, n.speaks_for as tenant, min(n.t) as t0 from records n
  where n.record = 'notice' and json_extract_string(n.body, '$.text') like 'Leaving: told to vacate%' group by all),
leases as (select run_id, id from records where record = 'agreement' and template = 'lease'),
signed as (select s.run_id, s.speaks_for as who, s.t from (select * from records where record = 'signature') s join leases a on a.run_id = s.run_id and a.id = json_extract_string(s.body, '$.agreement')),
yes as (select run_id, t, speaks_for as host, json_extract_string(body, '$.addressed_to[0]') as guest from records where kind = 'stay_answer' and json_extract_string(body, '$.data.yes') = 'true'),
noes as (select run_id, count(*) as n from records where kind = 'stay_answer' and json_extract_string(body, '$.data.yes') = 'false' group by all),
asks as (select run_id, t, coalesce(json_extract_string(body, '$.data.for'), speaks_for) as who, json_extract_string(body, '$.data.for') is null as own from records where kind = 'stay_request'),
gone as (select run_id, person, min(t) as t from life where event in ('person_left', 'person_died') group by all),
x as (select l.run_id, l.tenant, l.t0,
    (select min(s.t) from signed s where s.run_id = l.run_id and s.who = l.tenant and s.t > l.t0) as leased_t,
    (select min(y.t) from yes y where y.run_id = l.run_id and y.guest = l.tenant and y.t >= l.t0) as taken_t,
    (select count(*) from asks q where q.run_id = l.run_id and q.who = l.tenant and q.own and q.t >= l.t0) as asked,
    (select g.t from gone g where g.run_id = l.run_id and g.person = l.tenant and g.t >= l.t0) as gone_t
  from lost l)
select r.run_id, r.seed, count(x.tenant) as lost_home,
  count(*) filter (where x.leased_t is not null) as own_home_again,
  count(*) filter (where x.tenant is not null and x.leased_t is null and x.gone_t is not null) as left_town,
  count(*) filter (where x.leased_t is null and x.gone_t is null and x.taken_t is not null) as staying_with_someone,
  count(*) filter (where x.tenant is not null and x.leased_t is null and x.gone_t is null and x.taken_t is null) as no_dwelling,
  count(*) filter (where x.taken_t is not null) as ever_taken_in,
  count(*) filter (where x.asked > 0) as asked_someone, coalesce(sum(x.asked), 0) as people_asked,
  round(median((least(coalesce(x.leased_t, x.taken_t), coalesce(x.taken_t, x.leased_t)) - x.t0) / 86400.0), 1) as median_days_to_a_roof,
  round(median((r.end_t - x.t0) / 86400.0) filter (where x.leased_t is null and x.gone_t is null and x.taken_t is null), 1) as median_days_with_no_dwelling,
  (select count(distinct q.who) from asks q where q.run_id = r.run_id) as anyone_who_asked,
  (select count(distinct y.host) from yes y where y.run_id = r.run_id) as homes_that_said_yes,
  coalesce((select n.n from noes n where n.run_id = r.run_id), 0) as noes
from r left join x on x.run_id = r.run_id group by all order by r.run_id
