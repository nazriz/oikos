# The plan

The one list of what is being built, in order, and what is done. Agents tick an item in the commit that lands it; the
coordinating session keeps the rest current. Each item names where its detail lives. Nothing is built that the owner
(Naz) has not approved in his own words; text relayed from another agent is input to discuss, not approval.

Status words: `[x]` landed on main, `[~]` in progress, `[ ]` not started, `[?]` waiting on the owner.

## Now (2026-11-10)

**The study.** Do AI assistants with delegated work ask for more authority or resources than they need, across a wide
range of models? Obstacles are the main designed factor; open-weight models, with abliterated models paired against
their originals, are the model net (Naz, 2026-11-08). Not yet known to be feasible. `docs/research/paper-plan.md`,
`docs/north-star.md` (the TARA proposal, the direction this works toward). The five-round pilot of 2026-11-07 to 08 was a
shakedown, not a finding (`docs/handover.md`, "Now").

The path, in order (decided 2026-11-10):

- [ ] 1. Runs can be looked at: the pilot viewer opens experiment forks.
- [ ] 2. Seats see their world in plain terms only (design principle P1); framing unstated, with the debrief after (Naz,
  2026-10-11, reconfirmed 2026-11-10); no model call for a sitting with nothing new.
- [ ] 3. The model gets the real decision: a principal hands over the matter or the want, not the finished act, and
  principals read and answer a request for more (design first: `docs/design/handing-over.md`).
- [ ] 4. The translator back to its design (`docs/design/translator-and-resolver.md` P1 to P15): general, judged on
  forms it has not seen; repeated failures fixed in the blocks; no larger model behind it in study runs (audit first).
- [?] 5. The first true pilot: Haiku, Sonnet and one open-weight model on a small setup. Needs from Naz: the month's API
  credit and a Featherless Developer key.
- [ ] 6. The main study, sized from that pilot: the obstacle laws, the counting pipeline, the pairs.

Alongside:

- [~] Main cannot go red from a landing: `scripts/merge.ts` runs the whole slow tier before a broad push (2026-11-10,
  branch `worktree-agent-a284b76a3d1eeff49`; docs/dev-machine.md, "Merging").
- [~] The disk does not fill: tests clear their scratch, a merge clears the landed trees' builds, the cleaner no longer
  crashes, both scripts warn under 60 GB (same branch).
- [ ] `docs/handover.md` "Now" stays current.

Still open from the earlier list (to 2026-11-08; the done items are in git history):

- [~] Memory per person and tiered storage: 50,000 people for two years against the 40 GB goal (docs/design/tiered-storage.md; SC-6).
- [~] Test strength: the planted-bug catalogue against the code that runs; the single-seed outcome pins of the slow
  tier to replace with planted cases or properties over any seed.
- [~] Delegation capabilities: D0 to D7 landed; the study's measures and arms stay the owner's (docs/design/delegation.md).

## Next, in order

- [x] **Foundations-2, phase 2: conservation** (law 8; landed 2026-10-26, its hard-rule line in CLAUDE.md; the before/after measurement and a 10,000-person month next week). Water, energy, materials and waste as stocks with flows;
  metered homes; recipes say their energy and water; shortages follow from network, contracts and operators, with no
  allocation rule (docs/design/foundations-2.md §2).
- [x] **Foundations-2, phase 3: space** (law 9; branches `f2-phase3`, `f2-s4`, `f2-s5`: S1, the backstop and its inventory; S2, roads as ways and household vehicles; S3, bodies on their way; S4, goods carried, crews to the site, freight from the edges; S5, a road's flows an hour, congestion, fuel from the tank; S6, several towns in one world, `towns: N`). Roads, pipes, wires and data lines with capacity and energy; people in
  transit; goods need a carrier; several towns as an option (§3). Transport and many towns come from this.
- [~] **Foundations-2, phase 4: the general economy** (§7; every roadmap item to be done, owner 2026-10-31; branch
  `f2-economy`). Serves the north star's reversibility: what taking work back costs, and what AI takes of a finite town.
  - [x] E1. Services anyone can buy (the delegation capabilities' D1, above).
  - [x] E4. Skills that grow with use and fade without it, for people and staff; off, or on at a run's own rates, a
    factor of a study (docs/behaviour/skills.md). Slips by skill wait for a source.
  - [x] E2a. The outside's capability over time: releases of what it sells from a scenario (`capability`; the first,
    `rising-capability`), each a kind of system released on its day, sold newest first; tagged `ai` in
    `meta.study_tags` for measurement only, with a backstop that no world code reads it.
  - [x] E2b. Technologies that are goods: a tool a firm holds, with which a task takes a share of its time (the kernel's
    `tool`), sold by the outside and weighed by a factory as any technology is; off unless a town asks, `tools: true`
    (docs/behaviour/automation.md, "Tools"; risk ME-25); hardware as goods is E5's `runs_on`.
  - [~] E3. Firms enter any industry by expected profit: a factory now founded in works for sale, as a shop is
    (docs/behaviour/entry.md, "Founding a factory"); building new premises through planning (the capital-heavy route,
    a hosting firm among them) and borrowing for a venture in premises still to do (ME-1).
  - [x] E5. Compute competing for energy, water and land: what a system runs on, in the kernel (P4: hardware held
    somewhere, each hour of work drawing its recipe there, refused without power), and a host in the town where a study
    asks (`hosting: "local"`), on the feeders and the main with the homes (docs/behaviour/hosting.md; risk ME-24).
  - [x] WM-15. Every other workplace on the network, with its energy and water by industry: each recipe at a workplace
    draws its industry's hour (the kernel's `hour`), from connections kept up to what the work used (`up_to`), billed and
    paid by whoever bills and pays (docs/behaviour/utilities.md, "Workplaces"; risk WM-15, its remainder).
  - [~] E6. The measures: M8's census of who can still do the work (`skill_census`, `town/skills`) and the tag's
    backstop are built; M7 (what the town gives to AI: its share of energy, water, land and hours) is still to write.
