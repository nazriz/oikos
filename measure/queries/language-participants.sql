-- Language-model participants, per run: requests put in words, drafts made, confirmed and declined, requests that couldn't be turned into acts, and opt-outs.
select p.run_id, p.participant,
  (select count(*) from annotations a where a.run_id = p.run_id and a.annotation = 'draft' and json_extract_string(a.body, '$.draft.participant') = p.participant) as drafts,
  (select count(*) from annotations a where a.run_id = p.run_id and a.annotation = 'signoff' and json_extract_string(a.body, '$.participant') = p.participant and json_extract_string(a.body, '$.decision') = 'accept') as confirmed,
  (select count(*) from annotations a where a.run_id = p.run_id and a.annotation = 'signoff' and json_extract_string(a.body, '$.participant') = p.participant and json_extract_string(a.body, '$.decision') = 'reject') as declined,
  (select count(*) from annotations a where a.run_id = p.run_id and a.annotation = 'translation_failure' and a.subject = p.participant) as not_translated,
  (select count(*) from acts x where x.run_id = p.run_id and x.participant = p.participant and x.via = 'translator' and not x.applied) as refused_after_confirming,
  (select count(*) from events e where e.run_id = p.run_id and e.event = 'participant_opted_out' and json_extract_string(e.body, '$.participant') = p.participant) as opted_out
from participants p where p.controller = 'llm' order by p.run_id, p.participant
