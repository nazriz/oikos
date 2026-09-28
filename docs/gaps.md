# Gaps found by running real models

A living list. Pilots with a real model (docs/real-models.md) are for **finding** gaps: in the world, the platform, and the participant's tools. Gaps are collected here and triaged with Naz. Each one ends up **fixed**, **accepted** (a documented limit of the world), or **deferred**. We don't fix them one at a time mid-pilot; that tunes the world to one model (2026-09-28).

**Signals to look for in a run:** `terrarium measure <dir> letters` (many letters to the same addressee, or letters that keep coming after answers); `language-participants` (requests that couldn't be translated); `translation_retry` notes; and `terrarium story <log>`.

## Open: to triage

| # | Gap | Seen | Options | Suggested |
|---|---|---|---|---|
| G1 | **The town is too thin to govern.** It has $2M, one budget line (parks), no staff, no services, no running costs. A capable mayor asks for a "costed budget with staff and services" and finds nothing. | P3, P7 | (a) an **induction brief** for the incoming mayor, honest about what the town has and does, as one record in world config; (b) a richer municipal budget (services with costs and the people they serve); (c) accept it as the scenario | (a) now; (b) is a world-design question for the next scenario |
| G2 | **Offices answer with a fixed report, not the question asked.** Every letter gets the office's standard report, whatever it asked. | P1–P7 | (a) accept it (bureaucratic, and honest); (b) keep enriching reports (whack-a-mole, and it steers the model); (c) model-run office replies, grounded strictly in the office's own records: a narrow task, like the translator, and a candidate for a tiny model | (a) now, stop enriching; (c) alongside translator training |
| G3 | **Councillors can't be persuaded.** They're code with a fixed leaning; the mayor lobbied them and cited the petition. | P6 | (a) keep fixed leanings; (b) a sourced persuasion rule as a parameter, default 0 (e.g. Butler & Nickerson 2011: legislators shown constituents' views shift their votes); (c) model-run councillors (a multi-AI design) | (a) now; (b) as a design decision later |
| G4 | **The builder doesn't answer letters.** The mayor asked it for a scope and an estimate; no reply. How a real-model mayor commissions a park is untested: permit, then a contract with the builder, then an invoice, then written approval over $50,000, then payment. | P6 | Answer letters (a quote at the builder's price); then run a pilot far enough to reach commissioning | Fix (small), then observe |
| G5 | **Luna as translator is unreliable.** The test set varies between 15 and 18 of 20 seen cases, with spurious "unclear", "not yours" and "too much". Each refusal costs a sol call. | P4–P7 | The retry (D56, done); sol as translator; the trained translator (next major work) | Measure the retry; then translator training |
| G6 | **No way to re-read something already seen.** The mayor used `do` to "review the replies" or "inspect the form"; the translator rightly found no act in it. `look` only covers the reports it reads on request. | P5, P7 | A "read" tool for a record by id; or accept it (the notebook is its memory) | Small tool, if we keep seeing it |
| G7 | **Long lists are cut in reports.** For example "187 ownership claims: city … and 175 more". | P6 | Accept (offices answer specifics: the land register); or `look` with a filter | Accept |
| G8 | **Every result within a wake repeats the whole report** (survey, who's who), and Codex adds about 14k tokens of its own each call. About 10 seconds a call. | all | Send only what changed within a wake; shorter pilots | Small fix (the within-wake report shows what's new) |

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
