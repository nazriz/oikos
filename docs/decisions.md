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

**D15. [SUPERSEDED by D18]** Laws currently hard-coded that should probably become parameters (flagged for Stage 2):
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

**D18. The kernel is physics; every human construct is expressed through it.** *(Naz, 2026-09-25; supersedes D15's framing.)*
In Naz's words: "we need to equate the kernel with physics, and that's about it. Anything else that's a human construct is expressed through it." Laws, property, ownership (including ownership of money), contracts, organisations and jurisdiction must all be *expressible* through the kernel's generic mechanisms as config data. None of them is built in. A world whose config defines no property law has no ownership: accepted explicitly.
The kernel holds only physics (money is conserved, land is finite, time passes, what each block mechanically does) and a generic mechanism for evaluating rules. Every law is data: written in the world config, and changeable in-world by seats through blocks. The kernel has no built-in knowledge of tenant protection, zoning, rent caps or any other policy. Where no rule applies, the kernel does nothing on anyone's behalf: a missed payment records a debt, and what follows comes from a configured rule or a seat's decision.
Consequence: Stage 1 violates this. The built-in `zoning` and `rent_cap` rule types (a V0.md stopgap), automatic eviction on a missed payment, the no-demolition-with-tenants check, the encumbered-sale refusal, and the other D15 items must all come out of the kernel code. This makes the general rules mechanism (VISION §5, "the hardest block") the first Stage 2 task, not a later one.

**D19. Laws have no power of their own; entities act. The kernel refuses only what is physically impossible.** *(Naz, 2026-09-25. This is foundational; it rejects the "rule effects" design in the first draft of docs/design/v0.2.)*
We are simulating the real world as closely as we can, not building a video game.
- **Laws are records**: statements enacted by a body (plain text, plus optionally a formal condition), perceived by seats, changeable by acts. A law never blocks an act and never executes anything.
- **Breaking the law is possible** wherever physics allows it (e.g. building by the river without a permit). Whether anyone notices, and what happens next (enforcement, fines, lobbying to change the law, looking the other way), comes from entities acting.
- **Institutions are entities doing work**: a tax agency collects tax, a planning office grants permits, inspectors inspect, courts judge. Their efficiency, cost and capture are research questions, e.g. an AI takes over the tax agency, runs it more cheaply, and the rate falls from 10% to 5%. That's only possible if collection is an act by an entity, not a mechanic.
- Consequence: the kernel's refusals are physics only. The earlier design's `forbid`, `act` and `adjust` rule effects are withdrawn.
Open, raised with Naz: what counts as physical *possession* (can anyone physically take money from an account they have no access to?); whether seat mandates are physical capability (the levers a seat holds) rather than legal authority; and when to model the physical cost of work (labour, time), which institutional efficiency depends on.

**D20. Possession is physics; authority is not. Kernel-enforced mandates are withdrawn.** *(Naz, 2026-09-25.)*
- **Possession (physics):** an entity's money can only be physically moved by the seats that actually operate its account (e.g. a city's finance staff), not by anyone else. Land and buildings are physically open: building on, occupying or demolishing someone else's property is possible, though it may be illegal.
- **Authority (constructs, as data):** organisations act through roles (seats: mayor, councillors, finance officers, planners; mostly code-run, any of them AI) and procedures (internal rules, e.g. "spending must be within the approved budget", "payments over $50k need two sign-offs"). A mayor's power works through budgets, instructions, appointments and persuasion. Procedures, like laws, can be followed, bent or broken; whether anyone notices is research.
- This **replaces V0.md's invariant "no action takes effect unless it passes the acting seat's mandate"**, which under D18/D19 is itself gamified. It becomes: *no act happens unless the actor can physically do it* (possession, capacity, funds, time). The v0.1 mandate model (direct / approval / request) and its tests will be removed or reworked.
- "We will need to take liberties with some things", but not with the core institutional dynamics: that is what's being studied.

