-- Language-model seats, per run: requests put in words, drafts made, confirmed and declined, requests that couldn't be turned into acts, and opt-outs.
select s.run_id, s.seat,
  (select count(*) from annotations a where a.run_id = s.run_id and a.annotation = 'draft' and json_extract_string(a.body, '$.draft.seat') = s.seat) as drafts,
  (select count(*) from annotations a where a.run_id = s.run_id and a.annotation = 'signoff' and json_extract_string(a.body, '$.seat') = s.seat and json_extract_string(a.body, '$.decision') = 'accept') as confirmed,
  (select count(*) from annotations a where a.run_id = s.run_id and a.annotation = 'signoff' and json_extract_string(a.body, '$.seat') = s.seat and json_extract_string(a.body, '$.decision') = 'reject') as declined,
  (select count(*) from annotations a where a.run_id = s.run_id and a.annotation = 'translation_failure' and a.subject = s.seat) as not_translated,
  (select count(*) from acts x where x.run_id = s.run_id and x.seat = s.seat and x.via = 'translator' and not x.applied) as refused_after_confirming,
  (select count(*) from events e where e.run_id = s.run_id and e.event = 'seat_opted_out' and json_extract_string(e.body, '$.seat') = s.seat) as opted_out
from seats s where s.controller = 'llm' order by s.run_id, s.seat
