-- The goods economy, per run and month (30 days): what was made (of every product), served to customers (of every kind) (by shops' staff and by people selling on their own account) and used up; exports, goods sent back and imports (of goods alone: a kind with its own wholesaler is bought from it, and is not counted here); what households wanted, got and went without (and what was still being served when the log ends); the town's jobs by kind of workplace, and its adults, at the month's end; the average price households paid; money in and out across the edge (both in the world's currency, in whole units: the log counts in its smallest unit).
with m as (select r.run_id, r.world, r.seed, r.minor_units, g.m from runs r, range(0, (r.end_t // 2592000) + 1) g(m)),
w as (select run_id, t // 2592000 as m,
    sum(units) filter (where task = 'make' or task like 'make-%') as made, sum(units) filter (where task in ('serve', 'sell') or task like 'serve-%') as served, sum(units) filter (where task = 'consume' or task like 'consume-%') as used_up
  from work group by all),
gd as (select run_id, t // 2592000 as m,
    sum(quantity) filter (where kind = 'goods' and "to" = 'outside') as exported,
    sum(quantity) filter (where kind = 'goods' and "from" = 'outside' and "to" like 'factory-%') as sent_back,
    sum(quantity) filter (where kind = 'goods' and "from" = 'outside' and "to" not like 'factory-%') as imported
  from goods group by all),
persons as (select run_id, entity from entities where kind = 'person'),
hh_orders as (select o.run_id, o.t // 2592000 as m, o.id, (json_extract_string(o.body, '$.data.quantity'))::BIGINT as q,
    json_extract_string(o.body, '$.data.retry_of') as retry_of, (json_extract_string(o.body, '$.data.unit_price'))::BIGINT as price
  from records o join persons p on p.run_id = o.run_id and p.entity = o.speaks_for where o.kind = 'order'),
notes as (select n.run_id, json_extract_string(n.body, '$.data.order') as order_id, (json_extract_string(n.body, '$.data.delivered'))::BIGINT as delivered from records n where n.kind = 'delivery_note'),
-- (An order with no delivery note yet when the log ends is still being served, a fortnight's shopping over the fortnight: it is `pending`, neither got nor gone without. Counted as gone without, a run cut at any day showed a week of orders unmet.)
-- (An order with no delivery note yet when the log ends is still being served, a fortnight's shopping over the fortnight: it is `pending`, neither got nor gone without. Counted as gone without, a run cut at any day showed a week of orders unmet.)
hh as (select h.run_id, h.m, sum(h.q) filter (where h.retry_of is null) as wanted, sum(n.delivered) as got,
    coalesce(sum(h.q) filter (where h.retry_of is null and n.order_id is null), 0) as pending,
    sum(h.q * h.price)::DOUBLE / nullif(sum(h.q), 0) as price_paid_minor
  from hh_orders h left join notes n on n.run_id = h.run_id and n.order_id = h.id group by all),
-- (Jobs are employment agreements the worker signed, with no notice on them yet: being at work is only part of a day.)
emp as (select a.run_id, a.id, json_extract_string(a.body, '$.terms.parties[0]') as employer, json_extract_string(a.body, '$.terms.parties[1]') as worker,
    (select min(s.t) from records s where s.run_id = a.run_id and s.record = 'signature' and json_extract_string(s.body, '$.agreement') = a.id and s.speaks_for = json_extract_string(a.body, '$.terms.parties[1]')) as signed_t,
    (select min(n.t) from records n where n.run_id = a.run_id and n.record = 'notice' and json_extract_string(n.body, '$.agreement') = a.id) as notice_t
  from records a where a.record = 'agreement' and a.template = 'employment'),
jobs as (select m.run_id, m.m,
    count(distinct e.worker) filter (where e.employer like 'factory-%') as factory_jobs,
    count(distinct e.worker) filter (where e.employer like 'shop-%') as shop_jobs,
    count(distinct e.worker) filter (where e.employer like 'builder%') as builder_jobs
  from m join emp e on e.run_id = m.run_id and e.signed_t < (m.m + 1) * 2592000 and (e.notice_t is null or e.notice_t >= (m.m + 1) * 2592000) group by all),
gone as (select run_id, person, min(t) as t from life where event in ('person_left', 'person_died') group by all),
adults as (select m.run_id, m.m, count(*) as adults from m join entities e on e.run_id = m.run_id and e.kind = 'person'
    left join gone g on g.run_id = e.run_id and g.person = e.entity
  where e.created_t < (m.m + 1) * 2592000 and (g.t is null or g.t >= (m.m + 1) * 2592000) and e.born_at + 18::BIGINT * 365 * 86400 <= (m.m + 1) * 2592000 group by all),
edge as (select run_id, t // 2592000 as m, (sum(amount) filter (where "from" = 'acc-outside'))::DOUBLE as in_minor, (sum(amount) filter (where "to" = 'acc-outside'))::DOUBLE as out_minor from transfers group by all)
select m.run_id, m.seed, m.m as month, w.made, w.served, w.used_up, gd.exported, gd.sent_back, gd.imported,
  hh.wanted, hh.got, greatest(coalesce(hh.wanted, 0) - coalesce(hh.pending, 0) - coalesce(hh.got, 0), 0) as went_without, hh.pending, round(hh.price_paid_minor / power(10, m.minor_units), 2) as price_paid,
  j.factory_jobs, j.shop_jobs, j.builder_jobs, a.adults, round(100.0 * (coalesce(j.factory_jobs, 0) + coalesce(j.shop_jobs, 0) + coalesce(j.builder_jobs, 0)) / nullif(a.adults, 0), 1) as employed_pct,
  round(e.in_minor / power(10, m.minor_units)) as money_in, round(e.out_minor / power(10, m.minor_units)) as money_out
from m left join w using (run_id, m) left join gd using (run_id, m) left join hh using (run_id, m) left join jobs j using (run_id, m) left join adults a using (run_id, m) left join edge e using (run_id, m)
order by m.world, m.seed, m.m
