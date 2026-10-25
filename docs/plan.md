# The plan

The one list of what is being built, in order, and what is done. Agents tick an item in the commit that lands it; the
coordinating session keeps the rest current. Each item names where its detail lives. Nothing is built that the owner
(Naz) has not approved in his own words; text relayed from another agent is input to discuss, not approval.

Status words: `[x]` landed on main, `[~]` in progress, `[ ]` not started, `[?]` waiting on the owner.

## Now

- [~] **Memory per person.** A 10,000-person month peaked at about 500 KB a person; target about 50 KB, enforced by a
  test like the time budgets, results byte-identical (docs/design/performance.md, risk SC-1).
  - [ ] Measure bytes per person at peak by component, at 1,000, 10,000 and 50,000 people.
  - [ ] The budget and its backstop test (a 1,000-person month fails over budget).
  - [~] Compact minds and memories (a cloud agent, branch `mem-minds`).
  - [ ] A state hash worked out as it goes, without the cache of encoded copies.
  - [ ] What people have seen, held compactly (any bound on what they remember is a law: to the owner first).
  - [ ] No whole-world copies during a step.
  - [ ] 50,000 people for a month and 100,000 for a week, measured.
- [~] **Foundations-2, phase 1: capacity** (law 10). Every act has a time, every system its hours and lanes; casework
  done by officers' minutes (WM-14). Branch `f2-phase1`; tag `pre-foundations-2` on main before it lands.
- [~] **Test strength.** Dead TypeScript removed; the planted-bug catalogue rebuilt against the code that runs; tests
  that catch the hard-rule bugs, the kernel twin one first; disk-tidy clears a merged worktree's build at once.

## Next, in order

- [ ] **Foundations-2, phase 2: conservation** (law 8). Water, energy, materials and waste as stocks with flows;
  metered homes; recipes say their energy and water; shortages follow from network, contracts and operators, with no
  allocation rule (docs/design/foundations-2.md §2).
- [ ] **Foundations-2, phase 3: space** (law 9). Roads, pipes, wires and data lines with capacity and energy; people in
  transit; goods need a carrier; several towns as an option (§3). Transport and many towns come from this.
- [?] **Foundations-2, phase 4: the general economy** (§7). Services anyone can buy; technologies as goods with an
  outside capability scenario; firms enter any industry; skills by use. Overlaps the delegation capabilities below.
- [ ] **Foundations-2, phase 5:** strict modes on, old exception lists empty, each law's line in CLAUDE.md as its
  enforcement lands.
- [ ] **Market power in prices** (ME-16), after phase 4.
- [ ] **Translator rebuild,** once forms settle: about the current size, writing an act constrained by the form's
  grammar; Sonnet only as the safety net, its share reported in every run. Retrain plan: the 2026-10-25 "Translator v3"
  entry in docs/decisions.md.
- [ ] **Citizen model,** trained from the captured citizen decisions (docs/design/citizen-model.md, docs/citizen-data.md).

## Waiting on the owner

- [?] **Delegation capabilities** (proposed, not approved): responsibilities granted, changed and withdrawn at levels set
  independently per kind of matter (no ladder); a principal's instructions logged apart from the AI's acts; the AI's
  requests for scope as logged acts; providers as organisations with their own records and contracts, records
  transferable by contract; forks that apply an intervention; delegation decisions from the actor's own information only.
- [?] **The research definition** of people becoming less able to shape their society, and the study's measures and
  arms (the owner's research choice).
- [?] **A second batch of pilots** on the API credit (expires 11 November): whether, and its budget.
- [?] **More cloud agents** on the session credit (expires 5 November), once the `mem-minds` trial reports.

## Gaps in the register, to pick up when they matter (each names its entry in docs/risks.md where it has one)

- Commercial leases: no remedy for unpaid rent, no early exit, no rent reviews (docs/behaviour/leasing.md).
- Systems keep the same hours every day (no weekends). A seat cannot yet be a non-resident agency officer (WM-14).
- No taxpayer account to reclaim an overpayment from (PB-23).
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
