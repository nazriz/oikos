# Tiered storage: a proposal (SC-1)

Status: **proposed, for Naz's review; nothing built.** Measured on branch `representation` (2026-10-27), on a 4-core,
15 GB Linux machine.

## Why now

A run's length, not its size, is what limits a long study now. 1,000 people (au-vic, all code, 4 threads):

| run | peak resident | live heap | of it, the world's history |
|---|---|---|---|
| 30 days | 305 MB | about 200 MB | small |
| 180 days | 634 MB | | |
| 365 days | 1,081 MB | 895 MB | about 550 MB |

(With every cut on the branch; before the last, the delivered records' cache, a year peaked at 1,500 MB.) It grows
about 1 MB a day at 1,000 people, linearly: ten years at 10,000 would want some 30 to 40 GB, most of it history.

What a year's heap holds (`scripts/heapprof.ts --components`, the run's end): the world's records 441 MB (each
record and its JSON content); the offices' files of payments 38 MB; one entry per record in the delivered cache 25 MB;
what readers have learned from records 50 MB; the actors' state 61, citizens 57, their minds 44, the rest small.

## What is cold

A record is immutable once filed and, after its first days, seldom read: it is read again when someone asks its keeper
for it by name, when a register that lists it is shown, when a law or an agreement it carries is in force, and at a
checkpoint (the state hash streams every record). A payment on an office's file is read when a new holder takes the
post and is handed the file. Most of the history is read at a checkpoint and nowhere else.

## The proposal

**Records (and offices' files) past a few weeks old move to disk, and come back when read.** Nothing anyone sees,
nothing in the log and nothing in the state hash changes: disk is where the kernel keeps what it already keeps.

- **Segments.** Records leave memory in filing order, a segment at a time (say a month's): written once, canonical
  bytes, zstd-compressed (the kernel already uses it for snapshots and the binary log), to the run's own directory
  (`runs/<run>/cold/`), never edited. In memory each moved record leaves its id and where its bytes are (16 bytes or
  so, against some 400 now).
- **Reading.** A read of a moved record decodes it from its segment and keeps it in a small cache of the recently
  read (bounded by bytes). Every place that reads records goes through one accessor; today 14 places read the map.
- **What stays in memory.** Anything a rule reads every day: records whose laws or agreements are in force, the
  registers' current entries, what an office's file holds of the last weeks. The derived indexes (`marks`,
  `agreements_of`) stay as they are.
- **The state hash, unchanged.** At a checkpoint the hash streams every record in id order, as now, cold ones read
  from their segments in turn (some 440 MB a year at 1,000 people: about a second of reading per checkpoint).
  Changing the hash's definition (a tree of segment hashes, so cold segments are not read again) would be faster
  but is a change to the contract: not proposed.
- **Snapshots and resume.** A snapshot names the segments it relies on (they never change); resume maps them back.
- **The delivered cache.** It is keyed by where a record is in memory (so that what a host was handed is never
  mistaken for another record); a record read back from disk is a new copy, so the cache would be keyed by the
  record's id instead (one more small change, the same results).

## What must hold

Every result byte-identical to keeping all in memory, proved by `orchestrator/test/representation.test.ts` and by a
year-long town ending at the same state hash with and without the cold tier, forced on early (a test setting that
moves records to disk after a day). No participant learns anything differently: the cold tier is the kernel's, and
records still reach a participant only through its channels (docs/no-god-view.md). Disk I/O never decides anything.

## Expected effect

At a year at 1,000 people, about 450 to 500 MB of the 895 MB live goes to disk (records and payments past a month),
the peak falling to perhaps 550 to 650 MB, and growth to a fraction of 1 MB a day (what stays is the indexes and the
in-force records). CPU: a few percent at checkpoints and on reads of old records; to be paired, as every step.

## For Naz to decide

1. **Go ahead with the design?** It is the largest change on the branch (world state, the kernel's record accessor,
   snapshots, the delivered cache): some days, in steps, each byte-identical.
2. **Where cold data lives and what it may cost in disk.** Proposed: beside the run's log in `runs/<run>/cold/`; a
   year at 1,000 people is some 100 to 150 MB compressed. Kept with the run (model runs are never deleted) or let go
   when the run ends (it can be rebuilt from the log)?
3. **The state hash.** Keep it as it is (proposed), at the cost of reading cold history at each checkpoint, or
   consider a hash over segments later, which is a contract change.
4. **What people remember** is not touched: a person's own knowledge stays in memory. If it is the next to grow, it
   is yours to bound or to tier.
