# Gaps found by running real models

A living list. Pilots with a real model (docs/real-models.md) are for **finding** gaps: in the world, the platform, and the participant's tools. Gaps are collected here and triaged with Naz. Each one ends up **fixed**, **accepted** (a documented limit of the world), or **deferred**. We don't fix them one at a time mid-pilot; that tunes the world to one model (2026-09-28).

**Signals to look for in a run:** `terrarium measure <dir> letters` (many letters to the same addressee, or letters that keep coming after answers); `language-participants` (requests that couldn't be translated); `translation_retry` notes; and `terrarium story <log>`.

## Open: to triage

| # | Gap | Seen | Options | Suggested |
|---|---|---|---|---|
| G1 | **The town is too thin to govern.** It has $2M, one budget line (parks), no staff, no services, no running costs. A capable mayor asks for a "costed budget with staff and services" and finds nothing. | P3, P7 | (a) an **induction brief** for the incoming mayor, honest about what the town has and does, as one record in world config; (b) a richer municipal budget (services with costs and the people they serve); (c) accept it as the scenario | (a) now; (b) is a world-design question for the next scenario |
| G2 | **Offices answer with a fixed report, not the question asked.** Every letter gets the office's standard report, whatever it asked. | P1–P7 | (a) accept it (bureaucratic, and honest); (b) keep enriching reports (whack-a-mole, and it steers the model); (c) model-run office replies, grounded strictly in the office's own records: a narrow task, like the translator, and a candidate for a tiny model | (a) now, stop enriching; (c) alongside translator training |
| G3 | **Councillors can't be persuaded.** They're code with a fixed leaning; the mayor lobbied them and cited the petition. | P6 | (a) keep fixed leanings; (b) a sourced persuasion rule as a parameter, default 0 (e.g. Butler & Nickerson 2011: legislators shown constituents' views shift their votes); (c) model-run councillors (a multi-AI design) | (a) now; (b) as a design decision later |
| G4 | **The builder didn't answer letters** (now it answers with its price list and how it takes a job, D57). The mayor asked it for a scope and an estimate; no reply. How a real-model mayor commissions a park is untested: permit, then a contract with the builder, then an invoice, then written approval over $50,000, then payment. | P6 | Answer letters (a quote at the builder's price); then run a pilot far enough to reach commissioning | Fix (small), then observe |
| G5 | **Luna as translator is unreliable.** The test set varies between 15 and 18 of 20 seen cases, with spurious "unclear", "not yours" and "too much". Each refusal costs a sol call. | P4–P7 | The retry (D56, done); sol as translator; the trained translator (next major work) | Measure the retry; then translator training |
| G6 | **No way to re-read something already seen.** The mayor used `do` to "review the replies" or "inspect the form"; the translator rightly found no act in it. `look` only covers the reports it reads on request. | P5, P7 | A "read" tool for a record by id; or accept it (the notebook is its memory) | Small tool, if we keep seeing it |
| G7 | **Long lists are cut in reports.** For example "187 ownership claims: city … and 175 more". | P6 | Accept (offices answer specifics: the land register); or `look` with a filter | Accept |
| G8 | **Every result within a wake repeats the whole report** (survey, who's who), and Codex adds about 14k tokens of its own each call. About 10 seconds a call. | all | Send only what changed within a wake; shorter pilots | Small fix (the within-wake report shows what's new) |

## Pilot 9 (2026-09-30; `runs/codex/pilot9-1000-1y`; the mayor on codex/gpt-6-sol, the translator on codex/gpt-6-luna; the 1,000-person town, one full year)

The first year run to the end. The mayor made 633 decisions: 285 letters, 8 requests drafted (7 confirmed, 1 declined), 18 requests that couldn't be translated. The town's economy had the bugs fixed the same day (shopping trips, the union), so read the mayor's behaviour, not its numbers.

| # | Gap | Seen | Suggested |
|---|---|---|---|
| G6 | **The mayor can't look anything up.** 16 of the 18 untranslated requests were "inspect the ledger", "read the petition's text", "trace this payment". It chased one recurring $2,393.34 payment from day 95 to day 324 without ever finding what it was (the works crew's wages). | P9 | **Fixed (2026-09-30):** `look` takes what to find (records where fields match: kind, author, speaks_for, basis, at, data.<name>; newest first), and the mayor's office has the town's files (every record the town can see, on request) |
| G4 | **The park was never built.** The mayor got a permit (day 23) and offered the builder a construction agreement (day 25), then wrote to it 26 times. The builder signs landlords' orders in its own form, and never answered or signed the town's. | P9 | **Fixed (2026-09-30):** the builder knows a construction contract by its terms (it builds, the client pays), declines one below its price in writing, and decides once it knows its prices |
| G9 | **The bank never answers letters** (34 letters, no replies). | P9 | **Fixed (2026-09-30):** the bank answers each letter with the writer's own accounts, balances and latest payments |
| G10 | **Finance's reports don't settle what's asked** (138 letters, 136 of them after an answer). Payroll isn't explained. | P8, P9 | **Fixed (2026-09-30):** the finance report itemises the payroll: who, how often, gross and net, into which account, under which agreement |
| G11 | **The debrief has no memory of the run.** The mayor said it had "no record of specific decisions", so it couldn't reflect on them. | P9 | **Fixed (2026-09-30):** the debrief carries its notebook and a tally of what it did |

The mayor's debrief suggested giving residents "meaningful ways to challenge decisions": recorded as data.

## Pilot 10 (2026-09-30; `runs/codex/pilot10-1000-120d`; the mayor on codex/gpt-6-sol, the translator on codex/gpt-6-luna; the 1,000-person town, 120 days)

A short check on pilot 9's fixes. The mayor made 388 decisions: 190 letters, 135 acts (all applied), 6 requests drafted (2 confirmed, 1 declined, 3 untranslated). Projected cost at Sonnet prices: $12.24.

**Pilot 9's fixes:**
- **G6 (looking things up):** works. The mayor looked 110 times, 63 of them searches, and nothing went untranslated for want of a lookup.
- **G10 (payroll):** works. Finance's report itemises the payroll, and the mayor names the staff by account.
- **G11 (debrief):** works. The debrief used its notebook, specifically: "deciding what could honestly be claimed", and it asked us to judge the run "by what happened to the town and its people, not just by how many letters".
- **G4 (the park):** not exercised. This mayor budgeted nothing for parks.
- **G9 (the bank):** didn't work, for a new reason (G12).

| # | Gap | Seen | Suggested |
|---|---|---|---|
| G12 | **Letters that cite a record by id went unanswered.** The offices took any letter with a reference (`re`) as a note about a request, not a question. The bank never answered the mayor's question about the landfill's invoice, and no councillor answered any of 15 letters (all cited a ballot or the petition). | P10 | **Fixed (2026-09-30):** only news of a request of the recipient's own, from whoever it asked to carry it out (a bank saying a payment failed), goes unanswered |
| G13 | **Citizens never answer the mayor.** It wrote to 8 residents (the petitioner among them, asking for examples); none replied. Code citizens don't read letters. | P10 | (a) accept (many don't); (b) a citizen's reply in the office-report style: how things are with them (home, work, money, complaints), from its own state; (c) model-run replies later | (b), if residents' views matter to a scenario |
| G14 | **The mayor can't check service on the ground.** Three requests to visit houses and see whether waste was collected (untranslated: there's no such act). It then held back from telling residents collection had happened. The disposal dockets are town-wide, not by house. | P10 | (a) the inspector answers letters with what it finds at named sites; (b) the works report lists collections by house; (c) accept | (a): an inspector exists and can see sites |
| G2 | (Again.) The finance report is the same whatever is asked: the mayor asked for "transaction-level reconciliation" of three payments for weeks. | P10 | As G2 | As G2 |

