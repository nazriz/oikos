# Wave 2: the tables

Written by `make.ts`; do not edit by hand. The reasoning is in `plan.md`.

## What changed from the second version (2026-10-09, morning), and why

- **No pilot's translation waits on the Codex window.** The general translator is `claude-code/claude-sonnet-5-5` alone, with no chain of fallbacks (the owner, 2026-10-09; measured that morning under prompt 0.9.0: plan.md, "Translators"). The second version had a Codex model as translator in 38 of 43 pilots, and on the night of 2026-10-09 a pilot on Claude seats sat at day 0 for an hour for want of four translator calls.
- **Each pilot's translator is a late, cheap choice**, marked in the matrix: `sonnet` (the general model and no other: probes, elections, a crew to take on, measurements, every test pilot), `trained-ok` (our own retrained translator if its scores on the pilot's kinds of act are good enough when the stage starts, else the general model: 21 pilots), `trained` (our own, because its failures there are the data wanted: w2-26, five councillors). `make.ts --retrained decide/NAME [--retrained-for PILOT,...]` writes the files with it; until then every `trained-ok` pilot has the general model. The trained translator on disk serves the one `trained` pilot: in the second live check it refused 31 of a town hall's 44 requests, every one a hold or a withdrawal.
- **Codex models are seats only, in a lane of their own that blocks nothing** (`wave-2?-codex.json`: 12 pilots, none longer than 75 days, each with the general translator). The queue parks a pilot the moment its sign-in is at a limit and goes on (scripts/pilot-queue.ts, 2026-10-09). Six pilots that were on Codex seats are on Claude seats now (the second flood, the housing and lending pilots, the two probes, the council of councillors), so that their coverage does not depend on the window.
- **The largest Claude model sits in training seats** (the owner: it belongs in seats, and is not a translator): w2-14 in the shake-down, to measure it, then w2-46 and w2-15. **The held-out seat model is now gpt-6-luna** (four pilots, all test-only, all in the optional lane): the only models left to hold out are behind the Codex sign-in. If that lane never runs, the test has no unseen seat model, and plan.md says what is then done.
- **Two lanes of Claude seats, by what they cost.** `claude-1`: seats on the first and the largest Claude model (a 30-day pilot on the first recorded 0.62 and 0.99). `claude-2`: seats on the smaller one (18.54 and 15.51 for the same thirty days), one pilot at a time, shorter, with spending limits that fit; its first pilot (w2-54) measures that model at lower effort.
- **A registry seat's pilot is as long as it takes to have deaths to register.** In the second live check a registrar had none in thirty days. In code-run towns of each profile (one town each, 180 days) 2 to 10 deaths were registered, one of them in a first month, and no birth (the first is due about day 275). Registry seats are in pilots of 180 days on the cheap seats (w2-10, w2-06, w2-08; the test w2-49), 75 to 90 where the model is dear or the profile has the most deaths (w2-41, w2-46), and are taken out of pilots too short to give them anything (w2-33, w2-23, w2-35, w2-38, w2-47, w2-16).
- **Longer where a seat on the first Claude model costs almost nothing and comes back weekly:** landlords, housing and lending 120 days (were 60 to 90), the registers 180, the test pilots of that model 90.
- **Kenya and Brazil are in, as they are** (the owner, 2026-10-09: a profile does not have to be faithful to be used, and a town in trouble is data too): two pilots each, on the cheap seats, in training (a sixth and a seventh currency). The table below marks every town known not to be its place, and why.
- **Three more scenarios that reach an office**, one pilot each: `housing-shortage` (w2-28, landlords and the tribunal), `jobs-slump` (w2-21, the lender, the treasury, landlords), `energy-price-shock` (w2-44, the utilities probe). Eight presets in all, none in more than three pilots.
- **The three pilots with a model council clerk run in their lanes** (final pass: they were held in a file of their own). The fault was the mock's rhythm, not the clerk's code: a clerk held by the mock counts votes when it sits daily, and counted none sitting weekly, because a ballot closing is not a paper that brings a seat back. A real clerk is brought back by the proposal and by each vote, and has to arrange to be back for the count: untried, so w2-01 (45 days) is in the shake-down as the test of it, w2-03 and w2-07 are in the body after its report, and each is stopped if no result is declared within three weeks of a ballot opening. An election that does not turn on it stays (w2-48, a code clerk).
- **Every election pilot runs 75 days:** notice on day 1, nominations close on day 30, the poll, the count and the declaration on day 60, the winner seated by the clerk the day after, and two weeks of the new term.
- **Works pilots that start with no crew (w2-10, w2-42, w2-33) wait for nothing now** (final pass): a seat is told its office's staff and what each of its own forms is for. In the second live check such a seat never learned it had none, hired nobody, and the town had 301 complaints; the stopping rule for these pilots stays.
- **Final pass on origin/main 923d139** (everything the wave waited for is there): the low-effort measurement (w2-54) sets `seat_effort=low` for its seats and names the model plainly, so the translator's effort is untouched; `wake_on_papers` is left on everywhere (a paper filed with an office brings its seat back the next working day), which every estimate here predates; the translator's prompt is 0.9.1; five towns are marked as flooding through their wet seasons until the river's change lands.
- **Estimates are rebuilt on the second live check's thirty-day pilots:** a seat on the first Claude model sits weekly (0.42 answers a weighted seat-day, 3 or 4 requests a pilot-month); the smaller one is busy and dear (1.5 answers, 0.17 an answer); gpt-6.1-sol asked for 3 things in 25 days, not the five in twelve the second version was built on. They predate a change now on main (a paper filed with an office brings its seat back the next working day), with which seats sit more often.
- **50 pilots** (were 43): 38 on Claude seats in the three stages, 12 optional on Codex seats; 12 test-only.

