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

**D32. A `records` channel's `involving` filter looks one hop through references.** *(2026-09-25; clarifies contracts v0.2's channel semantics.)*
A record involves an entity if it names it, if its author acts as it, or if it refers to a record that names it: a signature on its agreement, a withdrawal of its listing, a vote on its ballot. Found in M1: landlords couldn't see tenants signing their leases (a signature names only the signer), so every home looked vacant and was relisted forever. What a person would count as "involving me" includes these.

**D33. The kernel's state uses persistent maps, and observations read through a derived index.** *(2026-09-25; implementation only, no contract change.)*
Found scaling M1 to 1,000 citizens, where a year took 5.5 minutes, 95% of it in the kernel. Two costs grew with population *and* time:
- **Every act cloned the whole world state**, every record ever made included, so that a refused action leaves no trace (all-or-nothing actions). State maps are now `imbl::OrdMap` and the record order an `imbl::Vector`. Both are persistent, structurally shared structures: cloning is O(1), and an act copies only what it touches. Act time at 1,000 citizens fell from 5.4 ms to 0.2 ms.
- **Every records channel scanned every new record**, and channels without `new_only` scanned every record since genesis. A `RecordIndex` held beside the state (never part of it, never hashed) now lists records by record kind, statement kind and involved entity. A channel reads only its candidates, and the full filter still decides. Involvement is computed once, when a record is made; that equals looking later, since what a record refers to must already exist (D32). Account channels use a cached holder/custodian lookup.

**Verified:** on a 150-day town run, every event body in the log, observation hashes included, is identical to the version before; only the kernel build id in the header differs. All invariant tests pass. A 2-year run at 1,000 citizens takes about 170 s; at 200 citizens, about 21 s.

**Dependency:** `imbl` 7 is **MPL-2.0** (file-level copyleft). It's compatible with an Apache-2.0 project as an unmodified dependency, but it's the first non-permissive licence in the tree. Naz to confirm at the checkpoint. The alternative is an undo log in the executor, which is more invasive.

**Remaining costs, for the checkpoint:** the bank's `directory` channel resends the whole directory (~120 KB at 1,000 citizens) on every daily wake. Directories rarely change, so a refresh interval on `directory` channels (like `sites` has with `every`) would remove most of it. That's a **contract addition**, to be proposed. After that, what's left is broadcast data that's genuinely public (listings and their withdrawals, which every house-hunter sees) and per-entry log hashing.

**D34. Language-model seats are built and tested against a mock adapter for as long as possible.** *(Naz, 2026-09-26.)* The whole M2 loop (reports, proposals, the translator, contract and physics checks, law warnings, sign-off with draft hashes, provenance, usage and transcripts, debriefs, resignation) runs without a real model; see docs/design/m2-llm-seats.md. The mock seat has a code brain (for the mayor, the all-code control's module), so a mock-LLM town behaves like the all-code town, and only language understanding is faked. No API key, budget or real call until Naz raises it.

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
- **Views:** the seat runtime keeps each seat's view (`seats/src/view.ts`) and hands its controller the current picture, so modules and the renderer are unchanged.
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

## Open (to decide at the Stage 2 checkpoint or before)

- **Construction payments must be fleshed out. Accepted only to unblock us** *(Naz, 2026-09-25: "not happy with this, but will accept it for now")*. In v0.2, `construct` and `demolish` pay materials and demolition costs straight from the builder's own account to the boundary. That skips the builder's bank (contrary to D26: money moves only when a custodian's seat moves it) and doesn't model suppliers at all. To return to it: have builders buy materials from supplier entities (possibly outside-world suppliers via the boundary) through ordinary bank-executed transfers, with materials as a physical stock that construction consumes, or through the work/process model (D24), where building is a task with inputs. Until then it's a documented liberty; see contracts/blocks.schema.json (`construct`, `demolish`). Known quirk: since materials are paid to the outside world, the outside world's own seat builds for free (it pays itself). Only a researcher-configured boundary module can do this; it disappears once construction payments are fleshed out.

- **Contract additions proposed by M2** (docs/design/m2-llm-seats.md, "Open"): `notices` on the Observation (translation failures and similar orchestrator-to-seat notes), and `framing.debrief_text`.
- ~~Directory refresh interval (D33)~~: superseded by D42 (perception is changes).
- **Calibrating word of mouth** (D45): hires via contacts are far below the 30–60% target. To address with citizen calibration (M3 batch runs give the measurement).
- ~~Citizen behaviour in the Rust kernel vs TypeScript code seats.~~ **Resolved by D30.**
- ~~Which D15 laws become parameters.~~ **Obsolete** under D18/D19: there are no laws in the kernel; laws are records in a world's config.