**D21. Work is real (simplified); borrow from existing economic models.** *(Naz, 2026-09-25.)*
Jobs must be real in effect: tasks require units of time, workers have units of capacity. Institutional efficiency (e.g. an AI-run tax agency needing fewer staff) depends on it. We design it now and build it after the core, provided the core can be tested without it. We borrow freely from established agent-based economic models (their published models and rules, cited in docs/behaviour/, rather than their code, which is mostly Python/Java/NetLogo).

**D22. The kernel never judges whether a record is valid.** *(Naz, 2026-09-25.)*
Claims, agreements and statements are stored with their author and basis. Validity, legality and legitimacy are interpretation, done by entities (clerks, courts, the public). Forged titles, laws published without a vote, and fake permits are all possible, and the record shows who made them.

**D23. Institutions are world content, not platform.** *(Naz, 2026-09-25.)*
Councils, agencies, courts and inspectors are entities, roles, procedures and seats in a world's config, filled by behaviour modules, LLMs or humans. An empty world is valid. The platform provides the kernel and the ability to run code-controlled seats from swappable behaviour modules. Example worlds and example behaviour modules are content: cited, documented and replaceable.

**D24. Work is designed in v0.2 and built after the core loop runs.** *(Naz, 2026-09-25.)* Tasks have time requirements and performers have capacity (the Acemoglu & Restrepo task framework). Until it's built, institutions act without time cost, so institutional-efficiency questions wait for it.

**D25. Proportional fidelity: faithful where the research is, documented liberties elsewhere.** *(Naz, 2026-09-25: "some things can be 100%, others 10%." Fidelity map confirmed ("fine to proceed with where we're at"). Adding this principle to VISION.md §3 was proposed; VISION left unedited pending Naz.)*
The rule: a simplification is acceptable if it changes *how much* or *how fast*. It is not acceptable if it decides *who acts* or *whether a safeguard works*. Every liberty taken is recorded here, or in docs/behaviour/.
Proposed map:
- **~100%:** power and institutions (who decides, how decisions are carried out, procedures that can be bent, laws that can be broken, enforcement by entities); human levers (vote, petition, protest, move away, object); information (who sees what; every report has an author).
- **High:** nature and irreversibility (Stage 4).
- **Medium:** the everyday economy (jobs, rent, prices, work taking time).
- **Low (~10%):** the financial system, construction details, geography, transport, demographics.

**D26. Money: conserved tokens held and moved by banks (option B).** *(Naz, 2026-09-25.)*
Money is a conserved integer quantity, as before, and it is held in accounts **at banks**, which are entities in a world's config. The account holder instructs; the bank's seat (a code module by default, swappable, possibly AI) executes: payments, standing orders, refusals, freezes. **Debt and credit are fully supported** (Naz: "we still need to support debt and credit"):
- loans, mortgages (with a security claim over property), overdrafts, credit limits, interest and arrears are agreements plus paired financial claims;
- interest and repayment schedules are applied by the lender's seat, not computed by the kernel;
- default and repossession are acts by entities.

**The liberty:** lenders can only lend money they actually hold (their own funds or borrowed funds), so banks **cannot create money** by lending out deposits (no fractional-reserve money creation). Also out of scope: exotic instruments (derivatives, securitisation, traded securities markets). That's D25: the financial system is low fidelity. The alternative, money as claims on banks with credit creation (option A, stock-flow consistent), is recorded as a future upgrade if the research needs it. The money-conservation invariant stays.

**D27. CEL lives in TypeScript, not the kernel; library `@bufbuild/cel`, pinned.** *(2026-09-25; check in docs/research/cel-check/.)*
Statements' `formal` conditions are evaluated only by code-run institutions, the translator and measurement, never by the kernel (D19), so the kernel takes no CEL dependency. `@bufbuild/cel` 0.6.1 (Apache-2.0) passed every requirement: exact int64 via bigint, errors on overflow and division by zero, custom functions, a static allowlist over the standard syntax tree (no decimals, time or regex), determinism, ~1 µs per evaluation. Pinned exactly because it is pre-1.0; `@marcbachmann/cel-js` is the fallback.
*Revisit if* measurement needs to evaluate conditions in Python (use cel-python on the same syntax).

