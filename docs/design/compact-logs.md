# Compact logs (a proposal, for sign-off)

**Status:** proposed, 2026-09-29. It changes the log contract (`contracts/log.schema.json`), so it waits for Naz.

## Why

A lean log of the 1,000-person town is about 470 MB a simulated year (1.42 GB for three years; 2.3 GB for five), and
about a seventh of that compressed. What fills it (a lean 3-year log):

| Share | What | Needed for |
|---|---|---|
| 52% | Commands (acts 36%, observes 12%, looks 4%) | Replay: they're its input |
| 47% | Events (transfers 20%, action results 7%, records 12%, work and goods 6%) | Replay regenerates them exactly and checks them; measurement reads them |
| 28% of every line | `hash` and `prev` (64 hex characters each) | The hash chain; `prev` repeats the previous line's `hash` |
| 30% of an act | `provenance.call`: the call text of a code participant's act | Nothing in replay; the resolved blocks are in the act |

What can be dropped already, with no contract change (docs/reliability.md): observation hashes and code
participants' reasoning (`--log lean`), the whole log for a code-only run at a commit (`--keep measures`: its
measures and a recipe that regenerates it), and bytes on disk (compressed by default).

## What's proposed

Three options in the world config's `log`, each off by default, each keeping replay exact:

1. **`chain: "hash"`**: lines keep `hash` and drop `prev`. A reader checks the chain by recomputing each line's hash
   from the previous line's, as replay already does. About 14% smaller. The anchors file is unchanged.
2. **`events: "derived"`**: the log keeps commands, annotations, checkpoints and the end; events aren't written. They
   are what the kernel does with the commands, so `terrarium-kernel replay --emit` writes the full log again, byte for
   byte (the checkpoints' state hashes say so). Measurement would run on the full log, emitted to a temporary file (or
   streamed). About 47% smaller; the cost is a replay's time (the kernel alone: about 25 s a simulated year) whenever
   the events are wanted.
3. **`call_text: "models"`**: an act submitted in the call language keeps its call text only for language-model
   participants (whose calls are training data). For code participants the text is a deterministic restatement of the
   blocks. About 11% smaller (`provenance.call` becomes optional where `via` is `call`).

Together, a lean, compact log would be about a third of today's lean log, and about 25 MB a simulated year compressed.

## What it costs

- Two more log shapes for every reader to handle. `logLines`/`readLog` (orchestrator/src/logs.ts) would hide them: an
  events-derived log is expanded on read.
- An events-derived log can't be measured without the kernel binary that wrote it. The version is in the header.
- Model runs should stay full: all three options are refused for a world with a language-model participant, as
  `--keep measures` is.

## Not proposed

- Dropping observe commands: they change the state (what's been seen), so replay needs them.
- A binary log format: JSONL is a stated interface (VISION: stay boring), and compression gets most of the way.