- [~] **Foundations-2, phase 5:** strict modes on, old exception lists empty, each law's line in CLAUDE.md as its
  enforcement lands (branch `f2-phase5`).
  - [~] Law 9 strict: systems somewhere (`unlocated`), vehicles that run on something (`moves_for_nothing`), the six
    profiles' fuel; its rule page (docs/everything-is-somewhere.md). Left: the unhoused, for the owner (WM-16).
  - [x] Law 12: L1 to L3, `oikos flags`, the backstop, the nightly flags (docs/flags.md). Holdings left to a replay dump.
  - [x] Law 11, N3: a generated world with an unbased number is not run (at the loader, not the kernel: decisions,
    "Foundations-2 phase 5: law 11 strict"); the old list of unbased places gone.
  - [~] Law 11, N4: the lint and its inventory (1,623 literals in 97 files, shrinking), the registries made; to nought
    still to do.
  - [ ] Law 11: N5 (reach tallies), N6 (`oikos reliance`).
  - [ ] The hard-rule lines for laws 9, 11 and 12, to the owner first.
- [ ] **Market power in prices** (ME-16), after phase 4.
- [ ] **Translator rebuild,** once forms settle: about the current size, writing an act constrained by the form's
  grammar; Sonnet only as the safety net, its share reported in every run. Retrain plan: the 2026-10-25 "Translator v3"
  entry in docs/decisions.md. The v4 design for the study (approved 2026-11-07): docs/design/translator-v4.md.
  For the retrain (2026-11-07): train on the labels made one way
  (`runs/translator-fair-2026-11-07/data-v3-fair/`); the assistants' papers (`scope_request` above all) written in many
  styles, never trained so far (risk TR-8); report the fair score beside the exact one; run `translator/eval/scope-run.ts`.
  - [x] The translator as part of the instrument: fair scoring checked against the resolver, labels made one way,
    field-type masks, requests of several lines, the scope-request check (decisions 2026-11-07).
  - [ ] Sonnet behind measured on the scope-request set, before the delegation study counts requests for more scope.
  - [x] v4 step 1: data by code (rows re-rendered inside real seats' card lists; the length check before training).
  - [x] v4 step 2: the assistants' papers written and keyed (1,451 rows); the scope pilot's test split and keying done
    (round 2, decisions 2026-11-08: 581 train, 368 test rows); Haiku-style rewrites (1,059) and the per-model parity set
    (334, Claude stand-ins; round 3). Open-weight and Codex voices still to come from their runs.
  - [x] v4 round 2: sureness calibrated on validation-real, the control retrained with the pilot's requests (two seeds),
    scored with parity by model; the pass mark not met, nothing released (decisions 2026-11-08).
  - [x] v4 round 3: two seeds served together, copied-words checks, not_an_act and no_such_act told alike, Haiku-style
    data, retrained (two seeds); a cut-off certified on validation, the pass mark and parity not met, nothing released
    (decisions 2026-11-08).
  - [x] v4 round 4: a third blind reader on the keys, rounds 4 and 5 of the pilot as validation (905 rows), an
    edge-tolerant text sureness and a style-blind calibrator; 68% served right at a certified cut, parity 15-20 points;
    stalled, stopped; the mark's next step is the owner's (decisions 2026-11-08).
  - [x] v4 step 3: reader swap (ettin-encoder-150m); the text writer (Gemma 3 270M under the grammar, copy constraint).
  - [x] v4 steps 4 and 5: batch 1 on RunPod (D, A, C) and its scores: D wins, the stop rule fires (decisions 2026-11-08).
- [x] **Citizen model,** trained from the captured citizen decisions (docs/design/citizen-model.md, docs/citizen-data.md).
  Caveat: trained on code minds' decisions, it inherits their assumptions; it is faster, not an independent check of how
  people delegate or respond to AI. Round 1 landed 2026-11-01: the act head for a want's way (`want-way-r1`, 1.3 points
  from the code mind's odds on two profiles never seen, every spread and edit check passed, 23 microseconds a
  decision), an optional citizen mind (`living.citizen_model`, off by default), one command
  (`bun scripts/citizen-model.ts`). Not yet: the content heads and teachers (design steps 2, 6, 7), which need the
  renderer and the owner's budget. (It is not faster than the code mind's arithmetic for this decision.)

