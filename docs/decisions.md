# Decision log

Why things are the way they are, and what would make us change them. When a decision is revisited, mark it superseded, add the new entry, and don't delete the old one.

Format: **decision** · why · alternatives considered · *revisit if*.

---

## 2026-09-25 · Stage 1 (contracts & kernel)

**D1. No floating point anywhere in the contracts, including opaque data.**
Why: a single float breaks cross-language canonical hashing, and with it the hash chain and byte-identical replay. Money is integer cents, costs are micro-USD, fractions are scaled integers (`temperature_milli`).
Alternatives: RFC 8785 number formatting for floats. Rejected, because Rust (ryu) and JS format some floats differently.
*Revisit if* a behaviour model genuinely needs non-integer maths inside the kernel. Use fixed-point integers before reconsidering.

**D2. Actions are atomic bundles; every block names its acting entity; `$ref` binds within an action.**
Why: real acts are compound (a sale is transfer + transfer_right), and all-or-nothing avoids escrow and partial states. Explicit actors make the log auditable and translator output unambiguous.
*Revisit if* translations regularly need conditional or partial execution. That belongs to the rules language, not to bundles.

**D3. Time is simulated seconds, not ticks.**
Why: configs survive a change of tick length; the kernel rounds durations up to whole ticks.

**D4. The kernel is the only writer of the log, including annotations, and there is one hash chain.**
Why: one chain means one thing to verify, and LLM transcripts and costs are tamper-evident too.
Consequence: annotations can make logs large. *Revisit if* logs get unwieldy. Move large blobs to content-addressed side files referenced by hash.

**D5. `observe` is a logged command.**
Why: "what did the AI know when it decided" is exact and replayable; the log stores the observation hash and replay re-derives the content.

**D6. Replay regenerates the entire log and compares bytes.**
Why: stronger than comparing final state, and it pinpoints the first divergent entry.
Consequence: any change to kernel behaviour, event shape or entry ordering makes old logs fail to replay on the new kernel. That is intended: logs record the kernel build that wrote them. Replaying old runs needs the old kernel build, so keep builds tagged.

**D7. Randomness: one seed, keyed streams** (SHA-256(seed, key) → xoshiro256**), implemented in-repo and frozen by known-answer tests.
Why: with a single sequential stream, adding one consumer (a citizen, a rule) perturbs every later draw, which makes controlled comparisons fragile and zoom-invariance hard. Our own implementation also means dependency upgrades can't change the random stream.
*Revisit* the keying convention in Stage 2, when citizens first draw randomness. Keys must be unique per purpose.

**D8. Mandates: default deny, first matching power wins, strictest level wins for a bundle, and every block is gated (including `message` and `decide`).** Mandates are static in v0.1.
*Revisit* when we study mandate creep. That needs an `amend_mandate`/delegation block (itself mandate-gated).

**D9. Approval-level actions are dry-run as the proposer; requests are not.**
Why: found while implementing. A request asks someone else to act with authority the requester lacks, so a dry run as the requester always failed. Approvals are re-validated when the last approval arrives, and still apply if the proposer has since resigned.

**D10. The kernel validates every input against the contract schemas, which are compiled into the binary.**
Why: found while implementing. The kernel had logged a command with `period: 0`, which violates the contract. Trusting the orchestrator isn't enough when the log is the scientific record. Using the schema itself (not a hand-written copy) prevents drift. Outputs (events, observations) are kernel-generated, so the conformance property tests cover them instead of runtime checks, which would be too slow for bulk runs.
*Revisit if* input validation shows up in profiles.

**D11. Protocol error vs refusal.** Off-contract input is a protocol error: rejected and never logged. A lawful-shaped act that the world or the mandate refuses is logged as a finding.
Consequence: an LLM emitting malformed blocks leaves no trace in the kernel log. The orchestrator must annotate such attempts (`translation_failure` / `note`) so probing is still recorded.

**D12. Reward is always 0 in the seat API.**
Why: the platform doesn't judge. RL users wrap the environment with a reward computed outside the world.

**D13. Resignation is always available and not configurable; every framing records a reason** (VISION §15).

**D14. Transport: the kernel is a subprocess speaking NDJSON over stdio.**
Why: simple, deterministic, no ports, and the same messages carry over to WASM. Not a contract; can change freely.

**D15. Laws currently hard-coded that should probably become parameters** (flagged for Stage 2):
- Failed payment → immediate breach.
- A structure with active leases can't be demolished.
- Derived rights are non-transferable.
- A surface right can't be transferred while encumbered.
- Structures pass with the surface right.
- Unzoned land is unrestricted.
- Rent is paid in advance and wages in arrears.

Tenancy law is where disempowerment shows up, so these are experimental variables, not physics.

**D16. Atomicity by cloning state.** Each action runs against a full copy of the state, which is committed on success.
Why: simplest correct implementation.
*Revisit if* state gets large (thousands of citizens) and actions become frequent. Switch to an undo log.

**D17. Citizens will be simulated individually at v0 scale** (proposed and accepted). Level of detail lives only in rendering and narration, so "zooming never changes the outcome" holds by construction.
*Revisit if* scale demands an aggregate mode. It must come with its own invariant test.

## Open (to decide at the Stage 2 checkpoint or before)

- Citizen behaviour in the Rust kernel (deterministic, fast, re-runnable, but researchers must write Rust to swap models) vs TypeScript code seats (easy to swap, but replay-only reproducibility). Leaning kernel.
- Which D15 laws become parameters, and their defaults.
