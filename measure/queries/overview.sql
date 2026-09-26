-- Each run: its world and seed, how far it ran, how it ended, and its final state hash.
select run_id, world, seed, round(end_t / 31536000.0, 2) as years, end_reason, entries, kernel_version, orchestrator_version, left(state_hash, 16) as state_hash
from runs order by world, seed, run_id