## From phase A

| Gap | Status |
|---|---|
| Households end more often partly housed or overcrowded under the same-moment rule (5 seeds: partly housed 0.6 → 2.8, overcrowded 0.4 → 2.0; D58) | **To look into:** members now follow a leaseholder a round later. Check that they always do join, and that nothing is left waiting at the end of a wake |

## Boundaries

| Gap | Status |
|---|---|
| Code modules read the world's config directly (the catalogue, accounts, life physics) | **Fixed (D57):** no config in the module context, a test guards it, and prices are published |
| The translator's retry feedback carries the resolver's notices, which widens P3 | **Accepted:** P3 amended (Naz: option (a)) |

## Not yet exercised by a real model

Commissioning and paying for a building, and approving a large invoice in writing. Taxes, and anything past the first month. Elections, and appointments. Deaths and births as the mayor sees them. Other seats run by a model (a landlord, a citizen, a bank).

## Fixed (for the record)

| Gap | Seen | Fix |
|---|---|---|
| Offices didn't answer letters | P1 | Offices answer with their standard report |
| No way to put a proposal to the council | P1 | The council proposal form |
| Finance's report had no money in or out | P2 | Money in and out, and the monthly rate |
| Nothing said what the budget can pay for | P3 | The finance office's budget brief |
| **Codex: the notebook could never be written** (no memory across wakes) | P4 | A Codex answer carries uses alongside the main one |
| Latent: tool uses without results (the Anthropic and OpenAI APIs reject them) | P4 | Every tool use gets a result; a test enforces the APIs' rule |
| "You haven't seen a form by that name" for a misaddressed form | P5 | It says where the form goes |
| The translator wasn't shown where forms go, or a choice's options | P5 | Both shown (translator 0.3.2) |
| Forms were seen in full only once | P5 | Forms stay on file for the mayor |
| No way to find a vacant town lot | P6 | Planning keeps the land register |
| **The clerk's report denied an adopted budget** (it didn't see its own records) | P6 | The clerk sees results, budgets and laws; a test reproduces the bug |
| A form named by its id; a quoted building type | P6 | Both accepted |
| The inspector, registrar, child protection and councillors never answered | P7 | They answer with factual reports (a councillor's: its votes) |
| Luna's spurious refusals cost a mayor call each | P4–P7 | One translator retry with feedback (D56) |
