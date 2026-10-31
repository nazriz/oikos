# The plan

The one list of what is being built, in order, and what is done. Agents tick an item in the commit that lands it; the
coordinating session keeps the rest current. Each item names where its detail lives. Nothing is built that the owner
(Naz) has not approved in his own words; text relayed from another agent is input to discuss, not approval.

Status words: `[x]` landed on main, `[~]` in progress, `[ ]` not started, `[?]` waiting on the owner.

## North star

The owner's TARA proposal (`docs/north-star.md`, submitted 2026-10-28): a town of tens of thousands over years, live
models from more than one provider as assistants to households, firms and government; forks at checkpoints that
withdraw, redirect, constrain, replace or take back the AI, or withhold a citizen's act; debriefs compared with measured
effects. Not rigid, but every item below should say how it serves it. Where the platform stands against it (2026-10-31):

| The proposal needs | Today |
|---|---|
| Tens of thousands of people, over years | 50,000 for a month measured (14.7 GB, 604 s); no multi-year run at that size yet |
| Real-world friction | Laws of time and capacity (phase 1) and conservation (phase 2) landed; space (phase 3) not started |
| Models act only in plain language | Seats write English, the translator turns it into acts; our translator parked at about 85%, Sonnet behind it |
| Live models from more than one provider | Anthropic (API, Claude Code) and OpenAI (Codex CLI, which puts its own instructions under ours) |
| Models as assistants to households, firms and government | **Mostly built** (delegation capabilities, in "Now"): providers sell assistants to organisations and persons; mock seats play them; a real model's forms are next |
| Forks that withdraw, redirect, constrain, replace or take back the AI | Built (2026-10-31): interventions at a fork in the principal's own name (docs/experiments.md, "Interventions") |
| Requests for more scope or resources recorded | Built: a `scope_request` paper with what it answers, a route no arm can withhold; the code assistant never asks, a model may |
| Debriefs compared with measured effects | Debriefs and fork attribution exist; the comparison itself is analysis still to write |
| A measure of "less able to shape their society" | Leverage measures designed (docs/design/gradual-disempowerment.md §6); the definition is the owner's to settle |

## Now

- [~] **Years at the study's size** (code only): 10,000 people for 3 years and 50,000 for 2 or more; what breaks over
  time fixed with its law, what emerges recorded (docs/design/performance.md, "Years at 10,000 and 50,000"; decisions
  2026-10-31 "Years at 10,000"). First faults fixed: the hall's room, owners homeless while the register answers, the
  works office's inspections in one moment, the energy retailer's bills read once a connection.
- [~] **Memory per person.** A 10,000-person month peaked at about 500 KB a person; target about 50 KB, enforced by a
  test like the time budgets, results byte-identical (docs/design/performance.md, risk SC-1).
  - [x] Measure bytes per person at peak by component, at 1,000, 10,000 and 50,000 people (`mem-budget`, 8c28f399).
  - [x] The budget and its backstop test (a 1,000-person month fails over budget) (`mem-budget`, 8c28f399; ceiling 590 KB, lowered with each cut).
  - [~] Compact minds and memories (a cloud agent, branch `mem-minds`).
  - [x] A state hash worked out as it goes, without the cache of encoded copies (`mem-state-hash`, a60f9ae3).
  - [x] What people have seen, held compactly (any bound on what they remember is a law: to the owner first) (`mem-seen`, 7f81ceb3: held once for all who see it the same; no bound). Records delivered (`mem-delivered`) and buildings' facts (`mem-facts`) the same way.
  - [x] No whole-world copies during a step (`mem-no-copies`: what an act's copy of the state still copied whole, nature's fields, the network's lists, takings, floods and scarce sales, now shared; byte-identical, no change at the peak).
  - [x] 50,000 people for a month and 100,000 for a week, measured (with `mem-minds`: 14.7 GB and 604 s; 31.0 GB and 320 s; docs/design/performance.md).
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
- [~] **Foundations-2, phase 3: space** (law 9; branch `f2-phase3`: S1, the backstop and its inventory). Roads, pipes, wires and data lines with capacity and energy; people in
  transit; goods need a carrier; several towns as an option (§3). Transport and many towns come from this.
- [?] **Foundations-2, phase 4: the general economy** (§7). Services anyone can buy (E1: now part of the delegation
  capabilities, step D1, above); technologies as goods with an outside capability scenario; firms enter any industry;
  skills by use.
- [ ] **Foundations-2, phase 5:** strict modes on, old exception lists empty, each law's line in CLAUDE.md as its
  enforcement lands.
- [ ] **Market power in prices** (ME-16), after phase 4.
- [ ] **Translator rebuild,** once forms settle: about the current size, writing an act constrained by the form's
  grammar; Sonnet only as the safety net, its share reported in every run. Retrain plan: the 2026-10-25 "Translator v3"
  entry in docs/decisions.md.
- [ ] **Citizen model,** trained from the captured citizen decisions (docs/design/citizen-model.md, docs/citizen-data.md).
  Caveat: trained on code minds' decisions, it inherits their assumptions; it is faster, not an independent check of how
  people delegate or respond to AI.

## Waiting on the owner

- [?] **The research definition** of people becoming less able to shape their society, and the study's measures and
  arms (the owner's research choice).
- [?] **A second batch of pilots** on the API credit (expires 11 November): whether, and its budget.
- [?] **More cloud agents** on the session credit (expires 5 November), once the `mem-minds` trial reports.

## Gaps in the register, to pick up when they matter (each names its entry in docs/risks.md where it has one)

- Commercial leases: no remedy for unpaid rent, no early exit, no rent reviews (docs/behaviour/leasing.md).
- Systems keep the same hours every day (no weekends).
- [x] A seat cannot yet be a non-resident agency officer (WM-14): a seat in the support office shares the body of an officer who lives outside the town (`gap-wm14`).
- [x] A taxpayer account to reclaim an overpayment from (PB-23): the tax collector keeps it (`taxpayer-accounts`, d3eb2bf3, cedc1903); its figures are still placeholders, so PB-23 stays open as mitigated.
- Candidacy: a field of 19 for about 118 votes (PB-10).
- One day's crew paperwork ran in series, cause untraced (MT-23).
- Three tests still pinned to one seed (production, entry, own-venture); two near-duplicate twin cases kept.
- Haiku against Sonnet welfare: a matched pair (same town, same offices) before more Haiku seats.
- The unbased-figures list (orchestrator/test/figures.test.ts) to shrink as figures are sourced.
- Borrowing to start a business (ME-1).
- Dev machine: elastic slots, Linux with a hosted nightly, one Rust test program (PL-4).
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
