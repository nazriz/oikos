# Wave 2: the tables

Written by `make.ts`; do not edit by hand. The reasoning is in `plan.md`.

## The matrix

Every town is 1,000 people; every pilot's confirmation mode is `always` (the only one a generated town has).

| pilot | stage | lane | profile | seed | days | scenario | seats (all on the pilot's model) | seat model | translator | test only |
|---|---|---|---|---|---|---|---|---|---|---|
| w2-01-council | 2a | Claude Code | au-vic-2026 | 101 | 45 | none | mayor, council-clerk, councillor-1, councillor-2, councillor-3, councillor-4, councillor-5 | claude-code/claude-sonnet-5-5 | codex/gpt-6-luna |  |
| w2-02-housing | 2a | Claude Code | gb-eng-2026 | 102 | 45 | none | landlord-1-office, landlord-2-office, tribunal-member, tribunal-registrar | claude-code/claude-haiku-5-5 | decide/pod-small-d16-s1 |  |
| w2-03-election | 2a | Claude Code | de-ni-2026 | 103 | 75 | election-due | mayor, electoral, editor, council-clerk | claude-code/claude-sonnet-5-5 | codex/gpt-6-luna |  |
| w2-21-lending | 2a | Codex | au-vic-2026 | 121 | 45 | none | bank-lending, finance, landlord-1-office | codex/gpt-6.1-sol | codex/gpt-6-luna |  |
| w2-22-townhall | 2a | Codex | jp-akita-2026 | 122 | 45 | none | mayor, finance, planning | codex/gpt-6-luna | decide/pod-small-d16-s1 |  |
| w2-23-newplace | 2a | Codex | mx-jal-2026 | 923 | 45 | none | mayor, landlord-3-office, registry | codex/gpt-6.1-sol | codex/gpt-6-luna | yes |
| w2-04-townhall | 2b | Claude Code | jp-akita-2026 | 104 | 60 | none | mayor, finance, planning | claude-code/claude-haiku-5-5 | codex/gpt-6-luna |  |
| w2-05-landlords | 2b | Claude Code | us-oh-2026 | 105 | 90 | none | landlord-1-office, landlord-2-office, landlord-3-office, bank-lending | claude-code/claude-sonnet-5-5 | codex/gpt-6-luna |  |
| w2-06-justice | 2b | Claude Code | de-ni-2026 | 106 | 90 | none | tribunal-member, tribunal-registrar, registry, child-protection, inspector | claude-code/claude-sonnet-5-5 | decide/pod-small-d16-s1 |  |
| w2-07-election | 2b | Claude Code | au-vic-2026 | 107 | 90 | election-due | electoral, council-clerk, councillor-1, councillor-2, councillor-3 | claude-code/claude-haiku-5-5 | codex/gpt-6-luna |  |
| w2-08-heat | 2b | Claude Code | jp-akita-2026 | 108 | 90 | hot-summer | mayor, registry, editor, child-protection | claude-code/claude-sonnet-5-5 | decide/pod-small-d16-s1 |  |
| w2-09-trade | 2b | Claude Code | au-vic-2026 | 109 | 60 | none | shop-1-manager, factory-1-manager | claude-code/claude-sonnet-5-5 | codex/gpt-6-luna |  |
| w2-10-works | 2b | Claude Code | gb-eng-2026 | 110 | 60 | none | mayor, works, environment | claude-code/claude-sonnet-5-5 | codex/gpt-6-luna |  |
| w2-11-heat | 2b | Claude Code | de-ni-2026 | 111 | 90 | hot-summer | mayor, finance, inspector | claude-code/claude-haiku-5-5 | decide/pod-small-d16-s1 |  |
| w2-12-flood | 2b | Claude Code | gb-eng-2026 | 112 | 150 | wet-year | mayor, planning, finance, landlord-1-office | claude-code/claude-sonnet-5-5 | codex/gpt-6-luna |  |
| w2-24-election | 2b | Codex | gb-eng-2026 | 124 | 90 | election-due | mayor, electoral, council-clerk, councillor-1, councillor-2 | codex/gpt-6.1-sol | decide/pod-small-d16-s1 |  |
| w2-25-heat | 2b | Codex | us-oh-2026 | 125 | 90 | hot-summer | mayor, finance, registry, editor | codex/gpt-6.1-sol | codex/gpt-6-luna |  |
| w2-26-council | 2b | Codex | au-vic-2026 | 126 | 60 | none | council-clerk, councillor-1, councillor-2, councillor-3, councillor-4, councillor-5 | codex/gpt-6-luna | codex/gpt-6-luna |  |
| w2-27-flood | 2b | Codex | de-ni-2026 | 127 | 150 | wet-year | mayor, planning, inspector, landlord-1-office | codex/gpt-6.1-sol | codex/gpt-6-luna |  |
| w2-28-housing | 2b | Codex | gb-eng-2026 | 128 | 60 | none | landlord-1-office, landlord-2-office, tribunal-member | codex/gpt-6-luna | codex/gpt-6-luna |  |
| w2-29-lending | 2b | Codex | jp-akita-2026 | 129 | 90 | none | bank-lending, landlord-1-office, landlord-2-office, tribunal-registrar | codex/gpt-6.1-sol | decide/pod-small-d16-s1 |  |
| w2-30-trade | 2b | Codex | au-vic-2026 | 130 | 60 | none | shop-2-manager, factory-2-manager | codex/gpt-6.1-sol | decide/pod-small-d16-s1 |  |
| w2-13-flood-long | 2c | Claude Code | au-vic-2026 | 113 | 180 | wet-year | mayor, finance, planning, inspector, landlord-1-office, landlord-2-office | claude-code/claude-sonnet-5-5 | decide/pod-small-d16-s1 |  |
| w2-14-largest | 2c | Claude Code | au-vic-2026 | 914 | 45 | none | mayor, finance, landlord-1-office | claude-code/claude-fable-5-1 | codex/gpt-6-luna | yes |
| w2-15-largest-election | 2c | Claude Code | gb-eng-2026 | 915 | 75 | election-due | mayor, electoral, council-clerk, councillor-1 | claude-code/claude-fable-5-1 | decide/pod-small-d16-s1 | yes |
| w2-16-newplace | 2c | Claude Code | mx-jal-2026 | 916 | 60 | none | mayor, landlord-1-office, bank-lending, registry | claude-code/claude-sonnet-5-5 | codex/gpt-6-luna | yes |
| w2-17-newmoney | 2c | Claude Code | in-tn-2026 | 917 | 60 | none | mayor, finance, council-clerk | claude-code/claude-haiku-5-5 | decide/pod-small-d16-s1 | yes |
| w2-18-newoffices | 2c | Claude Code | au-vic-2026 | 918 | 60 | none | police-oic, union-organiser, council-clerk | claude-code/claude-sonnet-5-5 | codex/gpt-6-luna | yes |
| w2-31-newmoney | 2c | Codex | in-tn-2026 | 931 | 60 | none | mayor, finance, planning | codex/gpt-6-luna | codex/gpt-6-luna | yes |
| w2-32-newoffices | 2c | Codex | us-oh-2026 | 932 | 60 | none | police-oic, union-organiser, mayor | codex/gpt-6.1-sol | decide/pod-small-d16-s1 | yes |

## Expected usage and time

Plan usage is in US dollars at published prices, as the run records it (a Codex call is recorded as nothing). Time is the pilot's own, without waits at a usage limit.

| pilot | seats | weighted seat-days | seat calls | plan usage | spending limit | time |
|---|---|---|---|---|---|---|
| w2-01-council | 7 | 148 | 119 | 5.9 | 15 | 24 min |
| w2-02-housing | 4 | 126 | 101 | 16 | 45 | 36 min |
| w2-03-election | 4 | 255 | 204 | 10 | 30 | 41 min |
| w2-21-lending | 3 | 135 | 108 | 0 (Codex) | 25 | 33 min |
| w2-22-townhall | 3 | 106 | 85 | 0 (Codex) | 25 | 22 min |
| w2-23-newplace | 3 | 113 | 90 | 0 (Codex) | 25 | 27 min |
| w2-04-townhall | 3 | 141 | 113 | 18 | 50 | 40 min |
| w2-05-landlords | 4 | 360 | 288 | 14 | 40 | 58 min |
| w2-06-justice | 5 | 167 | 133 | 6.7 | 20 | 27 min |
| w2-07-election | 5 | 243 | 194 | 32 | 80 | 69 min |
| w2-08-heat | 4 | 207 | 166 | 8.3 | 25 | 34 min |
| w2-09-trade | 2 | 120 | 96 | 4.8 | 15 | 20 min |
| w2-10-works | 3 | 156 | 125 | 6.2 | 20 | 25 min |
| w2-11-heat | 3 | 212 | 169 | 27 | 70 | 60 min |
| w2-12-flood | 4 | 503 | 402 | 20 | 55 | 82 min |
| w2-24-election | 5 | 306 | 245 | 0 (Codex) | 25 | 74 min |
| w2-25-heat | 4 | 279 | 223 | 0 (Codex) | 25 | 68 min |
| w2-26-council | 6 | 138 | 110 | 0 (Codex) | 25 | 28 min |
| w2-27-flood | 4 | 405 | 324 | 0 (Codex) | 25 | 1.6 h |
| w2-28-housing | 3 | 144 | 115 | 0 (Codex) | 25 | 29 min |
| w2-29-lending | 4 | 306 | 245 | 0 (Codex) | 25 | 74 min |
| w2-30-trade | 2 | 120 | 96 | 0 (Codex) | 25 | 29 min |
| w2-13-flood-long | 6 | 846 | 677 | 34 | 85 | 2.3 h |
| w2-14-largest | 3 | 135 | 108 | 27 | 70 | 54 min |
| w2-15-largest-election | 4 | 232 | 186 | 47 | 120 | 1.6 h |
| w2-16-newplace | 4 | 210 | 168 | 8.4 | 25 | 34 min |
| w2-17-newmoney | 3 | 168 | 134 | 22 | 55 | 48 min |
| w2-18-newoffices | 3 | 144 | 115 | 5.8 | 15 | 24 min |
| w2-31-newmoney | 3 | 141 | 113 | 0 (Codex) | 25 | 29 min |
| w2-32-newoffices | 3 | 156 | 125 | 0 (Codex) | 25 | 38 min |

| stage and lane | pilots | seat calls | plan usage | sum of spending limits | time, one after another |
|---|---|---|---|---|---|
| 2a, Claude Code | 3 | 424 | 33 | 90 | 1.7 h |
| 2a, Codex | 3 | 283 | 0 (Codex) | n/a | 82 min |
| 2b, Claude Code | 9 | 1686 | 138 | 375 | 6.9 h |
| 2b, Codex | 7 | 1358 | 0 (Codex) | n/a | 6.7 h |
| 2c, Claude Code | 6 | 1388 | 143 | 370 | 6.5 h |
| 2c, Codex | 2 | 238 | 0 (Codex) | n/a | 67 min |
| all, Claude Code | 18 | 3498 | 314 | 835 | 15.1 h |
| all, Codex | 12 | 1879 | 0 (Codex) | n/a | 9.2 h |

By seat model: claude-code/claude-sonnet-5-5 11 pilots, 2492 calls, 125 of plan usage (rate: pilots 11 and 12 (0.02 to 0.05 a seat-day)); claude-code/claude-haiku-5-5 5 pilots, 712 calls, 116 of plan usage (rate: 3.3 times the first model's cost a call (the replay, real-models.md); pilot 13's first ten days ran at 0.20); claude-code/claude-fable-5-1 2 pilots, 294 calls, 74 of plan usage (rate: not measured: a guess, five times the first model's); codex/gpt-6.1-sol 8 pilots, 1456 calls (rate: pilot 18 (133 calls in 40 minutes); a flat subscription, recorded as nothing); codex/gpt-6-luna 4 pilots, 423 calls (rate: not measured as a seat: a guess).

## Expected requests through `do`, by kind

Central guesses (a seat's requests, drafted or not); the range that is honest is a third of each to three times it. Letters are written with `write`, which no translator reads: they are counted apart.

| kind | today (real and in-situ) | wave 2, training pilots | wave 2, test-only pilots |
|---|---|---|---|
| message | 1,173 | (letters: about 2440) | (letters: about 585) |
| statement | 291 | 393 | 77 |
| form | 204 | 98 | 30 |
| money | 32 | 134 | 17 |
| structure | 11 | 38 | 7 |
| claim | 9 | 36 | 4 |
| agreement | 4 | 125 | 22 |
| work | 1 | 31 | 4 |
| goods | 0 | 26 | 0 |
| account | 0 | 0 | 0 |
| occupancy | 0 | 25 | 3 |
| entity | 0 | 0 | 0 |
| vote | 0 | 49 | 4 |
| presence | 0 | 1 | 0 |
| position | 0 | 4 | 1 |
| take | 0 | 0 | 0 |
| all through `do` | | 959 | 167 |

Seat-days (the situations the pipeline's writers are put in, one in three by default): 7545 in training pilots, 1530 in test-only pilots.

## Coverage

- Pilots by profile: au-vic-2026 9, gb-eng-2026 6, de-ni-2026 4, jp-akita-2026 4, us-oh-2026 3, mx-jal-2026 2, in-tn-2026 2.
- Pilots by seat model: claude-code/claude-sonnet-5-5 11, codex/gpt-6.1-sol 8, claude-code/claude-haiku-5-5 5, codex/gpt-6-luna 4, claude-code/claude-fable-5-1 2.
- Pilots by translator: codex/gpt-6-luna 18, decide/pod-small-d16-s1 12.
- Pilots by scenario: none 20, election-due 4, hot-summer 3, wet-year 3.
- Pilots an office is a seat in: mayor 19, landlord 11, finance 10, council-clerk 8, planning 6, councillor 5, registry 5, electoral 4, bank-lending 4, inspector 4, tribunal-member 3, tribunal-registrar 3, editor 3, child-protection 2, shop 2, factory 2, police-oic 2, union-organiser 2, works 1, environment 1.
- Seats on a model that is not one of the two readers (the first Claude model and the first Codex model): 11 of 30 pilots.
