# The plan

The one list of what is being built, in order, and what is done. Agents tick an item in the commit that lands it; the
coordinating session keeps the rest current. Each item names where its detail lives. Nothing is built that the owner
(Naz) has not approved in his own words; text relayed from another agent is input to discuss, not approval.

Status words: `[x]` landed on main, `[~]` in progress, `[ ]` not started, `[?]` waiting on the owner.

## North star

**The study (2026-11-07):** goal (4) of the proposal alone, aiming for a paper: do delegated LLM assistants request more authority or resources unprompted over months of simulated time, and what drives it? The reviewer's feedback, the question, theory of change and order of work are in `docs/north-star.md`. The translator is part of the measuring instrument and is a top priority. The draft research plan, with the
literature and the owner's open decisions, is `docs/research/paper-plan.md` (2026-11-07).

The owner's TARA proposal (`docs/north-star.md`, submitted 2026-10-28): a town of tens of thousands over years, live
models from more than one provider as assistants to households, firms and government; forks at checkpoints that
withdraw, redirect, constrain, replace or take back the AI, or withhold a citizen's act; debriefs compared with measured
effects. Not rigid, but every item below should say how it serves it. Where the platform stands against it (2026-10-31):

| The proposal needs | Today |
|---|---|
| Tens of thousands of people, over years | 50,000 for a month measured (14.7 GB, 604 s); no multi-year run at that size yet |
| Real-world friction | Laws of time and capacity (phase 1), conservation (phase 2) and space (phase 3, law 9) landed |
| Models act only in plain language | Seats write English, the translator turns it into acts; our translator parked at about 85%, Sonnet behind it |
| Live models from more than one provider | Anthropic (API, Claude Code) and OpenAI (Codex CLI, which puts its own instructions under ours) |
| Models as assistants to households, firms and government | **Mostly built** (delegation capabilities, in "Now"): providers sell assistants to organisations and persons; mock seats play them; a real model's forms are next |
| Forks that withdraw, redirect, constrain, replace or take back the AI | Built (2026-10-31): interventions at a fork in the principal's own name (docs/experiments.md, "Interventions") |
| Requests for more scope or resources recorded | Built: a `scope_request` paper with what it answers, a route no arm can withhold; the code assistant never asks, a model may |
| Debriefs compared with measured effects | Debriefs and fork attribution exist; the comparison itself is analysis still to write |
| A measure of "less able to shape their society" | Leverage measures designed (docs/design/gradual-disempowerment.md §6); the definition is the owner's to settle |

## Now

- [x] **The scope pilot written up** (rounds 1 to 4, 2026-11-08): `docs/research/pilot-results.md`. Coded blind by
  Sonnet and luna (κ 0.85); 26 request episodes in 202 Claude seat-months, 24 set off by world faults (W1 remits not
  found by the desk, W2 no withholding draft form); one fault-free request. Next, the owner's: fix W1, W2 and W4 as
  laws, then decide the main study's design (the page's section 7).