**D28. Contracts v0.2 approved.** *(Naz, 2026-09-25: "all is good.")* The eight choices listed in contracts/README.md ("What was decided while writing v0.2") are accepted, with one reservation (item 6, below).

**D29. Kernel reworked to contracts v0.2.** *(2026-09-25.)*
The kernel now implements physics plus records only. Mandates, typed rules, jurisdictions, the 19 audited laws and all law-specific refusal codes are gone. v0.1's invariant "no action bypasses a mandate" is **replaced** by "no act takes effect unless it's physically possible" (D20). Two new invariant tests guard the principle directly:
- `statements_have_no_power`: laws and instructions added to a world change nothing physical;
- `physical_feasibility`: an independent mirror and oracle of physics.

14 planted bugs, including two ways of sneaking law into the kernel, are each caught. The records' default visibility (who sees a record when its author doesn't say) is documented in contracts/README.md and tested in `tests/physics.rs`.

**D30. Behaviour lives in TypeScript code seats: citizens, and the people inside institutions.** *(Naz suggested it, 2026-09-25; follows from D23.)*
Citizens, bank payment systems, clerks, planning officers, inspectors, landlords and employers are code seats running swappable behaviour modules (content, cited in docs/behaviour/). They go through the same seat API as LLM and human seats (VISION principle 4), so any of them can be handed to an LLM or a human. Replay never needs their code, since their acts are logged commands. So that *re-runs* are reproducible too:
- modules draw randomness only from the run seed, via the same keyed-stream algorithm as the kernel (ported to TypeScript and checked against the Rust known-answer vectors);
- they read no clocks;
- their version and code hash are recorded in the log.

**D31. Money enters the world through the outside world's own seat.** *(Naz, 2026-09-25; amends contracts v0.2 in place, since v0.2 was approved the same day and nothing downstream depends on it.)*
v0.2 had a special rule, "the boundary's account can't pay", so no money could ever enter, and a town's economy could only drain. The rule is dropped. The outside world's account is held in its own custody, so ordinary custody physics already means only the outside world's own seat can pay from it. Boundary conditions (export demand, visitors, grants) are that seat's behaviour: world content with researcher-set parameters, not a kernel mechanic. Refusal code `boundary_protected` is kept with a narrower meaning: the outside world's edge account can never be *closed*, because the world's edge always exists (found by the physical-feasibility test: closing it made building impossible forever).

## Open (to decide at the Stage 2 checkpoint or before)

- **Construction payments must be fleshed out. Accepted only to unblock us** *(Naz, 2026-09-25: "not happy with this, but will accept it for now")*. In v0.2, `construct` and `demolish` pay materials and demolition costs straight from the builder's own account to the boundary. That skips the builder's bank (contrary to D26: money moves only when a custodian's seat moves it) and doesn't model suppliers at all. To return to it: have builders buy materials from supplier entities (possibly outside-world suppliers via the boundary) through ordinary bank-executed transfers, with materials as a physical stock that construction consumes, or through the work/process model (D24), where building is a task with inputs. Until then it's a documented liberty; see contracts/blocks.schema.json (`construct`, `demolish`). Known quirk: since materials are paid to the outside world, the outside world's own seat builds for free (it pays itself). Only a researcher-configured boundary module can do this; it disappears once construction payments are fleshed out.

- ~~Citizen behaviour in the Rust kernel vs TypeScript code seats.~~ **Resolved by D30.**
- ~~Which D15 laws become parameters.~~ **Obsolete** under D18/D19: there are no laws in the kernel; laws are records in a world's config.
