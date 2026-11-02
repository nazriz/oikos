# Tiered storage (SC-1, SC-6)

Status: **built** (branch `tiered-storage`, 2026-11-02; Naz approved the proposal 2026-11-02, "Yes to all"). The
proposal as it was reviewed is in git history (this file before that date); what was built differs from it where
"Where it differs" says. Numbers: docs/design/performance.md ("Years at 10,000 and 50,000"); the decision and what
would make us revisit it: docs/decisions.md 2026-11-02, "Tiered storage".

## Why

A run's length, not its size, limits a long study. After the faults of 2026-10-31 were fixed, a 10,000-person town grew
about 25 MB a simulated day and a 50,000-person town about 105 MB, so 50,000 people outgrew the 64 GB machine near day
290. A heap profile put the growth in the world's records (54%: every record ever made, held whole by every holder of
it), the resolver's knowledge of every addressed statement each participant saw, the twins' per-matter draw counts,
citizens' minds, and the offices' files of payments.

## What a record is held as

Every holder of a record (the world's store, perception's index, the delivered-records cache, every actor's book, a
host that keeps what it is handed) holds a `Rec` (`kernel/crates/contracts/src/held.rs`): a handle to the record's one
slot, shared by all of them. The slot holds the record in memory (hot), or knows where its canonical bytes are in the
run's cold file (cold), or both, and when the record was made. `Rec::load` reads it, from memory or back from disk (and
then holds it in memory again); it marks the slot read. Nothing anyone reads differs by where it was held: the bytes on
disk are the record's canonical bytes (`canon::canonical`), read back by the same deserialiser to the same record
(checked as each is written in a debug build).

- **The tier** (`Tier`, the kernel's: `Kernel::tier_records`, on by default in `oikos-kernel world` and in a host given a
  log; `OIKOS_COLD=off` keeps everything in memory). Once a simulated day it is told of the records filed since, and
  goes through those that may be in memory: one filed at least `after_days` ago (30) and not read for `idle_days` (14)
  is written to disk if it is not there yet, in blocks of up to 64 records or 32 KB, each compressed (zstd level 3),
  and let go of in memory. `OIKOS_COLD_AFTER_DAYS` and `OIKOS_COLD_IDLE_DAYS` change the policy (a test moves every
  record out after a day); the results never depend on it.
- **The cold file** is `<out>/<run>.cold` (the world command) or `<log>.cold` (a host), made anew at the start and
  removed when the run ends (when nothing holds a slot of it any more). It holds only what the run's memory held: a
  snapshot carries every record whole, as before, so nothing outlives the run that needs it, and a resumed run tiers
  again from its snapshot. (Decided here, not in the proposal: see "Where it differs".)
- **Reading back** decompresses the record's block, kept in a small cache of blocks (8 MB), and deserialises the record.
- **The state hash** streams every record in id order, as before; a cold record's bytes are written as they are on disk,
  never made into a record again (`Rec::write_canonical`), so a checkpoint does not bring the history back into memory.
- **Books** (`kernel/crates/actors/src/common/book.rs`) keep each record's `Rec`, and the record itself only while
  they read it: what a book has read is let go at its next day (`Book::set_moment`) and read again when it is next
  asked for. Its lists read lazily: what a reader skips (`skip`, `nth`), counts or passes over is not read, so a reader
  that keeps its place in a list reads only what is new to it.
- **The delivered-records cache** is keyed by the record's slot, not by where the record is in memory (a record read
  back from disk is a new copy), and an entry not shown for a week goes whole; a host that keeps what it is handed keeps
  the slots of what it holds itself.
- **The offices' files of payments** (`State::ledgers`, derived, never hashed) keep their last weeks in memory: what is
  older than `after_days` goes to the same cold file in blocks of at least 256 payments, and the file reads back whole
  and in order when a post changes hands (`Ledger::all`), the only time it is read.

## Readers that read what they no longer needed

A record stays in memory while someone reads it. Measured on the 10,000 town (`OIKOS_COLD_WHO`, which counts the first
read of each record each day by the kind of actor reading it), most of the old records still read each day were read
by code that went through more than it needed: every one a mechanism fault that also cost the run's own thread time
growing with the run. Fixed, each result-identical:

- a list collected whole to skip what was read before (the trade desk's delivery notes and orders, the producer's
  declined invoices, the electoral office's votes): the list read lazily from where it was left;
- a person's weekly going-through of public goings-on (citizen/memory.rs) read every record of their book; it reads
  only public statements and withdrawals, the only papers it can let go (`Book::public`, `forget_public`);
- a person's weekly plan read every record to find those made since the last plan (`Book::records_since`: the slot
  knows when its record was made);
- a payroll (firms', and the bank's own staff) went through every request on its book at every wake to find its own
  wage orders: at the bank, every payment anyone instructed, so every request ever made stayed in memory (450,000 of
  the 10,000 town's 1.17 million records at day 120). It now reads the new ones from where it left off
  (`Staffing::adopt_orders`), and its own standing ones by their ids.

What is still read every day is what is in force (a bank's standing orders, agreements, a register's entries, open
claims): held in memory, as the proposal said it would be.

## The other growers

- **The resolver's addressed statements** (`Knowledge::addressed`, what a hold on a paper is addressed to): one entry
  for every addressed statement each participant has seen, kept for the run. Held small: by the record's number, its
  list of addressees held once for all (`Addressed`); written out (a snapshot) as the map it stands for.
- **The twins' per-matter draw counts** (`Draws::matter_occurrences`): a matter may say when it is over
  (`Cx::rng_until`, `Cx::rng_once`), and its count goes then. A gathering's matter ends when it begins (it is decided on
  only before); a delivered order's faultiness is drawn once, when its note is read. Results identical: a matter is
  never drawn for after it says it is over (a test holds the count running on before its end).

## Where it differs from the proposal

- **Slots, not segments of a month.** Records leave memory one by one by when they were last read, not a month at a time:
  what a rule still reads stays, whatever its age, and what nobody reads goes after `idle_days`.
- **The cold file is the run's scratch, not kept.** The proposal's question 2 (keep it with the run, or let it go) is
  answered "let it go": it is rebuilt from the run, a snapshot carries what it holds, and a model run's log (never
  deleted) is untouched. Kept, it would add some 2 to 10 GB a run at 50,000 people.
- **The state hash unchanged** (question 3): as proposed.
- **What people remember** (question 4) is untouched: a person's mind and its knowledge stay in memory.

## What must hold

Every result byte-identical to keeping everything in memory: `kernel/tests/a1_citizen.rs` runs a town tiered from the
second day (every record not read that day goes to disk) against one held in memory, state hash and log byte for byte;
`orchestrator/test/representation.test.ts` holds six towns to their pins with the tier on; the 10,000 town over 60 days
ends at main's state hash and log digest with and without it (docs/decisions.md). Disk decides nothing: a cold file that
cannot be made leaves the records in memory; one that cannot be read back stops the run.