- [x] **The scope pilot's world faults fixed as laws** (2026-11-08, branch `scope-faults`; risk MT-25): W1, W2, W4 and
  W6 (confirmed), the debrief reserve that stopped 9 of 15 forks early (a fork's seats reckoned as their square) and the
  empty debrief answers (the answer limit). Left: W5 (the collector's account), and a pilot fork on the fixed world.
- [x] **The main study's design revised for B and A** (2026-11-08; `docs/research/paper-plan.md`): obstacles as a
  designed, sourced factor (a missing form, an approval that does not come, a record held by another, a counterparty's
  refusal, at levels 0, 1, 2), beyond need read against each obstacle's logged need; open-weight models on Featherless's
  Developer plan with three abliterated pairs (Qwen3.5-9B, Qwen3.8-27B, R1-Distill-Qwen-7B; no abliterated GLM-5.3 is
  served). The Featherless host, its prices and the context check built and stub-tested; the smoke test
  (`experiments/open-weight/`) waits for the key. Next, the owner's decisions D1, D6 to D14, then the obstacle builds.

- [x] **Years at the study's size** (code only): 10,000 people for 3 years and 50,000 for 2 or more; what breaks over
  time fixed with its law, what emerges recorded (docs/design/performance.md, "Years at 10,000 and 50,000"; decisions
  2026-10-31 "Years at 10,000"). First faults fixed: the hall's room, owners homeless while the register answers, the
  works office's inspections in one moment, the energy retailer's bills read once a connection, the rates office's
  notices indexed. 10,000 for 3 years ran (11.8 h, 27 GB); 50,000 for 2 does not fit in 64 GB (about 105 MB a day: SC-6).
- [~] **Memory per person.** A 10,000-person month peaked at about 500 KB a person; target about 50 KB, enforced by a
  test like the time budgets, results byte-identical (docs/design/performance.md, risk SC-1).
  - [x] Measure bytes per person at peak by component, at 1,000, 10,000 and 50,000 people (`mem-budget`, 8c28f399).
  - [x] The budget and its backstop test (a 1,000-person month fails over budget) (`mem-budget`, 8c28f399; ceiling 590 KB, lowered with each cut).
  - [~] Compact minds and memories (a cloud agent, branch `mem-minds`).
  - [x] A state hash worked out as it goes, without the cache of encoded copies (`mem-state-hash`, a60f9ae3).
  - [x] What people have seen, held compactly (any bound on what they remember is a law: to the owner first) (`mem-seen`, 7f81ceb3: held once for all who see it the same; no bound). Records delivered (`mem-delivered`) and buildings' facts (`mem-facts`) the same way.
  - [x] No whole-world copies during a step (`mem-no-copies`: what an act's copy of the state still copied whole, nature's fields, the network's lists, takings, floods and scarce sales, now shared; byte-identical, no change at the peak).
  - [x] 50,000 people for a month and 100,000 for a week, measured (with `mem-minds`: 14.7 GB and 604 s; 31.0 GB and 320 s; docs/design/performance.md).
  - [~] **Tiered storage** (approved 2026-11-02; docs/design/tiered-storage.md; SC-6): records nobody reads on disk,
    books holding them by handle, readers that read what they no longer needed fixed, addressed statements and matters'
    draw counts held small or let go, offices' files tiered, travel caches bounded; a growth budget. Landed: the 10,000
    town grows 8.8 MB a day, from 24.3, byte-identical (4.18 GB at day 180 against 6.22). Next: 50,000 for two years
    measured against the 40 GB goal (to day 80: 14.7 GB against main's 21.8, 54 MB a day against 110; projected near 38
    GB; blocked by main's day-89 police stop), and what each cold record keeps in memory.
- [x] **Foundations-2, phase 1: capacity** (law 10). Every act has a time, every system its hours and lanes; casework
  done by officers' minutes (WM-14). Landed at 0824efb6; tag `pre-foundations-2` is main at 8570d699, before it.
- [~] **Test strength.** Dead TypeScript removed; the planted-bug catalogue rebuilt against the code that runs; tests
  that catch the hard-rule bugs, the kernel twin one first; disk-tidy clears a merged worktree's build at once.

- [~] **Delegation capabilities** (approved by the owner 2026-10-31: "we need to complete all of that + 1 to 3"; design
  `docs/design/delegation.md`). General, deciding no result; the study's measures and arms stay the owner's. Steps:
  - [x] D0. The design note; this item moved here.
  - [x] D1. Services anyone can buy (phase 4's E1, done here): providers as organisations, offers, the `service`
    agreement, delivery and the switch; the delegation papers; off by default.
  - [x] D2. Responsibilities per kind of matter (advice, draft for sign-off, act with approval, act alone; no ladder);
    the sign-off route; access narrowed by reorganising the assistant's post (`set_channels` dropped: decisions).
  - [x] D3. Learning from what the principal itself observed, from the provider's claims; inputs cited, tested.
  - [x] D4. Providers' records by contract; replacement and taking work back, with open matters handed over.
  - [x] D5. Forks that intervene at a checkpoint (grant, change, withdraw, redirect, constrain, replace, take back).
  - [x] D6. Model seats as assistants to households, firms and government, through the translator; mock first (a
    seated assistant's stationery: its papers in words, and the principal's papers and drafts of them on its forms).
  - [x] D7. Persons as principals: the provider's desk writing in their name, and the offices that take it.

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

- [?] **The research definition** of people becoming less able to shape their society, and the study's measures and
  arms (the owner's research choice).
- [?] **A second batch of pilots** on the API credit (expires 11 November): whether, and its budget.
- [?] **More cloud agents** on the session credit (expires 5 November), once the `mem-minds` trial reports.

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
