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

**D13. Resignation is always available and not configurable; every framing records a reason** (VISION §15). *(Refined by D38: what's always available is opting out of the study, which is distinct from resigning an office; what happens to the seat afterwards is configurable.)*

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
Statements' `formal` conditions are evaluated only by code-run institutions, the translator and measurement, never by the kernel (D19), so the kernel takes no CEL dependency. `@bufbuild/cel` 0.6.1 (Apache-2.0) passed every requirement: exact int64 via bigint, errors on overflow and division by zero, custom functions, a static allowlist over the standard syntax tree (no decimals, time or regex), determinism, ~1 µs per evaluation. Pinned exactly because it is pre-1.0; `@marcbachmann/cel-js` is the fallback. *(2026-09-30: the reader is now Rust, kernel/crates/law; `@bufbuild/cel` stays as its shadow check. See "The `law` reader is Rust" below.)*
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

**D32. A `records` channel's `involving` filter looks one hop through references.** *(2026-09-25; clarifies contracts v0.2's channel semantics.)*
A record involves an entity if it names it, if its author acts as it, or if it refers to a record that names it: a signature on its agreement, a withdrawal of its listing, a vote on its ballot. Found in M1: landlords couldn't see tenants signing their leases (a signature names only the signer), so every home looked vacant and was relisted forever. What a person would count as "involving me" includes these.

**D33. The kernel's state uses persistent maps, and observations read through a derived index.** *(2026-09-25; implementation only, no contract change.)*
Found scaling M1 to 1,000 citizens, where a year took 5.5 minutes, 95% of it in the kernel. Two costs grew with population *and* time:
- **Every act cloned the whole world state**, every record ever made included, so that a refused action leaves no trace (all-or-nothing actions). State maps are now `imbl::OrdMap` and the record order an `imbl::Vector`. Both are persistent, structurally shared structures: cloning is O(1), and an act copies only what it touches. Act time at 1,000 citizens fell from 5.4 ms to 0.2 ms.
- **Every records channel scanned every new record**, and channels without `new_only` scanned every record since genesis. A `RecordIndex` held beside the state (never part of it, never hashed) now lists records by record kind, statement kind and involved entity. A channel reads only its candidates, and the full filter still decides. Involvement is computed once, when a record is made; that equals looking later, since what a record refers to must already exist (D32). Account channels use a cached holder/custodian lookup.

**Verified:** on a 150-day town run, every event body in the log, observation hashes included, is identical to the version before; only the kernel build id in the header differs. All invariant tests pass. A 2-year run at 1,000 citizens takes about 170 s; at 200 citizens, about 21 s.

**Dependency:** `imbl` 7 is **MPL-2.0** (file-level copyleft). It's compatible with an Apache-2.0 project as an unmodified dependency, but it's the first non-permissive licence in the tree. Naz to confirm at the checkpoint. The alternative is an undo log in the executor, which is more invasive.

**Remaining costs, for the checkpoint:** the bank's `directory` channel resends the whole directory (~120 KB at 1,000 citizens) on every daily wake. Directories rarely change, so a refresh interval on `directory` channels (like `sites` has with `every`) would remove most of it. That's a **contract addition**, to be proposed. After that, what's left is broadcast data that's genuinely public (listings and their withdrawals, which every house-hunter sees) and per-entry log hashing.

