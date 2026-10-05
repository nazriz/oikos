# oikos-kernel (v0.2)

**Physics, plus a place to keep records.** The kernel refuses only what is physically impossible. Laws, ownership, permits, agreements, procedures, debts and votes are records it stores with their authors and never judges. When a law is enforced or a payment made, it's because some seat chose to act (D18–D22).

Rust, no `unsafe`, no floats, no hash maps, no wall-clock time. Randomness comes only from `rng::Randomness` (one seed, keyed streams). The contracts in [`../contracts`](../contracts) (v0.2) are the source of truth: their schemas are compiled in, and every input is validated against them.

```bash
cargo test                      # all invariant, conformance and physics tests
cargo run -- serve              # NDJSON protocol on stdin/stdout (see src/protocol.rs)
cargo run -- verify run.jsonl --anchors run.anchors.jsonl
cargo run -- replay run.jsonl   # regenerate the log; must be byte-identical
```

## Layout

| Module | Role |
|---|---|
| `kernel.rs` | Commands in, events out: `act` (applied, or refused for physics), `advance`, `observe`, `opt_out` (leaving the study, D38), dry-run `check` |
| `exec.rs` | Physical acts (custody, funds, space, capacity, presence) and record acts (store, never judge). The only place state changes. |
| `observe.rs` | Perception through channels (`accounts`, `records`, `sites`, `directory`): each look delivers what changed since the seat's last look through the channel (change stamps and per-channel cursors), with `every` for how often it looks; respects each record's visibility. `full_view` gives the full picture a view must equal (tested in `tests/perception.rs`) |
| `blocks.rs` | The 18 blocks and the record types |
| `state.rs` | Accounts, parcels, structures, occupancy, the append-only record store, per-seat perception cursors |
| `config.rs` | World config and its coherence checks (none of them law) |
| `run.rs`, `log.rs` | Kernel plus hash-chained log, replay, witness anchors |
| `canon.rs`, `rng.rs`, `contracts.rs` | Canonical JSON and hashing; the PRNG; the compiled-in schemas |

## Invariant tests

| Invariant | Test | How |
|---|---|---|
| Money is conserved | `tests/money_conservation.rs` | Property test: total money including the boundary is constant; no ordinary account goes negative; every balance equals opening plus logged transfers; every payment was executed by the paying account's custodian |
| Replay is byte-identical | `tests/replay.rs` | Replay regenerates the whole log byte for byte; the same inputs give the same log; a forged-but-rechained log is caught at the first divergent line |
| **No act takes effect unless it's physically possible** (replaces v0.1's mandate invariant, D20) | `tests/physical_feasibility.rs` | An independent mirror of the physical world replays every physical event and checks it was possible; an oracle predicts every single-block physical act's outcome; refused actions change nothing |
| **Statements have no power** (D19 as code) | `tests/statements_have_no_power.rs` | The same commands in a world with and without extra laws, instructions, court orders and contradictory claims produce identical outcomes, payments, buildings and occupants |
| The hash chain verifies; tampering is detected | `tests/hash_chain.rs` | Every edit, insertion, deletion, reorder, reformat and byte flip is detected; rewriting with recomputed hashes, and truncation, are caught by the witness anchors |

Supporting tests:
- `tests/physics.rs`: one test per physical law and record mechanic, including the river scenario, in which an illegal building goes up because physics allows it.
- `tests/conformance.rs`: examples round-trip, and all outputs validate against the schemas.
- `tests/cli.rs`: the binary end to end.
- `tests/generator_reach.rs`: guards against vacuous property tests by requiring every record kind, payment kind, eviction kind and physical refusal to occur.
- `tests/determinism_lint.rs`.

**Mutation-checked:** 14 deliberately planted bugs are each caught by their suite. They include money leaks, bypassing the bank, over-capacity occupancy, silent eviction, overwritten claims, public votes, nondeterministic ids, weakened chain checks, and two ways of **sneaking law into the kernel**: a bank freeze enforced by physics, and construction obeying a law's text.

## Documented liberties

- Construction and demolition costs are paid from the builder's own account straight to the boundary, bypassing its bank. Accepted temporarily; see docs/decisions.md, under "Open".
