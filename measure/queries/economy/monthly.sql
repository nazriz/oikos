-- The goods economy, per run and month (30 days): what was made, served to customers and used up; exports, goods sent back and imports; what households wanted, got and went without; the town's jobs by kind of workplace, and its adults, at the month's end; the average price households paid; money in and out across the edge.
with m as (select r.run_id, r.world, r.seed, g.m from runs r, range(0, (r.end_t // 2592000) + 1) g(m)),
w as (select run_id, t // 2592000 as m,
    sum(units) filter (where task = 'make') as made, sum(units) filter (where task = 'serve') as served, sum(units) filter (where task = 'consume') as used_up
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
hh as (select h.run_id, h.m, sum(h.q) filter (where h.retry_of is null) as wanted, sum(n.delivered) as got,
    round(sum(h.q * h.price) / 100.0 / nullif(sum(h.q), 0), 2) as price_paid
  from hh_orders h left join notes n on n.run_id = h.run_id and n.order_id = h.id group by all),
jobs as (select m.run_id, m.m,
    sum(case when o.event = 'occupied' then 1 else -1 end) filter (where o.structure like 'factory-%') as factory_jobs,
    sum(case when o.event = 'occupied' then 1 else -1 end) filter (where o.structure like 'shop-%') as shop_jobs,
    sum(case when o.event = 'occupied' then 1 else -1 end) filter (where o.structure like 'builder-%') as builder_jobs
  from m join occupancy o on o.run_id = m.run_id and o.t < (m.m + 1) * 2592000 and o.space_kind = 'workplace' group by all),
gone as (select run_id, person, min(t) as t from life where event in ('person_left', 'person_died') group by all),
adults as (select m.run_id, m.m, count(*) as adults from m join entities e on e.run_id = m.run_id and e.kind = 'person'
    left join gone g on g.run_id = e.run_id and g.person = e.entity
  where e.created_t < (m.m + 1) * 2592000 and (g.t is null or g.t >= (m.m + 1) * 2592000) and e.born_at + 18 * 365 * 86400 <= (m.m + 1) * 2592000 group by all),
edge as (select run_id, t // 2592000 as m, round(sum(amount) filter (where "from" = 'acc-outside') / 100.0) as money_in_usd, round(sum(amount) filter (where "to" = 'acc-outside') / 100.0) as money_out_usd from transfers group by all)
select m.run_id, m.seed, m.m as month, w.made, w.served, w.used_up, gd.exported, gd.sent_back, gd.imported,
  hh.wanted, hh.got, greatest(coalesce(hh.wanted, 0) - coalesce(hh.got, 0), 0) as went_without, hh.price_paid,
  j.factory_jobs, j.shop_jobs, j.builder_jobs, a.adults, round(100.0 * (coalesce(j.factory_jobs, 0) + coalesce(j.shop_jobs, 0) + coalesce(j.builder_jobs, 0)) / nullif(a.adults, 0), 1) as employed_pct,
  e.money_in_usd, e.money_out_usd
from m left join w using (run_id, m) left join gd using (run_id, m) left join hh using (run_id, m) left join jobs j using (run_id, m) left join adults a using (run_id, m) left join edge e using (run_id, m)
order by m.world, m.seed, m.m
