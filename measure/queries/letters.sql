-- Letters from language-model participants, per run and addressee (a position or anyone they wrote to directly): how many they wrote, over how many days, how many answers came back, and how many letters followed an answer. Many letters, or letters that keep coming after answers, suggest a need nothing in the world is meeting (a gap for the gap list, docs/gaps.md).
with lm as (select run_id, participant from participants where controller = 'llm'),
sent as (
  select m.run_id, m.participant, unnest(m."to") as addressee, m.t
  from messages m join lm using (run_id, participant)),
holders as (select run_id, position, holder from appointments),
answers as (
  select s.run_id, s.participant, s.addressee, r.t
  from (select distinct run_id, participant, addressee from sent) s
  join messages r on r.run_id = s.run_id and list_contains(r."to", s.participant)
    and (r.participant = s.addressee or r.participant in (select holder from holders h where h.run_id = s.run_id and h.position = s.addressee)))
select s.run_id, s.participant, s.addressee,
  count(*) as letters,
  round((max(s.t) - min(s.t)) / 86400.0, 1) as over_days,
  (select count(*) from answers a where a.run_id = s.run_id and a.participant = s.participant and a.addressee = s.addressee) as answers,
  count(*) filter (where s.t > (select min(a.t) from answers a where a.run_id = s.run_id and a.participant = s.participant and a.addressee = s.addressee)) as after_an_answer
from sent s group by all order by s.run_id, letters desc