## The matrix

Every town is 1,000 people and a town of its own (generated from its seed); every pilot's confirmation mode is `always` (the only one a generated town has). The order is the order in the queue files. Lanes: `claude-1` and `claude-2` need the Claude sign-in alone; `codex` is the optional lane (Codex seats, a Claude translator).

| pilot | stage | lane | profile | seed | days | scenario | seats (all on the pilot's model) | seat model | translator may be | translator in the file | marks |
|---|---|---|---|---|---|---|---|---|---|---|---|
| w2-10-works | 2a | claude-1 | gb-eng-2026 | 110 | 180 | none | works, registry, environment | claude-code/claude-sonnet-5-5 | sonnet | claude-code/claude-sonnet-5-5 | probe; no crew at the start |
| w2-44-utilities | 2a | claude-1 | au-vic-2026 | 144 | 45 | energy-price-shock | water-operations, energy-operations, rates | claude-code/claude-sonnet-5-5 | sonnet | claude-code/claude-sonnet-5-5 | probe |
| w2-09-trade | 2a | claude-1 | au-vic-2026 | 109 | 30 | none | shop-1-manager, factory-1-manager | claude-code/claude-sonnet-5-5 | sonnet | claude-code/claude-sonnet-5-5 | probe |
| w2-01-council | 2a | claude-1 | au-vic-2026 | 101 | 45 | none | mayor, council-clerk, councillor-1, councillor-2, councillor-3, councillor-4, councillor-5 | claude-code/claude-sonnet-5-5 | sonnet | claude-code/claude-sonnet-5-5 | model clerk |
| w2-14-largest | 2a | claude-1 | au-vic-2026 | 114 | 45 | none | mayor, finance, landlord-1-office | claude-code/claude-fable-5-1 | trained-ok | claude-code/claude-sonnet-5-5 |  |
| w2-54-effort | 2a | claude-2 | us-oh-2026 | 154 | 30 | none | mayor, finance, planning | claude-code/claude-haiku-5-5 | sonnet | claude-code/claude-sonnet-5-5 | seats at low effort |
| w2-04-townhall | 2a | claude-2 | us-oh-2026 | 104 | 45 | none | mayor, finance, planning | claude-code/claude-haiku-5-5 | sonnet | claude-code/claude-sonnet-5-5 |  |
| w2-26-council | 2a | claude-2 | au-vic-2026 | 126 | 45 | none | councillor-1, councillor-2, councillor-3, councillor-4, councillor-5 | claude-code/claude-haiku-5-5 | trained | decide/pod-small-d16-s1 |  |
| w2-33-works | 2a | codex | au-vic-2026 | 133 | 30 | none | mayor, works, finance | codex/gpt-6.1-sol | sonnet | claude-code/claude-sonnet-5-5 | probe; no crew at the start; optional |
| w2-22-townhall | 2a | codex | jp-akita-2026 | 922 | 30 | none | mayor, finance, planning | codex/gpt-6-luna | sonnet | claude-code/claude-sonnet-5-5 | test only; optional |
| w2-23-newplace | 2a | codex | mx-jal-2026 | 923 | 30 | none | mayor, landlord-3-office, finance | codex/gpt-6.1-sol | sonnet | claude-code/claude-sonnet-5-5 | test only; optional |
| w2-42-townworks | 2b | claude-1 | us-oh-2026 | 142 | 90 | none | mayor, works, finance | claude-code/claude-sonnet-5-5 | sonnet | claude-code/claude-sonnet-5-5 | no crew at the start |
| w2-45-lean | 2b | claude-1 | de-ni-2026 | 145 | 90 | lean-council | mayor, finance, planning | claude-code/claude-sonnet-5-5 | trained-ok | claude-code/claude-sonnet-5-5 |  |
| w2-48-election | 2b | claude-1 | us-oh-2026 | 148 | 75 | election-due | mayor, editor, councillor-1, councillor-2 | claude-code/claude-sonnet-5-5 | sonnet | claude-code/claude-sonnet-5-5 |  |
| w2-03-election | 2b | claude-1 | de-ni-2026 | 103 | 75 | election-due | mayor, editor, council-clerk | claude-code/claude-sonnet-5-5 | sonnet | claude-code/claude-sonnet-5-5 | model clerk |
| w2-06-justice | 2b | claude-1 | de-ni-2026 | 106 | 180 | none | tribunal-member, tribunal-registrar, registry, land-registrar, child-protection, inspector | claude-code/claude-sonnet-5-5 | trained-ok | claude-code/claude-sonnet-5-5 |  |
| w2-08-heat | 2b | claude-1 | jp-akita-2026 | 108 | 180 | hot-summer | mayor, registry, editor, child-protection | claude-code/claude-sonnet-5-5 | trained-ok | claude-code/claude-sonnet-5-5 |  |
| w2-05-landlords | 2b | claude-1 | us-oh-2026 | 105 | 120 | dear-rents | landlord-1-office, landlord-2-office, landlord-3-office, bank-lending | claude-code/claude-sonnet-5-5 | trained-ok | claude-code/claude-sonnet-5-5 |  |
| w2-28-housing | 2b | claude-1 | de-ni-2026 | 128 | 120 | housing-shortage | landlord-1-office, landlord-2-office, tribunal-member, tribunal-registrar | claude-code/claude-sonnet-5-5 | trained-ok | claude-code/claude-sonnet-5-5 |  |
| w2-21-lending | 2b | claude-1 | jp-akita-2026 | 121 | 120 | jobs-slump | bank-lending, finance, landlord-1-office, landlord-2-office | claude-code/claude-sonnet-5-5 | trained-ok | claude-code/claude-sonnet-5-5 |  |
| w2-43-care | 2b | claude-1 | gb-eng-2026 | 143 | 45 | none | clinic-manager, principal | claude-code/claude-sonnet-5-5 | sonnet | claude-code/claude-sonnet-5-5 | probe |
| w2-11-heat | 2b | claude-1 | de-ni-2026 | 111 | 90 | hot-summer | mayor, finance, inspector | claude-code/claude-sonnet-5-5 | trained-ok | claude-code/claude-sonnet-5-5 |  |
| w2-12-flood | 2b | claude-1 | gb-eng-2026 | 112 | 150 | wet-year | mayor, planning, finance, landlord-1-office | claude-code/claude-sonnet-5-5 | trained-ok | claude-code/claude-sonnet-5-5 |  |
| w2-27-flood | 2b | claude-1 | de-ni-2026 | 127 | 150 | wet-year | mayor, planning, inspector, landlord-1-office | claude-code/claude-sonnet-5-5 | trained-ok | claude-code/claude-sonnet-5-5 |  |
| w2-46-largest-works | 2b | claude-1 | de-ni-2026 | 146 | 90 | none | mayor, works, registry | claude-code/claude-fable-5-1 | trained-ok | claude-code/claude-sonnet-5-5 |  |
| w2-15-largest-election | 2b | claude-1 | gb-eng-2026 | 115 | 75 | election-due | mayor, editor, councillor-1, councillor-2 | claude-code/claude-fable-5-1 | sonnet | claude-code/claude-sonnet-5-5 |  |
| w2-50-evictions | 2b | claude-1 | ke-nakuru-2026 | 150 | 120 | none | landlord-1-office, landlord-2-office, tribunal-member, tribunal-registrar | claude-code/claude-sonnet-5-5 | trained-ok | claude-code/claude-sonnet-5-5 |  |
| w2-51-townhall | 2b | claude-1 | ke-nakuru-2026 | 151 | 90 | none | mayor, finance, planning | claude-code/claude-sonnet-5-5 | trained-ok | claude-code/claude-sonnet-5-5 |  |
| w2-52-river | 2b | claude-1 | br-mg-2026 | 152 | 120 | none | mayor, planning, inspector, landlord-1-office | claude-code/claude-sonnet-5-5 | trained-ok | claude-code/claude-sonnet-5-5 |  |
| w2-53-townhall | 2b | claude-1 | br-mg-2026 | 153 | 90 | none | mayor, finance, editor | claude-code/claude-sonnet-5-5 | trained-ok | claude-code/claude-sonnet-5-5 |  |
| w2-41-works | 2b | claude-2 | us-oh-2026 | 141 | 75 | none | mayor, works, registry | claude-code/claude-haiku-5-5 | trained-ok | claude-code/claude-sonnet-5-5 |  |
| w2-02-housing | 2b | claude-2 | gb-eng-2026 | 102 | 45 | dear-rents | landlord-1-office, landlord-2-office, tribunal-member, tribunal-registrar | claude-code/claude-haiku-5-5 | trained-ok | claude-code/claude-sonnet-5-5 |  |
| w2-36-offices | 2b | claude-2 | us-oh-2026 | 136 | 30 | none | rates, water-operations, principal | claude-code/claude-haiku-5-5 | sonnet | claude-code/claude-sonnet-5-5 | probe |
| w2-30-trade | 2b | claude-2 | au-vic-2026 | 130 | 30 | none | shop-2-manager, factory-2-manager | claude-code/claude-haiku-5-5 | sonnet | claude-code/claude-sonnet-5-5 | probe |
| w2-07-election | 2b | claude-2 | au-vic-2026 | 107 | 75 | election-due | mayor, council-clerk, councillor-1, councillor-2, councillor-3 | claude-code/claude-haiku-5-5 | sonnet | claude-code/claude-sonnet-5-5 | model clerk |
| w2-34-works | 2b | codex | us-oh-2026 | 134 | 45 | none | works, registry, land-registrar, environment | codex/gpt-6.1-sol | trained-ok | claude-code/claude-sonnet-5-5 | optional |
| w2-24-election | 2b | codex | gb-eng-2026 | 124 | 75 | election-due | mayor, editor, councillor-1, councillor-2 | codex/gpt-6.1-sol | sonnet | claude-code/claude-sonnet-5-5 | optional |
| w2-25-rents | 2b | codex | us-oh-2026 | 125 | 45 | dear-rents | mayor, landlord-1-office, registry, editor | codex/gpt-6.1-sol | trained-ok | claude-code/claude-sonnet-5-5 | optional |
| w2-35-works | 2b | codex | gb-eng-2026 | 935 | 45 | none | mayor, works, finance | codex/gpt-6-luna | sonnet | claude-code/claude-sonnet-5-5 | test only; optional |
| w2-29-lending | 2b | codex | jp-akita-2026 | 129 | 45 | none | bank-lending, landlord-1-office, landlord-2-office, tribunal-registrar | codex/gpt-6.1-sol | trained-ok | claude-code/claude-sonnet-5-5 | optional |
| w2-37-lean | 2b | codex | gb-eng-2026 | 937 | 45 | lean-council | mayor, finance, planning | codex/gpt-6-luna | sonnet | claude-code/claude-sonnet-5-5 | test only; optional |
| w2-13-flood-long | 2c | claude-1 | au-vic-2026 | 113 | 180 | wet-year | mayor, finance, planning, inspector, landlord-1-office, landlord-2-office | claude-code/claude-sonnet-5-5 | trained-ok | claude-code/claude-sonnet-5-5 |  |
| w2-16-newplace | 2c | claude-1 | mx-jal-2026 | 916 | 90 | none | mayor, landlord-1-office, bank-lending, finance | claude-code/claude-sonnet-5-5 | sonnet | claude-code/claude-sonnet-5-5 | test only |
| w2-49-newmoney-registers | 2c | claude-1 | in-tn-2026 | 949 | 180 | none | registry, land-registrar, finance | claude-code/claude-sonnet-5-5 | sonnet | claude-code/claude-sonnet-5-5 | test only |
| w2-18-newoffices | 2c | claude-1 | au-vic-2026 | 918 | 90 | none | police-oic, union-organiser, finance | claude-code/claude-sonnet-5-5 | sonnet | claude-code/claude-sonnet-5-5 | test only |
| w2-47-newplace-works | 2c | claude-2 | mx-jal-2026 | 947 | 45 | none | works, environment, finance | claude-code/claude-haiku-5-5 | sonnet | claude-code/claude-sonnet-5-5 | test only |
| w2-17-newmoney | 2c | claude-2 | in-tn-2026 | 917 | 45 | none | mayor, finance, planning | claude-code/claude-haiku-5-5 | sonnet | claude-code/claude-sonnet-5-5 | test only |
| w2-38-newmoney-works | 2c | codex | in-tn-2026 | 938 | 45 | none | mayor, works, finance | codex/gpt-6.1-sol | sonnet | claude-code/claude-sonnet-5-5 | test only; optional |
| w2-32-newoffices | 2c | codex | us-oh-2026 | 932 | 45 | none | police-oic, union-organiser, mayor | codex/gpt-6.1-sol | sonnet | claude-code/claude-sonnet-5-5 | test only; optional |
| w2-31-newmoney | 2c | codex | in-tn-2026 | 931 | 45 | none | mayor, finance, planning | codex/gpt-6-luna | sonnet | claude-code/claude-sonnet-5-5 | test only; optional |

## Towns that are not their place

Used as they are: a town in trouble gives requests too. **Nothing in a pilot in one of these towns says anything about the country or the region its profile is named for.** Every profile also carries placeholder figures (docs/profiles.md).

| profile | pilots | known not to be faithful in |
|---|---|---|
| ke-nakuru-2026 | w2-50-evictions, w2-51-townhall | its rent share is wrong for its dwelling mix (rent at about 85% of income): landlords and the tribunal see arrears and evictions that are the profile's doing; it floods through its wet season (the river's flow: a change not on main) |
| br-mg-2026 | w2-52-river, w2-53-townhall | it floods through its wet season on a river-flow figure whose change is not on main: the flood is the profile's, not a wet year's |
| in-tn-2026 | w2-49-newmoney-registers, w2-17-newmoney, w2-38-newmoney-works, w2-31-newmoney | rent is 40% of income (no landlord seat there); a means-tested pension is paid to everyone; it floods through its wet season (the river's flow) |
| mx-jal-2026 | w2-23-newplace, w2-16-newplace, w2-47-newplace-works | it floods through its wet season (the river's flow: a change not on main) |
| us-oh-2026 | w2-54-effort, w2-04-townhall, w2-42-townworks, w2-48-election, w2-05-landlords, w2-41-works, w2-36-offices, w2-34-works, w2-25-rents, w2-32-newoffices | it floods through its wet season (the river's flow: a change not on main) |
| jp-akita-2026 | w2-22-townhall, w2-08-heat, w2-21-lending, w2-29-lending | far from its census by age (its children-at-home figures are placeholders); its budget expects grants seven times its spending; households' saving reads negative |
| de-ni-2026 | w2-45-lean, w2-03-election, w2-06-justice, w2-28-housing, w2-11-heat, w2-27-flood, w2-46-largest-works | households' saving reads negative; its ballot figure for industrial action is union practice, not law |

## Expected usage and time

Plan usage is in US dollars at published prices, as the run records it: the seats' answers where they are Claude models, and the translator's calls (a Codex call is recorded as nothing). Time is the pilot's own, without waits at a usage limit. Codex calls are the seats' answers of the optional lane. Deaths are what a registry seat can expect to have to register (one code-run town of each profile; noisy).

| pilot | seats | weighted seat-days | seat answers | requests through `do` | letters | plan usage | spending limit | Codex calls | deaths to register | time |
|---|---|---|---|---|---|---|---|---|---|---|
| w2-10-works | 3 | 378 | 159 | 27 | 11 | 5.2 | 30 | 0 | 8.0 | 36 min |
| w2-44-utilities | 3 | 77 | 32 | 3 | 2 | 1.0 | 10 | 0 |  | 7 min |
| w2-09-trade | 2 | 60 | 25 | 7 | 2 | 0.9 | 10 | 0 |  | 6 min |
| w2-01-council | 7 | 148 | 62 | 8 | 4 | 2.0 | 10 | 0 |  | 13 min |
| w2-14-largest | 3 | 135 | 57 | 8 | 4 | 11 | 60 | 0 |  | 26 min |
| w2-54-effort | 3 | 71 | 106 | 3 | 85 | 8.5 | 20 | 0 |  | 19 min |
| w2-04-townhall | 3 | 106 | 159 | 5 | 127 | 27 | 55 | 0 |  | 42 min |
| w2-26-council | 5 | 68 | 101 | 6 | 81 | 17 | 35 | 0 |  | 26 min |
| w2-33-works | 3 | 90 | 117 | 23 | 180 | 0.4 | 10 | 117 |  | 51 min |
| w2-22-townhall | 3 | 71 | 71 | 4 | 71 | 0.1 | 10 | 71 |  | 19 min |
| w2-23-newplace | 3 | 90 | 117 | 14 | 180 | 0.2 | 10 | 117 |  | 50 min |
| w2-42-townworks | 3 | 270 | 113 | 14 | 8 | 3.6 | 20 | 0 |  | 24 min |
| w2-45-lean | 3 | 212 | 89 | 11 | 6 | 2.8 | 15 | 0 |  | 19 min |
| w2-48-election | 4 | 165 | 69 | 12 | 5 | 2.3 | 15 | 0 |  | 16 min |
| w2-03-election | 3 | 180 | 76 | 13 | 5 | 2.5 | 15 | 0 |  | 17 min |
| w2-06-justice | 6 | 387 | 163 | 17 | 12 | 5.1 | 30 | 0 | 6.0 | 35 min |
| w2-08-heat | 4 | 414 | 174 | 23 | 12 | 5.6 | 30 | 0 | 4.0 | 37 min |
| w2-05-landlords | 4 | 480 | 202 | 46 | 14 | 6.8 | 35 | 0 |  | 45 min |
| w2-28-housing | 4 | 336 | 141 | 32 | 10 | 4.7 | 25 | 0 |  | 32 min |
| w2-21-lending | 4 | 480 | 202 | 38 | 14 | 6.6 | 35 | 0 |  | 43 min |
| w2-43-care | 2 | 54 | 23 | 2 | 2 | 0.7 | 10 | 0 |  | 5 min |
| w2-11-heat | 3 | 212 | 89 | 7 | 6 | 2.8 | 15 | 0 |  | 18 min |
| w2-12-flood | 4 | 503 | 211 | 35 | 15 | 6.9 | 35 | 0 |  | 45 min |
| w2-27-flood | 4 | 405 | 170 | 34 | 12 | 5.6 | 30 | 0 |  | 38 min |
| w2-46-largest-works | 3 | 225 | 95 | 10 | 7 | 19 | 100 | 0 | 3.0 | 43 min |
| w2-15-largest-election | 4 | 165 | 69 | 12 | 5 | 14 | 75 | 0 |  | 33 min |
| w2-50-evictions | 4 | 336 | 141 | 28 | 10 | 4.7 | 25 | 0 |  | 31 min |
| w2-51-townhall | 3 | 212 | 89 | 7 | 6 | 2.8 | 15 | 0 |  | 18 min |
| w2-52-river | 4 | 324 | 136 | 19 | 10 | 4.4 | 25 | 0 |  | 29 min |
| w2-53-townhall | 3 | 234 | 98 | 11 | 7 | 3.1 | 20 | 0 |  | 21 min |
| w2-41-works | 3 | 188 | 281 | 13 | 225 | 48 | 100 | 0 | 4.2 | 74 min |
| w2-02-housing | 4 | 126 | 189 | 14 | 151 | 32 | 65 | 0 |  | 51 min |
| w2-36-offices | 3 | 51 | 77 | 2 | 61 | 13 | 30 | 0 |  | 20 min |
| w2-30-trade | 2 | 60 | 90 | 9 | 72 | 15 | 35 | 0 |  | 25 min |
| w2-07-election | 5 | 202 | 304 | 15 | 243 | 52 | 105 | 0 |  | 80 min |
| w2-34-works | 4 | 108 | 140 | 14 | 216 | 0.2 | 10 | 140 | 2.5 | 60 min |
| w2-24-election | 4 | 165 | 215 | 33 | 330 | 0.5 | 10 | 215 |  | 1.6 h |
| w2-25-rents | 4 | 140 | 181 | 29 | 279 | 0.5 | 10 | 181 | 2.5 | 79 min |
| w2-35-works | 3 | 135 | 135 | 8 | 135 | 0.1 | 10 | 135 |  | 36 min |
| w2-29-lending | 4 | 153 | 199 | 34 | 306 | 0.5 | 10 | 199 |  | 87 min |
| w2-37-lean | 3 | 106 | 106 | 9 | 106 | 0.1 | 10 | 106 |  | 29 min |
| w2-13-flood-long | 6 | 846 | 355 | 67 | 25 | 12 | 60 | 0 |  | 75 min |
| w2-16-newplace | 4 | 360 | 151 | 20 | 11 | 4.9 | 25 | 0 |  | 31 min |
| w2-49-newmoney-registers | 3 | 324 | 136 | 17 | 10 | 4.3 | 25 | 0 | 8.0 | 30 min |
| w2-18-newoffices | 3 | 234 | 98 | 7 | 7 | 3.1 | 20 | 0 |  | 20 min |
| w2-47-newplace-works | 3 | 117 | 176 | 5 | 140 | 30 | 60 | 0 |  | 46 min |
| w2-17-newmoney | 3 | 106 | 159 | 5 | 127 | 27 | 55 | 0 |  | 42 min |
| w2-38-newmoney-works | 3 | 135 | 176 | 12 | 270 | 0.2 | 10 | 176 |  | 73 min |
| w2-32-newoffices | 3 | 117 | 152 | 12 | 234 | 0.2 | 10 | 152 |  | 64 min |
| w2-31-newmoney | 3 | 106 | 106 | 6 | 106 | 0.1 | 10 | 106 |  | 29 min |

| stage and lane | pilots | seat answers | requests through `do` | of them in training pilots | plan usage | sum of spending limits | Codex calls | Codex time | time, one after another |
|---|---|---|---|---|---|---|---|---|---|
| 2a, claude-1 | 5 | 335 | 53 | 53 | 21 | 120 | 0 | 0 min | 88 min |
| 2a, claude-2 | 3 | 366 | 13 | 13 | 53 | 110 | 0 | 0 min | 87 min |
| 2a, codex | 3 | 305 | 41 | 23 | 0.6 | 30 | 305 | 1.9 h | 2.0 h |
| 2b, claude-1 | 19 | 2349 | 371 | 371 | 104 | 570 | 0 | 0 min | 9.1 h |
| 2b, claude-2 | 5 | 941 | 53 | 53 | 161 | 335 | 0 | 0 min | 4.2 h |
| 2b, codex | 6 | 976 | 127 | 110 | 2.0 | 60 | 976 | 5.9 h | 6.4 h |
| 2c, claude-1 | 4 | 741 | 111 | 67 | 24 | 130 | 0 | 0 min | 2.6 h |
| 2c, claude-2 | 2 | 334 | 10 | 0 | 57 | 115 | 0 | 0 min | 87 min |
| 2c, codex | 3 | 433 | 30 | 0 | 0.5 | 30 | 433 | 2.6 h | 2.8 h |
| **Codex unavailable throughout: the Claude lanes** | 38 | 5065 | 611 | 557 | 419 | 1380 | 0 | 0 min | 20.3 h |
| **the optional lane (Codex seats)** | 12 | 1714 | 198 | 132 | 3.1 | 120 | 1714 | 10.4 h | 11.2 h |
| **Codex available: both** | 50 | 6779 | 809 | 689 | 422 | 1500 | 1714 | 10.4 h | 31.5 h |

By seat model: claude-code/claude-sonnet-5-5 25 pilots, 3204 answers, 505 requests, 104 of plan usage (basis: 29 and 28 answers in two 30-day pilots of 70 and 63 weighted seat-days (a seat came back each week: five sittings in thirty days); 0.021 and 0.035 an answer; 9 requests in four pilots where the offices' sixty-day business comes to 24); claude-code/claude-haiku-5-5 9 pilots, 1535 answers, 73 requests, 262 of plan usage (basis: 88 and 126 answers in two 30-day pilots (18.54 and 15.51 recorded; three quarters of its output was thinking); 0.21 and 0.12 an answer; 44 requests in one pilot, 38 of them provoked by a fault since fixed, counted as 6, and 2 in the other); claude-code/claude-haiku-5-5 1 pilots, 106 answers, 3 requests, 8.5 of plan usage (basis: not measured in a seat: the smaller model's pace at about half its cost, a guess (three quarters of its output at default effort was thinking; as a reader at low effort it used about three quarters of the tokens and agreed with the settled labels on 26 of 34 where at default effort it agreed on 34). w2-54 is the measurement); claude-code/claude-fable-5-1 3 pilots, 221 answers, 30 requests, 45 of plan usage (basis: not measured in a seat: the first model's pace and about seven times its cost, a guess (as a translator it cost 0.03 a request)); codex/gpt-6.1-sol 8 pilots, 1297 answers, 170 requests (basis: 43 answers in 12 days and 73 in 25 (83 and 92 letters); 5 requests in 12 days and 3 in 25, where the offices' business comes to 2.4 and 5; a flat subscription, recorded as nothing); codex/gpt-6-luna 4 pilots, 417 answers, 28 requests (basis: not measured in a seat: a guess between the two families).

## Expected requests through `do`, by kind

Central guesses (a seat's requests, drafted or not); the range that is honest is a third of each to three times it. A form is a paper on a form: a council proposal, a direction to an office, or one of the office's own (an advertisement, a register entry, a decision). A standing work order counts under work; a hold and an entry on one's own file under statement. Letters are written with `write`, which no translator reads: they are counted apart.

| kind | as of 2026-10-08 (real and in-situ) | training, Claude lanes | training, optional lane | test-only, Claude lanes | test-only, optional lane |
|---|---|---|---|---|---|
| message | 1,173 | (letters: about 1262) | (letters: about 1311) | (letters: about 295) | (letters: about 1101) |
| statement | 291 | 49 | 11 | 9 | 14 |
| form | 204 | 274 | 70 | 24 | 28 |
| money | 32 | 67 | 9 | 9 | 9 |
| structure | 11 | 14 | 1 | 0 | 2 |
| claim | 9 | 16 | 2 | 2 | 1 |
| agreement | 4 | 77 | 24 | 6 | 6 |
| work | 1 | 18 | 4 | 3 | 4 |
| goods | 0 | 6 | 0 | 0 | 0 |
| account | 0 | 0 | 0 | 0 | 0 |
| occupancy | 0 | 13 | 2 | 1 | 1 |
| entity | 0 | 0 | 0 | 0 | 0 |
| vote | 0 | 22 | 8 | 0 | 0 |
| presence | 0 | 1 | 0 | 0 | 0 |
| position | 0 | 1 | 0 | 0 | 0 |
| take | 0 | 0 | 0 | 0 | 0 |
| all through `do` | | 557 | 132 | 54 | 65 |

Seat-days (the situations the pipeline's writers are put in, one in three by default): 11580 training, Claude lanes; 930 training, optional lane; 1440 test-only, Claude lanes; 855 test-only, optional lane.

## Coverage

- Pilots by lane: claude-1 28, codex 12, claude-2 10.
- Pilots by profile: au-vic-2026 10, us-oh-2026 10, gb-eng-2026 8, de-ni-2026 7, jp-akita-2026 4, in-tn-2026 4, mx-jal-2026 3, ke-nakuru-2026 2, br-mg-2026 2; without the optional lane: au-vic-2026 9, us-oh-2026 7, de-ni-2026 7, gb-eng-2026 5, jp-akita-2026 2, ke-nakuru-2026 2, br-mg-2026 2, mx-jal-2026 2, in-tn-2026 2.
- Pilots by seat model: claude-code/claude-sonnet-5-5 25, claude-code/claude-haiku-5-5 10, codex/gpt-6.1-sol 8, codex/gpt-6-luna 4, claude-code/claude-fable-5-1 3.
- Pilots by translator: claude-code/claude-sonnet-5-5 49, decide/pod-small-d16-s1 1.
- Pilots by scenario: none 32, election-due 5, dear-rents 3, wet-year 3, lean-council 2, hot-summer 2, energy-price-shock 1, housing-shortage 1, jobs-slump 1.
- Pilots an office is a seat in: mayor 32, finance 23, landlord 14, planning 12, works 9, registry 8, editor 7, councillor 6, tribunal-registrar 5, inspector 5, tribunal-member 4, bank-lending 4, environment 3, council-clerk 3, land-registrar 3, water-operations 2, rates 2, shop 2, factory 2, child-protection 2, principal 2, police-oic 2, union-organiser 2, energy-operations 1, clinic-manager 1.
- The same, in the pilots that need no Codex: mayor 22, finance 16, landlord 11, planning 9, registry 6, works 5, councillor 5, editor 5, inspector 5, tribunal-member 4, tribunal-registrar 4, council-clerk 3, bank-lending 3, environment 2, water-operations 2, rates 2, shop 2, factory 2, land-registrar 2, child-protection 2, principal 2, energy-operations 1, clinic-manager 1, police-oic 1, union-organiser 1.
- Training pilots by seat model, for the offices asked for: works: claude-code/claude-sonnet-5-5 2, codex/gpt-6.1-sol 2, claude-code/claude-fable-5-1 1, claude-code/claude-haiku-5-5 1; registry: claude-code/claude-sonnet-5-5 3, codex/gpt-6.1-sol 2, claude-code/claude-fable-5-1 1, claude-code/claude-haiku-5-5 1; clinic-manager: claude-code/claude-sonnet-5-5 1; principal: claude-code/claude-sonnet-5-5 1, claude-code/claude-haiku-5-5 1; water-operations: claude-code/claude-sonnet-5-5 1, claude-code/claude-haiku-5-5 1; energy-operations: claude-code/claude-sonnet-5-5 1; rates: claude-code/claude-sonnet-5-5 1, claude-code/claude-haiku-5-5 1.
- A model mayor beside a code-run works office: w2-01-council, w2-14-largest, w2-54-effort, w2-04-townhall, w2-22-townhall, w2-23-newplace, w2-45-lean, w2-48-election, w2-03-election, w2-08-heat, w2-11-heat, w2-12-flood, w2-27-flood, w2-15-largest-election, w2-51-townhall, w2-52-river, w2-53-townhall, w2-07-election, w2-24-election, w2-25-rents, w2-37-lean, w2-13-flood-long, w2-16-newplace, w2-17-newmoney, w2-32-newoffices, w2-31-newmoney.
- A model mayor beside a model works office: w2-33-works, w2-42-townworks, w2-46-largest-works, w2-41-works, w2-35-works, w2-38-newmoney-works.
- Elections (75 days: nominations close day 30, poll and count day 60, the winner seated day 61): w2-48-election (claude-1), w2-03-election (claude-1), w2-15-largest-election (claude-1), w2-07-election (claude-2), w2-24-election (codex).
- Registry seats, with the deaths each can expect: w2-10-works 8.0 in 180 days, w2-06-justice 6.0 in 180 days, w2-08-heat 4.0 in 180 days, w2-46-largest-works 3.0 in 90 days, w2-41-works 4.2 in 75 days, w2-34-works 2.5 in 45 days, w2-25-rents 2.5 in 45 days, w2-49-newmoney-registers 8.0 in 180 days.
- A model council clerk (stopped if no result is declared within three weeks of a ballot opening): w2-01-council, w2-03-election, w2-07-election.
- Works with its crew still to take on: w2-10-works, w2-33-works, w2-42-townworks.
- Probes: w2-10-works, w2-44-utilities, w2-09-trade, w2-33-works, w2-43-care, w2-36-offices, w2-30-trade.
- Test-only: w2-22-townhall (codex), w2-23-newplace (codex), w2-35-works (codex), w2-37-lean (codex), w2-16-newplace (claude-1), w2-49-newmoney-registers (claude-1), w2-18-newoffices (claude-1), w2-47-newplace-works (claude-2), w2-17-newmoney (claude-2), w2-38-newmoney-works (codex), w2-32-newoffices (codex), w2-31-newmoney (codex).
- Pilots whose translator is behind the Codex sign-in: none. Pilots whose seats are: 12, all in the optional lane, about 1714 Codex calls in all.
- Pilots whose seats are the same model as the translator (the first Claude model reading its own requests): 25 of 50.
- Translator may be: `trained` (our own, for its failures): w2-26-council; `trained-ok` (our own retrained one if its scores allow, else the general model): w2-14-largest, w2-45-lean, w2-06-justice, w2-08-heat, w2-05-landlords, w2-28-housing, w2-21-lending, w2-11-heat, w2-12-flood, w2-27-flood, w2-46-largest-works, w2-50-evictions, w2-51-townhall, w2-52-river, w2-53-townhall, w2-41-works, w2-02-housing, w2-34-works, w2-25-rents, w2-29-lending, w2-13-flood-long; `sonnet` (the general model and no other): the other 28.