**D34. Language-model seats are built and tested against a mock adapter for as long as possible.** *(Naz, 2026-09-26.)* The whole M2 loop (reports, proposals, the translator, contract and physics checks, law warnings, sign-off with draft hashes, provenance, usage and transcripts, debriefs, resignation) runs without a real model; see docs/design/m2-llm-participants.md. The mock seat has a code brain (for the mayor, the all-code control's module), so a mock-LLM town behaves like the all-code town, and only language understanding is faked. No API key, budget or real call until Naz raises it.

**D35. The platform is invisible to seats, and the translator is abstract.** *(Naz, 2026-09-26.)* Seats experience their world in world terms, never the machinery: no blocks, records, channels, physics checks or refusal codes in what they read. No platform component gets an in-world identity. I proposed presenting the translator as "the mayor's office"; rejected, because the translator is abstract, and with many AIs in many seats none would go through one seat's office. Any in-world role (staff, advisers) is world content: a real seat. Natural language stays: no tool menus for language-model seats. See docs/design/translator-and-resolver.md, P1–P3.

**D36. Language → call → acts: a general translator and a deterministic resolver.** *(Naz, 2026-09-26; design note awaiting sign-off before building.)*
- **Translator:** turns language into a call in a function-call language whose functions are physics outcomes (money, structure, occupancy, …), not human verbs. It has no world knowledge and does zero arithmetic.
- **Resolver:** deterministic, on the platform side (not in the kernel). It turns a call into the seat's *own* acts. It asks whoever physically must act (e.g. a bank) rather than acting for them. It never chooses how: the seat supplies the inputs (funds, permit, contractor). It uses only what the seat knows.
- **Forms:** institutions publish the forms they expect.
- **Preview (option B):** a neutral, mechanical preview before anything takes effect. The translator's summary is dropped.
- **Code seats** act through the same calls.
- **Coupling:** kernel, call language, translator and resolver are versioned together.

Full detail, including every point settled in discussion: docs/design/translator-and-resolver.md.

**D37. Contract additions: `Observation.notices`, `Framing.debrief_text`, `Channel.title`.** *(Naz, 2026-09-26: "make these contract additions"; "sure" to channel titles.)* All three are optional and additive. They were first amended in place in v0.2, then moved into v0.3 (D40).

**D38. Opting out is not resigning.** *(Agreed, 2026-09-26.)* Resigning office is an act in the world (a published resignation, with consequences the world's charter sets). Opting out of the study is a platform exit: always available, recorded as a welfare outcome, never failure. What happens to the seat afterwards is set per world. The contract rename (`resign` → `opt_out`) is proposed in the design note, §15.

**D39. A local translation model is the direction; not trained yet.** *(Naz, 2026-09-26.)*
- **What it is:** a tiny open-weight model (~60–250M parameters, perhaps up to ~1B) mapping language to calls, with constrained decoding and deterministic CPU inference. It runs in milliseconds, and is pinned and recorded in every log.
- **Before any training run:** freeze the call language and forms encoding, the failure labels, and a hand-checked test set with its pass threshold. Also settle the base model's licence (weights are redistributed under Apache-2.0), the runtime, and the data-generation terms of use.
- **Training data:** our own runs' acts as labels; model-written requests from several providers; Naz's manual translations; negatives for every failure label.
- **Until then:** the translator stays behind the adapter and emits the same calls.

See the design note, §16.

**D40. Contracts bumped to v0.3 (draft).** *(Naz, 2026-09-26: "bump to v0.3".)* Following the versioning rule rather than amending in place again (as D31 and D37 did), v0.3 is opened now as a draft. It holds D37's additions today, and D36's contract changes when they're signed off; it's frozen then. Schema ids are `urn:terrarium:contracts:0.3`, and configs and log headers say `"0.3"`. A v0.2 log header is now an invalid example. v0.2 logs replay only on a v0.2 kernel build (D6).

**D41. The translator, resolver and in-world seats are built.** *(Naz signed off the design, 2026-09-26: "signed off, go ahead and build it".)*
- Contracts v0.3 (draft): the call language; outcomes, requests and forms; drafts and provenance with the call and resolver; `basis` on agreements; confirmation modes; `resign` renamed `opt_out` with `on_opt_out`.
- Every code seat acts through calls, and the bank reads requests. The planning office publishes its form.
- Language seats read and act in world terms, confirm mechanical previews, and can opt out, with an optional stand-in.
- What building it refined is recorded in docs/design/translator-and-resolver.md, §21.

**D42. Perception is changes, not snapshots.** *(Naz, 2026-09-26: "architecturally this does not seem scalable at all… we can substantially improve this + make it more general".)*
- **The problem:** every observation used to be a snapshot, re-sent, hashed and logged in full. So cost grew with the size of what a seat could see, not with what happened: the bank got its whole ledger and the whole directory every day.
- **Now:** every channel delivers only what changed within its scope since the seat's last look through it. The kernel keeps change stamps on accounts, parcels, entities and seats, closed-account tombstones, and per-channel cursors. All of it is hashed state, so it replays exactly.
- **Views:** the seat runtime keeps each seat's view (`participants/src/view.ts`) and hands its controller the current picture, so modules and the renderer are unchanged.
- **`new_only` is gone.** `every` becomes a perception cadence for any channel.
- **Invariants:** a kernel test (and a mutation check of it) proves that a view built from looks equals the full picture, over random worlds; a runtime test checks the same on a real town.
- **Results unchanged:** a 2-year, 200-citizen run has the identical final state. At 1,000 citizens, two years now take ~112 s, down from ~206 s.
- **Considered and not taken:** a refresh interval on the directory (stale, and useless for balances); stamping records with the author's true entity (defeats forgery for every reader); a database (it wouldn't change what's re-sent; a database belongs in measurement, and later as an on-disk archive for very long runs; see the note below).

**Database, noted for later (from the same discussion):** DuckDB over Parquet for measurement, built with M3. An on-disk archive for old records (SQLite or an embedded key-value store) with incremental hashing, once run lengths reach tens of millions of records.

**D43. Perception follows attention.** *(Naz, 2026-09-26: "every citizen does not need to see every house listing… each entity, just like the real world, has a map in their mind of the world".)*
- **The frame:** a seat's view is its mental map, and the platform gives general ways for maps to differ:
  - reach (channels, visibility, involvement);
  - sources (every record has an author);
  - attention (cadence, and now looking on request and searching);
  - position (proximity, word of mouth: see D44);
  - memory (views never forget, for now).
- **Built:** `on_request` channels; a `look` action and command; searches over any records channel (standing, conditions on named fields, order, limit). A search returns what matches now. It's mechanical matching: the kernel never learns what a field means. No world vocabulary is involved; the kernel's tests use a generic noticeboard.
- **In the town:** citizens search the housing and job markets only when hunting, and glance at the petitions board. The broadcast market and withdrawals channels are gone. Language seats get a `look` tool for their on-request reports.
- **Also found:** a landlord double-let (a relist in the same plan as the letting; no free-home check before offering), fixed in the landlord module.
- **Results:** the economy is in line with before (leases 197 vs 192, move-ins 194 vs 190, departures 54 vs 57). At 1,000 citizens, two years take ~68 s, down from ~112 s.

**D44. Position: what you can see depends on where you are.** *(Naz, 2026-09-27, on the position discussion: word of mouth as content, not a kernel mechanic: "yes"; occupant names hidden from outside by default: "yes"; proximity and placed records first, then word of mouth: "yes this makes sense".)*
- **The split:**
  - Proximity is physics: where you are decides what you can physically see. It's in the kernel.
  - Word of mouth is people telling people: the delay is when you next see them, and the distortion is what they chose to say and how well they remembered it. That belongs to the teller. A kernel mechanic that passed things along ties with a delay and a distortion rate would be a game rule (the same mistake as laws in the kernel), and it would hide the hand-offs that measurement wants to trace. So it becomes behaviour, over the `message` block that already exists. There's no "tie" concept either: relationships are already in the world (sharing a home or workplace, being near, agreements, past messages).
- **Built (kernel and contracts v0.3):**
  - **Places:** an entity is where it occupies a building. Nothing new is stored beyond a `moved` change stamp on the entity; an organisation that occupies nothing has no position, and nothing is near it.
  - **Distance:** the gap between parcel rectangles (0 when they touch), straight-line, in the world's own units. The kernel never knows what a unit is. Computed exactly in integers.
  - **`area: { near: N }`:** for sites channels and, newly, records channels. It covers the parcels within N of any of the entity's places, and moves with it. After a move, the next look delivers the whole of the new surroundings, flagged `whole`, and the view replaces the old picture. What was seen of the old street is memory, a separate axis (D43).
  - **Placed statements:** `publish` takes an optional `place` (a parcel): a sign, a notice on a fence. A placed statement, and its withdrawal (taking it down, where it was), is seen only through channels whose area covers the place, and by whoever put it up. A channel without an area sees what isn't placed anywhere. The kernel checks only that the parcel exists. Whether it may be put there is for the world's laws. Searches respect the area.
  - **Occupants:** from outside a building a seat sees how many are in it, per slot, not who. It sees who in the buildings its own entity occupies (a household, a workplace), and wherever a channel is configured with `occupants: "names"` (an owner's inspection, a register). That's reach, set per channel.
  - **The call language:** `statement(…, on=<lot>)`. The resolver passes the id through, like `structure(on=…)`, and the preview reads "You will put up a notice on p1: …". Language seats see placed records as "put up on p07-03", and a handful of lots one by one (what's on each, who's there where they can tell).
  - **Standing searches never return withdrawals themselves** (found while testing: a withdrawal is never withdrawn, so it "stood"). A takedown isn't something that's still up.
- **In the town (generator 0.8.0):** citizens get an "Around you" channel: the lots touching where they live and work, with their household and workmates by name. Code citizens don't act on it yet; it's the physical ground that word of mouth builds on. Landlords, the inspector and the mayor now see occupancy as counts; none of them used names.
- **Tests:**
  - `kernel/tests/position.rs`: distance, near views, counts vs names, a move bringing the whole new surroundings, placed notices seen by being near, a search near the seat, an unknown place refused.
  - The perception invariant (random worlds) now includes near channels and placed notices. A mutation that ignores moves fails it.
  - The runtime perception test checks every citizen's surroundings after every look in a real town, and requires that moves happen. A View that ignores `whole` fails it.
- **Results:** the 2-year, 200-citizen economy is identical to D43's (the citizen doesn't read its surroundings yet). At 1,000 citizens two years take ~67 s (was ~68 s).
- **Documented liberties (proportional fidelity):** no movement through the day (you're at home and at work at once), no line of sight or noise, and no travel time or cost to go and put a notice up somewhere. Each can come back when a scenario needs it; a protest in a public square is the obvious trigger. You also can't yet come to know a neighbour in another building by name: that would be an act (introducing yourself), which is the word-of-mouth step.
- **Revisit if:** a scenario needs presence in public space, or travel costs matter (placing notices far away becomes a real strategy).

**D45. Word of mouth is citizen behaviour.** *(Naz, 2026-09-27: "yes, go ahead"; figures are initial test configuration, not baked in.)*
- **What it is:**
  - Citizens who start hunting ask the people they share, or shared, a home or workplace with.
  - Those people name a building where they can see room.
  - The seeker searches that building's listings or postings first.
  - All of it is ordinary messages, the teller's `re` naming the building. The platform passes nothing along and has no notion of a tie.
- **Figures are content.** They're the citizen module's parameters, with sourced defaults, set per world in its config. Inputs are what people do: whether they ask (37% for homes, 69% for work, sourced), whether they pass a lead on (a placeholder). Aggregate outcomes are calibration targets to measure and compare, never parameters: the share of jobs found through contacts (about half, 30–60%).
- **Nobody tells more than they could know.** A runtime test checks every tip names a building the teller could see around it then (mutation-checked).
- **Results:**
  - 18% of move-ins follow a tip.
  - Hires almost never do, far below the job target. Reasons and remedies are in docs/behaviour/citizen.md; it's calibration work.
  - The economy stays in line: 191 leases vs 197, 55 departures vs 54.
  - Zero refusals at 200 and at 1,000 citizens: the old `not_present` refusal is gone, because citizens now see whether they're in their workplace.
  - At 1,000 citizens two years take ~73 s (was ~67 s): asking around wakes the people asked.
- **Revisit if:**
  - calibration needs employers to favour referrals;
  - leads need remembering and re-checking;
  - job seekers need to approach employers directly (the commonest method in the CPS);
  - language-model citizens arrive (they'll speak and understand freely).

**D46. M3: batch runs, measurement and the cost report.** *(Naz, 2026-09-27: "yes, go ahead with M3".)*
- **Batches:**
  - `terrarium run <world> --seeds N` runs each seed in its own process (with its own kernel), several in parallel.
  - A test checks a batch run is identical to the same seed run alone. Seed 1 of the 1,000-citizen batch also has the same final state as the earlier standalone run.
  - Seeds vary randomness, not the world.
  - `--set path=value` overrides the world file.
  - `batch.json` records what ran.
  - Guide: docs/measurement.md.
- **Measurement (`measure/`, DuckDB over Parquet, as D42 noted):**
  - Logs are exported to plain-fact tables, one Parquet file per table per run, so a batch is a folder DuckDB reads together.
  - Standing queries are SQL files with a description line. Generic: overview, activity, refusals, usage, language seats. Town-specific: economy, word of mouth.
  - Measurement lives outside the world and reads only logs.
  - DuckDB is `@duckdb/node-api` (1.5.5), which works under Bun. It's the platform's first native dependency, confined to measurement.
- **Cost report:**
  - Two figures, never mixed. *Recorded* is what was spent, priced when each call was made.
  - *Projected* is what the same calls would cost on each seat's configured model, at published prices (`orchestrator/prices.json`: claude.com/pricing, retrieved 2026-09-27).
  - While seats run on the mock, the report says why the projection is an order of magnitude: estimated tokens, short mock replies, the code brain's pace, and no caching.
  - The translator's model isn't set by any world, so it's priced as the seats' model or `--translator-model`. If worlds should name it, that's a proposed contract addition (orchestration), not made.
- **`worlds/town-1000.yaml`:** Stage 2's scale (the town five times over).
  - `--set citizens=1000` on town.yaml gives 1,000 people 175 homes, and most leave.
- **First batches** (five seeds, two years, 1,000 citizens; all-code and mock-LLM mayor; results in docs/measurement.md):
  - About 2 minutes a batch, and a full-size log replays byte-identically.
  - The two batches are close to each other, as they should be: the mock mayor's brain is the code mayor.
  - The projected cost of the language-model mayor at Sonnet 5 prices is about $0.70 per run.
- **Revisit if:** runs outgrow memory or disk (logs are about 260 MB per 2-year, 1,000-citizen run; the measurement tables about a tenth of that), or real adapters arrive (usage is then a provider's count, and the projection becomes a check).

**D47. Contracts v0.4: a world whose cast and land can change (Pass A: the platform, and the town rebuilt on it).** *(Naz, 2026-09-27: "design and build it all now"; "participant is fine, and yes overcrowding possible, go ahead and build"; "be extra vigilant to not video-gameise". Design: docs/design/v0.4-cast-and-land.md. The contract details are built and tested and await Naz's review.)*
- **Why:** the Stage 2 checkpoint found no world could have migration, births, new firms staffed by new people, elections that change who holds office, or land development: the cast and the lots were fixed at genesis.
- **What's in (contracts, kernel, runtime, translator, measurement):**
  - Seats became **participants** (people or systems; templates create them mid-run), acting as themselves or in **positions** only their organisation can create and fill.
  - **Bodies and life physics:** arrive and leave only through the boundary (deportation physically possible), birth, illness, accidents and harm drawn from the world's tables, death. Basic, and marked for expansion (design note §4).
  - **Land:** cells with terrain, footprints, buildings made of **spaces** with a physical capacity and the world's attributes (bedrooms). Lots are registry records. Overcrowding is physically possible and measurable, never blocked.
- **Choices made while building (please review):**
  - **Capacity is on the action, not on each call function.** The design note (§9) had every call function take an optional `as`. One program is one act, and the kernel's act command takes one capacity, so `as` sits on `act`, `call`, `propose` and `message`; a language-model participant names the post in its `do` and `write` tools (in world words: "the post you're acting in"). A post it doesn't hold is a malformed tool use, like any other.
  - **The resolver fills only single physical answers for land and space.** On a lot, the one corner cell from which the type's footprint fits the lot's open ground (the kernel's terrain rule mirrored), otherwise it asks which cell. In a building with one space, that space; otherwise it asks which. The design note's "the one space it holds a claim to" isn't done: leases now name the space itself, so it wasn't needed.
  - **New call functions:** `presence`, `birth`, `harm`, `position`, `system`, and `entity(position=…)`. `harm` exists because the physics does; no code citizen commits violence (that needs its own sourced behaviour, recorded as future work).
  - **Formal law sees `block.cells` and `block.lot`,** supplied by whoever evaluates (the translator's warnings from what the participant knows; the inspector from its survey and the registry). Laws speak of lots and cells; the kernel still never evaluates them.
  - **The builder's office sees the registry's lots and surveys the ground weekly,** so it knows where on a lot a building goes. Content, in the generator.
  - **Measurement 0.2.0:** tables `participants`, `entities`, `positions`, `appointments` and `life` replace `seats`; occupancy is by space (with its structure and kind split out); acts, commands and messages carry `participant` and `as`; records carry `in_position`. New query `cast`. `language-seats` became `language-participants`.
- **Checked:**
  - Every test passes: kernel (including the physics oracle with bodies, spaces and holders, and statistical checks of life against its tables), contracts (127), TypeScript (176).
  - **The town on v0.4 behaves like v0.3** (five seeds, two years, 1,000 citizens, all code): leases 978–1,010 per run (v0.3: 977–992), departures 229–235 (229–245), 20–22 constructions (20–22), about $1.32–1.35m paid to the town (1.24–1.37m). About 2 minutes a batch, as before.
  - **The mock-LLM mayor batch matches too:** 8–11 drafts per run, all confirmed; 621 model calls (v0.3: 633); projected $0.71 a run at Sonnet 5 prices (v0.3: $0.69). Two regressions were found and fixed on the way:
    - The first v0.4 build woke language-model participants on every record naming their organisation (each tax report to the city). That was 3,426 calls and $4.25 a run. v0.3 woke them only on their cadence and on letters, as the orchestrator's own header said. That's restored: a mayor reads the office's filings on their own schedule, and a stream of filings must never drive a model's cost.
    - "Who's who" listed all ~70 posts, every letting office and shop manager included. It now lists posts with a public role (as v0.3 listed office holders), names holders rather than internal ids, and counts the rest.
  - **Refusals went from 0–3 per run to none.** v0.3's were a new tenant moving in before the old one had left. A dwelling now holds up to six bodies, so that overlap is physically possible, as it is in reality.
- **Not yet (Pass B, content):**
  - households, and leases naming them;
  - the occupancy standard (bedrooms needed) as households' and landlords' behaviour;
  - sourced life tables, illness and occupational injury for the town;
  - fertility behaviour;
  - migration (Harris–Todaro) run by the boundary;
  - templates for newcomers and children.
  Until then the generated town has no `life` section: nobody is born, falls ill or dies, and the `cast` query shows zeros.
- **Revisit if:**
  - acting in two capacities in one act turns out to be needed (a person signing for a firm and personally guaranteeing it);
  - corner-filling on lots proves too literal for developers assembling land (they'd name cells);
  - the per-capacity views get expensive for participants holding many positions.

**D48. Households (Pass B, content).** *(Naz, 2026-09-27: "really need to nail that down"; "if a house has 2 bedrooms, probably can't have a family of 6 in there… need some kind of simple mechanism for that, nothing too crazy". Details: docs/behaviour/households.md.)*
- **What:**
  - A household is a record (kind `household`): its members (birth date, sex, how to reach them), its couples, and who holds the lease.
  - The starting town is drawn from ABS Census 2021 household shares and AIFS children-per-family shares.
  - Homes are units with bedrooms, with a generous physical capacity (2 per bedroom plus 2).
  - Households look for the bedrooms the **Canadian National Occupancy Standard** asks for (as the ABS applies it), within a third of household income, and accept fewer after hunting long enough.
  - The leaseholder applies, signs and brings the children; the other adults move when told, and pay an even share of the rent to the leaseholder.
  - Landlords turn down households with more than two people per bedroom (a policy parameter).
  - A child turning 18 opens a bank account (the bank now opens accounts on request) and looks for work.
  - Measurement counts overcrowding with the same standard (`town/households`, with a new `spaces` table).
- **The "nothing too crazy" mechanism:** physics only says how many bodies fit. The standard is what households and landlords choose by, and what measurement counts. Overcrowding happens when housing is short, and is measured, never blocked.
- **Checked** (1,000 people, five seeds, two years):
  - about 405 households (sizes 1–5: 25%, 35%, 16%, 17%, 7%; mean 2.5, as the census);
  - no household ends split, bar a few caught mid-move in the run's last week;
  - 5–15 unhoused and 2–8 overcrowded per run;
  - no refusals.
  - **About 45% of households have two or more spare bedrooms.** Households take the dearest home they can afford (the BoE rule: rent stands in for quality), so couples rent four-bedroom houses. A finding to calibrate against renters' actual bedroom use, not tuned away.
- **Two choices to review:**
  - **Sex is a trait, not physics.** The occupancy standard and fertility need it; the kernel's bodies don't model it. People carry it as a trait (`sex`), and households record it. A newborn's is drawn by the kernel from the template.
    - For that, **template traits gain `{"pick": {value: weight}}`** (a categorical draw) beside `{"uniform": [lo, hi]}`. It's an addition to the v0.4 draft, tested for its shares.
    - Whether sex should become a body attribute, so birth checks who can bear a child, is a contract question for you. Until then, the kernel lets anyone of fertile age give birth, and only behaviour restricts it.
  - **A newcomer's age is required** by the resolver's `presence` call. It asks "How old is …?" rather than sending an act physics will refuse.
- **Not yet** (households.md): partnering and separating, adult children leaving home, succession when a leaseholder dies, moving early to fit a grown household, flatmates leaving on their own, renter-specific shares, retirees.
- **Revisit if:** renters' bedroom use (ABS *Housing Occupancy and Costs*) shows the spare-bedroom share is far off, or language-model citizens make the code phrasing between household members a bottleneck.

**D49. Life and migration in the town (Pass B, content); births wait on a contract question.** *(Naz, 2026-09-27: violence, accidents and illness "very basic, but would be good if it's in there with a note to expand"; arrivals only through the boundary. Details: docs/behaviour/life.md, docs/behaviour/boundary.md.)*
- **Life** (the town's `life` config):
  - **Deaths:** from the ABS life table 2021–2023, by single year of age, male and female averaged, since bodies don't model sex. Life expectancy from the table as set: 82.9.
  - **Illness:** an overnight hospital stay. A placeholder shaped by AIHW's age gradient; to replace with AIHW's age-specific overnight rates.
  - **Injury anywhere:** 2.1% a year (AIHW).
  - **Injury at work:** factories 1.6%, shops 1.2% a year (Safe Work Australia serious claims).
  - **No death is counted twice:** illness and injury are set not to kill, and the life table covers all causes.
  - **Harm:** not set until there's a sourced severity table.
  - **Observed** (1,000 people, two years): 1–3 deaths, 80–103 illnesses, 34–42 injuries per run, as the rates imply. Nobody acts on a condition yet (sick leave, succession after a death: life.md).
- **Migration (`world.migration`, held by the outside world's `migration` position):**
  - Harris–Todaro: households come when the town's expected wage beats income elsewhere. The expected wage is the mean posted wage times the chance of a job (postings against recent newcomers).
  - Newcomers are drawn from the census shares, bring savings in their own keeping, and bank them: the bank opens accounts on request, and citizens deposit money they hold themselves.
  - It writes the newcomers' household record.
  - **Observed:** on the 1,000-person town almost nobody comes, because locals out of work fill postings within the month. With vacancies standing, households arrive and settle (a test).
  - The outside income and response rate are placeholders to calibrate against ABS regional internal migration.
- **Births: waiting for Naz.** A newborn's sex is needed by the occupancy standard (and a household records its children). With sex as a trait, the parent can't know it.
  - **The clean fix is physical:** bodies get an optional `sex`. The kernel draws a newborn's from a world sex ratio (`life.birth`), birth checks who can bear a child, and a parent sees their children (and their sex) in their body's view.
  - That's a contract change (world-config entities, `life.birth`, the Observation's `body`), so it's proposed here, not made.
  - Once decided: fertility behaviour from ABS Births age-specific fertility rates, a child template, parents bringing a newborn home and updating the household record.
- **Revisit if:** the town needs deaths by cause (set `fatal_bps` and subtract from other causes), or migration's placeholders prove far from ABS internal migration rates once calibrated.

**D50. Every code act says why; records cite what they rest on.** *(Stage 2 checkpoint, decision 4: "code modules name the rule that fired, and institutions use `basis` for the record they act on", recommended before Stage 3.)*
- Each code act carries `reasoning`: the rule that fired, with its numbers. `because(...)` in common.ts; no contract change (acts already had it).
- Applications cite the listing or posting (`basis`); offers cite the application; everything else already linked or has nothing to cite (a shopping payment, a listing).
- Reasons are built with deterministic formatting (no locale data), since they're hashed into the log.
- **Measured** (town.yaml, 2 years): 100% of acts have a reason (up from 0%); 27% of records made during the run cite a basis. The rest have nothing to cite: one-off payment requests, listings and postings, reports. Signatures, withdrawals, votes and notices link through what they refer to.
- **Revisit if:** the log grows too much (each act gains a sentence), or the renderer's trace needs reasons as structured data (a rule id and its inputs) rather than words. That would be a contract addition.

**D51. Sex is physical; children are born.** *(Naz, 2026-09-28: "yes" to sex as physics, D49's proposal.)*
- **Contracts (v0.4 draft):**
  - A person's body has an optional `sex`, female or male: given in the config or on arrival, drawn at birth from `life.birth.female_bps`, and reported on `person_created`.
  - Where bodies have a sex, only a female body bears a child, and a named other parent is male (`not_fertile` otherwise).
  - A body records its children, and a person sees them in their body's view (`children`: person, born_at, sex, alive).
  - It's physics only (who can bear a child); gender and identity are content.
  - The categorical trait draw (`pick`, D48) stays, as a general feature; the town no longer uses a `sex` trait.
- **Kernel:** a newborn's sex is keyed by the id they're about to get, so two births at the same moment draw independently. Tests: the biology rules, parents seeing children, and the sex ratio over 1,500 births.
- **The town:**
  - `life.birth`: 15–49, 266 days, same place, 48.59% female (ABS Births 2024).
  - Women conceive monthly at a twelfth of the ABS age-specific fertility rate, with their partner only when he's at home.
  - The mother brings the baby home and adds them to the household's record.
  - Generated children record their parents; newcomers' don't.
  - **Observed:** about 10 births per run of 1,000 people over two years, all housed within days where the mother has a home, with no refusals.
- **Revisit if:** partnership status should change the rates (most births are to couples), or twins, miscarriage or contraception choice become research questions.

**D52. A light calibration of voice, and calibration targets with their sources.** *(Naz, 2026-09-28: "see if we can calibrate now, but no need to go too deep"; "document where we got these numbers from".)*
- **Voice:**
  - Only people who sign petitions at all do so: 44%, drawn once per person (Australian Election Study 2016: 44% had signed a written petition in five years).
  - One tenants' petition now reaches 21–38% of adults over two years, down from ~99%.
  - When petitions start isn't calibrated: the genesis town has rent-stressed tenants, so one starts on day 0–1.
- **docs/calibration.md:** every target, its source, what's comparable, the measured value and the gap.
  - Includes ABS *Housing Occupancy and Costs* (20.2% of income on rent, and 58% of lower-income renters over 30%).
  - A new `town/rent-stress` query: median 27%; 31–34% of households over 30%.
  - Targets are outcomes to compare against, never settings to tune by hand.
- **Revisit if:** petition-signing evidence specific to local or tenant issues is found, or the AES figure is confirmed against its own tables.

**D53. Ready for a real model: adapters, a spending limit, and the translator's test set (no calls made).** *(Naz, 2026-09-28: "I want to keep inching as much as possible toward running it with a real LLM".)*
- **Adapters:**
  - `AnthropicAdapter` (Messages API);
  - `OpenAICompatibleAdapter`: OpenAI, or a local open-weight model behind Ollama, vLLM or LM Studio, which also meets V0's "one open-weight model".
  - Both retry rate limits and server errors, and are tested with a stand-in network.
- **`--model provider/model`, and a required `--budget` per run** for a model that costs money:
  - the worst case of every call is checked before it's made;
  - a run that would exceed the limit stops and says why;
  - 5% is kept back for debriefs.
  - No call is ever priced from a guess: a model needs a published price in prices.json.
- **The translator's test set:** 26 cases, 6 held out; `terrarium translator-eval`. The adoption threshold is Naz's to set.
- **The translator's glosses** now cover every call function (presence, birth, harm, position, system were missing).
- **Guide:** docs/real-models.md.
- **Revisit if:** providers' usage reports differ from what we record (reconcile against their dashboards on the first real run), or a run needs a separate model for the translator (`--translator-model` is only a cost projection today).

**D54. Deaths are seen, reported and acted on.** *(Naz, 2026-09-28: "yes to fixing deaths"; the problem: a dead person's rent and wage orders kept paying, nobody took over the lease, jobs were never refilled, and orphans were stranded.)*
- **Physics (contracts v0.4 draft):** a space keeps its last five departures (who, why: left, removed, died, …, when). A sites channel that shows who's in a space shows them (`left`). It's perception of a physical fact, like who's at home. Tested in the kernel.
- **Content:**
  - the household's first surviving adult reports the death and writes the household's new record (partner or eldest adult as leaseholder);
  - a lone person's landlord reports theirs (landlords now see their own buildings by name);
  - the registry (`city.registry`, after Victoria's BDM) registers it;
  - the bank stops the dead person's payments and settles the estate under a new `law-succession` (partner, else adult children, else the town);
  - employers stop wages and end the job; landlords give notice;
  - a child left with no adult asks for help and child protection (`city.child_protection`) takes them into care elsewhere.
- **Observed:**
  - With forced mortality, deaths are registered within days. Estates go to partners, or the town. Nothing leaves a dead person's account except the estate, wages stop, and a child alone is taken into care. No refusals.
  - At normal mortality, 1–3 deaths per 1,000-person run; those with no home go unreported.
- **Simplifications to revisit:**
  - estates settle at once (no probate);
  - minors don't inherit (Victoria holds their shares in trust);
  - a household member can't take over the tenancy;
  - care is outside the town;
  - the registry takes reports on trust.

**D55. Welfare defaults for model-run people.** *(Naz, 2026-09-28: "yes to ai welfare".)*
- **Violence withheld by default:** `harm` exists only in a world that sets `life.harm` (the generated town doesn't). A world that offers it to language-model people is flagged in the run's log.
- **Illness and injury are told plainly,** as facts of one's own body; a study that doesn't need them can leave them out.
- **Death:** the participant is debriefed if its framing says so. Whether to warn a model-run person that its body can die is decided per study, in its framing.
- Detail: docs/design/m2-llm-participants.md, Welfare.

**D56. The translator retries once, with what went wrong.** *(Naz, 2026-09-28: "yes add a retry".)*
- A request the translator can't turn into a working call gets one more attempt in the same exchange, with the problem as feedback. That covers a none(...) answer, a call that doesn't parse, and a question from the resolver. It may answer none(...) again when that's right. The participant hears only about the last attempt.
- **Why:** in the pilots, luna refused plain requests often enough that the mayor spent a sol call rewording each one; one tenancy law took five tries. A retry costs one luna call.
- **Recorded:** every attempt is an ordinary model call in the log, and each retried attempt is a `note` annotation (`translation_retry`: attempt, call, reason). A run's retry rate is measurable, and the attempts and feedback are training data for the translator model.
- **Revisit if:** the trained translator makes retries rare, or a study needs a one-shot translator (`attempts` = 1).
- **P3 amended** *(Naz, 2026-09-28: option (a))*. The feedback is what the resolver said: the participant's own knowledge (P8), like a compiler's error. The alternative, sending only the failure label, would have kept the translator's input to the request and forms.
- **Effect not yet measured:** luna varies too much from run to run on the 26-case set to separate the retry's effect (before: 15–18/20 seen, 2–3/6 held out; with it: 16–18/20, 3–6/6). One risk seen: on a request that needs arithmetic, the retry once pushed luna to write a partial call instead of refusing correctly.

**D57. Modules know the world only through perception and their own parameters.** *(Naz, 2026-09-28: "yes fix".)*
- **Found:** code participants read the world's config directly: the code mayor and landlords read the catalogue for prices, the builder read materials costs, a landlord read every account in the world, and citizens read the calendar and birth physics. It broke P14's promise that code and model seats "differ only in what they decide": they also differed in what they knew. It caused pilot 3's gap, where the code mayor knew a park's price and the model mayor couldn't.
- **Now:** the module context has no world config (`WorldInfo` is only the clock's grain and the run's end), and a test fails if a behaviour module reaches for it.
  - The builder gets its materials costs as its own parameters and **publishes a price list**; everyone else reads prices there.
  - Genesis leases say which account the tenant pays from, as a real tenancy ledger would.
  - Citizens get the calendar, whether births happen and the gestation period as parameters.
- **Rule for new modules** (and the municipal economy): what a participant knows comes from what it perceives, or from parameters in the world config that stand for its own knowledge or traits, visible in the config like a model seat's framing.
- **Revisit if:** a fact is genuinely public and everywhere (a calendar). Publish it as a record everyone perceives, rather than reopening the config.

**D58. A foundation for scale: contracts v0.5.** *(Naz, 2026-09-28: "yes to all twelve, go ahead with phase A".)*
- **The frame** (docs/design/foundation-for-scale.md): the platform carries a household to a grid of worlds, tens of people to billions, hours to centuries, many AI stewards and humans, and worlds from generators or real data. Each run chooses its resolution. The town is the first instance and the test fixture.
- **Approved, all twelve decisions of §9:**
  1. the frame;
  2. places as a tree, each detailed or summarised;
  3. cohorts, tested by statistical equivalence;
  4. conserved resources and state variables, retiring the materials liberty;
  5. work as a kernel act;
  6. amounts as decimal-string integers with units;
  7. several boundaries;
  8. same-moment wakes observe the same state, with acts applied in participant order;
  9. humans as participants (designed now, built in phase F);
  10. real-data seeding (synthetic people only; licences and provenance recorded);
  11. "one hash chain" becomes "one root";
  12. the order of work, with the municipal draft as phase C's instance.
- **Contracts bumped to v0.5** (the versioning rule, D40). **Phase A** (cheap now, painful later) lands first: amounts and units, several boundaries, the places tree with the town as one detailed place, and the same-moment rule. Each lands with the town unchanged in outcome, or the difference explained.
- **Money landed** (phase A, step 1): amounts are decimal strings with currencies; the kernel counts in 128 bits. A two-year town run on seed 1 has identical outcomes (economy, households, rent stress, cast, activity), identical event counts and identical money moved ($36,038,760.15) before and after. **Liberty:** TypeScript behaviour code does its arithmetic in ordinary numbers, exact to 2^53 (about $90 trillion), and throws beyond it rather than rounding. The wire, the kernel, the log and measurement (HUGEINT) are exact to 38 digits. A module that needs more works in bigint.
- **Several edges landed** (phase A, step 2): `world.boundaries`; arrivals and departures record their edge. The kernel's test world now has two edges (`outside`, `upriver`), so the property tests (conservation, physical feasibility, replay) exercise trade, arrivals and departures by either one. The deterministic "the cast changes" check now takes the union of four fixed sequences, since one sequence's reach shifts whenever the test world changes. The town: identical outcomes, events and money moved.
- **Places landed** (phase A, step 3), **revised from the design:** rather than scoping ids by place, the ground is one plane and places are nested areas on it, with cells only inside detailed places. That's how real geography works, and how the ABS's areas are drawn. Nothing is renamed, distance works across places, and a summarised region the size of a country costs no cells. `kernel/tests/places.rs` covers a 1000 × 1000 region with a detailed town and village and summarised farmland: only 18 cells exist, building happens only on detailed ground, a channel sees a place's detailed cells, and malformed trees are refused. The town is one detailed place: identical outcomes, events and money moved.
- **The same-moment rule landed** (phase A, step 4): at each simulated moment, everyone waking observes before anyone acts, all decide (model calls concurrently), and their acts are carried out in key order; those whose wakes go on look again in the next round. Model-call annotations made while deciding are held and written in key order, so the log doesn't depend on which call returned first. The spending limit now reserves each call's worst case while it's in flight. A test makes the rule visible (a slow mayor and a quick planning officer: neither sees the other's letter in round 1, both do in round 2, and the log is in key order).
- **Found while building it:** a wake set in the past (a participant created mid-run starts at 0) must count as due now. Missing that hung a two-year run at day 691 with no sign anything was wrong, which led to the reliability work (D59).
- **What changed in the town (5 seeds, 2 years):** the economy, rent stress and cast are unchanged within noise (leases 92.6 → 92.4, move-ins 245.6 → 245.2, paid to the town $148,541 → $164,297 with a spread of ±$26,139). Households at the end differ: more partly housed (0.6 → 2.8) and overcrowded (0.4 → 2.0), fewer unhoused (2.2 → 0.8). Members used to follow a leaseholder within the same moment by reading its fresh act; now they see it a round later. **To look into** (docs/gaps.md) before calling it right.

- **Phase B, B1–B2 landed** (Naz: "no half measures"; docs/design/phase-b-production.md). Holdings and `move_goods`: possession is physics (D20), and an edge's holdings may go negative. Tasks and `work`: a person's working day is a physical limit. State variables, perceived with their trend. Construction and demolition as materials plus labour; money for materials and demolition is retired. The kernel tests cover conservation (money; goods, accounted for by work and construction), feasibility, perception, reach, and the new `work.rs`.
  - **Interim until B4:** the generated town's building types carry no materials yet, so construction there takes only time. The builder has no yard, supplier or crew yet, and it still prices by its own reckoning of materials. B4 gives it all three.
- **B3 landed:** `goods(...)` and `work(...)` in the call language, and `materials_at` for building yourself. The resolver, the preview and the translator know them (contracts/calls.md).
- **B4, step 1 landed: the world market, and a builder with a yard, a crew and a supplier.** The B2 interim is over. The town's buildings are made of materials and hours of work ([building.md](behaviour/building.md); placeholder figures, to calibrate in B5).
  - **Trade** ([trade.md](behaviour/trade.md)) is shared by everyone who buys or sells goods. Sellers publish price lists. Buyers order and pay in the same act (cash with order). Sellers match payments by the paying account, deliver, refund what they couldn't, and send delivery notes.
    - **Why not a payment reference:** a bank can't vouch for a record it can't see, and the kernel refuses a `settles` naming a record that isn't there.
    - **Why no credit:** it keeps stock and cash physically honest.
    - **Revisit if** firm-to-firm trade needs payment terms (trade credit is the norm there).
  - **`world.trade`** is the outside as a price-taking world market: it sells against paid orders, and buys exports against invoices once the goods have arrived, up to a monthly demand, sending the rest back. For now the town buys only materials from it. Factories and shops come in steps 2–3, and `world.export_demand` goes then.
  - **`firm.builder` 0.6.0:**
    - buys materials for its waiting jobs;
    - starts each job when they're in the yard, and invoices;
    - on 5 days of 7, works its crew (the yard's employees, hired by its own `firm.employer`) up to a working day each;
    - prices from its costs (materials at its supplier's price, hours at the crew's hourly pay, a 20% margin), republishing when they change.

    A house now costs $270,000 (was $360,000) and a park $63,750 (was $60,000). **Landlords obey a demolition order by commissioning the builder**, since demolition is now work.
  - **The stepper** (`firms.ts`): a step can say what follows from its own outcome (`then`). That's how the builder learns its order's id and whether a day's work was done, and the world market what it has delivered.
  - **Found:** the builder was ordered to demolish a house it was still building. It then kept working on the house (refused as `not_being_built`), and never started the demolition, because its weekly survey didn't show the new house yet, so it didn't know how long bringing it down takes. Now it remembers what it builds, waits to see a building before demolishing it, and drops jobs the world says are over. Also: the world market was refunding every payment it couldn't match, including the factories' money-only "supplier" payments. Refunds now go only to its own customers.
  - **Tests** (`orchestrator/test/building.test.ts`):
    - materials bought at the world price, and a delivery note for each delivery;
    - every finished building took exactly its hours, and at least its least time;
    - nobody works beyond a working day;
    - invoices are paid;
    - a demolition order carried out: owner → builder → crew;
    - exports paid only once arrived, and only up to the month's demand, with the excess sent back and an invoice with no goods declined;
    - no call a module writes goes unresolved.

    Changed tests: the park's price; the view's channel kinds (holdings); deaths "at home" now means in a dwelling when they died, where it used to mean housed at the start.
- **B4, step 2 landed: factories (`firm.producer`, after Lengnick 2013).** See [producer.md](behaviour/producer.md).
  - **What a factory does:**
    - its workers' hours turn inputs into goods (the task `make`);
    - it buys inputs by an (s, S) rule;
    - it sells wholesale;
    - it exports what it needn't keep under its share of the world market's buying offer, and invoices it;
    - monthly, it applies Lengnick's hiring, wage and price rules, and pays what it holds beyond a buffer to its shareholders (a `shareholders` register: in the town, each household's leaseholder, in proportion to savings).
  - `world.export_demand` is gone from the town.
  - **Changed from Lengnick (each in the doc, with why):** inputs; output follows hours, and nothing is made when stock is above the band; contracts keep their wage; exports; a buffer covering wages and inputs paid ahead of sales; last in, first out.
  - **Employers share one staffing routine** (`Staffing`: postings, offers, wage orders, notice, deaths). It was extracted from `firm.employer` with the town's two-year run unchanged to the state hash.
  - **The builder hires its own crew, to the work in hand:** enough hands to do it within 90 days, a core of 2, the yard's 12 at most. It used to keep a fixed crew. In one seed the builder paid 12 idle hands for 250 days and went broke.
  - **Found:**
    - **Shared export demand swung.** A first-come-first-served monthly quantity, shared by two factories, went mostly to whoever shipped first, and the other's demand swung between zero and everything. The world market now buys from named sellers, each with its own share (a factory's export customers). The generator splits the spec's demand by the size of each works.
    - **An empty factory never started.** It counted only what it sold as demand, so with no staff it saw none. Its demand now includes demand it couldn't meet (its export share), as Lengnick's does.
    - **An empty factory paid out all its capital.** Its buffer was a month's wages for no one, so its $400,000 went to its shareholders. Dividends now come out of the month's earnings only.
    - **Daily hiring checks hired endlessly.** Stock that's shipped out weekly always looks low. Hiring is now decided monthly, as in Lengnick.
    - **Unsold stock kept piling up.** A factory with stock it couldn't sell kept making more. Now it makes nothing above the band.
    - **Dividends were never paid.** The act had 78 payments, beyond a program's 32 lines, and was dropped as `call_unreadable`. They're now paid in batches, and the tests fail on unreadable calls as well as unresolved ones.
    - **Offices answered bank notices with price lists.** Letters about one of our records (a bank saying a payment wasn't made) were answered with the price list. They're now not answered.
    - **Resumed runs diverged.** The log keeps the config in canonical form (keys sorted). A module that iterated a parameter's keys (the world market's price list) wrote its text in a different order after a resume, and the recorded model calls no longer matched. The orchestrator now gives every module its parameters with keys sorted, so a fresh run and a resumed one see the same.
    - **Dividends went on arriving in dead people's accounts.** The bank now passes on to the heirs whatever comes into an estate after it's settled, as an administrator does (bank 0.7.0). The deaths test checks estates end empty, and that wages (the thing it meant) stop.
  - **What changed in the town (3 seeds, 2 years, against the commit before B4):**
    - **Leases, move-ins and households** are within noise.
    - **More people leave:** 34 a run on average, was 23. There are fewer people at the end (176, was 184), and rent stress is somewhat higher (27% of households over 30%, was 22%). The added departures are households with nobody earning.
    - **Why:** about 100 people work, against 108 before.
      - At the placeholder productivity, $400,000 a month of exports keeps about 58 factory workers, where the money-only factories kept 72.
      - The builder's crew follows its work: from 4 at the start, up to 12 when busy, down to 2 when quiet.
      - The yard's opening crew is 4, sized to its usual work. A full yard of 12 at the start, laid off in the first quiet spell, doubled departures in a trial run.
      - Households don't yet buy goods locally. That's step 3, about 1,500 items a month through the shops, which is roughly 13 factory jobs.

      **To judge after step 3**, and calibrate in B5 (unemployment against ABS Labour Force).
    - **Dividends:** about $56,000 a month goes to households, and the factories' cash stays near their buffers.
  - **Tests:** `orchestrator/test/production.test.ts`.
    - Goods are made only by the factory's own employees, and within a working day.
    - Inputs are bought at the world price.
    - Exports are paid at the world price, within each factory's share.
    - Dividends are in proportion to shares.
    - Too little demand: workers are let go monthly, and making falls to what sells.
    - Plenty of demand: the factories hire monthly.
- **B4, step 3 landed: shops (`firm.retailer`), and households buying and using goods.** The town's own economy closes the loop: households buy goods through shops, which buy from the factories or import them, and nothing money-only is left in the town's trade.
  - **Shops** ([retailer.md](behaviour/retailer.md)):
    - they restock by Lengnick's band from the cheapest supplier, as much as they can pay for;
    - every paid order joins a queue, served by the staff at the shop (each item is `serve` work, 1.5 hours), over several days if need be;
    - out of stock, not served within 3 days, or undeliverable: refunded;
    - monthly: Lengnick price and wage rules, headcount a worker at a time toward what sales need, dividends out of earnings.

    **"Goods" is Lengnick's single consumption good,** standing for households' consumption of goods and services apart from housing. So "serving" is the labour of local consumer businesses. Without that, a town of 200 needs a handful of shop jobs and has no other services until phase C.
  - **Households** (citizen 0.10.0):
    - a month's spending by the same rule, now as goods, bought fortnightly from a favourite shop with Lengnick's switching rules (ψ_price, ξ, ψ_quant, β);
    - goods are delivered home (only if they're living there), or kept at the shop;
    - they're used up weekly (`consume`) over the weeks to the next trip, with goods held elsewhere brought home first.

    Going without is what was ordered and never delivered. Measurement reads it from delivery notes, so no special record is needed.
  - **The money-only stand-ins are gone from the generated town:**
    - citizens paying a shop "for shopping";
    - landlords' owners spending at a shop. Their draw goes to the landlord's shareholders.
    - shops paying "suppliers" a share of revenue.

    Wholesalers publish a minimum order, so households buy through shops.
  - **Shared code:** `lengnick.ts` (parameters, price and wage rules, dividends, distributing to shareholders). The producer moved onto it: identical but for the month's starting balance, which is now exact to the cent.
  - **Kernel fix (perception):**
    - **The change:** the full picture of a holdings channel (a first look) now leaves out holdings at 0, as it leaves out closed accounts. An incremental look still reports a holding going to 0, so views drop it.
    - **Why:** the participant runtime's view and the kernel's full picture disagreed.
    - **Tests:** the kernel's perception property test applies the same rule.
    - ⚑ **Contract wording clarified**, not changed: participant-api's holdings channel says "a first look: all it holds, nothing at 0".
  - **Provisional calibration** (the generated town, to redo in B5):
    - shops start with 3 staff (room for 6), sized to expected sales; the old 36 shop jobs came from the money-only model;
    - `exports_per_month` in `town.yaml` is raised to $470,000 (`town-1000.yaml`: $2,350,000), about what the factories' 80 places make less local sales, so the town's employment stays near what it was.
  - **Found:**
    - **Jammed queues.** A household's fortnightly order (about 11 items, 16.5 hours to serve) could never be served by one worker. First come, first served blocked every order behind it. Shops now take every paid order into a queue and serve it over days.
    - **Shops that stopped restocking.** Demand counted every order, including retries at other shops, and a shop that couldn't afford the whole restock ordered nothing. Now it orders what it can pay for.
    - **Quick re-hires.** A shop let someone go for want of cash, then hired again as soon as money came in. Its month's headcount now comes down with it (factories too).
    - **Orders that took more serving time than was left.** Accepting an order didn't reserve its serving hours. Now each order's hours are reserved, per worker, as the kernel shares them.
    - **A demolished home kept as home.** Its tenants had goods delivered there and used them there. Goods are now home only when the household is living there, and a delivery to a place that's gone is refunded, not retried (a retry would have blocked the shop's queue).
    - **A newborn left behind.** A household leaving town the day after a birth left the baby, who wasn't on the household's record yet. The leaving branch had dropped the birth steps planned in the same wake.
    - **Same-moment races.** A firm names a worker who left in the same moment (D58's observe-then-act). These refusals are expected and handled, and tests now allow exactly those codes (`not_present`, `not_at_work`).

      I tried re-planning after a refusal and dropped it. A plan's steps change the module's own records when they're planned, so dropping the unexecuted steps would lose orders.
  - **What changed in the town (3 seeds, 2 years, against the commit before B4):**
    - **Fewer people leave:** 7 households depart a run on average (was 16), and 11 people leave the world (was 23). There are more people at the end: 204 (was 184).
    - **About 114 people work** (was 108): 78–80 in the factories, 31–34 in the shops, 2–5 in the builder's crew.
    - **Leases and building are unchanged.** Rent stress is 26% of households over 30% (was 22%).
    - **Consumption** reaches about 4,300 items a month by the second year.
    - **Two-year runs take 40–50 s** (was 14 s): real trade has many more acts.
  - ⚑ **For calibration (B5): a shortage economy.** The town exports more than it imports, so money builds up in households. They order far more than the shops' 36 places can serve (unmet orders, counting retries, reach about twice what's delivered), and shop prices are held by Lengnick's bound of 1.15 × marginal cost. Nothing adds capacity: no new firms, no investment, as in Lengnick. B5 has to set export demand, serving time and shop room together, measured against unemployment, the retail margin and the trade balance.
  - **Tests:** `orchestrator/test/retail.test.ts`.
    - Serving is by each shop's own staff, an item's hours each.
    - Every household order is answered, with refunds that match.
    - Goods go home or to the shop.
    - Households use only what came.
    - Shops buy mostly from local factories.
    - No money-only stand-ins are left, and landlords' draws go to shareholders.
    - A shop with no staff serves nobody and refunds.
**D59. Reliability: timing failures stop cleanly and resume; deterministic ones recover in place.** *(Naz, 2026-09-28: "we need to be able to automatically gracefully recover from things like infinite loops, things getting stuck"; "determinism split sounds right".)*
- **Why:** a two-year run hung at day 691 for eight minutes with no sign anything was wrong. The cause was the orchestrator's own bug (D58's same-moment rule). The real problem was that nothing noticed. A dead kernel would also have been misread as an off-contract request, and the run would have gone on against nothing.
- **The split:** results must never depend on wall-clock timing. Deterministic failures (a module throws; a model call fails after its time limits and retries, which is then in the log) are recovered in place: recorded, and the participant waits. Timing failures (a stall, a dead kernel) stop the run cleanly, with a diagnosis, to be resumed once fixed.
- **Built:**
  - **Breadcrumbs and a watchdog thread** (`orchestrator/src/watchdog.ts`). It still works when the main thread is stuck in a synchronous loop. After `TERRARIUM_STALL_SECONDS` (default 300) without progress, it writes `<run>.failure.json` and ends the process.
  - **`KernelDied`**, distinct from a refused request.
  - **`RunStuck`** after 1,000 rounds of wakes at one moment.
  - **`ModelCallFailed`**: time limits (180 s) and retries on every adapter, including Codex's.
  - **Failed decisions and debriefs** are recorded and skipped.
  - **Batches** survive a failed seed.
  - **`terrarium resume <log>`** re-runs from the log's own config, serving recorded model calls (checked against the recording) until the stop, then going on live. It costs no model quota for what was already done.
  - **`--modules FILE`** for researchers' own behaviour modules.
- **Tests** (`orchestrator/test/reliability.test.ts`), fault injection:
  - a module stuck in a loop is stopped within seconds, with a diagnosis naming the participant and the time;
  - a throwing module is recovered, and two runs are byte-identical;
  - a killed kernel ends the run at once as `KernelDied`;
  - a model that never answers times out, retries, and its participant waits;
  - a run stopped at day 20 and resumed to day 40 serves every recorded call, makes exactly the remaining calls anew, ends in the same state as an uninterrupted run, and has the same log up to its closing `resumed_from` note.
- **Found by the tests:** annotations are stored in canonical JSON, so recordings must be compared canonically; a failed debrief used to crash the end of a run.
- Operator's guide: docs/reliability.md.

**D60. The platform is general: every place-specific figure lives in a profile.** *(Naz, 2026-09-28: "I feel like it's too scoped to like australia? ... we are trying to create a generalised platform here"; "please ensure that we have guardrails/docs/tests whatever to keep this untangled".)*
- **Why:** calibrating the town to Australian data had started to leak into the platform. Module defaults held Australian figures (census shares, fertility, the pension age, the saving ratio); a module was named for the Commonwealth, and a citizen's logic knew Australian payment names. A world for another place would have inherited Australia's rules without anyone noticing.
- **The rule:**
  - **Kernel, contracts, behaviour modules and generators are the same for every place.** Modules have neutral names ("support", "pension", "unemployment" as names a world gives), and their defaults are placeholders or "none" (no retirement age unless a world sets one).
  - **Every place-specific figure lives in a profile** (`worlds/profiles/<id>.json`): its values, a source for each (or "placeholder" and why), and that place's calibration targets.
  - **The generator reads a profile**, and derives by general formulas what it doesn't hold (hours per item from an industry's labour share and a wage).

  The first profile is `au-vic-2026` (a regional Victorian town, September 2026), holding everything that used to be scattered through the code: census household shares, life tables, fertility, injury rates, wages, rents, support payments, wealth shares, industry shares, currency.
- **Guardrails:**
  - `orchestrator/test/generality.test.ts` fails if platform code names a place, its statistics offices, agencies, payments or currency; if any profile figure lacks a source; or if a town doesn't generate from a profile, taking its figures from it.
  - CLAUDE.md states the rule, and docs/profiles.md explains the layers.
- **The guardrail found 11 leaks**, now fixed: comments citing a statistics office or a state's institutions (the rules' sources stay in docs/behaviour/); a household's stated reason for having a child, which cited the ABS; and contract descriptions that used "AUD" as the example currency.
  - ⚑ **Wording only:** contracts' descriptions now give a generic example ("cents, for a currency with two decimal places"). No schema change.
- ⚑ **Known exception, held for Naz:** money is displayed with "$", and the call language writes amounts in dollars ("$12.50"). A world in another currency would still see dollar signs. Fixing it changes the call language (a contract).
- **Revisit if** a second profile shows that a rule, general in form, was really one country's (the support payments' age windows, the example legal code).

- **Phase C, stage C0 (a sourced baseline):** see docs/design/phase-c-stakes.md for the phase: credit, firm failure and entry, concentrated ownership, shocks, prices that bite, government, and workers' voice (Naz: "everything you mentioned 1 to 7 I want implemented").
  - **What changed:**
    - wages: the award for shops, the ABS industry medians for factories and building;
    - rents: regional medians;
    - spending tied to income: the saving ratio and a small wealth effect, replacing 30% of savings a month;
    - retirement at the world's retirement age, with support in retirement and for the unemployed paid from outside (`world.transfers`);
    - participation in the labour force;
    - wealth-concentrated ownership (fifths of households by savings hold the profile's shares, with part of each firm owned from outside);
    - industry shares define an item (manufacturing's labour and input shares; retail's purchases and labour shares);
    - the world market's demand derived from the factories' opening staff when a spec doesn't set it.

    Measured against the profile's targets: docs/calibration.md.
  - **Changed my mind:**
    - **What "goods" stands for.** With retail's sourced shares, shops are retail. Consumer services are a missing sector for now; last stage I'd framed goods as goods and services.
    - **Award minimums for all wages** made every worker earn the floor. Industry medians are the better source.
  - **Found:**
    - **Money-only spending kept households spending more than they earned.**
    - **Claims were made again every week.** A refused claim for unemployment support (people under the minimum age) was repeated weekly.
    - **Income was undercounted.** Refunds were detected as "money from someone we paid", which counted a shop worker's wage from their own shop, or a tenant's dividend from their landlord, as a refund. Refunds now come off from delivery notes.
    - **A day's making overshot.** At sourced productivity, a day's making could be more than a month's demand, so factories now make only up to the band's top.
    - **Input orders fell below the minimum.** Factories' input orders could be below the supplier's minimum and be refunded.
    - **An empty factory never started** (a stage B4 issue, now covered by the demand rule).
  - **Tests:**
    - allow refusals when a household moves into a home its last tenants are still leaving (designed: refused, and retried);
    - read prices from what the builder publishes rather than fixed amounts;
    - the stock-band test checks the property itself (no day's making beyond the band's top).

- **Phase C, stage C1: prices that bite, and shocks.**
  - **Rents:** landlords review a tenancy's rent once a review period, to what they'd ask for the home now, with the notice the world's tenancy law requires (its profile; Victoria: 12 months, 60 days). Rent never goes down; the arrears they reckon follow the increases. Tenants pay the new rent if it's within their budget, or give notice and look elsewhere. In two years of the 200-person town: 56 increases, and about one in five households leaving over one.
  - **World prices** move monthly by a mean-reverting random process (the profile's, placeholder volatility), in integers from the seeded randomness. Researchers script shocks to a kind's price or demand (`shocks` in a spec).
  - Where shortage reaches shop prices, Lengnick's price rule does it, within its bounds.
  - **Tests** (`orchestrator/test/prices.test.ts`):
    - rents are reviewed no more often than the law allows, with its notice, never down, and tenants answer by paying or leaving;
    - world prices are republished as they move;
    - a price shock and a demand shock arrive as scripted;
    - factories pay what the world market lists.

    Earlier tests that assumed fixed world prices now check the order's price against the list in force, or the one just before, since a list republished in the same moment isn't seen yet (D58).

- **Phase C, stage C2: credit** (docs/behaviour/credit.md).
  - **The bank lends.** It decides on serviceability, assessed at the rate plus the regulator's buffer against regular income read from the account it keeps. Loans are agreements, paid out once signed and repaid by standing order. A month behind is arrears; 90 days is default, recorded as a debt claim, after which the borrower is refused.
  - **Funding:** it draws from outside when short (`world.funding`).
  - **Who borrows:** households short of rent with income coming in; firms before letting staff go.
  - **Figures** from the profile: cash rate 4.35%, small-business rate 7.39%, a 3-point buffer, the 90-day default rule.
  - **Found:**
    - **Serial lending.** The bank ignored existing loans, and one newcomer was lent five times while already behind. Assessments now count existing repayments and refuse anyone behind.
    - **A lump sum counted as income.** A newcomer's deposited savings looked like a month's income. Income is now the least of the last three months'.
    - **Two loans at once.** A borrower could apply again between approval and signing. Now it's one loan at a time.

    Defaults are still frequent: about a third of loans in the 200-person town, mostly firms that were already failing and people who later lost work. That's C3's business, and a calibration target (APRA's non-performing rates) for C6.
  - ⚑ **Held for Naz:**
    - **Money creation.** The bank lends what it has or borrows, since the kernel conserves money. Letting banks create deposits is a physics change.
    - **Mortgages** need a housing sales market.
  - **Tests** (`orchestrator/test/credit.test.ts`):
    - the repayment formula;
    - loans follow applications, are paid out once signed, and are repaid by standing order;
    - one loan at a time;
    - default only after arrears, with a debt recorded, and refusal after;
    - funding draws paid by the outside.

- **Phase C, stage C3a: firms that fail** (docs/behaviour/insolvency.md).
  - **Debts are claims recorded against a firm:** a lender's on a loan in default, and unpaid wages. A worker unpaid for a pay period plus five days resigns and claims them.
  - **A trading firm pays its debts while it can,** and asks its bank for what it can't cover.
  - **Insolvent** means in default on a loan, or with debts unpaid for 60 days that it can't pay and can't borrow for (after the "debts as they fall due" test). An insolvent firm says so, lets everyone go, sells what it has, pays its creditors oldest first after 60 days, passes any remainder to shareholders, and closes.
  - **Found:**
    - **A factory kept working people it wasn't paying.** Its wage payments failed and nobody noticed. Unpaid wages are now a debt, and the workers leave.
    - **A factory that had shed all its staff never counted as insolvent.** Being short of wages stopped counting once there were no workers. Insolvency now turns on unpaid debts.
    - **A firm with stock it could sell** paid its debts from it and wasn't insolvent, which is correct.
  - **Test** (`orchestrator/test/insolvency.test.ts`): a factory with no money, customers or stock:
    - is refused credit, and its unpaid workers claim;
    - is insolvent after trying to borrow;
    - lets everyone go, and stops buying and making;
    - pays creditors before shareholders;
    - closes after the wind-up period, and does nothing after.

    In that run its workers got $2,000 of the $102,000 owed them.

- **Phase C, stage C3b: firms that start** (docs/behaviour/entry.md).
  - **Premises for sale.** A closed firm offers its premises publicly at half what building them new costs (placeholder). Unsold, the price comes down 10% a month. It sells to the first buyer who pays in full, transfers the title (its ownership claim), and pays the proceeds to its creditors, then its shareholders.
  - **Founding.** A working-age citizen with the savings for the premises, the venture's capital and a buffer, with a month's chance (`found_bps`, placeholder), founds a business: the `entity` call, holding its first position, where the venture's rules (the generator's shop template) run. The new shop opens an account, takes its founder's capital, records the founder as its shareholder, buys the premises, then hires and trades.
  - **Closed by its owners** (voluntary winding up): a firm nobody has worked for in 90 days (placeholder) says it's `closing`, and winds up as an insolvent one does.
  - **On-the-job search** (citizen 0.13.0): in work, a month's 10% chance (Lengnick's π) of applying for a better-paid posting elsewhere; offered it, the worker gives notice and starts there when the notice is worked out. A posting unfilled at an old wage is published again at the firm's new wage.
  - **Found:**
    - **Zombie shops.** A shop with no money let each new hire go before payday, so it never ran up unpaid debts and never counted as insolvent. It sat for months with stock and no staff, refunding every order. Hence the owners' closure: most real closures aren't insolvencies.
    - **Nobody could hire in a full-employment town.** Employed people never looked for work, so a new shop's posting got no applicants. Hence on-the-job search, which also gives workers a way to move to better pay (wage competition between firms, which the economy lacked).
    - **A raised wage never reached applicants.** An open posting kept the wage it was published at.
    - **Almost nobody can found a business.** Working-age savings top out near $38,500 (cash only: no home equity, no business loans, no commercial leases), against premises at about $365,000; the people with that much are retirees. The mechanism works (the test gives one worker the savings), but in the generated town entry is close to impossible. **Revisit when** commercial leasing or home ownership and mortgages arrive, or when calibrating entry against business counts (ABS 8165.0).
  - **Contract change, signed off by Naz (2026-09-29):** the `entity` call (contracts/calls.md, calls.schema.json) takes `channels` and `role_module`, the new organisation's first position's, as `position` already does. Without them, a founder's position could see and do nothing the business needs. The translator's resolver passes them into `create_entity`'s `first_position`, which the kernel already accepted.
  - **Test** (`orchestrator/test/entry.test.ts`): a shop with nothing closes and lists its premises; a citizen founds a shop, which is created with its founder in its Manager position; the capital is paid and the founder recorded as shareholder; the title is transferred; the new shop hires into the premises and serves customers there.

- **Phase C, stage C4a: public finance** (docs/behaviour/public-finance.md).
  - **Income tax, withheld by employers.** The outside world publishes an income tax law (the profile's brackets and levy: Australia's 2025-26 resident rates). Every employer's payroll pays the wage less what the law withholds (a pay reckoned as a year's income) and pays it over monthly with a report. Short of money, an employer pays over what it can, keeping the next pay period's wages, and still owes the rest. Employees read the same public law to know their net pay has come.
  - **Rates replace the rent tax** (municipal-economy.md §9 Q3, as recommended). The outside world's valuer values every private property yearly: land per lot (the profile's median country house price, $572,000, less the builder's price for the commonest house: $212,000) plus the builder's current price for each building. The town's rating law gives a rate in the dollar (set at the start to raise the profile's rates per resident: 0.46% of value a year in the 200-person town), four instalments, and 10% penalty interest. The rates officer sends notices and records each as the town's claim. Owners pay: landlords as they pay fines, firms as debts (unpaid rates count towards insolvency), the builder on its yard.
  - **Grants:** the outside world pays the town quarterly, per resident it sees living in the town's homes (the profile's general purpose grants per resident).
  - **Found:**
    - **Payment references were dropped.** The bank passed a payment's `settles` on only when it could see the record named, and it never sees the town's claims, so no rates payment said what it paid. The bank now carries the payer's reference as given (bank 0.8.0), as real banks carry payment references; the kernel still refuses a reference to no record.
    - **A factory couldn't pay over what it withheld.** It had paid its wages first. Hence paying over what it can and owing the rest.
    - **Income tax is a leak from the town.** Employers' costs are unchanged (net pay plus tax is the old gross), but households take home about 15-20% less, and the tax leaves the town; only support and grants come back. In the slack-demand production test, a factory now runs short of cash by day 76 and lays staff off for want of it. A real town gets much of that back as the national government's own spending there (schools, hospitals, public jobs), which the town lacks. **Revisit** in C6's calibration: the town's income tax out against transfers in, and whether publicly funded services employment belongs in the town.
    - **The builder stalled on a pile of contracts.** It ordered materials for every waiting job at once or not at all; four permits granted together came to more than its balance, and nothing started for months (the river test). It now buys for the oldest jobs it can pay for (docs/behaviour/building.md).
  - **Not yet:** landlords passing rates on in rent; the collector chasing unpaid withholding; tax on income other than wages. **Revisit when** calibrating household saving (net pay lowers spending) and the town's revenue mix (VAGO: rates 51%, grants 19%).
  - **Test** (`orchestrator/test/public-finance.test.ts`): the tax arithmetic; wage orders net of withholding; withholding paid over as reported; valuations as land plus buildings, none of the town's own; notices at the law's rate from the latest valuations, one claim each, most paid by payments naming them; grants at the rate per resident; no rent tax. `government.test.ts` checks rates in place of the rent tax.
- **Phase C, stage C4b: the town's services** (docs/behaviour/services.md; municipal-economy.md §5.2, with its recommendations).
  - **Physics already there.** Waste builds up in homes per person a day (DCCEEW: 512 kg a year), and wear comes on parks and the hall over a 15-year life (placeholder), as structure variables. The crew's tasks `collect` and `maintain` change them. No kernel change.
  - **The works office** hires the crew the budget's staff line pays for (the profile's staff per 1,000 residents, derived: about 6; one in the 200-person town). Each working day it collects waste (complaints first, then the longest since a collection, a weekly round) and keeps the most worn assets up, within the crew's hours, from the hall. It takes the week's waste to the outside world's landfill with a docket. The landfill invoices monthly at the levy a tonne (EPA Victoria, rural municipal: $84.78), and the finance officer pays within the budget.
  - **Payroll is the finance officer's.** It's the one position the bank takes the town's payment instructions from, as in a real council, where managers hire and payroll pays. `Staffing` now splits its hiring half from its paying half. Wages count against the adopted budget.
  - **The budget** has staff and services lines beside parks (and on the proposal form). A budget with no staff lets the crew go, nothing is collected, and people complain.
  - **The town starts with its crew,** in work like the firms' staff, and first in the fill order, so a town short of workers still has one.
  - **Complaints:** a leaseholder whose waste has gone two weeks uncollected writes to the town, with a weekly chance (placeholder, to source).
  - **Found:**
    - **An office that needs names shouldn't overwrite them.** The survey of the whole town reports the hall by head count, and the depot's channel by name; the later one won. The works office now keeps the depot's view apart.
    - **Holdings are seen as they change,** like sites: a week's collected waste wasn't in the plan's observation on disposal day. The office keeps a running view.
    - **A day's round of 40 homes as 40 steps ran past the actions a wake allows,** and the disposal after it never happened. Rounds are now steps of up to 30 homes, and disposal comes first.
    - **A closed firm missed its buyer's payment** when it arrived in an observation between plans: `WindingUp.sell` read payments only from the observation it planned on (the entry test passed before by timing). Payments are now counted as they're seen, and so is a new shop's founder's capital.
  - **Not yet:** contracting out; recycling streams; a waste charge per household; streets; anything that uses a park (so wear affects only the works report). **Revisit** with the amenity term in leaving town (municipal-economy.md §6), and in the 1,000-person town, where the services have more to do.
  - **Test** (`orchestrator/test/services.test.ts`): the crew is the town's and paid by the finance officer; every home is collected from, by the crew, from the depot; weekly dockets, monthly invoices, paid; the hall kept up; few complaints. With no staff line: the crew let go with notice, nothing collected after, and complaints.
- **Phase C, stage C5: workers' voice** (docs/behaviour/unions.md).
  - **A union** the town's workers join: at the start, each employee with the profile's membership rate for their kind of work (ABS, August 2024: 13.1% overall; manufacturing 9.0%, construction 11.7%, retail 7.0%, public administration 23.1%), and new hires at the same rates. Membership is an agreement, with dues by standing order.
  - **Bargaining,** yearly, with each employer where it has members: a claim for the year's rise in shop prices plus a margin (placeholder 2%); an offer by the employer's capacity to pay; an accepted offer (at least half the claim, placeholder) becomes a published enterprise agreement and a rise for all staff.
  - **Protected action** (after the Fair Work Act 2009, Part 3-3; figures as parameters): a ballot (half voting, a majority yes), 3 days' notice, stoppages of 1, 2, 3 days a week apart, no pay for time on strike (the employer stops and restarts pay, settling what was earned before), and the employer's offer rising by half the gap after each stoppage (Hicks 1932) until agreement.
  - **Found:**
    - **An employee didn't recognise a raised wage** that arrived before they took in the agreement: agreements and strike calls are now taken in as they're observed, before the money that comes with them.
    - **Stopping 40 strikers' pay in one step kept only 30 withdrawals,** and restarting it as a step per worker ran past a wake's actions. Both are batched now. (Without the fix, ten workers would have been paid twice.)
  - **Targets** (in the profile, for C6): working days lost per 1,000 employees (about 11 a year: ABS, 139,100 days lost in 2024), and membership. In the generated town's first bargaining round (150 days, one seed), the union claimed 2% at the five employers where it had members. Four offered it all and settled. Factory-1, with little in hand beyond a month's wages, offered nothing; its members balloted, stopped work for a day, and settled at 1%.
  - **Not yet:** bargaining with the town (a steward's lever: public sector pay); lockouts; the tribunal; multi-year agreements; strike pay.
  - **Test** (`orchestrator/test/unions.test.ts`): claims answered by offers no more than the claim; agreements after acceptance, and everyone's wage orders replaced at a new gross net of tax; nobody resigning over pay that changed. Forced into action: the ballot passes with enough voting; notice at least 3 days before each stoppage; strikers leave and come back, their pay stopped and restarted; no making at the works during a full stoppage; offers never falling; an agreement at the end; no striker claiming unpaid wages.
- **Phase C, stage C6: language-model runs are translator training data** (Naz, 2026-09-29: "for each LLM run we need to make sure we're storing/saving data so that it is usable for future training runs for the translator"). The log already kept nearly all of it. Closed the gaps:
  - a translator transcript now names the draft it was for (`data.ref`), so the exchange joins to the rest;
  - proposals, failure reasons and the model's raw answers are no longer cut at 8,000 characters;
  - `terrarium corpus` exports one training example per translation (docs/measurement.md), marking the mock's as synthetic.

  Language-model runs are never deleted to free space. No contract change: the reference is inside the transcript's opaque data.

- **Phase C, stage C6: calibration** (docs/calibration.md). Naz (2026-09-29): "go ahead with C6 runs and calibration" (the language-model pilot not yet).
  - **Adults' ages from the census** (the profile's age bands; the other adults' ages derived from them less the parents the family shares imply), and **children at home to 24** (the ABS's dependent students). Before, adults were uniform on 18–80, so there were too few retirees and employment to population was 77–81% against 63.9%.
  - **Shops plan staff to fill 80% of their hours,** not 100% (Kingman 1961): at 100%, 17% of the goods households ordered weren't served and were refunded, and the unspent money was measured as saving (9–11% against 6.5%).
  - **Found, at the 1,000-person town's scale: a wake's steps were dropped.** A factory with 406 shareholders spends its month's end paying dividends, 30 to a step, and a wake allows 12 actions. The steps after those were thrown away when it next planned, among them republishing its price. Believing it published, it refused every shop's order at the old price as "below our price": from month 14, shops got nothing, and in two years unemployment reached 16–22% (the baseline, `runs/c6-baseline`). The shared stepper now carries what a wake didn't get to over to the next, first, since a module's state already counts on it. **Revisit:** paying 406 shareholders in 14 steps is itself heavy; a bank's bulk payment (one instruction, many payees) is how a registry pays dividends.
  - **The venture's capital is derived** (a month's stock and three months' wages for its opening staff), not the $50,000 placeholder: a new shop spent it all on its first stock and couldn't carry a worker until customers found it.
  - **Found: the bank dropped payments at busy moments** (bank 0.9.0). The same pattern: at the 1,000-person town's month ends it reached its ceiling of actions (1,152 transfers in one moment), and when it next planned, the rest were gone, one-offs already marked handled and standing orders already moved on. Wages, rent and dividends went unpaid with nobody told. It now carries them to its next wake. Citizens' own step lists had the same pattern, and are fixed the same way.
  - **Dividends are one bulk instruction to the bank** (a share registry's way), not 14 steps of 30 payments.

- **Run datasets** (docs/design/run-datasets.md; Naz, 2026-09-29, the first of three priorities: data for training, then speed, reliability and log size, then separation). Every run's data, derived from its log in one streaming pass: a manifest saying what made it (versions, seats, models, config and log hashes), system prompts, translations, model participants' decisions (what each was shown and answered, and what followed), and optionally code participants' acts and recorded observations. Deterministic: the same log, the same dataset. **For sign-off:** the format (`contracts/dataset.schema.json` 0.1.0), and the log contract's new `observation` annotation, written only when a run is asked to record observations (`--record-observations models|code|all|<ids>`). A recorded observation's channels are a list with their paths, since the log's free-form data doesn't allow a "/" in a key.
- **Speed and log size** (docs/reliability.md; Naz's second priority). Profiling (a `profile` in each run's summary) showed the modules' decision time growing with history: they rescanned everything they'd ever seen. `Book` indexes (standing statements by kind, records by type), incremental order books, delivery notes and bank instructions, and a round's looks sent to the kernel together took the 540-day, 1,000-person run from 260 s to 154 s with the same outcome. Log flags: `--log lean` (no observation hashes, no code reasoning; world config `log.detail`, **a contract addition for sign-off**) and `--compress` (zstd after measuring, about 7x smaller). **Revisit:** the kernel's own time per act (about 0.3 ms: logging, hashing and serialising each entry) and advancing the clock (about 5 ms an hour, life's schedule) are what's left.
  - **The kernel's state grew for ever** (kernel 0.5.1): transfers were queued for every participant acting for an entity concerned, and those without an accounts channel never took their queue. Queued now only for those who'd see them; the schedule of future effects is a persistent map (it was a list copied on every act). Logs from 0.5.0 replay with 0.5.0: the state differs by those queues.
  - **Health warnings** (docs/reliability.md): each run's summary counts wakes that ran out of actions with more to do (by module) and refusals by code; `terrarium run` prints a `!` line for anything worth a look. They caught shops' serving carried over into the next day (refused for want of hours); a day's work is now dropped at the day's end, its module told.
  - **Also found:** a member on strike who'd taken another job went "back to work" at the new one; they now go back only to the workplace they left, if they still work there. And the rent and government tests leant on timing and on landlords' 50% compliance; they're steadied.

- **Separation: modules name nobody** (Naz's third priority: "nothing baked into the world"). A sweep of the modules found defaults that named the generated town's entities (`"bank"`, `"builder"`, `"supplier"`, `"landfill"`, `"town-hall"`...) and a union joining rate read off a workplace's id prefix. A world that named things differently would have had its firms borrowing from, and paying, parties that aren't there, silently.
  - **Whom a module deals with is now the world's to say.** Defaults are empty; `need()` (participants/src/module.ts) fails at once, naming what's missing, where a module can't work without it (a producer's supplier and market, the mayor's builder, the works' depot, workplace and landfill, trade and transfer accounts). Where it can do without (a bank to borrow from, a registry), none means the module doesn't do that thing.
  - **Kinds of work are data:** a workplace carries an `industry` (the generator's names; the profile's `unions.membership_bps` is keyed by them, with `other`), a job posting carries it, and a new hire joins the union at their industry's rate. No module parses an id.
  - **Guard** (`orchestrator/test/generality.test.ts`): no quoted string in the platform's code is an id the generated town has (its entities, accounts or buildings). Probed with a planted `"town-hall"`: it fails.
  - **Laws that were module parameters are law records now** (D18/D19). The union's ballot and notice figures were the Fair Work Act's, written into its defaults (a place's law in the platform); the landlords' rent reviews came from the profile as parameters. Both are now law statements the generator publishes from the profile (`data.law: "rent_increases"`, `"industrial_action"`), read by `lawInForce()` (participants/src/behaviour/common.ts): the latest standing law on the matter. A module's own parameters are its own practice (neutral defaults), and the law bounds it. **Why it matters here:** the town's lawmakers, a steward among them, can change a law, and until now a changed rent law would have changed nothing, since landlords never read it. **Revisit:** jurisdiction (the latest law on a matter wins, whoever made it; a council can't override a state's tenancy law in life); and landlords' compliance applies to permits and fines but not yet to rent law.
  - **Found, making the rent law 6-monthly in the test:**
    - **A month's rent went unpaid at every increase** (citizen 0.16.0). A tenant stopped the old standing order at the notice, and the new one began at the increase's date, 45 to 60 days on. The rent due in between was never paid, and the landlord's arrears rule (two months) never noticed one missing. The old order now pays until the new rent's first payment, on the same days. The test now checks that no month is missed.
    - **A notice carried to a later wake kept its first date** (the landlord's rent increases, the union's notice of action). The notice ran short by however late it was given: 43 days against 45. A step can now say how to remake itself for a later moment (`Step.redo`), and the stepper does that when it sends a step later than planned.
  - **Needs sign-off, if wanted:** an end date on standing orders (`until` on the `money` call: a contract change). The citizen works around it by stopping the old order itself.

- **Bun 1.4.2** (Naz, 2026-09-29: "lets switch to 1.4.2"; from 1.3.4). Found first: the 5-year batch hung compressing its logs, because Bun 1.3's zstd stream stalls after 64 MB. The compression itself was fine (the zstd tool read it back whole); the read-back check waited for ever, and so would the dataset export on any big compressed log. 1.4.2 reads the 2.3 GB log back in about 4 s. `engines` in package.json now says so, and a test reads back a compressed log over 100 MB. The suite passes unchanged (256 tests). **Revisit:** time the runs on an idle machine against 1.3.4's.

- **Before the next 5-year runs: unemployment, the kernel's speed, compressed logs** (Naz, 2026-09-29: "yes go ahead with all three").
  - **Unemployment was a labour force that grew and jobs that didn't** (the 5-year runs, `runs/c6-run2`: 10–15% against 4.6%). Every job posted was filled (postings and hires matched each half-year), and jobs held stayed near 440 while the working-age population rose from 540 to 570. Participation was drawn only for the adults at the start: everyone who came of age or moved in looked for work. By year 5, 89% of working-age adults were in the labour force (the profile says 80%), and of those who came of age a third were out of work; of those who moved in, a quarter. The 50 or so extra jobseekers were about the whole gap. Two rules were short of their sources, not tuned:
    - **Participation for everyone** (citizen 0.16.0, generator 0.14.0): the town's children are drawn at the start too (for when they're adults), children born here at birth, and newcomers other than the one who came for the job by the migration office.
    - **Migration counts the town's unemployed** (world.migration 0.2.0, world.transfers 0.2.0). Harris & Todaro's chance of a job is the destination's employment rate; the module's left out the town's own unemployed, so people kept coming for jobs locals were queuing for. The support office now publishes its monthly count of recipients, as DSS does by area, and a would-be migrant counts the unemployment recipients among those competing. Test: 400 published jobseekers stop arrivals that come without them (0 against 12).
  - **The kernel's speed** (kernel 0.5.2, same results: a 3-year log replays byte-identically, to the same final state). Profiled late in a run, two costs grew with its age:
    - **Each act copied tree nodes whole:** the state is copied for each act (to undo it if refused), and the first change to a map's node afterwards copied its 64 values. A participant's values include its queue of transactions, and the bank's holds a day's transfers, so every transfer deep-copied them. Accounts and participants are now behind `Arc` and the queue is a persistent list: a change copies only what it changes.
    - **Every monthly checkpoint re-encoded the whole history** to hash the state (by year 3, over a second each). Records never change once made, so their canonical bytes are kept between checkpoints (in the kernel, not the state) and the hash is streamed: the same bytes, so the same hash.
    - A 3-year, 1,000-person run: 273 s to 183 s (kernel 183 s to 103 s; 0.32 to 0.16 ms an act; 10.5 to 2.4 ms a clock advance). The kernel alone, replaying it: 166 s to 79 s. The kernel's memory in a live run peaked at 1.3 GB. **Revisit:** the modules are now a third of the time (citizens most of it); the bank runs out of actions in 5% of its wakes (carried to the next, a day late at worst).
  - **Logs compressed by default** (`terrarium run`; `--no-compress` to keep plain): a 5-year run's log is 2.3 GB plain, 326 MB compressed, checked to read back whole first. Needs Bun 1.4 (above).
  - **Also found:** the rent test took a tenant's account to be `acc-<person>`; a newcomer's isn't. It now uses the account the rent order pays from.

- **Log size and the platform's speed, continued** (Naz, 2026-09-29: "these log sizes seem absolutely ridiculous... maybe we need to enable more flags").
  - **What fills a log** (lean, 3 years, 1.42 GB): commands 52%, events 47%, and the hash chain's two hashes 28% of every line. A code-only run is deterministic, so its log can be regenerated from its config, seed and commit: **`--keep measures`** keeps the measurement tables and a recipe instead (docs/reliability.md), refused for model runs and uncommitted changes. Dropping what replay regenerates (events, `prev`, code participants' call text) needs a contract change: **proposed, for sign-off**, in docs/design/compact-logs.md.
  - **The orchestrator read back what code participants wrote:** a module's call was written out as text, read back, resolved, and written out again for the log (12% of its time). An in-process module's action now carries its program as written (a symbol, not part of the action), which the orchestrator uses; the text is unchanged. Tests check, for every call in every test run, that the text reads back as exactly that program; a 1-year run ends in the same state.
  - **Found by that check:** citizens sometimes sent a step with nothing in it, refused as unreadable. They're no longer sent (as the shared stepper already did).
  - Breadcrumbs for the watchdog are written straight into its shared buffer.
  - **Where the time goes now** (1 year, 1,000 people, 52 s): the kernel is idle about half the time, waiting on the orchestrator, and its busy half is spread thin (applying acts 19%, observations 9%, the log 5%, checkpoints 5%). Parsing the kernel's replies is the orchestrator's largest cost (15%); most of it is citizens' observations, mostly prices and the street, delivered as changes. No single large cost is left on either side.
  - **The 5-year calibration** (`runs/c6-run3`, after the participation and migration fixes): unemployment 5.3–5.7% (target 4.6%), participation 65.9–67% (67.1%), employment to population 62.1–63.4% (63.9%). Saving is still 17–21% (6.5%): next.

- **Before the next model pilot** (docs/design/llm-readiness.md; Naz, 2026-09-29: "do the engineering items first"):
  - **Prompt caching** (Anthropic): the tools and system prompt, and the conversation so far within a wake, are marked for the provider's cache (a copy of the request: the conversation and transcripts are unchanged).
  - **Model participants' observations recorded by default** (training data); `--record-observations none` to stop.
  - **A subscription's usage limit stops the run cleanly**, to be resumed (the Codex CLI's limit is a `UsageLimitReached`, handled as a spending limit is), rather than failing call after call.
  - **A spending limit for a whole batch** (`--batch-budget`): each run gets the per-run limit or what's left, whichever is less. Tested against a stand-in provider billing as a real one does: three runs in parallel held $0.02, $0.02 and the $0.005 left of $0.045, and none spent past its own.
  - **Found:** the batch's child runs didn't see environment variables set after the orchestrator started (Bun reads the environment once); they're now given it explicitly.
  - **Deferred:** translations in parallel. They share one subject, and the log's order and resume's serving of recorded answers depend on their order; only worth it for several model seats.

- **AI citizens, step 1: the building blocks** (docs/design/ai-citizens.md; signed off by Naz, 2026-09-29, "agreed on facts only, signed off"; kernel 0.6.0).
  - **Offers and practices** are optional structured parts of a statement, like `adico` and `formal`:
    - an offer is what someone may take up, on what terms, and how;
    - a practice is a recurring situation people take part in.
    - Facts only: the contract refuses an offer stating what it's worth ("gives": "belonging").
  - **Commitments are typed** (`Does`: an outcome in the vocabulary the call language already wrote, or words), so no commitment is a convention only code can read. Nothing running used another shape; four contract examples and the kernel's tests did, and were migrated.
  - **A channel can show statements having an offer or a practice (`match.has`),** whatever their kind, so a new kind of offer is seen without configuring for it. Kernel test: a festival fund's offer is seen; the fund's plain report isn't.
  - **The call language's `statement` takes `offer` and `practice`,** so a model publishes them as code does.
  - **Contracts 0.6** (Naz: "yes rename to 0.6"): typed commitments are a breaking change, so the contract family is renamed. Configs and logs say `contracts: "0.6"`; a log from 0.5 replays with a 0.5 kernel.

- **AI citizens, step 2: laws without hidden fields, and offers published** (docs/design/ai-citizens.md 2a, 2e).
  - **Laws bind code participants only through their formal conditions,** as any participant reads a law (`breaches` in participants/src/behaviour/common.ts, lifted from the planning office).
    - The rent and strike laws are prohibitions with a CEL condition on the notice itself: when it takes effect and when the rent last changed; the ballot's figures and the notice given.
    - Landlords and the union check an act before taking it: they look for a lawful version (a later start), wait, or, not complying, breach.
    - The hidden `data.law` fields and `lawInForce` are gone. Tests change laws as a lawmaker would, by putting a different law in the world.
  - **Offers are published alongside today's records:** job postings (employment terms), homes to let (the lease), shops' and producers' price lists (per unit), the union's membership, the bank's loan terms, premises for sale.
    - Today's citizens keep reading the records' data; the new citizens will read the offers.
    - **Limits for now:**
      - a price list with several kinds of goods isn't one offer;
      - a minimum order isn't in the offer's shape;
      - transferring ownership is in words, since the vocabulary has no ownership outcome yet.
  - **Found:**
    - **A citizen counted unemployment support as income while in work,** and applied for homes only that income could afford. Once the claim stopped it couldn't sign, leaving the landlord's offer unsigned (the landlord then let the home to someone else). Support for being out of work is no longer counted once employed.
    - The migration test's world paid newcomers $1,500 a fortnight, which rents nothing here. It passed only through that bug; it now pays $3,000.

- **AI citizens, steps 3 to 8: the mind, and its decisions recorded** (docs/design/ai-citizens.md "Progress").
  - **The mind** (participants/src/behaviour/mind.ts): people drawn from the profile's values (Schwartz; a sourced placeholder, Schwartz and Bardi's pan-cultural order). Temperament and need weights follow from values. CONSUMAT picks how to decide; experience-weighted attraction learns.
  - **Wired:** shopping, work, housing (each through the mind); petition thresholds and job search (from the person).
  - **Kept as cited priors:** the union, business, leaving. Their worth is meaning, not facts.
  - **Decisions are recorded:** a `decision` annotation per decision (the log contract gains the name; signed off in the design, section 6), for full logs, exported as `citizen_decisions.jsonl` (dataset contract: `CitizenDecision`).
  - **Found while wiring:**
    - an untried option needs a prior, or failing to serve teaches nothing;
    - how a shop served should be judged by the usual shop, not a retry that made up for it;
    - with nobody to copy, go by experience, not habit;
    - the record must say what was done, not the quadrant it started in.

- **AI citizens, finishing step 2: the cited priors swayed by the person** (docs/design/ai-citizens.md "Progress").
  - Joining the union, strike ballots, starting a business and leaving town keep their cited rates. Each is now shifted by the person's values (standardised against the world's), and joining also by what membership has done for them (learned).
  - **Why shift, not replace:** their worth is meaning, not facts, so a facts-only mind would never join or found anything. The shift makes people differ while the town's rates stay as calibrated, because it's symmetric about the mean. One year, two seeds: employment, ballots, stoppages and departures within seed noise.
  - **The sizes are placeholders,** exposed as `sway`; a world may set any of them.
  - **Revisit if:** the sparse mind (step 8) gives these decisions a better basis than a rate, or a survey links values to union membership or entrepreneurship well enough to calibrate `sway`.

- **AI citizens, step 3: knowing what others do, by catching up** (docs/design/ai-citizens.md "Progress"; docs/behaviour/citizen.md).
  - People ask someone they know how things are, every fortnight, with a message. The answer says where they shop and how it serves them, whom they work for and whether they're paid, and whether they're in the union.
  - It feeds imitation (others going there), learning (others' payoffs, weighted as EWA's forgone payoffs), a conformist lean in joining the union, and the social need.
  - **Why messages, not a shared view of what everyone does:** it's how people actually find out. It costs a message each way, and it reaches only people one knows. A language-model citizen can take part in its own words, and a code citizen understands only its own phrasing (as with asking around).
  - **Found and fixed:** learning about employers never reached job choice, because options were postings and learning was of employers. Options are now employers. A message's sender (a participant) was being remembered as a person one knows.
  - **The entry test now makes shop 1 fail on purpose** (no credit, no hiring). With people hearing of work from friends, shop 1 hired and traded its way out, which is the world's business, not what the test is about.
  - **Revisit if:** catch-ups dominate message volume in bigger worlds (they're about 43 a day per 1,000 people), or survey data on how often people talk with friends calibrates `catch_up_days`.

- **AI citizens, step 4: practices, taken part in** (docs/design/ai-citizens.md "Progress"; docs/behaviour/citizen.md "Taking part").
  - **Gatherings are world content.** The profile's social groups and the union's meeting are standing notices with a practice, in a hall the town hall now has. There's no module for them: nothing happens unless people come.
  - **A starting routine is a typed term,** `attend` in a membership's commitments. The share who belong at the start comes from the ABS General Social Survey 2019 (50.0%), as union membership at the start comes from the ABS.
    - **Why:** without it, early choices were near coin flips, and everyone ended up going.
    - Routine from a term, not from "being a member", because a union's members don't commit to its meetings.
  - **Where people take part is physics:** occupancy for the gathering's time, which the kernel already had. No new block.
  - **The union meets on its own evening** (it had shared the hall and hour with a group).
  - **Tests:** a new gatherings test. The strike test checks that pay stops during any stoppage, since a one-day stoppage may end at the moment the employer next pays.
  - **Revisit if:** participation drifts from the target over five years; groups need joining and leaving (offers taken up), fees, or leaders; or the mind's logit needs a per-domain sensitivity.

- **AI citizens, step 5: belief** (docs/design/ai-citizens.md "Progress"; docs/behaviour/citizen.md "Belief").
  - Teachings are world content. A citizen holds them with a strength. It fades, grows at gatherings with others' costly displays (Henrich), grows when told (conformity-weighted), and is stated in catching up once firm. It adds meaning to the host's gatherings and to joining the union.
  - **Starting beliefs are per-person participant parameters,** from the census share and memberships: the mind's state, not the world's.
  - **Measured as stated,** since belief is internal: `town/beliefs` reads what people say, as a survey would.
  - **Why no decision-record change:** recording belief strengths would change the `CitizenDecision` contract, which needs sign-off.
  - **Proposed for sign-off (not done):**
    - a structured `claim` on statements, for things put forward to be believed, so code needn't recognise the kind `teaching`;
    - belief strengths in `CitizenDecision`, for training data.
  - **Revisit if:** a practising-share or stated-affiliation target is sourced; belief needs to attach to any statement (rumour, news, a mayor's promise), which is the `claim` field; or conversion rates need calibrating.

- **AI citizens, step 6: feelings and ties** (docs/design/ai-citizens.md "Progress"; docs/behaviour/citizen.md "Feelings and ties").
  - **Emotions** (OCC-lite: anger, fear, gratitude, fading by half-lives) now drive complaining (anger past a personal threshold, while the cause is there) and tenants' grievance (anger with the landlord while it lasts, where rent rises now count).
  - **Fear** lowers certainty in money decisions; gratitude and time together build affinity.
  - **Affinity** decides whom people catch up with and keep as contacts.
  - **Why emotions rather than rules:** the timing now differs by person and by how big the cause was. The old fixed 90 days and 14 days were uniform placeholders.
  - **Changed tests:** complaints come from about a week's worth of waste, not exactly two weeks.
  - **Revisit if:** a sourced complaint rate (complaints rose from 1–2 to 11–21 a year in the 1,000-person town); help, gossip and reputation; or emotions in decision records (a contract change).

- **AI citizens, step 7: goals with steps** (HTN, one level; docs/design/ai-citizens.md "Progress"; docs/behaviour/citizen.md "Goals").
  - A need long unmet becomes a goal, pursued by methods tried in turn (value-ordered, each with time to work), met when the need recovers, given up for a while when none is left. The methods act through what citizens already do: the job search, the saving share, the home hunt's budget, catching up, the practice decision.
  - **Why one level:** the multi-step behaviours (a home hunt, switching jobs) already exist as sequences. What was missing was persistence and choosing among ways to a goal.
  - **Recorded** as decisions in domain `goal` (the contract's `domain` is free text).
  - **Revisit if:** goals need sub-goals (moving house as a plan with its own steps), or methods need learning (EWA over methods: which worked for people like me).

- **AI citizens, step 8: the sparse mind, plumbed and off by default** (docs/design/ai-citizens.md section 4 and "Progress"; participants/src/llm/consult.ts).
  - **The plumbing:** code participants get a `consult` on their context when a run turns it on (`--consult`; recorded in a note; resume reads it back). It asks through the run's model I/O, so calls are logged, priced, budgeted and replayed like any other. Answers are remembered by kind of person and thing, for the run only. A citizen returns its pending question with its action, so the orchestrator waits for it inside the cohort and the log's order doesn't depend on which call came back first.
  - **Used for** joining the union and starting a business: the answer shifts the cited rate.
  - **Why purpose `participant`:** it is the participant's own call, and a new purpose would change the log contract. **Proposed for sign-off:** a `consult` purpose in the usage annotation.
  - **Before any real-model run:** the design's robustness audit and fidelity check; and Naz's go-ahead for paid calls (mock-first rule; Codex pilots are approved).
  - **Revisit if:** the kinds are too fine (every person asks) or too coarse (everyone alike); or answers swing with wording.

- **The sparse mind's robustness audit** (docs/design/ai-citizens.md section 4 and "Progress"; orchestrator/src/audit.ts; `terrarium consult-audit`).
  - **The four wordings:** the base, reworded, options reversed, and the needs' bins shifted. Plus a fidelity check: other people of a kind asked afresh, against the kind's answer.
  - **Unstable:** a swing over 2 points of 10, or a flipped preference. A run can leave unstable kinds (or whole things) out: `--consult-avoid`.
  - **Why these checks:** the design names them (after the audit paper's 76-point framing swings). The option-order check is added, a known position bias in models.
  - **Built on the world's own questions** (`CONSULT_THINGS`, shared with the citizen) and people drawn from its profile, so the audit checks exactly what runs would ask.
  - **Revisit if:** the 2-point threshold proves too loose or tight on a real model; or the fidelity check says kinds are too coarse, in which case bin finer.

- **Unions: closed employers, members who move, and ballots about one's own workplace** (union.organiser 0.3.0; docs/behaviour/unions.md).
  - **Found in the 5-year calibration:** 78 stoppages over three years at a shop that had closed on day 738. The union's register changed only when people joined, and members voted in any ballot sent to them.
  - **Now:**
    - members tell the union where they work (`membership_update`);
    - the union sees public closures, and ends a dispute at a closed employer or where no member works;
    - citizens vote only about their own workplace.
  - **Also:**
    - a JSON value in a call is normalised as its text will read back (an undefined field dropped), so a program always matches its own text;
    - the join decision is now recorded as the mind's (domain `membership`);
    - a unions test allows a raise's new wage orders up to two days after the agreement (a busy wake carries steps over).
  - **Not done: the tribunal I first proposed.** The stoppages were a bug, not a deadlock. A tribunal (conciliation, then an intractable bargaining declaration and arbitrated terms) is worth adding once real deadlocks can arise. They can't yet: employers concede the claim in full after three stoppages.
  - **Revisit if:** members' updates should be less than certain (not every member tells the union); or disputes deadlock for real.

- **Calibrating belief and saving** (docs/calibration.md; docs/behaviour/citizen.md).
  - **Belief grew where the census shows decline.** Three changes:
    - **Nominal starting strengths spread** evenly between placeholder bounds, not all at 5,000. With one level, uniform fading makes a cliff, not a decline.
    - **Telling only firms up a belief already held.** Hearsay turned non-believers into believers. Conversion comes through taking part (Henrich 2009; Stark and Lofland 1965).
    - **A census-like statement:** leaning towards a teaching, said once it's the citizen's own at all (`affiliate_bps`). The `town/beliefs` measure reports affiliation and its change a year.
    - **The fade rate is calibrated** against the census's fall (the profile's target, −1.64 points a year): one year each at 1.5%, 3% and 2.75% a month gave +1.9, −2.1 and −2.9 points; 2.25% is being checked over five years.
  - **Saving was 18–22% (target 6.5%): trips spent a fixed fortnight's worth, and came late.** A trip can only be made at a wake, often days after it was due: 23 trips a year, not 26, and a tenth of planned spending never happened. Each trip now spends for the time since the last, up to two fortnights. Two years: saving 2.4–3.2%, median rent share 20.2–20.4%, but employment rose to 68.5% (target 63.9%) with unemployment at 0.6% (4.6%): more spending, more hiring.
  - **Five years** (`runs/c9-run5`, fading at 2.25% a month):
    - **Affiliation:** −1.1, +0.2 and −1.0 points a year (target −1.64). Too slow: the one-year runs overstated the fall. Now checking 3% a month (`runs/c10-run5`).
    - **Saving:** creeps back to 15, 12 and 5.8% by year 5. It's no longer a spending bug. Shops fail to serve 20–30% of what's ordered in seeds 1 and 2 (0.2–1% before the fix), and refunds pile up as unspent money.
    - **The labour market is behind it.** Unemployment is 0–2.4% (target 4.6%). Shops can't hire, and three closed because "nobody has worked for us for 90 days". Restoring the spending that was lost exposed a labour market with too little slack.
    - **Seed 3 went the other way:** shops shed 36 staff in year 5 and the builder 10, and unemployment reached 11.7%, after 119 newcomers in years 2–3 (migration's bursts).
  - **Revisit:** the labour market's frictions (how long a job search takes, how often jobs end) and migration's response, which now decide saving.
  - **Belief, calibrated:** fading at 3% a month, five years (`runs/c10-run5`): affiliation −1.65, −1.32 and −1.63 points a year, a mean of −1.53 (target −1.64). Firm belief holds near its start (19% to 18–22%).

- **Runs that survive the machine sleeping, and resuming long runs** (docs/reliability.md).
  - **Found overnight:** a laptop's lid closed, and the watchdog read the sleep as a stall. A model call "hung" 17 minutes, and a code-only run's kernel "hung" on a clock advance, both while the machine slept (pmset's log), and both runs were stopped.
    - The watchdog now doesn't count a gap between its ticks far longer than a tick (the machine asleep, everything frozen).
    - A run pauses through sleep and goes on when the machine wakes.
  - **Resuming a long code-only run failed:** resume read the whole log into one string, and a 5-year log is 2.5 GB. It now reads it a line at a time, and only the first lines for the header and notes.
  - **Revisit if:** a model call begun before a sleep fails on waking (the adapter retries, then the participant waits, as after any failed call: D59).

- **The rebuild's time model** (docs/design/rebuild.md section 6; Naz, 2026-09-30: "yes to all three, acting costs time now in the rebuild … do any changes now, don't defer to later").
  - **The clock and simultaneity are world semantics.** They're specified in the contract and run by the engine's `time` crate, not in orchestration glue. Acts take effect when done, and acts completing at the same second apply in actor-key order.
  - **Acting costs time, replacing the action budget** (`max_actions_per_wake` and its carry-over).
    - Every act takes its actor time, by act and actor kind (`act_time`, world config, sourced or marked as placeholders).
    - A person has one timeline across all their capacities; a system has `lanes`.
    - Falling behind shows as a backlog, measured.
  - **Thinking time in both modes:** free, or costing world time. Models by tokens (deterministic, logged), humans by the wall clock (logged), code seats a configured fixed time.
  - **Why:** the budget was an artificial limit, and wake timing decided outcomes (the 23-trip mole). "Who actually does it, at what cost" (principle 12) includes the time it takes.
  - **Revisit if:** act-time figures need sources per place (they'd move to profiles), or rounds at per-second resolution miss the performance targets.

- **Contracts 0.7, signed off** (docs/design/contracts-0.7.md; Naz, 2026-09-30: "all as recommended").
  - **A1:** a `claim` on statements (things put forward to be believed; messages pass one on by `re`).
  - **A2:** citizens' state in decision records, the core (needs, satisfaction, certainty) required and emotion, beliefs and goal optional, versioned by mind.
  - **B1–B15:** the rebuild's batch.
  - **C:** `log.detail`, the dataset format and observation annotation, `notices`, and `framing.debrief_text`, ratified as built.
- **The rebuild's engineering calls** (docs/design/rebuild.md section 15; made within Naz's principles, open to his overruling):
  - **The architecture** is a Rust engine in-process with a TypeScript participant host. Models stay remote, so the AI under test is still isolated from the engine.
  - **What goes where:** the rule in section 3.
  - **The resolver and law reader** move to Rust.
  - **Readings:** the kernel records, `terms` and `law` read, nothing rules.
  - **Module manifests** are checked at world load.
  - **The mole-proofing mechanisms** of section 8.
  - **Payments reference what they settle,** as banks match payments.
  - **Organisations close by a registrar's act,** as in the world.
  - **Resume from checkpoints,** with every module's state serialisable. Per "don't defer", it's in the rebuild.
  - **Pre-0.7 logs replay with the tagged v0 binary.**
  - **The plan:** rebuild the architecture, not rewrite it, with parity gates against `v0-reference`.
  - **Work happens on a `rebuild` branch,** so `main` keeps running (pilots, fixes) until the rebuild passes its gates.

- **Readings in the `Book`: "concluded" and "in force" kept apart** (docs/design/rebuild.md section 7, R3 progress).
  - Code asks "concluded" (signed by every party) when it needs the history, such as a contract's start, wages still to stop, or a loan's repayments. It asks "in force" (the terms' reading) when it needs the present, such as membership or a job held now.
  - **Why:** merging them broke wages stopping at an employment's end: an ended contract no longer read "in force", so the employer never withdrew the order.
  - **Revisit if:** readings carry obligations (B2), so a loan's arrears come from the reading and no longer from the Book's arithmetic.
- **The engine's binary and native module must come from the same sources:** a fingerprint in each (kernel/build.rs), checked when the host loads the module. It's a loud stop, not a fallback to stdio: a quiet mismatch writes logs that don't replay.
  - **Revisit if:** the stdio binary is retired, and the module is the only engine.

- **Truth audits record only divergences that last** (docs/design/rebuild.md 8.2). A divergence counts when it's still there at the unit's next audit, with when it was first found (`since`, added to the `audit` annotation's data; the log contract's description now says so).
  - **Why:** a unit can't know what another did in the same moment. Counting that would bury real staleness in noise: the first run gave two such cases against 68 real ones.
  - **Revisit if:** R2's acting time changes what "the same moment" means (acts take effect when done), or a lag that is real shows up only once.
- **Memberships state the member's right to resign, and leaving town ends everything the citizen can end.** The union's figure is the Registered Organisations Act's two weeks (s 174, to confirm). A club's or congregation's is a placeholder of at once. Both are in the profile.
  - **Why:** the terms reader counts a notice only under the giver's own clause. With no clause for members, a member couldn't leave, and a member leaving town left the union holding a ghost (found by the first truth audit).
  - **Revisit if:** the `law` reader can supply terms implied by law (a statutory right to resign that a membership doesn't write down).

- **Acting costs time, in the engine** (docs/design/rebuild.md 6; R2's first step). A `time` crate says how long an act takes (the world's `act_time` by block and actor kind; one second where it says nothing) and places it on its actor's timeline: one per person (by body, shared by every capacity), `lanes` per system. The kernel holds an act in progress in its schedule and applies it when done. The orchestrator's wake for that unit pauses until then. `max_actions_per_wake` and the "cut short" signal are gone; the health report has a backlog instead (how long acts waited for their actor).
  - **Engineering calls:**
    - **A program of several steps takes effect whole,** when all its steps are done, not step by step as the design sketched. Steps refer to each other (a payment to the account a step before opened), and applying them apart would break that.
    - **Acts done at the same second apply in the order they were begun,** not strictly by actor key. It's still deterministic, and never the order decisions came back in.
    - **A unit busy with an act isn't woken by news** until it's done. It sees the news then, with its act's outcome, as someone in the middle of something would.
    - **Thinking time** is passed with the act (`thinking`, logged), so a replay is exact: a model's from the tokens it used, code's a fixed figure. A human's (wall-clock) waits for a human seat.
    - **Runaway guard:** 1,000 rounds at one moment stops the run. Acting always moves time on, so only looking and drafting can loop.
  - **Contract changes (within B5 and B7, signed):** `action_started` event; `thinking` on the act command; `max_actions_per_wake` removed; `act_time` absent means a second an act (description). **To confirm with Naz.**
  - **Revisit if:** a program's steps need to land apart (a long program whose early steps others should see), or lanes need a system to decide again before its acts are done.
  - **What it found in the modules, the first day** (the action budget had hidden each):
    - **Retries paced by wakes:** a citizen whose new home wasn't free yet tried to move in every time it woke. Once a refused act woke it a second later, it tried 2 million times in a month. It now tries again the next day, by time.
    - **Planning per moment:** modules planned whenever the clock had moved on. Every step now lands at a moment of its own, so they planned again mid-plan (a landlord listed one house 16 times). **The rule:** a plan is made when a wake begins; woken because its act is done (`woke_for: "done"`), a module carries on with the plan it has.
    - **A builder signing what it can't do:** it now declines a contract for a lot already built on, in writing (docs/behaviour/building.md).
    - **The planning rule, refined (with act times in the generated worlds):** a module plans when a wake begins, and again at a "done" wake once its plan is finished. That's a new moment, and something may have come due since, like a gathering ending. It never plans again while steps remain. Time-bound steps (going to a gathering that's on, leaving one that's over) go first in a plan: acts take time, so a plan's order is the order things get done.
  - **Act times in generated worlds** (generator 0.17.0): placeholders, minutes for a person's act (5 to write, 15 to fill in or go somewhere, 30 to draft an agreement, an hour to leave or arrive) and a second for a system's. A year of the 1,000-person town stays within the rebuild's seed spread on the town's measures, with a clean health report.
  - **A new expected race:** `no_time_left` when a new employer names someone on their first day who has already worked a full day at the job they just left. It's a same-day handover the new employer couldn't see (D58's kind).
    - **A guard that compared exact times:** units writing to each other were held to three news wakes a moment. Now no two moments are equal, so a mayor and its finance office wrote back and forth every second. It's now three news wakes a *tick*. A unit's own acts finishing don't count.
    - **A price that changed a second after it was quoted:** a builder declined a landlord's offer at the builder's own published price, raised a second later. A price it published in the last 30 days is now honoured (a placeholder: a common term for a quote).
  - **The health report watches for loops:** the same act by the same unit more than 24 times in a day is flagged ("a retry loop?").


- **The loop's schedule is the engine's** (docs/design/rebuild.md 5.1, R2). The TypeScript host registers its units and runs them; the engine decides who wakes when.
  - **Why this way first:** the whole loop in Rust, with the host as a callee, is a larger inversion. Moving the schedule gives every host the same semantics, and the host's execution order doesn't change, so it can be checked against the old one.
  - **One semantic tidy-up:** a cohort is everyone due at a moment in key order. The old host ordered by (wake time, key) and set news wakes at the time before an advance. Same final state over 60 days; different order within moments.
  - **Revisit if:** a second host (Python, human) needs the rounds (look, decide, act) in the engine too. Then the rest of the loop moves.

- **The `law` reader is Rust** (kernel/crates/law; revising the rebuild's deferral, at Naz's asking, 2026-09-30).
  - **What:** our own evaluator over `cel-parser`'s syntax tree, for the allowed subset (D27's allowlist, integers only, `holds_liberty` and `holds_right`). Built natively and to WebAssembly; `participants/src/law.ts` loads the module synchronously, so modules and the translator's warnings call it as before. `bun run kernel` builds it; a stale module is refused by its source fingerprint, as the native engine module is.
  - **Why our own evaluator, not `cel-interpreter`:** that crate is lax where a law reader must be strict. A missing field reads as null, `!` and `?:` take any truthy value, and `&&` doesn't absorb errors as CEL does. A missing field would quietly make a prohibition not match. Ours keeps CEL's semantics for the subset: a missing field is an error; `false && error` is false and `true || error` is true; comparisons take only their own types; integer arithmetic stops on overflow and division by zero.
  - **Checked** against `@bufbuild/cel` in shadow across the whole suite (`TERRARIUM_LAW=shadow`; under test a difference is an error), as the resolver was: no differences, and none in a year of the 1,000-person town (only 80 law reads there, so also a one-off check of 54 tricky conditions on two acts, both ways). That check found two differences, both where `@bufbuild/cel` strays from the CEL spec and ours doesn't: `int('')` is 0 there (JavaScript's `BigInt('')`), an error here; `has()` of a field of a number is false there, an error here. No law the generator writes reaches either.
  - **Faster, as it happens:** about 5 µs a read against about 230 µs, since each condition is parsed once.
  - **Two small changes of behaviour:** a condition that can't be parsed is now an error verdict, where it threw (a seat-written statute with a typo mustn't crash the institution reading it); and the parser's panics on some malformed input are caught as parse errors.
  - **Revisit if:** the subset grows (decimals, time), where the evaluator grows with it or a full implementation earns its place.

- **Resume by replay stays; checkpoints wait** (revising the rebuild's call "resume from checkpoints"; open to Naz's overruling).
  - **Why:** checkpoints need every module's state saved and restored. Modules keep state in closures, so it means restructuring all 28. What it buys is faster resume. The engine now runs a year of the 1,000-person town in about 100 seconds, and resume by replay (serving recorded model calls) costs a minute or two for a year's run. It's exact and works now.
  - **Revisit if:** runs get long enough that replay takes too long (many simulated years with model seats), or a study needs to branch a run from a point.

- **Two signed 0.7 items deferred, to confirm with Naz** (contracts 0.7 B1 and B13).
  - **B13, compact logs** (docs/design/compact-logs.md). They change the log's integrity machinery: verifying with gaps, and regenerating events for every reader. What they save is small today. Code-only runs are compressed about sevenfold, and `--keep measures` keeps a run's measures plus a recipe that regenerates it exactly. Model runs, the ones kept forever, may not use compact logs anyway.
    - **Revisit if:** code-only batches must be kept as logs at scale (many seeds over many years), where replay-to-regenerate isn't enough.
  - **B1, types generated from the schemas.** Drift between the hand-written types and the contracts is already caught: the kernel validates every input against the schemas, and the conformance tests check both sides.
    - **Revisit if:** a third language needs the types (Python seats), where generating them pays for itself.
- **What stays in TypeScript, and why** (R5): the TypeScript resolver and knowledge stay for model seats' draft previews and law warnings, and for shadow checks. The random streams and canonical encoding stay because modules use them as they decide, kept identical to the engine's by tests. The stdio protocol stays for the replay tool and a host outside the process.

- **Calibration, first pass after the rebuild** (2026-09-30; the 10-seed, one-year batch of the 1,000-person town against its profile's targets, `terrarium health`).
  - **The saving breach was the measure's.** It took people's accounts by name (`acc-c%`), which caught the town's account (`acc-city`) too, and it counted what leavers take with them (about 90 departures a year, some with six-figure savings) as spending. Now: the export has an `accounts` table (who holds each account: the config's and those opened in the run), people's accounts are those people hold, and wealth moving with people leaving or arriving isn't income or spending, as the national accounts treat it. Saving on the same batch: -10.2% before, 5.7% after (target 6.5%).
  - **Households fell into arrears at the start, and left town for it.** The generator drew each tenancy's rent day and each member's rent-share day independently, so a leaseholder often owed rent before the shares came in. The bank doesn't retry a failed standing order, and citizens ignored its letter saying so. So 33 arrears notices a run at day 60, evictions at day 120, and after 90 days without a home, departures (about 120 people a year, 12% of the town, against 17 arrivals). Now: shares reach the leaseholder the day before the rent (generator 0.18.0), and a citizen pays rent the bank couldn't pay as soon as it can (citizen 0.21.0).
  - **Rent rises past a third of income sent tenants away.** At the first annual review about a third of renting households gave notice. Real renters mostly stay and pay, in rental stress. Now they stay while the rent is at most half of household income (`rent_bearable_share_bps`, a placeholder).
  - **Leases lapsed at their term, and households hunted.** About 245 of some 350 tenancies a year ended at their fixed term, each household then without a home until it found one. Landlords now offer the sitting tenant a new lease as one runs out (landlord 0.10.0, `renew`), and the tenant signs if it can bear the rent (citizen 0.22.0). A lease that continues as a periodic tenancy (the Victorian Act's default) needs a contract change: proposed, not made (below, Open).
  - **Shops opened without working capital.** A flat $30,000 each: 43 of 51 restocks in the first fortnight were cut to what the shop could pay for, and households went without. Opening shops now get the working capital a shop founded in the run gets: a month's stock at the wholesale price and three months' wages for their opening staff (generator 0.19.0).
  - **Group membership at the start was the survey's 12-month figure.** Half of adults began as members and kept going; with others joining over the year, a year's participation came to 60% (target 50.0%). The starting share is a point-in-time figure the survey doesn't give, so it's calibrated: 40% gives 52.8%.
  - **A latent loop: firms planned a full day for a worker who'd already done one elsewhere** (a new starter arriving from their old job). The engine refused (`no_time_left`), and the firm planned the same again every second for the rest of the day: up to 700,000 refusals a run, caught by the health report's repeats. Shops, factories, the builder and the works crew now pick the crew that gets most done when the work is shared evenly (a new starter joins tomorrow), and a refusal for lack of time updates their count from the world's.
  - **Batch after these (10 seeds, one year; before renewals and the loop fix):** 2 breaches of 15, from 4. Saving 6.9%, groups 52.8%, unmet demand 4.65%, renters' costs 19.8%, all inside tolerance. Still off: employment to population 67.1% (63.9 ± 3) and unemployment 1.0% (4.6 ± 1.5), with about 140 people a year leaving and 17 arriving.
  - **Revisit if:** departures stay well above arrivals (the town shrinking), or renters' housing costs overshoot 20.2% of income. Moving house while housed is the realistic fix for rents that can't be borne (docs/behaviour/citizen.md, "Leaves out").

- **Hiring that takes time: tried, and reverted** (2026-09-30). Unemployment sits near 1–2% (target 4.6%): employers choose among a posting's applicants at their next wake, so someone out of work is hired within days. A posting kept open 21 days before choosing (as employers advertise, then shortlist) sent unemployment to 38% (10 seeds, one year): firms post one job at a time, and a posting republished at a new wage starts its wait again, so they couldn't replace the people who left. Reverted.
  - **Next:** recruit as employers do: several postings at once for the headcount wanted, a closing date that doesn't restart when the wage moves, and all the applicants seen then. And the separation side: jobs ending run at about 2.8% of employment a month, against roughly 1–1.5% in labour force gross flows (to confirm).

- **A wake asked for between ticks takes the next tick, not a whole tick on** (2026-09-30; kernel `schedule.rs` `finished`). A unit woken by news between ticks, asking to wake again at a gathering's end ten minutes later, was put a whole tick (an hour) on: people stayed at the hall an hour past its end. Now the soonest is the next tick boundary after now; for a wake on a tick (the usual), that's the same as before.
  - **Revisit if:** a finer clock is wanted for news (then wakes on exact times, which the tick exists to batch).

## Open (to decide at the Stage 2 checkpoint or before)

- **Periodic tenancies (a contract change, proposed 2026-09-30).** A lease can say a fixed `term` or none. Real tenancy law (Victoria's included) continues a fixed-term lease as a periodic one when neither side gives notice. Proposal: an optional `then: "periodic"` on an agreement's terms, read by `terms` as "in force after the term until notice". Until signed off, landlords renew instead (above).

- **Construction payments must be fleshed out. Accepted only to unblock us** *(Naz, 2026-09-25: "not happy with this, but will accept it for now")*. In v0.2, `construct` and `demolish` pay materials and demolition costs straight from the builder's own account to the boundary. That skips the builder's bank (contrary to D26: money moves only when a custodian's seat moves it) and doesn't model suppliers at all. To return to it: have builders buy materials from supplier entities (possibly outside-world suppliers via the boundary) through ordinary bank-executed transfers, with materials as a physical stock that construction consumes, or through the work/process model (D24), where building is a task with inputs. Until then it's a documented liberty; see contracts/blocks.schema.json (`construct`, `demolish`). Known quirk: since materials are paid to the outside world, the outside world's own seat builds for free (it pays itself). Only a researcher-configured boundary module can do this; it disappears once construction payments are fleshed out.

- **Contract additions proposed by M2** (docs/design/m2-llm-participants.md, "Open"): `notices` on the Observation (translation failures and similar orchestrator-to-seat notes), and `framing.debrief_text`.
- ~~Directory refresh interval (D33)~~: superseded by D42 (perception is changes).
- **Calibrating word of mouth** (D45): hires via contacts are far below the 30–60% target. To address with citizen calibration (M3 batch runs give the measurement).
- ~~Citizen behaviour in the Rust kernel vs TypeScript code seats.~~ **Resolved by D30.**
- ~~Which D15 laws become parameters.~~ **Obsolete** under D18/D19: there are no laws in the kernel; laws are records in a world's config.
