-- Model calls and tokens, by run, subject, purpose and model, with the recorded cost (the mock costs nothing).
select run_id, subject, purpose, provider || '/' || model as model, count(*) as calls,
  sum(input_tokens) as input_tokens, sum(output_tokens) as output_tokens, round(sum(cost_microusd) / 1e6, 4) as recorded_usd
from usage group by all order by run_id, subject, purpose
