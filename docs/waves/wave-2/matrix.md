# Wave 2: the tables

Written by `make.ts`; do not edit by hand. The reasoning is in `plan.md`.

## What changed from the second version (2026-10-09, morning), and why

- **After stage 2b (`runs/pilot-queues/wave-2b.review.md`), stage 2c is rebuilt for a new pinned wave, `wave-2c`**, on origin/main d769817 (prompt 0.9.3). The 2b queue files are left as they ran; `make.ts` writes the 2c files only.
- **No seat on the largest Claude model** (the owner stopped its use: it drains the plan). w2-14 and w2-46 finished and stay training data; w2-15 was stopped partway and is out; `make.ts` refuses one in a pilot still to run. Stage 2c had none.
- **What the test holds out now:** two profiles (mx-jal, in-tn) and two offices (the police, the union), each in pilots that need no Codex, and gpt-6-luna seats only if the Codex window opens. There is no unseen seat model otherwise: the fallback of marking the largest model's pilots test-only is gone with the model.
- **No pilot of councillors alone** (w2-26 and w2-56 made one request between them; `make.ts` refuses one). w2-58, the 400-day pilot with a mayor, a clerk and three councillors past a budget year's end, stays, last in its lane.
- **One test pilot more** (w2-59: the tribunal, a landlord and planning in the Mexican town), since the retrained translator is scored on 2c's tests and the wave has had almost no tribunal order, lease, occupancy or permit decision.
- **Rates and limits from stage 2b's twelve finished pilots:** Sonnet 0.47 answers a weighted seat-day at 0.02 and half the requests expected (factor 0.3); Haiku at low effort 0.82 at 0.066 and four tenths of them (0.6); a lender's seat about 1.25 answers a day at 0.22, counted apart. Spending limits are three times the estimate.
- **After the shake-down (stage 2a; `runs/pilot-queues/wave-2a.review.md`), stages 2b and 2c are rebuilt for a new pinned wave, `wave-2b`.** The eight Claude-lane pilots of 2a gave 129 requests for about 76 recorded (27.18 for the first six; 21.77 and 26.98 for the two on the smaller model at default effort); the 2a queue files are left as they ran and `make.ts` no longer writes them.
- **A hired crew now works**, so the works pilots the review held run as planned (w2-42, w2-41, w2-46, w2-34, w2-35, w2-47, w2-38).
- **Shops and factories cannot be seats yet** (serving and making are acts by hand for each order; no form writes a price list): w2-30-trade is dropped, and `make.ts` refuses a shop or factory seat.
- **Every council or election pilot has business by its scenario**, not by anything said to a seat: a calm town gave seven council seats nothing to decide in 45 days (w2-01: no request; a petition stood at 13 signatures) and five councillors one request (w2-26). The elections are `election-due+dear-rents` (w2-48, w2-07, w2-24) or `election-due+lean-council` (w2-03, w2-15); a full council of models sits under `dear-rents+lean-council` (w2-55, new); `make.ts` refuses council seats under neither.
- **The trained translator's council pilot is reworked, not repeated:** w2-26 (five Haiku councillors, a calm town) cost 26.98 for one request. w2-56 is five Sonnet councillors under `dear-rents`, about a dollar: kept because a councillor shown the proposal form may now propose, and what our own model makes of that is worth a dollar.
- **The utilities again, on another profile** (w2-57, de-ni, 60 days): the energy office has an order form and the water round bills.
- **Haiku seats sit at low effort everywhere** (`seat_effort=low` on w2-41, w2-02, w2-36, w2-07, w2-47, w2-17): w2-54 at low effort cost 0.090 an answer against 0.205 for the same offices at default effort (w2-04), with one answer in 109 unread and four malformed uses (a name where an id was wanted, since read as the id).
- **One pilot past a budget year's end** (w2-58, 400 days, a mayor, the treasury, a model clerk, three councillors and the registrar; about 25 of plan usage): the only way seats adopt a budget, and the only pilot long enough for a birth to register. Last in 2c, after a clerk seat has been seen to count a ballot.
- **Rates corrected from the finished pilots:** a Sonnet seat 0.5 answers a weighted seat-day at 0.025 (was 0.42 at 0.03) and half as many requests again; Haiku at low effort 1.55 at 0.09; Fable 0.3 at 0.22; the translator 0.0095 a call. Requests were twice the estimate, mostly from one office trying one thing again and again (energy orders, wage payments): faults since fixed, so the new factors are raised by half, not doubled.
- **The translator's prompt is 0.9.2.**
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
- **(As it stood before stage 2b.)** 53 pilots in all (eleven of them the shake-down's): 33 on Claude seats still to run in 2b and 2c, 9 optional on Codex seats; 12 test-only.

## The matrix

Every town is 1,000 people and a town of its own (generated from its seed); every pilot's confirmation mode is `always` (the only one a generated town has). The order is the order in the queue files. Lanes: `claude-1` and `claude-2` need the Claude sign-in alone; `codex` is the optional lane (Codex seats, a Claude translator).

| pilot | stage | lane | profile | seed | days | scenario | seats (all on the pilot's model) | seat model | translator may be | translator in the file | marks |
|---|---|---|---|---|---|---|---|---|---|---|---|
| w2-10-works | 2a | claude-1 | gb-eng-2026 | 110 | 180 | none | works, registry, environment | claude-code/claude-sonnet-5-5 | sonnet | claude-code/claude-sonnet-5-5 | run in the shake-down; probe; no crew at the start |
| w2-44-utilities | 2a | claude-1 | au-vic-2026 | 144 | 45 | energy-price-shock | water-operations, energy-operations, rates | claude-code/claude-sonnet-5-5 | sonnet | claude-code/claude-sonnet-5-5 | run in the shake-down; probe |
| w2-09-trade | 2a | claude-1 | au-vic-2026 | 109 | 30 | none | shop-1-manager, factory-1-manager | claude-code/claude-sonnet-5-5 | sonnet | claude-code/claude-sonnet-5-5 | run in the shake-down; probe |
| w2-01-council | 2a | claude-1 | au-vic-2026 | 101 | 45 | none | mayor, council-clerk, councillor-1, councillor-2, councillor-3, councillor-4, councillor-5 | claude-code/claude-sonnet-5-5 | sonnet | claude-code/claude-sonnet-5-5 | run in the shake-down; model clerk |
| w2-14-largest | 2a | claude-1 | au-vic-2026 | 114 | 45 | none | mayor, finance, landlord-1-office | claude-code/claude-fable-5-1 | trained-ok | claude-code/claude-sonnet-5-5 | run in the shake-down |
| w2-54-effort | 2a | claude-2 | us-oh-2026 | 154 | 30 | none | mayor, finance, planning | claude-code/claude-haiku-5-5 | sonnet | claude-code/claude-sonnet-5-5 | run in the shake-down; seats at low effort |
| w2-04-townhall | 2a | claude-2 | us-oh-2026 | 104 | 45 | none | mayor, finance, planning | claude-code/claude-haiku-5-5 | sonnet | claude-code/claude-sonnet-5-5 | run in the shake-down |
| w2-26-council | 2a | claude-2 | au-vic-2026 | 126 | 45 | none | councillor-1, councillor-2, councillor-3, councillor-4, councillor-5 | claude-code/claude-haiku-5-5 | trained | decide/pod-small-d16-s1 | run in the shake-down |
| w2-33-works | 2a | codex | au-vic-2026 | 133 | 30 | none | mayor, works, finance | codex/gpt-6.1-sol | sonnet | claude-code/claude-sonnet-5-5 | run in the shake-down; probe; no crew at the start; optional |
| w2-22-townhall | 2a | codex | jp-akita-2026 | 922 | 30 | none | mayor, finance, planning | codex/gpt-6-luna | sonnet | claude-code/claude-sonnet-5-5 | run in the shake-down; test only; optional |
| w2-23-newplace | 2a | codex | mx-jal-2026 | 923 | 30 | none | mayor, landlord-3-office, finance | codex/gpt-6.1-sol | sonnet | claude-code/claude-sonnet-5-5 | run in the shake-down; test only; optional |
| w2-42-townworks | 2b | claude-1 | us-oh-2026 | 142 | 90 | none | mayor, works, finance | claude-code/claude-sonnet-5-5 | sonnet | claude-code/claude-sonnet-5-5 | stage 2b (run, or running under wave-2b); no crew at the start |
| w2-45-lean | 2b | claude-1 | de-ni-2026 | 145 | 90 | lean-council | mayor, finance, planning | claude-code/claude-sonnet-5-5 | trained-ok | claude-code/claude-sonnet-5-5 | stage 2b (run, or running under wave-2b) |
| w2-48-election | 2b | claude-1 | us-oh-2026 | 148 | 75 | election-due+dear-rents | mayor, editor, councillor-1, councillor-2 | claude-code/claude-sonnet-5-5 | sonnet | claude-code/claude-sonnet-5-5 | stage 2b (run, or running under wave-2b) |
| w2-03-election | 2b | claude-1 | de-ni-2026 | 103 | 75 | election-due+lean-council | mayor, editor, council-clerk | claude-code/claude-sonnet-5-5 | sonnet | claude-code/claude-sonnet-5-5 | stage 2b (run, or running under wave-2b); model clerk |
| w2-55-council | 2b | claude-1 | gb-eng-2026 | 155 | 60 | dear-rents+lean-council | mayor, council-clerk, councillor-1, councillor-2, councillor-3, councillor-4, councillor-5 | claude-code/claude-sonnet-5-5 | sonnet | claude-code/claude-sonnet-5-5 | stage 2b (run, or running under wave-2b); model clerk |
| w2-56-council-votes | 2b | claude-1 | us-oh-2026 | 156 | 45 | dear-rents | councillor-1, councillor-2, councillor-3, councillor-4, councillor-5 | claude-code/claude-sonnet-5-5 | trained | decide/pod-small-d16-s1 | stage 2b (run, or running under wave-2b) |
| w2-06-justice | 2b | claude-1 | de-ni-2026 | 106 | 180 | none | tribunal-member, tribunal-registrar, registry, land-registrar, child-protection, inspector | claude-code/claude-sonnet-5-5 | trained-ok | claude-code/claude-sonnet-5-5 | stage 2b (run, or running under wave-2b) |
| w2-08-heat | 2b | claude-1 | jp-akita-2026 | 108 | 180 | hot-summer | mayor, registry, editor, child-protection | claude-code/claude-sonnet-5-5 | trained-ok | claude-code/claude-sonnet-5-5 | stage 2b (run, or running under wave-2b) |
| w2-05-landlords | 2b | claude-1 | us-oh-2026 | 105 | 120 | dear-rents | landlord-1-office, landlord-2-office, landlord-3-office, bank-lending | claude-code/claude-sonnet-5-5 | trained-ok | claude-code/claude-sonnet-5-5 | stage 2b (run, or running under wave-2b) |
| w2-28-housing | 2b | claude-1 | de-ni-2026 | 128 | 120 | housing-shortage | landlord-1-office, landlord-2-office, tribunal-member, tribunal-registrar | claude-code/claude-sonnet-5-5 | trained-ok | claude-code/claude-sonnet-5-5 | stage 2b (run, or running under wave-2b) |
| w2-21-lending | 2b | claude-1 | jp-akita-2026 | 121 | 120 | jobs-slump | bank-lending, finance, landlord-1-office, landlord-2-office | claude-code/claude-sonnet-5-5 | trained-ok | claude-code/claude-sonnet-5-5 | stage 2b (run, or running under wave-2b) |
| w2-43-care | 2b | claude-1 | gb-eng-2026 | 143 | 45 | none | clinic-manager, principal | claude-code/claude-sonnet-5-5 | sonnet | claude-code/claude-sonnet-5-5 | stage 2b (run, or running under wave-2b); probe |
| w2-57-utilities | 2b | claude-1 | de-ni-2026 | 157 | 60 | none | water-operations, energy-operations, rates | claude-code/claude-sonnet-5-5 | sonnet | claude-code/claude-sonnet-5-5 | stage 2b (run, or running under wave-2b); probe |
| w2-11-heat | 2b | claude-1 | de-ni-2026 | 111 | 90 | hot-summer | mayor, finance, inspector | claude-code/claude-sonnet-5-5 | trained-ok | claude-code/claude-sonnet-5-5 | stage 2b (run, or running under wave-2b) |
| w2-12-flood | 2b | claude-1 | gb-eng-2026 | 112 | 150 | wet-year | mayor, planning, finance, landlord-1-office | claude-code/claude-sonnet-5-5 | trained-ok | claude-code/claude-sonnet-5-5 | stage 2b (run, or running under wave-2b) |
| w2-27-flood | 2b | claude-1 | de-ni-2026 | 127 | 150 | wet-year | mayor, planning, inspector, landlord-1-office | claude-code/claude-sonnet-5-5 | trained-ok | claude-code/claude-sonnet-5-5 | stage 2b (run, or running under wave-2b) |
| w2-46-largest-works | 2b | claude-1 | de-ni-2026 | 146 | 90 | none | mayor, works, registry | claude-code/claude-fable-5-1 | trained-ok | claude-code/claude-sonnet-5-5 | stage 2b (run, or running under wave-2b) |
| w2-15-largest-election | 2b | claude-1 | gb-eng-2026 | 115 | 75 | election-due+lean-council | mayor, editor, councillor-1, councillor-2 | claude-code/claude-fable-5-1 | sonnet | claude-code/claude-sonnet-5-5 | stopped partway; out |
| w2-50-evictions | 2b | claude-1 | ke-nakuru-2026 | 150 | 120 | none | landlord-1-office, landlord-2-office, tribunal-member, tribunal-registrar | claude-code/claude-sonnet-5-5 | trained-ok | claude-code/claude-sonnet-5-5 | stage 2b (run, or running under wave-2b) |
| w2-51-townhall | 2b | claude-1 | ke-nakuru-2026 | 151 | 90 | none | mayor, finance, planning | claude-code/claude-sonnet-5-5 | trained-ok | claude-code/claude-sonnet-5-5 | stage 2b (run, or running under wave-2b) |
| w2-52-river | 2b | claude-1 | br-mg-2026 | 152 | 120 | none | mayor, planning, inspector, landlord-1-office | claude-code/claude-sonnet-5-5 | trained-ok | claude-code/claude-sonnet-5-5 | stage 2b (run, or running under wave-2b) |
| w2-53-townhall | 2b | claude-1 | br-mg-2026 | 153 | 90 | none | mayor, finance, editor | claude-code/claude-sonnet-5-5 | trained-ok | claude-code/claude-sonnet-5-5 | stage 2b (run, or running under wave-2b) |
| w2-41-works | 2b | claude-2 | us-oh-2026 | 141 | 75 | none | mayor, works, registry | claude-code/claude-haiku-5-5 | trained-ok | claude-code/claude-sonnet-5-5 | stage 2b (run, or running under wave-2b); seats at low effort |
| w2-02-housing | 2b | claude-2 | gb-eng-2026 | 102 | 45 | dear-rents | landlord-1-office, landlord-2-office, tribunal-member, tribunal-registrar | claude-code/claude-haiku-5-5 | trained-ok | claude-code/claude-sonnet-5-5 | stage 2b (run, or running under wave-2b); seats at low effort |
| w2-36-offices | 2b | claude-2 | us-oh-2026 | 136 | 30 | none | rates, water-operations, principal | claude-code/claude-haiku-5-5 | sonnet | claude-code/claude-sonnet-5-5 | stage 2b (run, or running under wave-2b); probe; seats at low effort |
| w2-07-election | 2b | claude-2 | au-vic-2026 | 107 | 75 | election-due+dear-rents | mayor, council-clerk, councillor-1, councillor-2, councillor-3 | claude-code/claude-haiku-5-5 | sonnet | claude-code/claude-sonnet-5-5 | stage 2b (run, or running under wave-2b); model clerk; seats at low effort |
| w2-34-works | 2b | codex | us-oh-2026 | 134 | 45 | none | works, registry, land-registrar, environment | codex/gpt-6.1-sol | trained-ok | claude-code/claude-sonnet-5-5 | stage 2b (run, or running under wave-2b); optional |
| w2-24-election | 2b | codex | gb-eng-2026 | 124 | 75 | election-due+dear-rents | mayor, editor, councillor-1, councillor-2 | codex/gpt-6.1-sol | sonnet | claude-code/claude-sonnet-5-5 | stage 2b (run, or running under wave-2b); optional |
| w2-25-rents | 2b | codex | us-oh-2026 | 125 | 45 | dear-rents | mayor, landlord-1-office, registry, editor | codex/gpt-6.1-sol | trained-ok | claude-code/claude-sonnet-5-5 | stage 2b (run, or running under wave-2b); optional |
| w2-35-works | 2b | codex | gb-eng-2026 | 935 | 45 | none | mayor, works, finance | codex/gpt-6-luna | sonnet | claude-code/claude-sonnet-5-5 | stage 2b (run, or running under wave-2b); test only; optional |
| w2-29-lending | 2b | codex | jp-akita-2026 | 129 | 45 | none | bank-lending, landlord-1-office, landlord-2-office, tribunal-registrar | codex/gpt-6.1-sol | trained-ok | claude-code/claude-sonnet-5-5 | stage 2b (run, or running under wave-2b); optional |
| w2-37-lean | 2b | codex | gb-eng-2026 | 937 | 45 | lean-council | mayor, finance, planning | codex/gpt-6-luna | sonnet | claude-code/claude-sonnet-5-5 | stage 2b (run, or running under wave-2b); test only; optional |
| w2-13-flood-long | 2c | claude-1 | au-vic-2026 | 113 | 180 | wet-year | mayor, finance, planning, inspector, landlord-1-office, landlord-2-office | claude-code/claude-sonnet-5-5 | trained-ok | claude-code/claude-sonnet-5-5 |  |
| w2-16-newplace | 2c | claude-1 | mx-jal-2026 | 916 | 90 | none | mayor, landlord-1-office, bank-lending, finance | claude-code/claude-sonnet-5-5 | sonnet | claude-code/claude-sonnet-5-5 | test only |
| w2-49-newmoney-registers | 2c | claude-1 | in-tn-2026 | 949 | 180 | none | registry, land-registrar, finance | claude-code/claude-sonnet-5-5 | sonnet | claude-code/claude-sonnet-5-5 | test only |
| w2-18-newoffices | 2c | claude-1 | au-vic-2026 | 918 | 90 | none | police-oic, union-organiser, finance | claude-code/claude-sonnet-5-5 | sonnet | claude-code/claude-sonnet-5-5 | test only |
| w2-59-newplace-justice | 2c | claude-1 | mx-jal-2026 | 959 | 90 | none | tribunal-member, tribunal-registrar, landlord-2-office, planning | claude-code/claude-sonnet-5-5 | sonnet | claude-code/claude-sonnet-5-5 | test only |
| w2-58-year | 2c | claude-1 | gb-eng-2026 | 158 | 400 | none | mayor, finance, council-clerk, councillor-1, councillor-2, councillor-3, registry | claude-code/claude-sonnet-5-5 | sonnet | claude-code/claude-sonnet-5-5 | model clerk |
| w2-47-newplace-works | 2c | claude-2 | mx-jal-2026 | 947 | 45 | none | works, environment, finance | claude-code/claude-haiku-5-5 | sonnet | claude-code/claude-sonnet-5-5 | test only; seats at low effort |
| w2-17-newmoney | 2c | claude-2 | in-tn-2026 | 917 | 45 | none | mayor, finance, planning | claude-code/claude-haiku-5-5 | sonnet | claude-code/claude-sonnet-5-5 | test only; seats at low effort |
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
| mx-jal-2026 | w2-23-newplace, w2-16-newplace, w2-59-newplace-justice, w2-47-newplace-works | it floods through its wet season (the river's flow: a change not on main) |
| us-oh-2026 | w2-54-effort, w2-04-townhall, w2-42-townworks, w2-48-election, w2-56-council-votes, w2-05-landlords, w2-41-works, w2-36-offices, w2-34-works, w2-25-rents, w2-32-newoffices | it floods through its wet season (the river's flow: a change not on main) |
| jp-akita-2026 | w2-22-townhall, w2-08-heat, w2-21-lending, w2-29-lending | far from its census by age (its children-at-home figures are placeholders); its budget expects grants seven times its spending; households' saving reads negative |
| de-ni-2026 | w2-45-lean, w2-03-election, w2-06-justice, w2-28-housing, w2-57-utilities, w2-11-heat, w2-27-flood, w2-46-largest-works | households' saving reads negative; its ballot figure for industrial action is union practice, not law |

## Expected usage and time: stage 2c

The pilots of stages 2a and 2b are left out: what they did is in `plan.md`. Plan usage is in US dollars at published prices, as the run records it: the seats' answers where they are Claude models, and the translator's calls (a Codex call is recorded as nothing). Time is the pilot's own, without waits at a usage limit. Codex calls are the seats' answers of the optional lane. Deaths are what a registry seat can expect to have to register (one code-run town of each profile; noisy).

| pilot | seats | weighted seat-days | seat answers | requests through `do` | letters | plan usage | spending limit | Codex calls | deaths to register | time |
|---|---|---|---|---|---|---|---|---|---|---|
| w2-13-flood-long | 6 | 846 | 398 | 50 | 17 | 8.5 | 30 | 0 |  | 34 min |
| w2-16-newplace | 4 | 360 | 169 | 15 | 7 | 28 | 85 | 0 |  | 14 min |
| w2-49-newmoney-registers | 3 | 324 | 152 | 13 | 6 | 3.2 | 10 | 0 | 8.0 | 15 min |
| w2-18-newoffices | 3 | 234 | 110 | 5 | 5 | 2.3 | 10 | 0 |  | 10 min |
| w2-59-newplace-justice | 4 | 194 | 91 | 10 | 4 | 1.9 | 10 | 0 |  | 9 min |
| w2-58-year | 7 | 1680 | 790 | 66 | 34 | 17 | 50 | 0 | 18 | 66 min |
| w2-47-newplace-works | 3 | 117 | 96 | 6 | 53 | 6.4 | 20 | 0 |  | 13 min |
| w2-17-newmoney | 3 | 106 | 87 | 5 | 48 | 5.8 | 20 | 0 |  | 12 min |
| w2-38-newmoney-works | 3 | 135 | 176 | 12 | 270 | 0.1 | 10 | 176 |  | 72 min |
| w2-32-newoffices | 3 | 117 | 152 | 12 | 234 | 0.1 | 10 | 152 |  | 63 min |
| w2-31-newmoney | 3 | 106 | 106 | 6 | 106 | 0.1 | 10 | 106 |  | 28 min |

| stage and lane | pilots | seat answers | requests through `do` | of them in training pilots | plan usage | sum of spending limits | Codex calls | Codex time | time, one after another |
|---|---|---|---|---|---|---|---|---|---|
| 2c, claude-1 | 6 | 1710 | 159 | 116 | 61 | 195 | 0 | 0 min | 2.5 h |
| 2c, claude-2 | 2 | 183 | 12 | 0 | 12 | 40 | 0 | 0 min | 24 min |
| 2c, codex | 3 | 433 | 30 | 0 | 0.3 | 30 | 433 | 2.6 h | 2.7 h |
| **Codex unavailable throughout: the Claude lanes** | 8 | 1892 | 171 | 116 | 73 | 235 | 0 | 0 min | 2.9 h |
| **the optional lane (Codex seats)** | 3 | 433 | 30 | 0 | 0.3 | 30 | 433 | 2.6 h | 2.7 h |
| **Codex available: both** | 11 | 2326 | 201 | 116 | 73 | 265 | 433 | 2.6 h | 5.6 h |

By seat model, to come: claude-code/claude-sonnet-5-5 6 pilots, 1710 answers, 159 requests, 61 of plan usage (basis: stage 2b's eight finished pilots on this model: 884 answers where 948 were expected at 0.5 a weighted seat-day, 0.019 an answer pooled (0.012 to 0.035), 91 requests where 176 were expected at a factor of 0.6 (councils and elections gave almost none); a lender's seat is counted apart); claude-code/claude-haiku-5-5 0 pilots, 0 answers, 0 requests, 0.0 of plan usage (basis: w2-04 at default effort: 105 answers in 106 weighted seat-days, 0.205 an answer (21.54 for 45 days), 25 requests, 89 letters; w2-26's five councillors: 204 answers in 68 (three a seat-day: a councillor's weight understates this model), 0.132 an answer. No pilot to come uses it at default effort); claude-code/claude-haiku-5-5 2 pilots, 183 answers, 12 requests, 12 of plan usage (basis: stage 2b's four pilots at low effort: 466 answers where 879 were expected at 1.55 a weighted seat-day, 0.066 an answer (31.36 in all), 55 requests where 135 were expected at a factor of 1.5); claude-code/claude-fable-5-1 0 pilots, 0 answers, 0 requests, 0.0 of plan usage (basis: w2-14: 39 answers in 135 weighted seat-days, 0.220 an answer (8.58 for 45 days), 12 requests where 8 were expected, 10 of 10 matters through, 17 letters); codex/gpt-6.1-sol 2 pilots, 328 answers, 24 requests (basis: 43 answers in 12 days and 73 in 25 (83 and 92 letters); 5 requests in 12 days and 3 in 25, where the offices' business comes to 2.4 and 5; a flat subscription, recorded as nothing. The shake-down's Codex lane had not finished when this was written); codex/gpt-6-luna 1 pilots, 106 answers, 6 requests (basis: not measured in a seat: a guess between the two families).

## Expected requests through `do`, by kind: stage 2c

Central guesses (a seat's requests, drafted or not); the range that is honest is a third of each to three times it. A form is a paper on a form: a council proposal, a direction to an office, or one of the office's own (an advertisement, a register entry, a decision). A standing work order counts under work; a hold and an entry on one's own file under statement. Letters are written with `write`, which no translator reads: they are counted apart.

| kind | as of 2026-10-08 (real and in-situ) | training, Claude lanes | training, optional lane | test-only, Claude lanes | test-only, optional lane |
|---|---|---|---|---|---|
| message | 1,173 | (letters: about 51) | (letters: about 0) | (letters: about 122) | (letters: about 610) |
| statement | 291 | 12 | 0 | 9 | 6 |
| form | 204 | 55 | 0 | 25 | 14 |
| money | 32 | 14 | 0 | 9 | 3 |
| structure | 11 | 4 | 0 | 0 | 1 |
| claim | 9 | 3 | 0 | 2 | 1 |
| agreement | 4 | 9 | 0 | 7 | 3 |
| work | 1 | 0 | 0 | 3 | 3 |
| goods | 0 | 0 | 0 | 0 | 0 |
| account | 0 | 0 | 0 | 0 | 0 |
| occupancy | 0 | 2 | 0 | 1 | 0 |
| entity | 0 | 0 | 0 | 0 | 0 |
| vote | 0 | 18 | 0 | 0 | 0 |
| presence | 0 | 0 | 0 | 0 | 0 |
| position | 0 | 0 | 0 | 0 | 0 |
| take | 0 | 0 | 0 | 0 | 0 |
| all through `do` | | 116 | 0 | 55 | 30 |

Seat-days (the situations the pipeline's writers are put in, one in three by default): 3880 training, Claude lanes; 0 training, optional lane; 1800 test-only, Claude lanes; 405 test-only, optional lane.

## Coverage (all three stages, the shake-down's pilots among them)

- Pilots by lane: claude-1 33, codex 12, claude-2 9.
- Pilots by profile: us-oh-2026 11, gb-eng-2026 10, au-vic-2026 9, de-ni-2026 8, jp-akita-2026 4, mx-jal-2026 4, in-tn-2026 4, ke-nakuru-2026 2, br-mg-2026 2; without the optional lane: au-vic-2026 8, us-oh-2026 8, de-ni-2026 8, gb-eng-2026 7, mx-jal-2026 3, jp-akita-2026 2, ke-nakuru-2026 2, br-mg-2026 2, in-tn-2026 2.
- Pilots by seat model: claude-code/claude-sonnet-5-5 30, claude-code/claude-haiku-5-5 9, codex/gpt-6.1-sol 8, codex/gpt-6-luna 4, claude-code/claude-fable-5-1 3.
- Pilots by translator: claude-code/claude-sonnet-5-5 52, decide/pod-small-d16-s1 2.
- Pilots by scenario (a pilot under two counts under each): none 34, dear-rents 8, lean-council 5, election-due 5, wet-year 3, hot-summer 2, energy-price-shock 1, housing-shortage 1, jobs-slump 1.
- Pilots an office is a seat in: mayor 34, finance 24, landlord 15, planning 13, works 9, registry 9, councillor 9, editor 7, tribunal-registrar 6, council-clerk 5, tribunal-member 5, inspector 5, bank-lending 4, environment 3, water-operations 3, rates 3, land-registrar 3, energy-operations 2, child-protection 2, principal 2, police-oic 2, union-organiser 2, shop 1, factory 1, clinic-manager 1.
- The same, in the pilots that need no Codex: finance 7, mayor 4, planning 3, landlord 3, registry 2, inspector 1, bank-lending 1, land-registrar 1, police-oic 1, union-organiser 1, tribunal-member 1, tribunal-registrar 1, council-clerk 1, councillor 1, works 1, environment 1.
- Training pilots by seat model, for the offices asked for: works: claude-code/claude-sonnet-5-5 2, codex/gpt-6.1-sol 2, claude-code/claude-fable-5-1 1, claude-code/claude-haiku-5-5 1; registry: claude-code/claude-sonnet-5-5 4, codex/gpt-6.1-sol 2, claude-code/claude-fable-5-1 1, claude-code/claude-haiku-5-5 1; clinic-manager: claude-code/claude-sonnet-5-5 1; principal: claude-code/claude-sonnet-5-5 1, claude-code/claude-haiku-5-5 1; water-operations: claude-code/claude-sonnet-5-5 2, claude-code/claude-haiku-5-5 1; energy-operations: claude-code/claude-sonnet-5-5 2; rates: claude-code/claude-sonnet-5-5 2, claude-code/claude-haiku-5-5 1.
- A model mayor beside a code-run works office: w2-01-council, w2-14-largest, w2-54-effort, w2-04-townhall, w2-22-townhall, w2-23-newplace, w2-45-lean, w2-48-election, w2-03-election, w2-55-council, w2-08-heat, w2-11-heat, w2-12-flood, w2-27-flood, w2-15-largest-election, w2-51-townhall, w2-52-river, w2-53-townhall, w2-07-election, w2-24-election, w2-25-rents, w2-37-lean, w2-13-flood-long, w2-16-newplace, w2-58-year, w2-17-newmoney, w2-32-newoffices, w2-31-newmoney.
- A model mayor beside a model works office: w2-33-works, w2-42-townworks, w2-46-largest-works, w2-41-works, w2-35-works, w2-38-newmoney-works.
- Elections (75 days: nominations close day 30, poll and count day 60, the winner seated day 61): w2-48-election (claude-1), w2-03-election (claude-1), w2-15-largest-election (claude-1), w2-07-election (claude-2), w2-24-election (codex).
- Registry seats, with the deaths each can expect: w2-10-works 8.0 in 180 days, w2-06-justice 6.0 in 180 days, w2-08-heat 4.0 in 180 days, w2-46-largest-works 3.0 in 90 days, w2-41-works 4.2 in 75 days, w2-34-works 2.5 in 45 days, w2-25-rents 2.5 in 45 days, w2-49-newmoney-registers 8.0 in 180 days, w2-58-year 18 in 400 days.
- A model council clerk (stopped if no result is declared within three weeks of a ballot opening): w2-01-council, w2-03-election, w2-55-council, w2-07-election, w2-58-year.
- Works with its crew still to take on: w2-10-works, w2-33-works, w2-42-townworks.
- Probes: w2-10-works, w2-44-utilities, w2-09-trade, w2-33-works, w2-43-care, w2-57-utilities, w2-36-offices.
- Test-only: w2-22-townhall (codex), w2-23-newplace (codex), w2-35-works (codex), w2-37-lean (codex), w2-16-newplace (claude-1), w2-49-newmoney-registers (claude-1), w2-18-newoffices (claude-1), w2-59-newplace-justice (claude-1), w2-47-newplace-works (claude-2), w2-17-newmoney (claude-2), w2-38-newmoney-works (codex), w2-32-newoffices (codex), w2-31-newmoney (codex).
- Pilots whose translator is behind the Codex sign-in: none. Pilots whose seats are: 3, all in the optional lane, about 433 Codex calls in all.
- Pilots whose seats are the same model as the translator (the first Claude model reading its own requests): 29 of 54.
- Translator may be: `trained` (our own, for its failures): w2-26-council, w2-56-council-votes; `trained-ok` (our own retrained one if its scores allow, else the general model): w2-14-largest, w2-45-lean, w2-06-justice, w2-08-heat, w2-05-landlords, w2-28-housing, w2-21-lending, w2-11-heat, w2-12-flood, w2-27-flood, w2-46-largest-works, w2-50-evictions, w2-51-townhall, w2-52-river, w2-53-townhall, w2-41-works, w2-02-housing, w2-34-works, w2-25-rents, w2-29-lending, w2-13-flood-long; `sonnet` (the general model and no other): the other 31.
