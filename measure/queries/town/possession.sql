-- Possession of let homes for arrears (docs/behaviour/justice.md, "Possession"), per run, over the last 12 months: the households renting at the end (a lease signed, with no notice on it); landlords' notices to vacate, and those that lapsed because the arrears were paid; applications to the tribunal for possession; its orders, by finding (a plan to pay, possession on a date, dismissed); warrants asked for, issued, carried out by the police and lapsed; tenancies ended by a landlord's notice on the lease for arrears (how it went in a world with no law on possession); and applications and evictions carried out for every 1,000 renting households (to set against a place's tribunal or court figures: docs/calibration.md). Counted; nothing is scored.
with r as (select run_id, world, seed, end_t, greatest(0, end_t - 365::BIGINT * 86400) as from_t from runs),
renting as (select a.run_id, count(distinct json_extract_string(a.body, '$.terms.parties[1]')) as n from records a join r on r.run_id = a.run_id
  where a.record = 'agreement' and a.template = 'lease'
    and exists (select 1 from records s where s.run_id = a.run_id and s.record = 'signature' and json_extract_string(s.body, '$.agreement') = a.id)
    and not exists (select 1 from records n where n.run_id = a.run_id and n.record = 'notice' and json_extract_string(n.body, '$.agreement') = a.id and n.t <= r.end_t) group by all),
c as (select x.run_id,
    count(*) filter (where x.kind = 'notice_to_vacate') as notices_to_vacate,
    count(*) filter (where x.withdraws is not null and exists (select 1 from records n where n.run_id = x.run_id and n.id = x.withdraws and n.kind = 'notice_to_vacate')) as lapsed_paid,
    count(*) filter (where x.kind = 'tribunal_application' and json_extract_string(x.body, '$.data.kind') = 'possession') as applications,
    count(*) filter (where x.kind = 'tribunal_order' and json_extract_string(x.body, '$.data.kind') = 'possession' and json_extract_string(x.body, '$.data.finding') = 'plan') as plans,
    count(*) filter (where x.kind = 'tribunal_order' and json_extract_string(x.body, '$.data.kind') = 'possession' and json_extract_string(x.body, '$.data.finding') = 'possession') as possession_orders,
    count(*) filter (where x.kind = 'tribunal_order' and json_extract_string(x.body, '$.data.kind') = 'possession' and json_extract_string(x.body, '$.data.finding') not in ('plan', 'possession')) as dismissed,
    count(*) filter (where x.kind = 'warrant_request') as warrants_asked,
    count(*) filter (where x.kind = 'warrant') as warrants,
    count(*) filter (where x.kind = 'warrant_executed') as carried_out,
    count(*) filter (where x.kind = 'warrant_lapsed') as warrants_lapsed,
    count(*) filter (where x.record = 'notice' and json_extract_string(x.body, '$.text') like 'Notice: rent is in arrears%') as ended_by_notice
  from records x join r on r.run_id = x.run_id where x.t > r.from_t and x.t <= r.end_t group by all)
select r.run_id, r.seed, coalesce(renting.n, 0) as renting_households, coalesce(c.notices_to_vacate, 0) as notices_to_vacate, coalesce(c.lapsed_paid, 0) as lapsed_paid, coalesce(c.applications, 0) as applications,
  coalesce(c.plans, 0) as plans, coalesce(c.possession_orders, 0) as possession_orders, coalesce(c.dismissed, 0) as dismissed, coalesce(c.warrants_asked, 0) as warrants_asked, coalesce(c.warrants, 0) as warrants,
  coalesce(c.carried_out, 0) as carried_out, coalesce(c.warrants_lapsed, 0) as warrants_lapsed, coalesce(c.ended_by_notice, 0) as ended_by_notice,
  round(1000.0 * coalesce(c.applications, 0) / nullif(renting.n, 0), 1) as applications_per_1000, round(1000.0 * coalesce(c.carried_out, 0) / nullif(renting.n, 0), 1) as carried_out_per_1000
from r left join renting on renting.run_id = r.run_id left join c on c.run_id = r.run_id order by r.world, r.seed
