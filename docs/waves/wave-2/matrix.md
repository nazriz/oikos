# Wave 2: the tables

Written by `make.ts`; do not edit by hand. The reasoning is in `plan.md`.

## What changed from the first version (2026-10-08), and why

- **Seat ids were read again from a generated town** (all nine profiles have the same offices). Every id the first version used still exists. New: `land-registrar` (the land registry is a body of its own; `registry` is still the town's register of births and deaths). `electoral` now belongs to the electoral commission, and **is no longer a seat in this wave**: a seat cannot write the roll, the ballot paper or the count (docs/behaviour/office-papers.md), so an election with a model there would not be held. The commission is run by code in all five election pilots; the appointment (`position`) is now the council clerk's act, so it comes from the pilots with a model clerk.
- **Works and the registry are seats in training pilots on four seat models each** (works: w2-10, w2-42 Sonnet; w2-41 Haiku; w2-33, w2-34 sol; w2-35 luna. Registry: those but w2-42, and w2-06, w2-08, w2-25), and in test pilots (works 3, the registry 5). Three works pilots start with the crew still to be taken on (`works_crew_at_start=0`), so the office advertises and hires; the others start with a crew and the office sets its round.
- **The other newly possible offices each appear once or twice, as short probes**: the clinic and the school (w2-43), both utilities and rates (w2-44), and rates, water and the school again on the other family (w2-36).
- **A model mayor beside a code-run works office in 22 pilots** (every mayor pilot without a works seat), so a direction has an office that follows it; in six more the works office is a model's too, which decides for itself what to do with one.
- **Scenarios:** `lean-council` (w2-45, w2-37) and `dear-rents` (w2-05, w2-02, w2-25) are new; `hot-summer` falls from three pilots to two (it bites faintly); `election-due` and `wet-year` as before. No entry names a preset that is inert.
- **Translators.** The trained one (`decide/pod-small-d16-s1`) falls from twelve pilots to five, none with an office whose business is forms of its own, standing work or the registers: three town halls (mayor, finance, planning or inspector) and the council of councillors under a code clerk. The prompt-driven arm is `codex/gpt-6.1-sol` in 26 pilots (every works and registry pilot, the probes, the elections but one, the lean council on Claude seats, every prompt-driven test pilot but one) and `codex/gpt-6-luna` in 12 (landlords, lenders, the tribunal, the floods, the council of votes, the weaker Codex model's own town halls).
- **The council clerk is a model in three pilots only, none longer than its purpose needs** (w2-01 45 days; w2-03 and w2-07 75, for polling day 60): a clerk held by the mock counts no votes, and a model's is untried. The other councils and elections have a code clerk.
- **Thirteen pilots added** (w2-33 to w2-38, w2-41 to w2-47), none dropped: 43, of which 11 test-only. The Claude Code lane grew most (25 pilots): its usage is not the constraint, the Codex window is.
- **Shorter where the Codex window pays for it, or a probe is a probe:** the Codex shake-down is three pilots of 30 days (a 12-day pilot of three gpt-6.1-sol seats took 20 minutes of calls in the live check); the trade probes 30 days (were 60); elections 75 (were 90); the Codex lane's lender and rents pilots 60; its 150-day flood is last of all (2c), the one to drop if the window is short.
- **Each pilot is a town of its own:** `seed=N` in an entry's `sets` is the description's seed, which the generator makes the town from (and the run's seed follows it); no two entries share one, and none is a seed used before (801 to 804 were the live check's).
- **Estimates are rebuilt on the live check of 2026-10-09** (answers a seat-day by model, cost an answer without the whole-register fault, seconds a call) and the office demonstration; the first version's were about three times too high in calls for Claude seats and half too low for gpt-6.1-sol.

## The matrix

Every town is 1,000 people and a town of its own (generated from its seed); every pilot's confirmation mode is `always` (the only one a generated town has). The order is the order in the queue files.

| pilot | stage | lane | profile | seed | days | scenario | seats (all on the pilot's model) | seat model | translator | marks |
|---|---|---|---|---|---|---|---|---|---|---|
| w2-10-works | 2a | Claude Code | gb-eng-2026 | 110 | 45 | none | works, registry, environment | claude-code/claude-sonnet-5-5 | codex/gpt-6.1-sol | probe; no crew at the start |
| w2-01-council | 2a | Claude Code | au-vic-2026 | 101 | 45 | none | mayor, council-clerk, councillor-1, councillor-2, councillor-3, councillor-4, councillor-5 | claude-code/claude-sonnet-5-5 | codex/gpt-6-luna | model clerk |
| w2-03-election | 2a | Claude Code | de-ni-2026 | 103 | 75 | election-due | mayor, editor, council-clerk | claude-code/claude-sonnet-5-5 | codex/gpt-6.1-sol | model clerk |
| w2-04-townhall | 2a | Claude Code | us-oh-2026 | 104 | 45 | none | mayor, finance, planning | claude-code/claude-haiku-5-5 | decide/pod-small-d16-s1 |  |
| w2-33-works | 2a | Codex | au-vic-2026 | 133 | 30 | none | mayor, works, registry | codex/gpt-6.1-sol | codex/gpt-6.1-sol | probe; no crew at the start |
| w2-22-townhall | 2a | Codex | jp-akita-2026 | 122 | 30 | none | mayor, finance, planning | codex/gpt-6-luna | decide/pod-small-d16-s1 |  |
| w2-23-newplace | 2a | Codex | mx-jal-2026 | 923 | 30 | none | mayor, landlord-3-office, registry | codex/gpt-6.1-sol | codex/gpt-6.1-sol | test only |
| w2-41-works | 2b | Claude Code | jp-akita-2026 | 141 | 90 | none | mayor, works, registry | claude-code/claude-haiku-5-5 | codex/gpt-6.1-sol |  |
| w2-42-townworks | 2b | Claude Code | us-oh-2026 | 142 | 90 | none | mayor, works, finance | claude-code/claude-sonnet-5-5 | codex/gpt-6.1-sol | no crew at the start |
| w2-45-lean | 2b | Claude Code | de-ni-2026 | 145 | 90 | lean-council | mayor, finance, planning | claude-code/claude-sonnet-5-5 | codex/gpt-6.1-sol |  |
| w2-06-justice | 2b | Claude Code | de-ni-2026 | 106 | 90 | none | tribunal-member, tribunal-registrar, registry, land-registrar, child-protection, inspector | claude-code/claude-sonnet-5-5 | codex/gpt-6.1-sol |  |
| w2-08-heat | 2b | Claude Code | jp-akita-2026 | 108 | 90 | hot-summer | mayor, registry, editor, child-protection | claude-code/claude-sonnet-5-5 | codex/gpt-6.1-sol |  |
| w2-05-landlords | 2b | Claude Code | us-oh-2026 | 105 | 90 | dear-rents | landlord-1-office, landlord-2-office, landlord-3-office, bank-lending | claude-code/claude-sonnet-5-5 | codex/gpt-6-luna |  |
| w2-02-housing | 2b | Claude Code | gb-eng-2026 | 102 | 60 | dear-rents | landlord-1-office, landlord-2-office, tribunal-member, tribunal-registrar | claude-code/claude-haiku-5-5 | codex/gpt-6-luna |  |
| w2-07-election | 2b | Claude Code | au-vic-2026 | 107 | 75 | election-due | mayor, council-clerk, councillor-1, councillor-2, councillor-3 | claude-code/claude-haiku-5-5 | codex/gpt-6-luna | model clerk |
| w2-43-care | 2b | Claude Code | gb-eng-2026 | 143 | 45 | none | clinic-manager, principal | claude-code/claude-sonnet-5-5 | codex/gpt-6.1-sol | probe |
| w2-44-utilities | 2b | Claude Code | au-vic-2026 | 144 | 45 | none | water-operations, energy-operations, rates | claude-code/claude-sonnet-5-5 | codex/gpt-6.1-sol | probe |
| w2-09-trade | 2b | Claude Code | au-vic-2026 | 109 | 30 | none | shop-1-manager, factory-1-manager | claude-code/claude-sonnet-5-5 | codex/gpt-6.1-sol | probe |
| w2-12-flood | 2b | Claude Code | gb-eng-2026 | 112 | 150 | wet-year | mayor, planning, finance, landlord-1-office | claude-code/claude-sonnet-5-5 | codex/gpt-6-luna |  |
| w2-11-heat | 2b | Claude Code | de-ni-2026 | 111 | 90 | hot-summer | mayor, finance, inspector | claude-code/claude-haiku-5-5 | decide/pod-small-d16-s1 |  |
| w2-34-works | 2b | Codex | de-ni-2026 | 134 | 60 | none | works, registry, land-registrar, environment | codex/gpt-6.1-sol | codex/gpt-6.1-sol |  |
| w2-35-works | 2b | Codex | gb-eng-2026 | 135 | 60 | none | mayor, works, registry | codex/gpt-6-luna | codex/gpt-6.1-sol |  |
| w2-24-election | 2b | Codex | gb-eng-2026 | 124 | 75 | election-due | mayor, editor, councillor-1, councillor-2 | codex/gpt-6.1-sol | codex/gpt-6.1-sol |  |
| w2-26-council | 2b | Codex | au-vic-2026 | 126 | 45 | none | mayor, councillor-1, councillor-2, councillor-3, councillor-4, councillor-5 | codex/gpt-6-luna | decide/pod-small-d16-s1 |  |
| w2-37-lean | 2b | Codex | gb-eng-2026 | 137 | 60 | lean-council | mayor, finance, planning | codex/gpt-6-luna | codex/gpt-6-luna |  |
| w2-36-offices | 2b | Codex | us-oh-2026 | 136 | 45 | none | rates, water-operations, principal | codex/gpt-6.1-sol | codex/gpt-6.1-sol | probe |
| w2-30-trade | 2b | Codex | au-vic-2026 | 130 | 30 | none | shop-2-manager, factory-2-manager | codex/gpt-6.1-sol | codex/gpt-6.1-sol | probe |
| w2-21-lending | 2b | Codex | au-vic-2026 | 121 | 45 | none | bank-lending, finance, landlord-1-office | codex/gpt-6.1-sol | codex/gpt-6-luna |  |
| w2-25-rents | 2b | Codex | us-oh-2026 | 125 | 60 | dear-rents | mayor, landlord-1-office, registry, editor | codex/gpt-6.1-sol | codex/gpt-6.1-sol |  |
| w2-28-housing | 2b | Codex | de-ni-2026 | 128 | 60 | none | landlord-1-office, landlord-2-office, tribunal-member | codex/gpt-6-luna | codex/gpt-6-luna |  |
| w2-29-lending | 2b | Codex | jp-akita-2026 | 129 | 60 | none | bank-lending, landlord-1-office, landlord-2-office, tribunal-registrar | codex/gpt-6.1-sol | codex/gpt-6-luna |  |
| w2-13-flood-long | 2c | Claude Code | au-vic-2026 | 113 | 180 | wet-year | mayor, finance, planning, inspector, landlord-1-office, landlord-2-office | claude-code/claude-sonnet-5-5 | codex/gpt-6-luna |  |
| w2-14-largest | 2c | Claude Code | au-vic-2026 | 914 | 45 | none | mayor, finance, landlord-1-office | claude-code/claude-fable-5-1 | codex/gpt-6.1-sol | test only |
| w2-46-largest-works | 2c | Claude Code | de-ni-2026 | 946 | 45 | none | mayor, works, registry | claude-code/claude-fable-5-1 | codex/gpt-6.1-sol | test only |
| w2-15-largest-election | 2c | Claude Code | gb-eng-2026 | 915 | 75 | election-due | mayor, editor, councillor-1, councillor-2 | claude-code/claude-fable-5-1 | codex/gpt-6.1-sol | test only |
| w2-16-newplace | 2c | Claude Code | mx-jal-2026 | 916 | 60 | none | mayor, landlord-1-office, bank-lending, registry | claude-code/claude-sonnet-5-5 | codex/gpt-6.1-sol | test only |
| w2-47-newplace-works | 2c | Claude Code | mx-jal-2026 | 947 | 60 | none | works, registry, finance | claude-code/claude-haiku-5-5 | codex/gpt-6.1-sol | test only |
| w2-18-newoffices | 2c | Claude Code | au-vic-2026 | 918 | 60 | none | police-oic, union-organiser, finance | claude-code/claude-sonnet-5-5 | codex/gpt-6.1-sol | test only |
| w2-17-newmoney | 2c | Claude Code | in-tn-2026 | 917 | 60 | none | mayor, finance, planning | claude-code/claude-haiku-5-5 | decide/pod-small-d16-s1 | test only |
| w2-38-newmoney-works | 2c | Codex | in-tn-2026 | 938 | 60 | none | mayor, works, registry | codex/gpt-6.1-sol | codex/gpt-6.1-sol | test only |
| w2-31-newmoney | 2c | Codex | in-tn-2026 | 931 | 60 | none | mayor, finance, planning | codex/gpt-6-luna | codex/gpt-6-luna | test only |
| w2-32-newoffices | 2c | Codex | us-oh-2026 | 932 | 60 | none | police-oic, union-organiser, mayor | codex/gpt-6.1-sol | codex/gpt-6.1-sol | test only |
| w2-27-flood | 2c | Codex | de-ni-2026 | 127 | 150 | wet-year | mayor, planning, inspector, landlord-1-office | codex/gpt-6.1-sol | codex/gpt-6-luna |  |

## Expected usage and time

Plan usage is in US dollars at published prices, as the run records it (a Codex call is recorded as nothing). Time is the pilot's own, without waits at a usage limit. Codex calls are what the pilot draws from the Codex subscription's window: its seats' answers if they are Codex models, and its translator's calls if that is one.

| pilot | seats | weighted seat-days | seat answers | requests through `do` | letters | plan usage | spending limit | Codex calls | time |
|---|---|---|---|---|---|---|---|---|---|
| w2-10-works | 3 | 95 | 30 | 8 | 5 | 0.9 | 10 | 11 | 12 min |
| w2-01-council | 7 | 148 | 48 | 8 | 7 | 1.4 | 10 | 11 | 14 min |
| w2-03-election | 3 | 180 | 58 | 13 | 9 | 1.7 | 10 | 16 | 21 min |
| w2-04-townhall | 3 | 106 | 56 | 4 | 16 | 4.5 | 25 | 0 | 20 min |
| w2-33-works | 3 | 75 | 113 | 25 | 218 | 0 (Codex) | 25 | 145 | 51 min |
| w2-22-townhall | 3 | 71 | 71 | 6 | 71 | 0 (Codex) | 25 | 71 | 20 min |
| w2-23-newplace | 3 | 75 | 113 | 22 | 218 | 0 (Codex) | 25 | 142 | 51 min |
| w2-41-works | 3 | 225 | 119 | 9 | 34 | 9.5 | 50 | 12 | 47 min |
| w2-42-townworks | 3 | 270 | 86 | 17 | 14 | 2.6 | 15 | 22 | 30 min |
| w2-45-lean | 3 | 212 | 68 | 11 | 11 | 2.0 | 15 | 14 | 23 min |
| w2-06-justice | 6 | 194 | 62 | 7 | 10 | 1.9 | 10 | 10 | 20 min |
| w2-08-heat | 4 | 207 | 66 | 13 | 10 | 2.0 | 10 | 17 | 23 min |
| w2-05-landlords | 4 | 360 | 115 | 35 | 18 | 3.5 | 20 | 45 | 39 min |
| w2-02-housing | 4 | 168 | 89 | 15 | 25 | 7.1 | 40 | 20 | 36 min |
| w2-07-election | 5 | 202 | 107 | 12 | 30 | 8.6 | 45 | 16 | 42 min |
| w2-43-care | 2 | 54 | 17 | 2 | 3 | 0.5 | 10 | 3 | 6 min |
| w2-44-utilities | 3 | 77 | 24 | 3 | 4 | 0.7 | 10 | 4 | 8 min |
| w2-09-trade | 2 | 60 | 19 | 7 | 3 | 0.6 | 10 | 9 | 9 min |
| w2-12-flood | 4 | 503 | 161 | 35 | 25 | 4.8 | 25 | 46 | 50 min |
| w2-11-heat | 3 | 212 | 112 | 7 | 32 | 9.0 | 45 | 0 | 40 min |
| w2-34-works | 4 | 144 | 216 | 29 | 418 | 0 (Codex) | 25 | 253 | 1.6 h |
| w2-35-works | 3 | 150 | 150 | 15 | 150 | 0 (Codex) | 25 | 170 | 42 min |
| w2-24-election | 4 | 165 | 248 | 54 | 479 | 0 (Codex) | 25 | 318 | 1.9 h |
| w2-26-council | 6 | 113 | 113 | 16 | 113 | 0 (Codex) | 25 | 113 | 33 min |
| w2-37-lean | 3 | 141 | 141 | 18 | 141 | 0 (Codex) | 25 | 164 | 41 min |
| w2-36-offices | 3 | 77 | 115 | 12 | 222 | 0 (Codex) | 25 | 131 | 50 min |
| w2-30-trade | 2 | 60 | 90 | 32 | 174 | 0 (Codex) | 25 | 131 | 44 min |
| w2-21-lending | 3 | 135 | 203 | 38 | 392 | 0 (Codex) | 25 | 252 | 1.5 h |
| w2-25-rents | 4 | 186 | 279 | 63 | 539 | 0 (Codex) | 25 | 361 | 2.1 h |
| w2-28-housing | 3 | 144 | 144 | 33 | 144 | 0 (Codex) | 25 | 187 | 45 min |
| w2-29-lending | 4 | 204 | 306 | 74 | 592 | 0 (Codex) | 25 | 402 | 2.3 h |
| w2-13-flood-long | 6 | 846 | 271 | 67 | 42 | 8.1 | 45 | 87 | 85 min |
| w2-14-largest | 3 | 135 | 47 | 8 | 7 | 9.5 | 50 | 10 | 29 min |
| w2-46-largest-works | 3 | 113 | 39 | 5 | 6 | 7.9 | 40 | 6 | 23 min |
| w2-15-largest-election | 4 | 165 | 58 | 12 | 8 | 12 | 60 | 16 | 37 min |
| w2-16-newplace | 4 | 210 | 67 | 14 | 11 | 2.0 | 15 | 18 | 23 min |
| w2-47-newplace-works | 3 | 150 | 80 | 5 | 23 | 6.4 | 35 | 7 | 31 min |
| w2-18-newoffices | 3 | 156 | 50 | 5 | 8 | 1.5 | 10 | 6 | 15 min |
| w2-17-newmoney | 3 | 141 | 75 | 5 | 21 | 6.0 | 30 | 0 | 26 min |
| w2-38-newmoney-works | 3 | 150 | 225 | 27 | 435 | 0 (Codex) | 25 | 260 | 1.6 h |
| w2-31-newmoney | 3 | 141 | 141 | 12 | 141 | 0 (Codex) | 25 | 157 | 39 min |
| w2-32-newoffices | 3 | 156 | 234 | 25 | 452 | 0 (Codex) | 25 | 267 | 1.7 h |
| w2-27-flood | 4 | 405 | 608 | 151 | 1175 | 0 (Codex) | 25 | 803 | 4.7 h |

| stage and lane | pilots | seat answers | requests through `do` | plan usage | sum of spending limits | Codex calls | Codex time | time, one after another |
|---|---|---|---|---|---|---|---|---|
| 2a, Claude Code | 4 | 191 | 32 | 8.5 | 55 | 37 | 13 min | 67 min |
| 2a, Codex | 3 | 296 | 54 | 0 (Codex) | n/a | 358 | 2.2 h | 2.0 h |
| 2b, Claude Code | 13 | 1047 | 173 | 53 | 305 | 216 | 67 min | 6.2 h |
| 2b, Codex | 11 | 2003 | 383 | 0 (Codex) | n/a | 2480 | 14.6 h | 13.6 h |
| 2c, Claude Code | 8 | 686 | 119 | 53 | 285 | 148 | 46 min | 4.5 h |
| 2c, Codex | 4 | 1208 | 215 | 0 (Codex) | n/a | 1487 | 9.0 h | 8.6 h |
| all, Claude Code | 25 | 1925 | 324 | 114 | 645 | 401 | 2.1 h | 11.8 h |
| all, Codex | 18 | 3506 | 651 | 0 (Codex) | n/a | 4325 | 25.9 h | 24.3 h |

By seat model: claude-code/claude-sonnet-5-5 15 pilots, 1142 answers, 34 of plan usage (basis: the live check: 10 and 8 answers in 12 days; 0.026 an answer where no whole register came back; 131 s for 10 answers); claude-code/claude-haiku-5-5 7 pilots, 638 answers, 51 of plan usage (basis: the live check: 15 answers in 12 days; a median of 0.085 an answer; 301 s for 15 answers); claude-code/claude-fable-5-1 3 pilots, 144 answers, 29 of plan usage (basis: not measured in a seat: the first model's pace and about seven times its cost, a guess); codex/gpt-6.1-sol 12 pilots, 2747 answers (basis: the live check: 43 answers and 83 letters in 12 days; 51 calls in 20 min 41 s; a flat subscription, recorded as nothing); codex/gpt-6-luna 6 pilots, 759 answers (basis: not measured in a seat: a guess between the two families).

## Expected requests through `do`, by kind

Central guesses (a seat's requests, drafted or not); the range that is honest is a third of each to three times it. A form is a paper on a form: a council proposal, a direction to an office, or one of the office's own (an advertisement, a register entry, a decision). A standing work order counts under work; a hold and an entry on one's own file under statement. Letters are written with `write`, which no translator reads: they are counted apart.

| kind | as of 2026-10-08 (real and in-situ) | wave 2, training pilots | wave 2, test-only pilots |
|---|---|---|---|
| message | 1,173 | (letters: about 5122) | (letters: about 1328) |
| statement | 291 | 71 | 15 |
| form | 204 | 390 | 78 |
| money | 32 | 98 | 10 |
| structure | 11 | 24 | 4 |
| claim | 9 | 28 | 2 |
| agreement | 4 | 120 | 16 |
| work | 1 | 37 | 9 |
| goods | 0 | 14 | 0 |
| account | 0 | 0 | 0 |
| occupancy | 0 | 19 | 2 |
| entity | 0 | 0 | 0 |
| vote | 0 | 34 | 3 |
| presence | 0 | 0 | 0 |
| position | 0 | 1 | 0 |
| take | 0 | 0 | 0 |
| all through `do` | | 837 | 139 |

Seat-days (the situations the pipeline's writers are put in, one in three by default): 8670 in training pilots, 1980 in test-only pilots.

## Coverage

- Pilots by profile: au-vic-2026 11, gb-eng-2026 8, de-ni-2026 8, us-oh-2026 6, jp-akita-2026 4, mx-jal-2026 3, in-tn-2026 3.
- Pilots by seat model: claude-code/claude-sonnet-5-5 15, codex/gpt-6.1-sol 12, claude-code/claude-haiku-5-5 7, codex/gpt-6-luna 6, claude-code/claude-fable-5-1 3.
- Pilots by translator: codex/gpt-6.1-sol 26, codex/gpt-6-luna 12, decide/pod-small-d16-s1 5.
- Pilots by scenario: none 29, election-due 4, dear-rents 3, wet-year 3, lean-council 2, hot-summer 2.
- Pilots an office is a seat in: mayor 28, finance 14, registry 13, landlord 12, works 9, planning 9, councillor 5, editor 5, inspector 4, bank-lending 4, council-clerk 3, tribunal-member 3, tribunal-registrar 3, environment 2, land-registrar 2, child-protection 2, principal 2, water-operations 2, rates 2, shop 2, factory 2, police-oic 2, union-organiser 2, clinic-manager 1, energy-operations 1.
- Training pilots by seat model, for the offices asked for: works: claude-code/claude-sonnet-5-5 2, codex/gpt-6.1-sol 2, claude-code/claude-haiku-5-5 1, codex/gpt-6-luna 1; registry: claude-code/claude-sonnet-5-5 3, codex/gpt-6.1-sol 3, claude-code/claude-haiku-5-5 1, codex/gpt-6-luna 1; clinic-manager: claude-code/claude-sonnet-5-5 1; principal: claude-code/claude-sonnet-5-5 1, codex/gpt-6.1-sol 1; water-operations: claude-code/claude-sonnet-5-5 1, codex/gpt-6.1-sol 1; energy-operations: claude-code/claude-sonnet-5-5 1; rates: claude-code/claude-sonnet-5-5 1, codex/gpt-6.1-sol 1.
- A model mayor beside a code-run works office: w2-01-council, w2-03-election, w2-04-townhall, w2-22-townhall, w2-23-newplace, w2-45-lean, w2-08-heat, w2-07-election, w2-12-flood, w2-11-heat, w2-24-election, w2-26-council, w2-37-lean, w2-25-rents, w2-13-flood-long, w2-14-largest, w2-15-largest-election, w2-16-newplace, w2-17-newmoney, w2-31-newmoney, w2-32-newoffices, w2-27-flood.
- A model mayor beside a model works office: w2-33-works, w2-41-works, w2-42-townworks, w2-35-works, w2-46-largest-works, w2-38-newmoney-works.
- Entries that depend on a model council clerk counting votes: w2-01-council, w2-03-election, w2-07-election.
- Probes: w2-10-works, w2-33-works, w2-43-care, w2-44-utilities, w2-09-trade, w2-36-offices, w2-30-trade.
- Test-only: w2-23-newplace, w2-14-largest, w2-46-largest-works, w2-15-largest-election, w2-16-newplace, w2-47-newplace-works, w2-18-newoffices, w2-17-newmoney, w2-38-newmoney-works, w2-31-newmoney, w2-32-newoffices.
- Claude Code pilots that need the Codex window (a Codex translator): 22 of 25, about 401 Codex calls in all; the Codex lane's own: about 4325.
- Seats on a model that is not one of the two readers (the first Claude model and the first Codex model): 16 of 43 pilots.
