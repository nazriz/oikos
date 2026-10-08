-- Who works how, at the end of each run (docs/measurement.md, "Employment"; docs/behaviour/firms.md, "Informal work"): the employed as labour force surveys count them (an hour's work for pay or profit in the run's last seven days, a job held, or a business of one's own in being); of them, those who hold a job with an employer (employees), those with a business of their own (own_account), employees taken on by the day (by_the_day), and employees whose job the employer has not registered (unregistered: counted from each employer's own note, which nobody in the world but that employer sees); informal employment as the ILO defines it for these (own-account workers in unregistered businesses of one, which all of these are, and employees in unregistered jobs) as a share of the employed, to set against a place's informal share of employment; and own-account workers as a share of the employed.
with r as (select run_id, world, seed, end_t from runs),
gone as (select run_id, person, min(t) as t from life where event in ('person_left', 'person_died') group by all),
adults as (select e.run_id, e.entity as person from entities e join r on r.run_id = e.run_id left join gone g on g.run_id = e.run_id and g.person = e.entity
  where e.kind = 'person' and e.created_t <= r.end_t and (g.t is null or g.t > r.end_t) and e.born_at + 18::BIGINT * 365 * 86400 <= r.end_t),
emp as (select a.run_id, a.id, json_extract_string(a.body, '$.terms.parties[0]') as employer, json_extract_string(a.body, '$.terms.parties[1]') as worker,
    (json_extract_string(list_filter(from_json(json_extract(a.body, '$.terms.commitments'), '["JSON"]'), c -> json_extract_string(c, '$.who') = json_extract_string(a.body, '$.terms.parties[0]'))[1], '$.every'))::BIGINT as every,
    (select min(s.t) from records s where s.run_id = a.run_id and s.record = 'signature' and json_extract_string(s.body, '$.agreement') = a.id and s.speaks_for = json_extract_string(a.body, '$.terms.parties[1]')) as signed_t,
    (select min(n.t) from records n where n.run_id = a.run_id and n.record = 'notice' and json_extract_string(n.body, '$.agreement') = a.id) as notice_t
  from records a where a.record = 'agreement' and a.template = 'employment'),
held as (select e.* from emp e join r on r.run_id = e.run_id where e.signed_t <= r.end_t and (e.notice_t is null or e.notice_t > r.end_t)),
off_books as (select run_id, json_extract_string(body, '$.data.agreement') as agreement from records where kind = 'off_books'),
week as (select w.run_id, u.person, sum(w.labour / greatest(w.performers, 1)) as seconds from work w join r on r.run_id = w.run_id, unnest(w.who) as u(person)
  where w.labour > 0 and w.t > r.end_t - 7 * 86400 and w.t <= r.end_t group by all),
own as (select p.run_id, p.person from participants p where p.impl = 'citizen.default' and json_extract_string(p.params, '$.own_work.firm') is not null
  and not exists (select 1 from records c join r on r.run_id = c.run_id where c.run_id = p.run_id and c.kind in ('closing', 'closure') and c.speaks_for = json_extract_string(p.params, '$.own_work.firm') and c.t <= r.end_t)),
status as (select a.run_id, a.person,
    exists (select 1 from held h where h.run_id = a.run_id and h.worker = a.person) as employee,
    exists (select 1 from own o where o.run_id = a.run_id and o.person = a.person) as own_account,
    exists (select 1 from held h where h.run_id = a.run_id and h.worker = a.person and h.every = 86400) as by_the_day,
    exists (select 1 from held h join off_books o on o.run_id = h.run_id and o.agreement = h.id where h.run_id = a.run_id and h.worker = a.person) as unregistered,
    coalesce((select w.seconds >= 3600 from week w where w.run_id = a.run_id and w.person = a.person), false) as worked
  from adults a)
select r.run_id, r.seed,
  count(*) filter (where s.employee or s.own_account or s.worked) as employed,
  count(*) filter (where s.employee) as employees,
  count(*) filter (where s.own_account) as own_account,
  count(*) filter (where s.by_the_day) as by_the_day,
  count(*) filter (where s.unregistered) as unregistered,
  count(*) filter (where s.worked) as worked_in_the_week,
  round(100.0 * count(*) filter (where s.own_account or s.unregistered) / nullif(count(*) filter (where s.employee or s.own_account or s.worked), 0), 1) as informal_employment_pct,
  round(100.0 * count(*) filter (where s.own_account) / nullif(count(*) filter (where s.employee or s.own_account or s.worked), 0), 1) as own_account_pct,
  round(100.0 * count(*) filter (where s.by_the_day) / nullif(count(*) filter (where s.employee), 0), 1) as by_the_day_pct_of_employees,
  round(100.0 * count(*) filter (where s.unregistered) / nullif(count(*) filter (where s.employee), 0), 1) as unregistered_pct_of_employees
from r join status s on s.run_id = r.run_id group by r.run_id, r.seed, r.world order by r.world, r.seed
