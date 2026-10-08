-- Pay, what is taken from it, and what is paid to people from outside, per run, over the whole run (in the world's currency, in whole units): wages paid to people under employment agreements (standing wage orders and each day's pay for work by the day; what reached them, after anything withheld); what businesses of one paid their owners; what employers paid over of what they withheld from wages, in all and to each payee's account (tax_and_contributions_by_payee); and what the outside world's accounts paid to people (support and pensions), in all, to how many different people, and from each account (support_by_account).
with r as (select run_id, world, seed, minor_units from runs),
people as (select a.run_id, a.account, a.holder from accounts a join entities e on e.run_id = a.run_id and e.entity = a.holder and e.kind = 'person'),
jobs as (select run_id, id from records where record = 'agreement' and template = 'employment'),
asked as (select q.run_id, q.id, q.basis, json_extract_string(q.body, '$.data.outcome.money.for') as what from records q where q.kind = 'request'),
paid as (select t.run_id, t.amount, t."from", t."to", t.t, q.basis, q.what from transfers t left join asked q on q.run_id = t.run_id and q.id = t.per_instruction),
wages as (select p.run_id, sum(p.amount)::DOUBLE as amount from paid p join jobs j on j.run_id = p.run_id and j.id = p.basis join people w on w.run_id = p.run_id and w.account = p."to" group by all),
own as (select p.run_id, json_extract_string(p.params, '$.own_work.account') as account, p.person from participants p where json_extract_string(p.params, '$.own_work.account') is not null),
drawn as (select t.run_id, sum(t.amount)::DOUBLE as amount from transfers t join own o on o.run_id = t.run_id and o.account = t."from" join people w on w.run_id = t.run_id and w.account = t."to" and w.holder = o.person group by all),
taken as (select p.run_id, p."to" as payee, sum(p.amount)::DOUBLE as amount from paid p where p.what ilike '%withheld from wages%' group by all),
arrived as (select run_id, person, max(t) as t from life where event = 'person_arrived' group by all),
support as (select t.run_id, t."from" as account, w.holder, t.amount from transfers t join accounts f on f.run_id = t.run_id and f.account = t."from" and f.holder = 'outside' join people w on w.run_id = t.run_id and w.account = t."to"
    left join arrived a on a.run_id = t.run_id and a.person = w.holder where not (a.t is not null and t.t between a.t and a.t + 86400))
select r.run_id, r.seed,
  round(coalesce((select amount from wages x where x.run_id = r.run_id), 0) / power(10, r.minor_units)) as wages_paid,
  round(coalesce((select amount from drawn x where x.run_id = r.run_id), 0) / power(10, r.minor_units)) as own_account_drawings,
  round(coalesce((select sum(amount) from taken x where x.run_id = r.run_id), 0) / power(10, r.minor_units)) as tax_and_contributions,
  (select string_agg(payee || ' ' || (round(amount / power(10, r.minor_units)))::BIGINT, '; ' order by payee) from taken x where x.run_id = r.run_id) as tax_and_contributions_by_payee,
  round(coalesce((select sum(amount)::DOUBLE from support x where x.run_id = r.run_id), 0) / power(10, r.minor_units)) as support_paid,
  (select count(distinct holder) from support x where x.run_id = r.run_id) as support_recipients,
  (select string_agg(account || ' ' || amount || ' to ' || n, '; ' order by account) from (select account, (round(sum(amount)::DOUBLE / power(10, r.minor_units)))::BIGINT as amount, count(distinct holder) as n from support x where x.run_id = r.run_id group by account)) as support_by_account
from r order by r.world, r.seed
