# terrarium-kernel

The world's laws of physics, and its only writer. Rust, no `unsafe`, no floats, no hash maps, no wall-clock time; randomness comes only from `rng::Randomness` (one seed from the config, with keyed streams derived from it).

The contracts in [`../contracts`](../contracts) are the source of truth. Their schemas are compiled into this crate, and every input is validated against them.

```bash
cargo test                      # all invariant, conformance and law tests
cargo run -- serve              # NDJSON protocol on stdin/stdout (see src/protocol.rs)
cargo run -- verify run.jsonl --anchors run.anchors.jsonl
cargo run -- replay run.jsonl   # regenerate the log; must be byte-identical
```

## Layout

| Module | Role |
|---|---|
| `kernel.rs` | Commands in, events out. Mandate verdict, the act → hold → approve → apply pipeline, `advance`, `observe`, dry-run `check`. |
| `exec.rs` | Applying blocks (atomically, against a scratch state) and scheduled effects (payments, completions, expiries). This is where the laws live. |
| `laws.rs` | Read-only questions the laws ask: authority, zoning, rent caps, capacity. |
| `mandate.rs` | Mandate evaluation: default deny, first matching power, strictest level wins. |
| `observe.rs` | Role-limited observations through configured channels. |
| `run.rs` | Kernel plus log: command → log → apply → events → checkpoints; `replay`. |
| `log.rs` | Hash-chained JSONL writer, verifier and witness anchors. |
| `canon.rs` | Canonical JSON (JCS subset) and domain-separated SHA-256. |
| `contracts.rs` | The contract schemas, compiled in; input validation. |
| `rng.rs` | xoshiro256** with keyed streams; frozen by known-answer tests. |

## Invariant tests (V0.md)

| Invariant | Test | How |
|---|---|---|
| Money is conserved | `tests/money_conservation.rs` | Property test over random worlds and command sequences: total including the boundary is constant, no ordinary balance goes negative, and every balance equals opening balance plus logged `transfer` events. |
| Replay is byte-identical | `tests/replay.rs` | Property test: replay regenerates the *whole log* byte for byte and the final canonical state matches; the same inputs in a fresh kernel give the same log; a forged-but-rechained log is caught at the first divergent line. |
| Nothing bypasses a mandate | `tests/mandate.rs` | Property test against an independent oracle that reads mandates from the config JSON, with random multi-approver mandates. Also concrete approval, bundle and request flows. |
| The hash chain verifies; tampering is detected | `tests/hash_chain.rs` | Every field edit, insertion, deletion, reorder, reformat and single-byte flip is detected. Rewriting with recomputed hashes, and truncation, are caught by the witness anchors (and only by them, by design). |

Supporting tests:
- `tests/conformance.rs`: kernel outputs validate against the schemas, and contract examples round-trip through the Rust types.
- `tests/laws.rs`: one test per law.
- `tests/cli.rs`: the real binary end to end.
- `tests/generator_reach.rs`: guards against vacuous property tests by requiring the random operations to reach leases, approvals, breaches, clipped rents and so on.
- `tests/determinism_lint.rs`: a textual ban on `HashMap`, floats, clocks and ambient randomness.

The property tests were also checked by mutation: 11 deliberately planted kernel bugs (money leaks, skipped approvals, nondeterministic ids, weakened chain checks, and others), each caught by its suite.
