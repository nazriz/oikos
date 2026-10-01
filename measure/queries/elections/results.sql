-- Elections (docs/behaviour/elections.md), per run and polling day: the candidates, whether the incumbent stood and won, the winner, turnout and the rounds of the count. From the electoral office's published records; the votes themselves are secret (seen by the town only), and measurement reads them only in aggregate.
with results as (select run_id, "at" // 86400 as day, json_extract_string(body, '$.data.ballot') as ballot, json_extract_string(body, '$.data.office') as office,
    json_extract_string(body, '$.data.winner') as winner, (json_extract_string(body, '$.data.turnout_bps'))::BIGINT / 100.0 as turnout_pct,
    (json_extract_string(body, '$.data.formal'))::BIGINT as formal, (json_extract_string(body, '$.data.electors'))::BIGINT as electors,
    json_array_length(json_extract(body, '$.data.rounds')) as rounds
  from records where kind = 'ballot_result' and json_extract_string(body, '$.data.ballot') in (select id from records where kind = 'ballot' and json_extract_string(body, '$.data.electorate') = 'roll')),
ballots as (select run_id, id as ballot, json_array_length(json_extract(body, '$.data.options')) as candidates from records where kind = 'ballot'),
incumbents as (select run_id, author as incumbent, "at" from records where kind = 'nomination' and json_extract_string(body, '$.data.incumbent') = 'true')
select r.run_id, x.seed, r.office, r.day, b.candidates, r.winner, r.turnout_pct, r.formal, r.electors, r.rounds,
  (select i.incumbent from incumbents i where i.run_id = r.run_id and i."at" < r.day * 86400 order by i."at" desc limit 1) as incumbent,
  r.winner = (select i.incumbent from incumbents i where i.run_id = r.run_id and i."at" < r.day * 86400 order by i."at" desc limit 1) as incumbent_kept
from results r join ballots b using (run_id, ballot) join runs x using (run_id)
order by r.run_id, r.day