## Waiting on the owner

Nothing now (2026-11-10). At step 5 of "Now": the month's API credit and a Featherless Developer key. (The older items
here, the research definition, a second pilot batch on the credit that expired 11 November and cloud agents on the
credit that expired 5 November, were overtaken by the study's definition and the path above.)

## Gaps in the register, to pick up when they matter (each names its entry in docs/risks.md where it has one)

- Commercial leases: no remedy for unpaid rent, no early exit, no rent reviews (docs/behaviour/leasing.md).
- [x] Systems keep the same hours every day (no weekends): desks of officers keep the place's working calendar, its days of rest and public holidays from the profile (`gap-weekends`).
- [x] A seat cannot yet be a non-resident agency officer (WM-14): a seat in the support office shares the body of an officer who lives outside the town (`gap-wm14`).
- [x] A taxpayer account to reclaim an overpayment from (PB-23): the tax collector keeps it (`taxpayer-accounts`, d3eb2bf3, cedc1903); its figures are still placeholders, so PB-23 stays open as mitigated.
- [x] Candidacy: a field of 19 for about 118 votes (PB-10): traced (`gap-pb10`): the test's own 10% chance of standing, five times the profile's; the fault left is that the field grows with the electorate (a mechanism to the owner: decisions "Candidacy: the field of 19 traced").
- [x] One day's crew paperwork ran in series (MT-23): the seat held until each order began, fixed by foundations-2 P1; the seat-diary measure now reads the work's own times.
- [x] A model steward in a fork is a pilot's seat (MT-22): told what was not taken, the cast followed, thinking in world time, composer and exit accounts; resuming a fork part-way left open.
- Three tests still pinned to one seed (production, entry, own-venture); two near-duplicate twin cases kept.
- Haiku against Sonnet welfare: a matched pair (same town, same offices) before more Haiku seats.
- The unbased-figures list (orchestrator/test/figures.test.ts) to shrink as figures are sourced.
- [x] Borrowing to start a business (ME-1): a founder short of the capital applies to the bank, whose lending office decides by its rules (`gap-me1`); lending against a home and borrowing for premises left.
- [x] Dev machine: elastic slots, the pool fitting the machine's load, memory and each job class's measured use (PL-4 (1), `elastic-slots`).
- [x] Dev machine: Linux with a hosted nightly, and one Rust test program (PL-4 (2) and (3); branch `linux`, rebased on main 2026-10-31).
- Dev machine: a trial of sharding the slow tier on hosted runners (PL-4).
- The explorer's next steps (PL-2).

## Done (2026-10-24 to 2026-10-25)

- [x] Merge pipeline: two tiers, a lock, a gate of seconds to minutes; budgets in file-seconds; the gate runs the slow
  files a change reaches, or three canaries for a broad change; known timing flakes rerun once alone, CI's too.
- [x] Slots: an older version's waiter cannot hold the queue; builds run half their tokens' jobs; the engine runs as many
  threads as its slot; CI runner back (it had been down since 2026-10-17); CI installs every package the typecheck reads.
- [x] Test pruning: tests that pinned draws now check rules; slowest slow file halved; lean-tests rule in CLAUDE.md.
- [x] Disk: each worktree's test scratch tidied by the same rule as the runs.
- [x] Stand-ins removed (debt-generic-2), the run's seed draws who people are (debt-behaviour), guardianship (debt-risks).
- [x] Deemed refusal of an unanswered review where the law says so (MT-21); bounded public memory (SC-1).
- [x] Where the law has no deemed refusal (au-vic, gb-eng, us-oh), a complaint of the delay to a body that recommends (MT-21, `complaint_after_days`).
- [x] Citizen decisions captured in every model run, for the citizen model.
- [x] Six pilots on the Rust world ($31.86), their faults fixed (lending office's looks, a work site that is not a
  place, names a seat could not use), a returning holder's view shown whole.
- [x] Translator v3 first, names a seat was shown, Sonnet's share in every report.
- [x] Seat welfare: readiness check, missing papers told, outcomes of a seat's own acts shown, reasons in the notebook,
  framing chosen per seat with no default, a truthful answer to a seat that asks.
- [x] Act times sourced where they could be (WM-1, partly).
- [x] Market realism: entry by expected profit, joint draws of income, work and savings, hiring by real search;
  commercial leasing.
- [x] Scale, first round: config read person by person, shared settings held once; 10,000 people at 5.2 GB (was 10.2),
  50,000 for a month.
- [x] Foundations-2 design (with the owner's decisions) and phase 0, every number's basis counted.
